import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OpenRouterClient,
  OpenRouterError,
  readCompletion,
  jsonSchema,
  formatUsd,
} from "./openrouter.js";
import type { AiEnv } from "./env.js";

/**
 * Run with:  node --test src/core/openrouter.test.ts
 *
 * Node 22 strips the types itself, so these run with no test framework and no
 * build step. Nothing here touches the network — `fetchImpl` and `sleep` are
 * injected, which is the reason those seams exist on the client at all.
 */

const env: AiEnv = {
  apiKey: "sk-or-v1-test",
  model: "deepseek/deepseek-v4-flash",
  baseUrl: "https://openrouter.ai/api/v1",
};

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const okBody = {
  id: "gen-123",
  model: "deepseek/deepseek-v4-flash",
  choices: [
    { message: { content: '{"value":"filled"}' }, finish_reason: "stop" },
  ],
  usage: {
    prompt_tokens: 100,
    completion_tokens: 10,
    cost: 0.000012,
    prompt_tokens_details: { cached_tokens: 80 },
  },
};

/** A fetch stub that replays a queue of responses and records what it was sent. */
function stubFetch(queue: (Response | Error)[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const next = queue.shift();
    if (next === undefined)
      throw new Error("stub fetch called more times than expected");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const noSleep = async (): Promise<void> => {};

test("parses a successful structured reply, including cached tokens and cost", async () => {
  const { impl, calls } = stubFetch([jsonResponse(okBody)]);
  const client = new OpenRouterClient(env, { fetchImpl: impl, sleep: noSleep });

  const res = await client.chat({
    messages: [{ role: "user", content: "go" }],
    schema: jsonSchema("t", { value: { type: "string" } }),
  });

  assert.deepEqual(res.json, { value: "filled" });
  assert.equal(res.usage.cachedTokens, 80);
  assert.equal(res.usage.costUsd, 0.000012);
  assert.equal(calls[0]?.url, "https://openrouter.ai/api/v1/chat/completions");
});

test("sends strict json_schema and require_parameters when a schema is given", async () => {
  const { impl, calls } = stubFetch([jsonResponse(okBody)]);
  const client = new OpenRouterClient(env, { fetchImpl: impl, sleep: noSleep });

  await client.chat({
    messages: [{ role: "user", content: "go" }],
    schema: jsonSchema("t", { value: { type: "string" } }),
  });

  const body = calls[0]!.body as {
    response_format?: { type?: string; json_schema?: { strict?: boolean } };
    provider?: { require_parameters?: boolean };
    temperature?: number;
  };

  assert.equal(body.response_format?.type, "json_schema");
  assert.equal(body.response_format?.json_schema?.strict, true);
  assert.equal(body.provider?.require_parameters, true);
  assert.equal(body.temperature, 0, "fills must be reproducible");
});

test("omits response_format entirely when no schema is given", async () => {
  const { impl, calls } = stubFetch([
    jsonResponse({
      ...okBody,
      choices: [{ message: { content: "plain" }, finish_reason: "stop" }],
    }),
  ]);
  const client = new OpenRouterClient(env, { fetchImpl: impl, sleep: noSleep });

  const res = await client.chat({
    messages: [{ role: "user", content: "go" }],
  });

  assert.equal(res.text, "plain");
  assert.equal(res.json, undefined);
  assert.ok(!("response_format" in calls[0]!.body));
});

test("retries a 429 and succeeds on the next attempt", async () => {
  const { impl, calls } = stubFetch([
    jsonResponse({ error: { message: "slow down" } }, 429, {
      "retry-after": "1",
    }),
    jsonResponse(okBody),
  ]);
  const client = new OpenRouterClient(env, {
    fetchImpl: impl,
    sleep: noSleep,
    maxRetries: 2,
  });

  const res = await client.chat({
    messages: [{ role: "user", content: "go" }],
  });

  assert.equal(res.model, "deepseek/deepseek-v4-flash");
  assert.equal(calls.length, 2);
});

test("does not retry a 401 — a bad key will still be bad in 500ms", async () => {
  const { impl, calls } = stubFetch([
    jsonResponse({ error: { message: "no auth" } }, 401),
  ]);
  const client = new OpenRouterClient(env, {
    fetchImpl: impl,
    sleep: noSleep,
    maxRetries: 3,
  });

  await assert.rejects(
    () => client.chat({ messages: [{ role: "user", content: "go" }] }),
    (err: OpenRouterError) => {
      assert.equal(err.kind, "auth");
      assert.equal(err.status, 401);
      return true;
    },
  );
  assert.equal(calls.length, 1);
});

test("gives up after maxRetries and surfaces the last error", async () => {
  const { impl, calls } = stubFetch([
    jsonResponse({}, 503),
    jsonResponse({}, 503),
    jsonResponse({}, 503),
  ]);
  const client = new OpenRouterClient(env, {
    fetchImpl: impl,
    sleep: noSleep,
    maxRetries: 2,
  });

  await assert.rejects(
    () => client.chat({ messages: [{ role: "user", content: "go" }] }),
    (err: OpenRouterError) => err.kind === "server",
  );
  assert.equal(calls.length, 3);
});

test("never leaks the API key into an error message", async () => {
  const { impl } = stubFetch([
    jsonResponse({ error: { message: "nope" } }, 401),
  ]);
  const client = new OpenRouterClient(env, { fetchImpl: impl, sleep: noSleep });

  await assert.rejects(
    () => client.chat({ messages: [{ role: "user", content: "go" }] }),
    (err: Error) => {
      assert.ok(!err.message.includes(env.apiKey));
      assert.ok(!(err.stack ?? "").includes(env.apiKey));
      return true;
    },
  );
});

test("treats a 200 body carrying an error object as a failure", () => {
  assert.throws(
    () => readCompletion({ error: { message: "provider exploded" } }),
    (err: OpenRouterError) => err.kind === "response" && err.retryable,
  );
});

test("rejects a truncated reply rather than writing half a value", () => {
  assert.throws(
    () =>
      readCompletion({
        choices: [
          { message: { content: '{"value":"half' }, finish_reason: "length" },
        ],
      }),
    (err: OpenRouterError) => /max_tokens/.test(err.message),
  );
});

test("tolerates JSON wrapped in a markdown fence", () => {
  const res = readCompletion(
    {
      choices: [
        {
          message: { content: '```json\n{"value":"ok"}\n```' },
          finish_reason: "stop",
        },
      ],
    },
    jsonSchema("t", { value: { type: "string" } }),
  );
  assert.deepEqual(res.json, { value: "ok" });
});

test("jsonSchema produces a strict-mode-valid schema", () => {
  const spec = jsonSchema("fills", {
    a: { type: "string" },
    b: { type: "string" },
  });
  assert.deepEqual(spec.schema.required, ["a", "b"]);
  assert.equal(spec.schema.additionalProperties, false);
});

test("formats sub-cent costs without rounding them to zero", () => {
  assert.equal(formatUsd(0.000012), "$0.000012");
  assert.equal(formatUsd(null), "unknown");
});
