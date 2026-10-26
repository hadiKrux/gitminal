import { describe, expect, it } from "bun:test";
import {
  executeBranchCheckout,
  executeBranchCreate,
  executeBranchDelete,
  executeRemoteCreateLocal,
} from "@/domain/commands/commands.branches";
import type {
  CommandFormValues,
  CommandHandlerContext,
  CommandTarget,
} from "@/domain/commands/commands.types";
import type { GitClient } from "@/domain/git/git.types";
import { createScriptedGitClient, fakeGitResult } from "@/test/git.fake";

/**
 * Builds a handler context for one executor call.
 *
 * @param client - Scripted git client.
 * @param input - Target, form values, and working directory.
 * @returns The handler context.
 */
function createContext(
  client: GitClient,
  input: {
    readonly target: CommandTarget;
    readonly formValues?: CommandFormValues;
    readonly cwd?: string;
  },
): CommandHandlerContext {
  return {
    request: {
      commandId: "branch.test",
      target: input.target,
      formValues: input.formValues,
    },
    target: input.target,
    cwd: input.cwd ?? "/repo",
    client,
    signal: new AbortController().signal,
    notifyProgress: () => {},
  };
}

/** Target of a local branch action. */
const FEATURE_TARGET: CommandTarget = { kind: "branch", name: "feature" };

describe("executeBranchCreate", () => {
  it("creates and checks out in one atomic switch", async () => {
    const fake = createScriptedGitClient({
      "switch -c topic HEAD": fakeGitResult(""),
    });

    const outcome = await executeBranchCreate(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: { name: "topic", checkout: "true", startPoint: "" },
      }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([["switch", "-c", "topic", "HEAD"]]);
    expect(fake.calls[0]?.operationClass).toBe("write");
    expect(outcome.steps).toHaveLength(1);
    expect(outcome.steps[0]?.argv).toEqual(["git", "switch", "-c", "topic", "HEAD"]);
  });

  it("creates without checkout from an explicit start point", async () => {
    const fake = createScriptedGitClient({ "branch topic abc123": fakeGitResult("") });

    const outcome = await executeBranchCreate(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: { name: "topic", checkout: "false", startPoint: "abc123" },
      }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([["branch", "topic", "abc123"]]);
    expect(outcome.steps[0]?.argv).toEqual(["git", "branch", "topic", "abc123"]);
  });

  it("refuses an unsafe branch name before running git", async () => {
    const fake = createScriptedGitClient({});
    const outcome = await executeBranchCreate(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: { name: "-forced", checkout: "true" },
      }),
    );

    expect(outcome.blockedReason).toBe("invalid-target");
    expect(outcome.steps).toEqual([]);
    expect(fake.calls).toEqual([]);
  });
});

describe("executeBranchCheckout", () => {
  it("checks out the target branch with one write step", async () => {
    const fake = createScriptedGitClient({ "checkout feature": fakeGitResult("") });

    const outcome = await executeBranchCheckout(
      createContext(fake.client, { target: FEATURE_TARGET }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([["checkout", "feature"]]);
    expect(fake.calls[0]?.operationClass).toBe("write");
    expect(outcome.steps[0]?.argv).toEqual(["git", "checkout", "feature"]);
  });

  it("allows checking out the current branch as a git no-op", async () => {
    const fake = createScriptedGitClient({ "checkout main": fakeGitResult("") });

    await executeBranchCheckout(
      createContext(fake.client, { target: { kind: "branch", name: "main" } }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([["checkout", "main"]]);
  });

  it("refuses a non-branch target before running git", async () => {
    const fake = createScriptedGitClient({});
    const outcome = await executeBranchCheckout(
      createContext(fake.client, { target: { kind: "none" } }),
    );

    expect(outcome.blockedReason).toBe("invalid-target");
    expect(outcome.steps).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("refuses an unsafe branch name before running git", async () => {
    const fake = createScriptedGitClient({});
    const outcome = await executeBranchCheckout(
      createContext(fake.client, { target: { kind: "branch", name: "-oops" } }),
    );

    expect(outcome.blockedReason).toBe("invalid-target");
    expect(fake.calls).toEqual([]);
  });
});

describe("executeBranchDelete", () => {
  it("deletes a local branch with -d", async () => {
    const fake = createScriptedGitClient({ "branch -d feature": fakeGitResult("") });

    const outcome = await executeBranchDelete(
      createContext(fake.client, { target: FEATURE_TARGET, formValues: { scope: "local" } }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([["branch", "-d", "feature"]]);
    expect(outcome.remoteResults).toBeUndefined();
    expect(outcome.failed).toBeUndefined();
  });

  it("uses -D when the force acknowledgement is set", async () => {
    const fake = createScriptedGitClient({ "branch -D feature": fakeGitResult("") });

    await executeBranchDelete(
      createContext(fake.client, {
        target: FEATURE_TARGET,
        formValues: { scope: "local", force: "true" },
      }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([["branch", "-D", "feature"]]);
  });

  it("deletes the local branch first and then the remote branch", async () => {
    const fake = createScriptedGitClient({
      "branch -d feature": fakeGitResult(""),
      "push --progress --delete -- origin feature": fakeGitResult(""),
    });

    const outcome = await executeBranchDelete(
      createContext(fake.client, {
        target: FEATURE_TARGET,
        formValues: { scope: "local-remote", remote: "origin", remoteBranch: "feature" },
      }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([
      ["branch", "-d", "feature"],
      ["push", "--progress", "--delete", "--", "origin", "feature"],
    ]);
    expect(fake.calls[1]?.operationClass).toBe("network");
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: true }]);
    expect(outcome.failed).toBeUndefined();
  });

  it("runs no remote delete when the local delete fails", async () => {
    const fake = createScriptedGitClient({
      "branch -d feature": fakeGitResult("", false, "error: branch not fully merged"),
    });

    const outcome = await executeBranchDelete(
      createContext(fake.client, {
        target: FEATURE_TARGET,
        formValues: { scope: "local-remote", remote: "origin", remoteBranch: "feature" },
      }),
    );

    expect(fake.calls).toHaveLength(1);
    expect(outcome.steps).toHaveLength(1);
    expect(outcome.remoteResults).toBeUndefined();
    expect(outcome.failed).toBeUndefined();
  });

  it("reports a partial failure that names the surviving remote branch", async () => {
    const fake = createScriptedGitClient({
      "branch -d feature": fakeGitResult(""),
      "push --progress --delete -- origin feature": fakeGitResult("", false, "error: denied"),
    });

    const outcome = await executeBranchDelete(
      createContext(fake.client, {
        target: FEATURE_TARGET,
        formValues: { scope: "local-remote", remote: "origin", remoteBranch: "feature" },
      }),
    );

    expect(fake.calls).toHaveLength(2);
    expect(outcome.failed).toBeTrue();
    expect(outcome.warnings).toEqual(["remote branch origin/feature was not deleted"]);
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: false }]);
  });

  it("falls back to the target branch name for the remote half", async () => {
    const fake = createScriptedGitClient({
      "branch -d feature": fakeGitResult(""),
      "push --progress --delete -- origin feature": fakeGitResult(""),
    });

    await executeBranchDelete(
      createContext(fake.client, {
        target: FEATURE_TARGET,
        formValues: { scope: "local-remote", remote: "origin" },
      }),
    );

    expect(fake.calls[1]?.args).toEqual([
      "push",
      "--progress",
      "--delete",
      "--",
      "origin",
      "feature",
    ]);
  });

  it("requires a branch target", async () => {
    const fake = createScriptedGitClient({});
    const outcome = await executeBranchDelete(
      createContext(fake.client, { target: { kind: "none" } }),
    );

    expect(outcome.blockedReason).toBe("missing-target");
    expect(fake.calls).toEqual([]);
  });
});

describe("executeRemoteCreateLocal", () => {
  const remoteBranchTarget: CommandTarget = {
    kind: "remoteBranch",
    remote: "origin",
    branch: "topic",
  };

  it("creates and checks out from the remote-tracking ref in one atomic switch", async () => {
    const fake = createScriptedGitClient({
      "switch -c topic origin/topic": fakeGitResult(""),
    });

    const outcome = await executeRemoteCreateLocal(
      createContext(fake.client, {
        target: remoteBranchTarget,
        formValues: { name: "topic", checkout: "true" },
      }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([
      ["switch", "-c", "topic", "origin/topic"],
    ]);
    expect(outcome.steps[0]?.argv).toEqual(["git", "switch", "-c", "topic", "origin/topic"]);
  });

  it("creates without checkout when the form leaves it unchecked", async () => {
    const fake = createScriptedGitClient({
      "branch topic origin/topic": fakeGitResult(""),
    });

    await executeRemoteCreateLocal(
      createContext(fake.client, {
        target: remoteBranchTarget,
        formValues: { name: "topic", checkout: "false" },
      }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([["branch", "topic", "origin/topic"]]);
  });

  it("requires a remote branch target", async () => {
    const fake = createScriptedGitClient({});
    const outcome = await executeRemoteCreateLocal(
      createContext(fake.client, { target: { kind: "none" } }),
    );

    expect(outcome.blockedReason).toBe("missing-target");
    expect(fake.calls).toEqual([]);
  });
});
