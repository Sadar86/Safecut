# Changelog

All notable changes to SafeCut are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project uses [Semantic Versioning](https://semver.org/).

## [0.3.0] — Phase 3: AI Creator Studio

### Added

- **AI Studio** panel in the editor with eight tabs: Captions, Silence, Voice,
  Background, Reframe, Highlights, Voice-over, Assistant.
- **On-device speech recognition** with transformers.js Whisper (tiny.en,
  multilingual base/small) plus the browser Web Speech engine as a fallback;
  word-level alignment maths with merge/split/retime.
- **Smart silence removal**: threshold and minimum-duration controls, per-segment
  approval, gap closing, sync preserved.
- **Background removal** with MODNet: transparent, solid colour, image and blur
  backgrounds, preview matte, applied non-destructively in the renderer and the
  exporter.
- **Smart reframe** with MediaPipe BlazeFace face focus, manual pan and crop
  maths for 9:16, 1:1, 4:5, 16:9 and 21:9.
- **Text-to-speech** that renders a local synthetic voice into a WAV asset placed
  on its own audio track.
- **Voice enhancement**: presets, intensity, level/SNR analysis, live preview
  chain and offline WAV rendering, all non-destructive.
- **Highlight detection** from motion + loudness, with an explicit "add reel"
  action that never deletes source clips.
- **Creator assistant** (titles, description, captions, aspect ratio,
  improvements, script → plan) with an optional server LLM proxy whose key never
  reaches the browser.
- `docs/AI_MODELS.md`: measured model sizes, load/inference times, memory,
  limitations and privacy.
- `npm run setup:models`, `npm run smoke:ai`, `npm run validate:models`.

### Fixed

- Chrome 156/157 removed the Shape Detection `FaceDetector` API; face detection
  now uses MediaPipe BlazeFace (220 KB model, CPU delegate 10× faster than GPU).
- MODNet masks were empty with the quantised export — pinned to `fp32` and
  `RawImage.fromCanvas` (the constructor loses the channel count).
- Whisper word timestamps throw without cross-attentions — now falls back to
  chunk timestamps and reports phrase-level timing honestly.
- Reframe focus label could lag behind the detection result; the panel now
  commits result state together and shows a measured "face pass" timing.

### Tests

- 131 unit tests (was 75).
- 30-check AI browser smoke suite, 17-check Phase 1–2 suite, 18-check real-model
  validation (Whisper, MODNet, BlazeFace, reframe maths, failure recovery).

## [0.2.0] — Phase 2: captions, audio studio, scene detection, FFmpeg export

### Added

- **Caption studio**
  - SRT / VTT parsing and serialisation, plus plain-text transcript export.
  - Subtitle cue editor: add at playhead, edit text, retime, delete, jump to cue.
  - Six caption templates (Clean, Boxed, Highlight word, TikTok word-by-word,
    Lower third, News ticker) applied to a dedicated Captions track.
  - Karaoke word highlight and word-by-word caption generation.
  - Optional speech recognition through the browser Web Speech API, merged into
    readable cues.
- **Audio studio**
  - Waveform peaks computed with Web Audio and drawn on timeline clips and in the
    studio panel; peaks are cached in IndexedDB.
  - Extract audio from any video into its own asset + timeline clip.
  - WAV mix export of the whole timeline and MP3 export via FFmpeg.wasm.
  - Silence detection with automatic removal (splits + deletes silent sections).
  - Noise reduction rendered to WAV, fades, volume, voice-enhance flag and
    automatic ducking.
- **Scene detection**
  - Samples the video, scores colour-histogram changes, merges nearby cuts,
    reports black frames, shows thumbnails and splits the clip at every boundary.
  - Adjustable sensitivity.
- **Export**
  - FFmpeg.wasm engine (libx264 / libvpx, AAC / Opus) for MP4, MOV and WebM with
    progress, cancellation and automatic fallback to the browser recorder.
  - Real-time renderer so recorded audio and video stay in sync.
  - `npm run setup:ffmpeg` (postinstall) prepares the FFmpeg core, worker and a
    patched library bundle under `public/ffmpeg/`.
- **Editing**
  - Frame stepping buttons and a frame counter in the timeline toolbar.
  - Stronger snapping (clip heads and tails, playhead, zero) with a snap guide.
  - 10-second auto-save with a countdown, save on tab hide, and a recovery banner
    when the previous session did not finish saving.
- **Tooling**
  - `npm run smoke`: 17-check Chromium end-to-end suite (boot, persistence,
    recovery, captions, scenes, MediaRecorder, FFmpeg.wasm, real MP4 download).
  - `FEATURES.md` with per-feature verification evidence.

### Changed

- Timeline audio sync now uses a coarse tick instead of per-frame restarts.
- Project normalisation fills in audio/caption fields for older project files.
- `.gitignore` excludes generated FFmpeg assets and `*.tsbuildinfo`.

### Fixed

- Trim-left could move a clip before its available source; it is now clamped.
- Export could desynchronise audio because it seeked every frame; the renderer
  now plays in real time.
- The published `@ffmpeg/ffmpeg` bundle always creates a *module* worker, which
  cannot `importScripts` the core; `setup-ffmpeg.mjs` patches the worker
  constructor while copying the bundle.
- Recovery banner was cleared by the boot-time save before it could render.

### Tests

- 75 unit tests across 6 suites (was 29).
- 17/17 browser smoke checks passing against a production build.

## [0.1.0] — Phase 1: foundation

### Added

- Next.js 16 / React 19 / TypeScript / Tailwind 4 / Zustand project skeleton.
- Plain-JSON project model, pure timeline operations (split, trim, move,
  duplicate, keyframes), 80-step undo/redo.
- IndexedDB persistence with auto-save and `.safecut.json` import/export.
- Dashboard, editor shell, media panel, canvas preview, properties panel and a
  multitrack timeline with drag-and-drop, snapping and zoom.
- Colour adjustments, filters, transitions, text styling and animations.
- Canvas export through MediaRecorder with progress and cancel.
- 29 unit tests; typecheck, lint and production build in CI-ready scripts.
