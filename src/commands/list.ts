import { listCategories } from "../core/paths.js";
import { readManifest } from "../core/apply.js";

export function listCommand(): void {
  const categories = listCategories();
  if (categories.length === 0) {
    console.log("No template categories found.");
    return;
  }
  console.log("Available categories:\n");
  for (const cat of categories) {
    let desc = "";
    let docs: string[] = [];
    try {
      const m = readManifest(cat);
      desc = m.description ? ` - ${m.description}` : "";
      docs = m.files.map((f) => f.doc);
    } catch {
      desc = " - (invalid manifest)";
    }
    console.log(`  ${cat}${desc}`);
    if (docs.length) console.log(`      docs: ${docs.join(", ")}`);
  }
}
