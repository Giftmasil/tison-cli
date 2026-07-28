import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Configuration for the AI layer, read from the environment.
 *
 * Precedence is: real shell environment > `.env` file > built-in default.
 * That order is not something we implement — `process.loadEnvFile` already
 * refuses to clobber variables that are set, which is what we want: CI and
 * one-off `TISON_MODEL=x tison ...` invocations must beat a checked-out `.env`.
 */

/** Cheapest model that supports strict json_schema output and a 1M context. */
export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export interface AiEnv {
  apiKey: string;
  model: string;
  baseUrl: string;
  /** Optional OpenRouter app-attribution headers. Never required. */
  referer?: string;
  title?: string;
}

const loadedPaths = new Set<string>();

/**
 * Load `.env` into process.env from the project being operated on, then from
 * the directory the command was invoked in.
 *
 * Both matter: `tison fill ../other-repo` is a normal thing to type, and the
 * key can reasonably live in either place. Order gives the target project
 * precedence, since `process.loadEnvFile` refuses to clobber a variable that is
 * already set — and a real shell variable still beats both.
 *
 * A missing file is not an error; the key may come from the environment. A
 * malformed one IS worth surfacing, because ignoring it silently produces a
 * confusing "no API key" message two lines later.
 */
export function loadEnvFile(dir?: string): void {
  const candidates = [dir ? resolve(dir) : undefined, process.cwd()].filter(
    (d): d is string => typeof d === "string",
  );

  for (const candidate of new Set(candidates)) {
    const path = resolve(candidate, ".env");
    if (loadedPaths.has(path)) continue;
    loadedPaths.add(path);

    if (!existsSync(path)) continue;

    try {
      process.loadEnvFile(path);
    } catch (err) {
      console.warn(
        `tison: could not parse ${path} — ignoring it (${(err as Error).message})`,
      );
    }
  }
}

/** Trim, and treat an empty/whitespace-only value as absent. */
function read(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface ReadAiEnvOptions {
  /** Overrides TISON_MODEL — for a `--model` flag. */
  model?: string;
  /** Directory to look for `.env` in. Defaults to the process cwd. */
  dir?: string;
}

/**
 * Resolve the AI config, or throw a CLI-shaped error explaining what to set.
 * The key itself is never included in any message this module produces.
 */
export function readAiEnv(opts: ReadAiEnvOptions = {}): AiEnv {
  loadEnvFile(opts.dir);

  const apiKey = read("OPENROUTER_API_KEY");
  if (!apiKey) {
    throw new Error(
      "no OPENROUTER_API_KEY found.\n" +
        "  Get a key at https://openrouter.ai/settings/keys, then either:\n" +
        "    - add  OPENROUTER_API_KEY=sk-or-v1-...  to a .env file in this project, or\n" +
        "    - export it in your shell.\n" +
        "  Make sure .env is in .gitignore — `tison validate` will flag it if it ever gets committed.",
    );
  }

  return {
    apiKey,
    model: opts.model ?? read("TISON_MODEL") ?? DEFAULT_MODEL,
    baseUrl: (read("OPENROUTER_BASE_URL") ?? DEFAULT_BASE_URL).replace(
      /\/+$/,
      "",
    ),
    referer: read("TISON_HTTP_REFERER"),
    title: read("TISON_APP_TITLE"),
  };
}

/**
 * Render a credential safely for display. Used by `tison doctor` so a human can
 * confirm *which* key is loaded without the full value reaching a terminal
 * scrollback, a screen share, or a CI log.
 */
export function redact(secret: string): string {
  if (secret.length <= 8) return "****";
  return `${secret.slice(0, 4)}…${secret.slice(-4)} (${secret.length} chars)`;
}
