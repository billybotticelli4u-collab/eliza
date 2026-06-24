/**
 * Tests for the Android coord-OCR mapper (#9105) — pure, runs on every platform
 * from injected native words (no device, no Capacitor). The bridge round-trip is
 * exercised separately; here we pin that native Tesseract4Android words group by
 * `(block, par, line)` into one block per text line, in display-absolute coords.
 */

import { describe, expect, it } from "vitest";
import type { OcrBridgeWord } from "./ocr-bridge.js";
import { mapOcrWordsToResult } from "./ocr-service-android-bridge.js";

function word(over: Partial<OcrBridgeWord> & { text: string }): OcrBridgeWord {
  return {
    left: 0,
    top: 0,
    width: 10,
    height: 10,
    confidence: 90,
    block: 0,
    par: 0,
    line: 0,
    ...over,
  };
}

describe("mapOcrWordsToResult (pure)", () => {
  it("groups words by block/par/line into blocks with union bbox + source shift", () => {
    const words: OcrBridgeWord[] = [
      word({
        text: "Save",
        left: 10,
        top: 20,
        width: 40,
        height: 16,
        block: 1,
        par: 1,
        line: 1,
      }),
      word({
        text: "File",
        left: 60,
        top: 20,
        width: 36,
        height: 16,
        block: 1,
        par: 1,
        line: 1,
      }),
      word({
        text: "Cancel",
        left: 10,
        top: 44,
        width: 52,
        height: 16,
        block: 1,
        par: 1,
        line: 2,
      }),
    ];
    const result = mapOcrWordsToResult(words, 200, 60, 100, 200);
    expect(result.blocks).toHaveLength(2);

    const [first, second] = result.blocks;
    expect(first.text).toBe("Save File");
    // Union of the two word rects (10..96 x, 20..36 y), shifted by source (100,200).
    expect(first.bbox).toEqual({ x: 110, y: 220, width: 86, height: 16 });
    expect(first.words.map((w) => w.text)).toEqual(["Save", "File"]);
    expect(first.words[0].bbox).toEqual({
      x: 110,
      y: 220,
      width: 40,
      height: 16,
    });
    expect(first.words[1].bbox).toEqual({
      x: 160,
      y: 220,
      width: 36,
      height: 16,
    });
    expect(first.semantic_position).toBeDefined();

    expect(second.text).toBe("Cancel");
    expect(second.bbox).toEqual({ x: 110, y: 244, width: 52, height: 16 });
    expect(second.words).toHaveLength(1);
  });

  it("keeps lines from different blocks/paragraphs as separate blocks", () => {
    const words: OcrBridgeWord[] = [
      word({ text: "A", block: 0, par: 0, line: 0 }),
      word({ text: "B", block: 0, par: 1, line: 0 }),
      word({ text: "C", block: 1, par: 0, line: 0 }),
    ];
    const result = mapOcrWordsToResult(words, 100, 100, 0, 0);
    expect(result.blocks.map((b) => b.text)).toEqual(["A", "B", "C"]);
  });

  it("skips blank-text words and returns no blocks for empty input", () => {
    expect(mapOcrWordsToResult([], 100, 100, 0, 0).blocks).toEqual([]);
    const result = mapOcrWordsToResult(
      [word({ text: "  " }), word({ text: "x", left: 5 })],
      100,
      100,
      0,
      0,
    );
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].text).toBe("x");
  });

  it("tolerates zero tile dimensions without throwing", () => {
    const result = mapOcrWordsToResult([word({ text: "x" })], 0, 0, 0, 0);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].semantic_position).toBeDefined();
  });
});
