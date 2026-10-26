import ts from "typescript";

/** Repository path of the privileged git client module. */
export const GIT_CLIENT_PATH = "src/domain/git/git.client.ts";

/** Repository path of the test-only git fixture module. */
export const GIT_FIXTURE_PATH = "src/test/git.fixture.ts";

/** Repository path of the git filesystem watcher module. */
const GIT_WATCHER_PATH = "src/domain/git/git.watcher.ts";

/** Repository path of the git diff and file-action module. */
const GIT_DIFF_PATH = "src/domain/git/git.diff.ts";

/** Repository path of the shared path helper module. */
const PATHS_HELPER_PATH = "src/lib/paths.ts";

/** Repository path of the only module allowed to perform network calls. */
export const UPDATE_CHECK_PATH = "src/domain/update/update.check.ts";

/** Repository path of the only module allowed to define hex colors. */
export const THEME_COLORS_PATH = "src/domain/theme/theme.catppuccin.ts";

/** Repository path prefix of the config modules. */
export const CONFIG_MODULE_PREFIX = "src/domain/config/";

/** Node builtins allowed in every module under `src/domain/config/`. */
export const CONFIG_BUILTIN_ALLOWLIST: ReadonlySet<string> = new Set([
  "node:fs",
  "node:fs/promises",
  "node:path",
  "node:os",
]);

/** Node builtins allowed in a specific domain or lib module. */
export const BUILTIN_ALLOWLIST_BY_PATH: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [GIT_CLIENT_PATH, new Set(["node:child_process", "node:path"])],
  [GIT_WATCHER_PATH, new Set(["node:fs", "node:fs/promises", "node:path"])],
  [GIT_DIFF_PATH, new Set(["node:fs/promises", "node:path"])],
  [PATHS_HELPER_PATH, new Set(["node:path", "node:os"])],
]);

/** Matches React (including subpaths) and OpenTUI package imports. */
export const UI_PACKAGE_PATTERN = /^(?:@opentui\/|react(?:\/|$))/i;

/** Matches a six, four, three, or eight digit hex color literal. */
export const HEX_COLOR_PATTERN =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/;

/** File base names that are forbidden by the naming contract. */
export const FORBIDDEN_FILE_NAMES: ReadonlySet<string> = new Set([
  "utils",
  "helpers",
  "common",
  "misc",
]);

/** Module specifiers that expose a test runner and are allowed only in tests. */
export const TEST_RUNNER_SPECIFIERS: ReadonlySet<string> = new Set(["bun:test", "node:test"]);

/** Module specifiers that can spawn a process. */
export const SPAWN_MODULES: ReadonlySet<string> = new Set(["node:child_process", "child_process"]);

/** Module specifiers that can open a network connection. */
export const NETWORK_MODULES: ReadonlySet<string> = new Set([
  "node:http",
  "node:https",
  "node:http2",
  "node:net",
  "node:dgram",
  "node:tls",
  "undici",
]);

/** `Bun` members that spawn a process or run a shell command. */
export const BUN_SPAWN_MEMBERS: ReadonlySet<string> = new Set(["spawn", "spawnSync", "shell", "$"]);

/** `Bun` members that perform network access. */
export const BUN_NETWORK_MEMBERS: ReadonlySet<string> = new Set(["fetch", "connect"]);

/** Key fields whose string comparisons belong to the keymap layer only. */
export const RAW_KEY_FIELD_NAMES: ReadonlySet<string> = new Set([
  "name",
  "sequence",
  "raw",
  "code",
]);

/** Binary operators that compare two values for equality. */
export const EQUALITY_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

/** Repository path prefixes where raw key comparisons are allowed. */
export const RAW_KEY_ALLOWED_PREFIXES = ["src/domain/keymap/"];

/** Repository paths where raw key comparisons are allowed before the keymap mounts. */
export const RAW_KEY_ALLOWED_PATHS: ReadonlySet<string> = new Set([
  "src/app/hooks/useHotkeys.ts",
  "src/app/quit.key.ts",
]);

/** Receiver names that hold a key event in every file. */
export const KEY_RECEIVER_NAME = "key";

/** Receiver suffixes that hold a key event in every file. */
export const KEY_RECEIVER_SUFFIX_PATTERN = /Key$/;

/** Short receiver names that hold a key event only in a key-aware file. */
export const KEY_AWARE_RECEIVER_NAMES: ReadonlySet<string> = new Set(["e", "ev", "event"]);

/** Receiver suffixes that hold a key event only in a key-aware file. */
export const KEY_AWARE_RECEIVER_SUFFIX_PATTERN = /Event$/;

/** Identifiers that make a file key-aware for bare key-field comparisons. */
export const KEY_AWARE_IDENTIFIERS: ReadonlySet<string> = new Set(["KeyEvent", "useKeyboard"]);

/** Key fields that make a file key-aware when accessed on `key`. */
export const KEY_AWARE_FIELDS: ReadonlySet<string> = new Set(["name", "sequence"]);

/** Node kinds that wrap an inner expression used for key-field detection. */
export const WRAPPER_KINDS: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.NonNullExpression,
  ts.SyntaxKind.AsExpression,
  ts.SyntaxKind.SatisfiesExpression,
  ts.SyntaxKind.TypeAssertionExpression,
]);

/** Layer prefix a feature may import from the app hooks. */
export const FEATURE_APP_HOOKS_PREFIX = "src/app/hooks/";

/** Layer prefix a feature may import provider hooks from. */
export const FEATURE_APP_PROVIDERS_PREFIX = "src/app/providers/";

/** Layer prefixes a feature may import from the shared source layers. */
export const FEATURE_SHARED_PREFIXES = ["src/ui/", "src/domain/", "src/lib/", "src/theme/"];
