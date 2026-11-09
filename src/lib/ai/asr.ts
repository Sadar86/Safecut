"use client";

/**
 * On-device Whisper transcription with transformers.js (ONNX runtime in WASM or
 * WebGPU). Loaded lazily: the library and the model are only downloaded when the
 * user runs local transcription.
 *
 * Output: word-level timings where the model provides them, which the caption
 * engine converts into cues.
 */

import type { WordTiming } from "@/lib/ai/align";
import type { ModelProgress } from "@/lib/ai/models";

type Pipeline = (audio: Float32Array, options: Record<string, unknown>) => Promise<{
  text?: string;
  chunks?: { text: string; timestamp: [number, number | null] }[];
}>;

interface TransformersModule {
  pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<Pipeline>;
  env: {
    allowLocalModels: boolean;
    backends?: { onnx?: { wasm?: { numThreads?: number } } };
  };
}

let modulePromise: Promise<TransformersModule> | null = null;
const pipelineCache = new Map<string, Pipeline>();

async function loadTransformers(): Promise<TransformersModule> {
  if (!modulePromise) {
    modulePromise = import("@huggingface/transformers").then((mod) => {
      const transformers = mod as unknown as TransformersModule;
      transformers.env.allowLocalModels = false; // fetch from the HF CDN, cache locally
      return transformers;
    });
  }
  return modulePromise;
}

export interface WhisperOptions {
  modelId: string;
  /** BCP-47-ish language code, or "auto". */
  language?: string;
  device?: "wasm" | "webgpu";
  onProgress?: ModelProgress;
  onStatus?: (message: string) => void;
  signal?: AbortSignal;
}

/** Progress of a transcription run, surfaced in the UI. */
export interface TranscribeStage {
  stage: "download" | "load" | "decode" | "transcribe";
  ratio: number;
  message: string;
}

export async function loadWhisper(options: WhisperOptions): Promise<Pipeline> {
  const cached = pipelineCache.get(options.modelId);
  if (cached) return cached;
  const transformers = await loadTransformers();
  options.onStatus?.("Downloading speech model…");
  const pipeline = await transformers.pipeline("automatic-speech-recognition", options.modelId, {
    device: options.device ?? "wasm",
    dtype: options.device === "webgpu" ? "fp16" : "q8",
    progress_callback: (event: { status?: string; file?: string; loaded?: number; total?: number }) => {
      if (!options.onProgress || !event.total) return;
      options.onProgress({
        file: event.file,
        loaded: event.loaded ?? 0,
        total: event.total,
        ratio: (event.loaded ?? 0) / event.total,
      });
    },
  });
  pipelineCache.set(options.modelId, pipeline);
  options.onStatus?.("Model ready");
  return pipeline;
}

/** Resample arbitrary-rate mono audio to 16 kHz (Whisper's expected rate). */
export function resampleTo16k(samples: Float32Array, sampleRate: number): Float32Array {
  if (sampleRate === 16000) return samples;
  const ratio = 16000 / sampleRate;
  const length = Math.max(1, Math.round(samples.length * ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const frac = src - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

export interface TranscriptionResult {
  text: string;
  words: WordTiming[];
  /** False when the model only returned phrase timings. */
  wordLevel: boolean;
}

/**
 * Transcribe mono 16 kHz audio. Requests word-level timestamps and falls back to
 * chunk timings when the backend does not support them.
 */
export async function transcribeLocal(
  audio16k: Float32Array,
  options: WhisperOptions & { offset?: number; onStage?: (stage: TranscribeStage) => void },
): Promise<TranscriptionResult> {
  const stage = (s: TranscribeStage) => options.onStage?.(s);
  stage({ stage: "load", ratio: 0, message: "Loading speech model…" });
  const pipeline = await loadWhisper({
    ...options,
    onProgress: (p) => {
      options.onProgress?.(p);
      stage({ stage: "download", ratio: p.ratio, message: `Downloading model ${Math.round(p.ratio * 100)}%` });
    },
    onStatus: (m) => {
      options.onStatus?.(m);
      stage({ stage: "load", ratio: 0, message: m });
    },
  });
  if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  options.onStatus?.("Transcribing…");
  stage({ stage: "transcribe", ratio: 0, message: "Transcribing (runs on this device)…" });
  const offset = options.offset ?? 0;

  // The quantised ONNX export has no cross-attention outputs, so *word*
  // timestamps throw. Request chunk timestamps first (supported everywhere),
  // then split each chunk into words proportionally.
  const base = {
    chunk_length_s: 30,
    stride_length_s: 5,
    language: options.language && options.language !== "auto" ? options.language : undefined,
    task: "transcribe",
  };
  let result: Awaited<ReturnType<Pipeline>>;
  let wordTimestamps = false;
  try {
    result = await pipeline(audio16k, { ...base, return_timestamps: "word" });
    wordTimestamps = true;
  } catch {
    result = await pipeline(audio16k, { ...base, return_timestamps: true });
  }

  const words: WordTiming[] = [];
  if (result.chunks?.length) {
    for (const chunk of result.chunks) {
      const [start, end] = chunk.timestamp;
      const text = chunk.text.trim();
      if (!text) continue;
      const finish = end ?? (start ?? 0) + 0.3;
      words.push({
        word: text,
        start: (start ?? 0) + offset,
        end: finish + offset,
      });
    }
  }

  if (words.length === 0 && result.text) {
    return {
      text: result.text.trim(),
      words: [{ word: result.text.trim(), start: offset, end: offset + audio16k.length / 16000 }],
      wordLevel: false,
    };
  }

  // Chunks may contain several words; split them evenly inside the chunk span.
  const expanded: WordTiming[] = [];
  for (const chunk of words) {
    const parts = chunk.word.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) {
      expanded.push(chunk);
      continue;
    }
    const span = (chunk.end - chunk.start) / parts.length;
    parts.forEach((word, i) => {
      expanded.push({
        word,
        start: chunk.start + i * span,
        end: chunk.start + (i + 1) * span,
      });
    });
  }

  return {
    text: result.text?.trim() ?? expanded.map((w) => w.word).join(" "),
    words: expanded,
    // `wordLevel` is true only when the model itself reported word timings;
    // chunk timings are split proportionally and reported as phrase-level.
    wordLevel: wordTimestamps && expanded.length > 1,
  };
}

export function isWhisperCached(modelId: string): boolean {
  return pipelineCache.has(modelId);
}
