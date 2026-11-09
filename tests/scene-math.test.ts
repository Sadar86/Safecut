import { describe, expect, it } from "vitest";
import {
  buildHistogram,
  detectCuts,
  histogramDistance,
  isBlackFrame,
  mergeCuts,
  type SceneFrame,
} from "@/lib/scene-math";

function hist(fill: number): number[] {
  const h = new Array(48).fill(0);
  h[fill] = 1;
  return h;
}

function frame(time: number, fill: number, luma = 0.5): SceneFrame {
  return { time, histogram: hist(fill), luma };
}

describe("histogramDistance", () => {
  it("is 0 for identical histograms and 1 for disjoint ones", () => {
    expect(histogramDistance(hist(0), hist(0))).toBe(0);
    expect(histogramDistance(hist(0), hist(5))).toBe(1);
  });

  it("is partial for overlapping histograms", () => {
    const a = [0.5, 0.5, 0, 0];
    const b = [0.25, 0.5, 0.25, 0];
    expect(histogramDistance(a, b)).toBeCloseTo(0.25);
  });
});

describe("detectCuts", () => {
  it("finds a hard cut between different scenes", () => {
    const frames = [frame(0, 0), frame(0.5, 0), frame(1, 0), frame(1.5, 10), frame(2, 10)];
    const cuts = detectCuts(frames, 0.35);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].time).toBe(1.5);
    expect(cuts[0].score).toBeGreaterThanOrEqual(0.35);
  });

  it("finds nothing in a continuous shot", () => {
    const frames = [frame(0, 3), frame(0.5, 3), frame(1, 3)];
    expect(detectCuts(frames, 0.35)).toHaveLength(0);
  });

  it("flags transitions to and from black", () => {
    const frames = [frame(0, 0, 0.5), frame(0.5, 0, 0.01), frame(1, 0, 0.5)];
    const cuts = detectCuts(frames, 0.9);
    expect(cuts).toHaveLength(2);
  });
});

describe("mergeCuts", () => {
  it("keeps the strongest cut inside a short window", () => {
    const merged = mergeCuts(
      [
        { time: 1, score: 0.4 },
        { time: 1.1, score: 0.9 },
        { time: 3, score: 0.5 },
      ],
      0.4,
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({ time: 1.1, score: 0.9 });
  });
});

describe("buildHistogram", () => {
  it("builds normalised bins and luminance from RGBA data", () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    const { histogram, luma } = buildHistogram(data);
    expect(histogram).toHaveLength(48);
    expect(histogram.reduce((a, b) => a + b, 0)).toBeCloseTo(3); // 2 pixels * 3 channels / pixels
    expect(luma).toBeGreaterThan(0);
    expect(luma).toBeLessThan(1);
  });

  it("reports black frames", () => {
    const { luma } = buildHistogram(new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]));
    expect(isBlackFrame(luma)).toBe(true);
  });
});
