// Groq AI helper — server only. Groq exposes an OpenAI-compatible API.
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
// llama-3.3-70b-versatile was shut down for free/dev tiers on 2026-08-16.
const DEFAULT_CHAT_MODEL = process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export function groqKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not configured");
  return key;
}

export async function chat(opts: {
  messages: ChatMessage[];
  model?: string;
  json?: boolean;
  temperature?: number;
}): Promise<string> {
  const key = groqKey();

  const body: Record<string, unknown> = {
    model: opts.model ?? DEFAULT_CHAT_MODEL,
    messages: opts.messages,
  };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (String(body.model).startsWith("openai/gpt-oss")) {
    // Reasoning model: keep it fast and return only the final answer in `content`.
    body.reasoning_effort = process.env.GROQ_REASONING_EFFORT || "low";
    body.include_reasoning = false;
  }
  if (opts.json) body.response_format = { type: "json_object" };

  const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("AI rate limit — please try again in a moment.");
    if (res.status === 401) throw new Error("Invalid GROQ_API_KEY.");
    throw new Error(`Groq API error [${res.status}]: ${text}`);
  }
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? "";
}

export async function chatJSON<T>(opts: {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
}): Promise<T> {
  const parse = (raw: string): T | null => {
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Try to find first JSON block
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return null;
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        return null;
      }
    }
  };
  // One retry: models occasionally return truncated or empty JSON.
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = parse(await chat({ ...opts, json: true }));
    if (out) return out;
  }
  throw new Error("AI returned an invalid response. Please try again.");
}
