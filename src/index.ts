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

// AI layer (0.2.0).
export {
  readAiEnv,
  loadEnvFile,
  redact,
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
} from "./core/env.js";
export type { AiEnv, ReadAiEnvOptions } from "./core/env.js";
export {
  OpenRouterClient,
  OpenRouterError,
  readCompletion,
  jsonSchema,
  formatUsd,
} from "./core/openrouter.js";
export type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  ChatRole,
  ChatUsage,
  ClientOptions,
  ErrorKind,
  SchemaSpec,
} from "./core/openrouter.js";

// Marker filling (0.2.0).
export { parseMarkers, applyFills, describeMarkers } from "./core/markers.js";
export type {
  Marker,
  ParseResult,
  ApplyFillsResult,
  RejectedFill,
} from "./core/markers.js";
export {
  collectProjectContext,
  renderProjectContext,
  isSensitive,
} from "./core/context.js";
export type { ProjectContext, ContextFile } from "./core/context.js";
export { fillProject, findPendingFiles } from "./core/fill.js";
export type { FillOptions, FillFileResult, PendingFile } from "./core/fill.js";

// Draft authoring (0.2.0).
export {
  draftDocument,
  normaliseDraft,
  renderDraft,
  DRAFT_SCHEMA,
} from "./core/draft.js";
export type {
  DraftDoc,
  DraftSection,
  DraftBlank,
  DraftOptions,
  DraftResult,
} from "./core/draft.js";

// Project detection and prompts (0.2.0).
export {
  detectProjects,
  isMisplaced,
  describeProject,
  looksLikeRepo,
} from "./core/detect.js";
export type { DetectedProject } from "./core/detect.js";
export { confirm, choose, isInteractive } from "./core/prompt.js";

// Evidence verification and redaction (0.2.0).
export { redactHumanMarkers } from "./core/markers.js";
export { verifyFills } from "./core/fill.js";
export type { VerifiedFills, SlotOutcome } from "./core/fill.js";
