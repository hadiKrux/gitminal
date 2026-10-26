# Gitminal Product Specification

Status: Draft for review
Last updated: 2026-10-22
Scope: Product behavior for v1. No implementation or architecture decisions.
Visual reference: [`gitminal.png`](../gitminal.png) is the authoritative UI mockup. The app must look like it: same four-region frame, three main columns, panel order, top-bar controls, commit graph layout, right-pane split, diff presentation, and footer hints. When this document and the mockup disagree on visual arrangement, the mockup wins; behavior is still governed by this document. The mockup is embedded in `docs/technical-implmentations/01-app-shell-and-focus.md`.

## 1. Product summary

Gitminal is a keyboard-first terminal git client. It opens inside a local git repository and gives the user one screen for reviewing history, inspecting changes, staging files, committing, and running common remote operations.

The product is for developers who already work in a terminal but do not want to leave it to inspect history, stage files, write a commit, or push a branch.

### Product goals

- Make the state of the repository visible at a glance: current branch, sync state, history, working tree changes, staged files, and untracked files.
- Make common git workflows fast from the keyboard without hiding what git is doing.
- Make destructive actions explicit and confirmed.
- Stay close to real git behavior. The app uses the system git CLI, respects git configuration and hooks, and logs the commands it runs.
- Remain usable with a mouse, but never require one.

### Product principles

1. Context is visible. The focused region, selected item, available actions, and keyboard hints are always clear.
2. Keyboard first. Every action has a keyboard path. Mouse support is an addition, not the primary model.
3. Safe by default. Discarding, deleting, dropping stashes, and force pushing always require confirmation. Nothing destructive happens as a side effect of navigation.
4. Real repository state. The UI reflects git refs and the index, not a private model. External git changes are picked up or can be refreshed.
5. No silent failure. Every git failure is visible, keeps the user's work intact, and records the command in the console.
6. One mutation at a time. Conflicting operations are blocked while another write is running.

### v1 scope

All features listed in this document are in v1 unless marked as deferred.

### Deferred beyond v1

- Commit actions such as revert, reset, cherry-pick, and checkout of a commit.
- Merge, rebase, and interactive rebase workflows.
- Partial hunk and line staging.
- Full visual conflict resolution with ours/theirs actions.
- Submodules, Git LFS, sparse checkout, and advanced worktree cases.
- Pull request and forge integrations.
- Blame and file history.
- Advanced commit search filters such as regex, author, hash, path, and date ranges.
- Side-by-side diff.
- Opening files in an external editor.
- Multiple repositories in one process.
- Settings UI, non-Catppuccin built-in themes, automatic light/dark switching, and configurable layout.
- Account, credential, and SSH key management.

## 2. Glossary

- Repository: the git repository containing the directory where the app was launched.
- Working tree: tracked files with unstaged modifications, deletions, or renames.
- Index or staged files: changes that will be included in the next commit.
- Untracked files: files that git does not track yet.
- Pending Changes row: the first row of the commit graph. It represents the working tree plus untracked files and selects the commit composer.
- Upstream: the remote branch tracked by the current local branch.
- Missing upstream: a local branch has a configured upstream but its remote-tracking ref is absent locally. After a successful fetch or fetch --prune confirms the absence, the state is "remote branch deleted".
- Missing-upstream indicator: the `[?]` badge shown on a branch with a missing upstream.
- Ahead / behind: the number of local commits not on the upstream / upstream commits not local. Counts are based on the last fetched remote refs.
- Refs badges: branch and tag labels shown on a commit.
- Destructive action: an action that loses work or rewrites shared history, such as discard, delete untracked file, drop stash, delete branch, delete worktree, delete tag, or force push.
- Context key: a keybinding that is active because a particular region or item type has focus.
- Global key: a keybinding that is active unless a higher-precedence context overrides it.

## 3. Application shell

### Layout

```text
+--------------------------------------------------------------------------+
| Gitminal | main  origin/main  ahead 2  behind 1   [Pull] [Push] [.]       |
+-------------+---------------------------------+--------------------------+
| Branches    | Commits                         | Commit message...        |
| ...         | ...                             | author <email>  [.][Commit]
|             |                                 +--------------------------+
| Remotes     |                                 | Diffs                    |
| ...         |                                 | v Working Directory      |
|             |                                 |   ...                    |
| Tags        |                                 | > Staged Files           |
| ...         |                                 | > Untracked Files        |
| Stashes     |                                 |                          |
| ...         |                                 |                          |
| Worktrees   |                                 |                          |
| ...         |                                 |                          |
+-------------+---------------------------------+--------------------------+
| Keyboard hints: n New branch | d Delete branch | p Pull | ? Keybindings  |
+--------------------------------------------------------------------------+
```

The text below is a behavioral summary. The authoritative visual target is the mockup in [`gitminal.png`](../gitminal.png). The app must match its layout: sidebar on the left with Branches, Remotes, Tags, Stashes, and Worktrees stacked in that order; commit graph in the middle column; commit composer above diffs in the right column; top bar across the full width; footer hint bar at the bottom.

The visible layout has four regions:

- Top bar: repository path, current branch and sync state, a center status strip for operation progress and transient status messages, and remote actions.
- Sidebar: five independently scrollable panels: Branches, Remotes, Tags, Stashes, Worktrees.
- Main area: commit graph on the left, commit composer or commit details plus diffs on the right.
- Footer: contextual keyboard hints and disabled reasons.

### Focus model

- Exactly one focus owner exists at a time: top bar, a sidebar panel, the commit graph, the right pane composer or details, the diff panel, the console, or an overlay.
- `Tab` and `Shift+Tab` move focus between regions.
- `1` through `9` focus a region directly. The digits follow screen order, not the Tab order: `1`-`5` are the Branches, Remotes, Tags, Stashes, and Worktrees panels, `6` is the commit graph, `7` is the right pane, `8` is the Diff panel, and `9` is the console. Direct jumps do not fire while a text input or an overlay owns keys; the digit goes to the field. The top bar has no digit and stays reachable with `Tab`, a click, or the Focus Top Bar command.
- Clicking a region focuses it.
- Arrow keys and `j` / `k` move within the focused region.
- `Esc` closes an overlay. With no overlay, it clears the current transient state, then returns focus to the previous region.
- Focus is shown with a visible border and a selection marker, not color alone.
- Keyboard hints and help always use the effective bindings from configuration, not the built-in defaults.
- Each list keeps its own cursor when focus moves away and back.

### Key precedence

Keys resolve in this order:

1. An open modal or overlay owns all keys except the app quit escape hatch and the toggle that closes that same overlay (`Ctrl/Cmd+P` for the palette, `?` for help). The console drawer is not a modal; its toggle remains global while it is open.
2. A text input owns printable keys, Backspace, Delete, arrow keys, Home, End, and Enter for newlines. A declared search input mode additionally routes Up, Down, PageUp, PageDown, Home, and End to its result list and Enter to the highlighted result, while printable keys keep editing the query. A declared form mode routes Tab and Shift+Tab between fields and actions and maps `Ctrl/Cmd+Enter` to form submit. Outside those declared modes, only app actions with a modified binding may fire while an input is focused.
3. Focused region context keys.
4. Global keys.
5. Unhandled keys are ignored.

This precedence resolves overlaps such as `p` meaning Pull in the top bar or commit graph, but Pop stash when the Stashes panel is focused. The footer shows the effective action, not every possible binding. The three input modes (`field`, `search`, `form`) are part of keymap resolution, so a search field can keep typing while Up and Down move results without weakening the general rule that a plain field owns its keys.

### Footer keyboard hints

- The footer shows hints for the focused region first, then relevant global hints.
- Hints change immediately when focus changes or when an action becomes available.
- If a context key overrides a global key, only the context action is shown.
- Destructive actions are shown only when the selected item supports them.
- While a git operation is running, the top bar middle section shows the phase and progress. The footer keeps the hint bar, because hints remain usable for navigation, console, and help while the operation runs.
- The footer still shows contextual disabled reasons, such as "message required", and modal keys. It does not duplicate operation progress or transient success messages.
- Success messages appear in the top bar status strip and, when relevant, in the console. Failures open a persistent error overlay, appear in the top bar status strip while the overlay is open, and also appear in the console.
- The footer never wraps. The app hides the least important hints first and keeps Help available.
- Self-evident keys are documented in Help and the command palette instead of the footer: Tab and Shift+Tab traversal, Left and Right movement between controls, quit, the console toggle, the More menu trigger, and Esc cancel. The footer keeps the focused region's actions and the global hints whose usefulness changes with context, such as pull, fetch, refresh, and theme.
- Direct region jumps (`1`-`9`) are documented in Help and the command palette, not in the footer, so nine jump hints never crowd out the context hints.

### Mouse

- Single click focuses a region and selects an item.
- Clicking buttons activates them.
- Double click performs the primary action for an item, such as checkout for a branch or create-local-branch for a remote branch.
- Mouse wheel scrolls the hovered list or diff.
- Scrollbars are visible for overflowing panels and can be dragged.
- Mouse support never exposes an action that is unavailable from the keyboard.

### Layout sizes and fallbacks

- Target minimum terminal size is 100 columns by 30 rows.
- Below 100 columns, the sidebar narrows first, then collapses to a single active panel selected with `Tab`.
- Below 80 columns or 24 rows, the app shows a "Terminal too small" notice with the current and minimum size. It does not attempt an unusable layout.
- At narrow widths, commit messages, file paths, author names, and dates truncate. Truncation must not hide the current branch, the selection, or the primary action.

### Application lifecycle

- On launch, the app shows a full-screen startup splash before the workspace: the `GITMINAL` wordmark, the running version, an optional update notice, and a press-any-key hint.
- Any key dismisses the splash and opens the workspace. `Ctrl+C` quits.
- The startup update check runs in the background while the splash is visible and never blocks the splash or the workspace. See F-21.
- The app opens in the current repository. If launched from a subdirectory, all paths are shown relative to the repository root.
- `q` quits when focus is not in a text input and no overlay is open.
- Quitting with an operation running, an unsent commit message, or an open confirmation asks for confirmation.
- The app restores the terminal before exit.

## 4. Feature catalog

| ID | Feature | Summary |
| --- | --- | --- |
| F-01 | App shell and focus | Four-region layout, focus model, contextual footer, mouse support, responsive fallbacks. |
| F-02 | Top bar | Current branch and sync state, Pull, Push, remote actions menu, operation feedback. |
| F-03 | Branches panel | Local branches, current marker, ahead/behind state, checkout, create, delete. |
| F-04 | Remotes panel | Remote-tracking branches, filter, create local branch with rename confirmation. |
| F-05 | Tags panel | Local and remote tags, unpushed indicator, create, push, delete locally or remotely. |
| F-06 | Stashes panel | Stash list, create with message, apply, pop, delete, stash diff. |
| F-07 | Worktrees panel | List worktrees, current marker, create, delete. |
| F-08 | Commit graph | History graph, pending changes row, merges, refs, tags, metadata, scrolling, lazy loading, commit search. |
| F-09 | Commit composer | Staged-only commit message box, identity, commit options, commit shortcut, reset. |
| F-10 | Commit details | Read-only details for a selected commit, including hashes, refs, parents, stats. |
| F-11 | Diffs and file actions | Working, staged, and untracked sections with per-file and bulk actions. |
| F-12 | Command palette | Searchable list of all commands with availability and recent history. |
| F-13 | Console | Command log with arguments, status, duration, output, and progress. |
| F-14 | Help | Searchable keymap and command reference. |
| F-15 | Overlays and confirmations | Standard modal behavior, destructive confirmations, validation, errors. |
| F-16 | Repository states | Empty, detached, conflicted, missing upstream, no remote, bare, non-repo, large repo. |
| F-17 | Freshness and performance | Refresh behavior, external changes, pagination, diff limits, virtualization targets. |
| F-18 | Safety and platform behavior | Data safety, credential handling, redaction, platform terminal behavior. |
| F-19 | Configuration and keybindings | User settings and full keyboard overrides from config.json and optional keybindings.json. |
| F-20 | Theme and colors | Catppuccin flavors with Mocha default, theme picker, theme.json color overrides, color capability fallbacks. |
| F-21 | Startup splash and update check | Startup wordmark, version, press-any-key dismiss, and a non-blocking npm update notice. |

## 5. Feature specifications

### F-01 App shell and focus

- The shell is persistent. Panels do not open as separate screens.
- Focus moves with `Tab` and `Shift+Tab` in this order unless an overlay is open: top bar, Branches, Remotes, Tags, Stashes, Worktrees, commit graph, right pane, diff panel.
- Focus order skips regions that are hidden by a responsive fallback.
- The active region has a clear border and selection marker.
- Each scrollable list shows a scrollbar only when content overflows.
- The footer hint bar is always visible, including when a modal is open, where it shows the modal keys.
- Transient status does not permanently replace hints.

Acceptance:

- Changing focus updates the highlighted region and the footer hints in the same render.
- Clicking a row selects it and focuses its region.
- Keyboard navigation never requires a mouse.

### F-02 Top bar

The top bar contains:

- Repository path as the frame's border title: the work-tree root, the bare git directory, or the launch directory when the path is not inside a work tree. A path under the home directory is shown with a leading `~`, and an overlong path is shortened from the start so its final segments stay readable.
- Current branch name on the left. Detached HEAD shows the short commit hash and a "detached" label.
- Upstream branch name when one exists.
- Ahead and behind counts when an upstream exists. Example text: "ahead 2" and "behind 1".
- A sync state badge: "up to date", "ahead", "behind", "diverged", "no upstream", or "upstream gone".
- Pull button.
- Push button.
- More button.
- A center status strip between the branch block and the buttons. When idle it shows the branch and sync state. During a git operation it shows the phase and progress. Transient success, warning, error, and informational messages also appear there.

Pull and Push are icon-only buttons, and the More button is icon-only too. Their order is Pull then Push then More. Their labels remain available to the action registry, footer, help, and palette.

#### Pull

- Runs a normal pull for the current branch and its upstream.
- Uses the user's git configuration for pull strategy unless a product setting says otherwise.
- Requires a current branch and an upstream. If the branch has no upstream, Pull is unavailable and explains that Push will create `origin/<local-branch-name>` first.
- If the configured upstream ref is missing or confirmed deleted, Pull is unavailable and explains that Push can recreate the upstream branch.
- Detached HEAD cannot pull.

#### Push

- Pushes the current branch to its upstream.
- If the branch has no upstream, Push automatically creates `origin/<local-branch-name>`, pushes the branch, and sets it as the upstream. There is no extra set-upstream modal.
- The app shows a short status such as "Creating origin/feature/AB-1231 and setting upstream" before and after the operation, and logs the command in the console.
- Auto-creation uses the remote named `origin`. If no `origin` remote exists, the push fails with a clear error listing the configured remotes. The app does not guess another remote in v1.
- If `origin/<branch>` already exists and the push is not a fast-forward, the push fails and leaves the local branch unchanged. The app does not force.
- If the branch has a configured upstream but the remote branch is gone, Push recreates the configured upstream branch rather than creating `origin/<branch>` under a different name.
- Push --no-verify uses the same auto-create behavior when no upstream exists.
- Force push variants require an existing upstream. When there is no upstream, they are disabled with the reason "no upstream; use Push to create it first."
- Detached HEAD cannot push.
- After a successful push that created the remote branch, the top bar shows the new upstream and zero ahead/behind.

#### More menu

The More menu is a modal list navigated with arrows or `j` / `k` and activated with `Enter`. It contains:

- Fetch.
- Fetch --prune.
- Push force (safe), which runs `--force-with-lease`.
- Push force (overwrite), which runs literal `--force`.
- Push --no-verify.

The menu shows why an item is unavailable, for example "no remote" or "detached HEAD". Additional items may be added only if they fit the same safety model.

Fetch and Fetch --prune follow the configured fetch scope. The default scope is the upstream refs of all local branches. There is no fetch-all action in v1.

Both force options open a confirmation that names the branch and remote. The safe option explains that it refuses to overwrite commits this clone has not fetched. The overwrite option uses a stronger warning and explains that remote commits not present locally can be lost. The safe option is visually primary; the overwrite option is never the default focused action.

Fetch is scoped to the Branches panel. It fetches only the upstream refs of local branches, grouped by remote and deduplicated. It never fetches every branch from every configured remote.

- Local branches without an upstream are skipped.
- Remote branches that are not the upstream of a local branch are not updated by Fetch.
- If no local branch has an upstream, Fetch is unavailable with the reason "no local branches with upstreams".
- The Remotes panel updates only the fetched upstream refs. Unrelated remote branches keep their last known state until they are fetched by another means.
- Fetch groups work by remote. A failure for one remote or one ref does not stop the other groups.
- A missing upstream ref during a normal Fetch is non-fatal. The branch is marked `[?] upstream not found`, and the status names the affected branch.
- Fetch --prune uses the same scope. It first confirms remote absence with `git ls-remote --heads <remote>` for each affected remote, then removes only the confirmed stale remote-tracking refs in that scope. It never prunes unrelated refs. A confirmed missing upstream is marked `[?] remote branch deleted`.
- A failed or timed-out remote check is `unknown`, not "missing" or "deleted". A normal Fetch with a missing upstream marks the branch `[?] upstream not found`; only a successful prune confirmation marks it deleted.
- Partial success is reported clearly. For example: "Fetched 4 upstreams; 1 upstream missing; 1 remote failed."
- After Fetch --prune, re-evaluate local branch upstreams. Local branches whose upstream ref disappeared get the `[?] remote branch deleted` indicator.
- A successful remote branch deletion from the Delete Branch flow also classifies that branch's upstream as deleted without requiring a second prune confirmation.
- The success status may report the number of fetched upstream refs, pruned refs, missing refs, and affected local branches.

#### Status and progress

- The middle of the top bar, between the branch block and the buttons, is the single surface for operation progress and transient status messages.
- While Pull, Push, Fetch, Fetch --prune, a force push, tag push, or another remote operation runs, the middle shows the current phase and a progress bar when git reports a percentage. Without a percentage it shows a spinner and the phase.
- The progress bar uses the OpenTUI FrameBuffer progress-bar technique: a one-row cell buffer with a filled portion and a track, drawn as colored cells rather than text characters, so its width is exact and independent of font glyph widths.
- Progress is always paired with text: the phase, the percentage when known, and the operation name. Color and the filled bar are never the only signal, so the display still works with `NO_COLOR` and on low-color terminals.
- When no operation is running, short status messages use the same surface: success, warning, informational, and failure summaries. A success or informational message clears after a short timeout. A warning stays until the next action. A failure summary stays while its error overlay is open.
- When there is no active operation and no status message, the middle returns to the branch name, upstream, ahead and behind counts, and sync badge.
- The status surface is not focusable and has no keybindings. `Left` and `Right` move only between the branch info when it is shown, Pull, Push, and More.
- Long phases and messages truncate with an ellipsis. The full text is available in the console and, for failures, in the error overlay.
- The status surface never changes the top bar height and never wraps the bar.

#### Focus behavior

When the top bar is focused:

- Left and Right move between branch info, Pull, Push, and More. When the status strip is showing progress or a message, branch info is not a stop, so Left and Right move between Pull, Push, and More.
- `Enter` activates the focused control.
- `p` triggers Pull.
- `P` triggers Push.
- `f` triggers Fetch.
- `F` triggers Fetch --prune.
- `.` opens the More menu.
- Footer hints show these actions.

When another region is focused, the same keys remain global unless that region defines a conflicting context key.

#### States

- Operation running: controls are disabled, and the top bar middle section shows a spinner and phase. Remote progress shows a percentage and the FrameBuffer progress bar when git reports one.
- Success: a short status message in the top bar middle section and refreshed repository state.
- Failure: a persistent error overlay with the relevant git output, plus a console entry. The repository state refreshes after the failure.
- No remote: remote actions are marked unavailable with a reason.
- No upstream: sync state is "no upstream". Push is available when `origin` exists and creates `origin/<local-branch-name>`. Pull is unavailable with that explanation.
- Upstream gone: sync state is "upstream gone" with a `[?]` indicator. Push recreates the configured upstream branch. Pull is unavailable until the remote branch exists again.
- Detached HEAD: branch name is replaced by the short hash, and branch-dependent actions show a reason.

Acceptance:

- Pull, Push, Fetch, Fetch --prune, safe force push, overwrite force push, and push --no-verify all run the expected git operation and are visible in the console.
- Push with no upstream creates `origin/<local-branch-name>` and sets the upstream without an extra modal.
- The top bar updates branch, upstream, and ahead/behind state after every successful operation.
- The top bar middle section shows the operation phase and a FrameBuffer progress bar with a percentage (when git reports one) during Pull, Push, Fetch, and Fetch --prune, and shows transient status messages when no operation is running.
- A failed operation never clears the user's commit message or staged files.

### F-03 Branches panel

The Branches panel lists all local branches.

Each row shows:

- Branch name.
- Current branch marker (`*`).
- Ahead and behind counts relative to the branch upstream, for example "ahead 1" and "behind 3".
- "no upstream" when no upstream exists.
- A `[?]` missing-upstream indicator when the branch has a configured upstream but the remote-tracking ref is absent locally.
- A marker when the branch is checked out in another worktree, with the worktree path available in the row detail or a notice.

Missing-upstream states:

- `[?] upstream not found`: the upstream is configured but its remote-tracking ref is absent, and the app has not confirmed a prune for that remote.
- `[?] remote branch deleted`: a successful Fetch --prune, or a fetch with pruning enabled, for the upstream remote completed and the remote-tracking ref is still absent.
- In both cases, ahead and behind counts are hidden because the comparison ref is unknown.
- The indicator clears automatically after a successful fetch finds the upstream ref again, and the ahead/behind counts return.
- The selected row and its detail text explain the state. The indicator is not color-only.
- A branch with no configured upstream shows "no upstream" and no `[?]` indicator. If `origin/<local-branch-name>` exists, it is still treated as having no upstream until Push or an explicit upstream change.

Ordering: current branch first, then branches by most recent commit, then name as a tie breaker. The ordering is stable across refreshes.

Actions:

- `Enter` checks out the selected branch. No confirmation is required for a normal checkout. If git rejects the checkout because of local changes, show the git error and keep the current branch.
- Double click performs the same checkout.
- `n` opens the New Branch modal.
- `d` opens the Delete Branch confirmation.
- Up and Down, or `j` and `k`, move the selection.
- `g` and `G` jump to the first and last branch.

New Branch modal:

- Name field, required.
- Start point, defaulting to the current HEAD. The start point is shown as read-only text in v1 unless the user opened the modal from a selected commit, in which case that commit is the start point.
- "Check out after creating" checkbox, on by default.
- Validation: git ref format, no duplicate local branch, no empty name, and at least one commit exists when the start point is HEAD.
- Creating with checkout is one atomic operation (`git switch -c` / `git checkout -b`), so a failed checkout cannot leave an orphan branch behind. Creating without checkout uses `git branch`.
- On success, the branch appears in the list and is selected. If checkout is requested, the current branch marker moves.

Delete Branch modal:

- Cannot delete the current branch. The action is disabled with a reason.
- Cannot delete a branch checked out in another worktree. The action is disabled with a reason.
- The modal always presents two scope choices:
  - Delete local branch only.
  - Delete local and remote branch.
- The modal names the local branch. For the remote option, it also names the exact remote and remote branch.
- Remote scope resolves in this order:
  1. The configured upstream remote and branch.
  2. When no upstream exists, `origin/<local-branch-name>` if that remote branch exists.
  3. Otherwise the remote option is disabled with a reason. The app does not guess another remote in v1.
- The remote option is disabled with a reason when the resolved remote branch is gone, the remote is missing, or there is no matching remote branch.
- When the upstream is gone, the modal explains that only the local branch can be deleted.
- The selected scope determines the confirm button label: "Delete local branch" or "Delete local and remote branch".
- The modal opens with Cancel focused. The user must choose a scope and confirm explicitly.
- Deleting a merged local branch requires no additional warning.
- Deleting an unmerged local branch requires a force-delete acknowledgement that names the commits at risk. This applies to both scopes because both delete the local branch.
- If the local branch is behind its remote, the local-and-remote scope shows a stronger warning that the remote branch contains commits not present locally.
- On success, the branch disappears from the Branches panel and selection moves to a neighbor. The Remotes panel refreshes.
- On failure, the git error is shown and no visible state is claimed as successful.

Delete order and partial failure:

- Before deleting, the app verifies that the local branch can be deleted: it is not current and not checked out in another worktree. An unmerged branch requires the force acknowledgement, which selects `git branch -D`; a merged branch uses `git branch -d`.
- For the local-and-remote scope, delete the local branch first, then the remote branch. This ordering guarantees that a local delete failure never removes the only remaining copy on the remote.
- If local deletion fails, keep the branch and the remote branch, and show the error. Nothing is deleted.
- If local deletion succeeds but remote deletion fails, report a partial failure and name the remaining remote branch. The local branch is gone; the remote branch can be deleted by another run of the same flow or outside the app.
- A successful remote deletion also updates the stored upstream classification for any local branch that tracked it to `[?] remote branch deleted`, without requiring a second Fetch --prune.
- Remote deletion targets the configured upstream remote and branch, or `origin/<local-branch-name>` when no upstream exists. It never scans or guesses another remote in v1.
- Local-only deletion never touches the remote branch.

Acceptance:

- The current branch is visually marked and is never deleted.
- Ahead/behind counts match the last fetched upstream state.
- A branch whose remote was deleted is marked `[?]` after Fetch --prune, with the correct explanation.
- A fetch that finds the remote branch again clears the `[?]` indicator.
- The Delete Branch modal always shows local-only and local-and-remote choices, with unavailable choices explained.
- Deleting local and remote deletes only the configured upstream branch, or `origin/<local-branch-name>` when no upstream exists.
- A partial failure leaves an accurate local branch state and message.
- Creating a branch can optionally check it out, and create-with-checkout is atomic so a failed checkout leaves no orphan branch.
- A failed checkout or delete reports the git error without changing visible state.
- Local-and-remote deletion deletes the local branch first and reports a partial failure if only the remote deletion fails.
- Branch creation and deletion are unavailable in an empty repository with the reason "no commits yet".

### F-04 Remotes panel

The Remotes panel lists remote-tracking branches, grouped or sorted by remote name and then branch name. Examples: `origin/main`, `origin/feature/AB-1231`.

- A filter field is available at the top, as shown in the [UI reference](../gitminal.png). Typing filters the list case-insensitively against the full remote branch name. `Esc` clears the filter before leaving the field.
- A scrollbar appears when the filtered list overflows.
- Rows are one line: the remote branch plus a text stale or unknown marker. The row truncates the branch name when the sidebar width cannot fit it and reserves room for the marker, so the marker is never the part dropped. There is no commit summary or date in the row.
- Remote branches are not checked out directly. Selecting one offers creation of a local branch.

Fetch scope and the Remotes panel:

- Fetch updates only remote refs that are upstreams of local branches. It does not refresh unrelated remote branches.
- Remote branches that are not tracked by a local branch keep their last known state. They may be stale, and Fetch does not claim they are current or deleted.
- Fetch --prune removes stale refs only inside the fetched upstream scope. It does not prune unrelated remote branches.
- A remote branch that no local branch tracks remains visible until it is fetched or pruned by another means.

Actions:

- `Space` opens the Create Local Branch modal for the selected remote branch.
- Double click opens the same modal.
- `Enter` does not create a branch in v1. This keeps the explicit Space and double-click behavior described by the product owner.
- Up and Down, or `j` and `k`, move the selection.
- `/` focuses the filter.
- `g` and `G` jump to the first and last row.

Create Local Branch modal:

- Title makes clear the source, for example "Create local branch from origin/feature/AB-1231".
- Local branch name is prefilled by stripping the remote name, for example `feature/AB-1231`. The user can edit it.
- Base ref is shown as read-only.
- "Check out after creating" checkbox, on by default.
- Validation: git ref format, no duplicate local branch, no empty name.
- Confirmation creates the local branch at the remote-tracking commit and optionally checks it out.
- On success, the new branch appears in the Branches panel and, if requested, becomes current.

Acceptance:

- Space and double click both open the confirmation modal with an editable local name.
- Creating from a remote branch does not require a fetch first, but it uses the locally known remote ref.
- Invalid names keep the modal open with an inline error.
- A remote branch that was pruned from the remote disappears after Fetch --prune when it is in the fetched upstream scope.
- Remote branches outside the fetch scope keep their last known state and are not removed by scoped Fetch --prune.
- Local branches that tracked the pruned remote branch show `[?] remote branch deleted` until their upstream is recreated or changed.

### F-05 Tags panel

The Tags panel lists tags known locally and tags known on remote-tracking refs. Tags with the same name are shown as one logical row with scope indicators:

- `local`: present locally.
- `remote`: present on at least one remote.
- `unpushed`: present locally but absent from the relevant remote.
- `local only`: no remote is configured.

Each row shows the tag name and, when available, the tagged commit summary. Ordering defaults to version-aware descending order for version-like names, then reverse name order for others. The order is deterministic.

Actions:

- `n` opens the Create Tag modal.
- `d` opens the Delete Tag modal.
- `P` pushes the selected unpushed tag after confirmation.
- Up and Down, or `j` and `k`, move the selection.
- `Enter` selects the tagged commit in the commit graph and shows its details. This is a convenience, not a separate details screen.
- `/` filters the tag list.
- Footer hints show only actions available for the selected tag.

Create Tag modal:

- Tag name, required. Validation follows git ref rules and rejects duplicates.
- Target commit, defaulting to the current commit graph selection if it is a commit, otherwise HEAD.
- Message field, optional. Empty message creates a lightweight tag. A non-empty message creates an annotated tag.
- "Push to remote after creating" checkbox, off by default. If checked, the modal states which remote will receive the tag.
- On success, the row appears immediately. If pushed, the unpushed indicator clears after the remote operation succeeds.
- If the tag exists only remotely, creation is blocked with a clear duplicate message.

Push Tag:

- Available for a selected local tag that is not on the remote.
- Confirmation names the tag and remote.
- On success, refresh refs and clear the unpushed indicator.
- A rejected push shows the git error and keeps the local tag.

Delete Tag modal:

- Offers actions based on where the tag exists:
  - Delete locally.
  - Delete locally and from a selected remote.
  - Delete from remote only, when the tag does not exist locally.
- If multiple remotes contain the tag, the user selects the remote.
- Destructive confirmation names the tag and the selected scope.
- Deleting a tag never deletes the commit it points to.
- On success, refresh refs and selection.

Acceptance:

- Local-only tags show an unpushed or local-only indicator.
- Creating an annotated tag records the message; creating a lightweight tag does not.
- Deleting locally and remotely performs both operations and reports partial failure clearly.
- A tag badge on the commit graph reflects the tag state.

### F-06 Stashes panel

The Stashes panel lists all stashes, newest first.

Each row shows:

- Stash index.
- Message, truncated to fit.
- Source branch when git records it.
- Relative age.

Actions:

- `s` opens the Create Stash modal.
- `a` applies the selected stash and keeps it.
- `p` opens the Pop Stash confirmation, then applies and drops it on success.
- `d` opens the Delete Stash confirmation.
- Up and Down, or `j` and `k`, move the selection.
- `Enter` shows the stash diff in the right pane. The diff is read-only.
- Footer hints show Apply, Pop, Delete, and Stash.

Create Stash modal:

- Message field, required so stashes are identifiable. Prefill with `WIP on <branch>: <short hash> <subject>`.
- "Include untracked files" checkbox, off by default. When checked, untracked files are included.
- The modal is shown before the operation so the user can cancel.
- If there are no changes to stash, the action is unavailable with the reason "nothing to stash".
- If the only changes are untracked and "Include untracked files" is off, the action is unavailable with the reason "only untracked changes; include untracked files to stash", because `git stash push` otherwise exits successfully without creating a stash.
- In an empty repository with no commits, stash creation is unavailable with the reason "no commits yet".
- On success, the composer area returns to the pending changes view, the stash list refreshes, and the new stash is selected.

Apply and Pop:

- Apply keeps the stash. No confirmation is required for Apply.
- Pop requires confirmation because it drops the stash after a successful apply.
- If apply or pop causes a conflict, show a persistent error with the git output. Keep the stash unless git reports it dropped. Do not silently discard anything.
- After success, refresh working tree, staged files, and commit graph.

Delete:

- Delete requires confirmation naming the stash message.
- On success, selection moves to a neighbor.

Stash diff:

- Selecting a stash replaces the commit composer or commit details area with a read-only "Stash <message>" summary and shows the stash diff in the Diff panel.
- Selecting the pending changes row returns to the composer.

Acceptance:

- Stash creation uses the entered message and optional untracked behavior.
- Pop with confirmation drops the stash only after a successful apply.
- Apply, pop, and delete failures preserve the stash.
- Stash action keys do not trigger Pull when the Stashes panel is focused.

### F-07 Worktrees panel

The Worktrees panel lists all worktrees known to the repository.

Each row shows:

- Branch name or detached short hash.
- Worktree path, with the repository-relative or shortened home path.
- Current worktree marker.
- Locked or prunable state when git reports it.
- Dirty marker when the worktree has local changes, when cheaply available.

Actions:

- `n` opens the New Worktree modal.
- `d` opens the Delete Worktree confirmation.
- Up and Down, or `j` and `k`, move the selection.
- `Enter` shows read-only worktree details in the right pane. It does not switch the app to another repository in v1.
- Double click does not change the active repository in v1.
- `/` filters the list.

New Worktree modal:

- Path, required. Prefill a sensible sibling directory based on the branch name.
- Branch mode:
  - Create a new branch from HEAD, with an editable branch name.
  - Use an existing branch that is not already checked out elsewhere.
- Create the worktree and check out the branch there.
- Validation: path does not exist or is empty, branch name is valid, branch is not already checked out, parent directory is writable.
- On success, the worktree appears in the list. The app remains focused on the current repository.

Delete Worktree confirmation:

- Cannot delete the current worktree. Disabled with a reason.
- A clean worktree requires one confirmation.
- A dirty or locked worktree requires a stronger confirmation that names the risk and requires the force option.
- Removing a dirty worktree uses one `--force`. Removing a locked worktree requires two force flags (`-f -f`); a single force exits 128. The app computes the exact flag set from the reported state.
- Deleting a worktree does not delete its branch.
- On success, the row disappears and selection moves to a neighbor.
- If the directory cannot be removed, show the git or filesystem error and keep the row.

Acceptance:

- The current worktree is marked and cannot be deleted.
- Branches checked out in another worktree are marked in the Branches panel and cannot be deleted there.
- Creating a worktree with a new branch makes that branch appear in the Branches panel with the worktree marker.
- Worktree operations never silently remove a directory.

### F-08 Commit graph

The commit graph occupies the main area left column.

The first row is always the Pending Changes row:

- Label: "Commit Changes".
- Secondary text: the number of unstaged files. The count includes working tree modifications, deletions, renames, and untracked files. Example: 7 modified plus 3 untracked shows "10 unstaged files".
- Selecting this row restores the commit composer and the working tree diff view.
- If the working tree is clean, the row shows "Working tree clean" but remains selectable so the composer remains reachable.
- Staged-only changes still allow a commit even when the pending count is zero. The composer shows the staged count.

Commit rows show:

- Graph lane lines and nodes, with merge commits visually distinct and connected to multiple parents.
- A selection indicator on the selected row.
- Truncated commit message.
- Ref badges: tags first, then local branches, then remote branches. If space is insufficient, show the first badges plus a "+N" count.
- Number of affected files, right aligned. This is the number shown at the right edge in the [UI reference](../gitminal.png).
- Author name, shortened when needed.
- Date or time, compact.
- For tagged commits, ref badges get visual priority. The metadata line shows the badges before the date, and the date may be omitted when space is tight.

Author shortening:

- Names up to 12 characters are shown as written.
- Longer names are shown as initials: first letters of the first two words, uppercased. A single long word shows its first two characters uppercased. Example: "John Doe" becomes "JD".
- The full author name and email are always available in commit details.

Date:

- Compact local time for commits from today.
- Day and month for commits from the current year.
- Day, month, and year for older commits.
- The full timestamp with timezone is shown in commit details.

Selection and navigation:

- Up and Down, or `j` and `k`, move the selection.
- `g` jumps to the newest loaded commit.
- `G` jumps to the oldest loaded commit and starts loading the next older page.
- PageUp and PageDown move by a screen and trigger another page when the selection nears the bottom.
- Selection follows the cursor and immediately updates the right pane.
- Clicking a row selects it.
- Selecting a commit replaces the composer with commit details and shows the commit diff.
- Selecting the Pending Changes row returns to the composer and working tree diffs.
- Refreshing keeps the selected commit selected when it still exists. If it no longer exists, select the nearest row.
- The graph is scrollable and virtualized. Long histories must not block navigation.

Lazy loading:

- The graph never loads the full history up front, even for a branch with a very large number of commits.
- The first page is bounded by `graph.initialPageSize`, 500 commits by default.
- Older pages use the same page size and load automatically when the selection or scroll reaches near the bottom of the loaded rows.
- Only one older-page load runs at a time. Repeated scrolling or key presses do not queue duplicate requests.
- A bottom loading row shows "Loading older commits..." while a page is in flight. The user can keep navigating already loaded commits.
- Appending a page does not move the current selection, viewport, or focus.
- After a page loads, `G` again moves to the newly loaded oldest commit and can trigger the next page.
- If no older commits remain, show a "Beginning of history" marker.
- If a page load fails, show a persistent inline error row with Retry. Already loaded rows remain usable.
- Changing graph scope, reloading configuration, or refreshing repository state cancels an in-flight older-page load and discards stale results.
- Selecting a parent commit that is not loaded triggers a bounded load until the parent is available, with a visible loading state.
- Loaded rows are retained for the session and rendered through the virtualized list. Only visible rows are drawn.

Commit search:

- `/` or `Ctrl/Cmd+F` while the commit graph is focused opens a single-line search input at the top of the Commit panel.
- The input is focused immediately. The footer changes to search hints: Up/Down navigate, Enter select, Esc cancel.
- With an empty query, the normal graph and Pending Changes row remain visible and a "Search commit messages..." placeholder is shown.
- The graph footer hint includes `/ Search commits`, using the configured key when overridden.
- The command palette also contains Search commits. Running it from another region focuses the commit graph and opens the input.
- Typing applies a live search after a short debounce. The query is case-insensitive.
- Matching covers the commit subject and the full commit message body. Whitespace-separated terms use AND semantics. Regular expressions are not supported in v1.
- Search covers the entire configured graph scope, not only the commits already loaded in the graph. It never loads full history into the graph.
- Search results load lazily in bounded pages with their own loading, retry, and end-of-results states.
- Changing the query cancels the previous query. Stale results from an older query are discarded.
- While a query is running, show "Searching..." and a result count. Show "N+ matches" while more results may exist, then the final "N matches".
- A non-empty query switches the panel from the graph to a flat search result list. Graph lanes and the Pending Changes row are hidden in search mode.
- Each result shows the short hash, subject, body snippet when the match is in the body, ref badges, affected file count, author, and date.
- Matched terms are highlighted with the theme accent. Results remain readable without color.
- The result list is newest first and virtualized. Scrolling near the bottom loads more matching commits.
- Up and Down move the result selection while the search input keeps focus. Printable keys, including `j` and `k`, continue to edit the query.
- PageUp and PageDown scroll the result list.
- `Enter` confirms the highlighted commit, exits search, and selects that commit in the normal graph. If the commit is not on a loaded graph page, load the containing page first.
- `Esc` clears the query, cancels any in-flight search, and restores the previous graph state in one press: selected commit or Pending Changes, scroll position, loaded pages, and composer state.
- Clicking a result previews it. Double click confirms it like Enter.
- Search mode is read-only. It never stages, commits, or changes refs.
- Search does not match commit hashes, author names, branch names, or tag names in v1.
- Changing graph scope, refreshing repository state, reloading configuration, opening an overlay, or moving focus out of the commit graph exits search and restores the previous graph state.
- An empty query does not produce results. A query with no matches shows "No commits match <query>".
- A failed search shows an inline Retry row while the previous graph state remains intact underneath.
- In an empty repository, search is unavailable with "No commits to search".

Graph content:

- The graph shows all commits reachable from local and remote branches plus `HEAD`, with ref badges. Including `HEAD` keeps a commit made while detached visible.
- Orphan or unreachable commits are not shown.
- The graph handles octopus merges, branch starts, and disconnected lanes without visual corruption.

States:

- Empty repository: "No commits yet" placeholder, with the Pending Changes row still available so the user can stage and make the first commit.
- Loading: a loading row or skeleton at the top.
- Load error: persistent error row with the git message and a Retry action.
- Detached HEAD: the current position is shown in the top bar and details. The graph still shows history.

Acceptance:

- The pending count equals the number of files in the working tree and untracked sections.
- Merge commits show a distinct node and connections to all displayed parents.
- Tags and branches appear as badges on the correct commits.
- Selecting a commit changes the right pane from composer to commit details.
- Selecting Pending Changes restores the composer.
- Very long histories remain navigable with keyboard and mouse.
- A branch with 100,000 commits opens with the initial page and does not load the full history up front.
- Scrolling near the bottom loads the next page, keeps the viewport and selection stable, and never starts duplicate page loads.
- `G` moves to the oldest loaded commit and triggers the next page when more history exists.
- The end of loaded history shows "Beginning of history", and a failed page load shows a Retry row without breaking loaded rows.
- Changing graph scope or refreshing discards stale older-page results.
- `/` or `Ctrl/Cmd+F` opens the commit search input at the top of the Commit panel.
- Commit search matches subject and message body case-insensitively across the full graph scope, not only loaded commits.
- Search results stream in bounded pages; stale queries are canceled and never replace newer results.
- Up and Down navigate results while typing remains possible in the input.
- Enter exits search and selects the result in the graph, loading the containing page if needed.
- Esc cancels search and restores the previous selection, scroll position, and Pending Changes or composer state.
- No-results and search-error states are clear and recoverable.
- Refreshing status preserves the loaded graph window and the selected commit instead of dropping pages 2..N.
- A commit made while HEAD is detached remains visible in the graph.
- Merge commits show real affected-file counts and a non-empty diff from their first parent.

### F-09 Commit composer

The composer is shown in the top part of the right pane when the Pending Changes row is selected.

Contents:

- Multiline commit message textarea with placeholder "Commit message...".
- Author name and email from git configuration, for example `im4aLL <me@habibhadi.com>`.
- More button.
- Commit button.

Enablement and validation:

- The textarea is disabled when no files are staged. It becomes editable as soon as at least one file is staged.
- When no files are staged, the Commit button label is "Nothing to commit", and clicking it does nothing.
- When files are staged but the message is empty or whitespace, the Commit button is disabled and the footer shows "message required".
- When the git identity is missing, show "Git identity not configured" with the missing value and disable commit. The user resolves it in git configuration outside the app.
- The textarea auto-grows up to 8 rows, then scrolls.
- Enter inserts a newline. `Ctrl/Cmd+S` commits while the textarea is focused.

Commit:

- Commits exactly the staged files. Untracked and unstaged files are not included.
- Commit button and `Ctrl/Cmd+S` run the same operation.
- While committing, the composer is disabled and shows progress.
- On success:
  - Clear the message.
  - Return to the default state.
  - Keep the pending row selected.
  - Refresh status, staged files, and graph.
  - Show a success status.
  - Disable the textarea if no files remain staged.
- On failure:
  - Keep the message and staged files.
  - Show the git error in a persistent overlay.
  - Record the command and output in the console.
  - If a pre-commit hook failed, the error overlay names the hook output and makes clear that `--no-verify` can bypass it.

More menu:

- Opens a modal list of commit variants:
  - Commit.
  - Commit --no-verify.
  - Commit --amend.
  - Amend --no-verify.
- The selected variant runs with the current message and staged files.
- Selecting Amend loads the previous commit message into the composer if the message is empty, and shows an "Amending <short hash>" indicator. If the user cancels the amend selection, the previous draft behavior is restored.
- Amend can run without staged changes because it replaces the last commit. The "Nothing to commit" rule applies to normal commits only.
- The menu shows why an option is unavailable, for example "no previous commit".

After commit:

- The new commit appears at the top of the graph, above the pending row.
- The app does not automatically select the new commit. It stays on Pending Changes so the next action is obvious.
- The composer clears, including after amend.

Acceptance:

- A user can stage one file, type a message, press `Ctrl/Cmd+S`, and see the commit at the top of the graph.
- Nothing is committed while no files are staged.
- The button reads "Nothing to commit" and does nothing in that state.
- Author identity comes from git configuration.
- `--no-verify` and amend variants work and are visible in the console.
- A failed commit preserves the message and staged state.

### F-10 Commit details

When a commit is selected in the graph, the right pane's top area is replaced by read-only commit details.

Details shown:

- Short hash and full hash, with the short hash prominent.
- Tree hash.
- Author name and email.
- Author date and time with timezone.
- Committer name and date when different from the author.
- Parent hashes, each shown as a short hash and selectable to move the graph selection to that parent.
- Branches and tags that point at the commit.
- Stats: number of files changed, insertions, and deletions, for example "8 files changed +120 -34".

Below the details, the Diff panel shows the commit's diff, grouped by file.

Behavior:

- Details and diff update as the graph selection moves.
- Selecting a parent moves the graph selection to that commit when it is loaded. If it is not loaded, load the needed history first.
- All fields are read-only in v1.
- There are no commit actions such as revert, reset, or checkout in v1.
- Selecting the Pending Changes row returns to the composer.
- If the commit details cannot be loaded, show a persistent error with the git message and keep the graph selection unchanged.

Acceptance:

- All requested fields are present and accurate.
- The diff matches the selected commit.
- The composer is not visible while a commit is selected.
- Returning to Pending Changes restores the composer state.

### F-11 Diffs and file actions

The Diff panel is in the lower part of the right pane. It has three sections in this order:

1. Working Directory.
2. Staged Files.
3. Untracked Files.

Each section header shows:

- Expand/collapse indicator.
- Section title.
- File count.
- Bulk actions.

Working Directory:

- Shows tracked files with unstaged changes, including modified, deleted, and renamed files.
- Bulk actions: Discard All and Stage All.
- Per-file actions: Discard and Stage.

Staged Files:

- Shows files in the index.
- Bulk action: Unstage All.
- Per-file action: Unstage.

Untracked Files:

- Shows files git does not track.
- Bulk actions: Delete All and Stage All.
- Per-file actions: Delete and Stage.

Conflicts:

- Conflict support stays inside the three-section model. Conflicted files appear in Working Directory with a `U` status and a conflict banner above the list.
- The file diff shows the conflict markers as text, rendered from a synthetic unified patch. It never passes git's combined `--cc` output to the diff renderer, which parses it as zero hunks and renders blank.
- The user resolves the file externally and then stages it. A staged conflict can be unstaged only when no merge, rebase, or cherry-pick is in progress, because `git restore --staged` would destroy the merge stages.
- Bulk Stage All and Unstage All are disabled while a merge, rebase, or cherry-pick is in progress, because they can stage conflict markers as resolved or destroy merge stages.
- Ours/theirs resolution actions are deferred beyond v1.
- If the repository is in a merge, rebase, or cherry-pick state, the app shows a persistent banner naming the operation until it finishes or aborts.

Section behavior:

- All three sections are expanded by default so the user can see the full working state.
- A section can be collapsed to hide its file rows. The header remains visible with count and bulk actions.
- Expanded sections show file rows. Each file row has its own expand/collapse indicator.
- The first file in the Working Directory section is expanded by default when it has a text diff. Other file rows are collapsed by default.
- Collapsing a section does not discard selection. When expanded again, the previous file selection is restored if it still exists.
- Empty sections show an empty state and disabled bulk actions.

File row contents:

- Status letter: M, A, D, R, C, U, or a text label for unusual states.
- Repository-relative path. Renames show `old -> new`.
- Added and deleted line counts when available.
- Expand/collapse indicator.
- Action buttons for the section.

File expansion:

- Expanding a text file loads and shows its unified diff inline.
- Diff shows file header, hunk headers, old and new line numbers, context lines, additions, and deletions.
- Long runs of unchanged lines collapse behind a "N unchanged lines" marker, matching the [UI reference](../gitminal.png).
- Binary files show "Binary file - preview unavailable" but can still be staged, unstaged, discarded, or deleted.
- Files above the preview limit show "File too large to preview" with the size. Actions remain available.
- Untracked text files show their full content as added lines.
- Deleted files show all lines as removed.
- Renames show the rename header and the content diff.
- A file with no text changes, such as a mode-only change, shows a metadata-only diff.

Actions:

- Stage adds the file to the index. No confirmation.
- Unstage removes the file from the index. No confirmation.
- Discard restores the working file to the index version. Requires confirmation.
- Delete untracked removes the file from disk. Requires confirmation.
- Discard All restores all working tree files and requires confirmation.
- Delete All untracked removes all untracked files and requires confirmation.
- Stage All and Unstage All do not require confirmation. Each bulk action applies only to the paths in its own section, never to the whole working tree. An untracked Stage All stages only the untracked set.
- Per-file and bulk commands treat paths as literal pathspecs and include both paths of a rename. A file named `a[1].txt` can never stage or discard `a1.txt`.
- If an operation is running, all conflicting actions are disabled.
- After an action, refresh the affected sections and keep the user's selection on the same path when possible.
- The unified diff renders one line-number gutter. The two-gutter appearance in the UI reference is illustrative; v1 does not add a custom two-gutter renderer.

Keyboard while the Diff panel is focused:

- Up and Down, or `j` and `k`, move between file rows.
- Left and Right, or `h` and `l`, collapse or expand a section or file row.
- `Enter` toggles the selected file row.
- `s` stages the selected file.
- `u` unstages the selected file.
- `d` discards or deletes the selected file, with the appropriate confirmation.
- `S` stages all in the current section.
- `U` unstages all in the current section.
- `D` discards or deletes all in the current section, with confirmation.
- Footer hints reflect the section and selected row.

Commit and stash context:

- When a commit is selected, the Diff panel is read-only. It shows the commit's changed files and diffs, with no stage or discard actions.
- When a stash is selected, the Diff panel is read-only and shows the stash diff.
- When the Pending Changes row is selected, the Diff panel shows working, staged, and untracked sections.

Acceptance:

- The three sections reflect git status accurately.
- Each per-file and bulk action is available and does what its label says.
- Destructive actions require confirmation and clearly state what will be lost.
- Binary and oversized files show a clear notice and do not break the panel.
- Expanding and collapsing preserves selection and does not refetch unnecessarily.
- Staged and working diffs show the correct comparison, not the same diff twice.
- Bulk actions apply only to the paths in their own section, and every path is treated literally, including renames and pathspec metacharacters.
- Bulk staging and unstaging are disabled during a merge, rebase, or cherry-pick, and conflicted files render from a valid synthetic patch rather than blank combined output.
- Collapsed and truncated diff segments remain valid unified patches with correct hunk headers.

### F-12 Command palette

`Ctrl/Cmd+P` opens the command palette from anywhere outside a modal.

Behavior:

- The palette is a centered modal with a search field and a scrollable result list.
- Typing filters commands by label, description, keywords, and shortcut.
- An empty query shows recently used commands first, then all commands grouped by category.
- Up and Down, or `j` and `k`, move the selection.
- `Enter` runs the selected command.
- `Esc` closes the palette without running anything.
- Running the palette shortcut again closes it.
- Disabled commands remain visible and dimmed with a reason, such as "nothing to commit", "message required", "no changes to stage", "no other branches", "no remote", or "detached HEAD".
- Selecting a disabled command does nothing except keep the palette open.
- Commands that need input close the palette and open the relevant modal.
- The palette contains every user-facing action, including navigation, commit search, theme picker, remote operations, commit variants, staging actions, branch creation, tag creation, stash creation, console, help, refresh, Reload configuration, and quit.
- Recent commands are session-only and capped at five.

Acceptance:

- The palette opens with `Ctrl/Cmd+P` and can be fully operated without a mouse.
- Filtering is case-insensitive and matches command keywords.
- Unavailable commands explain why.
- The palette and the footer agree on the active shortcut.

### F-13 Console

`Ctrl/Cmd+`` toggles the console.

The console is a non-modal bottom drawer. It opens above the footer and shows a log of git commands executed by the app.

Each entry shows:

- Local timestamp.
- Operation label, such as "Pull" or "Stage file".
- Command and arguments.
- Working directory only when it differs from the repository root.
- Exit status.
- Duration.
- Progress phase for remote operations, or a short success or failure summary.
- Expandable stdout and stderr for failures. Output is capped with the first and last portion preserved and an omitted-lines marker.

Behavior:

- Every mutating operation is logged. Read operations are logged when they are user-visible or fail, and may be grouped to avoid noise from routine refreshes.
- The console follows new entries while scrolled to the bottom. Scrolling up pauses follow mode and shows a "new entries" indicator.
- Up and Down, or `j` and `k`, scroll. PageUp and PageDown move by the entries that fill one screen. `g` and `G` jump to the oldest and newest entry.
- `Enter` expands or collapses the selected entry's output.
- `c` clears the console after confirmation.
- `Esc` closes the console.
- The console keeps a bounded session history, at least 200 entries.
- Credentials in URLs, authorization headers, and environment values are redacted before display, and terminal control bytes in captured output are sanitized before storage.
- Errors in the app link to the corresponding console entry.
- The console can remain open while the user works in other regions. Focus moves there with Tab or a click; the console joins the Tab cycle only while it is open.

Acceptance:

- Every app-triggered git command is visible, with outcome.
- A failed remote operation shows the decisive stderr line.
- Console scrolling does not interfere with repository navigation.
- No credentials appear in the console.

### F-14 Help

The help action (default `?`) opens the help modal from anywhere outside a text input or modal.

The help modal contains:

- A search field activated by its configured key (default `/`).
- Sections for Focus, Global, Top bar, Sidebar panels, Commit graph, Commit composer, Commit details, Diffs, Console, Modals, and Configuration.
- Each row shows the action, its effective keys after configuration overrides, and a one-line description.
- The Configuration section shows resolved config, keybindings, and theme paths, load status, active theme, and warnings.
- The section for the current focus is shown first.
- Search filters across all actions, keys, and descriptions, case-insensitively.
- Up and Down, or `j` and `k`, navigate results.
- `Esc` clears the search, then closes help on a second press.
- `?` closes help.
- Help is scrollable and never traps the user.

Acceptance:

- Every implemented keyboard action appears in help with its effective binding, whether or not it is currently available.
- An unavailable action stays listed with its availability reason, for example "detached HEAD", rather than disappearing. Help documents the action; the footer only hints actions that can run now.
- The help reflects context overrides and configuration overrides, for example the configured Stashes key shows Pop stash.
- A user can find any action by searching part of its name, key, or action ID.
- The Configuration section lists the resolved file paths and any warning without blocking the rest of help.

### F-15 Overlays and confirmations

All modals use the same structure:

- Title.
- Short description.
- Optional fields or list.
- Footer with actions and their keys.
- Focus trap while open.
- `Esc` cancels.

Rules:

- Destructive confirmations default focus to Cancel.
- Confirm buttons use specific labels: "Discard changes", "Delete local branch", "Delete local and remote branch", "Drop stash", "Delete tag", "Delete worktree", "Force push safely", "Overwrite remote".
- Simple "OK" and "Yes" labels never confirm a destructive action; a destructive confirmation whose label is not one of the documented labels cannot be confirmed.
- Destructive confirmations state the exact scope and consequence.
- Text input modals validate inline and keep the modal open on error.
- Enter submits single-line forms. Multiline fields use `Ctrl/Cmd+Enter` to submit.
- While a modal is open, background regions are visibly inactive and cannot receive actions. The only exceptions are `Esc`/`overlay.close`, the quit escape hatch, and the same overlay's toggle (the palette shortcut closes the palette, `?` closes help).
- The footer shows the modal's keys.
- Only one modal is open at a time. A successful action closes the modal and shows status.
- If an operation started from a modal fails, the modal closes and a persistent error overlay opens with the details. The user's input is preserved when retry is meaningful.
- Success and informational messages are non-blocking, appear only in the top bar status strip and the console, and auto-dismiss after a short delay. They never open a modal or overlay. Failures stay until dismissed.
- The app does not stack error overlays. A new failure replaces the visible error details but remains in the console.

### F-16 Repository states

| State | Behavior |
| --- | --- |
| Normal repository | Full functionality. |
| Subdirectory launch | Resolve the repository root, show root-relative paths, run commands from the root. |
| Not a git repository | Show a clear "Not a git repository" screen with the current directory and instructions. No git actions are available. |
| Bare repository | Detect and show "Bare repositories are not supported". No repository actions. |
| Empty repository | Show the unborn branch, no commits, Pending Changes row, and composer after staging. Push, branch creation from HEAD, branch deletion, tag creation, tag push, tag deletion, and stash creation are unavailable until a commit exists, each with the reason "no commits yet". |
| Detached HEAD | Show the short hash instead of a branch. Pull and branch-dependent actions explain why they are unavailable. Commit is allowed with a visible detached warning. |
| No upstream | Show "no upstream". Push creates `origin/<local-branch-name>` and sets the upstream. Pull explains that the branch must be pushed first. |
| Upstream gone | Show `[?]` and "upstream gone" in the branch row and top bar. Pull is unavailable. Push recreates the configured upstream branch. |
| No remote | Remote actions are disabled with "no remote". Tags show "local only". |
| No origin remote but other remotes exist | Push without an upstream fails with a clear error listing the configured remotes. The app does not guess another remote. |
| Merge or rebase in progress | Show a persistent repository-state banner. Conflicted files are visible. Unsupported operations are blocked with a reason. |
| Conflicted files | Show conflicted files as `U` rows in Working Directory with a conflict banner, plus a conflict-marker preview rendered from a synthetic unified patch (never the combined `--cc` output). The file can be staged after the user resolves it externally. Bulk staging and unstaging are disabled during a merge, rebase, or cherry-pick until conflicts are resolved. Ours/theirs actions are deferred. |
| Dirty working tree during checkout | No auto-stash. Run the checkout, show git's error, keep the current state. |
| Operation in progress | Disable conflicting actions, show progress in the top bar status strip, allow the console. |
| External git changes | Refresh the relevant state after operations and provide a manual refresh. Live watching is recommended for the git directory. |
| Huge repository | Paginate history, virtualize lists, truncate diffs, and keep navigation responsive. |
| Binary or oversized file | Show a notice instead of a diff. Actions remain available. |
| Permission or filesystem error | Show the exact error, keep the selection, and do not claim success. |
| Missing git binary | Show an installation message. Do not crash. |
| Missing git identity | Show the missing value and block commits with instructions. |
| Hook failure | Show hook output, keep the message and staged files, mention `--no-verify` when relevant. |
| Authentication failure or network error | Show the decisive error, keep local state, and record the command. No interactive credential prompts inside the app. |
| Invalid or unreadable configuration | Launch with defaults or the previous valid settings, show a non-blocking warning, and keep details in Help > Configuration and the console. |
| Invalid theme file | Keep the selected base theme, show a warning, and continue running. |

### F-17 Freshness and performance

Freshness:

- After every successful or failed mutation, refresh the affected repository state.
- Provide `r` to refresh manually.
- Live watch the git directory so changes made in another terminal appear without manual refresh. Also provide manual refresh.
- Watching the working tree for file edits is optional. If not watched, show a hint or refresh on focus so users know that external edits may need `r`.
- Ahead and behind counts reflect the last fetched remote refs. A fetch updates them.
- After every fetch, re-evaluate configured upstreams. Mark missing refs with `[?]`, and classify a missing ref as a deleted remote branch only after a successful prune for that remote.
- Preserve selection, expansion state, and the loaded graph window across refreshes when the underlying item still exists. A status refresh never silently drops loaded pages or the selected commit.
- Pagination is monotonic: loading an older page never reloads or duplicates a page that was already loaded, and trimming the oldest loaded page never changes the cursor used for the next page.

Performance targets:

- A repository with 100,000 commits and 10,000 changed files remains navigable.
- First screen of history renders within one second on a normal developer machine.
- Moving the selection updates details and diff promptly without blocking the UI.
- The initial commit page is bounded, with older commits loaded on demand.
- A branch with 100,000 commits opens with the first bounded page and never blocks startup on the full history.
- Older pages load incrementally near the bottom, and page loads are coalesced so scrolling cannot flood the repository reads.
- Stale page loads are discarded when the graph scope or repository state changes.
- Only visible commit rows are rendered by the virtualized graph.
- Commit search scans the configured graph scope lazily, returns bounded result pages, and cancels stale queries.
- Diffs load when a file is expanded, not for every file up front.
- Parsed diffs have a line and byte cap and show a truncation notice.
- Console and error output have bounded history.
- Remote operations show progress and do not freeze rendering.
- Repository reads and writes are serialized so two mutations cannot race the index.

### F-18 Safety and platform behavior

Safety:

- Never discard, delete, drop, or force push without a confirmation that names the target.
- Force push offers both `--force-with-lease` and literal `--force`. The safe option is primary. The literal option is never the default focus and requires a stronger confirmation that names the branch and remote.
- No automatic stash, reset, checkout, clean, or prune.
- No credentials are stored or requested by the app. Git prompts, editors, pagers, and interactive credential managers are disabled so missing credentials fail visibly instead of hanging.
- Every git invocation has a timeout and can be cancelled. Ctrl+C and quit abort the running child, terminate it, and restore the terminal; a timed-out or cancelled command is reported as a warning, never as success.
- Git commands are executed with argument arrays, not a shell string, so file names cannot be interpreted as shell syntax.
- Sensitive values are redacted in the console and error overlays.
- Commit messages and staged files survive failures.
- One mutation at a time. A second mutation is blocked with a visible reason.
- Deleting a branch, tag, stash, or worktree never deletes reachable commits as a side effect.
- Deleting a remote branch requires explicitly choosing the local-and-remote scope. The remote option is never the default action.
- Push with no upstream may create the `origin/<branch>` ref, but it never force-pushes and never overwrites a non-fast-forward remote branch.
- Missing upstream indicators are derived from fetched refs. The app never claims a remote branch was deleted without a Fetch --prune that confirms the ref is absent, or a successful remote branch deletion from the app. A failed or timed-out remote check is "unknown", never "deleted" or "unpushed".
- Configuration cannot disable destructive confirmations, force-push warnings, credential prompt protection, or hook execution by default.
- `git.path` from configuration is executed directly without a shell. It is a local user setting, not a repository-controlled value.

Platform:

- Support macOS, Linux, and Windows terminals where the runtime supports them.
- `Ctrl/Cmd` means Control on Windows and Linux and Command on macOS. The UI accepts both where the terminal forwards both. Help lists the actual bindings.
- Terminal-reserved shortcuts may not reach the app. The command palette and help must be reachable by an alternate binding if needed.
- Use ASCII-safe indicators with text equivalents. Do not rely on color alone to convey current, ahead, behind, unpushed, staged, or destructive state.
- Respect `NO_COLOR` and low-color terminals by keeping text markers and using the fallback color behavior in F-20.

### F-19 Configuration and keybindings

Application settings are optional and override built-in defaults. Configuration is file based; the app has no settings screen in v1.

#### Configuration files and locations

Main configuration:

1. `$GITMINAL_CONFIG` when set and non-empty.
2. `$XDG_CONFIG_HOME/gitminal/config.json` when `XDG_CONFIG_HOME` is set.
3. `~/.config/gitminal/config.json` otherwise.
4. On Windows, `%APPDATA%\gitminal\config.json` when the XDG and home paths are unavailable.

Keybindings:

- `$GITMINAL_KEYBINDINGS` when set and non-empty.
- Otherwise `keybindings.json` next to the resolved main configuration file.

Theme overrides:

- `$GITMINAL_THEME` when set and non-empty.
- Otherwise `theme.json` next to the resolved main configuration file.
- Theme behavior is specified in F-20.

All files are optional. Missing files produce no warning. Unreadable or malformed files produce a non-blocking configuration warning and never prevent launch.

#### Load order

1. Built-in defaults.
2. `config.json`.
3. `keybindings.json`, applied per action.
4. Runtime reload through the command palette.

The main configuration can contain a `keybindings` object. The optional `keybindings.json` is a second, dedicated way to override keybindings. When both define the same action, `keybindings.json` wins for that action. Actions not mentioned in either file keep their previous value.

#### Main configuration schema

`config.json` is standard UTF-8 JSON. Comments are not supported in v1.

| Key | Type | Default | Behavior |
| --- | --- | --- | --- |
| `version` | integer | `1` | Config schema version. A missing version is treated as 1. A newer version is ignored with a warning. |
| `git.path` | string | `"git"` | Git executable used by the app. Executed directly, never through a shell. A missing executable shows the git-not-found state. |
| `theme` | string | `"catppuccin-mocha"` | Built-in base theme. v1 supports `catppuccin-mocha`, `catppuccin-macchiato`, `catppuccin-frappe`, and `catppuccin-latte`. Unknown names fall back to Mocha with a warning. |
| `ui.mouse` | boolean | `true` | Enables mouse reporting. `false` frees the mouse for terminal text selection. |
| `graph.scope` | string | `"all"` | Commit graph scope: `all`, `local`, or `current`. |
| `graph.initialPageSize` | integer | `500` | Number of commits loaded initially and the size of each older page. Allowed range: 100 to 2000. |
| `diff.contextLines` | integer | `3` | Context lines shown around each diff hunk. Allowed range: 0 to 20. |
| `diff.expandFirstWorkingFile` | boolean | `true` | Expands the first Working Directory file diff by default. |
| `stash.includeUntrackedByDefault` | boolean | `false` | Initial state of the Include untracked files checkbox. |
| `remote.fetchScope` | string | `"local"` | Fetch scope: `local` fetches the upstream refs of every local branch that has an upstream; `current` fetches only the current branch upstream, and is unavailable when it has none. Fetch never fetches all remote branches by default. |
| `keybindings` | object | `{}` | Action ID to keybinding overrides. Syntax is defined below. |

Unknown fields and unknown action IDs are reported and ignored. Invalid field values fall back to the previous effective value.

Safety behavior is intentionally not configurable. Configuration cannot disable destructive confirmations, force-push warnings, credential prompt protection, or hook execution by default. There is no "always no-verify" or "always force" setting.

Example `config.json`:

```json
{
  "version": 1,
  "git": { "path": "git" },
  "theme": "catppuccin-mocha",
  "ui": { "mouse": true },
  "graph": { "scope": "all", "initialPageSize": 500 },
  "diff": { "contextLines": 3, "expandFirstWorkingFile": true },
  "stash": { "includeUntrackedByDefault": false },
  "remote": { "fetchScope": "local" },
  "keybindings": {
    "remote.pull": ["p"],
    "remote.push": ["P"],
    "stash.pop": ["p"],
    "diff.discard": ["d"],
    "app.quit": ["q"]
  }
}
```

The example repeats `p` and `d` in different contexts. That is allowed. A key can appear once per context, not twice in the same context.

#### keybindings.json

`keybindings.json` is a direct action map. It does not need a `keybindings` wrapper.

```json
{
  "remote.pull": ["p"],
  "remote.push": ["P"],
  "stash.pop": ["p"],
  "tag.push": ["P"],
  "nav.down": ["down", "j"],
  "commit.submit": ["ctrl+s", "cmd+s"]
}
```

Binding values:

- A string or an array of strings. An array replaces the entire binding list for that action; it is not appended to defaults.
- `null` resets the action to its built-in default. This is useful in `keybindings.json` to undo a value from `config.json`.
- `[]` unbinds the action. The action remains available in the command palette and help.
- Unknown action IDs are ignored with a warning.
- An invalid binding is ignored, and the previous effective binding remains.

Key syntax:

- Modifiers: `ctrl` or `control`, `shift`, `alt` or `option`, `cmd`, `command`, or `meta`, and `mod`.
- `mod` is Control on Linux and Windows and Command on macOS. Built-in defaults that display `Ctrl/Cmd` bind both `ctrl` and `mod` so Control also works on macOS terminals that do not forward Command.
- Named keys: `enter`, `esc`, `tab`, `space`, `backspace`, `delete`, `up`, `down`, `left`, `right`, `home`, `end`, `pageup`, `pagedown`, and `backtick`.
- Printable characters are written as themselves. Uppercase letters are treated as Shift plus that letter. Explicit `shift+p` is preferred.
- Modifier order does not matter. Unsupported keys and platform modifiers are reported and ignored on that platform.
- A plain printable binding never fires while a text input or filter field has focus. Modified shortcuts still work.

Conflict rules:

- The same key may be bound in different contexts. This is how Pull and Pop stash can both use `p`.
- Context actions override global actions for the same key.
- Two different actions in the same context cannot share a key. The conflicting overrides are rejected, built-in defaults remain effective for those actions, and the conflict is reported with both action IDs and the key.
- `Ctrl+C` is a hardcoded quit/cancel path and cannot be unbound.
- A configuration that leaves quit, help, and the command palette without any binding is allowed to load but shows a prominent warning.

#### Action IDs

Action IDs are stable names used in configuration. They are listed in section 6.1 with their contexts and defaults.

#### Validation and warnings

- Invalid JSON: the file is ignored, defaults remain, and a warning names the file and parse error.
- Invalid version: the file is ignored with a warning.
- Invalid field: only that field is ignored and the previous value remains.
- Invalid keybinding file: `config.json` keybindings still apply, and defaults remain for the rest.
- Invalid theme file: the base theme remains, and the warning appears in Help and the console.
- Warning display: a non-blocking message in the top bar status strip, plus a detailed entry in Help > Configuration and the console. Warnings do not block the app.
- The app does not watch configuration files. Changes apply after Reload configuration or a restart.

#### Reload configuration

The command palette contains Reload configuration.

- Re-reads the main config, keybindings file, and theme file.
- Validates the new configuration before applying it.
- If valid, applies settings and keybindings without a restart. The graph reloads when `graph.scope` or `graph.initialPageSize` changes. Diffs redraw with the new context line count. Mouse and theme changes apply immediately.
- If invalid, keeps the previous effective configuration and shows the warning.
- Preserves the current focus and selection where the relevant action or item still exists.
- Updates footer hints, help, and command palette shortcuts to the effective bindings.

#### Help and discovery

Help contains a Configuration section showing:

- Resolved config path.
- Resolved keybindings path, or "not present".
- Resolved theme path, or "not present".
- Load status and warnings.
- Active theme name.
- A note that Reload configuration is available from the command palette.

The help key list shows effective bindings, including user overrides. Unbound actions are labeled "Unbound".

Acceptance:

- A user can override a key in `config.json` or `keybindings.json` and see the new key in the footer and help.
- `keybindings.json` overrides `config.json` for the same action.
- `null` resets an action, and `[]` unbinds it.
- Conflicting keys in the same context are reported without making the app unusable.
- Invalid configuration never prevents launch or loses repository work.
- Reload configuration applies valid changes without restarting.
- Safety confirmations cannot be disabled through configuration.
- Printable overrides do not fire while typing in the composer or a filter.

### F-20 Theme and colors

Gitminal ships with a built-in Catppuccin theme. The default is Catppuccin Mocha, using the official Catppuccin palette at https://catppuccin.com/palette/.

- No configuration is required to get the default theme.
- v1 has four built-in Catppuccin flavors: Mocha (default, dark), Macchiato (dark), Frappe (dark), and Latte (light).
- Additional non-Catppuccin themes and automatic light/dark switching are deferred to later releases.
- A theme picker is part of v1.
- A user can override colors with `theme.json`.
- Theme selection and overrides are for visual tokens only. They do not change layout, wording, safety behavior, or keybindings.

#### Theme selection

- `config.json` sets `theme` to a built-in name.
- Accepted v1 names: `catppuccin-mocha`, `catppuccin-macchiato`, `catppuccin-frappe`, and `catppuccin-latte`.
- An unknown theme name falls back to Catppuccin Mocha with a warning.
- `theme.json`, when present, is layered over the selected built-in theme. It can override all or only some tokens.
- A missing `theme.json` is normal and silent.

#### Theme picker

The theme picker is a modal opened with `t` from anywhere outside a text input or another modal. The command palette also contains Theme picker.

Contents:

- Title "Theme".
- A list of built-in themes with name, light or dark label, and an active marker.
- v1 list:
  - Catppuccin Mocha (dark), default.
  - Catppuccin Macchiato (dark).
  - Catppuccin Frappe (dark).
  - Catppuccin Latte (light).
- A small color swatch for each row when the terminal supports color.
- If `theme.json` is present, a muted note below the list says "theme.json overrides are active and apply to every base theme."
- The picker remains usable without color; names and the active marker carry the meaning.

Behavior:

- Up and Down, or `j` and `k`, move the selection.
- Moving the highlight previews the theme live across the app, including the modal.
- `Enter` applies the highlighted theme, saves it, and closes the picker.
- `Esc` cancels, restores the previously active theme, and closes the picker.
- The active theme is marked with `*` and a text label, not color alone.
- Applying writes the selected name to the `theme` field in the resolved `config.json`, preserving other fields.
- If `config.json` does not exist, create a minimal valid config with version 1 and the selected theme.
- If `config.json` is malformed, read-only, or cannot be written, apply the theme for the current session, leave the file untouched, and show a warning.
- Selecting a theme does not modify `theme.json`. Overrides continue to layer over the new base theme.
- The picker applies changes immediately without reload or restart.
- If the same theme is selected, Enter simply closes the picker and shows the active theme.
- The footer includes `t Theme` when space permits. Help and the command palette always expose it.
- The theme picker action is read-only with respect to repository state. It never touches git refs or the index.

#### theme.json

Location:

1. `$GITMINAL_THEME` when set and non-empty.
2. `theme.json` next to the resolved main configuration file.
3. Default location is `~/.config/gitminal/theme.json` when no environment override is set.

Format: standard UTF-8 JSON, no comments.

```json
{
  "version": 1,
  "name": "My Catppuccin variant",
  "colors": {
    "background": "#1e1e2e",
    "panel": "#181825",
    "surface": "#313244",
    "border": "#45475a",
    "focus": "#cba6f7",
    "text": "#cdd6f4",
    "muted": "#a6adc8",
    "accent": "#cba6f7",
    "success": "#a6e3a1",
    "warning": "#f9e2af",
    "error": "#f38ba8",
    "info": "#89b4fa",
    "selection": "#585b70",
    "scrollbar": "#585b70",
    "tag": "#fab387",
    "branchLocal": "#cba6f7",
    "branchRemote": "#74c7ec",
    "diffAdd": "#a6e3a1",
    "diffRemove": "#f38ba8",
    "diffAddBackground": "#1f3b2c",
    "diffRemoveBackground": "#3b1f2a",
    "diffContext": "#7f849c",
    "diffHunk": "#89b4fa",
    "graph": ["#cba6f7", "#89b4fa", "#94e2d5", "#fab387", "#f5c2e7", "#a6e3a1"]
  }
}
```

Rules:

- `version` is optional and defaults to 1. A newer schema version is ignored with a warning.
- `name` is optional and used only in Help > Configuration.
- `colors` is required when the file is present. Each value is a `#RRGGBB` color.
- `graph` is an array of one or more lane colors. Lanes cycle through the list.
- Any token omitted from `theme.json` uses the value from the selected built-in theme.
- Unknown tokens and invalid color values are reported and ignored. The base token remains.
- A malformed file or missing `colors` object leaves the base theme active and shows a warning.

#### Theme tokens

| Token | Purpose | Catppuccin Mocha default |
| --- | --- | --- |
| `background` | App background | base |
| `panel` | Sidebar, diff, and console panels | mantle |
| `surface` | Raised rows, modals, inputs, selected sidebar list rows | surface0 |
| `border` | Inactive borders and separators | surface1 |
| `focus` | Focused border and active accent | mauve |
| `text` | Primary text | text |
| `muted` | Secondary text and author names | subtext0 |
| `dim` | Hints, context lines, disabled text | overlay1 |
| `selection` | Selected native select option and focused button background (sidebar list rows deliberately use `surface`) | surface2 |
| `accent` | Primary buttons and ref badges | mauve |
| `success` | Success status and added counts | green |
| `warning` | Warnings and pending state | yellow |
| `error` | Errors, deletions, destructive actions | red |
| `info` | Informational status and hunk headers | blue |
| `scrollbar` | Scrollbar thumb | surface2 |
| `tag` | Tag badges | peach |
| `branchLocal` | Local branch badges | mauve |
| `branchRemote` | Remote branch badges | sapphire |
| `diffAdd` | Added lines and add counts | green |
| `diffRemove` | Removed lines and delete counts | red |
| `diffAddBackground` | Added line background | derived from green |
| `diffRemoveBackground` | Removed line background | derived from red |
| `diffContext` | Diff context text | overlay1 |
| `diffHunk` | Diff hunk header | blue |
| `graph` | Commit graph lane colors | mauve, blue, teal, peach, pink, green |

When `diffAddBackground` or `diffRemoveBackground` is omitted, it is derived from the matching diff foreground with contrast-safe blending. Themes can override either background explicitly.

The token table shows the Catppuccin Mocha source roles. Macchiato, Frappe, and Latte use their own official palette values for the same semantic roles.

#### Rendering behavior

- Use 24-bit color when the terminal supports it.
- Fall back to the nearest supported 256-color value when truecolor is unavailable.
- Fall back to monochrome when color is disabled or the terminal reports no color support.
- Respect `NO_COLOR`. With colors disabled, keep text markers such as `*`, `+`, `-`, `>`, `v`, `M`, `A`, `D`, `R`, and `U`.
- Never rely on color alone to convey current branch, selection, staged state, ahead/behind, unpushed tags, errors, or destructive actions.
- Keep selection, focus, diff additions, and diff removals readable against their backgrounds.
- Theme changes apply at startup and through Reload configuration. They do not require a restart.
- Theme colors apply consistently to the top bar, sidebar, commit graph, composer, diffs, console, modals, footer, badges, and progress indicators.

Acceptance:

- A fresh install shows Catppuccin Mocha without any configuration.
- `t` opens the theme picker with all four Catppuccin flavors and marks the active one.
- Moving the picker highlight previews the theme. Enter applies and saves it. Esc restores the previous theme.
- The selected theme persists across restart when it can be written to `config.json`.
- If saving fails, the theme still applies for the session and a warning explains that it was not saved.
- `theme.json` overrides continue to apply over any selected base theme.
- A `theme.json` with a subset of tokens changes only those tokens and leaves the rest of Catppuccin intact.
- An invalid theme value keeps the base color and shows a warning.
- `NO_COLOR` removes color while preserving all text markers, theme names, and the active marker.
- Theme overrides cannot change layout or safety behavior.
- Reload configuration applies a valid theme without restarting.

### F-21 Startup splash and update check

The app shows a startup splash on every launch, before the workspace and before any repository read is required.

Contents, centered:

- The app wordmark `GITMINAL` rendered with the OpenTUI `tiny` ASCII font.
- The running version, shown as `version <semver>` from the package manifest.
- A startup update line: a checking hint while the npm registry request is in flight, an update notice when a newer version is published, or nothing otherwise.
- A `Press any key to continue` hint.

Update notice:

- Shown only when the registry's latest version is strictly newer than the running version.
- Names the published version and the running version.
- Shows the exact install command, `npm i -g @im4all/gitminal`, on its own line.
- Never shows an install command for a different package, and never runs an install or writes to disk.

Update check behavior:

- Runs once per launch, in the background, while the splash is visible.
- Queries the npm registry metadata endpoint for the `latest` distribution of the app package.
- Uses a short timeout of about two seconds and abandons the request on timeout.
- Is silent on failure. Offline launches, registry errors, timeouts, malformed responses, and invalid versions produce no update line and no warning.
- Compares semantic versions, so a running version that is newer than the registry version, such as a local development build, is not treated as needing an update.
- Is not cached, retried, persisted, or scheduled. A check that has not finished when the splash is dismissed is discarded.
- Sends no identifying information beyond the standard registry request. There is no telemetry, no usage data, and no version reporting.
- Is read-only with respect to the repository, the index, and the configuration files.

Dismissal and keyboard:

- Any key press dismisses the splash and shows the workspace.
- `Ctrl+C` quits the app.
- The splash keys are fixed. They are not configurable and are not part of the keymap in F-19, because the splash runs before the shell and its keymap are mounted.
- While the splash is visible, the shell is not mounted and repository actions are not available.

Terminal size:

- The wordmark uses the `tiny` ASCII font when the terminal is at least 40 columns and 10 rows.
- Below that, the splash falls back to the plain wordmark `GITMINAL` in bold text so the splash never wraps or overflows.
- The splash does not use the terminal-too-small notice from F-01; it degrades to the plain wordmark instead.

Acceptance:

- Launching the app shows the splash with the wordmark, the running version, and the press-any-key hint.
- Pressing any key opens the workspace, and `Ctrl+C` quits.
- When the registry has a newer version, the splash shows the published version, the running version, and `npm i -g @im4all/gitminal`.
- When the app is current, or the check fails, the splash shows no update notice and no warning.
- The splash appears and dismisses promptly and never waits on the update check.
- A running version newer than the registry version does not show an update notice.

## 6. Keyboard map

These are the v1 defaults. They can be overridden by F-19. Context keys override global keys. The footer and help show effective bindings. The startup splash keys are the exception: they are fixed, they run before the keymap is loaded, and they are not configurable.

### Startup splash

| Key | Action |
| --- | --- |
| Any key | Dismiss the splash and show the workspace |
| `Ctrl+C` | Quit |

### Global (outside text inputs and modals)

| Key | Action |
| --- | --- |
| `Tab` / `Shift+Tab` | Next / previous region |
| `?` | Help |
| `Ctrl/Cmd+P` | Command palette |
| `Ctrl/Cmd+`` | Toggle console |
| `r` | Refresh |
| `q` | Quit, with confirmation when work is unsaved or an operation is running |
| `p` | Pull |
| `P` | Push |
| `f` | Fetch |
| `F` | Fetch --prune |
| `.` | More remote actions |
| `c` | Focus commit composer, when it is visible |
| `t` | Theme picker |
| `Esc` | Clear transient state or return focus |

### Direct region jumps

| Key | Region |
| --- | --- |
| `1` | Branches |
| `2` | Remotes |
| `3` | Tags |
| `4` | Stashes |
| `5` | Worktrees |
| `6` | Commit graph |
| `7` | Right pane (composer or commit details) |
| `8` | Diffs |
| `9` | Console |

These jumps are a spatial map in screen order, not a second copy of the Tab cycle. They do not fire while a text input or an overlay owns keys, so a focused filter, search field, or composer keeps its digits. `9` opens the console if it is closed. Jumping to the region that already has focus does nothing. Every jump preserves the target region's cursor, selection, and scroll position. The top bar is intentionally unbound; bind `focus.region.topBar` when direct access is wanted.

### Top bar

| Key | Action |
| --- | --- |
| `Left` / `Right` | Move between controls |
| `Enter` | Activate the focused control |
| `p` / `P` | Pull / Push |
| `f` / `F` | Fetch / Fetch --prune |
| `.` | More remote actions |

### Branches

| Key | Action |
| --- | --- |
| `Up` / `Down`, `j` / `k` | Navigate |
| `Enter` | Check out |
| `n` | New branch |
| `d` | Delete branch |
| `g` / `G` | First / last |
| `/` | Filter |

### Remotes

| Key | Action |
| --- | --- |
| `Up` / `Down`, `j` / `k` | Navigate |
| `Space` | Create local branch |
| `Enter` | No action in v1 |
| `/` | Focus filter |
| `g` / `G` | First / last |

### Tags

| Key | Action |
| --- | --- |
| `Up` / `Down`, `j` / `k` | Navigate |
| `n` | New tag |
| `d` | Delete tag |
| `P` | Push selected tag |
| `Enter` | Select tagged commit |
| `/` | Filter |

### Stashes

| Key | Action |
| --- | --- |
| `Up` / `Down`, `j` / `k` | Navigate |
| `s` | Stash changes |
| `a` | Apply |
| `p` | Pop, with confirmation |
| `d` | Delete, with confirmation |
| `Enter` | Show stash diff |

### Worktrees

| Key | Action |
| --- | --- |
| `Up` / `Down`, `j` / `k` | Navigate |
| `n` | New worktree |
| `d` | Delete worktree |
| `Enter` | Show worktree details |
| `/` | Filter |

### Commit graph

| Key | Action |
| --- | --- |
| `Up` / `Down`, `j` / `k` | Navigate |
| `PageUp` / `PageDown` | Move by a screen |
| `g` / `G` | Newest loaded / oldest loaded, then load another page |
| `/` or `Ctrl/Cmd+F` | Search commits |
| `Enter` | Select the current row |
| `Esc` | Return focus |

### Commit composer

| Key | Action |
| --- | --- |
| `Ctrl/Cmd+S` | Commit staged files |
| `Alt+.` | Commit options menu while the message field is focused |
| `.` | Commit options menu while the right-pane region frame is focused outside the message field |
| `Ctrl/Cmd+Enter` | Submit the focused form (multiline forms) |
| `Esc` | Leave the textarea |
| `Enter` | New line |

### Diffs

| Key | Action |
| --- | --- |
| `Up` / `Down`, `j` / `k` | Navigate file rows |
| `Left` / `Right`, `h` / `l` | Collapse / expand section or file |
| `Enter` | Toggle file |
| `s` | Stage selected file |
| `u` | Unstage selected file |
| `d` | Discard or delete selected file, with confirmation |
| `S` | Stage all in the current section |
| `U` | Unstage all in the current section |
| `D` | Discard or delete all in the current section, with confirmation |

### Console

| Key | Action |
| --- | --- |
| `Ctrl/Cmd+`` | Close |
| `Up` / `Down`, `j` / `k` | Scroll |
| `PageUp` / `PageDown` | Page |
| `g` / `G` | Oldest / newest |
| `Enter` | Expand or collapse the selected entry |
| `c` | Clear, with confirmation |
| `Esc` | Close |

### Modals and palette

| Key | Action |
| --- | --- |
| `Up` / `Down`, `j` / `k` | Navigate options |
| `PageUp` / `PageDown` | Move by a page |
| `g` / `G` | First / last option |
| `Enter` | Confirm or run |
| `Esc` | Cancel or close |
| `Tab` / `Shift+Tab` | Move between fields and actions |
| `Ctrl/Cmd+Enter` | Submit a multiline form |

### 6.1 Action IDs

These IDs are stable and are the only names accepted in `config.json` and `keybindings.json`. The keymap above shows their built-in defaults.

| Context | Action IDs |
| --- | --- |
| Global | `app.quit`, `app.help`, `app.palette`, `app.console`, `app.refresh`, `app.reloadConfig`, `app.themePicker`, `remote.pull`, `remote.push`, `remote.pushForceSafe`, `remote.pushForceOverwrite`, `remote.pushNoVerify`, `remote.fetch`, `remote.fetchPrune`, `remote.more`, `commit.focus`, `focus.next`, `focus.previous`, `overlay.close` |
| Direct focus | `focus.region.topBar`, `focus.region.branches`, `focus.region.remotes`, `focus.region.tags`, `focus.region.stashes`, `focus.region.worktrees`, `focus.region.graph`, `focus.region.rightPane`, `focus.region.diff`, `focus.region.console` |
| Shared navigation | `nav.up`, `nav.down`, `nav.pageUp`, `nav.pageDown`, `nav.first`, `nav.last`, `nav.activate` |
| Commit graph | `graph.search` |
| Top bar | `nav.left`, `nav.right` |
| List filtering | `list.filter` |
| Branches | `branch.create`, `branch.delete` |
| Remotes | `remote.createLocal` |
| Tags | `tag.create`, `tag.push`, `tag.delete` |
| Stashes | `stash.create`, `stash.apply`, `stash.pop`, `stash.delete` |
| Worktrees | `worktree.create`, `worktree.delete` |
| Commit composer | `commit.submit`, `commit.submitNoVerify`, `commit.amend`, `commit.amendNoVerify`, `commit.options` |
| Diffs | `nav.expand`, `nav.collapse`, `diff.toggle`, `diff.stage`, `diff.unstage`, `diff.discard`, `diff.deleteUntracked`, `diff.stageAll`, `diff.unstageAll`, `diff.discardAll`, `diff.deleteAllUntracked` |
| Console | `console.clear` |
| Help | `help.search` |
| Modals, palette, and help | `form.submit`, `nav.activate`, `overlay.close`, `focus.next`, `focus.previous` |

Notes:

- `nav.activate` performs the primary action for the focused item: checkout, select, confirm, run, open details, or expand or collapse the selected console entry. `diff.toggle` shadows it in the Diff panel to expand or collapse a file.
- `overlay.close` closes modals, the console, the palette, and help.
- `app.reloadConfig` has no default key and is always available from the command palette.
- `focus.region.topBar` has no default key. The other direct focus actions default to `1`-`9` in screen order. A direct focus action never runs a region action, and it stays available while a git operation is running.
- Context action IDs shadow global IDs with the same key. For example, `tag.push` overrides `remote.push` while Tags is focused.
- Actions that are unbound still appear in the command palette and help.
- `remote.pushForceSafe`, `remote.pushForceOverwrite`, and `remote.pushNoVerify` have no default key; they are reachable from the More menu and the command palette.
- `commit.submitNoVerify`, `commit.amend`, and `commit.amendNoVerify` have no default key; they are reachable from the commit options menu and the command palette. `commit.submit` remains the default `Ctrl/Cmd+S` action.
- `diff.deleteUntracked` and `diff.deleteAllUntracked` are the untracked-delete intents. `diff.discard` and `diff.discardAll` act only on tracked working-tree files. Pressing `d` or `D` in the Diff panel performs the tracked or untracked intent that matches the selected section; the keymap resolves `d` and `D` to `diff.discard` and `diff.discardAll`, and the Diff handler routes to the untracked intent for untracked targets.
- `form.submit` defaults to `Ctrl/Cmd+Enter` and is the submit action for every multiline form. Single-line forms keep native Enter submission.
- `app.help` defaults to `?` plus `F1`, and `app.palette` defaults to `Ctrl/Cmd+P` plus `F2`, so both remain reachable when a terminal reserves the primary binding. These are alternative keys for the same action ID, not separate actions.
- Internal selection commands such as `graph.selectCommit`, `stash.select`, and `worktree.select` are command IDs used by the palette and other features. They have no action ID and no default key.

## 7. End-to-end flows

### Stage and commit

1. User focuses the Diff panel and selects a working file.
2. User presses `s` or clicks Stage. The file moves to Staged Files.
3. The composer becomes editable and shows the git identity.
4. User types a message and presses `Ctrl/Cmd+S`.
5. A progress state appears if the commit hook takes time.
6. On success, the message clears, staged files disappear, the graph gains the new commit, and a success status appears.
7. On hook failure, the error overlay shows the hook output, and the message and staged files remain.

### Review a commit

1. User focuses the graph and moves to a commit.
2. The right pane shows the commit hash, tree hash, author, dates, parents, refs, and stats.
3. The Diff panel shows the commit's files and diffs, read-only.
4. User selects the Pending Changes row to return to the composer.

### Create a local branch from a remote branch

1. User focuses Remotes and selects `origin/feature/AB-1231`.
2. User presses Space or double clicks.
3. The modal prefills `feature/AB-1231`, shows the base ref, and offers checkout.
4. User edits the name if needed and confirms.
5. The local branch is created and optionally checked out.
6. The Branches panel refreshes and marks the current branch.

### Push a branch with no upstream

1. User checks out a new local branch that has no upstream.
2. The top bar shows "no upstream" and Pull is unavailable.
3. User presses `P` or clicks Push.
4. The app reports "Creating origin/<local-branch-name> and setting upstream" and pushes.
5. On success, the top bar shows `origin/<local-branch-name>` and zero ahead/behind.
6. If `origin` is missing or the push is rejected, the error is shown and the local branch is unchanged.

### Delete a branch locally or remotely

1. User focuses Branches and presses `d`.
2. The modal shows "Delete local branch only" and "Delete local and remote branch", naming the configured upstream or the same-name origin branch.
3. User selects a scope and confirms.
4. For local and remote, the app preflights the local delete, deletes the local branch first, then deletes the upstream remote branch.
5. On success, the branch disappears from Branches and the Remotes panel refreshes.
6. If local deletion fails, both branches remain. If remote deletion fails after the local branch is gone, the app reports a partial failure and names the remaining remote branch.

### Discover a deleted remote branch

1. A remote branch is deleted outside the app while a local branch still tracks it.
2. User runs Fetch --prune.
3. The remote-tracking ref is pruned and the local branch shows `[?] remote branch deleted`.
4. Pull is unavailable for that branch. Push can recreate the configured upstream branch, or the user can delete the local branch only.

### Stash and restore

1. User focuses Stashes and presses `s`.
2. The modal asks for a message and whether to include untracked files.
3. User confirms. The working tree and staged changes are stashed, and the new stash appears.
4. Later, the user selects the stash and presses `a` to apply or `p` to pop.
5. Pop asks for confirmation, applies, and drops only after success.

### Create, push, and delete a tag

1. User focuses Tags and presses `n`.
2. The modal asks for a name, target, optional annotation, and whether to push.
3. User creates the tag. It appears with an unpushed indicator if not pushed.
4. User presses `P` to push it, or uses the create-and-push option.
5. Later, user presses `d`, chooses local only or local and remote, and confirms.

### Remote operation and failure

1. User presses `p` to pull, or uses the top bar.
2. The app shows progress and disables conflicting actions.
3. On success, the branch, ahead/behind, graph, and sidebar refresh.
4. On failure, the app shows the git error, the console records the command and output, and local state is unchanged.

## 8. Acceptance criteria for v1

- Launching shows the startup splash with the wordmark, the running version, and the press-any-key hint.
- Any key dismisses the splash and opens the workspace, and `Ctrl+C` quits.
- When a newer version exists on npm, the splash shows the published version, the running version, and `npm i -g @im4all/gitminal`. A current or failed check shows no update notice and no warning.
- Launching in a normal repository shows the current branch, upstream state, local branches, remote branches, tags, stashes, worktrees, commit graph, composer, and diffs.
- Launching outside a repository shows a clear non-repository state and no destructive actions.
- Focus changes are visible and footer hints match the focused region.
- `1`-`9` focus the nine labeled regions directly, the top bar stays on Tab only, and no digit fires while a text input or an overlay owns keys.
- Pull, Push, Fetch, Fetch --prune, safe force push, overwrite force push, and push --no-verify work from the top bar, More menu, and keys.
- Push with no upstream creates `origin/<local-branch-name>`, sets the upstream, and updates the top bar without an extra modal.
- Branch create, checkout, and delete work, with correct current-branch and worktree protections.
- The Delete Branch modal always offers local only and local plus remote, and explains unavailable remote deletion.
- Fetch updates only the upstream refs of local branches and does not fetch unrelated remote branches.
- A missing upstream ref or a failed remote does not block other fetched upstreams, and partial success is reported.
- Fetch --prune marks local branches with missing upstream refs as `[?] remote branch deleted`; a later fetch that finds the ref clears the indicator.
- Remote branches without a local upstream remain in their last known state and are not pruned by a scoped Fetch --prune.
- Remote branch Space/double-click opens a renameable create-local-branch confirmation.
- Tags can be created, pushed, and deleted locally or locally plus remote, with unpushed indicators.
- Stashes can be created with a message, applied, popped with confirmation, and deleted with confirmation.
- Worktrees can be listed, created, and deleted, with current and dirty protections.
- The commit graph shows pending changes, merges, refs, tags, file counts, authors, and dates, and lazy-loads older history with bounded pages.
- The composer is disabled when nothing is staged, shows "Nothing to commit", commits staged files only, resets on success, and preserves work on failure.
- The commit options menu includes `--no-verify` and amend variants.
- The Diff panel has working, staged, and untracked sections with per-file and bulk actions, confirmations for destructive actions, and correct comparisons.
- Conflicted files appear as `U` rows with conflict markers and can be staged after external resolution.
- Binary and oversized files show a clear notice instead of a broken diff.
- Selecting a commit shows commit details and a read-only commit diff; selecting Pending Changes restores the composer.
- The command palette opens with its configured shortcut (default `Ctrl/Cmd+P`), filters, explains unavailable commands, and runs actions.
- The console logs executed commands, results, durations, and errors, with redaction and scrolling.
- Help opens with its configured shortcut (default `?`), searches with its configured key (default `/`), and documents every implemented key.
- Application settings and keybindings can be overridden in `~/.config/gitminal/config.json`, with an optional `keybindings.json` override.
- Footer hints, help, and the command palette show effective bindings after configuration overrides.
- Reload configuration applies valid settings, keybindings, and theme changes without restarting.
- A fresh install uses Catppuccin Mocha. `theme.json` can override individual color tokens, and omitted tokens keep the Catppuccin base.
- `t` opens the theme picker with Catppuccin Mocha, Macchiato, Frappe, and Latte. Highlight previews, Enter applies and saves, and Esc restores the previous theme.
- The selected theme persists across restart when it can be written to `config.json`; otherwise it applies for the session with a warning.
- Invalid configuration or theme files never block launch, and their warnings are visible in Help > Configuration and the console.
- `NO_COLOR` and low-color terminals remain usable, with text markers preserved.
- Configuration cannot disable destructive confirmations, force-push warnings, or credential prompt protection.
- Every destructive action requires explicit confirmation and names its target.
- Failures keep the user's message, staged files, and repository state, and are visible in both the error overlay and console.
- The app remains usable at the target minimum size and shows a clear notice below it.
- The app does not hang on git prompts; missing credentials and network failures are reported.
- The app works with an empty repository, detached HEAD, no upstream, no remote, and conflicted files as described above.

## 9. Resolved product decisions

| ID | Decision | Outcome |
| --- | --- | --- |
| D1 | v1 scope | All listed features are v1, sequenced by risk. |
| D2 | Key precedence | Focused context wins. Global keys apply when the focused region does not define a conflict. |
| D3 | Commit graph scope | All local and remote branches plus `HEAD`, with ref badges, so detached commits stay visible. |
| D4 | Force push behavior | Offer both `--force-with-lease` and literal `--force`. Safe force is primary; literal force has a stronger confirmation. |
| D5 | Conflict support | Show conflicted files and conflict-marker diffs. The user resolves externally and stages. No ours/theirs actions in v1. |
| D6 | Pushing tags | Provide a Push tag action and an optional create-and-push checkbox. |
| D7 | Stashing untracked files | Provide a checkbox, default off. |
| D8 | Worktree selection | Manage only. Do not switch the app to another worktree in v1. |
| D9 | Commit options | Include `--no-verify` and amend variants. |
| D10 | Live refresh | Watch the git directory, refresh on focus, and keep manual `r` refresh. Do not watch the whole worktree. |
| D11 | Configuration | Settings and keybindings load from `config.json`, with an optional `keybindings.json` override and a Reload configuration command. Invalid files never block launch. |
| D12 | Theme | Catppuccin Mocha is the built-in default. v1 includes Mocha, Macchiato, Frappe, and Latte. `theme.json` layers partial color overrides. Non-Catppuccin themes are later. |
| D13 | Branch deletion | The modal always offers local only and local plus remote. Remote targets the configured upstream, or `origin/<local-branch-name>` when no upstream exists. Missing upstream refs show a `[?]` indicator, confirmed as deleted after prune or after the app deletes the remote branch. |
| D14 | Push without upstream | Push automatically creates `origin/<local-branch-name>`, pushes, and sets the upstream without an extra modal. |
| D15 | Fetch scope | Fetch updates only the upstream refs of local branches, grouped by remote and deduplicated. It does not fetch every remote branch. The default setting is `remote.fetchScope: "local"`. |
| D16 | Commit history loading | The graph lazy-loads bounded pages, starting at 500 commits by default, and loads older commits near the bottom. It never loads full history up front. |
| D17 | Commit search | `/` or `Ctrl/Cmd+F` opens an inline search above the graph. It matches subject and message body across the full graph scope, loads results lazily, and Esc restores the previous graph state. |
| D18 | Theme picker | `t` opens a modal theme picker. Highlight previews live, Enter applies and saves the theme, and Esc restores the previous theme. |
| D19 | Startup splash and update check | Every launch shows a splash with the wordmark and version. Any key opens the workspace. The app checks npm once in the background and shows the exact install command only when a newer version exists. Failures are silent. |
| D20 | Direct region focus | `1`-`9` focus the nine labeled regions in screen order: sidebar panels `1`-`5`, commit graph `6`, right pane `7`, Diffs `8`, console `9`. The top bar is left unbound because it is rarely a focus target and already has global keys. In a text input the digit types normally, and an overlay captures it. |

## 10. Assumed defaults

These are settled by the spec unless the product owner objects during review.

- Console is a non-modal bottom drawer.
- Push with no upstream automatically creates `origin/<local-branch-name>` and sets the upstream. No extra confirmation modal is shown.
- Fetch is scoped to the upstream refs of local branches. The default `remote.fetchScope` is `local`, not all remote branches.
- Selecting a tag with `Enter` selects its commit in the graph.
- Author names longer than 12 characters are shortened to initials.
- The commit graph loads an initial bounded page of 500 commits by default and lazy-loads older pages near the bottom. It never loads full history up front.
- Commit search is opened with `/` or `Ctrl/Cmd+F` while the graph is focused, follows `graph.scope`, shows flat lazy-loaded results, and Esc restores the prior graph state.
- All three diff sections are expanded by default; only the first Working Directory file is expanded.
- Default theme is Catppuccin Mocha. Configuration changes require Reload configuration or a restart; files are not hot-watched.
- Theme picker selection persists by writing the `theme` field in `config.json`. Live preview is used before Enter.
- Submodules, LFS, non-Catppuccin built-in themes, automatic light/dark switching, and a settings screen remain deferred.
- The startup splash is shown on every launch, including when the app is launched outside a repository or from a subdirectory.
- The npm update check has a two second timeout, is silent on failure, runs once per launch, and is discarded if the splash is dismissed first.
- The published package name used by the update check and the install hint is `@im4all/gitminal`.

## 11. Suggested delivery slices

These are product slices for later ticket creation, ordered to keep the app runnable and observable.

1. Startup splash: wordmark, version, press-any-key dismiss, background npm update check, and a silent failure path.
2. Shell and navigation: layout, focus model, footer hints, help shell, command palette shell, mouse basics, empty and non-repo states.
3. Configuration and theme: config and keybindings discovery, schema validation, overrides, Reload configuration, Catppuccin flavors, theme picker, theme.json overrides, color fallbacks.
4. Repository read path: branch, status, refs, commit graph, commit details, diffs, pending changes row.
5. Working tree and commit: stage, unstage, discard with confirmation, untracked handling, composer, commit, commit options, hook failure handling.
6. Sidebar actions: branches, remotes, create-local-branch flow, tags, stashes, worktrees.
7. Remote operations: scoped fetch, pull, push, auto-create upstream, safe force, overwrite force, no-verify, progress, error handling.
8. Overlays and history: console, command palette, help search, error overlays, confirmations.
9. Hardening: large repository pagination, virtualization, binary and oversized diffs, redaction, timeouts, external refresh, platform checks, acceptance pass.

## 12. Ticket mapping

Proposed epics for the ticket phase:

- E1 App shell, focus, footer, layout, responsive behavior.
- E2 Git data and repository states.
- E3 Commit graph, commit details, lazy page loading, virtualization, and commit search.
- E4 Working tree, diffs, staging, discard.
- E5 Commit composer and commit variants.
- E6 Branches, including local-only and local-plus-remote delete, and missing-upstream indicators.
- E7 Remotes and remote operations, including scoped fetch, push auto-create upstream, and prune-driven gone indicators.
- E8 Tags.
- E9 Stashes.
- E10 Worktrees.
- E11 Command palette.
- E12 Console.
- E13 Help.
- E14 Modals, confirmations, errors, notifications.
- E15 Freshness, performance, safety, platform hardening.
- E16 Configuration and keybinding overrides.
- E17 Theme, Catppuccin flavors, theme picker, persistence, and theme overrides.
- E18 Startup splash, wordmark, press-any-key dismiss, and npm update check.

Each epic should produce independently verifiable behavior and include its own empty, loading, error, and keyboard states.
