import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { ConflictBanner } from "@/features/diff/ConflictBanner";
import { ShellTestProviders } from "@/test/shell.harness";

/**
 * Renders the banner inside the provider stack.
 *
 * @param conflictedFiles - Conflicted paths.
 * @param operation - In-progress operation.
 * @returns The renderer setup.
 */
async function renderBanner(
  conflictedFiles: readonly string[],
  operation: "merge" | "rebase" | "cherry-pick" | null,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <ShellTestProviders>
      <box flexDirection="column" width={100} height={6}>
        <ConflictBanner conflictedFiles={conflictedFiles} operation={operation} />
      </box>
    </ShellTestProviders>,
    { width: 100, height: 8 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

describe("ConflictBanner", () => {
  it("renders nothing when there is no conflict and no operation", async () => {
    const setup = await renderBanner([], null);

    expect(setup.captureCharFrame().trim()).toBe("");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("names the conflicted files and the resolution remedy", async () => {
    const setup = await renderBanner(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"], null);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Conflicts in 4 files");
    expect(frame).toContain("src/a.ts");
    expect(frame).toContain("+1 more");
    expect(frame).toContain("Resolve each file externally");
    expect(frame).toContain("then");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("names each merge, rebase, and cherry-pick operation", async () => {
    const cases: readonly (readonly ["merge" | "rebase" | "cherry-pick", string])[] = [
      ["merge", "Merge in progress"],
      ["rebase", "Rebase in progress"],
      ["cherry-pick", "Cherry-pick in progress"],
    ];

    for (const [operation, text] of cases) {
      const setup = await renderBanner([], operation);

      expect(setup.captureCharFrame()).toContain(text);

      await act(async () => {
        await setup.dispose();
      });
    }
  });
});
