// Port of compiler/rustc_hir_analysis/src/collect/dump.rs (lane collect-b): the `#[rustc_dump_*]` attribute dumps.
//
// Contract: docs/handoff/hirtylowerer-contract.md. The free fns have their decls.ts `Fns_collect_dump` signatures.
// Init order: top-level code here touches only other crates; every rustc_hir_analysis export is read inside function
// bodies only.
//
// PORT notes (file-wide):
// - `find_attr!(tcx, id, Pat)` is `find_attr(HasAttrs_LocalDefId.get_attrs(id, tcx), ..)`, `find_attr!(tcx, crate, Pat)`
//   is `find_attr(tcx.hir_krate_attrs(), ..)` (rustc_attr_ir lib.ts).
// - `format!("{}", sym::x)` is `Symbol.as_str(sym.x)`; `{:?}` / `{:#?}` are the `debug_*` fns under `PLAIN` / `PRETTY`.
// - Query values that are `unknown` in queries.gen.ts are cast to the upstream value type.
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import { debug_DefKind } from "../../rustc_hir/def.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { Visitor, walk_anon_const, walk_item, type HirTyCtxt } from "../../rustc_hir/intravisit.ts";
import { TyCtxt_as_HirTyCtxt } from "../../rustc_middle/hir/map.ts";
import type { ModuleItems } from "../../rustc_middle/hir/mod.ts";
import { All } from "../../rustc_middle/hir/nested_filter.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { debug_Generics, GenericClauses, type Generics } from "../../rustc_middle/ty/generics.ts";
import type { Clauses } from "../../rustc_middle/ty/list.ts";
import { HasAttrs_LocalDefId, type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { debug_Clause } from "../../rustc_middle/ty/structural_impls.ts";
import { visit_with_Ty } from "../../rustc_middle/ty/mod.ts";
import { CRATE_DEF_ID, type DefId, debug_DefId, debug_LocalDefId, LocalDefId } from "../../rustc_span/def_id.ts";
import type { ObjectLifetimeDefault } from "../../rustc_middle/middle/resolve_bound_vars.ts";
import { Symbol, sym } from "../../rustc_span/symbol.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { TraitRef } from "../../rustc_type_ir/decls.ts";
import { ExistentialTraitRef, as_interner } from "../../rustc_type_ir/predicate.ts";
import { fold_with_ExistentialTraitRef, fold_with_TraitRef, try_fold_with_ExistentialTraitRef, try_fold_with_TraitRef, visit_with_ExistentialTraitRef, visit_with_TraitRef, type ExistentialTraitRef as ExistentialTraitRefT } from "../../rustc_type_ir/predicate.gen.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { visit_with_Unnormalized } from "../../rustc_type_ir/unnormalized.gen.ts";
import { type TypeVisitable, TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { debug_vec, format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import { COMMON_VTABLE_ENTRIES, debug_VtblEntry, type VtblEntry } from "../../rustc_middle/ty/vtable.ts";
import { TypeOf_diagnostic } from "../diagnostics.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { AnonConst } from "../../rustc_hir/hir.gen.ts";

/** PORT: D4 descriptors (`TraitRef`, `ExistentialTraitRef`, `Unnormalized<Ty>`), as rustc_middle generics.ts's private ones. */
const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
const d_ExistentialTraitRef: TypeFoldable<ExistentialTraitRefT> = {
  visit_with: visit_with_ExistentialTraitRef,
  try_fold_with: try_fold_with_ExistentialTraitRef,
  fold_with: fold_with_ExistentialTraitRef,
};
const d_Unnormalized_Ty: TypeVisitable<Unnormalized<Ty>> = { visit_with: (self, v) => visit_with_Unnormalized(self, v, visit_with_Ty) };

// rustc: compiler/rustc_hir_analysis/src/collect/dump.rs:11 generics
export function generics(tcx: TyCtxt): void {
  for (const did of (tcx.hir_crate_items(null) as ModuleItems).definitions()) {
    if (did === CRATE_DEF_ID) {
      continue;
    }

    if (find_attr(HasAttrs_LocalDefId.get_attrs(did, tcx), (k) => (k.$ === "RustcDumpGenerics" ? null : undefined)) !== undefined) {
      const span = tcx.def_span(did);

      const diag = tcx.dcx().struct_span_err(span, `${Symbol.as_str(sym.rustc_dump_generics)}: ${debug_LocalDefId(did, PLAIN)}`);

      const generics = tcx.generics_of(did) as Generics;
      diag.span_note(tcx.def_span(did), format_debug(generics, debug_Generics, PRETTY));
      diag.emit();
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/collect/dump.rs:30 object_lifetime_defaults
export function object_lifetime_defaults(tcx: TyCtxt): void {
  for (const def_id of (tcx.hir_crate_items(null) as ModuleItems).definitions()) {
    if (def_id === CRATE_DEF_ID) {
      continue;
    }

    if (find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) => (k.$ === "RustcDumpObjectLifetimeDefaults" ? null : undefined)) === undefined) {
      continue;
    }

    for (const param of (tcx.generics_of(def_id) as Generics).own_params) {
      if (param.kind.$ !== "Type") continue;
      const default_ = tcx.object_lifetime_default(param.def_id) as ObjectLifetimeDefault;
      let repr: string;
      switch (default_.$) {
        case "Empty":
          repr = "Empty";
          break;
        case "Static":
          repr = "'static";
          break;
        case "Param":
          repr = Symbol.as_str(tcx.item_name(default_._0));
          break;
        case "Ambiguous":
          repr = "Ambiguous";
          break;
      }
      tcx.dcx().span_err(tcx.def_span(param.def_id), repr);
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/collect/dump.rs:54 opaque_hidden_types
export function opaque_hidden_types(tcx: TyCtxt): void {
  if (!(find_attr(tcx.hir_krate_attrs(), (k) => (k.$ === "RustcDumpHiddenTypeOfOpaques" ? null : undefined)) !== undefined)) {
    return;
  }
  for (const id of (tcx.hir_crate_items(null) as ModuleItems).opaques()) {
    const origin = tcx.hir_expect_opaque_ty(id).origin;
    if (origin.$ === "FnReturn" || origin.$ === "AsyncFn") {
      const fn_def_id = origin.parent;
      const node = tcx.hir_node_by_def_id(fn_def_id);
      if (node.$ === "TraitItem") {
        const trait_item = node._0;
        const [, trait_fn] = trait_item.expect_fn();
        if (trait_fn.$ === "Required") {
          continue;
        }
      }
    }

    const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(id) as EarlyBinder<Ty>));
    const span = tcx.def_span(id);
    tcx.dcx().emit_err(TypeOf_diagnostic({ span, ty }));
  }
}

// rustc: compiler/rustc_hir_analysis/src/collect/dump.rs:74 clauses_and_item_bounds
export function clauses_and_item_bounds(tcx: TyCtxt): void {
  for (const id of (tcx.hir_crate_items(null) as ModuleItems).owners()) {
    // #[expect(deprecated)] // we don't want to unnecessarily retrieve the attrs twice in a row.
    const attrs = tcx.get_all_attrs(id.to_def_id());

    if (find_attr(attrs, (k) => (k.$ === "RustcDumpClauses" ? null : undefined)) !== undefined) {
      const clauses = GenericClauses.instantiate_identity(tcx.clauses_of(id) as GenericClauses, tcx).clauses.map((c) => Unnormalized.skip_norm_wip(c));
      const span = tcx.def_span(id);

      const diag = tcx.dcx().struct_span_err(span, Symbol.as_str(sym.rustc_dump_clauses));
      for (const clause of clauses) {
        diag.note(debug_Clause(clause, PLAIN));
      }
      diag.emit();
    }

    if (find_attr(attrs, (k) => (k.$ === "RustcDumpItemBounds" ? null : undefined)) !== undefined) {
      const name = Symbol.as_str(sym.rustc_dump_item_bounds);

      const kind = tcx.def_kind(id);
      if (kind.$ === "AssocTy") {
        const bounds = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.item_bounds(id) as EarlyBinder<Clauses>));
        const span = tcx.def_span(id);

        const diag = tcx.dcx().struct_span_err(span, name);
        for (const bound of bounds) {
          diag.note(debug_Clause(bound, PLAIN));
        }
        diag.emit_err();
      } else {
        tcx.dcx().span_delayed_bug(tcx.def_span(id), `attr parsing didn't report an error for \`#[${name}]\` on ${debug_DefKind(kind, PLAIN)}`);
      }
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/collect/dump.rs:118 def_parents
export function def_parents(tcx: TyCtxt): void {
  for (const iid of tcx.hir_free_items()) {
    const did = iid.owner_id.def_id;
    if (find_attr(HasAttrs_LocalDefId.get_attrs(did, tcx), (k) => (k.$ === "RustcDumpDefParents" ? null : undefined)) !== undefined) {
      // rustc-type: compiler/rustc_hir_analysis/src/collect/dump.rs:122 AnonConstFinder
      class AnonConstFinder extends Visitor {
        constructor(
          public tcx: TyCtxt,
          public anon_consts: LocalDefId[],
        ) {
          super();
        }

        // ---- impl<'tcx> intravisit::Visitor<'tcx> for AnonConstFinder<'tcx> ----

        // type NestedFilter = nested_filter::All;
        override NestedFilter = All;

        // rustc: compiler/rustc_hir_analysis/src/collect/dump.rs:130 maybe_tcx
        override maybe_tcx(): HirTyCtxt {
          return TyCtxt_as_HirTyCtxt(this.tcx);
        }

        // rustc: compiler/rustc_hir_analysis/src/collect/dump.rs:134 visit_anon_const
        override visit_anon_const(c: AnonConst): undefined {
          this.anon_consts.push(c.def_id);
          return walk_anon_const(this, c);
        }
      }

      // Look for any anon consts inside of this item as there is no way to apply
      // the `rustc_dump_def_parents` attribute to the anon const so it would not be possible
      // to see what its def parent is.
      const anon_ct_finder = new AnonConstFinder(tcx, []);
      walk_item(anon_ct_finder, tcx.hir_item(iid));

      for (const did_ of [did, ...anon_ct_finder.anon_consts]) {
        const span = tcx.def_span(did_);

        const diag = tcx.dcx().struct_span_err(span, `${Symbol.as_str(sym.rustc_dump_def_parents)}: ${debug_LocalDefId(did_, PLAIN)}`);

        let current_did = LocalDefId.to_def_id(did_);
        for (;;) {
          const parent_did = tcx.opt_parent(current_did);
          if (parent_did === undefined) break;
          current_did = parent_did;
          diag.span_note(tcx.def_span(parent_did), debug_DefId(parent_did, PLAIN));
        }
        diag.emit();
      }
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/collect/dump.rs:164 vtables
export function vtables(tcx: TyCtxt): void {
  for (const id of tcx.hir_free_items()) {
    const def_id = id.owner_id.def_id;

    const attr_span = find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) => (k.$ === "RustcDumpVtable" ? k._0 : undefined));
    if (attr_span === undefined) {
      continue;
    }

    let vtable_entries: readonly VtblEntry[];
    const kind = tcx.hir_item(id).kind;
    if (kind.$ === "Impl" && kind._0.of_trait !== undefined) {
      const trait_ref = EarlyBinder.instantiate_identity(tcx.impl_trait_ref(def_id) as EarlyBinder<TraitRef>);
      if (TypeVisitableExt.has_non_region_param(Unnormalized.skip_normalization(trait_ref), d_TraitRef)) {
        tcx.dcx().span_err(attr_span, "`rustc_dump_vtable` must be applied to non-generic impl");
        continue;
      }
      if (!tcx.is_dyn_compatible(Unnormalized.skip_normalization(trait_ref).def_id)) {
        tcx.dcx().span_err(attr_span, "`rustc_dump_vtable` must be applied to dyn-compatible trait");
        continue;
      }
      const r = tcx.try_normalize_erasing_regions(TypingEnv.fully_monomorphized(), trait_ref, d_TraitRef);
      if (r.$ === "Err") {
        tcx.dcx().span_err(attr_span, "`rustc_dump_vtable` applied to impl header that cannot be normalized");
        continue;
      }
      vtable_entries = tcx.vtable_entries(r._0);
    } else if (kind.$ === "TyAlias") {
      const ty_ = EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>);
      if (TypeVisitableExt.has_non_region_param(ty_, d_Unnormalized_Ty)) {
        tcx.dcx().span_err(attr_span, "`rustc_dump_vtable` must be applied to non-generic type");
        continue;
      }
      const r = tcx.try_normalize_erasing_regions(TypingEnv.fully_monomorphized(), ty_, fold_Ty);
      if (r.$ === "Err") {
        tcx.dcx().span_err(attr_span, "`rustc_dump_vtable` applied to type alias that cannot be normalized");
        continue;
      }
      const ty = r._0;
      const tk = ty.kind();
      if (tk.$ !== "Dynamic") {
        tcx.dcx().span_err(attr_span, "`rustc_dump_vtable` to type alias of dyn type");
        continue;
      }
      const data = tk._0;
      const principal = data.principal();
      if (principal !== undefined) {
        vtable_entries = tcx.vtable_entries(ExistentialTraitRef.with_self_ty(tcx.instantiate_bound_regions_with_erased(principal, d_ExistentialTraitRef), as_interner(tcx), ty));
      } else {
        vtable_entries = COMMON_VTABLE_ENTRIES;
      }
    } else {
      tcx.dcx().span_err(attr_span, "`rustc_dump_vtable` only applies to impl, or type alias of dyn type");
      continue;
    }

    tcx.dcx().span_err(tcx.def_span(def_id), `vtable entries: ${format_debug(vtable_entries, (v, f) => debug_vec(v, f, debug_VtblEntry), PRETTY)}`);
  }
}
