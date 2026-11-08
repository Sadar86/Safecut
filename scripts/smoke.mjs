/**
 * End-to-end smoke test for the browser-only paths that the Node unit suite
 * cannot reach: editor boot, project auto-save + recovery, timeline editing,
 * captions, and the export pipeline (MediaRecorder capture + FFmpeg.wasm load).
 *
 * Run against a production build:
 *   npm run build && npx next start -p 3112 &
 *   node scripts/smoke.mjs http://localhost:3112
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3112";
const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

try {
  /* ---------------------------------------------------------------- boot --- */
  await page.goto(`${BASE}/editor`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid=preview-canvas]", { timeout: 20000 });
  record("editor boots and renders preview canvas", true);

  const clipCount = await page.locator("[data-testid=timeline-clip]").count();
  record("demo project loads clips into the timeline", clipCount > 0, `${clipCount} clips`);

  /* --------------------------------------------------------- persistence --- */
  const projectId = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const req = indexedDB.open("safecut");
      req.onsuccess = () => resolve(req.result);
    });
    const all = await new Promise((resolve) => {
      const req = db.transaction("projects").objectStore("projects").getAll();
      req.onsuccess = () => resolve(req.result);
    });
    return all[0]?.id ?? null;
  });
  record("project is persisted in IndexedDB", Boolean(projectId), projectId ?? "none");

  // Edit something, then force a save and check it round-trips through storage.
  await page.locator("[data-testid=timeline-clip]").first().click();
  await page.keyboard.press("Control+d"); // duplicate
  await page.waitForTimeout(400);
  const duplicated = await page.locator("[data-testid=timeline-clip]").count();
  record("Ctrl+D duplicates a clip", duplicated > clipCount, `${clipCount} → ${duplicated}`);

  await page.keyboard.press("Control+s");
  await page.waitForTimeout(800);
  const storedCount = await page.evaluate(async (id) => {
    const db = await new Promise((resolve) => {
      const req = indexedDB.open("safecut");
      req.onsuccess = () => resolve(req.result);
    });
    const project = await new Promise((resolve) => {
      const req = db.transaction("projects").objectStore("projects").get(id);
      req.onsuccess = () => resolve(req.result);
    });
    return project?.clips?.length ?? -1;
  }, projectId);
  record("Ctrl+S saves the edited project to storage", storedCount === duplicated, `${storedCount} clips stored`);

  // Simulate an interrupted session. The editor legitimately saves on unload,
  // which clears the dirty flag, so plant the flag and open a fresh page (no
  // unload handler of a loaded editor runs).
  const recovery = await context.newPage();
  await recovery.goto(`${BASE}/editor`, { waitUntil: "networkidle" });
  await recovery.evaluate(() => localStorage.setItem("safecut.dirty", "1"));
  await recovery.close();

  const fresh = await context.newPage();
  await fresh.goto(`${BASE}/editor`, { waitUntil: "networkidle" });
  await fresh.waitForSelector("[data-testid=preview-canvas]");
  await fresh.waitForTimeout(1500);
  const dirtyFlag = await fresh.evaluate(() => localStorage.getItem("safecut.dirty"));
  const banner = await fresh
    .getByText(/last session closed before it finished saving/i)
    .count()
    .catch(() => 0);
  record("recovery banner appears after an interrupted session", banner > 0, `dirty=${dirtyFlag}, banner=${banner}`);
  const afterReload = await fresh.locator("[data-testid=timeline-clip]").count();
  record("project reloads with its clips after a refresh", afterReload === duplicated, `${afterReload} clips`);
  await fresh.close();

  /* ------------------------------------------------------------- captions --- */
  await page.getByRole("button", { name: "Captions" }).first().click();
  await page.getByRole("button", { name: /^Cues/ }).click();
  await page.getByRole("button", { name: /Add cue at playhead/ }).click();
  const cues = await page.locator("textarea[aria-label='Cue text']").count();
  record("caption cue can be added in the caption editor", cues > 0, `${cues} cue(s)`);

  /* --------------------------------------------------------------- scenes --- */
  await page.getByRole("button", { name: "Scenes" }).first().click();
  const detectButton = page.getByRole("button", { name: /Detect scenes/ });
  record("scene panel exposes detection", (await detectButton.count()) > 0);

  /* --------------------------------------------------------------- export --- */
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.waitForTimeout(300);
  const engineButtons = await page.getByRole("button", { name: /FFmpeg\.wasm|Browser recorder/ }).count();
  record("export dialog offers both engines", engineButtons === 2);

  await page.keyboard.press("Escape");
  // Shrink the project to ~2s so the export completes quickly. The store is
  // exposed on window in development/smoke builds via __safecutStore.
  await page.evaluate(() => {
    const store = window.__safecutStore;
    if (!store) return;
    const project = store.getState().project;
    const clips = project.clips.map((c, i) => (i === 0 ? { ...c, start: 0, duration: 2 } : { ...c, start: 0, duration: 2 }));
    store.getState().commit(clips, "smoke: shorten");
  });

  // Load the FFmpeg core in the page exactly as the app does, to prove the
  // assets are served correctly and the worker + core agree.
  const ffmpegLoaded = await page.evaluate(async () => {
    try {
      const script = document.createElement("script");
      script.src = "/ffmpeg/ffmpeg.js";
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      const ff = new window.FFmpegWASM.FFmpeg();
      const cfg = await window.__safecutFFmpegCore();
      await ff.load({ ...cfg, classWorkerURL: cfg.workerURL });
      const code = await ff.exec(["-version"]);
      return { loaded: ff.loaded === true, code };
    } catch (err) {
      return `error: ${err}`;
    }
  });
  record(
    "FFmpeg.wasm core loads and executes",
    ffmpegLoaded?.loaded === true && ffmpegLoaded?.code === 0,
    JSON.stringify(ffmpegLoaded),
  );

  /* ------------------------------------------- canvas capture + recorder --- */
  const recorderOk = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(30);
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: "video/webm" });
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise((resolve) => (rec.onstop = resolve));
    rec.start();
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        ctx.fillStyle = `hsl(${(performance.now() - t0) / 5}, 80%, 50%)`;
        ctx.fillRect(0, 0, 320, 180);
        if (performance.now() - t0 < 1200) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: "video/webm" });
    return blob.size;
  });
  record("canvas → MediaRecorder produces a video blob", recorderOk > 0, `${recorderOk} bytes`);

  /* ------------------------------------------------- real export through UI --- */
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "Browser recorder" }).click();
  await page.getByRole("button", { name: /Start export/ }).click();
  const finished = await page
    .getByText(/Export finished|Export failed|Export cancelled/i)
    .first()
    .waitFor({ timeout: 120000 })
    .then(() => true)
    .catch(() => false);
  const toastText = finished ? await page.getByText(/Export finished|Export failed|Export cancelled/i).first().innerText() : "timeout";
  record("UI export completes", /finished/i.test(toastText), toastText);

  const sizeText = await page
    .getByText(/video\/webm|video\/mp4/iu)
    .first()
    .innerText()
    .catch(() => "");
  const megabytes = Number((sizeText.match(/([\d.]+)\s*MB/) ?? [])[1] ?? 0);
  record("exported video has data", megabytes > 0, sizeText || "no size reported");

  /* ------------------------------------------------------- console health --- */
  const realErrors = consoleErrors.filter((e) => !/favicon|ResizeObserver/i.test(e));
  record("no unexpected console errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

  /* --------------------------------------- FFmpeg engine end-to-end export --- */
  // Close the previous export dialog (it shows the finished video) and reload
  // for a clean project state.
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid=preview-canvas]");
  await page.evaluate(() => {
    const store = window.__safecutStore;
    const p = store.getState().project;
    store.getState().commit(p.clips.map((c) => ({ ...c, start: 0, duration: 2 })), "smoke: shorten");
  });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "FFmpeg.wasm (H.264)" }).click();
  await page.getByRole("button", { name: /Start export/ }).click();
  let ffToast = "none";
  for (let i = 0; i < 120; i++) {
    const text = await page.locator("body").innerText();
    const match = text.match(/(Export finished[^\n]*|Export failed[^\n]*|Export cancelled[^\n]*)/);
    if (match) {
      ffToast = match[1];
      break;
    }
    await page.waitForTimeout(2500);
  }
  record("FFmpeg.wasm export completes", /finished/i.test(ffToast), ffToast);

  const downloadButton = page.getByRole("button", { name: /^Download/ });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }).catch(() => null),
    downloadButton.first().click(),
  ]);
  if (download) {
    const path = await download.path();
    const { readFileSync, statSync } = await import("node:fs");
    const bytes = readFileSync(path);
    const ftyp = bytes.subarray(4, 8).toString("latin1");
    record(
      "downloaded file is a real MP4",
      ftyp === "ftyp" && statSync(path).size > 10000,
      `${download.suggestedFilename()} · ${statSync(path).size} bytes · ftyp=${ftyp}`,
    );
  } else {
    record("downloaded file is a real MP4", false, "no download event");
  }
} catch (err) {
  record("smoke test crashed", false, String(err));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
writeFileSync("smoke-report.json", JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
