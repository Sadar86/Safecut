# SafeCut — AI models, measured behaviour and privacy

Everything on this page was measured on the development machine
(Windows, Chromium 156, headless, CPU-only WASM) with
`npm run validate:models` against a production build. Numbers are medians of
three runs unless stated otherwise. Re-run the script on your own hardware — it
prints the same table for your device.

---

## Model inventory

| Feature | Model | Runtime | Download | Where it runs |
| --- | --- | --- | --- | --- |
| Speech → captions | `onnx-community/whisper-tiny.en` (q8) | transformers.js (ONNX, WASM) | **68.6 MB** | On device |
| Speech → captions (optional) | Browser Web Speech API | Browser | 0 MB | **May be cloud-processed by the browser vendor** |
| Background removal | `Xenova/modnet` (fp32) | transformers.js (ONNX, WASM) | **≈ 25 MB** | On device |
| Face detection (reframe) | MediaPipe BlazeFace short-range | MediaPipe tasks-vision (WASM) | **220 KB** + 14 MB wasm runtime | On device |
| Voice-over | SafeCut formant synthesiser | Plain JS + Web Audio | 0 MB | On device |
| Assistant (default) | Rule-based planner | JS | 0 MB | On device |
| Assistant (optional) | Any OpenAI-compatible LLM | Server proxy `/api/llm` | — | **Cloud, only if the operator configures a key** |

Model files are fetched from the Hugging Face CDN on first use and cached by the
browser (Cache Storage). The MediaPipe runtime and face model are served from the
app's own origin (`public/models/`, prepared by `npm run setup:models`), so no
third-party script is loaded at runtime.

---

## Measured timings

| Measurement | Result | Notes |
| --- | --- | --- |
| Whisper tiny.en cold load (model download + ONNX init) | **23 s – 129 s** | Network-bound on the first run; subsequent runs load from cache in a few seconds |
| Whisper tiny.en inference | **4.3 – 4.8 s per 4 s of audio** | ≈ 1.1× real time on CPU |
| MODNet cold load | **12 – 29 s** | fp32 export; the quantised export returns unusable masks |
| MODNet inference | **2.0 – 2.4 s per 512×512 frame** | Single frame at a time — **offline processing, not real-time matting** |
| MediaPipe face detection, load | **180 – 290 ms** | WASM runtime already cached |
| MediaPipe face detection, per frame | **73 – 128 ms** (CPU delegate) | The GPU delegate is ~10× slower for this small model |
| Total model download in one session | **138 MB** | Whisper + MODNet + face model |

### Memory

The validation script reports **JavaScript heap** (`Performance.getMetrics`),
not total browser memory:

- baseline editor: **7.1 MB** JS heap
- after loading Whisper + MODNet: **12.1 – 14.6 MB** JS heap (+5 – 7.5 MB)

The ONNX weights live in WASM linear memory, which is **not** part of that
number. Budget roughly **300–500 MB of process memory** for Whisper tiny + MODNet
on a desktop browser, and treat 4 GB of RAM as the practical minimum.

---

## What Whisper tiny.en does and does not give you

**Language:** `whisper-tiny.en` is **English-only**. For other languages choose
`whisper-base` (multilingual, ~80 MB) or `whisper-small` (~250 MB) — both are
listed in the AI Studio engine picker and use the same code path, but they were
not part of this validation run.

**Timestamps — important:** the quantised ONNX export does **not** contain the
cross-attention tensors transformers.js needs for true word-level timestamps. It
throws:

```
Model outputs must contain cross attentions to extract timestamps.
```

SafeCut catches that and re-runs with **chunk timestamps**, then splits each
chunk across its words proportionally to word length. That is:

- **real timing** for the chunk (start and end are from the model),
- **estimated timing** for each word inside the chunk.

The caption engine therefore reports `wordLevel: false` for this engine, the
karaoke highlight is approximate, and the AI panel says so. Genuine word-level
timing needs a model exported with `output_attentions=True` (or a different
alignment model) — that is on the roadmap, not shipped.

**Accuracy:** the validation fixture is a synthetic speech-shaped tone, so the
transcript quality check is about the runtime and the timestamp shape, not about
WER. Accuracy on real speech was checked manually in the editor (clear English
narration transcribes correctly); no WER benchmark has been run.

---

## Background removal (MODNet)

- Works on **still frames**, one at a time: the panel captures the current frame
  of the selected clip, computes a matte (2 s) and composites it live.
- **Not** per-frame video matting — a 60 s clip would need ~120 s of processing
  at 2 s/frame. The panel labels this as offline processing.
- The quantised (`q8`) export produced masks with no channel data, so SafeCut
  pins `dtype: "fp32"`.
- The original media is never modified: the matte is stored separately and the
  clip keeps a `background` setting that the renderer applies.
- Transparent export is verified at the PNG/alpha level (corner α = 0, subject
  α > 0). Video export with transparency depends on the codec — WebM/VP9 with
  alpha is not produced by MediaRecorder, so exported video composites onto the
  project background colour.

---

## Face detection and reframing

- Chrome 156/157 **removed the Shape Detection `FaceDetector` API**, so SafeCut
  ships MediaPipe BlazeFace instead (220 KB model, 14 MB WASM runtime, both
  local).
- Detection finds a face in a real photograph (box ≈ 35 %, 11 % of the frame) in
  **73–128 ms**.
- Synthetic/illustrated faces are not reliably detected; the panel then keeps
  manual focus and tells the user.
- Reframe maths verified for 9:16, 1:1 and 16:9 with the face centre as focus
  (centre error ≤ 1.2 %), for edge-positioned faces (crop never leaves the
  source frame), and for manual panning to both edges.

---

## Privacy summary

| Data | Where it goes |
| --- | --- |
| Imported video, audio, images | Stay in the browser (IndexedDB). Never uploaded by SafeCut. |
| Whisper / MODNet processing | On device. The model **files** are downloaded from Hugging Face; your media is not sent. |
| Browser speech recognition | Handled by the browser; Chrome/Edge may send audio to their speech service. The panel warns when this engine is selected. |
| Optional LLM assistant | Only if `OPENAI_API_KEY` (or `COMPATIBLE_BASE_URL` + `LLM_API_KEY`) is set on the server **and** the user enables "Use server AI". Then the prompt (topic/script text, never media) is sent to that provider. |
| Exported video/audio | Written to your disk by the browser. |

**API keys:** read only in `src/app/api/llm/route.ts` on the server. No key is
bundled into client JavaScript, and `/api/llm` reports only whether a key is
configured.

---

## Reproducing these numbers

```bash
npm install && npm run setup:models      # MediaPipe runtime + face model
npm run build && npm run start &         # http://localhost:3000
node scripts/validate-models.mjs http://localhost:3000
```

The script writes `model-validation.json` with every measurement for the run.
