import { describe, expect, it } from "bun:test";
import {
  amendCommit,
  buildAmendCommitArgs,
  buildCommitArgs,
  buildStagedCommitArgs,
  commitStaged,
} from "@/domain/git/git.commit";
import { createScriptedGitClient, fakeGitResult } from "@/test/git.fake";

/** Options shared by the executor tests. */
const BASE_OPTIONS = {
  cwd: "/repo",
  signal: new AbortController().signal,
};

describe("buildCommitArgs", () => {
  it("builds a normal commit with no amend or no-verify flag", () => {
    const plan = buildStagedCommitArgs("fix the parser");

    expect(plan.ok).toBe(true);

    if (plan.ok) {
      expect(plan.args).toEqual(["commit", "-m", "fix the parser"]);
    }
  });

  it("adds only --no-verify for the no-verify variant", () => {
    const plan = buildStagedCommitArgs("fix the parser", { noVerify: true });

    expect(plan.ok).toBe(true);

    if (plan.ok) {
      expect(plan.args).toEqual(["commit", "--no-verify", "-m", "fix the parser"]);
    }
  });

  it("adds only --amend for the amend variant", () => {
    const plan = buildAmendCommitArgs("amended subject");

    expect(plan.ok).toBe(true);

    if (plan.ok) {
      expect(plan.args).toEqual(["commit", "--amend", "-m", "amended subject"]);
    }
  });

  it("adds both --amend and --no-verify for the amend no-verify variant", () => {
    const plan = buildAmendCommitArgs("amended subject", { noVerify: true });

    expect(plan.ok).toBe(true);

    if (plan.ok) {
      expect(plan.args).toEqual(["commit", "--amend", "--no-verify", "-m", "amended subject"]);
    }
  });

  it("keeps a multiline message in one argv value and never adds a pathspec or -a", () => {
    const message = "subject line\n\nbody line one\nbody line two";
    const plan = buildCommitArgs({ message });

    expect(plan.ok).toBe(true);

    if (plan.ok) {
      expect(plan.args).toEqual(["commit", "-m", message]);
      expect(plan.args.filter((arg) => arg === "-a" || arg === "-A")).toEqual([]);
      expect(plan.args).not.toContain("--");
      expect(plan.args.at(-1)).toBe(message);
      expect(plan.args.at(-1)?.split("\n")).toHaveLength(4);
    }
  });

  it("rejects an empty or whitespace-only message", () => {
    expect(buildStagedCommitArgs("").ok).toBe(false);
    expect(buildStagedCommitArgs("   \n\t ").ok).toBe(false);
    expect(buildAmendCommitArgs("  ").ok).toBe(false);
  });

  it("rejects a NUL in the message", () => {
    expect(buildStagedCommitArgs("subject\0body").ok).toBe(false);
  });
});

describe("commit executors", () => {
  it("runs a normal commit through the injected client", async () => {
    const client = createScriptedGitClient({
      "commit -m fix": fakeGitResult(""),
    });
    const result = await commitStaged(client.client, { ...BASE_OPTIONS, message: "fix" });

    expect(result.ok).toBe(true);
    expect(result.reason).toBeNull();
    expect(client.calls[0]?.args).toEqual(["commit", "-m", "fix"]);
    expect(client.calls[0]?.operationClass).toBe("write");
  });

  it("adds --no-verify only for the no-verify executor call", async () => {
    const client = createScriptedGitClient({
      "commit --no-verify -m fix": fakeGitResult(""),
    });
    const result = await commitStaged(client.client, {
      ...BASE_OPTIONS,
      message: "fix",
      noVerify: true,
    });

    expect(result.ok).toBe(true);
    expect(client.calls[0]?.args).toEqual(["commit", "--no-verify", "-m", "fix"]);
  });

  it("runs an amend through the injected client", async () => {
    const client = createScriptedGitClient({
      "commit --amend -m amended": fakeGitResult(""),
    });
    const result = await amendCommit(client.client, { ...BASE_OPTIONS, message: "amended" });

    expect(result.ok).toBe(true);
    expect(client.calls[0]?.args).toEqual(["commit", "--amend", "-m", "amended"]);
  });

  it("classifies a failed commit without throwing", async () => {
    const client = createScriptedGitClient({
      "commit -m fix": fakeGitResult("", false, "nothing to commit"),
    });
    const result = await commitStaged(client.client, { ...BASE_OPTIONS, message: "fix" });

    expect(result.ok).toBe(false);
    expect(result.failure?.message).toBe("nothing to commit");
    expect(result.steps[0]?.exitCode).toBe(1);
  });

  it("refuses an empty message without invoking git", async () => {
    const client = createScriptedGitClient({});
    const result = await commitStaged(client.client, { ...BASE_OPTIONS, message: "   " });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("empty-message");
    expect(client.calls).toHaveLength(0);
  });
});
