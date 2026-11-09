import { describe, expect, it } from "vitest";
import {
  applyFades,
  computePeaks,
  detectSilence,
  encodeWav,
  fromDb,
  reduceNoise,
  rms,
  toDb,
} from "@/lib/audio-math";

function sine(freq: number, seconds: number, sampleRate = 8000, amplitude = 0.5): Float32Array {
  const out = new Float32Array(Math.floor(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

describe("computePeaks", () => {
  it("returns one normalised peak per bucket", () => {
    const channel = new Float32Array([0, 0.5, -1, 0.25, 0, 0.1]);
    const peaks = computePeaks(channel, 3);
    expect(peaks).toHaveLength(3);
    expect(Math.max(...peaks)).toBe(1);
    expect(peaks.every((p) => p >= 0 && p <= 1)).toBe(true);
  });

  it("handles silence and empty input", () => {
    expect(computePeaks(new Float32Array(10), 5).every((p) => p === 0)).toBe(true);
    expect(computePeaks(new Float32Array(0), 5)).toEqual([0, 0, 0, 0, 0]);
    expect(computePeaks(new Float32Array(4), 0)).toEqual([]);
  });
});

describe("levels", () => {
  it("computes RMS of a sine wave", () => {
    const level = rms(sine(440, 0.5, 8000, 1));
    expect(level).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it("converts between gain and decibels", () => {
    expect(toDb(1)).toBeCloseTo(0);
    expect(toDb(0)).toBe(-Infinity);
    expect(toDb(0.5)).toBeCloseTo(-6.02, 1);
    expect(fromDb(-6.02)).toBeCloseTo(0.5, 2);
  });
});

describe("detectSilence", () => {
  it("finds the silent gap between two tones", () => {
    const sampleRate = 8000;
    const tone = sine(440, 1, sampleRate);
    const silence = new Float32Array(sampleRate);
    const buffer = new Float32Array(tone.length * 2 + silence.length);
    buffer.set(tone, 0);
    buffer.set(silence, tone.length);
    buffer.set(tone, tone.length * 2);
    const ranges = detectSilence(buffer, sampleRate, -40, 0.5);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].start).toBeCloseTo(1, 1);
    expect(ranges[0].end).toBeCloseTo(2, 1);
  });

  it("finds nothing in continuous sound", () => {
    expect(detectSilence(sine(440, 2), 8000, -40, 0.5)).toHaveLength(0);
  });
});

describe("encodeWav", () => {
  it("writes a valid 16-bit PCM header", () => {
    const buffer = encodeWav([new Float32Array(10), new Float32Array(10)], 48000);
    const view = new DataView(buffer);
    const str = (o: number, n: number) =>
      String.fromCharCode(...new Uint8Array(buffer, o, n));
    expect(str(0, 4)).toBe("RIFF");
    expect(str(8, 4)).toBe("WAVE");
    expect(str(12, 4)).toBe("fmt ");
    expect(view.getUint16(22, true)).toBe(2); // stereo
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16); // bit depth
    expect(buffer.byteLength).toBe(44 + 10 * 2 * 2);
  });

  it("clamps out-of-range samples", () => {
    const buffer = encodeWav([new Float32Array([2, -2])], 8000);
    const view = new DataView(buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });
});

describe("fades and noise reduction", () => {
  it("applies a linear fade in and out", () => {
    const channel = new Float32Array(100).fill(1);
    const out = applyFades(channel, 100, 0.2, 0.2);
    expect(out[0]).toBe(0);
    expect(out[50]).toBe(1);
    expect(out[99]).toBeCloseTo(0, 5);
    expect(channel[0]).toBe(1); // input not mutated
  });

  it("attenuates quiet samples only", () => {
    const out = reduceNoise(new Float32Array([0.5, 0.001, -0.5, 0.0005]), 0.02, 0.1);
    expect(out[0]).toBe(0.5);
    expect(Math.abs(out[1])).toBeLessThan(0.001);
    expect(Math.abs(out[3])).toBeLessThan(0.001);
  });
});
