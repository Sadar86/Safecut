"use client";

import { useRef, useState } from "react";
import {
  AudioLines,
  Film,
  Image as ImageIcon,
  Music,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  Type,
  Captions,
  ScanSearch,
  BrainCircuit,
} from "lucide-react";
import { useEditor, type Panel } from "@/stores/editor";
import { Button, SectionTitle, toast } from "@/components/ui";
import { importFiles, ACCEPTED_MEDIA } from "@/lib/media";
import { cn, formatBytes, formatTime } from "@/lib/utils";
import { findGap, makeClip } from "@/lib/timeline";
import { DEFAULT_TEXT } from "@/types";
import type { MediaAsset } from "@/types";
import { FILTERS } from "@/lib/effects";
import { CaptionsPanel } from "@/components/captions-panel";
import { AudioStudioPanel } from "@/components/audio-studio";
import { ScenePanel } from "@/components/scene-panel";
import {
  AiCaptionsPanel,
  AssistantPanel,
  BackgroundPanel,
  DeviceBadge,
  HighlightsPanel,
  ReframePanel,
  SilencePanel,
  TtsPanel,
  VoicePanel,
  useDeviceCaps,
} from "@/components/ai-panels";

const PANELS: { id: Panel; label: string; icon: React.ReactNode }[] = [
  { id: "media", label: "Media", icon: <Film size={15} /> },
  { id: "text", label: "Text", icon: <Type size={15} /> },
  { id: "effects", label: "Effects", icon: <Sparkles size={15} /> },
  { id: "filters", label: "Filters", icon: <Wand2 size={15} /> },
  { id: "audio", label: "Audio", icon: <AudioLines size={15} /> },
  { id: "captions", label: "Captions", icon: <Captions size={15} /> },
  { id: "scenes", label: "Scenes", icon: <ScanSearch size={15} /> },
  { id: "templates", label: "Templates", icon: <Film size={15} /> },
  { id: "ai", label: "AI Studio", icon: <BrainCircuit size={15} /> },
];

export function SidePanel() {
  const activePanel = useEditor((s) => s.activePanel);
  const setPanel = useEditor((s) => s.setPanel);

  return (
    <aside
      className="flex h-full min-h-0 w-[300px] shrink-0 flex-col border-r border-border-subtle bg-surface-2"
      aria-label="Library panel"
    >
      <div className="flex shrink-0 flex-wrap border-b border-border-subtle">
        {PANELS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPanel(p.id)}
            className={cn(
              "flex min-w-[54px] flex-1 flex-col items-center gap-0.5 py-1.5 text-[9px] font-medium transition-colors",
              activePanel === p.id
                ? "border-b-2 border-brand text-brand"
                : "text-muted hover:text-content",
            )}
            aria-pressed={activePanel === p.id}
          >
            {p.icon}
            {p.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activePanel === "media" && <MediaPanel />}
        {activePanel === "text" && <TextPanel />}
        {activePanel === "effects" && <EffectsPanel />}
        {activePanel === "filters" && <FiltersPanel />}
        {activePanel === "audio" && <AudioStudioPanel />}
        {activePanel === "captions" && <CaptionsPanel />}
        {activePanel === "scenes" && <ScenePanel />}
        {activePanel === "ai" && <AiStudioPanel />}
        {activePanel === "templates" && <TemplatesPanel />}
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/*  Media                                                                      */
/* -------------------------------------------------------------------------- */

function MediaPanel() {
  const project = useEditor((s) => s.project);
  const addAssets = useEditor((s) => s.addAssets);
  const removeAsset = useEditor((s) => s.removeAsset);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "video" | "audio" | "image">("all");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = async (files: FileList | File[]) => {
    setBusy(true);
    try {
      const { assets, errors } = await importFiles(Array.from(files));
      if (assets.length) {
        addAssets(assets);
        toast(`${assets.length} file${assets.length > 1 ? "s" : ""} imported`, "success");
      }
      errors.forEach((e) => toast(e, "error"));
    } finally {
      setBusy(false);
    }
  };

  const filtered = project.assets.filter(
    (a) => (filter === "all" || a.kind === filter) && a.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
      }}
    >
      <div className="p-2">
        <div className="flex items-center gap-1 rounded-lg border border-border-subtle bg-surface px-2">
          <Search size={13} className="text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search media"
            className="h-8 w-full bg-transparent text-xs outline-none placeholder:text-muted"
            aria-label="Search media"
          />
        </div>
        <Button
          variant="primary"
          size="md"
          className="mt-2 w-full justify-center"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          <Upload size={14} /> {busy ? "Importing…" : "Import media"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_MEDIA}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void handleFiles(e.target.files);
            e.target.value = "";
          }}
          data-testid="media-input"
        />
        <div className="mt-2 flex gap-1">
          {(["all", "video", "image", "audio"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "primary" : "ghost"}
              onClick={() => setFilter(f)}
              className="flex-1 justify-center capitalize"
            >
              {f}
            </Button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mx-2 rounded-lg border border-dashed border-border-subtle px-3 py-8 text-center text-[11px] text-muted">
          Drag video, audio or images here, or use Import media.
          <br />
          Files stay on your device.
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-2 p-2">
          {filtered.map((asset) => (
            <MediaCard key={asset.id} asset={asset} onRemove={() => removeAsset(asset.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MediaCard({ asset, onRemove }: { asset: MediaAsset; onRemove: () => void }) {
  const icon =
    asset.kind === "video" ? <Film size={12} /> : asset.kind === "audio" ? <Music size={12} /> : <ImageIcon size={12} />;
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-safecut-asset", asset.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      className="group relative cursor-grab overflow-hidden rounded-md border border-border-subtle bg-surface"
      title={`${asset.name}\n${formatBytes(asset.size)}${asset.duration ? `\n${formatTime(asset.duration)}` : ""}`}
    >
      <div className="relative flex aspect-video items-center justify-center bg-surface-3">
        {asset.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.thumbnail} alt="" className="h-full w-full object-cover" />
        ) : asset.kind === "audio" ? (
          <AudioLines size={20} className="text-brand" />
        ) : (
          icon
        )}
        {asset.duration > 0 && (
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[9px] text-white">
            {formatTime(asset.duration)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 px-1.5 py-1">
        <span className="text-muted">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-[10px]">{asset.name}</span>
        <button
          onClick={onRemove}
          className="text-muted opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
          aria-label={`Remove ${asset.name}`}
        >
          <Trash2 size={11} />
        </button>
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/*  Text                                                                       */
/* -------------------------------------------------------------------------- */

const TEXT_PRESETS = [
  { name: "Heading", style: { fontSize: 96, bold: true } },
  { name: "Subtitle", style: { fontSize: 54, bold: false } },
  { name: "Lower third", style: { fontSize: 44, y: 78, align: "left" as const, x: 28 } },
  { name: "Caption", style: { fontSize: 42, y: 88 } },
  { name: "Title", style: { fontSize: 120, bold: true } },
  { name: "Quote", style: { fontSize: 48, italic: true } },
];

function TextPanel() {
  const project = useEditor((s) => s.project);
  const commit = useEditor((s) => s.commit);
  const select = useEditor((s) => s.select);
  const playhead = useEditor((s) => s.playhead);
  const tracks = project.tracks.filter((t) => t.kind === "text" || t.kind === "overlay");

  const addText = (preset: (typeof TEXT_PRESETS)[number]) => {
    const track = tracks.find((t) => t.kind === "text") ?? tracks[0];
    if (!track) return toast("Add a text track first", "error");
    const clips = useEditor.getState().project.clips;
    const clip = makeClip({
      trackId: track.id,
      mediaId: null,
      name: preset.name,
      start: findGap(clips, track.id, 3, playhead),
      duration: 3,
      sourceDuration: 3,
    });
    clip.text = { ...DEFAULT_TEXT, ...preset.style, content: preset.name };
    commit([...clips, clip], "Add text");
    select([clip.id]);
    toast("Text added — edit it in the properties panel", "success");
  };

  return (
    <div>
      <SectionTitle>Text presets</SectionTitle>
      <div className="grid grid-cols-2 gap-2 px-2">
        {TEXT_PRESETS.map((p) => (
          <button
            key={p.name}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-safecut-text", p.name);
            }}
            onClick={() => addText(p)}
            className="flex h-16 flex-col items-center justify-center gap-1 rounded-md border border-border-subtle bg-surface text-[11px] hover:border-brand/60 hover:bg-surface-3"
          >
            <span style={{ fontSize: Math.min(20, p.style.fontSize / 5) }} className="font-bold">
              Aa
            </span>
            {p.name}
          </button>
        ))}
      </div>
      <p className="px-3 py-3 text-[11px] leading-relaxed text-muted">
        Drag a preset onto the timeline or click to add it at the playhead. Select it to change font,
        colour, outline, shadow and animation in Properties.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Effects / Filters                                                          */
/* -------------------------------------------------------------------------- */

const EFFECTS = [
  { id: "fade", name: "Fade" },
  { id: "dissolve", name: "Dissolve" },
  { id: "slide", name: "Slide" },
  { id: "zoom", name: "Zoom" },
  { id: "wipe", name: "Wipe" },
  { id: "spin", name: "Spin" },
  { id: "blur", name: "Blur" },
] as const;

const ADJUST_PRESETS = [
  { name: "Cinematic", color: { contrast: 1.2, saturation: 0.95, shadows: -20, highlights: 15, vignette: 25 } },
  { name: "Vivid", color: { saturation: 1.4, contrast: 1.12, brightness: 1.03 } },
  { name: "Moody", color: { brightness: 0.9, contrast: 1.15, temperature: -20, shadows: -15 } },
  { name: "Warm sun", color: { temperature: 30, saturation: 1.1, exposure: 8 } },
  { name: "Cold blue", color: { temperature: -35, tint: 10, saturation: 0.9 } },
  { name: "Film grain", color: { grain: 35, contrast: 1.08, vignette: 18 } },
];

function EffectsPanel() {
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.selectedClipIds);
  const commit = useEditor((s) => s.commit);
  const clip = project.clips.find((c) => c.id === selected[0]);

  const applyTransition = (id: (typeof EFFECTS)[number]["id"]) => {
    if (!clip) return toast("Select a clip first", "error");
    commit(
      project.clips.map((c) =>
        c.id === clip.id ? { ...c, transitionIn: id, transitionOut: id, transitionDuration: 0.6 } : c,
      ),
      "Apply transition",
    );
    toast(`${id} transition applied`, "success");
  };

  const applyPreset = (color: object) => {
    if (!clip) return toast("Select a clip first", "error");
    commit(
      project.clips.map((c) => (c.id === clip.id ? { ...c, color: { ...c.color, ...color } } : c)),
      "Apply look",
    );
  };

  return (
    <div>
      <SectionTitle>Transitions</SectionTitle>
      <div className="grid grid-cols-3 gap-1.5 px-2">
        {EFFECTS.map((e) => (
          <button
            key={e.id}
            onClick={() => applyTransition(e.id)}
            className="flex h-14 items-center justify-center rounded-md border border-border-subtle bg-surface text-[11px] hover:border-brand/60"
          >
            {e.name}
          </button>
        ))}
      </div>
      <SectionTitle>Looks</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5 px-2 pb-3">
        {ADJUST_PRESETS.map((p) => (
          <button
            key={p.name}
            onClick={() => applyPreset(p.color)}
            className="flex h-14 items-center justify-center rounded-md border border-border-subtle bg-surface text-[11px] hover:border-brand/60"
          >
            {p.name}
          </button>
        ))}
      </div>
      <p className="px-3 pb-4 text-[11px] text-muted">
        Transitions apply to the selected clip&apos;s in and out points. Fine-tune them in Properties.
      </p>
    </div>
  );
}

function FiltersPanel() {
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.selectedClipIds);
  const commit = useEditor((s) => s.commit);
  const clip = project.clips.find((c) => c.id === selected[0]);

  const apply = (filter: (typeof FILTERS)[number]["id"]) => {
    if (!clip) return toast("Select a clip first", "error");
    commit(project.clips.map((c) => (c.id === clip.id ? { ...c, filter } : c)), "Apply filter");
  };

  return (
    <div>
      <SectionTitle>Filters</SectionTitle>
      <div className="grid grid-cols-2 gap-2 px-2 pb-3">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => apply(f.id)}
            className={cn(
              "group overflow-hidden rounded-md border text-[10px]",
              clip?.filter === f.id ? "border-brand" : "border-border-subtle hover:border-brand/50",
            )}
          >
            <div
              className="h-12 w-full"
              style={{
                filter: f.css,
                background:
                  "linear-gradient(135deg,#f97316 0%,#ef4444 35%,#8b5cf6 70%,#3b82f6 100%)",
              }}
            />
            <div className="bg-surface px-1 py-1">{f.label}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Audio                                                                      */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*  Templates                                                                  */
/* -------------------------------------------------------------------------- */

const TEMPLATE_CATEGORIES = [
  { name: "YouTube", ratio: "16:9", accent: "#3b82f6" },
  { name: "Shorts", ratio: "9:16", accent: "#ef4444" },
  { name: "Reels", ratio: "9:16", accent: "#a855f7" },
  { name: "TikTok", ratio: "9:16", accent: "#22d3ee" },
  { name: "Square post", ratio: "1:1", accent: "#f59e0b" },
  { name: "Promo", ratio: "16:9", accent: "#10b981" },
  { name: "Travel", ratio: "16:9", accent: "#0ea5e9" },
  { name: "Cinematic", ratio: "21:9", accent: "#6366f1" },
];

function TemplatesPanel() {
  const project = useEditor((s) => s.project);
  const commit = useEditor((s) => s.commit);
  const select = useEditor((s) => s.select);

  const insertTemplate = (name: string, ratio: string) => {
    const track = project.tracks.find((t) => t.kind === "text");
    if (!track) return;
    const clips = useEditor.getState().project.clips;
    const clip = makeClip({
      trackId: track.id,
      mediaId: null,
      name: `${name} title`,
      start: 0,
      duration: 4,
      sourceDuration: 4,
    });
    clip.text = {
      ...DEFAULT_TEXT,
      content: `${name}\nTemplate`,
      animation: "pop",
      y: 50,
    };
    commit([...clips, clip], "Use template");
    select([clip.id]);
    toast(`${name} (${ratio}) title added`, "success");
  };

  return (
    <div>
      <SectionTitle>Templates</SectionTitle>
      <div className="grid grid-cols-2 gap-2 px-2 pb-4">
        {TEMPLATE_CATEGORIES.map((t) => (
          <button
            key={t.name}
            onClick={() => insertTemplate(t.name, t.ratio)}
            className="group overflow-hidden rounded-md border border-border-subtle bg-surface text-left hover:border-brand/60"
          >
            <div
              className="flex h-16 items-center justify-center text-[10px] font-semibold text-white"
              style={{ background: `linear-gradient(135deg, ${t.accent}, #0f172a)` }}
            >
              {t.ratio}
            </div>
            <div className="px-2 py-1 text-[11px]">{t.name}</div>
          </button>
        ))}
      </div>
      <p className="px-3 pb-4 text-[11px] text-muted">
        Templates add an animated title in the right aspect ratio. Swap in your own clips and text.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  AI Creator Studio                                                          */
/* -------------------------------------------------------------------------- */

const AI_TABS = [
  { id: "captions", label: "Captions" },
  { id: "silence", label: "Silence" },
  { id: "voice", label: "Voice" },
  { id: "background", label: "Background" },
  { id: "reframe", label: "Reframe" },
  { id: "highlights", label: "Highlights" },
  { id: "tts", label: "Voice-over" },
  { id: "assistant", label: "Assistant" },
] as const;

type AiTab = (typeof AI_TABS)[number]["id"];

function AiStudioPanel() {
  const [tab, setTab] = useState<AiTab>("captions");
  const caps = useDeviceCaps();

  return (
    <div className="pb-2">
      <div className="border-b border-border-subtle px-2 py-1.5">
        <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold">
          <BrainCircuit size={12} className="text-brand" /> AI Creator Studio
        </p>
        <DeviceBadge caps={caps} />
      </div>
      <div className="flex flex-wrap gap-1 px-2 py-1.5">
        {AI_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px]",
              tab === t.id ? "border-brand bg-brand/10 text-brand" : "border-border-subtle text-muted hover:text-content",
            )}
            aria-pressed={tab === t.id}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "captions" && <AiCaptionsPanel />}
      {tab === "silence" && <SilencePanel />}
      {tab === "voice" && <VoicePanel />}
      {tab === "background" && <BackgroundPanel />}
      {tab === "reframe" && <ReframePanel />}
      {tab === "highlights" && <HighlightsPanel />}
      {tab === "tts" && <TtsPanel />}
      {tab === "assistant" && <AssistantPanel />}
    </div>
  );
}
