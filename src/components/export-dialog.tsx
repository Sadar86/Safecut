"use client";

import { useRef, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { useEditor } from "@/stores/editor";
import { Button, Modal, toast } from "@/components/ui";
import { cn, downloadBlob } from "@/lib/utils";
import { renderProject } from "@/lib/exporter";
import type { ExportSettings } from "@/lib/exporter";
import { isFFmpegLoaded, loadFFmpeg, transcodeVideo } from "@/lib/ffmpeg";
import { recordBetaEvent } from "@/components/feedback";

const RESOLUTIONS = [
  { label: "480p", height: 480 },
  { label: "720p", height: 720 },
  { label: "1080p", height: 1080 },
  { label: "2K", height: 1440 },
  { label: "4K", height: 2160 },
];

const PRESETS: { id: string; label: string; ratio: string; width: number; height: number; platform: string }[] = [
  { id: "yt", label: "YouTube", ratio: "16:9", width: 1920, height: 1080, platform: "16:9" },
  { id: "shorts", label: "YouTube Shorts", ratio: "9:16", width: 1080, height: 1920, platform: "9:16" },
  { id: "reels", label: "Instagram Reels", ratio: "9:16", width: 1080, height: 1920, platform: "9:16" },
  { id: "igpost", label: "Instagram Post", ratio: "1:1", width: 1080, height: 1080, platform: "1:1" },
  { id: "ig45", label: "Instagram 4:5", ratio: "4:5", width: 1080, height: 1350, platform: "4:5" },
  { id: "tiktok", label: "TikTok", ratio: "9:16", width: 1080, height: 1920, platform: "9:16" },
  { id: "fb", label: "Facebook", ratio: "16:9", width: 1920, height: 1080, platform: "16:9" },
  { id: "fbstory", label: "Facebook Story", ratio: "9:16", width: 1080, height: 1920, platform: "9:16" },
];

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const [format, setFormat] = useState<"webm" | "mp4" | "mov">("mp4");
  const [engine, setEngine] = useState<"media-recorder" | "ffmpeg">("ffmpeg");
  const [height, setHeight] = useState(1080);
  const [fps, setFps] = useState(project.settings.fps);
  const [bitrate, setBitrate] = useState(8);
  const [audioBitrate, setAudioBitrate] = useState(128);
  const [progress, setProgress] = useState<{ ratio: number; label: string } | null>(null);
  const [result, setResult] = useState<{ blob: Blob; url: string; name: string; mime: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const width = Math.round((height * project.settings.width) / project.settings.height / 2) * 2;
  const supported = typeof window !== "undefined" && "MediaRecorder" in window;

  const start = async () => {
    if (!supported) return toast("This browser cannot record canvas video. Try Chrome or Edge.", "error");
    if (project.duration <= 0) return toast("Add clips to the timeline first", "error");
    setResult(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ ratio: 0, label: "Preparing" });
    try {
      // The canvas recorder always produces WebM or MP4 (when the browser can).
      const recordFormat: "webm" | "mp4" = format === "webm" ? "webm" : "mp4";
      const settings: ExportSettings = {
        width,
        height,
        fps,
        videoBitrate: bitrate * 1_000_000,
        audioBitrate: audioBitrate * 1000,
        mimeType: recordFormat === "webm" ? "video/webm;codecs=vp9,opus" : "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
        format: recordFormat,
      };
      let { blob, mime } = await renderProject(
        project,
        settings,
        (ratio, label) => setProgress({ ratio: ratio * (engine === "ffmpeg" ? 0.8 : 1), label }),
        controller.signal,
      );

      if (engine === "ffmpeg") {
        setProgress({ ratio: 0.82, label: "Loading FFmpeg.wasm" });
        await loadFFmpeg((ratio) => setProgress({ ratio: 0.82 + ratio * 0.15, label: "Encoding with FFmpeg" }));
        setProgress({ ratio: 0.85, label: "Encoding with FFmpeg" });
        blob = await transcodeVideo(blob, { extension: format, bitrateKbps: bitrate * 1000 }, (ratio, label) =>
          setProgress({ ratio: 0.85 + ratio * 0.14, label }),
        );
        mime = blob.type;
      }

      setProgress({ ratio: 1, label: "Done" });
      const url = URL.createObjectURL(blob);
      const safe = project.name.replace(/[^a-z0-9-_ ]/gi, "").replace(/\s+/g, "-") || "safecut";
      setResult({ blob, url, name: `${safe}-${height}p.${format}`, mime });
      recordBetaEvent({
        kind: "export",
        ok: true,
        detail: `${format.toUpperCase()} ${width}×${height} ${fps}fps · ${engine} · ${(blob.size / 1048576).toFixed(1)} MB`,
      });
      toast("Export finished — no watermark, no limits", "success");
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        toast("Export cancelled", "info");
      } else if (engine === "ffmpeg") {
        // Error recovery: retry with the browser recorder before giving up.
        toast("FFmpeg failed — retrying with the browser recorder", "info");
        setEngine("media-recorder");
        try {
          await start();
        } catch (retryErr) {
          toast((retryErr as Error).message || "Export failed", "error");
        }
      } else {
        recordBetaEvent({ kind: "error", ok: false, detail: `export: ${(err as Error).message}` });
        toast((err as Error).message || "Export failed", "error");
      }
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  const close = () => {
    abortRef.current?.abort();
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title="Export video" width="max-w-2xl">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Social presets</p>
            <div className="grid grid-cols-2 gap-1.5">
              {PRESETS.map((p) => {
                const active = height === Math.round((p.height / project.settings.height) * project.settings.height) && false;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      const h = Math.min(2160, p.height);
                      setHeight(h);
                    }}
                    className={cn(
                      "rounded-md border px-2 py-1.5 text-left text-[11px] hover:bg-surface-3",
                      active ? "border-brand" : "border-border-subtle",
                    )}
                  >
                    <span className="block truncate">{p.label}</span>
                    <span className="text-[9px] text-muted">
                      {p.width}×{p.height} · {p.ratio}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Resolution</p>
            <div className="flex flex-wrap gap-1.5">
              {RESOLUTIONS.map((r) => (
                <button
                  key={r.height}
                  onClick={() => setHeight(r.height)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-[11px]",
                    height === r.height ? "border-brand bg-brand/10 text-brand" : "border-border-subtle",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-muted">Output: {width}×{height}</p>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Frame rate</p>
            <div className="flex gap-1.5">
              {[24, 25, 30, 50, 60].map((f) => (
                <button
                  key={f}
                  onClick={() => setFps(f)}
                  className={cn(
                    "flex-1 rounded-md border py-1 text-[11px]",
                    fps === f ? "border-brand bg-brand/10 text-brand" : "border-border-subtle",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[11px] text-muted">
              Video bitrate (Mbps)
              <input
                type="number"
                min={1}
                max={80}
                value={bitrate}
                onChange={(e) => setBitrate(Number(e.target.value))}
                className="mt-1 h-8 w-full rounded border border-border-subtle bg-surface px-2 text-xs text-content"
              />
            </label>
            <label className="block text-[11px] text-muted">
              Audio bitrate (kbps)
              <input
                type="number"
                min={64}
                max={320}
                step={32}
                value={audioBitrate}
                onChange={(e) => setAudioBitrate(Number(e.target.value))}
                className="mt-1 h-8 w-full rounded border border-border-subtle bg-surface px-2 text-xs text-content"
              />
            </label>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Format</p>
            <div className="flex gap-1.5">
              {(["webm", "mp4", "mov"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={cn(
                    "flex-1 rounded-md border py-1.5 text-[11px] uppercase",
                    format === f ? "border-brand bg-brand/10 text-brand" : "border-border-subtle",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
            <p className="mb-1.5 mt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Engine</p>
            <div className="flex gap-1.5">
              {([
                { id: "ffmpeg", label: "FFmpeg.wasm (H.264)" },
                { id: "media-recorder", label: "Browser recorder" },
              ] as const).map((e) => (
                <button
                  key={e.id}
                  onClick={() => setEngine(e.id)}
                  className={cn(
                    "flex-1 rounded-md border px-1 py-1.5 text-[10px]",
                    engine === e.id ? "border-brand bg-brand/10 text-brand" : "border-border-subtle",
                  )}
                >
                  {e.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-muted">
              {engine === "ffmpeg"
                ? `Frames are recorded by the browser, then re-encoded to ${format.toUpperCase()} with FFmpeg.wasm (libx264/libvpx, AAC/Opus). First run downloads ~32 MB of WebAssembly. If FFmpeg cannot start, SafeCut falls back to the browser recorder automatically.`
                : "Pure browser recording: fastest, no download, WebM (VP9) everywhere and MP4 where MediaRecorder supports H.264."}
            </p>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-border-subtle bg-surface p-3">
          <h3 className="text-xs font-semibold">Render</h3>
          <dl className="space-y-1 text-[11px]">
            <div className="flex justify-between">
              <dt className="text-muted">Duration</dt>
              <dd className="font-mono">{project.duration.toFixed(1)}s</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Clips</dt>
              <dd className="font-mono">{project.clips.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Estimated frames</dt>
              <dd className="font-mono">{Math.ceil(project.duration * fps)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Watermark</dt>
              <dd className="text-brand">None</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">FFmpeg core</dt>
              <dd>{isFFmpegLoaded() ? "loaded" : engine === "ffmpeg" ? "loads on export" : "not used"}</dd>
            </div>
          </dl>

          {progress && (
            <div className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full bg-brand transition-all" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
              </div>
              <p className="flex items-center gap-1 text-[10px] text-muted">
                <Loader2 size={10} className="animate-spin" /> {progress.label} · {Math.round(progress.ratio * 100)}%
              </p>
            </div>
          )}

          {result ? (
            <div className="space-y-2">
              <video src={result.url} controls className="w-full rounded border border-border-subtle" />
              <Button variant="primary" className="w-full justify-center" onClick={() => downloadBlob(result.blob, result.name)}>
                <Download size={14} /> Download {result.name}
              </Button>
              <p className="text-[10px] text-muted">
                {result.mime} · {(result.blob.size / 1_048_576).toFixed(1)} MB
              </p>
            </div>
          ) : progress ? (
            <Button variant="danger" className="w-full justify-center" onClick={() => abortRef.current?.abort()}>
              <X size={14} /> Cancel export
            </Button>
          ) : (
            <Button variant="primary" className="w-full justify-center" onClick={() => void start()} disabled={!supported}>
              <Download size={14} /> Start export
            </Button>
          )}

          {!supported && (
            <p className="text-[10px] text-red-400">
              Your browser does not expose MediaRecorder. Use a recent Chrome, Edge or Firefox.
            </p>
          )}
          <p className="text-[10px] leading-relaxed text-muted">
            Export speed depends on your device: rendering is real-time-ish for 1080p on most laptops,
            slower for 4K. Nothing is uploaded.
          </p>
        </div>
      </div>
    </Modal>
  );
}
