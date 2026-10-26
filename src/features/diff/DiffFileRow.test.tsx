import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import type { DiffFileView, DiffStatusLetter } from "@/domain/repository/repository.types";
import { DiffFileRow } from "@/features/diff/DiffFileRow";
import { ShellTestProviders } from "@/test/shell.harness";

/**
 * Builds one file row model.
 *
 * @param overrides - Fields to override.
 * @returns The row model.
 */
function file(overrides: Partial<DiffFileView> = {}): DiffFileView {
  return {
    id: "working::src/app.ts",
    section: "working",
    statusLetter: "M",
    status: "modified",
    path: "src/app.ts",
    oldPath: null,
    conflicted: false,
    ...overrides,
  };
}

/**
 * Renders one row inside the provider stack.
 *
 * @param view - Row model.
 * @param options - Expansion, counts, actions, and width.
 * @returns The renderer setup.
 */
async function renderRow(
  view: DiffFileView,
  options: {
    readonly expanded?: boolean;
    readonly counts?: { readonly add: number; readonly remove: number } | null;
    readonly actions?: readonly {
      readonly id: string;
      readonly label: string;
      readonly disabled: boolean;
      readonly reason?: string;
      readonly onPress: () => void;
    }[];
    readonly width?: number;
    readonly terminalWidth?: number;
  } = {},
): Promise<Awaited<ReturnType<typeof testRender>>> {
  const width = options.width ?? 70;
  const terminalWidth = options.terminalWidth ?? width;
  const setup = await testRender(
    <ShellTestProviders>
      <box flexDirection="column" width={width} height={6}>
        <DiffFileRow
          file={view}
          width={width}
          selected
          focused
          expanded={options.expanded ?? false}
          counts={options.counts ?? null}
          actions={options.actions ?? []}
          onToggle={() => {}}
          onMouseDown={() => {}}
        />
      </box>
    </ShellTestProviders>,
    { width: terminalWidth, height: 8 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

describe("DiffFileRow", () => {
  it("renders the status letter, path, counts, and expand indicator", async () => {
    const setup = await renderRow(file(), {
      counts: { add: 3, remove: 1 },
      expanded: true,
    });
    const frame = setup.captureCharFrame();

    expect(frame).toContain("M");
    expect(frame).toContain("src/app.ts");
    expect(frame).toContain("+3 -1");
    expect(frame).toContain("v");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders each documented status letter", async () => {
    const letters: readonly (readonly [DiffStatusLetter, string])[] = [
      ["M", "modified"],
      ["A", "added"],
      ["D", "deleted"],
      ["R", "renamed"],
      ["C", "copied"],
      ["U", "conflicted"],
      ["?", "added"],
    ];

    for (const [letter, status] of letters) {
      const setup = await renderRow(
        file({ statusLetter: letter, status: status as DiffFileView["status"] }),
      );

      expect(setup.captureCharFrame()).toContain(letter);

      await act(async () => {
        await setup.dispose();
      });
    }
  });

  it("renders a rename as old -> new", async () => {
    const setup = await renderRow(
      file({ statusLetter: "R", status: "renamed", oldPath: "old.ts" }),
    );
    const frame = setup.captureCharFrame();

    expect(frame).toContain("old.ts -> src/app.ts");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders inline actions and keeps a disabled one visible with its reason", async () => {
    const setup = await renderRow(file({ section: "staged" }), {
      actions: [
        {
          id: "diff.unstage",
          label: "Unstage",
          disabled: true,
          reason: "read-only",
          onPress: () => {},
        },
      ],
    });
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Unstage");
    expect(frame).toContain("read-only");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("truncates a long path and keeps the status letter", async () => {
    const setup = await renderRow(file({ path: `${"very-long-path/".repeat(12)}file.ts` }), {
      width: 40,
    });
    const frame = setup.captureCharFrame();

    expect(frame).toContain("...");
    expect(frame).toContain("M");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("budgets the path from its container width when the terminal is wider", async () => {
    const setup = await renderRow(file({ path: `${"very-long-path/".repeat(12)}file.ts` }), {
      width: 40,
      terminalWidth: 80,
      counts: { add: 12, remove: 3 },
    });
    const frame = setup.captureCharFrame();
    const firstLine = frame.split("\n")[0] ?? "";

    expect(firstLine).toContain("...");
    expect(firstLine).toContain("M");
    expect(firstLine).toContain("+12 -3");

    await act(async () => {
      await setup.dispose();
    });
  });
});
