// Port of compiler/rustc_middle/src/ty/vtable.rs (lane instance-vtable). `VtblEntry` is generated into vtable.gen.ts
// (set rustc_middle_ty_instance of tools/codegen/types.ts); this file holds its manual `Debug`, the associated const
// `TyCtxt::COMMON_VTABLE_ENTRIES` and the free fns, in upstream order.
//
// PORT: `impl TyCtxt { pub const COMMON_VTABLE_ENTRIES }` is the module const `COMMON_VTABLE_ENTRIES` (an associated
// const on the `TyCtxt` class would make this module a TyCtxt extension; nothing else needs it there).
// PORT: `vtable_allocation_provider` builds the vtable's `mir::interpret::Allocation` (M4, not ported): it stops with
// `unported(..)` at `Allocation::new`, after the parts that do not need the interpreter's memory types.
// Init order: top-level code here touches only ./vtable.gen.ts; queries.gen.ts imports this module early, so the
// `TyCtxt` extension module ty/layout.ts is reached through `require`.
import { Size } from "../../rustc_abi/lib.ts";
import { supertrait_def_ids } from "../../rustc_type_ir/elaborate.ts";
import type { ExistentialTraitRef, TraitRef } from "../../rustc_type_ir/predicate.ts";
import { ExistentialTraitRef as ExistentialTraitRefC } from "../../rustc_type_ir/predicate.ts";
import { display_TraitRef } from "../../rustc_type_ir/ir_print.ts";
import { fold_with_TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../rustc_type_ir/predicate.gen.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { as_interner } from "../../rustc_type_ir/predicate.ts";
import type { Fmt } from "../../std/fmt.ts";
import { assert, unported } from "../../std/panic.ts";
import type { TyCtxt } from "./context.ts";
import { display_Instance } from "./instance.ts";
import { type Ty, TypingEnv } from "./mod.ts";
import { VtblEntry } from "./vtable.gen.ts";

export * from "./vtable.gen.ts";

const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };

// impl<'tcx> fmt::Debug for VtblEntry<'tcx>
// rustc: compiler/rustc_middle/src/ty/vtable.rs:29 fmt
export function debug_VtblEntry(self: VtblEntry, _f: Fmt): string {
  // We want to call `Display` on `Instance` and `PolyTraitRef`,
  // so we implement this manually.
  switch (self.$) {
    case "MetadataDropInPlace":
      return "MetadataDropInPlace";
    case "MetadataSize":
      return "MetadataSize";
    case "MetadataAlign":
      return "MetadataAlign";
    case "Vacant":
      return "Vacant";
    case "Method": {
      const instance = self._0;
      return `Method(${display_Instance(instance)})`;
    }
    case "TraitVPtr": {
      const trait_ref = self._0;
      return `TraitVPtr(${display_TraitRef(trait_ref)})`;
    }
  }
}

// Needs to be associated with the `'tcx` lifetime
// impl<'tcx> TyCtxt<'tcx> { pub const COMMON_VTABLE_ENTRIES: &'tcx [VtblEntry<'tcx>] = .. }
export const COMMON_VTABLE_ENTRIES: readonly VtblEntry[] = [VtblEntry.MetadataDropInPlace, VtblEntry.MetadataSize, VtblEntry.MetadataAlign];

export const COMMON_VTABLE_ENTRIES_DROPINPLACE: number = 0;
export const COMMON_VTABLE_ENTRIES_SIZE: number = 1;
export const COMMON_VTABLE_ENTRIES_ALIGN: number = 2;

// Note that we don't have access to a self type here, this has to be purely based on the trait (and
// supertrait) definitions. That means we can't call into the same vtable_entries code since that
// returns a specific instantiation (e.g., with Vacant slots when bounds aren't satisfied). The goal
// here is to do a best-effort approximation without duplicating a lot of code.
//
// This function is used in layout computation for e.g. &dyn Trait, so it's critical that this
// function is an accurate approximation. We verify this when actually computing the vtable below.
// rustc: compiler/rustc_middle/src/ty/vtable.rs:60 vtable_min_entries
export function vtable_min_entries(tcx: TyCtxt, trait_ref: ExistentialTraitRef | undefined): number {
  let count = COMMON_VTABLE_ENTRIES.length;
  if (trait_ref === undefined) {
    return count;
  }

  // This includes self in supertraits.
  for (const def_id of supertrait_def_ids(tcx, trait_ref.def_id)) {
    count += tcx.own_existential_vtable_entries(def_id).length;
  }

  return count;
}

/// Retrieves an allocation that represents the contents of a vtable.
/// Since this is a query, allocations are cached and not duplicated.
///
/// This is an "internal" `AllocId` that should never be used as a value in the interpreted program.
/// The interpreter should use `AllocId` that refer to a `GlobalAlloc::VTable` instead.
/// (This is similar to statics, which also have a similar "internal" `AllocId` storing their
/// initial contents.)
// rustc: compiler/rustc_middle/src/ty/vtable.rs:84 vtable_allocation_provider
export function vtable_allocation_provider(tcx: TyCtxt, key: [Ty, ExistentialTraitRef | undefined]): never {
  const [ty, poly_trait_ref] = key;

  let vtable_entries: readonly VtblEntry[];
  if (poly_trait_ref !== undefined) {
    const trait_ref_ = ExistentialTraitRefC.with_self_ty(poly_trait_ref, as_interner(tcx), ty);
    const trait_ref = tcx.erase_and_anonymize_regions(trait_ref_, d_TraitRef);

    vtable_entries = tcx.vtable_entries(trait_ref);
  } else {
    vtable_entries = COMMON_VTABLE_ENTRIES;
  }

  // This confirms that the layout computation for &dyn Trait has an accurate sizing.
  assert(vtable_entries.length >= vtable_min_entries(tcx, poly_trait_ref), "assertion failed: vtable_entries.len() >= vtable_min_entries(tcx, poly_trait_ref)");

  const layout_r = tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(ty));
  if (layout_r.$ === "Err") {
    const e = layout_r._0;
    return tcx.dcx().fatal((require("./layout.ts") as typeof import("./layout.ts")).display_LayoutError(e));
  }
  const layout = layout_r._0;
  assert(layout.is_sized(), "can't create a vtable for an unsized type");
  const size = layout.size.bytes();
  const align = layout.align.abi.bytes();

  const ptr_size: Size = tcx.data_layout().pointer_size();
  const ptr_align = tcx.data_layout().pointer_align().abi;

  const vtable_size = ptr_size.mul(vtable_entries.length);
  // let mut vtable = Allocation::new(vtable_size, ptr_align, AllocInit::Uninit, ());
  void [size, align, ptr_align, vtable_size];
  // .. (the entries are written as `Scalar`s of fn / vtable pointers; `tcx.reserve_and_set_memory_alloc(..)`)
  return unported("rustc_middle::mir::interpret::Allocation::new (ty/vtable.rs vtable_allocation_provider, M4)");
}
