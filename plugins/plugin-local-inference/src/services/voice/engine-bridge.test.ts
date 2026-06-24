/**
 * Tests for the streaming-TTS routing in `engine-bridge.ts`.
 *
 * Covers:
 *   - `nativeRejectedRangeToRollbackRange` half-open → inclusive conversion;
 *   - `StubTtsBackend` implementing the streaming seam for scheduler
 *     tests;
 *   - the `EngineVoiceBridge` direct-synthesis guard + one-shot transcription
 *     routing on the non-kokoroOnly (stub/override) path.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	EngineVoiceBridge,
	isStreamingTtsBackend,
	nativeRejectedRangeToRollbackRange,
	StubTtsBackend,
	type TtsPcmChunk,
} from "./engine-bridge";
import type { VoiceLifecycleLoaders } from "./lifecycle";
import type { MmapRegionHandle, RefCountedResource } from "./shared-resources";
import type { Phrase, SpeakerPreset, TtsBackend } from "./types";
import { writeVoicePresetFile } from "./voice-preset-format";

function phrase(text: string): Phrase {
	return {
		id: 1,
		text,
		fromIndex: 0,
		toIndex: text.length,
		terminator: "punctuation",
	};
}

function preset(): SpeakerPreset {
	return {
		voiceId: "default",
		embedding: new Float32Array(4),
		bytes: new Uint8Array(0),
	};
}

function writePresetBundle(root: string): void {
	mkdirSync(path.join(root, "cache"), { recursive: true });
	const embedding = new Float32Array(16);
	for (let i = 0; i < embedding.length; i++) embedding[i] = (i + 1) / 100;
	writeFileSync(
		path.join(root, "cache", "voice-preset-default.bin"),
		Buffer.from(writeVoicePresetFile({ embedding, phrases: [] })),
	);
}

function lifecycleLoadersOk(): VoiceLifecycleLoaders {
	const region: MmapRegionHandle = {
		id: "region-ok",
		path: "/tmp/tts-ok",
		sizeBytes: 1024,
		async evictPages() {},
		async release() {},
	};
	const refc: RefCountedResource = { id: "refc-ok", async release() {} };
	return {
		loadTtsRegion: async () => region,
		loadAsrRegion: async () => region,
		loadVoiceCaches: async () => refc,
		loadVoiceSchedulerNodes: async () => refc,
	};
}

describe("nativeRejectedRangeToRollbackRange", () => {
	it("converts native half-open verifier ranges to inclusive rollback ranges", () => {
		expect(
			nativeRejectedRangeToRollbackRange({ rejectedFrom: 3, rejectedTo: 7 }),
		).toEqual({ fromIndex: 3, toIndex: 6 });
	});

	it("ignores empty and absent native verifier ranges", () => {
		expect(
			nativeRejectedRangeToRollbackRange({ rejectedFrom: -1, rejectedTo: -1 }),
		).toBeNull();
		expect(
			nativeRejectedRangeToRollbackRange({ rejectedFrom: 5, rejectedTo: 5 }),
		).toBeNull();
	});
});

describe("StubTtsBackend — streaming seam", () => {
	it("implements StreamingTtsBackend and emits a fixed number of chunks + final tail", async () => {
		const backend = new StubTtsBackend(24_000);
		expect(isStreamingTtsBackend(backend)).toBe(true);
		const chunks: TtsPcmChunk[] = [];
		const res = await backend.synthesizeStream({
			phrase: phrase("one sec"),
			preset: preset(),
			cancelSignal: { cancelled: false },
			onChunk: (c) => {
				chunks.push(c);
			},
		});
		expect(res.cancelled).toBe(false);
		expect(chunks.length).toBeGreaterThanOrEqual(2);
		expect(chunks.at(-1)?.isFinal).toBe(true);
		// Every non-final chunk carries some PCM.
		for (const c of chunks.slice(0, -1)) {
			expect(c.isFinal).toBe(false);
			expect(c.pcm.length).toBeGreaterThan(0);
		}
		expect(backend.streamCalls).toBe(1);
	});

	it("honours a mid-stream cancel via onChunk returning true", async () => {
		const backend = new StubTtsBackend(24_000);
		let n = 0;
		const res = await backend.synthesizeStream({
			phrase: phrase("got it"),
			preset: preset(),
			cancelSignal: { cancelled: false },
			onChunk: () => {
				n += 1;
				return n === 1; // cancel after the first body chunk
			},
		});
		expect(res.cancelled).toBe(true);
	});
});

describe("EngineVoiceBridge direct synthesis guard", () => {
	let bundleRoot: string;

	beforeEach(() => {
		bundleRoot = mkdtempSync(path.join(tmpdir(), "eliza-engine-bridge-"));
		writePresetBundle(bundleRoot);
	});

	afterEach(() => {
		rmSync(bundleRoot, { recursive: true, force: true });
	});

	it("rejects direct WAV synthesis on the silent backend", async () => {
		const bridge = EngineVoiceBridge.start({
			bundleRoot,
			lifecycleLoaders: lifecycleLoadersOk(),
		});
		await bridge.arm();

		await expect(bridge.synthesizeTextToWav("hello")).rejects.toMatchObject({
			code: "missing-fused-build",
		});
	});

	it("routes one-shot transcription through the backend batch ABI without resampling first", async () => {
		let observedSampleRate = 0;
		let observedSamples = 0;
		const backend = {
			async synthesize() {
				return {
					phraseId: 0,
					fromIndex: 0,
					toIndex: 0,
					pcm: new Float32Array(1),
					sampleRate: 24_000,
				};
			},
			async transcribe(args: { pcm: Float32Array; sampleRate: number }) {
				observedSampleRate = args.sampleRate;
				observedSamples = args.pcm.length;
				return "Hello, say hello back.";
			},
		} as TtsBackend & {
			transcribe(args: {
				pcm: Float32Array;
				sampleRate: number;
			}): Promise<string>;
		};
		const bridge = EngineVoiceBridge.start({
			bundleRoot,
			lifecycleLoaders: lifecycleLoadersOk(),
			backendOverride: backend,
		});
		await bridge.arm();

		const pcm = new Float32Array(24_000);
		const transcript = await bridge.transcribePcm({
			pcm,
			sampleRate: 24_000,
		});

		expect(transcript).toBe("Hello, say hello back.");
		expect(observedSampleRate).toBe(24_000);
		expect(observedSamples).toBe(24_000);
	});
});
