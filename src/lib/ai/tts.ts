"use client";

/**
 * Text-to-speech that produces a real, editable audio clip.
 *
 * The browser's SpeechSynthesis API cannot be captured into Web Audio, so
 * recording system audio is unreliable and browser-dependent. SafeCut instead
 * builds a *voice-like* waveform locally with a formant synthesiser tuned to the
 * chosen language and rate, and labels it clearly in the UI as "synth voice".
 *
 * What this gives you, reliably and offline:
 *  - a WAV asset of the exact length of the spoken line,
 *  - correct duration from a word/rate model (shared with the timeline),
 *  - editable, exportable audio on its own track.
 *
 * What it is not: natural human speech. The real speech audio is still available
 * through the system voice preview (`speak()`), and the UI says so.
 */

import { encodeWav } from "@/lib/audio-math";

export interface TtsVoice {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

export interface VoiceProfile {
  id: string;
  name: string;
  /** Base pitch in Hz. */
  pitch: number;
  /** Formant multipliers for a male-ish / female-ish timbre. */
  formants: [number, number, number];
  description: string;
}

/** Deterministic voice profiles so the same script always sounds the same. */
export const VOICE_PROFILES: VoiceProfile[] = [
  { id: "aria", name: "Aria (female, neutral)", pitch: 205, formants: [1.12, 1.18, 1.15], description: "Clear and even — good for narration." },
  { id: "juno", name: "Juno (female, warm)", pitch: 185, formants: [1.08, 1.12, 1.1], description: "Softer, lower female voice." },
  { id: "orion", name: "Orion (male, neutral)", pitch: 118, formants: [0.92, 0.95, 0.98], description: "Standard male narrator." },
  { id: "atlas", name: "Atlas (male, deep)", pitch: 96, formants: [0.86, 0.9, 0.94], description: "Deep trailer-style voice." },
  { id: "kid", name: "Pip (child)", pitch: 260, formants: [1.3, 1.35, 1.3], description: "Higher, playful voice." },
];

export function profileById(id: string): VoiceProfile {
  return VOICE_PROFILES.find((p) => p.id === id) ?? VOICE_PROFILES[0];
}

/** Syllable estimate used for timing (matches the timeline preview). */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 1;
  const groups = w.match(/[aeiouy]+/g);
  let count = groups ? groups.length : 1;
  if (w.endsWith("e") && count > 1) count -= 1;
  return Math.max(1, count);
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

/** Lay words out on a timeline using syllables and the requested rate. */
export function planUtterance(text: string, rate = 1): { words: WordTiming[]; duration: number } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordsPerSecond = 2.6 * Math.max(0.5, Math.min(2, rate));
  const timings: WordTiming[] = [];
  let cursor = 0.06; // small lead-in
  for (const word of words) {
    const syllables = countSyllables(word);
    const duration = Math.max(0.12, (syllables * 0.62) / wordsPerSecond + 0.06);
    timings.push({ word, start: cursor, end: cursor + duration });
    cursor += duration + 0.045; // short inter-word gap
  }
  return { words: timings, duration: cursor + 0.1 };
}

const SAMPLE_RATE = 22050;

/**
 * Render the synthetic voice for a plan into a mono WAV blob.
 * Each syllable becomes a voiced segment with formant resonances and an
 * amplitude envelope; silences fall between words.
 */
export function renderVoiceWav(plan: { words: WordTiming[]; duration: number }, profile: VoiceProfile): Blob {
  const total = Math.max(1, Math.ceil(plan.duration * SAMPLE_RATE));
  const out = new Float32Array(total);
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1;
  };

  for (const word of plan.words) {
    const syllables = countSyllables(word.word);
    const span = (word.end - word.start) / syllables;
    for (let s = 0; s < syllables; s++) {
      const startSample = Math.floor((word.start + s * span) * SAMPLE_RATE);
      const length = Math.floor(span * SAMPLE_RATE * 0.82);
      // Slight pitch drift per syllable keeps it from sounding like a drone.
      const pitch = profile.pitch * (1 + (s % 2 === 0 ? 0.03 : -0.02));
      for (let i = 0; i < length; i++) {
        const t = i / SAMPLE_RATE;
        const env = Math.sin((Math.PI * i) / length) ** 0.7;
        const f0 = pitch * (1 - 0.12 * (i / length)); // falling intonation
        let sample = 0;
        for (let h = 1; h <= 12; h++) {
          const freq = f0 * h;
          if (freq > SAMPLE_RATE / 2) break;
          let gain = 0;
          for (let k = 0; k < 3; k++) {
            const formant = [700, 1220, 2600][k] * profile.formants[k];
            const bw = [130, 90, 160][k];
            gain += Math.exp(-(((freq - formant) / bw) ** 2)) * [1, 0.7, 0.4][k];
          }
          sample += Math.sin(2 * Math.PI * freq * t) * (gain / h);
        }
        sample += rand() * 0.006; // breath
        const idx = startSample + i;
        if (idx < total) out[idx] += sample * env * 0.16;
      }
    }
  }

  // Normalise to -3 dBFS.
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) {
    const gain = 0.7 / peak;
    for (let i = 0; i < out.length; i++) out[i] *= gain;
  }

  const wav = encodeWav([out], SAMPLE_RATE);
  return new Blob([wav], { type: "audio/wav" });
}

/** Convenience: script + voice → WAV blob and its planned word timings. */
export function synthesise(
  text: string,
  options: { voiceId: string; rate?: number },
): { blob: Blob; duration: number; words: WordTiming[] } {
  const plan = planUtterance(text, options.rate ?? 1);
  const blob = renderVoiceWav(plan, profileById(options.voiceId));
  return { blob, duration: plan.duration, words: plan.words };
}

/* ------------------------- system voice (optional) ------------------------- */

export function listSystemVoices(): TtsVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices().map((v) => ({
    name: v.name,
    lang: v.lang,
    localService: v.localService,
    default: v.default,
  }));
}

export function waitForSystemVoices(timeoutMs = 3000): Promise<TtsVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return resolve([]);
    const existing = listSystemVoices();
    if (existing.length > 0) return resolve(existing);
    const done = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", done);
      resolve(listSystemVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", done);
    setTimeout(done, timeoutMs);
  });
}

/** Speak text with a system voice (preview only — cannot be captured to a file). */
export function speakPreview(text: string, options: { voiceName?: string; rate?: number } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return reject(new Error("This browser has no speech synthesis"));
    }
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 600));
    const voice = window.speechSynthesis.getVoices().find((v) => v.name === options.voiceName);
    if (voice) utterance.voice = voice;
    utterance.rate = options.rate ?? 1;
    utterance.onend = () => resolve();
    utterance.onerror = (e) => reject(new Error(`Speech synthesis failed: ${e.error}`));
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function estimateSpeechSeconds(text: string, rate = 1): number {
  return planUtterance(text, rate).duration;
}
