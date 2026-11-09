import { useEffect } from "react";
import { useEditor } from "@/stores/editor";
import { deleteClips, duplicateClip, splitClip } from "@/lib/timeline";

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "Space", action: "Play / pause" },
  { keys: "S", action: "Split at playhead" },
  { keys: "Delete", action: "Delete selection" },
  { keys: "Ctrl+D", action: "Duplicate clip" },
  { keys: "Ctrl+Z", action: "Undo" },
  { keys: "Ctrl+Shift+Z", action: "Redo" },
  { keys: "Ctrl+S", action: "Save project" },
  { keys: "← / →", action: "Previous / next frame" },
  { keys: "Shift+← / →", action: "Jump one second" },
  { keys: "Home / End", action: "Start / end" },
  { keys: "Ctrl+A", action: "Select all clips" },
  { keys: "Escape", action: "Clear selection" },
  { keys: "+ / -", action: "Zoom timeline" },
  { keys: "M", action: "Mute selected clip" },
];

const isTyping = (el: EventTarget | null) => {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable;
};

/** Global editor keyboard handling. Mounted once by the editor shell. */
export function useEditorShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const state = useEditor.getState();
      const { project, selectedClipIds, playhead } = state;
      const mod = e.ctrlKey || e.metaKey;
      const fps = project.settings.fps;
      const selected = project.clips.find((c) => c.id === selectedClipIds[0]);

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void state.saveNow();
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (selected) state.commit(duplicateClip(project.clips, selected.id), "Duplicate");
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        state.select(project.clips.map((c) => c.id));
        return;
      }
      if (mod) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          state.togglePlaying();
          break;
        case "s":
        case "S":
          if (selected) state.commit(splitClip(project.clips, selected.id, playhead), "Split");
          break;
        case "Delete":
        case "Backspace":
          if (selectedClipIds.length) {
            state.commit(deleteClips(project.clips, selectedClipIds), "Delete");
            state.select([]);
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          state.setPlaying(false);
          state.setPlayhead(playhead - (e.shiftKey ? 1 : 1 / fps));
          break;
        case "ArrowRight":
          e.preventDefault();
          state.setPlaying(false);
          state.setPlayhead(playhead + (e.shiftKey ? 1 : 1 / fps));
          break;
        case "Home":
          state.setPlayhead(0);
          break;
        case "End":
          state.setPlayhead(project.duration);
          break;
        case "Escape":
          state.select([]);
          break;
        case "+":
        case "=":
          state.setZoom(Math.min(200, state.zoom + 10));
          break;
        case "-":
          state.setZoom(Math.max(10, state.zoom - 10));
          break;
        case "m":
        case "M":
          if (selected) {
            state.commit(
              project.clips.map((c) =>
                c.id === selected.id ? { ...c, audio: { ...c.audio, muted: !c.audio.muted } } : c,
              ),
              "Mute",
            );
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
