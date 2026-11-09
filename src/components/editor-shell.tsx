"use client";

import { useEffect, useState } from "react";
import { Download, Keyboard, MessageSquarePlus, Plus } from "lucide-react";
import { ExportDialog } from "@/components/export-dialog";
import { Button, Modal } from "@/components/ui";
import { Preview } from "@/components/preview";
import { SidePanel } from "@/components/side-panel";
import { PropertiesPanel } from "@/components/properties";
import { Timeline } from "@/components/timeline";
import { TopBar } from "@/components/top-bar";
import { flushSave, startAutosave, useEditor } from "@/stores/editor";
import { SHORTCUTS, useEditorShortcuts } from "@/lib/shortcuts";
import { FeedbackDialog } from "@/components/feedback";
import { FFMPEG_CORE, ffmpegCoreConfig } from "@/lib/ffmpeg";
import * as reframeMath from "@/lib/ai/reframe";

export function EditorShell() {
  const ready = useEditor((s) => s.ready);
  const boot = useEditor((s) => s.boot);
  const project = useEditor((s) => s.project);
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  useEditorShortcuts();

  useEffect(() => {
    if (!ready) void boot();
  }, [ready, boot]);

  // Expose the store for end-to-end smoke tests (scripts/smoke.mjs).
  useEffect(() => {
    const w = window as unknown as {
      __safecutStore?: typeof useEditor;
      __safecutFFmpegCore?: () => Promise<{ coreURL: string; wasmURL: string; workerURL: string }>;
      __safecutLoadTransformers?: () => Promise<unknown>;
      __safecutFace?: () => Promise<typeof import("@/lib/ai/detect")>;
      __safecutVision?: () => Promise<unknown>;
      __safecutMedia?: () => Promise<typeof import("@/lib/media")>;
      __safecutReframe?: typeof reframeMath;
      __smokeClipId?: string;
    };
    w.__safecutStore = useEditor;
    w.__safecutFFmpegCore = ffmpegCoreConfig;
    // Loaded on demand by scripts/validate-models.mjs.
    w.__safecutLoadTransformers = () => import("@huggingface/transformers");
    w.__safecutFace = () => import("@/lib/ai/detect");
    w.__safecutVision = () => import("@mediapipe/tasks-vision");
    w.__safecutMedia = () => import("@/lib/media");
    w.__safecutReframe = reframeMath;
    void FFMPEG_CORE;
  }, []);

  useEffect(() => {
    const beforeUnload = () => {
      void flushSave();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") void flushSave();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", visibility);
    const stopAutosave = startAutosave(10);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", visibility);
      stopAutosave();
    };
  }, []);

  const setRecovered = useEditor((s) => s.setRecovered);
  const recovered = useEditor((s) => s.recovered);
  const clearRecovered = () => setRecovered(false);

  // Detect an interrupted session when the editor mounts (e.g. after a refresh).
  // The dirty flag is read once on mount, *before* boot() runs: saving during
  // boot would legitimately clear it, so reading later would miss the crash.
  useEffect(() => {
    try {
      if (localStorage.getItem("safecut.dirty") === "1") setRecovered(true);
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center bg-surface text-sm text-muted">
        Loading SafeCut…
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-surface">
      <TopBar />
      {recovered && (
        <div className="flex items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300">
          <span>Your last session closed before it finished saving. Everything up to the last auto-save is here.</span>
          <button className="ml-auto rounded px-2 py-0.5 hover:bg-amber-500/20" onClick={clearRecovered}>
            Dismiss
          </button>
        </div>
      )}
      <main id="main" className="flex min-h-0 flex-1">
        <div className="hidden md:flex">
          <SidePanel />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <Preview />
          <div className="relative h-[38%] min-h-[180px] shrink-0 border-t border-border-subtle">
            <Timeline />
          </div>
        </div>
        <div className="hidden lg:flex">
          <PropertiesPanel />
        </div>
      </main>
      <footer className="flex h-10 shrink-0 items-center gap-2 border-t border-border-subtle bg-surface-2 px-2">
        <span className="hidden text-[10px] text-muted sm:block">
          {project.settings.width}×{project.settings.height} · {project.settings.fps} fps · free forever, no watermark
        </span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setHelpOpen(true)}>
          <Keyboard size={13} /> <span className="hidden sm:inline">Shortcuts</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setFeedbackOpen(true)} title="Send beta feedback">
          <MessageSquarePlus size={13} /> <span className="hidden sm:inline">Feedback</span>
        </Button>
        <Button size="sm" variant="secondary" onClick={() => useEditor.getState().setPanel("media")}>
          <Plus size={13} /> <span className="hidden sm:inline">Import</span>
        </Button>
        <Button size="sm" variant="primary" onClick={() => setExportOpen(true)}>
          <Download size={13} /> Export
        </Button>
      </footer>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="Keyboard shortcuts">
        <ul className="grid grid-cols-2 gap-2 text-xs">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-2 rounded border border-border-subtle px-2 py-1.5">
              <span className="text-muted">{s.action}</span>
              <kbd className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px]">{s.keys}</kbd>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
