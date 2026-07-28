import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normaliseDraft,
  renderDraft,
  DRAFT_SCHEMA,
  draftDocument,
} from "./draft.js";
import { parseMarkers, applyFills } from "./markers.js";
import { OpenRouterClient } from "./openrouter.js";
import type { AiEnv } from "./env.js";
import type { ProjectContext } from "./context.js";

const env: AiEnv = {
  apiKey: "sk-or-v1-test",
  model: "deepseek/deepseek-v4-flash",
  baseUrl: "https://openrouter.ai/api/v1",
};

const context: ProjectContext = {
  root: "/tmp/x",
  tree: ["package.json"],
  treeTruncated: false,
  files: [],
  approxTokens: 10,
};

function stubClient(payload: unknown) {
  const sent: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({
        model: env.model,
        choices: [
          {
            message: { content: JSON.stringify(payload) },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 500, completion_tokens: 120, cost: 0.0002 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return { client: new OpenRouterClient(env, { fetchImpl }), sent };
}

const section = (
  heading: string,
  blanks: { label: string; hint: string }[],
) => ({ heading, blanks });

/* -------------------------------------------------------------------------- */
/* Shape of the output                                                         */
/* -------------------------------------------------------------------------- */

test("renders a labelled blank per line, so a filled line still reads", () => {
  // The previous design emitted whole-line slots, so a filled document became a
  // bare list of commands with nothing saying which was which.
  const { doc, slotCount } = normaliseDraft({
    title: "Deployment",
    sections: [
      section("Build", [
        {
          label: "Build command",
          hint: "the command that builds for production",
        },
        { label: "Start command", hint: "the command that starts the server" },
      ]),
    ],
  });

  assert.equal(slotCount, 2);
  const markdown = renderDraft(doc);
  assert.match(
    markdown,
    /- Build command: `\[TODO\(tison\): the command that builds for production\]`/,
  );

  const { markers } = parseMarkers(markdown);
  const filled = applyFills(markdown, markers, {
    m1: "next build",
    m2: "next start",
  });
  assert.match(filled.text, /- Build command: `next build`/);
  assert.match(filled.text, /- Start command: `next start`/);
});

test("a blank that isn't a command or path renders without backticks", () => {
  const { doc } = normaliseDraft({
    title: "Releases",
    sections: [
      section("Sign-off", [
        { label: "Approver", hint: "who signs off a release" },
      ]),
    ],
  });
  const markdown = renderDraft(doc);
  assert.match(
    markdown,
    /- Approver: \[TODO\(tison\): who signs off a release\]/,
  );
  assert.ok(!/`\[TODO/.test(markdown));
});

test("every rendered blank round-trips through the marker parser", () => {
  const { doc, slotCount } = normaliseDraft({
    title: "Deployment",
    sections: [
      section("Build", [{ label: "Build command", hint: "the build command" }]),
      section("Checks", [
        { label: "Health endpoint", hint: "the health check route" },
      ]),
    ],
  });
  const { markers, malformed } = parseMarkers(renderDraft(doc));
  assert.deepEqual(malformed, []);
  assert.equal(markers.length, slotCount);
  assert.ok(
    markers.every((m) => !m.humanOnly),
    "draft only produces fillable blanks",
  );
});

test("says in the file that it is an unreviewed skeleton", () => {
  const { doc } = normaliseDraft({
    title: "T",
    sections: [section("S", [{ label: "L", hint: "the build command" }])],
  });
  assert.match(renderDraft(doc), /not reviewed by anyone yet/);
});

/* -------------------------------------------------------------------------- */
/* Guardrails                                                                  */
/* -------------------------------------------------------------------------- */

test("drops overview sections whatever they are called", () => {
  for (const heading of [
    "Overview",
    "Introduction",
    "About",
    "System Overview",
    "Getting Started",
  ]) {
    const { doc, dropped } = normaliseDraft({
      title: "T",
      sections: [section(heading, [{ label: "L", hint: "the build command" }])],
    });
    assert.equal(doc.sections.length, 0, `${heading} survived`);
    assert.ok(dropped.some((d) => /hurt agents/.test(d)));
  }
});

test("strips an example smuggled into a hint, which would answer its own blank", () => {
  const cases: [string, string][] = [
    ["the seed command (e.g., npx prisma db seed)", "the seed command"],
    ["package manager, e.g., npm, yarn, pnpm", "package manager"],
    ["the build command, e.g. npm run build", "the build command"],
  ];
  for (const [given, expected] of cases) {
    const { doc } = normaliseDraft({
      title: "T",
      sections: [section("S", [{ label: "L", hint: given }])],
    });
    assert.equal(
      doc.sections[0]!.blanks[0]!.hint,
      expected,
      `failed on: ${given}`,
    );
  }
});

test("strips every placeholder syntax the model has been seen to invent", () => {
  const cases: [string, RegExp][] = [
    ["(hint: the install command)", /^the install command$/],
    ["[: DATABASE_URL]", /^DATABASE_URL$/],
    ["command_slot(the build command)", /^the build command$/],
  ];
  for (const [given, expected] of cases) {
    const { doc } = normaliseDraft({
      title: "T",
      sections: [section("S", [{ label: "L", hint: given }])],
    });
    assert.match(
      doc.sections[0]!.blanks[0]!.hint,
      expected,
      `failed on: ${given}`,
    );
  }
});

test("a hint can never close its own marker", () => {
  const { doc } = normaliseDraft({
    title: "T",
    sections: [section("S", [{ label: "L", hint: "the [primary] region]" }])],
  });
  const { markers, malformed } = parseMarkers(renderDraft(doc));
  assert.deepEqual(malformed, []);
  assert.equal(markers.length, 1);
});

test("falls back to the hint when the model gives no label", () => {
  const { doc } = normaliseDraft({
    title: "T",
    sections: [section("S", [{ label: "", hint: "the build command" }])],
  });
  assert.equal(doc.sections[0]!.blanks[0]!.label, "The build command");
});

test("caps sections and blanks rather than trusting the prompt", () => {
  const { doc } = normaliseDraft({
    title: "T",
    sections: Array.from({ length: 12 }, (_, i) =>
      section(
        `S${i}`,
        Array.from({ length: 20 }, () => ({
          label: "L",
          hint: "the build command",
        })),
      ),
    ),
  });
  assert.equal(doc.sections.length, 6);
  assert.ok(doc.sections.every((s) => s.blanks.length <= 8));
});

test("drops a .md extension the model puts in the title", () => {
  const { doc } = normaliseDraft({ title: "DEPLOYMENT.md", sections: [] });
  assert.equal(doc.title, "DEPLOYMENT");
});

test("survives a reply missing everything", () => {
  const { doc, slotCount } = normaliseDraft({});
  assert.equal(doc.title, "Untitled");
  assert.deepEqual(doc.sections, []);
  assert.equal(slotCount, 0);
  assert.match(renderDraft(doc), /^# Untitled/);
});

test("stays under the length ceiling validate enforces", () => {
  const { doc } = normaliseDraft({
    title: "T",
    sections: Array.from({ length: 6 }, (_, i) =>
      section(
        `S${i}`,
        Array.from({ length: 8 }, () => ({
          label: "x".repeat(60),
          hint: "y".repeat(200),
        })),
      ),
    ),
  });
  assert.ok(renderDraft(doc).split("\n").length <= 120);
});

/* -------------------------------------------------------------------------- */
/* Request shape                                                              */
/* -------------------------------------------------------------------------- */

test("the schema offers no field for authoring prose or choosing a kind", () => {
  const schema = DRAFT_SCHEMA.schema as Record<string, unknown>;
  const props = schema.properties as Record<string, any>;
  assert.ok(!("purpose" in props), "no prose field");

  const blank = props.sections.items.properties.blanks.items;
  assert.deepEqual(Object.keys(blank.properties).sort(), ["hint", "label"]);
  assert.deepEqual(blank.required.sort(), ["hint", "label"]);
  assert.equal(blank.additionalProperties, false);
  assert.equal(schema.additionalProperties, false);
});

test("end to end: a stubbed reply becomes a fillable skeleton, with reasoning off", async () => {
  const { client, sent } = stubClient({
    title: "Deployment",
    sections: [
      section("Build", [{ label: "Build command", hint: "the build command" }]),
    ],
  });

  const result = await draftDocument({ client, context, topic: "deployment" });

  assert.equal(result.slotCount, 1);
  assert.match(result.markdown, /## Build/);
  assert.equal(parseMarkers(result.markdown).markers.length, 1);
  assert.deepEqual(sent[0]!.reasoning, { enabled: false });

  const messages = sent[0]!.messages as { role: string; content: string }[];
  assert.equal(messages.length, 3);
  assert.match(messages[0]!.content, /You write nothing else/);
});

test("refuses to create a blank asking for a secret's value", () => {
  // Real output from a live run: "AUTH_SECRET value: [TODO(tison): auth secret
  // for NextAuth (npx auth secret output)]". A committed file is the last place
  // that should invite a pasted credential.
  const unsafe = [
    { label: "AUTH_SECRET value", hint: "auth secret for NextAuth" },
    {
      label: "Database URL",
      hint: "the connection string for the production database",
    },
    { label: "API key", hint: "the api key for the mail provider" },
    { label: "Access token", hint: "the access token used in production" },
    { label: "Redis URL", hint: "the connection string for Upstash Redis" },
  ];
  for (const blank of unsafe) {
    const { doc, dropped, slotCount } = normaliseDraft({
      title: "Deployment",
      sections: [section("Secrets", [blank])],
    });
    assert.equal(slotCount, 0, `"${blank.label}" should not become a blank`);
    assert.equal(doc.sections.length, 0);
    assert.ok(dropped.some((d) => /documents get committed/.test(d)));
  }
});

test("still allows asking where a secret lives or what it is called", () => {
  const safe = [
    {
      label: "Auth secret variable",
      hint: "the name of the environment variable holding the secret",
    },
    {
      label: "Secret manager",
      hint: "the service where production secrets are stored",
    },
    { label: "Rotation policy", hint: "how often credentials are rotated" },
    { label: "Secret owner", hint: "who owns the production credentials" },
  ];
  for (const blank of safe) {
    const { slotCount } = normaliseDraft({
      title: "Deployment",
      sections: [section("Secrets", [blank])],
    });
    assert.equal(slotCount, 1, `"${blank.label}" should survive`);
  }
});
