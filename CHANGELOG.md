# Changelog

All notable changes to SafeCut are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project uses [Semantic Versioning](https://semver.org/).

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
