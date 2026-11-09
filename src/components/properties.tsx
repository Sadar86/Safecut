"use client";

import { useState } from "react";
import { Copy, Diamond, RotateCcw, SplitSquareVertical, Trash2 } from "lucide-react";
import { useEditor } from "@/stores/editor";
import { Button, Slider, Switch, toast } from "@/components/ui";
import { DEFAULT_AUDIO, DEFAULT_COLOR, DEFAULT_TEXT, DEFAULT_TRANSFORM } from "@/types";
import type { ColorAdjustments, FilterKind, TransitionKind } from "@/types";
import { deleteClips, duplicateClip, splitClip } from "@/lib/timeline";
import { FILTERS } from "@/lib/effects";
import { cn, formatTime } from "@/lib/utils";

type Tab = "video" | "audio" | "text" | "speed";

const TRANSITIONS: TransitionKind[] = ["none", "fade", "dissolve", "slide", "zoom", "wipe", "spin", "blur"];

export function PropertiesPanel() {
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.selectedClipIds);
  const playhead = useEditor((s) => s.playhead);
  const commit = useEditor((s) => s.commit);
  const select = useEditor((s) => s.select);
  const [tab, setTab] = useState<Tab>("video");

  const clip = project.clips.find((c) => c.id === selected[0]);

  if (!clip) {
    return (
      <aside className="w-[290px] shrink-0 border-l border-border-subtle bg-surface-2 p-4" aria-label="Properties">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Properties</h2>
        <div className="mt-6 space-y-2 text-center text-[11px] leading-relaxed text-muted">
          <p>Select a clip on the timeline to edit it.</p>
          <div className="mt-4 space-y-1 rounded-lg border border-dashed border-border-subtle p-3 text-left">
            <p className="font-medium text-content">Project</p>
            <p>
              {project.settings.width}×{project.settings.height} · {project.settings.fps} fps
            </p>
            <p>Duration {formatTime(project.duration)}</p>
            <p>
              {project.clips.length} clips · {project.assets.length} assets
            </p>
          </div>
        </div>
      </aside>
    );
  }

  const patch = (p: Parameters<typeof Object.assign>[1]) => {
    commit(
      project.clips.map((c) => (c.id === clip.id ? { ...c, ...p } : c)),
      "Edit clip",
    );
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "video", label: "Video" },
    { id: "audio", label: "Audio" },
    ...(clip.text ? [{ id: "text" as Tab, label: "Text" }] : []),
    { id: "speed", label: "Speed" },
  ];

  return (
    <aside
      className="flex w-[290px] shrink-0 flex-col border-l border-border-subtle bg-surface-2"
      aria-label="Properties"
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border-subtle px-2">
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">{clip.name}</span>
        <Button size="icon" variant="ghost" onClick={() => commit(splitClip(project.clips, clip.id, playhead), "Split")} title="Split" aria-label="Split clip">
          <SplitSquareVertical size={13} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => {
            const next = duplicateClip(project.clips, clip.id);
            const added = next[next.length - 1];
            commit(next, "Duplicate");
            if (added) select([added.id]);
          }}
          title="Duplicate"
          aria-label="Duplicate clip"
        >
          <Copy size={13} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => {
            commit(deleteClips(project.clips, [clip.id]), "Delete");
            select([]);
          }}
          title="Delete"
          aria-label="Delete clip"
        >
          <Trash2 size={13} />
        </Button>
      </div>

      <div className="flex shrink-0 border-b border-border-subtle">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex-1 py-1.5 text-[11px] font-medium",
              tab === t.id ? "border-b-2 border-brand text-brand" : "text-muted hover:text-content",
            )}
            aria-pressed={tab === t.id}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {tab === "video" && <VideoTab clipId={clip.id} />}
        {tab === "audio" && <AudioTab clipId={clip.id} />}
        {tab === "text" && <TextTab clipId={clip.id} />}
        {tab === "speed" && <SpeedTab clipId={clip.id} />}

        <details className="rounded-md border border-border-subtle bg-surface px-2 py-1.5" open>
          <summary className="cursor-pointer text-[11px] font-medium">Transitions</summary>
          <div className="mt-2 space-y-2">
            <label className="block text-[10px] text-muted">
              In
              <select
                value={clip.transitionIn}
                onChange={(e) => patch({ transitionIn: e.target.value as TransitionKind })}
                className="mt-0.5 w-full rounded border border-border-subtle bg-surface-2 px-1.5 py-1 text-[11px] text-content"
              >
                {TRANSITIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[10px] text-muted">
              Out
              <select
                value={clip.transitionOut}
                onChange={(e) => patch({ transitionOut: e.target.value as TransitionKind })}
                className="mt-0.5 w-full rounded border border-border-subtle bg-surface-2 px-1.5 py-1 text-[11px] text-content"
              >
                {TRANSITIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <Slider
              label="Duration"
              value={clip.transitionDuration}
              min={0.1}
              max={2}
              step={0.05}
              format={(v) => `${v.toFixed(2)}s`}
              onChange={(v) => patch({ transitionDuration: v })}
            />
          </div>
        </details>

        <details className="rounded-md border border-border-subtle bg-surface px-2 py-1.5">
          <summary className="cursor-pointer text-[11px] font-medium">Keyframes</summary>
          <p className="mt-1 text-[10px] leading-relaxed text-muted">
            Add a keyframe at the playhead to animate opacity, scale or position.
          </p>
          <div className="mt-1.5 grid grid-cols-2 gap-1">
            {(["opacity", "scale", "x", "rotation"] as const).map((prop) => (
              <Button
                key={prop}
                size="sm"
                variant="secondary"
                onClick={() => {
                  const local = Math.max(0, Math.min(clip.duration, playhead - clip.start));
                  const value =
                    prop === "opacity"
                      ? clip.color.opacity
                      : prop === "scale"
                        ? clip.transform.scale
                        : prop === "x"
                          ? clip.transform.x
                          : clip.transform.rotation;
                  const kf = clip.keyframes.filter((k) => !(k.property === prop && Math.abs(k.t - local) < 1e-3));
                  commit(
                    project.clips.map((c) =>
                      c.id === clip.id
                        ? { ...c, keyframes: [...kf, { t: local, property: prop, value }].sort((a, b) => a.t - b.t) }
                        : c,
                    ),
                    "Add keyframe",
                  );
                  toast(`Keyframe added at ${formatTime(local)}`, "success");
                }}
              >
                <Diamond size={11} /> {prop}
              </Button>
            ))}
          </div>
          {clip.keyframes.length > 0 && (
            <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted">
              <span>{clip.keyframes.length} keyframes</span>
              <button
                className="hover:text-red-400"
                onClick={() => commit(project.clips.map((c) => (c.id === clip.id ? { ...c, keyframes: [] } : c)), "Clear keyframes")}
              >
                Clear all
              </button>
            </div>
          )}
        </details>
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */

function useClip(id: string) {
  const project = useEditor((s) => s.project);
  const commit = useEditor((s) => s.commit);
  const clip = project.clips.find((c) => c.id === id);
  return { project, commit, clip };
}

function VideoTab({ clipId }: { clipId: string }) {
  const { project, commit, clip } = useClip(clipId);
  if (!clip) return null;
  const patchColor = (p: Partial<ColorAdjustments>) =>
    commit(project.clips.map((c) => (c.id === clip.id ? { ...c, color: { ...c.color, ...p } } : c)), "Adjust colour");
  const patchT = (p: Partial<typeof clip.transform>) =>
    commit(project.clips.map((c) => (c.id === clip.id ? { ...c, transform: { ...c.transform, ...p } } : c)), "Transform");

  return (
    <>
      <Group title="Transform" onReset={() => patchT(DEFAULT_TRANSFORM)}>
        <Slider label="Scale" value={clip.transform.scale} min={0.1} max={3} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patchT({ scale: v })} onReset={() => patchT({ scale: 1 })} />
        <Slider label="Position X" value={clip.transform.x} min={-100} max={100} format={(v) => `${v}%`} onChange={(v) => patchT({ x: v })} onReset={() => patchT({ x: 0 })} />
        <Slider label="Position Y" value={clip.transform.y} min={-100} max={100} format={(v) => `${v}%`} onChange={(v) => patchT({ y: v })} onReset={() => patchT({ y: 0 })} />
        <Slider label="Rotation" value={clip.transform.rotation} min={-180} max={180} format={(v) => `${v}°`} onChange={(v) => patchT({ rotation: v })} onReset={() => patchT({ rotation: 0 })} />
        <div className="flex gap-2">
          <Toggle label="Flip H" checked={clip.transform.flipH} onChange={(v) => patchT({ flipH: v })} />
          <Toggle label="Flip V" checked={clip.transform.flipV} onChange={(v) => patchT({ flipV: v })} />
        </div>
      </Group>

      <Group title="Colour" onReset={() => patchColor(DEFAULT_COLOR)}>
        <Slider label="Brightness" value={clip.color.brightness} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patchColor({ brightness: v })} onReset={() => patchColor({ brightness: 1 })} />
        <Slider label="Contrast" value={clip.color.contrast} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patchColor({ contrast: v })} onReset={() => patchColor({ contrast: 1 })} />
        <Slider label="Saturation" value={clip.color.saturation} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patchColor({ saturation: v })} onReset={() => patchColor({ saturation: 1 })} />
        <Slider label="Exposure" value={clip.color.exposure} min={-100} max={100} onChange={(v) => patchColor({ exposure: v })} onReset={() => patchColor({ exposure: 0 })} />
        <Slider label="Temperature" value={clip.color.temperature} min={-100} max={100} onChange={(v) => patchColor({ temperature: v })} onReset={() => patchColor({ temperature: 0 })} />
        <Slider label="Tint" value={clip.color.tint} min={-100} max={100} onChange={(v) => patchColor({ tint: v })} onReset={() => patchColor({ tint: 0 })} />
        <Slider label="Shadows" value={clip.color.shadows} min={-100} max={100} onChange={(v) => patchColor({ shadows: v })} onReset={() => patchColor({ shadows: 0 })} />
        <Slider label="Highlights" value={clip.color.highlights} min={-100} max={100} onChange={(v) => patchColor({ highlights: v })} onReset={() => patchColor({ highlights: 0 })} />
        <Slider label="Opacity" value={clip.color.opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patchColor({ opacity: v })} onReset={() => patchColor({ opacity: 1 })} />
      </Group>

      <Group title="Creative" onReset={() => patchColor({ blur: 0, sharpen: 0, vignette: 0, grain: 0 })}>
        <Slider label="Blur" value={clip.color.blur} min={0} max={20} step={0.5} format={(v) => `${v}px`} onChange={(v) => patchColor({ blur: v })} />
        <Slider label="Vignette" value={clip.color.vignette} min={0} max={100} onChange={(v) => patchColor({ vignette: v })} />
        <Slider label="Film grain" value={clip.color.grain} min={0} max={100} onChange={(v) => patchColor({ grain: v })} />
        <label className="block text-[10px] text-muted">
          Filter
          <select
            value={clip.filter}
            onChange={(e) =>
              commit(project.clips.map((c) => (c.id === clip.id ? { ...c, filter: e.target.value as FilterKind } : c)), "Filter")
            }
            className="mt-0.5 w-full rounded border border-border-subtle bg-surface px-1.5 py-1 text-[11px] text-content"
          >
            {FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </Group>
    </>
  );
}

function AudioTab({ clipId }: { clipId: string }) {
  const { project, commit, clip } = useClip(clipId);
  if (!clip) return null;
  const patchA = (p: Partial<typeof clip.audio>) =>
    commit(project.clips.map((c) => (c.id === clip.id ? { ...c, audio: { ...c.audio, ...p } } : c)), "Adjust audio");
  const patchEq = (p: Partial<typeof clip.audio.eq>) =>
    patchA({ eq: { ...clip.audio.eq, ...p } });

  return (
    <>
      <Group title="Volume" onReset={() => patchA(DEFAULT_AUDIO)}>
        <Slider label="Volume" value={clip.audio.volume} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patchA({ volume: v })} onReset={() => patchA({ volume: 1 })} />
        <Slider label="Fade in" value={clip.audio.fadeIn} min={0} max={5} step={0.1} format={(v) => `${v.toFixed(1)}s`} onChange={(v) => patchA({ fadeIn: v })} />
        <Slider label="Fade out" value={clip.audio.fadeOut} min={0} max={5} step={0.1} format={(v) => `${v.toFixed(1)}s`} onChange={(v) => patchA({ fadeOut: v })} />
        <Toggle label="Mute clip" checked={clip.audio.muted} onChange={(v) => patchA({ muted: v })} />
      </Group>
      <Group title="Equaliser" onReset={() => patchEq({ low: 0, mid: 0, high: 0 })}>
        <Slider label="Low (200 Hz)" value={clip.audio.eq.low} min={-12} max={12} format={(v) => `${v} dB`} onChange={(v) => patchEq({ low: v })} onReset={() => patchEq({ low: 0 })} />
        <Slider label="Mid (1 kHz)" value={clip.audio.eq.mid} min={-12} max={12} format={(v) => `${v} dB`} onChange={(v) => patchEq({ mid: v })} onReset={() => patchEq({ mid: 0 })} />
        <Slider label="High (6 kHz)" value={clip.audio.eq.high} min={-12} max={12} format={(v) => `${v} dB`} onChange={(v) => patchEq({ high: v })} onReset={() => patchEq({ high: 0 })} />
        <p className="text-[10px] leading-relaxed text-muted">
          EQ shapes the live preview. For baked-in EQ on export, SafeCut uses the volume and fade
          settings in this panel.
        </p>
      </Group>
    </>
  );
}

function TextTab({ clipId }: { clipId: string }) {
  const { project, commit, clip } = useClip(clipId);
  if (!clip?.text) return null;
  const patchT = (p: Partial<typeof clip.text>) =>
    commit(project.clips.map((c) => (c.id === clip.id && c.text ? { ...c, text: { ...c.text, ...p } } : c)), "Edit text");

  return (
    <>
      <Group title="Content" onReset={() => patchT(DEFAULT_TEXT)}>
        <textarea
          value={clip.text.content}
          onChange={(e) => patchT({ content: e.target.value })}
          rows={3}
          className="w-full resize-none rounded border border-border-subtle bg-surface px-2 py-1.5 text-xs text-content outline-none focus:border-brand"
          aria-label="Text content"
        />
        <label className="block text-[10px] text-muted">
          Font
          <select
            value={clip.text.fontFamily}
            onChange={(e) => patchT({ fontFamily: e.target.value })}
            className="mt-0.5 w-full rounded border border-border-subtle bg-surface px-1.5 py-1 text-[11px] text-content"
          >
            {[
              "Inter, system-ui, sans-serif",
              "Georgia, serif",
              "'Courier New', monospace",
              "'Arial Black', sans-serif",
              "'Times New Roman', serif",
              "Impact, sans-serif",
              "Verdana, sans-serif",
              "'Trebuchet MS', sans-serif",
            ].map((f) => (
              <option key={f} value={f}>
                {f.split(",")[0].replace(/'/g, "")}
              </option>
            ))}
          </select>
        </label>
        <Slider label="Size" value={clip.text.fontSize} min={12} max={220} format={(v) => `${v}px`} onChange={(v) => patchT({ fontSize: v })} />
        <div className="flex items-center gap-2">
          <label className="flex-1 text-[10px] text-muted">
            Colour
            <input type="color" value={clip.text.color} onChange={(e) => patchT({ color: e.target.value })} className="mt-0.5 h-7 w-full cursor-pointer rounded border border-border-subtle bg-surface" aria-label="Text colour" />
          </label>
          <label className="flex-1 text-[10px] text-muted">
            Background
            <input
              type="color"
              value={clip.text.background === "transparent" ? "#000000" : clip.text.background}
              onChange={(e) => patchT({ background: e.target.value })}
              className="mt-0.5 h-7 w-full cursor-pointer rounded border border-border-subtle bg-surface"
              aria-label="Text background colour"
            />
          </label>
        </div>
        <Button size="sm" variant="ghost" onClick={() => patchT({ background: clip.text?.background === "transparent" ? "#000000cc" : "transparent" })}>
          {clip.text.background === "transparent" ? "Add background" : "Remove background"}
        </Button>
        <div className="flex gap-1">
          {(["left", "center", "right"] as const).map((a) => (
            <Button key={a} size="sm" variant={clip.text?.align === a ? "primary" : "ghost"} onClick={() => patchT({ align: a })} className="flex-1 justify-center capitalize">
              {a}
            </Button>
          ))}
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant={clip.text.bold ? "primary" : "ghost"} onClick={() => patchT({ bold: !clip.text?.bold })} className="flex-1 justify-center font-bold">
            B
          </Button>
          <Button size="sm" variant={clip.text.italic ? "primary" : "ghost"} onClick={() => patchT({ italic: !clip.text?.italic })} className="flex-1 justify-center italic">
            I
          </Button>
          <Button size="sm" variant={clip.text.shadow ? "primary" : "ghost"} onClick={() => patchT({ shadow: !clip.text?.shadow })} className="flex-1 justify-center">
            Shadow
          </Button>
        </div>
      </Group>
      <Group title="Style">
        <Slider label="Outline" value={clip.text.outlineWidth} min={0} max={12} step={0.5} format={(v) => `${v}px`} onChange={(v) => patchT({ outlineWidth: v })} />
        <Slider label="Position X" value={clip.text.x} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => patchT({ x: v })} />
        <Slider label="Position Y" value={clip.text.y} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => patchT({ y: v })} />
        <label className="block text-[10px] text-muted">
          Animation
          <select
            value={clip.text.animation}
            onChange={(e) => patchT({ animation: e.target.value as typeof clip.text.animation })}
            className="mt-0.5 w-full rounded border border-border-subtle bg-surface px-1.5 py-1 text-[11px] text-content"
          >
            {["none", "fade", "pop", "slide-up", "typewriter"].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
      </Group>
    </>
  );
}

function SpeedTab({ clipId }: { clipId: string }) {
  const { project, commit, clip } = useClip(clipId);
  if (!clip) return null;
  const patch = (p: Partial<typeof clip>) =>
    commit(project.clips.map((c) => (c.id === clip.id ? { ...c, ...p } : c)), "Change speed");

  return (
    <Group title="Speed & time" onReset={() => patch({ speed: 1, reversed: false, freezeAt: undefined })}>
      <Slider
        label="Speed"
        value={clip.speed}
        min={0.1}
        max={4}
        step={0.05}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(v) => patch({ speed: v })}
        onReset={() => patch({ speed: 1 })}
      />
      <div className="flex flex-wrap gap-1">
        {[0.25, 0.5, 1, 1.5, 2, 4].map((s) => (
          <Button key={s} size="sm" variant={clip.speed === s ? "primary" : "ghost"} onClick={() => patch({ speed: s })}>
            {s}×
          </Button>
        ))}
      </div>
      <Toggle label="Reverse playback" checked={clip.reversed} onChange={(v) => patch({ reversed: v })} />
      <Button
        size="sm"
        variant="secondary"
        onClick={() => patch({ freezeAt: clip.inPoint + (useEditor.getState().playhead - clip.start) * clip.speed })}
      >
        Freeze current frame
      </Button>
      {clip.freezeAt !== undefined && (
        <Button size="sm" variant="ghost" onClick={() => patch({ freezeAt: undefined })}>
          <RotateCcw size={11} /> Unfreeze
        </Button>
      )}
      <p className="text-[10px] leading-relaxed text-muted">
        Speed changes are baked in when you export: audio is resampled and video frames are retimed.
        Reversed playback is exported with FFmpeg&apos;s reverse filter (needs the export engine).
      </p>
    </Group>
  );
}

/* -------------------------------------------------------------------------- */

function Group({
  title,
  children,
  onReset,
}: {
  title: string;
  children: React.ReactNode;
  onReset?: () => void;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
        {onReset && (
          <button onClick={onReset} className="text-[10px] text-muted hover:text-content" aria-label={`Reset ${title}`}>
            Reset
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex flex-1 items-center justify-between gap-2 text-[11px]">
      {label}
      <Switch checked={checked} onChange={onChange} label={label} />
    </label>
  );
}
