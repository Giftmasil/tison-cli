import { createInterface } from "node:readline/promises";

/**
 * The smallest interactive layer that does the job.
 *
 * No dependency: `node:readline/promises` covers a confirm and a numbered
 * choice, and this package's whole pitch is one runtime dep. Every prompt takes
 * a default, and every one is skipped when there's no TTY — a command that
 * blocks waiting for input in CI is worse than one that never asked.
 */

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Yes/no. Returns `defaultYes` unchanged when non-interactive or on empty input. */
export async function confirm(
  question: string,
  defaultYes = true,
): Promise<boolean> {
  if (!isInteractive()) return defaultYes;

  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = (await ask(`${question} (${hint}) `)).toLowerCase();

  if (answer === "") return defaultYes;
  return answer === "y" || answer === "yes";
}

export interface Choice<T> {
  label: string;
  value: T;
  /** Shown indented under the label. */
  detail?: string;
}

/** Numbered list. Returns the first choice when non-interactive or on empty input. */
export async function choose<T>(
  question: string,
  choices: Choice<T>[],
): Promise<T> {
  const first = choices[0];
  if (!first) throw new Error("choose() needs at least one option");
  if (!isInteractive() || choices.length === 1) return first.value;

  console.log(`\n${question}\n`);
  choices.forEach((choice, i) => {
    const marker = i === 0 ? ">" : " ";
    console.log(`  ${marker} ${i + 1}. ${choice.label}`);
    if (choice.detail) console.log(`        ${choice.detail}`);
  });

  const answer = await ask(`\nChoose 1-${choices.length} [1]: `);
  if (answer === "") return first.value;

  const index = Number.parseInt(answer, 10);
  if (Number.isNaN(index) || index < 1 || index > choices.length) {
    console.log("Not one of the options — using the default.");
    return first.value;
  }

  return choices[index - 1]!.value;
}
