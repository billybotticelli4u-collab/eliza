// Android agent-triggered OCR bridge (renderer-pulled), sibling of the
// screen-capture bridge.
//
// On Android the agent runs in a musl bun process with no Capacitor, so it can
// not call the native Tesseract4Android engine directly. OCR is therefore
// renderer-PULLED: the agent enqueues a PNG here; the renderer interval-polls
// `GET /api/vision/ocr-requests`, runs the `@elizaos/capacitor-tesseract`
// plugin, and POSTs the recognized words back to `POST /api/vision/ocr-result`,
// which resolves the matching pending promise. The JNI loopback already forwards
// any `/api/...` path, so no Java/Kotlin change is needed.

import { type IAgentRuntime, logger, Service } from "@elizaos/core";

export const OCR_BRIDGE_SERVICE_TYPE = "vision-ocr-bridge";

/** How long a `requestOcr` promise waits for the renderer before resolving null. */
const REQUEST_OCR_TIMEOUT_MS = 20_000;

/** One recognized word as the native plugin returns it (image-relative pixels). */
export interface OcrBridgeWord {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  confidence: number;
  block: number;
  par: number;
  line: number;
}

/** A queued OCR request, drained by the GET poll and run by the renderer. */
export interface OcrRequest {
  requestId: string;
  createdAt: number;
  /** Base64 PNG the renderer feeds to the native engine. */
  imageBase64: string;
  /** Page segmentation mode passed through to tesseract. */
  psm?: number;
}

interface PendingOcr {
  resolve: (words: OcrBridgeWord[] | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Renderer-pulled OCR bridge. The agent calls `requestOcr(pngBytes)`; the
 * renderer drains via `takeRequests()` and delivers words via `submitResult()`.
 * Never hangs — a request that the renderer never answers resolves `null` at the
 * timeout.
 */
export class OcrBridgeService extends Service {
  static override serviceType: string = OCR_BRIDGE_SERVICE_TYPE;
  override capabilityDescription =
    "Renderer-pulled bridge for agent-triggered on-device Tesseract OCR.";

  private readonly queue: OcrRequest[] = [];
  private readonly pending = new Map<string, PendingOcr>();
  private readonly timeoutMs = REQUEST_OCR_TIMEOUT_MS;

  static async start(runtime: IAgentRuntime): Promise<OcrBridgeService> {
    return new OcrBridgeService(runtime);
  }

  /** Enqueue a PNG for OCR; resolves the recognized words (or null on timeout). */
  requestOcr(
    pngBytes: Uint8Array,
    psm?: number,
  ): Promise<OcrBridgeWord[] | null> {
    const requestId = crypto.randomUUID();
    const request: OcrRequest = {
      requestId,
      createdAt: Date.now(),
      imageBase64: Buffer.from(pngBytes).toString("base64"),
    };
    if (typeof psm === "number") request.psm = psm;
    this.queue.push(request);

    return new Promise<OcrBridgeWord[] | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        logger.debug(
          `[OcrBridgeService] OCR request ${requestId} timed out after ${this.timeoutMs}ms`,
        );
        resolve(null);
      }, this.timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
      this.pending.set(requestId, { resolve, timer });
    });
  }

  /** Drain and return all queued OCR requests (for the GET poll). */
  takeRequests(): OcrRequest[] {
    return this.queue.splice(0, this.queue.length);
  }

  /** Deliver recognized words for a queued request. False if unknown/expired. */
  submitResult(requestId: string, words: OcrBridgeWord[]): boolean {
    const pendingOcr = this.pending.get(requestId);
    if (!pendingOcr) return false;
    this.pending.delete(requestId);
    clearTimeout(pendingOcr.timer);
    pendingOcr.resolve(words);
    return true;
  }

  /** Settle a request as a skip/failure (resolves null) so the agent moves on. */
  failRequest(requestId: string, reason: string): boolean {
    const pendingOcr = this.pending.get(requestId);
    if (!pendingOcr) return false;
    this.pending.delete(requestId);
    clearTimeout(pendingOcr.timer);
    logger.debug(
      `[OcrBridgeService] OCR request ${requestId} failed: ${reason}`,
    );
    pendingOcr.resolve(null);
    return true;
  }

  async stop(): Promise<void> {
    this.queue.length = 0;
    for (const [requestId, pendingOcr] of this.pending) {
      clearTimeout(pendingOcr.timer);
      pendingOcr.resolve(null);
      this.pending.delete(requestId);
    }
  }
}
