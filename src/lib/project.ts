import { DEFAULT_AUDIO, DEFAULT_COLOR, DEFAULT_TEXT, DEFAULT_TRANSFORM } from "@/types";
import type { Clip, Project } from "@/types";
import { createProject } from "@/lib/timeline";
import { uid } from "@/lib/utils";

export const PROJECT_VERSION = 1;

export interface ProjectFile {
  format: "safecut-project";
  version: number;
  exportedAt: number;
  project: Project;
}

/** Normalise a parsed project, filling in any fields a newer/older file lacks. */
export function normaliseProject(raw: unknown): Project {
  const p = (raw ?? {}) as Partial<Project> & { project?: Project };
  const source = p.project && (p.project as Project).clips ? (p.project as Project) : p;
  const base = createProject(source.name ?? "Untitled project");
  const project: Project = {
    ...base,
    ...source,
    id: source.id ?? base.id,
    settings: { ...base.settings, ...(source.settings ?? {}) },
    assets: (source.assets ?? []).map((a) => ({ ...a, url: undefined })),
    tracks:
      source.tracks && source.tracks.length > 0
        ? source.tracks.map((t) => ({ ...t, volume: t.volume ?? 1 }))
        : base.tracks,
    clips: (source.clips ?? []).map((c) => ({
      ...c,
      color: { ...DEFAULT_COLOR, ...(c.color ?? {}) },
      transform: { ...DEFAULT_TRANSFORM, ...(c.transform ?? {}) },
      audio: {
        ...DEFAULT_AUDIO,
        ...(c.audio ?? {}),
        eq: { ...DEFAULT_AUDIO.eq, ...(c.audio?.eq ?? {}) },
      },
      text: c.text ? { ...DEFAULT_TEXT, ...c.text } : undefined,
      keyframes: c.keyframes ?? [],
    })),
    duration: 0,
    updatedAt: Date.now(),
  };
  project.duration = project.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  return project;
}

export function toProjectFile(project: Project): ProjectFile {
  return {
    format: "safecut-project",
    version: PROJECT_VERSION,
    exportedAt: Date.now(),
    project: {
      ...project,
      assets: project.assets.map((a) => ({ ...a, url: undefined })),
      aiLastTranscript: undefined,
    },
  };
}

export function projectFileName(project: Project): string {
  const safe = project.name.trim().replace(/[^a-z0-9-_ ]/gi, "").replace(/\s+/g, "-");
  return `${safe || "safecut-project"}.safecut.json`;
}

export function parseProjectFile(text: string): Project {
  const data = JSON.parse(text);
  if (!data || (data.format && data.format !== "safecut-project")) {
    throw new Error("This file is not a SafeCut project.");
  }
  return normaliseProject(data);
}

/** A small, non-empty demo project so a first-time user sees the editor working. */
export function demoProject(): Project {
  const project = createProject("Welcome to SafeCut");
  const videoTrack = project.tracks.find((t) => t.kind === "video")!;
  const textTrack = project.tracks.find((t) => t.kind === "text")!;

  const intro: Clip = {
    id: uid("clp"),
    trackId: videoTrack.id,
    mediaId: null,
    name: "Title card",
    start: 0,
    duration: 3,
    inPoint: 0,
    sourceDuration: 3,
    speed: 1,
    reversed: false,
    color: { ...DEFAULT_COLOR },
    filter: "none",
    transform: { ...DEFAULT_TRANSFORM },
    audio: { ...DEFAULT_AUDIO, eq: { ...DEFAULT_AUDIO.eq } },
    transitionIn: "fade",
    transitionOut: "fade",
    transitionDuration: 0.6,
    keyframes: [],
  };

  const title: Clip = {
    ...intro,
    id: uid("clp"),
    trackId: textTrack.id,
    name: "Title",
    duration: 3,
    sourceDuration: 3,
    text: { ...DEFAULT_TEXT, content: "Welcome to SafeCut", animation: "pop" },
  };

  project.clips = [intro, title];
  project.duration = 3;
  return project;
}
