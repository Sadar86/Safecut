"use client";

/**
 * Beta feedback.
 *
 * Builds a report from facts the browser already knows (user agent, cores,
 * memory hint, the project's duration/resolution, whether the last export
 * succeeded) plus a few optional free-text answers. It is shown for review before
 * anything is copied, and it never includes media, file names or personal data.
 */

import { useCallback, useState } from "react";
import { Copy, MessageSquarePlus } from "lucide-react";
import { useEditor } from "@/stores/editor";
import { Button, Modal, toast } from "@/components/ui";

const STORAGE_KEY = "safecut.beta.events";

export interface BetaEvent {
  at: number;
  kind: "export" | "ai" | "error";
  detail: string;
  ok: boolean;
}

/** Record a beta-relevant event (kept locally, capped at 50 entries). */
export function recordBetaEvent(event: Omit<BetaEvent, "at">) {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as BetaEvent[];
    list.push({ ...event, at: Date.now() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-50)));
  } catch {
    /* storage unavailable */
  }
}

export function readBetaEvents(): BetaEvent[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as BetaEvent[];
  } catch {
    return [];
  }
}

/** Browser/device facts that are safe to share (no identifiers). */
export function deviceReport() {
  const ua = navigator.userAgent;
  const browser =
    /Edg\/([\d.]+)/.exec(ua)?.[0] ??
    /Chrome\/([\d.]+)/.exec(ua)?.[0] ??
    /Firefox\/([\d.]+)/.exec(ua)?.[0] ??
    /Version\/([\d.]+).*Safari/.exec(ua)?.[0] ??
    "unknown";
  const os = /Windows NT 10/.test(ua)
    ? "Windows 10/11"
    : /Mac OS X/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS/iPadOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "unknown";
  return {
    browser,
    os,
    cores: navigator.hardwareConcurrency ?? "unknown",
    memoryGb: (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? "unknown",
    webgpu: "gpu" in navigator,
    screen: `${window.screen.width}×${window.screen.height}`,
  };
}

export function buildReport(answers: Record<string, string>): string {
  const project = useEditor.getState().project;
  const device = deviceReport();
  const events = readBetaEvents();
  const lines = [
    "# SafeCut Beta 1 feedback",
    "",
    "## Environment",
    `- Browser: ${device.browser}`,
    `- OS: ${device.os}`,
    `- CPU cores: ${device.cores}`,
    `- Device memory hint: ${device.memoryGb} GB`,
    `- WebGPU: ${device.webgpu ? "yes" : "no"}`,
    `- Screen: ${device.screen}`,
    "",
    "## Project",
    `- Duration: ${project.duration.toFixed(1)} s`,
    `- Resolution: ${project.settings.width}×${project.settings.height} @ ${project.settings.fps} fps`,
    `- Clips: ${project.clips.length}`,
    `- Assets: ${project.assets.length} (${project.assets.map((a) => a.kind).join(", ") || "none"})`,
    "",
    "## Recent events (this browser)",
    ...(events.length
      ? events.slice(-10).map((e) => `- ${new Date(e.at).toLocaleString()} · ${e.kind} · ${e.ok ? "ok" : "failed"} · ${e.detail}`)
      : ["- none recorded"]),
    "",
    "## Your answers",
    ...Object.entries(answers)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => `- **${k}**: ${v.trim()}`),
    "",
    "_No media, file names or personal details are included._",
  ];
  return lines.join("\n");
}

const QUESTIONS: { id: string; label: string; placeholder: string }[] = [
  { id: "export", label: "Export", placeholder: "Format, resolution, how long it took, did the file play?" },
  { id: "ai", label: "AI performance", placeholder: "Which engine, model load time, processing time" },
  { id: "captions", label: "Captions quality", placeholder: "Accuracy and timing, 1–5, language" },
  { id: "background", label: "Background removal", placeholder: "Quality 1–5, time per frame" },
  { id: "reframe", label: "Reframing", placeholder: "Was the face found? Crop quality 1–5" },
  { id: "bugs", label: "Bugs", placeholder: "What broke, and what you did just before" },
  { id: "requests", label: "Feature requests", placeholder: "What would make SafeCut useful for you?" },
];

export function FeedbackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [report, setReport] = useState<string | null>(null);

  const generate = useCallback(() => setReport(buildReport(answers)), [answers]);

  return (
    <Modal open={open} onClose={onClose} title="Beta feedback" width="max-w-2xl">
      <div className="space-y-3">
        <p className="text-[11px] leading-relaxed text-muted">
          This report contains your browser and device details, your project&apos;s duration and
          resolution, and what you type below. It never includes your video, file names or personal
          details. Nothing is sent automatically — you copy it and post it wherever you like (GitHub
          issue, email).
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {QUESTIONS.map((q) => (
            <label key={q.id} className="block text-[10px] text-muted">
              {q.label}
              <textarea
                rows={2}
                value={answers[q.id] ?? ""}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                placeholder={q.placeholder}
                className="mt-0.5 w-full resize-none rounded border border-border-subtle bg-surface px-2 py-1 text-[11px] text-content outline-none focus:border-brand"
              />
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={generate}>
            <MessageSquarePlus size={13} /> Build report
          </Button>
          {report && (
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(report);
                toast("Report copied — paste it into a GitHub issue", "success");
              }}
            >
              <Copy size={13} /> Copy
            </Button>
          )}
        </div>
        {report && (
          <pre className="max-h-64 overflow-auto rounded border border-border-subtle bg-surface p-2 text-[10px] leading-relaxed">
            {report}
          </pre>
        )}
      </div>
    </Modal>
  );
}
