import { createGitProgressParser } from "@/domain/git/git.progress";
import { isSafeGitName, isTruncatedOutput } from "@/domain/git/git.remotes";
import { invokeNetwork } from "./commands.invoke";
import { toCommandStep } from "./commands.steps";
import type { CommandExecutionOutcome, CommandHandlerContext } from "./commands.types";

/**
 * Fetches the named configured remote (origin by default) using its configured refspecs.
 * Explicit no-prune flags override git configuration: ordinary fetch never removes refs or tags.
 * No local branch is checked out or changed by this operation.
 * @param context - Captured request and git execution boundary.
 * @returns Invocation evidence, remote freshness, or a scope refusal.
 */
export async function executeRemoteFetch(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  const remote = context.request.formValues?.remote ?? "origin";

  if (typeof remote !== "string" || !isSafeGitName(remote)) {
    return { steps: [], blockedReason: "unknown-remote" };
  }

  const configured = await context.client.invoke({
    args: ["remote"],
    cwd: context.cwd,
    signal: context.signal,
    operationClass: "read",
  });

  if (!configured.ok || isTruncatedOutput(configured)) {
    return { steps: [toCommandStep(configured)], failed: true };
  }

  if (!configured.stdout.split(/\r?\n/).includes(remote)) {
    return { steps: [], blockedReason: "unknown-remote" };
  }

  const refusal = await readFetchRefspecRefusal(context, remote);

  if (refusal !== null) {
    return refusal;
  }

  const result = await invokeNetwork(
    context,
    ["fetch", "--progress", "--no-prune", "--no-prune-tags", "--", remote],
    createGitProgressParser(),
  );

  return {
    steps: [toCommandStep(result)],
    remoteResults: [{ remote, succeeded: result.ok }],
    failed: !result.ok,
    cancelled: result.cancelled,
    timedOut: result.timedOut,
  };
}

/**
 * Refuses configured refspecs that could update a local branch before contacting the remote.
 * A missing fetch mapping is safe (git writes FETCH_HEAD only); unreadable configuration is not.
 * @param context - Git execution boundary.
 * @param remote - Existing configured remote name.
 * @returns A refusal or read failure, or null when the configured destinations are safe.
 */
async function readFetchRefspecRefusal(
  context: CommandHandlerContext,
  remote: string,
): Promise<CommandExecutionOutcome | null> {
  const config = await context.client.invoke({
    args: ["config", "--get-all", `remote.${remote}.fetch`],
    cwd: context.cwd,
    signal: context.signal,
    operationClass: "read",
  });
  const missingMapping =
    config.exitCode === 1 &&
    config.stderr.length === 0 &&
    !config.cancelled &&
    !config.timedOut &&
    config.spawnError === null;

  if ((!config.ok && !missingMapping) || isTruncatedOutput(config)) {
    return { steps: [toCommandStep(config)], failed: true };
  }

  return config.stdout.split(/\r?\n/).some(canFetchIntoLocalHeads)
    ? { steps: [], blockedReason: "unsafe-fetch-refspec" }
    : null;
}

/**
 * Checks whether a refspec destination overlaps refs/heads, including mirror wildcard mappings.
 * Unqualified destinations are refused because git may resolve them as local branch names.
 * @param refspec - One configured fetch mapping, possibly forced or negative.
 * @returns True when the destination could modify a local branch.
 */
function canFetchIntoLocalHeads(refspec: string): boolean {
  const separator = refspec.indexOf(":");

  if (separator < 0 || refspec.startsWith("^")) {
    return false;
  }

  const destination = refspec.slice(separator + 1).trim();

  if (destination.length === 0) {
    return false;
  }

  if (!destination.startsWith("refs/")) {
    return true;
  }

  if (!destination.includes("*")) {
    return destination === "refs/heads" || destination.startsWith("refs/heads/");
  }

  const prefix = destination.split("*")[0] ?? destination;
  return prefix.startsWith("refs/heads/") || "refs/heads/".startsWith(prefix);
}
