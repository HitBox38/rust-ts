// Port of compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/trait_impl_difference.rs (lane errrep-nice-region).
//
//! Error Reporting for `impl` items that do not match the obligations from their `trait`.
//
// `impl NiceRegionError` methods are assigned onto `NiceRegionError.prototype` (declared in the crate decls.ts);
// `TypeParamSpanVisitor` (an intravisit `Visitor`) is a hand class; `emit_err`'s fn-local `HighlightBuilder` (a
// `TypeVisitor`) is a module-local class.
// Init order: top-level code here touches only this file's .gen.ts, ./mod.ts (`NiceRegionError`) and other crates;
// the crate's other modules (diagnostics, ./placeholder_error.ts) are read inside function bodies only.
export * from "./trait_impl_difference.gen.ts";
import { type VisitorResult, VisitorResult as VisitorResultC } from "../../../../rustc_ast_ir/visit.ts";
import { Namespace } from "../../../../rustc_hir/def.ts";
import * as hir from "../../../../rustc_hir/lib.ts";
import type { HirTyCtxt } from "../../../../rustc_hir/intravisit.ts";
import type { HirId } from "../../../../rustc_hir_id/lib.ts";
import { RegionVariableOrigin } from "../../../../rustc_infer/infer/mod.ts";
import { TyCtxt_as_HirTyCtxt } from "../../../../rustc_middle/hir/map.ts";
import { OnlyBodies } from "../../../../rustc_middle/hir/nested_filter.ts";
import type { AssocItem } from "../../../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../../../rustc_middle/ty/context.ts";
import type { Clauses } from "../../../../rustc_middle/ty/list.ts";
import type { Ty } from "../../../../rustc_middle/ty/mod.ts";
import { type PrettyPrinter, RegionHighlightMode } from "../../../../rustc_middle/ty/print/pretty.ts";
import { print_Binder, print_FnSig } from "../../../../rustc_middle/ty/print/pretty.ts";
import { type DefId, LocalDefId } from "../../../../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../../../../rustc_span/lib.ts";
import { display_Ident, display_Symbol } from "../../../../rustc_span/symbol.ts";
import { type Binder, fold_Binder } from "../../../../rustc_type_ir/binder.ts";
import type { PolyFnSig } from "../../../../rustc_type_ir/decls.ts";
import type { PredicateProxy } from "../../../../rustc_type_ir/fold.ts";
import type { Const } from "../../../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../../../rustc_type_ir/sty/mod.ts";
import { type FnSig, fold_FnSig } from "../../../../rustc_type_ir/ty_kind.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../../../../rustc_type_ir/visit.ts";
import { intern_key } from "../../../../rust_ts/intern_key.ts";
import type { ElidedLifetimeInPath } from "./trait_impl_difference.gen.ts";
import { NiceRegionError } from "./mod.ts";

/** The crate's diagnostics.gen.ts (read lazily, init order). */
function diagnostics_gen(): typeof import("../../../diagnostics.gen.ts") {
  return require("../../../diagnostics.gen.ts") as typeof import("../../../diagnostics.gen.ts");
}

/** ./placeholder_error.ts (read lazily, init order). */
function placeholder_error(): typeof import("./placeholder_error.ts") {
  return require("./placeholder_error.ts") as typeof import("./placeholder_error.ts");
}

/** `Binder<FnSig>`'s `Print` (pretty.rs's generic `impl Print for Binder<T>` with `FnSig`). */
function print_PolyFnSig(self: Binder<FnSig>, p: PrettyPrinter) {
  return print_Binder(self, p, print_FnSig, fold_FnSig);
}

// impl<'a, 'tcx> NiceRegionError<'a, 'tcx> {
/// Print the error message for lifetime errors when the `impl` doesn't conform to the `trait`.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/trait_impl_difference.rs:24 try_report_impl_not_conforming_to_trait
NiceRegionError.prototype.try_report_impl_not_conforming_to_trait = function (this: NiceRegionError): ErrorGuaranteed | undefined {
  const error = this.error;
  if (error === undefined) return undefined;
  // debug!("try_report_impl_not_conforming_to_trait {:?}", error);
  // PORT: `error.clone()` only moves the matched fields out; nothing is mutated, so they are read in place.
  if (error.$ === "SubSupConflict") {
    const [var_origin, sub_origin, sup_origin] = [error._1, error._2, error._4];
    if (sup_origin.$ === "Subtype" && sub_origin.$ === "Subtype") {
      const sup_trace = sup_origin._0;
      const sub_trace = sub_origin._0;
      const code = sub_trace.cause.code_();
      // PORT: `ValuePairs`' derived `PartialEq` is `intern_key` equality (rust_ts/intern_key.ts).
      if (code.$ === "CompareImplItem" && intern_key(sub_trace.values) === intern_key(sup_trace.values) && sub_trace.values.$ === "PolySigs") {
        const { trait_item_def_id, impl_item_def_id } = code;
        // PORT: generated `ValuePairs::PolySigs` carries `ExpectedFound<unknown>` (its `PolyFnSig` is not mapped).
        const { expected, found } = sub_trace.values._0 as { expected: PolyFnSig; found: PolyFnSig };
        // FIXME(compiler-errors): Don't like that this needs `Ty`s, but
        // all of the region highlighting machinery only deals with those.
        const guar = this.emit_err(RegionVariableOrigin.span(var_origin), expected, found, trait_item_def_id, LocalDefId.to_def_id(impl_item_def_id));
        return guar;
      }
    }
  }
  return undefined;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/trait_impl_difference.rs:58 emit_err
NiceRegionError.prototype.emit_err = function (this: NiceRegionError, sp: Span, expected_: PolyFnSig, found_: PolyFnSig, trait_item_def_id: DefId, impl_item_def_id: DefId): ErrorGuaranteed {
  const { Highlighted, Highlighted_to_string } = placeholder_error();
  const trait_sp = this.tcx().def_span(trait_item_def_id);

  // Mark all unnamed regions in the type with a number.
  // This diagnostic is called in response to lifetime errors, so be informative.
  // (struct HighlightBuilder: module-local class below)

  const tcx = this.cx.tcx;
  const expected_highlight = HighlightBuilder.build(tcx, expected_);
  const expected_short = Highlighted_to_string(new Highlighted(tcx, expected_highlight.clone(), expected_, Namespace.TypeNS), print_PolyFnSig);
  expected_highlight.keep_regions = false;
  const expected = Highlighted_to_string(new Highlighted(tcx, expected_highlight.clone(), expected_, Namespace.TypeNS), print_PolyFnSig);
  const found_highlight = HighlightBuilder.build(tcx, found_);
  const found_short = Highlighted_to_string(new Highlighted(tcx, found_highlight.clone(), found_, Namespace.TypeNS), print_PolyFnSig);
  found_highlight.keep_regions = false;
  const found = Highlighted_to_string(new Highlighted(tcx, found_highlight.clone(), found_, Namespace.TypeNS), print_PolyFnSig);

  // Get the span of all the used type parameters in the method.
  const assoc_item = this.tcx().associated_item(trait_item_def_id) as AssocItem;
  const visitor = new TypeParamSpanVisitor(this.tcx(), [], []);
  switch (assoc_item.kind.$) {
    case "Fn": {
      const id = assoc_item.def_id.as_local();
      const hir_id = id !== undefined ? this.tcx().local_def_id_to_hir_id(id) : undefined;
      let decl;
      if (hir_id !== undefined && (decl = this.tcx().hir_fn_decl_by_hir_id(hir_id)) !== undefined) {
        visitor.visit_fn_decl(decl);
      }
      break;
    }
    default:
      break;
  }

  const d = diagnostics_gen();
  const diag_ = d.TraitImplDiff_diagnostic({
    sp,
    trait_sp,
    note: null,
    param_help: { spans: visitor.types.slice() },
    rel_help: visitor.types.length === 0,
    expected,
    found,
    expected_short,
    found_short,
    trait_span: Span.shrink_to_lo(this.tcx().def_span(this.tcx().parent(trait_item_def_id))),
    impl_span: Span.shrink_to_lo(this.tcx().def_span(this.tcx().parent(impl_item_def_id))),
  });

  const diag = this.tcx().dcx().create_err(diag_);
  // A limit not to make diag verbose.
  const ELIDED_LIFETIME_NOTE_LIMIT = 5;
  const elided_lifetime_paths = visitor.elided_lifetime_paths;
  const total_elided_lifetime_paths = elided_lifetime_paths.length;
  const shown_elided_lifetime_paths = tcx.sess.opts.verbose ? total_elided_lifetime_paths : ELIDED_LIFETIME_NOTE_LIMIT;

  for (const elided of elided_lifetime_paths.slice(0, shown_elided_lifetime_paths)) {
    diag.span_note(elided.span, `\`${display_Ident(elided.ident)}\` here is elided as \`${elided.shorthand}\``);
  }
  if (total_elided_lifetime_paths > shown_elided_lifetime_paths) {
    diag.note(
      `and ${total_elided_lifetime_paths - shown_elided_lifetime_paths} more elided lifetime${
        total_elided_lifetime_paths - shown_elided_lifetime_paths === 1 ? "" : "s"
      } in type paths`,
    );
  }
  return diag.emit_err();
};
// }

// PORT: the fn-local `struct HighlightBuilder<'tcx>` of `emit_err` (trait_impl_difference.rs:70) with its inherent
// impl and `TypeVisitor` impl (`type Result = ()`).
class HighlightBuilder implements TypeVisitor<undefined> {
  readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;

  constructor(
    public tcx: TyCtxt,
    public highlight: RegionHighlightMode,
    public counter: number,
  ) {}

  // impl<'tcx> HighlightBuilder<'tcx>
  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/trait_impl_difference.rs:77 build
  static build(tcx: TyCtxt, sig: PolyFnSig): RegionHighlightMode {
    const builder = new HighlightBuilder(tcx, RegionHighlightMode.default(), 1);
    fold_Binder(fold_FnSig).visit_with(sig, builder);
    return builder.highlight;
  }

  // impl<'tcx> ty::TypeVisitor<TyCtxt<'tcx>> for HighlightBuilder<'tcx>
  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/trait_impl_difference.rs:86 visit_region
  visit_region(r: Region): undefined {
    if (!r.is_named(this.tcx) && this.counter <= 3) {
      this.highlight.highlighting_region(r, this.counter);
      this.counter += 1;
    }
    return undefined;
  }

  // (provided) the `TypeVisitor` methods `HighlightBuilder` does not override.
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_ty(t: Ty): undefined {
    return TypeVisitor_provided.visit_ty(this, t);
  }
  visit_const(c: Const): undefined {
    return TypeVisitor_provided.visit_const(this, c);
  }
  visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }
  visit_clauses(c: Clauses): undefined {
    return TypeVisitor_provided.visit_clauses(this, c);
  }
  visit_error(guar: ErrorGuaranteed): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/trait_impl_difference.rs:189 TypeParamSpanVisitor
export class TypeParamSpanVisitor extends hir.intravisit.Visitor {
  // impl<'tcx> Visitor<'tcx> for TypeParamSpanVisitor<'tcx>
  // type NestedFilter = nested_filter::OnlyBodies;
  override NestedFilter = OnlyBodies;

  constructor(
    public tcx: TyCtxt,
    public types: Span[],
    public elided_lifetime_paths: ElidedLifetimeInPath[],
  ) {
    super();
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/trait_impl_difference.rs:198 maybe_tcx
  override maybe_tcx(): HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.tcx);
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/trait_impl_difference.rs:202 visit_qpath
  override visit_qpath(qpath: hir.QPath, id: HirId, _span: Span): undefined {
    // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/trait_impl_difference.rs:203 record_elided_lifetimes
    function record_elided_lifetimes(tcx: TyCtxt, elided_lifetime_paths: ElidedLifetimeInPath[], segment: hir.PathSegment): void {
      const args = segment.args;
      if (args === undefined) return;
      if (args.parenthesized !== "No") {
        // Our diagnostic rendering below uses `<...>` syntax; skip cases like `Fn(..) -> ..`.
        return;
      }
      const elided_count = args.args.filter((arg) => {
        if (arg.$ !== "Lifetime") return false;
        const l = arg._0;
        return l.syntax === "Implicit" && l.source.$ === "Path";
      }).length;
      if (elided_count === 0 || elided_lifetime_paths.some((p) => p.span === segment.ident.span)) {
        return;
      }

      const sm = tcx.sess.source_map();
      const parts = args.args.map((arg) => {
        switch (arg.$) {
          case "Lifetime": {
            const l = arg._0;
            if (l.syntax === "Implicit" && l.source.$ === "Path") {
              return "'_";
            } else {
              const r = sm.span_to_snippet(l.ident.span);
              return r.$ === "Ok" ? r._0.toString() : `'${display_Symbol(l.ident.name)}`;
            }
          }
          case "Type": {
            const ty = arg._0;
            const r = sm.span_to_snippet(ty.span);
            return r.$ === "Ok" ? r._0.toString() : "..";
          }
          case "Const": {
            const ct = arg._0;
            const r = sm.span_to_snippet(ct.span);
            return r.$ === "Ok" ? r._0.toString() : "..";
          }
          case "Infer":
            return "_";
        }
      });
      parts.push(
        ...args.constraints.map((constraint) => {
          const r = sm.span_to_snippet(constraint.span);
          return r.$ === "Ok" ? r._0.toString() : `${display_Ident(constraint.ident)} = ..`;
        }),
      );
      const shorthand = `${display_Ident(segment.ident)}<${parts.join(", ")}>`;

      elided_lifetime_paths.push({
        span: segment.ident.span,
        ident: segment.ident,
        shorthand,
      });
    }

    switch (qpath.$) {
      case "Resolved": {
        const path = qpath._1;
        for (const segment of path.segments) {
          record_elided_lifetimes(this.tcx, this.elided_lifetime_paths, segment);
        }
        break;
      }
      case "TypeRelative": {
        const segment = qpath._1;
        record_elided_lifetimes(this.tcx, this.elided_lifetime_paths, segment);
        break;
      }
    }

    hir.intravisit.walk_qpath(this, qpath, id);
    return undefined;
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/trait_impl_difference.rs:279 visit_ty
  override visit_ty(arg: hir.Ty<hir.AmbigArg>): undefined {
    const k = arg.kind;
    if (k.$ === "Ref") {
      const ty = k._1;
      // We don't want to suggest looking into borrowing `&T` or `&Self`.
      const ambig_ty = ty.try_as_ambig_ty();
      if (ambig_ty !== undefined) {
        hir.intravisit.walk_ty(this, ambig_ty);
      }
      return undefined;
    } else if (k.$ === "Path" && k._0.$ === "Resolved" && k._0._0 === undefined) {
      const path = k._0._1;
      if (path.segments.length === 1) {
        const segment = path.segments[0]!;
        const res = segment.res;
        if (res.$ === "SelfTyParam" || res.$ === "SelfTyAlias" || (res.$ === "Def" && res._0.$ === "TyParam")) {
          this.types.push(path.span);
        }
      }
    }
    hir.intravisit.walk_ty(this, arg);
    return undefined;
  }
}
