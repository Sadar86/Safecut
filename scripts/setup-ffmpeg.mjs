/**
 * Prepare the FFmpeg.wasm assets in public/ffmpeg so everything is served from
 * the app's own origin (no CDN at runtime, no COOP/COEP headers needed).
 *
 *  - ffmpeg-core.js / ffmpeg-core.wasm: the classic (UMD) core
 *  - ffmpeg-worker.js: the library's ESM worker, bundled into a single classic
 *    script (it imports ./const.js and ./errors.js, and a module worker cannot
 *    importScripts the core)
 *  - ffmpeg.js: the UMD library with two expressions patched so the worker is
 *    created without `{ type: "module" }` and resolved from the page
 *
 * When @ffmpeg/* is installed (normal `npm install`) the files are copied and
 * rebuilt from node_modules. Otherwise the published files are downloaded so a
 * fresh clone or a CI/Vercel build still gets a working core. A failure here is
 * never fatal: the app falls back to the browser recorder for export.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "public", "ffmpeg");
const coreSrc = join(root, "node_modules", "@ffmpeg", "core", "dist", "umd");
const libSrc = join(root, "node_modules", "@ffmpeg", "ffmpeg", "dist", "umd", "ffmpeg.js");
const workerEntry = join(root, "node_modules", "@ffmpeg", "ffmpeg", "dist", "esm", "worker.js");

mkdirSync(dest, { recursive: true });

const CORE_JS = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js";
const CORE_WASM = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm";

async function download(url, name) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  writeFileSync(join(dest, name), Buffer.from(await response.arrayBuffer()));
  console.log(`[setup:ffmpeg] downloaded ${name}`);
}

/** Bundle the library worker into a classic script. */
async function bundleWorker(entry) {
  const { build } = await import("esbuild");
  await build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    target: "es2022",
    outfile: join(dest, "ffmpeg-worker.js"),
    logLevel: "silent",
  });
  console.log("[setup:ffmpeg] ffmpeg-worker.js built");
}

/** Patch the UMD library so its worker starts as a classic script. */
function patchLibrary(source) {
  const patched = source
    // Drop both the baked path and the module-worker options: a module worker
    // cannot importScripts the FFmpeg core.
    .replace(/new Worker\(new URL\(s,"file:\/\/\/[^"]*"\),\{type:"module"\}\)/g, "new Worker(s)")
    .replace(/new Worker\(new URL\(s,"https:\/\/localhost\.invalid\/ffmpeg-worker\.js"\),\{type:"module"\}\)/g, "new Worker(s)")
    .replace(/new Worker\(new URL\(e\.p\+e\.u\(814\),e\.b\)/g, "new Worker(new URL(e.p+e.u(814),location.href)");
  // The UMD build is minified differently per version; accept either the bare
  // `new Worker(s)` or the same call followed by the dropped options object.
  if (!/new Worker\(s[,)]/.test(patched)) {
    throw new Error("could not patch the worker constructor - check the @ffmpeg/ffmpeg version");
  }
  return patched;
}

try {
  if (existsSync(coreSrc) && existsSync(workerEntry)) {
    for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
      copyFileSync(join(coreSrc, file), join(dest, file));
      console.log(`[setup:ffmpeg] ${file} -> public/ffmpeg/`);
    }
    await bundleWorker(workerEntry);
    writeFileSync(join(dest, "ffmpeg.js"), patchLibrary(readFileSync(libSrc, "utf8")));
    console.log("[setup:ffmpeg] ffmpeg.js patched");
  } else {
    console.log("[setup:ffmpeg] @ffmpeg packages not installed - using committed files");
    if (!existsSync(join(dest, "ffmpeg-core.js"))) await download(CORE_JS, "ffmpeg-core.js");
    if (!existsSync(join(dest, "ffmpeg-core.wasm"))) await download(CORE_WASM, "ffmpeg-core.wasm");
    // ffmpeg.js and ffmpeg-worker.js are committed and already patched/bundled.
    if (!existsSync(join(dest, "ffmpeg.js"))) {
      throw new Error("public/ffmpeg/ffmpeg.js is missing from the repository");
    }
    console.log("[setup:ffmpeg] using committed ffmpeg.js and ffmpeg-worker.js");
  }
} catch (err) {
  console.warn(`[setup:ffmpeg] ${err.message}`);
  console.warn("[setup:ffmpeg] MP4/MOV export will fall back to the browser recorder");
}
