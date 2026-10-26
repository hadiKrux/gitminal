import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { useDraft } from "@/app/hooks/useDraft";
import { DraftProvider } from "@/app/providers/DraftProvider";
import type { DraftContextValue } from "@/app/providers/DraftProvider.types";
import { readGuardError, renderGuard } from "@/test/react.guard";

/** Latest value observed by the composer probe. */
let composerValue: DraftContextValue | undefined;

/** Latest value observed by the quit-confirmation probe. */
let quitValue: DraftContextValue | undefined;

/**
 * Reads the draft the way the composer does.
 *
 * @returns Nothing.
 */
function ComposerProbe(): null {
  composerValue = useDraft();

  return null;
}

/**
 * Reads the unsaved-work flag the way the shell quit handler does.
 *
 * @returns Nothing.
 */
function QuitProbe(): null {
  quitValue = useDraft();

  return null;
}

/**
 * Renders both probes inside the provider.
 *
 * @param initialDraft - Optional starting draft.
 * @returns The renderer setup.
 */
async function renderDraft(initialDraft?: string): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <DraftProvider initialDraft={initialDraft}>
      <ComposerProbe />
      <QuitProbe />
      <text>draft</text>
    </DraftProvider>,
    { width: 40, height: 6 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

beforeEach(() => {
  composerValue = undefined;
  quitValue = undefined;
});

describe("DraftProvider", () => {
  it("starts empty and reports no unsaved draft", async () => {
    const setup = await renderDraft();

    expect(composerValue?.draft).toBe("");
    expect(quitValue?.hasUnsavedDraft).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("is the single owner both the composer and the quit confirmation read", async () => {
    const setup = await renderDraft();

    await act(async () => {
      composerValue?.setDraft("feat: composer");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(composerValue?.draft).toBe("feat: composer");
    expect(quitValue?.draft).toBe("feat: composer");
    expect(quitValue?.hasUnsavedDraft).toBe(true);
    expect(composerValue).toBe(quitValue);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("treats a whitespace-only draft as no unsaved work", async () => {
    const setup = await renderDraft();

    await act(async () => {
      quitValue?.setDraft("   \n\t ");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(composerValue?.hasUnsavedDraft).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the draft until the owner clears it", async () => {
    const setup = await renderDraft("work in progress");

    // A failed commit never calls clearDraft, so a re-read after the failure still sees the message.
    await act(async () => {
      await setup.renderOnce();
    });

    expect(composerValue?.draft).toBe("work in progress");
    expect(quitValue?.hasUnsavedDraft).toBe(true);

    await act(async () => {
      quitValue?.clearDraft();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(composerValue?.draft).toBe("");
    expect(quitValue?.hasUnsavedDraft).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("throws a clear error outside a DraftProvider", async () => {
    const setup = await renderGuard(<ComposerProbe />);

    expect(readGuardError()).toBe("useDraft must be used within a DraftProvider.");

    await act(async () => {
      await setup.dispose();
    });
  });
});
