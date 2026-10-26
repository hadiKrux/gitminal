import { beforeEach, describe, expect, it } from "bun:test";
import {
  clearFocusedInput,
  registerInputEscapeClear,
  resetInputEscapeClear,
} from "@/app/hooks/useInputEscapeClear";

beforeEach(() => {
  resetInputEscapeClear();
});

describe("useInputEscapeClear", () => {
  it("reports false when no renderable is focused or nothing is registered", () => {
    expect(clearFocusedInput(null)).toBe(false);
    expect(clearFocusedInput("remotes-filter")).toBe(false);
  });

  it("runs the registered clear callback and reports that focus stays in the field", () => {
    let clears = 0;
    registerInputEscapeClear("remotes-filter", () => {
      clears += 1;
    });

    expect(clearFocusedInput("remotes-filter")).toBe(true);
    expect(clears).toBe(1);
  });

  it("stops calling a callback after its cleanup runs", () => {
    let clears = 0;
    const cleanup = registerInputEscapeClear("tags-filter", () => {
      clears += 1;
    });

    cleanup();

    expect(clearFocusedInput("tags-filter")).toBe(false);
    expect(clears).toBe(0);
  });

  it("keeps the latest registration when a surface re-registers", () => {
    let clears = 0;
    const first = registerInputEscapeClear("worktrees-filter", () => {
      clears += 1;
    });
    const second = registerInputEscapeClear("worktrees-filter", () => {
      clears += 10;
    });

    first();
    expect(clearFocusedInput("worktrees-filter")).toBe(true);
    expect(clears).toBe(10);

    second();
    expect(clearFocusedInput("worktrees-filter")).toBe(false);
  });
});
