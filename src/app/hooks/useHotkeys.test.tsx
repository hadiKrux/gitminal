import { beforeEach, describe, expect, it } from "bun:test";
import { type InputRenderable, parseKeypress, type TextareaRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useEffect } from "react";
import { registerInputMode, resetInputModes } from "@/app/hooks/inputMode.registry";
import { resetActionRegistry, useAction } from "@/app/hooks/useAction";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { resolveHotkeyAction, useHotkeys } from "@/app/hooks/useHotkeys";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { FocusProvider } from "@/app/providers/FocusProvider";
import { KeymapProvider } from "@/app/providers/KeymapProvider";
import { OverlayProvider } from "@/app/providers/OverlayProvider";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import { resolveKeymap } from "@/domain/keymap/keymap.resolve";
import type { KeyEventLike } from "@/domain/keymap/keymap.types";
import { ShellTestProviders } from "@/test/shell.harness";

/**
 * Builds a key-like event for the pure resolver.
 *
 * @param name - Base key name.
 * @param overrides - Modifier or sequence overrides.
 * @returns A complete key-like event.
 */
function key(name: string, overrides: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    name,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: name,
    ...overrides,
  };
}

/** Resolved keymap shared by the pure resolver tests. */
const keymap = resolveKeymap({ platform: "linux" });

/**
 * Resolves one key in a focus context.
 *
 * @param event - Key event.
 * @param context - Focus and overlay state overrides.
 * @returns The resolver result.
 */
function resolve(
  event: KeyEventLike,
  context: {
    activeRegion?: "branches" | "stashes" | "graph" | "right-pane" | null;
    textInputFocused?: boolean;
    inputMode?: "field" | "search" | "form" | null;
    nativeListFocused?: boolean;
    focusInsideRegion?: boolean;
    overlayOpen?: boolean;
    overlayToggleActionId?: string;
  } = {},
): ReturnType<typeof resolveHotkeyAction> {
  return resolveHotkeyAction({
    keymap,
    key: event,
    activeRegion: context.activeRegion ?? null,
    textInputFocused: context.textInputFocused ?? false,
    textInputMode: context.inputMode ?? null,
    nativeListFocused: context.nativeListFocused ?? false,
    focusInsideRegion: context.focusInsideRegion ?? true,
    overlayOpen: context.overlayOpen ?? false,
    overlayToggleActionId: context.overlayToggleActionId,
  });
}

describe("resolveHotkeyAction", () => {
  it.each(["\x00", "\x1b[96;5u"])(
    "routes the console terminal encoding %j with and without an editor",
    (sequence) => {
      const event = parseKeypress(sequence, { useKittyKeyboard: true });

      expect(event).not.toBeNull();

      for (const textInputFocused of [false, true]) {
        expect(
          resolveHotkeyAction({
            keymap: resolveKeymap({ platform: "wsl" }),
            key: event as KeyEventLike,
            activeRegion: "right-pane",
            textInputFocused,
            nativeListFocused: false,
            overlayOpen: false,
          }),
        ).toEqual({ actionId: "app.console", scope: "global" });
      }
    },
  );

  it("keeps plain backtick and space available for typing", () => {
    for (const name of ["`", "space"]) {
      expect(resolve(key(name), { textInputFocused: true })).toBeNull();
      expect(resolve(key(name))).toBeNull();
    }
  });

  it("falls back to global actions and lets region context win", () => {
    expect(resolve(key("p"), { activeRegion: "graph" })).toEqual({
      actionId: "remote.pull",
      scope: "global",
    });
    expect(resolve(key("p"), { activeRegion: "stashes" })).toEqual({
      actionId: "stash.pop",
      scope: "stashes",
    });
  });

  it("resolves the reserved quit chord globally from a region frame", () => {
    expect(resolve(key("c", { ctrl: true }), { activeRegion: "branches" })).toEqual({
      actionId: "app.quit",
      scope: "global",
    });
    expect(resolve(key("c", { ctrl: true }), { overlayOpen: true })).toEqual({
      actionId: "app.quit",
      scope: "global",
    });
  });

  it("resolves direct region jumps from any region frame", () => {
    expect(resolve(key("1"), { activeRegion: "branches" })).toEqual({
      actionId: "focus.region.branches",
      scope: "global",
    });
    expect(resolve(key("6"), { activeRegion: "branches" })).toEqual({
      actionId: "focus.region.graph",
      scope: "global",
    });
  });

  it("keeps only the overlay and its escape hatches while an overlay is open", () => {
    expect(
      resolve(key("p"), { overlayOpen: true, overlayToggleActionId: "app.palette" }),
    ).toBeNull();
    expect(resolve(key("1"), { overlayOpen: true })).toBeNull();
    expect(resolve(key("escape"), { overlayOpen: true })).toEqual({
      actionId: "overlay.close",
      scope: "global",
    });
    expect(resolve(key("q"), { overlayOpen: true })).toEqual({
      actionId: "app.quit",
      scope: "global",
    });
    expect(resolve(key("p", { ctrl: true }), { overlayOpen: true })).toBeNull();
    expect(
      resolve(key("p", { ctrl: true }), {
        overlayOpen: true,
        overlayToggleActionId: "app.palette",
      }),
    ).toEqual({ actionId: "app.palette", scope: "global" });
    expect(resolve(key("`", { ctrl: true }), { overlayOpen: true })).toBeNull();
    expect(resolve(key("t"), { overlayOpen: true })).toBeNull();
    expect(
      resolve(key("p", { ctrl: true }), {
        overlayOpen: true,
        overlayToggleActionId: "app.palette",
      }),
    ).toEqual({ actionId: "app.palette", scope: "global" });
  });

  it("does not let plain global actions fire from a modal text field", () => {
    expect(resolve(key("q"), { overlayOpen: true, textInputFocused: true })).toBeNull();
    expect(resolve(key("r"), { overlayOpen: true, textInputFocused: true })).toBeNull();
    expect(resolve(key("escape"), { overlayOpen: true, textInputFocused: true })).toEqual({
      actionId: "overlay.close",
      scope: "global",
    });
    expect(
      resolve(key("c", { ctrl: true }), { overlayOpen: true, textInputFocused: true }),
    ).toEqual({ actionId: "app.quit", scope: "global" });
    expect(
      resolve(key("p", { ctrl: true }), {
        overlayOpen: true,
        textInputFocused: true,
        overlayToggleActionId: "app.palette",
      }),
    ).toEqual({ actionId: "app.palette", scope: "global" });
  });

  it("ignores a stale region when focus is outside every region", () => {
    expect(resolve(key("n"), { activeRegion: "branches", focusInsideRegion: false })).toBeNull();
    expect(resolve(key("n"), { activeRegion: "branches", focusInsideRegion: true })).toEqual({
      actionId: "branch.create",
      scope: "branches",
    });
    expect(resolve(key("q"), { activeRegion: "branches", focusInsideRegion: false })).toEqual({
      actionId: "app.quit",
      scope: "global",
    });
  });

  it("leaves unmodified typing keys with a focused editor", () => {
    expect(resolve(key("1"), { textInputFocused: true })).toBeNull();
    expect(resolve(key("r"), { textInputFocused: true })).toBeNull();
    expect(resolve(key("."), { textInputFocused: true })).toBeNull();
  });

  it("allows the documented text-input-safe actions with a modifier", () => {
    expect(resolve(key("p", { ctrl: true }), { textInputFocused: true })).toEqual({
      actionId: "app.palette",
      scope: "global",
    });
    expect(
      resolve(key("s", { ctrl: true }), {
        textInputFocused: true,
        activeRegion: "right-pane",
      }),
    ).toEqual({
      actionId: "commit.submit",
      scope: "right-pane",
    });
    expect(
      resolve(key(".", { option: true }), {
        textInputFocused: true,
        activeRegion: "right-pane",
      }),
    ).toEqual({
      actionId: "commit.options",
      scope: "right-pane",
    });
  });

  it("keeps Esc, Tab, and the hardcoded quit reachable while typing", () => {
    expect(resolve(key("escape"), { textInputFocused: true })).toEqual({
      actionId: "overlay.close",
      scope: "global",
    });
    expect(resolve(key("tab"), { textInputFocused: true })).toEqual({
      actionId: "focus.next",
      scope: "global",
    });
    expect(resolve(key("tab", { shift: true }), { textInputFocused: true })).toEqual({
      actionId: "focus.previous",
      scope: "global",
    });
    expect(resolve(key("c", { ctrl: true }), { textInputFocused: true })).toEqual({
      actionId: "app.quit",
      scope: "global",
    });
    expect(resolve(key("q"), { textInputFocused: true })).toBeNull();
  });

  it("delegates navigation and activation to a native list widget", () => {
    expect(resolve(key("enter"), { activeRegion: "branches", nativeListFocused: true })).toBeNull();
    expect(resolve(key("j"), { activeRegion: "branches", nativeListFocused: true })).toBeNull();
    expect(resolve(key("left"), { activeRegion: "branches", nativeListFocused: true })).toBeNull();
    expect(resolve(key("1"), { activeRegion: "branches", nativeListFocused: true })).toEqual({
      actionId: "focus.region.branches",
      scope: "global",
    });
    expect(resolve(key("tab"), { activeRegion: "branches", nativeListFocused: true })).toEqual({
      actionId: "focus.next",
      scope: "global",
    });
    expect(resolve(key("q"), { activeRegion: "branches", nativeListFocused: true })).toEqual({
      actionId: "app.quit",
      scope: "global",
    });
  });

  it("delegates overlay navigation keys to a focused native list", () => {
    expect(resolve(key("down"), { overlayOpen: true, nativeListFocused: true })).toBeNull();
  });

  it("routes navigation keys from a search input to the active region", () => {
    const context = { textInputFocused: true, inputMode: "search", activeRegion: "graph" } as const;

    expect(resolve(key("up"), context)).toEqual({ actionId: "nav.up", scope: "graph" });
    expect(resolve(key("down"), context)).toEqual({ actionId: "nav.down", scope: "graph" });
    expect(resolve(key("pageup"), context)).toEqual({
      actionId: "nav.pageUp",
      scope: "graph",
    });
    expect(resolve(key("pagedown"), context)).toEqual({
      actionId: "nav.pageDown",
      scope: "graph",
    });
    expect(resolve(key("home"), context)).toEqual({ actionId: "nav.first", scope: "graph" });
    expect(resolve(key("end"), context)).toEqual({ actionId: "nav.last", scope: "graph" });
    expect(resolve(key("enter"), context)).toEqual({
      actionId: "nav.activate",
      scope: "graph",
    });
  });

  it("routes a search input inside an overlay to the overlay result list", () => {
    const context = { overlayOpen: true, textInputFocused: true, inputMode: "search" } as const;

    expect(resolve(key("up"), context)).toEqual({ actionId: "nav.up", scope: "overlay" });
    expect(resolve(key("down"), context)).toEqual({ actionId: "nav.down", scope: "overlay" });
    expect(resolve(key("pageup"), context)).toEqual({
      actionId: "nav.pageUp",
      scope: "overlay",
    });
    expect(resolve(key("pagedown"), context)).toEqual({
      actionId: "nav.pageDown",
      scope: "overlay",
    });
    expect(resolve(key("home"), context)).toEqual({ actionId: "nav.first", scope: "overlay" });
    expect(resolve(key("end"), context)).toEqual({ actionId: "nav.last", scope: "overlay" });
    expect(resolve(key("enter"), context)).toEqual({
      actionId: "nav.activate",
      scope: "overlay",
    });
    expect(resolve(key("j"), context)).toBeNull();
    expect(resolve(key("k"), context)).toBeNull();
  });

  it("resolves modal traversal through the overlay scope", () => {
    expect(resolve(key("tab"), { overlayOpen: true })).toEqual({
      actionId: "focus.next",
      scope: "overlay",
    });
    expect(resolve(key("tab", { shift: true }), { overlayOpen: true })).toEqual({
      actionId: "focus.previous",
      scope: "overlay",
    });
    expect(
      resolve(key("tab"), { overlayOpen: true, textInputFocused: true, inputMode: "search" }),
    ).toEqual({ actionId: "focus.next", scope: "overlay" });
  });

  it("keeps typing, editing, and unbound keys in a search input", () => {
    const context = { textInputFocused: true, inputMode: "search", activeRegion: "graph" } as const;

    expect(resolve(key("j"), context)).toBeNull();
    expect(resolve(key("k"), context)).toBeNull();
    expect(resolve(key("a"), context)).toBeNull();
    expect(resolve(key("backspace"), context)).toBeNull();
    expect(resolve(key("delete"), context)).toBeNull();
    expect(resolve(key("left"), context)).toBeNull();
    expect(resolve(key("home"), context)).toEqual({ actionId: "nav.first", scope: "graph" });
    expect(resolve(key("end"), context)).toEqual({ actionId: "nav.last", scope: "graph" });
    expect(resolve(key("escape"), context)).toEqual({
      actionId: "overlay.close",
      scope: "global",
    });
  });

  it("does not route search navigation without an active region or with a field mode", () => {
    expect(
      resolve(key("down"), { textInputFocused: true, inputMode: "search", activeRegion: null }),
    ).toBeNull();
    expect(
      resolve(key("down"), {
        textInputFocused: true,
        inputMode: "field",
        activeRegion: "graph",
      }),
    ).toBeNull();
  });
});

/** Number of times the harness refresh handler ran. */
let refreshes = 0;

/**
 * Mounts the dispatcher, one region frame, and one text input.
 *
 * @returns The harness layout.
 */
function HotkeyHarness(): ReactNode {
  useHotkeys();
  useAction("app.refresh", { scope: "global", owner: "app" }, () => {
    refreshes += 1;
  });

  const region = useFocusRegion("branches");

  return (
    <box {...region.regionProps} flexDirection="column" width={40} height={8}>
      <input id="field" width={20} />
    </box>
  );
}

/** Number of times a single-line input submitted. */
let submits = 0;

/** Number of times a region-scoped activation handler ran. */
let activations = 0;

/**
 * Mounts the dispatcher with a real single-line input or textarea in a region.
 *
 * @param props - True to render a multiline textarea instead of an input.
 * @returns The harness layout.
 */
function TextEditingHarness(props: { multiline?: boolean }): ReactNode {
  useHotkeys();
  useAction("app.refresh", { scope: "global", owner: "app" }, () => {
    refreshes += 1;
  });
  useAction("nav.activate", { scope: "right-pane" }, () => {
    activations += 1;
  });

  const region = useFocusRegion("right-pane");

  return (
    <box {...region.regionProps} flexDirection="column" width={40} height={8}>
      {props.multiline ? (
        <textarea id="body" width={30} height={4} initialValue="line" />
      ) : (
        <input
          id="field"
          width={20}
          value="abc"
          onSubmit={() => {
            submits += 1;
          }}
        />
      )}
    </box>
  );
}

/** Number of times the search harness moved down. */
let searchDowns = 0;

/** Number of times the search harness activated a result. */
let searchActivations = 0;

/**
 * Mounts the dispatcher with a text input that declares the search input mode.
 *
 * @returns The harness layout.
 */
function SearchModeHarness(): ReactNode {
  useHotkeys();
  useAction("nav.down", { scope: "graph" }, () => {
    searchDowns += 1;
  });
  useAction("nav.activate", { scope: "graph" }, () => {
    searchActivations += 1;
  });

  const region = useFocusRegion("graph");

  useEffect(() => registerInputMode("search-field", "search"), []);

  return (
    <box {...region.regionProps} flexDirection="column" width={40} height={8}>
      <input id="search-field" width={30} />
    </box>
  );
}

/**
 * Renders the text editing harness inside the shell providers.
 *
 * @param multiline - True to render a textarea.
 * @returns The renderer setup.
 */
async function renderTextEditing(
  multiline: boolean,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  refreshes = 0;
  submits = 0;
  activations = 0;

  return testRender(
    <ShellTestProviders>
      <TextEditingHarness multiline={multiline} />
    </ShellTestProviders>,
    { width: 60, height: 20 },
  );
}

describe("useHotkeys", () => {
  beforeEach(() => {
    resetActionRegistry();
    resetInputModes();
    refreshes = 0;
    searchDowns = 0;
    searchActivations = 0;
  });

  it("runs a global action in a region and lets a focused editor keep its key", async () => {
    const setup = await testRender(
      <ConfigProvider>
        <ThemeProvider>
          <KeymapProvider platform="linux">
            <FocusProvider>
              <OverlayProvider>
                <HotkeyHarness />
              </OverlayProvider>
            </FocusProvider>
          </KeymapProvider>
        </ThemeProvider>
      </ConfigProvider>,
      { width: 60, height: 20 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    const regionFrame = setup.renderer.root.findDescendantById("region-branches");
    const input = setup.renderer.root.findDescendantById("field") as InputRenderable | undefined;

    expect(regionFrame).toBeDefined();
    expect(input).toBeDefined();

    await act(async () => {
      regionFrame?.focus();
    });
    await act(async () => {
      setup.mockInput.pressKey("r");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(refreshes).toBe(1);

    await act(async () => {
      input?.focus();
    });
    await act(async () => {
      setup.mockInput.pressKey("r");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(refreshes).toBe(1);
    expect(input?.value).toBe("r");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("indents and outdents a real textarea without moving focus", async () => {
    const setup = await renderTextEditing(true);

    await act(async () => {
      await setup.renderOnce();
    });

    const textarea = setup.renderer.root.findDescendantById("body") as
      | TextareaRenderable
      | undefined;

    expect(textarea).toBeDefined();

    await act(async () => {
      textarea?.focus();
      textarea?.editBuffer.setCursor(0, 0);
    });

    await act(async () => {
      setup.mockInput.pressTab();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(textarea?.plainText).toBe("  line");
    expect(textarea?.editBuffer.getCursorPosition().row).toBe(0);
    expect(textarea?.editBuffer.getCursorPosition().col).toBe(2);

    await act(async () => {
      setup.mockInput.pressTab({ shift: true });
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(textarea?.plainText).toBe("line");
    expect(textarea?.editBuffer.getCursorPosition().row).toBe(0);
    expect(textarea?.editBuffer.getCursorPosition().col).toBe(0);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("body");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("passes Enter through to a single-line input instead of activating the region", async () => {
    const setup = await renderTextEditing(false);

    await act(async () => {
      await setup.renderOnce();
    });

    const input = setup.renderer.root.findDescendantById("field") as InputRenderable | undefined;

    await act(async () => {
      input?.focus();
    });
    await act(async () => {
      setup.mockInput.pressEnter();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(submits).toBe(1);
    expect(activations).toBe(0);
    expect(input?.value).toBe("abc");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("routes search-mode navigation keys without editing or swallowing printable keys", async () => {
    const setup = await testRender(
      <ShellTestProviders>
        <SearchModeHarness />
      </ShellTestProviders>,
      { width: 60, height: 20 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    const input = setup.renderer.root.findDescendantById("search-field") as
      | InputRenderable
      | undefined;

    await act(async () => {
      input?.focus();
    });
    await act(async () => {
      setup.mockInput.pressArrow("down");
    });
    await act(async () => {
      setup.mockInput.pressKey("j");
    });
    await act(async () => {
      setup.mockInput.pressKey("k");
    });
    await act(async () => {
      setup.mockInput.pressEnter();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(searchDowns).toBe(1);
    expect(searchActivations).toBe(1);
    expect(input?.value).toBe("jk");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("passes OpenTUI editing keys through to the focused input", async () => {
    const setup = await renderTextEditing(false);

    await act(async () => {
      await setup.renderOnce();
    });

    const input = setup.renderer.root.findDescendantById("field") as InputRenderable | undefined;

    await act(async () => {
      input?.focus();
    });
    await act(async () => {
      setup.mockInput.pressKey("a", { ctrl: true });
    });
    await act(async () => {
      setup.mockInput.pressKey("z");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    // Ctrl+A moved the OpenTUI cursor to the line start, so typing replaced nothing and inserted.
    expect(input?.value).toBe("zabc");
    expect(refreshes).toBe(0);
    expect(submits).toBe(0);

    await act(async () => {
      await setup.dispose();
    });
  });
});
