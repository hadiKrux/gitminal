import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction } from "@/app/hooks/useAction";
import { publishActionAvailability } from "@/app/hooks/useActionAvailability";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useStatus } from "@/app/hooks/useStatus";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import type { CommandAvailability } from "@/domain/commands/commands.types";
import type { BranchRecord, RemoteBranchRecord } from "@/domain/git/git.types";
import type { RepositorySelection } from "@/domain/repository/repository.types";
import type {
  BranchActionsHandle,
  BranchesRepository,
  BranchRowItem,
  BranchTarget,
  DeleteRemoteResolution,
  UseBranchesOptions,
} from "@/features/branches/useBranches.types";

/** Region this hook owns. */
const REGION_ID = "branches" as const;

/** Overlay entry id of the New Branch modal. */
const NEW_BRANCH_OVERLAY_ID = "branches.new";

/** Renderable id of the New Branch name input, focused when the modal opens. */
const NEW_BRANCH_NAME_FIELD_ID = "branches-new-branch-name";

/** Overlay entry id of the Delete Branch modal. */
const DELETE_BRANCH_OVERLAY_ID = "branches.delete";

/** Commit id length shown in the New Branch start point label. */
const SHORT_OID_LENGTH = 7;

/** Remote treated as the fallback for a branch with no configured upstream. */
const FALLBACK_REMOTE = "origin";

/**
 * Owns the branches panel command actions, modal dispatch, and availability publication.
 *
 * The hook registers exactly `branch.create` and `branch.delete` in the `branches` scope and never
 * registers a global action. Both actions open a modal through the single overlay entry and submit
 * through `useCommandRunner` with the documented form value keys. A successful create selects the
 * created row once it appears. Region focus transitions to true refresh the repository through
 * `refreshStatus()`; this hook never calls git.
 *
 * @param input - Repository context, rendered rows, cursor selection, focus state, and renderers.
 * @returns Availability text, modal openers, and retry.
 */
export function useBranchActions(input: {
  readonly repository: BranchesRepository;
  readonly items: readonly BranchRowItem[];
  readonly selected: BranchRecord | null;
  readonly selectId: (id: string) => void;
  readonly focused: boolean;
  readonly options: UseBranchesOptions;
}): BranchActionsHandle {
  const { repository, items, selected, selectId, focused, options } = input;
  const overlay = useOverlay();
  const { runCommand } = useCommandRunner();
  const { setStatus } = useStatus();
  const optionsRef = useRef(options);
  const availability = useBranchAvailability({ repository, selected });
  const { setPendingSelection } = usePendingBranchSelection({ items, selectId });

  optionsRef.current = options;

  const existingBranchNames = useMemo(
    () => (repository.snapshot?.branches ?? []).map((branch) => branch.name),
    [repository.snapshot],
  );

  useBranchFocusRefresh({ focused, repository });

  /** Opens the New Branch modal with the documented start point and availability. */
  const openCreate = useCallback((): void => {
    const startPoint = readStartPoint(repository.selection);
    const renderNewBranchModal = optionsRef.current.renderNewBranchModal;

    overlay.open({
      kind: "modal",
      id: NEW_BRANCH_OVERLAY_ID,
      initialFocusId: NEW_BRANCH_NAME_FIELD_ID,
      render: ({ close }) =>
        renderNewBranchModal({
          nameFieldId: NEW_BRANCH_NAME_FIELD_ID,
          startPointLabel: startPoint.label,
          existingBranchNames,
          blockedReason: availability.createReason,
          onClose: close,
          onCreate: ({ name, checkout }) => {
            void runCommand({
              commandId: "branch.create",
              target: { kind: "none" },
              formValues: {
                name,
                checkout: checkout ? "true" : "false",
                startPoint: startPoint.value,
              },
            })
              .then((result) => {
                if (result.status === "success") {
                  setPendingSelection(name);
                }
              })
              .catch(() => undefined);
          },
        }),
    });
  }, [
    availability.createReason,
    existingBranchNames,
    overlay,
    repository.selection,
    runCommand,
    setPendingSelection,
  ]);

  /** Opens the Delete Branch modal for the selected row, or explains the missing selection. */
  const openDelete = useCallback((): void => {
    if (selected === null) {
      setStatus({ kind: "info", message: describeCommandReason("missing-target") });

      return;
    }

    const resolution = resolveDeleteRemote(
      selected,
      repository.snapshot?.remoteBranches ?? [],
      repository.signals.remotes,
    );
    const renderDeleteBranchModal = optionsRef.current.renderDeleteBranchModal;

    overlay.open({
      kind: "modal",
      id: DELETE_BRANCH_OVERLAY_ID,
      render: ({ close }) =>
        renderDeleteBranchModal({
          branch: selected,
          blockedReason: readDeleteReason(repository, selectedDeleteTarget(selected)),
          remote: resolution.remote,
          remoteReason: resolution.reason,
          onClose: close,
          onDelete: ({ scope, force }) => {
            void runCommand({
              commandId: "branch.delete",
              target: { kind: "branch", name: selected.name },
              formValues: {
                scope,
                force: force ? "true" : "false",
                remote: resolution.remote?.remote ?? "",
                remoteBranch: resolution.remote?.branch ?? "",
              },
            });
          },
        }),
    });
  }, [overlay, repository, runCommand, selected, setStatus]);

  useAction("branch.create", { scope: REGION_ID }, openCreate);
  useAction("branch.delete", { scope: REGION_ID }, openDelete);

  const retry = useCallback((): void => {
    void repository.refreshStatus();
  }, [repository]);

  return {
    createReason: availability.createReason,
    selectedDeleteReason: availability.selectedDeleteReason,
    openCreate,
    openDelete,
    retry,
  };
}

/**
 * Reads and publishes the availability of the two branch actions.
 *
 * The selected branch decides whether delete is available, so the published value changes with the
 * cursor. Publishing both actions in one hook keeps the create and delete rules in one place.
 *
 * @param input - Repository context and the selected branch.
 * @returns Display reasons and availability for both actions.
 */
function useBranchAvailability(input: {
  readonly repository: BranchesRepository;
  readonly selected: BranchRecord | null;
}): {
  readonly createReason: string | null;
  readonly selectedDeleteReason: string | null;
} {
  const { repository, selected } = input;
  const createAvailability = repository.getAvailability(
    "branch.create",
    { kind: "none" },
    REGION_ID,
  );
  const deleteAvailability =
    selected === null
      ? null
      : repository.getAvailability("branch.delete", selectedDeleteTarget(selected), REGION_ID);

  useEffect(
    () => publishActionAvailability(REGION_ID, "branch.create", createAvailability.available),
    [createAvailability.available],
  );

  useEffect(
    () =>
      publishActionAvailability(REGION_ID, "branch.delete", deleteAvailability?.available === true),
    [deleteAvailability?.available],
  );

  return {
    createReason: readReason(createAvailability),
    selectedDeleteReason: deleteAvailability === null ? null : readReason(deleteAvailability),
  };
}

/**
 * Selects a created branch once its row appears in the refreshed list.
 *
 * The pending id is retained until the list contains it, so a refresh that resolves before the new
 * branch is readable does not lose the selection.
 *
 * @param input - Rendered rows and the cursor selection operation.
 * @returns The setter the create flow calls on success.
 */
function usePendingBranchSelection(input: {
  readonly items: readonly BranchRowItem[];
  readonly selectId: (id: string) => void;
}): { readonly setPendingSelection: (id: string | null) => void } {
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const { items, selectId } = input;

  useEffect(() => {
    if (pendingSelection === null || !items.some((item) => item.id === pendingSelection)) {
      return;
    }

    selectId(pendingSelection);
    setPendingSelection(null);
  }, [items, pendingSelection, selectId]);

  return { setPendingSelection };
}

/**
 * Refreshes the repository when the branches region gains focus.
 *
 * The previous focus flag prevents a duplicate read while the region stays focused across renders.
 *
 * @param input - Current focus state and repository context.
 */
function useBranchFocusRefresh(input: {
  readonly focused: boolean;
  readonly repository: BranchesRepository;
}): void {
  const previousFocusRef = useRef(false);
  const { focused, repository } = input;

  useEffect(() => {
    if (!focused) {
      previousFocusRef.current = false;

      return;
    }

    if (previousFocusRef.current) {
      return;
    }

    previousFocusRef.current = true;
    void repository.refreshStatus();
  }, [focused, repository]);
}

/**
 * Builds the explicit target for a branch row.
 *
 * @param branch - Selected branch.
 * @returns The branch target used by availability checks.
 */
function selectedDeleteTarget(branch: BranchRecord): BranchTarget {
  return { kind: "branch", name: branch.name };
}

/**
 * Reads the delete availability text for one branch.
 *
 * @param repository - Repository context with the target-aware availability reader.
 * @param target - Explicit branch target.
 * @returns The display reason, or null when delete is available.
 */
function readDeleteReason(repository: BranchesRepository, target: BranchTarget): string | null {
  return readReason(repository.getAvailability("branch.delete", target, REGION_ID));
}

/**
 * Converts an availability result into display text.
 *
 * @param availability - Result from `getAvailability`.
 * @returns The documented reason text, or null when the command is available.
 */
function readReason(availability: CommandAvailability): string | null {
  if (availability.available) {
    return null;
  }

  return describeCommandReason(availability.reason ?? "invalid-target");
}

/**
 * Reads the New Branch start point from the repository selection.
 *
 * A selected commit is the start point the graph supplies. Every other selection, including the
 * Pending Changes row, falls back to `HEAD`.
 *
 * @param selection - Current right-pane selection.
 * @returns The form value and the read-only display label.
 */
function readStartPoint(selection: RepositorySelection): {
  readonly value: string;
  readonly label: string;
} {
  if (selection.kind === "commit") {
    return {
      value: selection.oid,
      label: `commit ${selection.oid.slice(0, SHORT_OID_LENGTH)}`,
    };
  }

  return { value: "HEAD", label: "HEAD (current tip)" };
}

/**
 * Resolves the remote branch a local-and-remote delete would remove.
 *
 * The configured upstream wins only while the snapshot still classifies it as `tracked` and its
 * remote remains configured. Without an upstream, `origin/<local-branch-name>` is used only when
 * that ref exists in the snapshot and `origin` is configured. A confirmed `notFound` or `deleted`
 * upstream, a missing configured remote, and an unknown check each get their own reason so an
 * unconfirmed state never reads as a confirmed absence. The app never guesses another remote.
 *
 * @param branch - Branch being deleted.
 * @param remoteBranches - Remote-tracking branches from the snapshot.
 * @param configuredRemotes - Configured remote names from the current signals.
 * @returns The resolved remote branch, or null with the documented unavailable reason.
 */
function resolveDeleteRemote(
  branch: BranchRecord,
  remoteBranches: readonly RemoteBranchRecord[],
  configuredRemotes: readonly string[],
): DeleteRemoteResolution {
  if (branch.upstreamRemote !== null && branch.upstreamBranch !== null) {
    return resolveConfiguredUpstream(branch, configuredRemotes);
  }

  if (!configuredRemotes.includes(FALLBACK_REMOTE)) {
    return { remote: null, reason: "remote missing" };
  }

  const fallback = remoteBranches.find(
    (record) => record.remote === FALLBACK_REMOTE && record.branch === branch.name,
  );

  if (fallback === undefined) {
    return { remote: null, reason: describeCommandReason("no-remote-branch") };
  }

  return { remote: { remote: fallback.remote, branch: fallback.branch }, reason: null };
}

/**
 * Resolves the remote half for a branch with a configured upstream.
 *
 * @param branch - Branch whose upstream remote and branch are set.
 * @param configuredRemotes - Configured remote names from the current signals.
 * @returns The resolved upstream, or null with the documented unavailable reason.
 */
function resolveConfiguredUpstream(
  branch: BranchRecord,
  configuredRemotes: readonly string[],
): DeleteRemoteResolution {
  const remote = branch.upstreamRemote ?? "";
  const branchName = branch.upstreamBranch ?? "";

  if (!configuredRemotes.includes(remote)) {
    return { remote: null, reason: "remote missing" };
  }

  switch (branch.upstreamStatus) {
    case "tracked":
      return { remote: { remote, branch: branchName }, reason: null };
    case "unknown":
      return { remote: null, reason: "remote state unknown" };
    case "none":
    case "notFound":
    case "deleted":
      return { remote: null, reason: describeCommandReason("no-remote-branch") };
  }
}
