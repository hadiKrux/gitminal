import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement, type ReactNode } from "react";
import { readAvailabilityRegion, useCommandTargets } from "@/app/hooks/useCommandTargets";
import type { CommandTargetHandle } from "@/app/hooks/useCommandTargets.types";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useRepository } from "@/app/hooks/useRepository";
import { getCommandDescriptor } from "@/domain/commands/commands.registry";
import type { CommandDescriptor, CommandTarget } from "@/domain/commands/commands.types";
import type { RepositorySelection } from "@/domain/repository/repository.types";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient } from "@/test/git.fake";

/** Latest shared target handle captured by the probe. */
let latestTargets: CommandTargetHandle | undefined;

/** Latest focus projection captured by the probe. */
let latestFocus: ReturnType<typeof useFocusState> | undefined;

/** Latest repository projection captured by the probe. */
let latestRepository: ReturnType<typeof useRepository> | undefined;

/**
 * Captures the shared target derivation and the projections it reads.
 *
 * @returns The probe content.
 */
function TargetsProbe(): ReactNode {
  const repository = useRepository();

  latestRepository = repository;
  latestFocus = useFocusState();
  latestTargets = useCommandTargets();

  return createElement("text", null, repository.snapshot === null ? "loading" : "ready");
}

/**
 * Renders until a predicate holds or the deadline passes.
 *
 * @param setup - Renderer setup.
 * @param predicate - Condition to wait for.
 */
async function waitFor(
  setup: Awaited<ReturnType<typeof testRender>>,
  predicate: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (!predicate() && Date.now() < deadline) {
    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

/**
 * Renders the probe and waits for the first repository read.
 *
 * @returns The renderer setup.
 */
async function renderTargets(): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestTargets = undefined;
  latestFocus = undefined;
  latestRepository = undefined;

  const setup = await testRender(
    createElement(
      AppTestProviders,
      { gitClient: createFakeGitClient().client },
      createElement(TargetsProbe),
    ),
    { width: 80, height: 20 },
  );

  await waitFor(
    setup,
    () =>
      latestRepository !== undefined &&
      latestRepository.snapshot !== null &&
      latestTargets !== undefined,
  );

  return setup;
}

/**
 * Reads a real descriptor from the catalogue.
 *
 * @param commandId - Command id.
 * @returns The descriptor.
 * @throws When the command is not in the catalogue.
 */
function descriptor(commandId: string): CommandDescriptor {
  const found = getCommandDescriptor(commandId);

  if (found === undefined) {
    throw new Error(`Missing command descriptor: ${commandId}`);
  }

  return found;
}

/**
 * Derives the target of one real command.
 *
 * @param commandId - Command id.
 * @returns The derived target.
 */
function derive(commandId: string): CommandTarget {
  return deriveDescriptor(descriptor(commandId));
}

/**
 * Derives the target of one descriptor.
 *
 * @param candidate - Command descriptor.
 * @returns The derived target.
 */
function deriveDescriptor(candidate: CommandDescriptor): CommandTarget {
  const targets = latestTargets;

  if (targets === undefined) {
    throw new Error("The target probe was not mounted.");
  }

  return targets.deriveTarget(candidate);
}

/**
 * Seeds one region cursor and flushes the render.
 *
 * @param setup - Renderer setup.
 * @param region - Region whose cursor is seeded.
 * @param identity - Cursor identity.
 */
async function seedCursor(
  setup: Awaited<ReturnType<typeof testRender>>,
  region: "branches" | "remotes" | "tags" | "stashes" | "worktrees" | "diff",
  identity: string,
): Promise<void> {
  await act(async () => {
    latestFocus?.setCursor(region, identity);
    await setup.renderOnce();
  });
}

/**
 * Selects one right-pane selection and flushes the render.
 *
 * @param setup - Renderer setup.
 * @param selection - Selection to apply.
 */
async function select(
  setup: Awaited<ReturnType<typeof testRender>>,
  selection: RepositorySelection,
): Promise<void> {
  await act(async () => {
    latestRepository?.setSelection(selection);
    await setup.renderOnce();
  });
}

beforeEach(() => {
  latestTargets = undefined;
  latestFocus = undefined;
  latestRepository = undefined;
});

describe("useCommandTargets derivation", () => {
  it("derives branch targets from the branches cursor and the current branch", async () => {
    const setup = await renderTargets();

    await seedCursor(setup, "branches", "feature");

    expect(derive("branch.delete")).toEqual({ kind: "branch", name: "feature" });
    expect(derive("remote.push")).toEqual({ kind: "branch", name: "main" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("derives a remote-branch target from the remotes cursor", async () => {
    const setup = await renderTargets();

    await seedCursor(setup, "remotes", "origin/main");

    expect(derive("remote.createLocal")).toEqual({
      kind: "remoteBranch",
      remote: "origin",
      branch: "main",
    });

    await act(async () => {
      latestFocus?.setCursor("remotes", "origin/missing");
      await setup.renderOnce();
    });

    expect(derive("remote.createLocal")).toEqual({ kind: "none" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("derives tag, stash, and worktree targets from their cursors", async () => {
    const setup = await renderTargets();

    await seedCursor(setup, "tags", "v1.0.0");
    await seedCursor(setup, "stashes", "aaa111");
    await seedCursor(setup, "worktrees", "/repo-feature");

    expect(derive("tag.delete")).toEqual({ kind: "tag", name: "v1.0.0" });
    expect(derive("stash.delete")).toEqual({ kind: "stash", objectName: "aaa111" });
    expect(derive("worktree.delete")).toEqual({ kind: "worktree", path: "/repo-feature" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("derives commit and pending targets from the right-pane selection", async () => {
    const setup = await renderTargets();

    await select(setup, { kind: "pending" });

    expect(derive("graph.selectPending")).toEqual({ kind: "pending" });
    expect(derive("graph.selectCommit")).toEqual({ kind: "none" });

    await select(setup, { kind: "commit", oid: "abc123" });

    expect(derive("graph.selectCommit")).toEqual({ kind: "commit", oid: "abc123" });
    expect(derive("graph.selectPending")).toEqual({ kind: "none" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("derives diff-file targets from the diff cursor including the read-only mapping", async () => {
    const setup = await renderTargets();

    await seedCursor(setup, "diff", "working::unstaged.txt");

    expect(derive("diff.stage")).toEqual({
      kind: "diffFile",
      section: "working",
      path: "unstaged.txt",
    });

    await seedCursor(setup, "diff", "readonly::src/a.ts");

    expect(derive("diff.stage")).toEqual({
      kind: "diffFile",
      section: "staged",
      path: "src/a.ts",
    });

    await seedCursor(setup, "diff", "nonsense");

    expect(derive("diff.stage")).toEqual({ kind: "none" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("returns the none target for form and none descriptors", async () => {
    const setup = await renderTargets();
    const formDescriptor: CommandDescriptor = {
      ...descriptor("remote.fetch"),
      id: "test.form",
      actionId: "test.form",
      targetKind: "form",
    };

    expect(deriveDescriptor(formDescriptor)).toEqual({ kind: "none" });
    expect(derive("remote.fetch")).toEqual({ kind: "none" });

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useCommandTargets owning region", () => {
  it("maps a scope to its owning region and returns null for global and overlay", async () => {
    const setup = await renderTargets();
    const targets = latestTargets;

    expect(targets?.readOwningRegion("global")).toBeNull();
    expect(targets?.readOwningRegion("overlay")).toBeNull();
    expect(targets?.readOwningRegion("branches")).toBe("branches");

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("readAvailabilityRegion", () => {
  it("maps a global scope to the overlay and keeps region and overlay scopes", () => {
    expect(readAvailabilityRegion("global")).toBe("overlay");
    expect(readAvailabilityRegion("overlay")).toBe("overlay");
    expect(readAvailabilityRegion("branches")).toBe("branches");
  });
});

describe("areCommandTargetsEqual", () => {
  const cases: readonly [CommandTarget, CommandTarget, boolean][] = [
    [{ kind: "branch", name: "main" }, { kind: "branch", name: "main" }, true],
    [{ kind: "branch", name: "main" }, { kind: "branch", name: "feature" }, false],
    [
      { kind: "remoteBranch", remote: "origin", branch: "main" },
      { kind: "remoteBranch", remote: "origin", branch: "main" },
      true,
    ],
    [
      { kind: "remoteBranch", remote: "origin", branch: "main" },
      { kind: "remoteBranch", remote: "upstream", branch: "main" },
      false,
    ],
    [{ kind: "tag", name: "v1.0.0", remote: "origin" }, { kind: "tag", name: "v1.0.0" }, false],
    [{ kind: "tag", name: "v1.0.0" }, { kind: "tag", name: "v1.0.0" }, true],
    [{ kind: "stash", objectName: "aaa111" }, { kind: "stash", objectName: "bbb222" }, false],
    [{ kind: "worktree", path: "/repo" }, { kind: "worktree", path: "/repo" }, true],
    [{ kind: "commit", oid: "abc123" }, { kind: "commit", oid: "abc123" }, true],
    [{ kind: "pending" }, { kind: "pending" }, true],
    [
      { kind: "diffFile", section: "working", path: "a.txt" },
      { kind: "diffFile", section: "working", path: "a.txt", oldPath: "b.txt" },
      false,
    ],
    [
      { kind: "diffFile", section: "working", path: "a.txt" },
      { kind: "diffFile", section: "staged", path: "a.txt" },
      false,
    ],
    [{ kind: "form", formId: "one" }, { kind: "form", formId: "one" }, true],
    [{ kind: "form", formId: "one" }, { kind: "form", formId: "two" }, false],
    [{ kind: "none" }, { kind: "none" }, true],
    [{ kind: "none" }, { kind: "pending" }, false],
  ];

  it("compares every field of every target kind by value", async () => {
    const setup = await renderTargets();
    const targets = latestTargets;

    for (const [left, right, expected] of cases) {
      expect(targets?.areCommandTargetsEqual(left, right), `${left.kind} <> ${right.kind}`).toBe(
        expected,
      );
    }

    await act(async () => {
      await setup.dispose();
    });
  });
});
