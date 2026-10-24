import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useEffect } from "react";
import { resetActionRegistry, useAction } from "@/app/hooks/useAction";
import type { ActionRegistrationOptions } from "@/app/hooks/useAction.types";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useStatus } from "@/app/hooks/useStatus";
import type { GitClient } from "@/domain/git/git.types";
import { Footer } from "@/features/shell/Footer";
import type { RegionId } from "@/features/shell/focus.types";
import { AppTestProviders } from "@/test/app.harness";
import { fakeGitResult } from "@/test/git.fake";
import { ShellTestProviders } from "@/test/shell.harness";

/**
 * Registers one action handler without rendering visible content.
 *
 * @param props - Action id and options.
 * @returns The marker element.
 */
function Registration(props: { actionId: string; options: ActionRegistrationOptions }): ReactNode {
  useAction(props.actionId, props.options, () => {});

  return <text> </text>;
}

/**
 * Switches the footer to modal hint mode after mount.
 *
 * @returns The marker element.
 */
function ModalModeProbe(): ReactNode {
  const { setHintMode } = useStatus();

  useEffect(() => {
    setHintMode("modal");
  }, [setHintMode]);

  return <text> </text>;
}

/** Starts an operation from a test. */
let startOperation: () => void = () => {};

/**
 * Captures the status operation starter.
 *
 * @returns The marker element.
 */
function OperationModeProbe(): ReactNode {
  const { beginOperation } = useStatus();

  startOperation = (): void => {
    beginOperation("Fetch");
  };

  return <text> </text>;
}

/**
 * Renders one focusable region frame above the footer.
 *
 * @param props - Region id and optional registrations.
 * @returns The harness layout.
 */
function FooterHarness(props: { region: RegionId; children?: ReactNode }): ReactNode {
  const region = useFocusRegion(props.region);

  return (
    <box flexDirection="column" flexGrow={1}>
      {props.children}
      <box {...region.regionProps} width={40} height={2}>
        <text>{props.region}</text>
      </box>
      <box id="footer-outside" focusable width={40} height={1}>
        <text>outside</text>
      </box>
      <Footer />
    </box>
  );
}

/**
 * Renders the footer harness inside the required providers.
 *
 * @param layout - Harness content.
 * @param width - Terminal width.
 * @returns The renderer setup.
 */
async function renderFooter(
  layout: ReactNode,
  width: number = 120,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  return testRender(<ShellTestProviders>{layout}</ShellTestProviders>, {
    width,
    height: 20,
  });
}

/**
 * Focuses the region frame in the harness.
 *
 * @param setup - Renderer setup.
 * @param region - Region id.
 */
async function focusRegion(
  setup: Awaited<ReturnType<typeof testRender>>,
  region: RegionId,
): Promise<void> {
  await act(async () => {
    setup.renderer.root.findDescendantById(`region-${region}`)?.focus();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Focuses a renderable outside every region.
 *
 * @param setup - Renderer setup.
 */
async function focusOutside(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    setup.renderer.root.findDescendantById("footer-outside")?.focus();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Builds a fake client for one repository state.
 *
 * @param state - Detached or no-remote fixture.
 * @returns The client and a status read counter.
 */
function createStateClient(state: "normal" | "detached" | "no-remote"): {
  client: GitClient;
  statusReads: () => number;
} {
  let statusReads = 0;
  const answers: Readonly<Record<string, () => ReturnType<typeof fakeGitResult>>> = {
    "rev-parse --is-inside-work-tree": () => fakeGitResult("true\n"),
    "rev-parse --is-bare-repository --absolute-git-dir": () => fakeGitResult("false\n/repo/.git\n"),
    "rev-parse --show-toplevel": () => fakeGitResult("/repo\n"),
    "rev-parse --verify HEAD": () => fakeGitResult("abc123\n"),
    "symbolic-ref -q --short HEAD": () =>
      state === "detached"
        ? fakeGitResult("", false, "fatal: ref HEAD is not a symbolic ref")
        : fakeGitResult("main\n"),
    "rev-parse --short HEAD": () => fakeGitResult("abc1234\n"),
    "rev-parse --verify --quiet MERGE_HEAD": () => fakeGitResult("", false),
    "rev-parse --verify --quiet REBASE_HEAD": () => fakeGitResult("", false),
    "rev-parse --verify --quiet CHERRY_PICK_HEAD": () => fakeGitResult("", false),
    "remote -v": () =>
      state === "no-remote"
        ? fakeGitResult("")
        : fakeGitResult("origin\tgit@example.com:repo.git (fetch)\n"),
    "config user.name": () => fakeGitResult("Test User\n"),
    "config user.email": () => fakeGitResult("test@example.com\n"),
    "for-each-ref --format=%(upstream:remotename)%09%(upstream:remoteref) refs/heads/main": () =>
      state === "no-remote" ? fakeGitResult("") : fakeGitResult("origin\trefs/heads/main\n"),
    "for-each-ref --format=%(upstream:short) refs/heads": () =>
      state === "no-remote" ? fakeGitResult("") : fakeGitResult("origin/main\n"),
    "rev-parse --verify --quiet refs/remotes/origin/main": () => fakeGitResult("abc123\n"),
  };

  return {
    statusReads: () => statusReads,
    client: {
      gitPath: "git",
      invoke: async (options) => {
        const key = options.args.join(" ");

        if (key === "status --porcelain=v2 --branch -z --untracked-files=all") {
          statusReads += 1;

          return fakeGitResult(
            state === "detached"
              ? "# branch.oid abc123\0# branch.head (detached)\0"
              : "# branch.oid abc123\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +0 -0\0",
          );
        }

        const answer = answers[key];

        return answer === undefined ? fakeGitResult("", false) : answer();
      },
    },
  };
}

/**
 * Renders the footer with a real repository provider for one state.
 *
 * @param state - Detached or no-remote fixture.
 * @returns The renderer setup.
 */
async function renderFooterWithRepository(
  state: "normal" | "detached" | "no-remote",
  children?: ReactNode,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  const fake = createStateClient(state);
  const setup = await testRender(
    <AppTestProviders gitClient={fake.client}>
      <FooterHarness region="branches">
        {children}
        <Registration actionId="remote.pull" options={{ scope: "global", owner: "top-bar" }} />
        <Registration actionId="remote.push" options={{ scope: "global", owner: "top-bar" }} />
        <Registration actionId="remote.fetch" options={{ scope: "global", owner: "top-bar" }} />
        <Registration actionId="app.help" options={{ scope: "global", owner: "app" }} />
      </FooterHarness>
    </AppTestProviders>,
    { width: 120, height: 20 },
  );
  const deadline = Date.now() + 2_000;

  while (fake.statusReads() === 0 && Date.now() < deadline) {
    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

beforeEach(() => {
  resetActionRegistry();
});

describe("Footer", () => {
  it("shows hints for the focused region and the global actions", async () => {
    const setup = await renderFooter(
      <FooterHarness region="branches">
        <Registration actionId="branch.create" options={{ scope: "branches" }} />
        <Registration actionId="app.quit" options={{ scope: "global", owner: "app" }} />
        <Registration actionId="app.help" options={{ scope: "global", owner: "app" }} />
      </FooterHarness>,
    );

    await act(async () => {
      await setup.renderOnce();
    });
    await focusRegion(setup, "branches");

    const frame = setup.captureCharFrame();

    expect(frame).toContain("n New branch");
    expect(frame).toContain("q Quit");
    expect(frame).toContain("? Help");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("falls back to global hints when focus leaves every region", async () => {
    const setup = await renderFooter(
      <FooterHarness region="branches">
        <Registration actionId="branch.create" options={{ scope: "branches" }} />
        <Registration actionId="app.help" options={{ scope: "global", owner: "app" }} />
      </FooterHarness>,
    );

    await act(async () => {
      await setup.renderOnce();
    });
    await focusRegion(setup, "branches");

    expect(setup.captureCharFrame()).toContain("n New branch");

    await focusOutside(setup);

    const frame = setup.captureCharFrame();

    expect(frame).toContain("? Help");
    expect(frame).not.toContain("New branch");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("hides a global hint when the focused context owns the same key", async () => {
    const setup = await renderFooter(
      <FooterHarness region="stashes">
        <Registration actionId="stash.pop" options={{ scope: "stashes" }} />
        <Registration actionId="remote.pull" options={{ scope: "global", owner: "top-bar" }} />
      </FooterHarness>,
    );

    await act(async () => {
      await setup.renderOnce();
    });
    await focusRegion(setup, "stashes");

    const frame = setup.captureCharFrame();

    expect(frame).toContain("p Pop stash");
    expect(frame).not.toContain("Pull");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("drops hints in priority order as the width shrinks", async () => {
    const layout = (
      <FooterHarness region="graph">
        <Registration actionId="app.help" options={{ scope: "global", owner: "app" }} />
        <Registration actionId="app.quit" options={{ scope: "global", owner: "app" }} />
        <Registration actionId="app.console" options={{ scope: "global", owner: "app" }} />
        <Registration actionId="focus.next" options={{ scope: "global", owner: "shell" }} />
        <Registration actionId="focus.previous" options={{ scope: "global", owner: "shell" }} />
      </FooterHarness>
    );
    const wide = await renderFooter(layout, 80);

    await act(async () => {
      await wide.renderOnce();
    });

    const wideFrame = wide.captureCharFrame();

    expect(wideFrame).toContain("? Help");
    expect(wideFrame).toContain("q Quit");
    expect(wideFrame).toContain("Toggle console");

    await act(async () => {
      await wide.dispose();
    });

    resetActionRegistry();

    const narrow = await renderFooter(layout, 12);

    await act(async () => {
      await narrow.renderOnce();
    });

    const narrowFrame = narrow.captureCharFrame();

    expect(narrowFrame).toContain("? Help");
    expect(narrowFrame).not.toContain("Quit");

    await act(async () => {
      await narrow.dispose();
    });
  });

  it("never emits direct region jump hints", async () => {
    const setup = await renderFooter(
      <FooterHarness region="branches">
        <Registration actionId="focus.region.graph" options={{ scope: "global", owner: "shell" }} />
        <Registration actionId="app.help" options={{ scope: "global", owner: "app" }} />
      </FooterHarness>,
    );

    await act(async () => {
      await setup.renderOnce();
    });
    await focusRegion(setup, "branches");

    const frame = setup.captureCharFrame();

    expect(frame).toContain("? Help");
    expect(frame).not.toContain("Focus commit graph");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("replaces region hints with modal keys when an overlay is open", async () => {
    const setup = await renderFooter(
      <FooterHarness region="branches">
        <ModalModeProbe />
        <Registration actionId="nav.activate" options={{ scope: "overlay" }} />
        <Registration actionId="nav.up" options={{ scope: "overlay" }} />
        <Registration actionId="nav.down" options={{ scope: "overlay" }} />
        <Registration actionId="overlay.close" options={{ scope: "global", owner: "app" }} />
        <Registration actionId="branch.create" options={{ scope: "branches" }} />
      </FooterHarness>,
    );

    await act(async () => {
      await setup.renderOnce();
    });
    await focusRegion(setup, "branches");

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Enter Activate");
    expect(frame).toContain("Esc Close or cancel");
    expect(frame).toContain("Up");
    expect(frame).toContain("Down");
    expect(frame).not.toContain("Left");
    expect(frame).not.toContain("Right");
    expect(frame).not.toContain("Next region");
    expect(frame).not.toContain("New branch");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("advertises Left and Right for a confirmation that registers them", async () => {
    const setup = await renderFooter(
      <FooterHarness region="branches">
        <ModalModeProbe />
        <Registration actionId="nav.activate" options={{ scope: "overlay" }} />
        <Registration actionId="nav.left" options={{ scope: "overlay" }} />
        <Registration actionId="nav.right" options={{ scope: "overlay" }} />
        <Registration actionId="overlay.close" options={{ scope: "global", owner: "app" }} />
      </FooterHarness>,
    );

    await act(async () => {
      await setup.renderOnce();
    });
    await focusRegion(setup, "branches");

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Left");
    expect(frame).toContain("Right");
    expect(frame).toContain("Enter Activate");
    expect(frame).toContain("Esc Close or cancel");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("filters remote hints while a mutation is running", async () => {
    startOperation = () => {};
    const setup = await renderFooterWithRepository("normal", <OperationModeProbe />);

    await focusRegion(setup, "branches");

    expect(setup.captureCharFrame()).toContain("Pull");

    await act(async () => {
      startOperation();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).not.toContain("Pull");
    expect(frame).not.toContain("Push");
    expect(frame).toContain("? Help");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("filters remote hints by availability in a detached HEAD state", async () => {
    const setup = await renderFooterWithRepository("detached");

    await focusRegion(setup, "branches");

    const frame = setup.captureCharFrame();

    expect(frame).toContain("? Help");
    expect(frame).not.toContain("Pull");
    expect(frame).not.toContain("Push");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("filters remote hints by availability with no configured remote", async () => {
    const setup = await renderFooterWithRepository("no-remote");

    await focusRegion(setup, "branches");

    const frame = setup.captureCharFrame();

    expect(frame).toContain("? Help");
    expect(frame).not.toContain("Pull");
    expect(frame).not.toContain("Push");
    expect(frame).not.toContain("Fetch");

    await act(async () => {
      await setup.dispose();
    });
  });
});
