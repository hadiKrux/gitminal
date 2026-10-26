import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useModalControlCycle } from "@/app/hooks/useModalControlCycle";
import type {
  ModalControlResolution,
  ModalHorizontalInput,
} from "@/app/hooks/useModalControlCycle.types";
import { COMPOSER_MENU_SELECT_ID } from "@/features/composer/composer.constants";
import type {
  CommitOptionsMenuProps,
  MenuControl,
  MenuVariant,
} from "@/features/composer/composer.types";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import type { ButtonProps } from "@/ui/Button.types";
import { ModalActions } from "@/ui/ModalActions";
import { ModalFrame } from "@/ui/ModalFrame";

/** Vertical control order: the variant list, then Run, then Cancel. */
const MENU_CONTROLS: readonly MenuControl[] = Object.freeze(["select", "run", "cancel"]);

/** Focused control when the menu opens. Cancel is the safe default for an amend-capable menu. */
const INITIAL_CONTROL: MenuControl = "cancel";

/** Modal title shown above the four variants. */
const MENU_TITLE = "Commit options";

/** Modal width in cells before terminal clamping. */
const MENU_WIDTH = 68;

/** Modal height in rows: four options, a reason line, a footer, and borders. */
const MENU_HEIGHT = 13;

/** Fallback reason when a disabled variant carries no text. */
const UNAVAILABLE_REASON = "not available";

/**
 * Renders the four commit variants as a modal select with a Run and Cancel footer.
 *
 * The rows are the four separate action ids in product order: Commit, Commit --no-verify,
 * Commit --amend, and Amend --no-verify. Each row keeps its own availability, so amend shows "no
 * commits yet" in an empty repository while a normal commit shows "nothing to commit" without staged
 * files. Highlighting an amend row asks the composer to load the previous message once and show the
 * "Amending <short hash>" indicator; moving back to a normal row restores the pre-menu draft.
 *
 * Cancel is focused by default, and Cancel, Esc, or any other close except Run restores the pre-menu
 * draft through `onDismiss`, which the unmount cleanup calls exactly once. The native select keeps
 * Up, Down, and Enter while it owns focus; the overlay control cycle owns the keys everywhere else.
 *
 * @param props - Variants, highlight, run, cancel, and dismiss callbacks.
 * @returns The commit options modal.
 */
export function CommitOptionsMenu(props: CommitOptionsMenuProps): ReactNode {
  const tokens = useTokens();
  const { focusRenderable } = useFocusState();
  const [highlighted, setHighlighted] = useState(0);
  const dismissRef = useRef(props.onDismiss);
  const selectedVariant = props.variants[highlighted] ?? null;
  const highlightedReason = readHighlightedReason(selectedVariant);
  const cycle = useModalControlCycle<MenuControl>({
    order: MENU_CONTROLS,
    initial: INITIAL_CONTROL,
    onHorizontal: readHorizontalResolution,
  });

  dismissRef.current = props.onDismiss;

  useEffect(
    () => () => {
      dismissRef.current();
    },
    [],
  );

  /**
   * Applies a highlighted row index reported by the native select.
   *
   * @param index - Highlighted option index.
   */
  const highlight = useCallback(
    (index: number): void => {
      setHighlighted(index);

      const variant = props.variants[index];

      if (variant !== undefined) {
        props.onHighlight(variant.commandId);
      }
    },
    [props],
  );

  /** Runs the highlighted variant when it is available. */
  const runHighlighted = useCallback((): void => {
    const variant = props.variants[highlighted];

    if (!isVariantAvailable(variant)) {
      return;
    }

    props.onRun(variant.commandId);
  }, [highlighted, props]);

  /**
   * Confirms one native select row.
   *
   * An available row runs immediately, which is the documented Enter behavior inside the menu. An
   * unavailable row stays visible with its reason so the user never loses the list.
   *
   * @param index - Selected option index.
   */
  const selectRow = useCallback(
    (index: number): void => {
      highlight(index);

      const variant = props.variants[index];

      if (isVariantAvailable(variant)) {
        props.onRun(variant.commandId);
      }
    },
    [highlight, props],
  );

  /** Runs the focused overlay control. */
  const activate = useCallback((): void => {
    activateControl({
      control: cycle.control,
      focusSelect: () => {
        focusRenderable(COMPOSER_MENU_SELECT_ID);
      },
      run: runHighlighted,
      cancel: props.onCancel,
    });
  }, [cycle.control, focusRenderable, props, runHighlighted]);

  useAction("nav.activate", { scope: "overlay" }, activate);

  return (
    <ModalFrame title={MENU_TITLE} width={MENU_WIDTH} height={MENU_HEIGHT}>
      <select
        id={COMPOSER_MENU_SELECT_ID}
        height={4}
        options={props.variants.map((variant) => ({
          name: variant.label,
          description: variant.description,
          value: variant.commandId,
        }))}
        selectedIndex={0}
        focused={cycle.control === "select"}
        backgroundColor={tokens.surface}
        focusedBackgroundColor={tokens.surface}
        textColor={tokens.text}
        focusedTextColor={tokens.text}
        selectedBackgroundColor={tokens.selection}
        selectedTextColor={tokens.text}
        descriptionColor={tokens.dim}
        selectedDescriptionColor={tokens.muted}
        showDescription={false}
        wrapSelection={false}
        onChange={(index) => {
          highlight(index);
        }}
        onSelect={(index) => {
          selectRow(index);
        }}
      />
      {highlightedReason === null ? null : (
        <text fg={tokens.warning} wrapMode="none">
          {`${ICONS.warning} ${highlightedReason}`}
        </text>
      )}
      <box flexGrow={1} />
      <ModalActions
        actions={readFooterActions({
          control: cycle.control,
          selectedVariant,
          highlightedReason,
          onRun: runHighlighted,
          onCancel: props.onCancel,
        })}
      />
    </ModalFrame>
  );
}

/**
 * Reads the disabled reason of the highlighted row.
 *
 * @param variant - Highlighted variant, or null when the list is empty.
 * @returns The reason text, or null when the row is available.
 */
function readHighlightedReason(variant: MenuVariant | null): string | null {
  if (variant === null || variant.available) {
    return null;
  }

  return variant.reason ?? UNAVAILABLE_REASON;
}

/**
 * Reports whether a variant can run.
 *
 * @param variant - Candidate row.
 * @returns True when the row exists and is available.
 */
function isVariantAvailable(
  variant: MenuVariant | undefined,
): variant is MenuVariant & { readonly available: true } {
  return variant?.available === true;
}

/**
 * Runs one focused menu control.
 *
 * @param input - Focused control plus the three control handlers.
 */
function activateControl(input: {
  readonly control: MenuControl;
  readonly focusSelect: () => void;
  readonly run: () => void;
  readonly cancel: () => void;
}): void {
  switch (input.control) {
    case "select":
      input.focusSelect();

      return;
    case "run":
      input.run();

      return;
    case "cancel":
      input.cancel();
  }
}

/**
 * Builds the Run and Cancel footer actions in display order.
 *
 * Run carries the highlighted variant's reason so a disabled row explains itself twice, in the list
 * and on the action. Cancel is never disabled and restores the pre-menu draft through its handler.
 *
 * @param input - Focused control, highlighted variant, its reason, and the two handlers.
 * @returns The footer actions.
 */
function readFooterActions(input: {
  readonly control: MenuControl;
  readonly selectedVariant: MenuVariant | null;
  readonly highlightedReason: string | null;
  readonly onRun: () => void;
  readonly onCancel: () => void;
}): readonly ButtonProps[] {
  const runDisabled = input.selectedVariant === null || !input.selectedVariant.available;

  return [
    {
      id: "commit-options-run",
      label: "Run",
      focused: input.control === "run",
      disabled: runDisabled,
      reason: runDisabled ? (input.highlightedReason ?? undefined) : undefined,
      onPress: input.onRun,
    },
    {
      id: "commit-options-cancel",
      label: "Cancel",
      focused: input.control === "cancel",
      onPress: input.onCancel,
    },
  ];
}

/**
 * Applies the menu's left and right rule.
 *
 * Right moves from Cancel to Run; left moves from Run back to Cancel. Up and Down always use the
 * vertical order, and every other horizontal move is a no-op.
 *
 * @param input - Focused control and requested direction.
 * @returns The control to focus, or a no-op resolution.
 */
function readHorizontalResolution(
  input: ModalHorizontalInput<MenuControl>,
): ModalControlResolution<MenuControl> {
  if (input.direction === "right" && input.control === "cancel") {
    return { kind: "focus", control: "run" };
  }

  if (input.direction === "left" && input.control === "run") {
    return { kind: "focus", control: "cancel" };
  }

  return { kind: "none" };
}
