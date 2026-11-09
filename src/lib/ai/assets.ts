"use client";

/**
 * Helpers that turn AI results into ordinary project assets, so every AI
 * feature produces normal, editable, exportable media instead of a special case.
 */

import type { MediaAsset } from "@/types";
import { putBlob } from "@/lib/storage";
import { uid } from "@/lib/utils";

/** Persist a generated blob as a media asset (audio by default). */
export async function saveGeneratedAsset(params: {
  blob: Blob;
  name: string;
  kind: MediaAsset["kind"];
  duration: number;
  width?: number;
  height?: number;
  tts?: MediaAsset["tts"];
  thumbnail?: string;
}): Promise<MediaAsset> {
  const id = uid("ast");
  await putBlob(id, params.blob);
  return {
    id,
    name: params.name,
    kind: params.kind,
    mimeType: params.blob.type || (params.kind === "audio" ? "audio/wav" : "image/png"),
    size: params.blob.size,
    duration: params.duration,
    width: params.width ?? 0,
    height: params.height ?? 0,
    url: URL.createObjectURL(params.blob),
    thumbnail: params.thumbnail,
    createdAt: Date.now(),
    hasAudio: params.kind === "audio",
    source: "tts",
    tts: params.tts,
  };
}

/** Format seconds for asset names: "tts-aria-01m12s". */
export function timestampName(prefix: string, seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${prefix}-${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s`;
}
