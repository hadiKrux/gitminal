import { describe, expect, it } from "bun:test";
import { MarkdownRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { DEFAULT_CONFIG } from "@/domain/config/config.defaults";
import { HelpConfiguration } from "@/features/help/HelpConfiguration";
import {
  HELP_FILE_NOT_PRESENT,
  HELP_MAX_WARNINGS,
  HELP_RELOAD_NOTE,
  HELP_RELOAD_NOTE_ID,
} from "@/features/help/HelpConfiguration.constants";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient } from "@/test/git.fake";

/** Configuration snapshot shape derived from the shared provider harness. */
type Snapshot = NonNullable<Parameters<typeof AppTestProviders>[0]["configSnapshot"]>;

/** Width the configuration block is rendered at. */
const WIDTH = 120;

/** Warnings used to prove the display cap and the marker. */
const WARNINGS: readonly string[] = [
  'Unknown field "theme.extra" was ignored.',
  'Invalid value for "graph.initialPageSize"; the previous value was kept.',
  'Unknown action ID "graph.select" in keybindings.json was ignored.',
  "Conflicting key Ctrl+P in context global for app.palette and stash.pop.",
  "Action app.help has no binding.",
  "Action app.palette has no binding.",
  "Unreadable theme.json: Unexpected token.",
];

/** Configuration snapshot with two resolved paths and one absent file. */
const SNAPSHOT: Snapshot = {
  status: "applied",
  config: DEFAULT_CONFIG,
  paths: {
    config: "/home/developer/.config/gitminal/config.json",
    keybindings: "/home/developer/.config/gitminal/keybindings.json",
    theme: null,
  },
  files: [
    {
      key: "config",
      status: "loaded",
      value: {},
      path: "/home/developer/.config/gitminal/config.json",
    },
    {
      key: "keybindings",
      status: "missing",
      value: null,
      path: "/home/developer/.config/gitminal/keybindings.json",
    },
  ],
  warnings: [...WARNINGS],
  keybindingsFile: {},
  themeOverrides: null,
};

/**
 * Renders the Configuration section in a bounded column.
 *
 * @returns The configuration harness.
 */
function ConfigurationHarness(): ReactNode {
  return (
    <box flexDirection="column" width={WIDTH} height={30}>
      <HelpConfiguration />
    </box>
  );
}

/**
 * Renders the section and returns the setup plus its captured frame.
 *
 * @param options - Snapshot and static theme name overrides.
 * @returns The renderer setup and the captured frame text.
 */
async function renderConfiguration(
  options: { readonly snapshot?: Snapshot; readonly themeName?: string } = {},
): Promise<{
  readonly setup: Awaited<ReturnType<typeof testRender>>;
  readonly frame: string;
}> {
  const setup = await testRender(
    <AppTestProviders
      gitClient={createFakeGitClient().client}
      configSnapshot={options.snapshot ?? SNAPSHOT}
      themeName={options.themeName ?? "catppuccin-latte"}
    >
      <ConfigurationHarness />
    </AppTestProviders>,
    { width: WIDTH, height: 30 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return { setup, frame: setup.captureCharFrame() };
}

describe("HelpConfiguration", () => {
  it("renders the resolved paths, the load status, and the active theme", async () => {
    const { setup, frame } = await renderConfiguration();

    expect(frame).toContain("/home/developer/.config/gitminal/config.json");
    expect(frame).toContain("/home/developer/.config/gitminal/keybindings.json");
    expect(frame).toContain(HELP_FILE_NOT_PRESENT);
    expect(frame).toContain("config.json: loaded");
    expect(frame).toContain("keybindings.json: missing");
    expect(frame).toContain("Catppuccin Latte (catppuccin-latte)");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders bounded warnings with the marker", async () => {
    const { setup, frame } = await renderConfiguration();
    const omitted = WARNINGS.length - HELP_MAX_WARNINGS;

    expect(frame).toContain("[!] Unknown field");
    expect(frame).toContain("[!] Action app.help has no binding.");
    expect(frame).toContain(`and ${omitted} more; see the console`);
    expect(frame).not.toContain("Unreadable theme.json");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("counts omitted warnings from the bounded combined list the console holds", async () => {
    const warnings = Array.from({ length: 15 }, (_, index) => `warning ${index}`);
    const { setup, frame } = await renderConfiguration({
      snapshot: { ...SNAPSHOT, warnings },
    });

    expect(frame).toContain("and 7 more; see the console");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders theme resolution warnings with the prefix and the marker", async () => {
    const { setup, frame } = await renderConfiguration({
      snapshot: { ...SNAPSHOT, warnings: [] },
      themeName: "not-a-theme",
    });

    expect(frame).toContain("[!] Theme: Unknown theme");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("counts theme warnings in the bounded warning count", async () => {
    const { setup, frame } = await renderConfiguration({ themeName: "not-a-theme" });
    const omitted = WARNINGS.length + 1 - HELP_MAX_WARNINGS;

    expect(frame).toContain(`and ${omitted} more; see the console`);
    expect(frame).not.toContain("Theme: Unknown theme");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders the reload note and the input-mode notes", async () => {
    const { setup, frame } = await renderConfiguration();
    const note = setup.renderer.root.findDescendantById(HELP_RELOAD_NOTE_ID);

    expect(note).toBeInstanceOf(MarkdownRenderable);

    if (!(note instanceof MarkdownRenderable)) {
      throw new Error("The reload note did not render as a markdown block.");
    }

    expect(note.content).toBe(HELP_RELOAD_NOTE);
    expect(frame).toContain("field: printable and editing keys");
    expect(frame).toContain("search: arrows, paging, and Enter");
    expect(frame).toContain("form.submit (Ctrl+Enter)");
    expect(frame).toContain("inside a multiline field");

    await act(async () => {
      await setup.dispose();
    });
  });
});
