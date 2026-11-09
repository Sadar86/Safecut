"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrainCircuit,
  ChevronDown,
  Cpu,
  Loader2,
  Pause,
  Play,
  Square,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useEditor } from "@/stores/editor";
import { Button, SectionTitle, Slider, Switch, toast } from "@/components/ui";
import { cn, formatTime } from "@/lib/utils";
import { detectCapabilities, MODELS, type DeviceCapabilities } from "@/lib/ai/models";
import { engineStatus, recommendEngine, transcribe, type EngineId, type TranscriptionProgress } from "@/lib/ai/speech";
import { wordsToCues } from "@/lib/ai/align";
import { CAPTION_TEMPLATES, captionTrack, cuesToClips, templateById } from "@/lib/captions";
import { decodeAsset } from "@/lib/audio";
import { findSilences, planRemoval, type SilenceSegment } from "@/lib/ai/silence";
import { splitClip } from "@/lib/timeline";
import { analyseVoice, planVoiceChain, presetById, VOICE_PRESETS } from "@/lib/ai/voice";
import { renderClipAudio } from "@/lib/audio";
import { saveGeneratedAsset } from "@/lib/ai/assets";
import { cropFor, cropToTransform, ASPECT_TARGETS, type Box } from "@/lib/ai/reframe";
import { detectFace, faceDetectionSupported } from "@/lib/ai/detect";
import { ASPECT_PRESETS, type AspectRatio } from "@/types";
import { useAnalysis } from "@/stores/analysis";
import { sampleVideoForScenes } from "@/components/preview-renderer";
import { computeMatte } from "@/lib/ai/segment";
import { putAuxBlob } from "@/lib/storage";

const LANGUAGES = [
  { code: "auto", label: "Auto-detect" },
  { code: "en", label: "English" },
  { code: "ur", label: "Urdu" },
  { code: "hi", label: "Hindi" },
  { code: "ar", label: "Arabic" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "tr", label: "Turkish" },
  { code: "id", label: "Indonesian" },
  { code: "zh", label: "Chinese" },
];

/** Shared device report so every AI panel shows the same numbers. */
export function useDeviceCaps() {
  const [caps, setCaps] = useState<DeviceCapabilities | null>(null);
  useEffect(() => {
    let cancelled = false;
    void detectCapabilities().then((c) => {
      if (!cancelled) setCaps(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return caps;
}

export function DeviceBadge({ caps }: { caps: DeviceCapabilities | null }) {
  if (!caps) return null;
  return (
    <p className="rounded border border-border-subtle bg-surface px-2 py-1 text-[10px] leading-relaxed text-muted">
      <Cpu size={10} className="mr-1 inline" />
      {caps.cores} cores · {caps.webgpu ? "WebGPU" : "CPU only"} · {caps.tier} tier
      {caps.deviceMemoryGb ? ` · ${caps.deviceMemoryGb} GB` : ""}
      {caps.warnings[0] ? ` — ${caps.warnings[0]}` : ""}
    </p>
  );
}

/* ========================================================================== */
/*  AI Auto captions                                                           */
/* ========================================================================== */

export function AiCaptionsPanel() {
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.selectedClipIds);
  const commit = useEditor((s) => s.commit);
  const caps = useDeviceCaps();
  const engines = useMemo(() => engineStatus(), []);
  const [engineChoice, setEngine] = useState<EngineId | null>(null);
  const [language, setLanguage] = useState("en");
  const [template, setTemplate] = useState("clean");
  const [progress, setProgress] = useState<TranscriptionProgress | null>(null);
  const [wordLevel, setWordLevel] = useState<boolean | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const clip = project.clips.find((c) => c.id === selected[0]);
  const asset = project.assets.find((a) => a.id === clip?.mediaId);

  // The recommended engine is derived, not stored in an effect.
  const engine: EngineId = engineChoice ?? (caps ? recommendEngine(caps) : "web-speech");

  const run = async () => {
    if (!asset) return toast("Select a video or audio clip first", "error");
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ stage: "loading", ratio: 0, message: "Starting…" });
    try {
      const result = await transcribe({
        assetId: asset.id,
        assetUrl: asset.url,
        engine,
        language,
        offset: 0,
        signal: controller.signal,
        onProgress: setProgress,
      });
      const cues = wordsToCues(result.words, { maxChars: 84, minDuration: 1 });
      if (cues.length === 0) return toast("No speech detected", "error");
      useEditor.setState({ project: { ...useEditor.getState().project, captions: cues, captionSourceId: asset.id } });
      setWordLevel(result.wordLevel);
      toast(
        `${cues.length} cues from ${result.engine}${result.wordLevel ? " (word-level)" : " (phrase timing)"}`,
        "success",
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") toast("Cancelled", "info");
      else toast((err as Error).message || "Transcription failed", "error");
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  const apply = () => {
    const cues = project.captions ?? [];
    if (cues.length === 0) return toast("Generate or import captions first", "error");
    const { project: withTrack, trackId } = captionTrack(project);
    const clips = cuesToClips(cues, trackId, templateById(template));
    const others = withTrack.clips.filter((c) => c.trackId !== trackId);
    useEditor.setState({ project: { ...withTrack, clips: [...others, ...clips], tracks: withTrack.tracks } });
    commit([...others, ...clips], "AI captions");
    toast(`${clips.length} caption clips added`, "success");
  };

  const busy = progress !== null;

  return (
    <div className="space-y-3 px-2 pb-4">
      <DeviceBadge caps={caps} />
      <div>
        <SectionTitle>Recognition engine</SectionTitle>
        <div className="space-y-1">
          {engines.map((e) => (
            <button
              key={e.id}
              onClick={() => setEngine(e.id)}
              disabled={!e.available}
              className={cn(
                "w-full rounded border px-2 py-1.5 text-left text-[11px]",
                engine === e.id ? "border-brand bg-brand/10" : "border-border-subtle",
                !e.available && "opacity-40",
              )}
            >
              <span className="flex items-center justify-between">
                <span>{MODELS[e.id].label}</span>
                <span className="text-[9px] text-muted">
                  {e.sizeMb ? `${e.sizeMb} MB` : "no download"} · {e.local ? "on-device" : "browser"}
                </span>
              </span>
              <span className="mt-0.5 block text-[9px] text-muted">
                {e.available ? MODELS[e.id].notes : e.reason}
              </span>
            </button>
          ))}
        </div>
      </div>

      <label className="block text-[10px] text-muted">
        Language
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="mt-0.5 w-full rounded border border-border-subtle bg-surface px-1.5 py-1 text-[11px] text-content"
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-1">
        <Button variant="primary" size="sm" className="flex-1 justify-center" onClick={() => void run()} disabled={busy}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <BrainCircuit size={12} />}
          {busy ? "Working…" : "Generate captions"}
        </Button>
        {busy && (
          <Button size="sm" variant="ghost" onClick={() => abortRef.current?.abort()} aria-label="Stop">
            <Square size={12} />
          </Button>
        )}
      </div>

      {progress && (
        <div className="space-y-1">
          <div className="h-1 overflow-hidden rounded bg-surface-3">
            <div className="h-full bg-brand transition-all" style={{ width: `${Math.max(4, progress.ratio * 100)}%` }} />
          </div>
          <p className="text-[10px] text-muted">{progress.message}</p>
        </div>
      )}

      {project.captions?.length ? (
        <>
          <SectionTitle>Captions ({project.captions.length})</SectionTitle>
          <label className="block text-[10px] text-muted">
            Template
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="mt-0.5 w-full rounded border border-border-subtle bg-surface px-1.5 py-1 text-[11px] text-content"
            >
              {CAPTION_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="secondary" className="w-full justify-center" onClick={apply}>
            <Wand2 size={12} /> Add to timeline
          </Button>
          <p className="text-[10px] text-muted">
            {wordLevel === false
              ? "This engine reports phrase timings; word-by-word templates will still work but timing is estimated."
              : "Word-level timings available — karaoke and word-by-word templates are accurate."}
          </p>
        </>
      ) : null}
    </div>
  );
}

/* ========================================================================== */
/*  Smart silence removal                                                      */
/* ========================================================================== */

export function SilencePanel() {
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.selectedClipIds);
  const commit = useEditor((s) => s.commit);
  const [threshold, setThreshold] = useState(-40);
  const [minDuration, setMinDuration] = useState(0.6);
  const [segments, setSegments] = useState<SilenceSegment[] | null>(null);
  const [approved, setApproved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [closeGaps, setCloseGaps] = useState(true);

  const clip = project.clips.find((c) => c.id === selected[0]);

  const analyse = async () => {
    if (!clip?.mediaId) return toast("Select an audio or video clip first", "error");
    setBusy(true);
    try {
      const buffer = await decodeAsset(clip.mediaId);
      if (!buffer) return toast("No decodable audio in that clip", "error");
      const from = Math.floor(clip.inPoint * buffer.sampleRate);
      const to = Math.floor((clip.inPoint + clip.duration * clip.speed) * buffer.sampleRate);
      const slice = buffer.getChannelData(0).subarray(from, Math.min(to, buffer.length));
      const found = findSilences(slice, buffer.sampleRate, { thresholdDb: threshold, minDuration });
      setSegments(found);
      setApproved(found.map((s) => s.id));
      toast(found.length ? `${found.length} silent segments found` : "No silence at this threshold", found.length ? "success" : "info");
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!clip || !segments) return;
    const plan = planRemoval(segments, clip.duration * clip.speed, approved);
    if (plan.ranges.length === 0) return toast("Nothing approved to remove", "error");

    // Work in timeline seconds: every source offset is divided by the speed.
    const cuts = plan.ranges.flatMap((r) => [
      clip.start + r.start / clip.speed,
      clip.start + r.end / clip.speed,
    ]);
    let clips = useEditor.getState().project.clips;
    for (const cut of cuts) clips = splitClip(clips, clip.id, cut);

    const inOriginal = (c: (typeof clips)[number]) =>
      c.trackId === clip.trackId &&
      c.mediaId === clip.mediaId &&
      c.start >= clip.start - 1e-6 &&
      c.start + c.duration <= clip.start + clip.duration + 1e-6;

    // Drop the pieces that start inside an approved silence.
    const isSilent = (c: (typeof clips)[number]) => {
      const local = (c.start - clip.start) * clip.speed;
      return plan.ranges.some((r) => local >= r.start - 0.01 && local < r.end - 0.01);
    };
    clips = clips.filter((c) => !inOriginal(c) || !isSilent(c));

    // Close the gap: move everything that followed the original clip left.
    if (closeGaps) {
      const removed = plan.savedSeconds / clip.speed;
      clips = clips.map((c) =>
        c.start >= clip.start + clip.duration - 1e-6 ? { ...c, start: Math.max(0, c.start - removed) } : c,
      );
    }

    commit(clips, "Remove silence");
    setSegments(null);
    setApproved([]);
    toast(`Removed ${plan.savedSeconds.toFixed(1)}s of silence`, "success");
  };

  return (
    <div className="space-y-3 px-2 pb-4">
      <p className="text-[11px] leading-relaxed text-muted">
        Select a clip, detect its silent parts, review the list, then remove only what you approve.
        Nothing changes until you press Remove.
      </p>
      <Slider label="Silence threshold" value={threshold} min={-70} max={-15} format={(v) => `${v} dB`} onChange={setThreshold} />
      <Slider label="Minimum silence" value={minDuration} min={0.2} max={3} step={0.1} format={(v) => `${v.toFixed(1)}s`} onChange={setMinDuration} />
      <div className="flex items-center justify-between text-[11px]">
        <span>Close gaps afterwards</span>
        <Switch checked={closeGaps} onChange={setCloseGaps} label="Close gaps" />
      </div>

      <Button variant="primary" size="sm" className="w-full justify-center" onClick={() => void analyse()} disabled={busy}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Detect silence
      </Button>

      {segments && (
        <>
          <div className="flex items-center justify-between text-[10px] text-muted">
            <span>{segments.length} segments · {approved.length} approved</span>
            <button className="hover:text-content" onClick={() => setApproved(approved.length === segments.length ? [] : segments.map((s) => s.id))}>
              {approved.length === segments.length ? "Clear" : "Approve all"}
            </button>
          </div>
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {segments.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded border border-border-subtle bg-surface px-2 py-1 text-[10px]">
                <input
                  type="checkbox"
                  checked={approved.includes(s.id)}
                  onChange={(e) =>
                    setApproved(e.target.checked ? [...approved, s.id] : approved.filter((id) => id !== s.id))
                  }
                  aria-label={`Approve silence ${s.id}`}
                />
                <span className="font-mono">
                  {formatTime(s.start)} → {formatTime(s.end)}
                </span>
                <span className="ml-auto text-muted">{(s.end - s.start).toFixed(1)}s</span>
              </li>
            ))}
          </ul>
          <Button variant="secondary" size="sm" className="w-full justify-center" onClick={apply} disabled={approved.length === 0}>
            <Square size={11} /> Remove approved
          </Button>
        </>
      )}
    </div>
  );
}

/* ========================================================================== */
/*  Voice enhancement                                                          */
/* ========================================================================== */

export function VoicePanel() {
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.selectedClipIds);
  const commit = useEditor((s) => s.commit);
  const [preset, setPreset] = useState("clean");
  const [intensity, setIntensity] = useState(1);
  const [analysis, setAnalysis] = useState<ReturnType<typeof analyseVoice> | null>(null);
  const [busy, setBusy] = useState(false);

  const clip = project.clips.find((c) => c.id === selected[0]);

  const analyse = async () => {
    if (!clip?.mediaId) return toast("Select a clip first", "error");
    setBusy(true);
    try {
      const buffer = await decodeAsset(clip.mediaId);
      if (!buffer) return toast("No audio in that clip", "error");
      const result = analyseVoice(buffer.getChannelData(0), buffer.sampleRate);
      setAnalysis(result);
      setPreset(result.recommendation);
    } finally {
      setBusy(false);
    }
  };

  const apply = (enabled: boolean) => {
    if (!clip) return;
    commit(
      project.clips.map((c) =>
        c.id === clip.id ? { ...c, voice: enabled ? { preset, intensity } : { preset: "none", intensity: 0 } } : c,
      ),
      "Voice enhancement",
    );
    toast(enabled ? "Voice enhancement applied to this clip (preview + export)" : "Voice enhancement removed", "success");
  };

  const renderFile = async () => {
    if (!clip) return;
    setBusy(true);
    try {
      const blob = await renderClipAudio({ ...clip, voice: { preset, intensity } });
      if (!blob) return toast("Could not render that clip", "error");
      const asset = await saveGeneratedAsset({
        blob,
        name: `${clip.name.replace(/\.[^.]+$/, "")}-enhanced.wav`,
        kind: "audio",
        duration: clip.duration,
      });
      useEditor.getState().addAssets([asset]);
      toast("Enhanced audio saved to the media library", "success");
    } finally {
      setBusy(false);
    }
  };

  const plan = planVoiceChain(presetById(preset), intensity);

  return (
    <div className="space-y-3 px-2 pb-4">
      <p className="text-[11px] leading-relaxed text-muted">
        Non-destructive: the original media is never modified. The chain is applied live in the preview
        and baked into exports only for this clip.
      </p>
      <Button size="sm" variant="secondary" className="w-full justify-center" onClick={() => void analyse()} disabled={busy}>
        <Sparkles size={12} /> Analyse clip
      </Button>
      {analysis && (
        <div className="rounded border border-border-subtle bg-surface p-2 text-[10px] leading-relaxed">
          <div className="flex justify-between"><span>Level</span><span className="font-mono">{analysis.rmsDb.toFixed(1)} dB</span></div>
          <div className="flex justify-between"><span>Noise floor</span><span className="font-mono">{analysis.noiseFloorDb.toFixed(1)} dB</span></div>
          <div className="flex justify-between"><span>Speech</span><span className="font-mono">{analysis.speechDb.toFixed(1)} dB</span></div>
          <div className="flex justify-between"><span>SNR</span><span className="font-mono">{analysis.snrDb.toFixed(1)} dB</span></div>
          <p className="mt-1 text-brand">Recommended: {presetById(analysis.recommendation).name}</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-1">
        {VOICE_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPreset(p.id)}
            className={cn(
              "rounded border px-1.5 py-1 text-[10px]",
              preset === p.id ? "border-brand bg-brand/10 text-brand" : "border-border-subtle",
            )}
            title={p.description}
          >
            {p.name}
          </button>
        ))}
      </div>
      <Slider label="Intensity" value={intensity} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={setIntensity} />
      <p className="text-[10px] text-muted">
        Chain: {plan.highpass ? `high-pass ${Math.round(plan.highpass)} Hz · ` : ""}
        {plan.lowpass ? `low-pass ${Math.round(plan.lowpass)} Hz · ` : ""}
        {plan.presenceDb > 0 ? `presence +${plan.presenceDb.toFixed(1)} dB · ` : ""}
        {plan.compressor ? `compressor ${plan.compressor.ratio.toFixed(1)}:1` : "no compression"}
      </p>
      <div className="flex gap-1">
        <Button size="sm" variant="primary" className="flex-1 justify-center" onClick={() => apply(true)} disabled={!clip}>
          Apply
        </Button>
        <Button size="sm" variant="ghost" onClick={() => apply(false)} disabled={!clip}>
          Remove
        </Button>
      </div>
      <Button size="sm" variant="secondary" className="w-full justify-center" onClick={() => void renderFile()} disabled={busy || !clip}>
        Render enhanced WAV
      </Button>
    </div>
  );
}

/* ========================================================================== */
/*  Background removal                                                         */
/* ========================================================================== */

export function BackgroundPanel() {
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.selectedClipIds);
  const commit = useEditor((s) => s.commit);
  const caps = useDeviceCaps();
  const [kind, setKind] = useState<"transparent" | "color" | "image" | "blur">("color");
  const [color, setColor] = useState("#0ea5e9");
  const [imageUrl, setImageUrl] = useState<string | undefined>();
  const [matteUrl, setMatteUrl] = useState<string | undefined>();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const clip = project.clips.find((c) => c.id === selected[0]);
  const asset = project.assets.find((a) => a.id === clip?.mediaId);

  const preview = async () => {
    if (!clip || !asset?.url) return toast("Select a video or image clip first", "error");
    setBusy(true);
    setStatus("Loading model…");
    try {
      const el =
        asset.kind === "image"
          ? await new Promise<HTMLImageElement>((resolve, reject) => {
              const img = new Image();
              img.onload = () => resolve(img);
              img.onerror = reject;
              img.src = asset.url!;
            })
          : await (async () => {
              const video = document.createElement("video");
              video.src = asset.url!;
              video.muted = true;
              await new Promise((r) => (video.onloadeddata = r));
              video.currentTime = clip.inPoint + 0.1;
              await new Promise((r) => (video.onseeked = r));
              return video;
            })();
      const matte = await computeMatte(el, { onStatus: setStatus });
      const canvas = document.createElement("canvas");
      canvas.width = matte.width;
      canvas.height = matte.height;
      const ctx = canvas.getContext("2d")!;
      const image = ctx.createImageData(matte.width, matte.height);
      for (let i = 0; i < matte.alpha.length; i++) {
        image.data[i * 4] = 255;
        image.data[i * 4 + 1] = 255;
        image.data[i * 4 + 2] = 255;
        image.data[i * 4 + 3] = matte.alpha[i];
      }
      ctx.putImageData(image, 0, 0);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("Could not encode the matte");
      await putAuxBlob(`matte:${clip.id}`, blob);
      setMatteUrl(URL.createObjectURL(blob));
      setStatus("Matte ready — preview it in the canvas");
      toast("Subject isolated. Apply to composite it.", "success");
    } catch (err) {
      setStatus(null);
      toast((err as Error).message || "Background removal failed — this device may not support the model", "error");
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!clip) return;
    if (!matteUrl) return toast("Generate the matte first", "error");
    commit(
      project.clips.map((c) =>
        c.id === clip.id
          ? {
              ...c,
              background: {
                enabled: true,
                kind,
                color,
                imageUrl: kind === "image" ? imageUrl : undefined,
                matteUrl,
                matteBlobId: `matte:${clip.id}`,
                matteTime: c.inPoint,
                feather: 0,
              },
            }
          : c,
      ),
      "Background removal",
    );
    toast("Background applied — original media untouched", "success");
  };

  return (
    <div className="space-y-3 px-2 pb-4">
      <DeviceBadge caps={caps} />
      <p className="text-[11px] leading-relaxed text-muted">
        Portrait segmentation (MODNet, ~{MODELS["selfie-segmentation"].sizeMb} MB) runs on this device.
        The matte is captured for one frame of the selected clip and composited live — your file is never modified.
      </p>
      {caps && caps.tier === "low" && (
        <p className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
          Low-power device: matting one frame can take 5–20 seconds.
        </p>
      )}
      <Button variant="primary" size="sm" className="w-full justify-center" onClick={() => void preview()} disabled={busy}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
        {busy ? "Working…" : "Detect subject"}
      </Button>
      {status && <p className="text-[10px] text-brand">{status}</p>}

      {matteUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={matteUrl} alt="Detected subject matte" className="w-full rounded border border-border-subtle bg-[repeating-conic-gradient(#333_0_25%,#222_0_50%)] bg-[length:16px_16px]" />
          <div className="grid grid-cols-2 gap-1">
            {(["transparent", "color", "image", "blur"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={cn(
                  "rounded border px-1.5 py-1 text-[10px] capitalize",
                  kind === k ? "border-brand bg-brand/10 text-brand" : "border-border-subtle",
                )}
              >
                {k}
              </button>
            ))}
          </div>
          {kind === "color" && (
            <label className="flex items-center justify-between text-[10px] text-muted">
              Background colour
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-6 w-16 rounded border border-border-subtle" />
            </label>
          )}
          {kind === "image" && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setImageUrl(URL.createObjectURL(f));
                  e.target.value = "";
                }}
              />
              <Button size="sm" variant="secondary" className="w-full justify-center" onClick={() => fileRef.current?.click()}>
                Choose background image
              </Button>
            </>
          )}
          <Button variant="primary" size="sm" className="w-full justify-center" onClick={apply}>
            Apply to clip
          </Button>
          {clip?.background?.enabled && (
            <Button
              size="sm"
              variant="ghost"
              className="w-full justify-center"
              onClick={() =>
                commit(project.clips.map((c) => (c.id === clip.id ? { ...c, background: undefined } : c)), "Remove background")
              }
            >
              Remove background
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/* ========================================================================== */
/*  Smart reframe                                                              */
/* ========================================================================== */

export function ReframePanel() {
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.selectedClipIds);
  const commit = useEditor((s) => s.commit);
  const [target, setTarget] = useState<AspectRatio>("9:16");
  const [subject, setSubject] = useState<Box | null>(null);
  const [manualX, setManualX] = useState(50);
  const [manualY, setManualY] = useState(50);
  const [busy, setBusy] = useState(false);

  const clip = project.clips.find((c) => c.id === selected[0]);
  const asset = project.assets.find((a) => a.id === clip?.mediaId);
  const source = { width: asset?.width || 1920, height: asset?.height || 1080 };
  const focus = subject
    ? { x: subject.x + subject.w / 2, y: subject.y + subject.h / 2 }
    : { x: manualX / 100, y: manualY / 100 };
  const crop = cropFor(source, ASPECT_TARGETS[target].ratio, focus, subject);
  const transform = cropToTransform(crop, source);

  const detect = async () => {
    if (!asset?.url) return toast("Select a video clip first", "error");
    setBusy(true);
    try {
      const video = document.createElement("video");
      video.src = asset.url;
      video.muted = true;
      await new Promise((r) => (video.onloadeddata = r));
      video.currentTime = clip?.inPoint ?? 0;
      await new Promise((r) => (video.onseeked = r));
      const face = await detectFace(video);
      if (face) {
        setSubject(face);
        toast("Face detected — the crop will follow it", "success");
      } else {
        toast(
          faceDetectionSupported()
            ? "No face found in this frame; using manual focus"
            : "This browser has no on-device face detection; using manual focus",
          "info",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!clip) return toast("Select a clip first", "error");
    const preset = ASPECT_PRESETS[target];
    useEditor.setState({
      project: {
        ...useEditor.getState().project,
        settings: {
          ...useEditor.getState().project.settings,
          width: preset.width,
          height: preset.height,
          aspectRatio: target,
        },
        clips: useEditor.getState().project.clips.map((c) =>
          c.id === clip.id
            ? { ...c, transform: { ...c.transform, scale: transform.scale, x: transform.x, y: transform.y } }
            : c,
        ),
      },
    });
    commit(useEditor.getState().project.clips, "Smart reframe");
    toast(`Reframed to ${target}`, "success");
  };

  return (
    <div className="space-y-3 px-2 pb-4">
      <p className="text-[11px] leading-relaxed text-muted">
        Crop rectangle is computed for the selected clip. Face detection uses the browser when available;
        otherwise drag the manual focus.
      </p>
      <div className="grid grid-cols-2 gap-1">
        {(Object.keys(ASPECT_TARGETS) as AspectRatio[]).filter((k) => ASPECT_PRESETS[k]).map((k) => (
          <button
            key={k}
            onClick={() => setTarget(k)}
            className={cn(
              "rounded border px-1.5 py-1 text-[10px]",
              target === k ? "border-brand bg-brand/10 text-brand" : "border-border-subtle",
            )}
          >
            {ASPECT_TARGETS[k].label}
          </button>
        ))}
      </div>
      <Button size="sm" variant="secondary" className="w-full justify-center" onClick={() => void detect()} disabled={busy}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Detect face
      </Button>
      <Slider label="Focus X" value={manualX} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => { setSubject(null); setManualX(v); }} />
      <Slider label="Focus Y" value={manualY} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => { setSubject(null); setManualY(v); }} />
      <div className="rounded border border-border-subtle bg-surface p-2 text-[10px]">
        <div className="flex justify-between"><span>Source</span><span className="font-mono">{source.width}×{source.height}</span></div>
        <div className="flex justify-between"><span>Crop</span><span className="font-mono">{crop.w}×{crop.h} at {crop.x},{crop.y}</span></div>
        <div className="flex justify-between"><span>Scale</span><span className="font-mono">{transform.scale.toFixed(2)}×</span></div>
      </div>
      <Button variant="primary" size="sm" className="w-full justify-center" onClick={apply} disabled={!clip}>
        Apply reframe
      </Button>
    </div>
  );
}

/* ========================================================================== */
/*  Highlight detection                                                        */
/* ========================================================================== */

export function HighlightsPanel() {
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.selectedClipIds);
  const commit = useEditor((s) => s.commit);
  const scenes = useAnalysis((s) => s.scenes);
  const [busy, setBusy] = useState(false);
  const [highlights, setHighlights] = useState<{ id: string; start: number; end: number; score: number; reasons: string[] }[]>([]);

  const clip = project.clips.find((c) => c.id === selected[0]);
  const asset = project.assets.find((a) => a.id === clip?.mediaId);

  const detect = async () => {
    if (!asset?.url || asset?.kind !== "video") return toast("Select a video clip first", "error");
    setBusy(true);
    try {
      const { samples } = await sampleVideoForScenes(asset.url, { interval: 1, maxSamples: 120 });
      // Loudness per second from the decoded audio, when available.
      const buffer = clip?.mediaId ? await decodeAsset(clip.mediaId) : null;
      const perSecond: number[] = [];
      if (buffer) {
        const data = buffer.getChannelData(0);
        const step = Math.floor(buffer.sampleRate);
        for (let i = 0; i < data.length; i += step) {
          let sum = 0;
          const end = Math.min(data.length, i + step);
          for (let j = i; j < end; j++) sum += data[j] * data[j];
          perSecond.push(Math.sqrt(sum / Math.max(1, end - i)));
        }
      }
      const motion = samples.map((s, i) => {
        const prev = samples[i - 1] ?? s;
        let diff = 0;
        for (let k = 0; k < s.histogram.length; k++) diff += Math.abs(s.histogram[k] - prev.histogram[k]);
        return { time: s.time, motion: Math.min(1, diff / 2), loudness: perSecond[Math.floor(s.time)] ?? 0 };
      });
      const { findHighlights } = await import("@/lib/ai/highlights");
      const found = findHighlights(motion, clip!.duration, { count: 3 });
      setHighlights(found);
      toast(found.length ? `${found.length} highlight suggestions` : "No strong highlights found", found.length ? "success" : "info");
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!clip || highlights.length === 0) return;
    // Build a highlight reel on the same track, after the original clip.
    let clips = [...useEditor.getState().project.clips];
    let cursor = clip.start + clip.duration + 0.5;
    for (const h of highlights) {
      const segment = {
        ...clip,
        id: `${clip.id}_hl_${h.id}`,
        name: `${clip.name} · highlight`,
        start: cursor,
        inPoint: clip.inPoint + h.start * clip.speed,
        duration: (h.end - h.start) / clip.speed,
      };
      clips = [...clips, segment];
      cursor += segment.duration;
    }
    commit(clips, "Highlight reel");
    toast(`Added ${highlights.length} highlight clips — original untouched`, "success");
  };

  return (
    <div className="space-y-3 px-2 pb-4">
      <p className="text-[11px] leading-relaxed text-muted">
        Scores motion and audio energy to suggest the liveliest moments. Source clips are never deleted —
        approved highlights are added as a reel after the original.
      </p>
      <Button variant="primary" size="sm" className="w-full justify-center" onClick={() => void detect()} disabled={busy}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Find highlights
      </Button>
      {scenes && <p className="text-[10px] text-muted">Scene detection already found {scenes.cuts.length} cuts.</p>}
      {highlights.length > 0 && (
        <>
          <ul className="space-y-1">
            {highlights.map((h) => (
              <li key={h.id} className="rounded border border-border-subtle bg-surface px-2 py-1 text-[10px]">
                <div className="flex justify-between">
                  <span className="font-mono">{formatTime(h.start)} → {formatTime(h.end)}</span>
                  <span className="text-brand">{Math.round(h.score * 100)}%</span>
                </div>
                <span className="text-muted">{h.reasons.join(", ")}</span>
              </li>
            ))}
          </ul>
          <Button variant="secondary" size="sm" className="w-full justify-center" onClick={apply}>
            <Play size={11} /> Add highlight reel
          </Button>
        </>
      )}
    </div>
  );
}

/* ========================================================================== */
/*  Text to speech                                                             */
/* ========================================================================== */

export function TtsPanel() {
  const project = useEditor((s) => s.project);
  const commit = useEditor((s) => s.commit);
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState("aria");
  const [rate, setRate] = useState(1);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (!text.trim()) return toast("Type the line you want spoken", "error");
    setBusy(true);
    try {
      const { synthesise } = await import("@/lib/ai/tts");
      const { blob, duration } = synthesise(text, { voiceId, rate });
      const asset = await saveGeneratedAsset({
        blob,
        name: `voice-${voiceId}-${Math.round(duration)}s.wav`,
        kind: "audio",
        duration,
        tts: { text, voice: voiceId, rate, pitch: 1, lang: "en" },
      });
      useEditor.getState().addAssets([asset]);
      const track = project.tracks.find((t) => t.kind === "audio");
      if (track) {
        const clips = useEditor.getState().project.clips;
        const start = clips.reduce((m, c) => (c.trackId === track.id ? Math.max(m, c.start + c.duration) : m), 0);
        const clip = {
          ...(await import("@/lib/timeline")).makeClip({
            trackId: track.id,
            mediaId: asset.id,
            name: asset.name,
            start,
            duration,
            sourceDuration: duration,
          }),
        };
        commit([...clips, clip], "Text to speech");
      }
      toast("Voice clip added to the audio track", "success");
    } catch (err) {
      toast((err as Error).message || "Speech generation failed", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 px-2 pb-4">
      <p className="text-[11px] leading-relaxed text-muted">
        SafeCut renders a synthesised voice locally (no account, no upload) into a WAV asset on its own
        audio track. It is a clear synthetic voice, not a human recording.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="Type the narration line…"
        className="w-full resize-none rounded border border-border-subtle bg-surface px-2 py-1.5 text-[11px] outline-none focus:border-brand"
        aria-label="Text to speak"
      />
      <label className="block text-[10px] text-muted">
        Voice
        <select
          value={voiceId}
          onChange={(e) => setVoiceId(e.target.value)}
          className="mt-0.5 w-full rounded border border-border-subtle bg-surface px-1.5 py-1 text-[11px] text-content"
        >
          {["aria", "juno", "orion", "atlas", "kid"].map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <Slider label="Speed" value={rate} min={0.6} max={1.8} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={setRate} />
      <Button variant="primary" size="sm" className="w-full justify-center" onClick={() => void generate()} disabled={busy}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} Generate voice clip
      </Button>
    </div>
  );
}

/* ========================================================================== */
/*  Creator assistant                                                          */
/* ========================================================================== */

export function AssistantPanel() {
  const project = useEditor((s) => s.project);
  const [topic, setTopic] = useState("");
  const [script, setScript] = useState("");
  const [result, setResult] = useState<{
    title: string;
    body: string;
    provider: "local" | "server";
    actions?: { kind: "aspect"; value: string }[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [useServer, setUseServer] = useState(false);
  const [serverOk, setServerOk] = useState<boolean | null>(null);

  useEffect(() => {
    void import("@/lib/ai/assistant").then((m) => m.serverAvailable().then(setServerOk));
  }, []);

  const run = async (taskId: string) => {
    setBusy(true);
    try {
      const { contextFromProject, runTask } = await import("@/lib/ai/assistant");
      const ctx = contextFromProject(project, { topic, script });
      const res = await runTask(taskId, ctx, { useServer: useServer && Boolean(serverOk) });
      setResult(res);
    } finally {
      setBusy(false);
    }
  };

  const applyAspect = (value: string) => {
    const preset = ASPECT_PRESETS[value as AspectRatio];
    if (!preset) return;
    useEditor.setState({
      project: {
        ...useEditor.getState().project,
        settings: { ...useEditor.getState().project.settings, ...preset, aspectRatio: value as AspectRatio },
      },
    });
    toast(`Project set to ${value}`, "success");
  };

  const tasks: { id: string; label: string }[] = [
    { id: "titles", label: "Titles" },
    { id: "description", label: "Description" },
    { id: "captions", label: "Captions" },
    { id: "aspect", label: "Aspect" },
    { id: "improvements", label: "Improve" },
    { id: "plan", label: "Script plan" },
  ];

  return (
    <div className="space-y-3 px-2 pb-4">
      <p className="text-[11px] leading-relaxed text-muted">
        Suggestions only — nothing is applied to the timeline unless you press an apply button.
      </p>
      <input
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="Topic (optional)"
        className="w-full rounded border border-border-subtle bg-surface px-2 py-1 text-[11px] outline-none focus:border-brand"
        aria-label="Video topic"
      />
      <textarea
        value={script}
        onChange={(e) => setScript(e.target.value)}
        rows={3}
        placeholder="Paste a script for an editing plan…"
        className="w-full resize-none rounded border border-border-subtle bg-surface px-2 py-1.5 text-[11px] outline-none focus:border-brand"
        aria-label="Script"
      />
      <div className="grid grid-cols-3 gap-1">
        {tasks.map((t) => (
          <Button key={t.id} size="sm" variant="secondary" className="justify-center text-[10px]" onClick={() => void run(t.id)} disabled={busy}>
            {t.label}
          </Button>
        ))}
      </div>
      <label className="flex items-center justify-between text-[10px] text-muted">
        Use server AI when configured
        <Switch checked={useServer} onChange={setUseServer} label="Use server AI" />
      </label>
      {serverOk === false && (
        <p className="text-[10px] text-muted">No server key configured — using the built-in offline assistant.</p>
      )}
      {busy && <Loader2 size={14} className="animate-spin text-brand" />}
      {result && (
        <div className="rounded border border-border-subtle bg-surface p-2">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold">
            <BrainCircuit size={12} className="text-brand" /> {result.title}
            <span className="ml-auto text-[9px] text-muted">{result.provider === "server" ? "AI" : "offline"}</span>
          </div>
          <pre className="whitespace-pre-wrap text-[10px] leading-relaxed text-muted">{result.body}</pre>
          {result.actions?.map((a) =>
            a.kind === "aspect" ? (
              <Button key={a.value} size="sm" variant="primary" className="mt-2 w-full justify-center" onClick={() => applyAspect(a.value)}>
                <ChevronDown size={11} /> Set project to {a.value}
              </Button>
            ) : null,
          )}
          <Button
            size="sm"
            variant="ghost"
            className="mt-1 w-full justify-center"
            onClick={() => {
              void navigator.clipboard?.writeText(result.body);
              toast("Copied", "success");
            }}
          >
            Copy
          </Button>
        </div>
      )}
      <p className="text-[10px] text-muted">
        <Pause size={9} className="mr-1 inline" />
        {project.clips.length} clips · {formatTime(project.duration)} · {project.settings.aspectRatio}
      </p>
    </div>
  );
}
