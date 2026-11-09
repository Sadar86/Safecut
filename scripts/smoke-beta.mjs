/**
 * Beta 1 critical-workflow smoke test (item 4 of the beta checklist).
 *
 * Covers: project creation + saving, video and audio import, timeline editing,
 * captions + subtitles, audio processing, scene detection, MP4 export, AI model
 * loading, background removal, smart reframing and project recovery.
 *
 *   npm run build && npx next start -p 3000 &
 *   node scripts/smoke-beta.mjs http://localhost:3000
 */
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3000";
const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

/** Create a real WAV and a real WebM clip in the page and import them. */
async function makeMedia() {
  return page.evaluate(async () => {
    const media = await window.__safecutMedia();
    // 3 s tone + 1 s silence + 2 s tone
    const rate = 22050;
    const total = rate * 6;
    const ch = new Float32Array(total);
    for (let i = 0; i < rate * 3; i++) ch[i] = 0.4 * Math.sin((2 * Math.PI * 330 * i) / rate);
    for (let i = rate * 4; i < total; i++) ch[i] = 0.4 * Math.sin((2 * Math.PI * 330 * i) / rate);
    const buf = new ArrayBuffer(44 + total * 2);
    const v = new DataView(buf);
    const str = (o, s) => [...s].forEach((c, k) => v.setUint8(o + k, c.charCodeAt(0)));
    str(0, "RIFF"); v.setUint32(4, 36 + total * 2, true); str(8, "WAVE"); str(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true);
    v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, total * 2, true);
    for (let i = 0; i < total; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, ch[i])) * 0x7fff, true);
    const wavFile = new File([new Blob([buf], { type: "audio/wav" })], "beta-audio.wav", { type: "audio/wav" });

    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(30);
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    rec.start();
    const t0 = performance.now();
    await new Promise((res) => {
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        ctx.fillStyle = t < 1.5 ? "#1f2937" : "#7c2d12";
        ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = "#f2c9a0";
        ctx.beginPath();
        ctx.ellipse(300 + 500 * Math.min(1, t / 3), 330, 110, 145, 0, 0, Math.PI * 2);
        ctx.fill();
        if (t < 3.2) requestAnimationFrame(tick);
        else res();
      };
      requestAnimationFrame(tick);
    });
    rec.stop();
    await done;
    const videoFile = new File([new Blob(chunks, { type: "video/webm" })], "beta-clip.webm", { type: "video/webm" });

    const { assets, errors: importErrors } = await media.importFiles([videoFile, wavFile]);
    window.__safecutStore.getState().addAssets(assets);
    return {
      count: assets.length,
      kinds: assets.map((a) => `${a.kind}:${a.name}`),
      errors: importErrors,
      video: assets.find((a) => a.kind === "video")?.id,
      audio: assets.find((a) => a.kind === "audio")?.id,
    };
  });
}

const store = (fn, arg) => page.evaluate(fn, arg);

try {
  /* ------------------------------------------------------ project + save --- */
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /New project/i }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /Create project/i }).click();
  await page.waitForSelector("[data-testid=preview-canvas]", { timeout: 30000 });
  record("create a new project from the dashboard", true, page.url());

  const media = await makeMedia();
  record("import a video and an audio file", media.count === 2 && media.errors.length === 0, media.kinds.join(", "));

  /* --------------------------------------------------- timeline editing --- */
  const placed = await store(({ video, audio }) => {
    const s = window.__safecutStore.getState();
    const p = s.project;
    const vTrack = p.tracks.find((t) => t.kind === "video");
    const aTrack = p.tracks.find((t) => t.kind === "audio");
    const blank = {
      speed: 1, reversed: false, filter: "none", transitionIn: "none", transitionOut: "none",
      transitionDuration: 0.5, keyframes: [],
      color: { brightness: 1, contrast: 1, saturation: 1, temperature: 0, tint: 0, exposure: 0, highlights: 0, shadows: 0, blur: 0, sharpen: 0, vignette: 0, grain: 0, opacity: 1 },
      transform: { scale: 1, x: 0, y: 0, rotation: 0, flipH: false, flipV: false },
      audio: { volume: 1, fadeIn: 0, fadeOut: 0, muted: false, eq: { low: 0, mid: 0, high: 0 } },
    };
    const vClip = { ...blank, id: "clp_beta_v", trackId: vTrack.id, mediaId: video, name: "beta-clip.webm", start: 0, duration: 3, inPoint: 0, sourceDuration: 3 };
    const aClip = { ...blank, id: "clp_beta_a", trackId: aTrack.id, mediaId: audio, name: "beta-audio.wav", start: 0, duration: 6, inPoint: 0, sourceDuration: 6 };
    s.commit([...p.clips, vClip, aClip], "beta: place clips");
    const after = window.__safecutStore.getState().project.clips;
    return {
      clips: after.length,
      names: after.map((c) => c.name),
      tracks: p.tracks.map((t) => t.kind),
      vTrack: vTrack?.id,
      aTrack: aTrack?.id,
    };
  }, media);
  record(
    "place clips on the timeline",
    placed.clips >= 4 && placed.names.includes("beta-clip.webm") && placed.names.includes("beta-audio.wav"),
    `${placed.clips} clips: ${placed.names.join(", ")} · tracks ${placed.tracks?.join("/")}`,
  );

  await store(() => window.__safecutStore.getState().select(["clp_beta_v"]));
  await page.keyboard.press("s"); // split at playhead (0) is a no-op; move first
  await store(() => window.__safecutStore.getState().setPlayhead(1.5));
  await page.keyboard.press("s");
  const afterSplit = await store(() => window.__safecutStore.getState().project.clips.filter((c) => c.name === "beta-clip.webm").length);
  record("split a clip at the playhead", afterSplit === 2, `${afterSplit} pieces`);

  await page.keyboard.press("Control+z");
  const afterUndo = await store(() => window.__safecutStore.getState().project.clips.filter((c) => c.name === "beta-clip.webm").length);
  record("undo restores the split clip", afterUndo === 1, `${afterUndo} piece(s)`);

  /* ------------------------------------------------------- captions/SRT --- */
  await page.getByRole("button", { name: "Captions", exact: true }).first().click();
  await page.getByRole("button", { name: /^Cues/ }).click();
  await page.getByRole("button", { name: /Add cue at playhead/ }).click();
  const cues = await page.locator("textarea[aria-label='Cue text']").count();
  record("add a subtitle cue", cues >= 1, `${cues} cue(s)`);

  const srt = await store(async () => {
    const mod = await import("/_next/static/chunks/x.js").catch(() => null);
    void mod;
    return null;
  }).catch(() => null);
  void srt;

  /* --------------------------------------------------- audio processing --- */
  await page.evaluate(() => {
    const s = window.__safecutStore.getState();
    s.select(["clp_beta_a"]);
    s.setPanel("ai");
  });
  await page.locator("button[aria-pressed]").filter({ hasText: /^Silence$/ }).last().click();
  await page.getByRole("button", { name: /Detect silence/ }).click();
  await page.waitForTimeout(2500);
  const silenceText = await page.locator("body").innerText();
  const silentSegments = Number(silenceText.match(/(\d+) segments ·/)?.[1] ?? 0);
  record("audio: silence detection finds the gap", silentSegments >= 1, `${silentSegments} segment(s)`);

  /* -------------------------------------------------- scene detection --- */
  await page.evaluate(() => {
    const s = window.__safecutStore.getState();
    s.select(["clp_beta_v"]);
    s.setPanel("scenes");
  });
  await page.getByRole("button", { name: /Detect scenes/ }).click();
  await page.waitForTimeout(8000);
  const sceneText = await page.locator("body").innerText();
  record("scene detection runs on a real clip", /scenes/.test(sceneText), sceneText.match(/\d+ scenes[^\n]*/)?.[0] ?? "");

  /* -------------------------------------------------------- MP4 export --- */
  await page.evaluate(() => {
    const s = window.__safecutStore.getState();
    s.setPlayhead(0);
  });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "Browser recorder" }).click();
  await page.getByRole("button", { name: /Start export/ }).click();
  let toast = "none";
  for (let i = 0; i < 60; i++) {
    const t = await page.locator("body").innerText();
    const m = t.match(/(Export finished[^\n]*|Export failed[^\n]*|Export cancelled[^\n]*)/);
    if (m) {
      toast = m[1];
      break;
    }
    await page.waitForTimeout(2000);
  }
  record("export completes in the browser recorder", /finished/i.test(toast), toast);
  const download = page.getByRole("button", { name: /^Download/ });
  const [file] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }).catch(() => null),
    download.first().click().catch(() => null),
  ]);
  record("exported file downloads", Boolean(file), file ? await file.suggestedFilename() : "no download");
  await page.keyboard.press("Escape");

  /* ------------------------------------------------------- AI: model ----- */
  await page.evaluate(() => {
    const s = window.__safecutStore.getState();
    s.select(["clp_beta_v"]);
    s.setPanel("ai");
  });
  await page.locator("button[aria-pressed]").filter({ hasText: /^Background$/ }).last().click();
  const deviceText = await page.locator("body").innerText();
  record("AI Studio shows device capabilities", /cores ·/.test(deviceText));

  const faceApi = await page.evaluate(async () => {
    const det = await window.__safecutFace();
    const detector = await det.loadFaceDetector();
    return Boolean(detector);
  });
  record("AI model loads (MediaPipe face detector)", faceApi === true);

  /* -------------------------------------------------- background removal --- */
  await page.getByRole("button", { name: /Detect subject/ }).click();
  let matteDetail = "no status";
  let matteReady = false;
  for (let i = 0; i < 60; i++) {
    const summary = await page.getByTestId("matte-summary").count();
    const status = await page.getByTestId("matte-status").innerText().catch(() => "");
    matteDetail = summary ? (await page.getByTestId("matte-summary").innerText()) : status || matteDetail;
    if (summary > 0) {
      matteReady = true;
      break;
    }
    if (/failed|not support/i.test(status)) {
      matteDetail = status;
      break;
    }
    await page.waitForTimeout(2000);
  }
  record("background removal produces a matte", matteReady, matteDetail.replace(/\n/g, " · "));

  /* ------------------------------------------------------- reframing ----- */
  await page.locator("button[aria-pressed]").filter({ hasText: /^Reframe$/ }).last().click();
  await page.getByRole("button", { name: "Vertical 9:16", exact: true }).click();
  await page.getByRole("button", { name: /Apply reframe/ }).click();
  await page.waitForTimeout(600);
  const settings = await store(() => window.__safecutStore.getState().project.settings);
  record("smart reframe changes the project to 9:16", settings.aspectRatio === "9:16", `${settings.width}×${settings.height}`);

  /* ------------------------------------------------- project recovery ---- */
  await page.evaluate(() => localStorage.setItem("safecut.dirty", "1"));
  const recovery = await context.newPage();
  await recovery.goto(`${BASE}/editor`, { waitUntil: "networkidle" });
  await recovery.waitForSelector("[data-testid=preview-canvas]");
  await recovery.waitForTimeout(2000);
  const banner = await recovery.getByText(/last session closed/i).count();
  const clipsAfter = await recovery.evaluate(() => window.__safecutStore.getState().project.clips.length);
  record("project recovery banner after an interrupted session", banner > 0, `banner=${banner}`);
  record("project reloads with its clips", clipsAfter >= 4, `${clipsAfter} clips`);
  await recovery.close();

  const real = errors.filter((e) => !/favicon|ResizeObserver|4\d\d\)/i.test(e));
  record("no unexpected console errors", real.length === 0, real.slice(0, 3).join(" | "));
} catch (err) {
  record("beta smoke crashed", false, String(err).slice(0, 300));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
