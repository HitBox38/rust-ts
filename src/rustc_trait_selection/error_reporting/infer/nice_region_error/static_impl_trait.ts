// Port of compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/static_impl_trait.rs (lane errrep-nice-region).
//
//! Error Reporting for static impl Traits.
//
// `impl NiceRegionError` methods / associated fns are assigned onto `NiceRegionError.prototype` / `NiceRegionError`
// (declared in the crate decls.ts); `TraitObjectVisitor` (a `TypeVisitor`) and `HirTraitObjectVisitor` (an intravisit
// `Visitor`) are hand classes (tuple-struct fields `_0`, `_1`).
// Init order: top-level code here touches only this file's .gen.ts, ./mod.ts (`NiceRegionError`) and other crates;
// the crate's diagnostics module is read inside function bodies only.
export * from "./static_impl_trait.gen.ts";
import { type VisitorResult, VisitorResult as VisitorResultC } from "../../../../rustc_ast_ir/visit.ts";
import { Applicability, type Diag } from "../../../../rustc_errors/lib.ts";
import * as hir from "../../../../rustc_hir/lib.ts";
import type { Clauses } from "../../../../rustc_middle/ty/list.ts";
import { RawList } from "../../../../rustc_middle/ty/list.ts";
import type { TyCtxt } from "../../../../rustc_middle/ty/context.ts";
import { Ty } from "../../../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../../../rustc_middle/ty/structural_impls.ts";
import { SubregionOrigin, RegionVariableOrigin } from "../../../../rustc_infer/infer/mod.ts";
import { type DefId, DefId_eq, DefIdSet, LocalDefId } from "../../../../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../../../../rustc_span/lib.ts";
import { display_Ident, display_Symbol, type Ident } from "../../../../rustc_span/symbol.ts";
import type { Binder } from "../../../../rustc_type_ir/binder.ts";
import type { PredicateProxy } from "../../../../rustc_type_ir/fold.ts";
import { display_Region } from "../../../../rustc_type_ir/ir_print.ts";
import type { Const } from "../../../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../../../rustc_type_ir/sty/mod.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../../../../rustc_type_ir/visit.ts";
import { NiceRegionError } from "./mod.ts";

/** The crate's diagnostics.gen.ts (read lazily, init order). */
function diagnostics_gen(): typeof import("../../../diagnostics.gen.ts") {
  return require("../../../diagnostics.gen.ts") as typeof import("../../../diagnostics.gen.ts");
}

/** PORT: `[BytePos; 2] < [BytePos; 2]` / `>` (`Span::lo_hi` tuples compare lexicographically). */
function cmp_lo_hi(a: Span, b: Span): number {
  const [a_lo, a_hi] = Span.lo_hi(a);
  const [b_lo, b_hi] = Span.lo_hi(b);
  if (a_lo !== b_lo) return a_lo < b_lo ? -1 : 1;
  if (a_hi !== b_hi) return a_hi < b_hi ? -1 : 1;
  return 0;
}

// impl<'a, 'tcx> NiceRegionError<'a, 'tcx> {
/// Print the error message for lifetime errors when the return type is a static `impl Trait`,
/// `dyn Trait` or if a method call on a trait object introduces a static requirement.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/static_impl_trait.rs:23 try_report_static_impl_trait
NiceRegionError.prototype.try_report_static_impl_trait = function (this: NiceRegionError): ErrorGuaranteed | undefined {
  // debug!("try_report_static_impl_trait(error={:?})", self.error);
  const tcx = this.tcx();
  const error = this.error;
  if (error === undefined) return undefined;
  if (!(error.$ === "SubSupConflict" && error._3.is_static())) return undefined;
  const [var_origin, sub_origin, sub_r, sup_origin, sup_r, spans_] = [error._1, error._2, error._3, error._4, error._5, error._6];
  // debug!("try_report_static_impl_trait(var={:?}, sub={:?} {:?} sup={:?} {:?})", var_origin, sub_origin, sub_r, sup_origin, sup_r);
  const anon_reg_sup = tcx.is_suitable_region(this.generic_param_scope, sup_r);
  if (anon_reg_sup === undefined) return undefined;
  // debug!("try_report_static_impl_trait: anon_reg_sup={:?}", anon_reg_sup);
  const sp = RegionVariableOrigin.span(var_origin);
  const return_sp = SubregionOrigin.span(sub_origin);
  const param = this.find_param_with_region(sup_r, sub_r);
  if (param === undefined) return undefined;
  const simple_ident = param.param.pat.simple_ident();
  const lifetime_name = sup_r.is_named(this.tcx()) ? display_Region(sup_r) : "'_";

  let mention_influencer: boolean;
  let influencer_point: Span;
  if (Span.overlaps(SubregionOrigin.span(sup_origin), param.param_ty_span)) {
    // Account for `async fn` like in `async-await/issues/issue-62097.rs`.
    // The desugaring of `async fn`s causes `sup_origin` and `param` to point at the same
    // place (but with different `ctxt`, hence `overlaps` instead of `==` above).
    //
    // This avoids the following:
    //
    // LL |     pub async fn run_dummy_fn(&self) {
    //    |                               ^^^^^
    //    |                               |
    //    |                               this data with an anonymous lifetime `'_`...
    //    |                               ...is captured here...
    [mention_influencer, influencer_point] = [false, SubregionOrigin.span(sup_origin)];
  } else {
    [mention_influencer, influencer_point] = [!Span.overlaps(SubregionOrigin.span(sup_origin), return_sp), param.param_ty_span];
  }

  // debug!("try_report_static_impl_trait: param_info={:?}", param);

  let spans = spans_.slice();

  if (mention_influencer) {
    spans.push(SubregionOrigin.span(sup_origin));
  }
  // We sort and dedup the spans *ignoring* expansion context.
  spans.sort(cmp_lo_hi);
  spans = spans.filter((span, i) => i === 0 || cmp_lo_hi(spans[i - 1]!, span) !== 0);

  // We try to make the output have fewer overlapping spans if possible.
  const require_span = Span.overlaps(SubregionOrigin.span(sup_origin), return_sp) ? SubregionOrigin.span(sup_origin) : return_sp;

  const spans_empty = spans.length === 0;
  const require_as_note = spans.some((sp) => Span.overlaps(sp, return_sp) || cmp_lo_hi(sp, return_sp) > 0);
  let bound: Span | undefined;
  if (sub_origin.$ === "RelateParamBound" && sub_origin._2 !== undefined) {
    bound = sub_origin._2;
  } else {
    bound = undefined;
  }

  const diag = diagnostics_gen().ButNeedsToSatisfy_diagnostic({
    sp,
    influencer_point,
    spans: spans.slice(),
    // If any of the "captured here" labels appears on the same line or after
    // `require_span`, we put it on a note to ensure the text flows by appearing
    // always at the end.
    require_span_as_note: require_as_note ? require_span : undefined,
    // We don't need a note, it's already at the end, it can be shown as a `span_label`.
    require_span_as_label: !require_as_note ? require_span : undefined,

    has_lifetime: sup_r.is_named(this.tcx()),
    lifetime: lifetime_name,
    has_param_name: simple_ident !== undefined,
    param_name: simple_ident !== undefined ? display_Ident(simple_ident) : "",
    spans_empty,
    bound,
  });

  const err = this.tcx().dcx().create_err(diag);

  const fn_returns = tcx.return_type_impl_or_dyn_traits(anon_reg_sup.scope);

  const simple_ident_2 = param.param.pat.simple_ident();
  const arg = simple_ident_2 !== undefined ? `argument \`${display_Ident(simple_ident_2)}\`` : "the argument";
  const captures = `captures data from ${arg}`;
  suggest_new_region_bound(tcx, err, fn_returns, lifetime_name, arg, captures, [param.param_ty_span, display_Ty(param.param_ty)], anon_reg_sup.scope);

  const guar = err.emit_err();
  return guar;
};
// }

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/static_impl_trait.rs:137 suggest_new_region_bound
export function suggest_new_region_bound(
  tcx: TyCtxt,
  err: Diag,
  fn_returns: hir.Ty[],
  lifetime_name: string,
  arg: string | undefined,
  captures: string,
  param: [Span, string] | undefined,
  scope_def_id: LocalDefId | undefined,
): void {
  // debug!("try_report_static_impl_trait: fn_return={:?}", fn_returns);
  // FIXME: account for the need of parens in `&(dyn Trait + '_)`
  const consider = "consider changing";
  const declare = "to declare that";
  const explicit = `you can add an explicit \`${lifetime_name}\` lifetime bound`;
  const explicit_static = arg !== undefined ? `explicit \`'static\` bound to the lifetime of ${arg}` : undefined;
  const add_static_bound = "alternatively, add an explicit `'static` bound to this reference";
  const plus_lt = ` + ${lifetime_name}`;
  for (const fn_return of fn_returns) {
    if (Span.desugaring_kind(fn_return.span) !== undefined) {
      // Skip `async` desugaring `impl Future`.
      continue;
    }
    const k = fn_return.kind;
    switch (k.$) {
      // FIXME(precise_captures): Suggest adding to `use<...>` list instead.
      case "OpaqueDef": {
        const opaque = k._0;
        // Get the identity type for this RPIT
        const did = LocalDefId.to_def_id(opaque.def_id);
        const ty = Ty.new_opaque(tcx, "No", did, RawList.identity_for_item(tcx, did));

        let span: Span | undefined = undefined;
        for (const arg of opaque.bounds) {
          if (arg.$ === "Outlives" && arg._0.kind.$ === "Static") {
            span = arg._0.ident.span;
            break;
          }
        }
        if (span !== undefined) {
          if (explicit_static !== undefined) {
            err.span_suggestion_verbose(span, `${consider} \`${display_Ty(ty)}\`'s ${explicit_static}`, lifetime_name, Applicability.MaybeIncorrect);
          }
          if (param !== undefined) {
            const [param_span, param_ty] = param;
            err.span_suggestion_verbose(param_span, add_static_bound, param_ty, Applicability.MaybeIncorrect);
          }
        } else if (opaque.bounds.some((arg) => arg.$ === "Outlives" && display_Symbol(arg._0.ident.name) === lifetime_name)) {
          // (nothing)
        } else {
          // get a lifetime name of existing named lifetimes if any
          let existing_lt_name: string | undefined;
          let generics: hir.Generics | undefined;
          let named_lifetimes: (string | undefined)[];
          if (
            scope_def_id !== undefined &&
            (generics = tcx.hir_get_generics(scope_def_id)) !== undefined &&
            ((named_lifetimes = generics.params
              .filter((p) => p.kind.$ === "Lifetime" && p.kind.kind.$ === "Explicit")
              .map((p) => {
                if (p.name.$ === "Plain") {
                  const name = p.name._0;
                  return display_Ident(name);
                } else {
                  return undefined;
                }
              })
              .filter((n) => !(n === undefined))),
            true) &&
            named_lifetimes.length > 0
          ) {
            existing_lt_name = named_lifetimes[0];
          } else {
            existing_lt_name = undefined;
          }
          const name = existing_lt_name !== undefined ? existing_lt_name : "'a";
          // if there are more than one elided lifetimes in inputs, the explicit `'_` lifetime cannot be used.
          // introducing a new lifetime `'a` or making use of one from existing named lifetimes if any
          let generics_2: hir.Generics | undefined;
          let spans_suggs: [Span, string][];
          if (
            scope_def_id !== undefined &&
            (generics_2 = tcx.hir_get_generics(scope_def_id)) !== undefined &&
            ((spans_suggs = make_elided_region_spans_suggs(name, generics_2.params)), true) &&
            spans_suggs.length > 1
          ) {
            let use_lt: string;
            if (existing_lt_name === undefined) {
              spans_suggs.push([Span.shrink_to_hi(generics_2.span), `<${name}>`]);
              use_lt = `you can introduce a named lifetime parameter \`${name}\``;
            } else {
              // make use the existing named lifetime
              use_lt = `you can use the named lifetime parameter \`${name}\``;
            }
            spans_suggs.push([Span.shrink_to_hi(fn_return.span), ` + ${name} `]);
            err.multipart_suggestion(`${declare} \`${display_Ty(ty)}\` ${captures}, ${use_lt}`, spans_suggs, Applicability.MaybeIncorrect);
          } else {
            err.span_suggestion_verbose(Span.shrink_to_hi(fn_return.span), `${declare} \`${display_Ty(ty)}\` ${captures}, ${explicit}`, plus_lt, Applicability.MaybeIncorrect);
          }
        }
        break;
      }
      case "TraitObject": {
        const lt = k._1.pointer();
        if (lt.kind.$ === "ImplicitObjectLifetimeDefault") {
          err.span_suggestion_verbose(Span.shrink_to_hi(fn_return.span), `${declare} the trait object ${captures}, ${explicit}`, plus_lt, Applicability.MaybeIncorrect);
        } else if (display_Symbol(lt.ident.name) !== lifetime_name) {
          // With this check we avoid suggesting redundant bounds. This
          // would happen if there are nested impl/dyn traits and only
          // one of them has the bound we'd suggest already there, like
          // in `impl Foo<X = dyn Bar> + '_`.
          if (explicit_static !== undefined) {
            err.span_suggestion_verbose(lt.ident.span, `${consider} the trait object's ${explicit_static}`, lifetime_name, Applicability.MaybeIncorrect);
          }
          if (param !== undefined) {
            const [param_span, param_ty] = param;
            err.span_suggestion_verbose(param_span, add_static_bound, param_ty, Applicability.MaybeIncorrect);
          }
        }
        break;
      }
      default:
        break;
    }
  }
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/static_impl_trait.rs:298 make_elided_region_spans_suggs
export function make_elided_region_spans_suggs(name: string, generic_params: Iterable<hir.GenericParam>): [Span, string][] {
  const spans_suggs: [Span, string][] = [];
  let bracket_span: Span | undefined = undefined;
  let consecutive_brackets = 0;

  const process_consecutive_brackets = (span: Span | undefined, spans_suggs: [Span, string][]): void => {
    const bs: Span | undefined = bracket_span;
    if (span !== undefined && (bs === undefined || span === bs)) {
      consecutive_brackets += 1;
    } else if (bs !== undefined) {
      bracket_span = undefined;
      const sugg = "<" + Array.from({ length: consecutive_brackets }, () => name).join(", ") + ">";
      spans_suggs.push([Span.shrink_to_hi(bs), sugg]);
      consecutive_brackets = 0;
    }
    bracket_span = span;
  };

  for (const p of generic_params) {
    if (p.kind.$ === "Lifetime" && p.kind.kind.$ === "Elided") {
      const kind = p.kind.kind._0;
      switch (kind) {
        case "Underscore":
          process_consecutive_brackets(undefined, spans_suggs);
          spans_suggs.push([p.span, name]);
          break;
        case "Ampersand":
          process_consecutive_brackets(undefined, spans_suggs);
          spans_suggs.push([Span.shrink_to_hi(p.span), `${name} `]);
          break;
        case "Comma":
          process_consecutive_brackets(undefined, spans_suggs);
          spans_suggs.push([Span.shrink_to_hi(p.span), `${name}, `]);
          break;
        case "Brackets":
          process_consecutive_brackets(p.span, spans_suggs);
          break;
      }
    }
  }
  process_consecutive_brackets(undefined, spans_suggs);

  return spans_suggs;
}

// impl<'a, 'tcx> NiceRegionError<'a, 'tcx> {
// PORT(decls): the decls.ts namespace augmentation's explicit `export { new_ as new }` leaves this declaration
// unexported (an ambient namespace with an export statement exports nothing implicitly): typed here (handoff).
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/static_impl_trait.rs:350 get_impl_ident_and_self_ty_from_trait
(NiceRegionError as unknown as { get_impl_ident_and_self_ty_from_trait: (tcx: TyCtxt, def_id: DefId, trait_objects: DefIdSet) => [Ident, hir.Ty] | undefined }).get_impl_ident_and_self_ty_from_trait =
  function (tcx: TyCtxt, def_id: DefId, trait_objects: DefIdSet): [Ident, hir.Ty] | undefined {
    const node = tcx.hir_get_if_local(def_id);
    if (node === undefined) return undefined;
    switch (node.$) {
      case "ImplItem": {
        const impl_item = node._0;
        const impl_did = tcx.hir_get_parent_item(impl_item.hir_id());
        const owner = tcx.hir_owner_node(impl_did);
        if (owner.$ === "Item" && owner._0.kind.$ === "Impl") {
          const self_ty = owner._0.kind._0.self_ty;
          return [impl_item.ident, self_ty];
        } else {
          return undefined;
        }
      }
      case "TraitItem": {
        const trait_item = node._0;
        const trait_id = tcx.hir_get_parent_item(trait_item.hir_id());
        // debug_assert_eq!(tcx.def_kind(trait_id.def_id), hir::def::DefKind::Trait);
        // The method being called is defined in the `trait`, but the `'static`
        // obligation comes from the `impl`. Find that `impl` so that we can point
        // at it in the suggestion.
        const trait_did = trait_id.to_def_id();
        for (const impl_did of tcx.local_trait_impls(trait_did)) {
          const n = tcx.hir_node_by_def_id(impl_did);
          if (
            n.$ === "Item" &&
            n._0.kind.$ === "Impl" &&
            [...trait_objects].every((did) => {
              const self_ty = (n._0.kind as { _0: hir.Impl })._0.self_ty;
              // FIXME: we should check `self_ty`, but for now, use
              // this imperfect proxy. This will fail if there are
              // multiple `impl`s for the same trait like
              // `impl Foo for Box<dyn Bar>` and `impl Foo for dyn Bar`.
              // In that case, only the first one will get suggestions.
              const traits: Span[] = [];
              const hir_v = new HirTraitObjectVisitor(traits, did);
              hir_v.visit_ty_unambig(self_ty);
              return traits.length !== 0;
            })
          ) {
            return [trait_item.ident, n._0.kind._0.self_ty];
          }
        }
        return undefined;
      }
      default:
        return undefined;
    }
  };
// }

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/static_impl_trait.rs:403 TraitObjectVisitor
/// Collect all the trait objects in a type that could have received an implicit `'static` lifetime.
export class TraitObjectVisitor implements TypeVisitor<undefined> {
  // impl<'tcx> TypeVisitor<TyCtxt<'tcx>> for TraitObjectVisitor (`type Result = ()`)
  readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;

  constructor(public _0: DefIdSet) {}

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/static_impl_trait.rs:406 visit_ty
  visit_ty(t: Ty): undefined {
    const k = t.kind();
    if (k.$ === "Dynamic" && k._1.is_static()) {
      const preds = k._0;
      const def_id = preds.principal_def_id();
      if (def_id !== undefined) {
        this._0.add(def_id);
      }
    } else {
      fold_Ty.super_visit_with(t, this);
    }
    return undefined;
  }

  // (provided) the `TypeVisitor` methods `TraitObjectVisitor` does not override.
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_region(r: Region): undefined {
    return TypeVisitor_provided.visit_region(this, r);
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

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/static_impl_trait.rs:419 HirTraitObjectVisitor
/// Collect all `hir::Ty<'_>` `Span`s for trait objects with an implicit lifetime.
export class HirTraitObjectVisitor extends hir.intravisit.Visitor {
  constructor(
    public _0: Span[],
    public _1: DefId,
  ) {
    super();
  }

  // impl<'a, 'tcx> Visitor<'tcx> for HirTraitObjectVisitor<'a>
  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/static_impl_trait.rs:422 visit_ty
  override visit_ty(t: hir.Ty<hir.AmbigArg>): undefined {
    const k = t.kind;
    if (k.$ === "TraitObject" && k._1.pointer().kind.$ === "ImplicitObjectLifetimeDefault") {
      const poly_trait_refs = k._0;
      for (const ptr of poly_trait_refs) {
        const did = ptr.trait_ref.trait_def_id();
        if (did !== undefined && DefId_eq(this._1, did)) {
          this._0.push(ptr.span);
        }
      }
    }
    hir.intravisit.walk_ty(this, t);
    return undefined;
  }
}
