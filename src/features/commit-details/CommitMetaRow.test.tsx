import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { CommitMetaRow } from "@/features/commit-details/CommitMetaRow";
import { ShellTestProviders } from "@/test/shell.harness";

/**
 * Renders one metadata row.
 *
 * @param props - Row props without the measured width.
 * @param width - Container and row width.
 * @param terminalWidth - Terminal width.
 * @returns The renderer setup.
 */
async function renderRow(
  props: Omit<Parameters<typeof CommitMetaRow>[0], "width">,
  width: number = 80,
  terminalWidth: number = width,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <ShellTestProviders>
      <box flexDirection="column" width={width} height={4}>
        <CommitMetaRow {...props} width={width} />
      </box>
    </ShellTestProviders>,
    { width: terminalWidth, height: 4 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

describe("CommitMetaRow", () => {
  it("renders the author label, identity, and date with timezone", async () => {
    const setup = await renderRow({
      kind: "author",
      name: "Alice Ng",
      email: "alice@example.com",
      date: "2026-10-25T09:30:00+05:00",
    });
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Author:");
    expect(frame).toContain("Alice Ng <alice@example.com>");
    expect(frame).toContain("2026-10-25T09:30:00+05:00");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders the committer marker only for a differing committer", async () => {
    const author = await renderRow({
      kind: "author",
      name: "Alice Ng",
      email: "alice@example.com",
      date: "2026-10-25T09:30:00+00:00",
      differs: true,
    });

    expect(author.captureCharFrame()).not.toContain("differs from author");

    await act(async () => {
      await author.dispose();
    });

    const committer = await renderRow({
      kind: "committer",
      name: "Rebase Bot",
      email: "bot@example.com",
      date: "2026-10-26T11:00:00+01:00",
      differs: true,
    });
    const frame = committer.captureCharFrame();

    expect(frame).toContain("Committer:");
    expect(frame).toContain("Rebase Bot <bot@example.com>");
    expect(frame).toContain("differs from author");

    await act(async () => {
      await committer.dispose();
    });
  });

  it("omits the committer marker when the committer matches the author", async () => {
    const setup = await renderRow({
      kind: "committer",
      name: "Alice Ng",
      email: "alice@example.com",
      date: "2026-10-25T09:30:00+00:00",
    });

    expect(setup.captureCharFrame()).not.toContain("differs from author");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("truncates a long value but keeps the label and the date budget", async () => {
    const setup = await renderRow(
      {
        kind: "author",
        name: "A Writer With A Very Long Display Name",
        email: "a.very.long.email.address@example-with-long-domain.test",
        date: "2026-10-25T09:30:00+05:00",
      },
      44,
    );
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Author:");
    expect(frame).toContain("...");
    expect(frame).not.toContain("example-with-long-domain.test");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("budgets the value from the pane width when the terminal is wider", async () => {
    const setup = await renderRow(
      {
        kind: "author",
        name: "A Writer With A Very Long Display Name",
        email: "a.very.long.email.address@example-with-long-domain.test",
        date: "2026-10-25T09:30:00+05:00",
      },
      40,
      80,
    );
    const frame = setup.captureCharFrame();
    const line = frame.split("\n")[0] ?? "";

    expect(frame).toContain("Author:");
    expect(frame).toContain("...");
    expect(line.trimEnd().length).toBeLessThanOrEqual(40);

    await act(async () => {
      await setup.dispose();
    });
  });
});
