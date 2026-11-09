# SafeCut Beta 1 — test plan and record

Copy this table for each beta session. Keep it free of personal data: record the
browser, the OS, the device class, and what happened — never the video itself.

## Session template

| Field | Value |
| --- | --- |
| Date | |
| Tester (initials only) | |
| Browser + version | |
| OS | |
| Device / CPU / RAM | |
| Test video: duration / resolution / codec | |
| Export result (format, resolution, time, success) | |
| AI: engine used, model load time, processing time | |
| Captions: engine, quality (1–5), word timing accuracy (1–5) | |
| Background removal: quality (1–5), time per frame | |
| Reframe: face detected? crop quality (1–5) | |
| Bugs found | |
| Feature requests | |

## Critical workflows to run

1. Create a project → import a video → drag it to the timeline → save → reload the
   page → the project and clips are still there.
2. Split, trim, duplicate, delete, undo/redo; drag a clip between tracks.
3. Add text, apply a caption template, import an SRT, export SRT.
4. Audio: extract audio from the video, remove silence, export a WAV mix.
5. Scenes: run detection, split at cuts.
6. Export MP4 (browser recorder) and MP4 via FFmpeg.wasm; confirm the file plays.
7. AI Studio: generate captions with the browser engine and with Whisper; note
   load time and quality.
8. Background removal on a portrait clip; try transparent and colour.
9. Reframe a landscape clip to 9:16 with face detection, then with manual pan.
10. Interrupt a session (close the tab mid-edit) → reopen → recovery banner shows.

## Recording results

Fill in `FEEDBACK.md` in the repo (see below) or use the in-app feedback link and
copy the generated report into a GitHub issue. Include the table above, plus:

- screenshots of anything broken (no personal video content),
- the browser console text if an error appeared.
