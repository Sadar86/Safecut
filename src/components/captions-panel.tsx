"use client";

import { useMemo, useRef, useState } from "react";
import {
  Captions,
  Download,
  FileUp,
  Mic,
  Play,
  Plus,
  Sparkles,
  Square,
  Trash2,
  Wand2,
} from "lucide-react";
import { useEditor } from "@/stores/editor";
import { Button, SectionTitle, toast } from "@/components/ui";
import type { SubtitleCue } from "@/types";
import { CAPTION_TEMPLATES, captionTrack, clipsToCues, cuesToClips, templateById } from "@/lib/captions";
import { parseSubtitles, toSRT, toVTT, toTranscript } from "@/lib/subtitles";
import { availableTranscribers, segmentsToCues } from "@/lib/transcribe";
import { downloadBlob, formatTime, uid } from "@/lib/utils";
import { cn } from "@/lib/utils";

type Mode = "template" | "editor";

/**
 * Caption studio: subtitle list with inline editing, timing nudges, SRT/VTT
 * import + export, caption templates and on-device speech recognition.
 */
export function CaptionsPanel() {
  const project = useEditor((s) => s.project);
  const commit = useEditor((s) => s.commit);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const playhead = useEditor((s) => s.playhead);
  const [mode, setMode] = useState<Mode>("template");
  const [templateId, setTemplateId] = useState("clean");
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const captionClips = useMemo(
    () =>
      project.clips
        .filter((c) => c.text && project.tracks.find((t) => t.id === c.trackId)?.name.toLowerCase().includes("caption"))
        .sort((a, b) => a.start - b.start),
    [project.clips, project.tracks],
  );

  const cues: SubtitleCue[] = useMemo(() => {
    if (project.captions && project.captions.length > 0) return project.captions;
    return clipsToCues(captionClips);
  }, [project.captions, captionClips]);

  const setCues = (next: SubtitleCue[]) => {
    useEditor.setState({ project: { ...useEditor.getState().project, captions: next } });
  };

  const importFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseSubtitles(text);
    if (parsed.length === 0) return toast("No cues found in that file", "error");
    setCues(parsed);
    toast(`${parsed.length} cues imported`, "success");
  };

  const exportFile = (kind: "srt" | "vtt" | "txt") => {
    if (cues.length === 0) return toast("No captions to export yet", "error");
    const body = kind === "srt" ? toSRT(cues) : kind === "vtt" ? toVTT(cues) : toTranscript(cues);
    const mime = kind === "vtt" ? "text/vtt" : kind === "txt" ? "text/plain" : "application/x-subrip";
    downloadBlob(new Blob([body], { type: mime }), `${project.name.replace(/\s+/g, "-")}.${kind}`);
    toast(`${kind.toUpperCase()} exported`, "success");
  };

  const applyToTimeline = (templateIdToUse = templateId) => {
    if (cues.length === 0) return toast("Add or import captions first", "error");
    const template = templateById(templateIdToUse);
    const { project: withTrack, trackId } = captionTrack(project);
    const existing = withTrack.clips.filter((c) => c.trackId !== trackId);
    const clips = cuesToClips(cues, trackId, template);
    commit([...existing, ...clips], "Build captions");
    useEditor.setState({ project: { ...useEditor.getState().project, tracks: withTrack.tracks } });
    toast(`${clips.length} caption clips added`, "success");
  };

  const transcribe = async () => {
    const transcribers = availableTranscribers();
    if (transcribers.length === 0) {
      return toast(
        "This browser has no speech recognition. Import an SRT/VTT file instead, or use Chrome/Edge.",
        "error",
      );
    }
    const audioClip = project.clips.find((c) => c.mediaId);
    const asset = project.assets.find((a) => a.id === audioClip?.mediaId) ?? project.assets.find((a) => a.kind !== "image");
    if (!asset?.url) return toast("Import a video or audio clip first", "error");
    setBusy(true);
    setPartial("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const segments = await transcribers[0].transcribe(asset.url, {
        lang: navigator.language || "en-US",
        signal: controller.signal,
        onProgress: (_ratio, interim) => setPartial(interim ?? ""),
      });
      const generated = segmentsToCues(segments);
      if (generated.length === 0) return toast("No speech detected", "error");
      setCues(generated);
      toast(`${generated.length} caption cues created — review and apply`, "success");
      setMode("editor");
    } catch (err) {
      toast((err as Error).message || "Transcription failed", "error");
    } finally {
      setBusy(false);
      setPartial("");
      abortRef.current = null;
    }
  };

  return (
    <div>
      <div className="flex gap-1 border-b border-border-subtle px-2 py-1.5">
        {(["template", "editor"] as Mode[]).map((m) => (
          <Button key={m} size="sm" variant={mode === m ? "primary" : "ghost"} onClick={() => setMode(m)} className="flex-1 justify-center capitalize">
            {m === "template" ? "Templates" : `Cues (${cues.length})`}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 px-2 py-2">
        <Button size="sm" variant="secondary" onClick={() => void transcribe()} disabled={busy}>
          {busy ? <Square size={11} /> : <Mic size={12} />} {busy ? "Stop" : "Auto captions"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
          <FileUp size={12} /> Import
        </Button>
        <Button size="sm" variant="ghost" onClick={() => exportFile("srt")}>
          <Download size={12} /> SRT
        </Button>
        <Button size="sm" variant="ghost" onClick={() => exportFile("vtt")}>
          <Download size={12} /> VTT
        </Button>
        <Button size="sm" variant="ghost" onClick={() => exportFile("txt")}>
          <Download size={12} /> TXT
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".srt,.vtt,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = "";
          }}
          aria-label="Import subtitles"
        />
      </div>

      {busy && (
        <p className="px-3 pb-2 text-[11px] text-brand">
          <Sparkles size={11} className="mr-1 inline" />
          Listening… {partial && <span className="text-muted">{partial}</span>}
          <button className="ml-2 text-red-400" onClick={() => abortRef.current?.abort()}>
            cancel
          </button>
        </p>
      )}

      {mode === "template" ? (
        <>
          <SectionTitle>Caption templates</SectionTitle>
          <div className="grid grid-cols-2 gap-2 px-2">
            {CAPTION_TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTemplateId(t.id)}
                className={cn(
                  "overflow-hidden rounded-md border text-left",
                  templateId === t.id ? "border-brand ring-1 ring-brand/40" : "border-border-subtle hover:border-brand/50",
                )}
                title={t.description}
              >
                <div
                  className="flex h-12 items-center justify-center text-[11px] font-bold"
                  style={{ background: t.swatch.background, color: t.swatch.color }}
                >
                  Aa
                </div>
                <div className="bg-surface px-1.5 py-1 text-[10px]">{t.name}</div>
              </button>
            ))}
          </div>
          <div className="px-2 py-3">
            <Button variant="primary" className="w-full justify-center" onClick={() => applyToTimeline()}>
              <Captions size={13} /> Apply to timeline
            </Button>
            <p className="mt-2 text-[10px] leading-relaxed text-muted">
              Captions are text clips on a dedicated track, so you can restyle or retime them like any
              other clip. Word-by-word templates create one clip per word.
            </p>
          </div>
        </>
      ) : (
        <CueEditor cues={cues} setCues={setCues} playhead={playhead} onSeek={setPlayhead} />
      )}
    </div>
  );
}

function CueEditor({
  cues,
  setCues,
  playhead,
  onSeek,
}: {
  cues: SubtitleCue[];
  setCues: (cues: SubtitleCue[]) => void;
  playhead: number;
  onSeek: (t: number) => void;
}) {
  const update = (id: string, patch: Partial<SubtitleCue>) =>
    setCues(cues.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <div className="px-2 pb-4">
      <div className="my-2 flex gap-1">
        <Button
          size="sm"
          variant="secondary"
          className="flex-1 justify-center"
          onClick={() => setCues([...cues, { id: uid("cue"), start: playhead, end: playhead + 2, text: "New caption" }])}
        >
          <Plus size={12} /> Add cue at playhead
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setCues([...cues].sort((a, b) => a.start - b.start))}
          title="Sort by start time"
        >
          <Wand2 size={12} />
        </Button>
      </div>

      {cues.length === 0 ? (
        <p className="rounded border border-dashed border-border-subtle p-3 text-[11px] text-muted">
          No cues yet. Use Auto captions, import an SRT/VTT file, or add cues manually.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {cues.map((cue) => (
            <li key={cue.id} className="rounded-md border border-border-subtle bg-surface p-1.5">
              <div className="flex items-center gap-1 text-[10px] text-muted">
                <button onClick={() => onSeek(cue.start)} className="hover:text-brand" aria-label="Jump to cue">
                  <Play size={10} />
                </button>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  value={Number(cue.start.toFixed(2))}
                  onChange={(e) => update(cue.id, { start: Math.max(0, Number(e.target.value)) })}
                  className="w-14 rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px]"
                  aria-label="Cue start"
                />
                <span>→</span>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  value={Number(cue.end.toFixed(2))}
                  onChange={(e) => update(cue.id, { end: Math.max(cue.start + 0.1, Number(e.target.value)) })}
                  className="w-14 rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px]"
                  aria-label="Cue end"
                />
                <span className="ml-auto">{formatTime(cue.end - cue.start)}</span>
                <button
                  onClick={() => setCues(cues.filter((c) => c.id !== cue.id))}
                  className="hover:text-red-400"
                  aria-label="Delete cue"
                >
                  <Trash2 size={10} />
                </button>
              </div>
              <textarea
                value={cue.text}
                onChange={(e) => update(cue.id, { text: e.target.value })}
                rows={2}
                className="mt-1 w-full resize-none rounded bg-surface-2 px-1.5 py-1 text-[11px] outline-none focus:ring-1 focus:ring-brand"
                aria-label="Cue text"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
