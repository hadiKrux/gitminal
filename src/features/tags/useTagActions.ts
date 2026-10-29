import { useCallback } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useRepository } from "@/app/hooks/useRepository";
import type { useStatus } from "@/app/hooks/useStatus";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import type { CommandAvailabilityReason } from "@/domain/commands/commands.types";
import type { TagRowRecord } from "@/domain/git/git.types";

/** Title and exact confirm label of the shared push-tag confirmation. */
const PUSH_TAG_TITLE = "Push tag";

/**
 * Owns the Tags region actions and their availability pre-checks.
 *
 * The hook registers exactly `tag.create`, `tag.delete`, and `tag.push` in the
 * `tags` scope. Push reads its display reason from the shared reason table except for a tag already
 * on a remote, where the remote is named. Every mutation goes through `useCommandRunner`; this hook
 * never calls git directly.
 *
 * @param input - Active row, rows, default remote, modal openers, and status writer.
 * @returns The action callbacks and the push availability reader.
 */
export function useTagActions(input: {
  readonly activeRow: TagRowRecord | null;
  readonly rows: readonly TagRowRecord[];
  readonly defaultRemote: string;
  readonly openCreateTag: () => void;
  readonly openDeleteTag: (row: TagRowRecord) => void;
  readonly setStatus: ReturnType<typeof useStatus>["setStatus"];
}) {
  const repository = useRepository();
  const overlay = useOverlay();
  const { runCommand } = useCommandRunner();
  const { activeRow, defaultRemote, openCreateTag, openDeleteTag, rows } = input;
  const { setStatus } = input;

  /** Shows an unavailable reason as a transient warning status. */
  const reportUnavailable = useCallback(
    (reason: CommandAvailabilityReason | undefined): void => {
      setStatus({
        kind: "warning",
        message: describeCommandReason(reason ?? "command-not-implemented"),
      });
    },
    [setStatus],
  );

  /**
   * Reads the display reason for a push, naming the remote that already has the tag.
   *
   * @param name - Tag name.
   * @returns Whether the tag may be pushed and the text of its blocking reason.
   */
  const readPushAvailability = useCallback(
    (name: string): { readonly available: boolean; readonly reason: string | null } => {
      const availability = repository.getAvailability("tag.push", { kind: "tag", name }, "tags");

      if (availability.available) {
        return { available: true, reason: null };
      }

      const row = rows.find((candidate) => candidate.name === name) ?? null;
      const reason = availability.reason ?? "command-not-implemented";

      return { available: false, reason: describePushReason(reason, row) };
    },
    [repository, rows],
  );

  /** Opens the Create Tag modal when a tag can be created in this repository. */
  const createTag = useCallback((): void => {
    const availability = repository.getAvailability("tag.create", { kind: "none" }, "tags");

    if (!availability.available) {
      reportUnavailable(availability.reason);
      return;
    }

    openCreateTag();
  }, [openCreateTag, reportUnavailable, repository]);

  /** Opens the Delete Tag modal for the active row after a fresh availability check. */
  const deleteTag = useCallback((): void => {
    if (activeRow === null) {
      reportUnavailable("missing-target");
      return;
    }

    const availability = repository.getAvailability(
      "tag.delete",
      { kind: "tag", name: activeRow.name },
      "tags",
    );

    if (!availability.available) {
      reportUnavailable(availability.reason);
      return;
    }

    openDeleteTag(activeRow);
  }, [activeRow, openDeleteTag, reportUnavailable, repository]);

  /** Confirms and pushes the active tag when known remote state says it is absent. */
  const pushTag = useCallback((): void => {
    if (activeRow === null) {
      reportUnavailable("missing-target");
      return;
    }

    const availability = readPushAvailability(activeRow.name);

    if (!availability.available) {
      setStatus({ kind: "warning", message: availability.reason ?? "no remote" });
      return;
    }

    overlay.confirm({
      title: PUSH_TAG_TITLE,
      description: `Push tag ${activeRow.name} to ${defaultRemote}.`,
      confirmLabel: PUSH_TAG_TITLE,
      destructive: false,
      onConfirm: () => {
        void runCommand({
          commandId: "tag.push",
          target: { kind: "tag", name: activeRow.name },
          formValues: { remote: defaultRemote },
        }).catch(() => undefined);
      },
    });
  }, [
    activeRow,
    defaultRemote,
    overlay,
    readPushAvailability,
    reportUnavailable,
    runCommand,
    setStatus,
  ]);

  useAction("tag.create", { scope: "tags", targetKind: "none" }, createTag);
  useAction("tag.delete", { scope: "tags", targetKind: "tag" }, deleteTag);
  useAction("tag.push", { scope: "tags", targetKind: "tag" }, pushTag);

  return { readPushAvailability };
}

/**
 * Reads the display text of a blocked push.
 *
 * The shared reason table is used for every case except a tag already present on a remote, where the
 * feature doc requires the remote to be named.
 *
 * @param reason - Machine-readable availability reason.
 * @param row - Merged row for the target tag, or null when it is no longer listed.
 * @returns The display text.
 */
function describePushReason(reason: CommandAvailabilityReason, row: TagRowRecord | null): string {
  if (reason === "tag-already-on-remote") {
    const remote = row?.remotes[0];

    return remote === undefined ? describeCommandReason(reason) : `already on ${remote}`;
  }

  return describeCommandReason(reason);
}
