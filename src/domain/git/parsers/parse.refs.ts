import type { TagRecord } from "../git.types";

/** NUL field separator used by the recorded `for-each-ref` formats. */
const FIELD_SEPARATOR = "\0";

/** Number of atoms in the local tag format. */
const TAG_FIELD_COUNT = 6;

/** Ref namespace prefix of an advertised tag. */
const TAG_REF_PREFIX = "refs/tags/";

/**
 * Suffix git appends to the peeled line of an annotated tag in `ls-remote` output.
 *
 * The peeled line repeats the tag name with this suffix, so it is collapsed into the tag name
 * instead of producing a second entry.
 */
const PEELED_REF_SUFFIX = "^{}";

/**
 * Parses `git for-each-ref refs/tags` output into local tag records.
 *
 * The recorded format is
 * `%(refname:short)%00%(objecttype)%00%(*objectname)%00%(objectname)%00%(*subject)%00%(subject)`.
 * An annotated tag (`objecttype` is `tag`) points at a tag object, so its target is the peeled
 * `%(*objectname)` and its summary is `%(*subject)`; using `%(subject)` there would show the tag
 * message instead of the commit subject. A lightweight tag (`objecttype` is `commit`) uses
 * `%(objectname)` and `%(subject)`. Tags that point at a tree or a blob are skipped because a tag
 * row needs a commit to select in the graph.
 *
 * @param stdout - Captured `for-each-ref refs/tags` output.
 * @returns Local tags in git order, with malformed records skipped.
 */
export function parseLocalTags(stdout: string): readonly TagRecord[] {
  const tags: TagRecord[] = [];

  for (const line of stdout.split("\n")) {
    const tag = parseLocalTagRecord(line);

    if (tag !== null) {
      tags.push(tag);
    }
  }

  return tags;
}

/**
 * Parses one NUL-separated local tag record.
 *
 * @param line - Raw output line, possibly ending in a carriage return.
 * @returns The tag record, or null for a malformed or non-commit record.
 */
function parseLocalTagRecord(line: string): TagRecord | null {
  const columns = line.replace(/\r$/, "").split(FIELD_SEPARATOR);

  if (columns.length !== TAG_FIELD_COUNT) {
    return null;
  }

  const [name, objectType, peeledOid, objectOid, peeledSubject, subject] = columns;

  if (name === undefined || name.length === 0) {
    return null;
  }

  if (objectType === "tag") {
    return createTagRecord(name, "tag", peeledOid, peeledSubject);
  }

  if (objectType === "commit") {
    return createTagRecord(name, "commit", objectOid, subject);
  }

  return null;
}

/**
 * Builds one tag record from the atoms selected for its object type.
 *
 * @param name - Short tag name.
 * @param objectType - Annotated or lightweight object type.
 * @param targetOid - Commit the tag points at; may be missing on a malformed record.
 * @param subject - Commit subject; may be missing on an empty commit message.
 * @returns The tag record, or null when the target commit is unknown.
 */
function createTagRecord(
  name: string,
  objectType: "tag" | "commit",
  targetOid: string | undefined,
  subject: string | undefined,
): TagRecord | null {
  if (targetOid === undefined || targetOid.length === 0) {
    return null;
  }

  return { name, objectType, targetOid, subject: subject ?? "" };
}

/**
 * Parses advertised tag names from `git ls-remote --tags` output.
 *
 * Each line is `<oid>\trefs/tags/<name>`, and an annotated tag adds a peeled line whose ref ends in
 * `^{}`. Both lines resolve to the same tag name, so the result contains each advertised name once
 * in first-seen order. Blank and malformed lines, refs outside `refs/tags`, and peeled refs with an
 * empty name are ignored.
 *
 * @param stdout - Captured `ls-remote --tags` output.
 * @returns Advertised tag names in first-seen order.
 */
export function parseLsRemoteTags(stdout: string): readonly string[] {
  const names = new Set<string>();

  for (const line of stdout.split("\n")) {
    const name = readAdvertisedTag(line);

    if (name !== null) {
      names.add(name);
    }
  }

  return [...names];
}

/**
 * Reads the tag name from one `ls-remote --tags` line.
 *
 * @param line - Raw output line.
 * @returns The tag name with any peeled suffix removed, or null for an unusable line.
 */
function readAdvertisedTag(line: string): string | null {
  const trimmed = line.trim();

  if (trimmed.length === 0) {
    return null;
  }

  const separator = trimmed.indexOf("\t");

  if (separator <= 0) {
    return null;
  }

  const ref = trimmed.slice(separator + 1).trim();
  const normalized = ref.endsWith(PEELED_REF_SUFFIX)
    ? ref.slice(0, -PEELED_REF_SUFFIX.length)
    : ref;

  if (!normalized.startsWith(TAG_REF_PREFIX)) {
    return null;
  }

  const name = normalized.slice(TAG_REF_PREFIX.length).trim();

  return name.length === 0 ? null : name;
}
