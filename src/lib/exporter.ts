"use client";

import type { Project } from "@/types";
import { evaluateKeyframes } from "@/lib/timeline";
import { cssFilter, tintOverlay } from "@/lib/effects";
import { drawTextClip, drawClipBackground } from "@/components/preview-renderer";
import { buildVoiceChain, presetById } from "@/lib/ai/voice";

export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
  audioBitrate: number;
  mimeType: string;
  format: "webm" | "mp4";
}

export type ProgressFn = (ratio: number, label: string) => void;

const MIME_CANDIDATES: Record<ExportSettings["format"], string[]> = {
  webm: ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"],
  mp4: ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1", "video/mp4"],
};

export function pickMimeType(format: ExportSettings["format"]): string {
  if (typeof MediaRecorder === "undefined") return MIME_CANDIDATES[format][0];
  return MIME_CANDIDATES[format].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

/** Does this browser have MediaRecorder + canvas.captureStream? */
export function recorderSupported(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function"
  );
}

/**
 * Media pool used by the exporter.
 *
 * Videos are *played* at their natural speed while MediaRecorder captures the
 * canvas in real time. Seeking per frame is far slower than real time and makes
 * audio stutter, so the renderer advances by wall clock and simply draws the
 * frame that is currently presented. What you see is what you get.
 */
interface MediaPool {
  videos: Map<string, HTMLVideoElement>;
  images: Map<string, HTMLImageElement>;
  audios: Map<string, HTMLAudioElement>;
  audioCtx: AudioContext | null;
  destination: MediaStreamAudioDestinationNode | null;
  gains: Map<string, GainNode>;
}

export async function prepareMedia(project: Project): Promise<MediaPool> {
  const videos = new Map<string, HTMLVideoElement>();
  const images = new Map<string, HTMLImageElement>();
  const audios = new Map<string, HTMLAudioElement>();
  const assetById = new Map(project.assets.map((a) => [a.id, a]));

  const jobs: Promise<void>[] = [];
  for (const asset of assetById.values()) {
    if (!asset.url) continue;
    if (asset.kind === "video") {
      jobs.push(
        new Promise<void>((resolve) => {
          const v = document.createElement("video");
          v.src = asset.url!;
          v.muted = true;
          v.playsInline = true;
          v.preload = "auto";
          v.crossOrigin = "anonymous";
          const done = () => resolve();
          v.onloadeddata = done;
          v.onerror = done;
          setTimeout(done, 15000);
          videos.set(asset.id, v);
        }),
      );
    } else if (asset.kind === "image") {
      jobs.push(
        new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => resolve();
          img.onerror = () => resolve();
          setTimeout(resolve, 15000);
          img.src = asset.url!;
          images.set(asset.id, img);
        }),
      );
    } else if (asset.kind === "audio") {
      jobs.push(
        new Promise<void>((resolve) => {
          const a = document.createElement("audio");
          a.src = asset.url!;
          a.preload = "auto";
          a.onloadedmetadata = () => resolve();
          a.onerror = () => resolve();
          setTimeout(resolve, 15000);
          audios.set(asset.id, a);
        }),
      );
    }
  }
  await Promise.all(jobs);

  // Audio graph: every audible media element → gain → destination.
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const audioCtx = AudioCtx ? new AudioCtx({ sampleRate: 48000 }) : null;
  const destination = audioCtx ? audioCtx.createMediaStreamDestination() : null;
  const gains = new Map<string, GainNode>();
  if (audioCtx && destination) {
    const trackById = new Map(project.tracks.map((t) => [t.id, t]));
    for (const clip of project.clips) {
      if (!clip.mediaId) continue;
      const track = trackById.get(clip.trackId);
      if (!track || track.muted || clip.audio.muted) continue;
      const el = videos.get(clip.mediaId) ?? audios.get(clip.mediaId);
      if (!el) continue;
      try {
        const node = audioCtx.createMediaElementSource(el as HTMLMediaElement);
        const gain = new GainNode(audioCtx, {
          gain: Math.max(0, Math.min(1, clip.audio.volume * (track.volume ?? 1))),
        });
        // Non-destructive voice enhancement in the exported mix.
        if (clip.voice && clip.voice.preset !== "none" && clip.voice.intensity > 0) {
          const chain = buildVoiceChain(audioCtx, presetById(clip.voice.preset), clip.voice.intensity);
          node.connect(chain.input);
          chain.output.connect(gain);
        } else {
          node.connect(gain);
        }
        gain.connect(destination);
        gains.set(clip.id, gain);
      } catch {
        /* element already connected */
      }
    }
  }

  return { videos, images, audios, audioCtx, destination, gains };
}

export function releaseMedia(pool: MediaPool) {
  for (const el of [...pool.videos.values(), ...pool.audios.values()]) {
    el.pause();
    el.removeAttribute("src");
    el.load();
  }
  if (pool.audioCtx) void pool.audioCtx.close().catch(() => undefined);
}

/** Draw a single timeline moment into a 2D context. */
export function drawProjectFrame(
  ctx: CanvasRenderingContext2D,
  project: Project,
  settings: { width: number; height: number },
  time: number,
  pool: Pick<MediaPool, "videos" | "images">,
) {
  const { width, height } = settings;
  ctx.save();
  ctx.filter = "none";
  ctx.globalAlpha = 1;
  ctx.fillStyle = project.settings.background || "#000";
  ctx.fillRect(0, 0, width, height);

  const assetById = new Map(project.assets.map((a) => [a.id, a]));
  const trackById = new Map(project.tracks.map((t) => [t.id, t]));
  const active = project.clips
    .filter((c) => time >= c.start && time < c.start + c.duration)
    .sort((a, b) => (trackById.get(a.trackId)?.index ?? 0) - (trackById.get(b.trackId)?.index ?? 0));

  for (const clip of active) {
    const track = trackById.get(clip.trackId);
    if (!track || track.hidden) continue;
    const local = time - clip.start;
    const asset = clip.mediaId ? assetById.get(clip.mediaId) : undefined;

    const opacity = evaluateKeyframes(clip.keyframes, "opacity", local, clip.color.opacity);
    const scaleKf = evaluateKeyframes(clip.keyframes, "scale", local, clip.transform.scale);
    const xKf = evaluateKeyframes(clip.keyframes, "x", local, clip.transform.x);
    const yKf = evaluateKeyframes(clip.keyframes, "y", local, clip.transform.y);
    const rotKf = evaluateKeyframes(clip.keyframes, "rotation", local, clip.transform.rotation);

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, opacity));

    const td = Math.min(clip.transitionDuration, clip.duration / 2);
    let fade = 1;
    let slideX = 0;
    let zoom = 1;
    if (clip.transitionIn !== "none" && td > 0 && local < td) {
      const p = local / td;
      if (clip.transitionIn === "fade" || clip.transitionIn === "dissolve") fade = p;
      if (clip.transitionIn === "slide") slideX = (1 - p) * -width;
      if (clip.transitionIn === "zoom") zoom = 0.7 + 0.3 * p;
    }
    if (clip.transitionOut !== "none" && td > 0 && local > clip.duration - td) {
      const p = (clip.duration - local) / td;
      if (clip.transitionOut === "fade" || clip.transitionOut === "dissolve") fade = Math.min(fade, p);
      if (clip.transitionOut === "slide") slideX = (1 - p) * width;
      if (clip.transitionOut === "zoom") zoom = 0.7 + 0.3 * p;
    }
    ctx.globalAlpha *= fade;

    const cx = width / 2 + slideX;
    const cy = height / 2;
    ctx.translate(cx + (xKf / 100) * width, cy + (yKf / 100) * height);
    ctx.rotate((rotKf * Math.PI) / 180);
    const s = scaleKf * zoom;
    ctx.scale(s * (clip.transform.flipH ? -1 : 1), s * (clip.transform.flipV ? -1 : 1));

    if (clip.text) {
      ctx.translate(-cx, -cy);
      drawTextClip(ctx, clip, local, width, height);
    } else if (asset) {
      ctx.filter = cssFilter(clip.color, clip.filter);
      if (asset.kind === "video") {
        const el = pool.videos.get(asset.id);
        if (el && el.readyState >= 2) {
          const composited = drawClipBackground(ctx, el, clip, width, height);
          if (!composited) drawCover(ctx, el, width, height, el.videoWidth, el.videoHeight);
        }
      } else if (asset.kind === "image") {
        const img = pool.images.get(asset.id);
        if (img?.complete) {
          const composited = drawClipBackground(ctx, img, clip, width, height);
          if (!composited) drawCover(ctx, img, width, height, img.naturalWidth, img.naturalHeight);
        }
      }
      ctx.filter = "none";

      const tint = tintOverlay(clip.color);
      if (tint) {
        ctx.save();
        ctx.globalCompositeOperation = "soft-light";
        ctx.fillStyle = tint;
        ctx.fillRect(-width / 2, -height / 2, width, height);
        ctx.restore();
      }
      if (clip.color.vignette > 0) {
        const g = ctx.createRadialGradient(0, 0, Math.min(width, height) * 0.3, 0, 0, Math.max(width, height) * 0.75);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(0,0,0,${(clip.color.vignette / 100) * 0.85})`);
        ctx.fillStyle = g;
        ctx.fillRect(-width / 2, -height / 2, width, height);
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
  sw: number,
  sh: number,
) {
  if (!sw || !sh) return;
  const scale = Math.max(width / sw, height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(source, -dw / 2, -dh / 2, dw, dh);
}

/**
 * Render the project in real time and capture it with MediaRecorder.
 * Video and audio play at 1x, so the recorded file has correct timing and sync.
 */
export async function renderProject(
  project: Project,
  settings: ExportSettings,
  onProgress: ProgressFn,
  signal: AbortSignal,
): Promise<{ blob: Blob; mime: string }> {
  const duration = project.duration;
  if (duration <= 0) throw new Error("The timeline is empty");
  if (!recorderSupported()) throw new Error("This browser cannot record canvas video. Try Chrome or Edge.");

  const { width, height, fps } = settings;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D is unavailable");

  onProgress(0, "Preparing media");
  const pool = await prepareMedia(project);

  const mime = pickMimeType(settings.format);
  if (!mime) {
    releaseMedia(pool);
    throw new Error(`This browser cannot record ${settings.format.toUpperCase()}`);
  }

  const stream = canvas.captureStream(fps);
  pool.destination?.stream.getAudioTracks().forEach((t) => stream.addTrack(t));

  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: settings.videoBitrate,
    audioBitsPerSecond: settings.audioBitrate,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  let aborted = false;
  const onAbort = () => {
    aborted = true;
    if (recorder.state !== "inactive") recorder.stop();
  };
  signal.addEventListener("abort", onAbort);

  try {
    await pool.audioCtx?.resume();
    recorder.start(250);

    const started = performance.now();
    let raf = 0;
    await new Promise<void>((resolve) => {
      const tick = () => {
        const elapsed = (performance.now() - started) / 1000;
        const time = Math.min(duration, elapsed);

        // Start / stop media elements as the playhead crosses their clips.
        for (const clip of project.clips) {
          if (!clip.mediaId) continue;
          const el = pool.videos.get(clip.mediaId) ?? pool.audios.get(clip.mediaId);
          if (!el) continue;
          const local = time - clip.start;
          const active = local >= 0 && local < clip.duration;
          if (active) {
            const target = clip.freezeAt ?? clip.inPoint + local * clip.speed;
            if (Math.abs(el.currentTime - target) > 0.3) el.currentTime = Math.max(0, target);
            el.playbackRate = Math.max(0.0625, Math.min(16, clip.speed));
            if (el.paused) void el.play().catch(() => undefined);
          } else if (!el.paused) {
            el.pause();
          }
          const gain = pool.gains.get(clip.id);
          if (gain) gain.gain.value = Math.max(0, Math.min(1, clip.audio.volume));
        }

        drawProjectFrame(ctx, project, { width, height }, time, pool);
        onProgress(Math.min(0.99, time / duration), "Recording");

        if (time < duration && !aborted) raf = requestAnimationFrame(tick);
        else resolve();
      };
      raf = requestAnimationFrame(tick);
    });
    cancelAnimationFrame(raf);
  } finally {
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    releaseMedia(pool);
    signal.removeEventListener("abort", onAbort);
  }

  if (aborted || signal.aborted) throw new DOMException("Export cancelled", "AbortError");
  onProgress(1, "Finalising");
  const type = mime.split(";")[0];
  return { blob: new Blob(chunks, { type }), mime: type };
}
