import type { ReactNode } from "react";
import { truncateText } from "@/lib/text";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import type { Hint } from "@/ui/HintBar.types";
import { KeyHint } from "@/ui/KeyHint";

/**
 * Renders a single-line footer hint bar.
 *
 * Hints arrive highest priority first. The bar drops hints from the end until the line fits the
 * budget, so the first hint always survives and never wraps. If the first hint alone is too wide,
 * its label is truncated instead of spilling to a second line.
 *
 * @param props - Priority-ordered hints and the available column budget.
 * @returns The fitted hint line.
 */
export function HintBar(props: { hints: readonly Hint[]; maxWidth: number }): ReactNode {
  const tokens = useTokens();
  const fitted = fitHints(props.hints, props.maxWidth);

  if (fitted.length === 0) {
    return <box height={1} />;
  }

  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      {fitted.map((hint, index) => (
        <box key={`${hint.key}:${hint.label}`} flexDirection="row" flexShrink={0}>
          {index > 0 ? (
            <text fg={tokens.dim} wrapMode="none">
              {" "}
              {ICONS.hintSeparator}{" "}
            </text>
          ) : null}
          <KeyHint keyLabel={hint.key} label={hint.label} />
        </box>
      ))}
    </box>
  );
}

/**
 * Drops and truncates hints until they fit a single line.
 *
 * @param hints - Hints ordered from most to least important.
 * @param maxWidth - Available columns.
 * @returns The hints that fit.
 */
function fitHints(hints: readonly Hint[], maxWidth: number): readonly Hint[] {
  const fitted = [...hints];

  while (fitted.length > 1 && hintsWidth(fitted) > maxWidth) {
    fitted.pop();
  }

  const first = fitted[0];

  if (first === undefined) {
    return [];
  }

  if (hintsWidth([first]) <= maxWidth) {
    return fitted;
  }

  const labelBudget = maxWidth - first.key.length - 1;

  if (labelBudget <= 0) {
    return [];
  }

  return [{ key: first.key, label: truncateText(first.label, labelBudget, ICONS.ellipsis) }];
}

/**
 * Measures the rendered width of a hint list, including separators.
 *
 * @param hints - Hints to measure.
 * @returns The number of columns required.
 */
function hintsWidth(hints: readonly Hint[]): number {
  const content = hints.reduce((total, hint) => total + hint.key.length + 1 + hint.label.length, 0);
  const separators = Math.max(0, hints.length - 1) * (ICONS.hintSeparator.length + 2);

  return content + separators;
}
