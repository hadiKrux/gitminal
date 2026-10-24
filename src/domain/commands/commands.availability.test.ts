import { describe, expect, it } from "bun:test";
import { getAvailability } from "@/domain/commands/commands.availability";
import type { CommandContext, CommandTarget } from "@/domain/commands/commands.types";
import {
  createRepositorySignals,
  detectRepositoryState,
} from "@/domain/repository/repository.states";
import type { RepositorySignals } from "@/domain/repository/repository.types";

/** No explicit target. */
const NO_TARGET: CommandTarget = { kind: "none" };

/** The current branch as an explicit target. */
const CURRENT_BRANCH: CommandTarget = { kind: "branch", name: "main" };

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
 * Builds a command context with overrides.
 *
 * @param overrides - Context values to override.
 * @returns The command context.
 */
function createContext(overrides: Partial<CommandContext> = {}): CommandContext {
  const signals = overrides.signals ?? createSignals();

  return {
    state: overrides.state ?? detectRepositoryState(signals),
    signals,
    target: overrides.target ?? NO_TARGET,
    region: overrides.region ?? "graph",
    operation: overrides.operation ?? "idle",
  };
}

describe("getAvailability", () => {
  it("reports an unknown command", () => {
    expect(getAvailability("nope.nothing", createContext())).toEqual({
      available: false,
      reason: "command-not-found",
    });
  });

  it("allows a normal read command", () => {
    expect(getAvailability("app.refresh", createContext())).toEqual({ available: true });
  });

  it("requires a matching target", () => {
    expect(getAvailability("branch.delete", createContext())).toEqual({
      available: false,
      reason: "missing-target",
    });
  });

  it("rejects a target when the command takes none", () => {
    expect(
      getAvailability("app.refresh", createContext({ target: { kind: "tag", name: "v1.0.0" } })),
    ).toEqual({ available: false, reason: "invalid-target" });
  });

  it("reports a missing target when the required kind does not match", () => {
    expect(
      getAvailability("branch.delete", createContext({ target: { kind: "tag", name: "v1.0.0" } })),
    ).toEqual({ available: false, reason: "missing-target" });
  });

  it("blocks deleting the current branch", () => {
    expect(
      getAvailability("branch.delete", createContext({ target: { kind: "branch", name: "main" } })),
    ).toEqual({ available: false, reason: "cannot-delete-current-branch" });

    expect(
      getAvailability(
        "branch.delete",
        createContext({ target: { kind: "branch", name: "feature" } }),
      ),
    ).toEqual({ available: true });
  });

  it("returns the repository-wide gate reason first", () => {
    const signals = createSignals({ branch: null, detached: true });

    expect(
      getAvailability("remote.pull", createContext({ signals, target: CURRENT_BRANCH })),
    ).toEqual({
      available: false,
      reason: "detached-head",
    });
  });

  it("blocks pull without an upstream", () => {
    const signals = createSignals({ upstream: null, upstreamCheck: "none" });

    expect(
      getAvailability("remote.pull", createContext({ signals, target: CURRENT_BRANCH })),
    ).toEqual({
      available: false,
      reason: "no-upstream",
    });
  });

  it("blocks pull when the upstream is gone", () => {
    const signals = createSignals({ upstreamExists: false });

    expect(
      getAvailability("remote.pull", createContext({ signals, target: CURRENT_BRANCH })),
    ).toEqual({
      available: false,
      reason: "upstream-gone",
    });
  });

  it("requires a branch target for pull and push", () => {
    expect(getAvailability("remote.pull", createContext())).toEqual({
      available: false,
      reason: "missing-target",
    });

    expect(getAvailability("remote.push", createContext())).toEqual({
      available: false,
      reason: "missing-target",
    });
  });

  it("allows pull and every push variant on the current branch", () => {
    for (const commandId of [
      "remote.pull",
      "remote.push",
      "remote.pushForceSafe",
      "remote.pushForceOverwrite",
      "remote.pushNoVerify",
    ]) {
      expect(getAvailability(commandId, createContext({ target: CURRENT_BRANCH }))).toEqual({
        available: true,
      });
    }
  });

  it("rejects a stale branch target for a remote command", () => {
    expect(
      getAvailability(
        "remote.push",
        createContext({ target: { kind: "branch", name: "feature" } }),
      ),
    ).toEqual({ available: false, reason: "invalid-target" });

    expect(
      getAvailability(
        "remote.pushNoVerify",
        createContext({ target: { kind: "branch", name: "feature" } }),
      ),
    ).toEqual({ available: false, reason: "invalid-target" });
  });

  it("rejects an empty branch name", () => {
    expect(
      getAvailability("branch.delete", createContext({ target: { kind: "branch", name: "" } })),
    ).toEqual({ available: false, reason: "invalid-target" });
  });

  it("blocks remote commands without a remote", () => {
    const signals = createSignals({ remotes: [], upstream: null, upstreamCheck: "none" });

    expect(getAvailability("remote.fetch", createContext({ signals }))).toEqual({
      available: false,
      reason: "no-remote",
    });
  });

  it("blocks fetch when no local branch has an upstream", () => {
    const signals = createSignals({ hasUpstreamBranches: false });

    expect(getAvailability("remote.fetch", createContext({ signals }))).toEqual({
      available: false,
      reason: "no-local-upstreams",
    });
  });

  it("blocks a mutation while another operation is running", () => {
    expect(getAvailability("branch.create", createContext({ operation: "running" }))).toEqual({
      available: false,
      reason: "operation-in-progress",
    });
  });

  it("rejects a remote branch whose remote is not configured", () => {
    expect(
      getAvailability(
        "tag.push",
        createContext({ target: { kind: "tag", name: "v1.0.0", remote: "upstream" } }),
      ),
    ).toEqual({ available: false, reason: "unknown-remote" });
  });

  it("blocks bulk staging during a merge", () => {
    const signals = createSignals({ mergeInProgress: true });

    expect(getAvailability("diff.stageAll", createContext({ signals }))).toEqual({
      available: false,
      reason: "merge-in-progress",
    });
  });

  it("blocks unstaging a conflicted file during a rebase", () => {
    const signals = createSignals({
      rebaseInProgress: true,
      conflictedPaths: ["shared.txt"],
    });

    expect(
      getAvailability(
        "diff.unstage",
        createContext({
          signals,
          target: { kind: "diffFile", section: "working", path: "shared.txt" },
        }),
      ),
    ).toEqual({ available: false, reason: "merge-state" });
  });

  it("requires conflicts to be resolved before discarding them", () => {
    const signals = createSignals({ conflictedPaths: ["shared.txt"] });
    const context = createContext({
      signals,
      target: { kind: "diffFile", section: "working", path: "shared.txt" },
    });

    expect(getAvailability("diff.discard", context)).toEqual({
      available: false,
      reason: "resolve-conflicts-first",
    });
    expect(getAvailability("diff.discardAll", createContext({ signals }))).toEqual({
      available: false,
      reason: "resolve-conflicts-first",
    });
  });

  it("allows a diff action on an unrelated file", () => {
    const signals = createSignals({ conflictedPaths: ["shared.txt"] });

    expect(
      getAvailability(
        "diff.stage",
        createContext({
          signals,
          target: { kind: "diffFile", section: "working", path: "other.txt" },
        }),
      ),
    ).toEqual({ available: true });
  });

  it("blocks commits without an identity", () => {
    const signals = createSignals({ identity: { name: null, email: null } });

    expect(getAvailability("commit.submit", createContext({ signals }))).toEqual({
      available: false,
      reason: "missing-git-identity",
    });
  });

  it("keeps every gated action absent from the catalogue as unavailable", () => {
    expect(getAvailability("nav.up", createContext())).toEqual({
      available: false,
      reason: "command-not-found",
    });
  });
});
