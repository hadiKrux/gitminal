import { describe, expect, it } from "bun:test";
import { collectRemoteTagChecks } from "@/app/hooks/useRepositoryRemoteTags";
import type { GitClient } from "@/domain/git/git.types";
import type { RemoteTagChecks } from "@/domain/repository/repository.types";
import { fakeGitResult } from "@/test/git.fake";

/**
 * Builds a tag read key for one remote.
 *
 * @param remote - Remote name.
 * @returns The joined argument array.
 */
function tagReadKey(remote: string): string {
  return ["ls-remote", "--tags", "--", remote].join(" ");
}

/**
 * Builds read options for one collection call.
 *
 * @param overrides - Options to override.
 * @returns The collection options.
 */
function readOptions(overrides: {
  readonly remotes: readonly string[];
  readonly previous?: RemoteTagChecks;
  readonly now?: () => number;
}) {
  return {
    cwd: "/repo",
    signal: new AbortController().signal,
    remotes: overrides.remotes,
    previous: overrides.previous ?? {},
    now: overrides.now ?? (() => 5_000),
  };
}

describe("collectRemoteTagChecks", () => {
  it("replaces names and records the check time after a successful read", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => fakeGitResult("aaaaaaaa\trefs/tags/v1\nbbbbbbbb\trefs/tags/v2\n"),
    };

    const checks = await collectRemoteTagChecks(client, readOptions({ remotes: ["origin"] }));

    expect(checks.origin).toEqual({ names: ["v1", "v2"], checkedAt: 5_000, status: "known" });
  });

  it("keeps the previous names and marks the attempt failed", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => fakeGitResult("", false, "fatal: could not read from remote"),
    };
    const previous: RemoteTagChecks = {
      origin: { names: ["v1"], checkedAt: 1_000, status: "known" },
    };

    const checks = await collectRemoteTagChecks(
      client,
      readOptions({ remotes: ["origin"], previous }),
    );

    expect(checks.origin).toEqual({ names: ["v1"], checkedAt: 1_000, status: "failed" });
  });

  it("marks a never-checked remote failed without inventing names", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => fakeGitResult("", false, "fatal: timed out"),
    };

    const checks = await collectRemoteTagChecks(client, readOptions({ remotes: ["origin"] }));

    expect(checks.origin).toEqual({ names: [], checkedAt: null, status: "failed" });
  });

  it("never treats a truncated read as an empty tag set", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => ({ ...fakeGitResult("aaaa\trefs/tags/v1\n"), stdoutTruncated: true }),
    };

    const checks = await collectRemoteTagChecks(client, readOptions({ remotes: ["origin"] }));

    expect(checks.origin?.status).toBe("failed");
  });

  it("reads at most three remotes at once", async () => {
    let active = 0;
    let peak = 0;
    const seen: string[] = [];

    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        active += 1;
        peak = Math.max(peak, active);
        seen.push(options.args[options.args.length - 1] ?? "");

        await new Promise((resolve) => setTimeout(resolve, 1));

        active -= 1;

        return fakeGitResult("");
      },
    };

    const checks = await collectRemoteTagChecks(
      client,
      readOptions({ remotes: ["one", "two", "three", "four"] }),
    );

    expect(peak).toBe(3);
    expect(Object.keys(checks).sort()).toEqual(["four", "one", "three", "two"]);
    expect(seen).toHaveLength(4);
  });

  it("reads each configured remote exactly once", async () => {
    const calls: string[] = [];
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        calls.push(options.args.join(" "));

        return fakeGitResult("");
      },
    };

    await collectRemoteTagChecks(client, readOptions({ remotes: ["origin", "upstream"] }));

    expect(calls.sort()).toEqual([tagReadKey("origin"), tagReadKey("upstream")]);
  });
});
