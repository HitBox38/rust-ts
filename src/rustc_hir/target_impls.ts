// Port of compiler/rustc_hir/src/target_impls.rs
//! Implements conversions from HIR types to Target.
//
// PORT: the `impl From<X> for Target` blocks are free fns `Target_from_<X>` (Target's companion lives in another
// crate, rustc_attr_ir; PORTING §8 names `From` impls after the source type). This module imports the HIR types from
// ./hir.ts (not ./lib.ts), and rustc_hir/lib.ts re-exports it (trait impls are crate-global upstream).
import { visit } from "../rustc_ast/lib.ts";
import { Target } from "../rustc_attr_ir/target.ts";
import { panic } from "../std/panic.ts";
import type { DefKind } from "./def.ts";
import type { ForeignItem, GenericParam, Item, TraitItem } from "./hir.ts";

// impl From<&hir::ForeignItem<'_>> for Target
// rustc: compiler/rustc_hir/src/target_impls.rs:9 from
export function Target_from_ForeignItem(foreign_item: ForeignItem): Target {
  switch (foreign_item.kind.$) {
    case "Fn":
      return Target.ForeignFn;
    case "Static":
      return Target.ForeignStatic;
    case "Type":
      return Target.ForeignTy;
  }
}

// impl From<&hir::GenericParam<'_>> for Target
// rustc: compiler/rustc_hir/src/target_impls.rs:19 from
export function Target_from_GenericParam(generic_param: GenericParam): Target {
  switch (generic_param.kind.$) {
    case "Type":
      return Target.TypeParam;
    case "Lifetime":
      return Target.LifetimeParam;
    case "Const":
      return Target.ConstParam;
  }
}

// impl From<&hir::TraitItem<'_>> for Target
// rustc: compiler/rustc_hir/src/target_impls.rs:29 from
export function Target_from_TraitItem(trait_item: TraitItem): Target {
  const kind = trait_item.kind;
  switch (kind.$) {
    case "Const":
      return { $: "AssocConst", _0: visit.AssocCtxt.Trait };
    case "Fn":
      if (kind._1.$ === "Required") {
        return { $: "Method", _0: { $: "Trait", body: false } };
      } else {
        return { $: "Method", _0: { $: "Trait", body: true } };
      }
    case "Type":
      return { $: "AssocTy", _0: visit.AssocCtxt.Trait };
  }
}

// impl From<DefKind> for Target
// rustc: compiler/rustc_hir/src/target_impls.rs:44 from
export function Target_from_DefKind(def_kind: DefKind): Target {
  switch (def_kind.$) {
    case "ExternCrate":
      return Target.ExternCrate;
    case "Use":
      return Target.Use;
    case "Static":
      return Target.Static;
    case "Const":
      return Target.Const;
    case "Fn":
      return Target.Fn;
    case "Macro":
      return Target.MacroDef;
    case "Mod":
      return Target.Mod;
    case "ForeignMod":
      return Target.ForeignMod;
    case "GlobalAsm":
      return Target.GlobalAsm;
    case "TyAlias":
      return Target.TyAlias;
    case "Enum":
      return Target.Enum;
    case "Struct":
      return Target.Struct;
    case "Union":
      return Target.Union;
    case "Trait":
      return Target.Trait;
    case "TraitAlias":
      return Target.TraitAlias;
    case "Impl":
      return { $: "Impl", of_trait: def_kind.of_trait };
    default:
      return panic("impossible case reached");
  }
}

// impl From<&hir::Item<'_>> for Target
// rustc: compiler/rustc_hir/src/target_impls.rs:68 from
export function Target_from_Item(item: Item): Target {
  const kind = item.kind;
  switch (kind.$) {
    case "ExternCrate":
      return Target.ExternCrate;
    case "Use":
      return Target.Use;
    case "Static":
      return Target.Static;
    case "Const":
      return Target.Const;
    case "Fn":
      return Target.Fn;
    case "Macro":
      return Target.MacroDef;
    case "Mod":
      return Target.Mod;
    case "ForeignMod":
      return Target.ForeignMod;
    case "GlobalAsm":
      return Target.GlobalAsm;
    case "TyAlias":
      return Target.TyAlias;
    case "Enum":
      return Target.Enum;
    case "Struct":
      return Target.Struct;
    case "Union":
      return Target.Union;
    case "Trait":
      return Target.Trait;
    case "TraitAlias":
      return Target.TraitAlias;
    case "Impl":
      return { $: "Impl", of_trait: kind._0.of_trait !== undefined };
    case "TestBinderConstraints":
      return Target.MacroCall;
  }
}
