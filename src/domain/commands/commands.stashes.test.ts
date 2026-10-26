import { describe, expect, it } from "bun:test";
import {
  executeStashApply,
  executeStashCreate,
  executeStashDelete,
  executeStashPop,
} from "@/domain/commands/commands.stashes";
import type {
  CommandFormValues,
  CommandHandlerContext,
  CommandTarget,
} from "@/domain/commands/commands.types";
import { buildListStashesArgs } from "@/domain/git/git.stashes";
import { STATUS_ARGS } from "@/domain/git/git.status";
import type { GitClient } from "@/domain/git/git.types";
import { createScriptedGitClient, fakeGitResult } from "@/test/git.fake";

/** Joined argv of the stash list read. */
const STASH_LIST_ARGS = buildListStashesArgs().join(" ");

/** Joined argv of the canonical status read. */
const STATUS_ARGS_KEY = STATUS_ARGS.join(" ");

/** Status output with one unstaged change and no untracked files. */
const TRACKED_CHANGE_STATUS =
  "# branch.oid abc123\0# branch.head main\0" +
  "1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb tracked.txt\0";

/** Status output whose only change is an untracked file. */
const UNTRACKED_ONLY_STATUS = "# branch.oid abc123\0# branch.head main\0? new.txt\0";

/**
 * Builds a stash list output.
 *
 * @param entries - Selector position and object name pairs, in git order.
 * @returns The recorded `git stash list` output.
 */
function stashList(entries: readonly (readonly [number, string])[]): string {
  return entries
    .map(
      ([position, objectName]) =>
        `stash@{${position}}\0${objectName}\0WIP on main: 111 work\x001700000000`,
    )
    .join("\n");
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
      commandId: "stash.test",
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

describe("executeStashCreate", () => {
  it("stashes tracked changes with the message", async () => {
    const fake = createScriptedGitClient({
      [STATUS_ARGS_KEY]: fakeGitResult(TRACKED_CHANGE_STATUS),
      "stash push -m work": fakeGitResult(""),
    });

    const outcome = await executeStashCreate(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: { message: "work", includeUntracked: "false" },
      }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([
      [...STATUS_ARGS],
      ["stash", "push", "-m", "work"],
    ]);
    expect(fake.calls[0]?.touchesIndex).toBeTrue();
    expect(outcome.steps.map((step) => step.argv)).toEqual([
      ["git", ...STATUS_ARGS],
      ["git", "stash", "push", "-m", "work"],
    ]);
  });

  it("adds -u when untracked files are included", async () => {
    const fake = createScriptedGitClient({
      [STATUS_ARGS_KEY]: fakeGitResult(UNTRACKED_ONLY_STATUS),
      "stash push -u -m work": fakeGitResult(""),
    });

    await executeStashCreate(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: { message: "work", includeUntracked: "true" },
      }),
    );

    expect(fake.calls[1]?.args).toEqual(["stash", "push", "-u", "-m", "work"]);
  });

  it("blocks an only-untracked stash when untracked files are excluded", async () => {
    const fake = createScriptedGitClient({
      [STATUS_ARGS_KEY]: fakeGitResult(UNTRACKED_ONLY_STATUS),
    });

    const outcome = await executeStashCreate(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: { message: "work", includeUntracked: "false" },
      }),
    );

    expect(outcome.blockedReason).toBe("only-untracked-changes");
    expect(fake.calls).toHaveLength(1);
  });

  it("reports a failed status read without running the stash", async () => {
    const fake = createScriptedGitClient({
      [STATUS_ARGS_KEY]: fakeGitResult("", false, "fatal: unable to read index"),
    });

    const outcome = await executeStashCreate(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: { message: "work", includeUntracked: "false" },
      }),
    );

    expect(outcome.failed).toBeTrue();
    expect(fake.calls).toHaveLength(1);
  });

  it("requires a message", async () => {
    const fake = createScriptedGitClient({
      [STATUS_ARGS_KEY]: fakeGitResult(TRACKED_CHANGE_STATUS),
    });

    const outcome = await executeStashCreate(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: { message: "", includeUntracked: "false" },
      }),
    );

    expect(outcome.blockedReason).toBe("invalid-target");
  });
});

describe("stash actions resolve the object name at action time", () => {
  const applyTarget: CommandTarget = { kind: "stash", objectName: "object-b" };

  it("applies the selector that currently holds the target object", async () => {
    const fake = createScriptedGitClient({
      [STASH_LIST_ARGS]: fakeGitResult(
        stashList([
          [0, "object-a"],
          [1, "object-b"],
        ]),
      ),
      "stash apply stash@{1}": fakeGitResult(""),
    });

    const outcome = await executeStashApply(createContext(fake.client, { target: applyTarget }));

    expect(fake.calls.map((call) => call.args)).toEqual([
      ["stash", "list", "--format=%gd%x00%H%x00%gs%x00%ct"],
      ["stash", "apply", "stash@{1}"],
    ]);
    expect(outcome.steps.map((step) => step.argv)).toEqual([
      ["git", "stash", "list", "--format=%gd%x00%H%x00%gs%x00%ct"],
      ["git", "stash", "apply", "stash@{1}"],
    ]);
  });

  it("pops the resolved selector", async () => {
    const fake = createScriptedGitClient({
      [STASH_LIST_ARGS]: fakeGitResult(stashList([[0, "object-b"]])),
      "stash pop stash@{0}": fakeGitResult(""),
    });

    await executeStashPop(createContext(fake.client, { target: applyTarget }));

    expect(fake.calls[1]?.args).toEqual(["stash", "pop", "stash@{0}"]);
  });

  it("drops the resolved selector", async () => {
    const fake = createScriptedGitClient({
      [STASH_LIST_ARGS]: fakeGitResult(stashList([[0, "object-b"]])),
      "stash drop stash@{0}": fakeGitResult(""),
    });

    await executeStashDelete(createContext(fake.client, { target: applyTarget }));

    expect(fake.calls[1]?.args).toEqual(["stash", "drop", "stash@{0}"]);
  });

  it("blocks a stash that no longer exists", async () => {
    const fake = createScriptedGitClient({
      [STASH_LIST_ARGS]: fakeGitResult(stashList([[0, "object-a"]])),
    });

    const outcome = await executeStashApply(createContext(fake.client, { target: applyTarget }));

    expect(outcome.blockedReason).toBe("stash-changed-externally");
    expect(fake.calls).toHaveLength(1);
  });

  it("fails the action instead of claiming a change when the list read fails", async () => {
    const fake = createScriptedGitClient({
      [STASH_LIST_ARGS]: fakeGitResult("", false, "fatal: unable to read logs"),
    });

    const outcome = await executeStashApply(createContext(fake.client, { target: applyTarget }));

    expect(outcome.blockedReason).toBeUndefined();
    expect(outcome.failed).toBeTrue();
    expect(outcome.steps).toHaveLength(1);
  });

  it("blocks a selector whose position now holds a different stash", async () => {
    const fake = createScriptedGitClient({
      [STASH_LIST_ARGS]: fakeGitResult(stashList([[0, "object-a"]])),
    });

    const outcome = await executeStashDelete(
      createContext(fake.client, { target: { kind: "stash", objectName: "stash@{0}" } }),
    );

    expect(outcome.blockedReason).toBe("stash-changed-externally");
    expect(fake.calls).toHaveLength(1);
  });

  it("requires a stash target", async () => {
    const fake = createScriptedGitClient({});
    const outcome = await executeStashApply(
      createContext(fake.client, { target: { kind: "none" } }),
    );

    expect(outcome.blockedReason).toBe("missing-target");
    expect(fake.calls).toEqual([]);
  });
});
