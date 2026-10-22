# gitminal

A terminal UI for real git repositories, built with [Ink](https://github.com/vadimdemedes/ink). gitminal reads and changes the repository through the `git` CLI: branch and file status, stage/unstage/discard, commits, the commit log with graph, per-file diffs, branches, remote operations with live progress, an operation console, and a filterable command palette.

## Requirements

- Node.js 20.15 or newer. Node 20.15 contains the recursive-watch setup fix, because Linux Node 20.12 to 20.14 can crash on watcher close after a watched file is removed during setup.
- The `git` CLI on `PATH`. gitminal does not ship or reimplement git; without the binary it shows a `git not found` screen with install instructions.
- A normal repository or a linked worktree. Bare repositories are detected and reported, but not supported yet.

## Run

Install globally:

```sh
npm install --global gitminal
gitminal
```

Or run from a checkout:

```sh
npm install
npm run build
node dist/cli.js
```

Start gitminal inside a git repository. Launching from a nested subdirectory works: every command runs from the resolved repository root, so status paths and mutations stay consistent. Press `q` to quit.

A linked worktree is supported, including one whose `.git` is a file. The sidebar lists the repository's worktrees, and live sync watches the shared common git directory.

## Configuration

gitminal reads an optional JSON config file from, in order:

- `$GITMINAL_CONFIG` when set and non-empty.
- `$XDG_CONFIG_HOME/gitminal/config.json` when `XDG_CONFIG_HOME` is set.
- `~/.config/gitminal/config.json` otherwise.

Every field is optional; anything missing keeps its default. The only current section is `keybindings`. An invalid or unreadable config is ignored and a warning is printed to stderr.

```json
{
	"keybindings": {
		"quit": ["q", "escape"],
		"toggle-console": ["ctrl+l"]
	}
}
```

A key spec is `modifier+key`, for example `ctrl+c`, `shift+tab`, `alt+left`, or just `left`, `enter`, `escape`, `tab`, `backspace`, `delete`, `pageup`, `pagedown`, `q`. Recognized modifiers are `ctrl` (alias `control`), `shift`, and `alt` (aliases `option`, `meta`). Overriding an action replaces its default list.

## Keybindings

Defaults are:

- `quit` - exit gitminal (`q`).
- `pull` - run `git pull` (`p`).
- `push` - run `git push` (`shift+p`).
- `toggle-mouse` - enable or disable mouse reporting, for example to select text (`m`).
- `open-remote-menu` - open the remote operations menu (`.`).
- `focus-commit` - focus the commit message input (`c`). Escape blurs it; Enter inserts a newline.
- `commit` - commit the staged index while the message is focused (`ctrl+s`).
- `refresh` - reload repository status manually (`r`).
- `toggle-console` - show or hide the operation console (`` ` ``).
- `open-command-palette` - open the filterable command palette (`ctrl+p`). Rebind it to a ctrl/alt-modified or non-printable key: a printable binding is also delivered while typing, so it could open the palette from the commit box or close it while typing a query. tmux and screen may use `ctrl+p` for their own prefix, so choose another key if the palette does not open there.
- `move-down` - move a menu or palette selection down (`down`).
- `move-up` - move a menu or palette selection up (`up`).
- `page-down` - scroll the operation console or the error overlay one page down (`ctrl+d`, `ctrl+f`).
- `page-up` - scroll the operation console or the error overlay one page up (`ctrl+u`).
- `activate-selection` - run the highlighted menu or palette entry, confirm a dialog, or open the newest failure's details (`enter`).
- `close-overlay` - close the current overlay, or the console when it is open (`escape`).

## Repository view

The toolbar shows the checked-out branch, its upstream relation and ahead/behind counts, the newest operation result, and the pull/push buttons. The sidebar lists local branches, remotes, tags, stashes, submodules, and worktrees. The explorer switches between the commit log and the working files, and the right panel holds the commit message box plus the grouped working tree (tracked changes, untracked paths, conflicts).

Stage and unstage are per file or per group. Discard a single untracked path only after a confirmation dialog; bulk discards always ask first. Discarding all changes restores tracked paths to the index version and deletes untracked paths permanently, and the dialog says so. Conflicts are staged with `git add`; an observed merge-origin path can only be un-staged through `Recreate Conflict` (`git checkout -m`), because a plain staged restore would silently drop its unmerged stages.

## Operation queue and timeouts

Every mutation runs through one serialized queue, so concurrent clicks cannot race the index. Local mutations include stage, unstage, discard, recreate-conflict, commit, branch switch, and branch create. Bulk path operations are chunked at about 100 paths per git command so argv stays bounded.

- Local mutations get a 60 second timeout per git command. Bulk path operations are chunked, so the 60 seconds bounds one stuck command, not the whole operation; a large stage or discard can take several 60 second windows.
- Remote operations (pull, fetch, fetch --prune, push variants) get a 30 second timeout per git command.
- Read-only commands (status, log, refs, diffs) get a 120 second timeout so a hung read cannot hold the single refresh slot indefinitely.
- On timeout the process group is killed (`SIGKILL` on the detached group) on POSIX, including transport children such as `ssh` or `git-remote-https`, so no orphaned child keeps the pipes open.
- On Windows a timeout uses `taskkill /pid <pid> /T /F` to terminate the process tree, with a direct child kill as the fallback. If a transport child still holds the output pipes open, a one second force-settle releases the command and reports the timeout, so the queue cannot remain busy after a timeout kill.
- On a normal quit gitminal kills every tracked git process group (POSIX group kill; the `taskkill` tree on Windows), both when Ink unmounts and when the process reaches its `exit` event. A signal that terminates the process outside those paths can bypass the cleanup, because Ink owns signal handling and terminal restoration.

A remote request that arrives while the queue is busy is ignored rather than queued, and the status line shows a short `ignored: busy` hint.

## Progress and the console

Remote commands run with `--progress`. A stateful parser turns the stderr stream into phases (`Enumerating objects`, `Compressing objects`, `Receiving objects`, `Writing objects`, and so on). The status line renders a progress bar when a percentage is known and a spinner plus the phase name otherwise. Updates are throttled to roughly 10 per second so a large transfer cannot cause a render storm.

The operation console (toggled with the backtick key) is a non-modal panel showing each command's time, status, label, argv, duration, and either its progress phase or its failure summary. It keeps a ring of about 200 entries and never stores per-chunk progress rows; only coalesced phase updates reach the UI. Failed console rows open the full error overlay when clicked.

## Large repositories

- The commit log starts with a 500 commit window and loads older commits when the selection reaches the bottom.
- A worktree-only refresh reuses the cached log and refs when HEAD, the branch, and a refs fingerprint are unchanged, so editing files does not re-run `git log` or the six refs commands. The fingerprint covers upstreams, worktrees, and submodules as well as branch, tag, remote, and stash refs. A failed or truncated probe forces the caches to miss on that load instead of trusting a partial digest.
- Parsed diffs stop at 2000 lines or 256 KB with a `diff truncated` header row.
- Untracked and conflicted files above 1 MB are not diffed; the row shows a note instead.
- Error output stored on a failure is capped at roughly 400 lines or 64 KB while keeping the first and last 200 lines, and the error overlay applies the same first/last cap with an explicit omitted-lines row.

## Live sync

gitminal watches the repository's common git directory with a recursive `fs.watch` and a trailing debounce of about 250 ms. Changes made by git in another terminal (stage, commit, fetch, branch switch, merge, stash) appear without a manual refresh. A linked worktree watches the shared common directory, so refs and fetched updates arrive there too.

Plain file edits in the worktree do not touch the git directory and therefore do not trigger the watcher. Press `r` (`refresh`) after editing files outside gitminal. Watching the worktree itself is intentionally not enabled.

If the watcher cannot start or later fails, gitminal keeps working and shows a `live sync unavailable; refresh manually` hint for the session, with the reason in the console.

## Remotes and force push

Pull, fetch, fetch --prune, push, and push --no-verify run real git commands from the toolbar, the remote menu, the keybindings, and the command palette.

The menu entry `push --force` runs `git push --force-with-lease`, not a bare `--force`, so it refuses to overwrite a remote commit this clone has not fetched. Fetch first if the lease is stale.

Git runs with prompts disabled (`GIT_TERMINAL_PROMPT=0` and `GIT_SSH_COMMAND='ssh -o BatchMode=yes'`), so missing credentials, passphrase prompts, and host-key prompts fail fast and classify into a short status summary instead of hanging the TUI. The error overlay keeps a capped first-and-last portion of the captured output (about 400 lines or 64 KB, with an omitted-lines marker) so the decisive `fatal:` line stays visible. The command palette dims remote commands outside a repository; the toolbar and keybindings still attempt them and report `not in a repo` in the operation log instead.

## Command palette

`ctrl+p` opens a filterable list of every app command. Empty queries list recently run commands first (up to five, session-only), then catalog order. With a query, label-prefix matches beat substrings, subsequences, and section matches; recency only breaks exact ties after match tier, subsequence tightness, and match position. Unavailable commands stay visible but dimmed with a short reason such as `nothing to commit`, `message is empty`, `no changes to stage`, `nothing staged`, `merge-resolved`, `nothing to discard`, `no other branches`, or `not in a repo`. Remote commands have the `not in a repo` gate; refresh and toggle-console stay available outside a repository.

## Scratch toolkit

The generator creates disposable repositories and parser fixtures. It uses a fixed identity and fixed commit dates, and it isolates itself from the machine's global git config, so repeated runs land on the same state. The scratch toolkit is POSIX-only: the scenarios rely on symlinks, executable chmod bits, and literal glob/magic filenames, so the generator expects a POSIX filesystem.

```sh
node scripts/make-scratch-repos.mjs [--dir <path>] [--big]
```

`--dir` defaults to `./scratch/`; `--big` adds the large stress repository. The owned repositories are wiped and rebuilt on every run.

Scenarios include:

- `basic/` - commits with a merge, branches, tags, a tracked bare origin, staged/unstaged/untracked changes, and an untracked directory.
- `empty/` - `git init` only.
- `conflicted/` - a merge left with unmerged paths.
- `detached/` - a detached HEAD.
- `remote/`, `remote-stale/`, `remote-pull/`, `remote-clean/`, `remote-other/` - remote pairs arranged for non-fast-forward rejection, stale force-with-lease, fast-forward pull, and a successful push.
- `remote-bad-auth/` and `remote-unreachable/` - a fake auth server and a closed local port.
- `hooks/` and `slow/` - a failing pre-commit hook and a hook that sleeps about two seconds.
- `edge-cases/` - a staged rename, an unstaged rename, a modified binary, a mode-only chmod, a file-to-symlink typechange, weird filenames (spaces, unicode, a double quote, a tab, pathspec glob/magic names including a leading-colon `:(exclude)magic.txt`, and plain decoys for the three glob rows), a >1 MB untracked file, and a tracked file with 2100 changed lines.
- `worktree-main/` and `worktree-linked/` - a linked worktree whose `.git` is a file.
- `big/` (with `--big`) - about 680 commits and 300 tracked files, with the last 40 commits unpushed so a live push has objects to transfer. The first 500 commits load immediately; older pages are available at the bottom of the log.

Parser fixtures from `basic/` and `big/` are written to `scripts/fixtures/`.

For auth failure and timeout verification, start the local fake server in a second terminal:

```sh
node scripts/fake-auth-server.mjs --mode=401
node scripts/fake-auth-server.mjs --mode=stall
```

`--mode=401` returns a smart-http 401 so the auth classification can be checked offline. `--mode=stall` accepts and then stalls, so the 30 second remote timeout and process-group kill can be observed without network access.

Manual verification against these repositories is the gate. There is no unit-test suite, and no unit tests are scheduled.

## Development

```sh
npm run build   # tsc
npm run lint    # prettier --check . && xo
```

After a build, the focused check scripts run the built modules against real git:

```sh
node scripts/check-remote-errors.mjs   # remote failure classification and overlay rendering
node scripts/check-text-input.mjs      # Backspace/Delete keystroke classification
node scripts/check-pathspecs.mjs       # literal pathspec isolation and hook environment
node scripts/check-hardening.mjs       # capped output and truncated reads
```
