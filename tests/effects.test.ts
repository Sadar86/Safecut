import { describe, expect, it } from "vitest";
import { cssFilter, FILTERS, textCss, tintOverlay } from "@/lib/effects";
import { normaliseProject, parseProjectFile, toProjectFile } from "@/lib/project";
import { createProject, makeClip } from "@/lib/timeline";

describe("cssFilter", () => {
  it("returns none for neutral adjustments", () => {
    expect(cssFilter({ brightness: 1, contrast: 1, saturation: 1 }, "none")).toBe("none");
  });

  it("includes each adjusted property", () => {
    const css = cssFilter({ brightness: 1.2, contrast: 1.1, saturation: 0.5, blur: 4 }, "none");
    expect(css).toContain("brightness(1.200)");
    expect(css).toContain("contrast(1.100)");
    expect(css).toContain("saturate(0.500)");
    expect(css).toContain("blur(4px)");
  });

  it("maps every filter preset to something renderable", () => {
    for (const f of FILTERS) {
      expect(typeof cssFilter({}, f.id)).toBe("string");
    }
    expect(cssFilter({}, "bw")).toContain("grayscale(1)");
    expect(cssFilter({}, "sepia")).toContain("sepia(0.85)");
  });

  it("applies exposure as an extra brightness multiplier", () => {
    expect(cssFilter({ brightness: 1, exposure: 100 }, "none")).toContain("brightness(1.500)");
  });
});

describe("tintOverlay", () => {
  it("is null when temperature and tint are neutral", () => {
    expect(tintOverlay({ temperature: 0, tint: 0 })).toBeNull();
  });
  it("produces an rgba colour otherwise", () => {
    expect(tintOverlay({ temperature: 40 })).toMatch(/^rgba\(/);
    expect(tintOverlay({ temperature: -40 })).toMatch(/^rgba\(/);
  });
});

describe("textCss", () => {
  it("scales font size with the frame width", () => {
    const base = textCss(
      { content: "Hi", fontFamily: "Inter", fontSize: 100, color: "#fff", background: "transparent", outlineColor: "#000", outlineWidth: 0, shadow: false, align: "center", bold: true, italic: false, x: 50, y: 50, animation: "none" },
      1080,
    );
    const wide = textCss(
      { content: "Hi", fontFamily: "Inter", fontSize: 100, color: "#fff", background: "transparent", outlineColor: "#000", outlineWidth: 0, shadow: false, align: "center", bold: true, italic: false, x: 50, y: 50, animation: "none" },
      2160,
    );
    expect(base.fontSize).toBe("100px");
    expect(wide.fontSize).toBe("200px");
  });
});

describe("project files", () => {
  it("round-trips through export and import", () => {
    const project = createProject("Round trip");
    project.clips = [
      makeClip({ trackId: project.tracks[0].id, mediaId: null, name: "A", start: 0, duration: 3, sourceDuration: 3 }),
    ];
    project.duration = 3;
    const text = JSON.stringify(toProjectFile(project));
    const parsed = parseProjectFile(text);
    expect(parsed.name).toBe("Round trip");
    expect(parsed.clips).toHaveLength(1);
    expect(parsed.duration).toBe(3);
  });

  it("rejects files that are not SafeCut projects", () => {
    expect(() => parseProjectFile(JSON.stringify({ format: "something-else" }))).toThrow();
  });

  it("fills in missing fields when normalising old projects", () => {
    const project = normaliseProject({ name: "Old", clips: [{ id: "x", trackId: "t", start: 0, duration: 2, name: "c" }] });
    expect(project.clips[0].color.brightness).toBe(1);
    expect(project.clips[0].audio.volume).toBe(1);
    expect(project.tracks.length).toBeGreaterThan(0);
    expect(project.duration).toBe(2);
  });

  it("drops runtime object URLs on save", () => {
    const project = createProject();
    project.assets = [
      {
        id: "a",
        name: "x.mp4",
        kind: "video",
        mimeType: "video/mp4",
        size: 1,
        duration: 2,
        width: 1,
        height: 1,
        url: "blob:abc",
        createdAt: 0,
      },
    ];
    const file = toProjectFile(project);
    expect(file.project.assets[0].url).toBeUndefined();
  });
});
