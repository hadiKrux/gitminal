import { buildListLocalBranchesArgs } from "@/domain/git/git.branches";
import { buildListRemoteBranchesArgs } from "@/domain/git/git.remote-branches";
import { buildListStashesArgs } from "@/domain/git/git.stashes";
import { buildListLocalTagsArgs } from "@/domain/git/git.tags";
import type { GitClient, GitInvocationResult, GitOperationClass } from "@/domain/git/git.types";
import { buildListWorktreesArgs } from "@/domain/git/git.worktrees";

/** Canonical status output for a normal repository with one change per pending bucket. */
const NORMAL_STATUS_OUTPUT = [
  "# branch.oid abc123",
  "# branch.head main",
  "# branch.upstream origin/main",
  "# branch.ab +2 -1",
  "1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb staged.txt",
  "1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb unstaged.txt",
  "? untracked.txt",
].join("\0");

/** Committer date shared by the recorded branch and remote-branch fixtures. */
const FIXTURE_DATE = "2026-01-02T03:04:05+00:00";

/** Recorded local branches: `main` tracks `origin/main`, `feature` has no upstream. */
const LOCAL_BRANCHES_OUTPUT = [
  `main\0abc123\0*\0${FIXTURE_DATE}\0origin\0refs/heads/main\0[ahead 2, behind 1]`,
  `feature\0def456\0 \0${FIXTURE_DATE}\0\0\0`,
].join("\n");

/** Recorded remote-tracking branches. */
const REMOTE_BRANCHES_OUTPUT = `refs/remotes/origin/main\0abc123\0${FIXTURE_DATE}\0initial commit\0\n`;

/** Recorded local tags: one lightweight tag pointing at `abc123`. */
const LOCAL_TAGS_OUTPUT = "v1.0.0\0commit\0\0abc123\0\0initial commit\n";

/** Recorded stash list with one stash, using the real NUL field separators of `git stash list`. */
const STASHES_OUTPUT = [
  "stash@{0}",
  "aaa111",
  "WIP on main: abc123 work in progress",
  "1700000000",
].join("\0");

/** Recorded worktree list: the main worktree plus a linked worktree on `feature`. */
const WORKTREES_OUTPUT = [
  "worktree /repo",
  "HEAD abc123",
  "branch refs/heads/main",
  "",
  "worktree /repo-feature",
  "HEAD def456",
  "branch refs/heads/feature",
  "",
].join("\n");

/**
 * Empty answers for the ref lists every repository read consumes.
 *
 * A fake that only exercises the shell still has to answer the branch, remote-branch, tag, stash,
 * and worktree reads. Spreading these keeps such a fake focused on the reads its assertions
 * actually observe.
 */
export const EMPTY_REF_READ_ANSWERS: Readonly<Record<string, () => GitInvocationResult>> =
  Object.freeze({
    [buildListLocalBranchesArgs().join(" ")]: () => fakeGitResult(""),
    [buildListRemoteBranchesArgs().join(" ")]: () => fakeGitResult(""),
    [buildListLocalTagsArgs().join(" ")]: () => fakeGitResult(""),
    [buildListStashesArgs().join(" ")]: () => fakeGitResult(""),
    [buildListWorktreesArgs().join(" ")]: () => fakeGitResult(""),
  });

/**
 * Builds one invocation result for a fake client.
 *
 * @param stdout - Captured standard output.
 * @param ok - Whether git exited cleanly.
 * @param stderr - Captured standard error.
 * @returns The synthetic result.
 */
export function fakeGitResult(
  stdout: string,
  ok: boolean = true,
  stderr: string = "",
): GitInvocationResult {
  return {
    argv: ["git"],
    cwd: "/repo",
    exitCode: ok ? 0 : 1,
    terminationSignal: null,
    stdout,
    stderr,
    durationMs: 0,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok,
  };
}

/**
 * Creates a fake git client that answers the repository read path and fetch command.
 *
 * The fake never spawns a process. Tests can mutate the status answer or replace it with a failure
 * to exercise the read error path, and can read per-argument counts to prove coalescing and refresh
 * effects.
 *
 * @returns The fake client plus its mutable answers and counters.
 */
export function createFakeGitClient() {
  const counts = new Map<string, number>();
  let statusResult: GitInvocationResult | null = null;
  let statusOutput = NORMAL_STATUS_OUTPUT;
  let fetchResult: GitInvocationResult | null = null;
  let mainStatusCwd: string | null = null;

  const answers: Readonly<Record<string, () => GitInvocationResult>> = {
    "rev-parse --is-inside-work-tree": () => fakeGitResult("true\n"),
    "rev-parse --is-bare-repository --absolute-git-dir": () => fakeGitResult("false\n/repo/.git\n"),
    "rev-parse --show-toplevel": () => fakeGitResult("/repo\n"),
    "rev-parse --verify HEAD": () => fakeGitResult("abc123\n"),
    "log -1 --format=%s": () => fakeGitResult("initial commit\n"),
    "symbolic-ref -q --short HEAD": () => fakeGitResult("main\n"),
    "rev-parse --verify --quiet MERGE_HEAD": () => fakeGitResult("", false),
    "rev-parse --verify --quiet REBASE_HEAD": () => fakeGitResult("", false),
    "rev-parse --verify --quiet CHERRY_PICK_HEAD": () => fakeGitResult("", false),
    "rebase --show-current-patch": () => fakeGitResult("", false, "fatal: no rebase"),
    remote: () => fakeGitResult("origin\n"),
    "remote -v": () =>
      fakeGitResult(
        "origin\tgit@example.com:repo.git (fetch)\norigin\tgit@example.com:repo.git (push)\n",
      ),
    "config --get-all remote.origin.fetch": () =>
      fakeGitResult("+refs/heads/*:refs/remotes/origin/*\n"),
    "config user.name": () => fakeGitResult("Test User\n"),
    "config user.email": () => fakeGitResult("test@example.com\n"),
    "for-each-ref --format=%(upstream:remotename)%09%(upstream:remoteref) refs/heads/main": () =>
      fakeGitResult("origin\trefs/heads/main\n"),
    "for-each-ref --format=%(upstream:short) refs/heads": () => fakeGitResult("origin/main\n"),
    "rev-parse --verify --quiet refs/remotes/origin/main": () => fakeGitResult("abc123\n"),
    "for-each-ref --format=%(refname:short)%09%(upstream:remotename)%09%(upstream:remoteref) refs/heads":
      () => fakeGitResult("main\torigin\trefs/heads/main\n"),
    "fetch --progress --no-prune --no-prune-tags -- origin": () => fetchResult ?? fakeGitResult(""),
    [buildListLocalBranchesArgs().join(" ")]: () => fakeGitResult(LOCAL_BRANCHES_OUTPUT),
    [buildListRemoteBranchesArgs().join(" ")]: () => fakeGitResult(REMOTE_BRANCHES_OUTPUT),
    [buildListLocalTagsArgs().join(" ")]: () => fakeGitResult(LOCAL_TAGS_OUTPUT),
    [buildListStashesArgs().join(" ")]: () => fakeGitResult(STASHES_OUTPUT),
    [buildListWorktreesArgs().join(" ")]: () => fakeGitResult(WORKTREES_OUTPUT),
  };

  const client: GitClient = {
    gitPath: "git",
    invoke: async (options) => {
      const key = options.args.join(" ");

      if (key === "status --porcelain=v2 --branch -z --untracked-files=all") {
        mainStatusCwd ??= options.cwd;

        if (options.cwd !== mainStatusCwd) {
          return fakeGitResult("");
        }

        counts.set(key, (counts.get(key) ?? 0) + 1);

        return statusResult ?? fakeGitResult(statusOutput);
      }

      counts.set(key, (counts.get(key) ?? 0) + 1);

      const answer = answers[key];

      return answer === undefined ? fakeGitResult("", false) : answer();
    },
  };

  return {
    client,
    counts,
    /**
     * Replaces the canonical status output.
     *
     * @param output - New status output.
     */
    setStatusOutput(output: string): void {
      statusOutput = output;
      statusResult = null;
    },
    /**
     * Replaces the canonical status answer with a full result, for failure cases.
     *
     * @param result - Result to return, or null to restore the output answer.
     */
    setStatusResult(result: GitInvocationResult | null): void {
      statusResult = result;
    },
    /**
     * Replaces the scoped fetch answer with a full result, for failure cases.
     *
     * @param result - Result to return, or null to restore the success answer.
     */
    setFetchResult(result: GitInvocationResult | null): void {
      fetchResult = result;
    },
  };
}

/** One invocation recorded by the scripted client. */
interface ScriptedGitCall {
  /** Arguments without the executable. */
  readonly args: readonly string[];
  /** Working directory requested by the caller. */
  readonly cwd: string;
  /** Operation class requested by the caller. */
  readonly operationClass: GitOperationClass;
  /** True when the caller declared the invocation touches the index. */
  readonly touchesIndex: boolean;
}

/** One scripted answer: a settled result or a factory producing one per invocation. */
export type ScriptedGitAnswer = GitInvocationResult | (() => GitInvocationResult);

/**
 * Creates a git client that answers only the arguments a test scripts.
 *
 * Every call is recorded with its exact argument array, working directory, and operation class, so a
 * composite executor test can assert both the argv of each invocation and the order they ran in. The
 * returned result carries the requested argv, because the real client reports the executable plus the
 * argument array it spawned. An unscripted invocation fails loudly with its own key in the stderr,
 * which turns a missing expectation into an assertion failure instead of a silent success.
 *
 * @param answers - Answers keyed by the joined argument array.
 * @returns The client plus its recorded calls.
 */
export function createScriptedGitClient(answers: Readonly<Record<string, ScriptedGitAnswer>>) {
  const calls: ScriptedGitCall[] = [];

  const client: GitClient = {
    gitPath: "git",
    invoke: async (options) => {
      const key = options.args.join(" ");
      const answer = answers[key];

      calls.push({
        args: options.args,
        cwd: options.cwd,
        operationClass: options.operationClass,
        touchesIndex: options.touchesIndex === true,
      });

      const result =
        answer === undefined
          ? fakeGitResult("", false, `unexpected git invocation: ${key}`)
          : typeof answer === "function"
            ? answer()
            : answer;

      return { ...result, argv: ["git", ...options.args], cwd: options.cwd };
    },
  };

  return { client, calls };
}
