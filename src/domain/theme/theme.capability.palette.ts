import type { HexColor } from "./theme.types";

/** The six intensity levels shared by every channel of the xterm-256 color cube. */
const CUBE_LEVELS: readonly number[] = Object.freeze([0, 95, 135, 175, 215, 255]);

/** Number of cube entries before the grayscale ramp of the 256-color palette. */
const CUBE_ENTRY_COUNT = 216;

/** First palette index considered; the scheme-dependent standard 16 colors are excluded. */
const FIRST_PALETTE_INDEX = 16;

/** One past the last palette index. */
const PALETTE_INDEX_LIMIT = 256;

/** Base value of the first grayscale ramp entry. */
const GRAYSCALE_BASE = 8;

/** Step between grayscale ramp entries. */
const GRAYSCALE_STEP = 10;

/** Memoized 256-color lookups keyed by the source hex. */
const nearestColorCache = new Map<HexColor, HexColor>();

/**
 * Maps a single color to the nearest cube or grayscale palette hex.
 *
 * Results are memoized by the input hex, so repeated token resolution performs the distance search
 * once per color instead of once per render.
 *
 * @param color - Source hex color.
 * @returns The nearest palette hex.
 */
export function nearestPaletteColor(color: HexColor): HexColor {
  const cached = nearestColorCache.get(color);

  if (cached !== undefined) {
    return cached;
  }

  const nearest = searchNearestPaletteColor(color);

  nearestColorCache.set(color, nearest);

  return nearest;
}

/**
 * Searches the palette for the closest match.
 *
 * The standard 16 ANSI colors are excluded because their RGB values are scheme-dependent, and the
 * cube plus grayscale ramp covers every distinct intensity the standard supports.
 *
 * @param color - Source hex color.
 * @returns The nearest palette hex.
 */
function searchNearestPaletteColor(color: HexColor): HexColor {
  const channels = readHexChannels(color);
  let bestIndex = FIRST_PALETTE_INDEX;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = FIRST_PALETTE_INDEX; index < PALETTE_INDEX_LIMIT; index += 1) {
    const candidate = readPaletteChannels(index);
    const distance =
      squares(channels[0], candidate[0]) +
      squares(channels[1], candidate[1]) +
      squares(channels[2], candidate[2]);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return toHex(readPaletteChannels(bestIndex));
}

/**
 * Reads the red, green, and blue channels of a `#RRGGBB` color.
 *
 * @param color - Source hex color.
 * @returns The three channels.
 */
function readHexChannels(color: HexColor): readonly [number, number, number] {
  return [parseChannel(color, 1), parseChannel(color, 3), parseChannel(color, 5)];
}

/**
 * Parses one two-digit hex channel.
 *
 * @param color - Source hex color.
 * @param offset - Character offset of the channel digits.
 * @returns The channel value from 0 to 255.
 */
function parseChannel(color: HexColor, offset: number): number {
  return Number.parseInt(color.slice(offset, offset + 2), 16) || 0;
}

/**
 * Reads the RGB channels of one palette index.
 *
 * @param index - Palette index from 16 to 255.
 * @returns The red, green, and blue channels.
 */
function readPaletteChannels(index: number): readonly [number, number, number] {
  return [paletteChannel(index, 0), paletteChannel(index, 1), paletteChannel(index, 2)];
}

/**
 * Builds one palette channel for an index.
 *
 * Indices at or above the cube end are the grayscale ramp; every lower index is a cube entry whose
 * channel is selected from the shared level list.
 *
 * @param index - Palette index from 16 to 255.
 * @param channel - Channel position: 0 for red, 1 for green, 2 for blue.
 * @returns The channel value from 0 to 255.
 */
function paletteChannel(index: number, channel: number): number {
  if (index >= FIRST_PALETTE_INDEX + CUBE_ENTRY_COUNT) {
    return GRAYSCALE_BASE + (index - (FIRST_PALETTE_INDEX + CUBE_ENTRY_COUNT)) * GRAYSCALE_STEP;
  }

  const cubeIndex = index - FIRST_PALETTE_INDEX;
  const levelIndex = Math.floor(cubeIndex / 6 ** (2 - channel));

  return CUBE_LEVELS[levelIndex] ?? 0;
}

/**
 * Builds `#RRGGBB` hex from RGB channels.
 *
 * @param channels - The red, green, and blue channels.
 * @returns The hex color.
 */
function toHex(channels: readonly number[]): HexColor {
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}` as HexColor;
}

/**
 * Computes the squared difference between two channel values.
 *
 * @param source - Source channel value.
 * @param candidate - Candidate channel value.
 * @returns The squared difference.
 */
function squares(source: number, candidate: number): number {
  return (source - candidate) * (source - candidate);
}
