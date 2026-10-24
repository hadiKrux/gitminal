import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";

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

  const answers: Readonly<Record<string, () => GitInvocationResult>> = {
    "rev-parse --is-inside-work-tree": () => fakeGitResult("true\n"),
    "rev-parse --is-bare-repository --absolute-git-dir": () => fakeGitResult("false\n/repo/.git\n"),
    "rev-parse --show-toplevel": () => fakeGitResult("/repo\n"),
    "rev-parse --verify HEAD": () => fakeGitResult("abc123\n"),
    "symbolic-ref -q --short HEAD": () => fakeGitResult("main\n"),
    "rev-parse --verify --quiet MERGE_HEAD": () => fakeGitResult("", false),
    "rev-parse --verify --quiet REBASE_HEAD": () => fakeGitResult("", false),
    "rev-parse --verify --quiet CHERRY_PICK_HEAD": () => fakeGitResult("", false),
    "rebase --show-current-patch": () => fakeGitResult("", false, "fatal: no rebase"),
    "remote -v": () =>
      fakeGitResult(
        "origin\tgit@example.com:repo.git (fetch)\norigin\tgit@example.com:repo.git (push)\n",
      ),
    "config user.name": () => fakeGitResult("Test User\n"),
    "config user.email": () => fakeGitResult("test@example.com\n"),
    "for-each-ref --format=%(upstream:short) refs/heads/main": () => fakeGitResult("origin/main\n"),
    "for-each-ref --format=%(upstream:short) refs/heads": () => fakeGitResult("origin/main\n"),
    "rev-parse --verify --quiet origin/main": () => fakeGitResult("abc123\n"),
    "for-each-ref --format=%(refname:short) %(upstream:short) refs/heads": () =>
      fakeGitResult("main origin/main\n"),
    "fetch --progress origin +refs/heads/main:refs/remotes/origin/main": () =>
      fetchResult ?? fakeGitResult(""),
  };

  const client: GitClient = {
    gitPath: "git",
    invoke: async (options) => {
      const key = options.args.join(" ");
      counts.set(key, (counts.get(key) ?? 0) + 1);

      if (key === "status --porcelain=v2 --branch -z --untracked-files=all") {
        return statusResult ?? fakeGitResult(statusOutput);
      }

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
