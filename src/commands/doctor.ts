import { readAiEnv, redact, DEFAULT_MODEL } from "../core/env.js";
import { OpenRouterClient, OpenRouterError, jsonSchema, formatUsd } from "../core/openrouter.js";

export interface DoctorFlags {
  /** Override the configured model for this check only. */
  model?: string;
  /** Report configuration only; make no network call and spend nothing. */
  offline: boolean;
}

/**
 * Prove the AI path works end to end before anything depends on it.
 *
 * Deliberately the smallest possible real call: a structured-output request
 * with a two-field schema. If this passes, the key, the model slug, the
 * network path, and strict json_schema support are all confirmed — which is
 * every assumption the marker-fill pass will rest on.
 */
export async function doctorCommand(flags: DoctorFlags): Promise<number> {
  console.log("\ntison doctor\n");

  let env;
  try {
    env = readAiEnv({ model: flags.model });
  } catch (err) {
    console.log(`  key      ✗  ${(err as Error).message}`);
    return 1;
  }

  console.log(`  key      ✓  ${redact(env.apiKey)}`);
  console.log(`  model    ${env.model}${env.model === DEFAULT_MODEL ? "  (default)" : ""}`);
  console.log(`  endpoint ${env.baseUrl}/chat/completions`);

  if (!env.apiKey.startsWith("sk-or-")) {
    console.log("  note     that key doesn't look like an OpenRouter key (they start with sk-or-)");
  }

  if (flags.offline) {
    console.log("\nConfiguration looks usable. Re-run without --offline to make a real call.");
    return 0;
  }

  console.log("\n  calling the model…");

  const client = new OpenRouterClient(env, { timeoutMs: 30_000, maxRetries: 1 });

  const schema = jsonSchema("tison_doctor", {
    ok: { type: "boolean", description: "always true" },
    model_family: { type: "string", description: "the family this model belongs to, one word" },
  });

  try {
    const res = await client.chat({
      messages: [
        {
          role: "system",
          content: "You are a connectivity check. Reply only with JSON matching the schema.",
        },
        { role: "user", content: "Confirm you are reachable." },
      ],
      schema,
      maxTokens: 200,
    });

    const shape = res.json as { ok?: unknown; model_family?: unknown } | undefined;

    console.log(`\n  reply    ✓  valid JSON matching the schema`);
    console.log(`  served   ${res.model}`);
    console.log(`  latency  ${res.latencyMs} ms`);
    console.log(
      `  tokens   ${res.usage.promptTokens} in / ${res.usage.completionTokens} out` +
        (res.usage.cachedTokens > 0 ? ` (${res.usage.cachedTokens} cached)` : "")
    );
    console.log(`  cost     ${formatUsd(res.usage.costUsd)}`);
    if (res.id) console.log(`  id       ${res.id}`);

    if (typeof shape?.ok !== "boolean") {
      console.log("\n  warning: the reply parsed but didn't contain the fields the schema required.");
      console.log("  This model may not honour strict json_schema. Try a different TISON_MODEL.");
      return 1;
    }

    console.log("\nThe AI path works. You're ready for marker filling.");
    return 0;
  } catch (err) {
    if (err instanceof OpenRouterError) {
      console.log(`\n  call     ✗  [${err.kind}] ${err.message}`);
      if (err.kind === "request") {
        console.log(
          "\n  A 4xx here usually means the model slug is wrong, or the chosen model\n" +
            "  doesn't support strict json_schema. Check the slug against\n" +
            "  https://openrouter.ai/models?supported_parameters=structured_outputs"
        );
      }
      return 1;
    }
    console.log(`\n  call     ✗  ${(err as Error).message}`);
    return 1;
  }
}