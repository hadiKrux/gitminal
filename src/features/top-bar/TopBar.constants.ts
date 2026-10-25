import { ICONS } from "@/theme/icons";
import { BUTTON_HORIZONTAL_PADDING } from "@/ui/Button.constants";

/** Space taken by the panel border, the content marker, and the content margin, in cells. */
export const TOP_BAR_CHROME_WIDTH = 6;

/** Number of icon actions in the top-bar strip. */
const TOP_BAR_ACTION_COUNT = 3;

/** Width of the three icons without padding. */
const TOP_BAR_ICONS_WIDTH = ICONS.pull.length + ICONS.push.length + ICONS.ellipsis.length;

/** Width of the three filled icon buttons, including their one-cell horizontal padding. */
export const TOP_BAR_ACTION_BUTTONS_WIDTH =
  TOP_BAR_ICONS_WIDTH + TOP_BAR_ACTION_COUNT * BUTTON_HORIZONTAL_PADDING * 2;

/** Space taken by the two one-cell gaps between the three actions. */
export const TOP_BAR_ACTION_GAPS_WIDTH = 2;

/** Narrowest status strip that still leaves the branch and sync badge readable, in cells. */
export const TOP_BAR_STATUS_MIN_WIDTH = 20;

/** Narrowest disabled reason shown next to an action, in cells. */
export const TOP_BAR_REASON_MIN_WIDTH = 4;

/** Widest disabled reason shown next to an action, in cells. */
export const TOP_BAR_REASON_MAX_WIDTH = 28;

/** Overlay entry id of the More menu. */
export const MORE_MENU_OVERLAY_ID = "remote.more";

/** Action id that toggles the More menu while it is open. */
export const MORE_MENU_TOGGLE_ACTION_ID = "remote.more";

/** Exact confirm label for the safe force push. */
export const FORCE_SAFE_LABEL = "Force push safely";

/** Exact confirm label for the overwriting force push. */
export const FORCE_OVERWRITE_LABEL = "Overwrite remote";
