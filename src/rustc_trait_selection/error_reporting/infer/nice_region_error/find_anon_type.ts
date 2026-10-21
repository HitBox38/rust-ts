// Port of compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/find_anon_type.rs (lane errrep-region; contract stub of lane errctxt-contract).
//
// How to fill this stub (docs/handoff/errctxt-contract.md "How to fill a stub"):
// - Every fn of this file is declared in src/rustc_trait_selection/decls.ts under `// error_reporting/infer/nice_region_error/find_anon_type.rs:<line>`:
//   `interface TypeErrCtxt` (methods), `NiceRegionError` (methods / statics), `Fns_<module>` (free fns) or a comment-only
//   declaration (trait impls, helper types: pick the TS form). Do not change a real signature; write a needed change in
//   your handoff (or a local `declare module` marked `// PORT(decls): pending root`).
// - Methods: in upstream order, `TypeErrCtxt.prototype.<name> = function (this: TypeErrCtxt, ..): R { .. };` with
//   `// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/find_anon_type.rs:<line> <name>` directly above, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty). In a split file edit only your lane's list.
// - Free fns: replace `export const f = ((): never => unported(..)) as Fns_..["f"]` by `export function f(..)` with the
//   declared signature and the marker. `self.tcx` / `self.infcx` / InferCtxt methods are read through the Deref forwarders
//   (`this.tcx`, `this.next_ty_var(..)`); a `&TypeErrCtxt` passed as `&InferCtxt` is `this.infcx`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
export * from "./find_anon_type.gen.ts";
import { ControlFlow, VisitorResult } from "../../../../rustc_ast_ir/visit.ts";
import * as hir from "../../../../rustc_hir/lib.ts";
import type { HirTyCtxt } from "../../../../rustc_hir/intravisit.ts";
import { TyCtxt_as_HirTyCtxt } from "../../../../rustc_middle/hir/map.ts";
import { OnlyBodies } from "../../../../rustc_middle/hir/nested_filter.ts";
import type { TyCtxt } from "../../../../rustc_middle/ty/context.ts";
import type { Region } from "../../../../rustc_middle/ty/decls.ts";
import { type DefId, DefId_eq, LocalDefId } from "../../../../rustc_span/def_id.ts";
import { DebruijnIndex, INNERMOST } from "../../../../rustc_type_ir/lib.ts";
import { field_mut } from "../../../../std/mut_ref.ts";

/// This function calls the `visit_ty` method for the parameters
/// corresponding to the anonymous regions. The `nested_visitor.found_type`
/// contains the anonymous type.
///
/// # Arguments
/// region - the anonymous region corresponding to the anon_anon conflict
/// br - the bound region corresponding to the above region which is of type `BrAnon(_)`
///
/// # Example
/// ```compile_fail
/// fn foo(x: &mut Vec<&u8>, y: &u8)
///    { x.push(y); }
/// ```
/// The function returns the nested type corresponding to the anonymous region
/// for e.g., `&u8` and `Vec<&u8>`.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/find_anon_type.rs:26 find_anon_type
export function find_anon_type(tcx: TyCtxt, generic_param_scope: LocalDefId, region: Region): [hir.Ty, hir.FnSig] | undefined {
  const anon_reg = tcx.is_suitable_region(generic_param_scope, region);
  if (anon_reg === undefined) return undefined;
  const fn_sig = hir.Node.fn_sig(tcx.hir_node_by_def_id(anon_reg.scope));
  if (fn_sig === undefined) return undefined;

  for (const arg of fn_sig.decl.inputs) {
    const ty = find_component_for_bound_region(tcx, arg, anon_reg.region_def_id);
    if (ty !== undefined) return [ty, fn_sig];
  }
  return undefined;
}

// This method creates a FindNestedTypeVisitor which returns the type corresponding
// to the anonymous region.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/find_anon_type.rs:44 find_component_for_bound_region
export function find_component_for_bound_region(tcx: TyCtxt, arg: hir.Ty, region_def_id: DefId): hir.Ty | undefined {
  const r = new FindNestedTypeVisitor(tcx, region_def_id, INNERMOST).visit_ty_unambig(arg);
  return r.$ === "Break" ? r._0 : undefined;
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/find_anon_type.rs:61 FindNestedTypeVisitor
// The FindNestedTypeVisitor captures the corresponding `hir::Ty` of the
// anonymous region. The example above would lead to a conflict between
// the two anonymous lifetimes for &u8 in x and y respectively. This visitor
// would be invoked twice, once for each lifetime, and would
// walk the types like &mut Vec<&u8> and &u8 looking for the HIR
// where that lifetime appears. This allows us to highlight the
// specific part of the type in the error message.
export class FindNestedTypeVisitor extends hir.intravisit.Visitor<ControlFlow<hir.Ty>> {
  // impl<'tcx> Visitor<'tcx> for FindNestedTypeVisitor<'tcx>
  // type Result = ControlFlow<&'tcx hir::Ty<'tcx>>;
  override Result = VisitorResult.ControlFlow<hir.Ty>();
  // type NestedFilter = nested_filter::OnlyBodies;
  override NestedFilter = OnlyBodies;

  constructor(
    public tcx: TyCtxt,
    // The `DefId` of the region we're looking for.
    public region_def_id: DefId,
    public current_index: DebruijnIndex,
  ) {
    super();
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/find_anon_type.rs:72 maybe_tcx
  override maybe_tcx(): HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.tcx);
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/find_anon_type.rs:76 visit_ty
  override visit_ty(arg: hir.Ty<hir.AmbigArg>): ControlFlow<hir.Ty> {
    const kind = arg.kind;
    switch (kind.$) {
      case "FnPtr": {
        DebruijnIndex.shift_in(field_mut(this, "current_index"), 1);
        hir.intravisit.walk_ty(this, arg);
        DebruijnIndex.shift_out(field_mut(this, "current_index"), 1);
        return ControlFlow.CONTINUE;
      }

      case "TraitObject": {
        const bounds = kind._0;
        for (const bound of bounds) {
          DebruijnIndex.shift_in(field_mut(this, "current_index"), 1);
          this.visit_poly_trait_ref(bound);
          DebruijnIndex.shift_out(field_mut(this, "current_index"), 1);
        }
        break;
      }

      case "Ref": {
        const lifetime = kind._0;
        // the lifetime of the Ref
        const hir_id = lifetime.hir_id;
        const rbv = this.tcx.named_bound_var(hir_id);
        switch (rbv?.$) {
          // Find the index of the named region that was part of the
          // error. We will then search the function parameters for a bound
          // region at the right depth with the same index
          case "EarlyBound": {
            const id = rbv._0;
            // debug!("EarlyBound id={:?}", id);
            if (DefId_eq(LocalDefId.to_def_id(id), this.region_def_id)) {
              return ControlFlow.Break(arg.as_unambig_ty());
            }
            break;
          }

          // Find the index of the named region that was part of the
          // error. We will then search the function parameters for a bound
          // region at the right depth with the same index
          case "LateBound": {
            const [debruijn_index, id] = [rbv._0, rbv._2];
            // debug!("FindNestedTypeVisitor::visit_ty: LateBound depth = {:?}", debruijn_index);
            // debug!("LateBound id={:?}", id);
            if (debruijn_index === this.current_index && DefId_eq(LocalDefId.to_def_id(id), this.region_def_id)) {
              return ControlFlow.Break(arg.as_unambig_ty());
            }
            break;
          }

          case "StaticLifetime":
          case "Free":
          case "Error":
          case undefined: {
            // debug!("no arg found");
            break;
          }
        }
        break;
      }
      // Checks if it is of type `hir::TyKind::Path` which corresponds to a struct.
      case "Path": {
        // Prefer using the lifetime in type arguments rather than lifetime arguments.
        const r = hir.intravisit.walk_ty(this, arg);
        if (r.$ === "Break") return r;

        // Call `walk_ty` as `visit_ty` is empty.
        return hir.intravisit.walk_ty(new TyPathVisitor(this.tcx, this.region_def_id, this.current_index), arg).$ === "Break"
          ? ControlFlow.Break(arg.as_unambig_ty())
          : ControlFlow.CONTINUE;
      }
      default:
        break;
    }
    // walk the embedded contents: e.g., if we are visiting `Vec<&Foo>`,
    // go on to visit `&Foo`
    return hir.intravisit.walk_ty(this, arg);
  }
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/find_anon_type.rs:168 TyPathVisitor
// The visitor captures the corresponding `hir::Ty` of the anonymous region
// in the case of structs i.e. `hir::TyKind::Path`.
// This visitor would be invoked for each lifetime corresponding to a struct,
// and would walk the types like Vec<Ref> in the above example and Ref looking for the HIR
// where that lifetime appears. This allows us to highlight the
// specific part of the type in the error message.
export class TyPathVisitor extends hir.intravisit.Visitor<ControlFlow<null>> {
  // impl<'tcx> Visitor<'tcx> for TyPathVisitor<'tcx>
  // type Result = ControlFlow<()>;
  override Result = VisitorResult.ControlFlow<null>();
  // type NestedFilter = nested_filter::OnlyBodies;
  override NestedFilter = OnlyBodies;

  constructor(
    public tcx: TyCtxt,
    public region_def_id: DefId,
    public current_index: DebruijnIndex,
  ) {
    super();
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/find_anon_type.rs:178 maybe_tcx
  override maybe_tcx(): HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.tcx);
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/find_anon_type.rs:182 visit_lifetime
  override visit_lifetime(lifetime: hir.Lifetime): ControlFlow<null> {
    const rbv = this.tcx.named_bound_var(lifetime.hir_id);
    switch (rbv?.$) {
      // the lifetime of the TyPath!
      case "EarlyBound": {
        const id = rbv._0;
        // debug!("EarlyBound id={:?}", id);
        if (DefId_eq(LocalDefId.to_def_id(id), this.region_def_id)) {
          return ControlFlow.Break(null);
        }
        break;
      }

      case "LateBound": {
        const [debruijn_index, id] = [rbv._0, rbv._2];
        // debug!("FindNestedTypeVisitor::visit_ty: LateBound depth = {debruijn_index:?}");
        // debug!("id={id:?}");
        if (debruijn_index === this.current_index && DefId_eq(LocalDefId.to_def_id(id), this.region_def_id)) {
          return ControlFlow.Break(null);
        }
        break;
      }

      case "StaticLifetime":
      case "Free":
      case "Error":
      case undefined: {
        // debug!("no arg found");
        break;
      }
    }
    return ControlFlow.CONTINUE;
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/find_anon_type.rs:212 visit_ty
  override visit_ty(_arg: hir.Ty<hir.AmbigArg>): ControlFlow<null> {
    // ignore nested types
    //
    // If you have a type like `Foo<'a, &Ty>` we
    // are only interested in the immediate lifetimes ('a).
    //
    // Making `visit_ty` empty will ignore the `&Ty` embedded
    // inside, it will get reached by the outer visitor.
    // debug!("`Ty` corresponding to a struct is {:?}", arg);
    return ControlFlow.CONTINUE;
  }
}
