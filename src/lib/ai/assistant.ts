/**
 * The AI Creator Assistant.
 *
 * Two providers behind one interface:
 *  - `local` (default): deterministic, rule-based planning that runs offline and
 *    is fully unit tested. No network, no key, no cost.
 *  - `server`: an optional proxy (`/api/llm`) that is only used when the
 *    operator configured a key. Responses are treated as text suggestions and
 *    are never applied to the timeline automatically.
 */

import type { Project } from "@/types";
import { formatTime } from "@/lib/utils";

export interface AssistantContext {
  projectName: string;
  duration: number;
  clipCount: number;
  aspectRatio: string;
  hasCaptions: boolean;
  hasAudio: boolean;
  topic?: string;
  script?: string;
}

export interface AssistantTask {
  id: string;
  label: string;
  prompt: string;
}

export const ASSISTANT_TASKS: AssistantTask[] = [
  { id: "titles", label: "Suggest titles", prompt: "Suggest 5 titles" },
  { id: "description", label: "Description + hashtags", prompt: "Write a description and hashtags" },
  { id: "captions", label: "Caption ideas", prompt: "Suggest captions" },
  { id: "aspect", label: "Best aspect ratio", prompt: "Recommend an aspect ratio" },
  { id: "improvements", label: "Editing improvements", prompt: "Propose editing improvements" },
  { id: "plan", label: "Script → editing plan", prompt: "Turn my script into an editing plan" },
];

export function contextFromProject(project: Project, extra: { topic?: string; script?: string } = {}): AssistantContext {
  return {
    projectName: project.name,
    duration: project.duration,
    clipCount: project.clips.length,
    aspectRatio: project.settings.aspectRatio,
    hasCaptions: Boolean(project.captions?.length) || project.clips.some((c) => Boolean(c.text)),
    hasAudio: project.assets.some((a) => a.kind === "audio" || a.hasAudio),
    topic: extra.topic,
    script: extra.script,
  };
}

export interface AssistantResult {
  provider: "local" | "server";
  title: string;
  body: string;
  /** Structured suggestions the user can apply deliberately. */
  actions?: { kind: "aspect"; value: string }[];
}

/* ------------------------------- local provider ---------------------------- */

function titleCase(text: string) {
  return text.replace(/\b\w/g, (m) => m.toUpperCase());
}

function topicOf(ctx: AssistantContext): string {
  const raw = ctx.topic?.trim() || ctx.projectName.replace(/[-_]+/g, " ").trim();
  return raw || "your video";
}

export function localAssistant(taskId: string, ctx: AssistantContext): AssistantResult {
  const topic = topicOf(ctx);
  const topicTitle = titleCase(topic);
  const length = formatTime(ctx.duration);

  switch (taskId) {
    case "titles":
      return {
        provider: "local",
        title: "Title ideas",
        body: [
          `1. ${topicTitle} — explained in ${length}`,
          `2. Everything you should know about ${topic.toLowerCase()}`,
          `3. ${topicTitle}: the ${Math.max(3, Math.ceil(ctx.clipCount))}-part guide`,
          `4. I tried ${topic.toLowerCase()} — here is what worked`,
          `5. ${topicTitle} in under a minute`,
        ].join("\n"),
      };
    case "description":
      return {
        provider: "local",
        title: "Description and hashtags",
        body: [
          `${topicTitle} — a ${length} edit made with SafeCut.`,
          "",
          "In this video:",
          `• ${ctx.clipCount} clips${ctx.hasCaptions ? " with captions" : ""}`,
          `• ${ctx.aspectRatio} frame${ctx.hasAudio ? " with a mixed soundtrack" : ""}`,
          "",
          `#${topic.replace(/\s+/g, "").toLowerCase()} #video #creator #safecut #editing`,
        ].join("\n"),
      };
    case "captions":
      return {
        provider: "local",
        title: "Caption ideas",
        body: [
          `Hook: “Most people get ${topic.toLowerCase()} wrong — here is the fix.”`,
          `Middle: “Notice how the edit changes pace right here.”`,
          `Close: “Save this for your next ${topic.toLowerCase()} project.”`,
          "",
          "Tip: add these as text clips on the Captions track and style them with a caption template.",
        ].join("\n"),
      };
    case "aspect": {
      const recommended = ctx.duration <= 90 ? "9:16" : "16:9";
      return {
        provider: "local",
        title: "Aspect ratio",
        body:
          ctx.duration <= 90
            ? `Your edit is ${length}, which suits short-form. Vertical 9:16 (1080×1920) is the safest choice for Shorts, Reels and TikTok. 1:1 works if the same cut also goes to a feed post.`
            : `Your edit is ${length}. Landscape 16:9 (1920×1080) suits YouTube and presentations; export a 9:16 cut of the highlights for Shorts.`,
        actions: [{ kind: "aspect", value: recommended }],
      };
    }
    case "improvements": {
      const tips: string[] = [];
      if (ctx.clipCount < 3) tips.push("Add one or two B-roll clips to break up long shots.");
      if (!ctx.hasCaptions) tips.push("Turn on captions — most viewers watch muted.");
      if (!ctx.hasAudio) tips.push("Add a music bed and lower it under any voice-over.");
      if (ctx.duration > 180) tips.push("Trim to under 3 minutes; cut the slowest 20%.");
      if (ctx.aspectRatio === "16:9") tips.push("Create a 9:16 vertical version for short-form platforms.");
      tips.push("Put your strongest visual in the first 2 seconds.");
      return {
        provider: "local",
        title: "Editing improvements",
        body: tips.map((t, i) => `${i + 1}. ${t}`).join("\n"),
      };
    }
    case "plan": {
      const script = (ctx.script ?? "").trim();
      if (!script) {
        return {
          provider: "local",
          title: "Editing plan",
          body: "Paste your script in the box above and I will break it into beats with suggested shots and timings.",
        };
      }
      const sentences = script
        .split(/(?<=[.!?])\s+|\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const total = Math.max(15, sentences.length * 6);
      const per = total / Math.max(1, sentences.length);
      const lines = sentences.map((sentence, i) => {
        const start = formatTime(i * per);
        const visual = i === 0 ? "opening shot / strongest visual" : i % 3 === 2 ? "B-roll or cutaway" : "main shot";
        return `${start} — ${visual}\n   “${sentence}”`;
      });
      return {
        provider: "local",
        title: `Editing plan (${formatTime(total)})`,
        body: lines.join("\n"),
      };
    }
    default:
      return { provider: "local", title: "Assistant", body: "Pick a task to get started." };
  }
}

/* ------------------------------ server provider ---------------------------- */

export async function serverAvailable(): Promise<boolean> {
  try {
    const response = await fetch("/api/llm");
    if (!response.ok) return false;
    const data = (await response.json()) as { configured?: boolean };
    return Boolean(data.configured);
  } catch {
    return false;
  }
}

const SYSTEM_PROMPT =
  "You are SafeCut's video editing assistant. Answer concisely in plain text with short lines. " +
  "Never claim to have changed the user's timeline.";

export async function askServer(prompt: string): Promise<AssistantResult> {
  const response = await fetch("/api/llm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, system: SYSTEM_PROMPT }),
  });
  if (!response.ok) throw new Error(`Assistant unavailable (${response.status})`);
  const data = (await response.json()) as { text?: string };
  return { provider: "server", title: "AI assistant", body: data.text?.trim() || "No suggestion returned." };
}

/**
 * Run a task: try the server when it is configured and the user asked for it,
 * otherwise fall back to the local planner. Never throws.
 */
export async function runTask(
  taskId: string,
  ctx: AssistantContext,
  options: { useServer?: boolean } = {},
): Promise<AssistantResult> {
  if (options.useServer) {
    try {
      const task = ASSISTANT_TASKS.find((t) => t.id === taskId);
      const prompt = [
        task?.prompt ?? taskId,
        `Project: ${ctx.projectName}`,
        `Duration: ${formatTime(ctx.duration)}, clips: ${ctx.clipCount}, aspect: ${ctx.aspectRatio}`,
        ctx.topic ? `Topic: ${ctx.topic}` : "",
        ctx.script ? `Script:\n${ctx.script}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      return await askServer(prompt);
    } catch {
      const local = localAssistant(taskId, ctx);
      return { ...local, title: `${local.title} (offline)` };
    }
  }
  return localAssistant(taskId, ctx);
}
