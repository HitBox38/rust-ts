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
import { AssocItem } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Span } from "../../rustc_span/lib.ts";
import { TraitRef } from "../../rustc_type_ir/predicate.ts";
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
import { Region } from "../../rustc_type_ir/sty/mod.ts";
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
import { Ident, sym, Symbol as Sym, display_Ident, Symbol } from "../../rustc_span/symbol.ts";
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
//   out-parameters are `MutRef<boolean>` cells.
// - `FxIndexMap` / `FxIndexSet` are insertion-ordered `Map` / `Set` (`DefIdMap` / `DefIdSet` for `DefId` keys, `KeyedMap` /
//   `KeyedSet` for tuple keys); `UnordSet` is a `Set` whose users only test membership or sort.
// - `Vec<String>::sort()` / `dedup()` compare strings by `str_cmp` (UTF-8 byte order, as `String: Ord`).

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
FnCtxt.prototype.suggest_unsatisfied_ty_or_trait = function (
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
      this.handle_unsatisfied_predicates(
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
    this.set_not_found_span_label(err, rcvr_ty, item_ident, item_kind, mode, source, span, unsatisfied_predicates, find_candidate_for_method);
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
FnCtxt.prototype.suggest_method_not_found_because_of_unsatisfied_bounds = function (
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

  const ty_file: MutRef<PathBuf | undefined> = { value: undefined };
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
      ? this.create_missing_writer_err(rcvr_ty, source._0, ty_file.value)
      : this.create_no_assoc_err(rcvr_ty, item_ident, item_kind, trait_missing_method, source, is_method, sugg_span, unsatisfied_predicates);
  if (source.$ === "MethodCall") {
    const rcvr_expr = source._0;
    this.err_ctxt().note_field_shadowed_by_private_candidate(err, rcvr_expr.hir_id, this.param_env);
  }

  this.set_label_for_method_error(err, source, rcvr_ty, item_ident, expr_id, item_ident.span, sugg_span, within_macro_span, args);

  this.suggest_method_call_annotation(err, item_ident.span, rcvr_ty, item_ident, mode, source, expected);

  const static_candidates = this.suggest_static_method_candidates(err, item_ident.span, rcvr_ty, item_ident, source, args, sugg_span, no_match_data);

  const r = this.suggest_unsatisfied_ty_or_trait(err, item_ident.span, rcvr_ty, item_ident, item_kind, source, unsatisfied_predicates, static_candidates);
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

  this.suggest_method_not_found_because_of_unsatisfied_bounds(err, rcvr_ty, item_ident, item_kind, bound_spans, unsatisfied_predicates);

  this.note_derefed_ty_has_method(err, source, rcvr_ty, item_ident, expected);
  this.suggest_bounds_for_range_to_method(err, source, item_ident);
  return err.emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:1443 set_not_found_span_label
FnCtxt.prototype.set_not_found_span_label = function (
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
FnCtxt.prototype.handle_unsatisfied_predicates = function (
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


// ==== lane typeck-suggest-b: method/suggest.rs:2433..5035 (note_candidates_on_method_error .. print_disambiguation_help) ====
// The imports of this region are kept separate from typeck-suggest-a's (on merge: drop names both blocks import).
import { ControlFlow as ControlFlowC, VisitorResult as VisitorResultC } from "../../rustc_ast_ir/visit.ts";
import { type Stability, StabilityLevel } from "../../rustc_attr_ir/stability.ts";
import { type Applicability, E0689, StashKey } from "../../rustc_errors/lib.ts";
import { Res } from "../../rustc_hir/def.ts";
import { GenericBound, ImplicitSelfKind, is_range_literal, ParamName } from "../../rustc_hir/hir.ts";
import { EvaluationResult } from "../../rustc_middle/traits/select.ts";
import type { ModChild, ResolverGlobalCtxt } from "../../rustc_middle/middle/resolve.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import { IsSuggestable } from "../../rustc_middle/ty/diagnostics.ts";
import { SimplifiedType_key } from "../../rustc_middle/ty/fast_reject.ts";
import { fold_GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { type FieldDef, type ImplTraitHeader, type VariantDef, Visibility } from "../../rustc_middle/ty/mod.ts";
import {
  display_GenericArg,
  display_ParamTy,
  display_TraitRefPrintOnlyTraitName,
  display_TraitRefPrintSugared,
  TraitRef_print_only_trait_name,
  TraitRef_print_trait_sugared,
  with_crate_prefix,
  with_no_visible_paths_if_doc_hidden,
} from "../../rustc_middle/ty/print/pretty.ts";
import { type BytePos, DUMMY_SP } from "../../rustc_span/lib.ts";
import { display_Symbol, kw } from "../../rustc_span/symbol.ts";
import { supertraits } from "../../rustc_type_ir/elaborate.ts";
import { DeepRejectCtxt, simplify_type } from "../../rustc_type_ir/fast_reject.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { display_TraitRef } from "../../rustc_type_ir/ir_print.ts";
import { fold_with_TraitClause, fold_with_TraitRef, PolyExistentialTraitRef, PolyTraitRef, try_fold_with_TraitClause, try_fold_with_TraitRef, visit_with_TraitClause, visit_with_TraitRef } from "../../rustc_type_ir/predicate.ts";
import { type PredicateKind, visit_with_PredicateKind } from "../../rustc_type_ir/predicate_kind.gen.ts";
import type { TypeVisitable } from "../../rustc_type_ir/visit.ts";
import { ToTrace_Ty } from "../../rustc_infer/infer/at.ts";
import { unwrap_result } from "../../std/result.ts";
import { type Str, utf8_width } from "../../std/str.ts";
import type { FulfillmentError } from "../../rustc_trait_selection/traits/mod.gen.ts";
import * as diagnostics from "../diagnostics.gen.ts";
import type { Pick } from "./probe.gen.ts";

/** PORT: `impl TypeFoldable for TraitRef` (the derived impls of predicate.gen.ts) as a descriptor. */
const fold_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
/** PORT: `impl TypeFoldable for TraitClause` (derived) as a descriptor. */
const fold_TraitClause: TypeFoldable<TraitClause> = { visit_with: visit_with_TraitClause, try_fold_with: try_fold_with_TraitClause, fold_with: fold_with_TraitClause };
/** PORT: `impl TypeVisitable for PredicateKind` (derived) as a descriptor. */
const d_PredicateKind: TypeVisitable<PredicateKind> = { visit_with: visit_with_PredicateKind };

/** PORT: `slice::sort_by_key` (stable) with the key computed once per element (the keys are pure). */
function sort_by_cached_key<T, K>(v: T[], key: (x: T) => K, cmp: (a: K, b: K) => number): void {
  const keyed = v.map((x) => [key(x), x] as const);
  keyed.sort((a, b) => cmp(a[0], b[0]));
  for (let i = 0; i < keyed.length; i++) v[i] = keyed[i]![1];
}

/** PORT: `Vec::dedup` / `dedup_by_key` (removes consecutive elements equal by `eq`). */
function dedup_by<T>(v: T[], eq: (a: T, b: T) => boolean): void {
  let w = 0;
  for (let r = 0; r < v.length; r++) {
    if (w === 0 || !eq(v[w - 1]!, v[r]!)) v[w++] = v[r]!;
  }
  v.length = w;
}


// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:2434 note_candidates_on_method_error
FnCtxt.prototype.note_candidates_on_method_error = function (
  this: FnCtxt,
  rcvr_ty: Ty,
  item_name: Ident,
  self_source: SelfSource,
  args: readonly hir.Expr[] | undefined,
  span: Span,
  err: Diag,
  sources: CandidateSource[],
  sugg_span: Span | undefined,
): void {
  sort_by_cached_key(
    sources,
    (source): [number, string] => {
      switch (source.$) {
        case "Trait":
          return [0, this.tcx.def_path_str(source._0)];
        case "Impl":
          return [1, this.tcx.def_path_str(source._0)];
      }
    },
    (a, b) => (a[0] !== b[0] ? a[0] - b[0] : str_cmp(a[1], b[1])),
  );
  dedup_by(sources, CandidateSource_eq);
  // Dynamic limit to avoid hiding just one candidate, which is silly.
  const limit = sources.length === 5 ? 5 : 4;

  const suggs: string[] = [];
  for (const [idx, source] of sources.slice(0, limit).entries()) {
    switch (source.$) {
      case "Impl": {
        const impl_did = source._0;
        // Provide the best span we can. Use the item, if local to crate, else
        // the impl, if local to crate (item may be defaulted), else nothing.
        let item = this.associated_value(impl_did, item_name);
        if (item === undefined) {
          const impl_trait_id = this.tcx.impl_opt_trait_id(impl_did);
          item = impl_trait_id === undefined ? undefined : this.associated_value(impl_trait_id, item_name);
        }
        if (item === undefined) {
          continue;
        }

        const note_span = item.def_id.is_local() ? this.tcx.def_span(item.def_id) : impl_did.is_local() ? this.tcx.def_span(impl_did) : undefined;

        const impl_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.at(span).type_of(impl_did) as EarlyBinder<Ty>));

        const opt_trait_ref = this.tcx.impl_opt_trait_ref(impl_did);
        const insertion = opt_trait_ref === undefined ? "" : ` of the trait \`${this.tcx.def_path_str(EarlyBinder.skip_binder(opt_trait_ref).def_id)}\``;

        let note_str: string;
        let idx_: number | undefined;
        if (sources.length > 1) {
          note_str = `candidate #${idx + 1} is defined in an impl${insertion} for the type \`${display_Ty(impl_ty)}\``;
          idx_ = idx + 1;
        } else {
          note_str = `the candidate is defined in an impl${insertion} for the type \`${display_Ty(impl_ty)}\``;
          idx_ = undefined;
        }
        if (note_span !== undefined) {
          // We have a span pointing to the method. Show note with snippet.
          err.span_note(note_span, note_str);
        } else {
          err.note(note_str);
        }
        if (sugg_span !== undefined) {
          const trait_ref = this.tcx.impl_opt_trait_ref(impl_did);
          if (trait_ref !== undefined) {
            const sugg = print_disambiguation_help(
              this.tcx,
              err,
              self_source,
              args,
              TraitRef.with_replaced_self_ty(
                Unnormalized.skip_norm_wip(EarlyBinder.instantiate(trait_ref, this.tcx, this.fresh_args_for_item(sugg_span, impl_did), fold_TraitRef)),
                as_interner(this.tcx),
                rcvr_ty,
              ),
              idx_,
              sugg_span,
              item,
            );
            if (sugg !== undefined) {
              suggs.push(sugg);
            }
          }
        }
        break;
      }
      case "Trait": {
        const trait_did = source._0;
        const item = this.associated_value(trait_did, item_name);
        if (item === undefined) continue;
        const item_span = this.tcx.def_span(item.def_id);
        let idx_: number | undefined;
        if (sources.length > 1) {
          const msg = `candidate #${idx + 1} is defined in the trait \`${this.tcx.def_path_str(trait_did)}\``;
          err.span_note(item_span, msg);
          idx_ = idx + 1;
        } else {
          const msg = `the candidate is defined in the trait \`${this.tcx.def_path_str(trait_did)}\``;
          err.span_note(item_span, msg);
          idx_ = undefined;
        }
        if (sugg_span !== undefined) {
          const sugg = print_disambiguation_help(
            this.tcx,
            err,
            self_source,
            args,
            TraitRef.with_replaced_self_ty(TraitRef.new_from_args(as_interner(this.tcx), trait_did, this.fresh_args_for_item(sugg_span, trait_did)), as_interner(this.tcx), rcvr_ty),
            idx_,
            sugg_span,
            item,
          );
          if (sugg !== undefined) {
            suggs.push(sugg);
          }
        }
        break;
      }
    }
  }
  if (suggs.length !== 0 && sugg_span !== undefined) {
    const span = sugg_span;
    suggs.sort(str_cmp);
    err.span_suggestions(Span.with_hi(span, Span.lo(item_name.span)), "use fully-qualified syntax to disambiguate", suggs, "MachineApplicable");
  }
  if (sources.length > limit) {
    err.note(`and ${sources.length - limit} others`);
  }
};

/// Look at all the associated functions without receivers in the type's inherent impls
/// to look for builders that return `Self`, `Option<Self>` or `Result<Self, _>`.
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:2592 find_builder_fn
FnCtxt.prototype.find_builder_fn = function (this: FnCtxt, err: Diag, rcvr_ty: Ty, expr_id: HirId): void {
  const rk = rcvr_ty.kind();
  if (rk.$ !== "Adt") {
    return;
  }
  const adt_def = rk._0;
  const items: [DefId, Ty][] = [];
  for (const i of this.tcx.inherent_impls(adt_def.did()) as readonly DefId[]) {
    for (const item of AssocItems.in_definition_order(this.tcx.associated_items(i) as AssocItems)) {
      // Only assoc fn with no receivers and only if
      // they are resolvable
      if (
        !(
          item.kind.$ === "Fn" &&
          item.kind.has_self === false &&
          this.probe_for_name("Path", AssocItem.ident(item, this.tcx), undefined, { _0: true }, rcvr_ty, expr_id, ProbeScope.TraitsInScope).$ === "Ok"
        )
      ) {
        continue;
      }
      // Only assoc fns that return `Self`, `Option<Self>` or `Result<Self, _>`.
      const r = ((): [DefId, Ty] | undefined => {
        const ret_ty_ = PolyFnSig.output(
          Unnormalized.skip_norm_wip(
            EarlyBinder.instantiate(this.tcx.fn_sig(item.def_id) as EarlyBinder<PolyFnSigT>, this.tcx, this.fresh_args_for_item(DUMMY_SP, item.def_id), fold_Binder(fold_FnSig)),
          ),
        );
        const ret_ty = this.tcx.instantiate_bound_regions_with_erased(ret_ty_, fold_Ty);
        const k = ret_ty.kind();
        if (k.$ !== "Adt") {
          return undefined;
        }
        const def = k._0;
        const args = k._1;
        // Check for `-> Self`
        if (this.can_eq(this.param_env, ret_ty, rcvr_ty, ToTrace_Ty)) {
          return [item.def_id, ret_ty];
        }
        // Check for `-> Option<Self>` or `-> Result<Self, _>`
        const option_type = this.tcx.lang_items().option_type();
        const result_type = this.tcx.get_diagnostic_item(sym.Result);
        if (!((option_type !== undefined && DefId_eq(option_type, def.did())) || (result_type !== undefined && DefId_eq(result_type, def.did())))) {
          return undefined;
        }
        const arg0 = args[0];
        if (arg0 === undefined) return undefined;
        const arg = GenericArg.expect_ty(arg0);
        if (this.can_eq(this.param_env, rcvr_ty, arg, ToTrace_Ty)) {
          return [item.def_id, ret_ty];
        } else {
          return undefined;
        }
      })();
      if (r !== undefined) items.push(r);
    }
  }
  let post: string;
  if (items.length > 5) {
    const items_len = items.length;
    items.length = 4;
    post = `\nand ${items_len - 4} others`;
  } else {
    post = "";
  }
  if (items.length === 0) {
    // []
  } else if (items.length === 1) {
    const [def_id, ret_ty] = items[0]!;
    err.span_note(
      this.tcx.def_span(def_id),
      `if you're trying to build a new \`${display_Ty(rcvr_ty)}\`, consider using \`${this.tcx.def_path_str(def_id)}\` which returns \`${display_Ty(ret_ty)}\``,
    );
  } else {
    const span: MultiSpan = MultiSpan.from_Vec(items.map(([def_id]) => this.tcx.def_span(def_id)));
    err.span_note(
      span,
      `if you're trying to build a new \`${display_Ty(rcvr_ty)}\` consider using one of the following associated functions:\n${items.map(([def_id, _ret_ty]) => this.tcx.def_path_str(def_id)).join("\n")}${post}`,
    );
  }
};

/// Suggest calling `Ty::method` if `.method()` isn't found because the method
/// doesn't take a `self` receiver.
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:2690 suggest_associated_call_syntax
FnCtxt.prototype.suggest_associated_call_syntax = function (
  this: FnCtxt,
  err: Diag,
  static_candidates: readonly CandidateSource[],
  rcvr_ty: Ty,
  source: SelfSource,
  item_name: Ident,
  args: readonly hir.Expr[] | undefined,
  sugg_span: Span,
): void {
  let has_unsuggestable_args = false;
  let ty_str: string;
  const sc0 = static_candidates[0];
  if (sc0 !== undefined && sc0.$ === "Impl") {
    const impl_did = sc0._0;
    // When the "method" is resolved through dereferencing, we really want the
    // original type that has the associated function for accurate suggestions.
    // (#61411)
    const impl_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(impl_did) as EarlyBinder<Ty>));
    let found: Ty | undefined;
    for (const [rcvr_ty_] of this.autoderef(sugg_span, rcvr_ty).silence_errors()) {
      if (DeepRejectCtxt.relate_rigid_infer(as_interner(this.tcx)).types_may_unify(rcvr_ty_, impl_ty)) {
        found = rcvr_ty_;
        break;
      }
    }
    const target_ty = (found ?? impl_ty).peel_refs();
    const tk = target_ty.kind();
    if (tk.$ === "Adt") {
      const def = tk._0;
      const args_ = tk._1;
      // If there are any inferred arguments, (`{integer}`), we should replace
      // them with underscores to allow the compiler to infer them
      const infer_args = this.tcx.mk_args_from_iter(
        args_.map((arg): GenericArg => {
          if (!IsSuggestable.is_suggestable(arg, this.tcx, true, fold_GenericArg)) {
            has_unsuggestable_args = true;
            const ak = GenericArg.kind(arg);
            switch (ak.$) {
              case "Lifetime":
                return GenericArg.from_Region(this.next_region_var({ $: "Misc", _0: DUMMY_SP }));
              case "Type":
                return GenericArg.from_Ty(this.next_ty_var(DUMMY_SP));
              case "Const":
                return GenericArg.from_Const(this.next_const_var(DUMMY_SP));
            }
          } else {
            return arg;
          }
        }),
      );

      ty_str = this.tcx.value_path_str_with_args(def.did(), infer_args);
    } else {
      ty_str = this.ty_to_value_string(target_ty);
    }
  } else {
    ty_str = this.ty_to_value_string(rcvr_ty.peel_refs());
  }
  if (source.$ === "MethodCall") {
    const first_arg = ((): string | undefined => {
      const candidate_source = static_candidates[0];
      if (candidate_source === undefined) return undefined;
      let assoc_did: DefId;
      let self_ty: Ty;
      switch (candidate_source.$) {
        case "Impl":
          [assoc_did, self_ty] = [candidate_source._0, Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(candidate_source._0) as EarlyBinder<Ty>))];
          break;
        case "Trait":
          [assoc_did, self_ty] = [candidate_source._0, rcvr_ty];
          break;
      }

      const assoc = this.associated_value(assoc_did, item_name);
      if (assoc === undefined) return undefined;
      if (!AssocItem.is_fn(assoc)) {
        return undefined;
      }

      // for CandidateSource::Impl, `Self` will be instantiated to a concrete type
      // but for CandidateSource::Trait, `Self` is still `Self`
      const sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.fn_sig(assoc.def_id) as EarlyBinder<PolyFnSigT>));
      const first = Binder.skip_binder(PolyFnSig.inputs(sig))[0];
      if (first === undefined) return undefined;
      // if the type of first arg is the same as the current impl type, we should take the first arg into assoc function
      const first_ty = first.peel_refs();
      if (first_ty === self_ty || first_ty === this.tcx.types.self_param) {
        const mutbl = first.ref_mutability();
        return mutbl === undefined ? "" : Mutability.ref_prefix_str(mutbl);
      } else {
        return undefined;
      }
    })();

    let applicability: Applicability = "MachineApplicable";
    let args_str: string;
    if (source.$ === "MethodCall" && args !== undefined) {
      const receiver = source._0;
      // The first arg is the same kind as the receiver
      let explicit_args: hir.Expr[];
      if (first_arg !== undefined) {
        explicit_args = [receiver, ...args];
      } else {
        // There is no `Self` kind to infer the arguments from
        if (has_unsuggestable_args) {
          applicability = "HasPlaceholders";
        }
        explicit_args = [...args];
      }
      args_str = `(${first_arg ?? ""}${explicit_args
        .map((arg) => {
          const r = this.tcx.sess.source_map().span_to_snippet(arg.span);
          if (r.$ === "Ok") return r._0.toString();
          applicability = "HasPlaceholders";
          return "_";
        })
        .join(", ")})`;
    } else {
      applicability = "HasPlaceholders";
      args_str = "(...)";
    }
    err.span_suggestion_verbose(sugg_span, "use associated function syntax instead", `${ty_str}::${display_Ident(item_name)}${args_str}`, applicability);
  } else {
    err.help(`try with \`${ty_str}::${display_Ident(item_name)}\``);
  }
};

/// Suggest calling a field with a type that implements the `Fn*` traits instead of a method with
/// the same name as the field i.e. `(a.my_fn_ptr)(10)` instead of `a.my_fn_ptr(10)`.
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:2816 suggest_calling_field_as_fn
FnCtxt.prototype.suggest_calling_field_as_fn = function (this: FnCtxt, span: Span, rcvr_ty: Ty, expr: hir.Expr, item_name: Ident, err: Diag): boolean {
  const tcx = this.tcx;
  let field_receiver: [FieldDef, Ty] | undefined;
  for (const [ty] of this.autoderef(span, rcvr_ty).silence_errors()) {
    const k = ty.kind();
    if (k.$ === "Adt" && !k._0.is_enum()) {
      const def = k._0;
      const args = k._1;
      const variant = def.non_enum_variant();
      const index = tcx.find_field_index(item_name, variant);
      if (index !== undefined) {
        const field = variant.fields[index]!;
        const field_ty = Unnormalized.skip_norm_wip(field.ty(tcx, args));
        field_receiver = [field, field_ty];
        break;
      }
    }
  }
  if (field_receiver !== undefined) {
    const [field, field_ty] = field_receiver;
    const is_accessible = Visibility.is_accessible_from(field.vis, this.mod_id, tcx);

    if (is_accessible) {
      const callable = this.extract_callable_info(field_ty);
      if (callable !== undefined) {
        const [what_] = callable;
        const what = what_.$ === "DefId" ? this.tcx.def_descr(what_._0) : what_._0;
        const expr_span = Span.to(expr.span, item_name.span);
        err.multipart_suggestion(
          `to call the ${what} stored in \`${display_Ident(item_name)}\`, surround the field access with parentheses`,
          [
            [Span.shrink_to_lo(expr_span), "("],
            [Span.shrink_to_hi(expr_span), ")"],
          ],
          "MachineApplicable",
        );
      } else {
        const call_expr = tcx.hir_expect_expr(tcx.parent_hir_id(expr.hir_id));

        const span_ = Span.trim_start(call_expr.span, item_name.span);
        if (span_ !== undefined) {
          err.span_suggestion(span_, "remove the arguments", "", "MaybeIncorrect");
        }
      }
    }

    const field_kind = is_accessible ? "field" : "private field";
    err.span_label(item_name.span, `${field_kind}, not a method`);
    return true;
  }
  return false;
};

/// Suggest possible range with adding parentheses, for example:
/// when encountering `0..1.map(|i| i + 1)` suggest `(0..1).map(|i| i + 1)`.
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:2881 report_failed_method_call_on_range_end
FnCtxt.prototype.report_failed_method_call_on_range_end = function (this: FnCtxt, tcx: TyCtxt, actual: Ty, source: SelfSource, span: Span, item_name: Ident): Result<undefined, ErrorGuaranteed> {
  if (source.$ === "MethodCall") {
    const expr = source._0;
    let n = 0;
    for (const [, parent] of tcx.hir_parent_iter(expr.hir_id)) {
      if (n++ >= 5) break;
      if (parent.$ === "Expr") {
        const parent_expr = parent._0;
        if (!is_range_literal(parent_expr)) {
          continue;
        }
        let lang_item: LangItem | undefined;
        const pk = parent_expr.kind;
        if (pk.$ === "Struct") {
          const li = tcx.qpath_lang_item(pk._0);
          lang_item =
            li !== undefined && (li === LangItem.Range || li === LangItem.RangeCopy || li === LangItem.RangeInclusiveCopy || li === LangItem.RangeTo || li === LangItem.RangeToInclusive)
              ? li
              : undefined;
        } else if (pk.$ === "Call") {
          const func = pk._0;
          // `..=` desugars into `::std::ops::RangeInclusive::new(...)`.
          if (func.kind.$ === "Path" && tcx.qpath_is_lang_item(func.kind._0, LangItem.RangeInclusiveNew)) {
            lang_item = LangItem.RangeInclusiveStruct;
          } else {
            lang_item = undefined;
          }
        } else {
          lang_item = undefined;
        }

        if (lang_item === undefined) {
          continue;
        }

        let span_included: boolean;
        if (pk.$ === "Struct") {
          const eps = pk._1;
          const last = eps[eps.length - 1];
          span_included = last !== undefined && Span.contains(last.span, span);
        } else if (pk.$ === "Call") {
          // `..=` desugars into `::std::ops::RangeInclusive::new(...)`.
          span_included = Span.contains(pk._0.span, span);
        } else {
          span_included = false;
        }

        if (!span_included) {
          continue;
        }

        const range_def_id = this.tcx.lang_items().get(lang_item);
        if (range_def_id === undefined) {
          continue;
        }
        const range_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(this.tcx.type_of(range_def_id) as EarlyBinder<Ty>, this.tcx, [GenericArg.from_Ty(actual)], fold_Ty));

        const pick = this.lookup_probe_for_diagnostic(item_name, range_ty, expr, ProbeScope.AllTraits, undefined);
        if (pick.$ === "Ok") {
          const range_span = Span.with_hi(parent_expr.span, Span.hi(expr.span));
          return Err(
            this.dcx().emit_err(
              diagnostics.MissingParenthesesInRange_diagnostic({
                span,
                ty: actual,
                method_name: item_name.as_str(),
                add_missing_parentheses: {
                  func_name: Symbol.as_str(item_name.name),
                  left: Span.shrink_to_lo(range_span),
                  right: Span.shrink_to_hi(range_span),
                },
              }),
            ),
          );
        }
      }
    }
  }
  return Ok(undefined);
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:2974 report_failed_method_call_on_numerical_infer_var
FnCtxt.prototype.report_failed_method_call_on_numerical_infer_var = function (
  this: FnCtxt,
  tcx: TyCtxt,
  actual: Ty,
  source: SelfSource,
  span: Span,
  item_kind: string,
  item_name: Ident,
  long_ty_path: MutRef<PathBuf | undefined>,
): Result<undefined, ErrorGuaranteed> {
  let found_candidate = all_traits(this.tcx).some((info) => this.associated_value(info.def_id, item_name) !== undefined);
  const found_assoc = (ty: Ty): boolean => {
    const simp = simplify_type(as_interner(tcx), ty, "InstantiateWithInfer");
    if (simp === undefined) return false;
    for (const id of tcx.incoherent_impls(simp) as readonly DefId[]) {
      if (this.associated_value(id, item_name) !== undefined) return true;
    }
    return false;
  };
  found_candidate =
    found_candidate ||
    found_assoc(tcx.types.i8) ||
    found_assoc(tcx.types.i16) ||
    found_assoc(tcx.types.i32) ||
    found_assoc(tcx.types.i64) ||
    found_assoc(tcx.types.i128) ||
    found_assoc(tcx.types.u8) ||
    found_assoc(tcx.types.u16) ||
    found_assoc(tcx.types.u32) ||
    found_assoc(tcx.types.u64) ||
    found_assoc(tcx.types.u128) ||
    found_assoc(tcx.types.f32) ||
    found_assoc(tcx.types.f64);
  if (found_candidate && actual.is_numeric() && !actual.has_concrete_skeleton() && source.$ === "MethodCall") {
    const expr = source._0;
    const ty_str = this.tcx.short_string(actual, long_ty_path, print_Ty);
    const err = struct_span_code_err(this.dcx(), span, E0689, `can't call ${item_kind} \`${display_Ident(item_name)}\` on ambiguous numeric type \`${ty_str}\``);
    const taken = long_ty_path.value;
    long_ty_path.value = undefined;
    err.long_ty_path().value = taken;
    const concrete_type = actual.is_integral() ? "i32" : "f32";
    const ek = expr.kind;
    if (ek.$ === "Lit") {
      const lit = ek._0;
      // numeric literal
      const r = tcx.sess.source_map().span_to_snippet(lit.span);
      let snippet = r.$ === "Ok" ? r._0.toString() : "<numeric literal>";

      // If this is a floating point literal that ends with '.',
      // get rid of it to stop this from becoming a member access.
      if (snippet.endsWith(".")) snippet = snippet.slice(0, -1);
      err.span_suggestion(lit.span, `you must specify a concrete type for this numeric value, like \`${concrete_type}\``, `${snippet}_${concrete_type}`, "MaybeIncorrect");
    } else if (ek.$ === "Path" && ek._0.$ === "Resolved") {
      const path = ek._0._1;
      // local binding
      if (path.res.$ === "Local") {
        const hir_id = path.res._0;
        const span = tcx.hir_span(hir_id);
        const filename = tcx.sess.source_map().span_to_filename(span);

        const parent_node = this.tcx.parent_hir_node(hir_id);
        const msg = `you must specify a type for this binding, like \`${concrete_type}\``;

        // FIXME: Maybe FileName::Anon should also be handled,
        // otherwise there would be no suggestion if the source is STDIN for example.
        let binding_pat: hir.Node;
        if (filename.$ === "Real" && parent_node.$ === "LetStmt" && parent_node._0.source === "Normal") {
          const ty = parent_node._0.ty;
          const type_span = ty !== undefined ? Span.with_lo(ty.span, Span.hi(span)) : Span.shrink_to_hi(span);
          err.span_suggestion(
            // account for `let x: _ = 42;`
            //                   ^^^
            type_span,
            msg,
            `: ${concrete_type}`,
            "MaybeIncorrect",
          );
        } else if (
          // For closure parameters with reference patterns (e.g., |&v|), suggest the type annotation
          // on the pattern itself, e.g., |&v: &i32|
          filename.$ === "Real" &&
          parent_node.$ === "Pat" &&
          (binding_pat = this.tcx.hir_node(hir_id)).$ === "Pat" &&
          binding_pat._0.kind.$ === "Binding" &&
          parent_node.$ === "Pat" &&
          parent_node._0.kind.$ === "Ref"
        ) {
          const pat = parent_node._0;
          err.span_label(span, "you must specify a type for this binding");

          const ref_muts: Mutability[] = [];
          let current_node: hir.Node = parent_node;

          while (current_node.$ === "Pat") {
            const parent_pat = current_node._0;
            if (parent_pat.kind.$ === "Ref") {
              const mutability = parent_pat.kind._2;
              ref_muts.push(mutability);
              current_node = this.tcx.parent_hir_node(parent_pat.hir_id);
            } else {
              break;
            }
          }

          let type_annotation = "";
          for (const mutability of [...ref_muts].reverse()) {
            switch (mutability) {
              case "Mut":
                type_annotation += "&mut ";
                break;
              case "Not":
                type_annotation += "&";
                break;
            }
          }
          type_annotation += concrete_type;

          err.span_suggestion_verbose(Span.shrink_to_hi(pat.span), "specify the type in the closure argument list", `: ${type_annotation}`, "MaybeIncorrect");
        } else {
          err.span_label(span, msg);
        }
      }
    }
    return Err(err.emit_err());
  }
  return Ok(undefined);
};

/// For code `rect::area(...)`,
/// if `rect` is a local variable and `area` is a valid assoc method for it,
/// we try to suggest `rect.area()`
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3133 suggest_assoc_method_call
FnCtxt.prototype.suggest_assoc_method_call = function (this: FnCtxt, segs: readonly hir.PathSegment[]): void {
  // debug!("suggest_assoc_method_call segs: {:?}", segs);
  if (segs.length !== 2) {
    return;
  }
  const [seg1, seg2] = [segs[0]!, segs[1]!];
  this.dcx().try_steal_modify_and_emit_err(seg1.ident.span, StashKey.CallAssocMethod, (err) => {
    const body = this.tcx.hir_body_owned_by(this.body_def_id);
    class LetVisitor extends Visitor<ControlFlow<hir.Expr | undefined>> {
      // type Result = ControlFlow<Option<&'v hir::Expr<'v>>>;
      override Result: VisitorResult<ControlFlow<hir.Expr | undefined>, unknown> = VisitorResultC.ControlFlow<hir.Expr | undefined>();
      constructor(public ident_name: Symbol) {
        super();
      }

      // FIXME: This really should be taking scoping, etc into account.
      // impl<'v> Visitor<'v> for LetVisitor
      // rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3150 visit_stmt
      override visit_stmt(ex: hir.Stmt): ControlFlow<hir.Expr | undefined> {
        if (ex.kind.$ === "Let" && ex.kind._0.pat.kind.$ === "Binding" && ex.kind._0.pat.kind._2.name === this.ident_name) {
          return ControlFlowC.Break(ex.kind._0.init);
        } else {
          return walk_stmt(this, ex);
        }
      }
    }

    const call_expr_node = this.tcx.parent_hir_node(seg1.hir_id);
    if (call_expr_node.$ === "Expr") {
      const call_expr = call_expr_node._0;
      const cf = new LetVisitor(seg1.ident.name).visit_body(body);
      if (cf.$ === "Break" && cf._0 !== undefined) {
        const expr = cf._0;
        const self_ty = this.node_ty_opt(expr.hir_id);
        if (self_ty !== undefined) {
          const probe = this.lookup_probe_for_diagnostic(seg2.ident, self_ty, call_expr, ProbeScope.TraitsInScope, undefined);
          if (probe.$ === "Ok") {
            const sm = this.infcx.tcx.sess.source_map();
            err.span_suggestion_verbose(
              unwrap_result(sm.span_extend_while(Span.shrink_to_hi(seg1.ident.span), (c) => c === 0x3a /* ':' */)),
              "you may have meant to call an instance method",
              ".",
              "MaybeIncorrect",
            );
          }
        }
      }
    }
  });
};

/// Suggest calling a method on a field i.e. `a.field.bar()` instead of `a.bar()`
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3190 suggest_calling_method_on_field
FnCtxt.prototype.suggest_calling_method_on_field = function (this: FnCtxt, err: Diag, source: SelfSource, span: Span, actual: Ty, item_name: Ident, return_type: Ty | undefined): void {
  if (source.$ === "MethodCall") {
    const expr = source._0;
    for (const fields of this.get_field_candidates_considering_privacy_for_diag(span, actual)) {
      const call_expr = this.tcx.hir_expect_expr(this.tcx.parent_hir_id(expr.hir_id));

      const lang_items = this.tcx.lang_items();
      const never_mention_traits = [
        lang_items.clone_trait(),
        lang_items.deref_trait(),
        lang_items.deref_mut_trait(),
        this.tcx.get_diagnostic_item(sym.AsRef),
        this.tcx.get_diagnostic_item(sym.AsMut),
        this.tcx.get_diagnostic_item(sym.Borrow),
        this.tcx.get_diagnostic_item(sym.BorrowMut),
      ];
      const candidate_fields: string[] = [];
      for (const candidate_field of fields) {
        const field_path = this.check_for_nested_field_satisfying_condition_for_diag(
          span,
          (_, field_ty) => {
            const r = this.lookup_probe_for_diagnostic(item_name, field_ty, call_expr, ProbeScope.TraitsInScope, return_type);
            if (r.$ !== "Ok") return false;
            const pick = r._0;
            return !never_mention_traits.some((def_id) => def_id !== undefined && DefId_eq(this.tcx.parent(pick.item.def_id), def_id));
          },
          candidate_field,
          [],
        );
        if (field_path === undefined) continue;
        candidate_fields.push(field_path.map((id) => display_Ident(id)).join("."));
      }
      candidate_fields.sort(str_cmp);

      const len = candidate_fields.length;
      if (len > 0) {
        err.span_suggestions(
          Span.shrink_to_lo(item_name.span),
          `${len > 1 ? "some" : "one"} of the expressions' fields ${len > 1 ? "have" : "has"} a method of the same name`,
          candidate_fields.map((path) => `${path}.`),
          "MaybeIncorrect",
        );
      }
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3264 suggest_unwrapping_inner_self
FnCtxt.prototype.suggest_unwrapping_inner_self = function (this: FnCtxt, err: Diag, source: SelfSource, actual: Ty, item_name: Ident): void {
  const tcx = this.tcx;
  if (source.$ !== "MethodCall") {
    return;
  }
  const expr = source._0;
  const call_expr = tcx.hir_expect_expr(tcx.parent_hir_id(expr.hir_id));

  const ak = actual.kind();
  if (ak.$ !== "Adt") {
    return;
  }
  const kind = ak._0;
  const args = ak._1;
  switch (kind.adt_kind()) {
    case "Enum": {
      const matching_variants: [VariantDef, FieldDef, Pick][] = [];
      for (const variant of kind.variants()) {
        if (variant.fields.length !== 1) {
          continue;
        }
        const field = variant.fields[0]!;
        const field_ty = Unnormalized.skip_norm_wip(field.ty(tcx, args));

        // Skip `_`, since that'll just lead to ambiguity.
        if (this.deeply_resolve_ignoring_regions(field_ty, fold_Ty).is_ty_var()) {
          continue;
        }

        const r = this.lookup_probe_for_diagnostic(item_name, field_ty, call_expr, ProbeScope.TraitsInScope, undefined);
        if (r.$ === "Ok") matching_variants.push([variant, field, r._0]);
      }

      const ret_ty_matches = (diagnostic_item: Symbol): boolean => {
        const ret_ty = this.ret_coercion === undefined ? undefined : this.deeply_resolve_ignoring_regions(this.ret_coercion.expected_ty(), fold_Ty);
        if (ret_ty !== undefined) {
          const rk = ret_ty.kind();
          if (rk.$ === "Adt") {
            const d = tcx.get_diagnostic_item(diagnostic_item);
            if (d !== undefined && DefId_eq(d, rk._0.did())) {
              return true;
            }
          }
        }
        return false;
      };

      if (matching_variants.length === 1) {
        const [, field, pick] = matching_variants[0]!;
        const self_ty = Unnormalized.skip_norm_wip(field.ty(tcx, args));
        err.span_note(tcx.def_span(pick.item.def_id), `the method \`${display_Ident(item_name)}\` exists on the type \`${display_Ty(self_ty)}\``);
        let article: string, kind_: string, variant: string, question: boolean;
        if (
          tcx.is_diagnostic_item(sym.Result, kind.did()) &&
          // Do not suggest `.expect()` in const context where it's not available. rust-lang/rust#149316
          !tcx.hir_is_inside_const_context(expr.hir_id)
        ) {
          [article, kind_, variant, question] = ["a", "Result", "Err", ret_ty_matches(sym.Result)];
        } else if (tcx.is_diagnostic_item(sym.Option, kind.did())) {
          [article, kind_, variant, question] = ["an", "Option", "None", ret_ty_matches(sym.Option)];
        } else {
          return;
        }
        if (question) {
          err.span_suggestion_verbose(
            Span.shrink_to_hi(expr.span),
            `use the \`?\` operator to extract the \`${display_Ty(self_ty)}\` value, propagating ${article} \`${kind_}::${variant}\` value to the caller`,
            "?",
            "MachineApplicable",
          );
        } else {
          err.span_suggestion_verbose(
            Span.shrink_to_hi(expr.span),
            `consider using \`${kind_}::expect\` to unwrap the \`${display_Ty(self_ty)}\` value, panicking if the value is ${article} \`${kind_}::${variant}\``,
            '.expect("REASON")',
            "HasPlaceholders",
          );
        }
      } else {
        // FIXME(compiler-errors): Support suggestions for other matching enum variants
      }
      break;
    }
    // Target wrapper types - types that wrap or pretend to wrap another type,
    // perhaps this inner type is meant to be called?
    case "Struct":
    case "Union": {
      if (args.length !== 1) {
        return;
      }
      const first = args[0]!;
      const fk = GenericArg.kind(first);
      if (fk.$ !== "Type") {
        return;
      }
      const ty = fk._0;
      const r = this.lookup_probe_for_diagnostic(item_name, ty, call_expr, ProbeScope.TraitsInScope, undefined);
      if (r.$ !== "Ok") {
        return;
      }
      const pick = r._0;

      const name = this.ty_to_string(actual);
      const inner_id = kind.did();
      const aopa = pick.autoref_or_ptr_adjustment;
      const mutable = aopa !== undefined && aopa.$ === "Autoref" ? aopa.mutbl : undefined;

      if (tcx.is_diagnostic_item(sym.LocalKey, inner_id)) {
        err.help("use `with` or `try_with` to access thread local storage");
      } else if (tcx.is_lang_item(kind.did(), LangItem.MaybeUninit)) {
        err.help(`if this \`${name}\` has been initialized, use one of the \`assume_init\` methods to access the inner value`);
      } else if (tcx.is_diagnostic_item(sym.RefCell, inner_id)) {
        let suggestion: string, borrow_kind: string, panic_if: string;
        switch (mutable) {
          case "Not":
            [suggestion, borrow_kind, panic_if] = [".borrow()", "borrow", "a mutable borrow exists"];
            break;
          case "Mut":
            [suggestion, borrow_kind, panic_if] = [".borrow_mut()", "mutably borrow", "any borrows exist"];
            break;
          case undefined:
            return;
        }
        err.span_suggestion_verbose(Span.shrink_to_hi(expr.span), `use \`${suggestion}\` to ${borrow_kind} the \`${display_Ty(ty)}\`, panicking if ${panic_if}`, suggestion, "MaybeIncorrect");
      } else if (tcx.is_diagnostic_item(sym.Mutex, inner_id)) {
        err.span_suggestion_verbose(
          Span.shrink_to_hi(expr.span),
          `use \`.lock().unwrap()\` to borrow the \`${display_Ty(ty)}\`, blocking the current thread until it can be acquired`,
          ".lock().unwrap()",
          "MaybeIncorrect",
        );
      } else if (tcx.is_diagnostic_item(sym.RwLock, inner_id)) {
        let suggestion: string, borrow_kind: string;
        switch (mutable) {
          case "Not":
            [suggestion, borrow_kind] = [".read().unwrap()", "borrow"];
            break;
          case "Mut":
            [suggestion, borrow_kind] = [".write().unwrap()", "mutably borrow"];
            break;
          case undefined:
            return;
        }
        err.span_suggestion_verbose(
          Span.shrink_to_hi(expr.span),
          `use \`${suggestion}\` to ${borrow_kind} the \`${display_Ty(ty)}\`, blocking the current thread until it can be acquired`,
          suggestion,
          "MaybeIncorrect",
        );
      } else {
        return;
      }

      err.span_note(tcx.def_span(pick.item.def_id), `the method \`${display_Ident(item_name)}\` exists on the type \`${display_Ty(ty)}\``);
      break;
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3455 note_unmet_impls_on_type
FnCtxt.prototype.note_unmet_impls_on_type = function (this: FnCtxt, err: Diag, errors: readonly FulfillmentError[], suggest_derive: boolean): void {
  const preds: [Predicate, TraitClause][] = [];
  for (const e of errors) {
    const k = Binder.skip_binder(e.obligation.predicate.kind());
    if (k.$ === "Clause" && k._0.$ === "Trait") {
      const pred = k._0._0;
      if (TraitClause.self_ty(pred).kind().$ === "Adt") {
        preds.push([e.root_obligation.predicate, pred]);
      }
    }
  }

  // Note for local items and foreign items respectively.
  const local_preds: [Predicate, TraitClause][] = [];
  const foreign_preds: [Predicate, TraitClause][] = [];
  for (const p of preds) {
    const k = TraitClause.self_ty(p[1]).kind();
    if (k.$ === "Adt" ? k._0.did().is_local() : false) {
      local_preds.push(p);
    } else {
      foreign_preds.push(p);
    }
  }

  sort_by_cached_key(local_preds, ([, pred]) => display_TraitRef(pred.trait_ref), str_cmp);
  // PORT: `FxIndexSet<DefId>`: insertion-ordered, deduplicated.
  const local_def_ids = new DefIdSet();
  for (const [, pred] of local_preds) {
    const k = TraitClause.self_ty(pred).kind();
    if (k.$ === "Adt") local_def_ids.add(k._0.did());
  }
  const local_spans_vec: Span[] = [];
  for (const def_id of local_def_ids) {
    const span = this.tcx.def_span(def_id);
    if (!Span.is_dummy(span)) local_spans_vec.push(span);
  }
  const local_spans: MultiSpan = MultiSpan.from_Vec(local_spans_vec);
  for (const [, pred] of local_preds) {
    const k = TraitClause.self_ty(pred).kind();
    if (k.$ === "Adt") {
      local_spans.push_span_label(this.tcx.def_span(k._0.did()), `must implement \`${display_TraitRefPrintSugared(TraitRef_print_trait_sugared(pred.trait_ref))}\``);
    }
  }
  if (local_spans.primary_span() !== undefined) {
    let msg: string;
    if (local_preds.length === 1) {
      const [, local_pred] = local_preds[0]!;
      msg = `an implementation of \`${display_TraitRefPrintSugared(TraitRef_print_trait_sugared(local_pred.trait_ref))}\` might be missing for \`${display_Ty(TraitClause.self_ty(local_pred))}\``;
    } else {
      msg = `the following type${pluralize(local_def_ids.size)} would have to \`impl\` ${local_def_ids.size === 1 ? "its" : "their"} required trait${pluralize(local_preds.length)} for this operation to be valid`;
    }
    err.span_note(local_spans, msg);
  }

  sort_by_cached_key(foreign_preds, ([, pred]) => display_TraitRef(pred.trait_ref), str_cmp);

  for (const [, pred] of foreign_preds) {
    const ty = TraitClause.self_ty(pred);
    const k = ty.kind();
    if (k.$ !== "Adt") continue;
    const def = k._0;
    const span = this.tcx.def_span(def.did());
    if (Span.is_dummy(span)) {
      continue;
    }
    const mspan: MultiSpan = MultiSpan.from_Span(span);
    mspan.push_span_label(span, `\`${display_Ty(ty)}\` is defined in another crate`);
    err.span_note(mspan, `\`${display_Ty(ty)}\` does not implement \`${display_TraitRefPrintSugared(TraitRef_print_trait_sugared(pred.trait_ref))}\``);

    foreign_preds.find(([root_pred, pred]) => {
      const rk = Binder.skip_binder(root_pred.kind());
      if (rk.$ === "Clause" && rk._0.$ === "Trait") {
        const root_adt = TraitClause.self_ty(rk._0._0).ty_adt_def();
        if (root_adt !== undefined) {
          return this.suggest_hashmap_on_unsatisfied_hashset_buildhasher(err, pred, root_adt);
        }
      }
      return false;
    });
  }

  const preds_: UnsatisfiedPredicates = errors.map((e) => [e.obligation.predicate, undefined, e.obligation.cause]);
  if (suggest_derive) {
    this.suggest_derive(err, preds_);
  } else {
    // The predicate comes from a binop where the lhs and rhs have different types.
    this.note_predicate_source_and_get_derives(err, preds_);
  }
};

/// Checks if we can suggest a derive macro for the unmet trait bound.
/// Returns Some(list_of_derives) if possible, or None if not.
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3570 consider_suggesting_derives_for_ty
FnCtxt.prototype.consider_suggesting_derives_for_ty = function (this: FnCtxt, trait_pred: TraitClause, adt: AdtDef): [string, OrdSpan, Symbol][] | undefined {
  const diagnostic_name = this.tcx.get_diagnostic_name(TraitClause.def_id(trait_pred));
  if (diagnostic_name === undefined) return undefined;

  let can_derive: boolean;
  if (diagnostic_name === sym.Copy || diagnostic_name === sym.Clone) {
    can_derive = true;
  } else if (adt.is_union()) {
    can_derive = false;
  } else if (
    diagnostic_name === sym.Default ||
    diagnostic_name === sym.Eq ||
    diagnostic_name === sym.PartialEq ||
    diagnostic_name === sym.Ord ||
    diagnostic_name === sym.PartialOrd ||
    diagnostic_name === sym.Hash ||
    diagnostic_name === sym.Debug
  ) {
    can_derive = true;
  } else {
    can_derive = false;
  }

  if (!can_derive) {
    return undefined;
  }

  const trait_def_id = TraitClause.def_id(trait_pred);
  const self_ty = TraitClause.self_ty(trait_pred);

  // We need to check if there is already a manual implementation of the trait
  // for this specific ADT to avoid suggesting `#[derive(..)]` that would conflict.
  for (const impl_def_id of this.tcx.non_blanket_impls_for_ty(trait_def_id, self_ty)) {
    const def = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(impl_def_id) as EarlyBinder<Ty>)).ty_adt_def();
    if (def !== undefined && DefId_eq(def.did(), adt.did())) {
      return undefined;
    }
  }

  const derives: [string, OrdSpan, Symbol][] = [];
  const self_name = display_Ty(self_ty);
  const self_span = new OrdSpan(this.tcx.def_span(adt.did()));

  for (const super_trait of supertraits(this.tcx, Binder.dummy(trait_pred.trait_ref, fold_TraitRef))) {
    const parent_diagnostic_name = this.tcx.get_diagnostic_name(PolyTraitRef.def_id(super_trait));
    if (parent_diagnostic_name !== undefined) {
      derives.push([self_name, self_span, parent_diagnostic_name]);
    }
  }

  derives.push([self_name, self_span, diagnostic_name]);

  return derives;
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3626 note_predicate_source_and_get_derives
FnCtxt.prototype.note_predicate_source_and_get_derives = function (this: FnCtxt, err: Diag, unsatisfied_predicates: UnsatisfiedPredicates): [string, OrdSpan, Symbol][] {
  const derives: [string, OrdSpan, Symbol][] = [];
  const traits: DefId[] = [];
  for (const [pred] of unsatisfied_predicates) {
    const k = Binder.no_bound_vars(pred.kind(), d_PredicateKind);
    if (!(k !== undefined && k.$ === "Clause" && k._0.$ === "Trait")) {
      continue;
    }
    const trait_pred = k._0._0;
    const adt_ = TraitClause.self_ty(trait_pred).ty_adt_def();
    if (!(adt_ !== undefined && adt_.did().is_local())) {
      continue;
    }
    const adt = adt_;
    const new_derives = this.consider_suggesting_derives_for_ty(trait_pred, adt);
    if (new_derives !== undefined) {
      derives.push(...new_derives);
    } else {
      traits.push(TraitClause.def_id(trait_pred));
    }
  }
  sort_by_cached_key(traits, (id) => this.tcx.def_path_str(id), str_cmp);
  dedup_by(traits, DefId_eq);

  const len = traits.length;
  if (len > 0) {
    const span = MultiSpan.from_spans(traits.map((did) => this.tcx.def_span(did)));
    let names = `\`${this.tcx.def_path_str(traits[0]!)}\``;
    for (let i = 1; i < traits.length; i++) {
      const did = traits[i]!;
      if (len > 2) {
        names += ", ";
      }
      if (i === len - 1) {
        names += " and ";
      }
      names += "`";
      names += this.tcx.def_path_str(did);
      names += "`";
    }
    err.span_note(span, `the trait${pluralize(len)} ${names} must be implemented`);
  }

  return derives;
};

/** PORT: `Ord for (String, OrdSpan, Symbol)` (derived tuple order; `Symbol`'s derived `Ord` is its index). */
function cmp_derive(a: [string, OrdSpan, Symbol], b: [string, OrdSpan, Symbol]): number {
  const c = str_cmp(a[0], b[0]);
  if (c !== 0) return c;
  const d = a[1].cmp(b[1]);
  if (d !== 0) return d;
  return a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0;
}

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3677 suggest_derive
FnCtxt.prototype.suggest_derive = function (this: FnCtxt, err: Diag, unsatisfied_predicates: UnsatisfiedPredicates): boolean {
  const derives = this.note_predicate_source_and_get_derives(err, unsatisfied_predicates);
  derives.sort(cmp_derive);
  dedup_by(derives, (a, b) => cmp_derive(a, b) === 0);

  const derives_grouped: [string, Span, string][] = [];
  for (const [self_name, self_span, trait_name] of derives) {
    const last = derives_grouped[derives_grouped.length - 1];
    if (last !== undefined) {
      const [last_self_name] = last;
      if (last_self_name === self_name) {
        last[2] += `, ${display_Symbol(trait_name)}`;
        continue;
      }
    }
    derives_grouped.push([self_name, self_span._0, display_Symbol(trait_name)]);
  }

  for (const [self_name, self_span, traits] of derives_grouped) {
    err.span_suggestion_verbose(Span.shrink_to_lo(self_span), `consider annotating \`${self_name}\` with \`#[derive(${traits})]\``, `#[derive(${traits})]\n`, "MaybeIncorrect");
  }
  return derives_grouped.length !== 0;
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3708 note_derefed_ty_has_method
FnCtxt.prototype.note_derefed_ty_has_method = function (this: FnCtxt, err: Diag, self_source: SelfSource, rcvr_ty: Ty, item_name: Ident, expected: Expectation): void {
  if (self_source.$ !== "QPath") {
    return;
  }
  const ty = self_source._0;
  let first = true;
  for (const [deref_ty] of this.autoderef(DUMMY_SP, rcvr_ty).silence_errors()) {
    // `.skip(1)`
    if (first) {
      first = false;
      continue;
    }
    const r = this.probe_for_name("Path", item_name, Expectation.only_has_type(expected, this), { _0: true }, deref_ty, ty.hir_id, ProbeScope.TraitsInScope);
    if (r.$ === "Ok") {
      const pick = r._0;
      let self_ty: Ty | undefined;
      if (
        IsSuggestable.is_suggestable(deref_ty, this.tcx, true, fold_Ty) &&
        // If this method receives `&self`, then the provided
        // argument _should_ coerce, so it's valid to suggest
        // just changing the path.
        AssocItem.is_method(pick.item) &&
        (self_ty = Binder.skip_binder(PolyFnSig.inputs(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.fn_sig(pick.item.def_id) as EarlyBinder<PolyFnSigT>))))[0]) !== undefined &&
        self_ty.is_ref()
      ) {
        let suggested_path: string;
        const dk = deref_ty.kind();
        if (
          dk.$ === "Bool" ||
          dk.$ === "Char" ||
          dk.$ === "Int" ||
          dk.$ === "Uint" ||
          dk.$ === "Float" ||
          dk.$ === "Adt" ||
          dk.$ === "Str" ||
          (dk.$ === "Alias" && (dk._1.kind.$ === "Projection" || dk._1.kind.$ === "Inherent")) ||
          dk.$ === "Param"
        ) {
          suggested_path = display_Ty(deref_ty);
        } else if (
          // we need to test something like  <&[_]>::len or <(&[u32])>::len
          // and Vec::function();
          // <&[_]>::len or <&[u32]>::len doesn't need an extra "<>" between
          // but for Adt type like Vec::function()
          // we would suggest <[_]>::function();
          this.tcx.sess.source_map().span_wrapped_by_angle_or_parentheses(ty.span)
        ) {
          suggested_path = display_Ty(deref_ty);
        } else {
          suggested_path = `<${display_Ty(deref_ty)}>`;
        }
        err.span_suggestion_verbose(ty.span, `the function \`${display_Ident(item_name)}\` is implemented on \`${display_Ty(deref_ty)}\``, suggested_path, "MaybeIncorrect");
      } else {
        err.span_note(ty.span, `the function \`${display_Ident(item_name)}\` is implemented on \`${display_Ty(deref_ty)}\``);
      }
      return;
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3785 suggest_bounds_for_range_to_method
FnCtxt.prototype.suggest_bounds_for_range_to_method = function (this: FnCtxt, err: Diag, source: SelfSource, item_ident: Ident): void {
  if (source.$ !== "MethodCall") return;
  const rcvr_expr = source._0;
  if (rcvr_expr.kind.$ !== "Struct") return;
  const qpath = rcvr_expr.kind._0;
  const fields = rcvr_expr.kind._1;
  const lang_item = this.tcx.qpath_lang_item(qpath);
  if (lang_item === undefined) {
    return;
  }
  let is_inclusive: boolean;
  if (lang_item === LangItem.RangeTo) {
    is_inclusive = false;
  } else if (lang_item === LangItem.RangeToInclusive || lang_item === LangItem.RangeInclusiveCopy) {
    is_inclusive = true;
  } else {
    return;
  }

  const iterator_trait = this.tcx.get_diagnostic_item(sym.Iterator);
  if (iterator_trait === undefined) return;
  if (AssocItems.filter_by_name_unhygienic(this.tcx.associated_items(iterator_trait) as AssocItems, item_ident.name).next().done) {
    return;
  }

  const source_map = this.tcx.sess.source_map();
  const range_type = is_inclusive ? "RangeInclusive" : "Range";
  const end_field = fields.find((f) => f.ident.name === sym.end);
  if (end_field === undefined) {
    return;
  }

  const element_ty = this.typeck_results.expr_ty_opt(end_field.expr);
  const is_integral = element_ty !== undefined && element_ty.is_integral();
  const end_is_negative = is_integral && end_field.expr.kind.$ === "Unary" && end_field.expr.kind._0 === "Neg";

  const sr = source_map.span_to_snippet(rcvr_expr.span);
  if (sr.$ !== "Ok") return;
  const snippet = sr._0.toString();

  let offset = 0;
  for (const c of snippet) {
    const cp = c.codePointAt(0)!;
    if (!(c === "(" || is_whitespace(cp))) break;
    offset += utf8_width(cp);
  }

  const insert_span = Span.shrink_to_lo(Span.with_lo(rcvr_expr.span, (Span.lo(rcvr_expr.span) + offset) as BytePos));

  const [value, appl]: [string, Applicability] = is_integral && !end_is_negative ? ["0", "MachineApplicable"] : ["/* start */", "HasPlaceholders"];

  err.span_suggestion_verbose(insert_span, `consider using a bounded \`${range_type}\` by adding a concrete starting value`, value, appl);
};

/// Print out the type for use in value namespace.
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3851 ty_to_value_string
FnCtxt.prototype.ty_to_value_string = function (this: FnCtxt, ty: Ty): string {
  const k = ty.kind();
  if (k.$ === "Adt") {
    return this.tcx.value_path_str_with_args(k._0.did(), k._1);
  }
  return this.ty_to_string(ty);
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3858 suggest_await_before_method
FnCtxt.prototype.suggest_await_before_method = function (this: FnCtxt, err: Diag, item_name: Ident, ty: Ty, call: hir.Expr, span: Span, return_type: Ty | undefined): void {
  const output_ty_ = this.tcx.get_impl_future_output_ty(ty);
  if (output_ty_ === undefined) return;
  const output_ty = this.deeply_resolve_ignoring_regions(output_ty_, fold_Ty);
  const method_exists = this.method_exists_for_diagnostic(item_name, output_ty, call.hir_id, return_type);
  // debug!("suggest_await_before_method: is_method_exist={}", method_exists);
  if (method_exists) {
    err.span_suggestion_verbose(Span.shrink_to_lo(span), "consider `await`ing on the `Future` and calling the method on its `Output`", "await.", "MaybeIncorrect");
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3882 set_label_for_method_error
FnCtxt.prototype.set_label_for_method_error = function (
  this: FnCtxt,
  err: Diag,
  source: SelfSource,
  rcvr_ty: Ty,
  item_ident: Ident,
  expr_id: HirId,
  span: Span,
  sugg_span: Span,
  within_macro_span: Span | undefined,
  args: readonly hir.Expr[] | undefined,
): void {
  const tcx = this.tcx;
  if (tcx.sess.source_map().is_multiline(sugg_span)) {
    err.span_context(Span.with_hi(sugg_span, Span.lo(span)));
  }
  if (within_macro_span !== undefined) {
    err.span_label(within_macro_span, "due to this macro variable");
  }

  if (source.$ === "QPath" && args !== undefined) {
    this.find_builder_fn(err, rcvr_ty, expr_id);
  }

  if (tcx.ty_is_opaque_future(rcvr_ty) && item_ident.name === sym.poll) {
    const ty_str = this.tcx.short_string(rcvr_ty, err.long_ty_path(), print_Ty);
    err.help(`method \`poll\` found on \`Pin<&mut ${ty_str}>\`, see documentation for \`std::pin::Pin\``);
    err.help("self type must be pinned to call `Future::poll`, see https://rust-lang.github.io/async-book/part-reference/pinning.html");
  }

  const span_ = (tcx.resolutions(null) as ResolverGlobalCtxt).confused_type_with_std_module.get(Span.with_parent(span, undefined));
  if (span_ !== undefined) {
    err.span_suggestion(Span.shrink_to_lo(span_), "you are looking for the module in `std`, not the primitive type", "std::", "MachineApplicable");
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3930 suggest_on_pointer_type
FnCtxt.prototype.suggest_on_pointer_type = function (this: FnCtxt, err: Diag, source: SelfSource, rcvr_ty: Ty, item_ident: Ident): void {
  const tcx = this.tcx;
  // on pointers, check if the method would exist on a reference
  if (source.$ !== "MethodCall") return;
  const rcvr_expr = source._0;
  const rk = rcvr_ty.kind();
  if (rk.$ !== "RawPtr") return;
  const ty = rk._0;
  const ptr_mutbl = rk._1;
  const r = this.lookup_probe_for_diagnostic(
    item_ident,
    Ty.new_ref(tcx, Region.new_error_misc(tcx), ty, ptr_mutbl),
    this.tcx.hir_expect_expr(this.tcx.parent_hir_id(rcvr_expr.hir_id)),
    ProbeScope.TraitsInScope,
    undefined,
  );
  if (r.$ !== "Ok") return;
  const pick = r._0;
  const pk = pick.self_ty.kind();
  if (pk.$ !== "Ref") return;
  const sugg_mutbl = pk._2;
  if (!(Mutability.is_not(sugg_mutbl) || Mutability.is_mut(ptr_mutbl))) return;
  let method: string, method_anchor: string;
  switch (sugg_mutbl) {
    case "Not": {
      switch (ptr_mutbl) {
        case "Not":
          method_anchor = "as_ref";
          break;
        case "Mut":
          method_anchor = "as_ref-1";
          break;
      }
      method = "as_ref";
      break;
    }
    case "Mut":
      [method, method_anchor] = ["as_mut", "as_mut"];
      break;
  }
  err.span_note(tcx.def_span(pick.item.def_id), `the method \`${display_Ident(item_ident)}\` exists on the type \`${display_Ty(pick.self_ty)}\``);
  const mut_str = Mutability.ptr_str(ptr_mutbl);
  err.note(`you might want to use the unsafe method \`<*${mut_str} T>::${method}\` to get an optional reference to the value behind the pointer`);
  err.note(
    `read the documentation for \`<*${mut_str} T>::${method}\` and ensure you satisfy its safety preconditions before calling it to avoid undefined behavior: https://doc.rust-lang.org/std/primitive.pointer.html#method.${method_anchor}`,
  );
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3978 suggest_use_candidates
FnCtxt.prototype.suggest_use_candidates = function (this: FnCtxt, candidates: DefId[], handle_candidates: (_1: string[], _2: string[], _3: Span) => void): void {
  const parent_map = this.tcx.visible_parent_map(null) as DefIdMap<DefId>;

  const accessible_candidates: DefId[] = [];
  const inaccessible_candidates: DefId[] = [];
  for (const id of candidates) {
    const vis = this.tcx.visibility(id);
    let ok = Visibility.is_accessible_from(vis, this.mod_id, this.tcx);
    if (ok) {
      // Visibility alone does not make `fn_name::Trait` an importable path.
      // We need to make sure all parent are modules, otherwise the path is not importable.
      for (let p = this.tcx.opt_parent(id); p !== undefined; p = this.tcx.opt_parent(p)) {
        if (this.tcx.def_kind(p).$ !== "Mod") {
          ok = false;
          break;
        }
      }
    }
    (ok ? accessible_candidates : inaccessible_candidates).push(id);
  }

  const sugg = (candidates_: DefId[], visible: boolean): string[] => {
    // Separate out candidates that must be imported with a glob, because they are named `_`
    // and cannot be referred with their identifier.
    const candidates: DefId[] = [];
    const globs: DefId[] = [];
    for (const trait_did of candidates_) {
      let keep = true;
      const parent_did = parent_map.get(trait_did);
      if (parent_did !== undefined) {
        // If the item is re-exported as `_`, we should suggest a glob-import instead.
        if (
          !DefId_eq(parent_did, this.tcx.parent(trait_did)) &&
          (this.tcx.module_children(parent_did) as readonly ModChild[])
            .filter((child) => {
              const d = Res.opt_def_id(child.res);
              return d !== undefined && DefId_eq(d, trait_did);
            })
            .every((child) => child.ident.name === kw.Underscore)
        ) {
          keep = false;
        }
      }
      (keep ? candidates : globs).push(trait_did);
    }

    const prefix = visible ? "use " : "";
    const postfix = visible ? ";" : "";
    const path_strings = candidates.map((trait_did) => `${prefix}${with_no_visible_paths_if_doc_hidden(() => with_crate_prefix(() => this.tcx.def_path_str(trait_did)))}${postfix}\n`);

    const glob_path_strings = globs.map((trait_did) => {
      const parent_did = unwrap(parent_map.get(trait_did));
      return `${prefix}${with_no_visible_paths_if_doc_hidden(() => with_crate_prefix(() => this.tcx.def_path_str(parent_did)))}::*${postfix} // trait ${display_Symbol(this.tcx.item_name(trait_did))}\n`;
    });
    const sugg = [...path_strings, ...glob_path_strings];
    sugg.sort(str_cmp);
    return sugg;
  };

  const accessible_sugg = sugg(accessible_candidates, true);
  const inaccessible_sugg = sugg(inaccessible_candidates, false);

  const [module] = this.tcx.hir_get_module(this.mod_id);
  const span = module.spans.inject_use_span;
  handle_candidates(accessible_sugg, inaccessible_sugg, span);
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:4050 suggest_valid_traits
FnCtxt.prototype.suggest_valid_traits = function (this: FnCtxt, err: Diag, item_name: Ident, valid_out_of_scope_traits_: DefId[], explain: boolean): boolean {
  const valid_out_of_scope_traits = valid_out_of_scope_traits_.filter((id) => this.tcx.is_user_visible_dep(id.krate));
  if (valid_out_of_scope_traits.length !== 0) {
    const candidates = valid_out_of_scope_traits;
    sort_by_cached_key(candidates, (id) => this.tcx.def_path_str(id), str_cmp);
    dedup_by(candidates, DefId_eq);

    // `TryFrom` and `FromIterator` have no methods
    const edition_fix = candidates.find((did) => this.tcx.is_diagnostic_item(sym.TryInto, did));

    if (explain) {
      err.help("items from traits can only be used if the trait is in scope");
    }

    const this_trait_is =
      candidates.length === 1
        ? `trait \`${display_Symbol(this.tcx.item_name(candidates[0]!))}\` which provides \`${display_Ident(item_name)}\` is`
        : `the following traits which provide \`${display_Ident(item_name)}\` are`;
    const msg = `${this_trait_is} implemented but not in scope`;

    this.suggest_use_candidates(candidates, (accessible_sugg, inaccessible_sugg, span) => {
      const suggest_for_access = (err: Diag, msg_: string, suggs: string[]): void => {
        let msg = msg_;
        msg += `; perhaps you want to import ${suggs.length === 1 ? "it" : "one of them"}`;
        err.span_suggestions(span, msg, suggs, "MaybeIncorrect");
      };
      const suggest_for_privacy = (err: Diag, suggs: string[]): void => {
        const this_trait_is =
          suggs.length === 1 ? `trait \`${suggs[0]!.trim()}\` which provides \`${display_Ident(item_name)}\` is` : `the following traits which provide \`${display_Ident(item_name)}\` are`;
        const msg = `${this_trait_is} implemented but not reachable`;
        if (suggs.length === 1) {
          err.help(msg);
        } else {
          err.help(`${msg}:\n${suggs.join("").trimEnd()}`);
        }
      };
      if (accessible_sugg.length === 0) {
        // `inaccessible_sugg` must not be empty
        suggest_for_privacy(err, inaccessible_sugg);
      } else if (inaccessible_sugg.length === 0) {
        suggest_for_access(err, msg, accessible_sugg);
      } else {
        suggest_for_access(err, msg, accessible_sugg);
        suggest_for_privacy(err, inaccessible_sugg);
      }
    });

    if (edition_fix !== undefined) {
      const did = edition_fix;
      err.note(`'${with_crate_prefix(() => this.tcx.def_path_str(did))}' is included in the prelude starting in Edition 2021`);
    }

    return true;
  } else {
    return false;
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:4132 suggest_traits_to_import
FnCtxt.prototype.suggest_traits_to_import = function (
  this: FnCtxt,
  err: Diag,
  span: Span,
  rcvr_ty: Ty,
  item_name: Ident,
  inputs_len: number | undefined,
  source: SelfSource,
  valid_out_of_scope_traits: DefId[],
  static_candidates: readonly CandidateSource[],
  unsatisfied_bounds: boolean,
  return_type: Ty | undefined,
  trait_missing_method: boolean,
): void {
  let alt_rcvr_sugg = false;
  let trait_in_other_version_found = false;
  if (source.$ === "MethodCall" && unsatisfied_bounds === false) {
    const rcvr = source._0;
    // debug!(
    //     "suggest_traits_to_import: span={:?}, item_name={:?}, rcvr_ty={:?}, rcvr={:?}",
    //     span, item_name, rcvr_ty, rcvr
    // );
    const skippable = [
      this.tcx.lang_items().clone_trait(),
      this.tcx.lang_items().deref_trait(),
      this.tcx.lang_items().deref_mut_trait(),
      this.tcx.lang_items().drop_trait(),
      this.tcx.get_diagnostic_item(sym.AsRef),
    ];
    /** PORT: `skippable.contains(&did)` on `[Option<DefId>; 5]`. */
    const skippable_contains = (did: DefId | undefined): boolean =>
      skippable.some((s) => (s === undefined ? did === undefined : did !== undefined && DefId_eq(s, did)));
    // Try alternative arbitrary self types that could fulfill this call.
    // FIXME: probe for all types that *could* be arbitrary self-types, not
    // just this list.
    const alts: [Ty, string, string | undefined][] = [
      [rcvr_ty, "", undefined],
      [Ty.new_mut_ref(this.tcx, this.tcx.lifetimes.re_erased, rcvr_ty), "&mut ", "as_mut"],
      [Ty.new_imm_ref(this.tcx, this.tcx.lifetimes.re_erased, rcvr_ty), "&", "as_ref"],
    ];
    for (const [rcvr_ty, post, pin_call] of alts) {
      const r = this.lookup_probe_for_diagnostic(item_name, rcvr_ty, rcvr, ProbeScope.AllTraits, return_type);
      if (r.$ === "Ok") {
        const pick = r._0;
        // If the method is defined for the receiver we have, it likely wasn't `use`d.
        // We point at the method, but we just skip the rest of the check for arbitrary
        // self types and rely on the suggestion to `use` the trait from
        // `suggest_valid_traits`.
        const did = AssocItem.container_id(pick.item, this.tcx);
        if (skippable_contains(did)) {
          continue;
        }
        trait_in_other_version_found = this.detect_and_explain_multiple_crate_versions_of_trait_item(err, pick.item.def_id, rcvr.hir_id, rcvr_ty);
        if (pick.autoderefs === 0 && !trait_in_other_version_found) {
          err.span_label(AssocItem.ident(pick.item, this.tcx).span, `the method is available for \`${display_Ty(rcvr_ty)}\` here`);
        }
        break;
      } else if (r._0.$ === "Ambiguity") {
        // If the method is defined (but ambiguous) for the receiver we have, it is also
        // likely we haven't `use`d it. It may be possible that if we `Box`/`Pin`/etc.
        // the receiver, then it might disambiguate this method, but I think these
        // suggestions are generally misleading (see #94218).
        break;
      } else {
        // Err(_) => ()
      }

      const unpin_trait = this.tcx.lang_items().unpin_trait();
      if (unpin_trait === undefined) {
        return;
      }
      const pred = TraitRef.new(as_interner(this.tcx), unpin_trait, [GenericArg.from_Ty(rcvr_ty)]);
      const unpin = this.predicate_must_hold_considering_regions(
        Obligation.new(this.tcx, this.misc(rcvr.span), this.param_env, pred, (from, _interner) => Predicate_upcast_from_TraitRef(from, this.tcx)),
      );
      const wrappers: [Ty | undefined, string][] = [
        [Ty.new_lang_item(this.tcx, rcvr_ty, LangItem.OwnedBox), "Box::new"],
        [Ty.new_lang_item(this.tcx, rcvr_ty, LangItem.Pin), "Pin::new"],
        [Ty.new_diagnostic_item(this.tcx, rcvr_ty, sym.Arc), "Arc::new"],
        [Ty.new_diagnostic_item(this.tcx, rcvr_ty, sym.Rc), "Rc::new"],
      ];
      for (const [rcvr_ty_, pre] of wrappers) {
        if (rcvr_ty_ === undefined) continue;
        const new_rcvr_t = rcvr_ty_;
        const r2 = this.lookup_probe_for_diagnostic(item_name, new_rcvr_t, rcvr, ProbeScope.AllTraits, return_type);
        if (r2.$ !== "Ok") continue;
        const pick = r2._0;
        // debug!("try_alt_rcvr: pick candidate {:?}", pick);
        const did = AssocItem.trait_container(pick.item, this.tcx);
        // We don't want to suggest a container type when the missing
        // method is `.clone()` or `.deref()` otherwise we'd suggest
        // `Arc::new(foo).clone()`, which is far from what the user wants.
        // Explicitly ignore the `Pin::as_ref()` method as `Pin` does not
        // implement the `AsRef` trait.
        const skip =
          skippable_contains(did) ||
          ("Pin::new" === pre && (sym.as_ref === item_name.name || !unpin)) ||
          (inputs_len !== undefined &&
            AssocItem.is_fn(pick.item) &&
            FnSig.inputs(Binder.skip_binder(EarlyBinder.skip_binder(this.tcx.fn_sig(pick.item.def_id) as EarlyBinder<PolyFnSigT>))).length !== inputs_len);
        // Make sure the method is defined for the *actual* receiver: we don't
        // want to treat `Box<Self>` as a receiver if it only works because of
        // an autoderef to `&self`
        if (pick.autoderefs === 0 && !skip) {
          err.span_label(AssocItem.ident(pick.item, this.tcx).span, `the method is available for \`${display_Ty(new_rcvr_t)}\` here`);
          err.multipart_suggestion(
            "consider wrapping the receiver expression with the appropriate type",
            [
              [Span.shrink_to_lo(rcvr.span), `${pre}(${post}`],
              [Span.shrink_to_hi(rcvr.span), ")"],
            ],
            "MaybeIncorrect",
          );
          // We don't care about the other suggestions.
          alt_rcvr_sugg = true;
        }
      }
      // We special case the situation where `Pin::new` wouldn't work, and instead
      // suggest using the `pin!()` macro instead.
      const new_rcvr_t = Ty.new_lang_item(this.tcx, rcvr_ty, LangItem.Pin);
      let pick: Pick | undefined;
      if (
        new_rcvr_t !== undefined &&
        // We didn't find an alternative receiver for the method.
        !alt_rcvr_sugg &&
        // `T: !Unpin`
        !unpin &&
        // Either `Pin::as_ref` or `Pin::as_mut`.
        pin_call !== undefined &&
        // Search for `item_name` as a method accessible on `Pin<T>`.
        (pick = ((r) => (r.$ === "Ok" ? r._0 : undefined))(this.lookup_probe_for_diagnostic(item_name, new_rcvr_t, rcvr, ProbeScope.AllTraits, return_type))) !== undefined &&
        // We skip some common traits that we don't want to consider because autoderefs
        // would take care of them.
        !skippable_contains(AssocItem.container_id(pick.item, this.tcx)) &&
        // Do not suggest pinning when the method is directly on `Pin`.
        ((did) => {
          if (did === undefined) return true;
          const k = EarlyBinder.skip_binder(this.tcx.type_of(did) as EarlyBinder<Ty>).kind();
          if (k.$ === "Adt") {
            const pin_type = this.tcx.lang_items().pin_type();
            return !(pin_type !== undefined && DefId_eq(k._0.did(), pin_type));
          }
          return true;
        })(AssocItem.impl_container(pick.item, this.tcx)) &&
        // We don't want to go through derefs.
        pick.autoderefs === 0 &&
        // Check that the method of the same name that was found on the new `Pin<T>`
        // receiver has the same number of arguments that appear in the user's code.
        inputs_len !== undefined &&
        AssocItem.is_fn(pick.item) &&
        FnSig.inputs(Binder.skip_binder(EarlyBinder.skip_binder(this.tcx.fn_sig(pick.item.def_id) as EarlyBinder<PolyFnSigT>))).length === inputs_len
      ) {
        const indent_ = this.tcx.sess.source_map().indentation_before(rcvr.span);
        const indent = indent_ === undefined ? " " : indent_.toString();
        let expr = rcvr;
        for (;;) {
          const n = this.tcx.parent_hir_node(expr.hir_id);
          if (n.$ === "Expr" && n._0.kind.$ === "MethodCall") {
            expr = n._0;
          } else {
            break;
          }
        }
        const pn = this.tcx.parent_hir_node(expr.hir_id);
        let code: Result<Str, unknown> | undefined;
        if (pn.$ === "LetStmt" && pn._0.init !== undefined && (code = this.tcx.sess.source_map().span_to_snippet(rcvr.span)).$ === "Ok") {
          const stmt = pn._0;
          const init = pn._0.init;
          // We need to take care to account for the existing binding when we
          // suggest the code.
          err.multipart_suggestion(
            "consider pinning the expression",
            [
              [Span.shrink_to_lo(stmt.span), `let mut pinned = std::pin::pin!(${code._0.toString()});\n${indent}`],
              [Span.until(init.span, Span.shrink_to_hi(rcvr.span)), `pinned.${pin_call}()`],
            ],
            "MaybeIncorrect",
          );
        } else if (pn.$ === "Block" || pn.$ === "Stmt") {
          // There's no binding, so we can provide a slightly nicer looking
          // suggestion.
          err.multipart_suggestion(
            "consider pinning the expression",
            [
              [Span.shrink_to_lo(rcvr.span), "let mut pinned = std::pin::pin!("],
              [Span.shrink_to_hi(rcvr.span), `);\n${indent}pinned.${pin_call}()`],
            ],
            "MaybeIncorrect",
          );
        } else {
          // We don't quite know what the users' code looks like, so we don't
          // provide a pinning suggestion.
          err.span_help(rcvr.span, "consider pinning the expression with `std::pin::pin!()` and assigning that to a new binding");
        }
        // We don't care about the other suggestions.
        alt_rcvr_sugg = true;
      }
    }
  }

  if (source.$ === "QPath" && valid_out_of_scope_traits.length !== 0 && source._0.kind.$ === "Path" && source._0.kind._0.$ === "Resolved") {
    const ty = source._0;
    const assoc = AssocItems.filter_by_name_unhygienic(this.tcx.associated_items(valid_out_of_scope_traits[0]!) as AssocItems, item_name.name).next();
    if (!assoc.done) {
      // See if the `Type::function(val)` where `function` wasn't found corresponds to a
      // `Trait` that is imported directly, but `Type` came from a different version of the
      // same crate.

      const rcvr_ty = this.node_ty_opt(ty.hir_id);
      trait_in_other_version_found = this.detect_and_explain_multiple_crate_versions_of_trait_item(err, assoc.value.def_id, ty.hir_id, rcvr_ty);
    }
  }
  if (!trait_in_other_version_found && this.suggest_valid_traits(err, item_name, valid_out_of_scope_traits, true)) {
    return;
  }

  const type_is_local = this.type_derefs_to_local(span, rcvr_ty, source);

  const arbitrary_rcvr: Span[] = [];
  // There are no traits implemented, so lets suggest some traits to
  // implement, by finding ones that have the item name, and are
  // legal to implement.
  // PORT: the three lazy `.filter(..)`s run per element in sequence (the third pushes to `arbitrary_rcvr`).
  const candidates = all_traits(this.tcx).filter(
    (info) =>
      // Don't issue suggestions for unstable traits since they're
      // unlikely to be implementable anyway
      ((): boolean => {
        const attr = this.tcx.lookup_stability(info.def_id) as Stability | undefined;
        return attr !== undefined ? StabilityLevel.is_stable(attr.level) : true;
      })() &&
      // Static candidates are already implemented, and known not to work
      // Do not suggest them again
      static_candidates.every((sc) => {
        switch (sc.$) {
          case "Trait":
            return !DefId_eq(sc._0, info.def_id);
          case "Impl": {
            const t = this.tcx.impl_opt_trait_id(sc._0);
            return !(t !== undefined && DefId_eq(t, info.def_id));
          }
        }
      }) &&
      ((): boolean => {
        // We approximate the coherence rules to only suggest
        // traits that are legal to implement by requiring that
        // either the type or trait is local. Multi-dispatch means
        // this isn't perfect (that is, there are cases when
        // implementing a trait would be legal but is rejected
        // here).
        if (!((type_is_local || info.def_id.is_local()) && !this.tcx.trait_is_auto(info.def_id))) return false;
        const item = this.associated_value(info.def_id, item_name);
        if (item === undefined) return false;
        if (AssocItem.is_fn(item)) {
          const local = item.def_id.as_local();
          const id = local === undefined ? undefined : this.tcx.hir_node_by_def_id(local);
          if (id !== undefined && id.$ === "TraitItem" && id._0.kind.$ === "Fn") {
            const fn_sig = id._0.kind._0;
            const method = id._0.kind._1;
            let self_first_arg: boolean;
            switch (method.$) {
              case "Required": {
                const ident = method._0[0];
                self_first_arg = method._0.length >= 1 && ident !== undefined && ident.name === kw.SelfLower;
                break;
              }
              case "Provided": {
                const param = this.tcx.hir_body(method._0).params[0];
                self_first_arg = param !== undefined && param.pat.kind.$ === "Binding" && param.pat.kind._2.name === kw.SelfLower;
                break;
              }
            }

            if (!ImplicitSelfKind.has_implicit_self(fn_sig.decl.implicit_self()) && self_first_arg) {
              const ty = fn_sig.decl.inputs[0];
              if (ty !== undefined) {
                arbitrary_rcvr.push(ty.span);
              }
              return false;
            }
          }
        }
        // We only want to suggest public or local traits (#45781).
        return Visibility.is_public(AssocItem.visibility(item, this.tcx)) || info.def_id.is_local();
      })(),
  );
  for (const span of arbitrary_rcvr) {
    err.span_label(span, "the method might not be found because of this arbitrary self type");
  }
  if (alt_rcvr_sugg) {
    return;
  }

  if (candidates.length !== 0) {
    // Sort local crate results before others
    sort_by_cached_key(
      candidates,
      (info): [boolean, string] => [!info.def_id.is_local(), this.tcx.def_path_str(info.def_id)],
      (a, b) => (a[0] !== b[0] ? (a[0] ? 1 : -1) : str_cmp(a[1], b[1])),
    );
    dedup_by(candidates, (a, b) => DefId_eq(a.def_id, b.def_id));

    let param_type: ParamTy | undefined;
    const rk = rcvr_ty.kind();
    if (rk.$ === "Param") {
      param_type = rk._0;
    } else if (rk.$ === "Ref") {
      const ik = rk._1.kind();
      param_type = ik.$ === "Param" ? ik._0 : undefined;
    } else {
      param_type = undefined;
    }
    if (!trait_missing_method) {
      err.help(
        param_type !== undefined
          ? "items from traits can only be used if the type parameter is bounded by the trait"
          : "items from traits can only be used if the trait is implemented and in scope",
      );
    }

    const candidates_len = candidates.length;
    const message = (action: string): string =>
      `the following ${candidates_len === 1 ? "trait defines" : "traits define"} an item \`${display_Ident(item_name)}\`, perhaps you need to ${action} ${candidates_len === 1 ? "it" : "one of them"}:`;
    // Obtain the span for `param` and use it for a structured suggestion.
    if (param_type !== undefined) {
      const param = param_type;
      const generics = this.tcx.generics_of(LocalDefId.to_def_id(this.body_def_id)) as Generics;
      const type_param = generics.type_param(param, this.tcx);
      const tcx = this.tcx;
      const def_id = type_param.def_id.as_local();
      if (def_id !== undefined) {
        const id = tcx.local_def_id_to_hir_id(def_id);
        // Get the `hir::Param` to verify whether it already has any bounds.
        // We do this to avoid suggesting code that ends up as `T: FooBar`,
        // instead we suggest `T: Foo + Bar` in that case.
        const node = tcx.hir_node(id);
        if (node.$ === "GenericParam") {
          const param = node._0;
          type Introducer = "Plus" | "Colon" | "Nothing";
          const hir_generics = unwrap(tcx.hir_get_generics(id.owner.def_id));
          const trait_def_ids = new DefIdSet();
          for (const bp of hir_generics.bounds_for_param(def_id)) {
            for (const bound of bp.bounds) {
              const tr = GenericBound.trait_ref(bound);
              const d = tr === undefined ? undefined : tr.trait_def_id();
              if (d !== undefined) trait_def_ids.add(d);
            }
          }
          if (candidates.some((t) => trait_def_ids.has(t.def_id))) {
            return;
          }
          const msg = message(`restrict type parameter \`${display_Ident(ParamName.ident(param.name))}\` with`);
          const bounds_span = hir_generics.bounds_span_for_suggestions(def_id);
          let applicability: Applicability = "MaybeIncorrect";
          // Format the path of each suggested candidate, providing placeholders
          // for any generic arguments without defaults.
          const candidate_strs = candidates.map((cand) => {
            const cand_path = tcx.def_path_str(cand.def_id);
            const cand_params = (tcx.generics_of(cand.def_id) as Generics).own_params;
            const cand_args = cand_params
              .slice(1)
              .filter((param) => !((param.kind.$ === "Type" && param.kind.has_default) || (param.kind.$ === "Const" && param.kind.has_default)))
              .map((param) => Symbol.as_str(param.name))
              .join(", ");
            if (cand_args.length === 0) {
              return cand_path;
            } else {
              applicability = "HasPlaceholders";
              return `${cand_path}</* ${cand_args} */>`;
            }
          });

          if (rcvr_ty.is_ref() && param.is_impl_trait() && bounds_span !== undefined) {
            const [bounds_span_] = bounds_span;
            err.multipart_suggestions(
              msg,
              candidate_strs.map((cand): [Span, string][] => [
                [Span.shrink_to_lo(param.span), "("],
                [bounds_span_, ` + ${cand})`],
              ]),
              applicability,
            );
            return;
          }

          let sp: Span, introducer: Introducer, open_paren_sp: Span | undefined;
          if (bounds_span !== undefined) {
            const [span, open_paren_sp_] = bounds_span;
            [sp, introducer, open_paren_sp] = [span, "Plus", open_paren_sp_];
          } else if (param.colon_span !== undefined) {
            [sp, introducer, open_paren_sp] = [Span.shrink_to_hi(param.colon_span), "Nothing", undefined];
          } else if (param.is_impl_trait()) {
            [sp, introducer, open_paren_sp] = [Span.shrink_to_hi(param.span), "Plus", undefined];
          } else {
            [sp, introducer, open_paren_sp] = [Span.shrink_to_hi(param.span), "Colon", undefined];
          }

          const all_suggs = candidate_strs.map((cand) => {
            const suggestion = `${introducer === "Plus" ? " +" : introducer === "Colon" ? ":" : ""} ${cand}`;

            const suggs: [Span, string][] = [];

            if (open_paren_sp !== undefined) {
              suggs.push([open_paren_sp, "("]);
              suggs.push([sp, `)${suggestion}`]);
            } else {
              suggs.push([sp, suggestion]);
            }

            return suggs;
          });

          err.multipart_suggestions(msg, all_suggs, applicability);

          return;
        } else if (node.$ === "Item" && node._0.kind.$ === "Trait") {
          const ident = node._0.kind.ident;
          const bounds = node._0.kind.bounds;
          let sp: Span, sep: string, article: string;
          if (bounds.length === 0) {
            [sp, sep, article] = [Span.shrink_to_hi(ident.span), ":", "a"];
          } else {
            [sp, sep, article] = [Span.shrink_to_hi(GenericBound.span(bounds[bounds.length - 1]!)), " +", "another"];
          }
          err.span_suggestions(
            sp,
            message(`add ${article} supertrait for`),
            candidates.map((t) => `${sep} ${tcx.def_path_str(t.def_id)}`),
            "MaybeIncorrect",
          );
          return;
        }
      }
    }

    let potential_candidates: TraitInfo[];
    let explicitly_negative: TraitInfo[];
    const simp_rcvr_ty = param_type !== undefined ? undefined : simplify_type(as_interner(this.tcx), rcvr_ty, "AsRigid");
    if (param_type !== undefined) {
      // FIXME: Even though negative bounds are not implemented, we could maybe handle
      // cases where a positive bound implies a negative impl.
      [potential_candidates, explicitly_negative] = [candidates, []];
    } else if (simp_rcvr_ty !== undefined) {
      potential_candidates = [];
      explicitly_negative = [];
      for (const candidate of candidates) {
        // Check if there's a negative impl of `candidate` for `rcvr_ty`
        let any = false;
        for (const imp_did of this.tcx.all_impls(candidate.def_id)) {
          const header = this.tcx.impl_trait_header(imp_did) as ImplTraitHeader;
          if (header.polarity === "Positive") continue;
          const imp = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(header.trait_ref));
          const imp_simp = simplify_type(as_interner(this.tcx), TraitRef.self_ty(imp), "AsRigid");
          if (imp_simp !== undefined && SimplifiedType_key(imp_simp) === SimplifiedType_key(simp_rcvr_ty)) {
            any = true;
            break;
          }
        }
        if (any) {
          explicitly_negative.push(candidate);
        } else {
          potential_candidates.push(candidate);
        }
      }
    } else {
      // We don't know enough about `recv_ty` to make proper suggestions.
      [potential_candidates, explicitly_negative] = [candidates, []];
    }

    const impls_trait = (def_id: DefId): boolean => {
      const args = RawList.for_item(this.tcx, def_id, (param, _) => {
        if (param.index === 0) {
          return GenericArg.from_Ty(rcvr_ty);
        } else {
          return this.infcx.var_for_def(span, param);
        }
      });
      return EvaluationResult.must_apply_modulo_regions(this.infcx.type_implements_trait(def_id, args, this.param_env)) && param_type === undefined;
    };
    if (potential_candidates.length === 0) {
      // []
    } else if (potential_candidates.length === 1 && potential_candidates[0]!.def_id.is_local()) {
      const trait_info = potential_candidates[0]!;
      if (impls_trait(trait_info.def_id)) {
        this.suggest_valid_traits(err, item_name, [trait_info.def_id], false);
      } else {
        err.subdiagnostic(
          diagnostics.CandidateTraitNote_subdiagnostic({
            span: this.tcx.def_span(trait_info.def_id),
            trait_name: this.tcx.def_path_str(trait_info.def_id),
            item_name,
            action_or_ty: trait_missing_method
              ? "NONE"
              : param_type === undefined
                ? "implement" // FIXME: it might only need to be imported into scope, not implemented.
                : display_ParamTy(param_type),
          }),
        );
      }
    } else {
      const trait_infos = potential_candidates;
      let msg = message(
        param_type === undefined
          ? "implement" // FIXME: it might only need to be imported into scope, not implemented.
          : `restrict type parameter \`${display_ParamTy(param_type)}\` with`,
      );
      for (const [i, trait_info] of trait_infos.entries()) {
        if (impls_trait(trait_info.def_id)) {
          this.suggest_valid_traits(err, item_name, [trait_info.def_id], false);
        }
        msg += `\ncandidate #${i + 1}: \`${this.tcx.def_path_str(trait_info.def_id)}\``;
      }
      err.note(msg);
    }
    if (explicitly_negative.length === 0) {
      // []
    } else if (explicitly_negative.length === 1) {
      const trait_info = explicitly_negative[0]!;
      const msg = `the trait \`${this.tcx.def_path_str(trait_info.def_id)}\` defines an item \`${display_Ident(item_name)}\`, but is explicitly unimplemented`;
      err.note(msg);
    } else {
      const trait_infos = explicitly_negative;
      let msg = `the following traits define an item \`${display_Ident(item_name)}\`, but are explicitly unimplemented:`;
      for (const trait_info of trait_infos) {
        msg += `\n${this.tcx.def_path_str(trait_info.def_id)}`;
      }
      err.note(msg);
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:4799 detect_and_explain_multiple_crate_versions_of_trait_item
FnCtxt.prototype.detect_and_explain_multiple_crate_versions_of_trait_item = function (this: FnCtxt, err: Diag, item_def_id: DefId, hir_id_: HirId, rcvr_ty: Ty | undefined): boolean {
  const hir_id = this.tcx.parent_hir_id(hir_id_);
  const traits = this.tcx.in_scope_traits(hir_id);
  if (traits === undefined) return false;
  if (traits.length === 0) {
    return false;
  }
  const trait_def_id = this.tcx.parent(item_def_id);
  if (!this.tcx.is_trait(trait_def_id)) {
    return false;
  }
  const node = this.tcx.hir_node(hir_id);
  if (node.$ !== "Expr") {
    return false;
  }
  const rcvr = node._0;
  // The trait may have generic parameters beyond `Self` (e.g. `Borrow<Borrowed>`), and
  // `rcvr_ty` may even be unknown. We only ever know the receiver type (the `Self` arg),
  // so fill `Self` from `rcvr_ty` when available and the remaining parameters with fresh
  // inference variables; building a `TraitRef` with a partial arg list would otherwise trip
  // `debug_assert_args_compatible` and ICE. See #157189.
  const trait_ref = TraitRef.new_from_args(
    as_interner(this.tcx),
    trait_def_id,
    RawList.for_item(this.tcx, trait_def_id, (param, _) => {
      if (param.index === 0 && rcvr_ty !== undefined) {
        return GenericArg.from_Ty(rcvr_ty);
      } else {
        return this.var_for_def(rcvr.span, param);
      }
    }),
  );
  const trait_pred = Binder.dummy<TraitClause>({ trait_ref, polarity: "Positive" }, fold_TraitClause);
  const obligation = Obligation.new(this.tcx, this.misc(rcvr.span), this.param_env, trait_ref, (from, _interner) => Predicate_upcast_from_TraitRef(from, this.tcx));
  return this.err_ctxt().note_different_trait_with_same_name(err, obligation, trait_pred);
};

/// issue #102320, for `unwrap_or` with closure as argument, suggest `unwrap_or_else`
/// FIXME: currently not working for suggesting `map_or_else`, see #102408
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:4846 suggest_else_fn_with_closure
FnCtxt.prototype.suggest_else_fn_with_closure = function (this: FnCtxt, err: Diag, expr: hir.Expr, found: Ty, expected: Ty): boolean {
  const callable = this.extract_callable_info(found);
  if (callable === undefined) {
    return false;
  }
  const [_def_id_or_name, output, _inputs] = callable;

  if (!this.may_coerce(output, expected)) {
    return false;
  }

  const node = this.tcx.parent_hir_node(expr.hir_id);
  if (node.$ === "Expr" && node._0.kind.$ === "MethodCall") {
    const method_name = node._0.kind._0.ident;
    const self_expr = node._0.kind._1;
    const args = node._0.kind._2;
    const self_ty = this.typeck_results.expr_ty_opt(self_expr);
    if (self_ty !== undefined) {
      const new_name = new Ident(Symbol.intern(`${method_name.as_str()}_else`), method_name.span);
      const probe = this.lookup_probe_for_diagnostic(new_name, self_ty, self_expr, ProbeScope.TraitsInScope, expected);

      // check the method arguments number
      if (probe.$ === "Ok") {
        const pick = probe._0;
        const fn_sig = this.tcx.fn_sig(pick.item.def_id) as EarlyBinder<PolyFnSigT>;
        const fn_args = FnSig.inputs(Binder.skip_binder(EarlyBinder.skip_binder(fn_sig)));
        if (fn_args.length === args.length + 1) {
          err.span_suggestion_verbose(Span.shrink_to_hi(method_name.span), `try calling \`${Symbol.as_str(new_name.name)}\` instead`, "_else", "MaybeIncorrect");
          return true;
        }
      }
    }
  }
  return false;
};

/// Checks whether there is a local type somewhere in the chain of
/// autoderefs of `rcvr_ty`.
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:4902 type_derefs_to_local
FnCtxt.prototype.type_derefs_to_local = function (this: FnCtxt, span: Span, rcvr_ty: Ty, source: SelfSource): boolean {
  // rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:4908 is_local
  function is_local(ty: Ty): boolean {
    const k = ty.kind();
    switch (k.$) {
      case "Adt":
        return k._0.did().is_local();
      case "Foreign":
        return k._0.is_local();
      case "Dynamic": {
        const d = k._0.principal();
        return d !== undefined && PolyExistentialTraitRef.def_id(d).is_local();
      }
      case "Param":
        return true;

      // Everything else (primitive types, etc.) is effectively
      // non-local (there are "edge" cases, e.g., `(LocalType,)`, but
      // the noise from these sort of types is usually just really
      // annoying, rather than any sort of help).
      default:
        return false;
    }
  }

  // This occurs for UFCS desugaring of `T::method`, where there is no
  // receiver expression for the method call, and thus no autoderef.
  if (source.$ === "QPath") {
    return is_local(rcvr_ty);
  }

  for (const [ty] of this.autoderef(span, rcvr_ty).silence_errors()) {
    if (is_local(ty)) return true;
  }
  return false;
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:4932 suggest_hashmap_on_unsatisfied_hashset_buildhasher
FnCtxt.prototype.suggest_hashmap_on_unsatisfied_hashset_buildhasher = function (this: FnCtxt, err: Diag, pred: TraitClause, adt: AdtDef): boolean {
  if (this.tcx.is_diagnostic_item(sym.HashSet, adt.did()) && this.tcx.is_diagnostic_item(sym.BuildHasher, TraitClause.def_id(pred))) {
    err.help("you might have intended to use a HashMap instead");
    return true;
  } else {
    return false;
  }
};

/// Retrieves all traits in this crate and any dependent crates,
/// and wraps them into `TraitInfo` for custom sorting.
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:4962 all_traits
export function all_traits(tcx: TyCtxt): TraitInfo[] {
  return [...tcx.all_traits_including_private()].map((def_id) => ({ def_id }));
}

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:4966 print_disambiguation_help
export function print_disambiguation_help(
  tcx: TyCtxt,
  err: Diag,
  source: SelfSource,
  args: readonly hir.Expr[] | undefined,
  trait_ref_: TraitRef,
  candidate_idx: number | undefined,
  span: Span,
  item: AssocItem,
): string | undefined {
  const trait_impl_type = TraitRef.self_ty(trait_ref_).peel_refs();
  const trait_ref = AssocItem.is_method(item)
    ? display_TraitRefPrintOnlyTraitName(TraitRef_print_only_trait_name(trait_ref_))
    : `<${display_GenericArg(trait_ref_.args[0]!)} as ${display_TraitRefPrintOnlyTraitName(TraitRef_print_only_trait_name(trait_ref_))}>`;
  if (AssocItem.is_fn(item) && source.$ === "MethodCall" && args !== undefined) {
    const receiver = source._0;
    const def_kind_descr = tcx.def_kind_descr(AssocItem.as_def_kind(item), item.def_id);
    const item_name = AssocItem.ident(item, tcx);
    const first_input = FnSig.inputs(Binder.skip_binder(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(item.def_id) as EarlyBinder<PolyFnSigT>))))[0];
    const first_arg_type = first_input === undefined ? undefined : first_input.peel_refs();
    const rcvr_mutbl = first_input === undefined ? undefined : first_input.ref_mutability();
    const rcvr_ref = rcvr_mutbl === undefined ? "" : Mutability.ref_prefix_str(rcvr_mutbl);

    // If the type of first arg of this assoc function is `Self` or current trait impl type or `arbitrary_self_types`, we need to take the receiver as args. Otherwise, we don't.
    const args_ = (
      first_arg_type !== undefined && (first_arg_type === tcx.types.self_param || first_arg_type === trait_impl_type || AssocItem.is_method(item)) ? [receiver] : []
    )
      .concat(args)
      .map((arg) => {
        const r = tcx.sess.source_map().span_to_snippet(arg.span);
        return r.$ === "Ok" ? r._0.toString() : "_";
      })
      .join(", ");

    const args_str = `(${rcvr_ref}${args_})`;
    err.span_suggestion_verbose(
      span,
      `disambiguate the ${def_kind_descr} for ${candidate_idx !== undefined ? `candidate #${candidate_idx}` : "the candidate"}`,
      `${trait_ref}::${display_Ident(item_name)}${args_str}`,
      "HasPlaceholders",
    );
    return undefined;
  } else {
    return `${trait_ref}::`;
  }
}
