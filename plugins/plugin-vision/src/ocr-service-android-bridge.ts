/**
 * Android coord-OCR provider (#9105). The agent (musl bun, no Capacitor) can not
 * call the native Tesseract4Android engine directly, so this provider rides the
 * renderer-pulled {@link OcrBridgeService}: it hands the PNG to the bridge, the
 * renderer runs `@elizaos/capacitor-tesseract`, and the recognized words come
 * back and are mapped — grouped by `(block, paragraph, line)` into one block per
 * text line, shifted into display-absolute coords — into `OcrWithCoordsResult`,
 * the same shape the Windows / Linux providers produce.
 *
 * Never throws: when the bridge is absent or times out it returns empty blocks,
 * so the boot chain falls through cleanly.
 */

import { type IAgentRuntime, logger } from "@elizaos/core";
import {
  OCR_BRIDGE_SERVICE_TYPE,
  type OcrBridgeService,
  type OcrBridgeWord,
} from "./ocr-bridge.js";
import {
  computeSemanticPosition,
  type OcrWithCoordsBlock,
  type OcrWithCoordsInput,
  type OcrWithCoordsResult,
  type OcrWithCoordsService,
  type OcrWithCoordsWord,
} from "./ocr-with-coords.js";
import type { BoundingBox } from "./types.js";

/** PNG IHDR width/height (big-endian uint32 at offsets 16/20). */
function readPngDimensions(png: Uint8Array): { width: number; height: number } {
  if (png.byteLength < 24) return { width: 0, height: 0 };
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return {
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
  };
}

/** Group one text line's words into a block (union bbox), in display coords. */
function lineToBlock(
  words: readonly OcrBridgeWord[],
  tileWidth: number,
  tileHeight: number,
  sourceX: number,
  sourceY: number,
): OcrWithCoordsBlock {
  const mappedWords: OcrWithCoordsWord[] = words.map((w) => {
    const tileBox: BoundingBox = {
      x: w.left,
      y: w.top,
      width: w.width,
      height: w.height,
    };
    return {
      text: w.text,
      bbox: {
        x: w.left + sourceX,
        y: w.top + sourceY,
        width: w.width,
        height: w.height,
      },
      semantic_position: computeSemanticPosition({
        bbox: tileBox,
        tileWidth,
        tileHeight,
      }),
    };
  });

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const w of words) {
    minX = Math.min(minX, w.left);
    minY = Math.min(minY, w.top);
    maxX = Math.max(maxX, w.left + w.width);
    maxY = Math.max(maxY, w.top + w.height);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }
  const tileBlockBox: BoundingBox = {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
  return {
    text: words.map((w) => w.text).join(" "),
    bbox: {
      x: minX + sourceX,
      y: minY + sourceY,
      width: maxX - minX,
      height: maxY - minY,
    },
    words: mappedWords,
    semantic_position: computeSemanticPosition({
      bbox: tileBlockBox,
      tileWidth,
      tileHeight,
    }),
  };
}

/** Pure: native words → coord blocks, grouped by `(block, par, line)` triple. */
export function mapOcrWordsToResult(
  words: readonly OcrBridgeWord[],
  tileWidth: number,
  tileHeight: number,
  sourceX: number,
  sourceY: number,
): OcrWithCoordsResult {
  const safeWidth = tileWidth > 0 ? tileWidth : 1;
  const safeHeight = tileHeight > 0 ? tileHeight : 1;
  const order: string[] = [];
  const groups = new Map<string, OcrBridgeWord[]>();
  for (const w of words) {
    if (w.text.trim().length === 0) continue;
    const key = `${w.block}/${w.par}/${w.line}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
      order.push(key);
    }
    group.push(w);
  }
  const blocks = order.map((key) =>
    lineToBlock(
      groups.get(key) as OcrBridgeWord[],
      safeWidth,
      safeHeight,
      sourceX,
      sourceY,
    ),
  );
  return { blocks };
}

export class AndroidBridgeOcrService implements OcrWithCoordsService {
  readonly name = "android-tesseract-bridge";

  constructor(private readonly runtime: IAgentRuntime) {}

  async describe(input: OcrWithCoordsInput): Promise<OcrWithCoordsResult> {
    if (input.pngBytes.byteLength === 0) return { blocks: [] };
    const bridge = this.runtime.getService<OcrBridgeService>(
      OCR_BRIDGE_SERVICE_TYPE,
    );
    if (!bridge) return { blocks: [] };
    const words = await bridge.requestOcr(input.pngBytes);
    if (!words || words.length === 0) return { blocks: [] };
    try {
      const { width, height } = readPngDimensions(input.pngBytes);
      return mapOcrWordsToResult(
        words,
        width,
        height,
        input.sourceX,
        input.sourceY,
      );
    } catch (err) {
      logger.warn(
        `[AndroidBridgeOcr] map failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { blocks: [] };
    }
  }
}
