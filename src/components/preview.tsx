"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, ZoomIn, ZoomOut } from "lucide-react";
import { useEditor } from "@/stores/editor";
import { applyVoiceChain, useCanvasRenderer } from "@/components/preview-renderer";
import { Button } from "@/components/ui";
import { formatTime } from "@/lib/utils";
import { evaluateKeyframes } from "@/lib/timeline";

/**
 * Live preview.
 *
 * Draws through the shared canvas renderer (so exports match), and keeps every
 * audible media element in sync with the playhead. Media is muted only when the
 * user mutes; otherwise the currently visible clips play their own audio.
 */
export function Preview() {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const setPlaying = useEditor((s) => s.setPlaying);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { draw } = useCanvasRenderer(canvasRef);
  const audioRefs = useRef<Map<string, HTMLMediaElement>>(new Map());
  const [muted, setMuted] = useState(false);
  const [zoomFit, setZoomFit] = useState(100);
  const rafRef = useRef<number | null>(null);
  const startedAt = useRef({ wall: 0, time: 0 });
  const playheadRef = useRef(playhead);
  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);

  const { width, height, fps } = project.settings;
  const assets = project.assets;

  // A coarse tick keeps audio volume/fades in sync without re-rendering the
  // whole preview on every animation frame.
  const tick = Math.floor(playhead * 20);
  const activeAudio = useMemo(
    () =>
      project.clips.filter((c) => {
        const track = project.tracks.find((t) => t.id === c.trackId);
        const asset = assets.find((a) => a.id === c.mediaId);
        return (
          asset &&
          asset.kind !== "image" &&
          track &&
          !track.muted &&
          !c.audio.muted &&
          playhead >= c.start &&
          playhead < c.start + c.duration
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.clips, project.tracks, assets, tick],
  );

  /* ------------------------------ drawing loop ----------------------------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;

    const render = () => {
      let t = playheadRef.current;
      if (playing) {
        t = startedAt.current.time + (performance.now() - startedAt.current.wall) / 1000;
        if (t >= project.duration) {
          setPlayhead(project.duration);
          setPlaying(false);
          draw({ width, height, time: project.duration, fps }, project, assets);
          return;
        }
        playheadRef.current = t;
        setPlayhead(t);
      }
      draw({ width, height, time: t, fps }, project, assets);
      if (playing) rafRef.current = requestAnimationFrame(render);
    };

    if (playing) startedAt.current = { wall: performance.now(), time: playheadRef.current };
    render();
    if (playing) rafRef.current = requestAnimationFrame(render);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, project, assets, width, height, fps, draw]);

  /* ---------------------------- audio sync loop ---------------------------- */
  useEffect(() => {
    const wanted = new Set(activeAudio.map((c) => c.id));

    // Stop audio for clips that are no longer active
    for (const [id, el] of audioRefs.current) {
      if (!wanted.has(id)) {
        el.pause();
        audioRefs.current.delete(id);
        el.remove();
      }
    }

    for (const clip of activeAudio) {
      const asset = assets.find((a) => a.id === clip.mediaId);
      if (!asset?.url) continue;
      let el = audioRefs.current.get(clip.id);
      if (!el) {
        el = document.createElement("audio");
        (el as HTMLAudioElement).src = asset.url;
        el.preload = "auto";
        audioRefs.current.set(clip.id, el);
      }
      const track = project.tracks.find((t) => t.id === clip.trackId);
      const volumeKf = evaluateKeyframes(clip.keyframes, "volume", playhead - clip.start, clip.audio.volume);
      const fadeIn = clip.audio.fadeIn;
      const fadeOut = clip.audio.fadeOut;
      const local = playhead - clip.start;
      const fadeInGain = fadeIn > 0 ? Math.min(1, local / fadeIn) : 1;
      const fadeOutGain = fadeOut > 0 ? Math.min(1, (clip.duration - local) / fadeOut) : 1;
      el.volume = Math.max(
        0,
        Math.min(1, volumeKf * fadeInGain * fadeOutGain * (track?.volume ?? 1) * (muted ? 0 : 1)),
      );
      // Non-destructive voice enhancement (nodes are reused per element).
      applyVoiceChain(el, clip);
      const target = clip.inPoint + local * clip.speed;
      if (Math.abs(el.currentTime - target) > 0.25) el.currentTime = target;
      if (playing && el.paused) void el.play().catch(() => undefined);
      if (!playing && !el.paused) el.pause();
    }
    // Audio is deliberately synced on a coarse tick: re-running on every frame
    // would restart media elements 30-60 times a second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, activeAudio, muted, tick]);

  useEffect(() => {
    const refs = audioRefs.current;
    return () => {
      for (const el of refs.values()) {
        el.pause();
        el.remove();
      }
      refs.clear();
    };
  }, []);

  /* -------------------------------- controls ------------------------------- */
  const step = (dir: 1 | -1) => {
    setPlaying(false);
    setPlayhead(Math.max(0, Math.min(project.duration, playhead + dir / fps)));
  };

  const seek = (t: number) => {
    setPlaying(false);
    setPlayhead(Math.max(0, Math.min(project.duration, t)));
  };

  const ratio = width / height;
  const previewStyle = {
    aspectRatio: `${width} / ${height}`,
    maxHeight: `${zoomFit}%`,
    maxWidth: "100%",
  } as React.CSSProperties;

  return (
    <section
      className="flex min-h-0 flex-1 flex-col bg-surface"
      aria-label="Video preview"
      data-testid="preview"
    >
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">
        <div className="relative flex h-full w-full items-center justify-center">
          <div
            className="relative overflow-hidden rounded-md bg-black shadow-lg ring-1 ring-white/5"
            style={previewStyle}
          >
            <canvas
              ref={canvasRef}
              className="block h-full w-full"
              style={{ aspectRatio: `${width} / ${height}` }}
              aria-label="Preview canvas"
              data-testid="preview-canvas"
            />
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-t border-border-subtle bg-surface-2 px-3 py-1.5">
        <span className="w-24 shrink-0 font-mono text-[11px] tabular-nums text-muted">
          {formatTime(playhead, true, fps)} / {formatTime(project.duration, true, fps)}
        </span>

        <div className="flex flex-1 items-center justify-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => seek(0)} aria-label="Go to start" title="Start (Home)">
            <SkipBack size={15} />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => step(-1)} aria-label="Previous frame" title="Previous frame (←)">
            <SkipBack size={15} className="opacity-60" />
          </Button>
          <Button
            size="icon"
            variant="primary"
            onClick={() => {
              if (playhead >= project.duration) seek(0);
              setPlaying(!playing);
            }}
            aria-label={playing ? "Pause" : "Play"}
            title="Play / pause (Space)"
            className="h-9 w-9"
          >
            {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
          </Button>
          <Button size="icon" variant="ghost" onClick={() => step(1)} aria-label="Next frame" title="Next frame (→)">
            <SkipForward size={15} className="opacity-60" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => seek(project.duration)}
            aria-label="Go to end"
            title="End (End)"
          >
            <SkipForward size={15} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setMuted(!muted)}
            aria-label={muted ? "Unmute preview" : "Mute preview"}
            title="Mute preview"
          >
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </Button>
        </div>

        <div className="flex w-24 shrink-0 items-center justify-end gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setZoomFit((z) => Math.max(50, z - 10))}
            aria-label="Zoom out preview"
            title="Zoom out"
          >
            <ZoomOut size={14} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setZoomFit((z) => Math.min(100, z + 10))}
            aria-label="Zoom in preview"
            title="Zoom in"
          >
            <ZoomIn size={14} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setZoomFit(100)}
            aria-label="Fit preview"
            title="Fit"
          >
            <Maximize2 size={14} />
          </Button>
        </div>
      </div>

      <input
        type="range"
        className="mx-3 mb-2 w-[calc(100%-1.5rem)]"
        min={0}
        max={Math.max(project.duration, 0.1)}
        step={1 / fps}
        value={Math.min(playhead, project.duration)}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="Seek"
      />
      <span className="sr-only">{ratio}</span>
    </section>
  );
}
