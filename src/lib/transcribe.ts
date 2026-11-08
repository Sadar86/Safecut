"use client";

/**
 * Local, on-device speech recognition.
 *
 * Tier 1 — Web Speech API (`webkitSpeechRecognition`). Chrome and Edge ship a
 *          speech service; audio is transcribed by the browser and, depending on
 *          the build, may be processed in the cloud by the browser vendor. We say
 *          so in the UI instead of pretending it is fully local.
 * Tier 2 — no recogniser available: the user imports SRT/VTT or types captions.
 *
 * A pluggable `Transcriber` interface leaves room for whisper.cpp / Whisper WASM
 * without changing the UI (see ROADMAP.md).
 */

import type { SubtitleCue } from "@/types";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  confidence?: number;
}

export interface Transcriber {
  id: string;
  name: string;
  /** True when nothing leaves the device. */
  local: boolean;
  available: () => boolean;
  transcribe: (
    mediaUrl: string,
    options: { lang?: string; onProgress?: (ratio: number, partial?: string) => void; signal?: AbortSignal },
  ) => Promise<TranscriptSegment[]>;
}

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string; confidence: number };
  length: number;
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
};
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const webSpeechTranscriber: Transcriber = {
  id: "web-speech",
  name: "Browser speech recognition",
  local: false,
  available: () => getRecognitionCtor() !== null,
  transcribe: (mediaUrl, options) =>
    new Promise<TranscriptSegment[]>((resolve, reject) => {
      const Ctor = getRecognitionCtor();
      if (!Ctor) return reject(new Error("This browser has no speech recognition"));
      const recognition = new Ctor();
      recognition.lang = options.lang ?? "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      const audio = document.createElement("audio");
      audio.src = mediaUrl;
      audio.crossOrigin = "anonymous";
      const startedAt = performance.now();
      const segments: TranscriptSegment[] = [];
      let finalText = "";

      const finish = () => {
        audio.pause();
        if (segments.length === 0 && finalText.trim()) {
          segments.push({ start: 0, end: (performance.now() - startedAt) / 1000, text: finalText.trim() });
        }
        resolve(segments);
      };

      recognition.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0].transcript.trim();
          if (result.isFinal) {
            const now = (performance.now() - startedAt) / 1000;
            const start = segments.length > 0 ? segments[segments.length - 1].end : 0;
            segments.push({ start, end: now, text, confidence: result[0].confidence });
            finalText = finalText ? `${finalText} ${text}` : text;
          } else {
            interim += ` ${text}`;
          }
        }
        options.onProgress?.(audio.duration ? audio.currentTime / audio.duration : 0, interim.trim());
      };
      recognition.onerror = (event) => {
        if (event.error === "aborted") return finish();
        reject(new Error(`Speech recognition failed: ${event.error}`));
      };
      recognition.onend = () => finish();
      options.signal?.addEventListener("abort", () => recognition.abort());

      audio.onended = () => recognition.stop();
      void audio.play().catch(() => recognition.stop());
      recognition.start();
    }),
};

export function availableTranscribers(): Transcriber[] {
  return [webSpeechTranscriber].filter((t) => t.available());
}

/** Merge consecutive segments into readable caption cues. */
export function segmentsToCues(
  segments: TranscriptSegment[],
  options: { maxChars?: number; maxGap?: number; minDuration?: number } = {},
): SubtitleCue[] {
  const maxChars = options.maxChars ?? 90;
  const maxGap = options.maxGap ?? 0.8;
  const minDuration = options.minDuration ?? 1.2;
  const cues: SubtitleCue[] = [];
  let current: SubtitleCue | null = null;

  segments.forEach((seg, i) => {
    const text = seg.text.trim();
    if (!text) return;
    // A single segment can be longer than a comfortable caption: wrap it into
    // several cues of roughly equal length.
    const pieces: string[] = [];
    if (text.length > maxChars) {
      const words = text.split(/\s+/);
      let line = "";
      for (const word of words) {
        if ((line + " " + word).trim().length > maxChars && line) {
          pieces.push(line);
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      }
      if (line) pieces.push(line);
    } else {
      pieces.push(text);
    }

    pieces.forEach((piece, pIndex) => {
      const segStart = seg.start + ((seg.end - seg.start) * pIndex) / pieces.length;
      const segEnd = seg.start + ((seg.end - seg.start) * (pIndex + 1)) / pieces.length;
      if (current && current.text.length + piece.length + 1 > maxChars) {
        cues.push(current);
        current = null;
      }
      if (current && segStart - current.end > maxGap) {
        cues.push(current);
        current = null;
      }
      if (!current) {
        current = {
          id: `cue_${i}_${pIndex}`,
          start: segStart,
          end: Math.max(segEnd, segStart + minDuration),
          text: piece,
        };
      } else {
        current.text = `${current.text} ${piece}`;
        current.end = Math.max(segEnd, current.start + minDuration);
      }
    });
  });
  if (current) cues.push(current);
  return cues;
}
