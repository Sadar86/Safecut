"use client";

import { useState } from "react";
import { AudioWaveform, Download, Scissors, Sparkles, Trash2, Volume2, Wand2 } from "lucide-react";
import { useEditor } from "@/stores/editor";
import { Button, SectionTitle, Slider, Switch, toast } from "@/components/ui";
import { WaveformPreview } from "@/components/waveform";
import { decodeAsset, renderTimelineAudio } from "@/lib/audio";
import { applyFades, detectSilence, encodeWav, reduceNoise } from "@/lib/audio-math";
import { transcodeToMp3 } from "@/lib/ffmpeg";
import { findGap, makeClip, splitClip } from "@/lib/timeline";
import { downloadBlob, formatTime, uid } from "@/lib/utils";
import type { Clip, MediaAsset } from "@/types";

/** Create an object URL (wrapper keeps the impure call out of component bodies). */
function makeObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

/**
 * Audio studio: per-clip processing (fades, noise reduction, voice enhance,
 * ducking), silence detection with auto-trim, audio extraction from video and
 * WAV / MP3 export of the timeline mix.
 */
export function AudioStudioPanel() {
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.selectedClipIds);
  const commit = useEditor((s) => s.commit);
  const addAssets = useEditor((s) => s.addAssets);
  const select = useEditor((s) => s.select);
  const [busy, setBusy] = useState<string | null>(null);

  const clip = project.clips.find((c) => c.id === selected[0]);
  const audioAssets = project.assets.filter((a) => a.kind === "audio" || (a.kind === "video" && a.hasAudio));

  const patchAudio = (patch: Partial<Clip["audio"]>) => {
    if (!clip) return;
    commit(project.clips.map((c) => (c.id === clip.id ? { ...c, audio: { ...c.audio, ...patch } } : c)), "Audio edit");
  };

  const extractAudio = async (source: MediaAsset) => {
    setBusy(`extract:${source.id}`);
    try {
      const buffer = await decodeAsset(source.id);
      if (!buffer) return toast("That file has no decodable audio track", "error");
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
      const wav = encodeWav(channels, buffer.sampleRate);
      const blob = new Blob([wav], { type: "audio/wav" });
      const id = uid("ast");
      // eslint-disable-next-line react-hooks/purity -- created inside an async click handler
      const createdAt = Date.now();
      const newAsset: MediaAsset = {
        id,
        name: `${source.name.replace(/\.[^.]+$/, "")}.wav`,
        kind: "audio",
        mimeType: "audio/wav",
        size: blob.size,
        duration: buffer.duration,
        width: 0,
        height: 0,
        url: makeObjectUrl(blob),
        createdAt,
        hasAudio: true,
      };
      const { putBlob } = await import("@/lib/storage");
      await putBlob(id, blob);
      addAssets([newAsset]);

      const track = project.tracks.find((t) => t.kind === "audio");
      if (track) {
        const clips = useEditor.getState().project.clips;
        const newClip = makeClip({
          trackId: track.id,
          mediaId: id,
          name: newAsset.name,
          start: findGap(clips, track.id, buffer.duration, 0),
          duration: buffer.duration,
          sourceDuration: buffer.duration,
        });
        commit([...clips, newClip], "Extract audio");
        select([newClip.id]);
      }
      toast("Audio extracted to its own track", "success");
    } catch (err) {
      toast((err as Error).message || "Extraction failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const findSilence = async () => {
    if (!clip?.mediaId) return toast("Select an audio or video clip first", "error");
    setBusy("silence");
    try {
      const buffer = await decodeAsset(clip.mediaId);
      if (!buffer) return toast("No audio in that clip", "error");
      const channel = buffer.getChannelData(0);
      const from = Math.floor(clip.inPoint * buffer.sampleRate);
      const to = Math.floor((clip.inPoint + clip.duration * clip.speed) * buffer.sampleRate);
      const slice = channel.subarray(from, Math.min(to, channel.length));
      const ranges = detectSilence(slice, buffer.sampleRate, -42, 0.5);
      if (ranges.length === 0) return toast("No silence detected at -42 dB", "info");
      // Remove silent ranges by splitting the clip into speech segments.
      let clips = useEditor.getState().project.clips;
      for (const range of ranges) {
        const cutStart = clip.start + range.start / clip.speed;
        const cutEnd = clip.start + range.end / clip.speed;
        clips = splitClip(clips, clip.id, cutStart);
        const middle = clips.find((c) => c.start >= cutStart - 0.001 && c.start < cutEnd && c.id !== clip.id);
        if (middle) clips = clips.filter((c) => c.id !== middle.id);
      }
      commit(clips, "Remove silence");
      toast(`${ranges.length} silent sections found, removed`, "success");
    } finally {
      setBusy(null);
    }
  };

  const exportMix = async (format: "wav" | "mp3") => {
    setBusy(`mix:${format}`);
    try {
      const wav = await renderTimelineAudio(project);
      if (!wav) return toast("Nothing audible to export", "error");
      const wavBlob = new Blob([wav], { type: "audio/wav" });
      if (format === "wav") {
        downloadBlob(wavBlob, `${project.name.replace(/\s+/g, "-")}.wav`);
        return toast("WAV exported", "success");
      }
      const mp3 = await transcodeToMp3(wavBlob, 192, (ratio) => setBusy(`mix:mp3:${Math.round(ratio * 100)}%`));
      downloadBlob(mp3, `${project.name.replace(/\s+/g, "-")}.mp3`);
      toast("MP3 exported (FFmpeg.wasm)", "success");
    } catch (err) {
      toast((err as Error).message || "Audio export failed — WAV still works", "error");
    } finally {
      setBusy(null);
    }
  };

  const denoisePreview = async () => {
    if (!clip?.mediaId) return;
    setBusy("denoise");
    try {
      const buffer = await decodeAsset(clip.mediaId);
      if (!buffer) return;
      const cleaned = reduceNoise(buffer.getChannelData(0), 0.02, 0.15);
      const faded = applyFades(cleaned, buffer.sampleRate, clip.audio.fadeIn, clip.audio.fadeOut);
      const blob = new Blob([encodeWav([faded], buffer.sampleRate)], { type: "audio/wav" });
      downloadBlob(blob, `${clip.name.replace(/\.[^.]+$/, "")}-denoised.wav`);
      toast("Denoised clip rendered to WAV", "success");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="pb-4">
      <SectionTitle>Audio clips</SectionTitle>
      {audioAssets.length === 0 ? (
        <p className="px-3 pb-2 text-[11px] text-muted">
          Import a video or audio file in the Media tab. Video audio can be extracted to its own track.
        </p>
      ) : (
        <ul className="space-y-1 px-2">
          {audioAssets.map((a) => (
            <li key={a.id} className="rounded border border-border-subtle bg-surface p-1.5">
              <div className="flex items-center gap-1.5 text-[11px]">
                <Volume2 size={12} className="shrink-0 text-brand" />
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                <span className="font-mono text-[10px] text-muted">{formatTime(a.duration)}</span>
              </div>
              <div className="mt-1 flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => void extractAudio(a)} disabled={busy === `extract:${a.id}`}>
                  <AudioWaveform size={11} /> Extract
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const track = project.tracks.find((t) => t.kind === "audio");
                    if (!track) return toast("Add an audio track first", "error");
                    const clips = useEditor.getState().project.clips;
                    const c = makeClip({
                      trackId: track.id,
                      mediaId: a.id,
                      name: a.name,
                      start: findGap(clips, track.id, a.duration || 5, 0),
                      duration: a.duration || 5,
                      sourceDuration: a.duration || 5,
                    });
                    commit([...clips, c], "Add audio");
                    select([c.id]);
                  }}
                >
                  Add to track
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>Selected clip</SectionTitle>
      {!clip ? (
        <p className="px-3 text-[11px] text-muted">Select an audio or video clip on the timeline.</p>
      ) : (
        <div className="space-y-3 px-2">
          {clip.mediaId && <WaveformPreview assetId={clip.mediaId} />}
          <Slider label="Volume" value={clip.audio.volume} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patchAudio({ volume: v })} />
          <Slider label="Fade in" value={clip.audio.fadeIn} min={0} max={5} step={0.1} format={(v) => `${v.toFixed(1)}s`} onChange={(v) => patchAudio({ fadeIn: v })} />
          <Slider label="Fade out" value={clip.audio.fadeOut} min={0} max={5} step={0.1} format={(v) => `${v.toFixed(1)}s`} onChange={(v) => patchAudio({ fadeOut: v })} />
          <Slider label="Noise reduction" value={clip.audio.denoise ?? 0} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patchAudio({ denoise: v })} />

          <div className="flex items-center justify-between text-[11px]">
            <span>Voice enhance</span>
            <Switch
              checked={clip.audio.enhance === "voice"}
              onChange={(v) => patchAudio({ enhance: v ? "voice" : "none" })}
              label="Voice enhance"
            />
          </div>

          <div className="rounded border border-border-subtle bg-surface p-2">
            <div className="flex items-center justify-between text-[11px]">
              <span>Auto ducking</span>
              <Switch
                checked={Boolean(clip.audio.ducking?.enabled)}
                onChange={(v) =>
                  patchAudio({
                    ducking: { enabled: v, trigger: "video", amount: 0.35, attack: 0.2, release: 0.4 },
                  })
                }
                label="Auto ducking"
              />
            </div>
            {clip.audio.ducking?.enabled && (
              <div className="mt-2">
                <Slider
                  label="Duck to"
                  value={clip.audio.ducking.amount}
                  min={0.05}
                  max={1}
                  step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => patchAudio({ ducking: { ...clip.audio.ducking!, amount: v } })}
                />
                <p className="mt-1 text-[10px] text-muted">Music drops while clips on the trigger track play.</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-1">
            <Button size="sm" variant="secondary" onClick={() => void findSilence()} disabled={busy === "silence"}>
              <Scissors size={11} /> Remove silence
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void denoisePreview()} disabled={busy === "denoise"}>
              <Sparkles size={11} /> Denoise → WAV
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => commit(splitClip(project.clips, clip.id, clip.start + clip.duration / 2), "Split audio")}
            >
              Split in half
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                commit(project.clips.filter((c) => c.id !== clip.id), "Delete clip");
                select([]);
              }}
            >
              <Trash2 size={11} /> Delete clip
            </Button>
          </div>
        </div>
      )}

      <SectionTitle>Export audio</SectionTitle>
      <div className="grid grid-cols-2 gap-1 px-2">
        <Button size="sm" variant="secondary" onClick={() => void exportMix("wav")} disabled={Boolean(busy)}>
          <Download size={11} /> WAV mix
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void exportMix("mp3")} disabled={Boolean(busy)}>
          <Wand2 size={11} /> MP3 mix
        </Button>
      </div>
      {busy && <p className="px-3 pt-2 text-[10px] text-brand">Working… {busy}</p>}
    </div>
  );
}
