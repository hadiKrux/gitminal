import { describe, expect, it } from "bun:test";
import { parseColor, type ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { ShellTestProviders } from "@/test/shell.harness";
import { useThemeControls } from "@/theme/useThemeControls";
import { useTokens } from "@/theme/useTokens";
import { ScrollableList } from "@/ui/ScrollableList";

let controls: ReturnType<typeof useThemeControls> | undefined;
let tokens: ReturnType<typeof useTokens> | undefined;

function ThemeProbe() {
  controls = useThemeControls();
  tokens = useTokens();

  return null;
}

function readTokens(): ReturnType<typeof useTokens> {
  if (tokens === undefined) {
    throw new Error("Theme probe has not mounted");
  }

  return tokens;
}

describe("ScrollableList", () => {
  it("updates both scrollbar axes and arrows when any built-in theme is previewed or restored", async () => {
    const setup = await testRender(
      <ShellTestProviders themeName="mocha">
        <ThemeProbe />
        <box width={20} height={4} flexDirection="column">
          <ScrollableList id="themed-scroll">
            <text>{"Long output line that overflows horizontally\n".repeat(20)}</text>
          </ScrollableList>
        </box>
      </ShellTestProviders>,
      { width: 20, height: 4 },
    );

    try {
      await act(async () => {
        await setup.renderOnce();
      });

      const scrollbox = setup.renderer.root.findDescendantById(
        "themed-scroll",
      ) as ScrollBoxRenderable;

      for (const themeName of ["latte", "frappe", "macchiato", "mocha"]) {
        await act(async () => {
          controls?.preview(themeName);
        });
        await setup.renderOnce();

        expect(tokens).toBeDefined();

        for (const bar of [scrollbox.verticalScrollBar, scrollbox.horizontalScrollBar]) {
          expect(bar.slider.foregroundColor).toEqual(parseColor(readTokens().scrollbar));
          expect(bar.slider.backgroundColor).toEqual(parseColor(readTokens().background));

          for (const arrow of [bar.startArrow, bar.endArrow]) {
            expect(arrow.foregroundColor).toEqual(parseColor(readTokens().scrollbar));
            expect(arrow.backgroundColor).toEqual(parseColor(readTokens().background));
          }
        }
      }

      await act(async () => {
        controls?.preview("latte");
      });
      await act(async () => {
        controls?.restore("mocha");
      });
      await setup.renderOnce();

      expect(scrollbox.verticalScrollBar.slider.foregroundColor).toEqual(
        parseColor(readTokens().scrollbar),
      );
    } finally {
      await act(async () => {
        await setup.dispose();
      });
    }
  });

  it("renders content in a plain, non-focusable scroll container", async () => {
    const setup = await testRender(
      <ShellTestProviders>
        <box flexDirection="column" width={30} height={5}>
          <ScrollableList id="details">
            <text>{"Stash summary"}</text>
            <text>{"Read-only details"}</text>
          </ScrollableList>
        </box>
      </ShellTestProviders>,
      { width: 30, height: 5 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    const list = setup.renderer.root.findDescendantById("details") as
      | ScrollBoxRenderable
      | undefined;
    const frame = setup.captureCharFrame();

    expect(list).toBeDefined();
    expect(list?.focusable).toBe(false);
    expect(frame).toContain("Stash summary");
    expect(frame).toContain("Read-only details");

    await act(async () => {
      await setup.dispose();
    });
  });
});
