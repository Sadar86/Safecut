import { NextResponse } from "next/server";

/**
 * Optional server-side proxy for the AI Creator Assistant.
 *
 * SafeCut works fully offline with its built-in, deterministic assistant. If an
 * operator sets OPENAI_API_KEY (or COMPATIBLE_BASE_URL + LLM_API_KEY), this route
 * forwards a single chat completion so users get better copywriting. The key is
 * read on the server only and is never sent to the browser.
 */
export const runtime = "nodejs";

const MODEL = process.env.LLM_MODEL ?? "gpt-4o-mini";

/**
 * Abuse protection for a public preview:
 *  - a per-IP sliding window (in-memory; per instance),
 *  - a global daily budget so a public URL cannot be used as a free LLM proxy,
 *  - a hard cap on prompt size.
 * Set LLM_DAILY_LIMIT=0 to disable the endpoint entirely.
 */
const WINDOW_MS = 60_000;
const PER_IP_PER_MINUTE = Number(process.env.LLM_RATE_PER_MINUTE ?? 4);
const DAILY_LIMIT = Number(process.env.LLM_DAILY_LIMIT ?? 200);
const MAX_PROMPT_CHARS = 4000;

const hits = new Map<string, number[]>();
let dayKey = new Date().toISOString().slice(0, 10);
let dayCount = 0;

function rateLimited(ip: string): { limited: boolean; retryAfter?: number } {
  const now = Date.now();
  const key = new Date().toISOString().slice(0, 10);
  if (key !== dayKey) {
    dayKey = key;
    dayCount = 0;
  }
  if (DAILY_LIMIT <= 0) return { limited: true, retryAfter: 3600 };
  if (dayCount >= DAILY_LIMIT) return { limited: true, retryAfter: 3600 };
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= PER_IP_PER_MINUTE) {
    return { limited: true, retryAfter: Math.ceil((WINDOW_MS - (now - recent[0])) / 1000) };
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  dayCount += 1;
  return { limited: false };
}

export async function GET() {
  return NextResponse.json({
    configured: Boolean(process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY),
    model: MODEL,
  });
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "not-configured" }, { status: 501 });
  }
  const baseUrl = process.env.COMPATIBLE_BASE_URL ?? "https://api.openai.com/v1";

  let body: { prompt?: string; system?: string } | null = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return NextResponse.json({ error: "empty-prompt" }, { status: 400 });
  if (prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: "prompt-too-long", max: MAX_PROMPT_CHARS }, { status: 413 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "anonymous";
  const limit = rateLimited(ip);
  if (limit.limited) {
    return NextResponse.json(
      { error: "rate-limited", retryAfter: limit.retryAfter },
      { status: 429, headers: { "retry-after": String(limit.retryAfter ?? 60) } },
    );
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.7,
        messages: [
          { role: "system", content: body?.system ?? "You are a helpful video editing assistant." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!response.ok) {
      return NextResponse.json({ error: `upstream-${response.status}` }, { status: 502 });
    }
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return NextResponse.json({ text: data.choices?.[0]?.message?.content ?? "" });
  } catch {
    return NextResponse.json({ error: "network" }, { status: 502 });
  }
}
