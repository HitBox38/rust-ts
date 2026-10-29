// Port of compiler/rustc_lint/src/unused/must_use.rs. The lint statics and the `declare_lint_pass!` expansion
// (`UnusedResults`) are generated (must_use.lints.gen.ts); this file has the `#[must_use]` analysis and the late
// pass `UnusedResults`.
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import type { LangItem } from "../../rustc_attr_ir/lang_items.gen.ts";
import type { Res } from "../../rustc_hir/def.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import { Elaboratable_Clause_Span } from "../../rustc_middle/ty/elaborate_impl.ts";
import { Asyncness, HasAttrs_DefId, type Ty, type TypingEnv } from "../../rustc_middle/ty/mod.ts";
import type { TypeckResults } from "../../rustc_middle/ty/typeck_results.ts";
import { pluralize } from "../../rustc_lint_defs/lib.ts";
import { type DefId, debug_DefId } from "../../rustc_span/def_id.ts";
import { debug_Span, Span } from "../../rustc_span/lib.ts";
import { debug_Symbol, type Symbol, sym } from "../../rustc_span/symbol.ts";
import { str_trim_end } from "../../std/str.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { elaborate } from "../../rustc_type_ir/elaborate.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import type { Clause } from "../../rustc_middle/ty/predicate.ts";
import { type Debug, debug_int, debug_option, debug_tuple, debug_vec } from "../../std/fmt.ts";
import { unwrap } from "../../std/panic.ts";
import type { LateContext } from "../context.ts";
import {
  UnusedClosure_diagnostic,
  UnusedCoroutine_diagnostic,
  type UnusedDefSuggestion,
  UnusedOp_diagnostic,
  type UnusedOpSuggestion,
  UnusedResult_diagnostic,
} from "../diagnostics.gen.ts";
import { UnusedDef_diagnostic } from "../diagnostics.ts";
import type { LateLintPass } from "../passes.ts";
import { UNUSED_MUST_USE, UNUSED_RESULTS, UnusedResults } from "./must_use.lints.gen.ts";

export * from "./must_use.lints.gen.ts";

declare module "./must_use.lints.gen.ts" {
  interface UnusedResults extends LateLintPass {}
}

/// Must the type be used?
// #[derive(Debug)]
export type IsTyMustUse =
  /// Yes, `MustUsePath` contains an explanation for why the type must be used.
  /// This will result in `unused_must_use` lint.
  | { readonly $: "Yes"; _0: MustUsePath }
  /// No, an ordinary type that may be ignored.
  /// This will result in `unused_results` lint.
  | { readonly $: "No" }
  /// No, the type is trivial and thus should always be ignored.
  /// (this suppresses `unused_results` lint)
  | { readonly $: "Trivial" };

export const IsTyMustUse = {
  No: Object.freeze({ $: "No" as const }),
  Trivial: Object.freeze({ $: "Trivial" as const }),

  // rustc: compiler/rustc_lint/src/unused/must_use.rs:108 map
  map(self: IsTyMustUse, f: (must_use_path: MustUsePath) => MustUsePath): IsTyMustUse {
    switch (self.$) {
      case "Yes":
        return { $: "Yes", _0: f(self._0) };
      default:
        return self;
    }
  },
};

/// A path through a type to a `must_use` source. Contains useful info for the lint.
// #[derive(Debug)]
export type MustUsePath =
  /// The root of the normal `must_use` lint with an optional message.
  | { readonly $: "Def"; _0: Span; _1: DefId; _2: Symbol | undefined }
  | { readonly $: "Boxed"; _0: MustUsePath }
  | { readonly $: "Pinned"; _0: MustUsePath }
  | { readonly $: "Opaque"; _0: MustUsePath }
  | { readonly $: "TraitObject"; _0: MustUsePath }
  | { readonly $: "TupleElement"; _0: [number, MustUsePath][] }
  /// `Result<T, Uninhabited>`
  | { readonly $: "Result"; _0: MustUsePath }
  /// `ControlFlow<Uninhabited, T>`
  | { readonly $: "ControlFlow"; _0: MustUsePath }
  // PORT: the `u64` length is a `number` (converted from `Const::try_to_target_usize`'s `bigint`, rust_ts/u64.ts).
  | { readonly $: "Array"; _0: MustUsePath; _1: bigint }
  /// The root of the unused_closures lint.
  | { readonly $: "Closure"; _0: Span }
  /// The root of the unused_coroutines lint.
  | { readonly $: "Coroutine"; _0: Span };

export const debug_MustUsePath: Debug<MustUsePath> = (v, f) => {
  switch (v.$) {
    case "Def":
      return debug_tuple(f, "Def", [debug_Span(v._0, f), debug_DefId(v._1, f), debug_option(v._2, f, debug_Symbol)]);
    case "Boxed":
    case "Pinned":
    case "Opaque":
    case "TraitObject":
    case "Result":
    case "ControlFlow":
      return debug_tuple(f, v.$, [debug_MustUsePath(v._0, f)]);
    case "TupleElement":
      return debug_tuple(f, "TupleElement", [
        debug_vec(v._0, f, (e, f) => debug_tuple(f, "", [debug_int(e[0], f), debug_MustUsePath(e[1], f)])),
      ]);
    case "Array":
      return debug_tuple(f, "Array", [debug_MustUsePath(v._0, f), debug_int(v._1, f)]);
    case "Closure":
    case "Coroutine":
      return debug_tuple(f, v.$, [debug_Span(v._0, f)]);
  }
};

export const debug_IsTyMustUse: Debug<IsTyMustUse> = (v, f) => {
  switch (v.$) {
    case "Yes":
      return debug_tuple(f, "Yes", [debug_MustUsePath(v._0, f)]);
    case "No":
    case "Trivial":
      return v.$;
  }
};

/// Returns `Some(path)` if `ty` should be considered as "`must_use`" in the context of `expr`
/// (`expr` is used to get the parent module, which can affect which types are considered uninhabited).
// #[instrument(skip(cx, expr), level = "debug", ret)]
// rustc: compiler/rustc_lint/src/unused/must_use.rs:140 is_ty_must_use
export function is_ty_must_use(cx: LateContext, ty: Ty, expr: hir.Expr): IsTyMustUse {
  if (ty.is_unit()) {
    return IsTyMustUse.Trivial;
  }

  const parent_mod_did = cx.tcx.parent_module(expr.hir_id);
  const is_uninhabited = (t: Ty): boolean => !t.is_inhabited_from(cx.tcx, parent_mod_did, cx.typing_env() as TypingEnv);

  const kind = ty.kind();
  if (is_uninhabited(ty)) {
    return IsTyMustUse.Trivial;
  }
  let boxed: Ty | undefined;
  if (kind.$ === "Adt" && (boxed = ty.boxed_ty()) !== undefined) {
    return IsTyMustUse.map(is_ty_must_use(cx, boxed, expr), (inner) => ({ $: "Boxed", _0: inner }));
  }
  if (kind.$ === "Adt" && cx.tcx.is_lang_item(kind._0.did(), "Pin" satisfies LangItem)) {
    const args = kind._1;
    const pinned_ty = args.type_at(0);
    return IsTyMustUse.map(is_ty_must_use(cx, pinned_ty, expr), (inner) => ({ $: "Pinned", _0: inner }));
  }
  // Consider `Result<T, Uninhabited>` (e.g. `Result<(), !>`) equivalent to `T`.
  if (kind.$ === "Adt" && cx.tcx.is_diagnostic_item(sym.Result, kind._0.did()) && is_uninhabited(kind._1.type_at(1))) {
    const args = kind._1;
    const ok_ty = args.type_at(0);
    return IsTyMustUse.map(is_ty_must_use(cx, ok_ty, expr), (path) => ({ $: "Result", _0: path }));
  }
  // Consider `ControlFlow<Uninhabited, T>` (e.g. `ControlFlow<!, ()>`) equivalent to `T`.
  if (kind.$ === "Adt" && cx.tcx.is_diagnostic_item(sym.ControlFlow, kind._0.did()) && is_uninhabited(kind._1.type_at(0))) {
    const args = kind._1;
    const continue_ty = args.type_at(1);
    return IsTyMustUse.map(is_ty_must_use(cx, continue_ty, expr), (path) => ({ $: "ControlFlow", _0: path }));
  }
  switch (kind.$) {
    case "Adt": {
      const def = kind._0;
      const p = is_def_must_use(cx, def.did(), expr.span);
      return p === undefined ? IsTyMustUse.No : { $: "Yes", _0: p };
    }
    case "Alias": {
      const alias = kind._1;
      if (alias.kind.$ !== "Opaque" && alias.kind.$ !== "Projection") return IsTyMustUse.No;
      const def = alias.kind.def_id;
      let found: MustUsePath | undefined;
      for (const [pred, _span] of elaborate(
        cx.tcx,
        mapIter(
          EarlyBinder.iter_identity_copied(cx.tcx.explicit_item_self_bounds(def) as EarlyBinder<readonly [Clause, Span][]>),
          (u) => Unnormalized.skip_norm_wip(u) as [Clause, Span],
        ),
        Elaboratable_Clause_Span,
      )
        // We only care about self bounds for the impl-trait
        .filter_only_self()) {
        // We only look at the `DefId`, so it is safe to skip the binder here.
        const pk = Binder.skip_binder(pred.kind());
        let r: MustUsePath | undefined;
        if (pk.$ === "Trait") {
          const poly_trait_predicate = pk._0;
          const def_id = poly_trait_predicate.trait_ref.def_id;

          r = is_def_must_use(cx, def_id, expr.span);
        } else {
          r = undefined;
        }
        if (r !== undefined) {
          found = r;
          break;
        }
      }
      const p: MustUsePath | undefined = found === undefined ? undefined : { $: "Opaque", _0: found };
      return p === undefined ? IsTyMustUse.No : { $: "Yes", _0: p };
    }
    case "Dynamic": {
      const binders = kind._0;
      let found: MustUsePath | undefined;
      for (const predicate of binders) {
        const sp = Binder.skip_binder(predicate);
        let r: MustUsePath | undefined;
        if (sp.$ === "Trait") {
          const trait_ref = sp._0;
          const def_id = trait_ref.def_id;
          const inner = is_def_must_use(cx, def_id, expr.span);
          r = inner === undefined ? undefined : { $: "TraitObject", _0: inner };
        } else {
          r = undefined;
        }
        if (r !== undefined) {
          found = r;
          break;
        }
      }
      return found === undefined ? IsTyMustUse.No : { $: "Yes", _0: found };
    }
    // NB: unit is checked up above; this is only reachable for tuples with at least one element
    case "Tuple": {
      const tys = kind._0;
      let elem_exprs_: readonly hir.Expr[];
      if (expr.kind.$ === "Tup") {
        const elem_exprs = expr.kind._0;
        // debug_assert_eq!(elem_exprs.len(), tys.len());
        elem_exprs_ = elem_exprs;
      } else {
        elem_exprs_ = [];
      }

      // Default to `expr`.
      // PORT: `elem_exprs.iter().chain(iter::repeat(expr))` → index `i`, falling back to `expr`.
      const elem_expr = (i: number): hir.Expr => (i < elem_exprs_.length ? elem_exprs_[i]! : expr);

      let all_trivial = true;
      const nested_must_use: [number, MustUsePath][] = [];

      tys.forEach((ty, i) => {
        const expr = elem_expr(i);
        const must_use = is_ty_must_use(cx, ty, expr);

        all_trivial = all_trivial && must_use.$ === "Trivial";
        if (must_use.$ === "Yes") {
          const path = must_use._0;
          nested_must_use.push([i, path]);
        }
      });

      if (all_trivial) {
        // If all tuple elements are trivial, mark the whole tuple as such.
        // i.e. don't emit `unused_results` for types such as `((), ())`
        return IsTyMustUse.Trivial;
      } else if (nested_must_use.length !== 0) {
        return { $: "Yes", _0: { $: "TupleElement", _0: nested_must_use } };
      } else {
        return IsTyMustUse.No;
      }
    }
    case "Array": {
      const ty = kind._0;
      const len = kind._1.try_to_target_usize(cx.tcx);
      // If the array is empty we don't lint, to avoid false positives
      if (len === 0n || len === undefined) return IsTyMustUse.No;
      // If the array is definitely non-empty, we can do `#[must_use]` checking.
      return IsTyMustUse.map(is_ty_must_use(cx, ty, expr), (inner) => ({ $: "Array", _0: inner, _1: len }));
    }
    case "Closure":
    case "CoroutineClosure":
      return { $: "Yes", _0: { $: "Closure", _0: expr.span } };
    case "Coroutine": {
      const def_id = kind._0;
      // async fn should be treated as "implementor of `Future`"
      let future_def_id: DefId | undefined;
      if (cx.tcx.coroutine_is_async(def_id) && (future_def_id = cx.tcx.lang_items().future_trait()) !== undefined) {
        const def_id = future_def_id;
        return {
          $: "Yes",
          _0: { $: "Opaque", _0: unwrap(is_def_must_use(cx, def_id, expr.span), "future trait is marked as `#[must_use]`") },
        };
      } else {
        return { $: "Yes", _0: { $: "Coroutine", _0: expr.span } };
      }
    }
    default:
      return IsTyMustUse.No;
  }
}

/** `Iterator::map` over an iterable (lazy, as upstream's adapter chain). */
function* mapIter<T, U>(it: Iterable<T>, f: (t: T) => U): Generator<U> {
  for (const t of it) yield f(t);
}

// impl LateLintPass for UnusedResults
// rustc: compiler/rustc_lint/src/unused/must_use.rs:285 check_stmt
UnusedResults.prototype.check_stmt = function (this: UnusedResults, cx: LateContext, s: hir.Stmt): void {
  if (s.kind.$ !== "Semi") {
    return;
  }
  let expr = s.kind._0;

  let expr_is_from_block = false;
  while (expr.kind.$ === "Block" && expr.kind._0.expr !== undefined) {
    const e = expr.kind._0.expr;
    expr = e;
    expr_is_from_block = true;
  }

  if (expr.kind.$ === "Ret") {
    return;
  }

  const typeck_results = (): TypeckResults => cx.typeck_results_() as TypeckResults;
  const ty = typeck_results().expr_ty(expr);
  const needs_binding = ty.has_significant_drop(cx.tcx, cx.typing_env() as TypingEnv);

  if (expr.kind.$ === "Match" && expr.kind._2.$ === "AwaitDesugar") {
    const await_expr = expr.kind._0;
    const ty = typeck_results().expr_ty(await_expr);
    const ty_kind = ty.kind();
    if (ty_kind.$ === "Alias" && ty_kind._1.kind.$ === "Opaque") {
      const future_def_id = ty_kind._1.kind.def_id;
      if (cx.tcx.ty_is_opaque_future(ty)) {
        const async_fn_def_id = cx.tcx.parent(future_def_id);
        const dk = cx.tcx.def_kind(async_fn_def_id);
        if (
          (dk.$ === "Fn" || dk.$ === "AssocFn") &&
          // Check that this `impl Future` actually comes from an `async fn`
          Asyncness.is_async(cx.tcx.asyncness(async_fn_def_id) as Asyncness) &&
          check_must_use_def(cx, async_fn_def_id, expr.span, "output of future returned by ", "", expr_is_from_block, needs_binding)
        ) {
          // We have a bare `foo().await;` on an opaque type from an async function that was
          // annotated with `#[must_use]`.
          return;
        }
      }
    }
  }

  const must_use_result = is_ty_must_use(cx, ty, expr);
  let type_lint_emitted_or_trivial: boolean;
  switch (must_use_result.$) {
    case "Yes": {
      const path = must_use_result._0;
      emit_must_use_untranslated(cx, path, "", "", 1n, false, expr_is_from_block, needs_binding);
      type_lint_emitted_or_trivial = true;
      break;
    }
    case "Trivial":
      type_lint_emitted_or_trivial = true;
      break;
    case "No":
      type_lint_emitted_or_trivial = false;
      break;
  }

  const fn_warned = check_fn_must_use(cx, expr, expr_is_from_block, needs_binding);

  if (!fn_warned && type_lint_emitted_or_trivial) {
    // We don't warn about unused unit or uninhabited types.
    // (See https://github.com/rust-lang/rust/issues/43806 for details.)
    return;
  }

  let must_use_op: string | undefined;
  switch (expr.kind.$) {
    // Hardcoding operators here seemed more expedient than the
    // refactoring that would be needed to look up the `#[must_use]`
    // attribute which does exist on the comparison trait methods
    case "Binary": {
      const bin_op = expr.kind._0;
      switch (bin_op.node) {
        case "Eq":
        case "Lt":
        case "Le":
        case "Ne":
        case "Ge":
        case "Gt":
          must_use_op = "comparison";
          break;
        case "Add":
        case "Sub":
        case "Div":
        case "Mul":
        case "Rem":
          must_use_op = "arithmetic operation";
          break;
        case "And":
        case "Or":
          must_use_op = "logical operation";
          break;
        case "BitXor":
        case "BitAnd":
        case "BitOr":
        case "Shl":
        case "Shr":
          must_use_op = "bitwise operation";
          break;
      }
      break;
    }
    case "AddrOf":
      must_use_op = "borrow";
      break;
    case "OffsetOf":
      must_use_op = "`offset_of` call";
      break;
    case "Unary":
      must_use_op = "unary operation";
      break;
    // The `offset_of` macro wraps its contents inside a `const` block.
    case "ConstBlock": {
      const block = expr.kind._0;
      const body = cx.tcx.hir_body(block.body);
      if (body.value.kind.$ === "Block" && body.value.kind._0.expr !== undefined && body.value.kind._0.expr.kind.$ === "OffsetOf") {
        must_use_op = "`offset_of` call";
      } else {
        must_use_op = undefined;
      }
      break;
    }
    default:
      must_use_op = undefined;
  }

  let op_warned: boolean;
  if (must_use_op !== undefined) {
    const span = Span.find_ancestor_not_from_macro(expr.span) ?? expr.span;
    const suggestion: UnusedOpSuggestion = expr_is_from_block
      ? { $: "BlockTailExpr", before_span: Span.shrink_to_lo(span), after_span: Span.shrink_to_hi(span) }
      : { $: "NormalExpr", span: Span.shrink_to_lo(span) };
    cx.emit_span_lint(UNUSED_MUST_USE, expr.span, UnusedOp_diagnostic({ op: must_use_op, label: expr.span, suggestion }));
    op_warned = true;
  } else {
    op_warned = false;
  }

  // Only emit unused results lint if we haven't emitted any of the more specific lints and the expression type is non trivial.
  if (!(type_lint_emitted_or_trivial || fn_warned || op_warned)) {
    cx.emit_span_lint(UNUSED_RESULTS, s.span, UnusedResult_diagnostic({ ty }));
  }
};

/// Checks if `expr` is a \[method\] call expression marked as `#[must_use]` and emits a lint if so.
/// Returns `true` if the lint has been emitted.
// rustc: compiler/rustc_lint/src/unused/must_use.rs:429 check_fn_must_use
function check_fn_must_use(cx: LateContext, expr: hir.Expr, expr_is_from_block: boolean, needs_binding: boolean): boolean {
  let maybe_def_id: DefId | undefined;
  switch (expr.kind.$) {
    case "Call": {
      const callee = expr.kind._0;
      let res: Res;
      if (
        callee.kind.$ === "Path" &&
        // `Res::Local` if it was a closure, for which we
        // do not currently support must-use linting
        (res = cx.qpath_res(callee.kind._0, callee.hir_id) as Res).$ === "Def" &&
        (res._0.$ === "Fn" || res._0.$ === "AssocFn")
      ) {
        maybe_def_id = res._1;
      } else {
        maybe_def_id = undefined;
      }
      break;
    }
    case "MethodCall":
      maybe_def_id = (cx.typeck_results_() as TypeckResults).type_dependent_def_id(expr.hir_id);
      break;
    default:
      maybe_def_id = undefined;
  }

  if (maybe_def_id !== undefined) {
    const def_id = maybe_def_id;
    return check_must_use_def(cx, def_id, expr.span, "return value of ", "", expr_is_from_block, needs_binding);
  }
  return false;
}

// rustc: compiler/rustc_lint/src/unused/must_use.rs:466 is_def_must_use
function is_def_must_use(cx: LateContext, def_id: DefId, span: Span): MustUsePath | undefined {
  // check for #[must_use = "..."]
  // PORT: `find_attr!(cx.tcx, def_id, MustUse { reason, .. } => reason)` yields `Option<&Option<Symbol>>`; the inner
  // option is boxed (`{ reason }`) so a `#[must_use]` without a reason is not `undefined`.
  const found = find_attr(HasAttrs_DefId.get_attrs(def_id, cx.tcx), (k) => (k.$ === "MustUse" ? { reason: k.reason } : undefined));
  return found === undefined ? undefined : { $: "Def", _0: span, _1: def_id, _2: found.reason };
}

/// Returns whether further errors should be suppressed because a lint has been emitted.
// rustc: compiler/rustc_lint/src/unused/must_use.rs:473 check_must_use_def
function check_must_use_def(
  cx: LateContext,
  def_id: DefId,
  span: Span,
  descr_pre_path: string,
  descr_post_path: string,
  expr_is_from_block: boolean,
  needs_binding: boolean,
): boolean {
  const must_use_path = is_def_must_use(cx, def_id, span);
  if (must_use_path === undefined) return false;
  emit_must_use_untranslated(cx, must_use_path, descr_pre_path, descr_post_path, 1n, false, expr_is_from_block, needs_binding);
  return true;
}

// #[instrument(skip(cx), level = "debug")]
// PORT: the host `usize::MAX`, for `saturating_add` below.
const USIZE_MAX = (1n << 64n) - 1n;

// rustc: compiler/rustc_lint/src/unused/must_use.rs:499 emit_must_use_untranslated
function emit_must_use_untranslated(
  cx: LateContext,
  path: MustUsePath,
  descr_pre: string,
  descr_post: string,
  // PORT: `usize` as a `bigint`: an array length can be `usize::MAX` (tests/ui/lint/unused/must_use-array.rs).
  plural_len: bigint,
  is_inner: boolean,
  expr_is_from_block: boolean,
  needs_binding: boolean,
): void {
  // PORT: `pluralize!` only tests `== 1`, which `Number` keeps exact.
  const plural_suffix = pluralize(Number(plural_len));

  switch (path.$) {
    case "Boxed": {
      const descr_pre_ = `${descr_pre}boxed `;
      emit_must_use_untranslated(cx, path._0, descr_pre_, descr_post, plural_len, true, expr_is_from_block, needs_binding);
      break;
    }
    case "Pinned": {
      const descr_pre_ = `${descr_pre}pinned `;
      emit_must_use_untranslated(cx, path._0, descr_pre_, descr_post, plural_len, true, expr_is_from_block, needs_binding);
      break;
    }
    case "Opaque": {
      const descr_pre_ = `${descr_pre}implementer${plural_suffix} of `;
      emit_must_use_untranslated(cx, path._0, descr_pre_, descr_post, plural_len, true, expr_is_from_block, needs_binding);
      break;
    }
    case "TraitObject": {
      const descr_post_ = ` trait object${plural_suffix}${descr_post}`;
      emit_must_use_untranslated(cx, path._0, descr_pre, descr_post_, plural_len, true, expr_is_from_block, needs_binding);
      break;
    }
    case "TupleElement": {
      const elems = path._0;
      for (const [index, p] of elems) {
        const descr_post_ = ` in tuple element ${index}`;
        emit_must_use_untranslated(cx, p, descr_pre, descr_post_, plural_len, true, expr_is_from_block, needs_binding);
      }
      break;
    }
    case "Result": {
      const descr_post_ = ` in a \`Result\` with an uninhabited error${descr_post}`;
      emit_must_use_untranslated(cx, path._0, descr_pre, descr_post_, plural_len, true, expr_is_from_block, needs_binding);
      break;
    }
    case "ControlFlow": {
      const descr_post_ = ` in a \`ControlFlow\` with an uninhabited break ${descr_post}`;
      emit_must_use_untranslated(cx, path._0, descr_pre, descr_post_, plural_len, true, expr_is_from_block, needs_binding);
      break;
    }
    case "Array": {
      const len = path._1;
      const descr_pre_ = `${descr_pre}array${plural_suffix} of `;
      // PORT: `usize::try_from(*len)` never fails: the host `usize` is 64 bits, like the target `u64`.
      const sum = plural_len + len;
      emit_must_use_untranslated(cx, path._0, descr_pre_, descr_post, sum > USIZE_MAX ? USIZE_MAX : sum, true, expr_is_from_block, needs_binding);
      break;
    }
    case "Closure": {
      const span = path._0;
      // PORT: the generated `count` is a `number`; above 2^53 the arg is a string either way (an
      // `i32` overflow), which the message only plural-selects (`*[other]`), so the rounding never shows.
      cx.emit_span_lint(UNUSED_MUST_USE, span, UnusedClosure_diagnostic({ count: Number(plural_len), pre: descr_pre, post: descr_post }));
      break;
    }
    case "Coroutine": {
      const span = path._0;
      cx.emit_span_lint(UNUSED_MUST_USE, span, UnusedCoroutine_diagnostic({ count: Number(plural_len), pre: descr_pre, post: descr_post }));
      break;
    }
    case "Def": {
      const span = path._0;
      const def_id = path._1;
      const reason = path._2;
      const ancenstor_span = Span.find_ancestor_not_from_macro(span) ?? span;
      const prev = cx.sess().source_map().span_to_prev_source(ancenstor_span);
      const is_redundant_let_ignore = prev.$ === "Ok" ? str_trim_end(prev._0).toString().endsWith("let _ =") : false;
      const suggestion_span = is_redundant_let_ignore ? span : ancenstor_span;
      let suggestion: UnusedDefSuggestion | undefined;
      if (is_inner) {
        suggestion = undefined;
      } else {
        const lo = Span.shrink_to_lo(suggestion_span);
        const hi = Span.shrink_to_hi(suggestion_span);
        if (needs_binding && expr_is_from_block) {
          suggestion = { $: "BindingBlockTailExpr", before_span: lo, after_span: hi };
        } else if (needs_binding && !expr_is_from_block) {
          suggestion = { $: "BindingExpr", span: lo };
        } else if (!needs_binding && expr_is_from_block) {
          suggestion = { $: "BlockTailExpr", before_span: lo, after_span: hi };
        } else {
          suggestion = { $: "NormalExpr", span: lo };
        }
      }
      cx.emit_span_lint(
        UNUSED_MUST_USE,
        ancenstor_span,
        UnusedDef_diagnostic({ pre: descr_pre, post: descr_post, cx, def_id, note: reason, suggestion }),
      );
      break;
    }
  }
}
