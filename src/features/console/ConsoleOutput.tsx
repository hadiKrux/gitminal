import type { ReactNode } from "react";
import type { ConsoleOutputBlock, ConsoleStepEntry } from "@/domain/console/console.types";
import {
  CONSOLE_STDERR_LABEL,
  CONSOLE_STDOUT_LABEL,
} from "@/features/console/ConsoleOutput.constants";
import { ConsoleOutputBlock as OutputBlock } from "@/features/console/ConsoleOutputBlock";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders the expanded stdout and stderr of every step in one entry.
 *
 * Each non-empty block is a bounded `<scrollbox>`, so a long git output scrolls inside its pane
 * instead of growing the entry without limit. Each block is rendered by `ConsoleOutputBlock`, which
 * also owns the omitted-lines marker substitution.
 *
 * @param props - Entry whose output should be rendered.
 * @returns The expanded output panes.
 */
export function ConsoleOutput(props: { readonly steps: readonly ConsoleStepEntry[] }): ReactNode {
  const tokens = useTokens();
  const blocks = props.steps.flatMap((step, index) =>
    readStepBlocks(step).map((block) => ({ ...block, key: `${index}:${block.label}` })),
  );

  if (blocks.length === 0) {
    return (
      <text fg={tokens.dim} wrapMode="none">
        {"  no output"}
      </text>
    );
  }

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={1}>
      {blocks.map((block) => (
        <OutputBlock key={block.key} label={block.label} block={block.block} />
      ))}
    </box>
  );
}

/**
 * Reads the non-empty output blocks of one step.
 *
 * @param step - One console step.
 * @returns Labelled blocks with their source kind.
 */
function readStepBlocks(
  step: ConsoleStepEntry,
): readonly { readonly label: string; readonly block: ConsoleOutputBlock }[] {
  const blocks: { readonly label: string; readonly block: ConsoleOutputBlock }[] = [];

  if (step.stdout.text.length > 0) {
    blocks.push({ label: CONSOLE_STDOUT_LABEL, block: step.stdout });
  }

  if (step.stderr.text.length > 0) {
    blocks.push({ label: CONSOLE_STDERR_LABEL, block: step.stderr });
  }

  return blocks;
}
