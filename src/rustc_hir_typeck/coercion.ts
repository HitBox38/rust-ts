// Port of compiler/rustc_hir_typeck/src/coercion.rs (STUB, lane typeck-coerce): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// coercion.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/coercion.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./coercion.gen.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { unported } from "../std/panic.ts";
import { FnCtxt, register_deref } from "./decls.ts";
import { Coerce } from "./coercion.gen.ts";
import type { Mutability } from "../rustc_ast_ir/lib.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { PredicateObligations } from "../rustc_infer/traits/mod.ts";
import type { Adjustment } from "../rustc_middle/ty/adjustment.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { ParamEnv, Ty } from "../rustc_middle/ty/mod.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import type { RelateResult } from "../rustc_type_ir/decls.ts";
import type { CoerceResult } from "./coercion.gen.ts";

// rustc-type: compiler/rustc_hir_typeck/src/coercion.rs:1565 CoerceMany
/// CoerceMany encapsulates the pattern you should use when you have
/// many expressions that are all getting coerced to a common
/// type. This arises, for example, when you have a match (the result
/// of each arm is coerced to a common type). It also arises in less
/// obvious places, such as when you have many `break foo` expressions
/// that target the same loop, or the various `return` expressions in
/// a function.
///
/// The basic protocol is as follows:
///
/// - Instantiate the `CoerceMany` with an initial `expected_ty`.
///   This will also serve as the "starting LUB". The expectation is
///   that this type is something which all of the expressions *must*
///   be coercible to. Use a fresh type variable if needed.
/// - For each expression whose result is to be coerced, invoke `coerce()` with.
///   - In some cases we wish to coerce "non-expressions" whose types are implicitly
///     unit. This happens for example if you have a `break` with no expression,
///     or an `if` with no `else`. In that case, invoke `coerce_forced_unit()`.
///   - `coerce()` and `coerce_forced_unit()` may report errors. They hide this
///     from you so that you don't have to worry your pretty head about it.
///     But if an error is reported, the final type will be `err`.
///   - Invoking `coerce()` may cause us to go and adjust the "adjustments" on
///     previously coerced expressions.
/// - When all done, invoke `complete()`. This will return the LUB of
///   all your expressions.
///   - WARNING: I don't believe this final type is guaranteed to be
///     related to your initial `expected_ty` in any particular way,
///     although it will typically be a subtype, so you should check it.
///     Check the note below for more details.
///   - Invoking `complete()` may cause us to go and adjust the "adjustments" on
///     previously coerced expressions.
///
/// Example:
///
/// ```ignore (illustrative)
/// let mut coerce = CoerceMany::new(expected_ty);
/// for expr in exprs {
///     let expr_ty = fcx.check_expr_with_expectation(expr, expected);
///     coerce.coerce(fcx, &cause, expr, expr_ty);
/// }
/// let final_ty = coerce.complete(fcx);
/// ```
///
/// NOTE: Why does the `expected_ty` participate in the LUB?
/// When coercing, each branch should use the following expectations for type inference:
/// - The branch can be coerced to the expected type of the match/if/whatever.
/// - The branch can be coercion lub'd with the types of the previous branches.
/// Ideally we'd have some sort of `Expectation::ParticipatesInCoerceLub(ongoing_lub_ty, final_ty)`,
/// but adding and using this feels very challenging.
/// What we instead do is to use the expected type of the match/if/whatever as
/// the initial coercion lub. This allows us to use the lub of "expected type of match" with
/// "types from previous branches" as the coercion target, which can contains both expectations.
///
/// Two concerns with this approach:
/// - We may have incompatible `final_ty` if that lub is different from the expected
///   type of the match. However, in this case coercing the final type of the
///   `CoerceMany` to its expected type would have error'd anyways, so we don't care.
/// - We may constrain the `expected_ty` too early. For some branches with
///   type `a` and `b`, we end up with `(a lub expected_ty) lub b` instead of
///   `(a lub b) is coercible to expected_ty`. `a lub expected_ty` may
///   then be a type which `b` is not coercible to due to information which
///   `expected_ty` doesn't have.
// PORT: hand class (types.sets.json `hand`): the field `expected_ty` is `expected_ty_`, because the method
// `expected_ty()` (coercion.rs:1592) has the same name (infcx-contract representation 2). Methods and the associated
// fns `new` / `with_capacity` are declared in decls.ts (`declare module "./coercion.ts"`).
export class CoerceMany {
  constructor(
    public expected_ty_: Ty,
    public final_ty: Ty | undefined,
    public expressions: hir.Expr[],
  ) {}
}

/** coercion.rs:2160 `struct CoerceVisitor` (`impl ProofTreeVisitor`; hand type, lane typeck-coerce writes the class). */
export type CoerceVisitor = unknown;

// coercion.rs:92 `impl Deref for Coerce { type Target = FnCtxt }` (`&self.fcx`): forwarders installed by lib.ts (decls.ts `register_deref`).
register_deref(Coerce, "fcx", FnCtxt);
unported_methods(FnCtxt.prototype, "rustc_hir_typeck::coercion::FnCtxt", ["coerce", "may_coerce", "may_coerce_except_never", "deref_steps_for_suggestion", "deref_once_mutably_for_diagnostic", "sig_for_coerce_lub", "sig_for_fn_def_coercion", "sig_for_closure_coercion", "try_find_coercion_lub"]);
unported_methods(CoerceMany.prototype, "rustc_hir_typeck::coercion::CoerceMany", ["expected_ty", "merged_ty", "coerce", "coerce_forced_unit", "coerce_inner", "suggest_boxing_tail_for_return_position_impl_trait", "report_return_mismatched_types", "is_return_ty_definitely_unsized", "complete"]);
unported_methods(CoerceMany, "rustc_hir_typeck::coercion::CoerceMany", ["new", "with_capacity"]);
unported_methods(Coerce.prototype, "rustc_hir_typeck::coercion::Coerce", ["deref", "unify_raw", "unify", "unify_and", "coerce", "coerce_from_inference_variable", "coerce_to_ref", "coerce_unsized", "coerce_unsized_old_solver", "unpin_obligation", "maybe_pin_ref_to_ref", "coerce_pin_ref_to_ref", "maybe_to_pin_ref", "coerce_to_pin_ref", "coerce_reborrow", "coerce_shared_reborrow", "coerce_from_fn_pointer", "coerce_from_fn_item", "coerce_closure_to_fn", "coerce_to_raw_ptr"]);
unported_methods(Coerce, "rustc_hir_typeck::coercion::Coerce", ["new"]);

// coercion.rs:101 (stub; final signature: decls.ts `Fns_coercion`)
export function coerce_mutbls(from_mutbl: Mutability, to_mutbl: Mutability): RelateResult<null> {
  return unported("rustc_hir_typeck::coercion::coerce_mutbls");
}

// coercion.rs:109 (stub; final signature: decls.ts `Fns_coercion`)
export function success(adj: Adjustment[], target: Ty, obligations: PredicateObligations): CoerceResult {
  return unported("rustc_hir_typeck::coercion::success");
}

// coercion.rs:1489 (stub; final signature: decls.ts `Fns_coercion`)
export function can_coerce(tcx: TyCtxt, param_env: ParamEnv, body_def_id: LocalDefId, ty: Ty, output_ty: Ty): boolean {
  return unported("rustc_hir_typeck::coercion::can_coerce");
}

// coercion.rs:2139 (stub; final signature: decls.ts `Fns_coercion`)
export function irrefutable_if_let_expr(block: hir.Block): hir.Pat | undefined {
  return unported("rustc_hir_typeck::coercion::irrefutable_if_let_expr");
}

// coercion.rs:2149 (stub; final signature: decls.ts `Fns_coercion`)
export function simple_irrefutable_pattern(pat: hir.Pat): boolean {
  return unported("rustc_hir_typeck::coercion::simple_irrefutable_pattern");
}
