# Contributing to SafeCut

Thanks for helping! SafeCut is a local-first video editor; correctness and
honesty matter more than feature count.

## Getting set up

```bash
npm install          # also prepares public/ffmpeg (see README)
npm run dev          # http://localhost:3000
```

## Before you open a pull request

```bash
npm test             # unit + integration tests (Vitest)
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm run build        # production build must succeed
npm run smoke        # optional: needs `npm run start` on port 3112/3119 first
```

All four commands must pass. New timeline/audio/subtitle maths belongs in a pure
module under `src/lib/` with tests in `tests/` — that is what keeps the editor
testable without a browser.

## Conventions

- **Pure logic out of components.** Anything that computes (trimming, cue
  parsing, histograms, WAV encoding) lives in `src/lib` and is unit tested.
- **One renderer.** Do not add a second way to draw a frame; extend
  `src/components/preview-renderer.ts` so preview and export stay identical.
- **No fake controls.** If a button cannot do its job, it does not ship. Mark
  unfinished work in `ROADMAP.md`, not in the UI.
- **Report what you verified.** Update `FEATURES.md` with how the change was
  tested (unit / smoke / manual).
- **Commit messages** follow `type(scope): summary` — e.g.
  `feat(captions): import SRT files`.

## Branching

- `main` holds the last released state and is only updated by the maintainer.
- Work happens on feature branches (`feat/...`, `fix/...`); Phase 1 and Phase 2
  live on `feat/safecut-web`.

## Licences

Only add assets, fonts and code you have the right to distribute. FFmpeg.wasm
bundles FFmpeg (LGPL) — keep its notices if you redistribute the build.
