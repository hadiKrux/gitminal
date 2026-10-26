import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { useInternalCommands } from "@/app/hooks/useInternalCommands";
import { useRepository } from "@/app/hooks/useRepository";
import type { RepositoryContextValue } from "@/app/providers/RepositoryProvider.types";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient } from "@/test/git.fake";

/** Captured dispatcher handle. */
let latestCommands: ReturnType<typeof useInternalCommands> | undefined;

/** Captured repository context. */
let latestRepository: RepositoryContextValue | undefined;

/** Captures both handles used by the assertions. */
function Probe(): ReactNode {
  latestCommands = useInternalCommands();
  latestRepository = useRepository();

  return null;
}

/**
 * Renders the dispatcher inside the repository provider.
 *
 * @returns The renderer setup.
 */
async function renderHarness(): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestCommands = undefined;
  latestRepository = undefined;
  const { client } = createFakeGitClient();
  const setup = await testRender(
    <AppTestProviders gitClient={client}>
      <Probe />
    </AppTestProviders>,
    { width: 80, height: 10 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

beforeEach(() => {
  latestCommands = undefined;
  latestRepository = undefined;
});

describe("useInternalCommands", () => {
  it("selects pending, stash, and worktree targets without the command runner", async () => {
    const setup = await renderHarness();

    await act(async () => {
      expect(
        await latestCommands?.run("stash.select", { kind: "stash", objectName: "stash@{0}" }),
      ).toEqual({ status: "handled" });
    });
    expect(latestRepository?.selection).toEqual({ kind: "stash", objectName: "stash@{0}" });

    await act(async () => {
      expect(
        await latestCommands?.run("worktree.select", { kind: "worktree", path: "/repo-feature" }),
      ).toEqual({ status: "handled" });
    });
    expect(latestRepository?.selection).toEqual({ kind: "worktree", path: "/repo-feature" });

    await act(async () => {
      expect(await latestCommands?.run("graph.selectPending", { kind: "pending" })).toEqual({
        status: "handled",
      });
    });
    expect(latestRepository?.selection).toEqual({ kind: "pending" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("resolves graph.selectCommit through the bounded provider selector", async () => {
    const setup = await renderHarness();

    await act(async () => {
      latestRepository?.registerCommitNavigator(async () => "loaded");
    });

    await act(async () => {
      expect(
        await latestCommands?.run("graph.selectCommit", { kind: "commit", oid: "abc123" }),
      ).toEqual({ status: "handled" });
    });
    expect(latestRepository?.selection).toEqual({ kind: "commit", oid: "abc123" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("blocks a commit the bounded selector cannot load and leaves the selection alone", async () => {
    const setup = await renderHarness();

    await act(async () => {
      latestRepository?.setSelection({ kind: "pending" });
      latestRepository?.registerCommitNavigator(async () => "notFound");
    });

    await act(async () => {
      expect(
        await latestCommands?.run("graph.selectCommit", { kind: "commit", oid: "missing" }),
      ).toEqual({ status: "blocked", reason: "invalid-target" });
    });
    expect(latestRepository?.selection).toEqual({ kind: "pending" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("maps a cancelled walk to a neutral blocked reason and keeps the detailed outcome", async () => {
    const setup = await renderHarness();

    await act(async () => {
      latestRepository?.setSelection({ kind: "pending" });
      latestRepository?.registerCommitNavigator(async () => "cancelled");
    });

    await act(async () => {
      expect(
        await latestCommands?.run("graph.selectCommit", { kind: "commit", oid: "abc123" }),
      ).toEqual({ status: "blocked", reason: "operation-in-progress" });
      expect(await latestCommands?.selectCommit("abc123")).toBe("cancelled");
    });
    expect(latestRepository?.selection).toEqual({ kind: "pending" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("maps a failed page read to a neutral blocked reason and keeps the detailed outcome", async () => {
    const setup = await renderHarness();

    await act(async () => {
      latestRepository?.setSelection({ kind: "pending" });
      latestRepository?.registerCommitNavigator(async () => "error");
    });

    await act(async () => {
      expect(
        await latestCommands?.run("graph.selectCommit", { kind: "commit", oid: "abc123" }),
      ).toEqual({ status: "blocked", reason: "operation-in-progress" });
      expect(await latestCommands?.selectCommit("abc123")).toBe("error");
    });
    expect(latestRepository?.selection).toEqual({ kind: "pending" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("blocks a mismatched target, an unknown command, and a non-internal command", async () => {
    const setup = await renderHarness();

    await act(async () => {
      expect(await latestCommands?.run("graph.selectCommit", { kind: "pending" })).toEqual({
        status: "blocked",
        reason: "missing-target",
      });
      expect(await latestCommands?.run("stash.select", { kind: "none" })).toEqual({
        status: "blocked",
        reason: "missing-target",
      });
      expect(
        await latestCommands?.run("graph.selectPending", { kind: "commit", oid: "abc123" }),
      ).toEqual({ status: "blocked", reason: "missing-target" });
      expect(await latestCommands?.run("nope.nothing", { kind: "none" })).toEqual({
        status: "blocked",
        reason: "command-not-found",
      });
    });

    expect(latestRepository?.selection).toEqual({ kind: "pending" });

    await act(async () => {
      await setup.dispose();
    });
  });
});
