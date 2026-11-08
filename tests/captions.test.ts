import { describe, expect, it } from "vitest";
import { CAPTION_TEMPLATES, captionTrack, clipsToCues, cuesToClips, styleForTemplate, templateById } from "@/lib/captions";
import { segmentsToCues } from "@/lib/transcribe";
import { createProject, makeClip } from "@/lib/timeline";
import { parseSubtitles, toSRT } from "@/lib/subtitles";

const cues = [
  { id: "a", start: 0, end: 2, text: "Hello world" },
  { id: "b", start: 2.2, end: 4, text: "Second line here" },
];

describe("caption templates", () => {
  it("exposes the documented template set", () => {
    expect(CAPTION_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    expect(CAPTION_TEMPLATES.map((t) => t.id)).toContain("tiktok");
  });

  it("falls back to the first template for unknown ids", () => {
    expect(templateById("does-not-exist").id).toBe(CAPTION_TEMPLATES[0].id);
  });

  it("merges template style over the base text style", () => {
    const style = styleForTemplate(templateById("boxed"), { content: "x" });
    expect(style.content).toBe("x");
    expect(style.template).toBe("boxed");
    expect(style.background).toContain("rgba");
  });
});

describe("cuesToClips", () => {
  it("creates one text clip per cue on the given track", () => {
    const clips = cuesToClips(cues, "track-1", templateById("clean"));
    expect(clips).toHaveLength(2);
    expect(clips[0].trackId).toBe("track-1");
    expect(clips[0].start).toBe(0);
    expect(clips[0].duration).toBe(2);
    expect(clips[1].text?.content).toBe("Second line here");
    expect(clips.every((c) => c.mediaId === null)).toBe(true);
  });

  it("applies an offset to every cue", () => {
    const clips = cuesToClips(cues, "t", templateById("clean"), { offset: 10 });
    expect(clips[0].start).toBe(10);
    expect(clips[1].start).toBe(12.2);
  });

  it("expands word-by-word templates into one clip per word", () => {
    const clips = cuesToClips(cues, "t", templateById("tiktok"));
    // "Hello world" (2) + "Second line here" (3)
    expect(clips).toHaveLength(5);
    expect(clips[0].text?.content).toBe("Hello");
  });

  it("round-trips cues through clips", () => {
    const clips = cuesToClips(cues, "t", templateById("clean"));
    const back = clipsToCues(clips);
    expect(back.map((c) => c.text)).toEqual(cues.map((c) => c.text));
    expect(back[1].start).toBeCloseTo(2.2);
  });
});

describe("captionTrack", () => {
  it("creates a caption track once and reuses it", () => {
    const project = createProject("Captions");
    const first = captionTrack(project);
    expect(first.trackId).not.toBeUndefined();
    expect(first.project.tracks.some((t) => t.id === first.trackId && t.name === "Captions")).toBe(true);
    const second = captionTrack(first.project);
    expect(second.trackId).toBe(first.trackId);
    expect(second.project.tracks).toHaveLength(first.project.tracks.length);
  });
});

describe("segmentsToCues", () => {
  it("merges short segments into readable cues", () => {
    const result = segmentsToCues([
      { start: 0, end: 0.6, text: "Hello" },
      { start: 0.6, end: 1.2, text: "there" },
      { start: 3, end: 4, text: "A new sentence" },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("Hello there");
    expect(result[1].start).toBe(3);
  });

  it("splits very long text into several cues", () => {
    const long = "word ".repeat(40).trim();
    const result = segmentsToCues([{ start: 0, end: 10, text: long }], { maxChars: 40 });
    expect(result.length).toBeGreaterThan(1);
  });

  it("enforces a minimum cue duration", () => {
    const result = segmentsToCues([{ start: 5, end: 5.1, text: "Hi" }], { minDuration: 1.5 });
    expect(result[0].end - result[0].start).toBeGreaterThanOrEqual(1.5);
  });
});

describe("captions in a project", () => {
  it("produces an SRT that parses back to the same cues", () => {
    const project = createProject("P");
    const { project: withTrack, trackId } = captionTrack(project);
    const clips = cuesToClips(cues, trackId, templateById("clean"));
    const srt = toSRT(clipsToCues(clips));
    const parsed = parseSubtitles(srt);
    expect(parsed.map((c) => c.text)).toEqual(cues.map((c) => c.text));
    expect(withTrack.tracks.length).toBe(project.tracks.length + 1);
    expect(makeClip).toBeTypeOf("function");
  });
});
