// Port of compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/placeholder_error.rs (lane errrep-nice-region).
//
// `impl NiceRegionError` methods are assigned onto `NiceRegionError.prototype` (declared in the crate decls.ts); the trait
// impls of `Highlighted` (`IntoDiagArg`, `fmt::Display`) and its `map` are free fns `Highlighted_<name>` (the type is the
// generated class in placeholder_error.gen.ts).
// Init order: top-level code here touches only this file's .gen.ts, ./mod.ts (`NiceRegionError`) and other crates;
// the crate's diagnostics modules are read inside function bodies only.
export * from "./placeholder_error.gen.ts";
import type { DiagArgValue } from "../../../../rustc_error_messages/lib.ts";
import { Applicability, type Diag } from "../../../../rustc_errors/lib.ts";
import { Namespace } from "../../../../rustc_hir/def.ts";
import { Safety } from "../../../../rustc_hir/lib.ts";
import type { ValuePairs } from "../../../../rustc_infer/infer/mod.ts";
import { type ObligationCause, type ObligationCauseCode, ObligationCauseCodeHandle } from "../../../../rustc_middle/traits/mod.ts";
import type { GenericArgs } from "../../../../rustc_middle/ty/decls.ts";
import { IsSuggestable } from "../../../../rustc_middle/ty/diagnostics.ts";
import { type ParamEnv, Ty } from "../../../../rustc_middle/ty/mod.ts";
import { type Print, print_Ty } from "../../../../rustc_middle/ty/print/mod.ts";
import {
  display_Ty,
  FmtPrinter,
  print_Binder,
  print_FnSig,
  print_TraitRefPrintOnlyTraitPath,
  RegionHighlightMode,
  TraitRef_print_only_trait_path,
  type TraitRefPrintOnlyTraitPath,
} from "../../../../rustc_middle/ty/print/pretty.ts";
import { Predicate_upcast_from_TraitRef } from "../../../../rustc_middle/ty/predicate.ts";
import { fold_Ty } from "../../../../rustc_middle/ty/structural_impls.ts";
import { CRATE_DEF_ID, type DefId, DefId_eq, DefIdSet, LocalDefId } from "../../../../rustc_span/def_id.ts";
import { type PathBuf, Span } from "../../../../rustc_span/lib.ts";
import { Limit } from "../../../../rustc_structures/limit.ts";
import { Binder } from "../../../../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../../../../rustc_type_ir/fold.ts";
import type { Interner } from "../../../../rustc_type_ir/interner.ts";
import {
  as_interner,
  fold_with_TraitRef,
  TraitClause,
  TraitRef,
  type TraitRef as TraitRefT,
  try_fold_with_TraitRef,
  visit_with_TraitRef,
} from "../../../../rustc_type_ir/predicate.ts";
import { Region } from "../../../../rustc_type_ir/sty/mod.ts";
import { type FnSig, fold_FnSig } from "../../../../rustc_type_ir/ty_kind.ts";
import { ClosureArgs } from "../../../../rustc_type_ir/ty_kind/closure.ts";
import type { MutRef } from "../../../../std/mut_ref.ts";
import { bug } from "../../../../rustc_span/macros.ts";
import { panic, unported } from "../../../../std/panic.ts";
import { utf8_len } from "../../../../std/str.ts";
import type {
  ActualImplExpectedKind,
  ActualImplExpectedLifetimeKind,
  ActualImplExplNotes as ActualImplExplNotesT,
  TyOrSig,
} from "../../../diagnostics.gen.ts";
import { Highlighted } from "./placeholder_error.gen.ts";
import { NiceRegionError } from "./mod.ts";

/** `TraitRef`'s `TypeFoldable` (derived). */
const d_TraitRef: TypeFoldable<TraitRefT> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };

/** The crate's diagnostics.gen.ts (read lazily: it imports this module). */
function diagnostics_gen(): typeof import("../../../diagnostics.gen.ts") {
  return require("../../../diagnostics.gen.ts") as typeof import("../../../diagnostics.gen.ts");
}

/** The crate's diagnostics.ts (read lazily: diagnostics.gen.ts imports it and this module). */
function diagnostics(): typeof import("../../../diagnostics.ts") {
  return require("../../../diagnostics.ts") as typeof import("../../../diagnostics.ts");
}

/** PORT: `T: for<'a> Print<FmtPrinter<'a, 'tcx>>` of the `Highlighted<T>` that reach the trait impls through the
 *  generated diagnostics (no printer parameter): the `T`s upstream instantiates (`TraitRefPrintOnlyTraitPath` in
 *  `ActualImplExplNotes`, `Ty` / `Binder<FnSig>` in `TyOrSig`), chosen by the value's representation; any other `T`
 *  is `unported`. */
function print_Highlighted_value<T>(value: T): Print<T, FmtPrinter> {
  if (value instanceof Ty) return print_Ty as unknown as Print<T, FmtPrinter>;
  const v = value as unknown as { readonly _0?: { readonly def_id?: unknown }; readonly bound_vars?: unknown; readonly value?: unknown };
  if (v.bound_vars !== undefined && v.value !== undefined) {
    // `Binder<FnSig>` (`TyOrSig::ClosureSig`, trait_impl_difference.rs's `PolyFnSig`)
    return ((self: Binder<FnSig>, p: FmtPrinter) => print_Binder(self, p, print_FnSig, fold_FnSig)) as unknown as Print<T, FmtPrinter>;
  }
  if (v._0 !== undefined && v._0.def_id !== undefined) {
    return print_TraitRefPrintOnlyTraitPath as unknown as Print<T, FmtPrinter>;
  }
  return unported("rustc_trait_selection::error_reporting::infer::nice_region_error::placeholder_error::Highlighted<T> (Print for this T)");
}

// impl<'tcx, T> IntoDiagArg for Highlighted<'tcx, T> where T: for<'a> Print<FmtPrinter<'a, 'tcx>> + Copy
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/placeholder_error.rs:35 into_diag_arg
export function Highlighted_into_diag_arg<T>(self: Highlighted<T>, _: MutRef<PathBuf | undefined>): DiagArgValue {
  return { $: "Str", _0: Highlighted_to_string(self, print_Highlighted_value(self.value)) };
}

// impl<'tcx, T> Highlighted<'tcx, T>
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/placeholder_error.rs:41 map
export function Highlighted_map<T, U>(self: Highlighted<T>, f: (_0: T) => U): Highlighted<U> {
  // PORT: `Highlighted` is `Copy`: `self.highlight` is copied (`RegionHighlightMode` is a mutable class).
  return new Highlighted(self.tcx, self.highlight.clone(), f(self.value), self.ns);
}

// impl<'tcx, T> fmt::Display for Highlighted<'tcx, T> where T: for<'a> Print<FmtPrinter<'a, 'tcx>> + Copy
// PORT: `fmt` writes into the returned string (`to_string()`); a `fmt::Error` panics as `ToString::to_string` does.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/placeholder_error.rs:50 fmt
export function Highlighted_to_string<T>(self: Highlighted<T>, print_T: Print<T, FmtPrinter>): string {
  let f = "";
  const p = FmtPrinter.new(self.tcx, self.ns);
  p._0.region_highlight_mode = self.highlight.clone();

  if (print_T(self.value, p).$ === "Err") return panic("a Display implementation returned an error unexpectedly: Error");
  const b = p.into_buffer();
  if (utf8_len(b) <= 40 || !self.highlight.keep_regions || self.tcx.sess.opts.verbose) {
    // This is a short enough type that can be safely be printed to the user, or we aren't
    // showing the type with a particular interest in its lifetimes.
    f += b;
  } else {
    // We are highlighting lifetimes in the output, we will print out the smallest possible
    // portion of the type while keeping the lifetimes visible.
    const p = FmtPrinter.new_with_limit(self.tcx, self.ns, Limit.new(0));
    p._0.region_highlight_mode = self.highlight.clone();
    if (print_T(self.value, p).$ === "Err") return panic("could not print type: Error");
    const x = p.into_buffer();
    f += x;
  }
  return f;
}

// impl<'tcx> NiceRegionError<'_, 'tcx> {
/// When given a `ConcreteFailure` for a function with arguments containing a named region and
/// an anonymous region, emit a descriptive diagnostic error.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/placeholder_error.rs:76 try_report_placeholder_conflict
NiceRegionError.prototype.try_report_placeholder_conflict = function (this: NiceRegionError): Diag | undefined {
  const is_placeholder = (r: Region): boolean => r.kind().$ === "RePlaceholder";
  const e = this.error;
  ///////////////////////////////////////////////////////////////////////////
  // NB. The ordering of cases in this match is very
  // sensitive, because we are often matching against
  // specific cases and then using an `_` to match all
  // others.

  ///////////////////////////////////////////////////////////////////////////
  // Check for errors from comparing trait failures -- first
  // with two placeholders, then with one.
  if (e !== undefined && e.$ === "SubSupConflict" && e._2.$ === "Subtype" && is_placeholder(e._3) && is_placeholder(e._5)) {
    const vid = e._0;
    const { cause, values } = e._2._0;
    const sub_placeholder = e._3;
    const sup_placeholder = e._5;
    return this.try_report_trait_placeholder_mismatch(Region.new_var(this.tcx(), vid), cause, sub_placeholder, sup_placeholder, values);
  }

  if (e !== undefined && e.$ === "SubSupConflict" && e._2.$ === "Subtype" && is_placeholder(e._3)) {
    const vid = e._0;
    const { cause, values } = e._2._0;
    const sub_placeholder = e._3;
    return this.try_report_trait_placeholder_mismatch(Region.new_var(this.tcx(), vid), cause, sub_placeholder, undefined, values);
  }

  if (e !== undefined && e.$ === "SubSupConflict" && e._2.$ === "Subtype" && is_placeholder(e._5)) {
    const vid = e._0;
    const { cause, values } = e._2._0;
    const sup_placeholder = e._5;
    return this.try_report_trait_placeholder_mismatch(Region.new_var(this.tcx(), vid), cause, undefined, sup_placeholder, values);
  }

  if (e !== undefined && e.$ === "SubSupConflict" && e._4.$ === "Subtype" && is_placeholder(e._5)) {
    const vid = e._0;
    const { cause, values } = e._4._0;
    const sup_placeholder = e._5;
    return this.try_report_trait_placeholder_mismatch(Region.new_var(this.tcx(), vid), cause, undefined, sup_placeholder, values);
  }

  if (e !== undefined && e.$ === "UpperBoundUniverseConflict" && e._3.$ === "Subtype" && is_placeholder(e._4)) {
    const vid = e._0;
    const { cause, values } = e._3._0;
    const sup_placeholder = e._4;
    return this.try_report_trait_placeholder_mismatch(Region.new_var(this.tcx(), vid), cause, undefined, sup_placeholder, values);
  }

  if (e !== undefined && e.$ === "ConcreteFailure" && e._0.$ === "Subtype" && is_placeholder(e._1) && is_placeholder(e._2)) {
    const { cause, values } = e._0._0;
    const sub_region = e._1;
    const sup_region = e._2;
    return this.try_report_trait_placeholder_mismatch(undefined, cause, sub_region, sup_region, values);
  }

  if (e !== undefined && e.$ === "ConcreteFailure" && e._0.$ === "Subtype" && is_placeholder(e._1)) {
    const { cause, values } = e._0._0;
    const sub_region = e._1;
    const sup_region = e._2;
    return this.try_report_trait_placeholder_mismatch(!sup_region.is_named(this.tcx()) ? sup_region : undefined, cause, sub_region, undefined, values);
  }

  if (e !== undefined && e.$ === "ConcreteFailure" && e._0.$ === "Subtype" && is_placeholder(e._2)) {
    const { cause, values } = e._0._0;
    const sub_region = e._1;
    const sup_region = e._2;
    return this.try_report_trait_placeholder_mismatch(!sub_region.is_named(this.tcx()) ? sub_region : undefined, cause, undefined, sup_region, values);
  }

  return undefined;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/placeholder_error.rs:205 try_report_trait_placeholder_mismatch
NiceRegionError.prototype.try_report_trait_placeholder_mismatch = function (
  this: NiceRegionError,
  vid: Region | undefined,
  cause: ObligationCause,
  sub_placeholder: Region | undefined,
  sup_placeholder: Region | undefined,
  value_pairs: ValuePairs,
): Diag | undefined {
  let expected_args: GenericArgs;
  let found_args: GenericArgs;
  let trait_def_id: DefId;
  if (value_pairs.$ === "TraitRefs" && DefId_eq(value_pairs._0.expected.def_id, value_pairs._0.found.def_id)) {
    const { expected, found } = value_pairs._0;
    // It's possible that the placeholders come from a binder
    // outside of this value pair. Use `no_bound_vars` as a
    // simple heuristic for that.
    [expected_args, found_args, trait_def_id] = [expected.args, found.args, expected.def_id];
  } else {
    return undefined;
  }

  return this.report_trait_placeholder_mismatch(vid, cause, sub_placeholder, sup_placeholder, trait_def_id, expected_args, found_args);
};

// error[E0308]: implementation of `Foo` does not apply to enough lifetimes
//   --> /home/nmatsakis/tmp/foo.rs:12:5
//    |
// 12 |     all::<&'static u32>();
//    |     ^^^^^^^^^^^^^^^^^^^ lifetime mismatch
//    |
//    = note: Due to a where-clause on the function `all`,
//    = note: `T` must implement `...` for any two lifetimes `'1` and `'2`.
//    = note: However, the type `T` only implements `...` for some specific lifetime `'2`.
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/placeholder_error.rs:246 report_trait_placeholder_mismatch
NiceRegionError.prototype.report_trait_placeholder_mismatch = function (
  this: NiceRegionError,
  vid: Region | undefined,
  cause: ObligationCause,
  sub_placeholder: Region | undefined,
  sup_placeholder: Region | undefined,
  trait_def_id: DefId,
  expected_args: GenericArgs,
  actual_args: GenericArgs,
): Diag {
  const span = cause.span;

  let code: ObligationCauseCode = cause.code_();
  for (;;) {
    if (code.$ === "MatchImpl") {
      const inner_cause = code._0;
      code = inner_cause.code_();
    } else if (code.$ === "ImplDerived") {
      const derived = code._0;
      code = ObligationCauseCodeHandle.deref(derived.derived.parent_code);
    } else if (code.$ === "BuiltinDerived") {
      const derived = code._0;
      code = ObligationCauseCodeHandle.deref(derived.parent_code);
    } else if (code.$ === "WellFormedDerived") {
      const derived = code._0;
      code = ObligationCauseCodeHandle.deref(derived.parent_code);
    } else if (code.$ === "ImplDerivedHost") {
      const derived = code._0;
      code = ObligationCauseCodeHandle.deref(derived.derived.parent_code);
    } else if (code.$ === "BuiltinDerivedHost") {
      const derived = code._0;
      code = ObligationCauseCodeHandle.deref(derived.parent_code);
    } else {
      break;
    }
  }
  let satisfy_span: Span | undefined;
  let item_span: Span | undefined;
  let outer_span: Span | undefined;
  let dup_span: Span | undefined;
  let item_name: string;
  if ((code.$ === "WhereClause" || code.$ === "WhereClauseInExpr") && !DefId_eq(code._0, LocalDefId.to_def_id(CRATE_DEF_ID))) {
    const def_id = code._0;
    const span = code._1;
    const parent = this.tcx().parent(def_id);
    const parent_kind = this.tcx().def_kind(parent);
    const ident = this.tcx().opt_item_ident(def_id);
    [satisfy_span, item_span, outer_span, dup_span, item_name] = [
      span,
      ident === undefined ? this.tcx().def_span(def_id) : ident.span,
      parent_kind.$ === "Trait" || parent_kind.$ === "Impl" ? Span.shrink_to_lo(this.tcx().def_span(parent)) : undefined,
      undefined,
      this.tcx().def_path_str(def_id),
    ];
  } else {
    [satisfy_span, item_span, outer_span, dup_span, item_name] = [undefined, undefined, undefined, span, ""];
  }
  if (satisfy_span !== undefined && Span.is_dummy(satisfy_span)) {
    satisfy_span = undefined;
  }
  if (item_span !== undefined && Span.is_dummy(item_span)) {
    item_span = undefined;
  }

  const expected_trait_ref = this.cx.deeply_resolve_ignoring_regions(TraitRef.new_from_args(as_interner(this.cx.tcx), trait_def_id, expected_args), d_TraitRef);
  const actual_trait_ref = this.cx.deeply_resolve_ignoring_regions(TraitRef.new_from_args(as_interner(this.cx.tcx), trait_def_id, actual_args), d_TraitRef);

  // Search the expected and actual trait references to see (a)
  // whether the sub/sup placeholders appear in them (sometimes
  // you have a trait ref like `T: Foo<fn(&u8)>`, where the
  // placeholder was created as part of an inner type) and (b)
  // whether the inference variable appears. In each case,
  // assign a counter value in each case if so.
  let counter = 0;
  let has_sub: number | undefined = undefined;
  let has_sup: number | undefined = undefined;

  let actual_has_vid: number | undefined = undefined;
  let expected_has_vid: number | undefined = undefined;

  this.tcx().for_each_free_region(
    expected_trait_ref,
    (r) => {
      if (r === sub_placeholder && has_sub === undefined) {
        has_sub = counter;
        counter += 1;
      } else if (r === sup_placeholder && has_sup === undefined) {
        has_sup = counter;
        counter += 1;
      }

      if (r === vid && expected_has_vid === undefined) {
        expected_has_vid = counter;
        counter += 1;
      }
    },
    d_TraitRef,
  );

  this.tcx().for_each_free_region(
    actual_trait_ref,
    (r) => {
      if (r === vid && actual_has_vid === undefined) {
        actual_has_vid = counter;
        counter += 1;
      }
    },
    d_TraitRef,
  );

  const actual_self_ty_has_vid = this.tcx().any_free_region_meets(TraitRef.self_ty(actual_trait_ref), (r) => r === vid, fold_Ty);

  const expected_self_ty_has_vid = this.tcx().any_free_region_meets(TraitRef.self_ty(expected_trait_ref), (r) => r === vid, fold_Ty);

  const any_self_ty_has_vid = actual_self_ty_has_vid || expected_self_ty_has_vid;

  // debug!(?actual_has_vid, ?expected_has_vid, ?has_sub, ?has_sup, ?actual_self_ty_has_vid, ?expected_self_ty_has_vid);

  const actual_impl_expl_notes = this.explain_actual_impl_that_was_found(
    sub_placeholder,
    sup_placeholder,
    has_sub,
    has_sup,
    expected_trait_ref,
    actual_trait_ref,
    vid,
    expected_has_vid,
    actual_has_vid,
    any_self_ty_has_vid,
    satisfy_span,
    item_span,
    outer_span,
    item_name,
  );

  const err = this.tcx()
    .dcx()
    .create_err(
      diagnostics_gen().TraitPlaceholderMismatch_diagnostic({
        span,
        dup_span,
        trait_def_id: this.tcx().def_path_str(trait_def_id),
        actual_impl_expl_notes,
      }),
    );

  let current_code: ObligationCauseCode = cause.code_();
  let coroutine_def_id: DefId | undefined = undefined;
  if (cause.body_def_id !== CRATE_DEF_ID) {
    if (code.$ === "WhereClause" || code.$ === "WhereClauseInExpr") {
      // Do not point at the same bound twice.
    } else {
      this.cx.note_obligation_cause_code(
        cause.body_def_id,
        err,
        actual_trait_ref,
        this.tcx().param_env(cause.body_def_id) as ParamEnv,
        cause.code_(),
        [],
        new DefIdSet(),
        Predicate_upcast_from_TraitRef as (from: TraitRefT, tcx: Interner) => ReturnType<typeof Predicate_upcast_from_TraitRef>,
      );
    }
  }

  for (;;) {
    if (current_code.$ === "MatchImpl") {
      const inner_cause = current_code._0;
      current_code = inner_cause.code_();
    } else if (current_code.$ === "BuiltinDerived") {
      const derived = current_code._0;
      const self_ty = TraitClause.self_ty(Binder.skip_binder(derived.parent_trait_pred));

      const k = self_ty.kind();
      if (k.$ === "Coroutine" || k.$ === "CoroutineWitness") {
        const def_id = k._0;
        coroutine_def_id = def_id;
        break;
      }

      current_code = ObligationCauseCodeHandle.deref(derived.parent_code);
    } else {
      break;
    }
  }

  if (coroutine_def_id !== undefined) {
    const def_id = coroutine_def_id;
    if (this.tcx().trait_is_auto(trait_def_id)) {
      const c_span = this.tcx().def_span(def_id);
      const descr = this.tcx().def_descr(def_id);
      const trait_name = this.tcx().def_path_str(trait_def_id);

      err.span_label(c_span, `this ${descr} captures a value whose type is not \`${trait_name}\``);
    }
  }

  // When the mismatched trait is an Fn-trait and the self type is a closure with
  // unannotated parameters, suggest adding explicit type annotations. This turns
  // the confusing lifetime-generality error into an actionable hint, e.g.:
  //   |buf|  →  |buf: &mut [u8]|
  if (this.tcx().is_fn_trait(trait_def_id)) {
    const actual_self_ty = this.cx.deeply_resolve_ignoring_regions(TraitRef.self_ty(TraitRef.new_from_args(as_interner(this.cx.tcx), trait_def_id, actual_args)), fold_Ty);
    const sk = actual_self_ty.kind();
    let local_def_id: LocalDefId | undefined;
    let node;
    if (
      sk.$ === "Closure" &&
      (local_def_id = sk._0.as_local()) !== undefined &&
      (node = this.tcx().hir_node_by_def_id(local_def_id)).$ === "Expr" &&
      node._0.kind.$ === "Closure"
    ) {
      const closure = node._0.kind._0;
      const body = this.tcx().hir_body(closure.body);
      // For Fn traits, args[1] is the tupled input types (e.g. `(&mut [u8],)`).
      const expected_input_tys = expected_args.type_at(1);
      const ek = expected_input_tys.kind();
      if (ek.$ === "Tuple") {
        const input_tys = ek._0;
        const suggestions: [Span, string][] = [];
        const n = Math.min(body.params.length, input_tys.length);
        for (let i = 0; i < n; i++) {
          const param = body.params[i]!;
          const ty = input_tys[i]!;
          // ty_span == pat.span means no explicit type annotation was written.
          if (param.ty_span === param.pat.span && IsSuggestable.is_suggestable(ty, this.tcx(), false, fold_Ty)) {
            suggestions.push([Span.shrink_to_hi(param.pat.span), `: ${display_Ty(ty)}`]);
          }
        }
        if (suggestions.length !== 0) {
          const msg =
            suggestions.length === 1
              ? "consider adding an explicit type annotation to the closure's argument"
              : "consider adding explicit type annotations to the closure's arguments";
          err.multipart_suggestion(msg, suggestions, Applicability.MaybeIncorrect);
        }
      }
    }
  }

  return err;
};

/// Add notes with details about the expected and actual trait refs, with attention to cases
/// when placeholder regions are involved: either the trait or the self type containing
/// them needs to be mentioned the closest to the placeholders.
/// This makes the error messages read better, however at the cost of some complexity
/// due to the number of combinations we have to deal with.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/placeholder_error.rs:506 explain_actual_impl_that_was_found
NiceRegionError.prototype.explain_actual_impl_that_was_found = function (
  this: NiceRegionError,
  sub_placeholder: Region | undefined,
  sup_placeholder: Region | undefined,
  has_sub: number | undefined,
  has_sup: number | undefined,
  expected_trait_ref_: TraitRefT,
  actual_trait_ref_: TraitRefT,
  vid: Region | undefined,
  expected_has_vid: number | undefined,
  actual_has_vid: number | undefined,
  any_self_ty_has_vid: boolean,
  satisfy_span: Span | undefined,
  item_span: Span | undefined,
  outer_span: Span | undefined,
  item_name: string,
): ActualImplExplNotesT[] {
  // The weird thing here with the `maybe_highlighting_region` calls and the
  // the match inside is meant to be like this:
  //
  // - The match checks whether the given things (placeholders, etc) appear
  //   in the types are about to print
  // - Meanwhile, the `maybe_highlighting_region` calls set up
  //   highlights so that, if they do appear, we will replace
  //   them `'0` and whatever. (This replacement takes place
  //   inside the closure given to `maybe_highlighting_region`.)
  //
  // There is some duplication between the calls -- i.e., the
  // `maybe_highlighting_region` checks if (e.g.) `has_sub` is
  // None, an then we check again inside the closure, but this
  // setup sort of minimized the number of calls and so form.

  const highlight_trait_ref = (trait_ref: TraitRefT): Highlighted<TraitRefT> =>
    new Highlighted(this.tcx(), RegionHighlightMode.default(), trait_ref, Namespace.TypeNS);

  const same_self_type = TraitRef.self_ty(actual_trait_ref_) === TraitRef.self_ty(expected_trait_ref_);

  const expected_trait_ref = highlight_trait_ref(expected_trait_ref_);
  expected_trait_ref.highlight.maybe_highlighting_region(sub_placeholder, has_sub);
  expected_trait_ref.highlight.maybe_highlighting_region(sup_placeholder, has_sup);

  let passive_voice: boolean;
  if (has_sub !== undefined || has_sup !== undefined) {
    passive_voice = any_self_ty_has_vid;
  } else {
    expected_trait_ref.highlight.maybe_highlighting_region(vid, expected_has_vid);
    passive_voice = expected_has_vid !== undefined ? true : any_self_ty_has_vid;
  }

  let kind: ActualImplExpectedKind;
  let ty_or_sig: TyOrSig;
  let trait_path: Highlighted<TraitRefPrintOnlyTraitPath>;
  if (same_self_type) {
    const self_ty = Highlighted_map(expected_trait_ref, (tr) => TraitRef.self_ty(tr));
    self_ty.highlight.maybe_highlighting_region(vid, actual_has_vid);

    if (self_ty.value.is_closure() && this.tcx().is_fn_trait(expected_trait_ref.value.def_id)) {
      const closure_sig = Highlighted_map(self_ty, (closure) => {
        const k = closure.kind();
        if (k.$ === "Closure") {
          const args = k._1;
          return this.tcx().signature_unclosure(ClosureArgs.sig(args.as_closure()), Safety.Safe);
        } else {
          return bug("type is not longer closure");
        }
      });
      [kind, ty_or_sig, trait_path] = ["Signature", { $: "ClosureSig", _0: closure_sig }, Highlighted_map(expected_trait_ref, (tr) => TraitRef_print_only_trait_path(tr))];
    } else {
      [kind, ty_or_sig, trait_path] = ["Other", { $: "Ty", _0: self_ty }, Highlighted_map(expected_trait_ref, (tr) => TraitRef_print_only_trait_path(tr))];
    }
  } else if (passive_voice) {
    [kind, ty_or_sig, trait_path] = [
      "Passive",
      { $: "Ty", _0: Highlighted_map(expected_trait_ref, (tr) => TraitRef.self_ty(tr)) },
      Highlighted_map(expected_trait_ref, (tr) => TraitRef_print_only_trait_path(tr)),
    ];
  } else {
    [kind, ty_or_sig, trait_path] = [
      "Other",
      { $: "Ty", _0: Highlighted_map(expected_trait_ref, (tr) => TraitRef.self_ty(tr)) },
      Highlighted_map(expected_trait_ref, (tr) => TraitRef_print_only_trait_path(tr)),
    ];
  }

  let lt_kind: ActualImplExpectedLifetimeKind;
  let lifetime_1: number;
  let lifetime_2: number;
  if (has_sub !== undefined && has_sup !== undefined) {
    const n1 = has_sub;
    const n2 = has_sup;
    [lt_kind, lifetime_1, lifetime_2] = ["Two", Math.min(n1, n2), Math.max(n1, n2)];
  } else if (has_sub !== undefined || has_sup !== undefined) {
    const n = (has_sub ?? has_sup)!;
    [lt_kind, lifetime_1, lifetime_2] = ["Any", n, 0];
  } else {
    if (expected_has_vid !== undefined) {
      const n = expected_has_vid;
      [lt_kind, lifetime_1, lifetime_2] = ["Some", n, 0];
    } else {
      [lt_kind, lifetime_1, lifetime_2] = ["Nothing", 0, 0];
    }
  }

  const note_1 = diagnostics().ActualImplExplNotes.new_expected(
    kind,
    lt_kind,
    ty_or_sig,
    trait_path,
    lifetime_1,
    lifetime_2,
    satisfy_span,
    item_span,
    outer_span,
    item_name,
  );

  const actual_trait_ref = highlight_trait_ref(actual_trait_ref_);
  actual_trait_ref.highlight.maybe_highlighting_region(vid, actual_has_vid);

  const passive_voice_2 = actual_has_vid !== undefined ? any_self_ty_has_vid : true;

  const trait_path_2 = Highlighted_map(actual_trait_ref, (tr) => TraitRef_print_only_trait_path(tr));
  const ty = Highlighted_to_string(
    Highlighted_map(actual_trait_ref, (tr) => TraitRef.self_ty(tr)),
    print_Ty,
  );
  const has_lifetime = actual_has_vid !== undefined;
  const lifetime = actual_has_vid ?? 0;

  let note_2: ActualImplExplNotesT;
  if (same_self_type) {
    const impl_candidates = this.cx.find_similar_impl_candidates(actual_trait_ref.value.def_id, TraitRef.self_ty(actual_trait_ref.value));
    let span: Span | undefined;
    if (impl_candidates.length === 1) {
      const candidate = impl_candidates[0]!;
      span = this.tcx().def_span(candidate.impl_def_id);
    } else {
      span = undefined;
    }
    note_2 = { $: "ButActuallyImplementsTrait", trait_path: trait_path_2, has_lifetime, lifetime, span };
  } else if (passive_voice_2) {
    note_2 = { $: "ButActuallyImplementedForTy", trait_path: trait_path_2, ty, has_lifetime, lifetime };
  } else {
    note_2 = { $: "ButActuallyTyImplements", trait_path: trait_path_2, ty, has_lifetime, lifetime };
  }

  return [note_1, note_2];
};
// }
