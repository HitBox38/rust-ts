// Port of compiler/rustc_middle/src/ty/region.rs. The types with their derived Debug / TypeVisitable / TypeFoldable
// impls are generated into region.gen.ts (set rustc_ty of tools/codegen/types.ts, lane codegen-tyir); the fns and manual
// impls of this file are below (lane small-gaps-18; the Debug impl by lane tydump-subject).
import { BoundVar } from "../../rustc_type_ir/lib.gen.ts";
import type { BoundRegionKind } from "../../rustc_type_ir/binder.ts";
import type { DefIdGetter, ParamLike, RegionName } from "../../rustc_type_ir/inherent.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { kw, Symbol } from "../../rustc_span/symbol.ts";
import type { Debug } from "../../std/fmt.ts";
import type { TyCtxt } from "./context.ts";
import * as gen from "./region.gen.ts";

export * from "./region.gen.ts";

// ---- EarlyParamRegion ---------------------------------------------------------------------------------------------

export type EarlyParamRegion = gen.EarlyParamRegion;
export const EarlyParamRegion = {
  // rustc: compiler/rustc_middle/src/ty/region.rs:24 get_name
  get_name(self: EarlyParamRegion): Symbol | undefined {
    if (EarlyParamRegion.is_named(self)) {
      return self.name;
    } else {
      return undefined;
    }
  },

  /// Does this early bound region have a name? Early bound regions normally
  /// always have names except when using anonymous lifetimes (`'_`).
  // rustc: compiler/rustc_middle/src/ty/region.rs:31 is_named
  is_named(self: EarlyParamRegion): boolean {
    return self.name !== kw.UnderscoreLifetime;
  },
};

/** `impl rustc_type_ir::inherent::ParamLike for EarlyParamRegion` */
export const ParamLike_EarlyParamRegion: ParamLike<EarlyParamRegion> = {
  // rustc: compiler/rustc_middle/src/ty/region.rs:37 index
  index(self: EarlyParamRegion): number {
    return self.index;
  },
};

/** `impl<'tcx> rustc_type_ir::inherent::RegionName<TyCtxt<'tcx>> for EarlyParamRegion` */
export const RegionName_EarlyParamRegion: RegionName<EarlyParamRegion> = {
  // rustc: compiler/rustc_middle/src/ty/region.rs:44 get_name
  get_name(self: EarlyParamRegion, _tcx: TyCtxt): Symbol | undefined {
    return EarlyParamRegion.get_name(self);
  },

  /// Does this early bound region have a name? Early bound regions normally
  /// always have names except when using anonymous lifetimes (`'_`).
  // rustc: compiler/rustc_middle/src/ty/region.rs:51 is_named
  is_named(self: EarlyParamRegion, _tcx: TyCtxt): boolean {
    return EarlyParamRegion.is_named(self);
  },
};

// impl std::fmt::Debug for EarlyParamRegion (lane tydump-subject)
// rustc: compiler/rustc_middle/src/ty/region.rs:57 fmt
export const debug_EarlyParamRegion: Debug<EarlyParamRegion> = (self, _f) => {
  // write!(f, "{}/#{}", self.name, self.index)
  return `${Symbol.as_str(self.name)}/#${self.index}`;
};

// ---- LateParamRegionKind ------------------------------------------------------------------------------------------

export type LateParamRegionKind = gen.LateParamRegionKind;
export const LateParamRegionKind = {
  ...gen.LateParamRegionKind,

  // rustc: compiler/rustc_middle/src/ty/region.rs:92 from_bound
  from_bound(var_: BoundVar, br: BoundRegionKind): LateParamRegionKind {
    switch (br.$) {
      case "Anon":
        return { $: "Anon", _0: BoundVar.as_u32(var_) };
      case "Named": {
        const def_id = br._0;
        return { $: "Named", _0: def_id };
      }
      case "ClosureEnv":
        return LateParamRegionKind.ClosureEnv;
      case "NamedForPrinting": {
        const name = br._0;
        return { $: "NamedAnon", _0: BoundVar.as_u32(var_), _1: name };
      }
    }
  },

  // rustc: compiler/rustc_middle/src/ty/region.rs:103 is_named
  is_named(self: LateParamRegionKind, tcx: TyCtxt): boolean {
    return LateParamRegionKind.get_name(self, tcx) !== undefined;
  },

  // rustc: compiler/rustc_middle/src/ty/region.rs:107 get_name
  get_name(self: LateParamRegionKind, tcx: TyCtxt): Symbol | undefined {
    switch (self.$) {
      case "Named": {
        const def_id = self._0;
        const name = tcx.item_name(def_id);
        if (name !== kw.UnderscoreLifetime) {
          return name;
        } else {
          return undefined;
        }
      }
      case "NamedAnon": {
        const name = self._1;
        return name;
      }
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/region.rs:118 get_id
  get_id(self: LateParamRegionKind): DefId | undefined {
    switch (self.$) {
      case "Named": {
        const id = self._0;
        return id;
      }
      default:
        return undefined;
    }
  },
};

/** `impl<'tcx> rustc_type_ir::inherent::RegionName<TyCtxt<'tcx>> for LateParamRegionKind` */
export const RegionName_LateParamRegionKind: RegionName<LateParamRegionKind> = {
  // rustc: compiler/rustc_middle/src/ty/region.rs:128 get_name
  get_name(self: LateParamRegionKind, tcx: TyCtxt): Symbol | undefined {
    return LateParamRegionKind.get_name(self, tcx);
  },

  // rustc: compiler/rustc_middle/src/ty/region.rs:133 is_named
  is_named(self: LateParamRegionKind, tcx: TyCtxt): boolean {
    return LateParamRegionKind.is_named(self, tcx);
  },
};

/** `impl<'tcx> rustc_type_ir::inherent::DefIdGetter<TyCtxt<'tcx>> for LateParamRegionKind` */
export const DefIdGetter_LateParamRegionKind: DefIdGetter<LateParamRegionKind> = {
  // rustc: compiler/rustc_middle/src/ty/region.rs:139 get_def_id
  get_def_id(self: LateParamRegionKind): DefId | undefined {
    return LateParamRegionKind.get_id(self);
  },
};
