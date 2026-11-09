import { describe, expect, it } from "vitest";
import {
  clampCues,
  cueConfidence,
  distributeWords,
  mergeCues,
  retimeCue,
  shiftCuesAfter,
  splitCue,
  wordsToCues,
} from "@/lib/ai/align";

const words = (spec: [string, number, number][]) => spec.map(([word, start, end]) => ({ word, start, end }));

describe("distributeWords", () => {
  it("spreads a phrase across its words proportionally to length", () => {
    const out = distributeWords("I absolutely agree", 0, 3);
    expect(out).toHaveLength(3);
    expect(out[0].start).toBe(0);
    expect(out[2].end).toBeCloseTo(3, 5);
    // "absolutely" is the longest word, so it gets the widest span.
    expect(out[1].end - out[1].start).toBeGreaterThan(out[0].end - out[0].start);
  });

  it("handles empty and single-word input", () => {
    expect(distributeWords("", 0, 1)).toEqual([]);
    const single = distributeWords("hello", 2, 3);
    expect(single[0]).toMatchObject({ start: 2, end: 3 });
  });
});

describe("wordsToCues", () => {
  it("groups words into readable cues and enforces a minimum duration", () => {
    const cues = wordsToCues(words([["Hello", 0, 0.3], ["there", 0.3, 0.6]]));
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("Hello there");
    expect(cues[0].end - cues[0].start).toBeGreaterThanOrEqual(1);
  });

  it("starts a new cue on a long pause", () => {
    const cues = wordsToCues(words([["One", 0, 0.4], ["two", 0.4, 0.8], ["three", 5, 5.4]]));
    expect(cues).toHaveLength(2);
    expect(cues[1].text).toBe("three");
  });

  it("wraps text longer than maxChars", () => {
    const long = Array.from({ length: 20 }, (_, i) => [`word${i}`, i * 0.3, i * 0.3 + 0.25] as [string, number, number]);
    const cues = wordsToCues(words(long), { maxChars: 30 });
    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) expect(cue.text.length).toBeLessThanOrEqual(30);
  });

  it("honours the maxWords ceiling", () => {
    const many = Array.from({ length: 10 }, (_, i) => [`w${i}`, i * 0.2, i * 0.2 + 0.18] as [string, number, number]);
    const cues = wordsToCues(words(many), { maxWords: 3 });
    expect(cues.length).toBeGreaterThanOrEqual(4);
  });
});

describe("cue editing", () => {
  const cue = { id: "a", start: 1, end: 3, text: "one two three four" };

  it("merges two cues", () => {
    const merged = mergeCues(cue, { id: "b", start: 3.2, end: 4, text: "five" });
    expect(merged).toMatchObject({ start: 1, end: 4, text: "one two three four five" });
  });

  it("splits a cue at a time", () => {
    const parts = splitCue(cue, 2);
    expect(parts).not.toBeNull();
    expect(parts![0].end).toBe(2);
    expect(parts![1].start).toBe(2);
    expect(`${parts![0].text} ${parts![1].text}`).toBe(cue.text);
  });

  it("refuses to split outside the cue", () => {
    expect(splitCue(cue, 0.5)).toBeNull();
    expect(splitCue(cue, 3.5)).toBeNull();
  });

  it("retimes keeping duration", () => {
    const moved = retimeCue(cue, 10);
    expect(moved.start).toBe(10);
    expect(moved.end).toBe(12);
  });

  it("shifts later cues", () => {
    const out = shiftCuesAfter([cue, { id: "b", start: 5, end: 6, text: "x" }], 3, 1);
    expect(out[0].start).toBe(1); // untouched
    expect(out[1].start).toBe(6);
  });

  it("clamps cues to the project duration", () => {
    const out = clampCues([cue, { id: "b", start: 10, end: 12, text: "late" }], 8);
    expect(out).toHaveLength(1);
    expect(out[0].end).toBe(3);
  });

  it("averages word confidences when present", () => {
    expect(cueConfidence([{ word: "a", start: 0, end: 1, confidence: 0.5 }, { word: "b", start: 1, end: 2, confidence: 1 }])).toBe(0.75);
    expect(cueConfidence([{ word: "a", start: 0, end: 1 }])).toBeUndefined();
  });
});
