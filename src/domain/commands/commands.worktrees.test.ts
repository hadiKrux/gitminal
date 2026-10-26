import { describe, expect, it } from "bun:test";
import type {
  CommandFormValues,
  CommandHandlerContext,
  CommandTarget,
} from "@/domain/commands/commands.types";
import { executeWorktreeCreate, executeWorktreeDelete } from "@/domain/commands/commands.worktrees";
import type { GitClient } from "@/domain/git/git.types";
import { buildListWorktreesArgs } from "@/domain/git/git.worktrees";
import { createScriptedGitClient, fakeGitResult } from "@/test/git.fake";

/** Joined argv of the worktree list read. */
const WORKTREE_LIST_ARGS = buildListWorktreesArgs().join(" ");

/**
 * Builds a worktree list output.
 *
 * @param locks - Worktree path and lock state pairs.
 * @returns The recorded porcelain output.
 */
function worktreeList(locks: readonly (readonly [string, boolean])[]): string {
  return locks
    .map(([path, locked]) =>
      [
        `worktree ${path}`,
        "HEAD abc123",
        "branch refs/heads/feature",
        ...(locked ? ["locked"] : []),
      ].join("\n"),
    )
    .join("\n\n");
}

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
      commandId: "worktree.test",
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

describe("executeWorktreeCreate", () => {
  it("adds a new branch worktree from HEAD", async () => {
    const fake = createScriptedGitClient({
      "worktree add -b topic /repo-topic HEAD": fakeGitResult(""),
    });

    const outcome = await executeWorktreeCreate(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: { path: "/repo-topic", mode: "new", branch: "topic" },
      }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([
      ["worktree", "add", "-b", "topic", "/repo-topic", "HEAD"],
    ]);
    expect(outcome.steps[0]?.argv).toEqual([
      "git",
      "worktree",
      "add",
      "-b",
      "topic",
      "/repo-topic",
      "HEAD",
    ]);
  });

  it("adds an existing branch worktree", async () => {
    const fake = createScriptedGitClient({
      "worktree add /repo-topic topic": fakeGitResult(""),
    });

    await executeWorktreeCreate(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: { path: "/repo-topic", mode: "existing", branch: "topic" },
      }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([
      ["worktree", "add", "/repo-topic", "topic"],
    ]);
  });

  it("refuses an unknown branch mode", async () => {
    const fake = createScriptedGitClient({});
    const outcome = await executeWorktreeCreate(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: { path: "/repo-topic", mode: "detached", branch: "topic" },
      }),
    );

    expect(outcome.blockedReason).toBe("invalid-target");
    expect(fake.calls).toEqual([]);
  });
});

describe("executeWorktreeDelete", () => {
  it("removes a clean worktree with no force flag", async () => {
    const fake = createScriptedGitClient({
      [WORKTREE_LIST_ARGS]: fakeGitResult(
        worktreeList([
          ["/repo", false],
          ["/repo-old", false],
        ]),
      ),
      "worktree remove /repo-old": fakeGitResult(""),
    });

    const outcome = await executeWorktreeDelete(
      createContext(fake.client, {
        target: { kind: "worktree", path: "/repo-old" },
        formValues: { force: "false" },
      }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([
      ["worktree", "list", "--porcelain"],
      ["worktree", "remove", "/repo-old"],
    ]);
    expect(outcome.steps).toHaveLength(2);
  });

  it("uses one --force when the acknowledgement is set", async () => {
    const fake = createScriptedGitClient({
      [WORKTREE_LIST_ARGS]: fakeGitResult(worktreeList([["/repo-old", false]])),
      "worktree remove --force /repo-old": fakeGitResult(""),
    });

    await executeWorktreeDelete(
      createContext(fake.client, {
        target: { kind: "worktree", path: "/repo-old" },
        formValues: { force: "true" },
      }),
    );

    expect(fake.calls[1]?.args).toEqual(["worktree", "remove", "--force", "/repo-old"]);
  });

  it("uses two force flags for a locked worktree", async () => {
    const fake = createScriptedGitClient({
      [WORKTREE_LIST_ARGS]: fakeGitResult(worktreeList([["/repo-locked", true]])),
      "worktree remove -f -f /repo-locked": fakeGitResult(""),
    });

    await executeWorktreeDelete(
      createContext(fake.client, {
        target: { kind: "worktree", path: "/repo-locked" },
        formValues: { force: "true" },
      }),
    );

    expect(fake.calls[1]?.args).toEqual(["worktree", "remove", "-f", "-f", "/repo-locked"]);
  });

  it("attempts no force flag without the acknowledgement", async () => {
    const fake = createScriptedGitClient({
      [WORKTREE_LIST_ARGS]: fakeGitResult(worktreeList([["/repo-locked", true]])),
      "worktree remove /repo-locked": fakeGitResult("", false, "fatal: locked working tree"),
    });

    await executeWorktreeDelete(
      createContext(fake.client, {
        target: { kind: "worktree", path: "/repo-locked" },
        formValues: { force: "false" },
      }),
    );

    expect(fake.calls[1]?.args).toEqual(["worktree", "remove", "/repo-locked"]);
  });

  it("refuses the current worktree", async () => {
    const fake = createScriptedGitClient({
      [WORKTREE_LIST_ARGS]: fakeGitResult(worktreeList([["/repo", false]])),
    });

    const outcome = await executeWorktreeDelete(
      createContext(fake.client, {
        target: { kind: "worktree", path: "/repo" },
        formValues: { force: "false" },
      }),
    );

    expect(outcome.blockedReason).toBe("current-worktree");
    expect(fake.calls).toHaveLength(1);
  });

  it("refuses a worktree that no longer exists", async () => {
    const fake = createScriptedGitClient({
      [WORKTREE_LIST_ARGS]: fakeGitResult(worktreeList([["/repo", false]])),
    });

    const outcome = await executeWorktreeDelete(
      createContext(fake.client, {
        target: { kind: "worktree", path: "/repo-gone" },
        formValues: { force: "false" },
      }),
    );

    expect(outcome.blockedReason).toBe("worktree-missing");
    expect(fake.calls).toHaveLength(1);
  });
});
