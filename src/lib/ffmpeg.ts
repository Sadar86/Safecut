"use client";

/**
 * Minimal structural type for the FFmpeg.wasm instance (the library is loaded
 * at runtime from `public/ffmpeg/ffmpeg.js`, see `loadLibrary`).
 */
interface FFmpeg {
  loaded: boolean;
  load: (config: { coreURL: string; wasmURL: string; classWorkerURL?: string }) => Promise<boolean>;
  exec: (args: string[]) => Promise<number>;
  writeFile: (path: string, data: Uint8Array | string) => Promise<boolean>;
  readFile: (path: string) => Promise<Uint8Array | string>;
  deleteFile: (path: string) => Promise<boolean>;
  on: (event: string, callback: (data: unknown) => void) => void;
  terminate: () => void;
}

/**
 * The `@ffmpeg/ffmpeg` builds contain `new Worker(new URL(..., import.meta.url))`
 * and always create the worker with `{ type: "module" }`. Module workers cannot
 * `importScripts`, which is exactly what the FFmpeg core loader uses, so the
 * published library cannot start in Chromium when the worker is a separate
 * file. `scripts/setup-ffmpeg.mjs` rewrites those two expressions while copying
 * the UMD bundle to `public/ffmpeg/ffmpeg.js`:
 *
 *   new Worker(new URL(s, "<baked path>"), { type: "module" })  →  new Worker(s)
 *   new Worker(new URL(<chunk>, e.b), { type: void 0 })         →  resolved from location.href
 */
const LIBRARY_URL = "/ffmpeg/ffmpeg.js";

type FFmpegModule = { FFmpeg: new () => FFmpeg };

async function loadLibrary(): Promise<FFmpegModule> {
  const w = window as unknown as { FFmpegWASM?: FFmpegModule };
  if (w.FFmpegWASM?.FFmpeg) return w.FFmpegWASM;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = LIBRARY_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${LIBRARY_URL}`));
    document.head.appendChild(script);
  });
  if (!w.FFmpegWASM?.FFmpeg) throw new Error("FFmpeg library did not register itself");
  return w.FFmpegWASM;
}

/**
 * FFmpeg.wasm wrapper.
 *
 * The core is served from `/ffmpeg/` (copied there by `npm run setup:ffmpeg`)
 * so it can be loaded from the same origin without SharedArrayBuffer or COOP/COEP
 * headers. All processing happens in the browser tab.
 */

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
let progressHandler: ((ratio: number, message: string) => void) | null = null;

/**
 * The core is the *classic* (UMD) build: the worker imports it with
 * `importScripts`, which cannot load an ES module.
 */
export const FFMPEG_CORE = {
  coreURL: "/ffmpeg/ffmpeg-core.js",
  wasmURL: "/ffmpeg/ffmpeg-core.wasm",
  workerURL: "/ffmpeg/ffmpeg-worker.js",
};

/**
 * Absolute URLs for the core, worker and wasm files.
 *
 * The core is fetched and handed to the worker as a Blob URL. Workers created
 * from a Blob URL (or from a module worker) cannot `importScripts` a
 * cross-origin URL, and a static file served by a bundler may be transformed;
 * a Blob URL of the exact bytes we fetched avoids both problems.
 */
export async function ffmpegCoreConfig() {
  const abs = (path: string) => new URL(path, window.location.href).href;
  let coreURL = abs(FFMPEG_CORE.coreURL);
  try {
    const source = await (await fetch(coreURL)).text();
    // keep the blob URL alive for the whole session (revoking it breaks the worker)
    coreURL = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  } catch {
    /* fall back to the served file */
  }
  return {
    coreURL,
    wasmURL: abs(FFMPEG_CORE.wasmURL),
    workerURL: abs(FFMPEG_CORE.workerURL),
  };
}

/** Read a Blob/File into a Uint8Array for FFmpeg's virtual file system. */
async function toUint8(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

export function ffmpegAvailable(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined";
}

export async function loadFFmpeg(
  onProgress?: (ratio: number, message: string) => void,
): Promise<FFmpeg> {
  if (instance?.loaded) {
    if (onProgress) progressHandler = onProgress;
    return instance;
  }
  if (loading) {
    const ff = await loading;
    if (onProgress) progressHandler = onProgress;
    return ff;
  }
  progressHandler = onProgress ?? null;
  loading = (async () => {
    const { FFmpeg: FFmpegClass } = await loadLibrary();
    const ff = new FFmpegClass();
    // An absolute URL keeps the library from calling `new URL(..., import.meta.url)`.
    const config = await ffmpegCoreConfig();
    ff.on("log", (data) => {
      const { message } = data as { message: string };
      const match = message.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (match && progressHandler) {
        // FFmpeg does not know the total duration here; the caller maps time.
        progressHandler(0, `time=${match[1]}:${match[2]}:${match[3]}`);
      }
    });
    ff.on("progress", (data) => {
      const { progress } = data as { progress: number };
      if (progressHandler) progressHandler(Math.max(0, Math.min(1, progress)), "Encoding");
    });
    // `workerURL` is forwarded to the worker, which needs it for `wasmURL`
    // resolution; the worker itself is started from an absolute URL so the
    // library never calls `new URL(..., import.meta.url)`.
    await ff.load({
      ...config,
      classWorkerURL: config.workerURL,
    } as unknown as { coreURL: string; wasmURL: string; classWorkerURL?: string });
    instance = ff;
    return ff;
  })();
  try {
    return await loading;
  } catch (err) {
    loading = null;
    throw new Error(
      `FFmpeg.wasm could not start (${(err as Error).message}). Run "npm run setup:ffmpeg" so the core is served from /ffmpeg/.`,
    );
  }
}

export function isFFmpegLoaded(): boolean {
  return Boolean(instance?.loaded);
}

/** Convert any audio blob to MP3 with libmp3lame. */
export async function transcodeToMp3(
  input: Blob,
  bitrateKbps = 192,
  onProgress?: (ratio: number, message: string) => void,
): Promise<Blob> {
  const ff = await loadFFmpeg(onProgress);
  const ext = input.type.includes("wav") ? "wav" : input.type.includes("webm") ? "webm" : "bin";
  await ff.writeFile(`input.${ext}`, await toUint8(input));
  await ff.exec([
    "-i",
    `input.${ext}`,
    "-vn",
    "-c:a",
    "libmp3lame",
    "-b:a",
    `${bitrateKbps}k`,
    "output.mp3",
  ]);
  const data = await ff.readFile("output.mp3");
  await ff.deleteFile(`input.${ext}`);
  await ff.deleteFile("output.mp3");
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return new Blob([bytes as BlobPart], { type: "audio/mpeg" });
}

/** Convert any video blob to a target container/codec set. */
export async function transcodeVideo(
  input: Blob,
  options: { extension: "mp4" | "mov" | "webm"; bitrateKbps: number },
  onProgress?: (ratio: number, message: string) => void,
): Promise<Blob> {
  const ff = await loadFFmpeg(onProgress);
  const inExt = input.type.includes("webm") ? "webm" : input.type.includes("quicktime") ? "mov" : "mp4";
  await ff.writeFile(`in.${inExt}`, await toUint8(input));
  const out = `out.${options.extension}`;
  const codec = options.extension === "webm" ? ["-c:v", "libvpx-vp9"] : ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"];
  await ff.exec([
    "-i",
    `in.${inExt}`,
    ...codec,
    "-b:v",
    `${options.bitrateKbps}k`,
    "-c:a",
    options.extension === "webm" ? "libopus" : "aac",
    "-b:a",
    "192k",
    out,
  ]);
  const data = await ff.readFile(out);
  await ff.deleteFile(`in.${inExt}`);
  await ff.deleteFile(out);
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return new Blob([bytes as BlobPart], {
    type: options.extension === "webm" ? "video/webm" : options.extension === "mov" ? "video/quicktime" : "video/mp4",
  });
}
