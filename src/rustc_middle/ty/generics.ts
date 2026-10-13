// Partial port of compiler/rustc_middle/src/ty/generics.rs: the data types `GenericParamDefKind`,
// `GenericParamDef`, `GenericParamCount` and `Generics` (decoded from crate metadata by the `generics_of`
// extern provider; derive(TyDecodable) is generated into rustc_middle/decodable.gen.ts), their derived / manual
// Debug, and the methods that need no `Ty` / `GenericArg` / clause machinery. The rest of the file (`default_value`,
// `to_error`, `param_at`, `own_args*`, `GenericClauses`, `ConstConditions`, ...) works on types and is M3.
//
// PORT: `param_def_id_to_index: FxHashMap<DefId, u32>` is a `KeyedMap` keyed by `DefId_hash_key` (a JS `Map` would
// compare the decoded `DefId` objects by identity).
import { ParamKindOrd } from "../../rustc_ast/lib.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { debug_DefId, type DefId } from "../../rustc_span/def_id.ts";
import { debug_Span, type Span } from "../../rustc_span/lib.ts";
import { debug_Symbol, kw, type Symbol } from "../../rustc_span/symbol.ts";
import { type Debug, debug_bool, debug_int, debug_list, debug_option, debug_struct, debug_tuple, debug_vec } from "../../std/fmt.ts";
import { DefId_hash_key } from "../query/caches.ts";
import type { TyCtxt } from "./context.ts";

export type GenericParamDefKind =
  | { readonly $: "Lifetime" }
  | { readonly $: "Type"; has_default: boolean; synthetic: boolean }
  | { readonly $: "Const"; has_default: boolean };

export const GenericParamDefKind = {
  Lifetime: Object.freeze({ $: "Lifetime" as const }),

  // rustc: compiler/rustc_middle/src/ty/generics.rs:22 descr
  descr(self: GenericParamDefKind): string {
    switch (self.$) {
      case "Lifetime":
        return "lifetime";
      case "Type":
        return "type";
      case "Const":
        return "constant";
    }
  },
  // rustc: compiler/rustc_middle/src/ty/generics.rs:29 to_ord
  to_ord(self: GenericParamDefKind): ParamKindOrd {
    switch (self.$) {
      case "Lifetime":
        return ParamKindOrd.Lifetime;
      case "Type":
      case "Const":
        return ParamKindOrd.TypeOrConst;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/generics.rs:38 is_ty_or_const
  is_ty_or_const(self: GenericParamDefKind): boolean {
    switch (self.$) {
      case "Lifetime":
        return false;
      case "Type":
      case "Const":
        return true;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/generics.rs:45 is_synthetic
  is_synthetic(self: GenericParamDefKind): boolean {
    switch (self.$) {
      case "Type":
        return self.synthetic;
      default:
        return false;
    }
  },
};

/** `#[derive(Debug)]` */
export const debug_GenericParamDefKind: Debug<GenericParamDefKind> = (v, f) => {
  switch (v.$) {
    case "Lifetime":
      return "Lifetime";
    case "Type":
      return debug_struct(f, "Type", [
        ["has_default", debug_bool(v.has_default, f)],
        ["synthetic", debug_bool(v.synthetic, f)],
      ]);
    case "Const":
      return debug_struct(f, "Const", [["has_default", debug_bool(v.has_default, f)]]);
  }
};

export interface GenericParamDef {
  name: Symbol;
  def_id: DefId;
  index: number;

  /// `pure_wrt_drop`, set by the (unsafe) `#[may_dangle]` attribute
  /// on generic parameter `'a`/`T`, asserts data behind the parameter
  /// `'a`/`T` won't be accessed during the parent type's `Drop` impl.
  pure_wrt_drop: boolean;

  kind: GenericParamDefKind;
}

export const GenericParamDef = {
  // rustc: compiler/rustc_middle/src/ty/generics.rs:76 is_anonymous_lifetime
  is_anonymous_lifetime(self: GenericParamDef): boolean {
    switch (self.kind.$) {
      case "Lifetime":
        return self.name === kw.UnderscoreLifetime;
      default:
        return false;
    }
  },
};

/** `#[derive(Debug)]` */
export const debug_GenericParamDef: Debug<GenericParamDef> = (v, f) =>
  debug_struct(f, "GenericParamDef", [
    ["name", debug_Symbol(v.name, f)],
    ["def_id", debug_DefId(v.def_id, f)],
    ["index", debug_int(v.index, f)],
    ["pure_wrt_drop", debug_bool(v.pure_wrt_drop, f)],
    ["kind", debug_GenericParamDefKind(v.kind, f)],
  ]);

// #[derive(Default)]
export interface GenericParamCount {
  lifetimes: number;
  types: number;
  consts: number;
}

/** `GenericParamCount::default()` */
export function default_GenericParamCount(): GenericParamCount {
  return { lifetimes: 0, types: 0, consts: 0 };
}

/// Information about the formal type/lifetime parameters associated
/// with an item or method. Analogous to `hir::Generics`.
///
/// The ordering of parameters is the same as in [`ty::GenericArg`] (excluding child generics):
/// `Self` (optionally), `Lifetime` params..., `Type` params...
export class Generics {
  constructor(
    public parent: DefId | undefined,
    public parent_count: number,
    public own_params: GenericParamDef[],

    /// Reverse map to the `index` field of each `GenericParamDef`.
    // #[stable_hash(ignore)]
    public param_def_id_to_index: Map<DefId, number>,

    public has_self: boolean,
    public has_late_bound_regions: Span | undefined,
  ) {}

  /** derive(TyDecodable) construction (tools/codegen `decodable_construct`): the decoded map, rekeyed by `DefId` value. */
  static from_decoded(
    parent: DefId | undefined,
    parent_count: number,
    own_params: GenericParamDef[],
    param_def_id_to_index: Map<DefId, number>,
    has_self: boolean,
    has_late_bound_regions: Span | undefined,
  ): Generics {
    return new Generics(parent, parent_count, own_params, new KeyedMap(DefId_hash_key, param_def_id_to_index), has_self, has_late_bound_regions);
  }

  /// Looks through the generics and all parents to find the index of the
  /// given param def-id. This is in comparison to the `param_def_id_to_index`
  /// struct member, which only stores information about this item's own
  /// generics.
  // rustc: compiler/rustc_middle/src/ty/generics.rs:164 param_def_id_to_index
  param_def_id_to_index_(tcx: TyCtxt, def_id: DefId): number | undefined {
    const idx = this.param_def_id_to_index.get(def_id);
    if (idx !== undefined) {
      return idx;
    } else if (this.parent !== undefined) {
      const parent = tcx.generics_of(this.parent) as Generics;
      return parent.param_def_id_to_index_(tcx, def_id);
    } else {
      return undefined;
    }
  }

  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/generics.rs:176 count
  count(): number {
    return this.parent_count + this.own_params.length;
  }

  // rustc: compiler/rustc_middle/src/ty/generics.rs:180 own_counts
  own_counts(): GenericParamCount {
    // We could cache this as a property of `GenericParamCount`, but
    // the aim is to refactor this away entirely eventually and the
    // presence of this method will be a constant reminder.
    const own_counts = default_GenericParamCount();

    for (const param of this.own_params) {
      switch (param.kind.$) {
        case "Lifetime":
          own_counts.lifetimes += 1;
          break;
        case "Type":
          own_counts.types += 1;
          break;
        case "Const":
          own_counts.consts += 1;
          break;
      }
    }

    return own_counts;
  }

  // rustc: compiler/rustc_middle/src/ty/generics.rs:197 own_defaults
  own_defaults(): GenericParamCount {
    const own_defaults = default_GenericParamCount();

    for (const param of this.own_params) {
      switch (param.kind.$) {
        case "Lifetime":
          break;
        case "Type":
          own_defaults.types += param.kind.has_default ? 1 : 0;
          break;
        case "Const":
          own_defaults.consts += param.kind.has_default ? 1 : 0;
          break;
      }
    }

    return own_defaults;
  }

  // rustc: compiler/rustc_middle/src/ty/generics.rs:215 requires_monomorphization
  requires_monomorphization(tcx: TyCtxt): boolean {
    if (this.own_requires_monomorphization()) {
      return true;
    }

    if (this.parent !== undefined) {
      const parent = tcx.generics_of(this.parent) as Generics;
      return parent.requires_monomorphization(tcx);
    } else {
      return false;
    }
  }

  // rustc: compiler/rustc_middle/src/ty/generics.rs:228 own_requires_monomorphization
  own_requires_monomorphization(): boolean {
    for (const param of this.own_params) {
      switch (param.kind.$) {
        case "Type":
        case "Const":
          return true;
        case "Lifetime":
          break;
      }
    }
    return false;
  }

  /// Returns `true` if `params` has `impl Trait`.
  // rustc: compiler/rustc_middle/src/ty/generics.rs:293 has_impl_trait
  has_impl_trait(): boolean {
    return this.own_params.some((param) => param.kind.$ === "Type" && param.kind.synthetic === true);
  }

  // rustc: compiler/rustc_middle/src/ty/generics.rs:299 own_synthetic_params_count
  own_synthetic_params_count(): number {
    return this.own_params.filter((p) => GenericParamDefKind.is_synthetic(p.kind)).length;
  }

  // rustc: compiler/rustc_middle/src/ty/generics.rs:373 is_empty
  is_empty(): boolean {
    return this.count() === 0;
  }

  // rustc: compiler/rustc_middle/src/ty/generics.rs:377 is_own_empty
  is_own_empty(): boolean {
    return this.own_params.length === 0;
  }

  // rustc: compiler/rustc_middle/src/ty/generics.rs:381 has_own_self
  has_own_self(): boolean {
    return this.has_self && this.parent === undefined;
  }
}

// rustc: compiler/rustc_middle/src/ty/generics.rs:134 fmt
export const debug_Generics: Debug<Generics> = (v, f) => {
  // ironically, we get this warning because of what we're trying to fix.
  // #[expect(rustc::potential_query_instability)]
  const stabilized_hashmap = [...v.param_def_id_to_index];
  // `sort_by_key` is a stable sort, as `Array.prototype.sort` is.
  stabilized_hashmap.sort((a, b) => a[1] - b[1]);
  return debug_struct(f, "Generics", [
    ["parent", debug_option(v.parent, f, debug_DefId)],
    ["parent_count", debug_int(v.parent_count, f)],
    ["own_params", debug_vec(v.own_params, f, debug_GenericParamDef)],
    ["param_def_id_to_index", debug_list(f, stabilized_hashmap.map(([k, i]) => debug_tuple(f, "", [debug_DefId(k, f), debug_int(i, f)])))],
    ["has_self", debug_bool(v.has_self, f)],
    ["has_late_bound_regions", debug_option(v.has_late_bound_regions, f, debug_Span)],
  ]);
};
