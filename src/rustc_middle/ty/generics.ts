// Port of compiler/rustc_middle/src/ty/generics.rs: the data types `GenericParamDefKind`, `GenericParamDef`,
// `GenericParamCount` and `Generics` (decoded from crate metadata by the `generics_of` extern provider;
// derive(TyDecodable) is generated into rustc_middle/decodable.gen.ts), `GenericClauses` and `ConstConditions`, their
// derived / manual Debug, and their methods (the type-level ones by lane ty-args).
//
// PORT: `param_def_id_to_index: FxHashMap<DefId, u32>` is a `KeyedMap` keyed by `DefId_hash_key` (a JS `Map` would
// compare the decoded `DefId` objects by identity).
// PORT: the queries `generics_of`, `type_of`, `const_param_default`, `clauses_of` and `const_conditions` are typed
// `unknown` by queries.gen.ts until their value types are generated; their values are cast to the upstream types here.
// PORT: `&'tcx [(Clause, Span)]` is `readonly [Clause, Span][]`; `impl Iterator + DoubleEndedIterator +
// ExactSizeIterator + Clone` results are `MapUnzipIter` (lazy, like upstream: instantiation happens per `next`).
import { ParamKindOrd } from "../../rustc_ast/lib.ts";
import { ControlFlow, VisitorResult as VisitorResultC, type VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { debug_DefId, type DefId } from "../../rustc_span/def_id.ts";
import { debug_Span, type ErrorGuaranteed, type Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { debug_Symbol, kw, type Symbol } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder, fold_Binder, type IterIdentityCopied, type IterInstantiatedCopied } from "../../rustc_type_ir/binder.ts";
import type { ClauseKind, PolyTraitRef, TraitRef } from "../../rustc_type_ir/decls.ts";
import { fold_tuple2, type PredicateProxy, type TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { fold_with_TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../rustc_type_ir/predicate.gen.ts";
import { TraitClause } from "../../rustc_type_ir/predicate.ts";
import { Const, debug_Region, Region } from "../../rustc_type_ir/sty/mod.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { standin_fold_Ty } from "../../rustc_type_ir/fold.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import { type Debug, debug_bool, debug_int, debug_list, debug_option, debug_struct, debug_tuple, debug_vec, type Fmt, PLAIN, PRETTY } from "../../std/fmt.ts";
import { panic, unwrap } from "../../std/panic.ts";
import { Ok } from "../../std/result.ts";
import { slice_from, slice_to } from "../../std/slice.ts";
import { DefId_hash_key } from "../query/caches.ts";
import type { TyCtxt } from "./context.ts";
import type { EarlyParamRegion, ParamConst, ParamTy } from "./decls.ts";
import { fold_GenericArg, GenericArg, type GenericArgsRef } from "./generic_args.ts";
import type { Clauses } from "./list.ts";
import { Ty } from "./mod.ts";
import { type Clause, debug_Clause, fold_with_Clause, try_fold_with_Clause, visit_with_Clause } from "./predicate.ts";

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

  // rustc: compiler/rustc_middle/src/ty/generics.rs:83 default_value
  default_value(self: GenericParamDef, tcx: TyCtxt): EarlyBinder<GenericArg> | undefined {
    switch (self.kind.$) {
      case "Type":
        if (self.kind.has_default === true) {
          return EarlyBinder.map_bound(tcx.type_of(self.def_id) as EarlyBinder<Ty>, (t) => GenericArg.from_Ty(t));
        }
        return undefined;
      case "Const":
        if (self.kind.has_default === true) {
          return EarlyBinder.map_bound(tcx.const_param_default(self.def_id) as EarlyBinder<Const>, (c) => GenericArg.from_Const(c));
        }
        return undefined;
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/generics.rs:98 to_error
  to_error(self: GenericParamDef, tcx: TyCtxt): GenericArg {
    switch (self.kind.$) {
      case "Lifetime":
        return GenericArg.from_Region(Region.new_error_misc(tcx));
      case "Type":
        return GenericArg.from_Ty(Ty.new_misc_error(tcx));
      case "Const":
        return GenericArg.from_Const(Const.new_misc_error(tcx));
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
  // rustc: compiler/rustc_middle/src/ty/generics.rs:68 to_early_bound_region_data
  to_early_bound_region_data(self: GenericParamDef): EarlyParamRegion {
    if (self.kind.$ === "Lifetime") {
      return { index: self.index, name: self.name };
    } else {
      return bug("cannot convert a non-lifetime parameter def to an early bound region");
    }
  },

  // rustc: compiler/rustc_middle/src/ty/generics.rs:76 is_anonymous_lifetime
  is_anonymous_lifetime(self: GenericParamDef): boolean {
    switch (self.kind.$) {
      case "Lifetime":
        return self.name === kw.UnderscoreLifetime;
      default:
        return false;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/generics.rs:83 default_value
  default_value(self: GenericParamDef, tcx: TyCtxt): EarlyBinder<GenericArg> | undefined {
    switch (self.kind.$) {
      case "Type":
        if (self.kind.has_default === true) {
          return EarlyBinder.map_bound(tcx.type_of(self.def_id) as EarlyBinder<Ty>, (t) => GenericArg.from_Ty(t));
        }
        return undefined;
      case "Const":
        if (self.kind.has_default === true) {
          return EarlyBinder.map_bound(tcx.const_param_default(self.def_id) as EarlyBinder<Const>, (c) => GenericArg.from_Const(c));
        }
        return undefined;
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/generics.rs:98 to_error
  to_error(self: GenericParamDef, tcx: TyCtxt): GenericArg {
    switch (self.kind.$) {
      case "Lifetime":
        return GenericArg.from_Region(Region.new_error_misc(tcx));
      case "Type":
        return GenericArg.from_Ty(Ty.new_misc_error(tcx));
      case "Const":
        return GenericArg.from_Const(Const.new_misc_error(tcx));
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

  // PORT: `impl inherent::GenericsOf for &Generics` (generics.rs:150): `count` is the inherent `count` below.
  // rustc: compiler/rustc_middle/src/ty/generics.rs:154 param_region_def_id
  param_region_def_id(tcx: TyCtxt, ebr: EarlyParamRegion): DefId {
    return this.region_param(ebr, tcx).def_id;
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

  // PORT: also `impl inherent::GenericsOf for &Generics` `count` (generics.rs:151, the same body): one method.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/generics.rs:151 count
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

  /// Returns the `GenericParamDef` with the given index.
  // rustc: compiler/rustc_middle/src/ty/generics.rs:241 param_at
  param_at(param_index: number, tcx: TyCtxt): GenericParamDef {
    // `param_index.checked_sub(self.parent_count)`
    if (param_index >= this.parent_count) {
      const index = param_index - this.parent_count;
      return index_slice(this.own_params, index);
    } else {
      const parent = tcx.generics_of(unwrap(this.parent, "parent_count > 0 but no parent?")) as Generics;
      return parent.param_at(param_index, tcx);
    }
  }

  // rustc: compiler/rustc_middle/src/ty/generics.rs:250 params_to
  params_to(param_index: number, tcx: TyCtxt): readonly GenericParamDef[] {
    // `param_index.checked_sub(self.parent_count)`
    if (param_index >= this.parent_count) {
      const index = param_index - this.parent_count;
      return slice_to(this.own_params, index);
    } else {
      const parent = tcx.generics_of(unwrap(this.parent, "parent_count > 0 but no parent?")) as Generics;
      return parent.params_to(param_index, tcx);
    }
  }

  /// Returns the `GenericParamDef` associated with this `EarlyParamRegion`.
  // rustc: compiler/rustc_middle/src/ty/generics.rs:260 region_param
  region_param(param_: EarlyParamRegion, tcx: TyCtxt): GenericParamDef {
    const param = this.param_at(param_.index, tcx);
    switch (param.kind.$) {
      case "Lifetime":
        return param;
      default:
        return bug(`expected lifetime parameter, but found another generic parameter: ${debug_GenericParamDef(param, PRETTY)}`);
    }
  }

  /// Returns the `GenericParamDef` associated with this `ParamTy`.
  // rustc: compiler/rustc_middle/src/ty/generics.rs:275 type_param
  type_param(param_: ParamTy, tcx: TyCtxt): GenericParamDef {
    const param = this.param_at(param_.index, tcx);
    switch (param.kind.$) {
      case "Type":
        return param;
      default:
        return bug(`expected type parameter, but found another generic parameter: ${debug_GenericParamDef(param, PRETTY)}`);
    }
  }

  /// Returns the `GenericParamDef` associated with this `ParamConst`.
  // rustc: compiler/rustc_middle/src/ty/generics.rs:284 const_param
  const_param(param_: ParamConst, tcx: TyCtxt): GenericParamDef {
    const param = this.param_at(param_.index, tcx);
    switch (param.kind.$) {
      case "Const":
        return param;
      default:
        return bug(`expected const parameter, but found another generic parameter: ${debug_GenericParamDef(param, PRETTY)}`);
    }
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

  /// Returns the args corresponding to the generic parameters
  /// of this item, excluding `Self`.
  ///
  /// **This should only be used for diagnostics purposes.**
  // rustc: compiler/rustc_middle/src/ty/generics.rs:307 own_args_no_defaults
  own_args_no_defaults(tcx: TyCtxt, args: readonly GenericArg[]): readonly GenericArg[] {
    // `let mut own_params = self.parent_count..self.count();`
    let start = this.parent_count;
    let end = this.count();
    if (this.has_own_self()) {
      start = 1;
    }

    // Filter the default arguments.
    //
    // This currently uses structural equality instead
    // of semantic equivalence. While not ideal, that's
    // good enough for now as this should only be used
    // for diagnostics anyways.
    let n = 0;
    for (let i = this.own_params.length - 1; i >= 0; i--) {
      const param = this.own_params[i]!;
      const default_ = GenericParamDef.default_value(param, tcx);
      if (
        default_ !== undefined &&
        Unnormalized.skip_norm_wip(EarlyBinder.instantiate(default_, tcx, args, fold_GenericArg)) === index_slice(args, param.index)
      ) {
        n += 1;
      } else {
        break;
      }
    }
    end -= n;

    return slice_range(args, start, end);
  }

  /// Returns the args corresponding to the generic parameters of this item, excluding `Self`.
  ///
  /// **This should only be used for diagnostics purposes.**
  // rustc: compiler/rustc_middle/src/ty/generics.rs:340 own_args
  own_args(args: readonly GenericArg[]): readonly GenericArg[] {
    const own = slice_to(slice_from(args, this.parent_count), this.own_params.length);
    if (this.has_own_self()) {
      return slice_from(own, 1);
    } else {
      return own;
    }
  }

  /// Returns true if a concrete type is specified after a default type.
  /// For example, consider `struct T<W = usize, X = Vec<W>>(W, X)`
  /// `T<usize, String>` will return true
  /// `T<usize>` will return false
  // rustc: compiler/rustc_middle/src/ty/generics.rs:352 check_concrete_type_after_default
  check_concrete_type_after_default(tcx: TyCtxt, args: readonly GenericArg[]): boolean {
    let default_param_seen = false;
    for (const param of this.own_params) {
      const default_ = GenericParamDef.default_value(param, tcx);
      const inst = default_ === undefined ? undefined : Unnormalized.skip_norm_wip(EarlyBinder.instantiate(default_, tcx, args, fold_GenericArg));
      if (inst !== undefined) {
        if (inst === index_slice(args, param.index)) {
          default_param_seen = true;
        } else if (default_param_seen) {
          return true;
        }
      }
    }
    return false;
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

/** PORT: `&v[i]` with core's `panic_bounds_check` text. */
function index_slice<T>(v: readonly T[], i: number): T {
  if (i < 0 || i >= v.length) panic(`index out of bounds: the len is ${v.length} but the index is ${i}`);
  return v[i]!;
}

/** PORT: `&v[start..end]` with core's `slice_index_order_fail` / `slice_end_index_len_fail` texts. */
function slice_range<T>(v: readonly T[], start: number, end: number): readonly T[] {
  if (start > end) panic(`slice index starts at ${start} but ends at ${end}`);
  if (end > v.length) panic(`range end index ${end} out of range for slice of length ${v.length}`);
  return v.slice(start, end);
}

/// Bounds on generics.
// #[derive(Copy, Clone, Default, Debug, TyEncodable, TyDecodable, StableHash)]
// rustc-type: compiler/rustc_middle/src/ty/generics.rs:388 GenericClauses
export interface GenericClauses {
  readonly parent: DefId | undefined;
  readonly clauses: readonly (readonly [Clause, Span])[];
}

/** `#[derive(Debug)]` */
export const debug_GenericClauses: Debug<GenericClauses> = (v, f) =>
  debug_struct(f, "GenericClauses", [
    ["parent", debug_option(v.parent, f, debug_DefId)],
    ["clauses", debug_list(f, v.clauses.map(([c, sp]) => debug_tuple(f, "", [debug_Clause(c, f), debug_Span(sp, f)])))],
  ]);

/** PORT: the D4 descriptor of `Clause` (structural_impls.rs, lane ty-results) over predicate.ts's impl fns. */
const d_Clause: TypeFoldable<Clause> = { visit_with: visit_with_Clause, try_fold_with: try_fold_with_Clause, fold_with: fold_with_Clause };

/** PORT: `TrivialTypeTraversalImpls! { Span }` (rustc_middle ty/structural_impls.rs): a no-op traversal. */
const d_Span: TypeFoldable<Span> = {
  try_fold_with(self) {
    return Ok(self);
  },
  fold_with(self) {
    return self;
  },
  visit_with(_self, visitor) {
    return visitor.Result.output();
  },
};

/** PORT: `TypeFoldable for TraitRef` (generated) as a D4 descriptor; `PolyTraitRef`'s is `fold_Binder` of it. */
const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
const d_PolyTraitRef: TypeFoldable<PolyTraitRef> = fold_Binder(d_TraitRef);

/**
 * PORT: `InstantiatedClauses` (ty/mod.rs:790, lane ty-mod): stand-in with the upstream fields and `empty()`; root
 * repoints it at the real type when ty/mod.rs lands.
 */
export interface InstantiatedClauses {
  clauses: Unnormalized<Clause>[];
  spans: Span[];
}
/** PORT: stand-in for `InstantiatedClauses::empty` (ty/mod.rs:796): the upstream body. */
function InstantiatedClauses_empty(): InstantiatedClauses {
  return { clauses: [], spans: [] };
}

/**
 * PORT: `iter.map(|u| { let (x, span) = u.unzip(); (x, span.skip_normalization()) })` over `IterInstantiatedCopied` /
 * `IterIdentityCopied` of `(T, Span)`: lazy, double-ended, exact-size and `Clone`, as upstream's `Map`.
 */
export class MapUnzipIter<T> implements Iterable<[Unnormalized<T>, Span]> {
  constructor(public iter: IterInstantiatedCopied<[T, Span]> | IterIdentityCopied<[T, Span]>) {}

  private static f<T>(u: Unnormalized<[T, Span]>): [Unnormalized<T>, Span] {
    const [clause, span] = Unnormalized.unzip(u);
    return [clause, Unnormalized.skip_normalization(span)];
  }

  clone(): MapUnzipIter<T> {
    return new MapUnzipIter(this.iter.clone());
  }

  next(): [Unnormalized<T>, Span] | undefined {
    const u = this.iter.next();
    return u === undefined ? undefined : MapUnzipIter.f(u);
  }

  next_back(): [Unnormalized<T>, Span] | undefined {
    const u = this.iter.next_back();
    return u === undefined ? undefined : MapUnzipIter.f(u);
  }

  size_hint(): [number, number | undefined] {
    return this.iter.size_hint();
  }

  *[globalThis.Symbol.iterator](): Iterator<[Unnormalized<T>, Span]> {
    for (;;) {
      const n = this.next();
      if (n === undefined) return;
      yield n;
    }
  }
}

export const GenericClauses = {
  /** `#[derive(Default)]` */
  default_(): GenericClauses {
    return { parent: undefined, clauses: [] };
  },

  // rustc: compiler/rustc_middle/src/ty/generics.rs:394 instantiate
  instantiate(self: GenericClauses, tcx: TyCtxt, args: GenericArgsRef): InstantiatedClauses {
    const instantiated = InstantiatedClauses_empty();
    GenericClauses.instantiate_into(self, tcx, instantiated, args);
    return instantiated;
  },

  // rustc: compiler/rustc_middle/src/ty/generics.rs:404 instantiate_own
  instantiate_own(self: GenericClauses, tcx: TyCtxt, args: GenericArgsRef): MapUnzipIter<Clause> {
    return new MapUnzipIter(EarlyBinder.iter_instantiated_copied(EarlyBinder.bind_iter(self.clauses as readonly [Clause, Span][]), tcx, args, fold_tuple2(d_Clause, d_Span)));
  },

  // rustc: compiler/rustc_middle/src/ty/generics.rs:418 instantiate_own_identity
  instantiate_own_identity(self: GenericClauses): MapUnzipIter<Clause> {
    return new MapUnzipIter(EarlyBinder.iter_identity_copied(EarlyBinder.bind_iter(self.clauses as readonly [Clause, Span][])));
  },

  // #[instrument(level = "debug", skip(self, tcx))]
  // rustc: compiler/rustc_middle/src/ty/generics.rs:431 instantiate_into
  instantiate_into(self: GenericClauses, tcx: TyCtxt, instantiated: InstantiatedClauses, args: GenericArgsRef): void {
    if (self.parent !== undefined) {
      const def_id = self.parent;
      GenericClauses.instantiate_into(tcx.clauses_of(def_id) as GenericClauses, tcx, instantiated, args);
    }
    instantiated.clauses.push(...self.clauses.map(([p, _]) => EarlyBinder.instantiate(EarlyBinder.bind(tcx, p, d_Clause), tcx, args, d_Clause)));
    instantiated.spans.push(...self.clauses.map(([_, sp]) => sp));
  },

  // rustc: compiler/rustc_middle/src/ty/generics.rs:446 instantiate_identity
  instantiate_identity(self: GenericClauses, tcx: TyCtxt): InstantiatedClauses {
    const instantiated = InstantiatedClauses_empty();
    GenericClauses.instantiate_identity_into(self, tcx, instantiated);
    return instantiated;
  },

  // rustc: compiler/rustc_middle/src/ty/generics.rs:452 instantiate_identity_into
  instantiate_identity_into(self: GenericClauses, tcx: TyCtxt, instantiated: InstantiatedClauses): void {
    if (self.parent !== undefined) {
      const def_id = self.parent;
      GenericClauses.instantiate_identity_into(tcx.clauses_of(def_id) as GenericClauses, tcx, instantiated);
    }
    instantiated.clauses.push(...self.clauses.map(([p, _]) => Unnormalized.new(p)));
    instantiated.spans.push(...self.clauses.map(([_, s]) => s));
  },

  /// Allow simple where bounds like `T: Debug`, but prevent any kind of
  /// outlives bounds or uses of generic parameters on the right hand side.
  ///
  /// We allow simple bounds because when the `T` actually gets substituted with a concrete type
  /// during monomorphization, we will be checking its `Debug` impl for fully_generic_for_reflection.
  ///
  /// Constants (associated or generic) are irrelevant for this analysis, as their value is neither
  /// affected by lifetimes, nor do they affect lifetimes.
  // rustc: compiler/rustc_middle/src/ty/generics.rs:472 is_fully_generic_for_reflection
  is_fully_generic_for_reflection(self: GenericClauses): boolean {
    // Pessimistic: if any of the parameters have where bounds
    // don't allow this impl to be used.
    return self.clauses.every(([clause, _]) => {
      const k: ClauseKind = Binder.skip_binder(clause.kind());
      switch (k.$) {
        case "Trait": {
          const trait_predicate = k._0;
          // In a `T: Trait`, if the rhs bound does not contain any generic params
          // or 'static lifetimes, then it cannot transitively cause such requirements,
          // considering we apply the fully-generic-for-reflection rules to any impls for
          // that trait, too.
          if (
            TraitClause.self_ty(trait_predicate).kind().$ === "Param" &&
            slice_from(trait_predicate.trait_ref.args, 1).every((arg) => fold_GenericArg.visit_with(arg, new ParamChecker()).$ === "Continue")
          ) {
            return true;
          }
          break;
        }
        case "RegionOutlives":
        case "TypeOutlives":
        case "Projection":
        case "ConstArgHasType":
        case "WellFormed":
        case "ConstEvaluatable":
        case "HostEffect":
        case "UnstableFeature":
          break;
      }
      return visit_with_Clause(clause, new ParamChecker()).$ === "Continue";
    });
  },
};

/** `struct ParamChecker;` (local to `GenericClauses::is_fully_generic_for_reflection`, generics.rs:473). */
class ParamChecker implements TypeVisitor<ControlFlow<null>> {
  readonly Result: VisitorResult<ControlFlow<null>, unknown> = VisitorResultC.ControlFlow<null>();

  // rustc: compiler/rustc_middle/src/ty/generics.rs:476 visit_region
  visit_region(r: Region): ControlFlow<null> {
    const k = r.kind();
    switch (k.$) {
      case "ReEarlyParam":
      case "ReStatic":
      case "ReError":
        return ControlFlow.Break(null);
      case "ReVar":
      case "RePlaceholder":
      case "ReErased":
      case "ReLateParam":
        return bug(`unexpected lifetime in impl: ${debug_Region(r, PLAIN)}`);
      case "ReBound":
        return ControlFlow.CONTINUE;
    }
  }

  // rustc: compiler/rustc_middle/src/ty/generics.rs:491 visit_ty
  visit_ty(t: Ty): ControlFlow<null> {
    switch (t.kind().$) {
      case "Param":
        // Reject using parameters used in the type in where bounds
        return ControlFlow.Break(null);
      case "Alias":
        return ControlFlow.Break(null);
      default:
        break;
    }
    return standin_fold_Ty.super_visit_with(t, this);
  }

  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<null> {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  visit_const(c: Const): ControlFlow<null> {
    return TypeVisitor_provided.visit_const(this, c);
  }

  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<null> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  visit_clauses(c: Clauses): ControlFlow<null> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  visit_error(guar: ErrorGuaranteed): ControlFlow<null> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

/// `[const]` bounds for a given item. This is represented using a struct much like
/// `GenericClauses`, where you can either choose to only instantiate the "own"
/// bounds or all of the bounds including those from the parent. This distinction
/// is necessary for code like `compare_method_clause_entailment`.
// #[derive(Copy, Clone, Default, Debug, TyEncodable, TyDecodable, StableHash)]
// rustc-type: compiler/rustc_middle/src/ty/generics.rs:540 ConstConditions
export interface ConstConditions {
  readonly parent: DefId | undefined;
  readonly clauses: readonly (readonly [PolyTraitRef, Span])[];
}

/** `#[derive(Debug)]`. PORT: `PolyTraitRef`'s Debug is `Binder`'s over `TraitRef`'s (ir_print), loaded lazily. */
export const debug_ConstConditions: Debug<ConstConditions> = (v, f) =>
  debug_struct(f, "ConstConditions", [
    ["parent", debug_option(v.parent, f, debug_DefId)],
    ["clauses", debug_list(f, v.clauses.map(([c, sp]) => debug_tuple(f, "", [debug_PolyTraitRef(c, f), debug_Span(sp, f)])))],
  ]);

function debug_PolyTraitRef(v: PolyTraitRef, f: Fmt): string {
  const binder = require("../../rustc_type_ir/binder.gen.ts") as typeof import("../../rustc_type_ir/binder.gen.ts");
  const ir_print = require("../../rustc_type_ir/ir_print.ts") as typeof import("../../rustc_type_ir/ir_print.ts");
  return binder.debug_Binder(v, f, ir_print.debug_TraitRef);
}

export const ConstConditions = {
  /** `#[derive(Default)]` */
  default_(): ConstConditions {
    return { parent: undefined, clauses: [] };
  },

  // rustc: compiler/rustc_middle/src/ty/generics.rs:546 instantiate
  instantiate(self: ConstConditions, tcx: TyCtxt, args: GenericArgsRef): [Unnormalized<PolyTraitRef>, Span][] {
    const instantiated: [Unnormalized<PolyTraitRef>, Span][] = [];
    ConstConditions.instantiate_into(self, tcx, instantiated, args);
    return instantiated;
  },

  // rustc: compiler/rustc_middle/src/ty/generics.rs:556 instantiate_own
  instantiate_own(self: ConstConditions, tcx: TyCtxt, args: GenericArgsRef): MapUnzipIter<PolyTraitRef> {
    return new MapUnzipIter(EarlyBinder.iter_instantiated_copied(EarlyBinder.bind_iter(self.clauses as readonly [PolyTraitRef, Span][]), tcx, args, fold_tuple2(d_PolyTraitRef, d_Span)));
  },

  // rustc: compiler/rustc_middle/src/ty/generics.rs:570 instantiate_own_identity
  instantiate_own_identity(self: ConstConditions): MapUnzipIter<PolyTraitRef> {
    return new MapUnzipIter(EarlyBinder.iter_identity_copied(EarlyBinder.bind_iter(self.clauses as readonly [PolyTraitRef, Span][])));
  },

  // #[instrument(level = "debug", skip(self, tcx))]
  // rustc: compiler/rustc_middle/src/ty/generics.rs:583 instantiate_into
  instantiate_into(self: ConstConditions, tcx: TyCtxt, instantiated: [Unnormalized<PolyTraitRef>, Span][], args: GenericArgsRef): void {
    if (self.parent !== undefined) {
      const def_id = self.parent;
      ConstConditions.instantiate_into(tcx.const_conditions(def_id) as ConstConditions, tcx, instantiated, args);
    }
    instantiated.push(...self.clauses.map(([c, s]): [Unnormalized<PolyTraitRef>, Span] => [EarlyBinder.instantiate(EarlyBinder.bind(tcx, c, d_PolyTraitRef), tcx, args, d_PolyTraitRef), s]));
  },

  // rustc: compiler/rustc_middle/src/ty/generics.rs:599 instantiate_identity
  instantiate_identity(self: ConstConditions, tcx: TyCtxt): [Unnormalized<PolyTraitRef>, Span][] {
    const instantiated: [Unnormalized<PolyTraitRef>, Span][] = [];
    ConstConditions.instantiate_identity_into(self, tcx, instantiated);
    return instantiated;
  },

  // rustc: compiler/rustc_middle/src/ty/generics.rs:608 instantiate_identity_into
  instantiate_identity_into(self: ConstConditions, tcx: TyCtxt, instantiated: [Unnormalized<PolyTraitRef>, Span][]): void {
    if (self.parent !== undefined) {
      const def_id = self.parent;
      ConstConditions.instantiate_identity_into(tcx.const_conditions(def_id) as ConstConditions, tcx, instantiated);
    }
    instantiated.push(...self.clauses.map(([trait_ref, span]): [Unnormalized<PolyTraitRef>, Span] => [Unnormalized.new(trait_ref), span]));
  },
};
