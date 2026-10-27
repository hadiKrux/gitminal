import type { ReactNode } from "react";
import {
  COMMIT_META_LABEL_WIDTH,
  COMMIT_META_MIN_BUDGET,
} from "@/features/commit-details/useCommitDetails";
import { truncateText } from "@/lib/text";
import { formatCommitDateTime } from "@/lib/time";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";

/** Marker shown on a committer row that differs from the author. */
const COMMITTER_DIFFERS_TEXT = "differs from author";

/** Width one space and the marker separator reserve beside the value. */
const COMMITTER_MARKER_WIDTH = COMMITTER_DIFFERS_TEXT.length + 4;

/** Left padding of the row. */
const ROW_LEFT_PADDING = 1;

/**
 * Renders one labeled author or committer row.
 *
 * The row shows `name <email> date`, where the strict ISO date from `%aI` or `%cI` is formatted by
 * `formatCommitDateTime` into a short timestamp that keeps the reported offset, so the timezone stays
 * visible. The value is truncated to the measured pane width using `truncateText` and the shared
 * ellipsis marker; the label and the committer marker are never truncated.
 *
 * A committer row that differs from the author carries the text marker `! differs from author`, so
 * the difference is explained by words rather than color alone.
 *
 * @param props - Row kind, name, email, date, measured width, and whether the committer differs.
 * @returns The composed metadata row.
 */
export function CommitMetaRow(props: {
  readonly kind: "author" | "committer";
  readonly name: string;
  readonly email: string;
  readonly date: string;
  readonly width: number;
  readonly differs?: boolean;
}): ReactNode {
  const tokens = useTokens();
  const label = props.kind === "author" ? "Author" : "Committer";
  const differs = props.kind === "committer" && props.differs === true;
  const reserved =
    ROW_LEFT_PADDING + COMMIT_META_LABEL_WIDTH + (differs ? COMMITTER_MARKER_WIDTH : 0);
  const budget = Math.max(COMMIT_META_MIN_BUDGET, Math.floor(props.width) - reserved);
  const value = truncateText(
    `${props.name} <${props.email}> ${formatCommitDateTime(props.date)}`,
    budget,
    ICONS.ellipsis,
  );

  return (
    <box flexDirection="row" flexShrink={0} paddingLeft={1}>
      <text wrapMode="none">
        <span fg={tokens.muted}>{`${label}: `}</span>
        <span fg={tokens.text}>{value}</span>
        {differs ? (
          <span fg={tokens.warning}>{` ${ICONS.warning} ${COMMITTER_DIFFERS_TEXT}`}</span>
        ) : null}
      </text>
    </box>
  );
}
