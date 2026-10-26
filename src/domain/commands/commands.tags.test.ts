import { describe, expect, it } from "bun:test";
import {
  executeTagCreate,
  executeTagDelete,
  executeTagPush,
} from "@/domain/commands/commands.tags";
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
 * @param input - Target and form values.
 * @returns The handler context.
 */
function createContext(
  client: GitClient,
  input: { readonly target: CommandTarget; readonly formValues?: CommandFormValues },
): CommandHandlerContext {
  return {
    request: {
      commandId: "tag.test",
      target: input.target,
      formValues: input.formValues,
    },
    target: input.target,
    cwd: "/repo",
    client,
    signal: new AbortController().signal,
    notifyProgress: () => {},
  };
}

/** Target of a tag action. */
const TAG_TARGET: CommandTarget = { kind: "tag", name: "v1.0.0" };

/** Arguments of the tag push for the fixture tag. */
const PUSH_ARGS = ["push", "--progress", "--", "origin", "refs/tags/v1.0.0"];

describe("executeTagCreate", () => {
  it("creates a lightweight tag when the message is empty", async () => {
    const fake = createScriptedGitClient({ "tag v1.0.0 abc123": fakeGitResult("") });

    const outcome = await executeTagCreate(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: { name: "v1.0.0", message: "", target: "abc123" },
      }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([["tag", "v1.0.0", "abc123"]]);
    expect(outcome.steps[0]?.argv).toEqual(["git", "tag", "v1.0.0", "abc123"]);
  });

  it("creates an annotated tag when a message is present", async () => {
    const fake = createScriptedGitClient({
      "tag -a v1.0.0 abc123 -m release": fakeGitResult(""),
    });

    await executeTagCreate(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: { name: "v1.0.0", message: "release", target: "abc123" },
      }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([
      ["tag", "-a", "v1.0.0", "abc123", "-m", "release"],
    ]);
  });

  it("pushes after creating when the form asks for it", async () => {
    const fake = createScriptedGitClient({
      "tag v1.0.0 HEAD": fakeGitResult(""),
      [PUSH_ARGS.join(" ")]: fakeGitResult(""),
    });

    const outcome = await executeTagCreate(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: { name: "v1.0.0", message: "", target: "", push: "true", remote: "origin" },
      }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([["tag", "v1.0.0", "HEAD"], PUSH_ARGS]);
    expect(fake.calls[1]?.operationClass).toBe("network");
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: true }]);
  });

  it("reports a failed push without claiming the remote half", async () => {
    const fake = createScriptedGitClient({
      "tag v1.0.0 HEAD": fakeGitResult(""),
      [PUSH_ARGS.join(" ")]: fakeGitResult("", false, "error: rejected"),
    });

    const outcome = await executeTagCreate(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: { name: "v1.0.0", message: "", target: "", push: "true", remote: "origin" },
      }),
    );

    expect(outcome.failed).toBeTrue();
    expect(outcome.warnings).toEqual(["tag v1.0.0 was not pushed to origin"]);
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: false }]);
  });

  it("refuses an unsafe tag name before running git", async () => {
    const fake = createScriptedGitClient({});
    const outcome = await executeTagCreate(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: { name: "-oops", message: "", target: "" },
      }),
    );

    expect(outcome.blockedReason).toBe("invalid-target");
    expect(fake.calls).toEqual([]);
  });
});

describe("executeTagPush", () => {
  it("pushes one explicit tag refspec", async () => {
    const fake = createScriptedGitClient({ [PUSH_ARGS.join(" ")]: fakeGitResult("") });

    const outcome = await executeTagPush(
      createContext(fake.client, { target: TAG_TARGET, formValues: { remote: "origin" } }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([PUSH_ARGS]);
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: true }]);
  });

  it("requires a tag target", async () => {
    const fake = createScriptedGitClient({});
    const outcome = await executeTagPush(createContext(fake.client, { target: { kind: "none" } }));

    expect(outcome.blockedReason).toBe("missing-target");
    expect(fake.calls).toEqual([]);
  });
});

describe("executeTagDelete", () => {
  it("deletes only the local tag", async () => {
    const fake = createScriptedGitClient({ "tag -d v1.0.0": fakeGitResult("") });

    const outcome = await executeTagDelete(
      createContext(fake.client, { target: TAG_TARGET, formValues: { scope: "local" } }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([["tag", "-d", "v1.0.0"]]);
    expect(outcome.remoteResults).toBeUndefined();
  });

  it("deletes only the remote tag", async () => {
    const fake = createScriptedGitClient({
      "push --progress --delete -- origin refs/tags/v1.0.0": fakeGitResult(""),
    });

    const outcome = await executeTagDelete(
      createContext(fake.client, {
        target: TAG_TARGET,
        formValues: { scope: "remote", remote: "origin" },
      }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([
      ["push", "--progress", "--delete", "--", "origin", "refs/tags/v1.0.0"],
    ]);
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: true }]);
  });

  it("deletes the remote tag before the local tag", async () => {
    const fake = createScriptedGitClient({
      "push --progress --delete -- origin refs/tags/v1.0.0": fakeGitResult(""),
      "tag -d v1.0.0": fakeGitResult(""),
    });

    const outcome = await executeTagDelete(
      createContext(fake.client, {
        target: TAG_TARGET,
        formValues: { scope: "local-remote", remote: "origin" },
      }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([
      ["push", "--progress", "--delete", "--", "origin", "refs/tags/v1.0.0"],
      ["tag", "-d", "v1.0.0"],
    ]);
    expect(outcome.steps.map((step) => step.argv)).toEqual([
      ["git", "push", "--progress", "--delete", "--", "origin", "refs/tags/v1.0.0"],
      ["git", "tag", "-d", "v1.0.0"],
    ]);
  });

  it("keeps the local tag when the remote delete fails", async () => {
    const fake = createScriptedGitClient({
      "push --progress --delete -- origin refs/tags/v1.0.0": fakeGitResult(
        "",
        false,
        "error: denied",
      ),
    });

    const outcome = await executeTagDelete(
      createContext(fake.client, {
        target: TAG_TARGET,
        formValues: { scope: "local-remote", remote: "origin" },
      }),
    );

    expect(fake.calls).toHaveLength(1);
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: false }]);
  });

  it("reports a partial failure when the local delete fails after the remote one", async () => {
    const fake = createScriptedGitClient({
      "push --progress --delete -- origin refs/tags/v1.0.0": fakeGitResult(""),
      "tag -d v1.0.0": fakeGitResult("", false, "error: unable to delete"),
    });

    const outcome = await executeTagDelete(
      createContext(fake.client, {
        target: TAG_TARGET,
        formValues: { scope: "local-remote", remote: "origin" },
      }),
    );

    expect(fake.calls).toHaveLength(2);
    expect(outcome.failed).toBeTrue();
    expect(outcome.warnings).toEqual(["local tag v1.0.0 remains"]);
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: true }]);
  });
});
