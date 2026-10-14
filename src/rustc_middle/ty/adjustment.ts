// Port of compiler/rustc_middle/src/ty/adjustment.rs (lane ty-results). The types with their derived Debug / TypeVisitable /
// TypeFoldable impls are generated into adjustment.gen.ts (set rustc_ty of tools/codegen/types.ts); this file holds the
// fns and manual impls. Methods of the generated structs / enums live on same-named companions taking `self` first
// (tyir-binder decision 5); a companion of a generated enum spreads the generated one (its unit-variant singletons).
// `impl fmt::Debug for Adjustment` / `PatAdjustment` live in structural_impls.rs (ty/structural_impls.ts).
import type { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type { Mutability } from "../../rustc_ast_ir/lib.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { unported } from "../../std/panic.ts";
import * as gen from "./adjustment.gen.ts";
import type { TyCtxt } from "./context.ts";

export * from "./adjustment.gen.ts";

export type Adjustment = gen.Adjustment;
export const Adjustment = {
  // rustc: compiler/rustc_middle/src/ty/adjustment.rs:89 is_region_borrow
  is_region_borrow(self: Adjustment): boolean {
    return self.kind.$ === "Borrow" && self.kind._0.$ === "Ref";
  },
};

export type OverloadedDeref = gen.OverloadedDeref;
export const OverloadedDeref = {
  /// Get the [`DefId`] of the method call for the given `Deref`/`DerefMut` trait
  /// for this overloaded deref's mutability.
  // rustc: compiler/rustc_middle/src/ty/adjustment.rs:139 method_call
  method_call(self: OverloadedDeref, tcx: TyCtxt): DefId {
    let trait_def_id: DefId;
    switch (self.mutbl) {
      case "Not":
        trait_def_id = tcx.require_lang_item("Deref" satisfies LangItem, self.span);
        break;
      case "Mut":
        trait_def_id = tcx.require_lang_item("DerefMut" satisfies LangItem, self.span);
        break;
    }
    // tcx.associated_items(trait_def_id)
    //     .in_definition_order()
    //     .find(|item| item.is_fn())
    //     .unwrap()
    //     .def_id
    void trait_def_id;
    return unported("rustc_middle::ty::assoc::AssocItems::in_definition_order (ty/assoc.rs, lane ty-adt-assoc)");
  },
};

export type AutoBorrowMutability = gen.AutoBorrowMutability;
export const AutoBorrowMutability = {
  ...gen.AutoBorrowMutability,

  /// Creates an `AutoBorrowMutability` from a mutability and allowance of two phase borrows.
  ///
  /// Note that when `mutbl.is_not()`, `allow_two_phase_borrow` is ignored
  // rustc: compiler/rustc_middle/src/ty/adjustment.rs:180 new
  new(mutbl: Mutability, allow_two_phase_borrow: gen.AllowTwoPhase): AutoBorrowMutability {
    switch (mutbl) {
      case "Not":
        return gen.AutoBorrowMutability.Not;
      case "Mut":
        return { $: "Mut", allow_two_phase_borrow };
    }
  },
};

/** `impl From<AutoBorrowMutability> for hir::Mutability` */
// rustc: compiler/rustc_middle/src/ty/adjustment.rs:189 from
export function Mutability_from_AutoBorrowMutability(m: AutoBorrowMutability): Mutability {
  switch (m.$) {
    case "Mut":
      return "Mut";
    case "Not":
      return "Not";
  }
}
