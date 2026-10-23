# 05 Tags Panel

## 1. Header

- Status: Ready for dev
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
| `useAction` | `useTags.ts` registers the region-scoped handlers `tag.create`, `tag.delete`, `tag.push`, `nav.activate`, and `list.filter` with `scope: "tags"` | One handler per `(actionId, scope)`; global actions such as `app.refresh` and `focus.*` are owned by the app or shell and are never registered here |
| `useListCursor` | `useTags.ts` navigation, `g`/`G`, and double click detection | Shared cursor and double click logic for custom rows |
| `useFocusRegion` | `TagsPanel.tsx` refreshes tag knowledge when `focused` flips true | Region focus is derived from native focus; `useFocus` only reports terminal-window focus |
| `useTerminalDimensions` | `TagRow.tsx` computes the truncation budget for the commit summary | Budget-aware truncation via `@/lib/text.ts` |

`<scrollbox>` versus `<select>` decision: the tag list uses a `<scrollbox>` of `<box>` rows because each row combines a tag name, one or more scope indicators, and a commit summary, which `<select>` cannot render. `<select>` is used only for the uniform scope and remote choices inside `DeleteTagModal.tsx` (architecture section 6 rule 3).

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
TagsPanel
  Panel
    PanelHeader (title "Tags", count)
    SearchField (filter, focused by list.filter)
    ScrollableList (scrollbox, viewportCulling, scrollbar when overflowing)
      TagRow (one per logical tag)
        ListRow (box)
          TextMarker
          text (tag name)
            span (scope indicator: local, remote, unpushed, local only)
          text (tagged commit summary, when width permits)
      LoadingRow (while the first read is in flight)
      EmptyState (no tags, or no matches)
      ErrorState (read failed, with Retry)
```

Modals are pushed onto `OverlayProvider` (F-15), not nested in the panel:

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

- `src/features/tags/TagsPanel.tsx` - panel composition, region registration, action wiring, focus refresh.
- `src/features/tags/TagRow.tsx` - one logical tag row with scope indicators and commit summary.
- `src/features/tags/CreateTagModal.tsx` - annotated versus lightweight rules, target, and optional create-and-push.
- `src/features/tags/DeleteTagModal.tsx` - scope selection, remote selection, and consequence text.
- `src/features/tags/useTags.ts` - derives logical rows from selectors, owns filter and cursor state, dispatches commands.
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
| repository refresh (local tags) | `git.tags.ts` `listLocalTags()` | `git for-each-ref refs/tags --format=%(refname:short)%00%(objecttype)%00%(*objectname)%00%(objectname)%00%(subject)%00%(*subject)` |
| remote tag knowledge (read-only) | `git.tags.ts` `listRemoteTags(remote)` | `git ls-remote --tags <remote>`; only a successful result updates the known set and its timestamp |
| scope merge | `git.tags.ts` `mergeTagScopes()` (pure) | none; produces the `local`, `remote`, `unpushed`, `local only`, and `unknown` states |
| ordering | `git.tags.ts` `sortTagsVersionDesc()` (pure) | none |
| `tag.create` (lightweight) | `git.tags.ts` `createLightweightTag()` | `git tag <name> <target>` |
| `tag.create` (annotated) | `git.tags.ts` `createAnnotatedTag()` | `git tag -a <name> <target> -m <message>` |
| `tag.push` | `git.tags.ts` `pushTag()` | `git push <remote> refs/tags/<name>` |
| `tag.delete` (local only) | `git.tags.ts` `deleteLocalTag()` | `git tag -d <name>` |
| `tag.delete` (local and remote) | `git.tags.ts` `deleteRemoteTag()` then `deleteLocalTag()` | `git push <remote> --delete refs/tags/<name>` then the local delete above |
| `tag.delete` (remote only) | `git.tags.ts` `deleteRemoteTag()` | `git push <remote> --delete refs/tags/<name>` |
| `nav.activate` (select tagged commit) | internal command `graph.selectCommit` -> `RepositoryProvider` selection | none; sets `{ kind: "commit", oid }`, no git call |

Command and handler model (architecture section 8.1):

- `useTags.ts` registers `tag.create`, `tag.delete`, `tag.push`, `nav.activate`, and `list.filter` with `scope: "tags"`. Exactly one handler exists per `(actionId, scope)`. The feature never registers `app.refresh`, `focus.*`, `overlay.close`, or `remote.*`; those are owned by the app, shell, or top bar.
- Targets are explicit. `tag.delete` and `tag.push` use `{ kind: "tag", name }` for the selected row. `tag.create` uses `{ kind: "commit", oid }` when `RepositoryProvider.selection.kind === "commit"` and `{ kind: "none" }` otherwise, so the modal defaults to the selected commit or HEAD.
- `nav.activate` in the Tags region dispatches the internal command `graph.selectCommit` with the selected tag's peeled commit. `graph.selectCommit` is a command ID only: it has no action ID and no default key, and it sets `RepositoryProvider.selection`.
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
| `nav.first`, `nav.last` | Jump to the first or last tag |
| `nav.pageUp`, `nav.pageDown` | Move by a screen |
| `nav.activate` | Select the tagged commit in the commit graph and show its details through the internal command `graph.selectCommit` |
| `tag.create` | Open the Create Tag modal |
| `tag.delete` | Open the Delete Tag modal for the selected tag |
| `tag.push` | Push the selected local tag that is not known to be on the remote, after confirmation; this ID overrides `remote.push` while Tags is focused |
| `list.filter` | Focus the tag filter field |
| `focus.next`, `focus.previous` | Tab traversal (owned by `useFocusModel`) |
| `focus.region.tags` | Direct jump to this panel (default `3`), shell-owned |

Notes: `app.refresh` is a global action owned by the app or shell; it is not registered by this feature. The footer shows only the actions available for the selected tag, for example `tag.push` only when the tag is local and the last successful remote check says it is absent. A tag known only remotely has no `tag.push`, and an `unknown` remote state disables it with "remote tag state unknown; refresh to retry". Modals are overlays and own all keys while open, with `overlay.close` cancelling. Availability comes from `@/domain/commands/commands.availability.ts` so the footer, help, and palette agree.

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
- Remote tag reads (`git ls-remote --tags`) are network reads. They run per configured remote with bounded concurrency, are cached from the last successful check with its timestamp, and are refreshed on region focus and manual refresh rather than on every render. A failed check keeps the previous successful knowledge and marks the latest attempt failed; it never turns a tag into `unpushed`.
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
| Creating an annotated tag records the message; creating a lightweight tag does not | `CreateTagModal.tsx` message field; `git.tags.ts` `createAnnotatedTag()` versus `createLightweightTag()` |
| The annotated tag row shows the peeled commit subject, not the tag message | `parse.refs.ts` selects `%(*subject)` for object type `tag` and `%(subject)` for `commit`; `TagRow.tsx` |
| A failed remote check is unknown, never unpushed | `git.tags.ts` `mergeTagScopes()` with the last successful check state; `TagRow.tsx` |
| Tag creation, deletion, and push are unavailable in an empty repository | `commands.availability.ts` and `repository.states.ts` gate with "no commits yet"; `TagsPanel.tsx` |
| Deleting locally and remotely performs both operations and reports partial failure clearly | Delete order and partial-failure handling in section 7; `DeleteTagModal.tsx` |
| A tag badge on the commit graph reflects the tag state | F-08 ref badges read the same tag snapshot; `repository.selectors.ts` |
| Tags with the same name are shown as one logical row with scope indicators | `git.tags.ts` `mergeTagScopes()`; `TagRow.tsx` |
| Ordering defaults to version-aware descending, then reverse name order, and is deterministic | `git.tags.ts` `sortTagsVersionDesc()` |
| Enter selects the tagged commit in the commit graph and shows its details | `useTags.ts` maps `nav.activate` to the `graph.selectCommit` command; F-08 and F-10 render the details |
| If the tag exists only remotely, creation is blocked with a clear duplicate message | `CreateTagModal.tsx` validation against the remote tag set |
| Push Tag confirmation names the tag and remote; success clears the unpushed indicator | `ConfirmModal` invocation; `git.tags.ts` `pushTag()` |
| Delete from remote only when the tag does not exist locally | `DeleteTagModal.tsx` scope availability; `git.tags.ts` `deleteRemoteTag()` |
| If multiple remotes contain the tag, the user selects the remote | `DeleteTagModal.tsx` remote `SelectField` |
| On success, refresh refs and selection | `RepositoryProvider` refresh after every command |

## 13. Tests to add

- `src/domain/git/git.tags.test.ts`: `mergeTagScopes` for `local`, `remote`, `unpushed`, `local only`, and `unknown`, including a tag present locally and on one of two remotes, a failed remote check with no prior success, and a failed check that keeps the last successful set; annotated versus lightweight detection from `%(objecttype)`; and argument construction for create, push, local delete, and remote delete; no spawning in unit tests.
- `src/domain/git/git.tags.test.ts`: `sortTagsVersionDesc` table covering `v1.2.10` above `v1.2.9`, mixed version and non-version names, and tie-breaking by reverse name order.
- `src/domain/git/parsers/parse.refs.test.ts` (shared with F-03 and F-04): parse recorded `for-each-ref` tag fixtures and `ls-remote --tags` output, including peeled `^{}` lines; assert an annotated tag's summary comes from `%(*subject)` and a lightweight tag's from `%(subject)`.
- `src/domain/commands/commands.availability.test.ts` (shared): `tag.create`, `tag.delete`, and `tag.push` return "no commits yet" in an empty repository; `tag.push` returns "remote tag state unknown; refresh to retry" for `neverChecked` and failed-with-no-prior-success states.
- `src/features/tags/TagRow.test.tsx`: rendered scope indicators for `local`, `remote`, `unpushed`, `local only`, and `unknown`, plus truncation behavior.
- `src/features/tags/TagsPanel.test.tsx`: `tag.push` available only for an unpushed local tag with known remote state, `tag.push` overriding `remote.push` while focused, the duplicate-creation blocked message, and exactly one handler per `(actionId, tags)` registration with no `app.refresh` registration.
- `src/features/tags/CreateTagModal.test.tsx`: empty message creates a lightweight tag, a non-empty message creates an annotated tag, the push-after-create checkbox states the target remote, and the tag target comes from `RepositoryProvider.selection` when it is a commit.

## 14. Open questions

- Confirm the remote tag refresh policy: region focus plus manual refresh, or also after a successful push and after a failed check retry. This doc stores the last successful result and never treats a failed check as absence.
- Confirm the default remote for create-and-push and for Push Tag when multiple remotes are configured. This doc uses the configured upstream remote of the current branch when it exists, otherwise `origin`.
- Confirm whether deleting a tag locally that is also on a remote should warn that the remote copy remains, beyond the absence of an `unpushed` indicator.
- Confirm whether the `unknown` remote state should appear as a row badge or only in the selected-row detail and the disabled reason for `tag.push`.
