//! The code in this module gathers up all of the inherent impls in
//! the current crate and organizes them in a map. It winds up
//! touching the whole crate and thus must be recomputed completely
//! for any change, but it is very cheap to compute. In practice, most
//! code in the compiler never *directly* requests this map. Instead,
//! it requests the inherent impls specific to some type (via
//! `tcx.inherent_impls(def_id)`). That value, however,
//! is computed by selecting an idea from this table.
//
// Port of compiler/rustc_hir_analysis/src/coherence/inherent_impls.rs (lane coherence).
//
// PORT notes (file-wide):
// - The arena is erased: `tcx.arena.alloc(x)` is `x`, `alloc_from_iter` an array.
// - `find_attr!(tcx, id, Pat)` is `find_attr(HasAttrs_DefId.get_attrs(id, tcx), ..) !== undefined` (rustc_attr_ir/lib.ts).
// - `entry(k).or_default().push(v)` on the `FxIndexMap`s is a get-or-insert of an empty array (insertion order kept).
// - The `crate_inherent_impls` query value is `[unknown, Result]` in queries.gen.ts: callers cast it to
//   `[CrateInherentImpls, Result]`.
// Init order: top-level code here touches only other crates.
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import { Node } from "../../rustc_hir/lib.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type SimplifiedType, TreatParams } from "../../rustc_middle/ty/fast_reject.ts";
import { simplify_type } from "../../rustc_type_ir/fast_reject.ts";
import { type CrateInherentImpls, CrateInherentImpls_default, HasAttrs_DefId, type Ty } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type DefId, debug_LocalDefId, LocalDefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { as_interner } from "../../rustc_type_ir/predicate.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { PLAIN } from "../../std/fmt.ts";
import { unreachable } from "../../std/panic.ts";
import { Ok, type Result } from "../../std/result.ts";
import * as diagnostics from "../diagnostics.ts";

/** `Result::and` (the argument is already evaluated). */
function and(self: Result<null, ErrorGuaranteed>, res: Result<null, ErrorGuaranteed>): Result<null, ErrorGuaranteed> {
  return self.$ === "Ok" ? res : self;
}

/// On-demand query: yields a map containing all types mapped to their inherent impls.
// rustc: compiler/rustc_hir_analysis/src/coherence/inherent_impls.rs:21 crate_inherent_impls
export function crate_inherent_impls(tcx: TyCtxt, _: null): [CrateInherentImpls, Result<null, ErrorGuaranteed>] {
  const collect = new InherentCollect(tcx, CrateInherentImpls_default());

  let res: Result<null, ErrorGuaranteed> = Ok(null);
  for (const id of tcx.hir_free_items()) {
    res = and(res, collect.check_item(id));
  }

  return [collect.impls_map, res];
}

// rustc: compiler/rustc_hir_analysis/src/coherence/inherent_impls.rs:35 crate_inherent_impls_validity_check
export function crate_inherent_impls_validity_check(tcx: TyCtxt, _: null): Result<null, ErrorGuaranteed> {
  return tcx.crate_inherent_impls(null)[1];
}

// rustc: compiler/rustc_hir_analysis/src/coherence/inherent_impls.rs:42 crate_incoherent_impls
export function crate_incoherent_impls(tcx: TyCtxt, simp: SimplifiedType): readonly DefId[] {
  const [crate_map] = tcx.crate_inherent_impls(null) as [CrateInherentImpls, Result<null, ErrorGuaranteed>];
  return (crate_map.incoherent_impls.get(simp) ?? []).map((d) => LocalDefId.to_def_id(d));
}

/// On-demand query: yields a vector of the inherent impls for a specific type.
// rustc: compiler/rustc_hir_analysis/src/coherence/inherent_impls.rs:50 inherent_impls
export function inherent_impls(tcx: TyCtxt, ty_def_id: LocalDefId): readonly DefId[] {
  const [crate_map] = tcx.crate_inherent_impls(null) as [CrateInherentImpls, Result<null, ErrorGuaranteed>];
  const v = crate_map.inherent_impls.get(ty_def_id);
  if (v !== undefined) {
    return v;
  } else {
    return [];
  }
}

// rustc-type: compiler/rustc_hir_analysis/src/coherence/inherent_impls.rs:58 InherentCollect
class InherentCollect {
  constructor(
    public tcx: TyCtxt,
    public impls_map: CrateInherentImpls,
  ) {}

  // rustc: compiler/rustc_hir_analysis/src/coherence/inherent_impls.rs:64 check_def_id
  check_def_id(impl_def_id: LocalDefId, self_ty: Ty, ty_def_id_: DefId): Result<null, ErrorGuaranteed> {
    const ty_def_id = ty_def_id_.as_local();
    if (ty_def_id !== undefined) {
      // Add the implementation to the mapping from implementation to base
      // type def ID, if there is a base type for this implementation and
      // the implementation does not have any associated traits.
      let vec = this.impls_map.inherent_impls.get(ty_def_id);
      if (vec === undefined) {
        vec = [];
        this.impls_map.inherent_impls.set(ty_def_id, vec);
      }
      vec.push(LocalDefId.to_def_id(impl_def_id));
      return Ok(null);
    }

    if (this.tcx.features().rustc_attrs()) {
      if (find_attr(HasAttrs_DefId.get_attrs(ty_def_id_, this.tcx), (k) => (k.$ === "RustcHasIncoherentInherentImpls" ? null : undefined)) === undefined) {
        const impl_span = this.tcx.def_span(impl_def_id);
        return { $: "Err", _0: this.tcx.dcx().emit_err(diagnostics.InherentTyOutside_diagnostic({ span: impl_span })) };
      }

      const items = this.tcx.associated_item_def_ids(impl_def_id);
      for (const impl_item of items) {
        if (find_attr(HasAttrs_DefId.get_attrs(impl_item, this.tcx), (k) => (k.$ === "RustcAllowIncoherentImpl" ? null : undefined)) === undefined) {
          const impl_span = this.tcx.def_span(impl_def_id);
          return {
            $: "Err",
            _0: this.tcx.dcx().emit_err(diagnostics.InherentTyOutsideRelevant_diagnostic({ span: impl_span, help_span: this.tcx.def_span(impl_item) })),
          };
        }
      }

      const simp = simplify_type(as_interner(this.tcx), self_ty, TreatParams.InstantiateWithInfer);
      if (simp !== undefined) {
        push_incoherent(this.impls_map, simp, impl_def_id);
      } else {
        bug(`unexpected self type: ${debug_Ty(self_ty, PLAIN)}`);
      }
      return Ok(null);
    } else {
      const impl_span = this.tcx.def_span(impl_def_id);
      const err: diagnostics.InherentTyOutsideNew = { span: impl_span, note: undefined };

      const self_ty_kind = Node.expect_item(this.tcx.hir_node_by_def_id(impl_def_id)).expect_impl().self_ty.kind;
      if (self_ty_kind.$ === "Path" && self_ty_kind._0.$ === "Resolved") {
        const path = self_ty_kind._0._1;
        if (path.res.$ === "Def" && path.res._0.$ === "TyAlias") {
          const def_id = path.res._1;
          const ty_name = this.tcx.def_path_str(def_id);
          const alias_ty_name = display_Ty(EarlyBinder.skip_binder(this.tcx.type_of(def_id) as EarlyBinder<Ty>));
          err.note = {
            span: this.tcx.def_span(def_id),
            ty_name,
            alias_ty_name,
          };
        }
      }

      return { $: "Err", _0: this.tcx.dcx().emit_err(diagnostics.InherentTyOutsideNew_diagnostic(err)) };
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/coherence/inherent_impls.rs:127 check_primitive_impl
  check_primitive_impl(impl_def_id: LocalDefId, ty: Ty): Result<null, ErrorGuaranteed> {
    const items = this.tcx.associated_item_def_ids(impl_def_id);
    if (!this.tcx.hir_rustc_coherence_is_core()) {
      if (this.tcx.features().rustc_attrs()) {
        for (const impl_item of items) {
          if (find_attr(HasAttrs_DefId.get_attrs(impl_item, this.tcx), (k) => (k.$ === "RustcAllowIncoherentImpl" ? null : undefined)) === undefined) {
            const span = this.tcx.def_span(impl_def_id);
            return {
              $: "Err",
              _0: this.tcx.dcx().emit_err(diagnostics.InherentTyOutsidePrimitive_diagnostic({ span, help_span: this.tcx.def_span(impl_item) })),
            };
          }
        }
      } else {
        const span = this.tcx.def_span(impl_def_id);
        let note: diagnostics.InherentPrimitiveTyNote | undefined = undefined;
        const k = ty.kind();
        if (k.$ === "Ref") {
          const subty = k._1;
          note = { subty };
        }
        return { $: "Err", _0: this.tcx.dcx().emit_err(diagnostics.InherentPrimitiveTy_diagnostic({ span, note })) };
      }
    }

    const simp = simplify_type(as_interner(this.tcx), ty, TreatParams.InstantiateWithInfer);
    if (simp !== undefined) {
      push_incoherent(this.impls_map, simp, impl_def_id);
    } else {
      bug(`unexpected primitive type: ${debug_Ty(ty, PLAIN)}`);
    }
    return Ok(null);
  }

  // rustc: compiler/rustc_hir_analysis/src/coherence/inherent_impls.rs:167 check_item
  check_item(id_: hir.ItemId): Result<null, ErrorGuaranteed> {
    const dk = this.tcx.def_kind(id_.owner_id);
    if (!(dk.$ === "Impl" && dk.of_trait === false)) {
      return Ok(null);
    }

    const id = id_.owner_id.def_id;
    const item_span = this.tcx.def_span(id);
    const self_ty0 = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(id) as EarlyBinder<Ty>));
    let self_ty = this.tcx.peel_off_free_alias_tys(self_ty0);
    // We allow impls on pattern types exactly when we allow impls on the base type.
    // FIXME(pattern_types): Figure out the exact coherence rules we want here.
    for (;;) {
      const pk = self_ty.kind();
      if (pk.$ !== "Pat") break;
      self_ty = pk._0;
    }
    const k = self_ty.kind();
    switch (k.$) {
      case "Adt":
        return this.check_def_id(id, self_ty, (k._0 as AdtDef).did());
      case "Foreign":
        return this.check_def_id(id, self_ty, k._0);
      case "Dynamic":
        if (k._0.principal_def_id() !== undefined) {
          return this.check_def_id(id, self_ty, k._0.principal_def_id()!);
        }
        return { $: "Err", _0: this.tcx.dcx().emit_err(diagnostics.InherentDyn_diagnostic({ span: item_span })) };
      case "Pat":
        return unreachable();
      case "Bool":
      case "Char":
      case "Int":
      case "Uint":
      case "Float":
      case "Str":
      case "Array":
      case "Slice":
      case "RawPtr":
      case "Ref":
      case "Never":
      case "FnPtr":
      case "Tuple":
      case "UnsafeBinder":
        return this.check_primitive_impl(id, self_ty);
      case "Alias":
        if (k._1.kind.$ === "Projection" || k._1.kind.$ === "Inherent" || k._1.kind.$ === "Opaque") {
          return { $: "Err", _0: this.tcx.dcx().emit_err(diagnostics.InherentNominal_diagnostic({ span: item_span })) };
        }
        // ty::Alias(_, ty::AliasTy { kind: ty::Free { .. }, .. })
        return bug(`unexpected impl self type of impl: ${debug_LocalDefId(id, PLAIN)} ${debug_Ty(self_ty, PLAIN)}`);
      case "Param":
        return { $: "Err", _0: this.tcx.dcx().emit_err(diagnostics.InherentNominal_diagnostic({ span: item_span })) };
      case "FnDef":
      case "Closure":
      case "CoroutineClosure":
      case "Coroutine":
      case "CoroutineWitness":
      case "Bound":
      case "Placeholder":
      case "Infer":
        return bug(`unexpected impl self type of impl: ${debug_LocalDefId(id, PLAIN)} ${debug_Ty(self_ty, PLAIN)}`);
      // We could bail out here, but that will silence other useful errors.
      case "Error":
        return Ok(null);
    }
  }
}

/** `self.impls_map.incoherent_impls.entry(simp).or_default().push(impl_def_id)` */
function push_incoherent(impls_map: CrateInherentImpls, simp: SimplifiedType, impl_def_id: LocalDefId): void {
  let v = impls_map.incoherent_impls.get(simp);
  if (v === undefined) {
    v = [];
    impls_map.incoherent_impls.set(simp, v);
  }
  v.push(impl_def_id);
}
