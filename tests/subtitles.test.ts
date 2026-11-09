import { describe, expect, it } from "vitest";
import {
  cuesDuration,
  formatTimestamp,
  parseSubtitles,
  parseTimestamp,
  shiftCues,
  toSRT,
  toTranscript,
  toVTT,
  toWordCues,
} from "@/lib/subtitles";

const SRT = `1
00:00:01,000 --> 00:00:03,500
Hello there

2
00:00:04,000 --> 00:00:06,000
This is SafeCut.
Second line.
`;

const VTT = `WEBVTT

00:00:01.000 --> 00:00:03.500
Hello there

NOTE this is a comment

00:04.000 --> 00:06.000
This is SafeCut.
`;

describe("timestamps", () => {
  it("parses SRT and VTT timestamps", () => {
    expect(parseTimestamp("00:00:01,500")).toBe(1.5);
    expect(parseTimestamp("00:01:02.250")).toBe(62.25);
    expect(parseTimestamp("01:02.000")).toBe(62);
    expect(parseTimestamp("nope")).toBeNaN();
  });

  it("formats with the right separator and padding", () => {
    expect(formatTimestamp(1.5, ",")).toBe("00:00:01,500");
    expect(formatTimestamp(3725.25, ".")).toBe("01:02:05.250");
    expect(formatTimestamp(-5, ",")).toBe("00:00:00,000");
  });
});

describe("parseSubtitles", () => {
  it("parses SRT cues including multi-line text", () => {
    const cues = parseSubtitles(SRT);
    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBe(1);
    expect(cues[0].end).toBe(3.5);
    expect(cues[1].text).toBe("This is SafeCut.\nSecond line.");
  });

  it("parses VTT, skipping headers and notes", () => {
    const cues = parseSubtitles(VTT);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe("Hello there");
    expect(cues[1].start).toBe(4);
  });

  it("strips inline HTML tags", () => {
    const cues = parseSubtitles("1\n00:00:00,000 --> 00:00:01,000\n<i>Hi</i> <b>you</b>");
    expect(cues[0].text).toBe("Hi you");
  });

  it("returns an empty list for junk", () => {
    expect(parseSubtitles("not a subtitle file at all")).toHaveLength(0);
    expect(parseSubtitles("")).toHaveLength(0);
  });

  it("repairs inverted timings", () => {
    const cues = parseSubtitles("1\n00:00:05,000 --> 00:00:04,000\nBackwards");
    expect(cues[0].end).toBeGreaterThan(cues[0].start);
  });
});

describe("serialisation", () => {
  const cues = parseSubtitles(SRT);

  it("round-trips SRT", () => {
    const again = parseSubtitles(toSRT(cues));
    expect(again.map((c) => c.text)).toEqual(cues.map((c) => c.text));
    expect(again[0].start).toBeCloseTo(cues[0].start, 3);
  });

  it("round-trips VTT", () => {
    const text = toVTT(cues);
    expect(text.startsWith("WEBVTT")).toBe(true);
    expect(parseSubtitles(text)).toHaveLength(2);
  });

  it("exports a plain transcript", () => {
    expect(toTranscript(cues)).toBe("Hello there\nThis is SafeCut. Second line.");
  });
});

describe("word cues and timing", () => {
  it("splits a cue into evenly timed words", () => {
    const words = toWordCues({ id: "a", start: 0, end: 3, text: "one two three" });
    expect(words).toHaveLength(3);
    expect(words[0]).toMatchObject({ start: 0, end: 1, text: "one" });
    expect(words[2]).toMatchObject({ start: 2, end: 3, text: "three" });
  });

  it("keeps single-word cues intact", () => {
    expect(toWordCues({ id: "b", start: 1, end: 2, text: "solo" })).toHaveLength(1);
  });

  it("shifts cues and clamps at zero", () => {
    const shifted = shiftCues([{ id: "x", start: 1, end: 2, text: "a" }], -5);
    expect(shifted[0].start).toBe(0);
    expect(shifted[0].end).toBe(0.1);
  });

  it("reports the end of the last cue", () => {
    expect(cuesDuration(parseSubtitles(SRT))).toBe(6);
  });
});
