/**
 * Prepare the on-device vision assets:
 *  - MediaPipe tasks-vision wasm runtime → public/models/wasm
 *  - BlazeFace short-range detector → public/models/blaze_face_short_range.tflite
 *
 * Run with `npm run setup:models` (also part of postinstall). Files are cached
 * in the repo's public folder so the app never fetches code from a third-party
 * CDN at runtime.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "public", "models");
mkdirSync(join(dest, "wasm"), { recursive: true });

const wasmSrc = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
if (existsSync(wasmSrc)) {
  for (const file of ["vision_wasm_internal.js", "vision_wasm_internal.wasm"]) {
    copyFileSync(join(wasmSrc, file), join(dest, "wasm", file));
    console.log(`[setup:models] wasm/${file}`);
  }
} else {
  console.warn("[setup:models] @mediapipe/tasks-vision not installed — skipping wasm");
}

const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const FACE_FIXTURE = "https://storage.googleapis.com/mediapipe-assets/portrait.jpg";
const fixtureTarget = join(dest, "test-face.jpg");
if (!existsSync(fixtureTarget)) {
  try {
    const response = await fetch(FACE_FIXTURE);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    writeFileSync(fixtureTarget, Buffer.from(await response.arrayBuffer()));
    console.log("[setup:models] test-face.jpg (validation fixture)");
  } catch (err) {
    console.warn(`[setup:models] could not download the test portrait: ${err.message}`);
  }
}

const faceTarget = join(dest, "blaze_face_short_range.tflite");
if (existsSync(faceTarget)) {
  console.log("[setup:models] face model already present");
} else {
  try {
    const response = await fetch(FACE_MODEL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(faceTarget, buffer);
    console.log(`[setup:models] blaze_face_short_range.tflite (${(buffer.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    console.warn(`[setup:models] could not download the face model: ${err.message}`);
  }
}
