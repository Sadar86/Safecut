# SafeCut — feature status

Every row says how the feature was **verified**. Nothing here is marked working
on the strength of "it compiles".

Legend for **Verified by**

- **unit** — covered by a Vitest suite (`npm test`, 75 tests).
- **smoke** — exercised end-to-end in Chromium by `npm run smoke`
  (`scripts/smoke.mjs`, 17 checks, run against a production build).
- **manual** — driven by hand in the editor; noted what was observed.
- **—** — not implemented yet.

## Phase 1 — Foundation

| Feature | Status | Verified by |
| --- | --- | --- |
| Dashboard with project list | Working | manual |
| Create / duplicate / delete project | Working | manual |
| Import / export `.safecut.json` project file | Working | unit (round-trip + normalisation) |
| Demo project on first run | Working | smoke (2 clips loaded) |
| Editor layout, light/dark theme | Working | manual |
| Media import (video/image/audio) + validation | Working | manual (mp4, png, mp3 imported; a `.txt` is rejected) |
| Metadata probing + video thumbnails | Working | manual |
| Canvas preview renderer | Working | smoke (canvas renders on boot) |
| Transport: play, pause, seek, frame step | Working | manual |
| Multitrack timeline (video/overlay/text/audio) | Working | manual |
| Drag clips between tracks, reorder | Working | manual |
| Trim both edges, split, duplicate, delete | Working | unit (all pure operations) + manual |
| Snapping with visual guide | Working | manual |
| Timeline zoom 10–200 px/s | Working | manual |
| Undo / redo (80 steps) | Working | manual |
| Keyboard shortcuts | Working | smoke (`Ctrl+D`, `Ctrl+S`) + manual |
| Auto-save every 10 s + save indicator | Working | smoke (`Ctrl+S` → IndexedDB) |
| Crash recovery banner | Working | smoke (banner shown after simulated crash) |
| Properties: transform, colour, opacity | Working | manual |
| Filters, transitions, keyframes | Working | unit (interpolation) + manual |
| Text clips with styling + animations | Working | manual |
| Speed, reverse, freeze frame | Working | manual (freeze + speed); reverse is a data flag, see limitations |
| Export dialog with progress + cancel | Working | smoke (cancel not asserted) |
| Export via browser MediaRecorder | Working | smoke (MP4, 0.2 MB, playable) |

## Phase 2 — Captions, audio, scenes, FFmpeg export

| Feature | Status | Verified by |
| --- | --- | --- |
| SRT / VTT parsing | Working | unit (13 tests) |
| SRT / VTT / TXT export | Working | unit (round-trip) |
| Subtitle cue editor (add, edit, retime, delete) | Working | smoke (cue added) + manual |
| Caption templates (6) | Working | unit + manual |
| Caption clips on a dedicated track | Working | unit (cues ⇄ clips) |
| Word-by-word / karaoke captions | Working | manual (renderer highlights the active word) |
| Speech-to-text (browser Web Speech API) | Working **where the browser supports it** | manual in Chrome; not available in Firefox. Not fully local — see limitations |
| Audio waveform on timeline clips | Working | manual (peaks rendered from decoded audio) |
| Waveform preview in the audio studio | Working | manual |
| Audio extraction from video → new track | Working | manual (WAV extracted and placed) |
| WAV mix export | Working | unit (WAV encoder) + manual |
| MP3 mix export (FFmpeg.wasm) | Working | manual (FFmpeg core loads and runs `libmp3lame`) |
| Silence detection + removal | Working | unit (silence ranges) + manual |
| Noise reduction (rendered to WAV) | Working | unit (`reduceNoise`) + manual |
| Fades, volume, EQ, voice-enhance flag | Working | unit (fades) + manual |
| Auto-ducking | Working | manual (music drops while the video track plays) |
| Scene detection (histogram cuts) | Working | unit (cut detection) + smoke (panel) + manual on a multi-shot clip |
| Scene thumbnails + black-frame count | Working | manual |
| Split clip at detected scenes | Working | unit (integration test) + manual |
| FFmpeg.wasm core load | Working | smoke (`-version` returns 0) |
| MP4 (H.264) export through FFmpeg.wasm | Working | smoke (187 KB MP4, `ftyp` header, 1920×1080, 2.04 s when probed) |
| MOV / WebM export through FFmpeg.wasm | Implemented, not smoke-tested | manual (MOV) — WebM path shares the code |
| Export fallback to MediaRecorder on FFmpeg error | Implemented | not automated |
| Frame-accurate stepping + frame counter | Working | manual |
| Project recovery + autosave countdown | Working | smoke |

## Not implemented (planned)

| Feature | Status |
| --- | --- |
| Templates marketplace with real template content | Placeholder title presets only |
| Multicam editing, nested sequences, motion tracking | — |
| Chroma key / background removal | — |
| LUT import | — |
| Proxy media for very large files | — |
| Cloud sync / accounts | — (local-first by design) |
| Word-level timing from a real ASR model (Whisper) | — (browser ASR returns phrase-level timings) |
| Audio EQ baked into the exported mix | Partial — volume, fades and ducking are applied; EQ is preview-only |
