import type { ReactNode } from "react";
import {
  BRANCHES_EMPTY_MESSAGE,
  BRANCHES_ERROR_MESSAGE,
  BRANCHES_LOADING_LABEL,
  BRANCHES_TRUNCATION_LABEL,
} from "@/features/branches/BranchesPanel.constants";
import { BranchRow } from "@/features/branches/BranchRow";
import { DeleteBranchModal } from "@/features/branches/DeleteBranchModal";
import { NewBranchModal } from "@/features/branches/NewBranchModal";
import { useBranches } from "@/features/branches/useBranches";
import { useTokens } from "@/theme/useTokens";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { LoadingRow } from "@/ui/LoadingRow";

/**
 * Renders the body of the Branches sidebar panel.
 *
 * The shell owns the focusable panel frame, the border title with the branch count, and the scroll
 * container, so this component returns only the branch rows, the truncation notice, and the
 * loading, empty, and error states. It renders no second title row. Rows are custom content, so
 * navigation, selection, double click, and `nav.activate` come from `useListCursor` through
 * `useBranches`. The two modals are overlay entries, not children of this component.
 *
 * A failed branch-list read keeps the previous rows visible above the inline error and its Retry
 * button, which refreshes the repository without entering the command runner.
 *
 * @returns The panel body content.
 */
export function BranchesPanel(): ReactNode {
  const tokens = useTokens();
  const branches = useBranches({
    renderNewBranchModal: (input) => <NewBranchModal {...input} />,
    renderDeleteBranchModal: (input) => <DeleteBranchModal {...input} />,
  });

  return (
    <box flexDirection="column" flexShrink={0}>
      {branches.error === null ? null : (
        <ErrorState
          message={BRANCHES_ERROR_MESSAGE}
          details={branches.error}
          onRetry={branches.retry}
        />
      )}
      {branches.loading ? <LoadingRow label={BRANCHES_LOADING_LABEL} /> : null}
      {branches.empty ? (
        <EmptyState message={BRANCHES_EMPTY_MESSAGE} hint={branches.emptyHint} />
      ) : null}
      {branches.items.map((item, index) => (
        <BranchRow
          key={item.id}
          branch={item.branch}
          selected={index === branches.selectedIndex}
          focused={branches.focused}
          deleteReason={index === branches.selectedIndex ? branches.selectedDeleteReason : null}
          onMouseDown={() => {
            branches.handleRowClick(index);
          }}
        />
      ))}
      {branches.hiddenCount > 0 ? (
        <text fg={tokens.dim} wrapMode="none">
          {`${BRANCHES_TRUNCATION_LABEL} ${branches.items.length} of ${branches.totalCount} branches`}
        </text>
      ) : null}
    </box>
  );
}
