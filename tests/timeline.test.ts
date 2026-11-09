import { describe, expect, it } from "vitest";
import {
  addKeyframe,
  clipEnd,
  clipsOnTrack,
  createProject,
  deleteClips,
  duplicateClip,
  evaluateKeyframes,
  findGap,
  makeClip,
  moveClip,
  overlaps,
  projectDuration,
  splitClip,
  trimClip,
} from "@/lib/timeline";
import type { Clip } from "@/types";

function clip(start: number, duration: number, trackId = "t1", id = `c${start}`): Clip {
  return { ...makeClip({ trackId, mediaId: null, name: id, start, duration, sourceDuration: 10 }), id };
}

describe("timeline math", () => {
  it("computes clip end and project duration", () => {
    const clips = [clip(0, 5), clip(8, 2)];
    expect(clipEnd(clips[0])).toBe(5);
    expect(projectDuration(clips)).toBe(10);
    expect(projectDuration([])).toBe(0);
  });

  it("sorts clips on a track", () => {
    const clips = [clip(6, 1, "t1", "b"), clip(1, 1, "t1", "a"), clip(3, 1, "t2", "c")];
    expect(clipsOnTrack(clips, "t1").map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("finds the first free gap on a track", () => {
    const clips = [clip(0, 4, "t1", "a"), clip(6, 2, "t1", "b")];
    expect(findGap(clips, "t1", 1)).toBe(4);
    expect(findGap(clips, "t1", 5)).toBe(8);
    expect(findGap(clips, "t1", 1, 1)).toBe(4);
  });

  it("detects overlaps but ignores the clip being moved", () => {
    const clips = [clip(0, 5, "t1", "a"), clip(5, 5, "t1", "b")];
    expect(overlaps(clips, "t1", 3, 1)).toBe(true);
    expect(overlaps(clips, "t1", 10, 1)).toBe(false);
    expect(overlaps(clips, "t1", 1, 1, ["a"])).toBe(false);
  });
});

describe("splitClip", () => {
  it("splits a clip into two contiguous halves", () => {
    const clips = [clip(0, 10, "t1", "a")];
    const out = splitClip(clips, "a", 4);
    expect(out).toHaveLength(2);
    const [left, right] = out;
    expect(left.start).toBe(0);
    expect(left.duration).toBe(4);
    expect(right.start).toBe(4);
    expect(right.duration).toBe(6);
    expect(right.inPoint).toBe(4);
    expect(left.id).not.toBe(right.id);
  });

  it("respects playback speed when computing the source in-point", () => {
    const base = clip(0, 10, "t1", "a");
    const out = splitClip([{ ...base, speed: 2 }], "a", 5);
    expect(out[1].inPoint).toBe(10);
  });

  it("ignores splits outside the clip", () => {
    const clips = [clip(2, 4, "t1", "a")];
    expect(splitClip(clips, "a", 0)).toHaveLength(1);
    expect(splitClip(clips, "a", 6)).toHaveLength(1);
    expect(splitClip(clips, "missing", 3)).toHaveLength(1);
  });

  it("distributes keyframes to the half that contains them", () => {
    const base = addKeyframe(clip(0, 10, "t1", "a"), "opacity", 8, 0.5);
    const out = splitClip([base], "a", 4);
    expect(out[0].keyframes).toHaveLength(0);
    expect(out[1].keyframes[0].t).toBe(4);
  });
});

describe("trimClip", () => {
  it("trims the end", () => {
    const out = trimClip([clip(0, 10, "t1", "a")], "a", "end", 6);
    expect(out[0].duration).toBe(6);
  });

  it("trims the start and advances the in-point", () => {
    const out = trimClip([clip(0, 10, "t1", "a")], "a", "start", 3);
    expect(out[0].start).toBe(3);
    expect(out[0].duration).toBe(7);
    expect(out[0].inPoint).toBe(3);
  });

  it("never trims past the source media", () => {
    const out = trimClip([clip(2, 5, "t1", "a")], "a", "start", 0);
    // The clip starts at 2s with inPoint 0, so there is no earlier source to
    // reveal: trimming left must not move it.
    expect(out[0].start).toBe(2);
    expect(out[0].inPoint).toBe(0);
    expect(out[0].duration).toBe(5);
  });
});

describe("other operations", () => {
  it("moves a clip between tracks and clamps negative starts", () => {
    const out = moveClip([clip(0, 2, "t1", "a")], "a", "t2", -5);
    expect(out[0].trackId).toBe("t2");
    expect(out[0].start).toBe(0);
  });

  it("deletes clips by id", () => {
    const clips = [clip(0, 1, "t1", "a"), clip(2, 1, "t1", "b")];
    expect(deleteClips(clips, ["a"]).map((c) => c.id)).toEqual(["b"]);
  });

  it("duplicates a clip after the original without overlapping", () => {
    const out = duplicateClip([clip(0, 4, "t1", "a")], "a");
    expect(out).toHaveLength(2);
    expect(out[1].start).toBe(4);
    expect(out[1].id).not.toBe(out[0].id);
  });
});

describe("keyframes", () => {
  const base = clip(0, 10, "t1", "a");

  it("falls back to the static value when there are no keyframes", () => {
    expect(evaluateKeyframes([], "opacity", 3, 0.7)).toBe(0.7);
  });

  it("interpolates linearly", () => {
    let c = addKeyframe(base, "opacity", 0, 0);
    c = addKeyframe(c, "opacity", 4, 1);
    expect(evaluateKeyframes(c.keyframes, "opacity", 0, 1)).toBe(0);
    expect(evaluateKeyframes(c.keyframes, "opacity", 2, 1)).toBeCloseTo(0.5);
    expect(evaluateKeyframes(c.keyframes, "opacity", 4, 1)).toBe(1);
    expect(evaluateKeyframes(c.keyframes, "opacity", 9, 1)).toBe(1);
  });

  it("replaces a keyframe at the same time", () => {
    let c = addKeyframe(base, "scale", 2, 1.5);
    c = addKeyframe(c, "scale", 2, 2);
    expect(c.keyframes.filter((k) => k.property === "scale")).toHaveLength(1);
    expect(c.keyframes[0].value).toBe(2);
  });
});

describe("createProject", () => {
  it("creates the four default tracks", () => {
    const p = createProject("Test");
    expect(p.tracks.map((t) => t.kind)).toEqual(["video", "overlay", "text", "audio"]);
    expect(p.settings.width).toBe(1920);
    expect(p.duration).toBe(0);
  });
});

describe("scene splitting (integration)", () => {
  it("splits a clip at every detected boundary inside it", async () => {
    const { splitClipAtScenes } = await import("@/stores/analysis");
    const project = createProject("Scenes");
    const track = project.tracks[0];
    const base = makeClip({ trackId: track.id, mediaId: "m1", name: "shot", start: 0, duration: 10, sourceDuration: 10 });
    project.clips = [base];
    const { clips, applied } = splitClipAtScenes(project, base.id, [2, 5, 8, 20, 0]);
    expect(applied).toBe(3);
    expect(clips).toHaveLength(4);
    expect(clips.map((c) => Number(c.start.toFixed(2))).sort((a, b) => a - b)).toEqual([0, 2, 5, 8]);
    expect(projectDuration(clips)).toBe(10);
  });

  it("does nothing when there is no clip", async () => {
    const { splitClipAtScenes } = await import("@/stores/analysis");
    const project = createProject("Scenes");
    const { applied } = splitClipAtScenes(project, "missing", [1]);
    expect(applied).toBe(0);
  });
});
