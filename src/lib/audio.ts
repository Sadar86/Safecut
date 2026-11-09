/**
 * Decoding, waveform extraction, audio extraction and audio rendering.
 *
 * Everything here runs locally with the Web Audio API: the browser decodes the
 * compressed file, we keep mono peak data for the timeline waveform, and we can
 * re-encode to WAV (always) or MP3 (via FFmpeg.wasm, see lib/ffmpeg.ts).
 */

import type { Clip, Project } from "@/types";
import { computePeaks, encodeWav } from "@/lib/audio-math";
import { getBlob } from "@/lib/storage";
import { buildVoiceChain, presetById } from "@/lib/ai/voice";

export interface WaveformData {
  /** Peak values 0..1, `buckets` long. */
  peaks: number[];
  duration: number;
  sampleRate: number;
}

const waveformCache = new Map<string, WaveformData>();
const bufferCache = new Map<string, AudioBuffer>();

/** Decode a stored blob to an AudioBuffer (cached by asset id). */
export async function decodeAsset(assetId: string): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(assetId);
  if (cached) return cached;
  const blob = await getBlob(assetId);
  if (!blob) return null;
  const Ctx =
    typeof AudioContext !== "undefined"
      ? AudioContext
      : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    bufferCache.set(assetId, buffer);
    return buffer;
  } catch {
    return null;
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

/** Compute (and cache) the waveform peaks for an asset. */
export async function getWaveform(assetId: string, buckets = 800): Promise<WaveformData | null> {
  const cached = waveformCache.get(assetId);
  if (cached) return cached;
  const buffer = await decodeAsset(assetId);
  if (!buffer) return null;
  const data: WaveformData = {
    peaks: computePeaks(buffer.getChannelData(0), buckets),
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
  };
  waveformCache.set(assetId, data);
  return data;
}

export function peekWaveform(assetId: string): WaveformData | undefined {
  return waveformCache.get(assetId);
}

/**
 * Render a clip's audio (including voice enhancement) to a WAV blob.
 * Used by "apply enhancement" so the result is a real, playable file.
 */
export async function renderClipAudio(
  clip: Clip,
  options: { sampleRate?: number; intensity?: number } = {},
): Promise<Blob | null> {
  if (!clip.mediaId) return null;
  const buffer = await decodeAsset(clip.mediaId);
  if (!buffer) return null;
  const sampleRate = options.sampleRate ?? buffer.sampleRate;
  const start = Math.max(0, clip.inPoint);
  const length = Math.max(1, Math.ceil(clip.duration * clip.speed * sampleRate));
  const source = new AudioBuffer({
    length: Math.min(length, Math.max(1, buffer.length - Math.floor(start * buffer.sampleRate))),
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
  });
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    source.copyToChannel(
      buffer.getChannelData(c).subarray(
        Math.floor(start * buffer.sampleRate),
        Math.floor(start * buffer.sampleRate) + source.length,
      ),
      c,
    );
  }

  const OfflineCtx =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!OfflineCtx) return null;
  const ctx = new OfflineCtx(buffer.numberOfChannels, source.length, buffer.sampleRate);
  const src = new AudioBufferSourceNode(ctx, { buffer: source });
  const voice = clip.voice;
  const chain = voice && voice.preset !== "none"
    ? buildVoiceChain(ctx, presetById(voice.preset), voice.intensity ?? options.intensity ?? 1)
    : null;
  const gain = new GainNode(ctx, { gain: Math.max(0, Math.min(1, clip.audio.volume)) });
  if (chain) {
    src.connect(chain.input);
    chain.output.connect(gain);
  } else {
    src.connect(gain);
  }
  gain.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  const channels = Array.from({ length: rendered.numberOfChannels }, (_, i) => rendered.getChannelData(i));
  const wav = encodeWav(channels, sampleRate === rendered.sampleRate ? rendered.sampleRate : rendered.sampleRate);
  return new Blob([wav], { type: "audio/wav" });
}

/** Render the audible part of the timeline to interleaved stereo WAV. */
export async function renderTimelineAudio(
  project: Project,
  options: { start?: number; end?: number; sampleRate?: number; includeMuted?: boolean } = {},
): Promise<ArrayBuffer | null> {
  const start = options.start ?? 0;
  const end = options.end ?? project.duration;
  const sampleRate = options.sampleRate ?? 48000;
  const length = Math.max(1, Math.ceil((end - start) * sampleRate));
  const left = new Float32Array(length);
  const right = new Float32Array(length);

  const audible = project.clips.filter((clip) => {
    const track = project.tracks.find((t) => t.id === clip.trackId);
    if (!track) return false;
    if (track.muted && !options.includeMuted) return false;
    if (clip.audio.muted && !options.includeMuted) return false;
    return clip.start < end && clip.start + clip.duration > start;
  });

  for (const clip of audible) {
    if (!clip.mediaId) continue;
    const buffer = await decodeAsset(clip.mediaId);
    if (!buffer) continue;
    const track = project.tracks.find((t) => t.id === clip.trackId);
    const gain = clip.audio.volume * (track?.volume ?? 1);
    const duck = duckGainFor(project, clip);
    // Voice enhancement is applied offline to the clip before mixing.
    let processed = buffer;
    if (clip.voice && clip.voice.preset !== "none" && clip.voice.intensity > 0) {
      const rendered = await renderClipAudio(clip);
      if (rendered) {
        const Ctx = window.AudioContext;
        const ctx = new Ctx();
        try {
          processed = await ctx.decodeAudioData(await rendered.arrayBuffer());
        } finally {
          void ctx.close().catch(() => undefined);
        }
      }
    }
    mixClip({ clip, buffer: processed, gain: gain * duck, start, sampleRate, left, right });
  }

  return encodeWav([left, right], sampleRate);
}

function mixClip(args: {
  clip: Clip;
  buffer: AudioBuffer;
  gain: number;
  start: number;
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
}) {
  const { clip, buffer, gain, start, sampleRate, left, right } = args;
  const srcRate = buffer.sampleRate;
  const chL = buffer.getChannelData(0);
  const chR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : chL;
  const frames = Math.floor(clip.duration * sampleRate);
  const fadeIn = clip.audio.fadeIn * sampleRate;
  const fadeOut = clip.audio.fadeOut * sampleRate;

  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const outIndex = Math.floor((clip.start + t - start) * sampleRate);
    if (outIndex < 0 || outIndex >= left.length) continue;
    let srcTime = clip.inPoint + t * clip.speed;
    if (clip.reversed) srcTime = clip.inPoint + (clip.duration - t) * clip.speed;
    const srcIndex = Math.floor(srcTime * srcRate);
    if (srcIndex < 0 || srcIndex >= chL.length) continue;
    let envelope = 1;
    if (fadeIn > 0 && i < fadeIn) envelope = i / fadeIn;
    if (fadeOut > 0 && frames - i < fadeOut) envelope = Math.min(envelope, (frames - i) / fadeOut);
    left[outIndex] += chL[srcIndex] * gain * envelope;
    right[outIndex] += chR[srcIndex] * gain * envelope;
  }
}

/** Gain multiplier for a clip after automatic ducking is applied. */
export function duckGainFor(project: Project, clip: Clip): number {
  const duck = clip.audio.ducking;
  if (!duck?.enabled) return 1;
  const triggerTracks = new Set(
    project.tracks.filter((t) => t.kind === duck.trigger && !t.muted).map((t) => t.id),
  );
  const active = project.clips.some(
    (other) =>
      other.id !== clip.id &&
      triggerTracks.has(other.trackId) &&
      other.start < clip.start + clip.duration &&
      other.start + other.duration > clip.start &&
      !other.audio.muted,
  );
  return active ? Math.max(0.05, Math.min(1, duck.amount)) : 1;
}

/** Duration of the decoded asset, or null when it has no audio track. */
export async function assetAudioDuration(assetId: string): Promise<number | null> {
  const buffer = await decodeAsset(assetId);
  return buffer ? buffer.duration : null;
}
