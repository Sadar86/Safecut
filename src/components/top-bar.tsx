"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CircleHelp,
  Cloud,
  CloudOff,
  Download,
  FolderOpen,
  Home,
  Loader2,
  Moon,
  Redo2,
  Save,
  Settings,
  Sun,
  Undo2,
  Upload,
} from "lucide-react";
import { flushSave, useEditor } from "@/stores/editor";
import { Button, Modal, toast, useTheme } from "@/components/ui";
import { cn } from "@/lib/utils";
import { projectFileName, toProjectFile } from "@/lib/project";
import { downloadBlob } from "@/lib/utils";
import { ASPECT_PRESETS } from "@/types";
import type { AspectRatio } from "@/types";

export function TopBar() {
  const router = useRouter();
  const project = useEditor((s) => s.project);
  const renameProject = useEditor((s) => s.renameProject);
  const saveNow = useEditor((s) => s.saveNow);
  const saveState = useEditor((s) => s.saveState);
  const autosaveIn = useEditor((s) => s.autosaveIn);
  const lastSavedAt = useEditor((s) => s.lastSavedAt);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [showSettings, setShowSettings] = useState(false);
  const importRef = useRef<HTMLInputElement | null>(null);

  const exportProject = () => {
    const file = toProjectFile(project);
    downloadBlob(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }), projectFileName(project));
    toast("Project exported — media stays on this device", "success");
  };

  const importProject = async (file: File) => {
    const { parseProjectFile } = await import("@/lib/project");
    try {
      const text = await file.text();
      const parsed = parseProjectFile(text);
      useEditor.setState({ project: parsed, selectedClipIds: [], playhead: 0, past: [], future: [] });
      await saveNow();
      toast(`Opened “${parsed.name}”`, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not read that project file", "error");
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-2" role="banner">
      <Button size="icon" variant="ghost" onClick={() => router.push("/")} aria-label="Back to dashboard" title="Dashboard">
        <ArrowLeft size={16} />
      </Button>
      <Link href="/" className="flex items-center gap-1.5" aria-label="SafeCut home">
        <Logo />
      </Link>

      <div className="mx-1 h-5 w-px bg-border-subtle" />

      {editing ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            renameProject(name.trim() || "Untitled project");
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setName(project.name);
              setEditing(false);
            }
          }}
          className="w-48 rounded border border-brand bg-surface-2 px-2 py-1 text-xs outline-none"
          aria-label="Project name"
        />
      ) : (
        <button
          onClick={() => {
            setName(project.name);
            setEditing(true);
          }}
          className="max-w-[220px] truncate rounded px-1.5 py-1 text-xs font-medium hover:bg-surface-3"
          title="Rename project"
        >
          {project.name}
        </button>
      )}

      <span className="hidden items-center gap-1 text-[10px] text-muted sm:flex" aria-live="polite">
        {saveState === "saving" ? (
          <>
            <Loader2 size={11} className="animate-spin" /> Saving…
          </>
        ) : saveState === "error" ? (
          <>
            <CloudOff size={11} className="text-red-400" /> Not saved
          </>
        ) : lastSavedAt ? (
          <>
            <Check size={11} className="text-brand" /> Saved {new Date(lastSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {saveState === "idle" && autosaveIn > 0 && <span className="text-muted">· next {autosaveIn}s</span>}
          </>
        ) : (
          <>
            <Cloud size={11} /> Auto-save on
          </>
        )}
      </span>

      <div className="flex-1" />

      <Button size="icon" variant="ghost" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
        <Undo2 size={15} />
      </Button>
      <Button size="icon" variant="ghost" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
        <Redo2 size={15} />
      </Button>

      <div className="mx-1 h-5 w-px bg-border-subtle" />

      <Button size="sm" variant="ghost" onClick={() => void saveNow()} title="Save (Ctrl+S)">
        <Save size={14} /> <span className="hidden md:inline">Save</span>
      </Button>
      <Button size="sm" variant="ghost" onClick={exportProject} title="Export project file">
        <Download size={14} /> <span className="hidden lg:inline">Project file</span>
      </Button>
      <Button size="sm" variant="ghost" onClick={() => importRef.current?.click()} title="Open a project file">
        <Upload size={14} /> <span className="hidden lg:inline">Open</span>
      </Button>
      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importProject(f);
          e.target.value = "";
        }}
        aria-label="Open project file"
      />

      <Button size="icon" variant="ghost" onClick={() => setShowSettings(true)} aria-label="Project settings" title="Project settings">
        <Settings size={15} />
      </Button>
      <Button size="icon" variant="ghost" onClick={toggleTheme} aria-label="Toggle colour theme" title="Toggle theme">
        {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
      </Button>
      <Button size="icon" variant="ghost" onClick={() => router.push("/help")} aria-label="Help" title="Help">
        <CircleHelp size={15} />
      </Button>
      <Button size="icon" variant="ghost" onClick={() => router.push("/")} aria-label="Projects" title="My projects">
        <FolderOpen size={15} />
      </Button>

      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Project settings">
        <ProjectSettingsForm onClose={() => setShowSettings(false)} />
      </Modal>

      <button className="hidden" onClick={() => void flushSave()} aria-hidden tabIndex={-1} />
      <Home size={0} />
    </header>
  );
}

export function ProjectSettingsForm({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const saveNow = useEditor((s) => s.saveNow);
  const [ratio, setRatio] = useState<AspectRatio>(project.settings.aspectRatio);
  const [fps, setFps] = useState(project.settings.fps);
  const [background, setBackground] = useState(project.settings.background);

  const apply = async () => {
    const preset = ASPECT_PRESETS[ratio];
    useEditor.setState({
      project: {
        ...useEditor.getState().project,
        settings: { ...useEditor.getState().project.settings, ...preset, aspectRatio: ratio, fps, background },
      },
    });
    await saveNow();
    toast("Project settings updated", "success");
    onClose();
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-xs font-medium">Aspect ratio</p>
        <div className="grid grid-cols-4 gap-1.5">
          {(Object.keys(ASPECT_PRESETS) as AspectRatio[]).map((r) => (
            <button
              key={r}
              onClick={() => setRatio(r)}
              className={cn(
                "rounded-md border py-2 text-[11px]",
                ratio === r ? "border-brand bg-brand/10 text-brand" : "border-border-subtle hover:bg-surface-3",
              )}
            >
              {r}
              <span className="mt-0.5 block text-[9px] text-muted">
                {ASPECT_PRESETS[r].width}×{ASPECT_PRESETS[r].height}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium">Frame rate</p>
        <div className="flex gap-1.5">
          {[24, 25, 30, 50, 60].map((f) => (
            <button
              key={f}
              onClick={() => setFps(f)}
              className={cn(
                "flex-1 rounded-md border py-1.5 text-[11px]",
                fps === f ? "border-brand bg-brand/10 text-brand" : "border-border-subtle hover:bg-surface-3",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <label className="block text-xs">
        Background colour
        <input
          type="color"
          value={background}
          onChange={(e) => setBackground(e.target.value)}
          className="mt-1 h-8 w-full cursor-pointer rounded border border-border-subtle"
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void apply()}>
          Apply
        </Button>
      </div>
    </div>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
        <defs>
          <linearGradient id="sc-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#0ea5e9" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#sc-grad)" />
        <path d="M12 9.5 22 16l-10 6.5z" fill="#0b1220" />
      </svg>
      <span className="text-sm font-bold tracking-tight">
        Safe<span className="text-brand">Cut</span>
      </span>
    </span>
  );
}
