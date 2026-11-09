"use client";

/**
 * Speech recognition service used by the AI Creator Studio.
 *
 * Engines, in preference order:
 *  1. Whisper (transformers.js, on-device, word-level timings) — downloads a model once.
 *  2. Browser Web Speech API — no download, phrase timings, may use the cloud.
 *
 * Everything returns `WordTiming[]`, so the caption engine sees one shape.
 */

import type { WordTiming } from "@/lib/ai/align";
import { MODELS } from "@/lib/ai/models";
import { resampleTo16k, transcribeLocal } from "@/lib/ai/asr";
import { availableTranscribers, segmentsToWords } from "@/lib/transcribe";
import { decodeAsset } from "@/lib/audio";

export type EngineId = "whisper-tiny.en" | "whisper-base" | "whisper-small" | "web-speech";

export interface EngineStatus {
  id: EngineId;
  available: boolean;
  reason?: string;
  wordLevel: boolean;
  local: boolean;
  sizeMb: number;
}

export interface TranscriptionProgress {
  stage: "loading" | "transcribing" | "done";
  ratio: number;
  message: string;
}

export interface TranscriptionRequest {
  assetId: string;
  assetUrl?: string;
  engine: EngineId;
  language?: string;
  /** Offset added to every timestamp (clip in-point on the timeline). */
  offset?: number;
  onProgress?: (p: TranscriptionProgress) => void;
  signal?: AbortSignal;
}

export interface TranscriptionResponse {
  words: WordTiming[];
  text: string;
  engine: EngineId;
  wordLevel: boolean;
  language: string;
  /** Seconds of audio processed. */
  duration: number;
}

const WHISPER_ENGINES: EngineId[] = ["whisper-tiny.en", "whisper-base", "whisper-small"];

export function engineStatus(): EngineStatus[] {
  const webSpeech = availableTranscribers().length > 0;
  const wasmOk = typeof WebAssembly !== "undefined";
  return (["whisper-tiny.en", "whisper-base", "whisper-small", "web-speech"] as EngineId[]).map((id) => {
    if (id === "web-speech") {
      return {
        id,
        available: webSpeech,
        reason: webSpeech ? undefined : "This browser has no speech recognition",
        wordLevel: false,
        local: false,
        sizeMb: 0,
      };
    }
    const model = MODELS[id];
    return {
      id,
      available: wasmOk,
      reason: wasmOk ? undefined : "WebAssembly is required for on-device models",
      wordLevel: true,
      local: true,
      sizeMb: model?.sizeMb ?? 0,
    };
  });
}

/** Recommended engine for this device. */
export function recommendEngine(caps: { tier: string; webgpu: boolean }): EngineId {
  if (caps.tier === "high" && caps.webgpu) return "whisper-base";
  if (caps.tier === "medium") return "whisper-tiny.en";
  return availableTranscribers().length > 0 ? "web-speech" : "whisper-tiny.en";
}

export async function transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse> {
  const { engine, assetId, onProgress, signal } = request;
  const offset = request.offset ?? 0;

  if (WHISPER_ENGINES.includes(engine)) {
    onProgress?.({ stage: "loading", ratio: 0, message: "Decoding audio…" });
    const buffer = await decodeAsset(assetId);
    if (!buffer) throw new Error("This asset has no audio track that the browser can decode.");
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");

    const mono = new Float32Array(buffer.length);
    const channels = Math.min(2, buffer.numberOfChannels);
    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / channels;
    }
    const audio16k = resampleTo16k(mono, buffer.sampleRate);
    onProgress?.({ stage: "transcribing", ratio: 0, message: "Preparing model…" });

    const result = await transcribeLocal(audio16k, {
      modelId: MODELS[engine].id,
      language: request.language,
      device: "wasm",
      offset,
      signal,
      onStage: (st) =>
        onProgress?.({
          stage: st.stage === "download" || st.stage === "load" ? "loading" : "transcribing",
          ratio: st.ratio,
          message: st.message,
        }),
      onProgress: (p) =>
        onProgress?.({ stage: "loading", ratio: p.ratio, message: `Downloading model ${Math.round(p.ratio * 100)}%` }),
      onStatus: (message) => onProgress?.({ stage: "transcribing", ratio: 0, message }),
    });
    onProgress?.({ stage: "done", ratio: 1, message: "Done" });
    return {
      words: result.words,
      text: result.text,
      engine,
      wordLevel: result.wordLevel,
      language: request.language ?? "auto",
      duration: buffer.duration,
    };
  }

  // Browser Web Speech API.
  const transcriber = availableTranscribers()[0];
  if (!transcriber) throw new Error("This browser has no speech recognition. Choose a Whisper model instead.");
  if (!request.assetUrl) throw new Error("The media URL is not available yet — reload the project.");
  onProgress?.({ stage: "transcribing", ratio: 0, message: "Listening…" });
  const segments = await transcriber.transcribe(request.assetUrl, {
    lang: request.language && request.language !== "auto" ? request.language : undefined,
    signal,
    onProgress: (ratio) => onProgress?.({ stage: "transcribing", ratio, message: "Listening…" }),
  });
  const words = segmentsToWords(segments).map((w) => ({ ...w, start: w.start + offset, end: w.end + offset }));
  onProgress?.({ stage: "done", ratio: 1, message: "Done" });
  return {
    words,
    text: words.map((w) => w.word).join(" "),
    engine,
    wordLevel: false,
    language: request.language ?? "auto",
    duration: words.length ? words[words.length - 1].end - offset : 0,
  };
}
