# SafeCut — feature status

Every row says how the feature was **verified**. Nothing here is marked working
on the strength of "it compiles".

Legend for **Verified by**

- **unit** — covered by a Vitest suite (`npm test`, 131 tests in 9 suites).
- **smoke** — exercised end-to-end in Chromium by `npm run smoke`
  (17 checks) or `npm run smoke:ai` (30 checks) against a production build.
- **model** — a real model was downloaded and run by `npm run validate:models`
  (18 checks): Whisper tiny.en, MODNet, MediaPipe BlazeFace.
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

## Phase 3 — AI Creator Studio

Status vocabulary: **Verified** (implemented *and* tested), **Partially
verified** (works, with a documented gap), **Planned**, **Unsupported**.

| Feature | Status | Verified by |
| --- | --- | --- |
| AI Studio panel with 8 tabs | Verified | smoke:ai (all tabs render) |
| Device capability report (cores, WebGPU, tier) | Verified | smoke:ai |
| Whisper tiny.en on-device transcription | Verified | model: 68.6 MB download, 23–129 s load, 4.3–4.8 s inference per 4 s audio |
| Whisper multilingual (base/small) | Partially verified | same code path, not part of the model run |
| Word-level timestamps | **Partially verified** | model: the quantised export has no cross-attentions → chunk timestamps + proportional word split; reported as `wordLevel: false` |
| Browser Web Speech engine | Verified | smoke:ai (engine listed and selectable; availability depends on browser) |
| Word distribution / cue alignment maths | Verified | unit (ai-align, 12 tests) |
| Caption merge / split / retime | Verified | unit + smoke:ai (cue editor) |
| Caption export SRT / VTT / TXT | Verified | unit (round-trip) |
| Manual captions without AI | Verified | smoke (Phase 2 cue editor) |
| Silence detection with adjustable threshold/duration | Verified | unit + smoke:ai (real 2 s gap found) |
| Approve individual segments before removal | Verified | smoke:ai |
| Remove silence + close gaps | Verified | smoke:ai (5.00 s → 1.08 s, original clip replaced) |
| MODNet background matte | Verified | model: 12–29 s load, 2.0–2.4 s/frame, 23 % subject coverage |
| Transparent / colour / image / blur backgrounds | Verified | model (alpha PNG: corner α 0, subject α 153) + smoke:ai (composite applied to clip) |
| Original media untouched | Verified | unit (project round-trip keeps the asset) + code path (matte stored separately) |
| Per-frame video matting | **Planned** | measured 2 s/frame — too slow for real-time |
| MediaPipe face detection | Verified | model: real photo detected in 73–128 ms (CPU delegate) |
| Smart reframe 9:16 / 1:1 / 16:9 | Verified | model: face-centre error 0.0 % / 0.0 % / 1.2 %, all crops inside the frame |
| Edge-positioned faces, manual pan | Verified | model (left x=0, right x=875, top y=0) |
| Missing face → manual fallback | Verified | model (button pressed, focus stays manual, user told) |
| Face tracking over time (smooth path) | Partially verified | unit (smoothing maths); not driven by a real moving subject |
| Text-to-speech → WAV on its own track | Verified | smoke:ai (241 KB valid RIFF WAV, clip on audio track) |
| Natural-sounding TTS voices | **Unsupported** | SafeCut synthesises a clear *synthetic* voice; it is not human speech |
| Voice analysis (level, noise floor, SNR) | Verified | unit + smoke:ai |
| Non-destructive voice enhancement (preview + export) | Verified | smoke:ai (preset stored, enhanced WAV rendered) |
| Highlight detection (motion + loudness) | Verified | unit + smoke:ai |
| Highlight reel added without deleting source | Verified | smoke:ai (panel copy) + code path |
| Creator assistant (titles, description, captions, aspect, improvements, script plan) | Verified | unit (ai-creator) + smoke:ai |
| Assistant never edits the timeline without a click | Verified | unit (project unchanged) + smoke:ai (explicit apply button) |
| Optional server LLM proxy | Verified | smoke:ai (`/api/llm` reports configuration); upstream call returned 429 in this environment |
| Model download progress + cancellation | Verified | model (failed download rejects; UI shows progress + Stop) |
| UI stays responsive during model runs | Partially verified | models run in a worker/WASM; the validation run showed no page errors, but no frame-rate profile was taken |

### Known gaps in Phase 3

1. Whisper tiny.en is **English-only**; multilingual models are offered but not
   validated here.
2. **No genuine word-level timestamps** from the quantised ONNX export.
3. MODNet is **still-frame** matting at ~2 s/frame, not video matting.
4. TTS is synthetic, not natural speech; no cloud TTS by design.
5. Face tracking between detections is smoothed, not tracked.
6. Real speech accuracy was checked by hand only; no WER benchmark.
