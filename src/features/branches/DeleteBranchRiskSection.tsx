import type { ScrollBoxRenderable } from "@opentui/core";
import { type ReactNode, useRef } from "react";
import { useAction } from "@/app/hooks/useAction";
import type { BranchRiskCommit } from "@/domain/repository/repository.types";
import {
  DELETE_BRANCH_HAS_MORE_NOTICE,
  DELETE_BRANCH_RISK_LIST_ID,
  DELETE_BRANCH_SCROLL_HINT,
  DELETE_BRANCH_SHORT_OID_LENGTH,
} from "@/features/branches/DeleteBranchModal.constants";
import type { BranchRiskState } from "@/features/branches/DeleteBranchModal.types";
import { useTokens } from "@/theme/useTokens";
import { ScrollableList } from "@/ui/ScrollableList";
import { TruncatedText } from "@/ui/TruncatedText";

/**
 * Renders the at-risk evidence for the Delete Branch modal.
 *
 * The loading, unreadable, merged, empty, and unmerged states each say what they know instead of
 * leaving the section blank. An unmerged branch lists its commits inside a bounded scrollbox whose
 * height comes from the modal budget, so the force control and footer below it stay on screen; long
 * subjects are truncated to the remaining row width. Every explanatory line is truncated to the
 * modal content width and rendered on one row, so a long branch name or a long notice cannot wrap
 * and consume a row reserved for a control. When the cap may hide older commits, a notice says so
 * rather than implying the shown list is complete. When the list is taller than its viewport, a
 * short hint names the keyboard path and PageUp/PageDown scroll the list while the modal is open.
 *
 * @param props - Current risk state, branch name, the list and row budgets, and the content width.
 * @returns The evidence block for the current state.
 */
export function DeleteBranchRiskSection(props: {
  readonly risk: BranchRiskState;
  readonly branchName: string;
  readonly listHeight: number;
  readonly subjectWidth: number;
  readonly contentWidth: number;
}): ReactNode {
  const tokens = useTokens();
  const { risk } = props;

  if (risk.status === "loading") {
    return (
      <TruncatedText
        text="Reading commits at risk..."
        maxWidth={props.contentWidth}
        fg={tokens.dim}
      />
    );
  }

  if (risk.error !== null) {
    return (
      <TruncatedText
        text={`Could not read commits at risk: ${risk.error}`}
        maxWidth={props.contentWidth}
        fg={tokens.warning}
      />
    );
  }

  if (risk.merged === true) {
    return (
      <TruncatedText
        text="The branch is merged; no commits are at risk."
        maxWidth={props.contentWidth}
        fg={tokens.dim}
      />
    );
  }

  if (risk.commits.length === 0) {
    return (
      <TruncatedText
        text="No commits at risk were found on this branch."
        maxWidth={props.contentWidth}
        fg={tokens.dim}
      />
    );
  }

  return (
    <DeleteBranchCommitList
      commits={risk.commits}
      branchName={props.branchName}
      listHeight={props.listHeight}
      subjectWidth={props.subjectWidth}
      contentWidth={props.contentWidth}
      hasMore={risk.hasMore}
    />
  );
}

/**
 * Renders one unmerged branch's at-risk commit list.
 *
 * The component mounts only while the list is shown, so it owns the PageUp and PageDown overlay
 * actions for exactly that lifetime. Each action scrolls the list by one viewport, matching the
 * terminal's page keys without taking Up and Down from the modal control cycle.
 *
 * @param props - Commits, branch name, list and row budgets, content width, and the cap indicator.
 * @returns The headed, bounded commit list with its overflow and cap notices.
 */
function DeleteBranchCommitList(props: {
  readonly commits: readonly BranchRiskCommit[];
  readonly branchName: string;
  readonly listHeight: number;
  readonly subjectWidth: number;
  readonly contentWidth: number;
  readonly hasMore: boolean;
}): ReactNode {
  const tokens = useTokens();
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const isOverflowing = props.commits.length > props.listHeight;

  useAction("nav.pageUp", { scope: "overlay" }, () => {
    scrollRef.current?.scrollBy(-1, "viewport");
  });
  useAction("nav.pageDown", { scope: "overlay" }, () => {
    scrollRef.current?.scrollBy(1, "viewport");
  });

  return (
    <box flexDirection="column" flexShrink={0}>
      <TruncatedText
        text={`Commits that only exist on ${props.branchName}:`}
        maxWidth={props.contentWidth}
        fg={tokens.warning}
      />
      <ScrollableList
        id={DELETE_BRANCH_RISK_LIST_ID}
        scrollRef={scrollRef}
        height={props.listHeight}
        flexGrow={0}
      >
        {props.commits.map((commit) => (
          <box key={commit.oid} flexDirection="row" flexShrink={0}>
            <text fg={tokens.muted} wrapMode="none" flexShrink={0}>
              {`${commit.oid.slice(0, DELETE_BRANCH_SHORT_OID_LENGTH)} `}
            </text>
            <TruncatedText text={commit.subject} maxWidth={props.subjectWidth} fg={tokens.muted} />
          </box>
        ))}
      </ScrollableList>
      {isOverflowing ? (
        <TruncatedText
          text={DELETE_BRANCH_SCROLL_HINT}
          maxWidth={props.contentWidth}
          fg={tokens.dim}
        />
      ) : null}
      {props.hasMore ? (
        <TruncatedText
          text={DELETE_BRANCH_HAS_MORE_NOTICE}
          maxWidth={props.contentWidth}
          fg={tokens.dim}
        />
      ) : null}
    </box>
  );
}
