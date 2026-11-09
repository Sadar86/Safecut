/**
 * Audio maths used by the waveform display, the audio analyser worker and the
 * WAV encoder. Pure functions, so they are unit tested in Node.
 */

/** Peak values per bucket, normalised to 0..1. */
export function computePeaks(channel: Float32Array, buckets: number): number[] {
  if (buckets <= 0) return [];
  const peaks: number[] = new Array(buckets).fill(0);
  const perBucket = channel.length / buckets;
  let globalMax = 0;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * perBucket);
    const end = Math.min(channel.length, Math.floor((b + 1) * perBucket));
    let peak = 0;
    for (let i = start; i < end; i++) {
      const v = Math.abs(channel[i]);
      if (v > peak) peak = v;
    }
    peaks[b] = peak;
    if (peak > globalMax) globalMax = peak;
  }
  if (globalMax > 0) {
    for (let b = 0; b < buckets; b++) peaks[b] = Math.min(1, peaks[b] / globalMax);
  }
  return peaks;
}

/** Root-mean-square level of a buffer, 0..1. */
export function rms(channel: Float32Array): number {
  if (channel.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < channel.length; i++) sum += channel[i] * channel[i];
  return Math.sqrt(sum / channel.length);
}

/** Convert a linear gain to decibels (‑Infinity for silence). */
export function toDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}

/** Convert decibels to a linear gain. */
export function fromDb(db: number): number {
  return Math.pow(10, db / 20);
}

/** dB value of an equaliser band, clamped to a sane range. */
export function eqGain(db: number): number {
  return fromDb(Math.max(-12, Math.min(12, db)));
}

/**
 * Detect silence in an audio buffer: returns ranges (seconds) whose RMS stays
 * below `thresholdDb` for at least `minSilence` seconds.
 */
export function detectSilence(
  channel: Float32Array,
  sampleRate: number,
  thresholdDb = -40,
  minSilence = 0.6,
  windowSec = 0.05,
): { start: number; end: number }[] {
  const windowSize = Math.max(1, Math.floor(sampleRate * windowSec));
  const threshold = fromDb(thresholdDb);
  const ranges: { start: number; end: number }[] = [];
  let runStart: number | null = null;

  for (let offset = 0; offset < channel.length; offset += windowSize) {
    const slice = channel.subarray(offset, Math.min(channel.length, offset + windowSize));
    const level = rms(slice);
    const time = offset / sampleRate;
    if (level < threshold) {
      if (runStart === null) runStart = time;
    } else if (runStart !== null) {
      const end = time;
      if (end - runStart >= minSilence) ranges.push({ start: runStart, end });
      runStart = null;
    }
  }
  if (runStart !== null) {
    const end = channel.length / sampleRate;
    if (end - runStart >= minSilence) ranges.push({ start: runStart, end });
  }
  return ranges;
}

/** Encode Float32 PCM samples as a 16-bit WAV file. */
export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const numChannels = Math.max(1, channels.length);
  const frames = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const dataSize = frames * numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return buffer;
}

/** Apply a linear fade to a mono buffer in place (fade-in / fade-out seconds). */
export function applyFades(
  channel: Float32Array,
  sampleRate: number,
  fadeIn: number,
  fadeOut: number,
): Float32Array {
  const inSamples = Math.min(channel.length, Math.floor(fadeIn * sampleRate));
  const outSamples = Math.min(channel.length, Math.floor(fadeOut * sampleRate));
  const out = new Float32Array(channel);
  for (let i = 0; i < inSamples; i++) out[i] *= i / inSamples;
  for (let i = 0; i < outSamples; i++) {
    const idx = out.length - 1 - i;
    out[idx] *= i / outSamples;
  }
  return out;
}

/**
 * Simple one-pole low-pass gate used for noise reduction: samples quieter than
 * `threshold` are attenuated, which removes hiss while leaving speech intact.
 */
export function reduceNoise(channel: Float32Array, threshold = 0.02, floor = 0.15): Float32Array {
  const out = new Float32Array(channel.length);
  for (let i = 0; i < channel.length; i++) {
    const v = channel[i];
    out[i] = Math.abs(v) < threshold ? v * floor : v;
  }
  return out;
}
