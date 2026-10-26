import {
  planCreateTag,
  planDeleteLocalTag,
  planDeleteRemoteTag,
  planPushTag,
} from "@/domain/git/git.tags";
import {
  blockedOutcome,
  didStepSucceed,
  invokeCommandStep,
  readFormBoolean,
  readFormChoice,
  readFormString,
} from "./commands.invoke";
import type {
  CommandExecutionOutcome,
  CommandHandlerContext,
  CommandStepResult,
} from "./commands.types";

/** Delete scopes offered by the Delete Tag modal. */
const DELETE_SCOPES = Object.freeze(["local", "local-remote", "remote"] as const);

/**
 * Executes `tag.create` with the annotated-versus-lightweight rule.
 *
 * An empty message creates a lightweight tag; a non-empty message creates an annotated tag and
 * records that message. The optional push runs after the local tag exists, so a rejected push keeps
 * the local tag and reports the remote half as not done.
 *
 * @param context - Request, form values, client, and signal.
 * @returns The tag steps plus the remote result when a push was attempted.
 */
export async function executeTagCreate(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  const values = context.request.formValues;
  const message = readFormString(values, "message");
  const plan = planCreateTag({
    name: readFormString(values, "name"),
    target: readFormString(values, "target"),
    message: message.length === 0 ? null : message,
  });

  if (!plan.ok) {
    return blockedOutcome("invalid-target");
  }

  const createStep = await invokeCommandStep(context, plan.args, "write");
  const steps: CommandStepResult[] = [createStep];

  if (!didStepSucceed(createStep) || !readFormBoolean(values, "push")) {
    return { steps };
  }

  return await pushTagAfterCreate(context, steps, readFormString(values, "name"));
}

/**
 * Pushes a tag that was just created and reports the remote outcome.
 *
 * @param context - Request, client, and signal.
 * @param steps - Steps that already ran; the push step is appended in place.
 * @param name - Tag that was created.
 * @returns The full outcome with the remote result the app layer records.
 */
async function pushTagAfterCreate(
  context: CommandHandlerContext,
  steps: CommandStepResult[],
  name: string,
): Promise<CommandExecutionOutcome> {
  const remote = readFormString(context.request.formValues, "remote");
  const plan = planPushTag(remote, name);

  if (!plan.ok) {
    return tagPushFailure(steps, remote, name);
  }

  const pushStep = await invokeCommandStep(context, plan.args, "network");

  steps.push(pushStep);

  if (!didStepSucceed(pushStep)) {
    return {
      ...tagPushFailure(steps, remote, name),
      remoteResults: [{ remote, succeeded: false }],
    };
  }

  return { steps, remoteResults: [{ remote, succeeded: true }] };
}

/**
 * Executes `tag.push`.
 *
 * One explicit `refs/tags/<name>` refspec is pushed to the resolved remote, so a configured
 * `push.default` can never widen the scope. Availability already refused a tag the last known remote
 * set says is present, so this path only runs for a tag that is absent or unknown.
 *
 * @param context - Request, target tag, form values, client, and signal.
 * @returns The push step with its remote result.
 */
export async function executeTagPush(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  const target = context.target;

  if (target.kind !== "tag") {
    return blockedOutcome("missing-target");
  }

  const remote = resolveRemote(context);
  const plan = planPushTag(remote, target.name);

  if (!plan.ok) {
    return blockedOutcome("invalid-target");
  }

  const step = await invokeCommandStep(context, plan.args, "network");

  return { steps: [step], remoteResults: [{ remote, succeeded: didStepSucceed(step) }] };
}

/**
 * Executes `tag.delete` with remote-first ordering for the local-and-remote scope.
 *
 * Deleting remotely first means a failed remote delete leaves the local tag in place and keeps the
 * row deletable. If the remote delete succeeds and the local delete fails, the result is a partial
 * failure with a warning about the remaining local tag, because the tag is now absent from the
 * remote and must not be reported as fully deleted.
 *
 * @param context - Request, target tag, form values, client, and signal.
 * @returns Every step that ran, plus the remote result when a remote delete was attempted.
 */
export async function executeTagDelete(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  const target = context.target;

  if (target.kind !== "tag") {
    return blockedOutcome("missing-target");
  }

  const scope = readFormChoice(context.request.formValues, "scope", DELETE_SCOPES) ?? "local";

  if (scope === "local") {
    return await deleteLocalTagOnly(context, target.name);
  }

  const remoteOutcome = await deleteRemoteTagOnly(context, target.name);

  if (scope === "remote" || !didRemoteStepSucceed(remoteOutcome)) {
    return remoteOutcome;
  }

  return await deleteLocalTagAfterRemote(context, remoteOutcome.steps, target.name, remoteOutcome);
}

/**
 * Reports whether the remote half of a tag delete completed.
 *
 * @param outcome - Settled remote delete outcome.
 * @returns True when its single step exited cleanly.
 */
function didRemoteStepSucceed(outcome: CommandExecutionOutcome): boolean {
  const step = outcome.steps[0];

  return step !== undefined && didStepSucceed(step);
}

/**
 * Deletes only the local tag.
 *
 * @param context - Request, client, and signal.
 * @param name - Tag to delete.
 * @returns The local delete step, or a blocked outcome for an unsafe name.
 */
async function deleteLocalTagOnly(
  context: CommandHandlerContext,
  name: string,
): Promise<CommandExecutionOutcome> {
  const plan = planDeleteLocalTag(name);

  if (!plan.ok) {
    return blockedOutcome("invalid-target");
  }

  return { steps: [await invokeCommandStep(context, plan.args, "write")] };
}

/**
 * Deletes only the remote tag, or the remote half of a local-and-remote delete.
 *
 * @param context - Request, form values, client, and signal.
 * @param name - Tag to delete.
 * @returns The remote delete step plus its remote result.
 */
async function deleteRemoteTagOnly(
  context: CommandHandlerContext,
  name: string,
): Promise<CommandExecutionOutcome> {
  const remote = resolveRemote(context);
  const plan = planDeleteRemoteTag(remote, name);

  if (!plan.ok) {
    return blockedOutcome("invalid-target");
  }

  const step = await invokeCommandStep(context, plan.args, "network");

  return { steps: [step], remoteResults: [{ remote, succeeded: didStepSucceed(step) }] };
}

/**
 * Deletes the local tag after the remote delete succeeded.
 *
 * @param context - Request, client, and signal.
 * @param remoteSteps - Steps that already ran; the local step is appended in place.
 * @param name - Tag to delete.
 * @param remoteOutcome - Settled remote half, whose remote result is preserved.
 * @returns The full outcome, a partial failure when the local delete fails.
 */
async function deleteLocalTagAfterRemote(
  context: CommandHandlerContext,
  remoteSteps: readonly CommandStepResult[],
  name: string,
  remoteOutcome: CommandExecutionOutcome,
): Promise<CommandExecutionOutcome> {
  const plan = planDeleteLocalTag(name);

  if (!plan.ok) {
    return {
      steps: remoteSteps,
      failed: true,
      warnings: [`local tag ${name} remains`],
      remoteResults: remoteOutcome.remoteResults,
    };
  }

  const localStep = await invokeCommandStep(context, plan.args, "write");
  const steps = [...remoteSteps, localStep];

  if (!didStepSucceed(localStep)) {
    return {
      steps,
      failed: true,
      warnings: [`local tag ${name} remains`],
      remoteResults: remoteOutcome.remoteResults,
    };
  }

  return { steps, remoteResults: remoteOutcome.remoteResults };
}

/**
 * Resolves the remote a tag command targets.
 *
 * @param context - Handler context carrying the form values and target.
 * @returns The form remote, then the target remote, or an empty string when neither is present.
 */
function resolveRemote(context: CommandHandlerContext): string {
  const formRemote = readFormString(context.request.formValues, "remote");

  if (formRemote.length > 0) {
    return formRemote;
  }

  return context.target.kind === "tag" ? (context.target.remote ?? "") : "";
}

/**
 * Builds the partial-failure outcome for a tag that could not be pushed.
 *
 * @param steps - Steps that ran.
 * @param remote - Remote the push targeted.
 * @param name - Tag name.
 * @returns A failed outcome with a warning naming the unpushed tag.
 */
function tagPushFailure(
  steps: readonly CommandStepResult[],
  remote: string,
  name: string,
): CommandExecutionOutcome {
  return {
    steps,
    failed: true,
    warnings: [`tag ${name} was not pushed to ${remote}`],
  };
}
