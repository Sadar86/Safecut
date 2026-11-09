import { describe, expect, it } from "vitest";
import { applyRemoval, findSilences, planRemoval, SILENCE_DEFAULTS, type SilenceSegment } from "@/lib/ai/silence";
import { analyseVoice, planVoiceChain, presetById, scalePreset, VOICE_PRESETS } from "@/lib/ai/voice";
import { findHighlights, highlightsDuration, normalise, scoreSamples } from "@/lib/ai/highlights";

function sine(freq: number, seconds: number, sampleRate = 8000, amp = 0.5) {
  const out = new Float32Array(Math.floor(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

function withSilence() {
  const rate = 8000;
  const tone = sine(300, 1, rate);
  const gap = new Float32Array(rate);
  const buffer = new Float32Array(tone.length * 2 + gap.length);
  buffer.set(tone, 0);
  buffer.set(gap, tone.length);
  buffer.set(tone, tone.length * 2);
  return { buffer, rate };
}

describe("silence detection", () => {
  it("finds the silent gap and pads it", () => {
    const { buffer, rate } = withSilence();
    const segments = findSilences(buffer, rate, { minDuration: 0.5 });
    expect(segments).toHaveLength(1);
    expect(segments[0].start).toBeGreaterThan(1);
    expect(segments[0].start).toBeLessThan(1.2);
    expect(segments[0].end).toBeLessThan(2);
    expect(segments[0].id).toBe("sil_0");
  });

  it("respects the minimum duration", () => {
    const { buffer, rate } = withSilence();
    expect(findSilences(buffer, rate, { minDuration: 5 })).toHaveLength(0);
  });

  it("uses sane defaults", () => {
    expect(SILENCE_DEFAULTS.thresholdDb).toBeLessThan(0);
    expect(SILENCE_DEFAULTS.padding).toBeGreaterThan(0);
  });
});

describe("planRemoval", () => {
  const segments: SilenceSegment[] = [
    { id: "a", start: 1, end: 2, level: -45 },
    { id: "b", start: 2.5, end: 3, level: -45 },
    { id: "c", start: 6, end: 7, level: -45 },
  ];

  it("keeps the complement of the removed ranges", () => {
    const plan = planRemoval(segments, 10);
    expect(plan.savedSeconds).toBeCloseTo(2.5);
    expect(plan.kept[0]).toEqual({ start: 0, end: 1 });
    expect(plan.kept.at(-1)).toEqual({ start: 7, end: 10 });
  });

  it("merges overlapping ranges", () => {
    const plan = planRemoval([{ id: "x", start: 1, end: 3, level: 0 }, { id: "y", start: 2, end: 4, level: 0 }], 10);
    expect(plan.ranges).toEqual([{ start: 1, end: 4 }]);
  });

  it("only removes approved segments", () => {
    const plan = planRemoval(segments, 10, ["b"]);
    expect(plan.ranges).toEqual([{ start: 2.5, end: 3 }]);
  });

  it("clamps ranges to the clip duration", () => {
    const plan = planRemoval([{ id: "z", start: 8, end: 20, level: 0 }], 10);
    expect(plan.ranges).toEqual([{ start: 8, end: 10 }]);
  });
});

describe("applyRemoval", () => {
  const clip = { start: 5, duration: 10, inPoint: 0, speed: 1 };

  it("lays the surviving pieces back to back", () => {
    const plan = planRemoval([{ id: "a", start: 2, end: 4, level: 0 }], 10);
    const pieces = applyRemoval(clip, plan, true);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toMatchObject({ start: 5, inPoint: 0, duration: 2 });
    expect(pieces[1]).toMatchObject({ start: 7, inPoint: 4, duration: 6 });
  });

  it("keeps gaps when asked", () => {
    const plan = planRemoval([{ id: "a", start: 2, end: 4, level: 0 }], 10);
    const pieces = applyRemoval(clip, plan, false);
    expect(pieces[1].start).toBe(9);
  });

  it("accounts for playback speed", () => {
    const plan = planRemoval([{ id: "a", start: 2, end: 4, level: 0 }], 10);
    const pieces = applyRemoval({ ...clip, speed: 2 }, plan, true);
    expect(pieces[0].duration).toBe(1);
    expect(pieces[1].inPoint).toBe(8);
  });
});

describe("voice enhancement", () => {
  it("ships the documented presets", () => {
    expect(VOICE_PRESETS.map((p) => p.id)).toEqual(["none", "clean", "podcast", "noisy"]);
    expect(presetById("missing").id).toBe("none");
  });

  it("scales a preset by intensity", () => {
    const full = presetById("podcast");
    const half = scalePreset(full, 0.5);
    expect(half.highpass).toBeCloseTo(full.highpass / 2);
    expect(half.ratio).toBeLessThan(full.ratio);
    expect(half.ratio).toBeGreaterThan(1);
    const off = scalePreset(full, 0);
    expect(off.highpass).toBe(0);
    expect(off.ratio).toBe(1);
  });

  it("analyses level, noise floor and SNR", () => {
    // Steady tone for the first half, quiet for the second: the noise floor is
    // the quiet part, so the SNR must be clearly positive.
    const mixed = new Float32Array(8000 * 2);
    mixed.set(sine(220, 1, 8000, 0.5), 0);
    const analysis = analyseVoice(mixed, 8000);
    expect(analysis.speechDb).toBeGreaterThan(analysis.noiseFloorDb);
    expect(analysis.snrDb).toBeGreaterThan(10);
    expect(["clean", "podcast", "noisy"]).toContain(analysis.recommendation);
  });

  it("plans a chain that matches the preset", () => {
    const plan = planVoiceChain(presetById("podcast"), 1);
    expect(plan.highpass).toBe(110);
    expect(plan.lowpass).toBe(14000);
    expect(plan.presenceDb).toBe(3);
    expect(plan.compressor?.ratio).toBe(3.5);
    expect(plan.makeupGain).toBeGreaterThan(1);
  });

  it("plans no processing when off or at zero intensity", () => {
    const off = planVoiceChain(presetById("none"));
    expect(off.highpass).toBeNull();
    expect(off.lowpass).toBeNull();
    expect(off.compressor).toBeNull();
    const zero = planVoiceChain(presetById("podcast"), 0);
    expect(zero.highpass).toBeNull();
    expect(zero.compressor).toBeNull();
  });
});

describe("highlight detection", () => {
  const samples = Array.from({ length: 60 }, (_, i) => ({
    time: i,
    motion: i > 40 && i < 48 ? 0.9 : 0.2,
    loudness: i > 40 && i < 48 ? 0.8 : 0.3,
  }));

  it("normalises a series", () => {
    expect(normalise([2, 4, 6])).toEqual([0, 0.5, 1]);
    expect(normalise([5, 5, 5])).toEqual([0, 0, 0]);
    expect(normalise([])).toEqual([]);
  });

  it("weights motion and loudness", () => {
    const motionOnly = scoreSamples(samples, 1);
    const loudOnly = scoreSamples(samples, 0);
    expect(motionOnly[44]).toBeGreaterThan(motionOnly[10]);
    expect(loudOnly[44]).toBeGreaterThan(loudOnly[10]);
  });

  it("finds the energetic window and explains it", () => {
    const highlights = findHighlights(samples, 60, { count: 2, minDuration: 4, maxDuration: 10 });
    expect(highlights.length).toBeGreaterThan(0);
    // The energetic window is samples 41-47, so a highlight must overlap it.
    expect(highlights.some((h) => h.start < 48 && h.end > 41)).toBe(true);
    expect(highlights[0].reasons.length).toBeGreaterThan(0);
    expect(highlightsDuration(highlights)).toBeGreaterThan(0);
  });

  it("returns nothing for empty input", () => {
    expect(findHighlights([], 10)).toEqual([]);
    expect(findHighlights(samples, 0)).toEqual([]);
  });

  it("never returns overlapping segments", () => {
    const highlights = findHighlights(samples, 60, { count: 4 });
    for (let i = 1; i < highlights.length; i++) {
      expect(highlights[i].start).toBeGreaterThanOrEqual(highlights[i - 1].end - 0.001);
    }
  });
});
