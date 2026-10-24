import type { CommandResult } from "@/domain/commands/commands.types";

/** Replacement written wherever a credential is removed. */
const REDACTED = "[redacted]";

/** Matches the user-information part of a URL, with or without a password. */
const URL_CREDENTIAL_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)([^/\s@]+)@/gi;

/** Matches authorization and proxy-authorization headers. */
const AUTHORIZATION_HEADER_PATTERN = /((?:proxy-)?authorization\s*:\s*)([^\r\n]+)/gi;

/** Matches environment assignments whose name marks a credential. */
const CREDENTIAL_ENVIRONMENT_PATTERN =
  /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|CREDENTIAL)[A-Z0-9_]*)(\s*=\s*)("[^"]*"|'[^']*'|[^\s]+)/gi;

/** Matches a bearer token that appears outside a header. */
const BEARER_TOKEN_PATTERN = /\b(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;

/**
 * Redacts credentials and secrets from captured git output.
 *
 * The function is linear in the input size and idempotent: redacting already redacted text changes
 * nothing. It covers credential-bearing URLs, authorization headers, bearer tokens, and
 * environment assignments whose name marks a token, secret, password, API key, access key, or
 * credential. It never removes surrounding command text, so the console entry stays diagnosable.
 *
 * @param value - Raw stdout, stderr, argv element, or error message.
 * @returns The text with credential values replaced by `[redacted]`.
 */
export function redactText(value: string): string {
  return value
    .replace(URL_CREDENTIAL_PATTERN, `$1${REDACTED}@`)
    .replace(AUTHORIZATION_HEADER_PATTERN, `$1${REDACTED}`)
    .replace(CREDENTIAL_ENVIRONMENT_PATTERN, `$1$2${REDACTED}`)
    .replace(BEARER_TOKEN_PATTERN, `$1${REDACTED}`);
}

/**
 * Redacts every element of a captured argv array.
 *
 * A URL or token can appear as an argument, for example in `git remote add` or a credential helper
 * invocation, so the console applies the same redaction to argv as it does to output.
 *
 * @param argv - Captured executable and arguments.
 * @returns A new array with credential values redacted.
 */
export function redactArgv(argv: readonly string[]): readonly string[] {
  return argv.map((argument) => redactText(argument));
}

/**
 * Redacts every captured field of a command result.
 *
 * The orchestrator calls this once before storing or rendering a result, so the console entry, the
 * error sink, and the status message cannot leak a credential that appeared in a URL, an argument,
 * or captured output. The result shape is preserved so later steps keep their order and flags.
 *
 * @param result - Raw command result returned by the runner.
 * @returns A new result with redacted argv, working directory, stdout, and stderr.
 */
export function redactCommandResult(result: CommandResult): CommandResult {
  return {
    ...result,
    cwd: redactText(result.cwd),
    steps: result.steps.map((step) => ({
      ...step,
      argv: redactArgv(step.argv),
      stdout: redactText(step.stdout),
      stderr: redactText(step.stderr),
    })),
  };
}
