// Port of compiler/rustc_hir_analysis/src/hir_wf_check.rs (lane small-gaps-18).
//
// PORT:
// - The fn-local `struct HirWfCheck` (with default field values) and its `impl Visitor` are a class declared inside
//   `diagnostic_hir_wf_check`, extending rustc_hir's `Visitor` (wfcheck.ts's `CollectUsageSpans` precedent).
// - The query key `(ty::Predicate<'tcx>, WellFormedLoc)` is `KEY_Predicate_WellFormedLoc` (query/keys.ts, merge-w19).
// - `debug!` is tracing only and stays as a comment.
import { DefKind } from "../rustc_hir/def.ts";
import * as hir from "../rustc_hir/hir.ts";
import { debug_ImplItemKind, debug_ItemKind, debug_Node, debug_TraitItemKind } from "../rustc_hir/hir.gen.ts";
import { Visitor, walk_ty } from "../rustc_hir/intravisit.ts";
import { TraitErrors } from "../rustc_infer/traits/engine.ts";
import { Obligation } from "../rustc_infer/traits/mod.ts";
import { ObligationCause, type WellFormedLoc } from "../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Predicate } from "../rustc_middle/ty/decls.ts";
import { type ParamEnv, Term } from "../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_PredicateKind } from "../rustc_middle/ty/predicate.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { LocalDefId as LocalDefIdC } from "../rustc_span/def_id.ts";
import { bug } from "../rustc_span/macros.ts";
import { ObligationCtxt } from "../rustc_trait_selection/traits/engine.ts";
import { fold_regions } from "../rustc_type_ir/fold.ts";
import { TypingMode } from "../rustc_type_ir/infer_ctxt.ts";
import type { Interner } from "../rustc_type_ir/interner.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { PLAIN } from "../std/fmt.ts";
import { unwrap } from "../std/panic.ts";
import { ItemCtxt } from "./collect.ts";

// Ideally, this would be in `rustc_trait_selection`, but we
// need access to `ItemCtxt`
// rustc: compiler/rustc_hir_analysis/src/hir_wf_check.rs:16 diagnostic_hir_wf_check
export function diagnostic_hir_wf_check(tcx: TyCtxt, [predicate_, loc]: [unknown, WellFormedLoc]): ObligationCause | undefined {
  // PORT: the key's `ty::Predicate` is typed `unknown` by queries.gen.ts (its `QueryKey` is not ported).
  const predicate = predicate_ as Predicate;
  let def_id: LocalDefId;
  switch (loc.$) {
    case "Ty":
      def_id = loc._0;
      break;
    case "Param":
      def_id = loc.function;
      break;
    case "HirId":
    case "None":
      return undefined;
  }
  const hir_id = tcx.local_def_id_to_hir_id(def_id);

  // HIR wfcheck should only ever happen as part of improving an existing error
  tcx.dcx().span_delayed_bug(tcx.def_span(def_id), "Performed HIR wfcheck without an existing error!");

  const icx = ItemCtxt.new(tcx, def_id);

  // To perform HIR-based WF checking, we iterate over all HIR types
  // that occur 'inside' the item we're checking. For example,
  // given the type `Option<MyStruct<u8>>`, we will check
  // `Option<MyStruct<u8>>`, `MyStruct<u8>`, and `u8`.
  // For each type, we perform a well-formed check, and see if we get
  // an error that matches our expected predicate. We save
  // the `ObligationCause` corresponding to the *innermost* type,
  // which is the most specific type that we can point to.
  // In general, the different components of an `hir::Ty` may have
  // completely different spans due to macro invocations. Pointing
  // to the most accurate part of the type can be the difference
  // between a useless span (e.g. the macro invocation site)
  // and a useful span (e.g. a user-provided type passed into the macro).
  //
  // This approach is quite inefficient - we redo a lot of work done
  // by the normal WF checker. However, this code is run at most once
  // per reported error - it will have no impact when compilation succeeds,
  // and should only have an impact if a very large number of errors is
  // displayed to the user.
  // rustc-type: compiler/rustc_hir_analysis/src/hir_wf_check.rs:52 HirWfCheck
  class HirWfCheck extends Visitor {
    cause: ObligationCause | undefined = undefined;
    cause_depth = 0;
    depth = 0;

    constructor(
      public tcx: TyCtxt,
      public predicate: Predicate,
      public icx: ItemCtxt,
      public def_id: LocalDefId,
      public param_env: ParamEnv,
    ) {
      super();
    }

    // impl<'tcx> Visitor<'tcx> for HirWfCheck<'tcx>

    // rustc: compiler/rustc_hir_analysis/src/hir_wf_check.rs:64 visit_ty
    override visit_ty(ty: hir.Ty<hir.AmbigArg>): undefined {
      const infcx = this.tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const ocx = ObligationCtxt.new_with_diagnostics(infcx);

      // We don't handle infer vars but we wouldn't handle them anyway as we're creating a
      // fresh `InferCtxt` in this function.
      let tcx_ty = this.icx.lower_ty(ty.as_unambig_ty());
      // This visitor can walk into binders, resulting in the `tcx_ty` to
      // potentially reference escaping bound variables. We simply erase
      // those here.
      tcx_ty = fold_regions(
        this.tcx,
        tcx_ty,
        (r, _) => {
          if (r.is_bound()) {
            return this.tcx.lifetimes.re_erased;
          } else {
            return r;
          }
        },
        fold_Ty,
      );

      // We may be checking the WFness of a type in an opaque with a non-lifetime bound.
      // Perhaps we could rebind all the escaping bound vars, but they're coming from
      // arbitrary debruijn indices and aren't particularly important anyways, since they
      // are only coming from `feature(non_lifetime_binders)` anyways.
      if (TypeVisitableExt.has_escaping_bound_vars(tcx_ty, fold_Ty)) {
        return undefined;
      }

      const cause = ObligationCause.new(ty.span, this.def_id, { $: "WellFormed", _0: { $: "HirId", _0: ty.hir_id } });

      ocx.register_obligation(
        Obligation.new(
          this.tcx,
          cause,
          this.param_env,
          { $: "Clause", _0: { $: "WellFormed", _0: Term.from_Ty(tcx_ty) } },
          Predicate_upcast_from_PredicateKind as (from: Parameters<typeof Predicate_upcast_from_PredicateKind>[0], tcx: Interner) => Predicate,
        ),
      );

      for (const error of TraitErrors.into_iter(ocx.evaluate_obligations_error_on_ambiguity())) {
        // debug!("Wf-check got error for {:?}: {:?}", ty, error);
        if (error.obligation.predicate === this.predicate) {
          // Save the cause from the greatest depth - this corresponds
          // to picking more-specific types (e.g. `MyStruct<u8>`)
          // over less-specific types (e.g. `Option<MyStruct<u8>>`)
          if (this.depth >= this.cause_depth) {
            this.cause = error.obligation.cause;
            if (ty.kind.$ === "TraitObject") {
              const k = this.tcx.def_kind(this.def_id) as DefKind;
              if (k.$ === "AssocTy" || k.$ === "AssocConst" || k.$ === "AssocFn") {
                this.cause = ObligationCause.new(ty.span, this.def_id, { $: "DynCompatible", _0: ty.span });
              }
            }
            this.cause_depth = this.depth;
          }
        }
      }

      this.depth += 1;
      walk_ty(this, ty);
      this.depth -= 1;
      return undefined;
    }
  }

  const param_env = tcx.param_env(LocalDefIdC.to_def_id(def_id)) as ParamEnv;
  const visitor = new HirWfCheck(tcx, predicate, icx, def_id, param_env);

  // Get the starting `hir::Ty` using our `WellFormedLoc`.
  // We will walk 'into' this type to try to find
  // a more precise span for our predicate.
  let tys: hir.Ty[];
  // PORT: `loc` is matched again (the early return above narrowed it; upstream's arms are kept).
  const loc2 = loc as WellFormedLoc;
  switch (loc2.$) {
    case "Ty": {
      const node = tcx.hir_node(hir_id);
      switch (node.$) {
        case "ImplItem": {
          const item = node._0;
          const k = item.kind;
          switch (k.$) {
            case "Type":
              tys = [k._0];
              break;
            case "Const":
              tys = [k._0];
              break;
            default:
              return bug(`Unexpected ImplItem ${debug_ImplItemKind(k, PLAIN)}`);
          }
          break;
        }
        case "TraitItem": {
          const item = node._0;
          const k = item.kind;
          switch (k.$) {
            case "Type":
              tys = k._1 !== undefined ? [k._1] : [];
              break;
            case "Const":
              tys = [k._0];
              break;
            default:
              return bug(`Unexpected TraitItem ${debug_TraitItemKind(k, PLAIN)}`);
          }
          break;
        }
        case "Item": {
          const item = node._0;
          const k = item.kind;
          switch (k.$) {
            case "TyAlias":
              tys = [k._2];
              break;
            case "Static":
              tys = [k._2];
              break;
            case "Const":
              tys = [k._2];
              break;
            case "Impl": {
              const impl_ = k._0;
              const of_trait = impl_.of_trait;
              if (of_trait !== undefined) {
                const segments = of_trait.trait_ref.path.segments;
                const last = segments.length > 0 ? [segments[segments.length - 1]!] : [];
                tys = [];
                for (const seg of last) {
                  for (const arg of seg.args_().args) {
                    if (arg.$ === "Type") {
                      const ty = arg._0;
                      tys.push(ty.as_unambig_ty());
                    }
                  }
                }
                tys.push(impl_.self_ty);
              } else {
                tys = [impl_.self_ty];
              }
              break;
            }
            default:
              return bug(`Unexpected item ${debug_ItemKind(k, PLAIN)}`);
          }
          break;
        }
        case "Field": {
          const field = node._0;
          tys = [field.ty];
          break;
        }
        case "ForeignItem": {
          const fk = node._0.kind;
          if (fk.$ === "Static") {
            tys = [fk._0];
            break;
          }
          return bug(`Unexpected node ${debug_Node(node, PLAIN)}`);
        }
        case "GenericParam": {
          const pk = node._0.kind;
          if (pk.$ === "Type" && pk.default !== undefined) {
            tys = [pk.default];
            break;
          }
          return bug(`Unexpected node ${debug_Node(node, PLAIN)}`);
        }
        case "AnonConst": {
          const const_param_id = tcx.hir_opt_const_param_default_param_def_id(hir_id);
          let found: hir.Ty | undefined;
          if (const_param_id !== undefined) {
            const n = tcx.hir_node_by_def_id(const_param_id);
            if (n.$ === "GenericParam" && n._0.kind.$ === "Const") {
              found = n._0.kind.ty;
            }
          }
          tys = found !== undefined ? [found] : [];
          break;
        }
        default:
          return bug(`Unexpected node ${debug_Node(node, PLAIN)}`);
      }
      break;
    }
    case "Param": {
      const param_idx = loc2.param_idx;
      const fn_decl = unwrap(tcx.hir_fn_decl_by_hir_id(hir_id));
      // Get return type
      if (param_idx === fn_decl.inputs.length) {
        const output = fn_decl.output;
        switch (output.$) {
          case "Return":
            tys = [output._0];
            break;
          // The unit type `()` is always well-formed
          case "DefaultReturn":
            tys = [];
            break;
        }
      } else {
        tys = [fn_decl.inputs[param_idx]!];
      }
      break;
    }
    case "HirId":
    case "None":
      return undefined;
  }
  for (const ty of tys) {
    visitor.visit_ty_unambig(ty);
  }
  return visitor.cause;
}
