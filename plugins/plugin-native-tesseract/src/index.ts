import { registerPlugin } from "@capacitor/core";

import type { TesseractPlugin } from "./definitions";

export * from "./definitions";

const loadWeb = () => import("./web").then((m) => new m.TesseractWeb());

export const Tesseract = registerPlugin<TesseractPlugin>("Tesseract", {
  web: loadWeb,
});
