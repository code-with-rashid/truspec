import type { TruSpecRequest } from "../format/types";
import { CODEGEN_TARGETS, type CodegenTarget, multipartNote } from "./targets";
import { type HttpShape, type ShapeOptions, toHttpShape } from "./shape";

export type { CodegenBody, HttpShape, ShapeOptions } from "./shape";
export type { CodegenTarget } from "./targets";
export { CODEGEN_TARGETS } from "./targets";
export { toHttpShape } from "./shape";

/** Ids of every supported snippet target, in menu order. */
export function codegenTargetIds(): string[] {
  return CODEGEN_TARGETS.map((t) => t.id);
}

export function findCodegenTarget(id: string): CodegenTarget | undefined {
  return CODEGEN_TARGETS.find((t) => t.id === id);
}

export interface GeneratedCode {
  target: CodegenTarget;
  code: string;
}

/**
 * Render a request as a runnable snippet in another client/language.
 *
 * Folder config (base URL, inherited headers/auth) is applied exactly as the runner applies it,
 * so the snippet hits the same URL with the same headers the runner would send. Variables are
 * substituted when `vars` is supplied; anything unresolved is left as its authored `{{name}}`
 * placeholder so the reader can see what to fill in.
 */
export function generateCode(
  req: TruSpecRequest,
  targetId: string,
  opts: ShapeOptions = {},
): GeneratedCode {
  const target = findCodegenTarget(targetId);
  if (!target) {
    throw new Error(`Unknown code target "${targetId}". Known: ${codegenTargetIds().join(", ")}`);
  }
  return { target, code: renderShape(toHttpShape(req, opts), target) };
}

/** Render an already-normalized shape. Exposed for callers that build a shape by hand. */
export function renderShape(shape: HttpShape, target: CodegenTarget): string {
  const code = target.render(shape);
  // A target that cannot express `multipart/form-data` must say so. Silently emitting the fields
  // as a urlencoded body would produce a snippet that looks right, runs, and sends the wrong
  // content type — a worse outcome than an honest comment.
  if (shape.body?.kind === "multipart" && !target.multipart) {
    return `${multipartNote(shape.body.parts, target.comment)}\n${code}`;
  }
  return code;
}
