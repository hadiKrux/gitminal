/** Stable field id used by overlay focus and search key routing. */
export const FEATURE_SEARCH_INPUT_ID = "feature-search-input";
/** Requested overlay width, clamped by ModalFrame; height follows its content. */
export const FEATURE_SEARCH_WIDTH = 110;
/** Non-scrolling details grow only as needed, up to this terminal-friendly bound. */
export const FEATURE_SEARCH_MAX_DETAIL_ROWS = 6;
/** Results fit their matches rather than reserving empty rows for short lists. */
export const FEATURE_SEARCH_MAX_RESULT_ROWS = 12;
/** Stable result and detail viewport identities for reveal and layout inspection. */
export const FEATURE_SEARCH_RESULTS_ID = "feature-search-results";
export const FEATURE_SEARCH_DETAILS_ID = "feature-search-details";
/** Stable footer identity for inspecting the fixed hint area. */
export const FEATURE_SEARCH_HINTS_ID = "feature-search-hints";
/** One blank row after the input and before hints; other sections remain content-sized. */
export const FEATURE_SEARCH_SPACER_ROWS = 1;
/** Page movement step while the search field owns native focus. */
export const FEATURE_SEARCH_PAGE_ROWS = 10;
