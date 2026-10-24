import { classifyGitFailure } from "./git.errors";
import type { GitClient, GitReadOptions, RemoteInfo, RemoteReadResult } from "./git.types";

/**
 * Reads the configured remotes with `git remote -v`.
 *
 * An empty list is a valid result and maps to the `no-remote` repository state. The read never
 * throws for a git failure; it returns the classified failure so the caller can surface it.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @returns Configured remotes or the classified failure.
 */
export async function readRemotes(
  client: GitClient,
  options: GitReadOptions,
): Promise<RemoteReadResult> {
  const result = await client.invoke({
    args: ["remote", "-v"],
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  if (!result.ok) {
    return { ok: false, remotes: [], failure: classifyGitFailure(result) };
  }

  return { ok: true, remotes: parseRemoteVerbose(result.stdout), failure: null };
}

/**
 * Parses `git remote -v` output into remote records.
 *
 * Each line is `<name>\t<url> (fetch|push)`. A URL can contain spaces, so only the trailing
 * `(fetch)` or `(push)` marker is stripped. The push URL is reported as null when it matches the
 * fetch URL, which keeps a single-URL remote from looking like two configurations.
 *
 * @param stdout - Captured `git remote -v` output.
 * @returns Remotes in first-seen order.
 */
export function parseRemoteVerbose(stdout: string): readonly RemoteInfo[] {
  const remotes = new Map<string, { fetchUrl: string | null; pushUrl: string | null }>();

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const separator = trimmed.indexOf("\t");

    if (separator < 0) {
      continue;
    }

    const name = trimmed.slice(0, separator);
    const target = trimmed.slice(separator + 1);
    const kind = readRemoteUrlKind(target);

    if (name.length === 0 || kind === null) {
      continue;
    }

    const current = remotes.get(name) ?? { fetchUrl: null, pushUrl: null };

    if (kind.kind === "fetch") {
      current.fetchUrl = kind.url;
    } else {
      current.pushUrl = kind.url;
    }

    remotes.set(name, current);
  }

  return [...remotes.entries()].map(([name, urls]) => ({
    name,
    fetchUrl: urls.fetchUrl,
    pushUrl: urls.pushUrl !== null && urls.pushUrl !== urls.fetchUrl ? urls.pushUrl : null,
  }));
}

/**
 * Reads the URL and direction from one `git remote -v` target.
 *
 * @param target - Text after the remote name.
 * @returns The URL and direction, or null for an unrecognized line.
 */
function readRemoteUrlKind(target: string): { url: string; kind: "fetch" | "push" } | null {
  const fetchSuffix = " (fetch)";
  const pushSuffix = " (push)";

  if (target.endsWith(fetchSuffix)) {
    return { url: target.slice(0, -fetchSuffix.length), kind: "fetch" };
  }

  if (target.endsWith(pushSuffix)) {
    return { url: target.slice(0, -pushSuffix.length), kind: "push" };
  }

  return null;
}
