import { describe, expect, it } from "bun:test";
import {
  createRepositorySignals,
  detectRepositoryState,
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

describe("detectRepositoryState", () => {
  it("reports loading before the first signal set", () => {
    expect(detectRepositoryState(createRepositorySignals())).toEqual({
      primary: "loading",
      flags: [],
    });
  });

  it("reports a missing git executable", () => {
    expect(detectRepositoryState(createSignals({ gitAvailable: false })).primary).toBe(
      "missing-git",
    );
  });

  it("reports a directory outside any repository", () => {
    const state = detectRepositoryState(
      createSignals({
        insideWorkTree: false,
        notARepository: true,
        repositoryRoot: null,
        headExists: false,
        branch: null,
      }),
    );

    expect(state.primary).toBe("not-a-repository");
  });

  it("reports a permission failure before a missing repository", () => {
    expect(
      detectRepositoryState(createSignals({ insideWorkTree: false, permissionError: true }))
        .primary,
    ).toBe("permission-error");
  });

  it("reports a bare repository", () => {
    const state = detectRepositoryState(
      createSignals({ insideWorkTree: false, bare: true, repositoryRoot: null }),
    );

    expect(state.primary).toBe("bare");
  });

  it("reports an empty repository without head-dependent flags", () => {
    const state = detectRepositoryState(
      createSignals({
        headExists: false,
        branch: "main",
        upstream: null,
        upstreamCheck: "none",
        remotes: [],
      }),
    );

    expect(state.primary).toBe("empty");
    expect(state.flags).toEqual(["no-remote"]);
  });

  it("reports a normal repository with no flags", () => {
    expect(detectRepositoryState(createSignals())).toEqual({ primary: "normal", flags: [] });
  });

  it("reports a subdirectory launch", () => {
    const state = detectRepositoryState(createSignals({ cwd: "/repo/src/deep" }));

    expect(state.primary).toBe("subdirectory");
  });

  it("reports detached HEAD first in the flag order", () => {
    const state = detectRepositoryState(
      createSignals({
        branch: null,
        detached: true,
        shortHash: "abc123",
        upstream: null,
        upstreamExists: false,
        upstreamCheck: "none",
      }),
    );

    expect(state.flags).toEqual(["detached", "no-upstream"]);
  });

  it("reports no-origin when other remotes exist", () => {
    const state = detectRepositoryState(createSignals({ remotes: ["upstream"], upstream: null }));

    expect(state.flags).toEqual(["no-upstream", "no-origin"]);
  });

  it("reports upstream-gone only after a successful check", () => {
    expect(
      detectRepositoryState(createSignals({ upstreamExists: false, upstreamCheck: "checked" }))
        .flags,
    ).toEqual(["upstream-gone"]);

    expect(
      detectRepositoryState(createSignals({ upstreamExists: false, upstreamCheck: "unknown" }))
        .flags,
    ).toEqual([]);
  });

  it("reports each operation marker separately and in order", () => {
    const state = detectRepositoryState(
      createSignals({
        mergeInProgress: true,
        rebaseInProgress: true,
        cherryPickInProgress: true,
        conflictedPaths: ["shared.txt"],
      }),
    );

    expect(state.flags).toEqual([
      "merge-in-progress",
      "rebase-in-progress",
      "cherry-pick-in-progress",
      "conflicted",
    ]);
  });

  it("reports missing identity, operation, and configuration flags in order", () => {
    const state = detectRepositoryState(
      createSignals({
        identity: { name: null, email: null },
        operationRunning: true,
        externalChanges: true,
        hugeRepository: true,
        binaryOrOversized: true,
        checkoutDirty: true,
        hookFailure: true,
        authNetworkFailure: true,
        invalidConfig: true,
        invalidTheme: true,
      }),
    );

    expect(state.flags).toEqual([
      "operation-in-progress",
      "checkout-dirty",
      "external-changes",
      "huge-repository",
      "binary-or-oversized",
      "missing-identity",
      "hook-failure",
      "auth-network-failure",
      "invalid-config",
      "invalid-theme",
    ]);
  });

  it("keeps configuration warnings while the shell is gated", () => {
    expect(
      detectRepositoryState(
        createSignals({
          insideWorkTree: false,
          notARepository: true,
          invalidConfig: true,
          invalidTheme: true,
        }),
      ),
    ).toEqual({
      primary: "not-a-repository",
      flags: ["invalid-config", "invalid-theme"],
    });
  });
});
