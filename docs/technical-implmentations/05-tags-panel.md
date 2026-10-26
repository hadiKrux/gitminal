# 05 Tags Panel

## 1. Header

- Spec reference: `docs/product-spec.md` F-05 (lines 452-506), decision D6 (line 1874), action IDs (lines 1705-1742)
- Architecture contract: `docs/technical-implmentations/00-project-architecture.md`
- Region id: `tags` (`src/features/shell/regions.ts`)
- Dependencies: F-02 (the `P` context override of `remote.push`), F-08 (Enter selects the tagged commit in the graph), F-15 (modal structure and destructive confirmations), F-16 (repository states), F-17 (freshness and performance), F-18 (safety), F-19 (configuration).
- Owned paths:
  - `src/features/tags/TagsPanel.tsx`
  - `src/features/tags/TagRow.tsx`
  - `src/features/tags/CreateTagModal.tsx`
  - `src/features/tags/DeleteTagModal.tsx`
  - `src/features/tags/useTags.ts`
  - `src/domain/git/git.tags.ts`
- Co-owned path: `src/domain/repository/repository.selectors.ts` owns the merge of local and remote tag knowledge consumed by the panel.

## 2. Scope and non-goals

Scope: one unified logical row per tag name across local and remote refs; scope indicators `local`, `remote`, `unpushed`, `local only`, and `unknown`; version-aware descending ordering; Enter selects the tagged commit in the graph; Create Tag modal with annotated versus lightweight rules and an optional create-and-push; Push Tag with confirmation; Delete Tag modal with local, local-and-remote, and remote-only scopes plus remote selection; partial failure reporting.

Non-goals: signed or verified tags; tag rename; force overwriting an existing tag; editing a tag message; pushing all tags at once; fetching all tags; a separate tag details screen.

## 3. OpenTUI components used

| Component | Where used | Why it is right |
| --- | --- | --- |
| `<box>` | Panel frame, every tag row, modal layout, scope choice container, remote choice container | The only layout primitive; rows need custom scope indicators and a commit summary |
| `<text>` | Tag name, scope indicator text, tagged commit summary, empty and error text | Every UI string must be rendered through `<text>` |
| `<span>` | Inline scope indicator and the commit summary run inside one `<text>` | Inline styled runs inside a single `<text>` |
| `<scrollbox>` | The tag list container, with `viewportCulling` and a scrollbar when the filtered list overflows | Scrollable region; tag lists can be long |
| `<input>` | Tag name field in the Create Tag modal, and the filter field through `SearchField` | Single-line fields; tag names and filters are single line |
| `<textarea>` | Optional message field in the Create Tag modal | Annotated tag messages can be multiline; architecture section 6 assigns multiline fields to `<textarea>` |
| `<select>` | Delete Tag scope choice, and the remote picker when multiple remotes contain the tag | Uniform option lists with built-in up/down and Enter |
| `<checkbox>` composition | "Push to remote after creating" in the Create Tag modal, via the `Checkbox` primitive | Toggle with `[x]`/`[ ]`, keyboard and mouse |

Hooks used:

| Hook | Where used | Why |
| --- | --- | --- |
| `useKeyboard` | Only inside `src/app/hooks/useHotkeys.ts` | Central dispatcher; this feature never calls it directly |
| `useAction` | `useTagActions.ts` registers the region-scoped handlers `tag.create`, `tag.delete`, `tag.push`, and `list.filter` with `scope: "tags"`; `useTags.ts` composes that hook and owns rows, filter, and cursor state; `useListCursor` registers `nav.up`, `nav.down`, and `nav.activate` in the same scope | One handler per `(actionId, scope)`; global actions such as `app.refresh` and `focus.*` are owned by the app or shell and are never registered here |
| `useListCursor` | `useTags.ts` navigation and double click detection | Shared cursor and double click logic for custom rows |
| `useFocusRegion` | `useTags.ts` refreshes the tag list and remote tag knowledge when `focused` flips true | Region focus is derived from native focus; `useFocus` only reports terminal-window focus |
| `useTerminalDimensions` | `TagRow.tsx` computes the truncation budget for the commit summary | Budget-aware truncation via `@/lib/text.ts` |

`<scrollbox>` versus `<select>` decision: the tag list uses a `<scrollbox>` of `<box>` rows because each row combines a tag name, one or more scope indicators, and a commit summary, which `<select>` cannot render. `<select>` is used only for the uniform scope and remote choices inside `DeleteTagModal.tsx` (architecture section 6 rule 3).

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
TagsPanel (body only; SidebarPanelFrame owns the Panel, border title, and scrollbox)
  SearchField (filter, focused by list.filter)
  TagRow (one per logical tag)
    ListRow (box)
      TextMarker
      text (tag name)
        span (scope indicator: local, remote, unpushed, local only, remote unknown)
      text (tagged commit summary, when width permits)
  LoadingRow (while the first read is in flight)
  EmptyState (no tags, or no matches)
  ErrorState (read failed, with Retry)
```

The body has no title or count row: the shell border title carries `Tags (<count>)`. Modals are pushed onto `OverlayProvider` (F-15), not nested in the panel:

```text
CreateTagModal
  ModalFrame
    FormField (tag name input, inline error text)
    text (read-only target commit, defaulting to the graph selection or HEAD)
    FormField (message textarea, optional; empty means lightweight)
    Checkbox ("Push to remote after creating", default off; states the target remote)
    ModalActions (Create, Cancel)

DeleteTagModal
  ModalFrame
    text (tag name)
    SelectField (scope: "Delete locally" / "Delete locally and from a remote" / "Delete from remote only")
    SelectField (remote picker, shown when multiple remotes contain the tag)
    text (consequence text naming the selected scope)
    ModalActions (confirm label by scope, Cancel focused by default)
```

Push Tag uses the shared `ConfirmModal` from `src/features/overlays/` (F-15) with the title "Push tag" and the target tag and remote named.

## 5. Enforced files and folders

- `src/features/tags/TagsPanel.tsx` - panel composition, region registration, and action wiring. Focus refresh lives in `useTags.ts`.
- `src/features/tags/TagRow.tsx` - one logical tag row with scope indicators and commit summary.
- `src/features/tags/CreateTagModal.tsx` - annotated versus lightweight rules, target, and optional create-and-push.
- `src/features/tags/DeleteTagModal.tsx` - scope selection, remote selection, and consequence text.
- `src/features/tags/useTags.ts` - derives logical rows from selectors, owns filter and cursor state, dispatches commands.
- `src/features/tags/useTagActions.ts` - registers `tag.create`, `tag.delete`, `tag.push`, and `list.filter` with `scope: "tags"`, runs the target availability pre-checks, and opens the modals, composed by `useTags.ts`.
- `src/domain/git/git.tags.ts` - tag reads, remote tag reads, scope merge, ordering, and create, push, and delete command builders.
- Tests colocated: `src/domain/git/git.tags.test.ts`, `src/features/tags/TagsPanel.test.tsx`, `src/features/tags/TagRow.test.tsx`, `src/features/tags/CreateTagModal.test.tsx`, plus the shared `src/domain/commands/commands.availability.test.ts` matrix.

## 6. State model

Local view state (owned by `useTags.ts` and the modals):

- Filter string for the tag list.
- Cursor index for the `tags` region, stored through `useListCursor` and persisted per region by `FocusProvider`.
- Modal open flag and which tag opened it, through `useOverlay`.
- Create Tag draft: name string, target commit, message string, push-after-create boolean.
- Delete Tag draft: selected scope, selected remote, force acknowledgement when applicable.

Provider state (read, never recomputed here):

- `RepositoryProvider` snapshot: local tags with name, object type (`tag` or `commit`), peeled target commit, and commit subject.
- Remote tag knowledge: for each configured remote, the set of tag names returned by the last successful read-only `git ls-remote --tags <remote>` check, with the timestamp of that successful check, plus a per-remote status of `known`, `neverChecked`, or `failed`. Commit dates never determine remote tag knowledge, and a failed or never-completed check is `unknown`, never `unpushed`.
- Merged logical rows with scope indicators, derived in `@/domain/repository/repository.selectors.ts` from `git.tags.ts` merge output.
- `RepositoryProvider` selection: `selection.kind === "commit"` supplies the default Create Tag target; otherwise the target is HEAD.
- `ConfigProvider`: `git.path`.
- `StatusProvider`: operation progress and transient status.
- `FocusProvider`: derived active region and cursor map.

Rules: this feature never recomputes scope indicators or ordering itself. It reads them from `@/domain/git/git.tags.ts` and `@/domain/repository/repository.selectors.ts` (architecture section 9).

## 7. Data flow

Generic path (architecture section 9):

```text
key or click -> action ID -> useAction handler -> useCommandRunner.runCommand(request)
  -> command runner (availability + serialization) -> @/domain/git/git.tags.ts -> git CLI
  -> CommandResult -> useCommandRunner applies RepositoryProvider refresh, console entry, status, and error overlay
  -> TagsPanel re-render
```

| Action ID or refresh | Domain module | Git subcommand |
| --- | --- | --- |
| repository refresh (local tags) | `git.tags.ts` `readLocalTags()` | `git for-each-ref refs/tags --format=%(refname:short)%00%(objecttype)%00%(*objectname)%00%(objectname)%00%(*subject)%00%(subject)` |
| remote tag knowledge (read-only) | `git.tags.ts` `readRemoteTags()` | `git ls-remote --tags -- <remote>`; only a successful result updates the known set and its timestamp |
| scope merge | `git.tags.ts` `mergeTagScopes()` (pure) | none; produces the `local`, `remote`, `unpushed`, `local only`, and `unknown` states |
| ordering | `git.tags.ts` `sortTagsVersionDesc()` (pure) | none |
| `tag.create` (lightweight) | `git.tags.ts` `planCreateTag()` -> `commands.tags.ts` `executeTagCreate()` | `git tag <name> <target>` |
| `tag.create` (annotated) | `git.tags.ts` `planCreateTag()` -> `commands.tags.ts` `executeTagCreate()` | `git tag -a <name> <target> -m <message>` |
| `tag.push` | `git.tags.ts` `planPushTag()` -> `commands.tags.ts` `executeTagPush()` | `git push --progress -- <remote> refs/tags/<name>` |
| `tag.delete` (local only) | `git.tags.ts` `planDeleteLocalTag()` -> `commands.tags.ts` `executeTagDelete()` | `git tag -d <name>` |
| `tag.delete` (local and remote) | `planDeleteRemoteTag()` then `planDeleteLocalTag()` -> `executeTagDelete()` | `git push --progress --delete -- <remote> refs/tags/<name>` then the local delete above |
| `tag.delete` (remote only) | `git.tags.ts` `planDeleteRemoteTag()` -> `commands.tags.ts` `executeTagDelete()` | `git push --progress --delete -- <remote> refs/tags/<name>` |
| `nav.activate` (select tagged commit) | sets `RepositoryProvider` selection equivalent to the internal `graph.selectCommit` command | none; sets `{ kind: "commit", oid }`, no git call |

Command and handler model (architecture section 8.1):

- `useTagActions.ts` registers `tag.create`, `tag.delete`, `tag.push`, and `list.filter` with `scope: "tags"`, composed by `useTags.ts`. Exactly one handler exists per `(actionId, scope)`. `useListCursor` owns the region's `nav.*` handlers. The feature never registers `app.refresh`, `focus.*`, `overlay.close`, or `remote.*`; those are owned by the app, shell, or top bar.
- Targets are explicit. `tag.delete` and `tag.push` use `{ kind: "tag", name }` for the selected row. `tag.create` always uses `{ kind: "none" }`; the target commit or `HEAD` travels in the form values as `target`, together with `name`, `message`, `push`, and `remote`. The modal reads `RepositoryProvider.selection.kind === "commit"` to choose the form value, and the executor plans from that value. This keeps a not-yet-existing tag from needing a command target kind.
- `nav.activate` in the Tags region sets `RepositoryProvider.selection` to `{ kind: "commit", oid: selectedTag.targetOid }`, which is the internal `graph.selectCommit` semantics. `graph.selectCommit` is a command ID only: it has no action ID, no default key, and no git call. A remote-only logical row has no local commit to select, so `nav.activate` is a no-op there rather than fetching.
- Availability is target-aware through `@/domain/commands/commands.availability.ts`. `tag.create`, `tag.delete`, and `tag.push` are unavailable in an empty repository with the reason "no commits yet". `tag.push` is available only for a local tag when the last successful check of the relevant remote says the tag is absent; when that knowledge is `unknown`, the reason is "remote tag state unknown; refresh to retry". `tag.delete` is available when the selected tag exists locally, remotely, or both.

Scope indicators (from `git.tags.ts` `mergeTagScopes()`):

- `local`: present locally.
- `remote`: present on at least one remote.
- `unpushed`: present locally and absent from the relevant remote according to the last successful remote check.
- `local only`: present locally and no remote is configured.
- `unknown`: present locally, at least one remote is configured, and the last remote check for the relevant remote is missing or failed. The row keeps the name and commit subject but shows "remote unknown"; it never shows `unpushed` from missing knowledge.

Annotated versus lightweight detection: `%(objecttype)` is `tag` for an annotated tag and `commit` for a lightweight tag. For an annotated tag, the tagged commit is the peeled `%(*objectname)`, and the commit subject is `%(*subject)`. For a lightweight tag, the tagged commit is `%(objectname)`, and the commit subject is `%(subject)`. `%(subject)` alone is never used as the annotated tag summary, because for an annotated tag it returns the tag message. `parse.refs.ts` selects the subject by object type and `TagRow.tsx` renders only the commit subject.

Ordering rule (`sortTagsVersionDesc()`): split each name into numeric and non-numeric runs; compare run by run with numeric runs compared numerically and non-numeric runs compared as strings; sort descending; break exact ties by reverse name order. The result is deterministic and stable across refreshes.

Delete order and partial failure: for local and remote, delete the remote tag first, then the local tag. If remote deletion fails, keep the local tag and show the error. If remote deletion succeeds but local deletion fails, report a partial failure and keep the local tag visible with the `unpushed` indicator, because it is now absent from the remote.

## 8. Keyboard and focus

| Action ID | Behavior in the Tags region |
| --- | --- |
| `nav.up`, `nav.down` | Move the cursor one row |
| `nav.activate` | Select the tagged commit in the commit graph and show its details by setting the commit selection (the `graph.selectCommit` semantics) |
| `tag.create` | Open the Create Tag modal |
| `tag.delete` | Open the Delete Tag modal for the selected tag |
| `tag.push` | Push the selected local tag that is not known to be on the remote, after confirmation; this ID overrides `remote.push` while Tags is focused |
| `list.filter` | Focus the tag filter field |
| `focus.next`, `focus.previous` | Tab traversal (owned by `useFocusModel`) |
| `focus.region.tags` | Direct jump to this panel (default `3`), shell-owned |

Notes: `app.refresh` is a global action owned by the app or shell; it is not registered by this feature. `nav.first` and `nav.last` are unbound in the Tags context per product spec section 6, so `g` and `G` are not claimed here. The footer shows only the actions available for the selected tag, for example `tag.push` only when the tag is local and the last successful remote check says it is absent. A tag known only remotely has no `tag.push`, and an `unknown` remote state disables it with "remote tag state unknown; refresh to retry". Modals are overlays and own all keys while open, with `overlay.close` cancelling. Delete Tag has an explicit keyboard control cycle: `nav.up` and `nav.down` move through scope, the remote picker when it is shown, Cancel, and Delete; `nav.left` and `nav.right` move within the select row or between Cancel and Delete; `nav.activate` focuses a select or runs the focused footer action. Remote tag knowledge is coalesced with a follow-up: a `refreshRemoteTags()` call that arrives while a check is in flight queues exactly one more full check and resolves after it settles, so a tag push or delete that lands during a check is never lost. Region focus and a successful remote tag operation both trigger it, and a manual `app.refresh` refreshes repository reads only, not remote tag knowledge. Availability comes from `@/domain/commands/commands.availability.ts` so the footer, help, and palette agree.

## 9. Loading, empty, error, and disabled states

- Loading: `LoadingRow` with the text marker `[..]` and "loading tags" while the first read is in flight.
- Empty, no tags: `EmptyState` with "No tags" and the hint "n New tag".
- Empty, filter matches nothing: `EmptyState` with "No tags match <filter>".
- Error: `ErrorState` with "Could not read tags" plus the git error text and a Retry button; the previous rows stay visible.
- Disabled, `tag.create`, `tag.delete`, and `tag.push` in an empty repository: unavailable with the reason "no commits yet" (F-16).
- Disabled, `tag.push`: unavailable with the reason "already on <remote>" when the last successful check says the tag exists remotely, "no remote" when no remote is configured, or "remote tag state unknown; refresh to retry" when the remote has never been checked successfully or the latest check failed with no prior success.
- Disabled, remote scope in the Delete Tag modal: unavailable with the reason "not on any remote" when the tag is absent from every remote according to the last successful check.
- Unknown remote state: the row shows "remote unknown" and never shows "unpushed"; the tag stays local and deletable.
- Blocked creation, duplicate: when the name exists only remotely, creation is blocked with the message "tag exists on <remote>". When the name exists locally, creation is blocked with "tag already exists".
- `local only`: the row shows the text "local only" when no remote is configured.
- `unpushed`: the row shows the text "unpushed" only when the tag is local and the last successful check of the relevant remote reports it absent.
- Operation in progress: the panel is read-only; a second mutation is blocked with the reason from the runner.

## 10. Performance and bounds

- Tags are rendered inside a `<scrollbox>` with `viewportCulling`; a soft cap of 5000 rendered rows applies, beyond which a notice row reports the truncation.
- Remote tag reads (`git ls-remote --tags`) are network reads. They run per configured remote with bounded concurrency, are cached from the last successful check with its timestamp, and are refreshed on region focus and after a successful remote tag operation rather than on every render; a manual `app.refresh` does not refresh remote tag knowledge. A call that joins an in-flight check queues one follow-up check and resolves after it settles, so the operation-triggered read is not dropped. A failed check keeps the previous successful knowledge and marks the latest attempt failed; it never turns a tag into `unpushed`.
- Remote tag knowledge is never derived from commit dates. A repository whose last fetch is old still shows the last successful `ls-remote` result, and an unreadable remote shows `unknown`.
- Scope merge and ordering are pure and memoized per snapshot; ordering is O(n log n).
- Row truncation uses `@/lib/text.ts` with a budget from `useTerminalDimensions`; the commit summary drops before the tag name and scope indicator.
- Create, push, and delete are single writes serialized by `commands.runner.ts`; the panel does not optimistically mutate the list.

## 11. Safety and confirmations

- Delete always requires an explicit confirmation through `DeleteTagModal`. The modal opens with Cancel focused; the user must choose a scope and confirm. The confirmation names the tag and the selected scope.
- When multiple remotes contain the tag, the user must select the remote. The app does not guess.
- The remote-only scope is offered only when the tag is absent locally.
- Deleting a tag never deletes the commit it points to (F-18).
- Push Tag requires a confirmation that names the tag and the remote. A rejected push shows the git error and keeps the local tag.
- The Create Tag modal states which remote will receive the tag when the push-after-create box is checked.
- Local and remote delete order is remote first, then local, with partial failure reporting as described in section 7.
- Every command runs through `git.client.ts` with an argument array and no shell; credentials in remote URLs are redacted before any console or error rendering.

## 12. Acceptance mapping

| F-05 acceptance bullet | Implementing module or component |
| --- | --- |
| Local-only tags show an unpushed or local-only indicator | `git.tags.ts` `mergeTagScopes()`; `TagRow.tsx` |
| Creating an annotated tag records the message; creating a lightweight tag does not | `CreateTagModal.tsx` message field; `git.tags.ts` `planCreateTag()` choosing `tag -a` versus `tag` |
| The annotated tag row shows the peeled commit subject, not the tag message | `parse.refs.ts` selects `%(*subject)` for object type `tag` and `%(subject)` for `commit`; `TagRow.tsx` |
| A failed remote check is unknown, never unpushed | `git.tags.ts` `mergeTagScopes()` with the last successful check state; `TagRow.tsx` |
| Tag creation, deletion, and push are unavailable in an empty repository | `commands.availability.ts` and `repository.states.ts` gate with "no commits yet"; `TagsPanel.tsx` |
| Deleting locally and remotely performs both operations and reports partial failure clearly | Delete order and partial-failure handling in section 7; `commands.tags.ts` `executeTagDelete()`; `DeleteTagModal.tsx` |
| A tag badge on the commit graph reflects the tag state | F-08 ref badges read the same tag snapshot; `repository.selectors.ts` |
| Tags with the same name are shown as one logical row with scope indicators | `git.tags.ts` `mergeTagScopes()`; `TagRow.tsx` |
| Ordering defaults to version-aware descending, then reverse name order, and is deterministic | `git.tags.ts` `sortTagsVersionDesc()` |
| Enter selects the tagged commit in the commit graph and shows its details | `useTags.ts` sets the commit selection from `nav.activate`; F-08 and F-10 render the details |
| If the tag exists only remotely, creation is blocked with a clear duplicate message | `CreateTagModal.tsx` validation against the remote tag set |
| Push Tag confirmation names the tag and remote; success clears the unpushed indicator | `ConfirmModal` invocation; `commands.tags.ts` `executeTagPush()`; the follow-up remote tag check |
| Delete from remote only when the tag does not exist locally | `DeleteTagModal.tsx` scope availability; `git.tags.ts` `planDeleteRemoteTag()` |
| If multiple remotes contain the tag, the user selects the remote | `DeleteTagModal.tsx` remote `SelectField` |
| On success, refresh refs and selection | `RepositoryProvider` refresh after every command |

## 13. Tests to add

- `src/domain/git/git.tags.test.ts`: `mergeTagScopes` for `local`, `remote`, `unpushed`, `local only`, and `unknown`, including a tag present locally and on one of two remotes, a failed remote check with no prior success, and a failed check that keeps the last successful set; annotated versus lightweight detection from `%(objecttype)`; and argument construction for create, push, local delete, and remote delete; no spawning in unit tests.
- `src/domain/git/git.tags.test.ts`: `sortTagsVersionDesc` table covering `v1.2.10` above `v1.2.9`, mixed version and non-version names, and tie-breaking by reverse name order.
- `src/domain/git/parsers/parse.refs.test.ts` (shared with F-03 and F-04): parse recorded `for-each-ref` tag fixtures and `ls-remote --tags` output, including peeled `^{}` lines; assert an annotated tag's summary comes from `%(*subject)` and a lightweight tag's from `%(subject)`.
- `src/domain/commands/commands.availability.test.ts` (shared): `tag.create`, `tag.delete`, and `tag.push` return "no commits yet" in an empty repository; `tag.push` returns "remote tag state unknown; refresh to retry" for `neverChecked` and failed-with-no-prior-success states.
- `src/features/tags/TagRow.test.tsx`: rendered scope indicators for `local`, `remote`, `unpushed`, `local only`, and `unknown`, plus truncation behavior.
- `src/features/tags/TagsPanel.test.tsx`: version-descending rows, `remote unknown` before a successful check, `tag.push` available only for an unpushed local tag with known remote state, the unknown-state and duplicate-name blocked messages, `P` resolving to `tag.push` instead of the global `remote.push`, Enter selecting the tagged commit, the empty, no-match, and error states, the unpushed indicator clearing after a successful push refreshes remote knowledge, and exactly one handler per `(actionId, tags)` registration with no `app.refresh` registration.
- `src/features/tags/useTags.test.tsx`: selector-derived ordering, local filter without reordering, `nav.activate` selecting the tagged commit without a git call, push availability for each remote knowledge state, double-click targeting the clicked row, and published availability clearing on unmount.
- `src/features/tags/CreateTagModal.test.tsx`: empty message creates a lightweight tag, a non-empty message creates an annotated tag, the push-after-create checkbox states the target remote, the target comes from `RepositoryProvider.selection` when it is a commit, empty and whitespace names are blocked, local and remote duplicates are blocked, and a validation failure keeps the modal open.
- `src/features/tags/DeleteTagModal.test.tsx`: local, local-and-remote, and remote-only scopes, Cancel focused by default, the unavailable remote reason, the selected remote in the consequence text, the empty remote form value for local scope, and the explicit keyboard focus cycle through the scope, remote, and footer controls.

## 14. Open questions

- Remote tag refresh is resolved as region focus and after a successful remote tag operation, with one queued follow-up when a caller joins an in-flight check. A manual `app.refresh` does not refresh remote tag knowledge. The last successful result is stored and a failed check is never treated as absence.
- Confirm the default remote for create-and-push and for Push Tag when multiple remotes are configured. The code resolves the configured upstream remote of the current branch when it exists, then `origin`, then the first configured remote; confirm this order.
- Confirm whether deleting a tag locally that is also on a remote should warn that the remote copy remains, beyond the absence of an `unpushed` indicator.
- The `unknown` remote state is implemented as the row's exact text indicator `remote unknown` plus the disabled `tag.push` reason; confirm whether a separate selected-row detail is also needed.
