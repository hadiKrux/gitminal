import { describe, expect, it } from "bun:test";
import {
  DIFF_FORM_PATHS,
  DIFF_FORM_READ_ONLY,
  DIFF_FORM_SECTION,
  executeDiffDeleteAllUntracked,
  executeDiffDeleteUntracked,
  executeDiffDiscard,
  executeDiffDiscardAll,
  executeDiffStage,
  executeDiffStageAll,
  executeDiffUnstage,
  executeDiffUnstageAll,
} from "@/domain/commands/commands.diff";
import type {
  CommandFormValues,
  CommandHandlerContext,
  CommandTarget,
} from "@/domain/commands/commands.types";
import { STATUS_ARGS } from "@/domain/git/git.status";
import type { GitClient } from "@/domain/git/git.types";
import { createScriptedGitClient, fakeGitResult } from "@/test/git.fake";

/** Joined argv of the canonical status read. */
const STATUS_ARGS_KEY = STATUS_ARGS.join(" ");

/** Status output with a staged rename pair and one plain working change. */
const RENAME_STATUS =
  "# branch.oid abc123\0# branch.head main\0" +
  "2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 new.txt\0old.txt\0" +
  "1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb tracked.txt\0";

/**
 * Builds a handler context for one executor call.
 *
 * @param client - Scripted git client.
 * @param input - Target and form values.
 * @returns The handler context.
 */
function createContext(
  client: GitClient,
  input: {
    readonly target: CommandTarget;
    readonly formValues?: CommandFormValues;
    readonly readOnly?: boolean;
  },
): CommandHandlerContext {
  return {
    request: {
      commandId: "diff.test",
      target: input.target,
      formValues: input.formValues,
    },
    target: input.target,
    cwd: "/repo",
    client,
    signal: new AbortController().signal,
    readOnly: input.readOnly,
    notifyProgress: () => {},
  };
}

/**
 * Builds a per-file diff target.
 *
 * @param section - Section that owns the row.
 * @param path - Current path.
 * @param oldPath - Pre-rename path.
 * @returns The command target.
 */
function fileTarget(section: string, path: string, oldPath?: string): CommandTarget {
  return { kind: "diffFile", section, path, ...(oldPath === undefined ? {} : { oldPath }) };
}

/**
 * Builds bulk form values for one section.
 *
 * @param section - Section identity.
 * @param paths - Section path set.
 * @returns The form values.
 */
function bulkValues(section: string, paths: readonly string[]): CommandFormValues {
  return { [DIFF_FORM_SECTION]: section, [DIFF_FORM_PATHS]: paths };
}

describe("diff per-file executors", () => {
  it("stages one file with a literal pathspec", async () => {
    const fake = createScriptedGitClient({
      "add -- :(literal)a[1].txt": fakeGitResult(""),
    });

    const outcome = await executeDiffStage(
      createContext(fake.client, {
        target: fileTarget("working", "a[1].txt"),
      }),
    );

    expect(fake.calls[0]?.args).toEqual(["add", "--", ":(literal)a[1].txt"]);
    expect(outcome.steps[0]?.exitCode).toBe(0);
    expect(outcome.blockedReason).toBeUndefined();
  });

  it("passes both paths of a rename when staging", async () => {
    const fake = createScriptedGitClient({
      "add -- :(literal)old.txt :(literal)new.txt": fakeGitResult(""),
    });

    await executeDiffStage(
      createContext(fake.client, {
        target: fileTarget("working", "new.txt", "old.txt"),
      }),
    );

    expect(fake.calls[0]?.args).toEqual(["add", "--", ":(literal)old.txt", ":(literal)new.txt"]);
  });

  it("unstages only a staged target", async () => {
    const fake = createScriptedGitClient({
      "restore --staged -- :(literal)staged.txt": fakeGitResult(""),
    });

    await executeDiffUnstage(
      createContext(fake.client, {
        target: fileTarget("staged", "staged.txt"),
      }),
    );

    expect(fake.calls[0]?.args).toEqual(["restore", "--staged", "--", ":(literal)staged.txt"]);
  });

  it("blocks a command whose target section belongs to another action", async () => {
    const fake = createScriptedGitClient({});

    const outcome = await executeDiffUnstage(
      createContext(fake.client, {
        target: fileTarget("working", "working.txt"),
      }),
    );

    expect(outcome.blockedReason).toBe("invalid-target");
    expect(fake.calls).toHaveLength(0);
  });

  it("blocks a command without a diff-file target", async () => {
    const fake = createScriptedGitClient({});

    const outcome = await executeDiffStage(
      createContext(fake.client, { target: { kind: "none" } }),
    );

    expect(outcome.blockedReason).toBe("missing-target");
    expect(fake.calls).toHaveLength(0);
  });

  it("discards a tracked file and keeps partial rename warnings", async () => {
    const fake = createScriptedGitClient({
      "restore -- :(literal)old.txt": fakeGitResult(""),
      [STATUS_ARGS_KEY]: fakeGitResult(RENAME_STATUS),
      "clean -f -- :(literal)new.txt": fakeGitResult("fatal: denied", false, "fatal: denied"),
    });

    const outcome = await executeDiffDiscard(
      createContext(fake.client, {
        target: fileTarget("working", "new.txt", "old.txt"),
      }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([
      ["restore", "--", ":(literal)old.txt"],
      [...STATUS_ARGS],
    ]);
    expect(outcome.failed).toBeUndefined();
    expect(outcome.warnings?.length).toBe(1);
  });

  it("deletes one untracked file without -x", async () => {
    const fake = createScriptedGitClient({
      "clean -f -- :(literal)new.txt": fakeGitResult(""),
    });

    await executeDiffDeleteUntracked(
      createContext(fake.client, {
        target: fileTarget("untracked", "new.txt"),
      }),
    );

    expect(fake.calls[0]?.args).toEqual(["clean", "-f", "--", ":(literal)new.txt"]);
  });
});

describe("diff bulk executors", () => {
  it("stages combined explicit working and untracked paths without a selected section", async () => {
    const fake = createScriptedGitClient({
      "add -- :(literal)working.txt :(literal)new.txt": fakeGitResult(""),
    });

    const outcome = await executeDiffStageAll(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: { paths: ["working.txt", "new.txt"] },
      }),
    );

    expect(outcome.blockedReason).toBeUndefined();
    expect(fake.calls[0]?.args).toEqual([
      "add",
      "--",
      ":(literal)working.txt",
      ":(literal)new.txt",
    ]);
  });

  it("blocks a panel-wide stage request with no paths", async () => {
    const fake = createScriptedGitClient({});

    const outcome = await executeDiffStageAll(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: { paths: [] },
      }),
    );

    expect(outcome.blockedReason).toBe("no-files");
    expect(fake.calls).toHaveLength(0);
  });

  it("stages only the supplied section path set", async () => {
    const fake = createScriptedGitClient({
      "add -- :(literal)working.txt :(literal)other.txt": fakeGitResult(""),
    });

    const outcome = await executeDiffStageAll(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: bulkValues("working", ["working.txt", "other.txt"]),
      }),
    );

    expect(fake.calls[0]?.args).toEqual([
      "add",
      "--",
      ":(literal)working.txt",
      ":(literal)other.txt",
    ]);
    expect(outcome.blockedReason).toBeUndefined();
  });

  it("unstages the staged path set", async () => {
    const fake = createScriptedGitClient({
      "restore --staged -- :(literal)staged.txt": fakeGitResult(""),
    });

    await executeDiffUnstageAll(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: bulkValues("staged", ["staged.txt"]),
      }),
    );

    expect(fake.calls[0]?.args).toEqual(["restore", "--staged", "--", ":(literal)staged.txt"]);
  });

  it("blocks an empty section with no-files", async () => {
    const fake = createScriptedGitClient({});

    const outcome = await executeDiffStageAll(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: bulkValues("working", []),
      }),
    );

    expect(outcome.blockedReason).toBe("no-files");
    expect(fake.calls).toHaveLength(0);
  });

  it("blocks a section the command does not own", async () => {
    const fake = createScriptedGitClient({});

    const outcome = await executeDiffUnstageAll(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: bulkValues("working", ["working.txt"]),
      }),
    );

    expect(outcome.blockedReason).toBe("invalid-target");
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses a whole-tree dot path without invoking git", async () => {
    const fake = createScriptedGitClient({});

    const outcome = await executeDiffStageAll(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: bulkValues("working", ["."]),
      }),
    );

    expect(outcome.blockedReason).toBe("no-files");
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses an authoritative read-only request without a form flag", async () => {
    const fake = createScriptedGitClient({});

    const stage = await executeDiffStage(
      createContext(fake.client, {
        target: fileTarget("working", "a.txt"),
        readOnly: true,
      }),
    );
    const unstage = await executeDiffUnstage(
      createContext(fake.client, {
        target: fileTarget("staged", "a.txt"),
        readOnly: true,
      }),
    );
    const bulk = await executeDiffStageAll(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: bulkValues("working", ["a.txt"]),
        readOnly: true,
      }),
    );

    expect(stage.blockedReason).toBe("read-only");
    expect(unstage.blockedReason).toBe("read-only");
    expect(bulk.blockedReason).toBe("read-only");
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses a read-only request before invoking git", async () => {
    const fake = createScriptedGitClient({});

    const outcome = await executeDiffDeleteAllUntracked(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: {
          ...bulkValues("untracked", ["new.txt"]),
          [DIFF_FORM_READ_ONLY]: true,
        },
      }),
    );

    expect(outcome.blockedReason).toBe("read-only");
    expect(fake.calls).toHaveLength(0);
  });

  it("folds a rename pair back into one discard target", async () => {
    const fake = createScriptedGitClient({
      [STATUS_ARGS_KEY]: fakeGitResult(RENAME_STATUS),
      "restore -- :(literal)old.txt": fakeGitResult(""),
      "clean -f -- :(literal)new.txt": fakeGitResult(""),
    });

    const outcome = await executeDiffDiscardAll(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: bulkValues("working", ["old.txt", "new.txt"]),
      }),
    );

    expect(fake.calls.map((call) => call.args)).toEqual([
      [...STATUS_ARGS],
      ["restore", "--", ":(literal)old.txt"],
      [...STATUS_ARGS],
    ]);
    expect(outcome.steps).toHaveLength(2);
    expect(outcome.failed).toBeUndefined();
    expect(outcome.warnings?.length).toBe(1);
  });

  it("blocks a bulk discard when the fresh status no longer lists a path", async () => {
    const fake = createScriptedGitClient({
      [STATUS_ARGS_KEY]: fakeGitResult(RENAME_STATUS),
    });

    const outcome = await executeDiffDiscardAll(
      createContext(fake.client, {
        target: { kind: "none" },
        formValues: bulkValues("working", ["gone.txt"]),
      }),
    );

    expect(outcome.blockedReason).toBe("invalid-target");
    expect(fake.calls.map((call) => call.args)).toEqual([[...STATUS_ARGS]]);
  });
});
