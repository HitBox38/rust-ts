// Port of compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/util.rs (lane errrep-region; contract stub of lane errctxt-contract).
//
// How to fill this stub (docs/handoff/errctxt-contract.md "How to fill a stub"):
// - Every fn of this file is declared in src/rustc_trait_selection/decls.ts under `// error_reporting/infer/nice_region_error/util.rs:<line>`:
//   `interface TypeErrCtxt` (methods), `NiceRegionError` (methods / statics), `Fns_<module>` (free fns) or a comment-only
//   declaration (trait impls, helper types: pick the TS form). Do not change a real signature; write a needed change in
//   your handoff (or a local `declare module` marked `// PORT(decls): pending root`).
// - Methods: in upstream order, `TypeErrCtxt.prototype.<name> = function (this: TypeErrCtxt, ..): R { .. };` with
//   `// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/util.rs:<line> <name>` directly above, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty). In a split file edit only your lane's list.
// - Free fns: replace `export const f = ((): never => unported(..)) as Fns_..["f"]` by `export function f(..)` with the
//   declared signature and the marker. `self.tcx` / `self.infcx` / InferCtxt methods are read through the Deref forwarders
//   (`this.tcx`, `this.next_ty_var(..)`); a `&TypeErrCtxt` passed as `&InferCtxt` is `this.infcx`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
export * from "./util.gen.ts";
import * as hir from "../../../../rustc_hir/lib.ts";
import { AssocItem } from "../../../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../../../rustc_middle/ty/context.ts";
import type { Region, Ty } from "../../../../rustc_middle/ty/decls.ts";
import type { Generics } from "../../../../rustc_middle/ty/generics.ts";
import type { LateParamRegionKind } from "../../../../rustc_middle/ty/region.ts";
import { fold_Ty } from "../../../../rustc_middle/ty/structural_impls.ts";
import { type DefId, DefId_eq, LocalDefId } from "../../../../rustc_span/def_id.ts";
import type { Span } from "../../../../rustc_span/lib.ts";
import { Binder, EarlyBinder } from "../../../../rustc_type_ir/binder.ts";
import type { PolyFnSig } from "../../../../rustc_type_ir/decls.ts";
import { fold_regions, type TypeFoldable } from "../../../../rustc_type_ir/fold.ts";
import { FnSig, fold_FnSig, PolyFnSig as PolyFnSigC } from "../../../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../../../rustc_type_ir/unnormalized.ts";
import { assert_eq } from "../../../../std/panic.ts";
import type { AnonymousParamInfo } from "./util.gen.ts";
import { NiceRegionError } from "./mod.ts";

// This method walks the Type of the function body parameters using
// `fold_regions()` function and returns the
// &hir::Param of the function parameter corresponding to the anonymous
// region and the Ty corresponding to the named region.
// Currently only the case where the function declaration consists of
// one named region and one anonymous region is handled.
// Consider the example `fn foo<'a>(x: &'a i32, y: &i32) -> &'a i32`
// Here, we would return the hir::Param for y, we return the type &'a
// i32, which is the type of y but with the anonymous region replaced
// with 'a, the corresponding bound region and is_first which is true if
// the hir::Param is the first parameter in the function declaration.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/util.rs:41 find_param_with_region
export function find_param_with_region(
  tcx: TyCtxt,
  generic_param_scope: LocalDefId,
  anon_region: Region,
  replace_region: Region,
): AnonymousParamInfo | undefined {
  let id: DefId;
  let kind: LateParamRegionKind;
  const k = anon_region.kind();
  switch (k.$) {
    case "ReLateParam": {
      const late_param = k._0;
      [id, kind] = [late_param.scope, late_param.kind];
      break;
    }
    case "ReEarlyParam": {
      const ebr = k._0;
      const region_def = (tcx.generics_of(generic_param_scope) as Generics).region_param(ebr, tcx).def_id;
      [id, kind] = [tcx.parent(region_def), { $: "Named", _0: region_def }];
      break;
    }
    default:
      return undefined; // not a free region
  }

  const def_id = id.as_local();
  if (def_id === undefined) return undefined;

  // FIXME: use def_kind
  // Don't perform this on closures
  const node = tcx.hir_node_by_def_id(generic_param_scope);
  if (node.$ === "Expr" && node._0.kind.$ === "Closure") {
    return undefined;
  }

  const body = tcx.hir_maybe_body_owned_by(def_id);
  if (body === undefined) return undefined;

  const owner_id = tcx.hir_body_owner(body.id());
  const fn_decl = tcx.hir_fn_decl_by_hir_id(owner_id);
  if (fn_decl === undefined) return undefined;
  const poly_fn_sig: PolyFnSig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(id) as EarlyBinder<PolyFnSig>));

  const fn_sig = tcx.liberate_late_bound_regions(id, poly_fn_sig, fold_FnSig);
  let take: number;
  if (FnSig.c_variadic(fn_sig)) {
    take = FnSig.inputs(fn_sig).length;
  } else {
    assert_eq(FnSig.inputs(fn_sig).length, body.params.length, String);
    take = body.params.length;
  }
  for (let index = 0; index < Math.min(take, body.params.length); index++) {
    const param = body.params[index]!;
    // May return None; sometimes the tables are not yet populated.
    const ty = FnSig.inputs(fn_sig)[index]!;
    let found_anon_region = false;
    const new_param_ty = fold_regions(
      tcx,
      ty,
      (r, _) => {
        if (r === anon_region) {
          found_anon_region = true;
          return replace_region;
        } else {
          return r;
        }
      },
      fold_Ty,
    );
    if (found_anon_region) {
      const ty_hir_id = fn_decl.inputs[index]!.hir_id;
      const param_ty_span = tcx.hir_span(ty_hir_id);
      const is_first = index === 0;
      return {
        param,
        param_ty: new_param_ty,
        orig_param_ty: ty,
        param_ty_span,
        kind,
        is_first,
      };
    }
  }
  return undefined;
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/util.rs:112 find_param_with_region
NiceRegionError.prototype.find_param_with_region = function (
  this: NiceRegionError,
  anon_region: Region,
  replace_region: Region,
): AnonymousParamInfo | undefined {
  return find_param_with_region(this.tcx(), this.generic_param_scope, anon_region, replace_region);
};

// Here, we check for the case where the anonymous region
// is in the return type as written by the user.
// FIXME(#42703) - Need to handle certain cases here.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/util.rs:123 is_return_type_anon
NiceRegionError.prototype.is_return_type_anon = function (
  this: NiceRegionError,
  scope_def_id: LocalDefId,
  region_def_id: DefId,
  hir_sig: hir.FnSig,
): Span | undefined {
  const tcx = this.tcx();
  const fn_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(scope_def_id) as EarlyBinder<Ty>));
  if (fn_ty.kind().$ === "FnDef") {
    const ret_ty = PolyFnSigC.output(fn_ty.fn_sig(tcx));
    const span = hir.FnRetTy.span(hir_sig.decl.output);
    const future_output = hir_sig.header.is_async()
      ? Binder.transpose(Binder.map_bound(ret_ty, (ty) => tcx.get_impl_future_output_ty(ty)))
      : undefined;
    if (future_output !== undefined) {
      const output = future_output;
      return this.includes_region(output, region_def_id, fold_Ty) ? span : undefined;
    } else {
      return this.includes_region(ret_ty, region_def_id, fold_Ty) ? span : undefined;
    }
  }
  return undefined;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/util.rs:148 includes_region
NiceRegionError.prototype.includes_region = function <T>(
  this: NiceRegionError,
  ty: Binder<T>,
  region_def_id: DefId,
  d_T: TypeFoldable<T>,
): boolean {
  const late_bound_regions = this.tcx().collect_referenced_late_bound_regions(ty, d_T);
  // We are only checking is any region meets the condition so order doesn't matter
  for (const r of late_bound_regions) {
    if (r.$ === "Named" && DefId_eq(r._0, region_def_id)) return true;
  }
  return false;
};

// Here we check for the case where anonymous region
// corresponds to self and if yes, we display E0312.
// FIXME(#42700) - Need to format self properly to
// enable E0621 for it.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/util.rs:166 is_self_anon
NiceRegionError.prototype.is_self_anon = function (this: NiceRegionError, is_first: boolean, scope_def_id: LocalDefId): boolean {
  if (!is_first) return false;
  const i = this.tcx().opt_associated_item(LocalDefId.to_def_id(scope_def_id));
  return i !== undefined && AssocItem.is_method(i);
};
