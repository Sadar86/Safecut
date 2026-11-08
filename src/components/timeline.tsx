"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Copy,
  Film,
  Music,
  Plus,
  Scissors,
  Magnet,
  Undo2,
  Redo2,
  Trash2,
  Volume2,
  VolumeX,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ZoomIn,
  ZoomOut,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useEditor } from "@/stores/editor";
import { Button, toast } from "@/components/ui";
import { cn, clamp, formatTime, uid } from "@/lib/utils";
import {
  clipEnd,
  deleteClips,
  duplicateClip,
  findGap,
  makeClip,
  moveClip,
  overlaps,
  patchClip,
  splitClip,
} from "@/lib/timeline";
import type { Clip, Track, TrackKind } from "@/types";
import { DEFAULT_TEXT } from "@/types";
import { Waveform } from "@/components/waveform";

const TRACK_HEIGHT: Record<TrackKind, number> = {
  video: 56,
  overlay: 44,
  text: 34,
  audio: 40,
};

const TRACK_COLOR: Record<TrackKind, string> = {
  video: "var(--track-video)",
  overlay: "var(--track-overlay)",
  text: "var(--track-text)",
  audio: "var(--track-audio)",
};

const SNAP_PX = 8;

export function Timeline() {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const setPlaying = useEditor((s) => s.setPlaying);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const selected = useEditor((s) => s.selectedClipIds);
  const select = useEditor((s) => s.select);
  const commit = useEditor((s) => s.commit);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const toggleSnap = useEditor((s) => s.toggleSnap);
  const updateTrack = useEditor((s) => s.updateTrack);
  const addTrack = useEditor((s) => s.addTrack);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{
    clipId: string;
    mode: "move" | "trim-start" | "trim-end";
    startX: number;
    origStart: number;
    origDuration: number;
    origIn: number;
    trackId: string;
  } | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [snapGuide, setSnapGuide] = useState<number | null>(null);

  const pxPerSec = zoom;
  const duration = Math.max(project.duration, 10);
  const contentWidth = Math.max(duration * pxPerSec + 200, 600);

  const tracks = [...project.tracks].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const assetById = new Map(project.assets.map((a) => [a.id, a]));

  /* ------------------------------- snapping ------------------------------- */
  const snapPoints = useCallback(() => {
    const points = [0, playhead, project.duration];
    for (const c of project.clips) {
      points.push(c.start, clipEnd(c));
    }
    return points;
  }, [project.clips, project.duration, playhead]);

  /**
   * Snap a proposed start time to the nearest edge, the playhead, or zero.
   * Both the clip's head and its tail are tested, which is what makes
   * butt-joining clips feel right.
   */
  const applySnap = useCallback(
    (time: number, ignoreId?: string, duration?: number) => {
      if (!snapEnabled) {
        setSnapGuide(null);
        return time;
      }
      const threshold = SNAP_PX / pxPerSec;
      const points = snapPoints().filter((p) => {
        if (!ignoreId) return true;
        const ignored = project.clips.find((c) => c.id === ignoreId);
        return ignored ? !(Math.abs(p - ignored.start) < 1e-6 || Math.abs(p - clipEnd(ignored)) < 1e-6) : true;
      });
      let best: { time: number; distance: number } | null = null;
      for (const p of points) {
        const dHead = Math.abs(p - time);
        if (dHead < threshold && (!best || dHead < best.distance)) best = { time: p, distance: dHead };
        if (duration !== undefined) {
          const dTail = Math.abs(p - (time + duration));
          if (dTail < threshold && (!best || dTail < best.distance)) best = { time: p - duration, distance: dTail };
        }
      }
      if (!best) {
        setSnapGuide(null);
        return time;
      }
      setSnapGuide(best.time);
      return Math.max(0, best.time);
    },
    [snapEnabled, pxPerSec, snapPoints, project.clips],
  );

  /* ---------------------------- pointer helpers ---------------------------- */
  const timeFromEvent = useCallback(
    (clientX: number) => {
      const rect = scrollRef.current?.getBoundingClientRect();
      const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
      if (!rect) return 0;
      return Math.max(0, (clientX - rect.left + scrollLeft) / pxPerSec);
    },
    [pxPerSec],
  );

  const startDrag = (
    e: React.PointerEvent,
    clip: Clip,
    mode: "move" | "trim-start" | "trim-end",
  ) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    select(e.shiftKey ? [...new Set([...selected, clip.id])] : [clip.id]);
    setDrag({
      clipId: clip.id,
      mode,
      startX: e.clientX,
      origStart: clip.start,
      origDuration: clip.duration,
      origIn: clip.inPoint,
      trackId: clip.trackId,
    });
  };

  useEffect(() => {
    if (!drag) return;
    const clip = project.clips.find((c) => c.id === drag.clipId);
    if (!clip) return;

    const onMove = (e: PointerEvent) => {
      const deltaSec = (e.clientX - drag.startX) / pxPerSec;
      if (drag.mode === "move") {
        let start = Math.max(0, drag.origStart + deltaSec);
        start = applySnap(start, clip.id, clip.duration);
        if (!overlaps(project.clips, clip.trackId, start, clip.duration, [clip.id])) {
          useEditor.setState({
            project: {
              ...useEditor.getState().project,
              clips: moveClip(useEditor.getState().project.clips, clip.id, clip.trackId, start),
            },
          });
        }
      } else if (drag.mode === "trim-start") {
        let start = clamp(drag.origStart + deltaSec, Math.max(0, drag.origStart - drag.origIn / clip.speed), drag.origStart + drag.origDuration - 0.1);
        start = applySnap(start, clip.id);
        const delta = start - drag.origStart;
        useEditor.setState({
          project: {
            ...useEditor.getState().project,
            clips: patchClip(useEditor.getState().project.clips, clip.id, {
              start,
              duration: drag.origDuration - delta,
              inPoint: Math.max(0, drag.origIn + delta * clip.speed),
            }),
          },
        });
      } else {
        let end = Math.max(drag.origStart + 0.1, drag.origStart + drag.origDuration + deltaSec);
        end = applySnap(end, clip.id);
        const maxEnd = clip.sourceDuration > 0 ? drag.origStart + (clip.sourceDuration - drag.origIn) / clip.speed : Infinity;
        end = Math.min(end, maxEnd);
        useEditor.setState({
          project: {
            ...useEditor.getState().project,
            clips: patchClip(useEditor.getState().project.clips, clip.id, { duration: end - drag.origStart }),
          },
        });
      }
    };

    const onUp = () => {
      const final = useEditor.getState().project.clips.find((c) => c.id === drag.clipId);
      if (final) {
        const before = project.clips.find((c) => c.id === drag.clipId);
        if (before && (before.start !== final.start || before.duration !== final.duration || before.inPoint !== final.inPoint)) {
          // Record the pre-drag state in history.
          const past = [...useEditor.getState().past, { clips: project.clips, label: drag.mode }].slice(-80);
          useEditor.setState({ past, future: [] });
        }
      }
      setDrag(null);
      setSnapGuide(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, pxPerSec, applySnap, project.clips]);

  /* ------------------------------ interactions ----------------------------- */
  const onRulerClick = (e: React.MouseEvent) => {
    setPlaying(false);
    setPlayhead(timeFromEvent(e.clientX));
  };

  const onRulerMove = (e: React.MouseEvent) => {
    setHoverTime(timeFromEvent(e.clientX));
  };

  const onDrop = (e: React.DragEvent, track: Track) => {
    e.preventDefault();
    const assetId = e.dataTransfer.getData("application/x-safecut-asset");
    const newText = e.dataTransfer.getData("application/x-safecut-text");
    const start = applySnap(timeFromEvent(e.clientX));
    const clips = useEditor.getState().project.clips;

    if (newText) {
      const clip = makeClip({
        trackId: track.id,
        mediaId: null,
        name: "Text",
        start: findGap(clips, track.id, 3, start),
        duration: 3,
        sourceDuration: 3,
      });
      clip.text = { ...DEFAULT_TEXT };
      commit([...clips, clip], "Add text");
      select([clip.id]);
      return;
    }
    if (!assetId) return;
    const asset = useEditor.getState().project.assets.find((a) => a.id === assetId);
    if (!asset) return;
    const isAudio = asset.kind === "audio";
    if (isAudio && track.kind !== "audio") {
      toast("Drop audio on an audio track", "error");
      return;
    }
    if (!isAudio && track.kind === "audio") {
      toast("Drop video or images on a video track", "error");
      return;
    }
    const dur = asset.kind === "image" ? 5 : asset.duration || 5;
    const startPos = findGap(clips, track.id, dur, start);
    const clip = makeClip({
      trackId: track.id,
      mediaId: asset.id,
      name: asset.name,
      start: startPos,
      duration: dur,
      sourceDuration: asset.duration || dur,
    });
    commit([...clips, clip], "Add clip");
    select([clip.id]);
  };

  const onDropTrack = (e: React.DragEvent, track: Track, clipId?: string) => {
    if (!clipId) return onDrop(e, track);
    e.preventDefault();
    e.stopPropagation();
    const clips = useEditor.getState().project.clips;
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;
    if (track.locked) return toast("Track is locked", "error");
    const start = applySnap(timeFromEvent(e.clientX), clip.id, clip.duration);
    if (overlaps(clips, track.id, start, clip.duration, [clip.id])) {
      return toast("That spot is occupied", "error");
    }
    commit(moveClip(clips, clip.id, track.id, start), "Move clip");
  };

  /* ------------------------------- shortcuts ------------------------------- */
  const selectedClip = project.clips.find((c) => c.id === selected[0]);

  const doSplit = () => {
    if (!selectedClip) return toast("Select a clip first", "error");
    const next = splitClip(project.clips, selectedClip.id, playhead);
    if (next.length === project.clips.length) return toast("Move the playhead over the clip to split", "error");
    commit(next, "Split");
    toast("Clip split", "success");
  };

  const doDelete = () => {
    if (selected.length === 0) return;
    commit(deleteClips(project.clips, selected), "Delete");
    select([]);
  };

  const doDuplicate = () => {
    if (!selectedClip) return;
    commit(duplicateClip(project.clips, selectedClip.id), "Duplicate");
  };

  /* -------------------------------- markers -------------------------------- */
  const ticks = [];
  const tickStep = pxPerSec >= 120 ? 0.5 : pxPerSec >= 60 ? 1 : pxPerSec >= 25 ? 5 : 10;
  for (let t = 0; t <= duration + 1; t += tickStep) {
    ticks.push(t);
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface-2" aria-label="Timeline">
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-y border-border-subtle bg-surface-2 px-2">
        <Button size="icon" variant="ghost" onClick={doSplit} aria-label="Split clip at playhead" title="Split (S)">
          <Scissors size={15} />
        </Button>
        <Button size="icon" variant="ghost" onClick={doDelete} aria-label="Delete selected clips" title="Delete (Del)">
          <Trash2 size={15} />
        </Button>
        <Button size="icon" variant="ghost" onClick={doDuplicate} aria-label="Duplicate clip" title="Duplicate (Ctrl+D)">
          <Copy size={15} />
        </Button>
        <div className="mx-1 h-5 w-px bg-border-subtle" />
        <Button size="icon" variant="ghost" onClick={undo} aria-label="Undo" title="Undo (Ctrl+Z)">
          <Undo2 size={15} />
        </Button>
        <Button size="icon" variant="ghost" onClick={redo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
          <Redo2 size={15} />
        </Button>
        <div className="mx-1 h-5 w-px bg-border-subtle" />
        <Button
          size="sm"
          variant={snapEnabled ? "primary" : "ghost"}
          onClick={toggleSnap}
          aria-pressed={snapEnabled}
          title="Toggle snapping"
        >
          <Magnet size={14} /> Snap
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const track = tracks.find((t) => t.kind === "video");
            if (!track) return;
            const clips = useEditor.getState().project.clips;
            const clip = makeClip({
              trackId: track.id,
              mediaId: null,
              name: "Colour clip",
              start: findGap(clips, track.id, 3, playhead),
              duration: 3,
              sourceDuration: 3,
            });
            commit([...clips, clip], "Add colour clip");
            select([clip.id]);
          }}
          title="Add a solid colour clip at the playhead"
        >
          <Plus size={14} /> Clip
        </Button>
        <div className="mx-1 h-5 w-px bg-border-subtle" />
        <Button
          size="icon"
          variant="ghost"
          onClick={() => {
            setPlaying(false);
            setPlayhead(Math.max(0, playhead - 1 / project.settings.fps));
          }}
          aria-label="Step back one frame"
          title="Previous frame (←)"
        >
          <ChevronLeft size={15} />
        </Button>
        <span className="hidden font-mono text-[10px] text-muted md:inline">
          f{Math.round(playhead * project.settings.fps)}
        </span>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => {
            setPlaying(false);
            setPlayhead(Math.min(project.duration, playhead + 1 / project.settings.fps));
          }}
          aria-label="Step forward one frame"
          title="Next frame (→)"
        >
          <ChevronRight size={15} />
        </Button>
        <div className="flex-1" />
        <span className="mr-1 hidden text-[11px] text-muted sm:block">
          {project.clips.length} clips · {formatTime(project.duration)}
        </span>
        <Button size="icon" variant="ghost" onClick={() => setZoom(Math.max(10, zoom - 10))} aria-label="Zoom out timeline">
          <ZoomOut size={15} />
        </Button>
        <input
          type="range"
          min={10}
          max={200}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-20"
          aria-label="Timeline zoom"
        />
        <Button size="icon" variant="ghost" onClick={() => setZoom(Math.min(200, zoom + 10))} aria-label="Zoom in timeline">
          <ZoomIn size={15} />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Track headers */}
        <div className="w-36 shrink-0 overflow-hidden border-r border-border-subtle bg-surface-2">
          <div className="h-7 border-b border-border-subtle" />
          {tracks.map((track) => (
            <div
              key={track.id}
              className="flex items-center gap-1 border-b border-border-subtle px-2"
              style={{ height: TRACK_HEIGHT[track.kind] }}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: TRACK_COLOR[track.kind] }}
              />
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{track.name}</span>
              {track.kind !== "text" && (
                <button
                  onClick={() => updateTrack(track.id, { muted: !track.muted })}
                  className="text-muted hover:text-content"
                  aria-label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
                  title="Mute track"
                >
                  {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                </button>
              )}
              <button
                onClick={() => updateTrack(track.id, { hidden: !track.hidden })}
                className="text-muted hover:text-content"
                aria-label={track.hidden ? `Show ${track.name}` : `Hide ${track.name}`}
                title="Hide track"
              >
                {track.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
              <button
                onClick={() => updateTrack(track.id, { locked: !track.locked })}
                className="text-muted hover:text-content"
                aria-label={track.locked ? `Unlock ${track.name}` : `Lock ${track.name}`}
                title="Lock track"
              >
                {track.locked ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
            </div>
          ))}
          <div className="flex gap-1 p-1.5">
            {(["video", "audio", "text"] as TrackKind[]).map((kind) => (
              <Button
                key={kind}
                size="sm"
                variant="ghost"
                className="px-1.5 text-[10px]"
                onClick={() => addTrack(kind)}
                title={`Add ${kind} track`}
              >
                + {kind}
              </Button>
            ))}
          </div>
        </div>

        {/* Scrollable track area */}
        <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-auto">
          <div style={{ width: contentWidth }} className="relative">
            {/* Ruler */}
            <div
              ref={rulerRef}
              className="sticky top-0 z-20 h-7 cursor-pointer border-b border-border-subtle bg-surface-3"
              onClick={onRulerClick}
              onMouseMove={onRulerMove}
              onMouseLeave={() => setHoverTime(null)}
              role="slider"
              aria-label="Timeline position"
              aria-valuemin={0}
              aria-valuemax={project.duration}
              aria-valuenow={playhead}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") setPlayhead(playhead + 1 / project.settings.fps);
                if (e.key === "ArrowLeft") setPlayhead(Math.max(0, playhead - 1 / project.settings.fps));
              }}
            >
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 flex h-full flex-col justify-end"
                  style={{ left: t * pxPerSec }}
                >
                  <span className="mb-0.5 ml-1 font-mono text-[10px] text-muted">{formatTime(t)}</span>
                  <div className="h-1.5 w-px bg-border-subtle" />
                </div>
              ))}
              {hoverTime !== null && (
                <div
                  className="pointer-events-none absolute top-0 h-full w-px bg-brand/50"
                  style={{ left: hoverTime * pxPerSec }}
                />
              )}
            </div>

            {/* Tracks */}
            {tracks.map((track) => (
              <div
                key={track.id}
                className={cn(
                  "relative border-b border-border-subtle",
                  track.hidden && "opacity-40",
                )}
                style={{ height: TRACK_HEIGHT[track.kind] }}
                onClick={(e) => {
                  if (e.target === e.currentTarget) {
                    setPlaying(false);
                    setPlayhead(timeFromEvent(e.clientX));
                    select([]);
                  }
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDropTrack(e, track)}
                data-testid={`track-${track.kind}`}
              >
                {project.clips
                  .filter((c) => c.trackId === track.id)
                  .map((clip) => {
                    const asset = clip.mediaId ? assetById.get(clip.mediaId) : undefined;
                    const isSelected = selected.includes(clip.id);
                    return (
                      <div
                        key={clip.id}
                        draggable={!track.locked}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/x-safecut-clip", clip.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onDrop={(e) => {
                          const clipId = e.dataTransfer.getData("application/x-safecut-clip");
                          onDropTrack(e, track, clipId || undefined);
                        }}
                        onPointerDown={(e) => {
                          if (track.locked) {
                            toast("Track is locked", "error");
                            return;
                          }
                          if ((e.target as HTMLElement).dataset.handle) return;
                          startDrag(e, clip, "move");
                        }}
                        className={cn(
                          "group absolute top-1 overflow-hidden rounded-md border text-[10px] text-white shadow-sm transition-shadow",
                          isSelected ? "border-white ring-2 ring-brand z-10" : "border-black/30",
                          track.locked ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing",
                        )}
                        style={{
                          left: clip.start * pxPerSec,
                          width: Math.max(8, clip.duration * pxPerSec),
                          height: TRACK_HEIGHT[track.kind] - 8,
                          background: `linear-gradient(180deg, ${TRACK_COLOR[track.kind]}dd, ${TRACK_COLOR[track.kind]}aa)`,
                        }}
                        title={`${clip.name} — ${formatTime(clip.duration)}`}
                        data-testid="timeline-clip"
                      >
                        {asset?.thumbnail && track.kind !== "text" && (
                          <div
                            className="pointer-events-none absolute inset-0 opacity-30"
                            style={{
                              backgroundImage: `url(${asset.thumbnail})`,
                              backgroundSize: "cover",
                              backgroundPosition: "center",
                            }}
                          />
                        )}
                        {(track.kind === "audio" || asset?.kind === "audio") && (
                          <div className="pointer-events-none absolute inset-0 px-0.5 py-1">
                            <Waveform clip={clip} pxPerSec={pxPerSec} height={TRACK_HEIGHT[track.kind] - 14} />
                          </div>
                        )}
                        <div className="relative flex h-full items-center gap-1 px-1.5">
                          {clip.text ? (
                            <span className="truncate font-medium">{clip.text.content || "Text"}</span>
                          ) : (
                            <>
                              {asset?.kind === "audio" ? (
                                <Music size={10} className="shrink-0" />
                              ) : asset?.kind === "image" ? (
                                <ImageIcon size={10} className="shrink-0" />
                              ) : clip.mediaId ? (
                                <Film size={10} className="shrink-0" />
                              ) : (
                                <span className="h-2 w-2 shrink-0 rounded-sm bg-white/60" />
                              )}
                              <span className="truncate font-medium">{clip.name}</span>
                            </>
                          )}
                        </div>
                        {clip.keyframes.length > 0 && (
                          <span className="absolute right-1 top-0.5 rounded bg-black/40 px-1 text-[8px]">◆</span>
                        )}
                        {clip.transitionIn !== "none" && (
                          <span className="absolute left-0 top-0 h-full w-1.5 bg-white/50" />
                        )}
                        {clip.transitionOut !== "none" && (
                          <span className="absolute right-0 top-0 h-full w-1.5 bg-white/50" />
                        )}
                        <span
                          data-handle="start"
                          onPointerDown={(e) => startDrag(e, clip, "trim-start")}
                          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize bg-black/30 opacity-0 group-hover:opacity-100"
                        />
                        <span
                          data-handle="end"
                          onPointerDown={(e) => startDrag(e, clip, "trim-end")}
                          className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-black/30 opacity-0 group-hover:opacity-100"
                        />
                      </div>
                    );
                  })}
              </div>
            ))}

            {snapGuide !== null && (
              <div
                className="pointer-events-none absolute top-0 z-30 h-full w-px bg-brand/80"
                style={{ left: snapGuide * pxPerSec }}
              />
            )}

            {/* Playhead */}
            <div
              className="pointer-events-none absolute top-0 z-30 w-px bg-red-500"
              style={{ left: playhead * pxPerSec, height: "100%" }}
            >
              <div className="absolute -left-[5px] top-0 h-2.5 w-2.5 rotate-45 rounded-sm bg-red-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Empty state hint */}
      {project.clips.length === 0 && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-xs text-muted">
          <p className="font-medium">Import media, then drag it onto a track</p>
          <p className="mt-1">or press the Clip button to add a colour clip</p>
        </div>
      )}
      <input type="hidden" value={playing ? "1" : "0"} readOnly />
      <input
        type="hidden"
        value={uid()}
        readOnly
        aria-hidden
        data-testid="timeline-render-key"
      />
    </section>
  );
}
