import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { AppShellHost } from "@/app/AppShellHost";
import { resetActionRegistry } from "@/app/hooks/useAction";
import { useStatus } from "@/app/hooks/useStatus";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { ConsoleProvider } from "@/app/providers/ConsoleProvider";
import { FocusProvider } from "@/app/providers/FocusProvider";
import { KeymapProvider } from "@/app/providers/KeymapProvider";
import { RepositoryProvider } from "@/app/providers/RepositoryProvider";
import { StatusProvider } from "@/app/providers/StatusProvider";
import type { StatusContextValue } from "@/app/providers/StatusProvider.types";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import { resetCommandRunner } from "@/domain/commands/commands.runner";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

/** Latest status context captured by the probe. */
let latestStatus: StatusContextValue | undefined;

/** Captures the status context. */
function StatusProbe(): ReactNode {
  latestStatus = useStatus();

  return <text id="status-probe">{latestStatus.status?.message ?? "idle"}</text>;
}

/**
 * Renders the composition root with the production provider nesting.
 *
 * @param client - Fake git client.
 * @returns The renderer setup.
 */
async function renderHost(client: GitClient): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestStatus = undefined;

  return testRender(
    <ConfigProvider>
      <ThemeProvider>
        <KeymapProvider platform="linux">
          <RepositoryProvider cwd="/repo" gitClient={client} enableWatcher={false} now={() => 0}>
            <FocusProvider>
              <StatusProvider>
                <ConsoleProvider>
                  <box flexDirection="column" flexGrow={1} width={120} height={40}>
                    <AppShellHost />
                    <StatusProbe />
                  </box>
                </ConsoleProvider>
              </StatusProvider>
            </FocusProvider>
          </RepositoryProvider>
        </KeymapProvider>
      </ThemeProvider>
    </ConfigProvider>,
    { width: 120, height: 40, exitOnCtrlC: false, kittyKeyboard: true },
  );
}

/**
 * Waits until the initial repository read has settled.
 *
 * @param setup - Renderer setup.
 * @param client - Fake client whose status reads are counted.
 * @param fake - Fake client handle with its counters.
 */
async function waitForInitialRead(
  setup: Awaited<ReturnType<typeof testRender>>,
  fake: ReturnType<typeof createFakeGitClient>,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while ((fake.counts.get("status --porcelain=v2 --branch -z --untracked-files=all") ?? 0) === 0) {
    if (Date.now() > deadline) {
      throw new Error("initial read did not settle");
    }

    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

beforeEach(() => {
  resetActionRegistry();
  resetCommandRunner();
});

describe("AppShellHost quit", () => {
  it("destroys the renderer on idle q", async () => {
    const fake = createFakeGitClient();
    const setup = await renderHost(fake.client);
    const destroy = spyOn(setup.renderer, "destroy").mockImplementation(() => {});

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("q");
      await Promise.resolve();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(destroy).toHaveBeenCalledTimes(1);

    destroy.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("aborts the running command and waits for it to settle before destroying the renderer", async () => {
    const fake = createFakeGitClient();
    const order: string[] = [];
    let releaseFetch: () => void = () => {};
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    let fetchStarted = false;
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options): Promise<GitInvocationResult> => {
        if (options.args[0] !== "fetch") {
          return await fake.client.invoke(options);
        }

        fetchStarted = true;

        return await new Promise<GitInvocationResult>((resolve) => {
          options.signal.addEventListener(
            "abort",
            () => {
              order.push("abort");

              void fetchGate.then(() => {
                resolve({
                  ...fakeGitResult("", false),
                  cancelled: true,
                  exitCode: null,
                });
              });
            },
            { once: true },
          );
        });
      },
    };
    const setup = await renderHost(client);
    const destroy = spyOn(setup.renderer, "destroy").mockImplementation(() => {
      order.push("destroy");
    });

    await waitForInitialRead(setup, fake);

    await act(async () => {
      setup.mockInput.pressKey("f");
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    expect(fetchStarted).toBeTrue();

    await act(async () => {
      setup.mockInput.pressKey("q");
      await Promise.resolve();
    });

    expect(order).toEqual(["abort"]);
    expect(destroy).not.toHaveBeenCalled();
    expect(latestStatus?.status).toBeNull();

    releaseFetch();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await setup.renderOnce();
    });

    expect(order).toEqual(["abort", "destroy"]);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(latestStatus?.status).toEqual({ kind: "warning", message: "cancelled" });

    destroy.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });
});
