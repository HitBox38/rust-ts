// Port of compiler/rustc_trait_selection/src/error_reporting/traits/overflow.rs (lane errctxt-contract).
//
// - `enum OverflowCause` is generated (overflow.gen.ts).
// - The `impl TypeErrCtxt` methods are declared in ../../decls.ts (`// error_reporting/traits/overflow.rs:<line>`) and assigned
//   onto `TypeErrCtxt.prototype` here. `T: Upcast<TyCtxt, Predicate>` is the parameter `upcast_from_T` (decls.ts).
// - The nested fn `with_short_path<T: Display + Print>` takes `T`'s Display and Print as `display_T` / `print_T`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other crates;
// other rustc_trait_selection modules are read inside function bodies only.
export * from "./overflow.gen.ts";
import { type Diag, E0275, struct_span_code_err } from "../../../rustc_errors/lib.ts";
import { Namespace } from "../../../rustc_hir/def.ts";
import type { Obligation, PredicateObligation, PredicateObligations } from "../../../rustc_infer/traits/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Predicate, Term } from "../../../rustc_middle/ty/decls.ts";
import type { PrettyPrinter } from "../../../rustc_middle/ty/print/pretty.ts";
import { display_Predicate, display_Term, display_Ty, FmtPrinter, print_AliasTerm, print_Predicate, print_Term } from "../../../rustc_middle/ty/print/pretty.ts";
import type { PrintResult } from "../../../rustc_middle/ty/print/mod.ts";
import { fold_Predicate } from "../../../rustc_middle/ty/structural_impls.ts";
import { DefIdSet, LOCAL_CRATE } from "../../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../../rustc_span/lib.ts";
import { display_Symbol } from "../../../rustc_span/symbol.ts";
import { display_Limit, Limit, Limit_mul } from "../../../rustc_structures/limit.ts";
import { Binder } from "../../../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import type { Interner } from "../../../rustc_type_ir/interner.ts";
import { upcast_from_self } from "../../../rustc_type_ir/upcast.ts";
import { display_AliasTerm } from "../../../rustc_type_ir/ir_print.ts";
import { AliasTermKind, fold_with_AliasTermKind, try_fold_with_AliasTermKind, visit_with_AliasTermKind } from "../../../rustc_type_ir/term_kind.ts";
import { type AliasTerm, fold_with_Alias, try_fold_with_Alias, visit_with_Alias } from "../../../rustc_type_ir/ty/alias.ts";
import { assert, panic } from "../../../std/panic.ts";
import { utf8_len } from "../../../std/str.ts";
import { TypeErrCtxt } from "../../decls.ts";
import type { OverflowCause } from "./overflow.gen.ts";

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/overflow.rs:20 suggest_new_overflow_limit
export function suggest_new_overflow_limit(tcx: TyCtxt, err: Diag): void {
  const limit = tcx.recursion_limit();
  const suggested_limit = limit._0 === 0 ? Limit.new(2) : Limit_mul(limit, 2);
  err.help(
    `consider increasing the recursion limit by adding a \`#![recursion_limit = "${display_Limit(suggested_limit)}"]\` attribute to your crate (\`${display_Symbol(tcx.crate_name(LOCAL_CRATE))}\`)`,
  );
}

// impl<'a, 'tcx> TypeErrCtxt<'a, 'tcx>

/// Reports that an overflow has occurred and halts compilation. We
/// halt compilation unconditionally because it is important that
/// overflows never be masked -- they basically represent computations
/// whose result could not be truly determined and thus we can't say
/// if the program type checks or not -- and they are unusual
/// occurrences in any case.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/overflow.rs:40 report_overflow_error
TypeErrCtxt.prototype.report_overflow_error = function (
  this: TypeErrCtxt,
  cause: OverflowCause,
  span: Span,
  suggest_increasing_limit: boolean,
  mutate: (_0: Diag) => void,
): never {
  const err = this.build_overflow_error(cause, span, suggest_increasing_limit);
  mutate(err);
  return err.emit_err().raise_fatal();
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/overflow.rs:52 build_overflow_error
TypeErrCtxt.prototype.build_overflow_error = function (this: TypeErrCtxt, cause: OverflowCause, span: Span, suggest_increasing_limit: boolean): Diag {
  // PORT: `T: fmt::Display + for<'b> Print<FmtPrinter<'b, 'tcx>>` are the parameters `display_T` / `print_T`.
  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/overflow.rs:58 with_short_path
  function with_short_path<T>(tcx: TyCtxt, value: T, display_T: (t: T) => string, print_T: (t: T, p: PrettyPrinter) => PrintResult): string {
    const s = display_T(value);
    if (utf8_len(s) > 50) {
      // We don't need to save the type to a file, we will be talking about this type already
      // in a separate note when we explain the obligation, so it will be available that way.
      const p: FmtPrinter = FmtPrinter.new_with_limit(tcx, Namespace.TypeNS, Limit.new(6));
      const r = print_T(value, p);
      if (r.$ === "Err") panic("called `Result::unwrap()` on an `Err` value: Error");
      return p.into_buffer();
    } else {
      return s;
    }
  }

  let err: Diag;
  switch (cause.$) {
    case "DeeplyNormalize": {
      const alias_term = this.deeply_resolve_ignoring_regions(cause._0, d_AliasTerm);
      const kind = AliasTermKind.descr(alias_term.kind);
      const alias_str = with_short_path(this.tcx, alias_term, display_AliasTerm, print_AliasTerm);
      err = struct_span_code_err(this.dcx(), span, E0275, `overflow normalizing the ${kind} \`${alias_str}\``);
      break;
    }
    case "TraitSolver": {
      const predicate = this.deeply_resolve_ignoring_regions(cause._0, fold_Predicate);
      const kind = Binder.skip_binder(predicate.kind());
      if (kind.$ === "Subtype" || kind.$ === "Coerce") {
        const { a, b } = kind._0;
        err = struct_span_code_err(this.dcx(), span, E0275, `overflow assigning \`${display_Ty(a)}\` to \`${display_Ty(b)}\``);
      } else if (kind.$ === "Clause" && kind._0.$ === "WellFormed") {
        const term = with_short_path<Term>(this.tcx, kind._0._0, display_Term, print_Term);
        err = struct_span_code_err(this.dcx(), span, E0275, `overflow evaluating whether \`${term}\` is well-formed`);
      } else {
        const pred_str = with_short_path(this.tcx, predicate, display_Predicate, print_Predicate);
        err = struct_span_code_err(this.dcx(), span, E0275, `overflow evaluating the requirement \`${pred_str}\``);
      }
      break;
    }
  }

  if (suggest_increasing_limit) {
    suggest_new_overflow_limit(this.tcx, err);
  }

  return err;
};

/// Reports that an overflow has occurred and halts compilation. We
/// halt compilation unconditionally because it is important that
/// overflows never be masked -- they basically represent computations
/// whose result could not be truly determined and thus we can't say
/// if the program type checks or not -- and they are unusual
/// occurrences in any case.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/overflow.rs:134 report_overflow_obligation
TypeErrCtxt.prototype.report_overflow_obligation = function <T>(
  this: TypeErrCtxt,
  obligation: Obligation<T>,
  suggest_increasing_limit: boolean,
  upcast_from_T: (from: T, tcx: Interner) => Predicate,
): never {
  const predicate_ = upcast_from_T(obligation.predicate, this.tcx as unknown as Interner);
  const predicate = this.deeply_resolve_ignoring_regions(predicate_, fold_Predicate);
  return this.report_overflow_error({ $: "TraitSolver", _0: predicate }, obligation.cause.span, suggest_increasing_limit, (err) => {
    this.note_obligation_cause_code(
      obligation.cause.body_def_id,
      err,
      predicate,
      obligation.param_env,
      obligation.cause.code_(),
      [],
      new DefIdSet(),
      upcast_from_Predicate,
    );
  });
};

/// Reports that a cycle was detected which led to overflow and halts
/// compilation. This is equivalent to `report_overflow_obligation` except
/// that we can give a more helpful error message (and, in particular,
/// we do not suggest increasing the overflow limit, which is not
/// going to help).
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/overflow.rs:167 report_overflow_obligation_cycle
TypeErrCtxt.prototype.report_overflow_obligation_cycle = function (this: TypeErrCtxt, cycle_: readonly PredicateObligation[]): never {
  const cycle = this.deeply_resolve_ignoring_regions([...cycle_], d_PredicateObligations());
  assert(cycle.length !== 0, "assertion failed: !cycle.is_empty()");

  // debug!(?cycle, "report_overflow_error_cycle");

  // The 'deepest' obligation is most likely to have a useful
  // cause 'backtrace'
  // PORT: `Iterator::max_by_key` returns the last of several maximal elements.
  let deepest = cycle[0]!;
  for (const p of cycle) {
    if (p.recursion_depth >= deepest.recursion_depth) deepest = p;
  }
  return this.report_overflow_obligation(deepest, false, upcast_from_Predicate);
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/overflow.rs:181 report_overflow_no_abort
TypeErrCtxt.prototype.report_overflow_no_abort = function (
  this: TypeErrCtxt,
  obligation_: PredicateObligation,
  suggest_increasing_limit: boolean,
): ErrorGuaranteed {
  const obligation = this.deeply_resolve_ignoring_regions(obligation_, d_PredicateObligation());
  const err = this.build_overflow_error({ $: "TraitSolver", _0: obligation.predicate }, obligation.cause.span, suggest_increasing_limit);
  this.note_obligation_cause(err, obligation);
  return err.emit_err();
};

// ---- helpers ---------------------------------------------------------------------------------------------------------

/** The reflexive `impl<I, T> UpcastFrom<I, T> for T` (rustc_type_ir upcast.rs) at `Predicate`. */
const upcast_from_Predicate: (from: Predicate, tcx: Interner) => Predicate = upcast_from_self;

/** `AliasTerm`'s derived `TypeFoldable` (`Alias<AliasTermKind>`, rustc_type_ir ty/alias.rs). */
const d_AliasTerm: TypeFoldable<AliasTerm> = {
  visit_with: (v, visitor) => visit_with_Alias(v, visitor, visit_with_AliasTermKind),
  try_fold_with: (v, folder) => try_fold_with_Alias(v, folder, try_fold_with_AliasTermKind),
  fold_with: (v, folder) => fold_with_Alias(v, folder, fold_with_AliasTermKind),
};

/** `PredicateObligation`'s `TypeFoldable` (../../traits/mod.ts), read lazily (init order). */
function d_PredicateObligation(): TypeFoldable<PredicateObligation> {
  const m = traits_mod();
  return { visit_with: m.visit_with_PredicateObligation, try_fold_with: m.try_fold_with_PredicateObligation, fold_with: m.fold_with_PredicateObligation };
}

/** `Vec<PredicateObligation>`'s `TypeFoldable` (../../traits/mod.ts), read lazily (init order). */
function d_PredicateObligations(): TypeFoldable<PredicateObligations> {
  const m = traits_mod();
  return { visit_with: m.visit_with_PredicateObligations, try_fold_with: m.try_fold_with_PredicateObligations, fold_with: m.fold_with_PredicateObligations };
}

/** The crate's traits/mod.ts (a static import would close a load-time cycle). */
function traits_mod(): typeof import("../../traits/mod.ts") {
  return require("../../traits/mod.ts") as typeof import("../../traits/mod.ts");
}
