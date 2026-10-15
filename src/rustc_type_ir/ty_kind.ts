// Port of compiler/rustc_type_ir/src/ty_kind.rs (lane tyir-kind). The types with their derived Debug / TypeVisitable /
// TypeFoldable impls are generated into ty_kind.gen.ts (set rustc_ty of tools/codegen/types.ts, lane codegen-tyir); this
// file holds the inherent methods, the manual trait impls and the helper fns, in upstream order.
//
// PORT (D3): `I: Interner` is erased; `interner: I` is `TyCtxt` where the body needs rustc_middle's inherent API
// (`Ty::new_*`) and `Interner` where it only calls trait methods. Methods of the generated enums live on their companion
// const (`TyKind.fn_sig(kind, tcx)`, PORTING §8); methods of the generated structs (`FnSigKind`, `FnSig`, `FnHeader`,
// `FnSigTys`, `UnsafeBinderInner`) and of the `Alias<K>` instances (`AliasTy`, `ProjectionAliasTy`, ...) live on a
// same-named companion const taking `self` first. The impls on `Binder<FnSig>` / `Binder<FnSigTys>` are the companions
// `PolyFnSig` / `PolyFnSigTys` (rustc_middle's names for these binders).
// PORT: `I::Safety` is `hir::Safety` (rustc_type_ir/interner.ts header); `I::Safety::safe()` / `unsafe_mode()` are
// `hir::Safety::Safe` / `Unsafe` (`impl inherent::Safety for hir::Safety`, rustc_middle ty/context.rs:91).
// PORT: `write!(f, "{:?}", x)` formats `x` with fresh options (no `{:#?}`), so those operands use `PLAIN`;
// `f.debug_tuple(..)` / `f.write_str` keep `f`.
import { debug_ExternAbi, ExternAbi } from "../rustc_abi/extern_abi.ts";
import { debug_FloatTy, debug_IntTy, debug_UintTy, Mutability } from "../rustc_ast_ir/lib.ts";
import { Safety } from "../rustc_hir/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { debug_GenericArg, debug_GenericArgs, fold_GenericArgs, GenericArg, type GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { debug_RawList, type List, RawList } from "../rustc_middle/ty/list.ts";
import { debug_Ty, type FnInputTys, Ty } from "../rustc_middle/ty/mod.ts";
import { debug_ParamTy } from "../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { debug_DefId } from "../rustc_span/def_id.ts";
import { type Debug, debug_str, debug_tuple, type Fmt, PLAIN } from "../std/fmt.ts";
import { assert, panic, unported, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { NoError, type UnifyKey, UnifyKey_provided, type UnifyValue } from "../vendor/ena/unify/mod.ts";
import { Binder, debug_Binder, debug_BoundTy, debug_Placeholder, EarlyBinder, fold_Binder } from "./binder.ts";
import type { Interner } from "./interner.ts";
import { debug_bound_var } from "./lib.ts";
import { debug_ExistentialPredicate, type ExistentialPredicate, type TraitRef } from "./predicate.ts";
import { debug_Const } from "./sty/consts.ts";
import { debug_Region } from "./sty/mod.ts";
import { type AliasTy as AliasTyT, debug_Alias, type FreeAliasTy as FreeAliasTyT, type InherentAliasTy as InherentAliasTyT, type OpaqueAliasTy as OpaqueAliasTyT, type ProjectionAliasTy as ProjectionAliasTyT } from "./ty/alias.ts";
import * as gen from "./ty_kind.gen.ts";
import type { FloatVid, InferTy, IntVid, SplattedArgIndexError } from "./ty_kind.gen.ts";
import type { TypeFoldable } from "./fold.ts";
import { debug_AliasTyKind, debug_FloatVid, debug_IntVid, debug_IsRigid, debug_TyVid, FloatVid as FloatVidC, IntVid as IntVidC } from "./ty_kind.gen.ts";
import { Unnormalized } from "./unnormalized.ts";
import { debug_AdtDef } from "../rustc_middle/ty/structural_impls.ts";

export * from "./ty_kind.gen.ts";

// ---- AliasTyKind ---------------------------------------------------------------------------------------------------

export type AliasTyKind = gen.AliasTyKind;
export const AliasTyKind = {
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:70 descr
  descr(self: AliasTyKind): string {
    switch (self.$) {
      case "Projection":
        return "associated type";
      case "Inherent":
        return "inherent associated type";
      case "Opaque":
        return "opaque type";
      case "Free":
        return "type alias";
    }
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:79 try_to_projection
  try_to_projection(self: AliasTyKind): DefId | undefined {
    switch (self.$) {
      case "Projection":
        return self.def_id;
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:86 try_to_inherent
  try_to_inherent(self: AliasTyKind): DefId | undefined {
    switch (self.$) {
      case "Inherent":
        return self.def_id;
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:93 try_to_opaque
  try_to_opaque(self: AliasTyKind): DefId | undefined {
    switch (self.$) {
      case "Opaque":
        return self.def_id;
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:100 try_to_free
  try_to_free(self: AliasTyKind): DefId | undefined {
    switch (self.$) {
      case "Free":
        return self.def_id;
      default:
        return undefined;
    }
  },
};

// ---- IsRigid -------------------------------------------------------------------------------------------------------

export type IsRigid = gen.IsRigid;
export const IsRigid = {
  ...gen.IsRigid,

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:141 yes_if_next_solver
  yes_if_next_solver(interner: Interner): IsRigid {
    if (interner.next_trait_solver_globally()) {
      return "Yes";
    } else {
      return "No";
    }
  },
};

// ---- TyKind --------------------------------------------------------------------------------------------------------

export type TyKind = gen.TyKind;
export const TyKind = {
  ...gen.TyKind,

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:364 fn_sig
  fn_sig(self: TyKind, interner: TyCtxt): Binder<FnSig> {
    return Unnormalized.skip_normalization(TyKind.unnormalized_fn_sig(self, interner));
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:368 unnormalized_fn_sig
  unnormalized_fn_sig(self: TyKind, interner: TyCtxt): Unnormalized<Binder<FnSig>> {
    switch (self.$) {
      case "FnPtr":
        return Unnormalized.new_wip(PolyFnSigTys.with(self._0, self._1));
      case "FnDef": {
        const def_id = self._0;
        const args = self._1;
        // PORT: queries.gen.ts types the `fn_sig` query's value `unknown` until its type is generated; it is
        // `EarlyBinder<Binder<FnSig>>` (`Interner::fn_sig`).
        return EarlyBinder.instantiate(interner.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>, interner, unwrap(Binder.no_bound_vars(args, fold_GenericArgs)), fold_Binder(fold_FnSig));
      }
      case "Error": {
        // ignore errors (#54954)
        return Unnormalized.dummy(Binder.dummy(FnSig.dummy(), fold_FnSig));
      }
      case "Closure":
        return panic("to get the signature of a closure, use `args.as_closure().sig()` not `fn_sig()`");
      default:
        return panic(`Ty::fn_sig() called on non-fn type: ${debug_TyKind(self, PLAIN)}`);
    }
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:392 is_known_rigid
  is_known_rigid(self: TyKind): boolean {
    switch (self.$) {
      case "Bool":
      case "Char":
      case "Int":
      case "Uint":
      case "Float":
      case "Adt":
      case "Foreign":
      case "Str":
      case "Array":
      case "Pat":
      case "Slice":
      case "RawPtr":
      case "Ref":
      case "FnDef":
      case "FnPtr":
      case "UnsafeBinder":
      case "Dynamic":
      case "Closure":
      case "CoroutineClosure":
      case "Coroutine":
      case "CoroutineWitness":
      case "Never":
      case "Tuple":
        return true;

      case "Error":
      case "Infer":
      case "Alias":
      case "Param":
      case "Bound":
      case "Placeholder":
        return false;
    }
  },
};

// This is manually implemented because a derive would require `I: Debug`
// rustc: compiler/rustc_type_ir/src/ty_kind.rs:430 fmt
export const debug_TyKind: Debug<TyKind> = (self, f) => {
  switch (self.$) {
    case "Bool":
      return "bool";
    case "Char":
      return "char";
    case "Int":
      return debug_IntTy(self._0, PLAIN);
    case "Uint":
      return debug_UintTy(self._0, PLAIN);
    case "Float":
      return debug_FloatTy(self._0, PLAIN);
    case "Adt": {
      // write!(f, "{d:?}")?;
      let out = debug_AdtDef(self._0, PLAIN);
      const s = self._1[Symbol.iterator]();
      const first = s.next();
      if (!first.done) {
        out += `<${debug_GenericArg(first.value, PLAIN)}`;
      } else {
        return out;
      }

      for (let arg = s.next(); !arg.done; arg = s.next()) {
        out += `, ${debug_GenericArg(arg.value, PLAIN)}`;
      }

      return out + ">";
    }
    case "Foreign":
      return debug_tuple(f, "Foreign", [debug_DefId(self._0, f)]);
    case "Str":
      return "str";
    case "Array":
      return `[${debug_Ty(self._0, PLAIN)}; ${debug_Const(self._1, PLAIN)}]`;
    case "Pat":
      // write!(f, "pattern_type!({t:?} is {p:?})")
      // PORT: `impl Debug for Pattern` (rustc_middle ty/pattern.rs) is not ported yet.
      return unported("rustc_type_ir::ty_kind::TyKind Debug (Pat: Debug for rustc_middle::ty::Pattern)");
    case "Slice":
      return `[${debug_Ty(self._0, PLAIN)}]`;
    case "RawPtr":
      return `*${Mutability.ptr_str(self._1)} ${debug_Ty(self._0, PLAIN)}`;
    case "Ref":
      return `&${debug_Region(self._0, PLAIN)} ${Mutability.prefix_str(self._2)}${debug_Ty(self._1, PLAIN)}`;
    case "FnDef":
      return debug_tuple(f, "FnDef", [debug_DefId(self._0, f), debug_Binder(self._1, f, debug_GenericArgs)]);
    case "FnPtr":
      return debug_Binder(PolyFnSigTys.with(self._0, self._1), PLAIN, debug_FnSig);
    // FIXME(unsafe_binder): print this like `unsafe<'a> T<'a>`.
    case "UnsafeBinder":
      return debug_UnsafeBinderInner(self._0, PLAIN);
    case "Dynamic":
      return `dyn ${debug_RawList(self._0, PLAIN, (p: Binder<ExistentialPredicate>, f: Fmt) => debug_Binder(p, f, debug_ExistentialPredicate))} + ${debug_Region(self._1, PLAIN)}`;
    case "Closure":
      return debug_tuple(f, "Closure", [debug_DefId(self._0, f), debug_GenericArgs(self._1, f)]);
    case "CoroutineClosure":
      return debug_tuple(f, "CoroutineClosure", [debug_DefId(self._0, f), debug_GenericArgs(self._1, f)]);
    case "Coroutine":
      return debug_tuple(f, "Coroutine", [debug_DefId(self._0, f), debug_GenericArgs(self._1, f)]);
    case "CoroutineWitness":
      return debug_tuple(f, "CoroutineWitness", [debug_DefId(self._0, f), debug_GenericArgs(self._1, f)]);
    case "Never":
      return "!";
    case "Tuple": {
      let out = "(";
      let count = 0;
      for (const ty of self._0) {
        if (count > 0) {
          out += ", ";
        }
        out += debug_Ty(ty, PLAIN);
        count += 1;
      }
      // unary tuples need a trailing comma
      if (count === 1) {
        out += ",";
      }
      return out + ")";
    }
    case "Alias":
      return debug_tuple(f, "Alias", [debug_IsRigid(self._0, f), debug_Alias(self._1, f, debug_AliasTyKind)]);
    case "Param":
      return debug_ParamTy(self._0, PLAIN);
    case "Bound":
      return debug_bound_var(self._0, self._1, debug_BoundTy);
    case "Placeholder":
      return debug_Placeholder(self._0, PLAIN, debug_BoundTy);
    case "Infer":
      return debug_InferTy(self._0, PLAIN);
    case "Error":
      return "{type error}";
  }
};

// ---- AliasTy -------------------------------------------------------------------------------------------------------

/**
 * `{:?}` of `AliasTy` (`Alias<I, AliasTyKind>`): the derived Debug of `Alias` (alias.rs:15) over `AliasTyKind`'s.
 * PORT: the hand alias the codegen type map names for `rustc_middle::ty::AliasTy` (middle_traits_thir.typemap.json;
 * lane typeck-gaps), as ty/alias.ts's `debug_AliasTerm`.
 */
export function debug_AliasTy(v: AliasTyT, f: Fmt): string {
  return debug_Alias(v, f, debug_AliasTyKind);
}

export const AliasTy = {
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:496 new_from_args
  new_from_args(_interner: TyCtxt, kind: AliasTyKind, args: GenericArgs): AliasTyT {
    // PORT: `if cfg!(debug_assertions) { interner.debug_assert_alias_term_args_compatible(kind.into(), args); }`:
    // the oracle is a release build without debug assertions.
    return { kind, args, _use_alias_new_instead: null };
  },

  // PORT: `args: impl IntoIterator<Item: Into<I::GenericArg>>` is `Iterable<GenericArg>` (packing is the identity).
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:503 new
  new(interner: TyCtxt, kind: AliasTyKind, args: Iterable<GenericArg>): AliasTyT {
    const args_ = interner.mk_args_from_iter(args);
    return AliasTy.new_from_args(interner, kind, args_);
  },

  /// Whether this alias type is an opaque.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:513 is_opaque
  is_opaque(self: AliasTyT): boolean {
    return self.kind.$ === "Opaque";
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:517 to_ty
  to_ty(self: AliasTyT, interner: TyCtxt, is_rigid: IsRigid): Ty {
    return Ty.new_alias(interner, is_rigid, self);
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:521 try_to_projection
  try_to_projection(self: AliasTyT): ProjectionAliasTyT | undefined {
    const kind = AliasTyKind.try_to_projection(self.kind);
    return kind === undefined ? undefined : { kind, args: self.args, _use_alias_new_instead: null };
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:529 try_to_inherent
  try_to_inherent(self: AliasTyT): InherentAliasTyT | undefined {
    const kind = AliasTyKind.try_to_inherent(self.kind);
    return kind === undefined ? undefined : { kind, args: self.args, _use_alias_new_instead: null };
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:537 try_to_opaque
  try_to_opaque(self: AliasTyT): OpaqueAliasTyT | undefined {
    const kind = AliasTyKind.try_to_opaque(self.kind);
    return kind === undefined ? undefined : { kind, args: self.args, _use_alias_new_instead: null };
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:545 try_to_free
  try_to_free(self: AliasTyT): FreeAliasTyT | undefined {
    const kind = AliasTyKind.try_to_free(self.kind);
    return kind === undefined ? undefined : { kind, args: self.args, _use_alias_new_instead: null };
  },

  // ---- The following methods work only with (trait) associated type projections. ----
  // FIXME: Migrate these to the impl on ProjectionAliasTy (by making callers use `try_to_projection`
  // or similar when they guard for projections)

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:586 self_ty
  self_ty(self: AliasTyT): Ty {
    return self.args.type_at(0);
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:590 with_replaced_self_ty
  with_replaced_self_ty(self: AliasTyT, interner: TyCtxt, self_ty: Ty): AliasTyT {
    return AliasTy.new(interner, self.kind, [GenericArg.from_Ty(self_ty), ...self.args.slice(1)]);
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:598 trait_def_id
  trait_def_id(self: AliasTyT, interner: Interner): DefId {
    if (self.kind.$ !== "Projection") return panic("expected a projection");
    const def_id = self.kind.def_id;

    return interner.projection_parent(def_id);
  },

  /// Extracts the underlying trait reference and own args from this projection.
  ///
  /// For example, if this is a projection of `<T as StreamingIterator>::Item<'a>`,
  /// then this function would return a `T: StreamingIterator` trait reference and
  /// `['a]` as the own args.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:609 trait_ref_and_own_args
  trait_ref_and_own_args(self: AliasTyT, interner: Interner): [TraitRef, readonly GenericArg[]] {
    if (self.kind.$ !== "Projection") return panic("expected a projection");
    const def_id = self.kind.def_id;

    return interner.trait_ref_and_own_args_for_alias(def_id, self.args);
  },

  /// Extracts the underlying trait reference from this projection.
  ///
  /// For example, if this is a projection of `<T as Iterator>::Item`,
  /// then this function would return a `T: Iterator` trait reference.
  ///
  /// WARNING: This will drop the args for generic associated types
  /// consider calling [Self::trait_ref_and_own_args] to get those
  /// as well.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:623 trait_ref
  trait_ref(self: AliasTyT, interner: Interner): TraitRef {
    return AliasTy.trait_ref_and_own_args(self, interner)[0];
  },
};

export const ProjectionAliasTy = {
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:555 new_projection_from_args
  new_projection_from_args(interner: Interner, kind: DefId, args: GenericArgs): ProjectionAliasTyT {
    interner.debug_assert_alias_term_args_compatible({ $: "ProjectionTy", def_id: kind }, args);
    return { kind, args, _use_alias_new_instead: null };
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:567 projection_to_alias_ty
  projection_to_alias_ty(self: ProjectionAliasTyT): AliasTyT {
    return { kind: { $: "Projection", def_id: self.kind }, args: self.args, _use_alias_new_instead: null };
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:576 projection_self_ty
  projection_self_ty(self: ProjectionAliasTyT): Ty {
    return self.args.type_at(0);
  },
};

export const InherentAliasTy = {
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:629 new_inherent_from_args
  new_inherent_from_args(interner: Interner, kind: DefId, args: GenericArgs): InherentAliasTyT {
    interner.debug_assert_alias_term_args_compatible({ $: "InherentTy", def_id: kind }, args);
    return { kind, args, _use_alias_new_instead: null };
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:641 inherent_to_alias_ty
  inherent_to_alias_ty(self: InherentAliasTyT): AliasTyT {
    return { kind: { $: "Inherent", def_id: self.kind }, args: self.args, _use_alias_new_instead: null };
  },
};

export const OpaqueAliasTy = {
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:651 new_opaque_from_args
  new_opaque_from_args(interner: Interner, kind: DefId, args: GenericArgs): OpaqueAliasTyT {
    interner.debug_assert_alias_term_args_compatible({ $: "OpaqueTy", def_id: kind }, args);
    return { kind, args, _use_alias_new_instead: null };
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:659 opaque_to_alias_ty
  opaque_to_alias_ty(self: OpaqueAliasTyT): AliasTyT {
    return { kind: { $: "Opaque", def_id: self.kind }, args: self.args, _use_alias_new_instead: null };
  },
};

export const FreeAliasTy = {
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:669 new_free_from_args
  new_free_from_args(interner: Interner, kind: DefId, args: GenericArgs): FreeAliasTyT {
    interner.debug_assert_alias_term_args_compatible({ $: "FreeTy", def_id: kind }, args);
    return { kind, args, _use_alias_new_instead: null };
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:677 free_to_alias_ty
  free_to_alias_ty(self: FreeAliasTyT): AliasTyT {
    return { kind: { $: "Free", def_id: self.kind }, args: self.args, _use_alias_new_instead: null };
  },
};

// ---- IntVarValue / FloatVarValue -------------------------------------------------------------------------------------

export type IntVarValue = gen.IntVarValue;
export const IntVarValue = {
  ...gen.IntVarValue,

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:694 is_known
  is_known(self: IntVarValue): boolean {
    switch (self.$) {
      case "IntType":
      case "UintType":
        return true;
      case "Unknown":
        return false;
    }
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:701 is_unknown
  is_unknown(self: IntVarValue): boolean {
    return !IntVarValue.is_known(self);
  },
};

export type FloatVarValue = gen.FloatVarValue;
export const FloatVarValue = {
  ...gen.FloatVarValue,

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:713 is_known
  is_known(self: FloatVarValue): boolean {
    switch (self.$) {
      case "Known":
        return true;
      case "Unknown":
        return false;
    }
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:720 is_unknown
  is_unknown(self: FloatVarValue): boolean {
    return !FloatVarValue.is_known(self);
  },
};

// ---- ena impls -----------------------------------------------------------------------------------------------------

/** `impl UnifyValue for IntVarValue` (`type Error = NoError`). */
export const UnifyValue_IntVarValue: UnifyValue<IntVarValue, NoError> = {
  clone: (v) => v,

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:793 unify_values
  unify_values(value1: IntVarValue, value2: IntVarValue): Result<IntVarValue, NoError> {
    if (value1.$ === "Unknown" && value2.$ === "Unknown") {
      return Ok(IntVarValue.Unknown);
    } else if (value1.$ === "Unknown" && (value2.$ === "UintType" || value2.$ === "IntType")) {
      const known = value2;
      return Ok(known);
    } else if ((value1.$ === "UintType" || value1.$ === "IntType") && value2.$ === "Unknown") {
      const known = value1;
      return Ok(known);
    } else {
      return panic("differing ints should have been resolved first");
    }
  },
};

/** `impl UnifyKey for IntVid` (`type Value = IntVarValue`). */
export const UnifyKey_IntVid: UnifyKey<IntVid, IntVarValue, NoError> = {
  Value: UnifyValue_IntVarValue,
  eq: (a, b) => a === b,

  // make this function eligible for inlining - it is quite hot.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:812 index
  index(self: IntVid): number {
    return IntVidC.as_u32(self);
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:816 from_index
  from_index(i: number): IntVid {
    return IntVidC.from_u32(i);
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:819 tag
  tag(): string {
    return "IntVid";
  },

  order_roots: UnifyKey_provided.order_roots,
};

/** `impl UnifyValue for FloatVarValue` (`type Error = NoError`). */
export const UnifyValue_FloatVarValue: UnifyValue<FloatVarValue, NoError> = {
  clone: (v) => v,

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:827 unify_values
  unify_values(value1: FloatVarValue, value2: FloatVarValue): Result<FloatVarValue, NoError> {
    if (value1.$ === "Unknown" && value2.$ === "Unknown") {
      return Ok(FloatVarValue.Unknown);
    } else if (value1.$ === "Unknown" && value2.$ === "Known") {
      const known = value2._0;
      return Ok({ $: "Known", _0: known });
    } else if (value1.$ === "Known" && value2.$ === "Unknown") {
      const known = value1._0;
      return Ok({ $: "Known", _0: known });
    } else {
      // (FloatVarValue::Known(_), FloatVarValue::Known(_))
      return panic("differing floats should have been resolved first");
    }
  },
};

/** `impl UnifyKey for FloatVid` (`type Value = FloatVarValue`). */
export const UnifyKey_FloatVid: UnifyKey<FloatVid, FloatVarValue, NoError> = {
  Value: UnifyValue_FloatVarValue,
  eq: (a, b) => a === b,

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:844 index
  index(self: FloatVid): number {
    return FloatVidC.as_u32(self);
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:848 from_index
  from_index(i: number): FloatVid {
    return FloatVidC.from_u32(i);
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:851 tag
  tag(): string {
    return "FloatVid";
  },

  order_roots: UnifyKey_provided.order_roots,
};

// rustc-skip: compiler/rustc_type_ir/src/ty_kind.rs:858 stable_hash StableHash impl (incremental, M5)

// ---- InferTy -------------------------------------------------------------------------------------------------------

/** `impl fmt::Display for InferTy` */
// rustc: compiler/rustc_type_ir/src/ty_kind.rs:871 fmt
export function display_InferTy(self: InferTy): string {
  switch (self.$) {
    case "TyVar":
      return "_";
    case "IntVar":
      return "{integer}";
    case "FloatVar":
      return "{float}";
    case "FreshTy":
      return `FreshTy(${self._0})`;
    case "FreshIntTy":
      return `FreshIntTy(${self._0})`;
    case "FreshFloatTy":
      return `FreshFloatTy(${self._0})`;
  }
}

// rustc: compiler/rustc_type_ir/src/ty_kind.rs:885 fmt
export const debug_InferTy: Debug<InferTy> = (self, f) => {
  switch (self.$) {
    case "TyVar":
      return debug_TyVid(self._0, f);
    case "IntVar":
      return debug_IntVid(self._0, f);
    case "FloatVar":
      return debug_FloatVid(self._0, f);
    case "FreshTy":
      return `FreshTy(${self._0})`;
    case "FreshIntTy":
      return `FreshIntTy(${self._0})`;
    case "FreshFloatTy":
      return `FreshFloatTy(${self._0})`;
  }
};

// ---- FnSigKind -----------------------------------------------------------------------------------------------------

// rustc: compiler/rustc_type_ir/src/ty_kind.rs:952 fmt
export const debug_FnSigKind: Debug<FnSigKind> = (self, f) => {
  const fields: string[] = [];

  if (FnSigKind.is_safe(self)) {
    fields.push(debug_str("Safe"));
  } else {
    fields.push(debug_str("Unsafe"));
  }

  fields.push(debug_ExternAbi(FnSigKind.abi(self), f));

  if (FnSigKind.c_variadic(self)) {
    fields.push(debug_str("CVariadic"));
  }

  const index = FnSigKind.splatted(self);
  if (index !== undefined) {
    fields.push(debug_str(`Splatted(${index})`));
  }

  return debug_tuple(f, "FnSigKind", fields);
};

export type FnSigKind = gen.FnSigKind;
export const FnSigKind = {
  /// Create a new FnSigKind with the "Rust" ABI, "Unsafe" safety, and no C-style variadic or splatted arguments.
  /// To modify these flags, use the `set_*` methods, for readability.
  // PORT: `impl Default for FnSigKind` (`default` is reserved: `default_`).
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:978 default
  default_(): FnSigKind {
    return FnSigKind.set_no_splatted_args(
      FnSigKind.set_c_variadic(
        FnSigKind.set_safety(FnSigKind.set_abi({ flags: 0, splatted: 0, _marker: undefined }, ExternAbi.Rust), Safety.Unsafe),
        false,
      ),
    );
  },

  /// Mask for the `ExternAbi` variant, including the unwind flag.
  EXTERN_ABI_MASK: 0b111111,

  /// Bitflag for `Safety::Safe`. The default is `Unsafe`.
  SAFE_FLAG: 1 << 6,

  /// Bitflag for a trailing C-style variadic argument.
  C_VARIADIC_FLAG: 1 << 7,

  /// The marker index for "no splatted arguments". Higher values are also not supported, for
  /// performance reasons.
  ///
  /// Must have the same value as `FnDeclFlags::NO_SPLATTED_ARG_INDEX` and
  /// `rustc_ast::FnDecl::NO_SPLATTED_ARG_INDEX`.
  ///
  /// This is an implementation detail, which should only be used in low-level encoding.
  NO_SPLATTED_ARG_INDEX: 0xff,

  /// Create a new FnSigKind with the given ABI, safety, C-style variadic, and splatted argument
  /// index.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1008 new
  new(abi: ExternAbi, safety: Safety, c_variadic: boolean, splatted: number | undefined, args_len: number): Result<FnSigKind, SplattedArgIndexError> {
    return FnSigKind.set_splatted(
      FnSigKind.set_c_variadic(FnSigKind.set_safety(FnSigKind.set_abi(FnSigKind.default_(), abi), safety), c_variadic),
      splatted,
      args_len,
    );
  },

  /// Create a new safe FnSigKind with the `extern "Rust"` ABI, that isn't C-style variadic or splatted.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1023 dummy
  dummy(): FnSigKind {
    return FnSigKind.set_safety(FnSigKind.default_(), Safety.Safe);
  },

  /// Set the ABI, including the unwind flag.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1029 set_abi
  set_abi(self_: FnSigKind, abi: ExternAbi): FnSigKind {
    const self = { ...self_ };
    const abi_index = ExternAbi.as_packed(abi);
    assert(abi_index <= FnSigKind.EXTERN_ABI_MASK, "assertion failed: abi_index <= Self::EXTERN_ABI_MASK");

    self.flags &= ~FnSigKind.EXTERN_ABI_MASK & 0xff;
    self.flags |= abi_index;

    return self;
  },

  /// Set the safety flag, `true` is `Safe`.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1041 set_safety
  set_safety(self_: FnSigKind, safety: Safety): FnSigKind {
    const self = { ...self_ };
    if (Safety.is_safe(safety)) {
      self.flags |= FnSigKind.SAFE_FLAG;
    } else {
      self.flags &= ~FnSigKind.SAFE_FLAG & 0xff;
    }

    return self;
  },

  /// Set the C-style variadic argument flag.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1053 set_c_variadic
  set_c_variadic(self_: FnSigKind, c_variadic: boolean): FnSigKind {
    const self = { ...self_ };
    if (c_variadic) {
      self.flags |= FnSigKind.C_VARIADIC_FLAG;
    } else {
      self.flags &= ~FnSigKind.C_VARIADIC_FLAG & 0xff;
    }

    return self;
  },

  /// Set the splatted argument index.
  /// The number of function arguments is used for error checking.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1066 set_splatted
  set_splatted(self_: FnSigKind, splatted: number | undefined, args_len: number): Result<FnSigKind, SplattedArgIndexError> {
    const self = { ...self_ };
    if (splatted !== undefined) {
      const splatted_arg_index = splatted;
      if (splatted_arg_index === FnSigKind.NO_SPLATTED_ARG_INDEX) {
        // This index value is used as a marker for "no splatting", so it is unsupported.
        // Higher values are also not supported, for performance reasons.
        return Err({ $: "InvalidIndex", splatted_arg_index });
      } else if (splatted_arg_index >= args_len) {
        return Err({
          $: "OutOfBounds",
          splatted_arg_index,
          // PORT: `args_len as u16` truncates.
          args_len: args_len & 0xffff,
        });
      }

      self.splatted = splatted_arg_index;
    } else {
      self.splatted = FnSigKind.NO_SPLATTED_ARG_INDEX;
    }

    return Ok(self);
  },

  /// Set the splatted argument index to "no splatted arguments".
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1093 set_no_splatted_args
  set_no_splatted_args(self_: FnSigKind): FnSigKind {
    const self = { ...self_ };
    self.splatted = FnSigKind.NO_SPLATTED_ARG_INDEX;
    return self;
  },

  /// Get the ABI, including the unwind flag.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1099 abi
  abi(self: FnSigKind): ExternAbi {
    const abi_index = self.flags & FnSigKind.EXTERN_ABI_MASK;
    return ExternAbi.from_packed(abi_index);
  },

  /// Get the safety flag.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1105 is_safe
  is_safe(self: FnSigKind): boolean {
    return (self.flags & FnSigKind.SAFE_FLAG) !== 0;
  },

  /// Returns the safety mode.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1110 safety
  safety(self: FnSigKind): Safety {
    if (FnSigKind.is_safe(self)) {
      return Safety.Safe;
    } else {
      return Safety.Unsafe;
    }
  },

  /// Do the function arguments end with a C-style variadic argument?
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1115 c_variadic
  c_variadic(self: FnSigKind): boolean {
    return (self.flags & FnSigKind.C_VARIADIC_FLAG) !== 0;
  },

  /// Get the index of the splatted argument, if any.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1120 splatted
  splatted(self: FnSigKind): number | undefined {
    if (self.splatted === FnSigKind.NO_SPLATTED_ARG_INDEX) {
      return undefined;
    } else {
      return self.splatted;
    }
  },
};

// ---- FnSig ---------------------------------------------------------------------------------------------------------

export type FnSig = gen.FnSig;
export const FnSig = {
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1141 inputs
  inputs(self: FnSig): FnInputTys {
    return self.inputs_and_output.inputs();
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1145 output
  output(self: FnSig): Ty {
    return self.inputs_and_output.output();
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1149 is_fn_trait_compatible
  is_fn_trait_compatible(self: FnSig): boolean {
    return !FnSig.c_variadic(self) && Safety.is_safe(FnSig.safety(self)) && ExternAbi.eq(FnSig.abi(self), ExternAbi.Rust);
  },

  /// Set the safety flag.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1155 set_safety
  set_safety(self: FnSig, safety: Safety): FnSig {
    return { ...self, fn_sig_kind: FnSigKind.set_safety(self.fn_sig_kind, safety) };
  },

  /// Set the splatted argument index.
  /// The number of function arguments is used for error checking.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1162 set_splatted
  set_splatted(self: FnSig, splatted: number | undefined, args_len: number): Result<FnSig, SplattedArgIndexError> {
    const fn_sig_kind = FnSigKind.set_splatted(self.fn_sig_kind, splatted, args_len);
    if (fn_sig_kind.$ === "Err") return fn_sig_kind;
    return Ok({ ...self, fn_sig_kind: fn_sig_kind._0 });
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1170 safety
  safety(self: FnSig): Safety {
    return FnSigKind.safety(self.fn_sig_kind);
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1174 abi
  abi(self: FnSig): ExternAbi {
    return FnSigKind.abi(self.fn_sig_kind);
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1178 c_variadic
  c_variadic(self: FnSig): boolean {
    return FnSigKind.c_variadic(self.fn_sig_kind);
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1182 splatted
  splatted(self: FnSig): number | undefined {
    return FnSigKind.splatted(self.fn_sig_kind);
  },

  /// Create a new safe FnSig with no arguments or return type, using the `extern "Rust"` ABI,
  /// that isn't C-style variadic or splatted.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1188 dummy
  dummy(): FnSig {
    return { inputs_and_output: RawList.empty<Ty>(), fn_sig_kind: FnSigKind.dummy() };
  },
};

/** PORT (D4): the descriptor of `FnSig` over its derived impls (ty_kind.gen.ts `#[derive(TypeVisitable_Generic,
 *  TypeFoldable_Generic)]`), for generic code (`EarlyBinder::instantiate`, `Binder::dummy`). */
export const fold_FnSig: TypeFoldable<FnSig> = {
  visit_with: (self, visitor) => gen.visit_with_FnSig(self, visitor),
  try_fold_with: (self, folder) => gen.try_fold_with_FnSig(self, folder),
  fold_with: (self, folder) => gen.fold_with_FnSig(self, folder),
};

/** The inherent methods of `ty::Binder<I, FnSig<I>>` (rustc_middle's `PolyFnSig`). */
export const PolyFnSig = {
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1195 inputs
  inputs(self: Binder<FnSig>): Binder<FnInputTys> {
    return Binder.map_bound(self, (fn_sig) => FnSig.inputs(fn_sig));
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1201 input
  input(self: Binder<FnSig>, index: number): Binder<Ty> {
    return Binder.map_bound(self, (fn_sig) => unwrap(FnSig.inputs(fn_sig)[index]));
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1205 inputs_and_output
  inputs_and_output(self: Binder<FnSig>): Binder<List<Ty>> {
    return Binder.map_bound(self, (fn_sig) => fn_sig.inputs_and_output);
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1210 output
  output(self: Binder<FnSig>): Binder<Ty> {
    return Binder.map_bound(self, (fn_sig) => FnSig.output(fn_sig));
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1214 fn_sig_kind
  fn_sig_kind(self: Binder<FnSig>): FnSigKind {
    return Binder.skip_binder(self).fn_sig_kind;
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1218 c_variadic
  c_variadic(self: Binder<FnSig>): boolean {
    return FnSig.c_variadic(Binder.skip_binder(self));
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1222 splatted
  splatted(self: Binder<FnSig>): number | undefined {
    return FnSig.splatted(Binder.skip_binder(self));
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1226 safety
  safety(self: Binder<FnSig>): Safety {
    return FnSig.safety(Binder.skip_binder(self));
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1230 abi
  abi(self: Binder<FnSig>): ExternAbi {
    return FnSig.abi(Binder.skip_binder(self));
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1234 is_fn_trait_compatible
  is_fn_trait_compatible(self: Binder<FnSig>): boolean {
    return FnSig.is_fn_trait_compatible(Binder.skip_binder(self));
  },

  // Used to split a single value into the two fields in `TyKind::FnPtr`.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1239 split
  split(self: Binder<FnSig>): [Binder<FnSigTys>, FnHeader] {
    const hdr: FnHeader = { fn_sig_kind: PolyFnSig.fn_sig_kind(self) };
    return [Binder.map_bound(self, (sig) => ({ inputs_and_output: sig.inputs_and_output })), hdr];
  },
};

// rustc: compiler/rustc_type_ir/src/ty_kind.rs:1246 fmt
export const debug_FnSig: Debug<FnSig> = (self, _f) => {
  const sig = self;
  const fn_sig_kind = sig.fn_sig_kind;

  let out = Safety.prefix_str(FnSigKind.safety(fn_sig_kind));
  if (!ExternAbi.eq(FnSigKind.abi(fn_sig_kind), ExternAbi.Rust)) {
    out += `extern "${debug_ExternAbi(FnSigKind.abi(fn_sig_kind), PLAIN)}" `;
  }

  out += "fn(";
  const inputs = FnSig.inputs(sig);
  for (let i = 0; i < inputs.length; i++) {
    const ty = inputs[i]!;
    if (i > 0) {
      out += ", ";
    }
    if (i === FnSigKind.splatted(fn_sig_kind)) {
      out += "#[rustc_splat] ";
    }
    out += debug_Ty(ty, PLAIN);
  }
  if (FnSigKind.c_variadic(fn_sig_kind)) {
    if (inputs.length === 0) {
      out += "...";
    } else {
      out += ", ...";
    }
  }
  out += ")";

  const output = FnSig.output(sig);
  const k = output.kind();
  if (k.$ === "Tuple" && k._0.length === 0) {
    return out;
  } else {
    return out + ` -> ${debug_Ty(FnSig.output(sig), PLAIN)}`;
  }
};

// ---- UnsafeBinderInner -----------------------------------------------------------------------------------------------

export type UnsafeBinderInner = gen.UnsafeBinderInner;
export const UnsafeBinderInner = {
  // PORT: `impl From<Binder<I, I::Ty>> for UnsafeBinderInner<I>`.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1293 from
  from_Binder(value: Binder<Ty>): UnsafeBinderInner {
    return { _0: value };
  },

  // PORT: `impl From<UnsafeBinderInner<I>> for Binder<I, I::Ty>` (`binder.into()`).
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1299 from
  into_Binder(value: UnsafeBinderInner): Binder<Ty> {
    return value._0;
  },
};

// rustc: compiler/rustc_type_ir/src/ty_kind.rs:1305 fmt
export const debug_UnsafeBinderInner: Debug<UnsafeBinderInner> = (self, f) => {
  return debug_Binder(self._0, f, debug_Ty);
};

// PORT: `impl Deref for UnsafeBinderInner` (`Target = Binder<I, I::Ty>`): callers write `UnsafeBinderInner_deref(b)`.
// rustc: compiler/rustc_type_ir/src/ty_kind.rs:1313 deref
export function UnsafeBinderInner_deref(self: UnsafeBinderInner): Binder<Ty> {
  return self._0;
}

// ---- FnSigTys / FnHeader -------------------------------------------------------------------------------------------

export type FnSigTys = gen.FnSigTys;
export const FnSigTys = {
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1332 inputs
  inputs(self: FnSigTys): FnInputTys {
    return self.inputs_and_output.inputs();
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1336 output
  output(self: FnSigTys): Ty {
    return self.inputs_and_output.output();
  },
};

/** The inherent methods of `ty::Binder<I, FnSigTys<I>>` (rustc_middle's `Binder<'tcx, FnSigTys<..>>`). */
export const PolyFnSigTys = {
  // Used to combine the two fields in `TyKind::FnPtr` into a single value.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1343 with
  with(self: Binder<FnSigTys>, hdr: FnHeader): Binder<FnSig> {
    return Binder.map_bound(self, (sig_tys) => ({
      inputs_and_output: sig_tys.inputs_and_output,
      fn_sig_kind: hdr.fn_sig_kind,
    }));
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1351 inputs
  inputs(self: Binder<FnSigTys>): Binder<FnInputTys> {
    return Binder.map_bound(self, (sig_tys) => FnSigTys.inputs(sig_tys));
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1357 input
  input(self: Binder<FnSigTys>, index: number): Binder<Ty> {
    return Binder.map_bound(self, (sig_tys) => unwrap(FnSigTys.inputs(sig_tys)[index]));
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1361 inputs_and_output
  inputs_and_output(self: Binder<FnSigTys>): Binder<List<Ty>> {
    return Binder.map_bound(self, (sig_tys) => sig_tys.inputs_and_output);
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1366 output
  output(self: Binder<FnSigTys>): Binder<Ty> {
    return Binder.map_bound(self, (sig_tys) => FnSigTys.output(sig_tys));
  },
};

export type FnHeader = gen.FnHeader;
export const FnHeader = {
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1384 c_variadic
  c_variadic(self: FnHeader): boolean {
    return FnSigKind.c_variadic(self.fn_sig_kind);
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1388 safety
  safety(self: FnHeader): Safety {
    return FnSigKind.safety(self.fn_sig_kind);
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1392 abi
  abi(self: FnHeader): ExternAbi {
    return FnSigKind.abi(self.fn_sig_kind);
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1396 splatted
  splatted(self: FnHeader): number | undefined {
    return FnSigKind.splatted(self.fn_sig_kind);
  },

  /// Create a new safe FnHeader with the `extern "Rust"` ABI, that isn't C-style variadic or splatted.
  // rustc: compiler/rustc_type_ir/src/ty_kind.rs:1401 dummy
  dummy(): FnHeader {
    return { fn_sig_kind: FnSigKind.dummy() };
  },
};
