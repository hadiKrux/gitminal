import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetActionRegistry, resolveActionHandler } from "@/app/hooks/useAction";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useRepository, useRepositoryRefreshAction } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { ConsoleProvider } from "@/app/providers/ConsoleProvider";
import type { ConsoleContextValue } from "@/app/providers/ConsoleProvider.types";
import { RepositoryProvider } from "@/app/providers/RepositoryProvider";
import type { RepositoryContextValue } from "@/app/providers/RepositoryProvider.types";
import { StatusProvider } from "@/app/providers/StatusProvider";
import type { StatusContextValue } from "@/app/providers/StatusProvider.types";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

/** Latest repository context captured by the probe. */
let latestRepository: RepositoryContextValue | undefined;

/** Latest status context captured by the probe. */
let latestStatus: StatusContextValue | undefined;

/** Latest console context captured by the probe. */
let latestConsole: ConsoleContextValue | undefined;

/** Captures the repository, status, and console contexts. */
function RepositoryProbe(): ReactNode {
  latestRepository = useRepository();
  latestStatus = useStatus();
  latestConsole = useConsoleLog();
  useRepositoryRefreshAction();

  return <text id="repository-probe">{latestRepository.state.primary}</text>;
}

/**
 * Renders the repository provider with its observable surfaces.
 *
 * @param client - Fake git client.
 * @returns The renderer setup.
 */
async function renderRepository(
  client: GitClient,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestRepository = undefined;
  latestStatus = undefined;
  latestConsole = undefined;

  return testRender(
    <ConfigProvider>
      <RepositoryProvider cwd="/repo" gitClient={client} enableWatcher={false} now={() => 5_000}>
        <StatusProvider>
          <ConsoleProvider>
            <RepositoryProbe />
          </ConsoleProvider>
        </StatusProvider>
      </RepositoryProvider>
    </ConfigProvider>,
    { width: 100, height: 20 },
  );
}

/**
 * Waits for one predicate while rendering.
 *
 * @param setup - Renderer setup.
 * @param predicate - Condition to reach.
 */
async function waitFor(
  setup: Awaited<ReturnType<typeof testRender>>,
  predicate: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("condition was not met in time");
    }

    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

/**
 * Wraps a fake client and overrides selected arguments.
 *
 * @param base - Base fake client.
 * @param override - Returns a result for a key, or null to delegate.
 * @returns The wrapped client.
 */
function wrapClient(
  base: GitClient,
  override: (
    key: string,
    options: Parameters<GitClient["invoke"]>[0],
  ) => GitInvocationResult | null,
): GitClient {
  return {
    gitPath: base.gitPath,
    invoke: async (options) => {
      const overridden = override(options.args.join(" "), options);

      return overridden ?? (await base.invoke(options));
    },
  };
}

beforeEach(() => {
  resetActionRegistry();
});

describe("repository read outcomes", () => {
  it("applies a successful first read", async () => {
    const fake = createFakeGitClient();
    const setup = await renderRepository(fake.client);

    await waitFor(setup, () => latestRepository?.state.primary === "normal");

    expect(latestRepository?.snapshot?.branch).toBe("main");
    expect(latestRepository?.lastRefreshError).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the previous snapshot when the inside probe is cancelled", async () => {
    const fake = createFakeGitClient();
    let cancelProbe = false;
    const client = wrapClient(fake.client, (key) =>
      cancelProbe && key === "rev-parse --is-inside-work-tree"
        ? { ...fakeGitResult("", false), cancelled: true, exitCode: null }
        : null,
    );
    const setup = await renderRepository(client);

    await waitFor(setup, () => latestRepository?.state.primary === "normal");
    cancelProbe = true;

    let outcome: Awaited<ReturnType<RepositoryContextValue["refreshStatus"]>> | undefined;

    await act(async () => {
      outcome = await latestRepository?.refreshStatus();
    });

    expect(outcome?.ok).toBe(false);
    expect(latestRepository?.state.primary).toBe("normal");
    expect(latestRepository?.snapshot?.branch).toBe("main");
    expect(latestRepository?.lastRefreshError).toBe("cancelled");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the previous snapshot when the status read times out", async () => {
    const fake = createFakeGitClient();
    const setup = await renderRepository(fake.client);

    await waitFor(setup, () => latestRepository?.state.primary === "normal");
    fake.setStatusResult({
      ...fakeGitResult("", false),
      exitCode: null,
      timedOut: true,
      timedOutAfterMs: 10_000,
    });

    await act(async () => {
      await latestRepository?.refreshStatus();
    });

    expect(latestRepository?.state.primary).toBe("normal");
    expect(latestRepository?.snapshot?.branch).toBe("main");
    expect(latestRepository?.lastRefreshError).toBe("timed out after 10 seconds");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("never reports a non-environment probe failure as not-a-repository or empty", async () => {
    const fake = createFakeGitClient();
    const failure = fakeGitResult("", false, "fatal: detected dubious ownership in repository");
    const client = wrapClient(fake.client, (key) =>
      key === "rev-parse --is-inside-work-tree" ||
      key === "rev-parse --is-bare-repository --absolute-git-dir"
        ? failure
        : null,
    );
    const setup = await renderRepository(client);

    await waitFor(setup, () => latestRepository?.lastRefreshError !== null);

    expect(latestRepository?.state.primary).not.toBe("not-a-repository");
    expect(latestRepository?.state.primary).not.toBe("empty");
    expect(latestRepository?.state.primary).toBe("loading");
    expect(latestRepository?.lastRefreshError).toContain("dubious ownership");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("redacts read-refresh errors before the console, status, and lastRefreshError", async () => {
    const fake = createFakeGitClient();
    const setup = await renderRepository(fake.client);

    await waitFor(setup, () => latestRepository?.state.primary === "normal");
    fake.setStatusResult(
      fakeGitResult(
        "",
        false,
        "fatal: unable to access 'https://user:secret@example.com/repo.git/': 403",
      ),
    );

    await act(async () => {
      resolveActionHandler("app.refresh", "global")?.();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const surfaces = JSON.stringify({
      error: latestRepository?.lastRefreshError,
      status: latestStatus?.status,
      console: latestConsole?.entries,
    });

    expect(surfaces).not.toContain("secret");
    expect(surfaces).toContain("[redacted]");

    await act(async () => {
      await setup.dispose();
    });
  });
});
