// Port of compiler/rustc_lint/src/static_mut_refs.rs. The lint static and the `declare_lint_pass!` expansion are
// generated (static_mut_refs.lints.gen.ts).
import type { Mutability } from "../rustc_ast_ir/lib.ts";
import type * as hir from "../rustc_hir/hir.ts";
import type { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { BytePos, Span } from "../rustc_span/lib.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import type { PolyFnSig as PolyFnSigT } from "../rustc_type_ir/decls.ts";
import { PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import { is_ascii_alphanumeric, is_whitespace, len_utf8 } from "../std/char.ts";
import type { Str } from "../std/str.ts";
import { utf8_len } from "../std/str.ts";
import type { LateContext } from "./context.ts";
import { type MutRefSugg, RefOfMutStatic_diagnostic, type StaticMutRefsInteriorMutabilitySugg } from "./diagnostics.gen.ts";
import type { LateLintPass } from "./passes.ts";
import { STATIC_MUT_REFS, StaticMutRefs } from "./static_mut_refs.lints.gen.ts";

export * from "./static_mut_refs.lints.gen.ts";

declare module "./static_mut_refs.lints.gen.ts" {
  interface StaticMutRefs extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for StaticMutRefs
// #[allow(rustc::usage_of_ty_tykind)]
// rustc: compiler/rustc_lint/src/static_mut_refs.rs:65 check_expr
StaticMutRefs.prototype.check_expr = function (this: StaticMutRefs, cx: LateContext, expr: hir.Expr): void {
  const err_span = expr.span;
  const kind = expr.kind;
  let static_mut: StaticMutInfo | undefined;
  let method_def_id: DefId | undefined;
  let receiver: Ty | undefined;
  let rk;
  if (kind.$ === "AddrOf" && kind._0 === "Ref" && (static_mut = path_is_static_mut(kind._2, err_span)) !== undefined) {
    const { _1: m, _2: ex } = kind;
    const source_map = cx.sess().source_map();
    const snippet = source_map.span_to_snippet(err_span);

    let sugg_span: Span;
    if (snippet.$ === "Ok") {
      // ( ( &IDENT ) )
      // ~~~~ exclude these from the suggestion span to avoid unmatching parens
      let exclude_n_bytes = 0;
      const chars = snippet._0.chars();
      for (let ch = chars.next(); ch !== undefined && (is_whitespace(ch) || ch === 0x28 /* '(' */); ch = chars.next()) {
        exclude_n_bytes += len_utf8(ch);
      }

      sugg_span = Span.with_hi(Span.with_lo(err_span, BytePos(Span.lo(err_span) + exclude_n_bytes)), Span.lo(ex.span));
    } else {
      sugg_span = Span.with_hi(err_span, Span.lo(ex.span));
    }

    emit_static_mut_refs(cx, static_mut.err_span, sugg_span, m, !Span.from_expansion(expr.span), static_mut.def_id);
  } else if (
    kind.$ === "MethodCall" &&
    (static_mut = path_is_static_mut(kind._1, expr.span)) !== undefined &&
    // PORT: `LateContext::typeck_results` is typed `unknown` in context.ts (lane lint-late-a types it).
    (method_def_id = (cx.typeck_results_() as TypeckResults).type_dependent_def_id(expr.hir_id)) !== undefined &&
    (receiver = Binder.skip_binder(PolyFnSig.inputs(EarlyBinder.skip_binder(cx.tcx.fn_sig(method_def_id) as EarlyBinder<PolyFnSigT>)))[0]) !== undefined &&
    (rk = receiver.kind()).$ === "Ref"
  ) {
    emit_static_mut_refs(cx, static_mut.err_span, Span.shrink_to_lo(static_mut.err_span), rk._2, false, static_mut.def_id);
  }
};

// rustc: compiler/rustc_lint/src/static_mut_refs.rs:120 check_stmt
StaticMutRefs.prototype.check_stmt = function (this: StaticMutRefs, cx: LateContext, stmt: hir.Stmt): void {
  let static_mut: StaticMutInfo | undefined;
  if (
    stmt.kind.$ === "Let" &&
    stmt.kind._0.pat.kind.$ === "Binding" &&
    stmt.kind._0.pat.kind._0._0.$ === "Yes" &&
    stmt.kind._0.init !== undefined &&
    (static_mut = path_is_static_mut(stmt.kind._0.init, stmt.kind._0.init.span)) !== undefined
  ) {
    const m = stmt.kind._0.pat.kind._0._0._1;
    emit_static_mut_refs(cx, static_mut.err_span, Span.shrink_to_lo(static_mut.err_span), m, false, static_mut.def_id);
  }
};

interface StaticMutInfo {
  err_span: Span;
  def_id: DefId;
}

// rustc: compiler/rustc_lint/src/static_mut_refs.rs:144 path_is_static_mut
function path_is_static_mut(expr: hir.Expr, err_span: Span): StaticMutInfo | undefined {
  if (Span.from_expansion(err_span)) {
    err_span = expr.span;
  }

  while (expr.kind.$ === "Field") {
    expr = expr.kind._0;
  }

  if (expr.kind.$ === "Path" && expr.kind._0.$ === "Resolved") {
    const path = expr.kind._0._1;
    const res = path.res;
    if (res.$ === "Def") {
      const def_kind = res._0;
      if (def_kind.$ === "Static" && def_kind.mutability === "Mut" && def_kind.nested === false) {
        return { err_span, def_id: res._1 };
      }
    }
  }
  return undefined;
}

// rustc: compiler/rustc_lint/src/static_mut_refs.rs:164 emit_static_mut_refs
function emit_static_mut_refs(cx: LateContext, span: Span, sugg_span: Span, mutable: Mutability, suggest_addr_of: boolean, def_id: DefId): void {
  let shared_label: string;
  let shared_note: boolean;
  let mut_note: boolean;
  let sugg: MutRefSugg | undefined;
  switch (mutable) {
    case "Mut": {
      const sugg_: MutRefSugg | undefined = suggest_addr_of ? { $: "Mut", span: sugg_span } : undefined;
      [shared_label, shared_note, mut_note, sugg] = ["mutable ", false, true, sugg_];
      break;
    }
    case "Not": {
      const sugg_: MutRefSugg | undefined = suggest_addr_of ? { $: "Shared", span: sugg_span } : undefined;
      [shared_label, shared_note, mut_note, sugg] = ["shared ", true, false, sugg_];
      break;
    }
  }

  const [interior_mutability_help, interior_mutability_sugg] = interior_mutability_suggestion(cx, def_id, mut_note, suggest_addr_of);

  cx.emit_span_lint(
    STATIC_MUT_REFS,
    span,
    RefOfMutStatic_diagnostic({
      span,
      sugg,
      shared_label,
      shared_note,
      mut_note,
      interior_mutability_help,
      interior_mutability_sugg,
    }),
  );
}

// FIXME: This builds suggestion spans by handcrafting from source text.
// Replace this with HIR-based handling once we can identify the `mut` token
// in the static declaration that way.
// Context: https://github.com/rust-lang/rust/pull/151362/changes#r3210767018
// rustc: compiler/rustc_lint/src/static_mut_refs.rs:207 interior_mutability_suggestion
function interior_mutability_suggestion(cx: LateContext, def_id: DefId, mut_ref: boolean, suggest_addr_of: boolean): [boolean, StaticMutRefsInteriorMutabilitySugg | undefined] {
  const static_ty = EarlyBinder.skip_binder(cx.tcx.type_of(def_id) as EarlyBinder<Ty>);
  // PORT: `LateContext::typing_env` is typed `unknown` in context.ts (lane lint-late-a types it).
  const has_interior_mutability = !static_ty.is_freeze(cx.tcx, cx.typing_env() as TypingEnv);

  if (!has_interior_mutability) {
    return [!suggest_addr_of, undefined];
  }

  if (mut_ref) {
    return [false, undefined];
  }

  const span = static_mutability_span(cx, def_id);
  const sugg = span !== undefined ? { span } : undefined;
  return [false, sugg];
}

// rustc: compiler/rustc_lint/src/static_mut_refs.rs:229 static_mutability_span
function static_mutability_span(cx: LateContext, def_id: DefId): Span | undefined {
  const hir_id = cx.tcx.hir_get_if_local(def_id);
  if (hir_id === undefined) return undefined;
  if (hir_id.$ !== "Item") return undefined;
  const item = hir_id._0;
  if (item.kind.$ !== "Static") return undefined;
  const [mutability, ident] = [item.kind._0, item.kind._1];
  if (mutability !== "Mut") {
    return undefined;
  }

  const vis_span = Span.find_ancestor_inside(item.vis_span, item.span);
  if (vis_span === undefined) return undefined;
  if (!Span.can_be_used_for_suggestions(item.span) || !Span.can_be_used_for_suggestions(vis_span)) {
    return undefined;
  }

  const header_span = Span.between(vis_span, ident.span);
  if (!Span.can_be_used_for_suggestions(header_span)) {
    return undefined;
  }

  const source_map = cx.sess().source_map();
  const snippet_r = source_map.span_to_snippet(header_span);
  if (snippet_r.$ !== "Ok") return undefined;
  const snippet = snippet_r._0;

  const static_w = find_word(snippet, "static", 0);
  if (static_w === undefined) return undefined;
  const [, static_end] = static_w;
  const mut_w = find_word(snippet, "mut", static_end);
  if (mut_w === undefined) return undefined;
  const [mut_start, mut_end_] = mut_w;
  const mut_end = extend_trailing_space(snippet, mut_end_);

  return Span.with_hi(Span.with_lo(header_span, BytePos(Span.lo(header_span) + mut_start)), BytePos(Span.lo(header_span) + mut_end));
}

// rustc: compiler/rustc_lint/src/static_mut_refs.rs:264 find_word
function find_word(snippet: Str, word: string, start: number): [number, number] | undefined {
  const bytes = snippet;
  const word_len = utf8_len(word);
  let search = start;
  while (search <= snippet.len()) {
    const found = snippet.slice(search).find(word);
    if (found === undefined) return undefined;
    const idx = search + found;
    const end = idx + word_len;
    const before_ok = idx === 0 || !is_ident_char(bytes.byte(idx - 1));
    const after_ok = end >= bytes.len() || !is_ident_char(bytes.byte(end));
    if (before_ok && after_ok) {
      return [idx, end];
    }
    search = end;
  }
  return undefined;
}

// rustc: compiler/rustc_lint/src/static_mut_refs.rs:282 is_ident_char
function is_ident_char(byte: number): boolean {
  return is_ascii_alphanumeric(byte) || byte === 0x5f /* b'_' */;
}

// rustc: compiler/rustc_lint/src/static_mut_refs.rs:286 extend_trailing_space
function extend_trailing_space(snippet: Str, end: number): number {
  const ch = snippet.slice(end).chars().next();
  if (ch !== undefined && (ch === 0x20 /* ' ' */ || ch === 0x09) /* '\t' */) {
    end += len_utf8(ch);
  }
  return end;
}
