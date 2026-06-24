# @elizaos/capacitor-tesseract

On-device **Tesseract OCR** (text + word boxes + confidence) for the #9105 vision
coord-OCR seam. Native **JNI** engine — Tesseract4Android on Android (a loaded
`.so`, so it is unaffected by Android's `noexec` data dirs that block shipping a
CLI binary). `eng.traineddata` ships in `android/src/main/assets/tessdata/` and
is copied once into `filesDir/tessdata/` at first use.

```ts
import { Tesseract } from "@elizaos/capacitor-tesseract";
const { available } = await Tesseract.isAvailable();
const { words, width, height } = await Tesseract.recognize({ image: base64Png });
// words: { text, left, top, width, height, confidence, block, par, line }[]
```

Consumed by `plugin-vision` (the Android coord-OCR provider) → `ocr-with-coords.ts`
→ the computer-use scene builder / GET_SCREEN. Web/Node report unavailable (those
hosts use Windows.Media.Ocr / the bundled desktop tesseract CLI / docTR).
