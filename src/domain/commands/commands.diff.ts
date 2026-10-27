import type {
  DiffFileActionOptions,
  DiffFileActionResult,
  DiffPathPair,
  DiffSection,
} from "@/domain/diff/diff.types";
import {
  deleteAllUntracked,
  deleteUntrackedFile,
  discardFile,
  discardPaths,
  stageFile,
  stagePaths,
  unstageFile,
  unstagePaths,
} from "@/domain/git/git.diff";
import { STATUS_ARGS } from "@/domain/git/git.status";
import type { StatusEntry } from "@/domain/git/git.types";
import { parseStatus } from "@/domain/git/parsers/parse.status";
import { blockedOutcome, invokeCommandStep } from "./commands.invoke";
import { toCommandStep } from "./commands.steps";
import type {
  CommandExecutionOutcome,
  CommandFormValues,
  CommandHandlerContext,
  CommandStepResult,
} from "./commands.types";

/** Form key carrying a bulk action's literal paths; Stage All may combine working and untracked. */
export const DIFF_FORM_PATHS = "paths";

/** Form key carrying the section a bulk action is scoped to. */
export const DIFF_FORM_SECTION = "section";

/** Form key marking a request as coming from the read-only commit or stash context. */
export const DIFF_FORM_READ_ONLY = "readOnly";

/** Sections each diff command may act on. */
const DIFF_SECTION_RULES: Readonly<Record<string, readonly DiffSection[]>> = Object.freeze({
  "diff.stage": Object.freeze(["working", "untracked"] as const),
  "diff.stageAll": Object.freeze(["working", "untracked"] as const),
  "diff.unstage": Object.freeze(["staged"] as const),
  "diff.unstageAll": Object.freeze(["staged"] as const),
  "diff.discard": Object.freeze(["working"] as const),
  "diff.discardAll": Object.freeze(["working"] as const),
  "diff.deleteUntracked": Object.freeze(["untracked"] as const),
  "diff.deleteAllUntracked": Object.freeze(["untracked"] as const),
});

/** Bulk diff commands whose scope is a section path set. */
const DIFF_BULK_COMMANDS: ReadonlySet<string> = new Set([
  "diff.stageAll",
  "diff.unstageAll",
  "diff.discardAll",
  "diff.deleteAllUntracked",
]);

/** Sections a command accepts, or undefined when the command is not a diff command. */
export function readDiffCommandSections(commandId: string): readonly DiffSection[] | undefined {
  return DIFF_SECTION_RULES[commandId];
}

/**
 * Reports whether a command is a bulk diff action scoped to a section path set.
 *
 * @param commandId - Stable command id.
 * @returns True for the four bulk diff actions.
 */
export function isDiffBulkCommand(commandId: string): boolean {
  return DIFF_BULK_COMMANDS.has(commandId);
}

/**
 * Reads the section-scoped path set from the form values.
 *
 * Only string entries survive, so a malformed value never reaches a planner. An absent key is
 * distinct from an empty list: absent means the caller supplied no scope, while an empty list means
 * the section is empty and the action has nothing to do.
 *
 * @param values - Form values collected by the dispatching feature.
 * @returns The path list, or undefined when the key is absent or not a list.
 */
export function readDiffFormPaths(
  values: CommandFormValues | undefined,
): readonly string[] | undefined {
  const value = values?.[DIFF_FORM_PATHS];

  return Array.isArray(value) ? value.filter((path) => typeof path === "string") : undefined;
}

/**
 * Reads the section from the form values.
 *
 * @param values - Form values collected by the dispatching feature.
 * @returns The section, or null when the value is absent or unknown.
 */
export function readDiffFormSection(values: CommandFormValues | undefined): DiffSection | null {
  const value = values?.[DIFF_FORM_SECTION];

  if (value === "working" || value === "staged" || value === "untracked") {
    return value;
  }

  return null;
}

/**
 * Reports whether a request was dispatched from the read-only commit or stash context.
 *
 * Read-only mode cannot be inferred from repository signals, so the feature passes it explicitly in
 * the form values. Both a boolean and the string spelling are accepted.
 *
 * @param values - Form values collected by the dispatching feature.
 * @returns True when the request must be refused as read-only.
 */
export function isDiffFormReadOnly(values: CommandFormValues | undefined): boolean {
  const value = values?.[DIFF_FORM_READ_ONLY];

  return value === true || value === "true";
}

/**
 * Reports whether a diff handler must refuse its write as read-only.
 *
 * The runner-provided `readOnly` value is authoritative because it comes from the right-pane
 * selection. The form flag stays as an additional defense for a direct executor call.
 *
 * @param context - Handler context.
 * @returns True when the handler must refuse before invoking git.
 */
function isReadOnlyRequest(context: CommandHandlerContext): boolean {
  return context.readOnly === true || isDiffFormReadOnly(context.request.formValues);
}

/**
 * Executes `diff.stage` for one explicit file target.
 *
 * @param context - Request, explicit diff-file target, client, and signal.
 * @returns The stage step, or a blocked outcome for a missing or invalid target.
 */
export async function executeDiffStage(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  if (isReadOnlyRequest(context)) {
    return blockedOutcome("read-only");
  }

  const target = readDiffFileTarget(context);

  if (target === null || !isSectionAllowed("diff.stage", target.section)) {
    return blockedOutcome(target === null ? "missing-target" : "invalid-target");
  }

  return toDiffOutcome(await stageFile(context.client, writeOptions(context, [target])));
}

/**
 * Executes `diff.unstage` for one explicit file target.
 *
 * @param context - Request, explicit diff-file target, client, and signal.
 * @returns The unstage step, or a blocked outcome for a missing or invalid target.
 */
export async function executeDiffUnstage(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  if (isReadOnlyRequest(context)) {
    return blockedOutcome("read-only");
  }

  const target = readDiffFileTarget(context);

  if (target === null || !isSectionAllowed("diff.unstage", target.section)) {
    return blockedOutcome(target === null ? "missing-target" : "invalid-target");
  }

  return toDiffOutcome(await unstageFile(context.client, writeOptions(context, [target])));
}

/**
 * Executes `diff.discard` for one explicit tracked working-tree target.
 *
 * A rename target carries both paths, so the domain executor restores the old path and removes the
 * new path only after a status read confirms it is untracked.
 *
 * @param context - Request, explicit diff-file target, client, and signal.
 * @returns The restore steps, or a blocked outcome for a missing or invalid target.
 */
export async function executeDiffDiscard(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  if (isReadOnlyRequest(context)) {
    return blockedOutcome("read-only");
  }

  const target = readDiffFileTarget(context);

  if (target === null || !isSectionAllowed("diff.discard", target.section)) {
    return blockedOutcome(target === null ? "missing-target" : "invalid-target");
  }

  return toDiffOutcome(await discardFile(context.client, writeOptions(context, [target])));
}

/**
 * Executes `diff.deleteUntracked` for one explicit untracked target.
 *
 * @param context - Request, explicit diff-file target, client, and signal.
 * @returns The scoped clean step, or a blocked outcome for a missing or invalid target.
 */
export async function executeDiffDeleteUntracked(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  if (isReadOnlyRequest(context)) {
    return blockedOutcome("read-only");
  }

  const target = readDiffFileTarget(context);

  if (target === null || !isSectionAllowed("diff.deleteUntracked", target.section)) {
    return blockedOutcome(target === null ? "missing-target" : "invalid-target");
  }

  return toDiffOutcome(await deleteUntrackedFile(context.client, writeOptions(context, [target])));
}

/**
 * Executes `diff.stageAll` for the explicit path set in the form values.
 *
 * An omitted section stages the combined working and untracked paths supplied by the global
 * `diff.stageAllUnstaged` action. Inline section buttons and the diff-scoped `S` still send their
 * own section and paths. A rename contributes both paths, which `git add` accepts once the old path
 * is gone from the working tree.
 *
 * @param context - Request, explicit path set, optional section, client, and signal.
 * @returns The stage step, or a blocked outcome for an empty set or invalid section.
 */
export async function executeDiffStageAll(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  return await executeBulk(context, "diff.stageAll", stagePaths);
}

/**
 * Executes `diff.unstageAll` for the staged section path set in the form values.
 *
 * @param context - Request, section path set, client, and signal.
 * @returns The unstage step, or a blocked outcome for an empty set or invalid section.
 */
export async function executeDiffUnstageAll(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  return await executeBulk(context, "diff.unstageAll", unstagePaths);
}

/**
 * Executes `diff.deleteAllUntracked` for the untracked section path set in the form values.
 *
 * @param context - Request, section path set, client, and signal.
 * @returns The scoped clean step, or a blocked outcome for an empty set or invalid section.
 */
export async function executeDiffDeleteAllUntracked(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  return await executeBulk(context, "diff.deleteAllUntracked", deleteAllUntracked);
}

/**
 * Executes `diff.discardAll` for the tracked working-tree section path set.
 *
 * Rename pairing needs both paths of one logical change, but a bulk request carries only the section
 * path set. The handler therefore reads status once to fold a rename pair back into one target, then
 * calls the same executor the per-file command uses. A path the fresh status no longer explains is a
 * stale target and blocks the whole action before any write.
 *
 * @param context - Request, section path set, client, and signal.
 * @returns The status step and restore steps, or a blocked outcome.
 */
export async function executeDiffDiscardAll(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  if (isReadOnlyRequest(context)) {
    return blockedOutcome("read-only");
  }

  const section = readDiffFormSection(context.request.formValues);

  if (!isSectionAllowed("diff.discardAll", section)) {
    return blockedOutcome("invalid-target");
  }

  const paths = readBulkPaths(context);

  if (paths.length === 0) {
    return blockedOutcome("no-files");
  }

  const statusStep = await invokeCommandStep(context, STATUS_ARGS, "read");

  if (statusStep.exitCode !== 0) {
    return { steps: [statusStep], failed: true };
  }

  const targets = buildWorkingDiscardTargets(parseStatus(statusStep.stdout).entries, paths);

  if (targets === null) {
    return blockedOutcome("invalid-target");
  }

  const result = await discardPaths(context.client, writeOptions(context, targets));

  return toDiffOutcome(result, [statusStep]);
}

/**
 * Executes one bulk index action against the section path set.
 *
 * @param context - Handler context.
 * @param commandId - Bulk command id whose section rule applies.
 * @param executor - Domain executor for the action.
 * @returns The write step, or a blocked outcome for an empty set or invalid section.
 */
async function executeBulk(
  context: CommandHandlerContext,
  commandId: string,
  executor: (
    client: CommandHandlerContext["client"],
    options: DiffFileActionOptions,
  ) => Promise<DiffFileActionResult>,
): Promise<CommandExecutionOutcome> {
  if (isReadOnlyRequest(context)) {
    return blockedOutcome("read-only");
  }

  const section = readDiffFormSection(context.request.formValues);

  const isCombinedStageAll =
    commandId === "diff.stageAll" && context.request.formValues?.[DIFF_FORM_SECTION] === undefined;

  if (!isCombinedStageAll && !isSectionAllowed(commandId, section)) {
    return blockedOutcome("invalid-target");
  }

  const paths = readBulkPaths(context);

  if (paths.length === 0) {
    return blockedOutcome("no-files");
  }

  const targets = paths.map((path) => ({ path, oldPath: null }));

  return toDiffOutcome(await executor(context.client, writeOptions(context, targets)));
}

/**
 * Reads and validates the literal path set of a bulk request.
 *
 * An empty path, a `.` path, and a NUL are rejected because they can never name one literal file.
 * Wildcard characters stay valid: the domain builder wraps every path as `:(literal)`, so a file
 * literally named `*` is matched and nothing else is. The app never emits a whole-tree pathspec or
 * `git clean -x`.
 *
 * @param context - Handler context carrying the form values.
 * @returns The safe path list, or an empty list when the request is unusable.
 */
function readBulkPaths(context: CommandHandlerContext): readonly string[] {
  const paths = readDiffFormPaths(context.request.formValues) ?? [];

  return paths.filter((path) => isLiteralPath(path));
}

/**
 * Reports whether a path can name exactly one literal file.
 *
 * @param path - Candidate path.
 * @returns True when the path is non-empty, is not the whole-tree `.` path, and has no NUL.
 */
function isLiteralPath(path: string): boolean {
  return path.length > 0 && path !== "." && !path.includes("\0");
}

/**
 * Reads the explicit diff-file target and narrows its section.
 *
 * @param context - Handler context.
 * @returns The target path pair with its section, or null when the target is missing or invalid.
 */
function readDiffFileTarget(context: CommandHandlerContext): {
  readonly section: DiffSection;
  readonly path: string;
  readonly oldPath: string | null;
} | null {
  const target = context.target;

  if (target.kind !== "diffFile") {
    return null;
  }

  const section = readDiffFormSection({ section: target.section });

  if (section === null || !isLiteralPath(target.path)) {
    return null;
  }

  return { section, path: target.path, oldPath: target.oldPath ?? null };
}

/**
 * Reports whether a command accepts one section.
 *
 * @param commandId - Stable command id.
 * @param section - Section the request targets, or null when absent.
 * @returns True when the section is documented for the command.
 */
function isSectionAllowed(commandId: string, section: DiffSection | null): boolean {
  const allowed = DIFF_SECTION_RULES[commandId];

  return allowed !== undefined && section !== null && allowed.includes(section);
}

/**
 * Builds the domain write options for one request.
 *
 * @param context - Handler context carrying the root and signal.
 * @param targets - Literal targets of the action.
 * @returns The executor options.
 */
function writeOptions(
  context: CommandHandlerContext,
  targets: readonly DiffPathPair[],
): {
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly targets: readonly DiffPathPair[];
} {
  return { cwd: context.cwd, signal: context.signal, targets };
}

/**
 * Folds a section path set into the targets `discardPaths` expects.
 *
 * A rename pair in the set becomes one target carrying both paths. Any other path becomes a plain
 * target. A path the fresh status no longer lists as a working-tree change is stale, so the whole
 * action is refused instead of running a restore that would fail halfway.
 *
 * @param entries - Entries from a status read taken immediately before the write.
 * @param paths - Section path set from the request.
 * @returns The targets, or null when one path is stale.
 */
function buildWorkingDiscardTargets(
  entries: readonly StatusEntry[],
  paths: readonly string[],
): readonly DiffPathPair[] | null {
  const targets: DiffPathPair[] = [];
  const resolved = new Set<string>();

  for (const path of paths) {
    if (resolved.has(path)) {
      continue;
    }

    const rename = entries.find(
      (entry) =>
        entry.kind === "renamed" &&
        entry.originalPath !== null &&
        (entry.path === path || entry.originalPath === path),
    );

    if (rename !== undefined && rename.originalPath !== null) {
      targets.push({ path: rename.path, oldPath: rename.originalPath });
      resolved.add(rename.path);
      resolved.add(rename.originalPath);
      continue;
    }

    const exists = entries.some((entry) => entry.path === path && entry.worktree !== "unmodified");

    if (!exists) {
      return null;
    }

    targets.push({ path, oldPath: null });
    resolved.add(path);
  }

  return targets;
}

/**
 * Converts one domain action result into a command outcome.
 *
 * @param result - Domain file action result.
 * @param prefixSteps - Steps that ran before the action, such as a status read.
 * @returns The outcome with mapped steps, warnings, failure, or blocked reason.
 */
function toDiffOutcome(
  result: DiffFileActionResult,
  prefixSteps: readonly CommandStepResult[] = [],
): CommandExecutionOutcome {
  if (result.reason !== null) {
    return blockedOutcome(result.reason === "no-paths" ? "no-files" : "invalid-target");
  }

  const steps = [...prefixSteps, ...result.steps.map((step) => toCommandStep(step))];

  if (!result.ok) {
    return { steps, failed: true, warnings: readWarnings(result.warnings) };
  }

  return { steps, warnings: readWarnings(result.warnings) };
}

/**
 * Reads the warning list of an action result.
 *
 * @param warnings - Domain warning list.
 * @returns The list, or undefined when empty.
 */
function readWarnings(warnings: readonly string[]): readonly string[] | undefined {
  return warnings.length > 0 ? warnings : undefined;
}
