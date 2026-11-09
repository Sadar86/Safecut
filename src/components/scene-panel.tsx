"use client";

import { useState } from "react";
import { Film, Loader2, Scissors, Sparkles } from "lucide-react";
import { useEditor } from "@/stores/editor";
import { useAnalysis } from "@/stores/analysis";
import { Button, Slider, toast } from "@/components/ui";
import { sampleVideoForScenes } from "@/components/preview-renderer";
import { detectCuts, mergeCuts } from "@/lib/scene-math";
import { splitClipAtScenes } from "@/stores/analysis";
import { formatTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * Scene detection: samples the selected video, scores colour-histogram changes,
 * shows thumbnails for every detected scene and splits the clip at the cuts.
 */
export function ScenePanel() {
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.selectedClipIds);
  const commit = useEditor((s) => s.commit);
  const select = useEditor((s) => s.select);
  const scenes = useAnalysis((s) => s.scenes);
  const setScenes = useAnalysis((s) => s.setScenes);
  const busy = useAnalysis((s) => s.sceneBusy);
  const setBusy = useAnalysis((s) => s.setSceneBusy);
  const progress = useAnalysis((s) => s.sceneProgress);
  const setProgress = useAnalysis((s) => s.setSceneProgress);
  const [threshold, setThreshold] = useState(0.35);

  const clip = project.clips.find((c) => c.id === selected[0]);
  const asset = project.assets.find((a) => a.id === clip?.mediaId);

  const analyze = async () => {
    if (!clip || !asset?.url || asset.kind !== "video") {
      return toast("Select a video clip on the timeline first", "error");
    }
    setBusy(true);
    setProgress(0);
    setScenes(null);
    try {
      const { samples } = await sampleVideoForScenes(asset.url, {
        interval: 0.5,
        maxSamples: 240,
        onProgress: setProgress,
      });
      const cuts = mergeCuts(detectCuts(samples, threshold), 0.4);
      const blackFrames = samples.filter((s) => s.luma < 0.08).map((s) => ({ time: s.time }));
      const thumbnails = new Map(samples.map((s) => [Math.round(s.time * 10), s.thumbnail]));
      const withThumbs = cuts.map((cut) => {
        const key = Math.round(cut.time * 10);
        const nearest =
          thumbnails.get(key) ??
          thumbnails.get(key + 1) ??
          thumbnails.get(key - 1) ??
          samples[Math.min(samples.length - 1, Math.round(cut.time / 0.5))]?.thumbnail;
        return { ...cut, thumbnail: nearest };
      });
      setScenes({
        assetId: asset.id,
        clipId: clip.id,
        cuts: withThumbs,
        blackFrames,
        createdAt: Date.now(),
      });
      toast(`${withThumbs.length} scene changes detected`, "success");
    } catch (err) {
      toast((err as Error).message || "Scene detection failed", "error");
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  const splitAtCuts = () => {
    if (!scenes || scenes.cuts.length === 0) return toast("Run detection first", "error");
    const target = project.clips.find((c) => c.id === scenes.clipId);
    if (!target) return toast("The detected clip is no longer on the timeline", "error");
    const { clips, applied } = splitClipAtScenes(project, target.id, scenes.cuts.map((c) => c.time));
    if (applied === 0) return toast("No cuts fell inside the clip", "info");
    commit(clips, "Split at scenes");
    toast(`${applied} cuts applied`, "success");
  };

  return (
    <div className="pb-4">
      <div className="px-2 pt-2">
        <Button variant="primary" size="sm" className="w-full justify-center" onClick={() => void analyze()} disabled={busy}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {busy ? `Analysing ${Math.round(progress * 100)}%` : "Detect scenes"}
        </Button>
        {busy && (
          <div className="mt-2 h-1 overflow-hidden rounded bg-surface-3">
            <div className="h-full bg-brand transition-all" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>

      <div className="px-3 pt-3">
        <Slider
          label="Cut sensitivity"
          value={threshold}
          min={0.1}
          max={0.8}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={setThreshold}
        />
        <p className="mt-1 text-[10px] leading-relaxed text-muted">
          Lower values detect subtler changes. Detection samples the video twice a second and compares
          colour histograms, so camera pans do not create false cuts.
        </p>
      </div>

      {scenes && (
        <>
          <div className="mt-3 flex items-center gap-1 px-2">
            <span className="text-[11px] font-medium">{scenes.cuts.length} scenes</span>
            {scenes.blackFrames.length > 0 && (
              <span className="rounded bg-surface-3 px-1 text-[10px] text-muted">
                {scenes.blackFrames.length} black frames
              </span>
            )}
            <div className="flex-1" />
            <Button size="sm" variant="secondary" onClick={splitAtCuts}>
              <Scissors size={11} /> Split clip
            </Button>
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-1.5 px-2">
            {scenes.cuts.map((cut, i) => (
              <li key={`${cut.time}-${i}`}>
                <button
                  onClick={() => select([scenes.clipId])}
                  className={cn("w-full overflow-hidden rounded border border-border-subtle hover:border-brand/60")}
                  title={`Scene at ${formatTime(cut.time)} · score ${cut.score.toFixed(2)}`}
                >
                  {cut.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cut.thumbnail} alt="" className="h-12 w-full object-cover" />
                  ) : (
                    <div className="flex h-12 items-center justify-center bg-surface-3">
                      <Film size={14} />
                    </div>
                  )}
                  <span className="block bg-surface px-1 py-0.5 text-left font-mono text-[9px]">
                    {formatTime(cut.time)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {scenes.cuts.length === 0 && (
            <p className="px-3 pt-2 text-[11px] text-muted">
              No cuts found. Try lowering the sensitivity.
            </p>
          )}
        </>
      )}
    </div>
  );
}
