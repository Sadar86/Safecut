"use client";

import { create } from "zustand";
import type { Clip, MediaAsset, Project, Track } from "@/types";
import { createProject } from "@/lib/timeline";
import { demoProject } from "@/lib/project";
import { uid } from "@/lib/utils";
import { listProjects, loadProject, saveProject, deleteProject, markDirty } from "@/lib/storage";

export type Panel =
  | "media"
  | "text"
  | "effects"
  | "filters"
  | "audio"
  | "captions"
  | "scenes"
  | "templates"
  | "ai";

export interface HistoryEntry {
  clips: Clip[];
  label: string;
}

export interface EditorState {
  project: Project;
  selectedClipIds: string[];
  playhead: number;
  playing: boolean;
  zoom: number;
  snapEnabled: boolean;
  activePanel: Panel;
  saveState: "idle" | "saving" | "saved" | "error";
  lastSavedAt: number | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Saved projects listed on the dashboard. */
  projectList: { id: string; name: string; updatedAt: number; duration: number }[];
  ready: boolean;
  /** Seconds until the next auto-save; shown in the top bar. */
  autosaveIn: number;
  /** Set when the previous session ended without a clean save. */
  recovered: boolean;

  /* lifecycle */
  boot: () => Promise<void>;
  newProject: () => void;
  openProject: (id: string) => Promise<boolean>;
  saveNow: () => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  renameProject: (name: string) => void;

  /* media */
  addAssets: (assets: MediaAsset[]) => void;
  removeAsset: (id: string) => void;

  /* selection & transport */
  select: (ids: string[]) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  setZoom: (zoom: number) => void;
  toggleSnap: () => void;
  setPanel: (panel: Panel) => void;

  /* editing */
  commit: (next: Clip[], label: string) => void;
  undo: () => void;
  redo: () => void;
  updateTrack: (trackId: string, patch: Partial<Track>) => void;
  addTrack: (kind: Track["kind"]) => void;
  clearRecovered: () => void;
  selectAll: () => void;
  setAutosaveIn: (seconds: number) => void;
  setRecovered: (recovered: boolean) => void;
}

const HISTORY_LIMIT = 80;

function withDuration(project: Project, clips: Clip[]): Project {
  return {
    ...project,
    clips,
    duration: clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0),
    updatedAt: Date.now(),
  };
}

export const useEditor = create<EditorState>((set, get) => ({
  project: createProject(),
  selectedClipIds: [],
  playhead: 0,
  playing: false,
  zoom: 60,
  snapEnabled: true,
  activePanel: "media",
  saveState: "idle",
  lastSavedAt: null,
  past: [],
  future: [],
  projectList: [],
  ready: false,
  autosaveIn: 10,
  recovered: false,

  boot: async () => {
    const list = await listProjects();
    if (list.length === 0) {
      const demo = demoProject();
      await saveProject(demo);
      set({
        project: demo,
        projectList: await listProjects(),
        ready: true,
        saveState: "saved",
        lastSavedAt: Date.now(),
      });
      return;
    }
    const latest = await loadProject(list[0].id);
    // Recovery: if the tab closed mid-edit, the dirty flag survives a reload.
    let recovered = false;
    try {
      recovered = localStorage.getItem("safecut.dirty") === "1";
    } catch {
      recovered = false;
    }
    set({
      project: latest ?? demoProject(),
      projectList: list,
      ready: true,
      saveState: recovered ? "idle" : "saved",
      lastSavedAt: list[0].updatedAt,
      recovered,
    });
  },

  clearRecovered: () => set({ recovered: false }),

  newProject: () => {
    const project = createProject(`Project ${new Date().toLocaleDateString()}`);
    set({
      project,
      selectedClipIds: [],
      playhead: 0,
      playing: false,
      past: [],
      future: [],
      saveState: "idle",
    });
    void get().saveNow();
  },

  openProject: async (id) => {
    const project = await loadProject(id);
    if (!project) return false;
    set({
      project,
      selectedClipIds: [],
      playhead: 0,
      playing: false,
      past: [],
      future: [],
      saveState: "saved",
      lastSavedAt: project.updatedAt,
    });
    return true;
  },

  saveNow: async () => {
    const { project } = get();
    set({ saveState: "saving" });
    try {
      await saveProject(project);
      set({
        saveState: "saved",
        lastSavedAt: Date.now(),
        projectList: await listProjects(),
      });
    } catch {
      set({ saveState: "error" });
    }
  },

  removeProject: async (id) => {
    await deleteProject(id);
    const list = await listProjects();
    set({ projectList: list });
    if (get().project.id === id) {
      if (list.length > 0) await get().openProject(list[0].id);
      else get().newProject();
    }
  },

  renameProject: (name) => {
    set({ project: { ...get().project, name, updatedAt: Date.now() }, saveState: "idle" });
  },

  addAssets: (assets) => {
    set({
      project: {
        ...get().project,
        assets: [...get().project.assets, ...assets],
        updatedAt: Date.now(),
      },
      saveState: "idle",
    });
  },

  removeAsset: (id) => {
    const { project } = get();
    set({
      project: withDuration(
        { ...project, assets: project.assets.filter((a) => a.id !== id) },
        project.clips.filter((c) => c.mediaId !== id),
      ),
      saveState: "idle",
    });
  },

  select: (ids) => set({ selectedClipIds: ids }),
  setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
  setPlaying: (playing) => set({ playing }),
  togglePlaying: () => set({ playing: !get().playing }),
  setZoom: (zoom) => set({ zoom }),
  toggleSnap: () => set({ snapEnabled: !get().snapEnabled }),
  setPanel: (activePanel) => set({ activePanel }),

  commit: (next, label) => {
    const { project, past } = get();
    const history = [...past, { clips: project.clips, label }].slice(-HISTORY_LIMIT);
    set({
      project: withDuration(project, next),
      past: history,
      future: [],
      saveState: "idle",
    });
    markDirty(true);
    scheduleSave();
  },

  undo: () => {
    const { past, future, project } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    set({
      project: withDuration(project, prev.clips),
      past: past.slice(0, -1),
      future: [{ clips: project.clips, label: prev.label }, ...future].slice(0, HISTORY_LIMIT),
      saveState: "idle",
    });
    scheduleSave();
  },

  redo: () => {
    const { past, future, project } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      project: withDuration(project, next.clips),
      past: [...past, { clips: project.clips, label: next.label }].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      saveState: "idle",
    });
    scheduleSave();
  },

  selectAll: () => set({ selectedClipIds: get().project.clips.map((c) => c.id) }),
  setAutosaveIn: (autosaveIn) => set({ autosaveIn }),
  setRecovered: (recovered) => set({ recovered }),

  updateTrack: (trackId, patch) => {
    const { project } = get();
    set({
      project: {
        ...project,
        tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)),
        updatedAt: Date.now(),
      },
      saveState: "idle",
    });
    scheduleSave();
  },

  addTrack: (kind) => {
    const { project } = get();
    const count = project.tracks.filter((t) => t.kind === kind).length + 1;
    const label = { video: "Video", audio: "Audio", text: "Text", overlay: "Overlay" }[kind];
    const track: Track = {
      id: uid("trk"),
      kind,
      name: `${label} ${count}`,
      muted: false,
      locked: false,
      hidden: false,
      volume: 1,
      index: project.tracks.length,
    };
    set({
      project: { ...project, tracks: [...project.tracks, track], updatedAt: Date.now() },
      saveState: "idle",
    });
    scheduleSave();
  },
}));

/* -------------------------------------------------------------------------- */
/*  Debounced auto-save                                                       */
/* -------------------------------------------------------------------------- */

let saveTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Periodic auto-save (every 10s while dirty). A tick also drives the
 * "auto-save in Ns" indicator in the top bar.
 */
export function startAutosave(intervalSeconds = 10) {
  if (typeof window === "undefined") return () => undefined;
  if (saveTimer) clearInterval(saveTimer);
  let remaining = intervalSeconds;
  saveTimer = setInterval(() => {
    remaining -= 1;
    useEditor.getState().setAutosaveIn(Math.max(0, remaining));
    if (remaining > 0) return;
    remaining = intervalSeconds;
    const state = useEditor.getState();
    if (state.saveState === "idle" || state.saveState === "error") void state.saveNow();
  }, 1000);
  return () => {
    if (saveTimer) clearInterval(saveTimer);
    saveTimer = null;
  };
}

/** Kept for callers that want an immediate debounced save. */
export function scheduleSave(delay = 900) {
  if (typeof window === "undefined") return;
  markDirty(true);
  setTimeout(() => {
    const state = useEditor.getState();
    if (state.saveState === "idle") void state.saveNow();
  }, delay);
}

export function flushSave() {
  return useEditor.getState().saveNow();
}
