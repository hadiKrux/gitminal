import { describe, expect, it } from "bun:test";
import {
  createRepositorySignals,
  detectRepositoryState,
  gateRepository,
} from "@/domain/repository/repository.states";
import type { RepositorySignals } from "@/domain/repository/repository.types";

/**
 * Builds a loaded, normal-repository signal set with overrides.
 *
 * @param overrides - Signal values to override.
 * @returns The signal set.
 */
function createSignals(overrides: Partial<RepositorySignals> = {}): RepositorySignals {
  return createRepositorySignals({
    loaded: true,
    insideWorkTree: true,
    repositoryRoot: "/repo",
    cwd: "/repo",
    headExists: true,
    branch: "main",
    identity: { name: "Test User", email: "test@example.com" },
    remotes: ["origin"],
    upstream: "origin/main",
    upstreamExists: true,
    upstreamCheck: "checked",
    ...overrides,
  });
}

/**
 * Builds the detected state for one signal set.
 *
 * @param overrides - Signal overrides.
 * @returns The detected state snapshot.
 */
function stateFor(overrides: Partial<RepositorySignals> = {}) {
  return detectRepositoryState(createSignals(overrides));
}

describe("gateRepository", () => {
  it("allows a normal repository action", () => {
    const signals = createSignals();

    expect(gateRepository("branch.create", stateFor(), signals)).toEqual({ available: true });
  });

  it("keeps non-repository actions available in a whole-shell state", () => {
    const signals = createSignals({ insideWorkTree: false, notARepository: true });
    const state = detectRepositoryState(signals);

    expect(gateRepository("app.help", state, signals)).toEqual({ available: true });
    expect(gateRepository("focus.next", state, signals)).toEqual({ available: true });
  });

  it("blocks repository actions outside a repository", () => {
    const signals = createSignals({ insideWorkTree: false, notARepository: true });
    const state = detectRepositoryState(signals);

    expect(gateRepository("branch.create", state, signals)).toEqual({
      available: false,
      reason: "not-a-repository",
    });
  });

  it("blocks repository actions in a bare repository", () => {
    const signals = createSignals({ insideWorkTree: false, bare: true, repositoryRoot: null });

    expect(gateRepository("remote.fetch", detectRepositoryState(signals), signals)).toEqual({
      available: false,
      reason: "bare-repository",
    });
  });

  it("blocks repository actions when git is missing", () => {
    const signals = createSignals({ gitAvailable: false });

    expect(gateRepository("commit.submit", detectRepositoryState(signals), signals)).toEqual({
      available: false,
      reason: "git-missing",
    });
  });

  it("keeps app.refresh available while loading", () => {
    const signals = createRepositorySignals();

    expect(gateRepository("app.refresh", detectRepositoryState(signals), signals)).toEqual({
      available: true,
    });
    expect(gateRepository("branch.delete", detectRepositoryState(signals), signals)).toEqual({
      available: false,
      reason: "loading",
    });
  });

  it("blocks repository actions after a permission failure", () => {
    const signals = createSignals({ insideWorkTree: false, permissionError: true });

    expect(gateRepository("branch.delete", detectRepositoryState(signals), signals)).toEqual({
      available: false,
      reason: "permission-error",
    });
  });

  it("returns no-commits-yet for every empty-repository action", () => {
    const signals = createSignals({
      headExists: false,
      upstream: null,
      upstreamCheck: "none",
      remotes: [],
    });
    const state = detectRepositoryState(signals);

    for (const commandId of [
      "branch.create",
      "branch.delete",
      "tag.create",
      "tag.push",
      "tag.delete",
      "stash.create",
      "remote.push",
      "remote.pushForceSafe",
      "remote.pushForceOverwrite",
      "remote.pushNoVerify",
    ]) {
      expect(gateRepository(commandId, state, signals)).toEqual({
        available: false,
        reason: "no-commits-yet",
      });
    }

    expect(gateRepository("commit.submit", state, signals)).toEqual({ available: true });
  });

  it("blocks branch-dependent actions on a detached HEAD", () => {
    const signals = createSignals({ branch: null, detached: true });
    const state = detectRepositoryState(signals);

    for (const commandId of [
      "remote.pull",
      "remote.push",
      "remote.pushForceSafe",
      "remote.pushForceOverwrite",
      "remote.pushNoVerify",
    ]) {
      expect(gateRepository(commandId, state, signals)).toEqual({
        available: false,
        reason: "detached-head",
      });
    }

    expect(gateRepository("branch.create", state, signals)).toEqual({ available: true });
    expect(gateRepository("commit.submit", state, signals)).toEqual({ available: true });
  });

  it("blocks remote actions when no remote is configured but keeps the More menu available", () => {
    const signals = createSignals({ remotes: [], upstream: null, upstreamCheck: "none" });
    const state = detectRepositoryState(signals);

    for (const commandId of [
      "remote.pull",
      "remote.push",
      "remote.pushForceSafe",
      "remote.pushForceOverwrite",
      "remote.pushNoVerify",
      "remote.fetch",
      "remote.fetchPrune",
    ]) {
      expect(gateRepository(commandId, state, signals)).toEqual({
        available: false,
        reason: "no-remote",
      });
    }

    expect(gateRepository("remote.more", state, signals)).toEqual({ available: true });
  });

  it("blocks pull and the force variants when the branch has no upstream but keeps push available", () => {
    const signals = createSignals({ upstream: null, upstreamCheck: "none" });
    const state = detectRepositoryState(signals);

    for (const commandId of ["remote.pull", "remote.pushForceSafe", "remote.pushForceOverwrite"]) {
      expect(gateRepository(commandId, state, signals)).toEqual({
        available: false,
        reason: "no-upstream",
      });
    }

    expect(gateRepository("remote.push", state, signals)).toEqual({ available: true });
    expect(gateRepository("remote.pushNoVerify", state, signals)).toEqual({ available: true });
  });

  it("blocks pull and the force variants when the upstream is confirmed gone", () => {
    const signals = createSignals({ upstreamExists: false, upstreamCheck: "checked" });
    const state = detectRepositoryState(signals);

    for (const commandId of ["remote.pull", "remote.pushForceSafe", "remote.pushForceOverwrite"]) {
      expect(gateRepository(commandId, state, signals)).toEqual({
        available: false,
        reason: "upstream-gone",
      });
    }

    expect(gateRepository("remote.push", state, signals)).toEqual({ available: true });
    expect(gateRepository("remote.pushNoVerify", state, signals)).toEqual({ available: true });
  });

  it("does not guess a remote when origin is absent", () => {
    const signals = createSignals({ remotes: ["upstream"], upstream: null, upstreamCheck: "none" });
    const state = detectRepositoryState(signals);

    expect(gateRepository("remote.push", state, signals)).toEqual({ available: true });
  });

  it("blocks mutations while an operation runs but keeps reads and quit", () => {
    const signals = createSignals({ operationRunning: true });
    const state = detectRepositoryState(signals);

    expect(gateRepository("branch.delete", state, signals)).toEqual({
      available: false,
      reason: "operation-in-progress",
    });
    expect(gateRepository("app.refresh", state, signals)).toEqual({ available: true });
    expect(gateRepository("app.quit", state, signals)).toEqual({ available: true });
  });

  it("blocks bulk index actions with the precise operation reason", () => {
    for (const [overrides, reason] of [
      [{ mergeInProgress: true }, "merge-in-progress"],
      [{ rebaseInProgress: true }, "rebase-in-progress"],
      [{ cherryPickInProgress: true }, "cherry-pick-in-progress"],
    ] as const) {
      const signals = createSignals(overrides);
      const state = detectRepositoryState(signals);

      expect(gateRepository("diff.stageAll", state, signals)).toEqual({
        available: false,
        reason,
      });
      expect(gateRepository("diff.stage", state, signals)).toEqual({ available: true });
    }
  });

  it("blocks commits without a configured identity", () => {
    const signals = createSignals({ identity: { name: null, email: null } });
    const state = detectRepositoryState(signals);

    for (const commandId of [
      "commit.submit",
      "commit.submitNoVerify",
      "commit.amend",
      "commit.amendNoVerify",
    ]) {
      expect(gateRepository(commandId, state, signals)).toEqual({
        available: false,
        reason: "missing-git-identity",
      });
    }
  });
});
