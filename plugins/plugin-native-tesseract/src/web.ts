import { WebPlugin } from "@capacitor/core";

import type {
  TesseractAvailability,
  TesseractPlugin,
  TesseractRecognizeResult,
} from "./definitions";

/**
 * Web fallback: there is no in-browser native tesseract here. The host's
 * platform OCR chain (Windows.Media.Ocr / the bundled desktop tesseract CLI /
 * docTR) covers web/Node, so this reports unavailable rather than pulling a
 * wasm engine into the bundle.
 */
export class TesseractWeb extends WebPlugin implements TesseractPlugin {
  async isAvailable(): Promise<TesseractAvailability> {
    return {
      available: false,
      reason: "native tesseract is Android/iOS only; web uses the docTR chain",
    };
  }

  async recognize(): Promise<TesseractRecognizeResult> {
    throw this.unavailable("Tesseract OCR is not available on web.");
  }
}
