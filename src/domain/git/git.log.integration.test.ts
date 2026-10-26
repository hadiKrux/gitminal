import { describe, expect, it } from "bun:test";
import { readCommitDiff } from "@/domain/git/git.diff.read-only";
import {
  readCommitDetails,
  readCommitStats,
  readLogPage,
  readSearchPage,
} from "@/domain/git/git.log";
import type { GitClient } from "@/domain/git/git.types";
import { createGraphPaginator } from "@/domain/graph/graph.paginate";
import type {
  GraphPage,
  GraphPageOutcome,
  GraphPageRequest,
  GraphPaginator,
  GraphScope,
} from "@/domain/graph/graph.types";
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

/**
 * Builds a page loader that runs the real bounded log read for one scope.
 *
 * @param client - Git client bound to the fixture.
 * @param cwd - Repository root.
 * @param scope - Scope the page reads from.
 * @returns The paginator loader.
 */
function createRealPageLoader(
  client: GitClient,
  cwd: string,
  scope: GraphScope,
): (request: GraphPageRequest) => Promise<GraphPage> {
  return async (request) => {
    const result = await readLogPage(client, {
      cwd,
      signal: signal(),
      scope,
      limit: request.limit,
      frontier: request.frontier,
    });

    if (!result.ok) {
      throw new Error(result.failure?.message ?? "log page failed");
    }

    return {
      commits: result.rows.map((row) => ({ oid: row.oid, parents: row.parents, row })),
      done: result.done,
    };
  };
}

/**
 * Walks every page of one paginator.
 *
 * @param paginator - Paginator to drive.
 * @returns Each settled outcome, in load order.
 */
async function walkAllPages(paginator: GraphPaginator): Promise<readonly GraphPageOutcome[]> {
  const outcomes: GraphPageOutcome[] = [await paginator.loadInitial()];

  while (!paginator.getState().done && outcomes.length < 50) {
    outcomes.push(await paginator.loadOlder());
  }

  return outcomes;
}

/**
 * Reads every commit OID reachable from every ref.
 *
 * @param fixture - Fixture repository.
 * @returns Sorted OID list.
 */
async function readAllOids(fixture: {
  readonly run: (args: readonly string[]) => Promise<{ readonly stdout: string }>;
}): Promise<readonly string[]> {
  const result = await fixture.run(["rev-list", "--all"]);

  return result.stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .sort();
}

describe.skipIf(!gitAvailable)("graph and diff reads against a real repository", () => {
  it("reads a log page, a search page, details, stats, and the commit diff", async () => {
    await withGitFixture({}, async (fixture) => {
      fixture.writeFile("app.txt", `${"line\n".repeat(20)}`);
      expect((await fixture.commit("Add app file")).ok).toBeTrue();

      await fixture.run(["checkout", "-b", "feature"], { operationClass: "write" });
      fixture.writeFile("feature.txt", "feature\n");
      expect((await fixture.commit("Add feature file")).ok).toBeTrue();

      await fixture.run(["checkout", "main"], { operationClass: "write" });
      fixture.writeFile("main.txt", "main\n");
      expect((await fixture.commit("Add main file")).ok).toBeTrue();

      const merged = await fixture.run(["merge", "--no-ff", "feature", "-m", "Merge feature"], {
        operationClass: "write",
      });

      expect(merged.ok).toBeTrue();

      const head = await fixture.run(["rev-parse", "HEAD"]);
      const mergeOid = head.stdout.trim();

      const page = await readLogPage(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
        scope: "all",
        limit: 10,
      });

      expect(page.ok).toBeTrue();
      expect(page.failure).toBeNull();
      expect(page.rows.map((row) => row.oid)).toContain(mergeOid);

      const mergeRow = page.rows.find((row) => row.oid === mergeOid);

      expect(mergeRow?.parents).toHaveLength(2);
      expect(mergeRow?.fileCount).toBeGreaterThan(0);

      const search = await readSearchPage(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
        scope: "all",
        terms: ["feature"],
        limit: 10,
      });

      expect(search.ok).toBeTrue();
      expect(search.failure).toBeNull();
      expect(search.rows.length).toBeGreaterThan(0);

      const details = await readCommitDetails(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
        oid: mergeOid,
      });

      expect(details.ok).toBeTrue();
      expect(details.details?.oid).toBe(mergeOid);
      expect(details.details?.parents).toHaveLength(2);

      const stats = await readCommitStats(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
        oid: mergeOid,
      });

      expect(stats.ok).toBeTrue();
      expect(stats.stats?.filesChanged).toBeGreaterThan(0);
      expect(stats.stats?.insertions).toBeGreaterThan(0);

      const diff = await readCommitDiff(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
        sha: mergeOid,
        contextLines: 3,
      });

      expect(diff.ok).toBeTrue();
      expect(diff.failure).toBeNull();
      expect(diff.files.map((file) => file.path)).toContain("feature.txt");
    });
  });
});

describe.skipIf(!gitAvailable)("paged history against a real repository", () => {
  it("loads older pages from the frontier without repeating page 1", async () => {
    await withGitFixture({ seed: false }, async (fixture) => {
      for (let number = 1; number <= 5; number += 1) {
        fixture.writeFile("history.txt", `${number}\n`);
        expect((await fixture.commit(`commit ${number}`)).ok).toBeTrue();
      }

      const page1 = await readLogPage(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
        scope: "all",
        limit: 2,
      });

      expect(page1.ok).toBeTrue();
      expect(page1.rows.map((row) => row.subject)).toEqual(["commit 5", "commit 4"]);
      expect(page1.done).toBeFalse();

      const frontier1 = page1.rows.at(-1)?.parents ?? [];

      expect(frontier1).toHaveLength(1);

      const page2 = await readLogPage(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
        scope: "all",
        limit: 2,
        frontier: frontier1,
      });

      expect(page2.ok).toBeTrue();
      expect(page2.rows.map((row) => row.subject)).toEqual(["commit 3", "commit 2"]);
      expect(
        page2.rows.some((row) => page1.rows.some((first) => first.oid === row.oid)),
      ).toBeFalse();

      const frontier2 = page2.rows.at(-1)?.parents ?? [];

      expect(frontier2).toHaveLength(1);
      expect(frontier2).not.toEqual(frontier1);

      const page3 = await readLogPage(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
        scope: "all",
        limit: 2,
        frontier: frontier2,
      });

      expect(page3.rows.map((row) => row.subject)).toEqual(["commit 1"]);
      expect(page3.done).toBeTrue();
    });
  });

  it("loads every scope tip across page boundaries, including an older branch", async () => {
    await withGitFixture({ seed: false }, async (fixture) => {
      fixture.writeFile("main.txt", "main 1\n");
      expect((await fixture.commit("main 1")).ok).toBeTrue();

      expect(
        (await fixture.run(["checkout", "-b", "old"], { operationClass: "write" })).ok,
      ).toBeTrue();
      fixture.writeFile("old.txt", "old branch\n");
      expect((await fixture.commit("OLD branch tip")).ok).toBeTrue();

      const oldTip = (await fixture.run(["rev-parse", "HEAD"])).stdout.trim();

      // Give the side tip an older committer second so the first page cannot reach it.
      await new Promise((resolve) => setTimeout(resolve, 1_100));

      expect((await fixture.run(["checkout", "main"], { operationClass: "write" })).ok).toBeTrue();

      for (let number = 2; number <= 5; number += 1) {
        fixture.writeFile("main.txt", `main ${number}\n`);
        expect((await fixture.commit(`main ${number}`)).ok).toBeTrue();
      }

      const mainTip = (await fixture.run(["rev-parse", "HEAD"])).stdout.trim();
      const expected = await readAllOids(fixture);
      const paginator = createGraphPaginator({
        pageSize: 2,
        initialScope: "all",
        listScopeTips: () => [mainTip, oldTip],
        loadPage: createRealPageLoader(fixture.client, fixture.root, "all"),
      });

      const first = await paginator.loadInitial();

      expect(first.state.rows.some((row) => row.oid === oldTip)).toBeFalse();

      const outcomes = [first];

      while (!paginator.getState().done && outcomes.length < 20) {
        outcomes.push(await paginator.loadOlder());
      }

      const rows = paginator.getState().rows.map((row) => row.oid);

      expect([...rows].sort()).toEqual([...expected]);
      expect(new Set(rows).size).toBe(expected.length);
      expect(rows.filter((oid) => oid === oldTip)).toHaveLength(1);
      expect(paginator.getState().done).toBeTrue();
      expect(outcomes.slice(0, -1).every((outcome) => outcome.status !== "done")).toBeTrue();
      expect(outcomes.at(-1)?.status).toBe("done");
      expect(await paginator.ensureLoaded(oldTip)).toBe("loaded");
    });
  });

  it("does not fold an external commit into a started walk and reloads it in topo order", async () => {
    await withGitFixture({ seed: false }, async (fixture) => {
      for (let number = 1; number <= 4; number += 1) {
        fixture.writeFile("history.txt", `${number}\n`);
        expect((await fixture.commit(`commit ${number}`)).ok).toBeTrue();
      }

      const mainTip = (await fixture.run(["rev-parse", "HEAD"])).stdout.trim();
      let tips: readonly string[] = [mainTip];
      const paginator = createGraphPaginator({
        pageSize: 2,
        initialScope: "all",
        listScopeTips: () => tips,
        loadPage: createRealPageLoader(fixture.client, fixture.root, "all"),
      });

      const first = await paginator.loadInitial();

      expect(first.state.rows.map((row) => row.row?.subject)).toEqual(["commit 4", "commit 3"]);

      fixture.writeFile("history.txt", "external\n");
      expect((await fixture.commit("commit 5 external")).ok).toBeTrue();

      const externalTip = (await fixture.run(["rev-parse", "HEAD"])).stdout.trim();

      tips = [externalTip];

      await paginator.loadOlder();
      await paginator.loadOlder();

      const walked = paginator.getState().rows.map((row) => row.row?.subject);

      expect(walked).toEqual(["commit 4", "commit 3", "commit 2", "commit 1"]);
      expect(walked).not.toContain("commit 5 external");
      expect(paginator.getState().done).toBeTrue();

      paginator.reset("all");

      const reloaded = await walkAllPages(paginator);
      const subjects = paginator.getState().rows.map((row) => row.row?.subject);
      const oneShot = (await fixture.run(["log", "--all", "--topo-order", "--format=%s"])).stdout
        .split("\n")
        .filter((line) => line.length > 0);

      expect(subjects).toEqual([
        "commit 5 external",
        "commit 4",
        "commit 3",
        "commit 2",
        "commit 1",
      ]);
      expect(subjects).toEqual(oneShot);
      expect(paginator.getState().done).toBeTrue();
      expect(reloaded.slice(0, -1).every((outcome) => outcome.status !== "done")).toBeTrue();
      expect(reloaded.at(-1)?.status).toBe("done");
    });
  });

  it("loads every commit of a merge exactly once across page boundaries", async () => {
    await withGitFixture({ seed: false }, async (fixture) => {
      fixture.writeFile("base.txt", "base\n");
      expect((await fixture.commit("base")).ok).toBeTrue();
      expect(
        (await fixture.run(["checkout", "-b", "side"], { operationClass: "write" })).ok,
      ).toBeTrue();
      fixture.writeFile("side.txt", "side\n");
      expect((await fixture.commit("side 1")).ok).toBeTrue();
      expect((await fixture.run(["checkout", "main"], { operationClass: "write" })).ok).toBeTrue();
      fixture.writeFile("main.txt", "main\n");
      expect((await fixture.commit("main 1")).ok).toBeTrue();
      expect(
        (
          await fixture.run(["merge", "--no-ff", "side", "-m", "merge side"], {
            operationClass: "write",
          })
        ).ok,
      ).toBeTrue();

      const tip = (await fixture.run(["rev-parse", "HEAD"])).stdout.trim();
      const expected = await readAllOids(fixture);
      const paginator = createGraphPaginator({
        pageSize: 2,
        initialScope: "all",
        listScopeTips: () => [tip],
        loadPage: createRealPageLoader(fixture.client, fixture.root, "all"),
      });

      const outcomes = await walkAllPages(paginator);
      const rows = paginator.getState().rows.map((row) => row.oid);

      expect([...rows].sort()).toEqual([...expected]);
      expect(new Set(rows).size).toBe(expected.length);
      expect(paginator.getState().done).toBeTrue();
      expect(outcomes.slice(0, -1).every((outcome) => outcome.status !== "done")).toBeTrue();
    });
  });

  it("loads every commit of an octopus merge exactly once across page boundaries", async () => {
    await withGitFixture({ seed: false }, async (fixture) => {
      fixture.writeFile("base.txt", "base\n");
      expect((await fixture.commit("base")).ok).toBeTrue();
      expect(
        (await fixture.run(["checkout", "-b", "one"], { operationClass: "write" })).ok,
      ).toBeTrue();
      fixture.writeFile("one.txt", "one\n");
      expect((await fixture.commit("branch one")).ok).toBeTrue();
      expect((await fixture.run(["checkout", "main"], { operationClass: "write" })).ok).toBeTrue();
      expect(
        (await fixture.run(["checkout", "-b", "two"], { operationClass: "write" })).ok,
      ).toBeTrue();
      fixture.writeFile("two.txt", "two\n");
      expect((await fixture.commit("branch two")).ok).toBeTrue();
      expect((await fixture.run(["checkout", "main"], { operationClass: "write" })).ok).toBeTrue();
      fixture.writeFile("main.txt", "main\n");
      expect((await fixture.commit("main tip")).ok).toBeTrue();
      expect(
        (
          await fixture.run(["merge", "--no-ff", "one", "two", "-m", "octopus"], {
            operationClass: "write",
          })
        ).ok,
      ).toBeTrue();

      const tip = (await fixture.run(["rev-parse", "HEAD"])).stdout.trim();
      const expected = await readAllOids(fixture);
      const paginator = createGraphPaginator({
        pageSize: 2,
        initialScope: "all",
        listScopeTips: () => [tip],
        loadPage: createRealPageLoader(fixture.client, fixture.root, "all"),
      });

      const outcomes = await walkAllPages(paginator);
      const rows = paginator.getState().rows.map((row) => row.oid);

      expect([...rows].sort()).toEqual([...expected]);
      expect(new Set(rows).size).toBe(expected.length);
      expect(paginator.getState().done).toBeTrue();
      expect(outcomes.slice(0, -1).every((outcome) => outcome.status !== "done")).toBeTrue();
    });
  });

  it("returns every search match across a merge page boundary", async () => {
    await withGitFixture({ seed: false }, async (fixture) => {
      fixture.writeFile("base.txt", "base\n");
      expect((await fixture.commit("plain base")).ok).toBeTrue();
      expect(
        (await fixture.run(["checkout", "-b", "side"], { operationClass: "write" })).ok,
      ).toBeTrue();
      fixture.writeFile("side.txt", "side\n");
      expect((await fixture.commit("TARGET side deep")).ok).toBeTrue();
      expect((await fixture.run(["checkout", "main"], { operationClass: "write" })).ok).toBeTrue();
      fixture.writeFile("main.txt", "main\n");
      expect((await fixture.commit("TARGET main")).ok).toBeTrue();
      expect(
        (
          await fixture.run(["merge", "--no-ff", "side", "-m", "merge side"], {
            operationClass: "write",
          })
        ).ok,
      ).toBeTrue();

      const subjects: string[] = [];
      let offset = 0;
      let done = false;

      for (let page = 0; page < 10 && !done; page += 1) {
        const result = await readSearchPage(fixture.client, {
          cwd: fixture.root,
          signal: signal(),
          scope: "all",
          terms: ["TARGET"],
          limit: 1,
          offset,
        });

        expect(result.ok).toBeTrue();
        subjects.push(...result.rows.map((row) => row.subject));
        offset += result.rows.length;
        done = result.done;
      }

      expect(subjects.sort()).toEqual(["TARGET main", "TARGET side deep"]);
      expect(done).toBeTrue();
    });
  });

  it("returns every search match across offset pages, including behind a non-matching parent", async () => {
    await withGitFixture({ seed: false }, async (fixture) => {
      for (let number = 1; number <= 10; number += 1) {
        fixture.writeFile("search.txt", `${number}\n`);
        const subject = number === 1 || number === 3 || number === 8 ? "TARGET" : "plain";

        expect((await fixture.commit(`${subject} commit ${number}`)).ok).toBeTrue();
      }

      const subjects: string[] = [];
      let offset = 0;
      let done = false;

      for (let page = 0; page < 10 && !done; page += 1) {
        const result = await readSearchPage(fixture.client, {
          cwd: fixture.root,
          signal: signal(),
          scope: "all",
          terms: ["TARGET"],
          limit: 1,
          offset,
        });

        expect(result.ok).toBeTrue();
        subjects.push(...result.rows.map((row) => row.subject));
        offset += result.rows.length;
        done = result.done;
      }

      expect(subjects).toEqual(["TARGET commit 8", "TARGET commit 3", "TARGET commit 1"]);
      expect(done).toBeTrue();
    });
  });

  it("finds matches from every branch in the configured scope", async () => {
    await withGitFixture({ seed: false }, async (fixture) => {
      fixture.writeFile("base.txt", "base\n");
      expect((await fixture.commit("base commit")).ok).toBeTrue();

      await fixture.run(["checkout", "-b", "side"], { operationClass: "write" });
      fixture.writeFile("side.txt", "side\n");
      expect((await fixture.commit("TARGET side deep")).ok).toBeTrue();

      await fixture.run(["checkout", "main"], { operationClass: "write" });
      fixture.writeFile("main.txt", "main\n");
      expect((await fixture.commit("TARGET main")).ok).toBeTrue();

      const subjects: string[] = [];
      let offset = 0;
      let done = false;

      for (let page = 0; page < 5 && !done; page += 1) {
        const result = await readSearchPage(fixture.client, {
          cwd: fixture.root,
          signal: signal(),
          scope: "all",
          terms: ["TARGET"],
          limit: 1,
          offset,
        });

        expect(result.ok).toBeTrue();
        subjects.push(...result.rows.map((row) => row.subject));
        offset += result.rows.length;
        done = result.done;
      }

      expect(subjects.sort()).toEqual(["TARGET main", "TARGET side deep"]);
      expect(done).toBeTrue();
    });
  });
});
