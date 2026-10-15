// Port of compiler/rustc_hir_typeck/src/method/suggest.rs (lines 1..2432 by lane typeck-suggest-a, 2433.. by lane
// typeck-suggest-b): see docs/handoff/fnctxt-contract.md "How to fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// method/suggest.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./suggest.gen.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { unported } from "../../std/panic.ts";
import { FnCtxt } from "../decls.ts";
import { debug_Expr, debug_Ty as debug_hir_Ty } from "../../rustc_hir/lib.ts";
import { type Debug, debug_tuple } from "../../std/fmt.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import type { AssocItem } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { TraitRef } from "../../rustc_type_ir/decls.ts";
import type { TraitInfo } from "./suggest.gen.ts";
// ---- lane typeck-suggest-a imports ----
import { Mutability } from "../../rustc_ast_ir/lib.ts";
import { ControlFlow, VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { SortedMap } from "../../rustc_data_structures/sorted_map.ts";
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import { listify, pluralize, StringPart, str_trim, struct_span_code_err } from "../../rustc_errors/lib.ts";
import { E0034, E0599, E0624 } from "../../rustc_errors/error_codes.gen.ts";
import * as hir_ from "../../rustc_hir/lib.ts";
import { debug_Node } from "../../rustc_hir/hir.gen.ts";
import { Visitor, walk_pat, walk_stmt } from "../../rustc_hir/intravisit.ts";
import { type HirId, HirId_eq, type ItemLocalId } from "../../rustc_hir_id/lib.ts";
import { BoundRegionConversionTime } from "../../rustc_infer/infer/mod.gen.ts";
import { Obligation } from "../../rustc_infer/traits/mod.ts";
import type { PredicateObligation } from "../../rustc_infer/traits/mod.gen.ts";
import { clone_ObligationCause } from "../../rustc_middle/traits/mod.ts";
import { AssocItem as AssocItemC, AssocItems } from "../../rustc_middle/ty/assoc.ts";
import type { Region } from "../../rustc_middle/ty/decls.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { GenericParamDef, Generics } from "../../rustc_middle/ty/generics.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { HasAttrs_DefId, Ty } from "../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_TraitRef, type Predicate } from "../../rustc_middle/ty/predicate.ts";
import { display_Predicate, display_Term, display_TraitRefPrintOnlyTraitPath, display_Ty, TraitRef_print_only_trait_path, with_forced_trimmed_paths } from "../../rustc_middle/ty/print/pretty.ts";
import { print_Ty } from "../../rustc_middle/ty/print/mod.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { ParamTy } from "../../rustc_middle/ty/sty.ts";
import { DefId_eq, DefIdMap, DefIdSet, LocalDefId, type DefId } from "../../rustc_span/def_id.ts";
import { find_best_match_for_name } from "../../rustc_span/edit_distance.ts";
import { SyntaxContext } from "../../rustc_span/hygiene.ts";
import { OrdSpan, Span as SpanC, type ErrorGuaranteed, type PathBuf } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Ident, sym, Symbol as Sym, display_Ident, type Symbol } from "../../rustc_span/symbol.ts";
import { str_cmp } from "../../rustc_session/options.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import { display_AliasTerm } from "../../rustc_type_ir/ir_print.ts";
import { as_interner, PolyTraitClause, TraitClause, TraitRef as TraitRefC } from "../../rustc_type_ir/predicate.ts";
import type { PolyTraitClause as PolyTraitClauseT } from "../../rustc_type_ir/decls.ts";
import { AliasTerm, AliasTermKind } from "../../rustc_type_ir/term_kind.ts";
import { FnSig, fold_FnSig, PolyFnSig, TyVid } from "../../rustc_type_ir/ty_kind.ts";
import type { PolyFnSig as PolyFnSigT } from "../../rustc_type_ir/decls.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { KeyedMap, KeyedSet } from "../../rust_ts/keyed.ts";
import { is_whitespace } from "../../std/char.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { utf8_len } from "../../std/str.ts";
import { PLAIN } from "../../std/fmt.ts";
import { expr_place } from "../expr_use_visitor.ts";
import { Expectation } from "../expectation.ts";
import type { Expectation as ExpectationT } from "../expectation.gen.ts";
import { NoAssociatedItem_diagnostic } from "../diagnostics.gen.ts";
import { clone_CandidateSource, type CandidateSource, type MethodError, type NoMatchData } from "./mod.gen.ts";
import { ProbeScope, type Mode, type UnsatisfiedPredicates } from "./probe.gen.ts";
import { TraitBoundDuplicateTracker } from "./suggest.gen.ts";

// rustc-type: compiler/rustc_hir_typeck/src/method/suggest.rs:4950 SelfSource
// PORT: hand-written (types.sets.json `skip`): the generated Debug would import `hir::Ty`'s and `ty::Ty`'s `debug_Ty` under
// one name. `#[derive(Copy, Clone, Debug)]`: an immutable value, so Clone is the identity.
export type SelfSource =
  | { readonly $: "QPath"; _0: hir.Ty }
  | { readonly $: "MethodCall"; _0: hir.Expr /* rcvr */ };
export const debug_SelfSource: Debug<SelfSource> = (v, f) => {
  switch (v.$) {
    case "QPath":
      return debug_tuple(f, "QPath", [debug_hir_Ty(v._0, f, (_x, _f) => "()")]);
    case "MethodCall":
      return debug_tuple(f, "MethodCall", [debug_Expr(v._0, f)]);
  }
};

// ==== lane typeck-suggest-a: method/suggest.rs:1..2432 ====
// Port notes (lane typeck-suggest-a):
// - `#[instrument]` / `debug!` / `info!` are tracing only and stay as comments.
// - `SortedMap<OrdSpan, Vec<String>>` is rustc_data_structures' `SortedMap` ordered by `OrdSpan::cmp`; `&mut bool`
//   out-parameters are `MutRef<boolean>` cells (decls.ts declares them by value: see `FnCtxt_suggest_a` below).
// - `FxIndexMap` / `FxIndexSet` are insertion-ordered `Map` / `Set` (`DefIdMap` / `DefIdSet` for `DefId` keys, `KeyedMap` /
//   `KeyedSet` for tuple keys); `UnordSet` is a `Set` whose users only test membership or sort.
// - `Vec<String>::sort()` / `dedup()` compare strings by `str_cmp` (UTF-8 byte order, as `String: Ord`).

// PORT(decls): pending root. decls.ts declares the `&mut bool` parameters of these four private methods (only called from
// this region) as `boolean` and `SortedMap<OrdSpan, Vec<String>>` as `Map<OrdSpan, string[]>`. `FnCtxt_suggest_a` is the
// upstream signatures; the region calls and assigns the four methods through it (`suggest_a(fcx)`).
interface FnCtxt_suggest_a {
  suggest_unsatisfied_ty_or_trait(err: Diag, span: Span, rcvr_ty: Ty, item_ident: Ident, item_kind: string, source: SelfSource, unsatisfied_predicates: UnsatisfiedPredicates, static_candidates: readonly CandidateSource[]): Result<[boolean, boolean, boolean, boolean, SortedMap<OrdSpan, string[]>], null>;
  suggest_method_not_found_because_of_unsatisfied_bounds(err: Diag, rcvr_ty: Ty, item_ident: Ident, item_kind: string, bound_spans: SortedMap<OrdSpan, string[]>, unsatisfied_predicates: UnsatisfiedPredicates): void;
  set_not_found_span_label(err: Diag, rcvr_ty: Ty, item_ident: Ident, item_kind: string, mode: Mode, source: SelfSource, span: Span, unsatisfied_predicates: UnsatisfiedPredicates, find_candidate_for_method: MutRef<boolean>): void;
  handle_unsatisfied_predicates(err: Diag, rcvr_ty: Ty, item_ident: Ident, item_kind: string, span: Span, unsatisfied_predicates: UnsatisfiedPredicates, restrict_type_params: MutRef<boolean>, suggested_derive: MutRef<boolean>, unsatisfied_bounds: MutRef<boolean>, custom_span_label: MutRef<boolean>, bound_spans: SortedMap<OrdSpan, string[]>): void;
}
function suggest_a(fcx: FnCtxt): FnCtxt_suggest_a {
  return fcx as unknown as FnCtxt_suggest_a;
}
const FnCtxt_suggest_a_prototype = FnCtxt.prototype as unknown as { [K in keyof FnCtxt_suggest_a]: (this: FnCtxt, ...args: Parameters<FnCtxt_suggest_a[K]>) => ReturnType<FnCtxt_suggest_a[K]> };

/** `String: Ord` (UTF-8 byte order). */
function cmp_String(a: string, b: string): number {
  return str_cmp(a, b);
}

/** `#[derive(PartialEq)] CandidateSource` */
function CandidateSource_eq(a: CandidateSource, b: CandidateSource): boolean {
  return a.$ === b.$ && DefId_eq(a._0, b._0);
}

/** `Vec::dedup_by(same_bucket)`: removes consecutive elements `same_bucket` finds equal (keeps the first). */
function vec_dedup_by<T>(v: T[], same_bucket: (a: T, b: T) => boolean): void {
  let w = 0;
  for (let r = 0; r < v.length; r++) {
    if (w > 0 && same_bucket(v[r]!, v[w - 1]!)) continue;
    v[w++] = v[r]!;
  }
  v.length = w;
}

/** `str::trim_end` (Unicode `White_Space`). */
function string_trim_end(s: string): string {
  const cps = Array.from(s);
  let b = cps.length;
  while (b > 0 && is_whitespace(cps[b - 1]!.codePointAt(0)!)) b--;
  return cps.slice(0, b).join("");
}

/** `SortedMap::get_mut_or_insert_default` (rustc_data_structures sorted_map.rs) for a `Vec` value. */
function get_mut_or_insert_default<K, V>(map: SortedMap<K, V[]>, key: K): V[] {
  let v = map.get(key);
  if (v === undefined) {
    v = [];
    map.insert(key, v);
  }
  return v;
}

declare module "./suggest.gen.ts" {
  interface TraitBoundDuplicateTracker {
    track(def_id: DefId, is_ref: boolean): void;
    into_trait_def_ids(): Set<DefId>;
  }
  namespace TraitBoundDuplicateTracker {
    let new_: () => TraitBoundDuplicateTracker;
    export { new_ as new };
    /** PORT: `has_ref_dupes(&self)` is an associated fn: the field `has_ref_dupes` has the method's name. */
    export let has_ref_dupes: (self: TraitBoundDuplicateTracker) => boolean;
  }
}

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:64 new
(TraitBoundDuplicateTracker as unknown as { new: () => TraitBoundDuplicateTracker }).new = function (): TraitBoundDuplicateTracker {
  return new TraitBoundDuplicateTracker(new DefIdSet(), new DefIdSet(), new DefIdSet(), false);
};

/// Track a trait bound. `is_ref` indicates whether the self type is a reference.
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:74 track
TraitBoundDuplicateTracker.prototype.track = function (this: TraitBoundDuplicateTracker, def_id: DefId, is_ref: boolean): void {
  this.trait_def_ids.add(def_id);
  if (is_ref) {
    if (this.seen_non_ref.has(def_id)) {
      this.has_ref_dupes = true;
    }
    this.seen_ref.add(def_id);
  } else {
    if (this.seen_ref.has(def_id)) {
      this.has_ref_dupes = true;
    }
    this.seen_non_ref.add(def_id);
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:89 has_ref_dupes
(TraitBoundDuplicateTracker as unknown as { has_ref_dupes: (self: TraitBoundDuplicateTracker) => boolean }).has_ref_dupes = function (self: TraitBoundDuplicateTracker): boolean {
  return self.has_ref_dupes;
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:93 into_trait_def_ids
TraitBoundDuplicateTracker.prototype.into_trait_def_ids = function (this: TraitBoundDuplicateTracker): Set<DefId> {
  return this.trait_def_ids;
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:99 is_slice_ty
FnCtxt.prototype.is_slice_ty = function (this: FnCtxt, ty: Ty, span: Span): boolean {
  for (const [ty_] of this.autoderef(span, ty).silence_errors()) {
    const k = ty_.kind();
    if (k.$ === "Slice" || k.$ === "Array") return true;
  }
  return false;
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:105 impl_into_iterator_should_be_iterator
FnCtxt.prototype.impl_into_iterator_should_be_iterator = function (this: FnCtxt, ty: Ty, span: Span, unsatisfied_predicates: UnsatisfiedPredicates): boolean {
  // rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:111 predicate_bounds_generic_param
  function predicate_bounds_generic_param(predicate: Predicate, generics: Generics, generic_param: GenericParamDef, tcx: TyCtxt): boolean {
    const k = Binder.skip_binder(predicate.kind());
    if (k.$ === "Clause" && k._0.$ === "Trait") {
      const trait_pred = k._0._0;
      const args = trait_pred.trait_ref.args;
      if (args.length === 0) {
        return false;
      }
      const arg_ty = GenericArg.as_type(args[0]!);
      if (arg_ty === undefined) {
        return false;
      }
      const ak = arg_ty.kind();
      if (ak.$ !== "Param") {
        return false;
      }
      const param = ak._0;
      // Is `generic_param` the same as the arg for this trait predicate?
      return generic_param.index === generics.type_param(param, tcx).index;
    } else {
      return false;
    }
  }

  const is_iterator_predicate = (predicate: Predicate): boolean => {
    const k = Binder.skip_binder(predicate.kind());
    if (k.$ === "Clause" && k._0.$ === "Trait") {
      const trait_pred = k._0._0;
      return (
        this.tcx.is_diagnostic_item(sym.Iterator, trait_pred.trait_ref.def_id) &&
        // ignore unsatisfied predicates generated from trying to auto-ref ty (#127511)
        TraitRefC.self_ty(trait_pred.trait_ref) === ty
      );
    } else {
      return false;
    }
  };

  // Does the `ty` implement `IntoIterator`?
  const into_iterator_trait = this.tcx.get_diagnostic_item(sym.IntoIterator);
  if (into_iterator_trait === undefined) {
    return false;
  }
  const trait_ref = TraitRefC.new(as_interner(this.tcx), into_iterator_trait, [ty]);
  const obligation = Obligation.new(this.tcx, this.misc(span), this.param_env, trait_ref, (from, _interner) => Predicate_upcast_from_TraitRef(from, this.tcx));
  if (!this.predicate_must_hold_modulo_regions(obligation)) {
    return false;
  }

  const k = ty.peel_refs().kind();
  switch (k.$) {
    case "Param": {
      const param = k._0;
      const generics = this.tcx.generics_of(this.body_def_id) as Generics;
      const generic_param = generics.type_param(param, this.tcx);
      for (const unsatisfied of unsatisfied_predicates) {
        // The parameter implements `IntoIterator`
        // but it has called a method that requires it to implement `Iterator`
        if (predicate_bounds_generic_param(unsatisfied[0], generics, generic_param, this.tcx) && is_iterator_predicate(unsatisfied[0])) {
          return true;
        }
      }
      break;
    }
    case "Slice":
    case "Adt":
    case "Alias": {
      if (k.$ === "Alias" && k._1.kind.$ !== "Opaque") {
        return false;
      }
      for (const unsatisfied of unsatisfied_predicates) {
        if (is_iterator_predicate(unsatisfied[0])) {
          return true;
        }
      }
      break;
    }
    default:
      return false;
  }
  return false;
};

// Pick the iterator method to suggest: `.into_iter()` by default, and
// `.iter()`/`.iter_mut()` for projections through references.
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:193 preferred_iterator_method
FnCtxt.prototype.preferred_iterator_method = function (this: FnCtxt, source: SelfSource, rcvr_ty: Ty): Symbol | undefined {
  if (source.$ !== "MethodCall") {
    return sym.into_iter;
  }
  let rcvr_expr = source._0;

  rcvr_expr = rcvr_expr.peel_drop_temps().peel_blocks();
  const place_with_id = expr_place(this, rcvr_expr);
  if (place_with_id.$ !== "Ok") {
    return undefined;
  }

  let projection_mutability: Mutability | undefined = undefined;
  for (const pointer_ty of place_with_id._0.place.deref_tys()) {
    const k = this.structurally_resolve_type(rcvr_expr.span, pointer_ty).kind();
    if (k.$ === "Ref" && k._2 === "Not") {
      projection_mutability = "Not";
      break;
    } else if (k.$ === "Ref" && k._2 === "Mut") {
      projection_mutability ??= "Mut";
    } else if (k.$ === "RawPtr") {
      return undefined;
    }
  }

  // Keep `.into_iter()` for receivers like `&Vec<_>`; only projections that
  // dereference a reference need to switch to `iter`/`iter_mut`.
  if (projection_mutability === undefined) {
    return sym.into_iter;
  }

  const call_expr = this.tcx.hir_expect_expr(this.tcx.parent_hir_id(rcvr_expr.hir_id));
  // `IntoIterator` does not imply inherent `iter`/`iter_mut` methods.
  const has_method = (method_name: Symbol): boolean => {
    return this.lookup_probe_for_diagnostic(Ident.with_dummy_span(method_name), rcvr_ty, call_expr, ProbeScope.TraitsInScope, undefined).$ === "Ok";
  };

  switch (projection_mutability) {
    case "Not":
      return has_method(sym.iter) ? sym.iter : undefined;
    case "Mut": {
      if (has_method(sym.iter_mut)) {
        return sym.iter_mut;
      } else if (has_method(sym.iter)) {
        return sym.iter;
      } else {
        return undefined;
      }
    }
  }
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:256 report_method_error
FnCtxt.prototype.report_method_error = function (this: FnCtxt, call_id: HirId, rcvr_ty: Ty, error: MethodError, expected: ExpectationT, trait_missing_method: boolean): ErrorGuaranteed {
  // NOTE: Reporting a method error should also suppress any unused trait errors,
  // since the method error is very possibly the reason why the trait wasn't used.
  for (const c of this.tcx.in_scope_traits(call_id) ?? []) {
    for (const import_id of c.import_ids) {
      this.typeck_results.used_trait_imports.add(import_id);
    }
  }

  const [span, expr_span, source, item_name, args] = ((): [Span, Span, SelfSource, Ident, readonly hir.Expr[] | undefined] => {
    const node = this.tcx.hir_node(call_id);
    if (node.$ === "Expr" && node._0.kind.$ === "MethodCall") {
      const segment = node._0.kind._0;
      const rcvr = node._0.kind._1;
      const args = node._0.kind._2;
      const span = node._0.span;
      return [segment.ident.span, span, { $: "MethodCall", _0: rcvr }, segment.ident, args];
    }
    // `Expr { kind: Path(TypeRelative(rcvr, segment)), span }` | `PatExpr { kind: Path(TypeRelative(..)), span }` |
    // `Pat { kind: Struct(TypeRelative(..), ..) | TupleStruct(TypeRelative(..), ..), span }`
    let type_relative: [hir.Ty, hir.PathSegment, Span] | undefined;
    if (node.$ === "Expr" && node._0.kind.$ === "Path" && node._0.kind._0.$ === "TypeRelative") {
      type_relative = [node._0.kind._0._0, node._0.kind._0._1, node._0.span];
    } else if (node.$ === "PatExpr" && node._0.kind.$ === "Path" && node._0.kind._0.$ === "TypeRelative") {
      type_relative = [node._0.kind._0._0, node._0.kind._0._1, node._0.span];
    } else if (node.$ === "Pat" && (node._0.kind.$ === "Struct" || node._0.kind.$ === "TupleStruct") && node._0.kind._0.$ === "TypeRelative") {
      type_relative = [node._0.kind._0._0, node._0.kind._0._1, node._0.span];
    }
    if (type_relative === undefined) {
      return unreachable(`internal error: entered unreachable code: ${debug_Node(node, PLAIN)}`);
    }
    const [rcvr, segment, span] = type_relative;
    const parent = this.tcx.parent_hir_node(call_id);
    const args = parent.$ === "Expr" && parent._0.kind.$ === "Call" && HirId_eq(parent._0.kind._0.hir_id, call_id) ? parent._0.kind._1 : undefined;
    return [segment.ident.span, span, { $: "QPath", _0: rcvr }, segment.ident, args];
  })();

  // Try to get the span of the identifier within the expression's syntax context
  // (if that's different).
  const within_macro_span = SpanC.within_macro(span, expr_span, this.tcx.sess.source_map());

  // Avoid suggestions when we don't know what's going on.
  const reported = TypeVisitableExt.error_reported(rcvr_ty, fold_Ty);
  if (reported.$ === "Err") {
    return reported._0;
  }

  switch (error.$) {
    case "NoMatch": {
      const no_match_data = error._0;
      return this.report_no_match_method_error(span, rcvr_ty, item_name, call_id, source, args, expr_span, no_match_data, expected, trait_missing_method, within_macro_span);
    }

    case "Ambiguity": {
      const sources = error._0;
      const err = struct_span_code_err(this.dcx(), item_name.span, E0034, "multiple applicable items in scope");
      err.span_label(item_name.span, `multiple \`${display_Ident(item_name)}\` found`);
      if (within_macro_span !== undefined) {
        err.span_label(within_macro_span, "due to this macro variable");
      }

      this.note_candidates_on_method_error(rcvr_ty, item_name, source, args, span, err, sources, expr_span);
      return err.emit_err();
    }

    case "PrivateMatch": {
      const kind = this.tcx.def_kind_descr(error._0, error._1);
      const def_id = error._1;
      const out_of_scope_traits = error._2;
      const err = struct_span_code_err(this.dcx(), item_name.span, E0624, `${kind} \`${display_Ident(item_name)}\` is private`);
      err.span_label(item_name.span, `private ${kind}`);
      const sp = this.tcx.hir_span_if_local(def_id) ?? this.tcx.def_span(def_id);
      err.span_label(sp, `private ${kind} defined here`);
      if (within_macro_span !== undefined) {
        err.span_label(within_macro_span, "due to this macro variable");
      }
      this.suggest_valid_traits(err, item_name, out_of_scope_traits, true);
      this.suggest_unwrapping_inner_self(err, source, rcvr_ty, item_name);
      return err.emit_err();
    }

    case "IllegalSizedBound": {
      const { candidates, needs_mut, bound_span, self_expr } = error;
      const msg = needs_mut
        ? with_forced_trimmed_paths(() => `the \`${display_Ident(item_name)}\` method cannot be invoked on \`${display_Ty(rcvr_ty)}\``)
        : `the \`${display_Ident(item_name)}\` method cannot be invoked on a trait object`;
      const err = this.dcx().struct_span_err(span, msg);
      if (!needs_mut) {
        err.span_label(bound_span, "this has a `Sized` requirement");
      }
      if (within_macro_span !== undefined) {
        err.span_label(within_macro_span, "due to this macro variable");
      }
      if (candidates.length !== 0) {
        const an = candidates.length === 1 ? "an" : "";
        const s = pluralize(candidates.length);
        const were = pluralize("was", candidates.length);
        const help = `${an}other candidate${s} ${were} found in the following trait${s}`;
        this.suggest_use_candidates(candidates, (accessible_sugg, inaccessible_sugg, span) => {
          const suggest_for_access = (err: Diag, msg: string, sugg: string[]): void => {
            msg += `, perhaps add a \`use\` for ${sugg.length === 1 ? "it" : "one_of_them"}:`;
            err.span_suggestions(span, msg, sugg, "MaybeIncorrect");
          };
          const suggest_for_privacy = (err: Diag, msg: string, suggs: string[]): void => {
            if (suggs.length === 1) {
              const sugg = suggs[0]!;
              err.help(`trait \`${str_trim(sugg)}\` provides \`${display_Ident(item_name)}\` is implemented but not reachable`);
            } else {
              msg += ` but ${pluralize("is", suggs.length)} not reachable`;
              err.help(`${msg}:\n${string_trim_end(suggs.join(""))}`);
            }
          };
          if (accessible_sugg.length === 0) {
            // `inaccessible_sugg` must not be empty
            suggest_for_privacy(err, help, inaccessible_sugg);
          } else if (inaccessible_sugg.length === 0) {
            suggest_for_access(err, help, accessible_sugg);
          } else {
            suggest_for_access(err, help, accessible_sugg);
            suggest_for_privacy(err, help, inaccessible_sugg);
          }
        });
      }
      const rk = rcvr_ty.kind();
      if (rk.$ === "Ref") {
        const region = rk._0;
        const t_type = rk._1;
        const mutability = rk._2;
        if (needs_mut) {
          const trait_type = Ty.new_ref(this.tcx, region, t_type, Mutability.invert(mutability));
          const msg = `you need \`${display_Ty(trait_type)}\` instead of \`${display_Ty(rcvr_ty)}\``;
          let kind = self_expr.kind;
          for (;;) {
            if (kind.$ === "AddrOf") {
              kind = kind._2.kind;
            } else if (kind.$ === "Unary" && kind._0 === "Deref") {
              kind = kind._1.kind;
            } else {
              break;
            }
          }
          let inner_ty: hir.Ty | undefined;
          if (kind.$ === "Path" && kind._0.$ === "Resolved" && kind._0._0 === undefined) {
            const path = kind._0._1;
            const res = path.res;
            if (res.$ === "Local") {
              const hir_id = res._0;
              const b = this.tcx.hir_node(hir_id);
              if (b.$ === "Pat") {
                const p = this.tcx.parent_hir_node(b._0.hir_id);
                if (p.$ === "Param") {
                  const decl = hir_.Node.fn_decl(this.tcx.parent_hir_node(p._0.hir_id));
                  if (decl !== undefined) {
                    const ty = decl.inputs.find((ty) => ty.span === p._0.ty_span);
                    if (ty !== undefined && ty.kind.$ === "Ref" && ty.kind._2 === "Not") {
                      inner_ty = ty.kind._1;
                    }
                  }
                }
              }
            }
          }
          if (inner_ty !== undefined) {
            err.span_suggestion_verbose(SpanC.shrink_to_lo(inner_ty.span), msg, "mut ", "MachineApplicable");
          } else {
            err.help(msg);
          }
        }
      }
      return err.emit_err();
    }

    case "ErrorReported":
      return error._0;

    case "BadReturnType":
      return bug("no return type expectations but got BadReturnType");
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:481 create_missing_writer_err
FnCtxt.prototype.create_missing_writer_err = function (this: FnCtxt, rcvr_ty: Ty, rcvr_expr: hir.Expr, long_ty_path_: PathBuf | undefined): Diag {
  const long_ty_path: MutRef<PathBuf | undefined> = { value: long_ty_path_ };
  const err = struct_span_code_err(this.dcx(), rcvr_expr.span, E0599, `cannot write into \`${this.tcx.short_string(rcvr_ty, long_ty_path, print_Ty)}\``);
  err.long_ty_path().value = long_ty_path.value;
  err.span_note(rcvr_expr.span, "must implement `io::Write`, `fmt::Write`, or have a `write_fmt` method");
  if (rcvr_expr.kind.$ === "Lit") {
    err.span_help(SpanC.shrink_to_lo(rcvr_expr.span), "a writer is needed before this format string");
  }
  return err;
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:508 create_no_assoc_err
FnCtxt.prototype.create_no_assoc_err = function (
  this: FnCtxt,
  rcvr_ty: Ty,
  item_ident: Ident,
  item_kind: string,
  trait_missing_method: boolean,
  source: SelfSource,
  is_method: boolean,
  sugg_span: Span,
  unsatisfied_predicates: UnsatisfiedPredicates,
): Diag {
  // Don't show expanded generic arguments when the method can't be found in any
  // implementation (#81576).
  let ty = rcvr_ty;
  const span = item_ident.span;
  const rk = rcvr_ty.kind();
  if (rk.$ === "Adt") {
    const def = rk._0;
    const generics = rk._1;
    if (generics.length > 0) {
      const autoderef = this.autoderef(span, rcvr_ty).silence_errors();
      // `autoderef.any(..)`: stops at the first step the closure accepts.
      let candidate_found = false;
      for (const [ty_] of autoderef) {
        const k = ty_.kind();
        const found =
          k.$ === "Adt"
            ? this.tcx.inherent_impls(k._0.did()).some((def_id) => this.associated_value(def_id, item_ident) !== undefined)
            : false;
        if (found) {
          candidate_found = true;
          break;
        }
      }
      const has_deref = autoderef.step_count() > 0;
      if (!candidate_found && !has_deref && unsatisfied_predicates.length === 0) {
        ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity((this.tcx.at(span).type_of(def.did()) as EarlyBinder<Ty>)));
      }
    }
  }

  const err = this.dcx().create_err(
    NoAssociatedItem_diagnostic({
      span,
      item_kind,
      item_ident,
      ty_prefix: trait_missing_method
        ? // FIXME(mu001999) E0599 maybe not suitable here because it is for types
          "trait"
        : rcvr_ty.prefix_string(this.tcx),
      ty,
      trait_missing_method,
    }),
  );

  if (is_method) {
    this.suggest_use_shadowed_binding_with_method(source, item_ident, rcvr_ty, err);
  }

  const tcx = this.tcx;
  // Check if we wrote `Self::Assoc(1)` as if it were a tuple ctor.
  if (source.$ === "QPath" && source._0.kind.$ === "Path" && source._0.kind._0.$ === "Resolved") {
    const path = source._0.kind._0._1;
    const res = path.res;
    if (res.$ === "SelfTyAlias") {
      const impl_def_id = res.alias_to;
      if (this.tcx.def_kind(impl_def_id).$ === "Impl") {
        const candidate = AssocItems.find_by_ident_and_kind(tcx.associated_items(impl_def_id) as AssocItems, this.tcx, item_ident, "Type", impl_def_id);
        if (candidate !== undefined) {
          const adt_def = EarlyBinder.skip_binder(tcx.type_of(candidate.def_id) as EarlyBinder<Ty>).ty_adt_def();
          if (adt_def !== undefined && adt_def.is_struct() && adt_def.non_enum_variant().ctor_kind() === "Fn") {
            const def_path = tcx.def_path_str(adt_def.did());
            err.span_suggestion(sugg_span, `to construct a value of type \`${def_path}\`, use the explicit path`, def_path, "MachineApplicable");
          }
        }
      }
    }
  }

  return err;
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:590 suggest_use_shadowed_binding_with_method
FnCtxt.prototype.suggest_use_shadowed_binding_with_method = function (this: FnCtxt, self_source: SelfSource, method_name: Ident, ty: Ty, err: Diag): void {
  // #[derive(Debug)]
  interface LetStmt {
    ty_hir_id_opt: HirId | undefined;
    binding_id: HirId;
    span: Span;
    init_hir_id: HirId;
  }

  // Used for finding suggest binding.
  // ```rust
  // earlier binding for suggesting:
  // let y = vec![1, 2];
  // now binding:
  // if let Some(y) = x {
  //     y.push(y);
  // }
  // ```
  class LetVisitor extends Visitor<ControlFlow<null>> {
    // type Result = ControlFlow<()>;
    override Result = VisitorResult.ControlFlow<null>();

    constructor(
      // Error binding which don't have `method_name`.
      public binding_name: Symbol,
      public binding_id: HirId,
      // Used for check if the suggest binding has `method_name`.
      public fcx: FnCtxt,
      public call_expr: hir.Expr,
      public method_name: Ident,
      // Suggest the binding which is shallowed.
      public sugg_let: LetStmt | undefined,
    ) {
      super();
    }

    // Check scope of binding.
    // rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:628 is_sub_scope
    is_sub_scope(sub_id: ItemLocalId, super_id: ItemLocalId): boolean {
      const scope_tree = this.fcx.tcx.region_scope_tree(this.fcx.body_def_id);
      const sub_var_scope = scope_tree.var_scope(sub_id);
      if (sub_var_scope !== undefined) {
        const super_var_scope = scope_tree.var_scope(super_id);
        if (super_var_scope !== undefined && scope_tree.is_subscope_of(sub_var_scope, super_var_scope)) {
          return true;
        }
      }
      return false;
    }

    // Check if an earlier shadowed binding make `the receiver` of a MethodCall has the method.
    // If it does, record the earlier binding for subsequent notes.
    // rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:641 check_and_add_sugg_binding
    check_and_add_sugg_binding(binding: LetStmt): boolean {
      if (!this.is_sub_scope(this.binding_id.local_id, binding.binding_id.local_id)) {
        return false;
      }

      // Get the earlier shadowed binding'ty and use it to check the method.
      if (binding.ty_hir_id_opt !== undefined) {
        const tyck_ty = this.fcx.node_ty_opt(binding.ty_hir_id_opt);
        if (tyck_ty !== undefined) {
          if (this.fcx.lookup_probe_for_diagnostic(this.method_name, tyck_ty, this.call_expr, ProbeScope.TraitsInScope, undefined).$ === "Ok") {
            this.sugg_let = binding;
            return true;
          } else {
            return false;
          }
        }
      }

      // If the shadowed binding has an initializer expression,
      // use the initializer expression's ty to try to find the method again.
      // For example like:  `let mut x = Vec::new();`,
      // `Vec::new()` is the initializer expression.
      const self_ty = this.fcx.node_ty_opt(binding.init_hir_id);
      if (self_ty !== undefined && this.fcx.lookup_probe_for_diagnostic(this.method_name, self_ty, this.call_expr, ProbeScope.TraitsInScope, undefined).$ === "Ok") {
        this.sugg_let = binding;
        return true;
      }
      return false;
    }

    // impl<'v> Visitor<'v> for LetVisitor<'_, '_>
    // rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:693 visit_stmt
    override visit_stmt(ex: hir.Stmt): ControlFlow<null> {
      if (ex.kind.$ === "Let") {
        const { pat, ty, init } = ex.kind._0;
        if (pat.kind.$ === "Binding" && init !== undefined) {
          const binding_id = pat.kind._1;
          const binding_name = pat.kind._2;
          if (binding_name.name === this.binding_name && !HirId_eq(binding_id, this.binding_id)) {
            if (this.check_and_add_sugg_binding({ ty_hir_id_opt: ty?.hir_id, binding_id, span: pat.span, init_hir_id: init.hir_id })) {
              return ControlFlow.Break(null);
            }
            return ControlFlow.CONTINUE;
          }
        }
      }
      return walk_stmt(this, ex);
    }

    // Used for find the error binding.
    // When the visitor reaches this point, all the shadowed bindings
    // have been found, so the visitor ends.
    // rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:717 visit_pat
    override visit_pat(p: hir.Pat): ControlFlow<null> {
      if (p.kind.$ === "Binding") {
        const binding_id = p.kind._1;
        const binding_name = p.kind._2;
        if (binding_name.name === this.binding_name && HirId_eq(binding_id, this.binding_id)) {
          return ControlFlow.Break(null);
        }
      } else {
        walk_pat(this, p);
      }
      return ControlFlow.CONTINUE;
    }
  }

  if (self_source.$ === "MethodCall") {
    const rcvr = self_source._0;
    if (rcvr.kind.$ === "Path" && rcvr.kind._0.$ === "Resolved") {
      const path = rcvr.kind._0._1;
      const res = path.res;
      const segment = path.segments[0];
      if (res.$ === "Local" && segment !== undefined) {
        const recv_id = res._0;
        const body = this.tcx.hir_body_owned_by(this.body_def_id);

        const parent = this.tcx.parent_hir_node(rcvr.hir_id);
        if (parent.$ === "Expr") {
          const call_expr = parent._0;
          const let_visitor = new LetVisitor(segment.ident.name, recv_id, this, call_expr, method_name, undefined);
          let_visitor.visit_body(body);
          const sugg_let = let_visitor.sugg_let;
          const self_ty = sugg_let !== undefined ? this.node_ty_opt(sugg_let.init_hir_id) : undefined;
          if (sugg_let !== undefined && self_ty !== undefined) {
            const _sm = this.infcx.tcx.sess.source_map();
            const rcvr_name = segment.ident.name;
            const span = MultiSpan.from_span(sugg_let.span);
            span.push_span_label(
              sugg_let.span,
              `\`${Sym.as_str(rcvr_name)}\` of type \`${display_Ty(self_ty)}\` that has method \`${display_Ident(method_name)}\` defined earlier here`,
            );

            const ty_ = this.tcx.short_string(ty, err.long_ty_path(), print_Ty);
            span.push_span_label(this.tcx.hir_span(recv_id), `earlier \`${Sym.as_str(rcvr_name)}\` shadowed here with type \`${ty_}\``);
            err.span_note(
              span,
              `there's an earlier shadowed binding \`${Sym.as_str(rcvr_name)}\` of type \`${display_Ty(self_ty)}\` that has method \`${display_Ident(method_name)}\` available`,
            );
          }
        }
      }
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:775 suggest_method_call_annotation
FnCtxt.prototype.suggest_method_call_annotation = function (this: FnCtxt, err: Diag, span: Span, rcvr_ty: Ty, item_ident: Ident, mode: Mode, source: SelfSource, expected: ExpectationT): void {
  if (mode === "MethodCall" && source.$ === "MethodCall") {
    const cal = source._0;
    this.suggest_await_before_method(err, item_ident, rcvr_ty, cal, span, Expectation.only_has_type(expected, this));
  }

  this.suggest_on_pointer_type(err, source, rcvr_ty, item_ident);

  if (source.$ === "MethodCall") {
    const rcvr_expr = source._0;
    this.suggest_fn_call(err, rcvr_expr, rcvr_ty, (output_ty) => {
      const call_expr = this.tcx.hir_expect_expr(this.tcx.parent_hir_id(rcvr_expr.hir_id));
      const probe = this.lookup_probe_for_diagnostic(item_ident, output_ty, call_expr, ProbeScope.AllTraits, Expectation.only_has_type(expected, this));
      return probe.$ === "Ok";
    });
    this.note_internal_mutation_in_method(err, rcvr_expr, Expectation.to_option(expected, this), rcvr_ty);
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:821 suggest_static_method_candidates
FnCtxt.prototype.suggest_static_method_candidates = function (
  this: FnCtxt,
  err: Diag,
  span: Span,
  rcvr_ty: Ty,
  item_ident: Ident,
  source: SelfSource,
  args: readonly hir.Expr[] | undefined,
  sugg_span: Span,
  no_match_data: NoMatchData,
): CandidateSource[] {
  const static_candidates = no_match_data.static_candidates.map(clone_CandidateSource);

  // `static_candidates` may have same candidates appended by
  // inherent and extension, which may result in incorrect
  // diagnostic.
  vec_dedup_by(static_candidates, CandidateSource_eq);

  if (static_candidates.length !== 0) {
    err.note("found the following associated functions; to be used as methods, functions must have a `self` parameter");
    err.span_label(span, "this is an associated function, not a method");
  }
  if (static_candidates.length === 1) {
    this.suggest_associated_call_syntax(err, static_candidates, rcvr_ty, source, item_ident, args, sugg_span);
    this.note_candidates_on_method_error(rcvr_ty, item_ident, source, args, span, err, static_candidates, undefined);
  } else if (static_candidates.length > 1) {
    this.note_candidates_on_method_error(rcvr_ty, item_ident, source, args, span, err, static_candidates, sugg_span);
  }
  return static_candidates;
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:881 suggest_unsatisfied_ty_or_trait
FnCtxt_suggest_a_prototype.suggest_unsatisfied_ty_or_trait = function (
  this: FnCtxt,
  err: Diag,
  span: Span,
  rcvr_ty: Ty,
  item_ident: Ident,
  item_kind: string,
  source: SelfSource,
  unsatisfied_predicates: UnsatisfiedPredicates,
  static_candidates: readonly CandidateSource[],
): Result<[boolean, boolean, boolean, boolean, SortedMap<OrdSpan, string[]>], null> {
  const restrict_type_params: MutRef<boolean> = { value: false };
  const suggested_derive: MutRef<boolean> = { value: false };
  const unsatisfied_bounds: MutRef<boolean> = { value: false };
  const custom_span_label: MutRef<boolean> = { value: static_candidates.length !== 0 };
  const bound_spans: SortedMap<OrdSpan, string[]> = SortedMap.default((a, b) => a.cmp(b));
  const tcx = this.tcx;

  const rk = rcvr_ty.kind();
  // `else if matches!(..) && let ty::Adt(adt_def, args) = .. && .. && let inner_ty = args.type_at(0) && ..`
  const option_by_value = ((): boolean => {
    if (!["cloned", "copied"].includes(Sym.as_str(item_ident.name))) return false;
    if (rk.$ !== "Adt") return false;
    if (!tcx.is_diagnostic_item(sym.Option, rk._0.did())) return false;
    const inner_ty = rk._1.type_at(0);
    // Skip refs (`Option<&T>.into_iter().cloned()` is valid, let the default branch
    // handle it), and params/infer where we can't statically rule out a reference.
    const ik = inner_ty.kind();
    return !(ik.$ === "Ref" || ik.$ === "Param" || ik.$ === "Infer");
  });
  if (item_ident.name === sym.count && this.is_slice_ty(rcvr_ty, span)) {
    const msg = "consider using `len` instead";
    if (source.$ === "MethodCall") {
      err.span_suggestion_short(span, msg, "len", "MachineApplicable");
    } else {
      err.span_label(span, msg);
    }
    const iterator_trait = this.tcx.get_diagnostic_item(sym.Iterator);
    if (iterator_trait !== undefined) {
      const iterator_trait_ = this.tcx.def_path_str(iterator_trait);
      err.note(`\`count\` is defined on \`${iterator_trait_}\`, which \`${display_Ty(rcvr_ty)}\` does not implement`);
    }
  } else if (option_by_value()) {
    // The default branch below would suggest `.into_iter()`, but that still
    // fails: `Option<T>` yields `T` by value, not `&T`, so `.cloned()`/`.copied()`
    // can't resolve. Give a targeted diagnostic instead.
    err.span_label(span, "this method is only available on `Option<&_>`");
    if (source.$ === "MethodCall" && !SpanC.in_external_macro(span, tcx.sess.source_map())) {
      const rcvr_expr = source._0;
      const call_expr = this.tcx.hir_expect_expr(this.tcx.parent_hir_id(rcvr_expr.hir_id));
      err.span_suggestion(
        SpanC.to(SpanC.shrink_to_hi(rcvr_expr.span), SpanC.shrink_to_hi(call_expr.span)),
        `consider removing the \`.${Sym.as_str(item_ident.name)}()\` call`,
        "",
        "MaybeIncorrect",
      );
    }
    return Err(null);
  } else if (this.impl_into_iterator_should_be_iterator(rcvr_ty, span, unsatisfied_predicates)) {
    err.span_label(span, `\`${display_Ty(rcvr_ty)}\` is not an iterator`);
    if (!SpanC.in_external_macro(span, this.tcx.sess.source_map())) {
      const method_name = this.preferred_iterator_method(source, rcvr_ty);
      if (method_name !== undefined) {
        err.multipart_suggestion(`call \`.${Sym.as_str(method_name)}()\` first`, [[SpanC.shrink_to_lo(span), `${Sym.as_str(method_name)}().`]], "MaybeIncorrect");
      }
    }
    // Report to emit the diagnostic
    return Err(null);
  } else if (unsatisfied_predicates.length !== 0) {
    if (rk.$ === "Param") {
      // We special case the situation where we are looking for `_` in
      // `<TypeParam as _>::method` because otherwise the machinery will look for blanket
      // implementations that have unsatisfied trait bounds to suggest, leading us to claim
      // things like "we're looking for a trait with method `cmp`, both `Iterator` and `Ord`
      // have one, in order to implement `Ord` you need to restrict `TypeParam: FnPtr` so
      // that `impl<T: FnPtr> Ord for T` can apply", which is not what we want. We have a type
      // parameter, we want to directly say "`Ord::cmp` and `Iterator::cmp` exist, restrict
      // `TypeParam: Ord` or `TypeParam: Iterator`"". That is done further down when calling
      // `self.suggest_traits_to_import`, so we ignore the `unsatisfied_predicates`
      // suggestions.
    } else {
      suggest_a(this).handle_unsatisfied_predicates(
        err,
        rcvr_ty,
        item_ident,
        item_kind,
        span,
        unsatisfied_predicates,
        restrict_type_params,
        suggested_derive,
        unsatisfied_bounds,
        custom_span_label,
        bound_spans,
      );
    }
  } else if (rk.$ === "Adt" && source.$ === "MethodCall") {
    const def = rk._0;
    const targs = rk._1;
    const rcvr_expr = source._0;
    // This is useful for methods on arbitrary self types that might have a simple
    // mutability difference, like calling a method on `Pin<&mut Self>` that is on
    // `Pin<&Self>`.
    if (targs.length === 1) {
      const item_segment = hir_.PathSegment.invalid();
      item_segment.ident = item_ident;
      for (const t of [Ty.new_mut_ref, Ty.new_imm_ref, (_: TyCtxt, _r: Region, t: Ty): Ty => t]) {
        const new_args = tcx.mk_args_from_iter(
          targs.map((arg) => {
            const ty = GenericArg.as_type(arg);
            return ty !== undefined ? t(tcx, tcx.lifetimes.re_erased, ty.peel_refs()) : arg;
          }),
        );
        const rcvr_ty = Ty.new_adt(tcx, def, new_args);
        const method = this.lookup_method_for_diagnostic(rcvr_ty, item_segment, span, hir_.Node.expect_expr(tcx.parent_hir_node(rcvr_expr.hir_id)), rcvr_expr);
        if (method.$ === "Ok") {
          err.span_note(tcx.def_span(method._0.def_id), `${item_kind} is available for \`${display_Ty(rcvr_ty)}\``);
        }
      }
    }
  }
  return Ok([restrict_type_params.value, suggested_derive.value, unsatisfied_bounds.value, custom_span_label.value, bound_spans]);
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:1021 suggest_surround_method_call
FnCtxt.prototype.suggest_surround_method_call = function (this: FnCtxt, err: Diag, span: Span, rcvr_ty: Ty, item_ident: Ident, source: SelfSource, similar_candidate: AssocItem | undefined): boolean {
  switch (source.$) {
    // If the method name is the name of a field with a function or closure type,
    // give a helping note that it has to be called as `(x.f)(...)`.
    case "MethodCall": {
      const expr = source._0;
      return !this.suggest_calling_field_as_fn(span, rcvr_ty, expr, item_ident, err) && similar_candidate === undefined;
    }
    default:
      return true;
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:1041 find_possible_candidates_for_method
FnCtxt.prototype.find_possible_candidates_for_method = function (
  this: FnCtxt,
  err: Diag,
  span: Span,
  rcvr_ty: Ty,
  item_ident: Ident,
  item_kind: string,
  mode: Mode,
  source: SelfSource,
  no_match_data: NoMatchData,
  expected: ExpectationT,
  should_label_not_found: boolean,
  custom_span_label: boolean,
): void {
  const find_candidate_for_method: MutRef<boolean> = { value: false };
  const unsatisfied_predicates = no_match_data.unsatisfied_predicates;

  if (should_label_not_found && !custom_span_label) {
    suggest_a(this).set_not_found_span_label(err, rcvr_ty, item_ident, item_kind, mode, source, span, unsatisfied_predicates, find_candidate_for_method);
  }
  if (!find_candidate_for_method.value) {
    this.lookup_segments_chain_for_no_match_method(err, item_ident, item_kind, source, no_match_data);
  }

  // Don't suggest (for example) `expr.field.clone()` if `expr.clone()`
  // can't be called due to `typeof(expr): Clone` not holding.
  if (unsatisfied_predicates.length === 0) {
    this.suggest_calling_method_on_field(err, source, span, rcvr_ty, item_ident, Expectation.only_has_type(expected, this));
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:1095 suggest_confusable_or_similarly_named_method
FnCtxt.prototype.suggest_confusable_or_similarly_named_method = function (
  this: FnCtxt,
  err: Diag,
  span: Span,
  rcvr_ty: Ty,
  item_ident: Ident,
  mode: Mode,
  args: readonly hir.Expr[] | undefined,
  unsatisfied_predicates: UnsatisfiedPredicates,
  similar_candidate: AssocItem | undefined,
): void {
  const confusable_suggested = this.confusable_method_name(
    err,
    rcvr_ty,
    item_ident,
    args?.map((expr) => this.node_ty_opt(expr.hir_id) ?? this.next_ty_var(expr.span)),
  );
  if (similar_candidate !== undefined) {
    // Don't emit a suggestion if we found an actual method
    // that had unsatisfied trait bounds
    if (
      unsatisfied_predicates.length === 0 &&
      // ...or if we already suggested that name because of `rustc_confusable` annotation
      AssocItemC.name(similar_candidate) !== confusable_suggested &&
      // and if we aren't in an expansion.
      !SpanC.from_expansion(span)
    ) {
      this.find_likely_intended_associated_item(err, similar_candidate, span, args, mode);
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:1132 suggest_method_not_found_because_of_unsatisfied_bounds
FnCtxt_suggest_a_prototype.suggest_method_not_found_because_of_unsatisfied_bounds = function (
  this: FnCtxt,
  err: Diag,
  rcvr_ty: Ty,
  item_ident: Ident,
  item_kind: string,
  bound_spans: SortedMap<OrdSpan, string[]>,
  unsatisfied_predicates: UnsatisfiedPredicates,
): void {
  const rk = rcvr_ty.kind();
  let ty_span: Span | undefined =
    rk.$ === "Param"
      ? ParamTy.span_from_generics(rk._0, this.tcx, LocalDefId.to_def_id(this.body_def_id))
      : rk.$ === "Adt" && rk._0.did().is_local()
        ? this.tcx.def_span(rk._0.did())
        : undefined;
  const rcvr_ty_str = this.tcx.short_string(rcvr_ty, err.long_ty_path(), print_Ty);
  const tracker = TraitBoundDuplicateTracker.new();
  for (const [predicate, _parent_pred, _cause] of unsatisfied_predicates) {
    const k = Binder.skip_binder(predicate.kind());
    if (k.$ === "Clause" && k._0.$ === "Trait") {
      const pred = k._0._0;
      const self_ty = TraitRefC.self_ty(pred.trait_ref);
      if (self_ty.peel_refs() === rcvr_ty) {
        const is_ref = self_ty.kind().$ === "Ref";
        tracker.track(pred.trait_ref.def_id, is_ref);
      }
    }
  }
  const has_ref_dupes = TraitBoundDuplicateTracker.has_ref_dupes(tracker);
  const missing_trait_names = [...tracker.into_trait_def_ids()].map((def_id) => `\`${this.tcx.def_path_str(def_id)}\``);
  missing_trait_names.sort(cmp_String);
  const should_condense = has_ref_dupes && missing_trait_names.length > 1 && rk.$ === "Adt";
  let missing_trait_list: string | undefined;
  if (should_condense) {
    const n = missing_trait_names.length;
    if (n === 1) {
      missing_trait_list = missing_trait_names[0]!;
    } else if (n === 2) {
      missing_trait_list = `${missing_trait_names[0]!} or ${missing_trait_names[1]!}`;
    } else if (n > 2) {
      missing_trait_list = `${missing_trait_names.slice(0, -1).join(", ")} or ${missing_trait_names[n - 1]!}`;
    } else {
      missing_trait_list = "";
    }
  } else {
    missing_trait_list = undefined;
  }
  for (const [span_, bounds_] of bound_spans.iter()) {
    const span = span_._0;
    const bounds = [...bounds_];
    if (!this.tcx.sess.source_map().is_span_accessible(span)) {
      continue;
    }
    bounds.sort(cmp_String);
    vec_dedup_by(bounds, (a, b) => a === b);
    const is_ty_span = span === ty_span;
    if (is_ty_span && should_condense) {
      ty_span = undefined;
      const label =
        missing_trait_list !== undefined
          ? `${item_kind} \`${display_Ident(item_ident)}\` not found for this ${rcvr_ty.prefix_string(this.tcx)} because \`${rcvr_ty_str}\` doesn't implement ${missing_trait_list}`
          : `${item_kind} \`${display_Ident(item_ident)}\` not found for this ${rcvr_ty.prefix_string(this.tcx)}`;
      err.span_label(span, label);
      continue;
    }
    let pre: string;
    if (is_ty_span) {
      ty_span = undefined;
      pre = `${item_kind} \`${display_Ident(item_ident)}\` not found for this ${rcvr_ty.prefix_string(this.tcx)} because it `;
    } else {
      pre = "";
    }
    let msg: string;
    if (bounds.length === 1) {
      msg = `${pre}doesn't satisfy ${bounds[0]!}`;
    } else if (bounds.length > 4) {
      msg = `doesn't satisfy ${bounds.length} bounds`;
    } else if (bounds.length > 0) {
      const last = bounds[bounds.length - 1]!;
      msg = `${pre}doesn't satisfy ${bounds.slice(0, -1).join(", ")} or ${last}`;
    } else {
      return unreachable();
    }
    err.span_label(span, msg);
  }
  if (ty_span !== undefined) {
    err.span_label(ty_span, `${item_kind} \`${display_Ident(item_ident)}\` not found for this ${rcvr_ty.prefix_string(this.tcx)}`);
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:1233 report_no_match_method_error
FnCtxt.prototype.report_no_match_method_error = function (
  this: FnCtxt,
  span: Span,
  rcvr_ty_: Ty,
  item_ident: Ident,
  expr_id: HirId,
  source: SelfSource,
  args: readonly hir.Expr[] | undefined,
  sugg_span: Span,
  no_match_data: NoMatchData,
  expected: ExpectationT,
  trait_missing_method: boolean,
  within_macro_span: Span | undefined,
): ErrorGuaranteed {
  const tcx = this.tcx;
  const rcvr_ty = this.deeply_resolve_ignoring_regions(rcvr_ty_, fold_Ty);

  const reported = TypeVisitableExt.error_reported(rcvr_ty, fold_Ty);
  if (reported.$ === "Err") {
    return reported._0;
  }

  // We could pass the file for long types into these two, but it isn't strictly necessary
  // given how targeted they are.
  const range_end = this.report_failed_method_call_on_range_end(tcx, rcvr_ty, source, span, item_ident);
  if (range_end.$ === "Err") {
    return range_end._0;
  }

  // PORT: `let mut ty_file = None;`, passed as `&mut ty_file` below; decls.ts declares that parameter by value (the callee
  // only writes it on its error path, which returns), so `ty_file` stays `None` here.
  const ty_file: PathBuf | undefined = undefined;
  const mode = no_match_data.mode;
  const is_method = mode === "MethodCall";
  const item_kind = is_method ? "method" : rcvr_ty.is_enum() || rcvr_ty.is_fresh_ty() ? "variant, associated function, or constant" : "associated function or constant";

  const numerical = this.report_failed_method_call_on_numerical_infer_var(tcx, rcvr_ty, source, span, item_kind, item_ident, ty_file);
  if (numerical.$ === "Err") {
    return numerical._0;
  }

  const unsatisfied_predicates = no_match_data.unsatisfied_predicates;
  const macro_def_id = SyntaxContext.outer_expn_data(SpanC.ctxt(sugg_span)).macro_def_id;
  const is_write =
    macro_def_id !== undefined &&
    (tcx.is_diagnostic_item(sym.write_macro, macro_def_id) || tcx.is_diagnostic_item(sym.writeln_macro, macro_def_id)) &&
    item_ident.name === sym.write_fmt;
  const err =
    is_write && source.$ === "MethodCall"
      ? this.create_missing_writer_err(rcvr_ty, source._0, ty_file)
      : this.create_no_assoc_err(rcvr_ty, item_ident, item_kind, trait_missing_method, source, is_method, sugg_span, unsatisfied_predicates);
  if (source.$ === "MethodCall") {
    const rcvr_expr = source._0;
    this.err_ctxt().note_field_shadowed_by_private_candidate(err, rcvr_expr.hir_id, this.param_env);
  }

  this.set_label_for_method_error(err, source, rcvr_ty, item_ident, expr_id, item_ident.span, sugg_span, within_macro_span, args);

  this.suggest_method_call_annotation(err, item_ident.span, rcvr_ty, item_ident, mode, source, expected);

  const static_candidates = this.suggest_static_method_candidates(err, item_ident.span, rcvr_ty, item_ident, source, args, sugg_span, no_match_data);

  const r = suggest_a(this).suggest_unsatisfied_ty_or_trait(err, item_ident.span, rcvr_ty, item_ident, item_kind, source, unsatisfied_predicates, static_candidates);
  if (r.$ !== "Ok") {
    return err.emit_err();
  }
  const [restrict_type_params, suggested_derive, unsatisfied_bounds, custom_span_label, bound_spans] = r._0;

  const similar_candidate = no_match_data.similar_candidate;
  const should_label_not_found = this.suggest_surround_method_call(err, item_ident.span, rcvr_ty, item_ident, source, similar_candidate);

  this.find_possible_candidates_for_method(err, item_ident.span, rcvr_ty, item_ident, item_kind, mode, source, no_match_data, expected, should_label_not_found, custom_span_label);

  this.suggest_unwrapping_inner_self(err, source, rcvr_ty, item_ident);

  if ((rcvr_ty.is_numeric() && rcvr_ty.is_fresh()) || restrict_type_params || suggested_derive) {
    // skip suggesting traits to import
  } else {
    this.suggest_traits_to_import(
      err,
      item_ident.span,
      rcvr_ty,
      item_ident,
      args !== undefined ? args.length + 1 : undefined,
      source,
      [...no_match_data.out_of_scope_traits],
      static_candidates,
      unsatisfied_bounds,
      Expectation.only_has_type(expected, this),
      trait_missing_method,
    );
  }

  this.suggest_enum_variant_for_method_call(err, rcvr_ty, item_ident, item_ident.span, source, unsatisfied_predicates);

  this.suggest_confusable_or_similarly_named_method(err, item_ident.span, rcvr_ty, item_ident, mode, args, unsatisfied_predicates, similar_candidate);

  suggest_a(this).suggest_method_not_found_because_of_unsatisfied_bounds(err, rcvr_ty, item_ident, item_kind, bound_spans, unsatisfied_predicates);

  this.note_derefed_ty_has_method(err, source, rcvr_ty, item_ident, expected);
  this.suggest_bounds_for_range_to_method(err, source, item_ident);
  return err.emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:1443 set_not_found_span_label
FnCtxt_suggest_a_prototype.set_not_found_span_label = function (
  this: FnCtxt,
  err: Diag,
  rcvr_ty: Ty,
  item_ident: Ident,
  item_kind: string,
  mode: Mode,
  source: SelfSource,
  span: Span,
  unsatisfied_predicates: UnsatisfiedPredicates,
  find_candidate_for_method: MutRef<boolean>,
): void {
  const ty_str = this.tcx.short_string(rcvr_ty, err.long_ty_path(), print_Ty);
  if (unsatisfied_predicates.length === 0) {
    err.span_label(span, `${item_kind} not found in \`${ty_str}\``);
    const rk = rcvr_ty.kind();
    let is_string_or_ref_str: boolean;
    if (rk.$ === "Ref") {
      const ty = rk._1;
      const tk = ty.kind();
      is_string_or_ref_str = ty.is_str() || (tk.$ === "Adt" && this.tcx.is_lang_item(tk._0.did(), LangItem.String));
    } else if (rk.$ === "Adt") {
      is_string_or_ref_str = this.tcx.is_lang_item(rk._0.did(), LangItem.String);
    } else {
      is_string_or_ref_str = false;
    }
    if (is_string_or_ref_str && item_ident.name === sym.iter) {
      err.span_suggestion_verbose(
        item_ident.span,
        "because of the in-memory representation of `&str`, to obtain an `Iterator` over each of its codepoint use method `chars`",
        "chars",
        "MachineApplicable",
      );
    }
    if (rk.$ === "Adt") {
      const adt = rk._0;
      const inherent_impls_candidate = [...this.tcx.inherent_impls(adt.did())].filter((def_id) => {
        const assoc = this.associated_value(def_id, item_ident);
        if (assoc !== undefined) {
          // Check for both mode is the same so we avoid suggesting
          // incorrect associated item.
          if (mode === "MethodCall" && AssocItemC.is_method(assoc) && source.$ === "MethodCall") {
            // We check that the suggest type is actually
            // different from the received one
            // So we avoid suggestion method with Box<Self>
            // for instance
            return Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity((this.tcx.at(span).type_of(def_id) as EarlyBinder<Ty>))) !== rcvr_ty;
          } else if (mode === "Path" && !AssocItemC.is_method(assoc)) {
            return true;
          } else {
            return false;
          }
        } else {
          return false;
        }
      });
      // `sort_by_key(|&id| self.tcx.def_path_str(id))` (stable; the key is computed per comparison).
      inherent_impls_candidate.sort((a, b) => cmp_String(this.tcx.def_path_str(a), this.tcx.def_path_str(b)));
      vec_dedup_by(inherent_impls_candidate, DefId_eq);
      let msg: StringPart[];
      if (inherent_impls_candidate.length === 0) {
        return;
      } else if (inherent_impls_candidate.length === 1) {
        const only = inherent_impls_candidate[0]!;
        msg = [
          StringPart.normal(`the ${item_kind} was found for \``),
          StringPart.highlighted(display_Ty(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity((this.tcx.at(span).type_of(only) as EarlyBinder<Ty>))))),
          StringPart.normal("`"),
        ];
      } else {
        const candidates = inherent_impls_candidate;
        // number of types to show at most
        const limit = candidates.length === 5 ? 5 : 4;
        const type_candidates = candidates
          .slice(0, limit)
          .map((impl_item) => `- \`${display_Ty(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity((this.tcx.at(span).type_of(impl_item) as EarlyBinder<Ty>))))}\``)
          .join("\n");
        const additional_types = candidates.length > limit ? `\nand ${candidates.length - limit} more types` : "";
        msg = [StringPart.normal(`the ${item_kind} was found for\n${type_candidates}${additional_types}`)];
      }
      err.highlighted_note(msg);
      find_candidate_for_method.value = mode === "MethodCall";
    }
  } else {
    const ty_str_ = utf8_len(ty_str) > 50 ? "" : `on \`${ty_str}\` `;
    err.span_label(span, `${item_kind} cannot be called ${ty_str_}due to unsatisfied trait bounds`);
  }
};

/// Suggest similar enum variant when method call fails
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:1568 suggest_enum_variant_for_method_call
FnCtxt.prototype.suggest_enum_variant_for_method_call = function (this: FnCtxt, err: Diag, rcvr_ty: Ty, item_ident: Ident, span: Span, source: SelfSource, unsatisfied_predicates: UnsatisfiedPredicates): void {
  // Don't emit a suggestion if we found an actual method that had unsatisfied trait bounds
  if (unsatisfied_predicates.length !== 0 || !rcvr_ty.is_enum()) {
    return;
  }

  const tcx = this.tcx;
  const adt_def = unwrap(rcvr_ty.ty_adt_def(), "enum is not an ADT");
  const var_name = find_best_match_for_name(
    adt_def.variants().map((s) => s.name),
    item_ident.name,
    undefined,
  );
  const variant = var_name !== undefined ? adt_def.variants().find((s) => s.name === var_name) : undefined;
  if (var_name !== undefined && variant !== undefined) {
    let suggestion: [Span, string][] = [[span, Sym.as_str(var_name)]];
    // `if let SelfSource::QPath(ty) = source && let Node::Expr(path_expr) = parent(ty) && let ExprKind::Path(_) = ..
    //   && let Node::Stmt(Stmt { kind: StmtKind::Semi(parent), .. }) | Node::Expr(parent) = parent(path_expr)`
    const path_expr_node = source.$ === "QPath" ? tcx.parent_hir_node(source._0.hir_id) : undefined;
    const path_expr = path_expr_node !== undefined && path_expr_node.$ === "Expr" && path_expr_node._0.kind.$ === "Path" ? path_expr_node._0 : undefined;
    const parent_node = path_expr !== undefined ? tcx.parent_hir_node(path_expr.hir_id) : undefined;
    const parent =
      parent_node === undefined
        ? undefined
        : parent_node.$ === "Stmt" && parent_node._0.kind.$ === "Semi"
          ? parent_node._0.kind._0
          : parent_node.$ === "Expr"
            ? parent_node._0
            : undefined;
    if (path_expr !== undefined && parent !== undefined) {
      // We want to replace the parts that need to go, like `()` and `{}`.
      const pk = parent.kind;
      const replacement_span =
        pk.$ === "Call" && HirId_eq(pk._0.hir_id, path_expr.hir_id)
          ? SpanC.with_hi(span, SpanC.hi(parent.span))
          : pk.$ === "Struct"
            ? SpanC.with_hi(span, SpanC.hi(parent.span))
            : span;
      const ctor = variant.ctor;
      if (ctor === undefined && pk.$ === "Struct") {
        // We want a struct and we have a struct. We won't suggest changing
        // the fields (at least for now).
        suggestion = [[span, Sym.as_str(var_name)]];
      } else if (ctor === undefined) {
        // struct
        suggestion = [
          [
            replacement_span,
            variant.fields.length === 0
              ? `${Sym.as_str(var_name)} {}`
              : `${Sym.as_str(var_name)} { ${variant.fields.map((f) => `${Sym.as_str(f.name)}: /* value */`).join(", ")} }`,
          ],
        ];
      } else if (ctor[0] === "Const") {
        // unit, remove the `()`.
        suggestion = [[replacement_span, Sym.as_str(var_name)]];
      } else if (pk.$ === "Call") {
        // `(Some((CtorKind::Fn, def_id)), ExprKind::Call(rcvr, args))`
        const def_id = ctor[1];
        const rcvr = pk._0;
        const args = pk._1;
        const fn_sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(def_id) as EarlyBinder<PolyFnSigT>));
        const inputs = Binder.skip_binder(PolyFnSig.inputs(fn_sig));
        // FIXME: reuse the logic for "change args" suggestion to account for types
        // involved and detect things like substitution.
        if (args.length === 0) {
          // Add arguments.
          suggestion.push([SpanC.with_hi(SpanC.shrink_to_hi(rcvr.span), SpanC.hi(parent.span)), `(${inputs.map((i) => `/* ${display_Ty(i)} */`).join(", ")})`]);
        } else if (args.length === 1 && inputs.length !== args.length) {
          const arg = args[0]!;
          // Replace arguments.
          suggestion.push([arg.span, inputs.map((i) => `/* ${display_Ty(i)} */`).join(", ")]);
        } else if (args.length >= 2 && inputs.length !== args.length) {
          const arg_start = args[0]!;
          const arg_end = args[args.length - 1]!;
          // Replace arguments.
          suggestion.push([SpanC.to(arg_start.span, arg_end.span), inputs.map((i) => `/* ${display_Ty(i)} */`).join(", ")]);
        } else {
          // Argument count is the same, keep as is.
        }
      } else {
        // `(Some((CtorKind::Fn, def_id)), _)`
        const def_id = ctor[1];
        const fn_sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(def_id) as EarlyBinder<PolyFnSigT>));
        const inputs = Binder.skip_binder(PolyFnSig.inputs(fn_sig));
        suggestion = [[replacement_span, `${Sym.as_str(var_name)}(${inputs.map((i) => `/* ${display_Ty(i)} */`).join(", ")})`]];
      }
    }
    err.multipart_suggestion("there is a variant with a similar name", suggestion, "HasPlaceholders");
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:1705 handle_unsatisfied_predicates
FnCtxt_suggest_a_prototype.handle_unsatisfied_predicates = function (
  this: FnCtxt,
  err: Diag,
  rcvr_ty: Ty,
  item_ident: Ident,
  item_kind: string,
  span: Span,
  unsatisfied_predicates: UnsatisfiedPredicates,
  restrict_type_params: MutRef<boolean>,
  suggested_derive: MutRef<boolean>,
  unsatisfied_bounds: MutRef<boolean>,
  custom_span_label: MutRef<boolean>,
  bound_spans: SortedMap<OrdSpan, string[]>,
): void {
  const tcx = this.tcx;
  const rcvr_ty_str = this.tcx.short_string(rcvr_ty, err.long_ty_path(), print_Ty);
  // `FxIndexMap<(Span, &str), UnordSet<String>>`
  const type_params = new KeyedMap<[Span, string], Set<string>>((k) => `${k[0]}:${k[1]}`);

  // Pick out the list of unimplemented traits on the receiver.
  // This is used for custom error messages with the `#[rustc_on_unimplemented]` attribute.
  const unimplemented_traits = new DefIdMap<[PolyTraitClauseT, PredicateObligation]>();

  let unimplemented_traits_only = true;
  for (const [predicate, _parent_pred, cause] of unsatisfied_predicates) {
    const k = Binder.skip_binder(predicate.kind());
    if (k.$ === "Clause" && k._0.$ === "Trait" && cause !== undefined) {
      const p = k._0._0;
      if (TraitRefC.self_ty(p.trait_ref) !== rcvr_ty) {
        // This is necessary, not just to keep the errors clean, but also
        // because our derived obligations can wind up with a trait ref that
        // requires a different param_env to be correctly compared.
        continue;
      }
      if (!unimplemented_traits.has(p.trait_ref.def_id)) {
        unimplemented_traits.set(p.trait_ref.def_id, [Binder.rebind(predicate.kind(), p), new Obligation(clone_ObligationCause(cause), this.param_env, predicate, 0)]);
      }
    }
  }

  // Make sure that, if any traits other than the found ones were involved,
  // we don't report an unimplemented trait.
  // We don't want to say that `iter::Cloned` is not an iterator, just
  // because of some non-Clone item being iterated over.
  for (const [predicate, _parent_pred, _cause] of unsatisfied_predicates) {
    const k = Binder.skip_binder(predicate.kind());
    if (k.$ === "Clause" && k._0.$ === "Trait" && unimplemented_traits.has(k._0._0.trait_ref.def_id)) {
      // {}
    } else {
      unimplemented_traits_only = false;
      break;
    }
  }

  const collect_type_param_suggestions = (self_ty: Ty, parent_pred: Predicate, obligation: string): boolean => {
    // We don't care about regions here, so it's fine to skip the binder here.
    const pk = Binder.skip_binder(parent_pred.kind());
    if (self_ty.kind().$ === "Param" && pk.$ === "Clause" && pk._0.$ === "Trait") {
      const p = pk._0._0;
      const sk = TraitRefC.self_ty(p.trait_ref).kind();
      let node: hir.Node | undefined;
      if (sk.$ === "Param") {
        // Account for `fn` items like in `issue-35677.rs` to
        // suggest restricting its type params.
        node = this.tcx.hir_node_by_def_id(this.body_def_id);
      } else if (sk.$ === "Adt") {
        const def_id = sk._0.did().as_local();
        node = def_id !== undefined ? this.tcx.hir_node_by_def_id(def_id) : undefined;
      } else {
        node = undefined;
      }
      if (node !== undefined && node.$ === "Item") {
        const g = hir_.ItemKind.generics(node._0.kind);
        if (g !== undefined) {
          const key: [Span, string] = [g.tail_span_for_predicate_suggestion(), g.add_where_or_trailing_comma()];
          let set = type_params.get(key);
          if (set === undefined) {
            set = new Set();
            type_params.set(key, set);
          }
          set.add(obligation);
          return true;
        }
      }
    }
    return false;
  };
  const bound_span_label = (self_ty: Ty, obligation: string, quiet: string): void => {
    const msg = `\`${utf8_len(obligation) > 50 ? quiet : obligation}\``;
    const sk = self_ty.kind();
    switch (sk.$) {
      // Point at the type that couldn't satisfy the bound.
      case "Adt":
        get_mut_or_insert_default(bound_spans, new OrdSpan(tcx.def_span(sk._0.did()))).push(msg);
        break;
      // Point at the trait object that couldn't satisfy the bound.
      case "Dynamic": {
        const preds = sk._0;
        for (const pred of preds) {
          const ep = Binder.skip_binder(pred);
          switch (ep.$) {
            case "Trait": {
              const tr = ep._0;
              get_mut_or_insert_default(bound_spans, new OrdSpan(tcx.def_span(tr.def_id))).push(msg);
              break;
            }
            case "Projection":
            case "AutoTrait":
              break;
          }
        }
        break;
      }
      // Point at the closure that couldn't satisfy the bound.
      case "Closure": {
        const def_id = sk._0;
        get_mut_or_insert_default(bound_spans, new OrdSpan(tcx.def_span(def_id))).push(`\`${quiet}\``);
        break;
      }
      default:
        break;
    }
  };

  const format_pred = (pred: Predicate): [string, Ty] | undefined => {
    const bound_predicate = pred.kind();
    const k = Binder.skip_binder(bound_predicate);
    if (k.$ === "Clause" && k._0.$ === "Projection") {
      const pred = Binder.rebind(bound_predicate, k._0._0);
      // `<Foo as Iterator>::Item = String`.
      const projection_term = Binder.skip_binder(pred).projection_term;
      if (!AliasTermKind.is_trait_projection(projection_term.kind)) {
        return undefined;
      }

      const quiet_projection_term = AliasTerm.with_replaced_self_ty(projection_term, tcx, Ty.new_var(tcx, TyVid.ZERO));

      const term = Binder.skip_binder(pred).term;

      const obligation = `${display_AliasTerm(projection_term)} = ${display_Term(term)}`;
      const quiet = with_forced_trimmed_paths(() => `${display_AliasTerm(quiet_projection_term)} = ${display_Term(term)}`);

      bound_span_label(AliasTerm.self_ty(projection_term), obligation, quiet);
      return [obligation, AliasTerm.self_ty(projection_term)];
    } else if (k.$ === "Clause" && k._0.$ === "Trait") {
      const poly_trait_ref = k._0._0;
      const p = poly_trait_ref.trait_ref;
      const self_ty = TraitRefC.self_ty(p);
      const path = TraitRef_print_only_trait_path(p);
      const obligation = `${display_Ty(self_ty)}: ${display_TraitRefPrintOnlyTraitPath(path)}`;
      const quiet = with_forced_trimmed_paths(() => `_: ${display_TraitRefPrintOnlyTraitPath(path)}`);
      bound_span_label(self_ty, obligation, quiet);
      return [obligation, self_ty];
    } else {
      return undefined;
    }
  };

  // Find all the requirements that come from a local `impl` block.
  const skip_list = new Set<Predicate>();
  // `FxIndexMap<Span, (FxIndexSet<Span>, FxIndexSet<(Span, String)>, Vec<&Predicate>)>`
  const spanned_predicates = new Map<Span, [Set<Span>, KeyedSet<[Span, string]>, Predicate[]]>();
  const new_entry = (): [Set<Span>, KeyedSet<[Span, string]>, Predicate[]] => [new Set(), new KeyedSet<[Span, string]>((k) => `${k[0]}:${k[1]}`), []];
  const entry_or_insert_with = (key: Span): [Set<Span>, KeyedSet<[Span, string]>, Predicate[]] => {
    let e = spanned_predicates.get(key);
    if (e === undefined) {
      e = new_entry();
      spanned_predicates.set(key, e);
    }
    return e;
  };
  let manually_impl = false;
  for (const [p, parent_p, cause] of unsatisfied_predicates) {
    // Extract the predicate span and parent def id of the cause,
    // if we have one.
    const code = cause?.code_();
    let item_def_id: DefId;
    let cause_span: Span;
    let cause_msg: string;
    if (code !== undefined && code.$ === "ImplDerived") {
      const data = code._0;
      const dk = this.tcx.def_kind(data.impl_or_alias_def_id);
      const msg =
        dk.$ === "Impl" && dk.of_trait
          ? `type parameter would need to implement \`${Sym.as_str(this.tcx.item_name(this.tcx.impl_trait_id(data.impl_or_alias_def_id)))}\``
          : `unsatisfied bound \`${display_Predicate(p)}\` introduced here`;
      [item_def_id, cause_span, cause_msg] = [data.impl_or_alias_def_id, data.span, msg];
    } else if (code !== undefined && (code.$ === "WhereClauseInExpr" || code.$ === "WhereClause") && !SpanC.is_dummy(code._1)) {
      [item_def_id, cause_span, cause_msg] = [code._0, code._1, `unsatisfied bound \`${display_Predicate(p)}\` introduced here`];
    } else {
      continue;
    }

    // Don't point out the span of `WellFormed` predicates.
    const pk = Binder.skip_binder(p.kind());
    if (!(pk.$ === "Clause" && (pk._0.$ === "Projection" || pk._0.$ === "Trait"))) {
      continue;
    }

    const node = this.tcx.hir_get_if_local(item_def_id);
    const item = node !== undefined && node.$ === "Item" ? node._0 : undefined;
    const is_derive = (span: Span): boolean => {
      const kind = SyntaxContext.outer_expn_data(SpanC.ctxt(span)).kind;
      return kind.$ === "Macro" && kind._0 === "Derive";
    };
    if (
      item !== undefined &&
      item.kind.$ === "Impl" &&
      (is_derive(item.kind._0.self_ty.span) || (item.kind._0.of_trait !== undefined && is_derive(item.kind._0.of_trait.trait_ref.path.span)))
    ) {
      // Unmet obligation comes from a `derive` macro, point at it once to
      // avoid multiple span labels pointing at the same place.
      const self_ty = item.kind._0.self_ty;
      const span = SyntaxContext.outer_expn_data(SpanC.ctxt(self_ty.span)).call_site;
      const entry = entry_or_insert_with(span);
      entry[0].add(cause_span);
      entry[1].add([cause_span, cause_msg]);
      entry[2].push(p);
      skip_list.add(p);
      manually_impl = true;
    } else if (item !== undefined && item.kind.$ === "Impl") {
      // Unmet obligation coming from an `impl`.
      const { of_trait, self_ty, generics } = item.kind._0;
      const item_span = item.span;
      const sized_pred = unsatisfied_predicates.some(([pred, _, _c]) => {
        const k = Binder.skip_binder(pred.kind());
        if (k.$ === "Clause" && k._0.$ === "Trait") {
          const pred = k._0._0;
          return this.tcx.is_lang_item(TraitClause.def_id(pred), LangItem.Sized) && pred.polarity === "Positive";
        } else {
          return false;
        }
      });
      for (const param of generics.params) {
        if (param.span === cause_span && sized_pred) {
          const [sp, sugg] = param.colon_span !== undefined ? [SpanC.shrink_to_hi(param.colon_span), " ?Sized +"] : [SpanC.shrink_to_hi(param.span), ": ?Sized"];
          err.span_suggestion_verbose(sp, "consider relaxing the type parameter's implicit `Sized` bound", sugg, "MachineApplicable");
        }
      }
      if (parent_p !== undefined) {
        // Done to add the "doesn't satisfy" `span_label`.
        format_pred(parent_p);
      }
      skip_list.add(p);
      const entry = entry_or_insert_with(self_ty.span);
      entry[2].push(p);
      if (cause_span !== item_span) {
        entry[0].add(cause_span);
        entry[1].add([cause_span, "unsatisfied trait bound introduced here"]);
      } else {
        if (of_trait !== undefined) {
          entry[0].add(of_trait.trait_ref.path.span);
        }
        entry[0].add(self_ty.span);
      }
      if (of_trait !== undefined) {
        entry[1].add([of_trait.trait_ref.path.span, ""]);
      }
      entry[1].add([self_ty.span, ""]);
    } else if (item !== undefined && item.kind.$ === "Trait" && item.kind.is_auto === "Yes") {
      const item_span = item.span;
      this.dcx().span_delayed_bug(item_span, "auto trait is invoked with no method error, but no error reported?");
    } else {
      // `Node::Item(Item { kind: ItemKind::Trait { ident, .. } | ItemKind::TraitAlias(_, ident, ..), .. })`
      // | `Node::TraitItem(TraitItem { ident, .. })` | `Node::ImplItem(ImplItem { ident, .. })`
      // We may also encounter unsatisfied GAT or method bounds
      let ident: Ident | undefined;
      if (item !== undefined && item.kind.$ === "Trait") {
        ident = item.kind.ident;
      } else if (item !== undefined && item.kind.$ === "TraitAlias") {
        ident = item.kind._1;
      } else if (node !== undefined && node.$ === "TraitItem") {
        ident = node._0.ident;
      } else if (node !== undefined && node.$ === "ImplItem") {
        ident = node._0.ident;
      }
      if (ident !== undefined) {
        skip_list.add(p);
        const entry = entry_or_insert_with(ident.span);
        entry[0].add(cause_span);
        entry[1].add([ident.span, ""]);
        entry[1].add([cause_span, "unsatisfied trait bound introduced here"]);
        entry[2].push(p);
      } else {
        // It's possible to use well-formedness clauses to get obligations
        // which point arbitrary items like ADTs, so there's no use in ICEing
        // here if we find that the obligation originates from some other
        // node that we don't handle.
      }
    }
  }
  const spanned_predicates_ = [...spanned_predicates];
  // `sort_by_key(|(span, _)| span.lo_hi())` (stable)
  spanned_predicates_.sort((a, b) => {
    const [a_lo, a_hi] = SpanC.lo_hi(a[0]);
    const [b_lo, b_hi] = SpanC.lo_hi(b[0]);
    return a_lo !== b_lo ? (a_lo < b_lo ? -1 : 1) : a_hi !== b_hi ? (a_hi < b_hi ? -1 : 1) : 0;
  });
  for (const [, [primary_spans, span_labels, predicates]] of spanned_predicates_) {
    const tracker = TraitBoundDuplicateTracker.new();
    let all_trait_bounds_for_rcvr = true;
    for (const pred of predicates) {
      const k = Binder.skip_binder(pred.kind());
      if (k.$ === "Clause" && k._0.$ === "Trait") {
        const pred = k._0._0;
        const self_ty = TraitRefC.self_ty(pred.trait_ref);
        if (self_ty.peel_refs() !== rcvr_ty) {
          all_trait_bounds_for_rcvr = false;
          break;
        }
        const is_ref = self_ty.kind().$ === "Ref";
        tracker.track(pred.trait_ref.def_id, is_ref);
      } else {
        all_trait_bounds_for_rcvr = false;
        break;
      }
    }
    const has_ref_dupes = TraitBoundDuplicateTracker.has_ref_dupes(tracker);
    const trait_def_ids = tracker.into_trait_def_ids();
    const preds: string[] = [];
    for (const pred of predicates) {
      const r = format_pred(pred);
      if (r !== undefined) preds.push(`\`${r[0]}\``);
    }
    preds.sort(cmp_String);
    vec_dedup_by(preds, (a, b) => a === b);
    let availability_note: string | undefined;
    if (all_trait_bounds_for_rcvr && has_ref_dupes && trait_def_ids.size > 1 && rcvr_ty.kind().$ === "Adt") {
      const trait_names = [...trait_def_ids].map((def_id) => `\`${tcx.def_path_str(def_id)}\``);
      trait_names.sort(cmp_String);
      const traits = listify(trait_names, (name) => name);
      availability_note = traits !== undefined ? `for \`${display_Ident(item_ident)}\` to be available, \`${rcvr_ty_str}\` must implement ${traits}` : undefined;
    } else {
      availability_note = undefined;
    }
    let msg: string;
    if (availability_note !== undefined) {
      msg = availability_note;
    } else if (preds.length === 1) {
      msg = `trait bound ${preds[0]!} was not satisfied`;
    } else {
      msg = `the following trait bounds were not satisfied:\n${preds.join("\n")}`;
    }
    const span = MultiSpan.from_spans([...primary_spans]);
    for (const [sp, label] of span_labels) {
      span.push_span_label(sp, label);
    }
    err.span_note(span, msg);
    unsatisfied_bounds.value = true;
  }

  const suggested_bounds = new Set<Predicate>();
  // The requirements that didn't have an `impl` span to show.
  const bound_list_: [string, Predicate][] = [];
  for (const [pred, parent_pred, _cause] of unsatisfied_predicates) {
    let suggested = false;
    const r = format_pred(pred);
    if (r === undefined) continue;
    const [p, self_ty] = r;
    if (parent_pred !== undefined && suggested_bounds.has(parent_pred)) {
      // We don't suggest `PartialEq` when we already suggest `Eq`.
    } else if (!suggested_bounds.has(pred) && collect_type_param_suggestions(self_ty, pred, p)) {
      suggested = true;
      suggested_bounds.add(pred);
    }
    let s: string;
    if (parent_pred === undefined) {
      s = `\`${p}\``;
    } else {
      const parent_r = format_pred(parent_pred);
      if (parent_r === undefined) {
        s = `\`${p}\``;
      } else {
        const [parent_p] = parent_r;
        if (!suggested && !suggested_bounds.has(pred) && !suggested_bounds.has(parent_pred) && collect_type_param_suggestions(self_ty, parent_pred, p)) {
          suggested_bounds.add(pred);
        }
        s = `\`${p}\`\nwhich is required by \`${parent_p}\``;
      }
    }
    bound_list_.push([s, pred]);
  }
  const bound_list: [number, string][] = bound_list_
    .filter(([, pred]) => !skip_list.has(pred))
    .map(([t]) => t)
    .map((t, i): [number, string] => [i, t]);

  if (rcvr_ty.peel_refs().kind().$ !== "Param") {
    for (const [[span, add_where_or_comma], obligations_] of type_params) {
      restrict_type_params.value = true;
      // #74886: Sort here so that the output is always the same.
      const obligations = [...obligations_].sort(cmp_String);
      const s = pluralize(obligations.length);
      err.span_suggestion_verbose(
        span,
        `consider restricting the type parameter${s} to satisfy the trait bound${s}`,
        `${add_where_or_comma} ${obligations.join(", ")}`,
        "MaybeIncorrect",
      );
    }
  }

  bound_list.sort((a, b) => cmp_String(a[1], b[1])); // Sort alphabetically.
  vec_dedup_by(bound_list, (a, b) => a[1] === b[1]); // #35677
  bound_list.sort((a, b) => a[0] - b[0]); // Keep the original predicate order.

  if (bound_list.length !== 0 || skip_list.size !== 0) {
    const bound_list_str = bound_list.map(([, path]) => path).join("\n");
    const actual_prefix = rcvr_ty.prefix_string(this.tcx);
    // info!("unimplemented_traits.len() == {}", unimplemented_traits.len());
    let primary_message: string | undefined;
    let label: string | undefined;
    let notes: string[];
    if (unimplemented_traits.size === 1 && unimplemented_traits_only) {
      [primary_message, label, notes] = ((): [string | undefined, string | undefined, string[]] => {
        const [trait_ref, obligation] = unwrap(unimplemented_traits.values().next().value);
        if (TypeVisitableExt.references_error(PolyTraitClause.self_ty(trait_ref), fold_Binder(fold_Ty)) || TypeVisitableExt.references_error(rcvr_ty, fold_Ty)) {
          // Avoid crashing.
          return [undefined, undefined, []];
        }
        const { message, label, notes } = this.err_ctxt().on_unimplemented_note(trait_ref, obligation, err.long_ty_path());
        return [message, label, notes];
      })();
    } else {
      [primary_message, label, notes] = [undefined, undefined, []];
    }
    const primary_message_ =
      primary_message ??
      ((): string => {
        const ty_str = this.tcx.short_string(rcvr_ty, err.long_ty_path(), print_Ty);
        return `the ${item_kind} \`${display_Ident(item_ident)}\` exists for ${actual_prefix} \`${ty_str}\`, but its trait bounds were not satisfied`;
      })();
    err.primary_message(primary_message_);
    if (label !== undefined) {
      custom_span_label.value = true;
      err.span_label(span, label);
    }
    if (bound_list.length !== 0) {
      err.note(`the following trait bounds were not satisfied:\n${bound_list_str}`);
    }
    for (const note of notes) {
      err.note(note);
    }

    const rk = rcvr_ty.kind();
    if (rk.$ === "Adt") {
      const adt_def = rk._0;
      unsatisfied_predicates.find(([pred, _parent, _cause]) => {
        const k = Binder.skip_binder(pred.kind());
        if (k.$ === "Clause" && k._0.$ === "Trait") {
          return this.suggest_hashmap_on_unsatisfied_hashset_buildhasher(err, k._0._0, adt_def);
        } else {
          return false;
        }
      });
    }

    suggested_derive.value = this.suggest_derive(err, unsatisfied_predicates);
    unsatisfied_bounds.value = true;
  }
  if (manually_impl) {
    err.help("consider manually implementing the trait to avoid undesired bounds");
  }
};

/// If an appropriate error source is not found, check method chain for possible candidates
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:2227 lookup_segments_chain_for_no_match_method
FnCtxt.prototype.lookup_segments_chain_for_no_match_method = function (this: FnCtxt, err: Diag, item_name: Ident, item_kind: string, source: SelfSource, no_match_data: NoMatchData): void {
  if (no_match_data.unsatisfied_predicates.length === 0 && no_match_data.mode === "MethodCall" && source.$ === "MethodCall") {
    let source_expr = source._0;
    const stack_methods: Ty[] = [];
    while (source_expr.kind.$ === "MethodCall") {
      const rcvr_expr = source_expr.kind._1;
      const method_span = source_expr.kind._3;
      // Pop the matching receiver, to align on it's notional span
      const prev_match = stack_methods.pop();
      if (prev_match !== undefined) {
        err.span_label(method_span, `${item_kind} \`${display_Ident(item_name)}\` is available on \`${display_Ty(prev_match)}\``);
      }
      // `.unwrap_or(Ty::new_misc_error(self.tcx))`: the default is evaluated eagerly.
      const misc_error = Ty.new_misc_error(this.tcx);
      const rcvr_ty = this.deeply_resolve_ignoring_regions(this.typeck_results.expr_ty_adjusted_opt(rcvr_expr) ?? misc_error, fold_Ty);

      const candidates = this.probe_for_name_many("MethodCall", item_name, undefined, { _0: true }, rcvr_ty, source_expr.hir_id, ProbeScope.TraitsInScope);
      if (candidates.$ !== "Ok") {
        return;
      }

      // FIXME: `probe_for_name_many` searches for methods in inherent implementations,
      // so it may return a candidate that doesn't belong to this `revr_ty`. We need to
      // check whether the instantiated type matches the received one.
      for (const _matched_method of candidates._0) {
        // found a match, push to stack
        stack_methods.push(rcvr_ty);
      }
      source_expr = rcvr_expr;
    }
    // If there is a match at the start of the chain, add a label for it too!
    const prev_match = stack_methods.pop();
    if (prev_match !== undefined) {
      err.span_label(source_expr.span, `${item_kind} \`${display_Ident(item_name)}\` is available on \`${display_Ty(prev_match)}\``);
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:2288 find_likely_intended_associated_item
FnCtxt.prototype.find_likely_intended_associated_item = function (this: FnCtxt, err: Diag, similar_candidate: AssocItem, span: Span, args: readonly hir.Expr[] | undefined, mode: Mode): void {
  const tcx = this.tcx;
  const def_kind = AssocItemC.as_def_kind(similar_candidate);
  const an = this.tcx.def_kind_descr_article(def_kind, similar_candidate.def_id);
  const similar_candidate_name = AssocItemC.name(similar_candidate);
  const msg = `there is ${an} ${this.tcx.def_kind_descr(def_kind, similar_candidate.def_id)} \`${Sym.as_str(similar_candidate_name)}\` with a similar name`;
  // Methods are defined within the context of a struct and their first parameter
  // is always `self`, which represents the instance of the struct the method is
  // being called on Associated functions don’t take self as a parameter and they are
  // not methods because they don’t have an instance of the struct to work with.
  if (def_kind.$ === "AssocFn") {
    const ty_args = this.infcx.fresh_args_for_item(span, similar_candidate.def_id);
    const fn_sig_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.fn_sig(similar_candidate.def_id) as EarlyBinder<PolyFnSigT>, tcx, ty_args, fold_Binder(fold_FnSig)));
    const fn_sig = this.instantiate_binder_with_fresh_vars(span, BoundRegionConversionTime.FnCall, fn_sig_, fold_FnSig);
    if (AssocItemC.is_method(similar_candidate)) {
      if (args !== undefined && FnSig.inputs(fn_sig).slice(1).length === args.length) {
        // We found a method with the same number of arguments as the method
        // call expression the user wrote.
        err.span_suggestion_verbose(span, msg, Sym.as_str(similar_candidate_name), "MaybeIncorrect");
      } else {
        // We found a method but either the expression is not a method call or
        // the argument count didn't match.
        err.span_help(tcx.def_span(similar_candidate.def_id), `${msg}${args === undefined ? "" : ", but with different arguments"}`);
      }
    } else if (args !== undefined && FnSig.inputs(fn_sig).length === args.length) {
      // We have fn call expression and the argument count match the associated
      // function we found.
      err.span_suggestion_verbose(span, msg, Sym.as_str(similar_candidate_name), "MaybeIncorrect");
    } else {
      err.span_help(tcx.def_span(similar_candidate.def_id), msg);
    }
  } else if (mode === "Path" && (args ?? []).length === 0) {
    // We have an associated item syntax and we found something that isn't an fn.
    err.span_suggestion_verbose(span, msg, Sym.as_str(similar_candidate_name), "MaybeIncorrect");
  } else {
    // The expression is a function or method call, but the item we found is an
    // associated const or type.
    err.span_help(tcx.def_span(similar_candidate.def_id), msg);
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:2372 confusable_method_name
FnCtxt.prototype.confusable_method_name = function (this: FnCtxt, err: Diag, rcvr_ty: Ty, item_name: Ident, call_args: Ty[] | undefined): Symbol | undefined {
  const rk = rcvr_ty.kind();
  if (rk.$ === "Adt") {
    const adt = rk._0;
    const adt_args = rk._1;
    for (const inherent_impl_did of this.tcx.inherent_impls(adt.did())) {
      for (const inherent_method of AssocItems.in_definition_order(this.tcx.associated_items(inherent_impl_did) as AssocItems)) {
        const confusables = find_attr(HasAttrs_DefId.get_attrs(inherent_method.def_id, this.tcx), (k) => (k.$ === "RustcConfusables" ? k.confusables : undefined));
        if (confusables !== undefined && confusables.includes(item_name.name) && AssocItemC.is_fn(inherent_method)) {
          const args = RawList.identity_for_item(this.tcx, inherent_method.def_id).rebase_onto(this.tcx, AssocItemC.container_id(inherent_method, this.tcx), adt_args);
          const fn_sig_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(this.tcx.fn_sig(inherent_method.def_id) as EarlyBinder<PolyFnSigT>, this.tcx, args, fold_Binder(fold_FnSig)));
          const fn_sig = this.instantiate_binder_with_fresh_vars(item_name.span, BoundRegionConversionTime.FnCall, fn_sig_, fold_FnSig);
          const name = AssocItemC.name(inherent_method);
          const inputs = FnSig.inputs(fn_sig);
          const expected_inputs = AssocItemC.is_method(inherent_method) ? inputs.slice(1) : inputs;
          if (
            call_args !== undefined &&
            // `Iterator::eq_by`
            expected_inputs.length === call_args.length &&
            expected_inputs.every((expected, i) => this.may_coerce(expected, call_args[i]!))
          ) {
            err.span_suggestion_verbose(item_name.span, `you might have meant to use \`${Sym.as_str(name)}\``, Sym.as_str(name), "MaybeIncorrect");
            return name;
          } else if (call_args === undefined) {
            err.span_note(this.tcx.def_span(inherent_method.def_id), `you might have meant to use method \`${Sym.as_str(name)}\``);
            return name;
          }
        }
      }
    }
  }
  return undefined;
};

// ==== lane typeck-suggest-b: method/suggest.rs:2433.. ====
unported_methods(FnCtxt.prototype, "rustc_hir_typeck::method::suggest::FnCtxt", ["note_candidates_on_method_error", "find_builder_fn", "suggest_associated_call_syntax", "suggest_calling_field_as_fn", "report_failed_method_call_on_range_end", "report_failed_method_call_on_numerical_infer_var", "suggest_assoc_method_call", "suggest_calling_method_on_field", "suggest_unwrapping_inner_self", "note_unmet_impls_on_type", "consider_suggesting_derives_for_ty", "note_predicate_source_and_get_derives", "suggest_derive", "note_derefed_ty_has_method", "suggest_bounds_for_range_to_method", "ty_to_value_string", "suggest_await_before_method", "set_label_for_method_error", "suggest_on_pointer_type", "suggest_use_candidates", "suggest_valid_traits", "suggest_traits_to_import", "detect_and_explain_multiple_crate_versions_of_trait_item", "suggest_else_fn_with_closure", "type_derefs_to_local", "suggest_hashmap_on_unsatisfied_hashset_buildhasher"]);


// method/suggest.rs:4962 (stub; final signature: decls.ts `Fns_method_suggest`)
export function all_traits(tcx: TyCtxt): TraitInfo[] {
  return unported("rustc_hir_typeck::method::suggest::all_traits");
}

// method/suggest.rs:4966 (stub; final signature: decls.ts `Fns_method_suggest`)
export function print_disambiguation_help(tcx: TyCtxt, err: Diag, source: SelfSource, args: readonly hir.Expr[] | undefined, trait_ref: TraitRef, candidate_idx: number | undefined, span: Span, item: AssocItem): string | undefined {
  return unported("rustc_hir_typeck::method::suggest::print_disambiguation_help");
}
