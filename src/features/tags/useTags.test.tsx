import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useEffect } from "react";
import {
  isCommandOrchestrationActive,
  resetCommandOrchestration,
} from "@/app/hooks/commandRunner.state";
import { resetActionRegistry, resolveActionHandler } from "@/app/hooks/useAction";
import { readActionAvailability, resetActionAvailability } from "@/app/hooks/useActionAvailability";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useRepository } from "@/app/hooks/useRepository";
import { buildListLocalTagsArgs } from "@/domain/git/git.tags";
import type { GitClient } from "@/domain/git/git.types";
import type { RepositorySelection } from "@/domain/repository/repository.types";
import { useTags } from "@/features/tags/useTags";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

/** Latest tags hook handle captured by the probe. */
let latestTags: ReturnType<typeof useTags> | undefined;

/** Latest right-pane selection captured by the probe. */
let latestSelection: RepositorySelection | undefined;

/** Latest remote tag knowledge captured by the probe. */
let latestChecks: ReturnType<typeof useRepository>["remoteTagChecks"] = {};

/**
 * Mounts the tags hook inside the focusable tags region frame.
 *
 * @returns The probe frame.
 */
function TagsProbe(): ReactNode {
  const repository = useRepository();
  const region = useFocusRegion("tags");

  latestTags = useTags({ openCreateTag: () => {}, openDeleteTag: () => {} });
  latestSelection = repository.selection;
  latestChecks = repository.remoteTagChecks;

  return <box {...region.regionProps} flexDirection="column" width={60} height={10} />;
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
  } = {},
): GitClient {
  const base = createFakeGitClient().client;
  const remotes =
    options.remotes ??
    "origin\tgit@example.com:repo.git (fetch)\norigin\tgit@example.com:repo.git (push)\n";

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

      if (key.startsWith("ls-remote --tags -- ")) {
        const ok = options.remoteTagsOk !== false;

        return fakeGitResult(
          options.remoteTags ?? "",
          ok,
          ok ? "" : "fatal: could not read from remote",
        );
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
 * Renders the probe with the provider stack the hook needs.
 *
 * @param gitClient - Injected client.
 * @returns The renderer setup.
 */
async function renderProbe(gitClient: GitClient): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <AppTestProviders gitClient={gitClient}>
      <TagsProbe />
      <RemoteTagsProbe />
    </AppTestProviders>,
    { width: 80, height: 16 },
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

beforeEach(() => {
  resetActionRegistry();
  resetActionAvailability();
  resetCommandOrchestration();
  latestTags = undefined;
  latestSelection = undefined;
  latestChecks = {};
});

describe("useTags", () => {
  it("derives rows in version-descending order from the shared selector", async () => {
    const setup = await renderProbe(
      createClient({
        tags: [
          lightweightTag("v1.2.9", "aaa", "older"),
          lightweightTag("v1.2.10", "bbb", "newer"),
          lightweightTag("v2.0.0-beta", "ccc", "newest"),
        ].join("\n"),
      }),
    );

    await waitFor(setup, () => latestTags?.rows.length === 3);

    expect(latestTags?.rows.map((row) => row.name)).toEqual(["v2.0.0-beta", "v1.2.10", "v1.2.9"]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("selects the tagged commit through nav.activate without a git call", async () => {
    const setup = await renderProbe(
      createClient({ tags: lightweightTag("v2.0.0", "abc123", "subject") }),
    );

    await waitFor(setup, () => latestTags?.rows.length === 1);

    const activate = resolveActionHandler("nav.activate", "tags");

    await act(async () => {
      activate?.();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestSelection).toEqual({ kind: "commit", oid: "abc123" });
    expect(isCommandOrchestrationActive()).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("allows a push only for a local tag on a known remote that does not have it", async () => {
    const setup = await renderProbe(
      createClient({ tags: lightweightTag("v1.0.0", "abc123", "subject"), remoteTags: "" }),
    );

    await waitFor(setup, () => latestChecks.origin?.status === "known");
    await waitFor(setup, () => latestTags?.rows.length === 1);

    expect(latestTags?.pushAvailability("v1.0.0")).toEqual({ available: true, reason: null });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("names the remote that already has the tag", async () => {
    const setup = await renderProbe(
      createClient({
        tags: lightweightTag("v1.0.0", "abc123", "subject"),
        remoteTags: "abc123\trefs/tags/v1.0.0\n",
      }),
    );

    await waitFor(setup, () => latestChecks.origin?.status === "known");
    await waitFor(setup, () => latestTags?.rows.length === 1);

    expect(latestTags?.pushAvailability("v1.0.0")).toEqual({
      available: false,
      reason: "already on origin",
    });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("refuses a push while remote tag state is unknown", async () => {
    const setup = await renderProbe(
      createClient({
        tags: lightweightTag("v1.0.0", "abc123", "subject"),
        remoteTagsOk: false,
      }),
    );

    await waitFor(setup, () => latestChecks.origin?.status === "failed");
    await waitFor(setup, () => latestTags?.rows.length === 1);

    expect(latestTags?.rows[0]?.state).toBe("unknown");
    expect(latestTags?.pushAvailability("v1.0.0")).toEqual({
      available: false,
      reason: "remote tag state unknown; refresh to retry",
    });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("refuses a push when no remote is configured", async () => {
    const setup = await renderProbe(
      createClient({
        tags: lightweightTag("v1.0.0", "abc123", "subject"),
        remotes: "",
      }),
    );

    await waitFor(setup, () => latestTags?.rows.length === 1);

    expect(latestTags?.rows[0]?.state).toBe("local-only");
    expect(latestTags?.pushAvailability("v1.0.0")).toEqual({
      available: false,
      reason: "no remote",
    });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("refuses a push for a tag that exists only remotely", async () => {
    const setup = await renderProbe(createClient({ remoteTags: "abc123\trefs/tags/v9.0.0\n" }));

    await waitFor(setup, () => latestChecks.origin?.status === "known");
    await waitFor(setup, () => latestTags?.rows.length === 1);

    const push = latestTags?.pushAvailability("v9.0.0");

    expect(push?.available).toBe(false);
    expect(push?.reason).toBe("The selected target is no longer valid");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("activates the double-clicked row, not the previous cursor row", async () => {
    const setup = await renderProbe(
      createClient({
        tags: [
          lightweightTag("v2.0.0", "bbb222", "newer"),
          lightweightTag("v1.0.0", "aaa111", "older"),
        ].join("\n"),
      }),
    );

    await waitFor(setup, () => latestTags?.rows.length === 2);

    await act(async () => {
      latestTags?.handleRowClick(1);
      latestTags?.handleRowClick(1);
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestSelection).toEqual({ kind: "commit", oid: "aaa111" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("publishes the selected row's action availability and clears it on unmount", async () => {
    const setup = await renderProbe(
      createClient({
        tags: lightweightTag("v1.0.0", "abc123", "subject"),
        remoteTags: "abc123\trefs/tags/v1.0.0\n",
      }),
    );

    await waitFor(setup, () => latestChecks.origin?.status === "known");
    await waitFor(setup, () => latestTags?.rows.length === 1);
    await act(async () => {
      await setup.renderOnce();
    });

    expect(readActionAvailability("tags", "tag.create")).toBe(true);
    expect(readActionAvailability("tags", "tag.delete")).toBe(true);
    expect(readActionAvailability("tags", "tag.push")).toBe(false);

    await act(async () => {
      await setup.dispose();
    });

    expect(readActionAvailability("tags", "tag.delete")).toBeUndefined();
  });
});
