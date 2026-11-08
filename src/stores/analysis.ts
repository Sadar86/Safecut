"use client";

import { create } from "zustand";
import type { Project } from "@/types";
import { splitClip } from "@/lib/timeline";
import { getWaveform, peekWaveform, type WaveformData } from "@/lib/audio";
import { loadWaveform, saveWaveform } from "@/lib/storage";

/**
 * Derived, non-persisted editor data: waveform peaks per asset and the result of
 * the last scene-detection pass. Kept out of the project file so saves stay small.
 */

export interface SceneResult {
  assetId: string;
  clipId: string;
  cuts: { time: number; score: number; thumbnail?: string }[];
  blackFrames: { time: number }[];
  createdAt: number;
}

interface AnalysisState {
  waveforms: Record<string, WaveformData>;
  analyzing: Record<string, boolean>;
  scenes: SceneResult | null;
  sceneBusy: boolean;
  sceneProgress: number;
  ensureWaveform: (assetId: string) => void;
  setWaveform: (assetId: string, data: WaveformData) => void;
  setScenes: (result: SceneResult | null) => void;
  setSceneBusy: (busy: boolean) => void;
  setSceneProgress: (progress: number) => void;
}

export const useAnalysis = create<AnalysisState>((set, get) => ({
  waveforms: {},
  analyzing: {},
  scenes: null,
  sceneBusy: false,
  sceneProgress: 0,
  ensureWaveform: (assetId) => {
    const cached = peekWaveform(assetId);
    if (cached) {
      set((s) => ({ waveforms: { ...s.waveforms, [assetId]: cached } }));
      return;
    }
    if (get().analyzing[assetId]) return;
    set((s) => ({ analyzing: { ...s.analyzing, [assetId]: true } }));
    void loadWaveform<WaveformData>(assetId)
      .then((stored) => {
        if (stored) {
          set((s) => ({ waveforms: { ...s.waveforms, [assetId]: stored } }));
          return null;
        }
        return getWaveform(assetId, 1200);
      })
      .then((data) => {
        if (!data) return;
        set((s) => ({ waveforms: { ...s.waveforms, [assetId]: data } }));
        void saveWaveform(assetId, data);
      })
      .finally(() => set((s) => ({ analyzing: { ...s.analyzing, [assetId]: false } })));
  },
  setWaveform: (assetId, data) => set((s) => ({ waveforms: { ...s.waveforms, [assetId]: data } })),
  setScenes: (scenes) => set({ scenes }),
  setSceneBusy: (sceneBusy) => set({ sceneBusy }),
  setSceneProgress: (sceneProgress) => set({ sceneProgress }),
}));

/**
 * Split a video clip at every detected scene boundary that falls inside it.
 * Returns the new clip array plus how many cuts were applied.
 */
export function splitClipAtScenes(
  project: Project,
  clipId: string,
  cutTimes: number[],
): { clips: Project["clips"]; applied: number } {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return { clips: project.clips, applied: 0 };
  const inside = [...new Set(cutTimes)]
    .map((t) => Math.round(t * 1000) / 1000)
    .filter((t) => t > clip.start + 0.05 && t < clip.start + clip.duration - 0.05)
    .sort((a, b) => a - b);
  let clips = project.clips;
  let applied = 0;
  for (const t of inside) {
    const before = clips.length;
    // After the first split the right-hand piece keeps a new id; split whichever
    // clip currently covers time t on this track.
    const covering = clips.find(
      (c) => c.trackId === clip.trackId && t > c.start + 0.05 && t < c.start + c.duration - 0.05 && c.mediaId === clip.mediaId,
    );
    if (!covering) continue;
    clips = splitClip(clips, covering.id, t);
    if (clips.length > before) applied++;
  }
  return { clips, applied };
}
