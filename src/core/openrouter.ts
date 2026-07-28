import type { AiEnv } from "./env.js";

/**
 * A minimal OpenRouter client.
 *
 * Deliberately one file and zero dependencies: Node 22 ships `fetch` and
 * `AbortSignal.timeout`, so an SDK would buy us nothing but supply-chain
 * surface — and this package's whole pitch is that it has one runtime dep.
 *
 * The endpoint is OpenAI-shaped (`POST /chat/completions`), so everything here
 * transfers if we ever point `OPENROUTER_BASE_URL` somewhere else.
 */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/**
 * A JSON Schema to constrain the reply.
 *
 * Under `strict: true` the schema must set `additionalProperties: false` and
 * list every property in `required`; providers reject schemas that don't.
 * Use `jsonSchema()` below rather than hand-rolling that each time.
 */
export interface SchemaSpec {
  name: string;
  schema: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** When set, the reply is constrained to this schema and parsed into `json`. */
  schema?: SchemaSpec;
  /** Hard ceiling on reply length. Also the main cost guard. */
  maxTokens?: number;
  /** Default 0 — we want reproducible fills, not creative ones. */
  temperature?: number;
  /**
   * Turn the model's thinking off.
   *
   * Reasoning tokens are billed at the output rate, and a model that deliberates
   * before answering "what is the test command" spends real money to reach the
   * same string. Extraction wants none of it.
   */
  noReasoning?: boolean;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  /** Tokens served from the provider's prompt cache. Billed far cheaper. */
  cachedTokens: number;
  /** USD charged for this call, as reported by OpenRouter. */
  costUsd: number | null;
}

export interface ChatResult {
  text: string;
  /** Present only when `schema` was supplied. Already parsed. */
  json?: unknown;
  /** The model that actually served the request (may differ from what we asked for). */
  model: string;
  /** OpenRouter generation id — useful for support tickets and the activity dashboard. */
  id?: string;
  usage: ChatUsage;
  latencyMs: number;
}

export type ErrorKind =
  | "auth" // bad or missing key
  | "credits" // account out of credits
  | "rate-limit" // 429
  | "timeout" // our own deadline elapsed
  | "network" // DNS, connection reset, offline
  | "server" // 5xx upstream
  | "request" // we sent something invalid — 4xx that isn't auth/rate-limit
  | "response"; // 200, but the body wasn't what we can use

export class OpenRouterError extends Error {
  readonly kind: ErrorKind;
  readonly status?: number;
  readonly retryable: boolean;
  /** Server-supplied backoff, when it sent a Retry-After header. */
  retryAfterMs?: number;

  constructor(
    kind: ErrorKind,
    message: string,
    opts: { status?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "OpenRouterError";
    this.kind = kind;
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
  }
}

export interface ClientOptions {
  /** Per-attempt deadline. Default 60s. */
  timeoutMs?: number;
  /** Attempts after the first. Default 2, so 3 tries at most. */
  maxRetries?: number;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests, so backoff doesn't make the suite slow. */
  sleep?: (ms: number) => Promise<void>;
  /** Lets a caller cancel the whole operation, retries included. */
  signal?: AbortSignal;
  /**
   * Pins every call in this run to one provider.
   *
   * Without it, OpenRouter only starts sticky routing *after* it observes a
   * cache hit — so a burst of one-shot calls can each land on a different
   * provider and never hit the cache at all. With it, stickiness applies from
   * the first request, which is what makes a shared prompt prefix worth having.
   */
  sessionId?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_TOKENS = 2048;

/** Status codes where trying again is meaningful rather than just rude. */
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Build a strict-mode-safe JSON schema object from a flat map of properties.
 * Handles the `required` + `additionalProperties: false` boilerplate that
 * strict mode demands and that is easy to forget.
 */
export function jsonSchema(
  name: string,
  properties: Record<string, unknown>,
): SchemaSpec {
  return {
    name,
    schema: {
      type: "object",
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  };
}

export class OpenRouterClient {
  private readonly env: AiEnv;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly signal?: AbortSignal;
  private readonly sessionId?: string;

  constructor(env: AiEnv, opts: ClientOptions = {}) {
    this.env = env;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.signal = opts.signal;
    this.sessionId = opts.sessionId?.slice(0, 256);
  }

  get model(): string {
    return this.env.model;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    let body = this.buildBody(req);
    const started = Date.now();

    // Some endpoints reject `reasoning.enabled: false` outright with
    // "Reasoning is mandatory for this endpoint and cannot be disabled."
    // Dropping the request is the wrong response to that; dropping the
    // preference is the right one.
    let reasoningDropped = false;

    let lastError: OpenRouterError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff with jitter. The server's Retry-After wins if it
        // gave us one, because guessing against a rate limiter is how you stay
        // rate-limited.
        const backoff =
          lastError?.retryAfterMs ?? Math.min(2 ** attempt * 500, 8_000);
        const jitter = Math.floor(Math.random() * 250);
        await this.sleep(backoff + jitter);
      }

      try {
        const parsed = await this.attempt(body, req.schema);
        return { ...parsed, latencyMs: Date.now() - started };
      } catch (err) {
        const e = err instanceof OpenRouterError ? err : toOpenRouterError(err);

        if (!reasoningDropped && req.noReasoning && isMandatoryReasoning(e)) {
          reasoningDropped = true;
          const { reasoning: _dropped, ...rest } = body;
          body = rest;
          attempt--; // this attempt didn't test anything; don't spend a retry on it
          lastError = undefined;
          continue;
        }

        if (!e.retryable || attempt === this.maxRetries) throw e;
        lastError = e;
      }
    }

    /* istanbul ignore next — the loop always returns or throws. */
    throw lastError ?? new OpenRouterError("network", "request failed");
  }

  private buildBody(req: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.env.model,
      messages: req.messages,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: req.temperature ?? 0,
    };

    if (this.sessionId) body.session_id = this.sessionId;
    if (req.noReasoning) body.reasoning = { enabled: false };

    if (req.schema) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: req.schema.name,
          strict: true,
          schema: req.schema.schema,
        },
      };
      // Without this, OpenRouter may route to a provider that silently degrades
      // json_schema to loose json_object and ignores the schema entirely.
      body.provider = { require_parameters: true };
    }

    return body;
  }

  private async attempt(
    body: Record<string, unknown>,
    schema: SchemaSpec | undefined,
  ): Promise<Omit<ChatResult, "latencyMs">> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.env.apiKey}`,
      "Content-Type": "application/json",
    };
    // Optional attribution — shows the app name on OpenRouter's leaderboards.
    if (this.env.referer) headers["HTTP-Referer"] = this.env.referer;
    if (this.env.title) headers["X-Title"] = this.env.title;

    const signal = this.signal
      ? AbortSignal.any([this.signal, AbortSignal.timeout(this.timeoutMs)])
      : AbortSignal.timeout(this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.env.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      throw toOpenRouterError(err);
    }

    if (!res.ok) throw await httpError(res);

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new OpenRouterError(
        "response",
        "the API returned a body that wasn't JSON",
      );
    }

    return readCompletion(payload, schema);
  }
}

/* -------------------------------------------------------------------------- */
/* Response parsing                                                            */
/* -------------------------------------------------------------------------- */

interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

interface RawResponse {
  id?: string;
  model?: string;
  error?: { message?: string; code?: number | string };
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: RawUsage;
}

/**
 * Pull a usable result out of a 200 response, or explain precisely why we can't.
 *
 * OpenRouter can return HTTP 200 with an `error` object in the body (typically
 * when a downstream provider fails after routing), so a 200 is not by itself
 * proof of success.
 */
export function readCompletion(
  payload: unknown,
  schema?: SchemaSpec,
): Omit<ChatResult, "latencyMs"> {
  const data = payload as RawResponse;

  if (data?.error) {
    const msg = data.error.message ?? "unknown provider error";
    throw new OpenRouterError(
      "response",
      `the provider returned an error: ${msg}`,
      {
        retryable: true,
      },
    );
  }

  const choice = data?.choices?.[0];
  if (!choice) {
    throw new OpenRouterError("response", "the API returned no choices");
  }

  if (choice.finish_reason === "length") {
    throw new OpenRouterError(
      "response",
      "the reply hit the max_tokens ceiling and was cut off — raise maxTokens or send less at once",
    );
  }

  const text = choice.message?.content ?? "";
  if (text.trim() === "") {
    throw new OpenRouterError("response", "the model returned an empty reply", {
      retryable: true,
    });
  }

  const usage: ChatUsage = {
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    costUsd: typeof data.usage?.cost === "number" ? data.usage.cost : null,
  };

  const result: Omit<ChatResult, "latencyMs"> = {
    text,
    model: data.model ?? "unknown",
    id: data.id,
    usage,
  };

  if (schema) {
    try {
      result.json = JSON.parse(stripCodeFence(text));
    } catch {
      throw new OpenRouterError(
        "response",
        `the model was asked for JSON matching "${schema.name}" but returned something unparseable`,
        { retryable: true },
      );
    }
  }

  return result;
}

/**
 * Some models wrap JSON in a markdown fence even under strict mode. Cheap to
 * tolerate, expensive to debug if we don't.
 */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```$/, "")
    .trim();
}

/* -------------------------------------------------------------------------- */
/* Error mapping                                                               */
/* -------------------------------------------------------------------------- */

async function httpError(res: Response): Promise<OpenRouterError> {
  // Read the body for the provider's own message, but never assume it parses.
  let detail = "";
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    detail = body?.error?.message ?? "";
  } catch {
    /* body wasn't JSON; the status alone will have to do */
  }

  const suffix = detail ? ` — ${detail}` : "";
  const retryable = RETRYABLE_STATUS.has(res.status);

  let kind: ErrorKind;
  let message: string;

  switch (res.status) {
    case 401:
    case 403:
      kind = "auth";
      message = `OpenRouter rejected the key (${res.status})${suffix}\n  Check OPENROUTER_API_KEY — you can view and rotate keys at https://openrouter.ai/settings/keys`;
      break;
    case 402:
      kind = "credits";
      message = `OpenRouter says the account is out of credits (402)${suffix}\n  Top up at https://openrouter.ai/settings/credits`;
      break;
    case 429:
      kind = "rate-limit";
      message = `rate limited by OpenRouter (429)${suffix}`;
      break;
    default:
      if (res.status >= 500) {
        kind = "server";
        message = `OpenRouter or the upstream provider failed (${res.status})${suffix}`;
      } else {
        kind = "request";
        message = `OpenRouter rejected the request (${res.status})${suffix}`;
      }
  }

  const err = new OpenRouterError(kind, message, {
    status: res.status,
    retryable,
  });
  const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
  if (retryAfter !== undefined) err.retryAfterMs = retryAfter;
  return err;
}

/** Retry-After is either delta-seconds or an HTTP date. Cap it so we never hang. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(seconds * 1000, 30_000);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.min(date - Date.now(), 30_000));
}

function toOpenRouterError(err: unknown): OpenRouterError {
  const e = err as {
    name?: string;
    message?: string;
    cause?: { code?: string };
  };

  if (e?.name === "TimeoutError") {
    return new OpenRouterError("timeout", "the request timed out", {
      retryable: true,
    });
  }
  if (e?.name === "AbortError") {
    return new OpenRouterError("timeout", "the request was cancelled", {
      retryable: false,
    });
  }

  const code = e?.cause?.code;
  return new OpenRouterError(
    "network",
    `could not reach OpenRouter${code ? ` (${code})` : ""} — check your connection`,
    { retryable: true },
  );
}

/* -------------------------------------------------------------------------- */
/* Display helpers                                                             */
/* -------------------------------------------------------------------------- */

/** The provider refuses to run without thinking. Not our request's fault. */
function isMandatoryReasoning(err: OpenRouterError): boolean {
  return err.status === 400 && /reasoning is mandatory/i.test(err.message);
}

/** Format a USD amount that is usually a fraction of a cent. */
export function formatUsd(amount: number | null): string {
  if (amount === null) return "unknown";
  if (amount === 0) return "$0";
  if (amount < 0.01) return `$${amount.toFixed(6)}`;
  return `$${amount.toFixed(4)}`;
}
