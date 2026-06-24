import { Capacitor } from "@capacitor/core";
import { getTesseractPlugin } from "../bridge/native-plugins";

/**
 * Renderer side of the Android agent-triggered OCR bridge (#9105), sibling of
 * the screen-capture bridge.
 *
 * The agent (musl bun, no Capacitor) can not call the native Tesseract4Android
 * engine, so OCR is renderer-PULLED: this module interval-polls
 * `GET /api/vision/ocr-requests`, runs the Capacitor `@elizaos/capacitor-tesseract`
 * plugin on each queued PNG, and POSTs the recognized words back to
 * `POST /api/vision/ocr-result`, which resolves the agent's pending promise.
 */

const POLL_INTERVAL_MS = 1200;

interface OcrRequest {
  requestId: string;
  createdAt: number;
  imageBase64: string;
  psm?: number;
}

let started = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function isNativeMobile(): boolean {
  try {
    const platform = Capacitor.getPlatform();
    return platform === "android" || platform === "ios";
  } catch {
    return false;
  }
}

function isOcrRequest(value: unknown): value is OcrRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { requestId?: unknown }).requestId === "string" &&
    typeof (value as { imageBase64?: unknown }).imageBase64 === "string"
  );
}

async function postOcrResult(body: Record<string, unknown>): Promise<void> {
  await fetch("/api/vision/ocr-result", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function serveRequest(request: OcrRequest): Promise<void> {
  try {
    const opts: { image: string; psm?: number } = {
      image: request.imageBase64,
    };
    if (typeof request.psm === "number") opts.psm = request.psm;
    const result = await getTesseractPlugin().recognize(opts);
    await postOcrResult({
      requestId: request.requestId,
      words: result.words,
    });
  } catch (error) {
    // Settle the agent's pending request immediately (as null) instead of
    // waiting out its timeout, and keep this poller running for the next one.
    const reason = error instanceof Error ? error.message : String(error);
    await postOcrResult({ requestId: request.requestId, error: reason }).catch(
      () => {},
    );
  }
}

async function poll(): Promise<void> {
  let requests: OcrRequest[];
  try {
    const res = await fetch("/api/vision/ocr-requests");
    if (!res.ok) return;
    const data = (await res.json()) as { requests?: unknown };
    const list = Array.isArray(data.requests) ? data.requests : [];
    requests = list.filter(isOcrRequest);
  } catch {
    return;
  }
  for (const request of requests) {
    await serveRequest(request);
  }
}

/**
 * Idempotent boot: start the OCR-request poller on Android/iOS native. No-op on
 * web/desktop and on repeat calls.
 */
export function initOcrBridge(): void {
  if (started) return;
  if (!isNativeMobile()) return;
  started = true;
  pollTimer = setInterval(() => {
    void poll();
  }, POLL_INTERVAL_MS);
}

/** Test-only reset hook. */
export function __resetOcrBridgeForTests(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  started = false;
}
