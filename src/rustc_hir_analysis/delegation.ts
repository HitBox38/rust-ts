// Port of compiler/rustc_hir_analysis/src/delegation.rs (lane hira-misc).
//! Support inheriting generic parameters and predicates for function delegation.
//!
//! For more information about delegation design, see the tracking issue #118212.
//
// PORT notes (file-wide):
// - `tcx.arena.alloc_from_iter(..)` is a plain array; `&'tcx [GenericArg]` is `readonly GenericArg[]`.
// - The query values typed `unknown` in queries.gen.ts (`generics_of`, `type_of`, `fn_sig`, `impl_trait_header`,
//   `clauses_of`, `explicit_clauses_of`, `delegation_user_specified_args`) are cast to upstream's value type at the read
//   (as rustc_middle's generics.ts and collect-b's clauses_of.ts do).
// - `fn_kind(tcx, def_id: impl Into<DefId>)` takes `DefId | LocalDefId` and converts with `into_query_key_DefId`.
// - `FxHashMap<u32, u32>` is a `Map<number, number>`; `FxHashSet<ty::ParamConst>` (a non-interned struct) is a
//   `KeyedSet` over `intern_key` (equal exactly when the derived `PartialEq` is).
// - The folders implement `TypeFolder` and forward the methods they do not override to `TypeFolder_provided`.
// - `&s[a..b]` is `slice_range` below (core's `slice_index_fail` checks and texts).
// Init order: top-level code here touches only ./decls.ts (the classes) and other crates.
import { ItemCtxt } from "./decls.ts";
import { UnsupportedDelegation_diagnostic } from "./diagnostics.gen.ts";
import * as hir from "../rustc_hir/lib.ts";
import { type DefKind, debug_DefKind, Res } from "../rustc_hir/def.ts";
import { into_MultiSpan } from "../rustc_error_messages/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { type GenericClauses, type Generics, GenericParamDefKind } from "../rustc_middle/ty/generics.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import type { Clauses } from "../rustc_middle/ty/list.ts";
import { type ImplTraitHeader, Ty } from "../rustc_middle/ty/mod.ts";
import type { Clause } from "../rustc_middle/ty/predicate.ts";
import { fold_Clause, fold_Predicate, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { ParamConst } from "../rustc_middle/ty/sty.ts";
import { into_query_key_DefId } from "../rustc_middle/query/into_query_key.ts";
import { type DefId, LocalDefId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { kw } from "../rustc_span/symbol.ts";
import { Binder, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import { PolyTraitClause } from "../rustc_type_ir/predicate.ts";
import { type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../rustc_type_ir/fold.ts";
import { Const, fold_Const, Region } from "../rustc_type_ir/sty/mod.ts";
import { type FnSig, fold_FnSig, FnSig as FnSigC } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import { KeyedSet } from "../rust_ts/keyed.ts";
import { type Debug, debug_bool, debug_option, debug_tuple, format_debug, PLAIN } from "../std/fmt.ts";
import { assert, assert_matches, panic, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";

/** PORT: `&v[start..end]` with core's `slice_index_fail` (library/core/src/slice/index.rs:39 at the pin): the start,
 *  end and order checks in that order. Bounds may be negative wrapped `usize` subtractions (no overflow checks). */
function slice_range<T>(v: readonly T[], start: number, end: number): readonly T[] {
  const usize = (n: number): string => (n < 0 ? String(2n ** 64n + BigInt(n)) : String(n));
  const len = v.length;
  if (start >= 0 && end >= 0 && start <= end && end <= len) return v.slice(start, end);
  if (start < 0 || start > len) panic(`range start index ${usize(start)} out of range for slice of length ${len}`);
  if (end < 0 || end > len) panic(`range end index ${usize(end)} out of range for slice of length ${len}`);
  return panic(`slice index starts at ${usize(start)} but ends at ${usize(end)}`);
}

const fold_PolyFnSig: TypeFoldable<Binder<FnSig>> = fold_Binder(fold_FnSig);

// type RemapTable = FxHashMap<u32, u32>;
type RemapTable = Map<number, number>;

// rustc-type: compiler/rustc_hir_analysis/src/delegation.rs:22 ParamIndexRemapper
class ParamIndexRemapper implements TypeFolder {
  constructor(
    public tcx: TyCtxt,
    public remap_table: RemapTable,
    public delegation_parent_consts: KeyedSet<ParamConst>,
  ) {}

  // rustc: compiler/rustc_hir_analysis/src/delegation.rs:29 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  /** (provided) `TypeFolder::fold_binder` */
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }

  // rustc: compiler/rustc_hir_analysis/src/delegation.rs:33 fold_ty
  fold_ty(ty: Ty): Ty {
    if (!TypeVisitableExt.has_param(ty, fold_Ty)) {
      return ty;
    }

    const k = ty.kind();
    if (k.$ === "Param") {
      const param = k._0;
      const index = this.remap_table.get(param.index);
      if (index !== undefined) {
        return Ty.new_param(this.tcx, index, param.name);
      }
    }
    return fold_Ty.super_fold_with(ty, this);
  }

  // rustc: compiler/rustc_hir_analysis/src/delegation.rs:46 fold_region
  fold_region(r: Region): Region {
    const k = r.kind();
    if (k.$ === "ReEarlyParam") {
      const param = k._0;
      const index = this.remap_table.get(param.index);
      if (index !== undefined) {
        return Region.new_early_param(this.tcx, { index, name: param.name });
      }
    }
    return r;
  }

  // rustc: compiler/rustc_hir_analysis/src/delegation.rs:58 fold_const
  fold_const(ct: Const): Const {
    const k = ct.kind();
    if (k.$ === "Param") {
      const param_ = k._0;
      const idx = this.remap_table.get(param_.index);
      if (idx !== undefined) {
        const param = ParamConst.new(idx, param_.name);
        return Const.new_param(this.tcx, param);
      }
    }
    return fold_Const.super_fold_with(ct, this);
  }

  /** (provided) `TypeFolder::fold_predicate` */
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }

  /** (provided) `TypeFolder::fold_clauses` */
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

// #[derive(Debug)]
// rustc-type: compiler/rustc_hir_analysis/src/delegation.rs:70 SelfPositionKind
type SelfPositionKind =
  | { readonly $: "AfterLifetimes"; _0: hir.DelegationSelfTyPropagationKind | undefined }
  | { readonly $: "Zero" }
  | { readonly $: "None" };
const SelfPositionKind = {
  Zero: Object.freeze({ $: "Zero" as const }),
  None: Object.freeze({ $: "None" as const }),
};
/** `#[derive(Debug)]` */
export const debug_SelfPositionKind: Debug<SelfPositionKind> = (v, f) => {
  switch (v.$) {
    case "AfterLifetimes":
      return debug_tuple(f, "AfterLifetimes", [debug_option(v._0, f, hir.debug_DelegationSelfTyPropagationKind)]);
    case "Zero":
      return "Zero";
    case "None":
      return "None";
  }
};

// rustc: compiler/rustc_hir_analysis/src/delegation.rs:76 create_self_param_position_kind
function create_self_param_position_kind(tcx: TyCtxt, def_id: LocalDefId, sig_id: DefId): SelfPositionKind {
  const [k0, k1] = fn_kinds(tcx, def_id, sig_id);
  if (k0 === "Free" && k1 === "AssocTrait") {
    const kind = tcx.hir_delegation_info(def_id).self_ty_propagation_kind;
    return { $: "AfterLifetimes", _0: kind };
  } else if (k1 === "AssocTraitImpl") {
    return unreachable();
  } else if (k1 === "AssocTrait" || k0 === "AssocTrait") {
    return SelfPositionKind.Zero;
  } else if (k0 === "AssocTraitImpl") {
    return unreachable();
  } else {
    return SelfPositionKind.None;
  }
}

// #[derive(Clone, Copy, Debug, PartialEq)]
// rustc-type: compiler/rustc_hir_analysis/src/delegation.rs:98 FnKind
type FnKind = "Free" | "AssocInherentImpl" | "AssocTrait" | "AssocTraitImpl";
/** `#[derive(Debug)]` */
export const debug_FnKind: Debug<FnKind> = (v) => v;

// rustc: compiler/rustc_hir_analysis/src/delegation.rs:105 fn_kind
function fn_kind(tcx: TyCtxt, def_id_: DefId | LocalDefId): FnKind {
  const def_id = into_query_key_DefId(def_id_);

  const dk = tcx.def_kind(def_id);
  switch (dk.$) {
    case "Fn":
      return "Free";
    case "AssocFn": {
      const pk = tcx.def_kind(tcx.parent(def_id));
      switch (pk.$) {
        case "Trait":
          return "AssocTrait";
        case "Impl": {
          const of_trait = pk.of_trait;
          // match of_trait { true => .., false => .. }
          return of_trait ? "AssocTraitImpl" : "AssocInherentImpl";
        }
        default:
          return unreachable("internal error: entered unreachable code: associated function can only be in trait or impl");
      }
    }
    default:
      return unreachable("internal error: entered unreachable code: delegation/signature can be either free or associated function");
  }
}

// rustc: compiler/rustc_hir_analysis/src/delegation.rs:122 fn_kinds
function fn_kinds(tcx: TyCtxt, def_id: LocalDefId, sig_id: DefId): [FnKind, FnKind] {
  const kinds: [FnKind, FnKind] = [fn_kind(tcx, def_id), fn_kind(tcx, sig_id)];

  // For trait impl's `sig_id` is always equal to the corresponding trait method.
  assert(!(kinds[1] === "AssocTraitImpl"), "assertion failed: !matches!(kinds, (_, FnKind::AssocTraitImpl))");

  return kinds;
}

/// Given the current context(caller and callee `FnKind`), it specifies
/// the policy of predicates and generic parameters inheritance.
// #[derive(Clone, Copy, Debug, PartialEq)]
// rustc-type: compiler/rustc_hir_analysis/src/delegation.rs:134 InheritanceKind
type InheritanceKind =
  /// Copying all predicates and parameters, including those of the parent
  /// container.
  ///
  /// Boolean value defines whether the `Self` parameter or `Self: Trait`
  /// predicate are copied. It's always equal to `false` except when
  /// delegating from a free function to a trait method.
  ///
  /// FIXME(fn_delegation): This often leads to type inference
  /// errors. Support providing generic arguments or restrict use sites.
  | { readonly $: "WithParent"; _0: boolean }
  /// The trait implementation should be compatible with the original trait.
  /// Therefore, for trait implementations only the method's own parameters
  /// and predicates are copied.
  | { readonly $: "Own" };
/** `#[derive(Debug)]` */
export const debug_InheritanceKind: Debug<InheritanceKind> = (v, f) => (v.$ === "WithParent" ? debug_tuple(f, "WithParent", [debug_bool(v._0, f)]) : "Own");

/// Maps sig generics into generic args of delegation. Delegation generics has the following pattern:
///
/// [SELF | maybe self in the beginning]
/// [PARENT | args of delegation parent]
/// [SIG PARENT LIFETIMES]
/// [SIG LIFETIMES]
/// [SELF | maybe self after lifetimes, when we reuse trait fn in free context]
/// [SIG PARENT TYPES/CONSTS]
/// [SIG TYPES/CONSTS]
// rustc: compiler/rustc_hir_analysis/src/delegation.rs:160 create_mapping
function create_mapping(tcx: TyCtxt, sig_id: DefId, def_id: LocalDefId): Map<number, number> {
  const mapping: Map<number, number> = new Map();

  const self_pos_kind = create_self_param_position_kind(tcx, def_id, sig_id);
  const is_self_at_zero = self_pos_kind.$ === "Zero";

  // Is self at zero? If so insert mapping, self in sig parent is always at 0.
  if (is_self_at_zero) {
    mapping.set(0, 0);
  }

  let args_index = 0;

  args_index += is_self_at_zero ? 1 : 0;
  args_index += get_delegation_parent_args_count_without_self(tcx, def_id, sig_id);

  const parent_kind = fn_kind(tcx, sig_id);
  const process_parent = parent_kind === "AssocTrait" || parent_kind === "AssocInherentImpl";
  const parent_generics = process_parent ? (tcx.generics_of(tcx.parent(sig_id)) as Generics) : undefined;

  // In case of delegations to inherent impls indices of generic params which are passed
  // to ADT can be random numbers not from range 0..parent_params_count, so we need to
  // use original indices in mapping:
  // impl<'a, 'b, 'c, A: 'a, const C: usize> S<'a, A, C> {
  //      fn foo_static<'d: 'd, 'e, T, const B: bool>() {}
  //      fn foo_self<'d: 'd, 'e, T, const B: bool>(self) {}
  // },
  // 'a has index 0, A index 3, C index 4. If we encounter not a generic param as generic arg,
  // then we do not need to map it (i.e. consts like `1`, `2`, `3`; `'static`, etc.).
  let parent_params: [number | undefined, boolean][];
  switch (parent_kind) {
    case "AssocInherentImpl": {
      const k = EarlyBinder.skip_binder(tcx.type_of(tcx.parent(sig_id)) as EarlyBinder<Ty>).kind();
      if (k.$ !== "Adt") {
        return unreachable("internal error: entered unreachable code: parent of inherent function in delegation can be only struct or enum");
      }
      const args = k._1;

      const opt_param_info = (arg: GenericArg): [number | undefined, boolean] => {
        const ak = GenericArg.kind(arg);
        switch (ak.$) {
          case "Lifetime": {
            const rk = ak._0.kind();
            return [rk.$ === "ReEarlyParam" ? rk._0.index : undefined, false];
          }
          case "Type": {
            const tk = ak._0.kind();
            return [tk.$ === "Param" ? tk._0.index : undefined, true];
          }
          case "Const": {
            const ck = ak._0.kind();
            return [ck.$ === "Param" ? ck._0.index : undefined, true];
          }
        }
      };

      parent_params = args.map(opt_param_info);
      break;
    }
    case "AssocTrait":
      parent_params = unwrap(parent_generics, "trait must have generics").own_params.map((p) => [p.index, GenericParamDefKind.is_ty_or_const(p.kind)]);
      break;
    default:
      parent_params = [];
      break;
  }

  let has_self: boolean;
  switch (parent_kind) {
    case "AssocTrait":
      has_self = unwrap(parent_generics, "trait must have generics").has_self;
      break;
    default:
      has_self = false;
      break;
  }

  if (process_parent) {
    for (let i = has_self ? 1 : 0; i < parent_params.length; i++) {
      const [index, is_ty_or_const] = parent_params[i]!;
      if (!is_ty_or_const) {
        if (index !== undefined) {
          mapping.set(index, args_index);
        }

        args_index += 1;
      }
    }
  }

  const child_generics = tcx.generics_of(sig_id) as Generics;
  for (const param of child_generics.own_params) {
    if (!GenericParamDefKind.is_ty_or_const(param.kind)) {
      mapping.set(param.index, args_index);
      args_index += 1;
    }
  }

  // If self after lifetimes insert mapping, relying that self is at 0 in sig parent.
  // If self ty is propagated (meaning there is no generic param `Self`), the specified
  // self ty will be inserted in args in `create_generic_args`.
  if (self_pos_kind.$ === "AfterLifetimes") {
    mapping.set(0, args_index);
    args_index += 1;
  }

  if (process_parent) {
    for (let i = has_self ? 1 : 0; i < parent_params.length; i++) {
      const [index, is_ty_or_const] = parent_params[i]!;
      if (is_ty_or_const) {
        if (index !== undefined) {
          mapping.set(index, args_index);
        }

        args_index += 1;
      }
    }
  }

  for (const param of child_generics.own_params) {
    if (GenericParamDefKind.is_ty_or_const(param.kind)) {
      mapping.set(param.index, args_index);
      args_index += 1;
    }
  }

  return mapping;
}

// rustc: compiler/rustc_hir_analysis/src/delegation.rs:291 get_delegation_parent_args_count_without_self
function get_delegation_parent_args_count_without_self(tcx: TyCtxt, def_id: LocalDefId, sig_id: DefId): number {
  const kinds = fn_kinds(tcx, def_id, sig_id);
  const [def_kind] = kinds;

  if (kinds[0] === "AssocTraitImpl" && kinds[1] === "AssocTrait") {
    return 0;
  } else if (kinds[0] === "AssocTraitImpl" || kinds[1] === "AssocTraitImpl") {
    return unreachable();
  } else if (kinds[0] === "Free") {
    return 0;
  } else {
    const delegation_parent_args_count = (tcx.generics_of(def_id) as Generics).parent_count;
    const has_self = def_kind === "AssocTrait";

    return delegation_parent_args_count - (has_self ? 1 : 0);
  }
}

// rustc: compiler/rustc_hir_analysis/src/delegation.rs:314 get_parent_and_inheritance_kind
function get_parent_and_inheritance_kind(tcx: TyCtxt, def_id: LocalDefId, sig_id: DefId): [DefId | undefined, InheritanceKind] {
  const kinds = fn_kinds(tcx, def_id, sig_id);
  const [, sig_kind] = kinds;

  if (kinds[0] === "AssocTraitImpl" && kinds[1] === "AssocTrait") {
    return [tcx.parent(LocalDefId.to_def_id(def_id)), { $: "Own" }];
  } else if (kinds[0] === "AssocTraitImpl" || kinds[1] === "AssocTraitImpl") {
    return unreachable();
  } else if (kinds[0] === "Free") {
    const copy_self_clauses = sig_kind === "AssocTrait";
    return [undefined, { $: "WithParent", _0: copy_self_clauses }];
  } else {
    return [tcx.parent(LocalDefId.to_def_id(def_id)), { $: "WithParent", _0: false }];
  }
}

// rustc: compiler/rustc_hir_analysis/src/delegation.rs:337 get_delegation_self_ty
function get_delegation_self_ty(tcx: TyCtxt, def_id: LocalDefId): Ty | undefined {
  const sig_id = unwrap(tcx.hir_opt_delegation_sig_id(def_id), "processing delegation");
  const [caller_kind, callee_kind] = fn_kinds(tcx, def_id, sig_id);

  if ((caller_kind === "AssocTraitImpl" && callee_kind === "AssocTrait") || caller_kind === "AssocInherentImpl") {
    return Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(tcx.local_parent(def_id)) as EarlyBinder<Ty>));
  } else if (caller_kind === "AssocTraitImpl" || callee_kind === "AssocTraitImpl") {
    // For trait impl's `sig_id` is always equal to the corresponding trait method.
    return unreachable();
  } else {
    const spk = create_self_param_position_kind(tcx, def_id, sig_id);
    if (spk.$ === "None") {
      return undefined;
    } else if (spk.$ === "AfterLifetimes") {
      const propagation_kind = spk._0;
      if (propagation_kind !== undefined) {
        const kind = propagation_kind;
        if (kind.$ === "SelfTy") {
          const self_ty_id = kind._0;
          const ctx = ItemCtxt.new(tcx, def_id);
          return ctx.lower_ty(hir.Node.expect_ty(tcx.hir_node(self_ty_id)));
        } else {
          const index = (tcx.generics_of(def_id) as Generics).own_counts().lifetimes;
          return Ty.new_param(tcx, index, kw.SelfUpper);
        }
      } else {
        return Ty.new_error_with_message(tcx, into_MultiSpan(tcx.def_span(def_id)), "self propagation kind must be specified for `AfterLifetimes` variant");
      }
    } else {
      return Ty.new_param(tcx, 0, kw.SelfUpper);
    }
  }
}

/// Creates generic arguments for further delegation signature and predicates instantiation.
/// Arguments can be user-specified (in this case they are in `parent_args` and `child_args`)
/// or propagated. User can specify either both `parent_args` and `child_args`, one of them or none,
/// that is why we firstly create generic arguments from generic params and then adjust them with
/// user-specified args.
///
/// The order of produced list is important, it must be of this pattern:
///
/// [SELF | maybe self in the beginning]
/// [PARENT | args of delegation parent]
/// [SIG PARENT LIFETIMES] <- `lifetimes_end_pos`
/// [SIG LIFETIMES]
/// [SELF | maybe self after lifetimes, when we reuse trait fn in free context]
/// [SIG PARENT TYPES/CONSTS]
/// [SIG TYPES/CONSTS]
// rustc: compiler/rustc_hir_analysis/src/delegation.rs:388 create_generic_args
function create_generic_args(
  tcx: TyCtxt,
  sig_id: DefId,
  def_id: LocalDefId,
  parent_args_: readonly GenericArg[],
  child_args_: readonly GenericArg[],
): [GenericArg[], readonly GenericArg[]] {
  let parent_args = parent_args_;
  let child_args = child_args_;
  const delegation_generics = tcx.generics_of(def_id) as Generics;
  const delegation_args_ = RawList.identity_for_item(tcx, LocalDefId.to_def_id(def_id));

  const real_args_count = delegation_args_.length - delegation_generics.own_synthetic_params_count();
  const synth_args = slice_range(delegation_args_, real_args_count, delegation_args_.length);

  let delegation_parent_args = slice_range(delegation_args_, delegation_generics.has_self ? 1 : 0, delegation_generics.parent_count);

  const delegation_args = slice_range(delegation_args_, delegation_generics.parent_count, delegation_args_.length);

  const kinds = fn_kinds(tcx, def_id, sig_id);
  const [, parent_kind] = kinds;
  if (kinds[0] === "AssocTraitImpl" && kinds[1] === "AssocTrait") {
    // Special case, as user specifies Trait args in trait impl header, we want to treat
    // them as parent args. We always generate a function whose generics match
    // child generics in trait.
    const parent = tcx.local_parent(def_id);

    parent_args = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity((tcx.impl_trait_header(parent) as ImplTraitHeader).trait_ref)).args;

    child_args = slice_range(delegation_args, delegation_args.length - delegation_generics.own_params.length, delegation_args.length);

    delegation_parent_args = [];
  }

  const self_ty = get_delegation_self_ty(tcx, def_id);
  const self_type = self_ty !== undefined ? GenericArg.from_Ty(self_ty) : undefined;

  if (self_type !== undefined && !(parent_args.length === 0)) {
    switch (parent_kind) {
      case "AssocInherentImpl":
        break;
      // Remove `Self` from parent args (it is always at the `0th` index) as it is
      // added manually.
      case "AssocTrait":
        parent_args = slice_range(parent_args, 1, parent_args.length);
        break;
      default:
        return unreachable("internal error: entered unreachable code: if parent args are non-empty then the parent must exist");
    }
  }

  let zero_self: GenericArg | undefined;
  let after_lifetimes_self: GenericArg | undefined;
  const spk = create_self_param_position_kind(tcx, def_id, sig_id);
  switch (spk.$) {
    case "AfterLifetimes":
      assert(self_type !== undefined, "assertion failed: self_type.is_some()");
      [zero_self, after_lifetimes_self] = [undefined, self_type];
      break;
    case "Zero":
      assert(self_type !== undefined, "assertion failed: self_type.is_some()");
      [zero_self, after_lifetimes_self] = [self_type, undefined];
      break;
    case "None":
      [zero_self, after_lifetimes_self] = [undefined, undefined];
      break;
  }

  const args: GenericArg[] = [
    ...(zero_self !== undefined ? [zero_self] : []),
    ...delegation_parent_args,
    ...parent_args.filter((a) => GenericArg.as_region(a) !== undefined),
    ...child_args.filter((a) => GenericArg.as_region(a) !== undefined),
    ...(after_lifetimes_self !== undefined ? [after_lifetimes_self] : []),
    ...parent_args.filter((a) => GenericArg.as_region(a) === undefined),
    ...child_args.filter((a) => GenericArg.as_region(a) === undefined),
    ...synth_args,
  ];

  return [args, delegation_parent_args];
}

// rustc: compiler/rustc_hir_analysis/src/delegation.rs:464 inherit_clauses_for_delegation_item
export function inherit_clauses_for_delegation_item(tcx: TyCtxt, def_id: LocalDefId, sig_id: DefId): GenericClauses {
  class ClausesCollector {
    constructor(
      public tcx: TyCtxt,
      public clauses: [Clause, Span][],
      public args: GenericArg[],
      public folder: ParamIndexRemapper,
      public filter_self_clauses: boolean,
    ) {}

    // rustc: compiler/rustc_hir_analysis/src/delegation.rs:478 with_own_clauses
    with_own_clauses(f: (def_id: DefId) => GenericClauses, def_id: DefId): ClausesCollector {
      const clauses = f(def_id);
      const args = this.args;

      for (const clause of clauses.clauses) {
        // If self ty is specified then there will be no generic param `Self`,
        // so we do not need its clauses.
        if (this.filter_self_clauses) {
          const trait_clause = clause[0].as_trait_clause();
          // Rely that `Self` has zero index.
          if (trait_clause !== undefined && Binder.skip_binder(PolyTraitClause.self_ty(trait_clause)).is_param(0)) {
            continue;
          }
        }

        // If we have a constant in parent or child args that came from delegation
        // parent:
        // ```rust
        // trait Trait<T, const B: bool> { /* .. */}
        // impl<const N: usize> S<N> {
        //     reuse Trait::<S<N>, N>::foo;
        // }
        // ```
        // Then if we inherit const clause from `Trait` then we end up with
        // two `ConstArgHasType` for `N` constant:
        // 1) ConstArgHasType(N/#0, bool) from `Trait`
        // 2) ConstArgHasType(N/#0, usize) from delegation parent
        // So in case the constant came from delegation parent we will not inherit
        // ConstArgHasType from signature.
        // The check is so complicated because we build generic args for signature
        // and clauses inheritance, for the example above it will be
        // `args = [S<N/#0>, N/#0, S<N/#0>, N/#0]`, where
        // args[0] - Self type, args[1] - delegation parent const, args[2] - first
        // arg of callee path, args[3] - second arg of callee path.
        // When processing clause ConstArgHasType(B/#2, bool)
        // from delegation signature (`Trait::foo`), we need to map `B/#2` into some
        // arg from `args`. The mapping which is built by `create_mapping` function is:
        // `{0: 0, 2: 3, 1: 2}`, so as `B/#2` has index `2` it is mapped into third
        // arg from `args` - `N/#0`. After we obtained mapped const param, we check if
        // it came from delegation parent, and if so we do not process its `ConstArgHasType`
        // clause.
        // (Issue #158675).
        const pk = Binder.skip_binder(fold_Predicate.fold_with(clause[0].as_predicate(), this.folder).kind());
        if (pk.$ === "Clause" && pk._0.$ === "ConstArgHasType") {
          const ct = pk._0._0;
          const unnorm_const = EarlyBinder.instantiate(EarlyBinder.bind(this.tcx, ct, fold_Const), this.tcx, args, fold_Const);
          const ck = Unnormalized.skip_norm_wip(unnorm_const).kind();
          if (ck.$ === "Param" && this.folder.delegation_parent_consts.has(ck._0)) {
            continue;
          }
        }

        const new_clause = fold_Clause.fold_with(clause[0], this.folder);
        this.clauses.push([Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.bind(this.tcx, new_clause, fold_Clause), this.tcx, args, fold_Clause)), clause[1]]);
      }

      return this;
    }

    // rustc: compiler/rustc_hir_analysis/src/delegation.rs:547 with_clauses
    with_clauses(f: (def_id: DefId) => GenericClauses, def_id: DefId): ClausesCollector {
      let self_ = this as ClausesCollector;
      const preds = f(def_id);
      if (preds.parent !== undefined) {
        const parent_def_id = preds.parent;
        self_ = self_.with_own_clauses(f, parent_def_id);
      }

      return self_.with_own_clauses(f, def_id);
    }
  }

  const [parent_args, child_args] = tcx.delegation_user_specified_args(def_id) as [readonly GenericArg[], readonly GenericArg[]];
  const [folder, args] = create_folder_and_args(tcx, def_id, sig_id, parent_args, child_args);
  const self_pos_kind = create_self_param_position_kind(tcx, def_id, sig_id);
  const filter_self_clauses = self_pos_kind.$ === "AfterLifetimes" && self_pos_kind._0 !== undefined && self_pos_kind._0.$ === "SelfTy";

  const collector = new ClausesCollector(tcx, [], args, folder, filter_self_clauses);
  const [parent, inh_kind] = get_parent_and_inheritance_kind(tcx, def_id, sig_id);

  // `explicit_clauses_of` is used here to avoid copying `Self: Trait` clause.
  // Note: `clauses_of` query can also add inferred outlives clauses, but that
  // is not the case here as `sig_id` is either a trait or a function.
  let clauses: [Clause, Span][];
  if (inh_kind.$ === "WithParent" && inh_kind._0 === false) {
    clauses = collector.with_clauses((def_id) => tcx.explicit_clauses_of(def_id) as GenericClauses, sig_id).clauses;
  } else if (inh_kind.$ === "WithParent" && inh_kind._0 === true) {
    clauses = collector.with_clauses((def_id) => tcx.clauses_of(def_id) as GenericClauses, sig_id).clauses;
  } else {
    clauses = collector.with_own_clauses((def_id) => tcx.clauses_of(def_id) as GenericClauses, sig_id).clauses;
  }

  return { parent, clauses };
}

// rustc: compiler/rustc_hir_analysis/src/delegation.rs:589 create_folder_and_args
function create_folder_and_args(
  tcx: TyCtxt,
  def_id: LocalDefId,
  sig_id: DefId,
  parent_args: readonly GenericArg[],
  child_args: readonly GenericArg[],
): [ParamIndexRemapper, GenericArg[]] {
  const [args, delegation_parent_args] = create_generic_args(tcx, sig_id, def_id, parent_args, child_args);

  const remap_table = create_mapping(tcx, sig_id, def_id);

  const delegation_parent_consts = new KeyedSet<ParamConst>(intern_key);
  for (const a of delegation_parent_args) {
    const c = GenericArg.as_const(a);
    if (c !== undefined) {
      const k = c.kind();
      if (k.$ === "Param") delegation_parent_consts.add(k._0);
    }
  }

  return [new ParamIndexRemapper(tcx, remap_table, delegation_parent_consts), args];
}

// rustc: compiler/rustc_hir_analysis/src/delegation.rs:613 check_constraints
function check_constraints(tcx: TyCtxt, def_id: LocalDefId, sig_id: DefId): Result<undefined, ErrorGuaranteed> {
  let ret: Result<undefined, ErrorGuaranteed> = Ok(undefined);

  const emit = (descr: string): void => {
    ret = Err(
      tcx.dcx().emit_err(
        UnsupportedDelegation_diagnostic({
          span: tcx.def_span(def_id),
          descr,
          callee_span: tcx.def_span(sig_id),
        }),
      ),
    );
  };

  if (FnSigC.c_variadic(Binder.skip_binder(EarlyBinder.skip_binder(tcx.fn_sig(sig_id) as EarlyBinder<Binder<FnSig>>)))) {
    // See issue #127443 for explanation.
    emit("delegation to C-variadic functions is not allowed");
  }

  return ret;
}

// rustc: compiler/rustc_hir_analysis/src/delegation.rs:636 inherit_sig_for_delegation_item
export function inherit_sig_for_delegation_item(tcx: TyCtxt, def_id: LocalDefId): readonly Ty[] {
  const sig_id = unwrap(tcx.hir_opt_delegation_sig_id(def_id), "Delegation must have sig_id");
  const caller_sig_ = tcx.fn_sig(sig_id) as EarlyBinder<Binder<FnSig>>;
  const r = check_constraints(tcx, def_id, sig_id);
  if (r.$ === "Err") {
    const err = r._0;
    const sig_len = FnSigC.inputs(Unnormalized.skip_binder(EarlyBinder.instantiate_identity(caller_sig_))).length + 1;
    const err_type = Ty.new_error(tcx, err);
    return Array.from({ length: sig_len }, () => err_type);
  }

  const [parent_args, child_args] = tcx.delegation_user_specified_args(def_id) as [readonly GenericArg[], readonly GenericArg[]];
  const [folder, args] = create_folder_and_args(tcx, def_id, sig_id, parent_args, child_args);
  const caller_sig = EarlyBinder.bind(tcx, fold_PolyFnSig.fold_with(EarlyBinder.skip_binder(caller_sig_), folder), fold_PolyFnSig);

  const sig_ = Unnormalized.skip_binder(EarlyBinder.instantiate(caller_sig, tcx, args, fold_PolyFnSig));
  const output = FnSigC.output(sig_);
  const sig: Ty[] = [...FnSigC.inputs(sig_), output];

  adjust_sig_in_inherent_impl_cases(tcx, sig_id, def_id, parent_args, sig);

  return sig;
}

/// We need to replace `Self` type of the signature function parent with
/// either type of parent of delegation (which is either `Self` param in case of trait)
/// and other ADT in case of inherent impl. We do the same thing when delegating to trait,
/// in this case replacement happens during signature instantiation (as we can replace `Self`
/// generic param with other type from `args` when instantiating).
// rustc: compiler/rustc_hir_analysis/src/delegation.rs:666 adjust_sig_in_inherent_impl_cases
function adjust_sig_in_inherent_impl_cases(tcx: TyCtxt, sig_id: DefId, def_id: LocalDefId, parent_args: readonly GenericArg[], sig: Ty[]): void {
  if (!tcx.is_method(sig_id)) {
    return;
  }

  const kinds = fn_kinds(tcx, def_id, sig_id);
  const [def_kind] = kinds;
  if (def_kind === "Free" || !(kinds[1] === "AssocInherentImpl")) {
    return;
  }

  const k = EarlyBinder.skip_binder(tcx.type_of(tcx.parent(sig_id)) as EarlyBinder<Ty>).kind();
  if (k.$ !== "Adt") {
    return unreachable("internal error: entered unreachable code: delegation is supported only to struct or enums");
  }
  const def = k._0;

  for (let i = 0; i < sig.length; i++) {
    const to_replace = Ty.new_adt(tcx, def, tcx.mk_args(parent_args));
    let replacement: Ty;
    // PORT: `def_kind` is already narrowed by the early return above; upstream keeps the `Free` arm.
    switch (def_kind as FnKind) {
      case "Free":
        return unreachable();

      case "AssocTrait":
        replacement = Ty.new_param(tcx, 0, kw.SelfUpper);
        break;
      default:
        replacement = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(tcx.parent(LocalDefId.to_def_id(def_id))) as EarlyBinder<Ty>));
        break;
    }

    // rustc-type: compiler/rustc_hir_analysis/src/delegation.rs:695 Replacer
    class Replacer implements TypeFolder {
      constructor(
        public tcx: TyCtxt,
        public to_replace: Ty,
        public replacement: Ty,
      ) {}

      /** (provided) `TypeFolder::fold_binder` */
      fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
        return TypeFolder_provided.fold_binder(this, t, d);
      }

      // rustc: compiler/rustc_hir_analysis/src/delegation.rs:702 fold_ty
      fold_ty(t: Ty): Ty {
        return t === this.to_replace ? this.replacement : fold_Ty.super_fold_with(t, this);
      }

      /** (provided) `TypeFolder::fold_region` */
      fold_region(r: Region): Region {
        return TypeFolder_provided.fold_region(this, r);
      }

      /** (provided) `TypeFolder::fold_const` */
      fold_const(c: Const): Const {
        return TypeFolder_provided.fold_const(this, c);
      }

      /** (provided) `TypeFolder::fold_predicate` */
      fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
        return TypeFolder_provided.fold_predicate(this, p, d);
      }

      /** (provided) `TypeFolder::fold_clauses` */
      fold_clauses(c: Clauses): Clauses {
        return TypeFolder_provided.fold_clauses(this, c);
      }

      // rustc: compiler/rustc_hir_analysis/src/delegation.rs:706 cx
      cx(): TyCtxt {
        return this.tcx;
      }
    }

    sig[i] = fold_Ty.fold_with(sig[i]!, new Replacer(tcx, to_replace, replacement));
  }
}

// Creates user-specified generic arguments from delegation path,
// they will be used during delegation signature and predicates inheritance.
// Example: reuse Trait::<'static, i32, 1>::foo::<A, B>
// we want to extract [Self, 'static, i32, 1] for parent and [A, B] for child.
// rustc: compiler/rustc_hir_analysis/src/delegation.rs:719 delegation_user_specified_args
export function delegation_user_specified_args(tcx: TyCtxt, def_id: LocalDefId): [readonly GenericArg[], readonly GenericArg[]] {
  const info = tcx.hir_delegation_info(def_id);

  const get_segment = (hir_id: hir.HirId): [hir.PathSegment, DefId] | undefined => {
    const segment = hir.Node.expect_path_segment(tcx.hir_node(hir_id));
    const def_id = Res.opt_def_id(segment.res);
    return def_id !== undefined ? [segment, def_id] : undefined;
  };

  const ctx = ItemCtxt.new_for_delegation(tcx, def_id);
  const lowerer = ctx.lowerer();

  let parent_args: readonly GenericArg[] | undefined = undefined;
  {
    const seg = info.parent_seg_id_for_sig !== undefined ? get_segment(info.parent_seg_id_for_sig) : undefined;
    if (seg !== undefined && !(tcx.def_kind(seg[1]).$ === "Mod")) {
      const [segment, def_id] = seg;
      // After lowering parent segment can be resolved only to those variants (and `DefKind::Mod`),
      // which we do not process here.
      const dk = tcx.def_kind(def_id);
      assert_matches(dk, dk.$ === "Trait" || dk.$ === "Struct" || dk.$ === "Enum", "DefKind::Trait | DefKind::Struct | DefKind::Enum", (v: DefKind) => format_debug(v, debug_DefKind, PLAIN));

      const self_ty = tcx.def_kind(def_id).$ === "Trait" ? Ty.new_param(tcx, 0, kw.SelfUpper) : undefined;

      parent_args = lowerer.lower_generic_args_of_path(segment.ident.span, def_id, [], segment, self_ty)[0];
    }
  }

  let child_args: readonly GenericArg[] | undefined = undefined;
  {
    const seg = info.child_seg_id_for_sig !== undefined ? get_segment(info.child_seg_id_for_sig) : undefined;
    if (seg !== undefined) {
      const [segment, def_id] = seg;
      const dk = tcx.def_kind(def_id);
      assert_matches(dk, dk.$ === "Fn" || dk.$ === "AssocFn", "DefKind::Fn | DefKind::AssocFn", (v: DefKind) => format_debug(v, debug_DefKind, PLAIN));
      const parent = tcx.parent(def_id);

      const pk = tcx.def_kind(parent);
      let parent_args_: readonly GenericArg[];
      if ((pk.$ === "Impl" && pk.of_trait === false) || pk.$ === "Trait") {
        parent_args_ = RawList.identity_for_item(tcx, parent);
      } else if (parent_args !== undefined) {
        parent_args_ = parent_args;
      } else {
        parent_args_ = [];
      }

      const args = lowerer.lower_generic_args_of_path(segment.ident.span, def_id, parent_args_, segment, undefined)[0];

      const synth_params_count = (tcx.generics_of(def_id) as Generics).own_synthetic_params_count();
      child_args = slice_range(args, parent_args_.length, args.length - synth_params_count);
    }
  }

  return [parent_args ?? [], child_args ?? []];
}
