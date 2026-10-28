// Port of compiler/rustc_middle/src/ty/util.rs (lane ty-util).
//! Miscellaneous type-system utilities that are too small to deserve their own modules.
//
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes; its
// top-level code only assigns to the prototypes of the classes it imports (`TyCtxt`, `Ty`).
// PORT: `impl<'tcx> TyCtxt<'tcx>` / `impl<'tcx> Ty<'tcx>` -> methods put on `TyCtxt.prototype` / `Ty.prototype`
// (declared in ty/decls.ts under `// ty/util.rs:<line>`).
// PORT: the `#[instrument]` / `debug!` tracing calls are comments (tracing is off).
// PORT: types this file defines that ty/decls.ts still names `Pending` (`Discr`, `CheckRegions`, `NotUniqueParam`):
// the methods typed with them are cast once at the assignment (`as unknown as TyCtxt[..]`) until root re-exports
// them from here.
import { KeyedMap, KeyedSet } from "../../rust_ts/keyed.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { Integer as IntegerC, type Integer, Size } from "../../rustc_abi/lib.ts";
import { IntegerExt } from "./layout.ts";
import type { FloatTy, IntTy, Mutability, UintTy } from "../../rustc_ast_ir/lib.ts";
import { find_attr, type Attribute } from "../../rustc_attr_ir/lib.ts";
import type { ExternCrate } from "../../rustc_crate_store/cstore.ts";
import { StableHasher } from "../../rustc_data_structures/stable_hash.ts";
import { Hash128 } from "../../rustc_hashes/lib.ts";
import { DefKind, type Res } from "../../rustc_hir/def.ts";
import { Safety } from "../../rustc_hir/lib.ts";
import type { CoroutineKind } from "../../rustc_hir/hir.ts";
import { type CrateNum, type DefId, DefId_eq, DefIdSet, LocalDefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { sym } from "../../rustc_span/symbol.ts";
import { Limit, Limit_mul } from "../../rustc_structures/limit.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { AnonConstKind } from "../../rustc_type_ir/const_kind.ts";
import { type FallibleTypeFolder, type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../rustc_type_ir/fold.ts";
import { TypeFlags } from "../../rustc_type_ir/flags.ts";
import { SizedTraitKind } from "../../rustc_type_ir/solve/mod.ts";
import type { BoundRegion } from "../../rustc_type_ir/binder.gen.ts";
import type { BoundVarIndexKind } from "../../rustc_type_ir/binder.gen.ts";
import type { ClosureKind } from "../../rustc_type_ir/lib.gen.ts";
import type { ProjectionClause } from "../../rustc_type_ir/predicate.gen.ts";
import { Const, fold_Const, Region } from "../../rustc_type_ir/sty/mod.ts";
import { fold_with_AliasTermKind } from "../../rustc_type_ir/term_kind.ts";
import { fold_with_Alias } from "../../rustc_type_ir/ty/alias.gen.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt, visit_with_tuple2 } from "../../rustc_type_ir/visit.ts";
import { debug_struct, debug_tuple, debug_int, type Debug, type Fmt, PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, panic, unported, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { RecursionLimitReached_diagnostic } from "../diagnostics.ts";
import type { Providers } from "../queries.gen.ts";
import { AssocItem as AssocItemC, type AssocItem } from "./assoc.ts";
import { TyCtxt } from "./context.ts";
import { with_ } from "./context/tls.ts";
import type {
  AdtDef,
  AsyncDestructor,
  Clauses,
  Destructor,
  ObligationCause,
  PseudoCanonicalInput,
  TypingEnv,
} from "./decls.ts";
import type { AliasTermKind, Variance } from "../../rustc_type_ir/decls.ts";
import { debug_GenericArg, GenericArg, type GenericArgs, fold_with_GenericArgs } from "./generic_args.ts";
import type { GenericParamDef, Generics } from "./generics.ts";
import { RawList } from "./list.ts";
import { Asyncness, debug_Ty, HasAttrs_DefId, HasAttrs_LocalDefId, Ty, TypingEnv as TypingEnvC } from "./mod.ts";
import type { EarlyParamRegion } from "./region.ts";
import type { ParamConst, ParamTy } from "./sty.ts";
import { fold_Clauses, fold_Ty } from "./structural_impls.ts";
import { CodegenFnAttrFlags, type CodegenFnAttrs } from "../middle/codegen_fn_attrs.ts";
import { Double, Half, Quad, Single } from "../../vendor/rustc_apfloat/ieee.ts";

// rustc-type: compiler/rustc_middle/src/ty/util.rs:37 Discr
// #[derive(Copy, Clone, Debug)]
export class Discr {
  constructor(
    /// Bit representation of the discriminant (e.g., `-1i8` is `0xFF_u128`).
    // PORT: `u128` -> `bigint`.
    public val: bigint,
    public ty: Ty,
  ) {}
}
export interface Discr {
  wrap_incr(tcx: TyCtxt): Discr;
  checked_add(tcx: TyCtxt, n: bigint): [Discr, boolean];
}
export const debug_Discr: Debug<Discr> = (v, f) =>
  debug_struct(f, "Discr", [
    ["val", debug_int(v.val, f)],
    ["ty", debug_Ty(v.ty, f)],
  ]);

/// Used as an input to [`TyCtxt::uses_unique_generic_params`].
// rustc-type: compiler/rustc_middle/src/ty/util.rs:45 CheckRegions
// #[derive(Copy, Clone, Debug, PartialEq, Eq)]
export type CheckRegions =
  | "No"
  /// Only permit parameter regions. This should be used
  /// for everything apart from functions, which may use
  /// `ReBound` to represent late-bound regions.
  | "OnlyParam"
  /// Check region parameters from a function definition.
  /// Allows `ReEarlyParam` and `ReBound` to handle early
  /// and late-bound region parameters.
  | "FromFunction";
export const CheckRegions = { No: "No", OnlyParam: "OnlyParam", FromFunction: "FromFunction" } as const;
export const debug_CheckRegions: Debug<CheckRegions> = (v) => v;

// rustc-type: compiler/rustc_middle/src/ty/util.rs:58 NotUniqueParam
// #[derive(Copy, Clone, Debug)]
export type NotUniqueParam = { readonly $: "DuplicateParam"; _0: GenericArg } | { readonly $: "NotParam"; _0: GenericArg };
export const debug_NotUniqueParam: Debug<NotUniqueParam> = (v, f) => debug_tuple(f, v.$, [debug_GenericArg(v._0, f)]);

// rustc: compiler/rustc_middle/src/ty/util.rs:64 fmt
export function display_Discr(self: Discr): string {
  const k = self.ty.kind();
  switch (k.$) {
    case "Int": {
      const ity = k._0;
      const size = with_((tcx) => Integer_size(IntegerExt_from_int_ty(tcx, ity)));
      const x0 = self.val;
      // sign extend the raw representation to be an i128
      const x = Size_sign_extend(size, x0);
      return `${x}`;
    }
    default:
      return `${self.val}`;
  }
}

/// Adds `1` to the value and wraps around if the maximum for the type is reached.
// rustc: compiler/rustc_middle/src/ty/util.rs:80 wrap_incr
Discr.prototype.wrap_incr = function (this: Discr, tcx: TyCtxt): Discr {
  return this.checked_add(tcx, 1n)[0];
};

// rustc: compiler/rustc_middle/src/ty/util.rs:83 checked_add
Discr.prototype.checked_add = function (this: Discr, tcx: TyCtxt, n: bigint): [Discr, boolean] {
  const [size, signed] = this.ty.int_size_and_signed(tcx);
  let val: bigint;
  let oflo: boolean;
  if (signed) {
    const min = Size_signed_int_min(size);
    const max = Size_signed_int_max(size);
    const val0 = Size_sign_extend(size, this.val);
    assert(n < I128_MAX, "assertion failed: n < (i128::MAX as u128)");
    const n_ = n; // `n as i128`
    const oflo_ = val0 > i128_wrapping(max - n_);
    const val1 = oflo_ ? i128_wrapping(min + i128_wrapping(i128_wrapping(n_ - i128_wrapping(max - val0)) - 1n)) : i128_wrapping(val0 + n_);
    // zero the upper bits
    const val2 = BigInt.asUintN(128, val1); // `val as u128`
    const val3 = Size_truncate(size, val2);
    [val, oflo] = [val3, oflo_];
  } else {
    const max = Size_unsigned_int_max(size);
    const val0 = this.val;
    const oflo_ = val0 > u128_wrapping(max - n);
    const val1 = oflo_ ? u128_wrapping(u128_wrapping(n - u128_wrapping(max - val0)) - 1n) : u128_wrapping(val0 + n);
    [val, oflo] = [val1, oflo_];
  }
  return [new Discr(val, this.ty), oflo];
};

// rustc-trait: compiler/rustc_middle/src/ty/util.rs:108 IntTypeExt (`#[extension]` on `impl IntegerType`, :109)
// PORT: `#[extension(pub trait IntTypeExt)] impl IntegerType` -> companion functions taking `self` first.
export const IntTypeExt = {
  // rustc: compiler/rustc_middle/src/ty/util.rs:110 to_ty
  to_ty(self: IntegerType, tcx: TyCtxt): Ty {
    switch (self.$) {
      case "Pointer":
        return self._0 ? tcx.types.isize : tcx.types.usize;
      case "Fixed":
        return IntegerExt_to_ty(self._0, tcx, self._1);
    }
  },

  // rustc: compiler/rustc_middle/src/ty/util.rs:118 initial_discriminant
  initial_discriminant(self: IntegerType, tcx: TyCtxt): Discr {
    return new Discr(0n, IntTypeExt.to_ty(self, tcx));
  },

  // rustc: compiler/rustc_middle/src/ty/util.rs:122 disr_incr
  disr_incr(self: IntegerType, tcx: TyCtxt, val: Discr | undefined): Discr | undefined {
    if (val !== undefined) {
      assert_eq(IntTypeExt.to_ty(self, tcx), val.ty, (t) => debug_Ty(t, PLAIN));
      const [new_, oflo] = val.checked_add(tcx, 1n);
      return oflo ? undefined : new_;
    } else {
      return IntTypeExt.initial_discriminant(self, tcx);
    }
  },
};

// PORT (init order): the generated StableHash module reaches most of rustc_middle at load, so it is required lazily
// (the precedent of the `tyir_*` accessors in rustc_middle ty/mod.ts).
function middle_stable_hash(): typeof import("../stable_hash.gen.ts") {
  return (middle_stable_hash__m ??= require("../stable_hash.gen.ts") as typeof import("../stable_hash.gen.ts"));
}
var middle_stable_hash__m: typeof import("../stable_hash.gen.ts") | undefined;

/// Creates a hash of the type `Ty` which will be the same no matter what crate
/// context it's calculated within. This is used by the `type_id` intrinsic.
// rustc: compiler/rustc_middle/src/ty/util.rs:136 type_id_hash
TyCtxt.prototype.type_id_hash = function (this: TyCtxt, ty: Ty): Hash128 {
  // We don't have region information, so we erase all free regions. Equal types
  // must have the same `TypeId`, so we must anonymize all bound regions as well.
  const ty_ = this.erase_and_anonymize_regions(ty, fold_Ty);

  return this.with_stable_hashing_context((hcx) => {
    const hasher = StableHasher.new();
    hcx.while_hashing_spans(false, (hcx) => middle_stable_hash().stable_hash_Ty(ty_, hcx, hasher));
    return hasher.finish(Hash128);
  });
};

// rustc: compiler/rustc_middle/src/ty/util.rs:148 res_generics_def_id
TyCtxt.prototype.res_generics_def_id = function (this: TyCtxt, res: Res): DefId | undefined {
  if (res.$ === "Def") {
    const kind = res._0;
    const def_id = res._1;
    if (kind.$ === "Ctor" && kind._0 === "Variant") {
      return this.parent(this.parent(def_id));
    }
    if (kind.$ === "Variant" || (kind.$ === "Ctor" && kind._0 === "Struct")) {
      return this.parent(def_id);
    }
    // Other `DefKind`s don't have generics and would ICE when calling
    // `generics_of`.
    switch (kind.$) {
      case "Struct":
      case "Union":
      case "Enum":
      case "Trait":
      case "OpaqueTy":
      case "TyAlias":
      case "ForeignTy":
      case "TraitAlias":
      case "AssocTy":
      case "Fn":
      case "AssocFn":
      case "AssocConst":
      case "Impl":
        return def_id;
    }
  }
  if (res.$ === "Err") return undefined;
  return undefined;
};

/// Checks whether `ty: Copy` holds while ignoring region constraints.
///
/// This impacts whether values of `ty` are *moved* or *copied*
/// when referenced. This means that we may generate MIR which
/// does copies even when the type actually doesn't satisfy the
/// full requirements for the `Copy` trait (cc #29149) -- this
/// winds up being reported as an error during NLL borrow check.
///
/// This function should not be used if there is an `InferCtxt` available.
/// Use `InferCtxt::type_is_copy_modulo_regions` instead.
// rustc: compiler/rustc_middle/src/ty/util.rs:189 type_is_copy_modulo_regions
TyCtxt.prototype.type_is_copy_modulo_regions = function (this: TyCtxt, typing_env: TypingEnv, ty: Ty): boolean {
  return ty.is_trivially_pure_clone_copy() || this.is_copy_raw(typing_env.as_query_input(ty));
};

/// Checks whether `ty: UseCloned` holds while ignoring region constraints.
///
/// This function should not be used if there is an `InferCtxt` available.
/// Use `InferCtxt::type_is_copy_modulo_regions` instead.
// rustc: compiler/rustc_middle/src/ty/util.rs:201 type_is_use_cloned_modulo_regions
TyCtxt.prototype.type_is_use_cloned_modulo_regions = function (this: TyCtxt, typing_env: TypingEnv, ty: Ty): boolean {
  return ty.is_trivially_pure_clone_copy() || this.is_use_cloned_raw(typing_env.as_query_input(ty));
};

/// Returns the deeply last field of nested structures, or the same type if
/// not a structure at all. Corresponds to the only possible unsized field,
/// and its type can be used to determine unsizing strategy.
///
/// Should only be called if `ty` has no inference variables and does not
/// need its lifetimes preserved (e.g. as part of codegen); otherwise
/// normalization attempt may cause compiler bugs.
// rustc: compiler/rustc_middle/src/ty/util.rs:216 struct_tail_for_codegen
TyCtxt.prototype.struct_tail_for_codegen = function (this: TyCtxt, ty: Ty, typing_env: TypingEnv): Ty {
  this.assert_fully_normalized(typing_env, ty, fold_Ty);
  return this.struct_tail_raw(
    ty,
    traits_mod().ObligationCause.dummy(),
    (ty) => this.normalize_erasing_regions(typing_env, ty, fold_Ty),
    () => {},
  );
};

/// Returns true if a type has metadata.
// rustc: compiler/rustc_middle/src/ty/util.rs:231 type_has_metadata
TyCtxt.prototype.type_has_metadata = function (this: TyCtxt, ty: Ty, typing_env: TypingEnv): boolean {
  if (ty.is_sized(this, typing_env)) {
    return false;
  }

  const tail = this.struct_tail_for_codegen(ty, typing_env);
  switch (tail.kind().$) {
    case "Foreign":
      return false;
    case "Str":
    case "Slice":
    case "Dynamic":
      return true;
    default:
      return bug(`unexpected unsized tail: ${debug_Ty(tail, PLAIN)}`);
  }
};

/// Returns the deeply last field of nested structures, or the same type if
/// not a structure at all. Corresponds to the only possible unsized field,
/// and its type can be used to determine unsizing strategy.
///
/// This is parameterized over the normalization strategy (i.e. how to
/// handle `<T as Trait>::Assoc` and `impl Trait`). You almost certainly do
/// **NOT** want to pass the identity function here, unless you know what
/// you're doing, or you're within normalization code itself and will handle
/// an unnormalized tail recursively.
///
/// See also `struct_tail_for_codegen`, which is suitable for use
/// during codegen.
// rustc: compiler/rustc_middle/src/ty/util.rs:256 struct_tail_raw
TyCtxt.prototype.struct_tail_raw = function (
  this: TyCtxt,
  ty_: Ty,
  cause: ObligationCause,
  normalize: (_0: Unnormalized<Ty>) => Ty,
  // This is currently used to allow us to walk a ValTree
  // in lockstep with the type in order to get the ValTree branch that
  // corresponds to an unsized field.
  f: () => void,
): Ty {
  let ty = ty_;
  const recursion_limit = this.recursion_limit();
  loop: for (let iteration = 0; ; iteration++) {
    if (!recursion_limit.value_within_limit(iteration)) {
      const suggested_limit = recursion_limit._0 === 0 ? Limit.new(2) : Limit_mul(recursion_limit, 2);
      const reported = this.dcx().emit_err(
        RecursionLimitReached_diagnostic({
          span: cause.span,
          ty,
          suggested_limit,
        }),
      );
      return Ty.new_error(this, reported);
    }
    const k = ty.kind();
    switch (k.$) {
      case "Adt": {
        const def = k._0;
        const args = k._1;
        if (!def.is_struct()) {
          break loop;
        }
        const field = def.non_enum_variant().tail_opt();
        if (field !== undefined) {
          f();
          ty = normalize(field.ty(this, args));
        } else {
          break loop;
        }
        break;
      }

      case "Tuple": {
        const tys = k._0;
        if (tys.length > 0) {
          const last_ty = tys[tys.length - 1]!;
          f();
          ty = last_ty;
        } else {
          break loop;
        }
        break;
      }

      case "Pat": {
        const inner = k._0;
        f();
        ty = inner;
        break;
      }

      default: {
        break loop;
      }
    }
  }
  return ty;
};

/// Same as applying `struct_tail` on `source` and `target`, but only
/// keeps going as long as the two types are instances of the same
/// structure definitions.
/// For `(Foo<Foo<T>>, Foo<dyn Trait>)`, the result will be `(Foo<T>, dyn Trait)`,
/// whereas struct_tail produces `T`, and `Trait`, respectively.
///
/// Should only be called if the types have no inference variables and do
/// not need their lifetimes preserved (e.g., as part of codegen); otherwise,
/// normalization attempt may cause compiler bugs.
// rustc: compiler/rustc_middle/src/ty/util.rs:323 struct_lockstep_tails_for_codegen
TyCtxt.prototype.struct_lockstep_tails_for_codegen = function (this: TyCtxt, source: Ty, target: Ty, typing_env: TypingEnv): [Ty, Ty] {
  this.assert_fully_normalized(typing_env, [source, target], fold_Ty_Ty);
  return this.struct_lockstep_tails_raw(source, target, (ty) => this.normalize_erasing_regions(typing_env, ty, fold_Ty));
};

/// Same as applying `struct_tail` on `source` and `target`, but only
/// keeps going as long as the two types are instances of the same
/// structure definitions.
/// For `(Foo<Foo<T>>, Foo<dyn Trait>)`, the result will be `(Foo<T>, Trait)`,
/// whereas struct_tail produces `T`, and `Trait`, respectively.
///
/// See also `struct_lockstep_tails_for_codegen`, which is suitable for use
/// during codegen.
// rustc: compiler/rustc_middle/src/ty/util.rs:343 struct_lockstep_tails_raw
TyCtxt.prototype.struct_lockstep_tails_raw = function (this: TyCtxt, source: Ty, target: Ty, normalize: (_0: Unnormalized<Ty>) => Ty): [Ty, Ty] {
  let [a, b] = [source, target];
  for (;;) {
    const ak = a.kind();
    const bk = b.kind();
    if (ak.$ === "Adt" && bk.$ === "Adt" && ak._0 === bk._0 && ak._0.is_struct()) {
      const a_def = ak._0;
      const a_args = ak._1;
      const b_args = bk._1;
      const f = a_def.non_enum_variant().tail_opt();
      if (f !== undefined) {
        a = normalize(f.ty(this, a_args));
        b = normalize(f.ty(this, b_args));
      } else {
        break;
      }
    } else if (ak.$ === "Tuple" && bk.$ === "Tuple" && ak._0.length === bk._0.length) {
      const a_tys = ak._0;
      const b_tys = bk._0;
      if (a_tys.length > 0) {
        const a_last = a_tys[a_tys.length - 1]!;
        a = a_last;
        b = b_tys[b_tys.length - 1]!;
      } else {
        break;
      }
    } else {
      break;
    }
  }
  return [a, b];
};

/// Calculate the destructor of a given type.
// rustc: compiler/rustc_middle/src/ty/util.rs:378 calculate_dtor
TyCtxt.prototype.calculate_dtor = function (
  this: TyCtxt,
  adt_did: LocalDefId,
  validate: (tcx: TyCtxt, def_id: LocalDefId) => Result<null, ErrorGuaranteed>,
): Destructor | undefined {
  const drop_trait = this.lang_items().drop_trait();
  if (drop_trait === undefined) return undefined;
  if (this.ensure_result().coherent_trait(drop_trait).$ === "Err") return undefined;

  let dtor_candidate: DefId | undefined = undefined;
  // `Drop` impls can only be written in the same crate as the adt, and cannot be blanket impls
  for (const impl_did of this.local_trait_impls(drop_trait)) {
    const adt_def = EarlyBinder.skip_binder(this.type_of(impl_did) as EarlyBinder<Ty>).ty_adt_def();
    if (adt_def === undefined) continue;
    if (!DefId_eq(adt_def.did(), LocalDefId.to_def_id(adt_did))) {
      continue;
    }

    if (validate(this, impl_did).$ === "Err") {
      // Already `ErrorGuaranteed`, no need to delay a span bug here.
      continue;
    }

    const item_id = this.associated_item_def_ids(impl_did)[0];
    if (item_id === undefined) {
      this.dcx().span_delayed_bug(this.def_span(impl_did), "Drop impl without drop function");
      continue;
    }

    if (this.def_kind(item_id).$ !== "AssocFn") {
      this.dcx().span_delayed_bug(this.def_span(item_id), "drop is not a function");
      continue;
    }

    const old_item_id = dtor_candidate;
    if (old_item_id !== undefined) {
      this.dcx().struct_span_err(this.def_span(item_id), "multiple drop impls found").with_span_note(this.def_span(old_item_id), "other impl here").delay_as_bug();
    }

    dtor_candidate = item_id;
  }

  const did = dtor_candidate;
  if (did === undefined) return undefined;
  return { did };
};

/// Calculate the async destructor of a given type.
// rustc: compiler/rustc_middle/src/ty/util.rs:425 calculate_async_dtor
TyCtxt.prototype.calculate_async_dtor = function (
  this: TyCtxt,
  adt_did: LocalDefId,
  validate: (tcx: TyCtxt, def_id: LocalDefId) => Result<null, ErrorGuaranteed>,
): AsyncDestructor | undefined {
  const async_drop_trait = this.lang_items().async_drop_trait();
  if (async_drop_trait === undefined) return undefined;
  if (this.ensure_result().coherent_trait(async_drop_trait).$ === "Err") return undefined;

  let dtor_candidate: LocalDefId | undefined = undefined;
  // `AsyncDrop` impls can only be written in the same crate as the adt, and cannot be blanket impls
  for (const impl_did of this.local_trait_impls(async_drop_trait)) {
    const adt_def = EarlyBinder.skip_binder(this.type_of(impl_did) as EarlyBinder<Ty>).ty_adt_def();
    if (adt_def === undefined) continue;
    if (!DefId_eq(adt_def.did(), LocalDefId.to_def_id(adt_did))) {
      continue;
    }

    if (validate(this, impl_did).$ === "Err") {
      // Already `ErrorGuaranteed`, no need to delay a span bug here.
      continue;
    }

    const old_impl_did = dtor_candidate;
    if (old_impl_did !== undefined) {
      this.dcx().struct_span_err(this.def_span(impl_did), "multiple async drop impls found").with_span_note(this.def_span(old_impl_did), "other impl here").delay_as_bug();
    }

    dtor_candidate = impl_did;
  }

  if (dtor_candidate === undefined) return undefined;
  return { impl_did: LocalDefId.to_def_id(dtor_candidate) };
};

/// Returns the set of types that are required to be alive in
/// order to run the destructor of `def` (see RFCs 769 and
/// 1238).
///
/// Note that this returns only the constraints for the
/// destructor of `def` itself. For the destructors of the
/// contents, you need `adt_dtorck_constraint`.
// rustc: compiler/rustc_middle/src/ty/util.rs:466 destructor_constraints
TyCtxt.prototype.destructor_constraints = function (this: TyCtxt, def: AdtDef): GenericArg[] {
  const dtor0 = def.destructor(this);
  let dtor: DefId;
  if (dtor0 === undefined) {
    // debug!("destructor_constraints({:?}) - no dtor", def.did());
    return [];
  } else {
    dtor = dtor0.did;
  }

  const impl_def_id = this.parent(dtor);
  const impl_generics = this.generics_of(impl_def_id) as Generics;

  // We have a destructor - all the parameters that are not
  // pure_wrt_drop (i.e, don't have a #[may_dangle] attribute)
  // must be live.

  // We need to return the list of parameters from the ADTs
  // generics/args that correspond to impure parameters on the
  // impl's generics. This is a bit ugly, but conceptually simple:
  //
  // Suppose our ADT looks like the following
  //
  //     struct S<X, Y, Z>(X, Y, Z);
  //
  // and the impl is
  //
  //     impl<#[may_dangle] P0, P1, P2> Drop for S<P1, P2, P0>
  //
  // We want to return the parameters (X, Y). For that, we match
  // up the item-args <X, Y, Z> with the args on the impl ADT,
  // <P1, P2, P0>, and then look up which of the impl args refer to
  // parameters marked as pure.

  const self_kind = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.type_of(impl_def_id) as EarlyBinder<Ty>)).kind();
  let impl_args: GenericArgs;
  if (self_kind.$ === "Adt" && self_kind._0 === def) {
    impl_args = self_kind._1;
  } else {
    return span_bug(this.def_span(impl_def_id), "expected ADT for self type of `Drop` impl");
  }

  const item_args = RawList.identity_for_item(this, def.did());

  const result: GenericArg[] = [];
  // iter::zip(item_args, impl_args).filter(..).map(|(item_param, _)| item_param).collect()
  const n = Math.min(item_args.length, impl_args.length);
  for (let i = 0; i < n; i++) {
    const item_param = item_args[i]!;
    const arg = impl_args[i]!;
    let keep: boolean;
    const k = GenericArg.kind(arg);
    switch (k.$) {
      case "Lifetime": {
        const region_kind = k._0.kind();
        if (region_kind.$ === "ReEarlyParam") {
          const ebr = region_kind._0;
          keep = !impl_generics.region_param(ebr, this).pure_wrt_drop;
        } else {
          // Error: not a region param
          keep = false;
        }
        break;
      }
      case "Type": {
        const ty_kind = k._0.kind();
        if (ty_kind.$ === "Param") {
          const pt = ty_kind._0;
          keep = !impl_generics.type_param(pt, this).pure_wrt_drop;
        } else {
          // Error: not a type param
          keep = false;
        }
        break;
      }
      case "Const": {
        const ct_kind = k._0.kind();
        if (ct_kind.$ === "Param") {
          const pc = ct_kind._0;
          keep = !impl_generics.const_param(pc, this).pure_wrt_drop;
        } else {
          // Error: not a const param
          keep = false;
        }
        break;
      }
    }
    if (keep) result.push(item_param);
  }
  // debug!("destructor_constraint({:?}) = {:?}", def.did(), result);
  return result;
};

/// Checks whether each generic argument is simply a unique generic parameter.
// rustc: compiler/rustc_middle/src/ty/util.rs:541 uses_unique_generic_params
TyCtxt.prototype.uses_unique_generic_params = function (this: TyCtxt, args: readonly GenericArg[], ignore_regions: CheckRegions): Result<null, NotUniqueParam> {
  // PORT: `GrowableBitSet<u32>` (rustc_index, not ported) -> `Set<number>`; `insert` reports whether the value is new.
  const seen = new Set<number>();
  const seen_late = new KeyedSet<[BoundVarIndexKind, BoundRegion]>(intern_key);
  for (const arg of args) {
    const k = GenericArg.kind(arg);
    switch (k.$) {
      case "Lifetime": {
        const lt = k._0;
        const lk = lt.kind();
        if (ignore_regions === "FromFunction" && lk.$ === "ReBound") {
          const [di, reg] = [lk._0, lk._1];
          if (!insert(seen_late, [di, reg])) {
            return Err({ $: "DuplicateParam", _0: lt });
          }
        } else if ((ignore_regions === "OnlyParam" || ignore_regions === "FromFunction") && lk.$ === "ReEarlyParam") {
          const p = lk._0;
          if (!insert(seen, p.index)) {
            return Err({ $: "DuplicateParam", _0: lt });
          }
        } else if (ignore_regions === "OnlyParam" || ignore_regions === "FromFunction") {
          return Err({ $: "NotParam", _0: lt });
        } else {
          // (CheckRegions::No, _) => {}
        }
        break;
      }
      case "Type": {
        const t = k._0;
        const tk = t.kind();
        if (tk.$ === "Param") {
          const p = tk._0;
          if (!insert(seen, p.index)) {
            return Err({ $: "DuplicateParam", _0: t });
          }
        } else {
          return Err({ $: "NotParam", _0: t });
        }
        break;
      }
      case "Const": {
        const c = k._0;
        const ck = c.kind();
        if (ck.$ === "Param") {
          const p = ck._0;
          if (!insert(seen, p.index)) {
            return Err({ $: "DuplicateParam", _0: c });
          }
        } else {
          return Err({ $: "NotParam", _0: c });
        }
        break;
      }
    }
  }

  return Ok(null);
};

/// Returns `true` if `def_id` refers to a closure, coroutine, or coroutine-closure
/// (i.e. an async closure). These are all represented by `hir::Closure`, and all
/// have the same `DefKind`.
///
/// Note that closures have a `DefId`, but the closure *expression* also has a
/// `HirId` that is located within the context where the closure appears. The
/// parent of the closure's `DefId` will also be the context where it appears.
// rustc: compiler/rustc_middle/src/ty/util.rs:595 is_closure_like
TyCtxt.prototype.is_closure_like = function (this: TyCtxt, def_id: DefId): boolean {
  return this.def_kind(def_id).$ === "Closure";
};

/// Returns `true` if `def_id` refers to a definition that does not have its own
/// type-checking context, i.e. closure, coroutine or inline const.
// rustc: compiler/rustc_middle/src/ty/util.rs:601 is_typeck_child
TyCtxt.prototype.is_typeck_child = function (this: TyCtxt, def_id: DefId): boolean {
  const def_kind = this.def_kind(def_id);
  switch (def_kind.$) {
    case "AnonConst":
      // PORT: the `anon_const_kind` query value is `unknown` in queries.gen.ts.
      return (this.anon_const_kind(def_id) as AnonConstKind) === "NonTypeSystemInline";
    case "Closure":
    case "SyntheticCoroutineBody":
      return true;
    case "Mod":
    case "Struct":
    case "Union":
    case "Enum":
    case "Variant":
    case "Trait":
    case "TyAlias":
    case "ForeignTy":
    case "TraitAlias":
    case "AssocTy":
    case "TyParam":
    case "Fn":
    case "Const":
    case "ConstParam":
    case "Static":
    case "Ctor":
    case "AssocFn":
    case "AssocConst":
    case "Macro":
    case "ExternCrate":
    case "Use":
    case "ForeignMod":
    case "OpaqueTy":
    case "Field":
    case "LifetimeParam":
    case "GlobalAsm":
    case "Impl":
    case "TestBinderConstraints":
      return false;
  }
};

/// Returns `true` if `def_id` refers to a trait (i.e., `trait Foo { ... }`).
// rustc: compiler/rustc_middle/src/ty/util.rs:639 is_trait
TyCtxt.prototype.is_trait = function (this: TyCtxt, def_id: DefId): boolean {
  return this.def_kind(def_id).$ === "Trait";
};

/// Returns `true` if `def_id` refers to a trait alias (i.e., `trait Foo = ...;`),
/// and `false` otherwise.
// rustc: compiler/rustc_middle/src/ty/util.rs:645 is_trait_alias
TyCtxt.prototype.is_trait_alias = function (this: TyCtxt, def_id: DefId): boolean {
  return this.def_kind(def_id).$ === "TraitAlias";
};

/// Returns `true` if this `DefId` refers to the implicit constructor for
/// a tuple struct like `struct Foo(u32)`, and `false` otherwise.
// rustc: compiler/rustc_middle/src/ty/util.rs:651 is_constructor
TyCtxt.prototype.is_constructor = function (this: TyCtxt, def_id: DefId): boolean {
  return this.def_kind(def_id).$ === "Ctor";
};

/// Given the `DefId`, returns the `DefId` of the innermost item that
/// has its own type-checking context or "inference environment".
///
/// For example, a closure has its own `DefId`, but it is type-checked
/// with the containing item. Therefore, when we fetch the `typeck` of the closure,
/// for example, we really wind up fetching the `typeck` of the enclosing fn item.
// rustc: compiler/rustc_middle/src/ty/util.rs:661 typeck_root_def_id
TyCtxt.prototype.typeck_root_def_id = function (this: TyCtxt, def_id_: DefId): DefId {
  let def_id = def_id_;
  while (this.is_typeck_child(def_id)) {
    def_id = this.parent(def_id);
  }
  return def_id;
};

/// Given the `LocalDefId`, returns the `LocalDefId` of the innermost item that
/// has its own type-checking context or "inference environment".
///
/// For example, a closure has its own `LocalDefId`, but it is type-checked
/// with the containing item. Therefore, when we fetch the `typeck` of the closure,
/// for example, we really wind up fetching the `typeck` of the enclosing fn item.
// rustc: compiler/rustc_middle/src/ty/util.rs:675 typeck_root_def_id_local
TyCtxt.prototype.typeck_root_def_id_local = function (this: TyCtxt, def_id_: LocalDefId): LocalDefId {
  let def_id = def_id_;
  while (this.is_typeck_child(LocalDefId.to_def_id(def_id))) {
    def_id = this.local_parent(def_id);
  }
  return def_id;
};

/// Given the `DefId` and args a closure, creates the type of
/// `self` argument that the closure expects. For example, for a
/// `Fn` closure, this would return a reference type `&T` where
/// `T = closure_ty`.
///
/// Returns `None` if this closure's kind has not yet been inferred.
/// This should only be possible during type checking.
///
/// Note that the return value is a late-bound region and hence
/// wrapped in a binder.
// rustc: compiler/rustc_middle/src/ty/util.rs:693 closure_env_ty
TyCtxt.prototype.closure_env_ty = function (this: TyCtxt, closure_ty: Ty, closure_kind: ClosureKind, env_region: Region): Ty {
  switch (closure_kind) {
    case "Fn":
      return Ty.new_imm_ref(this, env_region, closure_ty);
    case "FnMut":
      return Ty.new_mut_ref(this, env_region, closure_ty);
    case "FnOnce":
      return closure_ty;
  }
};

/// Returns `true` if the node pointed to by `def_id` is a `static` item.
// #[inline]
// rustc: compiler/rustc_middle/src/ty/util.rs:708 is_static
TyCtxt.prototype.is_static = function (this: TyCtxt, def_id: DefId): boolean {
  return this.def_kind(def_id).$ === "Static";
};

// #[inline]
// rustc: compiler/rustc_middle/src/ty/util.rs:713 static_mutability
TyCtxt.prototype.static_mutability = function (this: TyCtxt, def_id: DefId): Mutability | undefined {
  const def_kind = this.def_kind(def_id);
  if (def_kind.$ === "Static") {
    return def_kind.mutability;
  } else {
    return undefined;
  }
};

/// Returns `true` if this is a `static` item with the `#[thread_local]` attribute.
// rustc: compiler/rustc_middle/src/ty/util.rs:722 is_thread_local_static
TyCtxt.prototype.is_thread_local_static = function (this: TyCtxt, def_id: DefId): boolean {
  return CodegenFnAttrs_flags_contains_THREAD_LOCAL(this.codegen_fn_attrs(def_id));
};

/// Returns `true` if the node pointed to by `def_id` is a mutable `static` item.
// #[inline]
// rustc: compiler/rustc_middle/src/ty/util.rs:728 is_mutable_static
TyCtxt.prototype.is_mutable_static = function (this: TyCtxt, def_id: DefId): boolean {
  return this.static_mutability(def_id) === "Mut";
};

/// Returns `true` if the item pointed to by `def_id` is a thread local which needs a
/// thread local shim generated.
// #[inline]
// rustc: compiler/rustc_middle/src/ty/util.rs:735 needs_thread_local_shim
TyCtxt.prototype.needs_thread_local_shim = function (this: TyCtxt, def_id: DefId): boolean {
  return !this.sess.target.dll_tls_export && this.is_thread_local_static(def_id) && !this.is_foreign_item(def_id);
};

/// Returns the type a reference to the thread local takes in MIR.
// rustc: compiler/rustc_middle/src/ty/util.rs:742 thread_local_ptr_ty
TyCtxt.prototype.thread_local_ptr_ty = function (this: TyCtxt, def_id: DefId): Ty {
  const static_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.type_of(def_id) as EarlyBinder<Ty>));
  if (this.is_mutable_static(def_id)) {
    return Ty.new_mut_ptr(this, static_ty);
  } else if (this.is_foreign_item(def_id)) {
    return Ty.new_imm_ptr(this, static_ty);
  } else {
    // FIXME: These things don't *really* have 'static lifetime.
    return Ty.new_imm_ref(this, this.lifetimes.re_static, static_ty);
  }
};

/// Get the type of the pointer to the static that we use in MIR.
// rustc: compiler/rustc_middle/src/ty/util.rs:755 static_ptr_ty
TyCtxt.prototype.static_ptr_ty = function (this: TyCtxt, def_id: DefId, typing_env: TypingEnv): Ty {
  // Make sure that any constants in the static's type are evaluated.
  const static_ty = this.normalize_erasing_regions(typing_env, EarlyBinder.instantiate_identity(this.type_of(def_id) as EarlyBinder<Ty>), fold_Ty);

  // Make sure that accesses to unsafe statics end up using raw pointers.
  // For thread-locals, this needs to be kept in sync with `Rvalue::ty`.
  if (this.is_mutable_static(def_id)) {
    return Ty.new_mut_ptr(this, static_ty);
  } else if (this.is_foreign_item(def_id)) {
    return Ty.new_imm_ptr(this, static_ty);
  } else {
    return Ty.new_imm_ref(this, this.lifetimes.re_erased, static_ty);
  }
};

/// Expands the given impl trait type, stopping if the type is recursive.
// #[instrument(skip(self), level = "debug", ret)]
// rustc: compiler/rustc_middle/src/ty/util.rs:773 try_expand_impl_trait_type
TyCtxt.prototype.try_expand_impl_trait_type = function (this: TyCtxt, def_id: DefId, args: GenericArgs): Result<Ty, Ty> {
  const visitor = new OpaqueTypeExpander(new DefIdSet(), new KeyedMap<[DefId, GenericArgs], Ty>(intern_key), def_id, false, false, true, this);

  const expanded_type = unwrap(visitor.expand_opaque_ty(def_id, args));
  if (visitor.found_recursion) {
    return Err(expanded_type);
  } else {
    return Ok(expanded_type);
  }
};

/// Query and get an English description for the item's kind.
// rustc: compiler/rustc_middle/src/ty/util.rs:793 def_descr
TyCtxt.prototype.def_descr = function (this: TyCtxt, def_id: DefId): string {
  return this.def_kind_descr(this.def_kind(def_id), def_id);
};

/// Get an English description for the item's kind.
// rustc: compiler/rustc_middle/src/ty/util.rs:798 def_kind_descr
TyCtxt.prototype.def_kind_descr = function (this: TyCtxt, def_kind: DefKind, def_id: DefId): string {
  if (def_kind.$ === "AssocFn" && AssocItemC.is_method(this.associated_item(def_id) as AssocItem)) {
    return "method";
  }
  if (def_kind.$ === "AssocTy" && this.opt_rpitit_info(def_id) !== undefined) {
    return "opaque type";
  }
  if (def_kind.$ === "Closure") {
    // PORT: the `coroutine_kind` query value is `unknown` in queries.gen.ts.
    const coroutine_kind = this.coroutine_kind(def_id) as CoroutineKind | undefined;
    if (coroutine_kind !== undefined) {
      if (coroutine_kind.$ === "Desugared") {
        const [desugaring, source] = [coroutine_kind._0, coroutine_kind._1];
        if (desugaring === "Async" && source === "Fn") return "async fn";
        if (desugaring === "Async" && source === "Block") return "async block";
        if (desugaring === "Async" && source === "Closure") return "async closure";
        if (desugaring === "AsyncGen" && source === "Fn") return "async gen fn";
        if (desugaring === "AsyncGen" && source === "Block") return "async gen block";
        if (desugaring === "AsyncGen" && source === "Closure") return "async gen closure";
        if (desugaring === "Gen" && source === "Fn") return "gen fn";
        if (desugaring === "Gen" && source === "Block") return "gen block";
        if (desugaring === "Gen" && source === "Closure") return "gen closure";
      }
      // hir::CoroutineKind::Coroutine(_)
      return "coroutine";
    }
  }
  return DefKind.descr(def_kind, def_id);
};

/// Gets an English article for the [`TyCtxt::def_descr`].
// rustc: compiler/rustc_middle/src/ty/util.rs:848 def_descr_article
TyCtxt.prototype.def_descr_article = function (this: TyCtxt, def_id: DefId): string {
  return this.def_kind_descr_article(this.def_kind(def_id), def_id);
};

/// Gets an English article for the [`TyCtxt::def_kind_descr`].
// rustc: compiler/rustc_middle/src/ty/util.rs:853 def_kind_descr_article
TyCtxt.prototype.def_kind_descr_article = function (this: TyCtxt, def_kind: DefKind, def_id: DefId): string {
  if (def_kind.$ === "AssocFn" && AssocItemC.is_method(this.associated_item(def_id) as AssocItem)) {
    return "a";
  }
  if (def_kind.$ === "Closure") {
    // PORT: the `coroutine_kind` query value is `unknown` in queries.gen.ts.
    const coroutine_kind = this.coroutine_kind(def_id) as CoroutineKind | undefined;
    if (coroutine_kind !== undefined) {
      if (coroutine_kind.$ === "Desugared") {
        switch (coroutine_kind._0) {
          case "Async":
            return "an";
          case "AsyncGen":
            return "an";
          case "Gen":
            return "a";
        }
      }
      // hir::CoroutineKind::Coroutine(_)
      return "a";
    }
  }
  return DefKind.article(def_kind);
};

/// Return `true` if the supplied `CrateNum` is "user-visible," meaning either a [public]
/// dependency, or a [direct] private dependency. This is used to decide whether the crate can
/// be shown in `impl` suggestions.
///
/// [public]: TyCtxt::is_private_dep
/// [direct]: rustc_crate_store::ExternCrate::is_direct
// rustc: compiler/rustc_middle/src/ty/util.rs:874 is_user_visible_dep
TyCtxt.prototype.is_user_visible_dep = function (this: TyCtxt, key: CrateNum): boolean {
  // `#![rustc_private]` overrides defaults to make private dependencies usable.
  if (this.features().enabled(sym.rustc_private)) {
    return true;
  }

  // | Private | Direct | Visible |                    |
  // |---------|--------|---------|--------------------|
  // | Yes     | Yes    | Yes     | !true || true   |
  // | No      | Yes    | Yes     | !false || true  |
  // | Yes     | No     | No      | !true || false  |
  // | No      | No     | Yes     | !false || false |
  if (!this.is_private_dep(key)) return true;
  // If `extern_crate` is `None`, then the crate was injected (e.g., by the allocator).
  // Treat that kind of crate as "indirect", since it's an implementation detail of
  // the language.
  // PORT: the `extern_crate` query value is `unknown` in queries.gen.ts.
  const e = this.extern_crate(key) as ExternCrate | undefined;
  return e !== undefined && e.is_direct();
};

/// Expand any [free alias types][free] contained within the given `value`.
///
/// This should be used over other normalization routines in situations where
/// it's important not to normalize other alias types and where the predicates
/// on the corresponding type alias shouldn't be taken into consideration.
///
/// Whenever possible **prefer not to use this function**! Instead, use standard
/// normalization routines or if feasible don't normalize at all.
///
/// This function comes in handy if you want to mimic the behavior of eager
/// type alias expansion in a localized manner.
///
/// <div class="warning">
/// This delays a bug on overflow! Therefore you need to be certain that the
/// contained types get fully normalized at a later stage. Note that even on
/// overflow all well-behaved free alias types get expanded correctly, so the
/// result is still useful.
/// </div>
///
/// [free]: ty::Free
// rustc: compiler/rustc_middle/src/ty/util.rs:913 expand_free_alias_tys
TyCtxt.prototype.expand_free_alias_tys = function <T>(this: TyCtxt, value: T, d_T: TypeFoldable<T>): T {
  return d_T.fold_with(value, new FreeAliasTypeExpander(this, 0));
};

/// Peel off all [free alias types] in this type until there are none left.
///
/// This only expands free alias types in “head” / outermost positions. It can
/// be used over [expand_free_alias_tys] as an optimization in situations where
/// one only really cares about the *kind* of the final aliased type but not
/// the types the other constituent types alias.
///
/// <div class="warning">
/// This delays a bug on overflow! Therefore you need to be certain that the
/// type gets fully normalized at a later stage.
/// </div>
///
/// [free]: ty::Free
/// [expand_free_alias_tys]: Self::expand_free_alias_tys
// rustc: compiler/rustc_middle/src/ty/util.rs:931 peel_off_free_alias_tys
TyCtxt.prototype.peel_off_free_alias_tys = function (this: TyCtxt, ty_: Ty): Ty {
  let ty = ty_;
  const k0 = ty.kind();
  if (!(k0.$ === "Alias" && k0._1.kind.$ === "Free")) {
    return ty;
  }

  const limit = this.recursion_limit();
  let depth = 0;

  for (;;) {
    const k = ty.kind();
    if (!(k.$ === "Alias" && k._1.kind.$ === "Free")) break;
    const def_id = k._1.kind.def_id;
    const args = k._1.args;
    if (!limit.value_within_limit(depth)) {
      const guar = this.dcx().delayed_bug("overflow expanding free alias type");
      return Ty.new_error(this, guar);
    }

    ty = Unnormalized.skip_normalization(EarlyBinder.instantiate(this.type_of(def_id) as EarlyBinder<Ty>, this, args, fold_Ty));
    depth += 1;
  }

  return ty;
};

// Computes the variances for an alias (opaque or RPITIT) that represent
// its (un)captured regions.
// rustc: compiler/rustc_middle/src/ty/util.rs:954 opt_alias_variances
TyCtxt.prototype.opt_alias_variances = function (this: TyCtxt, kind: AliasTermKind): readonly Variance[] | undefined {
  // PORT: `kind: impl Into<ty::AliasTermKind>`: callers convert (`AliasTermKind.from_AliasTyKind`).
  switch (kind.$) {
    case "ProjectionTy": {
      const def_id = kind.def_id;
      if (this.is_impl_trait_in_trait(def_id)) {
        return this.variances_of(def_id) as readonly Variance[];
      } else {
        return undefined;
      }
    }
    case "OpaqueTy": {
      const def_id = kind.def_id;
      return this.variances_of(def_id) as readonly Variance[];
    }
    case "InherentTy":
    case "InherentConstSelf":
    case "InherentConstImpl":
    case "FreeTy":
    case "FreeConst":
    case "AnonConst":
    case "ProjectionConst":
      return undefined;
  }
};

// rustc-type: compiler/rustc_middle/src/ty/util.rs:978 OpaqueTypeExpander
class OpaqueTypeExpander implements TypeFolder {
  constructor(
    // Contains the DefIds of the opaque types that are currently being
    // expanded. When we expand an opaque type we insert the DefId of
    // that type, and when we finish expanding that type we remove the
    // its DefId.
    public seen_opaque_tys: DefIdSet,
    // Cache of all expansions we've seen so far. This is a critical
    // optimization for some large types produced by async fn trees.
    public expanded_cache: KeyedMap<[DefId, GenericArgs], Ty>,
    public primary_def_id: DefId | undefined,
    public found_recursion: boolean,
    public found_any_recursion: boolean,
    /// Whether or not to check for recursive opaque types.
    /// This is `true` when we're explicitly checking for opaque type
    /// recursion, and 'false' otherwise to avoid unnecessary work.
    public check_recursion: boolean,
    public tcx: TyCtxt,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/util.rs:998 expand_opaque_ty
  expand_opaque_ty(def_id: DefId, args_: GenericArgs): Ty | undefined {
    if (this.found_any_recursion) {
      return undefined;
    }
    const args = fold_with_GenericArgs(args_, this);
    if (!this.check_recursion || insert(this.seen_opaque_tys, def_id)) {
      let expanded_ty: Ty;
      const cached = this.expanded_cache.get([def_id, args]);
      if (cached !== undefined) {
        expanded_ty = cached;
      } else {
        const generic_ty = this.tcx.type_of(def_id) as EarlyBinder<Ty>;
        const concrete_ty = Unnormalized.skip_normalization(EarlyBinder.instantiate(generic_ty, this.tcx, args, fold_Ty));
        const expanded_ty_ = this.fold_ty(concrete_ty);
        this.expanded_cache.set([def_id, args], expanded_ty_);
        expanded_ty = expanded_ty_;
      }
      if (this.check_recursion) {
        this.seen_opaque_tys.delete(def_id);
      }
      return expanded_ty;
    } else {
      // If another opaque type that we contain is recursive, then it
      // will report the error, so we don't have to.
      this.found_any_recursion = true;
      this.found_recursion = DefId_eq(def_id, unwrap(this.primary_def_id));
      return undefined;
    }
  }

  // rustc: compiler/rustc_middle/src/ty/util.rs:1029 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_middle/src/ty/util.rs:1033 fold_ty
  fold_ty(t: Ty): Ty {
    const k = t.kind();
    if (k.$ === "Alias" && k._1.kind.$ === "Opaque") {
      const def_id = k._1.kind.def_id;
      const args = k._1.args;
      return this.expand_opaque_ty(def_id, args) ?? t;
    } else if (TypeVisitableExt.has_opaque_types(t, fold_Ty)) {
      return fold_Ty.super_fold_with(t, this);
    } else {
      return t;
    }
  }

  // rustc: compiler/rustc_middle/src/ty/util.rs:1043 fold_predicate
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    // We use `map_projection` to execute the closure only if `p` is a projection clause,
    // to implement the logic described below (i.e. avoid folding the `term`).
    // In all other cases, fold recursively, as normal.
    const mapped = d.map_projection(p, this.tcx, (bound_clause) => {
      const projection_clause = Binder.skip_binder(bound_clause);
      const new_clause: ProjectionClause = {
        projection_term: fold_with_Alias(projection_clause.projection_term, this, fold_with_AliasTermKind),
        // Don't fold the term on the RHS of the projection predicate.
        // This is because for default trait methods with RPITITs, we
        // install a `NormalizesTo(Projection(RPITIT) -> Opaque(RPITIT))`
        // predicate, which would trivially cause a cycle when we do
        // anything that requires `TypingEnv::with_post_analysis_normalized`.
        term: projection_clause.term,
      };
      return Binder.rebind(bound_clause, new_clause);
    });
    return mapped !== undefined ? mapped : d.super_fold_with(p, this);
  }

  // provided `TypeFolder` methods (not overridden upstream)
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }
  fold_region(r: Region): Region {
    return TypeFolder_provided.fold_region(this, r);
  }
  fold_const(c: Const): Const {
    return TypeFolder_provided.fold_const(this, c);
  }
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

// rustc-type: compiler/rustc_middle/src/ty/util.rs:1063 FreeAliasTypeExpander
class FreeAliasTypeExpander implements TypeFolder {
  constructor(
    public tcx: TyCtxt,
    public depth: number,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/util.rs:1069 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_middle/src/ty/util.rs:1073 fold_ty
  fold_ty(ty: Ty): Ty {
    if (!TypeVisitableExt.has_type_flags(ty, TypeFlags.HAS_TY_FREE_ALIAS, fold_Ty)) {
      return ty;
    }
    const k = ty.kind();
    if (!(k.$ === "Alias" && k._1.kind.$ === "Free")) {
      return fold_Ty.super_fold_with(ty, this);
    }
    const def_id = k._1.kind.def_id;
    const args = k._1.args;
    if (!this.tcx.recursion_limit().value_within_limit(this.depth)) {
      const guar = this.tcx.dcx().delayed_bug("overflow expanding free alias type");
      return Ty.new_error(this.tcx, guar);
    }

    this.depth += 1;
    const ty_ = fold_Ty.fold_with(Unnormalized.skip_normalization(EarlyBinder.instantiate(this.tcx.type_of(def_id) as EarlyBinder<Ty>, this.tcx, args, fold_Ty)), this);
    this.depth -= 1;
    return ty_;
  }

  // rustc: compiler/rustc_middle/src/ty/util.rs:1096 fold_const
  fold_const(ct: Const): Const {
    if (!TypeVisitableExt.has_type_flags(ct, TypeFlags.HAS_TY_FREE_ALIAS, fold_Const)) {
      return ct;
    }
    return fold_Const.super_fold_with(ct, this);
  }

  // provided `TypeFolder` methods (not overridden upstream)
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }
  fold_region(r: Region): Region {
    return TypeFolder_provided.fold_region(this, r);
  }
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

/// Returns the `Size` for primitive types (bool, uint, int, char, float).
// rustc: compiler/rustc_middle/src/ty/util.rs:1106 primitive_size
Ty.prototype.primitive_size = function (this: Ty, tcx: TyCtxt): Size {
  const k = this.kind();
  switch (k.$) {
    case "Bool":
      return Size.from_bytes(1);
    case "Char":
      return Size.from_bytes(4);
    case "Int":
      return Integer_size(IntegerExt_from_int_ty(tcx, k._0));
    case "Uint":
      return Integer_size(IntegerExt_from_uint_ty(tcx, k._0));
    case "Float":
      return Float_size(FloatExt_from_float_ty(k._0));
    default:
      return bug("non primitive type");
  }
};

// rustc: compiler/rustc_middle/src/ty/util.rs:1117 int_size_and_signed
Ty.prototype.int_size_and_signed = function (this: Ty, tcx: TyCtxt): [Size, boolean] {
  const k = this.kind();
  switch (k.$) {
    case "Int":
      return [Integer_size(IntegerExt_from_int_ty(tcx, k._0)), true];
    case "Uint":
      return [Integer_size(IntegerExt_from_uint_ty(tcx, k._0)), false];
    default:
      return bug("non integer discriminant");
  }
};

/// Returns the minimum and maximum values for the given numeric type (including `char`s) or
/// returns `None` if the type is not numeric.
// rustc: compiler/rustc_middle/src/ty/util.rs:1127 numeric_min_and_max_as_bits
Ty.prototype.numeric_min_and_max_as_bits = function (this: Ty, tcx: TyCtxt): [bigint, bigint] | undefined {
  // use rustc_apfloat::ieee::{Double, Half, Quad, Single};
  const k = this.kind();
  switch (k.$) {
    case "Int":
    case "Uint": {
      const [size, signed] = this.int_size_and_signed(tcx);
      const min = signed ? Size_truncate(size, BigInt.asUintN(128, Size_signed_int_min(size))) : 0n;
      const max = signed ? BigInt.asUintN(128, Size_signed_int_max(size)) : Size_unsigned_int_max(size);
      return [min, max];
    }
    case "Char":
      return [0n, CHAR_MAX];
    case "Float":
      switch (k._0) {
        case "F16":
          return [Half.INFINITY.neg().to_bits(), Half.INFINITY.to_bits()];
        case "F32":
          return [Single.INFINITY.neg().to_bits(), Single.INFINITY.to_bits()];
        case "F64":
          return [Double.INFINITY.neg().to_bits(), Double.INFINITY.to_bits()];
        case "F128":
          return [Quad.INFINITY.neg().to_bits(), Quad.INFINITY.to_bits()];
      }
      break;
    default:
      return undefined;
  }
};

/// Returns the maximum value for the given numeric type (including `char`s)
/// or returns `None` if the type is not numeric.
// rustc: compiler/rustc_middle/src/ty/util.rs:1152 numeric_max_val
Ty.prototype.numeric_max_val = function (this: Ty, tcx: TyCtxt): Const | undefined {
  const typing_env = TypingEnvC.fully_monomorphized();
  const r = this.numeric_min_and_max_as_bits(tcx);
  if (r === undefined) return undefined;
  const [, max] = r;
  return mir_Const_from_bits(tcx, max, typing_env, this);
};

/// Returns the minimum value for the given numeric type (including `char`s)
/// or returns `None` if the type is not numeric.
// rustc: compiler/rustc_middle/src/ty/util.rs:1160 numeric_min_val
Ty.prototype.numeric_min_val = function (this: Ty, tcx: TyCtxt): Const | undefined {
  const typing_env = TypingEnvC.fully_monomorphized();
  const r = this.numeric_min_and_max_as_bits(tcx);
  if (r === undefined) return undefined;
  const [min] = r;
  return mir_Const_from_bits(tcx, min, typing_env, this);
};

/// Checks whether values of this type `T` have a size known at
/// compile time (i.e., whether `T: Sized`). Lifetimes are ignored
/// for the purposes of this check, so it can be an
/// over-approximation in generic contexts, where one can have
/// strange rules like `<T as Foo<'static>>::Bar: Sized` that
/// actually carry lifetime requirements.
// rustc: compiler/rustc_middle/src/ty/util.rs:1172 is_sized
Ty.prototype.is_sized = function (this: Ty, tcx: TyCtxt, typing_env: TypingEnv): boolean {
  return this.has_trivial_sizedness(tcx, SizedTraitKind.Sized) || tcx.is_sized_raw(typing_env.as_query_input(this));
};

/// Checks whether values of this type `T` implement the `Freeze`
/// trait -- frozen types are those that do not contain an
/// `UnsafeCell` anywhere. This is a language concept used to
/// distinguish "true immutability", which is relevant to
/// optimization as well as the rules around static values. Note
/// that the `Freeze` trait is not exposed to end users and is
/// effectively an implementation detail.
// rustc: compiler/rustc_middle/src/ty/util.rs:1184 is_freeze
Ty.prototype.is_freeze = function (this: Ty, tcx: TyCtxt, typing_env: TypingEnv): boolean {
  return this.is_trivially_freeze() || tcx.is_freeze_raw(typing_env.as_query_input(this));
};

/// Fast path helper for testing if a type is `Freeze`.
///
/// Returning true means the type is known to be `Freeze`. Returning
/// `false` means nothing -- could be `Freeze`, might not be.
// rustc: compiler/rustc_middle/src/ty/util.rs:1192 is_trivially_freeze
Ty.prototype.is_trivially_freeze = function (this: Ty): boolean {
  const k = this.kind();
  switch (k.$) {
    case "Int":
    case "Uint":
    case "Float":
    case "Bool":
    case "Char":
    case "Str":
    case "Never":
    case "Ref":
    case "RawPtr":
    case "FnDef":
    case "Error":
    case "FnPtr":
      return true;
    case "Tuple":
      return k._0.every((t) => t.is_trivially_freeze());
    case "Pat":
    case "Slice":
    case "Array":
      return k._0.is_trivially_freeze();
    case "Adt":
    case "Bound":
    case "Closure":
    case "CoroutineClosure":
    case "Dynamic":
    case "Foreign":
    case "Coroutine":
    case "CoroutineWitness":
    case "UnsafeBinder":
    case "Infer":
    case "Alias":
    case "Param":
    case "Placeholder":
      return false;
  }
};

/// Checks whether values of this type `T` implement the `UnsafeUnpin` trait.
// rustc: compiler/rustc_middle/src/ty/util.rs:1225 is_unsafe_unpin
Ty.prototype.is_unsafe_unpin = function (this: Ty, tcx: TyCtxt, typing_env: TypingEnv): boolean {
  return this.is_trivially_unpin() || tcx.is_unsafe_unpin_raw(typing_env.as_query_input(this));
};

/// Checks whether values of this type `T` implement the `Unpin` trait.
///
/// Note that this is a safe trait, so it cannot be very semantically meaningful.
/// However, as a hack to mitigate <https://github.com/rust-lang/rust/issues/63818> until a
/// proper solution is implemented, we do give special semantics to the `Unpin` trait.
// rustc: compiler/rustc_middle/src/ty/util.rs:1234 is_unpin
Ty.prototype.is_unpin = function (this: Ty, tcx: TyCtxt, typing_env: TypingEnv): boolean {
  return this.is_trivially_unpin() || tcx.is_unpin_raw(typing_env.as_query_input(this));
};

/// Fast path helper for testing if a type is `Unpin` *and* `UnsafeUnpin`.
///
/// Returning true means the type is known to be `Unpin` and `UnsafeUnpin`. Returning
/// `false` means nothing -- could be `Unpin`, might not be.
// rustc: compiler/rustc_middle/src/ty/util.rs:1242 is_trivially_unpin
Ty.prototype.is_trivially_unpin = function (this: Ty): boolean {
  const k = this.kind();
  switch (k.$) {
    case "Int":
    case "Uint":
    case "Float":
    case "Bool":
    case "Char":
    case "Str":
    case "Never":
    case "Ref":
    case "RawPtr":
    case "FnDef":
    case "Error":
    case "FnPtr":
      return true;
    case "Tuple":
      return k._0.every((t) => t.is_trivially_unpin());
    case "Pat":
    case "Slice":
    case "Array":
      return k._0.is_trivially_unpin();
    case "Adt":
    case "Bound":
    case "Closure":
    case "CoroutineClosure":
    case "Dynamic":
    case "Foreign":
    case "Coroutine":
    case "CoroutineWitness":
    case "UnsafeBinder":
    case "Infer":
    case "Alias":
    case "Param":
    case "Placeholder":
      return false;
  }
};

/// Checks whether this type is an ADT that has unsafe fields.
// PORT: also serves `impl inherent::Ty for Ty` (ty/sty.rs:1122, `Ty::has_unsafe_fields(self)`): one TS method.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1122 has_unsafe_fields
// rustc: compiler/rustc_middle/src/ty/util.rs:1275 has_unsafe_fields
Ty.prototype.has_unsafe_fields = function (this: Ty): boolean {
  const k = this.kind();
  if (k.$ === "Adt") {
    const adt_def = k._0;
    for (const x of adt_def.all_fields()) if (Safety.is_unsafe(x.safety)) return true;
    return false;
  } else {
    return false;
  }
};

/// Checks whether values of this type `T` implement the `AsyncDrop` trait.
// rustc: compiler/rustc_middle/src/ty/util.rs:1284 is_async_drop
Ty.prototype.is_async_drop = function (this: Ty, tcx: TyCtxt, typing_env: TypingEnv): boolean {
  return !this.is_trivially_not_async_drop() && tcx.is_async_drop_raw(typing_env.as_query_input(this));
};

/// Fast path helper for testing if a type is `AsyncDrop`.
///
/// Returning true means the type is known to be `!AsyncDrop`. Returning
/// `false` means nothing -- could be `AsyncDrop`, might not be.
// rustc: compiler/rustc_middle/src/ty/util.rs:1293 is_trivially_not_async_drop
Ty.prototype.is_trivially_not_async_drop = function (this: Ty): boolean {
  const k = this.kind();
  switch (k.$) {
    case "Int":
    case "Uint":
    case "Float":
    case "Bool":
    case "Char":
    case "Str":
    case "Never":
    case "Ref":
    case "RawPtr":
    case "FnDef":
    case "Error":
    case "FnPtr":
      return true;
    // FIXME(unsafe_binders):
    case "UnsafeBinder":
      return panic("not implemented");
    case "Tuple":
      return k._0.every((t) => t.is_trivially_not_async_drop());
    case "Pat":
    case "Slice":
    case "Array": {
      const elem_ty = k._0;
      return elem_ty.is_trivially_not_async_drop();
    }
    case "Adt":
    case "Bound":
    case "Closure":
    case "CoroutineClosure":
    case "Dynamic":
    case "Foreign":
    case "Coroutine":
    case "CoroutineWitness":
    case "Infer":
    case "Alias":
    case "Param":
    case "Placeholder":
      return false;
  }
};

/// If `ty.needs_drop(...)` returns `true`, then `ty` is definitely
/// non-copy and *might* have a destructor attached; if it returns
/// `false`, then `ty` definitely has no destructor (i.e., no drop glue).
///
/// (Note that this implies that if `ty` has a destructor attached,
/// then `needs_drop` will definitely return `true` for `ty`.)
///
/// Note that this method is used to check eligible types in unions.
// #[inline]
// rustc: compiler/rustc_middle/src/ty/util.rs:1337 needs_drop
Ty.prototype.needs_drop = function (this: Ty, tcx: TyCtxt, typing_env: TypingEnv): boolean {
  // Avoid querying in simple cases.
  const r = needs_drop_components(tcx, this);
  if (r.$ === "Err") {
    return true;
  } else {
    const components = r._0;
    let query_ty: Ty;
    if (components.length === 0) {
      return false;
    } else if (components.length === 1) {
      // If we've got a single component, call the query with that
      // to increase the chance that we hit the query cache.
      query_ty = components[0]!;
    } else {
      query_ty = this;
    }

    // This doesn't depend on regions, so try to minimize distinct
    // query keys used. If normalization fails, we just use `query_ty`.
    // debug_assert!(!typing_env.param_env.has_infer());
    const n = tcx.try_normalize_erasing_regions(typing_env, Unnormalized.new_wip(query_ty), fold_Ty);
    const query_ty_ = n.$ === "Ok" ? n._0 : tcx.erase_and_anonymize_regions(query_ty, fold_Ty);

    return tcx.needs_drop_raw(typing_env.as_query_input(query_ty_));
  }
};

/// If `ty.needs_async_drop(...)` returns `true`, then `ty` is definitely
/// non-copy and *might* have a async destructor attached; if it returns
/// `false`, then `ty` definitely has no async destructor (i.e., no async
/// drop glue).
///
/// (Note that this implies that if `ty` has an async destructor attached,
/// then `needs_async_drop` will definitely return `true` for `ty`.)
///
// FIXME(zetanumbers): Note that this method is used to check eligible types
// in unions.
// #[inline]
// rustc: compiler/rustc_middle/src/ty/util.rs:1373 needs_async_drop
Ty.prototype.needs_async_drop = function (this: Ty, tcx: TyCtxt, typing_env: TypingEnv): boolean {
  // Avoid querying in simple cases.
  const r = needs_drop_components(tcx, this);
  if (r.$ === "Err") {
    return true;
  } else {
    const components = r._0;
    let query_ty: Ty;
    if (components.length === 0) {
      return false;
    } else if (components.length === 1) {
      // If we've got a single component, call the query with that
      // to increase the chance that we hit the query cache.
      query_ty = components[0]!;
    } else {
      query_ty = this;
    }

    // This doesn't depend on regions, so try to minimize distinct
    // query keys used.
    // If normalization fails, we just use `query_ty`.
    // debug_assert!(!typing_env.has_infer());
    const n = tcx.try_normalize_erasing_regions(typing_env, Unnormalized.new_wip(query_ty), fold_Ty);
    const query_ty_ = n.$ === "Ok" ? n._0 : tcx.erase_and_anonymize_regions(query_ty, fold_Ty);

    return tcx.needs_async_drop_raw(typing_env.as_query_input(query_ty_));
  }
};

/// Checks if `ty` has a significant drop.
///
/// Note that this method can return false even if `ty` has a destructor
/// attached; even if that is the case then the adt has been marked with
/// the attribute `rustc_insignificant_dtor`.
///
/// Note that this method is used to check for change in drop order for
/// 2229 drop reorder migration analysis.
// #[inline]
// rustc: compiler/rustc_middle/src/ty/util.rs:1408 has_significant_drop
Ty.prototype.has_significant_drop = function (this: Ty, tcx: TyCtxt, typing_env: TypingEnv): boolean {
  // Avoid querying in simple cases.
  const r = needs_drop_components(tcx, this);
  if (r.$ === "Err") {
    return true;
  } else {
    const components = r._0;
    let query_ty: Ty;
    if (components.length === 0) {
      return false;
    } else if (components.length === 1) {
      // If we've got a single component, call the query with that
      // to increase the chance that we hit the query cache.
      query_ty = components[0]!;
    } else {
      query_ty = this;
    }

    // FIXME
    // We should be canonicalizing, or else moving this to a method of inference
    // context, or *something* like that,
    // but for now just avoid passing inference variables
    // to queries that can't cope with them.
    // Instead, conservatively return "true" (may change drop order).
    if (TypeVisitableExt.has_infer(query_ty, fold_Ty)) {
      return true;
    }

    // This doesn't depend on regions, so try to minimize distinct
    // query keys used.
    // FIX: Use try_normalize to avoid crashing. If it fails, return true.
    const n = tcx.try_normalize_erasing_regions(typing_env, Unnormalized.new_wip(query_ty), fold_Ty);
    if (n.$ === "Ok") {
      const erased = n._0;
      return tcx.has_significant_drop_raw(typing_env.as_query_input(erased));
    } else {
      return true;
    }
  }
};

/// Returns `true` if equality for this type is both reflexive and structural.
///
/// Reflexive equality for a type is indicated by an `Eq` impl for that type.
///
/// Primitive types (`u32`, `str`) have structural equality by definition. For composite data
/// types, equality for the type as a whole is structural when it is the same as equality
/// between all components (fields, array elements, etc.) of that type. For ADTs, structural
/// equality is indicated by an implementation of `StructuralPartialEq` for that type.
///
/// This function is "shallow" because it may return `true` for a composite type whose fields
/// are not `StructuralPartialEq`. For example, `[T; 4]` has structural equality regardless of `T`
/// because equality for arrays is determined by the equality of each array element. If you
/// want to know whether a given call to `PartialEq::eq` will proceed structurally all the way
/// down, you will need to use a type visitor.
// #[inline]
// rustc: compiler/rustc_middle/src/ty/util.rs:1456 is_structural_eq_shallow
Ty.prototype.is_structural_eq_shallow = function (this: Ty, tcx: TyCtxt): boolean {
  switch (this.kind().$) {
    // Look for an impl of `StructuralPartialEq`.
    case "Adt":
      return tcx.has_structural_eq_impl(this);

    // Primitive types that satisfy `Eq`.
    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Str":
    case "Never":
      return true;

    // Composite types that satisfy `Eq` when all of their fields do.
    //
    // Because this function is "shallow", we return `true` for these composites regardless
    // of the type(s) contained within.
    case "Pat":
    case "Ref":
    case "Array":
    case "Slice":
    case "Tuple":
      return true;

    // Raw pointers use bitwise comparison.
    case "RawPtr":
    case "FnPtr":
      return true;

    // Floating point numbers are not `Eq`.
    case "Float":
      return false;

    // Conservatively return `false` for all others...

    // Anonymous function types
    case "FnDef":
    case "Closure":
    case "CoroutineClosure":
    case "Dynamic":
    case "Coroutine":
      return false;

    // Generic or inferred types
    //
    // FIXME(ecstaticmorse): Maybe we should `bug` here? This should probably only be
    // called for known, fully-monomorphized types.
    case "Alias":
    case "Param":
    case "Bound":
    case "Placeholder":
    case "Infer":
      return false;

    case "Foreign":
    case "CoroutineWitness":
    case "Error":
    case "UnsafeBinder":
      return false;
  }
};

/// Peel off all reference types in this type until there are none left.
///
/// This method is idempotent, i.e. `ty.peel_refs().peel_refs() == ty.peel_refs()`.
///
/// # Examples
///
/// - `u8` -> `u8`
/// - `&'a mut u8` -> `u8`
/// - `&'a &'b u8` -> `u8`
/// - `&'a *const &'b u8 -> *const &'b u8`
// rustc: compiler/rustc_middle/src/ty/util.rs:1507 peel_refs
Ty.prototype.peel_refs = function (this: Ty): Ty {
  let ty: Ty = this;
  for (;;) {
    const k = ty.kind();
    if (k.$ !== "Ref") break;
    const inner_ty = k._1;
    ty = inner_ty;
  }
  return ty;
};

/// Returns a list of types such that the given type needs drop if and only if
/// *any* of the returned types need drop. Returns `Err(AlwaysRequiresDrop)` if
/// this type always needs drop.
//
// FIXME(zetanumbers): consider replacing this with only
// `needs_drop_components_with_async`
// #[inline]
// rustc: compiler/rustc_middle/src/ty/util.rs:1523 needs_drop_components
export function needs_drop_components(tcx: TyCtxt, ty: Ty): Result<Ty[], AlwaysRequiresDrop> {
  return needs_drop_components_with_async(tcx, ty, "No");
}

/// Returns a list of types such that the given type needs drop if and only if
/// *any* of the returned types need drop. Returns `Err(AlwaysRequiresDrop)` if
/// this type always needs drop.
// rustc: compiler/rustc_middle/src/ty/util.rs:1533 needs_drop_components_with_async
export function needs_drop_components_with_async(tcx: TyCtxt, ty: Ty, asyncness: Asyncness): Result<Ty[], AlwaysRequiresDrop> {
  const k = ty.kind();
  switch (k.$) {
    case "Infer":
      if (k._0.$ === "FreshIntTy" || k._0.$ === "FreshFloatTy") {
        return Ok([]);
      }
      // These require checking for `Copy` bounds or `Adt` destructors.
      return Ok([ty]);
    case "Bool":
    case "Int":
    case "Uint":
    case "Float":
    case "Never":
    case "FnDef":
    case "FnPtr":
    case "Char":
    case "RawPtr":
    case "Ref":
    case "Str":
      return Ok([]);

    // Foreign types can never have destructors.
    case "Foreign":
      return Ok([]);

    // FIXME(zetanumbers): Temporary workaround for async drop of dynamic types
    case "Dynamic":
    case "Error":
      if (Asyncness.is_async(asyncness)) {
        return Ok([]);
      } else {
        return Err(AlwaysRequiresDrop);
      }

    case "Pat":
    case "Slice":
      return needs_drop_components_with_async(tcx, k._0, asyncness);
    case "Array": {
      const elem_ty = k._0;
      const size = k._1;
      const res = needs_drop_components_with_async(tcx, elem_ty, asyncness);
      if (res.$ === "Ok" && res._0.length === 0) {
        return res;
      }
      const n = size.try_to_target_usize(tcx);
      if (n === 0n) {
        // Arrays of size zero don't need drop, even if their element
        // type does.
        return Ok([]);
      } else if (n !== undefined) {
        return res;
      } else {
        // We don't know which of the cases above we are in, so
        // return the whole type and let the caller decide what to
        // do.
        return Ok([ty]);
      }
    }
    // If any field needs drop, then the whole tuple does.
    case "Tuple": {
      const acc: Ty[] = [];
      for (const elem of k._0) {
        const r = needs_drop_components_with_async(tcx, elem, asyncness);
        if (r.$ === "Err") return r;
        acc.push(...r._0);
      }
      return Ok(acc);
    }

    // These require checking for `Copy` bounds or `Adt` destructors.
    case "Adt":
    case "Alias":
    case "Param":
    case "Bound":
    case "Placeholder":
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
    case "CoroutineWitness":
    case "UnsafeBinder":
      return Ok([ty]);
  }
}

/// Does the equivalent of
/// ```ignore (illustrative)
/// let v = self.iter().map(|p| p.fold_with(folder)).collect::<SmallVec<[_; 8]>>();
/// folder.tcx().intern_*(&v)
/// ```
// PORT: D4 descriptor `d_T` of `T: TypeFoldable`; `eq_T` is `T: PartialEq` (`===` for interned values, the default).
// rustc: compiler/rustc_middle/src/ty/util.rs:1607 fold_list
export function fold_list<L extends readonly T[], T>(
  list: L,
  folder: TypeFolder,
  intern: (tcx: TyCtxt, v: readonly T[]) => L,
  d_T: TypeFoldable<T>,
  eq_T: (a: T, b: T) => boolean = (a, b) => a === b,
): L {
  const slice = list;
  let i = 0;
  // Look for the first element that changed
  let found: [number, T] | undefined = undefined;
  while (i < slice.length) {
    const t = slice[i]!;
    const idx = i;
    i++;
    const new_t = d_T.fold_with(t, folder);
    if (!eq_T(new_t, t)) {
      found = [idx, new_t];
      break;
    }
  }
  if (found !== undefined) {
    const [idx, new_t] = found;
    // An element changed, prepare to intern the resulting list
    const new_list: T[] = slice.slice(0, idx);
    new_list.push(new_t);
    for (; i < slice.length; i++) {
      new_list.push(d_T.fold_with(slice[i]!, folder));
    }
    return intern(folder.cx(), new_list);
  } else {
    return list;
  }
}

/// Does the equivalent of
/// ```ignore (illustrative)
/// let v = self.iter().map(|p| p.try_fold_with(folder)).collect::<SmallVec<[_; 8]>>();
/// folder.tcx().intern_*(&v)
/// ```
// PORT: `d_T` / `eq_T` as in `fold_list`; `F::Error` is the type parameter `E`.
// rustc: compiler/rustc_middle/src/ty/util.rs:1643 try_fold_list
export function try_fold_list<L extends readonly T[], T, E>(
  list: L,
  folder: FallibleTypeFolder<E>,
  intern: (tcx: TyCtxt, v: readonly T[]) => L,
  d_T: TypeFoldable<T>,
  eq_T: (a: T, b: T) => boolean = (a, b) => a === b,
): Result<L, E> {
  const slice = list;
  let i = 0;
  // Look for the first element that changed
  let found: [number, Result<T, E>] | undefined = undefined;
  while (i < slice.length) {
    const t = slice[i]!;
    const idx = i;
    i++;
    const new_t = d_T.try_fold_with(t, folder);
    if (new_t.$ === "Ok" && eq_T(new_t._0, t)) continue;
    found = [idx, new_t];
    break;
  }
  if (found !== undefined && found[1].$ === "Ok") {
    const [idx, r] = found;
    const new_t = (r as { _0: T })._0;
    // An element changed, prepare to intern the resulting list
    const new_list: T[] = slice.slice(0, idx);
    new_list.push(new_t);
    for (; i < slice.length; i++) {
      const r2 = d_T.try_fold_with(slice[i]!, folder);
      if (r2.$ === "Err") return r2;
      new_list.push(r2._0);
    }
    return Ok(intern(folder.cx(), new_list));
  } else if (found !== undefined) {
    const err = found[1];
    return err as Result<never, E>;
  } else {
    return Ok(list);
  }
}

// PORT: the unit struct is its name (as `FoundFlags` in rustc_type_ir visit.ts).
// rustc-type: compiler/rustc_middle/src/ty/util.rs:1678 AlwaysRequiresDrop
// #[derive(Copy, Clone, Debug, StableHash, TyEncodable, TyDecodable)]
export type AlwaysRequiresDrop = "AlwaysRequiresDrop";
export const AlwaysRequiresDrop: AlwaysRequiresDrop = "AlwaysRequiresDrop";
export const debug_AlwaysRequiresDrop: Debug<AlwaysRequiresDrop> = (v) => v;

/// Reveals all opaque types in the given value, replacing them
/// with their underlying types.
// rustc: compiler/rustc_middle/src/ty/util.rs:1682 reveal_opaque_types_in_bounds
export function reveal_opaque_types_in_bounds(tcx: TyCtxt, val: Clauses): Clauses {
  assert(!tcx.next_trait_solver_globally(), "assertion failed: !tcx.next_trait_solver_globally()");
  const visitor = new OpaqueTypeExpander(new DefIdSet(), new KeyedMap<[DefId, GenericArgs], Ty>(intern_key), undefined, false, false, false, tcx);
  return fold_Clauses.fold_with(val, visitor);
}

/// Determines whether an item is directly annotated with `doc(hidden)`.
// rustc: compiler/rustc_middle/src/ty/util.rs:1700 is_doc_hidden
function is_doc_hidden(tcx: TyCtxt, def_id: LocalDefId): boolean {
  return find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) => (k.$ === "Doc" && k._0.hidden !== undefined ? null : undefined)) !== undefined;
}

/// Determines whether an item is annotated with `doc(notable_trait)`.
// rustc: compiler/rustc_middle/src/ty/util.rs:1705 is_doc_notable_trait
export function is_doc_notable_trait(tcx: TyCtxt, def_id: DefId): boolean {
  return find_attr(HasAttrs_DefId.get_attrs(def_id, tcx), (k) => (k.$ === "Doc" && k._0.notable_trait !== undefined ? null : undefined)) !== undefined;
}

/// Determines whether an item is an intrinsic (which may be via Abi or via the `rustc_intrinsic` attribute).
///
/// We double check the feature gate here because whether a function may be defined as an intrinsic causes
/// the compiler to make some assumptions about its shape; if the user doesn't use a feature gate, they may
/// cause an ICE that we otherwise may want to prevent.
// rustc: compiler/rustc_middle/src/ty/util.rs:1714 intrinsic_raw
export function intrinsic_raw(tcx: TyCtxt, def_id: LocalDefId): IntrinsicDefView | undefined {
  if (tcx.features().intrinsics() && find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) => (k.$ === "RustcIntrinsic" ? null : undefined)) !== undefined) {
    const node = tcx.hir_node_by_def_id(def_id);
    let must_be_overridden: boolean;
    if (node.$ === "Item" && node._0.kind.$ === "Fn") {
      const has_body = node._0.kind.has_body;
      must_be_overridden = !has_body;
    } else {
      must_be_overridden = true;
    }
    return {
      name: tcx.item_name(def_id),
      must_be_overridden,
      const_stable_indirect: find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) => (k.$ === "RustcIntrinsicConstStableIndirect" ? null : undefined)) !== undefined,
    };
  } else {
    return undefined;
  }
}

// rustc: compiler/rustc_middle/src/ty/util.rs:1732 provide
export function provide(providers: Providers): void {
  // PORT: `*providers = Providers { reveal_opaque_types_in_bounds, .., ..*providers }`; the
  // `reveal_opaque_types_in_bounds` query key / value are `unknown` in queries.gen.ts.
  providers.reveal_opaque_types_in_bounds = (tcx, key) => reveal_opaque_types_in_bounds(tcx, key as Clauses);
  providers.is_doc_hidden = is_doc_hidden;
  providers.is_doc_notable_trait = is_doc_notable_trait;
  providers.intrinsic_raw = intrinsic_raw;
}

// ---- local helpers (not upstream fns) ----

/** `HashSet::insert` / `GrowableBitSet::insert`: adds `v`, returns whether it was not present. */
function insert<T>(set: Set<T>, v: T): boolean {
  if (set.has(v)) return false;
  set.add(v);
  return true;
}

/** `i128::MAX` */
const I128_MAX = (1n << 127n) - 1n;
/** `std::char::MAX as u128` */
const CHAR_MAX = 0x10ffffn;

/** Release-mode (wrapping) `i128` arithmetic: rustc ships without overflow checks. */
function i128_wrapping(v: bigint): bigint {
  return BigInt.asIntN(128, v);
}
/** Release-mode (wrapping) `u128` arithmetic: rustc ships without overflow checks. */
function u128_wrapping(v: bigint): bigint {
  return BigInt.asUintN(128, v);
}

/** `(Ty, Ty): TypeFoldable` / `TypeVisitable` (fold.rs's / visit.rs's tuple impls) over `fold_Ty`. */
const fold_Ty_Ty: TypeFoldable<[Ty, Ty]> = {
  try_fold_with(self, folder) {
    const a = fold_Ty.try_fold_with(self[0], folder);
    if (a.$ === "Err") return a;
    const b = fold_Ty.try_fold_with(self[1], folder);
    if (b.$ === "Err") return b;
    return Ok([a._0, b._0]);
  },
  fold_with(self, folder) {
    return [fold_Ty.fold_with(self[0], folder), fold_Ty.fold_with(self[1], folder)];
  },
  visit_with(self, visitor) {
    return visit_with_tuple2(self, visitor, fold_Ty.visit_with, fold_Ty.visit_with);
  },
};

// ==== stand-ins (PORT: pending other lanes / crates). Root deletes each when its owner lands and points the uses at
// the real port; bodies are upstream's where they only read fields / build a struct, `unported` otherwise. ====

// ---- rustc_abi (lib.rs) and rustc_middle ty/layout.rs (M4) ----
// lane repr-options: `IntegerType` is the real rustc_abi type (abi/lib.rs:123).
import type { IntegerType } from "../../rustc_abi/lib.ts";
export type { IntegerType };
// `IntegerExt::{from_int_ty, from_uint_ty, to_ty}` (layout.rs:47/:58/:31): ty/layout.ts (lane typeck-gaps); read inside
// function bodies (layout.ts is an extension module).
function IntegerExt_from_int_ty(cx: TyCtxt, ity: IntTy): Integer {
  return IntegerExt.from_int_ty(cx, ity);
}
function IntegerExt_from_uint_ty(cx: TyCtxt, ity: UintTy): Integer {
  return IntegerExt.from_uint_ty(cx, ity);
}
function IntegerExt_to_ty(self: Integer, tcx: TyCtxt, signed: boolean): Ty {
  return IntegerExt.to_ty(self, tcx, signed);
}
/** PORT: pending ty/layout.rs (M4): `FloatExt::from_float_ty` (layout.rs:157). */
function FloatExt_from_float_ty(_fty: FloatTy): FloatT {
  return unported("rustc_middle::ty::layout::FloatExt::from_float_ty (ty/layout.rs, M4)");
}
/** PORT: pending rustc_abi: `Float` (abi/lib.rs). */
type FloatT = { readonly __pending: "rustc_abi::Float" };
/** PORT: pending rustc_abi: `Float::size`. */
function Float_size(_self: FloatT): Size {
  return unported("rustc_abi::Float::size (rustc_abi is partly ported)");
}
// rustc_abi's `Integer::size` / `Size::{sign_extend, truncate, signed_int_min, signed_int_max, unsigned_int_max}`
// (abi/lib.rs:1293, :958-995) are ported (rustc_abi lib.ts); these names stay as thin forwarders (lane typeck-gaps).
function Integer_size(self: Integer): Size {
  return IntegerC.size(self);
}
function Size_sign_extend(self: Size, value: bigint): bigint {
  return self.sign_extend(value);
}
function Size_truncate(self: Size, value: bigint): bigint {
  return self.truncate(value);
}
function Size_signed_int_min(self: Size): bigint {
  return self.signed_int_min();
}
function Size_signed_int_max(self: Size): bigint {
  return self.signed_int_max();
}
function Size_unsigned_int_max(self: Size): bigint {
  return self.unsigned_int_max();
}

// ---- rustc_middle mir (M4) ----
/** PORT: pending mir/consts.rs (M4): `mir::Const::from_bits`. */
function mir_Const_from_bits(_tcx: TyCtxt, _bits: bigint, _typing_env: TypingEnv, _ty: Ty): Const {
  return unported("rustc_middle::mir::Const::from_bits (mir/consts.rs, M4)");
}

// ---- rustc_middle middle/codegen_fn_attrs.rs ----
/** `codegen_fn_attrs(def_id).flags.contains(CodegenFnAttrFlags::THREAD_LOCAL)` (the query value is `unknown` in queries.gen.ts). */
function CodegenFnAttrs_flags_contains_THREAD_LOCAL(attrs: unknown): boolean {
  return CodegenFnAttrFlags.contains((attrs as CodegenFnAttrs).flags, CodegenFnAttrFlags.THREAD_LOCAL);
}

// ---- lane ty-mod (ty/mod.rs) ----
/** PORT: pending ty-mod: `ty::IntrinsicDef` (ty/intrinsic.rs:8) as built here. */
export interface IntrinsicDefView {
  name: import("../../rustc_span/symbol.ts").Symbol;
  /// Whether the intrinsic has no meaningful body and all backends need to shim all calls to it.
  must_be_overridden: boolean;
  /// Whether the intrinsic can be invoked from stable const fn (`#[rustc_intrinsic_const_stable_indirect]`).
  const_stable_indirect: boolean;
}

/** PORT (merge-w15b): rustc_middle traits/mod.ts reaches this module back through rustc_type_ir: loaded lazily. */
function traits_mod(): typeof import("../traits/mod.ts") {
  return (traits_mod__m ??= require("../traits/mod.ts") as typeof import("../traits/mod.ts"));
}
var traits_mod__m: typeof import("../traits/mod.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
