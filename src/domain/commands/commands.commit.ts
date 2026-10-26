import { amendCommit, commitStaged } from "@/domain/git/git.commit";
import type { CommitActionResult } from "@/domain/git/git.types";
import type { CommitCommandVariant, CommitFormKey } from "./commands.commit.types";
import { blockedOutcome, readFormString } from "./commands.invoke";
import { toCommandStep } from "./commands.steps";
import type { CommandExecutionOutcome, CommandHandlerContext } from "./commands.types";

/** Form key the composer uses to pass the draft message. */
export const COMMIT_FORM_MESSAGE: CommitFormKey = "message";

/**
 * Variant flags keyed by command id.
 *
 * The four menu rows are separate action ids and commands, so the handler table is the only place
 * that maps a command to its amend and no-verify flags.
 */
const COMMIT_COMMAND_VARIANTS: Readonly<Record<string, CommitCommandVariant>> = Object.freeze({
  "commit.submit": Object.freeze({ amend: false, noVerify: false }),
  "commit.submitNoVerify": Object.freeze({ amend: false, noVerify: true }),
  "commit.amend": Object.freeze({ amend: true, noVerify: false }),
  "commit.amendNoVerify": Object.freeze({ amend: true, noVerify: true }),
});

/**
 * Executes `commit.submit` as a normal commit.
 *
 * @param context - Request, message form value, client, and signal.
 * @returns The commit step, or a blocked outcome for an empty message.
 */
export async function executeCommitSubmit(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  return await executeCommitCommand(context, "commit.submit");
}

/**
 * Executes `commit.submitNoVerify` as a normal commit with `--no-verify`.
 *
 * @param context - Request, message form value, client, and signal.
 * @returns The commit step, or a blocked outcome for an empty message.
 */
export async function executeCommitSubmitNoVerify(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  return await executeCommitCommand(context, "commit.submitNoVerify");
}

/**
 * Executes `commit.amend` as an amend of HEAD.
 *
 * @param context - Request, message form value, client, and signal.
 * @returns The amend step, or a blocked outcome for an empty message.
 */
export async function executeCommitAmend(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  return await executeCommitCommand(context, "commit.amend");
}

/**
 * Executes `commit.amendNoVerify` as an amend of HEAD with `--no-verify`.
 *
 * @param context - Request, message form value, client, and signal.
 * @returns The amend step, or a blocked outcome for an empty message.
 */
export async function executeCommitAmendNoVerify(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  return await executeCommitCommand(context, "commit.amendNoVerify");
}

/**
 * Runs one commit variant through the domain executor.
 *
 * The message is read from the captured form values so the composer, the menu, and the palette all
 * send the same shape. The domain planner validates the message, and its typed rejection becomes the
 * shared `message-required` availability reason.
 *
 * @param context - Handler context carrying the request and git client.
 * @param commandId - Variant to execute.
 * @returns The mapped command outcome.
 */
async function executeCommitCommand(
  context: CommandHandlerContext,
  commandId: string,
): Promise<CommandExecutionOutcome> {
  const variant = COMMIT_COMMAND_VARIANTS[commandId];

  if (variant === undefined) {
    return blockedOutcome("command-not-found");
  }

  const message = readFormString(context.request.formValues, COMMIT_FORM_MESSAGE);
  const options = {
    message,
    noVerify: variant.noVerify,
    cwd: context.cwd,
    signal: context.signal,
  };
  const result = variant.amend
    ? await amendCommit(context.client, options)
    : await commitStaged(context.client, options);

  return toCommitOutcome(result);
}

/**
 * Maps a domain commit result into a command outcome.
 *
 * @param result - Domain commit result.
 * @returns The outcome with mapped steps, a failure flag, or the blocked reason.
 */
function toCommitOutcome(result: CommitActionResult): CommandExecutionOutcome {
  if (result.reason !== null) {
    return blockedOutcome("message-required");
  }

  const steps = result.steps.map((step) => toCommandStep(step));

  return result.ok ? { steps } : { steps, failed: true };
}
