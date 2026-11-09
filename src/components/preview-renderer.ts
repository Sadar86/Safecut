"use client";

import type { MediaAsset, Project } from "@/types";
import { useCallback } from "react";
import { evaluateKeyframes } from "@/lib/timeline";
import { cssFilter, tintOverlay } from "@/lib/effects";
import { buildHistogram, isBlackFrame, type SceneFrame } from "@/lib/scene-math";
import { buildVoiceChain, presetById } from "@/lib/ai/voice";

export interface RenderOptions {
  width: number;
  height: number;
  time: number;
  fps: number;
}

export interface RendererHandle {
  draw: (options: RenderOptions) => void;
  element: HTMLCanvasElement | null;
}

type Pool = Map<string, HTMLVideoElement | HTMLImageElement>;

const videoPool: Pool = new Map();
const imagePool: Pool = new Map();
/** Alpha mattes for background removal, keyed by URL. */
const mattePool = new Map<string, HTMLCanvasElement>();
const matteImages = new Map<string, HTMLImageElement>();

export function clearMatteCache() {
  mattePool.clear();
  matteImages.clear();
}

/** Turn an alpha-matte image into a canvas (cached) so it can be masked. */
function getMatte(url: string): HTMLCanvasElement | null {
  const cached = mattePool.get(url);
  if (cached) return cached;
  const img = matteImages.get(url) ?? new Image();
  if (!matteImages.has(url)) {
    img.crossOrigin = "anonymous";
    img.src = url;
    matteImages.set(url, img);
  }
  if (!img.complete || img.naturalWidth === 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d")?.drawImage(img, 0, 0);
  mattePool.set(url, canvas);
  return canvas;
}

/**
 * Draw a source with a background: the subject is masked by the alpha matte and
 * composited over the chosen background.
 */
function drawWithBackground(
  ctx: CanvasRenderingContext2D,
  source: HTMLVideoElement | HTMLImageElement,
  sourceSize: { w: number; h: number },
  clip: Project["clips"][number],
  width: number,
  height: number,
) {
  const bg = clip.background;
  if (!bg?.enabled) return false;
  const matte = bg.matteUrl ? getMatte(bg.matteUrl) : null;
  if (!matte) return false;

  // Offscreen layer the size of the frame.
  const layer = document.createElement("canvas");
  layer.width = width;
  layer.height = height;
  const lctx = layer.getContext("2d");
  if (!lctx) return false;

  // Subject, cover-fitted.
  const scale = Math.max(width / sourceSize.w, height / sourceSize.h);
  const dw = sourceSize.w * scale;
  const dh = sourceSize.h * scale;
  lctx.drawImage(source, -dw / 2, -dh / 2, dw, dh);

  // Mask it with the matte (scaled to the same frame).
  lctx.globalCompositeOperation = "destination-in";
  lctx.drawImage(matte, -dw / 2, -dh / 2, dw, dh);
  lctx.globalCompositeOperation = "source-over";

  // Background behind the subject.
  ctx.save();
  if (bg.kind === "color") {
    ctx.fillStyle = bg.color;
    ctx.fillRect(-width / 2, -height / 2, width, height);
  } else if (bg.kind === "image" && bg.imageUrl) {
    const img = getImage(bg.imageUrl);
    if (img.complete) drawCover(ctx, img, width, height, img.naturalWidth, img.naturalHeight);
    else {
      ctx.fillStyle = "#111827";
      ctx.fillRect(-width / 2, -height / 2, width, height);
    }
  } else if (bg.kind === "blur") {
    // Blurred copy of the same source.
    ctx.save();
    ctx.filter = "blur(18px) brightness(0.85)";
    drawCover(ctx, source, width, height, sourceSize.w, sourceSize.h);
    ctx.restore();
  }
  // "transparent": nothing painted, the project background shows through.
  ctx.drawImage(layer, -width / 2, -height / 2, width, height);
  ctx.restore();
  return true;
}
const readyVideos = new Set<string>();

function getVideo(url: string): HTMLVideoElement {
  let v = videoPool.get(url) as HTMLVideoElement | undefined;
  if (!v) {
    v = document.createElement("video");
    v.src = url;
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    v.addEventListener("loadeddata", () => readyVideos.add(url));
    videoPool.set(url, v);
  }
  return v;
}

function getImage(url: string): HTMLImageElement {
  let img = imagePool.get(url) as HTMLImageElement | undefined;
  if (!img) {
    img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    imagePool.set(url, img);
  }
  return img;
}

/** Draw a clip's text layer with its animation applied. */
export function drawTextClip(
  ctx: CanvasRenderingContext2D,
  clip: Project["clips"][number],
  localTime: number,
  W: number,
  H: number,
) {
  if (!clip.text) return;
  const t = clip.text;
  const scale = W / 1080;
  const p = Math.min(1, localTime / 0.4);
  let alpha = 1;
  let dy = 0;
  let extra = 1;
  let content = t.content;
  switch (t.animation) {
    case "fade":
      alpha = p;
      break;
    case "pop":
      extra = 0.85 + 0.15 * (1 - Math.pow(1 - p, 3));
      alpha = p;
      break;
    case "slide-up":
      dy = (1 - p) * 40 * scale;
      alpha = p;
      break;
    case "typewriter": {
      const chars = Math.ceil(t.content.length * Math.min(1, localTime / Math.max(0.6, clip.duration * 0.7)));
      content = t.content.slice(0, Math.max(chars, 1));
      break;
    }
    default:
      break;
  }

  const words = content.split(/\s+/).filter(Boolean);
  const wrapped =
    t.maxWordsPerLine && t.maxWordsPerLine > 0 && words.length > t.maxWordsPerLine
      ? words.reduce<string[]>((lines, word) => {
          const last = lines[lines.length - 1];
          if (last !== undefined && last.split(" ").length < t.maxWordsPerLine!) {
            lines[lines.length - 1] = `${last} ${word}`;
          } else {
            lines.push(word);
          }
          return lines;
        }, [])
      : content.split("\n");
  content = wrapped.join("\n");

  const fontSize = t.fontSize * scale * extra;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `${t.italic ? "italic " : ""}${t.bold ? 800 : 400} ${fontSize}px ${t.fontFamily}`;
  ctx.textAlign = t.align;
  ctx.textBaseline = "middle";

  const x = (t.x / 100) * W;
  const y = (t.y / 100) * H + dy;
  const lines = content.split("\n");
  const lineHeight = fontSize * 1.2;
  const totalH = lines.length * lineHeight;

  if (t.background !== "transparent") {
    let maxW = 0;
    for (const line of lines) maxW = Math.max(maxW, ctx.measureText(line).width);
    const padX = 16 * scale;
    const padY = 8 * scale;
    const bx = t.align === "center" ? x - maxW / 2 - padX : t.align === "right" ? x - maxW - padX : x - padX;
    ctx.fillStyle = t.background;
    ctx.beginPath();
    ctx.roundRect(bx, y - totalH / 2 - padY, maxW + padX * 2, totalH + padY * 2, 8 * scale);
    ctx.fill();
  }

  if (t.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 12 * scale;
    ctx.shadowOffsetY = 3 * scale;
  }

  if (t.animation === "word" && t.highlightColor) {
    const allWords = content.split(/\s+/).filter(Boolean);
    const progress = Math.min(1, Math.max(0, localTime / Math.max(0.2, clip.duration)));
    const activeIndex = Math.min(allWords.length - 1, Math.floor(progress * allWords.length));
    let cursorY = y - totalH / 2;
    for (const line of lines) {
      const lineWords = line.split(/\s+/).filter(Boolean);
      let cursorX =
        t.align === "center"
          ? x - ctx.measureText(line).width / 2
          : t.align === "right"
            ? x - ctx.measureText(line).width
            : x;
      for (let wi = 0; wi < lineWords.length; wi++) {
        const word = lineWords[wi];
        const w = ctx.measureText(word).width;
        if (wi === activeIndex) {
          ctx.save();
          ctx.fillStyle = t.highlightColor;
          ctx.fillRect(cursorX - 3 * scale, cursorY + lineHeight * 0.1, w + 6 * scale, lineHeight * 0.8);
          ctx.restore();
        }
        cursorX += w + ctx.measureText(" ").width;
      }
      cursorY += lineHeight;
    }
  }

  lines.forEach((line, i) => {
    const ly = y - totalH / 2 + lineHeight * (i + 0.5);
    if (t.outlineWidth > 0) {
      ctx.strokeStyle = t.outlineColor;
      ctx.lineWidth = t.outlineWidth * scale * 2;
      ctx.lineJoin = "round";
      ctx.strokeText(line, x, ly);
    }
    ctx.fillStyle = t.color;
    ctx.fillText(line, x, ly);
  });
  ctx.restore();
}

/**
 * The SafeCut canvas renderer.
 *
 * This is the single source of truth for what a frame looks like: the preview
 * calls it on every animation frame and the export engine calls it once per
 * frame. Keeping one renderer means exports match the preview exactly.
 */
export function useCanvasRenderer(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const draw = useCallback(
    ({ width, height, time, fps }: RenderOptions, project: Project, assets: MediaAsset[]) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = project.settings.background || "#000";
      ctx.fillRect(0, 0, width, height);

      const assetById = new Map(assets.map((a) => [a.id, a]));
      const trackById = new Map(project.tracks.map((t) => [t.id, t]));

      const active = project.clips
        .filter((c) => time >= c.start && time < c.start + c.duration)
        .sort((a, b) => {
          const ai = trackById.get(a.trackId)?.index ?? 0;
          const bi = trackById.get(b.trackId)?.index ?? 0;
          return bi - ai; // draw bottom tracks first
        });

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

        // Transitions
        const td = Math.min(clip.transitionDuration, clip.duration / 2);
        let fade = 1;
        let slideX = 0;
        let scaleT = 1;
        if (clip.transitionIn !== "none" && td > 0 && local < td) {
          const p = local / td;
          if (clip.transitionIn === "fade" || clip.transitionIn === "dissolve") fade = p;
          if (clip.transitionIn === "slide") slideX = (1 - p) * -width;
          if (clip.transitionIn === "zoom") scaleT = 0.7 + 0.3 * p;
          if (clip.transitionIn === "blur") fade = p;
        }
        if (clip.transitionOut !== "none" && td > 0 && local > clip.duration - td) {
          const p = (clip.duration - local) / td;
          if (clip.transitionOut === "fade" || clip.transitionOut === "dissolve") fade = Math.min(fade, p);
          if (clip.transitionOut === "slide") slideX = (1 - p) * width;
          if (clip.transitionOut === "zoom") scaleT = 0.7 + 0.3 * p;
          if (clip.transitionOut === "blur") fade = Math.min(fade, p);
        }
        ctx.globalAlpha *= fade;

        const cx = width / 2 + slideX;
        const cy = height / 2;
        ctx.translate(cx + (xKf / 100) * width, cy + (yKf / 100) * height);
        ctx.rotate((rotKf * Math.PI) / 180);
        const s = scaleKf * scaleT;
        ctx.scale(s * (clip.transform.flipH ? -1 : 1), s * (clip.transform.flipV ? -1 : 1));

        if (clip.text) {
          // Text is positioned in frame space, so undo the centre translation.
          ctx.translate(-cx, -cy);
          drawTextClip(ctx, clip, local, width, height);
        } else if (asset && (asset.kind === "video" || asset.kind === "image") && asset.url) {
          ctx.filter = cssFilter(clip.color, clip.filter);
          if (asset.kind === "image") {
            const img = getImage(asset.url);
            if (img.complete) {
              const composited = drawWithBackground(
                ctx,
                img,
                { w: img.naturalWidth || asset.width, h: img.naturalHeight || asset.height },
                clip,
                width,
                height,
              );
              if (!composited) drawCover(ctx, img, width, height, asset.width, asset.height);
            }
          } else {
            const v = getVideo(asset.url);
            const sourceTime = clip.freezeAt ?? clip.inPoint + local * clip.speed;
            if (readyVideos.has(asset.url) && Math.abs(v.currentTime - sourceTime) > 0.04) {
              v.currentTime = Math.max(0, Math.min(sourceTime, (v.duration || sourceTime) - 0.01));
            }
            if (v.readyState >= 2) {
              const composited = drawWithBackground(
                ctx,
                v,
                { w: v.videoWidth, h: v.videoHeight },
                clip,
                width,
                height,
              );
              if (!composited) drawCover(ctx, v, width, height, v.videoWidth, v.videoHeight);
            }
          }
          ctx.filter = "none";

          // Temperature / tint overlay
          const tint = tintOverlay(clip.color);
          if (tint) {
            ctx.save();
            ctx.globalCompositeOperation = "soft-light";
            ctx.fillStyle = tint;
            ctx.fillRect(-width / 2, -height / 2, width, height);
            ctx.restore();
          }
          // Vignette
          if (clip.color.vignette > 0) {
            const g = ctx.createRadialGradient(0, 0, Math.min(width, height) * 0.3, 0, 0, Math.max(width, height) * 0.75);
            g.addColorStop(0, "rgba(0,0,0,0)");
            g.addColorStop(1, `rgba(0,0,0,${(clip.color.vignette / 100) * 0.85})`);
            ctx.fillStyle = g;
            ctx.fillRect(-width / 2, -height / 2, width, height);
          }
          // Film grain
          if (clip.color.grain > 0) {
            const amount = Math.floor((clip.color.grain / 100) * 2400);
            ctx.save();
            ctx.globalAlpha = (clip.color.grain / 100) * 0.18;
            for (let i = 0; i < amount; i += 3) {
              const gx = (Math.random() - 0.5) * width;
              const gy = (Math.random() - 0.5) * height;
              ctx.fillStyle = Math.random() > 0.5 ? "#fff" : "#000";
              ctx.fillRect(gx, gy, 1.5, 1.5);
            }
            ctx.restore();
          }
        }
        ctx.restore();
      }

      // Frame counter / fps are exposed for tests and debugging
      void fps;
    },
    [canvasRef],
  );

  return { draw };
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource & { videoWidth?: number; videoHeight?: number; width?: number; height?: number },
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

/** Public wrapper used by the exporter (same compositing as the preview). */
export function drawClipBackground(
  ctx: CanvasRenderingContext2D,
  source: HTMLVideoElement | HTMLImageElement,
  clip: Project["clips"][number],
  width: number,
  height: number,
): boolean {
  const size =
    source instanceof HTMLVideoElement
      ? { w: source.videoWidth, h: source.videoHeight }
      : { w: source.naturalWidth, h: source.naturalHeight };
  return drawWithBackground(ctx, source, size, clip, width, height);
}

/* -------------------------------------------------------------------------- */
/*  Non-destructive audio processing                                           */
/* -------------------------------------------------------------------------- */

/**
 * Route a media element through the voice-enhancement chain for preview.
 * The element is only ever routed once; changing the preset updates the nodes.
 * Returns the chain so callers can tweak it later.
 */
const elementChains = new WeakMap<HTMLMediaElement, { ctx: AudioContext; input: AudioNode; output: AudioNode; preset: string }>();

export function applyVoiceChain(el: HTMLMediaElement, clip: Project["clips"][number]) {
  const voice = clip.voice;
  if (!voice || voice.preset === "none" || voice.intensity <= 0) {
    const existing = elementChains.get(el);
    if (existing) {
      // Disconnect the chain so the element plays dry again.
      try {
        existing.input.disconnect();
        existing.output.disconnect();
      } catch {
        /* already disconnected */
      }
      elementChains.delete(el);
    }
    return;
  }
  const existing = elementChains.get(el);
  if (existing && existing.preset === voice.preset) return;
  const Ctx = window.AudioContext;
  const ctx = existing?.ctx ?? new Ctx();
  try {
    const source = ctx.createMediaElementSource(el);
    const chain = buildVoiceChain(ctx, presetById(voice.preset), voice.intensity);
    source.connect(chain.input);
    chain.output.connect(ctx.destination);
    elementChains.set(el, { ctx, input: chain.input, output: chain.output, preset: voice.preset });
  } catch {
    /* element already has a source node from the export graph */
  }
}

/* -------------------------------------------------------------------------- */
/*  Scene detection sampling                                                   */
/* -------------------------------------------------------------------------- */

export interface SceneSample {
  time: number;
  thumbnail: string;
  luma: number;
  histogram: number[];
}

/**
 * Sample a video element at a fixed interval and return colour histograms plus
 * a small JPEG thumbnail for each sample. Used by the scene detector.
 */
export async function sampleVideoForScenes(
  url: string,
  options: {
    interval?: number;
    maxSamples?: number;
    width?: number;
    onProgress?: (ratio: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<{ duration: number; samples: SceneSample[] }> {
  const interval = options.interval ?? 0.5;
  const width = options.width ?? 96;
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("Could not load video for scene detection"));
    setTimeout(() => reject(new Error("Timed out loading video")), 20000);
  });

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const height = Math.max(2, Math.round((width * (video.videoHeight || 9)) / (video.videoWidth || 16)));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D unavailable");

  const step = Math.max(interval, duration / (options.maxSamples ?? 400));
  const samples: SceneSample[] = [];

  for (let t = 0; t < duration; t += step) {
    if (options.signal?.aborted) break;
    await new Promise<void>((resolve) => {
      const done = () => {
        video.removeEventListener("seeked", done);
        resolve();
      };
      video.addEventListener("seeked", done);
      video.currentTime = Math.min(t, Math.max(0, duration - 0.05));
      setTimeout(done, 500);
    });
    ctx.drawImage(video, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    const { histogram, luma } = buildHistogram(data);
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = 160;
    thumbCanvas.height = Math.round((160 * height) / width);
    thumbCanvas.getContext("2d")?.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    samples.push({ time: t, thumbnail: thumbCanvas.toDataURL("image/jpeg", 0.6), luma, histogram });
    options.onProgress?.(Math.min(0.99, t / Math.max(duration, 0.01)));
  }

  video.removeAttribute("src");
  video.load();
  return { duration, samples };
}

/** Convenience: is a sampled frame black? (re-exported for the scene panel) */
export const isDarkFrame = isBlackFrame;
export type { SceneFrame };
