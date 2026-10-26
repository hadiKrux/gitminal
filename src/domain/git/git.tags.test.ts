import { describe, expect, it } from "bun:test";
import {
  buildListLocalTagsArgs,
  buildLsRemoteTagsArgs,
  mergeTagScopes,
  planCreateTag,
  planDeleteLocalTag,
  planDeleteRemoteTag,
  planPushTag,
  readLocalTags,
  readRemoteTags,
  sortTagsVersionDesc,
} from "@/domain/git/git.tags";
import type { GitClient, GitInvocationResult, TagRecord } from "@/domain/git/git.types";

/** Local tag fixture used across the scope matrix. */
const LOCAL_TAG: TagRecord = {
  name: "v1.0.0",
  objectType: "tag",
  targetOid: "commit-1",
  subject: "first release",
};

/**
 * Builds an invocation result.
 *
 * @param stdout - Captured output.
 * @param ok - Whether git exited cleanly.
 * @returns The synthetic result.
 */
function result(stdout: string, ok: boolean = true): GitInvocationResult {
  return {
    argv: ["git"],
    cwd: "/repo",
    exitCode: ok ? 0 : 1,
    terminationSignal: null,
    stdout,
    stderr: ok ? "" : "fatal: no remote",
    durationMs: 1,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok,
  };
}

describe("tag read arguments", () => {
  it("reads local tags with the peeled and direct atoms", () => {
    expect(buildListLocalTagsArgs()).toEqual([
      "for-each-ref",
      "--format=%(refname:short)%00%(objecttype)%00%(*objectname)%00%(objectname)" +
        "%00%(*subject)%00%(subject)",
      "refs/tags",
    ]);
  });

  it("reads remote tags with option parsing terminated", () => {
    expect(buildLsRemoteTagsArgs("origin")).toEqual(["ls-remote", "--tags", "--", "origin"]);
    expect(buildLsRemoteTagsArgs("team/up")).toEqual(["ls-remote", "--tags", "--", "team/up"]);
  });

  it("refuses an unsafe remote name", () => {
    expect(buildLsRemoteTagsArgs("--upload-pack")).toBeNull();
    expect(buildLsRemoteTagsArgs("")).toBeNull();
  });
});

describe("tag reads", () => {
  it("runs the local tag read and parses the result", async () => {
    let args: readonly string[] = [];
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        args = options.args;

        return result("v1\0commit\0\0commit-1\0\0first release\n");
      },
    };

    const read = await readLocalTags(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(args).toEqual(buildListLocalTagsArgs());
    expect(read.ok).toBeTrue();
    expect(read.tags).toHaveLength(1);
  });

  it("fails a truncated local tag read", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => ({ ...result("v1\n"), stdoutTruncated: true }),
    };

    const read = await readLocalTags(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(read.ok).toBeFalse();
    expect(read.failure?.message).toBe("git for-each-ref refs/tags output was truncated");
  });

  it("reads remote tags as a network read", async () => {
    let operationClass = "";
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        operationClass = options.operationClass;

        return result("1111\trefs/tags/v1.0.0\n2222\trefs/tags/v1.0.0^{}\n");
      },
    };

    const read = await readRemoteTags(
      client,
      {
        cwd: "/repo",
        signal: new AbortController().signal,
      },
      "origin",
    );

    expect(operationClass).toBe("network");
    expect(read).toEqual({ ok: true, names: ["v1.0.0"], failure: null });
  });

  it("fails a remote tag read instead of inferring absence", async () => {
    const failing: GitClient = {
      gitPath: "git",
      invoke: async () => result("", false),
    };
    const truncated: GitClient = {
      gitPath: "git",
      invoke: async () => ({ ...result("1111\trefs/tags/v1\n"), stdoutTruncated: true }),
    };

    const options = { cwd: "/repo", signal: new AbortController().signal };
    const failed = await readRemoteTags(failing, options, "origin");
    const shortened = await readRemoteTags(truncated, options, "origin");

    expect(failed.ok).toBeFalse();
    expect(failed.names).toEqual([]);
    expect(shortened.ok).toBeFalse();
    expect(shortened.failure?.message).toBe("git ls-remote --tags output was truncated");
  });

  it("fails an unsafe remote without invoking git", async () => {
    let invoked = false;
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => {
        invoked = true;

        return result("");
      },
    };

    const read = await readRemoteTags(
      client,
      { cwd: "/repo", signal: new AbortController().signal },
      "--upload-pack",
    );

    expect(invoked).toBeFalse();
    expect(read.ok).toBeFalse();
    expect(read.failure?.message).toBe('invalid remote name "--upload-pack"');
  });
});

describe("mergeTagScopes", () => {
  it("reports local-only when no remote is configured", () => {
    const rows = mergeTagScopes([LOCAL_TAG], {});

    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("local-only");
    expect(rows[0]?.local).toBeTrue();
    expect(rows[0]?.remotes).toEqual([]);
  });

  it("reports both when a known remote set contains the tag", () => {
    const rows = mergeTagScopes([LOCAL_TAG], {
      origin: { names: ["v1.0.0"], status: "known" },
    });

    expect(rows[0]?.state).toBe("both");
    expect(rows[0]?.remotes).toEqual(["origin"]);
  });

  it("reports unpushed when every known remote set omits the tag", () => {
    const rows = mergeTagScopes([LOCAL_TAG], {
      origin: { names: ["other"], status: "known" },
      upstream: { names: [], status: "known" },
    });

    expect(rows[0]?.state).toBe("unpushed");
  });

  it("reports unknown for a never-checked remote", () => {
    const rows = mergeTagScopes([LOCAL_TAG], {
      origin: { names: [], status: "neverChecked" },
    });

    expect(rows[0]?.state).toBe("unknown");
  });

  it("reports unknown for a failed check with no known match", () => {
    const rows = mergeTagScopes([LOCAL_TAG], {
      origin: { names: [], status: "failed" },
    });

    expect(rows[0]?.state).toBe("unknown");
  });

  it("reports unknown when one remote is absent and another failed", () => {
    const rows = mergeTagScopes([LOCAL_TAG], {
      origin: { names: [], status: "known" },
      upstream: { names: [], status: "failed" },
    });

    expect(rows[0]?.state).toBe("unknown");
  });

  it("keeps last known names from a failed check and reports both", () => {
    const rows = mergeTagScopes([LOCAL_TAG], {
      origin: { names: ["v1.0.0"], status: "failed" },
    });

    expect(rows[0]?.state).toBe("both");
  });

  it("reports both and names only the remotes that contain the tag", () => {
    const rows = mergeTagScopes([LOCAL_TAG], {
      origin: { names: ["other", "v1.0.0"], status: "known" },
      upstream: { names: ["other"], status: "known" },
    });

    expect(rows[0]?.state).toBe("both");
    expect(rows[0]?.remotes).toEqual(["origin"]);
  });

  it("reports remote for a tag that exists only in remote knowledge", () => {
    const rows = mergeTagScopes([], {
      origin: { names: ["v2.0.0", "v1.0.0"], status: "known" },
    });

    expect(rows.map((row) => row.name)).toEqual(["v2.0.0", "v1.0.0"]);
    expect(rows[0]).toEqual({
      name: "v2.0.0",
      objectType: "commit",
      targetOid: "",
      subject: "",
      local: false,
      remotes: ["origin"],
      state: "remote",
    });
  });

  it("merges one row per name and keeps locals first", () => {
    const rows = mergeTagScopes([LOCAL_TAG], {
      origin: { names: ["v1.0.0", "v2.0.0"], status: "known" },
    });

    expect(rows.map((row) => row.name)).toEqual(["v1.0.0", "v2.0.0"]);
    expect(rows[0]?.targetOid).toBe("commit-1");
    expect(rows[0]?.subject).toBe("first release");
  });

  it("sorts the remotes that contain a tag", () => {
    const rows = mergeTagScopes([LOCAL_TAG], {
      zeta: { names: ["v1.0.0"], status: "known" },
      alpha: { names: ["v1.0.0"], status: "known" },
    });

    expect(rows[0]?.remotes).toEqual(["alpha", "zeta"]);
  });
});

describe("sortTagsVersionDesc", () => {
  it("sorts numeric runs by value", () => {
    const rows = ["v1.2.9", "v1.2.10", "v1.10.0", "v1.2"].map((name) => ({ name }));

    expect(sortTagsVersionDesc(rows).map((row) => row.name)).toEqual([
      "v1.10.0",
      "v1.2.10",
      "v1.2.9",
      "v1.2",
    ]);
  });

  it("breaks an equal version by reverse name order", () => {
    const rows = ["v01", "v1"].map((name) => ({ name }));

    expect(sortTagsVersionDesc(rows).map((row) => row.name)).toEqual(["v1", "v01"]);
  });

  it("places numeric names above non-numeric names in descending order", () => {
    const rows = ["beta", "1.0", "alpha"].map((name) => ({ name }));

    expect(sortTagsVersionDesc(rows).map((row) => row.name)).toEqual(["1.0", "beta", "alpha"]);
  });

  it("is deterministic for equal names and does not mutate the input", () => {
    const rows = [{ name: "v1" }, { name: "v1" }];
    const sorted = sortTagsVersionDesc(rows);

    expect(sorted).toHaveLength(2);
    expect(rows).toHaveLength(2);
    expect(sorted).not.toBe(rows);
  });
});

describe("tag planners", () => {
  it("plans a lightweight tag when the message is empty", () => {
    expect(planCreateTag({ name: "v1", target: "HEAD", message: null })).toEqual({
      ok: true,
      args: ["tag", "v1", "HEAD"],
    });
    expect(planCreateTag({ name: "v1", target: "abc123", message: "" })).toEqual({
      ok: true,
      args: ["tag", "v1", "abc123"],
    });
  });

  it("defaults an empty target to HEAD", () => {
    expect(planCreateTag({ name: "v1", target: "", message: null })).toEqual({
      ok: true,
      args: ["tag", "v1", "HEAD"],
    });
  });

  it("plans an annotated tag when a message is present", () => {
    expect(planCreateTag({ name: "v1", target: "HEAD", message: "first release" })).toEqual({
      ok: true,
      args: ["tag", "-a", "v1", "HEAD", "-m", "first release"],
    });
  });

  it("plans a push with an explicit tag refspec", () => {
    expect(planPushTag("origin", "v1")).toEqual({
      ok: true,
      args: ["push", "--progress", "--", "origin", "refs/tags/v1"],
    });
  });

  it("plans local and remote deletes", () => {
    expect(planDeleteLocalTag("v1")).toEqual({ ok: true, args: ["tag", "-d", "v1"] });
    expect(planDeleteRemoteTag("origin", "v1")).toEqual({
      ok: true,
      args: ["push", "--progress", "--delete", "--", "origin", "refs/tags/v1"],
    });
  });

  it("rejects unsafe tag names, targets, and remotes", () => {
    expect(planCreateTag({ name: "-v1", target: "HEAD", message: null }).ok).toBeFalse();
    expect(planCreateTag({ name: "v1", target: "--exec=x", message: null }).ok).toBeFalse();
    expect(planPushTag("--upload-pack", "v1").ok).toBeFalse();
    expect(planPushTag("origin", "bad tag").ok).toBeFalse();
    expect(planDeleteLocalTag("").ok).toBeFalse();
    expect(planDeleteRemoteTag("-oops", "v1").ok).toBeFalse();
  });
});
