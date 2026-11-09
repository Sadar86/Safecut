"use client";

import { useCallback, useRef } from "react";
import type { MediaAsset } from "@/types";
import { putBlob } from "@/lib/storage";
import { uid } from "@/lib/utils";

export const ACCEPTED_MEDIA =
  "video/*,audio/*,image/*,.mp4,.mov,.webm,.mkv,.m4v,.mp3,.wav,.aac,.m4a,.ogg,.flac,.png,.jpg,.jpeg,.webp,.gif,.avif";

export function kindFromMime(mime: string, name: string): MediaAsset["kind"] {
  if (mime.startsWith("video")) return "video";
  if (mime.startsWith("audio")) return "audio";
  if (mime.startsWith("image")) return "image";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "mov", "webm", "mkv", "m4v", "avi"].includes(ext)) return "video";
  if (["mp3", "wav", "aac", "m4a", "ogg", "flac"].includes(ext)) return "audio";
  return "image";
}

const ALLOWED_MIME = /^(video|audio|image)\//;
const ALLOWED_EXT = /\.(mp4|mov|webm|mkv|m4v|avi|mp3|wav|aac|m4a|ogg|flac|png|jpe?g|webp|gif|avif)$/i;
// Beta limit: 2 GB per file. The browser keeps everything in memory while
// decoding, so larger files are refused instead of crashing the tab.
const MAX_BYTES = 2 * 1024 * 1024 * 1024;

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

/** Reject anything that is not obviously an image, audio or video file. */
export function validateMediaFile(file: File): ValidationResult {
  const mimeOk = file.type ? ALLOWED_MIME.test(file.type) : ALLOWED_EXT.test(file.name);
  if (!mimeOk) return { ok: false, error: `${file.name}: unsupported file type` };
  if (file.size === 0) return { ok: false, error: `${file.name}: file is empty` };
  if (file.size > MAX_BYTES) return { ok: false, error: `${file.name}: larger than 2 GB (beta limit)` };
  return { ok: true };
}

/** Read duration and dimensions from a media file without uploading it. */
export function probeMedia(
  file: File,
  url: string,
): Promise<{ duration: number; width: number; height: number }> {
  const kind = kindFromMime(file.type, file.name);
  if (kind === "image") {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ duration: 0, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ duration: 0, width: 0, height: 0 });
      img.src = url;
    });
  }
  return new Promise((resolve) => {
    const el = document.createElement(kind === "video" ? "video" : "audio");
    el.preload = "metadata";
    el.muted = true;
    const done = (duration: number) => {
      const v = el as HTMLVideoElement;
      resolve({ duration, width: v.videoWidth || 0, height: v.videoHeight || 0 });
    };
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => done(0);
    el.src = url;
  });
}

/** Grab a poster frame from a video. */
export function captureThumbnail(url: string, at = 0.2): Promise<string | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    video.src = url;
    const fail = () => resolve(undefined);
    video.onloadeddata = () => {
      video.currentTime = Math.min(at, (video.duration || 1) * 0.5);
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        const w = 320;
        const h = Math.round((video.videoHeight / (video.videoWidth || 1)) * w) || 180;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return fail();
        ctx.drawImage(video, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      } catch {
        fail();
      }
    };
    video.onerror = fail;
    setTimeout(fail, 8000);
  });
}

export async function importFiles(
  files: File[],
): Promise<{ assets: MediaAsset[]; errors: string[] }> {
  const assets: MediaAsset[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const check = validateMediaFile(file);
    if (!check.ok) {
      errors.push(check.error!);
      continue;
    }
    const id = uid("ast");
    const kind = kindFromMime(file.type, file.name);
    const url = URL.createObjectURL(file);
    const probe = await probeMedia(file, url);
    const thumbnail = kind === "video" ? await captureThumbnail(url) : kind === "image" ? url : undefined;
    await putBlob(id, file);
    assets.push({
      id,
      name: file.name,
      kind,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      url,
      thumbnail,
      createdAt: Date.now(),
      hasAudio: kind === "video" || kind === "audio",
    });
  }
  return { assets, errors };
}

/** Recreate object URLs for assets that lost them after a page reload. */
export function useAssetUrls() {
  const cache = useRef<Map<string, string>>(new Map());
  return useCallback((assets: MediaAsset[]) => {
    for (const a of assets) {
      if (a.url && !cache.current.has(a.id)) cache.current.set(a.id, a.url);
    }
    return cache.current;
  }, []);
}
