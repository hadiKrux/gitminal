/** Immutable terminal cell dimensions shared by all consumers of a renderer. */
export interface TerminalDimensions {
  readonly width: number;
  readonly height: number;
}

/** React external-store contract for a renderer's shared resize subscription. */
export interface TerminalDimensionsStore {
  readonly getSnapshot: () => TerminalDimensions;
  readonly subscribe: (listener: () => void) => () => void;
}
