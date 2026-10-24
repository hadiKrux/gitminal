import { describe, expect, it } from "bun:test";
import {
  readGitIdentity,
  readHeadProbe,
  readOperationProbe,
  readRepositoryProbe,
} from "@/domain/git/git.repo";
import { readStatus } from "@/domain/git/git.status";
import { readRepositorySnapshot } from "@/domain/repository/repository.read";
import { EMPTY_UPSTREAM_EVIDENCE } from "@/domain/repository/repository.upstream";
import { isSamePath } from "@/lib/paths";
import { isGitAvailable, withGitFixture } from "@/test/git.fixture";

const gitAvailable = isGitAvailable();

/**
 * Creates a never-aborted signal for one read.
 *
 * @returns The signal.
 */
function signal(): AbortSignal {
  return new AbortController().signal;
}

describe.skipIf(!gitAvailable)("repository reads against a real repository", () => {
  it("reads discovery, HEAD, identity, and operation probes", async () => {
    await withGitFixture({}, async (fixture) => {
      const probe = await readRepositoryProbe(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
      });

      expect(probe.insideWorkTree).toBeTrue();
      expect(probe.bare).toBeFalse();
      expect(probe.root).not.toBeNull();
      expect(isSamePath(probe.root ?? "", fixture.root)).toBeTrue();
      expect(probe.gitDir).not.toBeNull();

      const head = await readHeadProbe(fixture.client, { cwd: fixture.root, signal: signal() });

      expect(head).toEqual({ exists: true, branch: "main", detached: false, shortHash: null });

      const identity = await readGitIdentity(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
      });

      expect(identity.name).toBe("Gitminal Test");
      expect(identity.email).toBe("test@gitminal.invalid");

      const operations = await readOperationProbe(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
      });

      expect(operations).toEqual({
        mergeInProgress: false,
        rebaseInProgress: false,
        cherryPickInProgress: false,
      });

      const read = await readRepositorySnapshot(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
        now: () => Date.now(),
        evidence: EMPTY_UPSTREAM_EVIDENCE,
      });

      expect(read.ok).toBeTrue();
      expect(read.snapshot?.branch).toBe("main");
      expect(read.snapshot?.status?.branch).toBe("main");
      expect(read.snapshot?.remotes).toEqual([]);
    });
  });

  it("resolves a subdirectory launch to the repository root", async () => {
    await withGitFixture({}, async (fixture) => {
      const subdirectory = fixture.createDirectory("packages/app");
      const probe = await readRepositoryProbe(fixture.client, {
        cwd: subdirectory,
        signal: signal(),
      });

      expect(probe.insideWorkTree).toBeTrue();
      expect(probe.root).not.toBeNull();
      expect(isSamePath(probe.root ?? "", fixture.root)).toBeTrue();
      expect(isSamePath(subdirectory, probe.root ?? "")).toBeFalse();
    });
  });

  it("reads an empty repository with its unborn branch", async () => {
    await withGitFixture({ seed: false }, async (fixture) => {
      const head = await readHeadProbe(fixture.client, { cwd: fixture.root, signal: signal() });

      expect(head.exists).toBeFalse();
      expect(head.branch).toBe("main");
      expect(head.detached).toBeFalse();

      const status = await readStatus(fixture.client, { cwd: fixture.root, signal: signal() });

      expect(status.ok).toBeTrue();
      expect(status.snapshot?.headOid).toBeNull();
      expect(status.snapshot?.branch).toBe("main");
    });
  });

  it("detects a bare repository", async () => {
    await withGitFixture({ bare: true }, async (fixture) => {
      const probe = await readRepositoryProbe(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
      });

      expect(probe.bare).toBeTrue();
      expect(probe.insideWorkTree).toBeFalse();
      expect(probe.root).toBeNull();
    });
  });

  it("reports a directory outside any repository", async () => {
    await withGitFixture({ initialize: false }, async (fixture) => {
      const probe = await readRepositoryProbe(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
      });

      expect(probe.insideWorkTree).toBeFalse();
      expect(probe.bare).toBeFalse();
      expect(probe.root).toBeNull();
      expect(probe.gitDir).toBeNull();
    });
  });

  it("detects a merge conflict and reports conflicted paths", async () => {
    await withGitFixture({}, async (fixture) => {
      const merge = await fixture.createMergeConflict();

      expect(merge.ok).toBeFalse();

      const operations = await readOperationProbe(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
      });

      expect(operations.mergeInProgress).toBeTrue();

      const status = await readStatus(fixture.client, { cwd: fixture.root, signal: signal() });

      expect(status.snapshot?.conflictedPaths).toContain("shared.txt");
      expect(status.snapshot?.entries.some((entry) => entry.kind === "unmerged")).toBeTrue();
    });
  });

  it("detects a rebase in progress", async () => {
    await withGitFixture({}, async (fixture) => {
      const rebase = await fixture.createRebaseConflict();

      expect(rebase.ok).toBeFalse();

      const operations = await readOperationProbe(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
      });

      expect(operations.rebaseInProgress).toBeTrue();
      expect(operations.mergeInProgress).toBeFalse();
    });
  });
});
