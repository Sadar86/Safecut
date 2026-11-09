# SafeCut — Beta 1

**A free, professional video editor that runs in your browser.**
Status: **Beta 1** — features are frozen while the first users try it. Expect rough
edges; see [Known limitations](#known-limitations) and [Feedback](#beta-feedback).
Multitrack timeline, colour, text, captions, audio studio, scene detection and
watermark-free export — with no subscription, no watermark and no uploads.

SafeCut is an original project. It is *inspired* by the workflow of modern
mobile/desktop editors but shares no code, assets, templates or trademarks with
any of them.

- **Free:** every editing and export feature is available to everyone.
- **Private:** media is decoded and rendered on your device (IndexedDB + Web
  Audio + Canvas). Nothing is uploaded by SafeCut itself.
- **Real:** every control in the UI is wired to working code. See
  [FEATURES.md](./FEATURES.md) for the honest, tested status of each feature.

---

## Beta 1 at a glance

| | |
| --- | --- |
| Status | Beta 1 (feature freeze) |
| Branch | `feat/safecut-web` |
| Public preview | _not yet published — see [Deployment](#deployment)_ |
| Feedback | In-app **Feedback** button in the editor footer → builds a privacy-safe report |
| Test plan | [docs/BETA_TEST_PLAN.md](./docs/BETA_TEST_PLAN.md) |

## Deployment

The app is a standard Next.js project with one optional API route
(`/api/llm`). It deploys to any Node-capable host; the repository ships a
`vercel.json` with build settings, long-lived caching for `/ffmpeg/*` and
`/models/*`, and baseline security headers.

```bash
npm ci                 # postinstall prepares public/ffmpeg and public/models
npm run build
npm run start          # or deploy the repo to Vercel as a *preview* deployment
```

Environment variables (all optional — without them the AI Studio runs fully
offline): `OPENAI_API_KEY` **or** `LLM_API_KEY`, `COMPATIBLE_BASE_URL`,
`LLM_MODEL`, `LLM_RATE_PER_MINUTE` (default 4/IP/min), `LLM_DAILY_LIMIT`
(default 200/day; `0` disables the endpoint).

## Quick start

Requirements: **Node.js 20+** (tested on 22.23.4), npm 10+, and a Chromium-based
browser or Firefox for editing.

```bash
git clone https://github.com/Sadar86/Safecut.git
cd Safecut
git checkout feat/safecut-web        # Phase 1 + Phase 2 work

npm install                          # also copies the FFmpeg.wasm core (see below)
npm run dev                          # http://localhost:3000
```

Production build:

```bash
npm run build
npm run start                        # http://localhost:3000
```

### FFmpeg.wasm assets

`npm install` runs `scripts/setup-ffmpeg.mjs` (postinstall), which copies the
FFmpeg.wasm core, its worker and the UMD library into `public/ffmpeg/`
(~33 MB, git-ignored). If you ever need to regenerate them:

```bash
npm run setup:ffmpeg
```

Without these files the editor still works; the export dialog simply falls back
to the browser's MediaRecorder (WebM/MP4) instead of the FFmpeg encoder.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint (Next.js + TypeScript rules) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit/integration suite |
| `npm run test:watch` | Vitest in watch mode |
| `npm run setup:ffmpeg` | Copy FFmpeg.wasm assets into `public/ffmpeg/` |
| `npm run setup:models` | Copy the MediaPipe runtime + face model into `public/models/` |
| `npm run smoke` | Browser smoke suite for Phase 1–2 workflows (17 checks) |
| `npm run smoke:ai` | Browser smoke suite for the AI Studio (30 checks) |
| `npm run validate:models` | Real-model validation + performance measurements (18 checks) |

---

## What is in the app

### Dashboard (`/`)
Project list with search, create / duplicate / delete, import & export of
`.safecut.json` project files, demo project, light/dark theme.

### Editor (`/editor`)
- **Preview:** canvas renderer shared with the exporter, transport controls,
  frame stepping, seek bar, preview zoom, mute.
- **Timeline:** video / overlay / text / audio tracks, drag-and-drop import,
  move, trim (both edges), split, duplicate, delete, snapping with visual guide,
  zoom 10–200 px/s, per-track mute / hide / lock, waveform strips on audio.
- **Properties:** transform (scale, position, rotation, flip), colour
  (brightness, contrast, saturation, exposure, temperature, tint, shadows,
  highlights, opacity, blur, vignette, grain), filters, transitions in/out,
  keyframes (opacity, scale, x, rotation), text styling and animation, audio
  volume / fades / EQ, speed, reverse, freeze frame.
- **Captions:** subtitle cue editor, SRT / VTT / TXT import and export, six
  caption templates, karaoke word highlight, word-by-word captions, optional
  browser speech recognition.
- **Scenes:** colour-histogram scene detection with thumbnails, black-frame
  detection, sensitivity control, split clip at every detected cut.
- **Audio studio:** audio extraction from video, waveform preview, silence
  detection and removal, noise reduction, voice-enhance toggle, auto-ducking,
  WAV and MP3 mix export.
- **Export:** MP4 / MOV / WebM, 480p–4K, 24–60 fps, custom video/audio bitrate,
  progress, cancel, automatic fallback from FFmpeg.wasm to MediaRecorder.
- **Project management:** auto-save every 10 s, recovery banner after an
  interrupted session, `.safecut.json` import/export, duplicate/delete.

### AI Creator Studio (`AI Studio` tab in the editor)

| Tab | What it does | Status |
| --- | --- | --- |
| Captions | Whisper (on-device) or browser speech → editable cues, word-level when the engine supports it | Verified (real model run) |
| Silence | Detect, review and remove silence with adjustable threshold, optional gap closing | Verified |
| Voice | Analyse a clip, pick a preset/intensity, apply non-destructively, render an enhanced WAV | Verified |
| Background | MODNet matte + transparent/colour/image/blur background, preview before applying | Verified for still frames |
| Reframe | 9:16 / 1:1 / 4:5 / 16:9 / 21:9 crop with MediaPipe face focus or manual pan | Verified |
| Highlights | Motion + loudness scoring, suggests clips, never deletes source | Verified |
| Voice-over | Local formant TTS → WAV asset on its own audio track | Verified |
| Assistant | Titles, description, captions, aspect ratio, improvements, script → plan | Verified (offline planner) |

Measured model sizes, timings, limitations and privacy details:
**[docs/AI_MODELS.md](./docs/AI_MODELS.md)**.

### Help (`/help`)
In-app documentation.

---

## Architecture

```
src/
  app/                 Next.js App Router pages (dashboard, editor, help)
  components/          UI: editor shell, timeline, preview, panels, dialogs
    preview-renderer.ts  canvas renderer shared by preview + export
  lib/
    timeline.ts        pure editing operations (split, trim, move, keyframes)
    project.ts         project file format, normalisation, demo project
    storage.ts         IndexedDB: projects, media blobs, waveforms, dirty flag
    media.ts           import validation, metadata probing, thumbnails
    effects.ts         CSS/canvas filters, tints, text styling
    subtitles.ts       SRT/VTT parse + serialise, word cues
    captions.ts        caption templates, cues ⇄ clips
    audio.ts           decoding, waveform peaks, timeline mix → WAV, ducking
    audio-math.ts      peaks, RMS, dB, silence detection, WAV encoder
    scene-math.ts      histogram distance, cut detection, black frames
    exporter.ts        real-time render + MediaRecorder capture
    ffmpeg.ts          FFmpeg.wasm loader, MP3 / MP4 / MOV / WebM transcode
    transcribe.ts      speech-to-text providers (browser Web Speech)
  stores/              Zustand: editor state + history, analysis caches
  types/               the project data model
tests/                 Vitest suites (75 tests)
```

Key decisions:

- **One renderer.** The preview and the exporter call the same drawing code, so
  what you see is what you get.
- **Plain-JSON project model.** A project is serialisable at any time: save,
  export, import, future cloud sync.
- **Pure editing functions.** Every timeline operation is a pure function over
  the clip array, which is why they are cheap to test and easy to undo.
- **History by snapshot.** Undo/redo stores clip snapshots (80 steps), which is
  simple and robust for a timeline of this size.
- **Local-first storage.** Projects and media live in IndexedDB; the FFmpeg core
  is served from the app's own origin so no cross-origin isolation is needed.

---

## Testing

```bash
npm test        # 131 tests, 9 suites
npm run lint
npm run typecheck
npm run build
```

Suites: `timeline`, `effects`, `subtitles`, `audio-math`, `scene-math`,
`captions`, `ai-align`, `ai-media`, `ai-creator` (including integration tests that
split a clip at detected scene boundaries, round-trip captions through SRT, plan
silence removal, score highlights and compute reframe crops).

Browser-only paths are covered by three Playwright scripts that run against a
production build:

| Suite | Checks | Covers |
| --- | --- | --- |
| `npm run smoke` | 17 | boot, IndexedDB persistence, recovery, captions, scenes, MediaRecorder export, FFmpeg.wasm export + real MP4 |
| `npm run smoke:ai` | 30 | every AI panel, assistant, TTS WAV, silence removal, voice enhancement, reframe, LLM proxy |
| `npm run validate:models` | 18 | real Whisper + MODNet downloads and runs, face detection, reframe maths, failure recovery, memory |

See [FEATURES.md](./FEATURES.md) for the verification evidence per feature and
[docs/AI_MODELS.md](./docs/AI_MODELS.md) for measured performance.

---

## Browser compatibility (Beta 1)

| Browser | Editor | Export | Notes |
| --- | --- | --- | --- |
| Chrome 156 / Edge 157 (tested) | ✅ | WebM, MP4 (FFmpeg.wasm) | Reference browser; all suites run here |
| Other Chromium (recent) | expected ✅ | same | not individually tested |
| Firefox (recent) | expected ✅ | WebM; MP4 via FFmpeg.wasm | no Web Speech captions; not tested in Beta 1 |
| Safari 17+ | untested | WebM support varies | FFmpeg.wasm path recommended; not tested |

Not supported in Beta 1: iOS/iPadOS Safari, browsers without WebAssembly
(no export), and devices with < 4 GB RAM for the on-device AI models.

## Known limitations

| Browser | Editing | Export |
| --- | --- | --- |
| Chrome / Edge (recent) | ✅ | WebM, MP4 (H.264 via FFmpeg.wasm), MOV |
| Firefox (recent) | ✅ | WebM, MP4/MOV via FFmpeg.wasm |
| Safari 17+ | mostly | WebM via MediaRecorder depends on OS support; FFmpeg.wasm path preferred |

---

## AI model download requirements

| Feature | Model | First-run download |
| --- | --- | --- |
| Whisper captions | `whisper-tiny.en` | ≈ 69 MB (cached afterwards) |
| Multilingual captions | `whisper-base` / `whisper-small` | ≈ 80 MB / 250 MB |
| Background removal | MODNet | ≈ 25 MB |
| Face detection (reframe) | MediaPipe BlazeFace | 220 KB + 14 MB runtime (served locally) |

Measured timings, memory and limitations: [docs/AI_MODELS.md](./docs/AI_MODELS.md).

## Beta feedback

In the editor footer press **Feedback**: SafeCut fills in your browser, OS, CPU
cores, WebGPU support, project duration/resolution and recent export events, you
answer a few optional questions, and you copy the report into a GitHub issue on
[Sadar86/Safecut](https://github.com/Sadar86/Safecut/issues). No media, file
names or personal data are included. The manual test plan lives in
[docs/BETA_TEST_PLAN.md](./docs/BETA_TEST_PLAN.md).

## Privacy

- Media you import stays in your browser (IndexedDB); SafeCut never uploads it.
- On-device models (Whisper, MODNet, BlazeFace) run locally; only the model
  files are downloaded, from the Hugging Face CDN.
- The browser speech-recognition engine may be cloud-processed by Chrome/Edge —
  the AI panel warns when it is selected.
- The optional server assistant is off unless an operator configures a key, and
  the key never reaches the browser. It is rate-limited and capped daily.

## Environment variables (all optional)

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` or `LLM_API_KEY` | Enables the server-side AI assistant proxy. Read only on the server; never bundled. |
| `COMPATIBLE_BASE_URL` | Base URL for an OpenAI-compatible API (default `https://api.openai.com/v1`). |
| `LLM_MODEL` | Model name for the proxy (default `gpt-4o-mini`). |

Without these, the AI Studio works fully offline with the built-in assistant.

## Licence

MIT — see [LICENSE](./LICENSE). FFmpeg.wasm bundles FFmpeg (LGPL-2.1+) and is
loaded in the browser; comply with FFmpeg's licence when redistributing.
