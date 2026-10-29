import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import {
  getActionRegistryVersion,
  hasRegisteredAction,
  registerAction,
  resetActionRegistry,
} from "@/app/hooks/useAction";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import { useOverlay } from "@/app/hooks/useOverlay";
import { usePanelCommands } from "@/app/hooks/usePanelCommands";
import { useRepository } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { buildListLocalTagsArgs } from "@/domain/git/git.tags";
import type { GitClient } from "@/domain/git/git.types";
import type { RepositorySelection } from "@/domain/repository/repository.types";
import { TagsPanel } from "@/features/tags/TagsPanel";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

/** Upward arrow the unpushed scope indicator shows; written as a code point to keep this file ASCII. */
const UP_ARROW = String.fromCodePoint(0x2191);

/** Rendered scope indicator for a tag that no remote has and every remote check confirmed. */
const UNPUSHED_SCOPE = `[L${UP_ARROW}]`;

/** Rendered scope indicator for a local tag whose remote state could not be read. */
const UNKNOWN_SCOPE = "[L?]";

/** Rendered scope indicator for a tag that is both local and on a remote. */
const BOTH_SCOPE = "[LR]";

/** Latest overlay context captured by the probe. */
let latestOverlay: ReturnType<typeof useOverlay> | undefined;

/** Latest status context captured by the probe. */
let latestStatus: ReturnType<typeof useStatus> | undefined;

/** Latest right-pane selection captured by the probe. */
let latestSelection: RepositorySelection | undefined;

/**
 * Renders the tags panel body inside a focusable tags region frame.
 *
 * @returns The panel frame.
 */
function PanelHarness(): ReactNode {
  const region = useFocusRegion("tags");
  const repository = useRepository();

  latestOverlay = useOverlay();
  latestStatus = useStatus();
  latestSelection = repository.selection;
  useHotkeys();
  usePanelCommands();

  return (
    <box {...region.regionProps} flexDirection="column" width={60} height={20}>
      <TagsPanel />
    </box>
  );
}

/**
 * Builds a fake client with recorded local tags and remote tag output.
 *
 * @param options - Local tag output, remote tag output, its success, and the remote list output.
 * @returns The git client.
 */
function createClient(
  options: {
    readonly tags?: string;
    readonly remoteTags?: string;
    readonly remoteTagsOk?: boolean;
    readonly remotes?: string;
    readonly pushedTag?: string;
    readonly remoteTagsAfterPush?: string;
  } = {},
): GitClient {
  const base = createFakeGitClient().client;
  const remotes =
    options.remotes ??
    "origin\tgit@example.com:repo.git (fetch)\norigin\tgit@example.com:repo.git (push)\n";
  let remoteTags = options.remoteTags ?? "";

  return {
    ...base,
    invoke: async (input) => {
      const key = input.args.join(" ");

      if (key === buildListLocalTagsArgs().join(" ")) {
        return fakeGitResult(options.tags ?? "");
      }

      if (key === "remote -v") {
        return fakeGitResult(remotes);
      }

      if (options.pushedTag !== undefined && key.includes(`refs/tags/${options.pushedTag}`)) {
        remoteTags = options.remoteTagsAfterPush ?? remoteTags;

        return fakeGitResult("");
      }

      if (key.startsWith("ls-remote --tags -- ")) {
        const ok = options.remoteTagsOk !== false;

        return fakeGitResult(remoteTags, ok, ok ? "" : "fatal: could not read from remote");
      }

      return await base.invoke(input);
    },
  };
}

/**
 * Builds one NUL-separated lightweight tag record.
 *
 * @param name - Tag name.
 * @param oid - Target commit id.
 * @param subject - Commit subject.
 * @returns The recorded line.
 */
function lightweightTag(name: string, oid: string, subject: string): string {
  return `${name}\0commit\0\0${oid}\0\0${subject}`;
}

/**
 * Renders the panel with the full provider stack.
 *
 * @param gitClient - Injected client.
 * @returns The renderer setup.
 */
async function renderPanel(gitClient: GitClient): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestOverlay = undefined;
  latestStatus = undefined;
  latestSelection = undefined;

  const setup = await testRender(
    <AppTestProviders gitClient={gitClient}>
      <PanelHarness />
    </AppTestProviders>,
    { width: 100, height: 30, kittyKeyboard: true },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

/**
 * Renders until a predicate holds, or the deadline passes.
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

  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Focuses the tags region frame.
 *
 * @param setup - Renderer setup.
 */
async function focusTags(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    setup.renderer.root.findDescendantById("region-tags")?.focus();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Presses one printable key and renders once.
 *
 * @param setup - Renderer setup.
 * @param key - Key to press.
 */
async function pressKey(setup: Awaited<ReturnType<typeof testRender>>, key: string): Promise<void> {
  await act(async () => {
    setup.mockInput.pressKey(key);
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Presses Enter and renders once.
 *
 * @param setup - Renderer setup.
 */
async function pressEnter(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    setup.mockInput.pressEnter();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

beforeEach(() => {
  resetActionRegistry();
});

describe("TagsPanel", () => {
  it("registers exactly the tag actions plus cursor navigation, and no global action", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const versionBefore = getActionRegistryVersion();
    const setup = await renderPanel(
      createClient({ tags: lightweightTag("v1.0.0", "abc123", "subject") }),
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("v1.0.0"));

    const expected = [
      "nav.up",
      "nav.down",
      "nav.activate",
      "tag.create",
      "tag.delete",
      "tag.push",
      "list.filter",
    ];

    for (const actionId of expected) {
      expect(hasRegisteredAction(actionId, "tags"), actionId).toBe(true);
    }

    expect(hasRegisteredAction("nav.first", "tags")).toBe(false);
    expect(hasRegisteredAction("nav.last", "tags")).toBe(false);
    expect(hasRegisteredAction("app.refresh", "tags")).toBe(false);
    expect(hasRegisteredAction("app.refresh", "global")).toBe(false);
    expect(hasRegisteredAction("remote.push", "tags")).toBe(false);
    expect(getActionRegistryVersion() - versionBefore).toBe(expected.length);
    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders rows in version-descending order", async () => {
    const setup = await renderPanel(
      createClient({
        tags: [
          lightweightTag("v1.2.9", "aaa", "older"),
          lightweightTag("v1.2.10", "bbb", "newer"),
        ].join("\n"),
      }),
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("v1.2.9"));

    const frame = setup.captureCharFrame();

    expect(frame.indexOf("v1.2.10")).toBeLessThan(frame.indexOf("v1.2.9"));

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the unknown scope indicator rather than unpushed before a remote check succeeds", async () => {
    const setup = await renderPanel(
      createClient({ tags: lightweightTag("v1.0.0", "abc123", "subject") }),
    );

    await waitFor(setup, () => setup.captureCharFrame().includes(UNKNOWN_SCOPE));

    const frame = setup.captureCharFrame();

    expect(frame).toContain(UNKNOWN_SCOPE);
    expect(frame).not.toContain(UNPUSHED_SCOPE);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("selects the tagged commit in the graph on Enter", async () => {
    const setup = await renderPanel(
      createClient({ tags: lightweightTag("v1.0.0", "abc1234567890", "subject") }),
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("v1.0.0"));
    await focusTags(setup);
    await pressEnter(setup);

    expect(latestSelection).toEqual({ kind: "commit", oid: "abc1234567890" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("confirms a push for an unpushed local tag with known remote state", async () => {
    const setup = await renderPanel(
      createClient({ tags: lightweightTag("v1.0.0", "abc123", "subject"), remoteTags: "" }),
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("v1.0.0"));
    await focusTags(setup);
    await waitFor(setup, () => setup.captureCharFrame().includes(UNPUSHED_SCOPE));
    await pressKey(setup, "P");

    expect(latestOverlay?.entry?.kind).toBe("confirm");

    const entry = latestOverlay?.entry?.kind === "confirm" ? latestOverlay.entry : null;

    expect(entry?.title).toBe("Push tag");
    expect(entry?.confirmLabel).toBe("Push tag");
    expect(entry?.description).toContain("v1.0.0");
    expect(entry?.description).toContain("origin");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("blocks a push with the unknown-state reason instead of confirming", async () => {
    const setup = await renderPanel(
      createClient({
        tags: lightweightTag("v1.0.0", "abc123", "subject"),
        remoteTagsOk: false,
      }),
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("v1.0.0"));
    await focusTags(setup);
    await waitFor(setup, () => setup.captureCharFrame().includes(UNKNOWN_SCOPE));
    await pressKey(setup, "P");

    expect(latestOverlay?.entry).toBeNull();
    expect(latestStatus?.status?.message).toBe("remote tag state unknown; refresh to retry");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the empty state with the create hint when there are no tags", async () => {
    const setup = await renderPanel(createClient());

    await waitFor(setup, () => setup.captureCharFrame().includes("No tags"));

    const frame = setup.captureCharFrame();

    expect(frame).toContain("No tags");
    expect(frame).toContain("n New tag");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the read error with a Retry action and keeps the panel usable", async () => {
    const failingClient = createClient({
      tags: lightweightTag("v1.0.0", "abc123", "subject"),
    });
    const client: GitClient = {
      ...failingClient,
      invoke: async (input) => {
        if (input.args.join(" ") === buildListLocalTagsArgs().join(" ")) {
          return fakeGitResult("", false, "fatal: cannot read refs");
        }

        return await failingClient.invoke(input);
      },
    };
    const setup = await renderPanel(client);

    await waitFor(setup, () => setup.captureCharFrame().includes("Could not read tags"));

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Could not read tags");
    expect(frame).toContain("Retry");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("routes P to tag.push instead of the global remote.push", async () => {
    let remotePushCalls = 0;
    const cleanup = registerAction("remote.push", { scope: "global", owner: "top-bar" }, () => {
      remotePushCalls += 1;
    });
    const setup = await renderPanel(
      createClient({ tags: lightweightTag("v1.0.0", "abc123", "subject"), remoteTags: "" }),
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("v1.0.0"));
    await focusTags(setup);
    await waitFor(setup, () => setup.captureCharFrame().includes(UNPUSHED_SCOPE));
    await pressKey(setup, "P");

    expect(remotePushCalls).toBe(0);
    expect(latestOverlay?.entry?.kind).toBe("confirm");

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("clears the unpushed scope indicator after a successful push refreshes remote knowledge", async () => {
    const setup = await renderPanel(
      createClient({
        tags: lightweightTag("v1.0.0", "abc123", "subject"),
        remoteTags: "",
        pushedTag: "v1.0.0",
        remoteTagsAfterPush: "abc123\trefs/tags/v1.0.0\n",
      }),
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("v1.0.0"));
    await focusTags(setup);
    await waitFor(setup, () => setup.captureCharFrame().includes(UNPUSHED_SCOPE));
    await pressKey(setup, "P");

    const entry = latestOverlay?.entry;

    expect(entry?.kind).toBe("confirm");

    await act(async () => {
      if (entry?.kind === "confirm") {
        entry.onConfirm();
      }
    });
    await waitFor(
      setup,
      () =>
        !setup.captureCharFrame().includes(UNPUSHED_SCOPE) &&
        setup.captureCharFrame().includes(BOTH_SCOPE),
    );

    const frame = setup.captureCharFrame();

    expect(frame).not.toContain(UNPUSHED_SCOPE);
    expect(frame).toContain(BOTH_SCOPE);

    await act(async () => {
      await setup.dispose();
    });
  });
});
