// Port of compiler/rustc_hir_typeck/src/pat.rs (STUB, lane typeck-pat-a|typeck-pat-b): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// pat.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/pat.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./pat.gen.ts";
import { BindingMode, BindingMode_eq, ByRef } from "../rustc_ast/lib.ts";
import { type Mutability, Mutability_cmp, Pinnedness } from "../rustc_ast_ir/lib.ts";
import type { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { Applicability, Diag, type DiagCtxtHandle, type Diagnostic, E0023, E0025, E0026, E0027, E0164, E0308, E0527, E0528, E0638, E0730, E0769, type Level, MultiSpan, pluralize, struct_span_code_err } from "../rustc_errors/lib.ts";
import { debug_Res, Res, type Res as ResT } from "../rustc_hir/def.ts";
import * as hir from "../rustc_hir/lib.ts";
import { enumerate_and_adjust } from "../rustc_hir/pat_util.ts";
import { pat_to_string, qpath_to_string } from "../rustc_hir_pretty/lib.ts";
import { debug_HirId, type HirId } from "../rustc_hir_id/lib.ts";
import { NON_EXHAUSTIVE_OMITTED_PATTERNS } from "../rustc_lint_defs/builtin.gen.ts";
import type { Rust2024IncompatiblePatInfo } from "../rustc_middle/ty/typeck_results.ts";
import type { Const, FieldIdx } from "../rustc_middle/ty/decls.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import type { GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { debug_Ty, type FieldDef, Ty, type VariantDef } from "../rustc_middle/ty/mod.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { BytePos, DUMMY_SP, type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { span_bug, bug } from "../rustc_span/macros.ts";
import { find_best_match_for_name } from "../rustc_span/edit_distance.ts";
import { display_Ident, type Ident, kw, sym, Symbol } from "../rustc_span/symbol.ts";
import { Binder } from "../rustc_type_ir/binder.ts";
import { PolyFnSig as PolyFnSigC } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { ch } from "../std/char.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert, unported, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { str_trim_start } from "../std/str.ts";
import { FnCtxt } from "./decls.ts";
import type { DeclOrigin } from "./gather_locals.ts";
import { ExpectedArrayOrSlice_diagnostic, UnionPatDotDot_diagnostic, UnionPatMultipleFields_diagnostic, type AsDerefSuggestion, type SlicingSuggestion } from "./diagnostics.ts";
import { FnCtxt_as_PpAnn } from "./fn_ctxt/mod.ts";
import { type InheritedRefMatchRule, type MutblCap, type PatInfo, clone_PatInfo, ResolvedPat } from "./pat.gen.ts";
import * as pat_mod from "./pat.ts";

// ==== lane typeck-pat-a: pat.rs:1..1779 ====
unported_methods(FnCtxt.prototype, "rustc_hir_typeck::pat::FnCtxt", ["pattern_cause", "demand_eqtype_pat_diag", "demand_eqtype_pat", "downgrade_mut_inside_shared", "ref_pat_matches_inherited_ref", "ref_pat_matches_mut_ref", "check_pat_top", "check_pat", "check_pat_inner", "adjust_pat_info", "check_deref_pattern", "calc_adjust_mode", "should_peel_ref", "should_peel_smart_pointer", "check_pat_expr_unadjusted", "check_pat_lit", "check_pat_range", "endpoint_has_type", "emit_err_pat_range", "check_pat_ident", "check_binding_alt_eq_ty", "suggest_adding_missing_ref_or_removing_ref", "borrow_pat_suggestion", "check_dereferenceable", "resolve_pat_struct", "check_pin_projection", "check_pat_struct", "resolve_pat_path", "check_pat_path", "maybe_suggest_range_literal", "emit_bad_pat_path"]);
// ==== lane typeck-pat-b: pat.rs:1780..3388 ====
// PORT: `PatInfo` is `Copy` and passed by value; a fn that takes `mut pat_info` and assigns its fields clones it on
// entry (`clone_PatInfo`) so the caller's value is untouched (PORTING §8 "Rust copy of a Copy object").
// PORT(pat-a): `MutblCap::cap_to_weakly_not` / `MutblCap::as_mutbl` (pat.rs:229 / :237) belong to lane typeck-pat-a
// (enum methods on the companion, PORTING §8). This region reads them off this module's `MutblCap` export at call
// time (`MutblCap_methods()`), so it type-checks before and after that lane lands; it stops `unported` until then.
interface MutblCapMethods {
  cap_to_weakly_not(self_: MutblCap, span: Span | undefined): MutblCap;
  as_mutbl(self_: MutblCap): Mutability;
}
function MutblCap_methods(): MutblCapMethods {
  const c = pat_mod.MutblCap as unknown as Partial<MutblCapMethods>;
  if (c.cap_to_weakly_not === undefined || c.as_mutbl === undefined) {
    return unported("rustc_hir_typeck::pat::MutblCap::{cap_to_weakly_not, as_mutbl}");
  }
  return c as MutblCapMethods;
}

/** `FxHashMap<Ident, _>` key: `Ident`'s `Eq`/`Hash` (the name and the span's `SyntaxContext`). */
function Ident_key(ident: Ident): string {
  return `${ident.name}:${Span.ctxt(ident.span)}`;
}

/** `str::parse::<usize>().is_err()` (an optional `+`, then ASCII digits, value < 2^64). */
function parse_usize_is_err(s: string): boolean {
  if (!/^\+?[0-9]+$/.test(s)) return true;
  return BigInt(s) > 0xffff_ffff_ffff_ffffn;
}

// rustc: compiler/rustc_hir_typeck/src/pat.rs:1781 resolve_pat_tuple_struct
FnCtxt.prototype.resolve_pat_tuple_struct = function (this: FnCtxt, pat: hir.Pat, qpath: hir.QPath): Result<ResolvedPat, ErrorGuaranteed> {
  const tcx = this.tcx;
  const report_unexpected_res = (res: ResT): Result<ResolvedPat, ErrorGuaranteed> => {
    const expected = "tuple struct or tuple variant";
    const sub_pats: readonly hir.Pat[] = pat.kind.$ === "TupleStruct" ? pat.kind._1 : [];
    const e = this.report_unexpected_variant_res(res, undefined, sub_pats, qpath, pat.span, E0164, expected);
    return Err(e);
  };

  // Resolve the path and check the definition for errors.
  const [res_, opt_ty, segments] = this.resolve_ty_and_res_fully_qualified_call(qpath, pat.hir_id, pat.span);
  if (res_.$ === "Err") {
    const e = this.dcx().span_delayed_bug(pat.span, "`Res::Err` but no error emitted");
    this.set_tainted_by_errors(e);
    return Err(e);
  }

  // Type-check the path.
  const [pat_ty_, res] = this.instantiate_value_path(segments, opt_ty, res_, pat.span, pat.span, pat.hir_id, false);
  if (!pat_ty_.is_fn()) {
    return report_unexpected_res(res);
  }

  let variant: VariantDef;
  if (res.$ === "Err") {
    return this.dcx().span_bug(pat.span, "`Res::Err` but no error emitted");
  } else if (res.$ === "Def" && (res._0.$ === "AssocConst" || res._0.$ === "AssocFn")) {
    return report_unexpected_res(res);
  } else if (res.$ === "Def" && res._0.$ === "Ctor" && res._0._1 === "Fn") {
    variant = tcx.expect_variant_res(res);
  } else {
    return bug(`unexpected pattern resolution: ${debug_Res(res, PLAIN, debug_HirId)}`);
  }

  // Replace constructor type with constructed type for tuple struct patterns.
  const pat_ty_out = PolyFnSigC.output(pat_ty_.fn_sig(tcx));
  const pat_ty = unwrap(Binder.no_bound_vars(pat_ty_out, fold_Ty), "expected fn type");

  return Ok(new ResolvedPat(pat_ty, { $: "TupleStruct", res, variant }));
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:1833 check_pat_tuple_struct
FnCtxt.prototype.check_pat_tuple_struct = function (
  this: FnCtxt,
  pat: hir.Pat,
  qpath: hir.QPath,
  subpats: readonly hir.Pat[],
  ddpos: hir.DotDotPos,
  res: ResT,
  pat_ty: Ty,
  variant: VariantDef,
  expected: Ty,
  pat_info: PatInfo,
): Ty {
  this.check_pin_projection(pat, pat_ty, pat_info);

  const tcx = this.tcx;
  const on_error = (e: ErrorGuaranteed): void => {
    for (const pat of subpats) {
      this.check_pat(pat, Ty.new_error(tcx, e), pat_info);
    }
  };

  // Type-check the tuple struct pattern against the expected type.
  const had_err = this.demand_eqtype_pat(pat.span, expected, pat_ty, pat_info.top_info);

  // Type-check subpatterns.
  if (subpats.length === variant.fields.length || (subpats.length < variant.fields.length && ddpos.as_opt_usize() !== undefined)) {
    const k = pat_ty.kind();
    if (k.$ !== "Adt") {
      return bug(`unexpected pattern type ${debug_Ty(pat_ty, PLAIN)}`);
    }
    const args = k._1;
    for (const [i, subpat] of enumerate_and_adjust(subpats, variant.fields.length, ddpos)) {
      const field = unwrap(variant.fields[i]);
      const field_ty = this.field_ty(subpat.span, field, args);
      this.check_pat(subpat, field_ty, pat_info);

      this.tcx.check_stability(unwrap(variant.fields[i]).did, subpat.hir_id, subpat.span, undefined);
    }
    if (had_err.$ === "Err") {
      const e = had_err._0;
      on_error(e);
      return Ty.new_error(tcx, e);
    }
  } else {
    const e = this.emit_err_pat_wrong_number_of_fields(pat.span, res, qpath, subpats, variant.fields, expected, had_err);
    on_error(e);
    return Ty.new_error(tcx, e);
  }
  return pat_ty;
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:1896 emit_err_pat_wrong_number_of_fields
FnCtxt.prototype.emit_err_pat_wrong_number_of_fields = function (
  this: FnCtxt,
  pat_span: Span,
  res: ResT,
  qpath: hir.QPath,
  subpats: readonly hir.Pat[],
  fields: readonly FieldDef[],
  expected: Ty,
  had_err: Result<undefined, ErrorGuaranteed>,
): ErrorGuaranteed {
  const subpats_ending = pluralize(subpats.length);
  const fields_ending = pluralize(fields.length);

  const subpat_spans: Span[] = subpats.length === 0 ? [pat_span] : subpats.map((p) => p.span);
  const last_subpat_span = unwrap(subpat_spans[subpat_spans.length - 1]);
  const res_span = this.tcx.def_span(Res.def_id(res, debug_HirId));
  const def_ident_span = this.tcx.def_ident_span(Res.def_id(res, debug_HirId)) ?? res_span;
  const field_def_spans: Span[] = fields.length === 0 ? [res_span] : fields.map((f) => f.ident(this.tcx).span);
  const last_field_def_span = unwrap(field_def_spans[field_def_spans.length - 1]);

  const err = struct_span_code_err(
    this.dcx(),
    MultiSpan.from_spans(subpat_spans),
    E0023,
    `this pattern has ${subpats.length} field${subpats_ending}, but the corresponding ${Res.descr(res)} has ${fields.length} field${fields_ending}`,
  );
  err.span_label(last_subpat_span, `expected ${fields.length} field${fields_ending}, found ${subpats.length}`);
  err.span_context(hir.QPath.span(qpath));
  if (this.tcx.sess.source_map().is_multiline(Span.between(def_ident_span, last_field_def_span))) {
    err.span_label(def_ident_span, `${Res.descr(res)} defined here`);
  }
  for (const span of field_def_spans.slice(0, field_def_spans.length - 1)) {
    err.span_label(span, "");
  }
  err.span_label(last_field_def_span, `${Res.descr(res)} has ${fields.length} field${fields_ending}`);

  // Identify the case `Some(x, y)` where the expected type is e.g. `Option<(T, U)>`.
  // More generally, the expected type wants a tuple variant with one field of an
  // N-arity-tuple, e.g., `V_i((p_0, .., p_N))`. Meanwhile, the user supplied a pattern
  // with the subpatterns directly in the tuple variant pattern, e.g., `V_i(p_0, .., p_N)`.
  let missing_parentheses: boolean;
  const expected_kind = expected.kind();
  // #67037: only do this if we could successfully type-check the expected type against
  // the tuple struct pattern. Otherwise the args could get out of range on e.g.,
  // `let P() = U;` where `P != U` with `struct Box<T>(T);`.
  if (expected_kind.$ === "Adt" && fields.length === 1 && had_err.$ === "Ok") {
    const field = fields[0]!;
    const field_ty = this.field_ty(pat_span, field, expected_kind._1);
    const fk = field_ty.kind();
    missing_parentheses = fk.$ === "Tuple" ? fk._0.length === subpats.length : false;
  } else {
    missing_parentheses = false;
  }
  if (missing_parentheses) {
    let left: Span;
    let right: Span;
    if (subpats.length === 0) {
      // This is the zero case; we aim to get the "hi" part of the `QPath`'s
      // span as the "lo" and then the "hi" part of the pattern's span as the "hi".
      // This looks like:
      //
      // help: missing parentheses
      //   |
      // L |     let A(()) = A(());
      //   |          ^  ^
      [left, right] = [Span.shrink_to_hi(hir.QPath.span(qpath)), pat_span];
    } else {
      // Easy case. Just take the "lo" of the first sub-pattern and the "hi" of the
      // last sub-pattern. In the case of `A(x)` the first and last may coincide.
      // This looks like:
      //
      // help: missing parentheses
      //   |
      // L |     let A((x, y)) = A((1, 2));
      //   |           ^    ^
      const first = subpats[0]!;
      [left, right] = [Span.shrink_to_lo(first.span), unwrap(subpats[subpats.length - 1]).span];
    }
    err.multipart_suggestion(
      "missing parentheses",
      [
        [left, "("],
        [Span.shrink_to_hi(right), ")"],
      ],
      "MachineApplicable",
    );
  } else if (fields.length > subpats.length && pat_span !== DUMMY_SP) {
    const after_fields_span = Span.shrink_to_hi(Span.with_hi(pat_span, (Span.hi(pat_span) - 1) as BytePos));
    let all_fields_span: Span;
    if (subpats.length === 0) {
      all_fields_span = after_fields_span;
    } else if (subpats.length === 1) {
      all_fields_span = subpats[0]!.span;
    } else {
      all_fields_span = Span.to(subpats[0]!.span, subpats[subpats.length - 1]!.span);
    }

    // Check if all the fields in the pattern are wildcards.
    const all_wildcards = subpats.every((pat) => pat.kind.$ === "Wild");
    let first_tail_wildcard: number | undefined = undefined;
    subpats.forEach((pat, pos) => {
      const acc = first_tail_wildcard;
      if (acc === undefined && pat.kind.$ === "Wild") {
        first_tail_wildcard = pos;
      } else if (acc !== undefined && pat.kind.$ === "Wild") {
        first_tail_wildcard = acc;
      } else {
        first_tail_wildcard = undefined;
      }
    });
    let tail_span: Span;
    const ftw = first_tail_wildcard as number | undefined;
    if (ftw === undefined) {
      tail_span = after_fields_span;
    } else if (ftw === 0) {
      tail_span = Span.to(subpats[0]!.span, after_fields_span);
    } else {
      tail_span = Span.to(Span.shrink_to_hi(subpats[ftw - 1]!.span), after_fields_span);
    }

    // FIXME: heuristic-based suggestion to check current types for where to add `_`.
    let wildcard_sugg = new Array<string>(fields.length - subpats.length).fill("_").join(", ");
    if (subpats.length !== 0) {
      wildcard_sugg = ", " + wildcard_sugg;
    }

    err.span_suggestion_verbose(after_fields_span, "use `_` to explicitly ignore each field", wildcard_sugg, "MaybeIncorrect");

    // Only suggest `..` if more than one field is missing
    // or the pattern consists of all wildcards.
    if (fields.length - subpats.length > 1 || all_wildcards) {
      if (subpats.length === 0 || all_wildcards) {
        err.span_suggestion_verbose(all_fields_span, "use `..` to ignore all fields", "..", "MaybeIncorrect");
      } else {
        err.span_suggestion_verbose(tail_span, "use `..` to ignore the rest of the fields", ", ..", "MaybeIncorrect");
      }
    }
  }

  return err.emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2053 check_pat_tuple
FnCtxt.prototype.check_pat_tuple = function (this: FnCtxt, span: Span, elements: readonly hir.Pat[], ddpos: hir.DotDotPos, expected: Ty, pat_info: PatInfo): Ty {
  const tcx = this.tcx;
  let expected_len = elements.length;
  if (ddpos.as_opt_usize() !== undefined) {
    // Require known type only when `..` is present.
    const k = this.structurally_resolve_type(span, expected).kind();
    if (k.$ === "Tuple") {
      expected_len = k._0.length;
    }
  }
  const max_len = Math.max(expected_len, elements.length);

  const element_tys_iter: Ty[] = [];
  for (let i = 0; i < max_len; i++) element_tys_iter.push(this.next_ty_var(span));
  const element_tys = tcx.mk_type_list_from_iter(element_tys_iter);
  const pat_ty = Ty.new_tup(tcx, element_tys);
  const r = this.demand_eqtype_pat(span, expected, pat_ty, pat_info.top_info);
  if (r.$ === "Err") {
    const reported = r._0;
    // Walk subpatterns with an expected type of `err` in this case to silence
    // further errors being emitted when using the bindings. #50333
    for (const [, elem] of enumerate_and_adjust(elements, max_len, ddpos)) {
      this.check_pat(elem, Ty.new_error(tcx, reported), pat_info);
    }
    return Ty.new_error(tcx, reported);
  } else {
    for (const [i, elem] of enumerate_and_adjust(elements, max_len, ddpos)) {
      this.check_pat(elem, unwrap(element_tys[i]), pat_info);
    }
    return pat_ty;
  }
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2089 check_struct_pat_fields
FnCtxt.prototype.check_struct_pat_fields = function (
  this: FnCtxt,
  adt_ty: Ty,
  pat: hir.Pat,
  variant: VariantDef,
  fields: readonly hir.PatField[],
  has_rest_pat: boolean,
  pat_info: PatInfo,
): Result<undefined, ErrorGuaranteed> {
  const tcx = this.tcx;

  const adt_kind = adt_ty.kind();
  if (adt_kind.$ !== "Adt") {
    return span_bug(pat.span, "struct pattern is not an ADT");
  }
  const adt = adt_kind._0;
  const args = adt_kind._1;

  // Index the struct fields' types.
  const field_map = new KeyedMap<Ident, [FieldIdx, FieldDef]>(Ident_key);
  variant.fields.forEach((field, i) => {
    field_map.set(field.ident(this.tcx).normalize_to_macros_2_0(), [i as FieldIdx, field]);
  });

  // Keep track of which fields have already appeared in the pattern.
  const used_fields = new KeyedMap<Ident, Span>(Ident_key);
  let result: Result<undefined, ErrorGuaranteed> = Ok(undefined);

  const inexistent_fields: hir.PatField[] = [];
  // Typecheck each field.
  for (const field of fields) {
    const span = field.span;
    const ident = tcx.adjust_ident(field.ident, variant.def_id);
    let field_ty: Ty;
    if (used_fields.has(ident)) {
      // Occupied(occupied)
      const guar = this.error_field_already_bound(span, field.ident, used_fields.get(ident)!);
      result = Err(guar);
      field_ty = Ty.new_error(tcx, guar);
    } else {
      // Vacant(vacant)
      used_fields.set(ident, span);
      const entry = field_map.get(ident);
      if (entry !== undefined) {
        const [i, f] = entry;
        this.write_field_index(field.hir_id, i);
        this.tcx.check_stability(f.did, field.hir_id, span, undefined);
        field_ty = this.field_ty(span, f, args);
      } else {
        inexistent_fields.push(field);
        field_ty = Ty.new_misc_error(tcx);
      }
    }

    this.check_pat(field.pat, field_ty, pat_info);
  }

  const unmentioned_fields: [FieldDef, Ident][] = variant.fields
    .map((field): [FieldDef, Ident] => [field, field.ident(this.tcx).normalize_to_macros_2_0()])
    .filter(([, ident]) => !used_fields.has(ident));

  let inexistent_fields_err: Diag | undefined;
  if (inexistent_fields.length !== 0 && !inexistent_fields.some((field) => field.ident.name === kw.Underscore)) {
    // we don't care to report errors for a struct if the struct itself is tainted
    const tainted = variant.has_errors();
    if (tainted.$ === "Err") return Err(tainted._0);
    inexistent_fields_err = this.error_inexistent_fields(adt.variant_descr(), inexistent_fields, unmentioned_fields, pat, variant, args);
  } else {
    inexistent_fields_err = undefined;
  }

  // Require `..` if struct has non_exhaustive attribute.
  const non_exhaustive = variant.field_list_has_applicable_non_exhaustive();
  if (non_exhaustive && !has_rest_pat) {
    this.error_foreign_non_exhaustive_spat(pat, adt.variant_descr(), fields.length === 0);
  }

  let unmentioned_err: Diag | undefined = undefined;
  // Report an error if an incorrect number of fields was specified.
  if (adt.is_union()) {
    if (fields.length !== 1) {
      this.dcx().emit_err(UnionPatMultipleFields_diagnostic({ span: pat.span }));
    }
    if (has_rest_pat) {
      this.dcx().emit_err(UnionPatDotDot_diagnostic({ span: pat.span }));
    }
  } else if (unmentioned_fields.length !== 0) {
    const accessible_unmentioned_fields: [FieldDef, Ident][] = unmentioned_fields.filter(([field]) => this.is_field_suggestable(field, pat.span));

    if (!has_rest_pat) {
      if (accessible_unmentioned_fields.length === 0) {
        unmentioned_err = this.error_no_accessible_fields(pat, fields);
      } else {
        unmentioned_err = this.error_unmentioned_fields(
          pat,
          accessible_unmentioned_fields,
          accessible_unmentioned_fields.length !== unmentioned_fields.length,
          fields,
        );
      }
    } else if (non_exhaustive && accessible_unmentioned_fields.length !== 0) {
      this.lint_non_exhaustive_omitted_patterns(pat, accessible_unmentioned_fields, adt_ty);
    }
  }
  if (inexistent_fields_err !== undefined && unmentioned_err !== undefined) {
    const i = inexistent_fields_err;
    const u = unmentioned_err;
    const r = this.error_tuple_variant_as_struct_pat(pat, fields, variant);
    if (r.$ === "Err") {
      // We don't want to show the nonexistent fields error when this was
      // `Foo { a, b }` when it should have been `Foo(a, b)`.
      i.delay_as_bug();
      u.delay_as_bug();
      return Err(r._0);
    } else {
      i.emit();
      return Err(u.emit_err());
    }
  } else if (inexistent_fields_err === undefined && unmentioned_err !== undefined) {
    const u = unmentioned_err;
    const r = this.error_tuple_variant_as_struct_pat(pat, fields, variant);
    if (r.$ === "Err") {
      u.delay_as_bug();
      return Err(r._0);
    } else {
      return Err(u.emit_err());
    }
  } else if (inexistent_fields_err !== undefined && unmentioned_err === undefined) {
    return Err(inexistent_fields_err.emit_err());
  } else {
    const r = this.error_tuple_variant_index_shorthand(variant, pat, fields);
    if (r.$ === "Err") return r;
    return result;
  }
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2239 error_tuple_variant_index_shorthand
FnCtxt.prototype.error_tuple_variant_index_shorthand = function (this: FnCtxt, variant: VariantDef, pat: hir.Pat, fields: readonly hir.PatField[]): Result<undefined, ErrorGuaranteed> {
  // if this is a tuple struct, then all field names will be numbers
  // so if any fields in a struct pattern use shorthand syntax, they will
  // be invalid identifiers (for example, Foo { 0, 1 }).
  if (variant.ctor_kind() === "Fn" && pat.kind.$ === "Struct") {
    const qpath = pat.kind._0;
    const field_patterns = pat.kind._1;
    const has_shorthand_field_name = field_patterns.some((field) => field.is_shorthand);
    if (has_shorthand_field_name) {
      const path = qpath_to_string(FnCtxt_as_PpAnn(this), qpath);
      const err = struct_span_code_err(this.dcx(), pat.span, E0769, `tuple variant \`${path}\` written as struct variant`);
      err.span_suggestion_verbose(
        Span.to(Span.shrink_to_hi(hir.QPath.span(qpath)), Span.shrink_to_hi(pat.span)),
        "use the tuple variant pattern syntax instead",
        `(${this.get_suggested_tuple_struct_pattern(fields, variant)})`,
        "MaybeIncorrect",
      );
      return Err(err.emit_err());
    }
  }
  return Ok(undefined);
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2272 error_foreign_non_exhaustive_spat
FnCtxt.prototype.error_foreign_non_exhaustive_spat = function (this: FnCtxt, pat: hir.Pat, descr: string, no_fields: boolean): void {
  const sess = this.tcx.sess;
  const sm = sess.source_map();
  const sp_brace = sm.end_point(pat.span);
  const sp_comma = sm.end_point(Span.with_hi(pat.span, Span.hi(sp_brace)));
  const sugg = no_fields || sp_brace !== sp_comma ? ".. }" : ", .. }";

  struct_span_code_err(this.dcx(), pat.span, E0638, `\`..\` required with ${descr} marked as non-exhaustive`)
    .with_span_suggestion_verbose(sp_comma, "add `..` at the end of the field list to ignore all other fields", sugg, "MachineApplicable")
    .emit();
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2294 error_field_already_bound
FnCtxt.prototype.error_field_already_bound = function (this: FnCtxt, span: Span, ident: Ident, other_field: Span): ErrorGuaranteed {
  return struct_span_code_err(this.dcx(), span, E0025, `field \`${display_Ident(ident)}\` bound multiple times in the pattern`)
    .with_span_label(span, `multiple uses of \`${display_Ident(ident)}\` in pattern`)
    .with_span_label(other_field, `first use of \`${display_Ident(ident)}\``)
    .emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2312 error_inexistent_fields
FnCtxt.prototype.error_inexistent_fields = function (
  this: FnCtxt,
  kind_name: string,
  inexistent_fields: readonly hir.PatField[],
  unmentioned_fields: [FieldDef, Ident][],
  pat: hir.Pat,
  variant: VariantDef,
  args: GenericArgs,
): Diag {
  const tcx = this.tcx;
  let field_names: string;
  let t: string;
  let plural: string;
  if (inexistent_fields.length === 1) {
    const field = inexistent_fields[0]!;
    [field_names, t, plural] = [`a field named \`${display_Ident(field.ident)}\``, "this", ""];
  } else {
    [field_names, t, plural] = [`fields named ${inexistent_fields.map((field) => `\`${display_Ident(field.ident)}\``).join(", ")}`, "these", "s"];
  }
  const spans = inexistent_fields.map((field) => field.ident.span);
  const err = struct_span_code_err(this.dcx(), spans, E0026, `${kind_name} \`${tcx.def_path_str(variant.def_id)}\` does not have ${field_names}`);
  const pat_field = inexistent_fields[inexistent_fields.length - 1];
  if (pat_field !== undefined) {
    err.span_label(pat_field.ident.span, `${kind_name} \`${tcx.def_path_str(variant.def_id)}\` does not have ${t} field${plural}`);

    if (unmentioned_fields.length === 1 && this.is_field_suggestable(unmentioned_fields[0]![0], pat.span)) {
      const [field_def, field] = unmentioned_fields[0]!;
      const suggested_name = find_best_match_for_name([field.name], pat_field.ident.name, undefined);
      if (suggested_name !== undefined) {
        err.span_suggestion_verbose(pat_field.ident.span, "a field with a similar name exists", Symbol.as_str(suggested_name), "MaybeIncorrect");

        // When we have a tuple struct used with struct we don't want to suggest using
        // the (valid) struct syntax with numeric field names. Instead we want to
        // suggest the expected syntax. We infer that this is the case by parsing the
        // `Ident` into an unsized integer. The suggestion will be emitted elsewhere in
        // `smart_resolve_context_dependent_help`.
        if (parse_usize_is_err(Symbol.to_ident_string(suggested_name))) {
          // We don't want to throw `E0027` in case we have thrown `E0026` for them.
          // PORT: `Vec::retain` edits the caller's vector in place.
          const kept = unmentioned_fields.filter(([, x]) => x.name !== suggested_name);
          unmentioned_fields.splice(0, unmentioned_fields.length, ...kept);
        }
      } else if (inexistent_fields.length === 1) {
        if (pat_field.pat.kind.$ === "Expr" && !this.may_coerce(this.typeck_results.node_type(pat_field.pat.hir_id), this.field_ty(field.span, field_def, args))) {
          // nothing
        } else {
          err.span_suggestion_short(
            pat_field.ident.span,
            `\`${tcx.def_path_str(variant.def_id)}\` has a field named \`${Symbol.as_str(field.name)}\``,
            Symbol.as_str(field.name),
            "MaybeIncorrect",
          );
        }
      }
    }
  }
  if (tcx.sess.teach(unwrap(err.deref().code))) {
    err.note(
      "This error indicates that a struct pattern attempted to \
extract a nonexistent field from a struct. Struct fields \
are identified by the name used before the colon : so struct \
patterns should resemble the declaration of the struct type \
being matched.\n\n\
If you are using shorthand field patterns but want to refer \
to the struct field by a different name, you should rename \
it explicitly.",
    );
  }
  return err;
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2420 error_tuple_variant_as_struct_pat
FnCtxt.prototype.error_tuple_variant_as_struct_pat = function (this: FnCtxt, pat: hir.Pat, fields: readonly hir.PatField[], variant: VariantDef): Result<undefined, ErrorGuaranteed> {
  if (variant.ctor_kind() === "Fn" && pat.kind.$ === "Struct") {
    const qpath = pat.kind._0;
    const pattern_fields = pat.kind._1;
    const is_tuple_struct_match = pattern_fields.length !== 0 && pattern_fields.map((field) => Symbol.as_str(field.ident.name)).every((s) => is_number(s));
    if (is_tuple_struct_match) {
      return Ok(undefined);
    }

    // we don't care to report errors for a struct if the struct itself is tainted
    const tainted = variant.has_errors();
    if (tainted.$ === "Err") return Err(tainted._0);

    const path = qpath_to_string(FnCtxt_as_PpAnn(this), qpath);
    const err = struct_span_code_err(this.dcx(), pat.span, E0769, `tuple variant \`${path}\` written as struct variant`);
    let sugg: string;
    let appl: Applicability;
    if (fields.length === variant.fields.length) {
      [sugg, appl] = [this.get_suggested_tuple_struct_pattern(fields, variant), "MachineApplicable"];
    } else {
      [sugg, appl] = [variant.fields.map(() => "_").join(", "), "MaybeIncorrect"];
    }
    err.span_suggestion_verbose(
      Span.to(Span.shrink_to_hi(hir.QPath.span(qpath)), Span.shrink_to_hi(pat.span)),
      "use the tuple variant pattern syntax instead",
      `(${sugg})`,
      appl,
    );
    return Err(err.emit_err());
  }
  return Ok(undefined);
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2468 get_suggested_tuple_struct_pattern
FnCtxt.prototype.get_suggested_tuple_struct_pattern = function (this: FnCtxt, fields: readonly hir.PatField[], variant: VariantDef): string {
  const variant_field_idents: Ident[] = variant.fields.map((f) => f.ident(this.tcx));
  return fields
    .map((field) => {
      const r = this.tcx.sess.source_map().span_to_snippet(field.pat.span);
      if (r.$ === "Ok") {
        const f = r._0.toString();
        // Field names are numbers, but numbers
        // are not valid identifiers
        if (variant_field_idents.some((i) => i.eq(field.ident))) {
          return "_";
        } else {
          return f;
        }
      } else {
        return pat_to_string(FnCtxt_as_PpAnn(this), field.pat);
      }
    })
    .join(", ");
};

/// Returns a diagnostic reporting a struct pattern which is missing an `..` due to
/// inaccessible fields.
///
/// ```text
/// error: pattern requires `..` due to inaccessible fields
///   --> src/main.rs:10:9
///    |
/// LL |     let foo::Foo {} = foo::Foo::default();
///    |         ^^^^^^^^^^^
///    |
/// help: add a `..`
///    |
/// LL |     let foo::Foo { .. } = foo::Foo::default();
///    |                  ^^^^^^
/// ```
// rustc: compiler/rustc_hir_typeck/src/pat.rs:2510 error_no_accessible_fields
FnCtxt.prototype.error_no_accessible_fields = function (this: FnCtxt, pat: hir.Pat, fields: readonly hir.PatField[]): Diag {
  const err = this.dcx().struct_span_err(pat.span, "pattern requires `..` due to inaccessible fields");

  const field = fields[fields.length - 1];
  if (field !== undefined) {
    const tail_span = Span.to(Span.shrink_to_hi(field.span), Span.shrink_to_hi(pat.span));
    const snippet_r = this.tcx.sess.source_map().span_to_snippet(tail_span);
    let comma_hi_offset: number | undefined;
    if (snippet_r.$ === "Ok") {
      const snippet = snippet_r._0;
      const trimmed = str_trim_start(snippet);
      comma_hi_offset = trimmed.starts_with(",") ? snippet.len() - trimmed.len() + 1 : undefined;
    } else {
      comma_hi_offset = undefined;
    }
    err.span_suggestion_verbose(
      comma_hi_offset !== undefined
        ? Span.shrink_to_hi(Span.with_hi(tail_span, (Span.lo(tail_span) + comma_hi_offset) as BytePos))
        : Span.shrink_to_hi(field.span),
      "ignore the inaccessible and unused fields",
      comma_hi_offset !== undefined ? " .." : ", ..",
      "MachineApplicable",
    );
  } else {
    let qpath_span: Span;
    if (pat.kind.$ === "Struct") {
      qpath_span = hir.QPath.span(pat.kind._0);
    } else {
      return bug("`error_no_accessible_fields` called on non-struct pattern");
    }

    // Shrink the span to exclude the `foo:Foo` in `foo::Foo { }`.
    const span = Span.with_lo(pat.span, Span.hi(Span.shrink_to_hi(qpath_span)));
    err.span_suggestion_verbose(span, "ignore the inaccessible and unused fields", " { .. }", "MachineApplicable");
  }
  return err;
};

/// Report that a pattern for a `#[non_exhaustive]` struct marked with `non_exhaustive_omitted_patterns`
/// is not exhaustive enough.
///
/// Nb: the partner lint for enums lives in `compiler/rustc_mir_build/src/thir/pattern/usefulness.rs`.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:2559 lint_non_exhaustive_omitted_patterns
FnCtxt.prototype.lint_non_exhaustive_omitted_patterns = function (this: FnCtxt, pat: hir.Pat, unmentioned_fields: readonly [FieldDef, Ident][], ty: Ty): void {
  // struct FieldsNotListed<'a, 'b, 'tcx> { pat_span, unmentioned_fields, joined_patterns, ty }
  // impl<'a, 'b, 'c, 'tcx> Diagnostic<'a> for FieldsNotListed<'b, 'c, 'tcx>
  const FieldsNotListed = (self_: { pat_span: Span; unmentioned_fields: readonly [FieldDef, Ident][]; joined_patterns: string; ty: Ty }): Diagnostic => ({
    // rustc: compiler/rustc_hir_typeck/src/pat.rs:2573 into_diag
    into_diag(dcx: DiagCtxtHandle, level: Level): Diag {
      const { pat_span, unmentioned_fields, joined_patterns, ty } = self_;
      return Diag.new(dcx, level, "some fields are not explicitly listed")
        .with_span_label(pat_span, `field${pluralize(unmentioned_fields.length)} ${joined_patterns} not listed`)
        .with_help("ensure that all fields are mentioned explicitly by adding the suggested fields")
        .with_note(`the pattern is of type \`${display_Ty(ty)}\` and the \`non_exhaustive_omitted_patterns\` attribute was found`);
    },
  });

  // rustc: compiler/rustc_hir_typeck/src/pat.rs:2586 joined_uncovered_patterns
  function joined_uncovered_patterns(witnesses: readonly Ident[]): string {
    const LIMIT = 3;
    if (witnesses.length === 0) {
      return unreachable("expected an uncovered pattern, otherwise why are we emitting an error?");
    } else if (witnesses.length === 1) {
      return `\`${display_Ident(witnesses[0]!)}\``;
    } else if (witnesses.length - 1 < LIMIT) {
      const head_ = witnesses.slice(0, witnesses.length - 1);
      const tail = witnesses[witnesses.length - 1]!;
      const head = head_.map(display_Ident);
      return `\`${head.join("`, `")}\` and \`${display_Ident(tail)}\``;
    } else {
      const head_ = witnesses.slice(0, LIMIT);
      const tail = witnesses.slice(LIMIT);
      const head = head_.map(display_Ident);
      return `\`${head.join("`, `")}\` and ${tail.length} more`;
    }
  }
  const joined_patterns = joined_uncovered_patterns(unmentioned_fields.map(([, i]) => i));

  this.tcx.emit_node_span_lint(
    NON_EXHAUSTIVE_OMITTED_PATTERNS,
    pat.hir_id,
    pat.span,
    FieldsNotListed({ pat_span: pat.span, unmentioned_fields, joined_patterns, ty }),
  );
};

/// Returns a diagnostic reporting a struct pattern which does not mention some fields.
///
/// ```text
/// error[E0027]: pattern does not mention field `bar`
///   --> src/main.rs:15:9
///    |
/// LL |     let foo::Foo {} = foo::Foo::new();
///    |         ^^^^^^^^^^^ missing field `bar`
/// ```
// rustc: compiler/rustc_hir_typeck/src/pat.rs:2627 error_unmentioned_fields
FnCtxt.prototype.error_unmentioned_fields = function (
  this: FnCtxt,
  pat: hir.Pat,
  unmentioned_fields: readonly [FieldDef, Ident][],
  have_inaccessible_fields: boolean,
  fields: readonly hir.PatField[],
): Diag {
  const inaccessible = have_inaccessible_fields ? " and inaccessible fields" : "";
  let field_names: string;
  if (unmentioned_fields.length === 1) {
    const field = unmentioned_fields[0]![1];
    field_names = `field \`${display_Ident(field)}\`${inaccessible}`;
  } else {
    const fields = unmentioned_fields.map(([, name]) => `\`${display_Ident(name)}\``).join(", ");
    field_names = `fields ${fields}${inaccessible}`;
  }
  const err = struct_span_code_err(this.dcx(), pat.span, E0027, `pattern does not mention ${field_names}`);
  err.span_label(pat.span, `missing ${field_names}`);
  const len = unmentioned_fields.length;
  let prefix: string;
  let postfix: string;
  let sp: Span;
  if (fields.length === 0) {
    if (pat.kind.$ === "Struct" && pat.kind._1.length === 0 && pat.kind._2 === undefined) {
      const path = pat.kind._0;
      [prefix, postfix, sp] = [" { ", " }", Span.until(Span.shrink_to_hi(hir.QPath.span(path)), Span.shrink_to_hi(pat.span))];
    } else {
      return err;
    }
  } else {
    const field = fields[fields.length - 1]!;
    // Account for last field having a trailing comma or parse recovery at the tail of
    // the pattern to avoid invalid suggestion (#78511).
    const tail = Span.with_hi(Span.shrink_to_hi(field.span), Span.hi(pat.span));
    if (pat.kind.$ === "Struct") {
      [prefix, postfix, sp] = [", ", " }", tail];
    } else {
      return err;
    }
  }
  err.span_suggestion_verbose(
    sp,
    `include the missing field${pluralize(len)} in the pattern${have_inaccessible_fields ? " and ignore the inaccessible fields" : ""}`,
    `${prefix}${unmentioned_fields
      .map(([, name]) => {
        const field_name = display_Ident(name);
        return is_number(field_name) ? `${field_name}: _` : field_name;
      })
      .join(", ")}${have_inaccessible_fields ? ", .." : ""}${postfix}`,
    "MachineApplicable",
  );
  err.span_suggestion_verbose(
    sp,
    `if you don't care about ${pluralize("this", len)} missing field${pluralize(len)}, you can explicitly ignore ${len === 1 ? "it" : "them"}`,
    `${prefix}${unmentioned_fields
      .map(([, name]) => {
        const field_name = display_Ident(name);
        return `${field_name}: _`;
      })
      .join(", ")}${have_inaccessible_fields ? ", .." : ""}${postfix}`,
    "MachineApplicable",
  );
  err.span_suggestion_verbose(sp, "or always ignore missing fields here", `${prefix}..${postfix}`, "MachineApplicable");
  return err;
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2727 check_pat_deref
FnCtxt.prototype.check_pat_deref = function (this: FnCtxt, span: Span, inner: hir.Pat, expected: Ty, pat_info: PatInfo): Ty {
  const target_ty = this.deref_pat_target(span, expected);
  this.check_pat(inner, target_ty, pat_info);
  this.register_deref_mut_bounds_if_needed(span, inner, [expected]);
  return expected;
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2740 deref_pat_target
FnCtxt.prototype.deref_pat_target = function (this: FnCtxt, span: Span, source_ty: Ty): Ty {
  // Register a `DerefPure` bound, which is required by all `deref!()` pats.
  const tcx = this.tcx;
  this.register_bound(source_ty, tcx.require_lang_item("DerefPure" satisfies LangItem, span), this.misc(span));
  // The expected type for the deref pat's inner pattern is `<expected as Deref>::Target`.
  const target_ty_ = Ty.new_projection(tcx, "No", tcx.require_lang_item("DerefTarget" satisfies LangItem, span), [source_ty]);
  const target_ty = this.normalize(span, Unnormalized.new_wip(target_ty_), fold_Ty);
  return this.deeply_resolve_ignoring_regions_with_obligations(target_ty, fold_Ty);
};

/// Check if the interior of a deref pattern (either explicit or implicit) has any `ref mut`
/// bindings, which would require `DerefMut` to be emitted in MIR building instead of just
/// `Deref`. We do this *after* checking the inner pattern, since we want to make sure to
/// account for `ref mut` binding modes inherited from implicitly dereferencing `&mut` refs.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:2763 register_deref_mut_bounds_if_needed
FnCtxt.prototype.register_deref_mut_bounds_if_needed = function (this: FnCtxt, span: Span, inner: hir.Pat, derefed_tys: Iterable<Ty>): void {
  if (this.typeck_results.pat_has_ref_mut_binding(inner)) {
    for (const mutably_derefed_ty of derefed_tys) {
      this.register_bound(mutably_derefed_ty, this.tcx.require_lang_item("DerefMut" satisfies LangItem, span), this.misc(span));
    }
  }
};

// Precondition: Pat is Ref(inner)
// rustc: compiler/rustc_hir_typeck/src/pat.rs:2781 check_pat_ref
FnCtxt.prototype.check_pat_ref = function (
  this: FnCtxt,
  pat: hir.Pat,
  inner: hir.Pat,
  pat_pinned: Pinnedness,
  pat_mutbl: Mutability,
  expected: Ty,
  pat_info_: PatInfo,
): Ty {
  // PORT: `mut pat_info` is a by-value copy (see the PORT note at the top of this region).
  const pat_info = clone_PatInfo(pat_info_);
  const tcx = this.tcx;

  const pat_prefix_span_ = Span.find_ancestor_inside(inner.span, pat.span);
  const pat_prefix_span = pat_prefix_span_ === undefined ? undefined : Span.until(pat.span, pat_prefix_span_);

  const ref_pat_matches_mut_ref = this.ref_pat_matches_mut_ref();
  if (ref_pat_matches_mut_ref && pat_mutbl === "Not") {
    // If `&` patterns can match against mutable reference types (RFC 3627, Rule 5), we need
    // to prevent subpatterns from binding with `ref mut`. Subpatterns of a shared reference
    // pattern should have read-only access to the scrutinee, and the borrow checker won't
    // catch it in this case.
    pat_info.max_ref_mutbl = MutblCap_methods().cap_to_weakly_not(pat_info.max_ref_mutbl, pat_prefix_span);
  }

  expected = this.deeply_resolve_ignoring_regions_with_obligations(expected, fold_Ty);
  // Determine whether we're consuming an inherited reference and resetting the default
  // binding mode, based on edition and enabled experimental features.
  const binding_mode = pat_info.binding_mode;
  if (binding_mode.$ === "Yes" && pat_pinned === binding_mode._0) {
    const inh_mut = binding_mode._1;
    const rule: InheritedRefMatchRule = this.ref_pat_matches_inherited_ref(Span.edition(pat.span));
    if (rule.$ === "EatOuter") {
      // ref pattern attempts to consume inherited reference
      if (Mutability_cmp(pat_mutbl, inh_mut) > 0) {
        // Tried to match inherited `ref` with `&mut`
        // NB: This assumes that `&` patterns can match against mutable references
        // (RFC 3627, Rule 5). If we implement a pattern typing ruleset with Rule 4E
        // but not Rule 5, we'll need to check that here.
        // debug_assert!(ref_pat_matches_mut_ref);
        this.error_inherited_ref_mutability_mismatch(pat, pat_prefix_span);
      }

      pat_info.binding_mode = ByRef.No;
      this.typeck_results.skipped_ref_pats_mut().insert(pat.hir_id);
      this.check_pat(inner, expected, pat_info);
      return expected;
    } else if (rule.$ === "EatInner") {
      const ek = expected.kind();
      if (ek.$ === "Ref" && Mutability_cmp(pat_mutbl, ek._2) <= 0) {
        const r_mutbl = ek._2;
        // Match against the reference type; don't consume the inherited ref.
        // NB: The check for compatible pattern and ref type mutability assumes that
        // `&` patterns can match against mutable references (RFC 3627, Rule 5). If
        // we implement a pattern typing ruleset with Rule 4 (including the fallback
        // to matching the inherited ref when the inner ref can't match) but not
        // Rule 5, we'll need to check that here.
        // debug_assert!(ref_pat_matches_mut_ref);
        // NB: For RFC 3627's Rule 3, we limit the default binding mode's ref
        // mutability to `pat_info.max_ref_mutbl`. If we implement a pattern typing
        // ruleset with Rule 4 but not Rule 3, we'll need to check that here.
        // debug_assert!(self.downgrade_mut_inside_shared());
        const cap = MutblCap_methods().as_mutbl(pat_info.max_ref_mutbl);
        // cmp::min(r_mutbl, cap) (derived `Ord`)
        const mutbl_cap = Mutability_cmp(cap, r_mutbl) < 0 ? cap : r_mutbl;
        pat_info.binding_mode = ByRef.cap_ref_mutability(pat_info.binding_mode, mutbl_cap);
      } else {
        // The reference pattern can't match against the expected type, so try
        // matching against the inherited ref instead.
        if (Mutability_cmp(pat_mutbl, inh_mut) > 0) {
          // We can't match an inherited shared reference with `&mut`.
          // NB: This assumes that `&` patterns can match against mutable
          // references (RFC 3627, Rule 5). If we implement a pattern typing
          // ruleset with Rule 4 but not Rule 5, we'll need to check that here.
          // FIXME(ref_pat_eat_one_layer_2024_structural): If we already tried
          // matching the real reference, the error message should explain that
          // falling back to the inherited reference didn't work. This should be
          // the same error as the old-Edition version below.
          // debug_assert!(ref_pat_matches_mut_ref);
          this.error_inherited_ref_mutability_mismatch(pat, pat_prefix_span);
        }

        pat_info.binding_mode = ByRef.No;
        this.typeck_results.skipped_ref_pats_mut().insert(pat.hir_id);
        this.check_pat(inner, expected, pat_info);
        return expected;
      }
    } else if (rule.$ === "EatBoth" && rule.consider_inherited_ref) {
      // Reset binding mode on old editions
      pat_info.binding_mode = ByRef.No;

      const ek = expected.kind();
      if (ek.$ === "Ref") {
        const inner_ty = ek._1;
        // Consume both the inherited and inner references.
        if (pat_mutbl === "Mut" && inh_mut === "Mut") {
          // As a special case, a `&mut` reference pattern will be able to match
          // against a reference type of any mutability if the inherited ref is
          // mutable. Since this allows us to match against a shared reference
          // type, we refer to this as "falling back" to matching the inherited
          // reference, though we consume the real reference as well. We handle
          // this here to avoid adding this case to the common logic below.
          this.check_pat(inner, inner_ty, pat_info);
          return expected;
        } else {
          // Otherwise, use the common logic below for matching the inner
          // reference type.
          // FIXME(ref_pat_eat_one_layer_2024_structural): If this results in a
          // mutability mismatch, the error message should explain that falling
          // back to the inherited reference didn't work. This should be the same
          // error as the Edition 2024 version above.
        }
      } else {
        // The expected type isn't a reference type, so only match against the
        // inherited reference.
        if (Mutability_cmp(pat_mutbl, inh_mut) > 0) {
          // We can't match a lone inherited shared reference with `&mut`.
          this.error_inherited_ref_mutability_mismatch(pat, pat_prefix_span);
        }

        this.typeck_results.skipped_ref_pats_mut().insert(pat.hir_id);
        this.check_pat(inner, expected, pat_info);
        return expected;
      }
    } else {
      // InheritedRefMatchRule::EatBoth { consider_inherited_ref: false }
      // Reset binding mode on stable Rust. This will be a type error below if
      // `expected` is not a reference type.
      pat_info.binding_mode = ByRef.No;
      this.add_rust_2024_migration_desugared_pat(
        pat_info.top_info.hir_id,
        pat,
        pat_mutbl === "Not"
          ? ch("&") // last char of `&`
          : ch("t"), // last char of `&mut`
        inh_mut,
      );
    }
  }

  let ref_ty: Ty;
  let inner_ty: Ty;
  const deref_r = this.check_dereferenceable(pat.span, expected, inner);
  if (deref_r.$ === "Ok") {
    // `demand::subtype` would be good enough, but using `eqtype` turns
    // out to be equally general. See (note_1) for details.

    // Take region, inner-type from expected type if we can,
    // to avoid creating needless variables. This also helps with
    // the bad interactions of the given hack detailed in (note_1).
    // debug!("check_pat_ref: expected={:?}", expected);
    const m = expected.maybe_pinned_ref();
    if (
      m !== undefined &&
      ((ref_pat_matches_mut_ref && Mutability_cmp(m[2], pat_mutbl) >= 0) || m[2] === pat_mutbl) &&
      pat_pinned === m[1]
    ) {
      const [r_ty, r_pinned, r_mutbl] = m;
      if (r_mutbl === "Not") {
        pat_info.max_ref_mutbl = pat_mod.MutblCap.Not;
      }
      if (r_pinned === "Pinned") {
        pat_info.max_pinnedness = "Pinned";
      }

      [ref_ty, inner_ty] = [expected, r_ty];
    } else {
      const inner_ty_ = this.next_ty_var(inner.span);
      const ref_ty_ = this.new_ref_ty(pat.span, pat_pinned, pat_mutbl, inner_ty_);
      // debug!("check_pat_ref: demanding {:?} = {:?}", expected, ref_ty);
      const err = this.demand_eqtype_pat_diag(pat.span, expected, ref_ty_, pat_info.top_info);

      // Look for a case like `fn foo(&foo: u32)` and suggest
      // `fn foo(foo: &u32)`
      if (err.$ === "Err") {
        const e = err._0;
        this.borrow_pat_suggestion(e, pat);
        e.emit();
      }
      [ref_ty, inner_ty] = [ref_ty_, inner_ty_];
    }
  } else {
    const guar = deref_r._0;
    const err = Ty.new_error(tcx, guar);
    [ref_ty, inner_ty] = [err, err];
  }

  this.check_pat(inner, inner_ty, pat_info);
  return ref_ty;
};

/// Create a reference or pinned reference type with a fresh region variable.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:2975 new_ref_ty
FnCtxt.prototype.new_ref_ty = function (this: FnCtxt, span: Span, pinnedness: Pinnedness, mutbl: Mutability, ty: Ty): Ty {
  const region = this.next_region_var({ $: "PatternRegion", _0: span });
  const ref_ty = Ty.new_ref(this.tcx, region, ty, mutbl);
  if (Pinnedness.is_pinned(pinnedness)) {
    return this.new_pinned_ty(span, ref_ty);
  }
  return ref_ty;
};

/// Create a pinned type.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:2991 new_pinned_ty
FnCtxt.prototype.new_pinned_ty = function (this: FnCtxt, span: Span, ty: Ty): Ty {
  return Ty.new_adt(this.tcx, this.tcx.adt_def(this.tcx.require_lang_item("Pin" satisfies LangItem, span)) as AdtDef, this.tcx.mk_args([ty]));
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2999 error_inherited_ref_mutability_mismatch
FnCtxt.prototype.error_inherited_ref_mutability_mismatch = function (this: FnCtxt, pat: hir.Pat, pat_prefix_span: Span | undefined): ErrorGuaranteed {
  const err_msg = "mismatched types";
  let err: Diag;
  if (pat_prefix_span !== undefined) {
    const span = pat_prefix_span;
    const err_ = this.dcx().struct_span_err(span, err_msg);
    err_.code(E0308);
    err_.note("cannot match inherited `&` with `&mut` pattern");
    err_.span_suggestion_verbose(span, "replace this `&mut` pattern with `&`", "&", "MachineApplicable");
    err = err_;
  } else {
    err = this.dcx().struct_span_err(pat.span, err_msg);
  }
  return err.emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:3022 try_resolve_slice_ty_to_array_ty
FnCtxt.prototype.try_resolve_slice_ty_to_array_ty = function (this: FnCtxt, before: readonly hir.Pat[], slice: hir.Pat | undefined, span: Span): Ty | undefined {
  if (slice !== undefined) {
    return undefined;
  }

  const tcx = this.tcx;
  const len = before.length;
  const inner_ty = this.next_ty_var(span);

  return Ty.new_array(tcx, inner_ty, len);
};

/// Used to determines whether we can infer the expected type in the slice pattern to be of type array.
/// This is only possible if we're in an irrefutable pattern. If we were to allow this in refutable
/// patterns we wouldn't e.g. report ambiguity in the following situation:
///
/// ```ignore(rust)
/// struct Zeroes;
///    const ARR: [usize; 2] = [0; 2];
///    const ARR2: [usize; 2] = [2; 2];
///
///    impl Into<&'static [usize; 2]> for Zeroes {
///        fn into(self) -> &'static [usize; 2] {
///            &ARR
///        }
///    }
///
///    impl Into<&'static [usize]> for Zeroes {
///        fn into(self) -> &'static [usize] {
///            &ARR2
///        }
///    }
///
///    fn main() {
///        let &[a, b]: &[usize] = Zeroes.into() else {
///           ..
///        };
///    }
/// ```
///
/// If we're in an irrefutable pattern we prefer the array impl candidate given that
/// the slice impl candidate would be rejected anyway (if no ambiguity existed).
// rustc: compiler/rustc_hir_typeck/src/pat.rs:3069 pat_is_irrefutable
FnCtxt.prototype.pat_is_irrefutable = function (this: FnCtxt, decl_origin: DeclOrigin | undefined): boolean {
  if (decl_origin !== undefined && decl_origin.$ === "LocalDecl" && decl_origin.els === undefined) {
    return true;
  }
  // Some(DeclOrigin::LocalDecl { els: Some(_) } | DeclOrigin::LetExpr) | None
  return false;
};

/// Type check a slice pattern.
///
/// Syntactically, these look like `[pat_0, ..., pat_n]`.
/// Semantically, we are type checking a pattern with structure:
/// ```ignore (not-rust)
/// [before_0, ..., before_n, (slice, after_0, ... after_n)?]
/// ```
/// The type of `slice`, if it is present, depends on the `expected` type.
/// If `slice` is missing, then so is `after_i`.
/// If `slice` is present, it can still represent 0 elements.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:3086 check_pat_slice
FnCtxt.prototype.check_pat_slice = function (
  this: FnCtxt,
  span: Span,
  before: readonly hir.Pat[],
  slice: hir.Pat | undefined,
  after: readonly hir.Pat[],
  expected_: Ty,
  pat_info: PatInfo,
): Ty {
  const expected0 = this.deeply_resolve_ignoring_regions_with_obligations(expected_, fold_Ty);

  // If the pattern is irrefutable and `expected` is an infer ty, we try to equate it
  // to an array if the given pattern allows it. See issue #76342
  if (this.pat_is_irrefutable(pat_info.decl_origin) && expected0.is_ty_var()) {
    const resolved_arr_ty = this.try_resolve_slice_ty_to_array_ty(before, slice, span);
    if (resolved_arr_ty !== undefined) {
      // debug!(?resolved_arr_ty);
      this.demand_eqtype(span, expected0, resolved_arr_ty);
    }
  }

  const expected = this.structurally_resolve_type(span, expected0);
  // debug!(?expected);

  let element_ty: Ty;
  let opt_slice_ty: Ty | undefined;
  let inferred: Ty;
  const k = expected.kind();
  if (k.$ === "Array") {
    // An array, so we might have something like `let [a, b, c] = [0, 1, 2];`.
    const element_ty_ = k._0;
    const len = k._1;
    const min = before.length + after.length;
    const [opt_slice_ty_, expected_] = this.check_array_pat_len(span, element_ty_, expected, slice, len, min);
    // `opt_slice_ty.is_none()` => `slice.is_none()`.
    // Note, though, that opt_slice_ty could be `Some(error_ty)`.
    assert(opt_slice_ty_ !== undefined || slice === undefined, "assertion failed: opt_slice_ty.is_some() || slice.is_none()");
    [element_ty, opt_slice_ty, inferred] = [element_ty_, opt_slice_ty_, expected_];
  } else if (k.$ === "Slice") {
    [element_ty, opt_slice_ty, inferred] = [k._0, expected, expected];
  } else {
    // The expected type must be an array or slice, but was neither, so error.
    const r = TypeVisitableExt.error_reported(expected, fold_Ty);
    const guar = r.$ === "Err" ? r._0 : this.error_expected_array_or_slice(span, expected, pat_info);
    const err = Ty.new_error(this.tcx, guar);
    [element_ty, opt_slice_ty, inferred] = [err, err, err];
  }

  // Type check all the patterns before `slice`.
  for (const elt of before) {
    this.check_pat(elt, element_ty, pat_info);
  }
  // Type check the `slice`, if present, against its expected type.
  if (slice !== undefined) {
    this.check_pat(slice, unwrap(opt_slice_ty), pat_info);
  }
  // Type check the elements after `slice`, if present.
  for (const elt of after) {
    this.check_pat(elt, element_ty, pat_info);
  }
  return inferred;
};

/// Type check the length of an array pattern.
///
/// Returns both the type of the variable length pattern (or `None`), and the potentially
/// inferred array type. We only return `None` for the slice type if `slice.is_none()`.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:3152 check_array_pat_len
FnCtxt.prototype.check_array_pat_len = function (
  this: FnCtxt,
  span: Span,
  element_ty: Ty,
  arr_ty: Ty,
  slice: hir.Pat | undefined,
  len_: Const,
  min_len: number,
): [Ty | undefined, Ty] {
  const len = this.try_structurally_resolve_const(span, len_).try_to_target_usize(this.tcx);

  let guar: ErrorGuaranteed;
  if (len !== undefined) {
    // Now we know the length...
    if (slice === undefined) {
      // ...and since there is no variable-length pattern,
      // we require an exact match between the number of elements
      // in the array pattern and as provided by the matched type.
      if (min_len === len) {
        return [undefined, arr_ty];
      }

      guar = this.error_scrutinee_inconsistent_length(span, min_len, len);
    } else if (len >= min_len) {
      // `len.checked_sub(min_len)` is `Some(pat_len)`
      const pat_len = len - min_len;
      // The variable-length pattern was there,
      // so it has an array type with the remaining elements left as its size...
      return [Ty.new_array(this.tcx, element_ty, pat_len), arr_ty];
    } else {
      // ...however, in this case, there were no remaining elements.
      // That is, the slice pattern requires more than the array type offers.
      guar = this.error_scrutinee_with_rest_inconsistent_length(span, min_len, len);
    }
  } else if (slice === undefined) {
    // We have a pattern with a fixed length,
    // which we can use to infer the length of the array.
    const updated_arr_ty = Ty.new_array(this.tcx, element_ty, min_len);
    this.demand_eqtype(span, updated_arr_ty, arr_ty);
    return [undefined, updated_arr_ty];
  } else {
    // We have a variable-length pattern and don't know the array length.
    // This happens if we have e.g.,
    // `let [a, b, ..] = arr` where `arr: [T; N]` where `const N: usize`.
    guar = this.error_scrutinee_unfixed_length(span);
  }

  // If we get here, we must have emitted an error.
  return [Ty.new_error(this.tcx, guar), arr_ty];
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:3200 error_scrutinee_inconsistent_length
FnCtxt.prototype.error_scrutinee_inconsistent_length = function (this: FnCtxt, span: Span, min_len: number, size: number): ErrorGuaranteed {
  return struct_span_code_err(this.dcx(), span, E0527, `pattern requires ${min_len} element${pluralize(min_len)} but array has ${size}`)
    .with_span_label(span, `expected ${size} element${pluralize(size)}`)
    .emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:3219 error_scrutinee_with_rest_inconsistent_length
FnCtxt.prototype.error_scrutinee_with_rest_inconsistent_length = function (this: FnCtxt, span: Span, min_len: number, size: number): ErrorGuaranteed {
  return struct_span_code_err(this.dcx(), span, E0528, `pattern requires at least ${min_len} element${pluralize(min_len)} but array has ${size}`)
    .with_span_label(span, `pattern cannot match array of ${size} element${pluralize(size)}`)
    .emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:3241 error_scrutinee_unfixed_length
FnCtxt.prototype.error_scrutinee_unfixed_length = function (this: FnCtxt, span: Span): ErrorGuaranteed {
  return struct_span_code_err(this.dcx(), span, E0730, "cannot pattern-match on an array without a fixed length").emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:3251 error_expected_array_or_slice
FnCtxt.prototype.error_expected_array_or_slice = function (this: FnCtxt, span: Span, expected_ty: Ty, pat_info: PatInfo): ErrorGuaranteed {
  const { top_info: ti, current_depth } = pat_info;

  let slice_pat_semantics = false;
  let as_deref: AsDerefSuggestion | undefined = undefined;
  let slicing: SlicingSuggestion | undefined = undefined;
  const ek = expected_ty.kind();
  const ref_inner = ek.$ === "Ref" ? ek._1.kind() : undefined;
  if (ref_inner !== undefined && (ref_inner.$ === "Array" || ref_inner.$ === "Slice")) {
    slice_pat_semantics = true;
  } else {
    let any = false;
    for (const [ty] of this.autoderef(span, expected_ty).silence_errors()) {
      const tk = ty.kind();
      if (tk.$ === "Slice" || tk.$ === "Array") {
        any = true;
        break;
      }
    }
    const ti_span = ti.span;
    if (any && ti_span !== undefined && ti.origin_expr !== undefined) {
      const span = ti_span;
      const resolved_ty_ = this.deeply_resolve_ignoring_regions(ti.expected, fold_Ty);
      const [is_slice_or_array_or_vector, resolved_ty] = this.is_slice_or_array_or_vector(resolved_ty_);
      const rk = resolved_ty.kind();
      if (rk.$ === "Adt" && (this.tcx.is_diagnostic_item(sym.Option, rk._0.did()) || this.tcx.is_diagnostic_item(sym.Result, rk._0.did()))) {
        // Slicing won't work here, but `.as_deref()` might (issue #91328).
        as_deref = { span: Span.shrink_to_hi(span) };
      }

      const is_top_level = current_depth <= 1;
      if (is_slice_or_array_or_vector && is_top_level) {
        slicing = { span: Span.shrink_to_hi(span) };
      }
    }
  }
  return this.dcx().emit_err(
    ExpectedArrayOrSlice_diagnostic({
      span,
      ty: expected_ty,
      slice_pat_semantics,
      as_deref,
      slicing,
    }),
  );
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:3301 is_slice_or_array_or_vector
FnCtxt.prototype.is_slice_or_array_or_vector = function (this: FnCtxt, ty: Ty): [boolean, Ty] {
  const k = ty.kind();
  if (k.$ === "Adt" && this.tcx.is_diagnostic_item(sym.Vec, k._0.did())) {
    return [true, ty];
  } else if (k.$ === "Ref") {
    return this.is_slice_or_array_or_vector(k._1);
  } else if (k.$ === "Slice" || k.$ === "Array") {
    return [true, ty];
  } else {
    return [false, ty];
  }
};

/// Record a pattern that's invalid under Rust 2024 match ergonomics, along with a problematic
/// span, so that the pattern migration lint can desugar it during THIR construction.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:3314 add_rust_2024_migration_desugared_pat
FnCtxt.prototype.add_rust_2024_migration_desugared_pat = function (this: FnCtxt, pat_id: HirId, subpat: hir.Pat, final_char: number, def_br_mutbl: Mutability): void {
  // Try to trim the span we're labeling to just the `&` or binding mode that's an issue.
  const from_expansion = Span.from_expansion(subpat.span);
  let trimmed_span: Span;
  if (from_expansion) {
    // If the subpattern is from an expansion, highlight the whole macro call instead.
    trimmed_span = subpat.span;
  } else {
    const trimmed = this.tcx.sess.source_map().span_through_char(subpat.span, final_char);
    // The edition of the trimmed span should be the same as `subpat.span`; this will be a
    // a hard error if the subpattern is of edition >= 2024. We set it manually to be sure:
    trimmed_span = Span.with_ctxt(trimmed, Span.ctxt(subpat.span));
  }

  const typeck_results = this.typeck_results;
  const table = typeck_results.rust_2024_migration_desugared_pats_mut();
  // FIXME(ref_pat_eat_one_layer_2024): The migration diagnostic doesn't know how to track the
  // default binding mode in the presence of Rule 3 or Rule 5. As a consequence, the labels it
  // gives for default binding modes are wrong, as well as suggestions based on the default
  // binding mode. This keeps it from making those suggestions, as doing so could panic.
  const info: Rust2024IncompatiblePatInfo = table.entry(pat_id).or_insert_with(
    (): Rust2024IncompatiblePatInfo => ({
      primary_labels: [],
      bad_ref_modifiers: false,
      bad_mut_modifiers: false,
      bad_ref_pats: false,
      suggest_eliding_modes: !this.tcx.features().ref_pat_eat_one_layer_2024() && !this.tcx.features().ref_pat_eat_one_layer_2024_structural(),
    }),
  ).value;

  let pat_kind: string;
  if (subpat.kind.$ === "Binding") {
    const user_bind_annot = subpat.kind._0;
    // If the user-provided binding modifier doesn't match the default binding mode, we'll
    // need to suggest reference patterns, which can affect other bindings.
    // For simplicity, we opt to suggest making the pattern fully explicit.
    info.suggest_eliding_modes =
      info.suggest_eliding_modes && user_bind_annot._0.$ === "Yes" && user_bind_annot._1 === "Not" && user_bind_annot._0._1 === def_br_mutbl;
    if (BindingMode_eq(user_bind_annot, new BindingMode(ByRef.No, "Mut"))) {
      info.bad_mut_modifiers = true;
      pat_kind = "`mut` binding modifier";
    } else {
      info.bad_ref_modifiers = true;
      switch (user_bind_annot._1) {
        case "Not":
          pat_kind = "explicit `ref` binding modifier";
          break;
        case "Mut":
          pat_kind = "explicit `ref mut` binding modifier";
          break;
      }
    }
  } else {
    info.bad_ref_pats = true;
    // For simplicity, we don't try to suggest eliding reference patterns. Thus, we'll
    // suggest adding them instead, which can affect the types assigned to bindings.
    // As such, we opt to suggest making the pattern fully explicit.
    info.suggest_eliding_modes = false;
    pat_kind = "reference pattern";
  }
  // Only provide a detailed label if the problematic subpattern isn't from an expansion.
  // In the case that it's from a macro, we'll add a more detailed note in the emitter.
  let primary_label: string;
  if (from_expansion) {
    // We can't suggest eliding modifiers within expansions.
    info.suggest_eliding_modes = false;
    // NB: This wording assumes the only expansions that can produce problematic reference
    // patterns and bindings are macros. If a desugaring or AST pass is added that can do
    // so, we may want to inspect the span's source callee or macro backtrace.
    primary_label = "occurs within macro expansion";
  } else {
    primary_label = `${pat_kind} not allowed when implicitly borrowing`;
  }
  info.primary_labels.push([trimmed_span, primary_label]);
};

// pat.rs:49 (stub; final signature: decls.ts `Fns_pat`)
export function is_number(text: string): boolean {
  return unported("rustc_hir_typeck::pat::is_number");
}
