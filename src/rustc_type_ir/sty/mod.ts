// Port of compiler/rustc_type_ir/src/sty/mod.rs (contract by lane ty-contract, docs/plan-m3.md D2/D3; filled by lane
// tyir-misc, sub-lane lib-sty).
//
// Defines the hash-consed `Region` class (`pub struct Region<I: Interner>(pub I::InternedRegionKind)`).
// PORT (D2, D3):
// - `I` is erased to rustc_middle's `TyCtxt`; `I::InternedRegionKind` is `Interned<'tcx, RegionKind<'tcx>>`, so
//   the `Region` object *is* the interned `RegionKind` box: one frozen instance per distinct `RegionKind`,
//   made only by `CtxtInterners`' `region` set (`TyCtxt::intern_region`, rustc_middle ty/context.ts). Equality
//   is `===`; a `Region` is its own `Map`/`Set` key.
// - The `RegionKind` is the `internee` field (the name of `WithCachedTypeInfo`'s field, for uniformity with
//   `Ty` / `Const`; a region caches no flags upstream either: `type_flags()` computes them). `self.0.get()` is
//   `this.internee`.
// - Methods: declared in ../decls.ts (`interface Region` / `namespace Region` for the statics), filled on
//   `Region.prototype` / `Region` below, in upstream order (docs/handoff/ty-contract.md "How to fill a stub").
// - Trait impls that are not methods: `Debug` (sty/mod.rs:291) is `debug_Region`; `TypeVisitable` /
//   `TypeFoldable` (:297, :303) are the D4 descriptor `fold_Region`; `Relate` (:281) is `relate_Region`.
// PORT: `write!(f, "{:?}", x)` formats `x` with fresh options (`PLAIN`), tyir-kind decision 5.
import { Interned } from "../../rustc_data_structures/intern.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { EarlyParamRegion, LateParamRegionKind } from "../../rustc_middle/ty/decls.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { debug_DefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed, type Span } from "../../rustc_span/lib.ts";
import { kw, sym, type Symbol } from "../../rustc_span/symbol.ts";
import { type Fmt, PLAIN } from "../../std/fmt.ts";
import { panic } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import type { BoundRegion, BoundVar, DebruijnIndex, PlaceholderRegion, RegionKind, RegionVid } from "../decls.ts";
import type { FallibleTypeFolder, TypeFoldable, TypeFolder } from "../fold.ts";
import { TypeFlags } from "../flags.gen.ts";
import { DebruijnIndex as DebruijnIndexC, INNERMOST } from "../lib.ts";
import type { RelateResult, TypeRelation } from "../relate.ts";
import type { TypeVisitor } from "../visit.ts";
import type { LateParamRegion } from "./mod.gen.ts";
import { debug_LateParamRegionKind } from "../../rustc_middle/ty/structural_impls.ts";
import {
  DefIdGetter_LateParamRegionKind,
  RegionName_EarlyParamRegion,
  RegionName_LateParamRegionKind,
} from "../../rustc_middle/ty/region.ts";

export * from "./consts.ts";
// The other types of sty/mod.rs (`LateParamRegion`) with their derived impls are generated into mod.gen.ts (set rustc_ty
// of tools/codegen/types.ts, lane codegen-tyir); merged with the contract stub by merge-w13.
export * from "./mod.gen.ts";

// PORT (init order): this is a defining module (rustc_middle ty/mod.ts imports it, ty-contract "Init order"), and
// region_kind.ts reaches the extension module rustc_middle ty/sty.ts (through ty_kind.ts), so a static import throws a
// TDZ `ReferenceError` (`Ty`) when rustc_middle/lib.ts loads. `debug_RegionKind` is required lazily, at call time.
function region_kind(): typeof import("../region_kind.ts") {
  return require("../region_kind.ts") as typeof import("../region_kind.ts");
}
// PORT (init order, merge-w15a): binder.ts reaches rustc_middle ty/sty.ts too, so it is required lazily as well.
function binder(): typeof import("../binder.ts") {
  return require("../binder.ts") as typeof import("../binder.ts");
}

/// Use this rather than `RegionKind`, whenever possible.
// rustc-type: compiler/rustc_type_ir/src/sty/mod.rs:26 Region
export class Region extends Interned {
  /** PORT: the interned `RegionKind` (module comment). */
  readonly internee: RegionKind;

  /** PORT: only `CtxtInterners` constructs (D2); the kind object is frozen with it. */
  constructor(internee: RegionKind) {
    super();
    this.internee = Object.freeze(internee);
    Object.freeze(this);
  }

  // PORT: also `impl IntoKind for Region` (sty/mod.rs:275, `self.0.get()`): one method.
  // rustc: compiler/rustc_type_ir/src/sty/mod.rs:246 kind
  // rustc: compiler/rustc_type_ir/src/sty/mod.rs:275 kind
  kind(): RegionKind {
    return this.internee;
  }
}

// These are only the `inherent` trait methods that have been ported across

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:31 new_var
Region.new_var = function (interner: TyCtxt, v: RegionVid): Region {
  return interner.intern_re_var(v);
};

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:35 get_name
Region.prototype.get_name = function (this: Region, interner: TyCtxt): Symbol | undefined {
  const k = this.kind();
  switch (k.$) {
    case "ReEarlyParam":
      return RegionName_EarlyParamRegion.get_name(k._0, interner);
    case "ReBound":
      return binder().BoundRegionKind.get_name(k._1.kind, interner);
    case "ReLateParam":
      return RegionName_LateParamRegionKind.get_name(k._0.kind, interner);
    // PORT: `I::Symbol::KW_STATIC_LIFETIME` is `kw::StaticLifetime` (`impl inherent::Symbol for Symbol`,
    // rustc_middle ty/sty.rs:2192).
    case "ReStatic":
      return kw.StaticLifetime;
    case "RePlaceholder":
      return binder().BoundRegionKind.get_name(k._0.bound.kind, interner);
    default:
      return undefined;
  }
};

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:46 get_name_or_anon
Region.prototype.get_name_or_anon = function (this: Region, interner: TyCtxt): Symbol {
  const name = this.get_name(interner);
  if (name !== undefined) {
    return name;
  } else {
    // PORT: `I::Symbol::SYM_ANON` is `sym::anon` (rustc_middle ty/sty.rs:2193).
    return sym.anon;
  }
};

/// Given some item `binding_item`, check if this region is a generic parameter introduced by it
/// or one of the parent generics. Returns the `DefId` of the parameter definition if so.
// rustc: compiler/rustc_type_ir/src/sty/mod.rs:55 opt_param_def_id
Region.prototype.opt_param_def_id = function (this: Region, interner: TyCtxt, binding_item: DefId): DefId | undefined {
  const k = this.kind();
  switch (k.$) {
    case "ReEarlyParam": {
      const ebr = k._0;
      return (interner.generics_of(binding_item) as Generics).param_region_def_id(interner, ebr);
    }
    case "ReLateParam":
      return DefIdGetter_LateParamRegionKind.get_def_id(k._0.kind);
    default:
      return undefined;
  }
};

/// Is this region named by the user?
// rustc: compiler/rustc_type_ir/src/sty/mod.rs:66 is_named
Region.prototype.is_named = function (this: Region, interner: TyCtxt): boolean {
  const k = this.kind();
  switch (k.$) {
    case "ReEarlyParam":
      return RegionName_EarlyParamRegion.is_named(k._0, interner);
    case "ReBound":
      return binder().BoundRegionKind.is_named(k._1.kind, interner);
    case "ReLateParam":
      return RegionName_LateParamRegionKind.is_named(k._0.kind, interner);
    case "ReStatic":
      return true;
    case "ReVar":
      return false;
    case "RePlaceholder":
      return binder().BoundRegionKind.is_named(k._0.bound.kind, interner);
    case "ReErased":
      return false;
    case "ReError":
      return false;
  }
};

/// Constructs a `RegionKind::ReError` region and registers a delayed bug to ensure it gets
/// used.
// rustc: compiler/rustc_type_ir/src/sty/mod.rs:82 new_error_misc
Region.new_error_misc = function (interner: TyCtxt): Region {
  // PORT: `I::Span::dummy()` is `DUMMY_SP` (`impl inherent::Span for Span`, rustc_middle ty/context.rs:131).
  return Region.new_error_with_message(interner, DUMMY_SP, "RegionKind::ReError constructed but no error reported");
};

/// Constructs a `RegionKind::ReError` region and registers a delayed bug with the given `msg`
/// to ensure it gets used.
// rustc: compiler/rustc_type_ir/src/sty/mod.rs:93 new_error_with_message
Region.new_error_with_message = function (interner: TyCtxt, span: Span, msg: string): Region {
  const reported = interner.span_delayed_bug(span, msg);
  return Region.new_error(interner, reported);
};

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:99 new_late_param
Region.new_late_param = function (interner: TyCtxt, scope: DefId, kind: LateParamRegionKind): Region {
  return interner.intern_region({ $: "ReLateParam", _0: { scope, kind } });
};

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:104 new_early_param
Region.new_early_param = function (interner: TyCtxt, early_bound_region: EarlyParamRegion): Region {
  return interner.intern_region({ $: "ReEarlyParam", _0: early_bound_region });
};

/// Constructs a `RegionKind::ReError` region.
// rustc: compiler/rustc_type_ir/src/sty/mod.rs:110 new_error
Region.new_error = function (interner: TyCtxt, guar: ErrorGuaranteed): Region {
  return interner.intern_region({ $: "ReError", _0: guar });
};

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:115 new_bound
Region.new_bound = function (interner: TyCtxt, debruijn: DebruijnIndex, bound_region: BoundRegion): Region {
  return interner.intern_bound_region(debruijn, bound_region);
};

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:120 new_anon_bound
Region.new_anon_bound = function (interner: TyCtxt, debruijn: DebruijnIndex, var_: BoundVar): Region {
  return Region.new_bound(interner, debruijn, { var: var_, kind: { $: "Anon" } });
};

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:125 new_canonical_bound
Region.new_canonical_bound = function (interner: TyCtxt, var_: BoundVar): Region {
  return interner.intern_canonical_bound(var_);
};

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:130 new_placeholder
Region.new_placeholder = function (interner: TyCtxt, placeholder: PlaceholderRegion): Region {
  return interner.intern_region({ $: "RePlaceholder", _0: placeholder });
};

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:135 new_static
Region.new_static = function (interner: TyCtxt): Region {
  return interner.get_re_static_lifetime();
};

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:140 is_bound
Region.prototype.is_bound = function (this: Region): boolean {
  return this.internee.$ === "ReBound";
};

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:145 is_error
Region.prototype.is_error = function (this: Region): boolean {
  return this.kind().$ === "ReError";
};

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:150 is_static
Region.prototype.is_static = function (this: Region): boolean {
  return this.kind().$ === "ReStatic";
};

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:155 is_erased
Region.prototype.is_erased = function (this: Region): boolean {
  return this.kind().$ === "ReErased";
};

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:160 is_placeholder
Region.prototype.is_placeholder = function (this: Region): boolean {
  return this.kind().$ === "RePlaceholder";
};

/// True for free regions other than `'static`.
// rustc: compiler/rustc_type_ir/src/sty/mod.rs:165 is_param
Region.prototype.is_param = function (this: Region): boolean {
  const k = this.kind();
  return k.$ === "ReEarlyParam" || k.$ === "ReLateParam";
};

/// True for free region in the current context.
///
/// This is the case for `'static` and param regions.
// rustc: compiler/rustc_type_ir/src/sty/mod.rs:172 is_free
Region.prototype.is_free = function (this: Region): boolean {
  switch (this.kind().$) {
    case "ReStatic":
    case "ReEarlyParam":
    case "ReLateParam":
      return true;
    case "ReVar":
    case "RePlaceholder":
    case "ReBound":
    case "ReErased":
    case "ReError":
      return false;
  }
};

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:185 is_var
Region.prototype.is_var = function (this: Region): boolean {
  return this.kind().$ === "ReVar";
};

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:189 as_var
Region.prototype.as_var = function (this: Region): RegionVid {
  const k = this.kind();
  if (k.$ === "ReVar") {
    return k._0;
  }
  return panic(`expected region ${debug_Region(this, PLAIN)} to be of kind ReVar`);
};

// FIXME this should be made private and instead accessed via the
// trait Flags
// rustc: compiler/rustc_type_ir/src/sty/mod.rs:199 type_flags
Region.prototype.type_flags = function (this: Region): TypeFlags {
  let flags = TypeFlags.empty();

  const k = this.internee;
  switch (k.$) {
    case "ReVar": {
      flags = (flags | TypeFlags.HAS_FREE_REGIONS) as TypeFlags;
      flags = (flags | TypeFlags.HAS_FREE_LOCAL_REGIONS) as TypeFlags;
      flags = (flags | TypeFlags.HAS_RE_INFER) as TypeFlags;
      break;
    }
    case "RePlaceholder": {
      flags = (flags | TypeFlags.HAS_FREE_REGIONS) as TypeFlags;
      flags = (flags | TypeFlags.HAS_FREE_LOCAL_REGIONS) as TypeFlags;
      flags = (flags | TypeFlags.HAS_RE_PLACEHOLDER) as TypeFlags;
      break;
    }
    case "ReEarlyParam": {
      flags = (flags | TypeFlags.HAS_FREE_REGIONS) as TypeFlags;
      flags = (flags | TypeFlags.HAS_FREE_LOCAL_REGIONS) as TypeFlags;
      flags = (flags | TypeFlags.HAS_RE_PARAM) as TypeFlags;
      break;
    }
    case "ReLateParam": {
      flags = (flags | TypeFlags.HAS_FREE_REGIONS) as TypeFlags;
      flags = (flags | TypeFlags.HAS_FREE_LOCAL_REGIONS) as TypeFlags;
      break;
    }
    case "ReStatic": {
      flags = (flags | TypeFlags.HAS_FREE_REGIONS) as TypeFlags;
      break;
    }
    case "ReBound": {
      if (k._0.$ === "Canonical") {
        flags = (flags | TypeFlags.HAS_RE_BOUND) as TypeFlags;
        flags = (flags | TypeFlags.HAS_CANONICAL_BOUND) as TypeFlags;
      } else {
        flags = (flags | TypeFlags.HAS_RE_BOUND) as TypeFlags;
      }
      break;
    }
    case "ReErased": {
      flags = (flags | TypeFlags.HAS_RE_ERASED) as TypeFlags;
      break;
    }
    case "ReError": {
      flags = (flags | TypeFlags.HAS_FREE_REGIONS) as TypeFlags;
      flags = (flags | TypeFlags.HAS_RE_ERROR) as TypeFlags;
      break;
    }
  }
  // debug!("type_flags({:?}) = {:?}", self, flags);

  return flags;
};

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:251 bound_at_or_above_binder
Region.prototype.bound_at_or_above_binder = function (this: Region, index: DebruijnIndex): boolean {
  const k = this.kind();
  if (k.$ === "ReBound" && k._0.$ === "Bound") {
    const debruijn = k._0._0;
    return debruijn >= index;
  }
  return false;
};

// ---- impl<I: Interner> Flags for Region<I> ----

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:260 flags
Region.prototype.flags = function (this: Region): TypeFlags {
  return this.type_flags();
};

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:264 outer_exclusive_binder
Region.prototype.outer_exclusive_binder = function (this: Region): DebruijnIndex {
  const k = this.kind();
  if (k.$ === "ReBound" && k._0.$ === "Bound") {
    const debruijn = k._0._0;
    return DebruijnIndexC.shifted_in(debruijn, 1);
  }
  return INNERMOST;
};

// ---- impl<I: Interner> Relate<I> for Region<I> ----

// PORT: `R: TypeRelation<I>` is the relation object (relate.ts's `TypeRelation`); relate.ts wraps this fn in its
// `relate_Region` descriptor.
// rustc: compiler/rustc_type_ir/src/sty/mod.rs:281 relate
export function relate_Region(relation: TypeRelation, a: Region, b: Region): RelateResult<Region> {
  return relation.regions(a, b);
}

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:291 fmt
export function debug_Region(self: Region, _f: Fmt): string {
  return region_kind().debug_RegionKind(self.kind(), PLAIN);
}

/** D4 descriptor: `impl TypeVisitable for Region` (sty/mod.rs:296) + `impl TypeFoldable for Region` (:302). */
export const fold_Region: TypeFoldable<Region> = {
  // rustc: compiler/rustc_type_ir/src/sty/mod.rs:297 visit_with
  visit_with<R>(self: Region, visitor: TypeVisitor<R>): R {
    return visitor.visit_region(self);
  },
  // rustc: compiler/rustc_type_ir/src/sty/mod.rs:303 try_fold_with
  try_fold_with<E>(self: Region, folder: FallibleTypeFolder<E>): Result<Region, E> {
    return folder.try_fold_region(self);
  },
  // rustc: compiler/rustc_type_ir/src/sty/mod.rs:307 fold_with
  fold_with(self: Region, folder: TypeFolder): Region {
    return folder.fold_region(self);
  },
};

// PORT (merge-w13): the impl fns of `fold_Region` as tools/codegen's generated code calls them (type_fold.json shape).
export function visit_with_Region<R>(self: Region, visitor: TypeVisitor<R>): R {
  return fold_Region.visit_with(self, visitor);
}
export function try_fold_with_Region<E>(self: Region, folder: FallibleTypeFolder<E>): Result<Region, E> {
  return fold_Region.try_fold_with(self, folder);
}
export function fold_with_Region(self: Region, folder: TypeFolder): Region {
  return fold_Region.fold_with(self, folder);
}

// rustc: compiler/rustc_type_ir/src/sty/mod.rs:331 fmt
export function debug_LateParamRegion(self: LateParamRegion, _f: Fmt): string {
  return `ReLateParam(${debug_DefId(self.scope, PLAIN)}, ${debug_LateParamRegionKind(self.kind, PLAIN)})`;
}
