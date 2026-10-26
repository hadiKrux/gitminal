import { describe, expect, it } from "bun:test";
import { getAvailability } from "@/domain/commands/commands.availability";
import type {
  CommandContext,
  CommandPanelFacts,
  CommandTarget,
} from "@/domain/commands/commands.types";
import type {
  BranchRecord,
  StashRecord,
  TagRowRecord,
  WorktreeRecord,
} from "@/domain/git/git.types";
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
    panel: overrides.panel,
    formValues: overrides.formValues,
  };
}

/**
 * Builds one panel facts value.
 *
 * @param overrides - Facts to override.
 * @returns The panel facts.
 */
function createPanel(overrides: Partial<CommandPanelFacts> = {}): CommandPanelFacts {
  return {
    branches: [],
    remoteBranches: [],
    stashes: [],
    worktrees: [],
    tagRows: [],
    status: null,
    ...overrides,
  };
}

/**
 * Builds one local branch record.
 *
 * @param name - Branch name.
 * @param worktreePath - Path of the worktree that has it checked out, or null.
 * @returns The branch record.
 */
function branch(name: string, worktreePath: string | null = null): BranchRecord {
  return {
    name,
    head: false,
    tipOid: "abc123",
    committerDate: null,
    upstream: null,
    upstreamRemote: null,
    upstreamBranch: null,
    ahead: 0,
    behind: 0,
    worktreePath,
    upstreamStatus: "none",
  };
}

/**
 * Builds one stash record.
 *
 * @param objectName - Immutable stash object name.
 * @returns The stash record.
 */
function stash(objectName: string): StashRecord {
  return {
    index: "stash@{0}",
    objectName,
    subject: "WIP on main: abc123 work",
    sourceBranch: "main",
    committedAt: 1_700_000_000,
  };
}

/**
 * Builds one tag row.
 *
 * @param name - Tag name.
 * @param overrides - Row values to override.
 * @returns The tag row.
 */
function tagRow(name: string, overrides: Partial<TagRowRecord> = {}): TagRowRecord {
  return {
    name,
    objectType: "commit",
    targetOid: "abc123",
    subject: "subject",
    local: true,
    remotes: [],
    state: "unpushed",
    ...overrides,
  };
}

/**
 * Builds one worktree record.
 *
 * @param path - Absolute worktree path.
 * @param current - Whether it is the current worktree.
 * @returns The worktree record.
 */
function worktree(path: string, current: boolean): WorktreeRecord {
  return {
    path,
    headOid: "abc123",
    branch: "feature",
    detached: false,
    bare: false,
    locked: false,
    lockReason: null,
    prunable: false,
    pruneReason: null,
    current,
    dirty: false,
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

  it("blocks deleting a branch checked out in another worktree", () => {
    const panel = createPanel({ branches: [branch("feature", "/repo-feature")] });

    expect(
      getAvailability(
        "branch.delete",
        createContext({ panel, target: { kind: "branch", name: "feature" } }),
      ),
    ).toEqual({ available: false, reason: "checked-out-in-worktree" });

    expect(
      getAvailability(
        "branch.delete",
        createContext({
          panel: createPanel({ branches: [branch("feature")] }),
          target: { kind: "branch", name: "feature" },
        }),
      ),
    ).toEqual({ available: true });
  });

  it("blocks creating a local branch from a remote branch the snapshot does not hold", () => {
    const target: CommandTarget = { kind: "remoteBranch", remote: "origin", branch: "topic" };

    expect(
      getAvailability("remote.createLocal", createContext({ panel: createPanel(), target })),
    ).toEqual({ available: false, reason: "no-remote-branch" });

    expect(
      getAvailability(
        "remote.createLocal",
        createContext({
          panel: createPanel({
            remoteBranches: [
              {
                ref: "refs/remotes/origin/topic",
                remote: "origin",
                branch: "topic",
                tipOid: "abc123",
                committerDate: null,
                subject: "topic",
              },
            ],
          }),
          target,
        }),
      ),
    ).toEqual({ available: true });
  });

  it("guards tag push with the last known remote tag set", () => {
    const target: CommandTarget = { kind: "tag", name: "v1" };

    expect(
      getAvailability(
        "tag.push",
        createContext({
          panel: createPanel({ tagRows: [tagRow("v1", { state: "both" })] }),
          target,
        }),
      ),
    ).toEqual({ available: false, reason: "tag-already-on-remote" });

    expect(
      getAvailability(
        "tag.push",
        createContext({
          panel: createPanel({ tagRows: [tagRow("v1", { state: "unknown" })] }),
          target,
        }),
      ),
    ).toEqual({ available: false, reason: "remote-tag-unknown" });

    expect(
      getAvailability(
        "tag.push",
        createContext({
          panel: createPanel({
            tagRows: [tagRow("v1", { local: false, remotes: ["origin"], state: "remote" })],
          }),
          target,
        }),
      ),
    ).toEqual({ available: false, reason: "invalid-target" });

    expect(
      getAvailability(
        "tag.push",
        createContext({
          panel: createPanel({ tagRows: [tagRow("v1", { state: "unpushed" })] }),
          target,
        }),
      ),
    ).toEqual({ available: true });
  });

  it("blocks pushing a tag when no remote is configured", () => {
    const signals = createSignals({ remotes: [] });

    expect(
      getAvailability(
        "tag.push",
        createContext({
          signals,
          panel: createPanel({ tagRows: [tagRow("v1", { state: "local-only" })] }),
          target: { kind: "tag", name: "v1" },
        }),
      ),
    ).toEqual({ available: false, reason: "no-remote" });
  });

  it("requires the deleted tag to still exist", () => {
    expect(
      getAvailability(
        "tag.delete",
        createContext({ panel: createPanel(), target: { kind: "tag", name: "v1" } }),
      ),
    ).toEqual({ available: false, reason: "invalid-target" });

    expect(
      getAvailability(
        "tag.delete",
        createContext({
          panel: createPanel({ tagRows: [tagRow("v1")] }),
          target: { kind: "tag", name: "v1" },
        }),
      ),
    ).toEqual({ available: true });
  });

  it("refuses a stash action without a selected or still-existing stash", () => {
    const target: CommandTarget = { kind: "stash", objectName: "object-1" };

    expect(getAvailability("stash.apply", createContext({ panel: createPanel(), target }))).toEqual(
      { available: false, reason: "no-stash-selected" },
    );

    expect(
      getAvailability(
        "stash.apply",
        createContext({ panel: createPanel({ stashes: [stash("object-2")] }), target }),
      ),
    ).toEqual({ available: false, reason: "stash-changed-externally" });

    expect(
      getAvailability(
        "stash.apply",
        createContext({ panel: createPanel({ stashes: [stash("object-1")] }), target }),
      ),
    ).toEqual({ available: true });
  });

  it("delegates stash creation to the status snapshot", () => {
    const nothingToStash = createSignals({
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
    });

    expect(
      getAvailability(
        "stash.create",
        createContext({
          signals: nothingToStash,
          panel: createPanel({ status: { ...emptyStatus(), untrackedCount: 0 } }),
        }),
      ),
    ).toEqual({ available: false, reason: "nothing-to-stash" });

    expect(
      getAvailability(
        "stash.create",
        createContext({
          panel: createPanel({ status: { ...emptyStatus(), untrackedCount: 1 } }),
        }),
      ),
    ).toEqual({ available: false, reason: "only-untracked-changes" });

    expect(
      getAvailability(
        "stash.create",
        createContext({ panel: createPanel({ status: { ...emptyStatus(), unstagedCount: 1 } }) }),
      ),
    ).toEqual({ available: true });
  });

  it("reads the include-untracked form value for only-untracked changes", () => {
    const panel = createPanel({ status: { ...emptyStatus(), untrackedCount: 1 } });

    expect(
      getAvailability(
        "stash.create",
        createContext({ panel, formValues: { includeUntracked: "false" } }),
      ),
    ).toEqual({ available: false, reason: "only-untracked-changes" });

    expect(
      getAvailability(
        "stash.create",
        createContext({ panel, formValues: { includeUntracked: "true" } }),
      ),
    ).toEqual({ available: true });
  });

  it("blocks deleting the current worktree or a worktree that no longer exists", () => {
    const panel = createPanel({
      worktrees: [worktree("/repo", true), worktree("/repo-feature", false)],
    });

    expect(
      getAvailability(
        "worktree.delete",
        createContext({ panel, target: { kind: "worktree", path: "/repo" } }),
      ),
    ).toEqual({ available: false, reason: "current-worktree" });

    expect(
      getAvailability(
        "worktree.delete",
        createContext({ panel, target: { kind: "worktree", path: "/repo-gone" } }),
      ),
    ).toEqual({ available: false, reason: "worktree-missing" });

    expect(
      getAvailability(
        "worktree.delete",
        createContext({ panel, target: { kind: "worktree", path: "/repo-feature" } }),
      ),
    ).toEqual({ available: true });
  });

  it("blocks worktree creation in an empty repository", () => {
    const signals = createSignals({
      headExists: false,
      branch: null,
      upstream: null,
      upstreamCheck: "none",
    });

    expect(getAvailability("worktree.create", createContext({ signals }))).toEqual({
      available: false,
      reason: "no-commits-yet",
    });
  });

  it("allows creating a local branch in an empty repository that has remote-tracking refs", () => {
    const signals = createSignals({
      headExists: false,
      branch: null,
      upstream: null,
      upstreamCheck: "none",
    });
    const panel = createPanel({
      remoteBranches: [
        {
          ref: "refs/remotes/origin/topic",
          remote: "origin",
          branch: "topic",
          tipOid: "abc123",
          committerDate: null,
          subject: "topic",
        },
      ],
    });

    expect(
      getAvailability(
        "remote.createLocal",
        createContext({
          signals,
          panel,
          target: { kind: "remoteBranch", remote: "origin", branch: "topic" },
        }),
      ),
    ).toEqual({ available: true });
  });

  it("blocks creating a local branch when the repository has no commits and no remote refs", () => {
    const signals = createSignals({
      headExists: false,
      branch: null,
      upstream: null,
      upstreamCheck: "none",
    });

    expect(
      getAvailability(
        "remote.createLocal",
        createContext({
          signals,
          panel: createPanel({ remoteBranches: undefined }),
          target: { kind: "remoteBranch", remote: "origin", branch: "topic" },
        }),
      ),
    ).toEqual({ available: false, reason: "no-commits-yet" });
  });
});

/**
 * Builds a status snapshot with one change per bucket zeroed.
 *
 * @returns The status snapshot.
 */
function emptyStatus() {
  return {
    headOid: "abc123",
    branch: "main",
    detached: false,
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    entries: [],
    conflictedPaths: [],
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
  };
}
