import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { InputRenderable, TextareaRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useEffect } from "react";
import {
  isCommandOrchestrationActive,
  resetCommandOrchestration,
} from "@/app/hooks/commandRunner.state";
import { resetActionRegistry } from "@/app/hooks/useAction";
import { useRepository } from "@/app/hooks/useRepository";
import { registerCommandHandler, resetCommandRunner } from "@/domain/commands/commands.runner";
import type { CommandRequest } from "@/domain/commands/commands.types";
import type { GitClient, TagRecord } from "@/domain/git/git.types";
import type { RemoteTagChecks } from "@/domain/repository/repository.types";
import { CreateTagModal } from "@/features/tags/CreateTagModal";
import {
  CREATE_TAG_MESSAGE_INPUT_ID,
  CREATE_TAG_NAME_INPUT_ID,
} from "@/features/tags/CreateTagModal.constants";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";
import { ICONS } from "@/theme/icons";

/** Requests captured by the registered tag.create handler. */
let capturedRequests: CommandRequest[] = [];

/** Latest local tags observed through the repository probe. */
let latestTags: readonly TagRecord[] = [];

/** Latest remote tag knowledge observed through the repository probe. */
let latestChecks: RemoteTagChecks = {};

/**
 * Captures repository values so a test can wait for the first read.
 *
 * @returns Nothing.
 */
function RepositoryProbe(): null {
  const repository = useRepository();

  latestTags = repository.snapshot?.tags ?? [];
  latestChecks = repository.remoteTagChecks;

  return null;
}

/**
 * Selects a commit in the right pane, proving the create target follows the selection.
 *
 * @param props - Commit id to select.
 * @returns Nothing.
 */
function SelectionProbe(props: { readonly oid: string }): null {
  const repository = useRepository();

  useEffect(() => {
    repository.setSelection({ kind: "commit", oid: props.oid });
  }, [props.oid, repository]);

  return null;
}

/**
 * Reads remote tag knowledge once the first snapshot has configured remotes.
 *
 * @returns Nothing.
 */
function RemoteTagsProbe(): null {
  const repository = useRepository();
  const remoteCount = repository.snapshot?.remotes.length ?? 0;
  const { refreshRemoteTags } = repository;

  useEffect(() => {
    if (remoteCount > 0) {
      void refreshRemoteTags();
    }
  }, [refreshRemoteTags, remoteCount]);

  return null;
}

/**
 * Wraps a fake git client and overrides the remote tag read.
 *
 * @param remoteTagsOutput - Output for `git ls-remote --tags`.
 * @param ok - Whether the read succeeds.
 * @returns The wrapped client.
 */
function createClient(remoteTagsOutput: string = "", ok: boolean = true): GitClient {
  const base = createFakeGitClient().client;

  return {
    ...base,
    invoke: async (options) => {
      const key = options.args.join(" ");

      if (key.startsWith("ls-remote --tags -- ")) {
        return fakeGitResult(remoteTagsOutput, ok, ok ? "" : "fatal: could not read from remote");
      }

      return await base.invoke(options);
    },
  };
}

/**
 * Renders the modal with an optional probe.
 *
 * @param props - Client, probe node, and close spy.
 * @returns The renderer setup.
 */
async function renderModal(props: {
  readonly gitClient: GitClient;
  readonly probe?: ReactNode;
  readonly onClose: () => void;
}): Promise<Awaited<ReturnType<typeof testRender>>> {
  return testRender(
    <AppTestProviders gitClient={props.gitClient}>
      <RepositoryProbe />
      {props.probe}
      <CreateTagModal onClose={props.onClose} />
    </AppTestProviders>,
    { width: 100, height: 26 },
  );
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
 * Types a value into the tag name input.
 *
 * @param setup - Renderer setup.
 * @param value - Text to insert.
 */
async function typeName(
  setup: Awaited<ReturnType<typeof testRender>>,
  value: string,
): Promise<void> {
  await act(async () => {
    const input = setup.renderer.root.findDescendantById(
      CREATE_TAG_NAME_INPUT_ID,
    ) as InputRenderable | null;

    input?.focus();
    input?.insertText(value);
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Types a value into the annotation textarea.
 *
 * @param setup - Renderer setup.
 * @param value - Text to insert.
 */
async function typeMessage(
  setup: Awaited<ReturnType<typeof testRender>>,
  value: string,
): Promise<void> {
  await act(async () => {
    const textarea = setup.renderer.root.findDescendantById(
      CREATE_TAG_MESSAGE_INPUT_ID,
    ) as TextareaRenderable | null;

    textarea?.focus();
    textarea?.insertText(value);
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Submits the name field through its native submit callback.
 *
 * @param setup - Renderer setup.
 */
async function submitForm(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    const input = setup.renderer.root.findDescendantById(
      CREATE_TAG_NAME_INPUT_ID,
    ) as InputRenderable | null;

    input?.submit();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Registers a capture-only tag.create handler.
 *
 * @returns The registration cleanup.
 */
function registerCapture(): () => void {
  return registerCommandHandler({
    commandId: "tag.create",
    operationLabel: "Create tag",
    handler: async (context) => {
      capturedRequests.push(context.request);

      return { steps: [] };
    },
  });
}

beforeEach(() => {
  resetActionRegistry();
  resetCommandRunner();
  resetCommandOrchestration();
  capturedRequests = [];
  latestTags = [];
  latestChecks = {};
});

afterEach(() => {
  resetCommandRunner();
  resetCommandOrchestration();
});

describe("CreateTagModal", () => {
  it("requests a lightweight tag from HEAD when the message is empty", async () => {
    const cleanup = registerCapture();
    const setup = await renderModal({ gitClient: createClient(), onClose: () => {} });

    await waitFor(setup, () => latestTags.length > 0);
    await typeName(setup, "v2.0.0");
    await submitForm(setup);
    await waitFor(setup, () => capturedRequests.length > 0);

    expect(capturedRequests[0]).toEqual({
      commandId: "tag.create",
      target: { kind: "none" },
      formValues: {
        name: "v2.0.0",
        message: "",
        push: "false",
        remote: "origin",
        target: "HEAD",
      },
    });

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("requests an annotated tag when the message is not empty", async () => {
    const cleanup = registerCapture();
    const setup = await renderModal({ gitClient: createClient(), onClose: () => {} });

    await waitFor(setup, () => latestTags.length > 0);
    await typeName(setup, "v2.0.0");
    await typeMessage(setup, "release notes");
    await submitForm(setup);
    await waitFor(setup, () => capturedRequests.length > 0);

    expect(capturedRequests[0]?.formValues?.message).toBe("release notes");

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("states the remote that would receive a created tag", async () => {
    const setup = await renderModal({ gitClient: createClient(), onClose: () => {} });

    await waitFor(setup, () => latestTags.length > 0);

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Push to remote after creating (origin)");
    expect(frame).toContain(ICONS.checkboxOff);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("uses the selected commit as the target when the selection is a commit", async () => {
    const cleanup = registerCapture();
    const setup = await renderModal({
      gitClient: createClient(),
      probe: <SelectionProbe oid="abc1234567890" />,
      onClose: () => {},
    });

    await waitFor(setup, () => latestTags.length > 0);
    await waitFor(setup, () => setup.captureCharFrame().includes("abc1234"));

    await typeName(setup, "v2.0.0");
    await submitForm(setup);
    await waitFor(setup, () => capturedRequests.length > 0);

    expect(capturedRequests[0]?.formValues?.target).toBe("abc1234567890");
    expect(setup.captureCharFrame()).toContain("(selected commit)");

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("blocks an empty name and a name with whitespace", async () => {
    const cleanup = registerCapture();
    const setup = await renderModal({ gitClient: createClient(), onClose: () => {} });

    await waitFor(setup, () => latestTags.length > 0);
    await submitForm(setup);

    expect(setup.captureCharFrame()).toContain("Enter a tag name");

    await typeName(setup, "bad name");
    await submitForm(setup);

    expect(setup.captureCharFrame()).toContain("Tag names cannot contain whitespace");
    expect(capturedRequests).toHaveLength(0);

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("blocks a duplicate local name with the shared wording", async () => {
    const cleanup = registerCapture();
    const setup = await renderModal({ gitClient: createClient(), onClose: () => {} });

    await waitFor(setup, () => latestTags.length > 0);
    await typeName(setup, "v1.0.0");
    await submitForm(setup);

    expect(setup.captureCharFrame()).toContain("tag already exists");
    expect(capturedRequests).toHaveLength(0);

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("blocks a name known on a remote and names that remote", async () => {
    const cleanup = registerCapture();
    const setup = await renderModal({
      gitClient: createClient("aaaa\trefs/tags/v2.0.0\n"),
      probe: <RemoteTagsProbe />,
      onClose: () => {},
    });

    await waitFor(setup, () => latestChecks.origin?.status === "known");
    await typeName(setup, "v2.0.0");
    await submitForm(setup);

    expect(setup.captureCharFrame()).toContain("tag exists on origin");
    expect(capturedRequests).toHaveLength(0);

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("closes only after a valid submit, not after a validation failure", async () => {
    const cleanup = registerCapture();
    let closeCount = 0;
    const setup = await renderModal({
      gitClient: createClient(),
      onClose: () => {
        closeCount += 1;
      },
    });

    await waitFor(setup, () => latestTags.length > 0);
    await typeName(setup, "v1.0.0");
    await submitForm(setup);

    expect(closeCount).toBe(0);

    await typeName(setup, "x");
    await submitForm(setup);
    await waitFor(setup, () => capturedRequests.length > 0 && !isCommandOrchestrationActive());

    expect(closeCount).toBe(1);

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });
});
