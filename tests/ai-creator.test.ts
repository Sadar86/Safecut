import { describe, expect, it } from "vitest";
import { ASPECT_TARGETS, clamp01, cropFor, cropToTransform, describeCrop, smoothPath } from "@/lib/ai/reframe";
import { countSyllables, planUtterance, profileById, renderVoiceWav, synthesise, VOICE_PROFILES } from "@/lib/ai/tts";
import { contextFromProject, localAssistant, runTask } from "@/lib/ai/assistant";
import { createProject, makeClip } from "@/lib/timeline";

const landscape = { width: 1920, height: 1080 };

describe("reframe crop maths", () => {
  it("crops the sides for a vertical target", () => {
    const crop = cropFor(landscape, 9 / 16);
    expect(crop.h).toBe(1080);
    expect(Math.abs(crop.w - 607.5)).toBeLessThanOrEqual(1);
    expect(crop.x).toBeGreaterThan(0);
  });

  it("crops the top/bottom for a portrait source into landscape", () => {
    const crop = cropFor({ width: 1080, height: 1920 }, 16 / 9);
    expect(crop.w).toBe(1080);
    expect(Math.abs(crop.h - 607.5)).toBeLessThanOrEqual(1);
  });

  it("keeps a square crop square", () => {
    const crop = cropFor(landscape, 1);
    expect(crop.w).toBe(crop.h);
  });

  it("centres on a subject box", () => {
    const crop = cropFor(landscape, 9 / 16, { x: 0.5, y: 0.5 }, { x: 0.05, y: 0.2, w: 0.15, h: 0.4 });
    expect(crop.x).toBeLessThan(300);
    expect(crop.x).toBeGreaterThanOrEqual(0);
  });

  it("never leaves the source frame", () => {
    for (const focus of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.2, y: 0.9 }]) {
      const crop = cropFor(landscape, 9 / 16, focus);
      expect(crop.x).toBeGreaterThanOrEqual(0);
      expect(crop.y).toBeGreaterThanOrEqual(0);
      expect(crop.x + crop.w).toBeLessThanOrEqual(1920);
      expect(crop.y + crop.h).toBeLessThanOrEqual(1080);
    }
  });

  it("converts a crop into renderer transform values", () => {
    const crop = cropFor(landscape, 9 / 16);
    const t = cropToTransform(crop, landscape);
    expect(t.scale).toBeCloseTo(1920 / crop.w, 5);
    expect(Math.abs(t.x)).toBeLessThan(100);
    expect(t.y).toBeCloseTo(0, 5);
  });

  it("smooths a jittery path", () => {
    const jitter = [0.5, 0.9, 0.5, 0.1, 0.5, 0.5].map((x) => ({ x, y: 0.5 }));
    const smooth = smoothPath(jitter, 5);
    expect(smooth).toHaveLength(jitter.length);
    expect(Math.abs(smooth[3].x - 0.5)).toBeLessThan(Math.abs(jitter[3].x - 0.5));
  });

  it("describes a crop for the manual controls", () => {
    const crop = cropFor(landscape, 9 / 16, { x: 0.2, y: 0.5 });
    const d = describeCrop(crop, landscape);
    expect(d.horizontal).toBeGreaterThanOrEqual(0);
    expect(d.horizontal).toBeLessThanOrEqual(100);
    expect(d.coverage).toBeGreaterThan(0);
    expect(d.coverage).toBeLessThan(100);
  });

  it("exposes the documented aspect targets", () => {
    expect(Object.keys(ASPECT_TARGETS)).toEqual(["9:16", "1:1", "4:5", "16:9", "21:9"]);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(-1)).toBe(0);
  });
});

describe("text-to-speech planning", () => {
  it("counts syllables sensibly", () => {
    expect(countSyllables("cat")).toBe(1);
    expect(countSyllables("banana")).toBe(3);
    expect(countSyllables("make")).toBe(1);
    expect(countSyllables("")).toBe(1);
  });

  it("lays words out in order with no overlap", () => {
    const plan = planUtterance("SafeCut makes editing quick and free");
    expect(plan.words).toHaveLength(6);
    expect(plan.duration).toBeGreaterThan(1);
    for (let i = 1; i < plan.words.length; i++) {
      expect(plan.words[i].start).toBeGreaterThanOrEqual(plan.words[i - 1].end);
    }
  });

  it("speeds up with a higher rate", () => {
    const slow = planUtterance("hello there friend", 0.8);
    const fast = planUtterance("hello there friend", 1.6);
    expect(fast.duration).toBeLessThan(slow.duration);
  });

  it("renders a real WAV blob", () => {
    const plan = planUtterance("Hello world", 1);
    const blob = renderVoiceWav(plan, profileById("aria"));
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBeGreaterThan(44 + 1000);
  });

  it("produces identical output for the same input (deterministic)", () => {
    const a = synthesise("same words", { voiceId: "orion" });
    const b = synthesise("same words", { voiceId: "orion" });
    expect(a.duration).toBe(b.duration);
    expect(a.blob.size).toBe(b.blob.size);
  });

  it("ships distinct voice profiles", () => {
    expect(VOICE_PROFILES.length).toBeGreaterThanOrEqual(4);
    expect(profileById("nope").id).toBe(VOICE_PROFILES[0].id);
    const pitches = new Set(VOICE_PROFILES.map((p) => p.pitch));
    expect(pitches.size).toBe(VOICE_PROFILES.length);
  });
});

describe("AI assistant (local provider)", () => {
  const project = createProject("My travel vlog");
  project.clips = [
    makeClip({ trackId: project.tracks[0].id, mediaId: "a", name: "A", start: 0, duration: 30, sourceDuration: 30 }),
  ];
  project.duration = 30;
  const ctx = contextFromProject(project, { topic: "Iceland road trip" });

  it("derives context from the project", () => {
    expect(ctx.clipCount).toBe(1);
    expect(ctx.duration).toBe(30);
    expect(ctx.aspectRatio).toBe("16:9");
    expect(ctx.hasCaptions).toBe(false);
  });

  it("suggests titles that mention the topic", () => {
    const result = localAssistant("titles", ctx);
    expect(result.provider).toBe("local");
    expect(result.body.split("\n")).toHaveLength(5);
    expect(result.body.toLowerCase()).toContain("iceland");
  });

  it("recommends vertical for short edits and offers an action", () => {
    const result = localAssistant("aspect", ctx);
    expect(result.body).toContain("9:16");
    expect(result.actions?.[0]).toEqual({ kind: "aspect", value: "9:16" });
  });

  it("recommends landscape for long edits", () => {
    const result = localAssistant("aspect", { ...ctx, duration: 600 });
    expect(result.body).toContain("16:9");
    expect(result.actions?.[0].value).toBe("16:9");
  });

  it("asks for a script before planning", () => {
    const result = localAssistant("plan", { ...ctx, script: "" });
    expect(result.body).toContain("Paste your script");
  });

  it("turns a script into a timed plan", () => {
    const result = localAssistant("plan", {
      ...ctx,
      script: "Welcome back. Today we drive the ring road. Then we stop at a waterfall.",
    });
    const lines = result.body.split("\n").filter((l) => l.includes("—"));
    expect(lines).toHaveLength(3);
    expect(result.body).toContain("Welcome back");
  });

  it("falls back to the local provider when the server is not configured", async () => {
    const result = await runTask("improvements", ctx, { useServer: false });
    expect(result.provider).toBe("local");
    expect(result.body.length).toBeGreaterThan(10);
  });

  it("never mutates the project", async () => {
    const before = JSON.stringify(project);
    await runTask("titles", ctx);
    await runTask("plan", { ...ctx, script: "One. Two." });
    expect(JSON.stringify(project)).toBe(before);
  });
});
