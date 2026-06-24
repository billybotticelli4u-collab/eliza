/**
 * On-device Tesseract OCR plugin (#9105). Recognizes text in an image and
 * returns per-word text + bounding boxes + confidence — the raw material the
 * vision coord-OCR seam (`plugin-vision/src/ocr-with-coords.ts`) maps into
 * display-absolute `OcrWithCoordsResult` for the computer-use loop.
 *
 * Native engine: Tesseract4Android (JNI tesseract 5) on Android; a maintained
 * tesseract build on iOS. There is no web/Node engine — `isAvailable()` reports
 * false there and the host falls through to its platform provider (Windows.Media
 * .Ocr / the bundled desktop tesseract CLI / docTR).
 */

/** A single recognized word with its pixel box (image-relative) + confidence. */
export interface TesseractWord {
  text: string;
  /** Left edge in source-image pixels. */
  left: number;
  /** Top edge in source-image pixels. */
  top: number;
  width: number;
  height: number;
  /** Tesseract confidence in [0, 100]. */
  confidence: number;
  /** 0-based block / paragraph / line indices so callers can group into lines. */
  block: number;
  par: number;
  line: number;
}

export interface TesseractRecognizeOptions {
  /** Base64-encoded PNG or JPEG (no data-URL prefix). */
  image: string;
  /** Language(s), `+`-joined traineddata names. Defaults to `eng`. */
  lang?: string;
  /**
   * Page segmentation mode (tesseract `--psm`). Defaults to 11 (sparse text —
   * find as much text as possible in no particular order), which matches the
   * desktop CLI provider and suits arbitrary UI screenshots.
   */
  psm?: number;
}

export interface TesseractRecognizeResult {
  words: TesseractWord[];
  /** Source image dimensions in pixels. */
  width: number;
  height: number;
  /** Wall-clock recognition time in ms. */
  durationMs: number;
}

export interface TesseractAvailability {
  available: boolean;
  /** The tesseract engine version, when available. */
  version?: string;
  /** The languages whose traineddata is present. */
  languages?: string[];
  reason?: string;
}

export interface TesseractPlugin {
  /** True when the native engine + at least one traineddata language is ready. */
  isAvailable(): Promise<TesseractAvailability>;
  /** Recognize text + word boxes in `image`. */
  recognize(
    options: TesseractRecognizeOptions,
  ): Promise<TesseractRecognizeResult>;
}
