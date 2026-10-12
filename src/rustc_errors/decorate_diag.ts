// Port of compiler/rustc_errors/src/decorate_diag.rs.
/// This module provides types and traits for buffering lints until later in compilation.
import type { NodeId } from "../rustc_ast/node_id.ts";
import { into_MultiSpan, type IntoMultiSpan } from "../rustc_error_messages/lib.ts";
import { debug_struct, type Debug } from "../std/fmt.ts";
import { LintBuffer, type BufferedEarlyLint } from "./decorate_diag.gen.ts";
import type { Diag, Diagnostic } from "./diagnostic.ts";
import { LintId, type DiagCtxtHandle, type Level, type Lint } from "./lib.ts";

export * from "./decorate_diag.gen.ts";

/** `pub struct DecorateDiagCompat(pub Box<dyn for<'a> FnOnce(DiagCtxtHandle<'a>, Level, &dyn Any) -> Diag<'a> + ...>)` */
// PORT: the third closure argument is a `Session` passed as `&dyn Any` (`unknown`).
export class DecorateDiagCompat {
  constructor(
    /// The third argument of the closure is a `Session`. However, due to the dependency tree,
    /// we don't have access to `rustc_session` here, so we downcast it when needed.
    public _0: (dcx: DiagCtxtHandle, level: Level, sess: unknown) => Diag,
  ) {}

  /** `impl<D: for<'a> Diagnostic<'a> + ...> From<D> for DecorateDiagCompat` */
  // rustc: compiler/rustc_errors/src/decorate_diag.rs:31 from
  static from(d: Diagnostic): DecorateDiagCompat {
    return new DecorateDiagCompat((dcx, level, _) => d.into_diag(dcx, level));
  }
}

/** `impl std::fmt::Debug for DecorateDiagCompat` */
// rustc: compiler/rustc_errors/src/decorate_diag.rs:24 fmt
export const debug_DecorateDiagCompat: Debug<DecorateDiagCompat> = (_v, f) => debug_struct(f, "DecorateDiagCompat", []);

/** `#[derive(Default)]` */
export function LintBuffer_default(): LintBuffer {
  return new LintBuffer(new Map());
}

declare module "./decorate_diag.gen.ts" {
  interface LintBuffer {
    add_early_lint(early_lint: BufferedEarlyLint): void;
    take(id: NodeId): BufferedEarlyLint[];
    buffer_lint(lint: Lint, node_id: NodeId, span: IntoMultiSpan, decorate: DecorateDiagCompat | Diagnostic): void;
    dyn_buffer_lint(lint: Lint, node_id: NodeId, span: IntoMultiSpan, callback: (dcx: DiagCtxtHandle, level: Level) => Diag): void;
    dyn_buffer_lint_any(
      lint: Lint,
      node_id: NodeId,
      span: IntoMultiSpan,
      callback: (dcx: DiagCtxtHandle, level: Level, sess: unknown) => Diag,
    ): void;
  }
}

// rustc: compiler/rustc_errors/src/decorate_diag.rs:60 add_early_lint
LintBuffer.prototype.add_early_lint = function (this: LintBuffer, early_lint: BufferedEarlyLint): void {
  // self.map.entry(early_lint.node_id).or_default().push(early_lint);
  let v = this.map.get(early_lint.node_id);
  if (v === undefined) {
    v = [];
    this.map.set(early_lint.node_id, v);
  }
  v.push(early_lint);
};

// rustc: compiler/rustc_errors/src/decorate_diag.rs:64 take
LintBuffer.prototype.take = function (this: LintBuffer, id: NodeId): BufferedEarlyLint[] {
  // FIXME(#120456) - is `swap_remove` correct?
  return index_map_swap_remove(this.map, id) ?? [];
};

// rustc: compiler/rustc_errors/src/decorate_diag.rs:69 buffer_lint
LintBuffer.prototype.buffer_lint = function (
  this: LintBuffer,
  lint: Lint,
  node_id: NodeId,
  span: IntoMultiSpan,
  decorate: DecorateDiagCompat | Diagnostic,
): void {
  this.add_early_lint({
    lint_id: LintId.of(lint),
    node_id,
    span: into_MultiSpan(span),
    diagnostic: decorate instanceof DecorateDiagCompat ? decorate : DecorateDiagCompat.from(decorate),
  });
};

// rustc: compiler/rustc_errors/src/decorate_diag.rs:84 dyn_buffer_lint
LintBuffer.prototype.dyn_buffer_lint = function (
  this: LintBuffer,
  lint: Lint,
  node_id: NodeId,
  span: IntoMultiSpan,
  callback: (dcx: DiagCtxtHandle, level: Level) => Diag,
): void {
  this.add_early_lint({
    lint_id: LintId.of(lint),
    node_id,
    span: into_MultiSpan(span),
    diagnostic: new DecorateDiagCompat((dcx, level, _) => callback(dcx, level)),
  });
};

// rustc: compiler/rustc_errors/src/decorate_diag.rs:101 dyn_buffer_lint_any
LintBuffer.prototype.dyn_buffer_lint_any = function (
  this: LintBuffer,
  lint: Lint,
  node_id: NodeId,
  span: IntoMultiSpan,
  callback: (dcx: DiagCtxtHandle, level: Level, sess: unknown) => Diag,
): void {
  this.add_early_lint({
    lint_id: LintId.of(lint),
    node_id,
    span: into_MultiSpan(span),
    diagnostic: new DecorateDiagCompat(callback),
  });
};

/**
 * PORT: `IndexMap::swap_remove` on an insertion-ordered JS `Map`: the last entry takes the removed
 * entry's position. (Helper; a shared `src/rust_ts` home would be better, see handoff.)
 */
export function index_map_swap_remove<K, V>(map: Map<K, V>, key: K): V | undefined {
  if (!map.has(key)) return undefined;
  const value = map.get(key)!;
  const entries = [...map];
  const idx = entries.findIndex(([k]) => k === key);
  const last = entries.pop()!;
  if (idx < entries.length) entries[idx] = last;
  map.clear();
  for (const [k, v] of entries) map.set(k, v);
  return value;
}
