import { useCallback, useRef } from "react";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useStatus } from "@/app/hooks/useStatus";
import { buildFetchFormValues } from "@/domain/commands/commands.fetch.scope";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import type {
  CommandAvailabilityReason,
  CommandFormValues,
  CommandResult,
  CommandTarget,
} from "@/domain/commands/commands.types";
import { CONFIRM_LABELS } from "@/domain/commands/confirm.labels";
import { PUSH_AUTO_CREATE_REMOTE } from "@/domain/git/git.remotes";
import { resolveCommandTarget } from "@/features/top-bar/topBar.controls";
import type { TopBarCommands, TopBarCommandsInput } from "@/features/top-bar/useTopBar.types";
import type { ForceConfirmationCapture } from "./useTopBarCommands.types";

/** Commands that open a confirmation before running. */
const CONFIRMED_COMMANDS: ReadonlySet<string> = new Set([
  "remote.pushForceSafe",
  "remote.pushForceOverwrite",
]);

/** Command id of the destructive force push. */
const OVERWRITE_COMMAND = "remote.pushForceOverwrite";

/** Warning shown when a confirmation no longer matches the current branch or upstream. */
const STALE_CONFIRMATION_WARNING = "branch or upstream changed; open the confirmation again";

/** Commands whose request carries the effective fetch scope and checked-out branch. */
const FETCH_COMMANDS: ReadonlySet<string> = new Set(["remote.fetchPrune"]);

/**
 * Routes the top bar's remote commands through the orchestrator and the overlay provider.
 *
 * Dispatch re-checks availability with the provider's fresh reader before starting anything, so a
 * stale menu or a palette request surfaces the same reason text as a disabled button. Push and Push
 * --no-verify communicate auto-creation through the operation phase emitted by the executor, and the
 * success text is derived from the argv that actually ran, never from a stale upstream snapshot.
 *
 * The force variants never run from this hook directly: they open a confirmation that captures the
 * branch, upstream, and target it names. On confirm those captured values are compared with the
 * latest provider state; a branch or upstream change closes the confirmation with a warning and runs
 * nothing, so an overwrite can never authorise a branch the user did not see.
 *
 * @param input - Branch, upstream ref, effective fetch scope, and availability reader.
 * @returns The dispatch and confirmed-activation entry points.
 */
export function useTopBarCommands(input: TopBarCommandsInput): TopBarCommands {
  const { setStatus } = useStatus();
  const overlay = useOverlay();
  const { runCommand } = useCommandRunner();
  const latestInputRef = useRef(input);

  latestInputRef.current = input;

  /** Shows a blocked command's reason as a warning status. */
  const reportBlocked = useCallback(
    (reason: CommandAvailabilityReason | undefined): void => {
      setStatus({
        kind: "warning",
        message: describeCommandReason(reason ?? "command-not-implemented"),
      });
    },
    [setStatus],
  );

  /** Runs a command after a fresh availability check, including the push auto-create statuses. */
  const dispatch = useCallback(
    (commandId: string, expectedBranch?: string): void => {
      const current = latestInputRef.current;

      if (expectedBranch !== undefined && expectedBranch !== current.branch) {
        setStatus({ kind: "warning", message: STALE_CONFIRMATION_WARNING });
        return;
      }

      const target = resolveCommandTarget(commandId, current.branch);
      const availability = current.getAvailability(commandId, target);

      if (!availability.available) {
        reportBlocked(availability.reason);
        return;
      }

      const formValues = readFetchFormValues(commandId, current);

      void runCommand({
        commandId,
        target,
        ...(formValues === undefined ? {} : { formValues }),
      })
        .then((result) => {
          const autoCreated = readAutoCreatedUpstream(result);

          if (result.status === "success" && autoCreated !== null) {
            setStatus({
              kind: "success",
              message: `Pushed ${autoCreated.branch}; tracking ${autoCreated.remote}/${autoCreated.branch}`,
            });
          }
        })
        .catch((error: unknown) => {
          // `useCommandRunner` owns the error overlay and has already stored its detail before this
          // promise rejects. The catch exists only to consume the rejection so it cannot become an
          // unhandled promise rejection; it must not replace the orchestrator's message.
          void error;
        });
    },
    [reportBlocked, runCommand, setStatus],
  );

  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  /** Opens the force push confirmation; the command runs only after confirmation. */
  const openForceConfirmation = useCallback(
    (commandId: string): void => {
      const target: CommandTarget = { kind: "branch", name: input.branch };
      const availability = input.getAvailability(commandId, target);

      if (!availability.available) {
        reportBlocked(availability.reason);
        return;
      }

      const captured: ForceConfirmationCapture = {
        commandId,
        branch: input.branch,
        upstreamRef: input.upstreamRef,
        target,
      };
      const destructive = commandId === OVERWRITE_COMMAND;

      overlay.confirm({
        title: destructive ? CONFIRM_LABELS.overwriteRemote : CONFIRM_LABELS.forcePushSafely,
        description: buildForcePushDescription({
          destructive,
          branch: captured.branch,
          upstream: captured.upstreamRef,
        }),
        confirmLabel: destructive ? CONFIRM_LABELS.overwriteRemote : CONFIRM_LABELS.forcePushSafely,
        destructive,
        onConfirm: () => {
          confirmForcePush(captured, latestInputRef.current, {
            close: overlay.close,
            dispatch: dispatchRef.current,
            reportBlocked,
            setStatus,
          });
        },
      });
    },
    [input.branch, input.getAvailability, input.upstreamRef, overlay, reportBlocked, setStatus],
  );

  /** Routes a user command request, confirming the force variants before dispatch. */
  const activateCommand = useCallback(
    (commandId: string): void => {
      if (CONFIRMED_COMMANDS.has(commandId)) {
        openForceConfirmation(commandId);
        return;
      }

      dispatch(commandId);
    },
    [dispatch, openForceConfirmation],
  );

  return { dispatch, activateCommand };
}

/**
 * Builds the fetch form values a remote request carries.
 *
 * Only Fetch --prune reads them. The scope comes from the effective configuration and the
 * branch from the same projection the top bar renders, so a palette dispatch through this handler
 * produces a request identical to a top bar activation.
 *
 * @param commandId - Command being dispatched.
 * @param input - Current branch and effective fetch scope.
 * @returns The fetch form values, or undefined for every other command.
 */
function readFetchFormValues(
  commandId: string,
  input: TopBarCommandsInput,
): CommandFormValues | undefined {
  return FETCH_COMMANDS.has(commandId)
    ? buildFetchFormValues(input.fetchScope, input.branch)
    : undefined;
}

/**
 * Revalidates a captured force confirmation and dispatches it only when it is still current.
 *
 * @param captured - Branch, upstream, command, and target captured at open time.
 * @param latest - Current branch, upstream, and availability reader.
 * @param actions - Close, dispatch, blocked-report, and status writers.
 */
function confirmForcePush(
  captured: ForceConfirmationCapture,
  latest: TopBarCommandsInput,
  actions: {
    readonly close: () => void;
    readonly dispatch: (commandId: string, expectedBranch?: string) => void;
    readonly reportBlocked: (reason: CommandAvailabilityReason | undefined) => void;
    readonly setStatus: (status: { kind: "warning"; message: string }) => void;
  },
): void {
  const mismatch = readForceConfirmationMismatch(captured, latest);

  if (mismatch !== null) {
    actions.close();
    actions.setStatus({ kind: "warning", message: mismatch });

    return;
  }

  const availability = latest.getAvailability(captured.commandId, captured.target);

  if (!availability.available) {
    actions.close();
    actions.reportBlocked(availability.reason);

    return;
  }

  actions.close();
  actions.dispatch(captured.commandId, captured.branch);
}

/**
 * Compares the branch and upstream named by a confirmation with the latest values.
 *
 * @param captured - Values captured when the confirmation opened.
 * @param latest - Current branch and upstream values.
 * @returns The warning message, or null when the confirmation is still valid.
 */
function readForceConfirmationMismatch(
  captured: { readonly branch: string; readonly upstreamRef: string | null },
  latest: { readonly branch: string; readonly upstreamRef: string | null },
): string | null {
  if (captured.branch !== latest.branch || captured.upstreamRef !== latest.upstreamRef) {
    return STALE_CONFIRMATION_WARNING;
  }

  return null;
}

/**
 * Reads the upstream a push appended to `--set-upstream`, when it did.
 *
 * The message reflects the argv that actually ran instead of the snapshot captured at dispatch time.
 *
 * @param result - Settled command result.
 * @returns The remote and branch of the created upstream, or null when no push set one.
 */
export function readAutoCreatedUpstream(
  result: CommandResult,
): { readonly remote: string; readonly branch: string } | null {
  for (const step of result.steps) {
    const index = step.argv.indexOf("--set-upstream");

    if (index < 0) {
      continue;
    }

    const remote = step.argv[index + 1];
    const refspec = step.argv[index + 2];

    if (remote === undefined || refspec === undefined) {
      continue;
    }

    const destination = refspec.split(":")[1] ?? refspec;
    const branch = destination.replace(/^refs\/heads\//, "");

    if (branch.length > 0) {
      return { remote, branch };
    }
  }

  return null;
}

/**
 * Builds the force push confirmation description naming the branch and remote.
 *
 * @param input - Destructiveness, branch name, and configured upstream ref.
 * @returns The consequence text.
 */
export function buildForcePushDescription(input: {
  readonly destructive: boolean;
  readonly branch: string;
  readonly upstream: string | null;
}): string {
  const remoteRef = input.upstream ?? `${PUSH_AUTO_CREATE_REMOTE}/${input.branch}`;
  const consequence = input.destructive
    ? "Remote commits that are not present locally can be lost."
    : "Commits this clone has not fetched are not overwritten.";

  return `${input.branch} -> ${remoteRef}. ${consequence}`;
}
