// Programmatic API (matches package.json "exports").
export { applyDocs, readManifest } from "./core/apply.js";
export type {
  ApplyOptions,
  AppliedFile,
  ApplyStatus,
  TemplateFile,
  TemplateManifest,
} from "./core/apply.js";
export { listCategories } from "./core/paths.js";
export { validateDir, collectContextFiles } from "./core/validate.js";
export type { Finding, Severity, ValidationResult } from "./core/validate.js";
