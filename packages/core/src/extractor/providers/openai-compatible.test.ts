import { describe, expect, it } from "vitest";
import { ProviderError } from "../../errors.js";
import { fakeFetch, jsonResponse } from "../../test/fake-fetch.js";
import { createGeminiProvider, GEMINI_BASE_URL } from "./gemini.js";
import { createGroqProvider, GROQ_BASE_URL } from "./groq.js";

// Exercises the real openai SDK against a fake fetch: request shape, usage mapping,
// and error translation. No network.

const completion = (content: string) => ({
  id: "chatcmpl-1",
  object: "chat.completion",
  created: 1,
  model: "openai/gpt-oss-120b",
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 321, completion_tokens: 45, total_tokens: 366 },
});

describe("OpenAI-compatible providers", () => {
  it("posts a JSON-mode chat completion to the provider's base URL and maps usage", async () => {
    const http = fakeFetch([
      { match: "/chat/completions", respond: () => jsonResponse(completion('{"results":[]}')) },
    ]);
    const groq = createGroqProvider({ apiKey: "sk-test", model: "openai/gpt-oss-120b", fetch: http.fetch });

    const res = await groq.complete({ system: "sys", user: "usr", json: true });
    expect(res).toEqual({ content: '{"results":[]}', usage: { promptTokens: 321, completionTokens: 45 } });

    const call = http.calls[0];
    expect(call?.url.toString()).toBe(`${GROQ_BASE_URL}/chat/completions`);
    expect(call?.method).toBe("POST");
    expect(call?.headers.authorization).toBe("Bearer sk-test");
    const body = JSON.parse(call?.body ?? "{}") as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "openai/gpt-oss-120b",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "usr" },
      ],
    });
  });

  it("Gemini uses its own base URL", async () => {
    const http = fakeFetch([{ match: "/chat/completions", respond: () => jsonResponse(completion("ok")) }]);
    await createGeminiProvider({ apiKey: "g", model: "gemini-2.5-flash-lite", fetch: http.fetch }).complete({
      system: "s",
      user: "u",
      json: false,
    });
    expect(http.calls[0]?.url.toString()).toBe(`${GEMINI_BASE_URL}/chat/completions`);
    expect(JSON.parse(http.calls[0]?.body ?? "{}")).not.toHaveProperty("response_format");
  });

  it("translates HTTP failures into ProviderError with status and retryability, without SDK retries", async () => {
    const http = fakeFetch([
      {
        match: "/chat/completions",
        respond: () =>
          jsonResponse(
            { error: { message: "rate limited" } },
            { status: 429, headers: { "retry-after": "7" } },
          ),
      },
    ]);
    const groq = createGroqProvider({ apiKey: "k", model: "m", fetch: http.fetch });

    const err = await groq.complete({ system: "s", user: "u", json: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ provider: "groq", status: 429, retryable: true, retryAfterMs: 7_000 });
    expect(http.calls).toHaveLength(1); // maxRetries: 0

    const forbidden = fakeFetch([
      {
        match: "/chat/completions",
        respond: () => jsonResponse({ error: { message: "bad key" } }, { status: 401 }),
      },
    ]);
    const e2 = await createGroqProvider({ apiKey: "k", model: "m", fetch: forbidden.fetch })
      .complete({ system: "s", user: "u", json: true })
      .catch((e: unknown) => e);
    expect(e2).toMatchObject({ status: 401, retryable: false });
  });

  it("treats an empty completion as retryable", async () => {
    const http = fakeFetch([{ match: "/chat/completions", respond: () => jsonResponse(completion("")) }]);
    const err = await createGroqProvider({ apiKey: "k", model: "m", fetch: http.fetch })
      .complete({ system: "s", user: "u", json: true })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ provider: "groq", retryable: true });
  });
});
