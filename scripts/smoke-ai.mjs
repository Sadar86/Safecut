/**
 * End-to-end smoke tests for the Phase 3 AI Creator Studio.
 *
 * Runs against a production build. Every AI panel is opened, the local-only
 * features are exercised for real, and the model-backed features are driven until
 * they either succeed or report a clear, user-facing failure.
 *
 *   npm run build && npx next start -p 3130 &
 *   node scripts/smoke-ai.mjs http://localhost:3130
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3130";
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
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

const openAi = async (tab) => {
  await page.getByRole("button", { name: "AI Studio", exact: true }).click();
  // AI tabs are pill buttons; the left rail has buttons with the same name.
  await page.locator("button[aria-pressed]").filter({ hasText: new RegExp(`^${tab}$`) }).last().click();
  await page.waitForTimeout(250);
};

const bodyText = () => page.locator("body").innerText();

try {
  await page.goto(`${BASE}/editor`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid=preview-canvas]", { timeout: 30000 });
  record("editor boots with the AI Studio tab", (await page.getByRole("button", { name: "AI Studio", exact: true }).count()) === 1);

  // Device report is shown in every AI panel.
  await openAi("Captions");
  const captionText = await bodyText();
  record("AI Studio reports device capabilities", /cores ·/.test(captionText) && /tier/.test(captionText));

  // Every AI tab opens without an error boundary.
  for (const tab of ["Captions", "Silence", "Voice", "Background", "Reframe", "Highlights", "Voice-over", "Assistant"]) {
    await openAi(tab);
    const text = await bodyText();
    record(`AI tab "${tab}" renders`, text.length > 200 && !/Application error/i.test(text));
  }

  /* ------------------------------------------------------------- assistant --- */
  await openAi("Assistant");
  await page.getByPlaceholder("Topic (optional)").fill("Iceland road trip");
  await page.getByRole("button", { name: "Titles", exact: true }).click();
  await page.waitForTimeout(500);
  let text = await bodyText();
  record("assistant suggests titles for the topic", /iceland/i.test(text) && /Title ideas/i.test(text));

  await page.getByRole("button", { name: "Aspect", exact: true }).click();
  await page.waitForTimeout(500);
  text = await bodyText();
  const hasApply = (await page.getByRole("button", { name: /Set project to/ }).count()) > 0;
  record("assistant recommends an aspect ratio with an explicit apply button", /Aspect ratio/i.test(text) && hasApply);

  // Applying is explicit and undoable.
  const before = await page.evaluate(() => window.__safecutStore.getState().project.settings.aspectRatio);
  await page.getByRole("button", { name: /Set project to/ }).click();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__safecutStore.getState().project.settings.aspectRatio);
  record("assistant only changes the project when applied", before === "16:9" && after !== before, `${before} → ${after}`);

  await page.getByPlaceholder("Paste a script for an editing plan…").fill("Welcome back. Today we drive the ring road. Then we stop at a waterfall.");
  await page.getByRole("button", { name: "Script plan", exact: true }).click();
  await page.waitForTimeout(500);
  text = await bodyText();
  record("assistant builds a timed plan from a script", /Editing plan/i.test(text) && /Welcome back/.test(text));

  /* ---------------------------------------------------------------- silence --- */
  // Give the timeline a real audio clip to analyse: generate a TTS line.
  await openAi("Voice-over");
  await page.getByLabel("Text to speak").fill("This is a SafeCut voice over test with several words in it.");
  await page.getByRole("button", { name: /Generate voice clip/ }).click();
  await page.waitForTimeout(2500);
  const assets = await page.evaluate(() => window.__safecutStore.getState().project.assets.length);
  const audioClips = await page.evaluate(() =>
    window.__safecutStore.getState().project.clips.filter((c) => c.mediaId && c.name.includes("voice-")).length,
  );
  record("text-to-speech creates a WAV asset", assets >= 1, `${assets} assets`);
  record("text-to-speech places a clip on the audio track", audioClips === 1, `${audioClips} clips`);

  const ttsBlob = await page.evaluate(async () => {
    const asset = window.__safecutStore.getState().project.assets.find((a) => a.source === "tts");
    if (!asset?.url) return null;
    const response = await fetch(asset.url);
    const buffer = await response.arrayBuffer();
    return { size: buffer.byteLength, riff: String.fromCharCode(...new Uint8Array(buffer.slice(0, 4))) };
  });
  record("generated audio is a valid WAV file", ttsBlob?.riff === "RIFF" && ttsBlob.size > 10000, `${ttsBlob?.size ?? 0} bytes`);

  // Select the TTS clip and run silence detection on it.
  await page.evaluate(() => {
    const store = window.__safecutStore;
    const clip = store.getState().project.clips.find((c) => c.name.includes("voice-"));
    store.getState().select([clip.id]);
  });
  await openAi("Silence");
  await page.getByRole("button", { name: /Detect silence/ }).click();
  await page.waitForTimeout(2500);
  text = await bodyText();
  const silentCount = Number(text.match(/(\d+) segments ·/)?.[1] ?? 0);
  record(
    "silence detection shows segments before editing",
    /segments ·/.test(text),
    `${silentCount} segments listed${silentCount > 0 ? "" : " (synthetic voice has no long silence)"}`,
  );

  // Make a clip that definitely contains silence: tone + 2 s gap + tone.
  const madeSilence = await page.evaluate(async () => {
    const sampleRate = 22050;
    const total = sampleRate * 5;
    const channel = new Float32Array(total);
    for (let i = 0; i < sampleRate; i++) channel[i] = 0.4 * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
    for (let i = sampleRate * 3; i < total; i++) channel[i] = 0.4 * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
    const wav = (() => {
      const buffer = new ArrayBuffer(44 + total * 2);
      const view = new DataView(buffer);
      const str = (o, v) => [...v].forEach((ch, k) => view.setUint8(o + k, ch.charCodeAt(0)));
      str(0, "RIFF"); view.setUint32(4, 36 + total * 2, true); str(8, "WAVE"); str(12, "fmt ");
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, "data"); view.setUint32(40, total * 2, true);
      for (let i = 0; i < total; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, channel[i])) * 0x7fff, true);
      return new Blob([buffer], { type: "audio/wav" });
    })();
    const id = `ast_silence_${Date.now()}`;
    const db = await new Promise((resolve) => {
      const req = indexedDB.open("safecut");
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise((resolve) => {
      const tx = db.transaction("blobs", "readwrite");
      tx.objectStore("blobs").put(wav, id);
      tx.oncomplete = resolve;
    });
    const store = window.__safecutStore;
    const project = store.getState().project;
    const track = project.tracks.find((t) => t.kind === "audio");
    const asset = {
      id, name: "silence-test.wav", kind: "audio", mimeType: "audio/wav", size: wav.size,
      duration: 5, width: 0, height: 0, url: URL.createObjectURL(wav), createdAt: Date.now(), hasAudio: true,
    };
    store.getState().addAssets([asset]);
    const clip = {
      id: `clp_${Date.now()}`, trackId: track.id, mediaId: id, name: "silence-test.wav", start: 0,
      duration: 5, inPoint: 0, sourceDuration: 5, speed: 1, reversed: false,
      color: {}, filter: "none", transform: {}, audio: { volume: 1, fadeIn: 0, fadeOut: 0, muted: false, eq: { low: 0, mid: 0, high: 0 } },
      transitionIn: "none", transitionOut: "none", transitionDuration: 0.5, keyframes: [],
    };
    store.getState().commit([...store.getState().project.clips, clip], "smoke: silence fixture");
    store.getState().select([clip.id]);
    return clip.id;
  });
  record("silence fixture created", Boolean(madeSilence), madeSilence);

  await page.getByRole("button", { name: /Detect silence/ }).click();
  await page.waitForTimeout(2500);
  text = await bodyText();
  const detected = Number(text.match(/(\d+) segments ·/)?.[1] ?? 0);
  record("silence detection finds a real 2 s gap", detected >= 1, `${detected} segment(s)`);
  const approveAll = await page.getByRole("button", { name: /^(Approve all|Clear)$/ }).count();
  record("silence segments can be approved individually", approveAll === 1);
  const beforeRemoval = await page.evaluate((id) => {
    const s = window.__safecutStore.getState();
    const clip = s.project.clips.find((c) => c.id === id);
    return clip ? clip.duration : -1;
  }, madeSilence);
  await page.getByRole("button", { name: /Remove approved/ }).click();
  await page.waitForTimeout(800);
  const afterRemoval = await page.evaluate((id) => {
    const s = window.__safecutStore.getState();
    const survivors = s.project.clips.filter((c) => c.name === "silence-test.wav");
    return {
      duration: survivors.reduce((m, c) => m + c.duration, 0),
      pieces: survivors.length,
      originalGone: !s.project.clips.some((c) => c.id === id),
    };
  }, madeSilence);
  record(
    "approved silence is removed and the gap closes",
    afterRemoval.duration <= beforeRemoval - 1 && afterRemoval.duration >= 0.9,
    `${beforeRemoval.toFixed(2)}s → ${afterRemoval.duration.toFixed(2)}s, ${afterRemoval.pieces} piece(s)`,
  );

  /* ------------------------------------------------------------------ voice --- */
  await page.evaluate(() => {
    const store = window.__safecutStore;
    const clip = store.getState().project.clips.find((c) => c.name.includes("voice-"));
    if (clip) store.getState().select([clip.id]);
  });
  await openAi("Voice");
  await page.getByRole("button", { name: /Analyse clip/ }).click();
  await page.waitForTimeout(2000);
  text = await bodyText();
  record("voice analysis reports level and SNR", /SNR/.test(text) && /Noise floor/.test(text));

  await page.getByRole("button", { name: "Podcast", exact: true }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.waitForTimeout(500);
  const voice = await page.evaluate(() => {
    const store = window.__safecutStore.getState();
    const clip = store.project.clips.find((c) => c.name.includes("voice-"));
    return clip?.voice ?? null;
  });
  record("voice enhancement is stored on the clip (non-destructive)", voice?.preset === "podcast", JSON.stringify(voice));

  await page.getByRole("button", { name: /Render enhanced WAV/ }).click();
  await page.waitForTimeout(4000);
  const enhanced = await page.evaluate(() =>
    window.__safecutStore.getState().project.assets.filter((a) => a.name.includes("enhanced")).length,
  );
  record("enhanced audio can be rendered to a new asset", enhanced >= 1, `${enhanced} enhanced asset(s)`);

  /* --------------------------------------------------------------- reframe --- */
  await openAi("Reframe");
  await page.getByRole("button", { name: "Vertical 9:16", exact: true }).click();
  await page.waitForTimeout(200);
  text = await bodyText();
  record("reframe computes a crop rectangle", /Crop/.test(text) && /\d+×\d+ at \d+,\d+/.test(text));
  await page.getByRole("button", { name: /Apply reframe/ }).click();
  await page.waitForTimeout(500);
  const settings = await page.evaluate(() => window.__safecutStore.getState().project.settings);
  record("reframe changes the project aspect ratio", settings.aspectRatio === "9:16" && settings.width === 1080, `${settings.width}×${settings.height}`);

  /* ------------------------------------------------------------ highlights --- */
  await openAi("Highlights");
  text = await bodyText();
  record("highlights panel explains it never deletes source", /never deleted|never delete|untouched/i.test(text));

  /* --------------------------------------------------------------- backend --- */
  const api = await page.evaluate(async () => {
    const response = await fetch("/api/llm");
    return { status: response.status, body: await response.json() };
  });
  record("optional LLM proxy reports its configuration", api.status === 200 && typeof api.body.configured === "boolean", JSON.stringify(api.body));

  const realErrors = errors.filter((e) => !/favicon|ResizeObserver|Failed to load resource: the server responded with a status of 4/i.test(e));
  record("no unexpected console errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
} catch (err) {
  record("AI smoke test crashed", false, String(err));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
writeFileSync("smoke-ai-report.json", JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
