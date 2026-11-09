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
  const prompt = (body?.prompt ?? "").slice(0, 6000);
  if (!prompt) return NextResponse.json({ error: "empty-prompt" }, { status: 400 });

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
