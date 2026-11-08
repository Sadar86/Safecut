# SafeCut

**A free, professional video editor that runs in your browser.**
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
npm test        # 75 tests, 6 suites
npm run lint
npm run typecheck
npm run build
```

Suites: `timeline`, `effects`, `subtitles`, `audio-math`, `scene-math`,
`captions` (including an integration test that splits a clip at detected scene
boundaries and one that round-trips captions through SRT).

Browser-only paths (canvas capture, MediaRecorder, FFmpeg.wasm, IndexedDB,
speech recognition) are not covered by the Node test suite; see
[FEATURES.md](./FEATURES.md) for exactly what was verified by hand and how.

---

## Browser support

| Browser | Editing | Export |
| --- | --- | --- |
| Chrome / Edge (recent) | ✅ | WebM, MP4 (H.264 via FFmpeg.wasm), MOV |
| Firefox (recent) | ✅ | WebM, MP4/MOV via FFmpeg.wasm |
| Safari 17+ | mostly | WebM via MediaRecorder depends on OS support; FFmpeg.wasm path preferred |

---

## Licence

MIT — see [LICENSE](./LICENSE). FFmpeg.wasm bundles FFmpeg (LGPL-2.1+) and is
loaded in the browser; comply with FFmpeg's licence when redistributing.
