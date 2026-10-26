/** Props accepted by `CommandPalette`. */
export interface CommandPaletteProps {
  /**
   * Closes the overlay entry that renders the palette.
   *
   * @param afterRestore - Work the overlay provider runs after it restores the background focus.
   */
  readonly onClose: (afterRestore?: () => void) => void;
}
