// Port of compiler/rustc_middle/src/ty/sty.rs (lane ty-sty).
//
//! This module contains `TyKind` and its major components.
//
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes;
// its top-level code touches only the classes it imports (`Ty`, `RawList`). The methods of `Ty` / `RawList` are
// declared in ty/decls.ts (`// ty/sty.rs:<line>` lines); the statics are the `namespace Ty` augmentation there.
//
// PORT notes:
// - `#[instrument]` / `tracing::instrument` produce no output in the oracle and are left out.
// - `cfg!(debug_assertions)` blocks are commented out (the oracle is a release build; PORTING §3), the
//   `debug_assert*!` macros stay as comments.
// - `impl inherent::Ty for Ty` (:929) forwards to the inherent fns: where the names and signatures agree, TS has one
//   function, which carries both markers (the inherent one and the trait impl's, PORTING §8). `inherent::Ty::new_param`
//   is `Ty.ir_new_param` (ty-contract decision 5). `has_unsafe_fields` (:1122) forwards to `Ty::has_unsafe_fields` of
//   ty/util.rs:1275 (util.ts), which defines the one method (merge-w15b).
// - Stand-ins for fns of other files that are not ported yet (`AdtDef`, `VariantDef`, `ValTree`,
//   `ParamEnv`, `CoroutineLayout`, ...) are at the end of the file: module-local, not markers, each calls
//   `unported`. Root repoints them when their lanes land.
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type { FloatTy, IntTy, Mutability, Pinnedness, UintTy } from "../../rustc_ast_ir/lib.ts";
import { FloatTy as FloatTyC, IntTy as IntTyC, UintTy as UintTyC } from "../../rustc_ast_ir/lib.ts";
import { type ControlFlow, ControlFlow as ControlFlowC, type VisitorResult, VisitorResult as VisitorResultC } from "../../rustc_ast_ir/visit.ts";
import { into_MultiSpan, type MultiSpan } from "../../rustc_error_messages/lib.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { DUMMY_SP } from "../../rustc_span/span_encoding.ts";
import { kw, sym, type Symbol } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { BoundTy, BoundVar, ClosureKind, DebruijnIndex, FloatVid, InferTy, IntVid, IsRigid, Pending, PlaceholderType, PolyExistentialPredicate, TyVid } from "../../rustc_type_ir/decls.ts";
import { fold_tuple2, type PredicateProxy } from "../../rustc_type_ir/fold.ts";
import type { Symbol_static } from "../../rustc_type_ir/inherent.ts";
import { CollectAndApply_T, type CollectAndApply_Result } from "../../rustc_type_ir/interner.ts";
import { SizedTraitKind } from "../../rustc_type_ir/solve/mod.ts";
import { Const, fold_Const, type Region } from "../../rustc_type_ir/sty/mod.ts";
import { AliasTy, debug_TyKind, PolyFnSig as PolyFnSigC, TyKind as TyKindC, UnsafeBinderInner } from "../../rustc_type_ir/ty_kind.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs } from "../../rustc_type_ir/ty_kind/closure.ts";
import { debug_Unnormalized, Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import { TypeWalker } from "../../rustc_type_ir/walk.ts";
import { type Fmt, PLAIN, PRETTY } from "../../std/fmt.ts";
import { assert, assert_eq, panic, unported, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { TyCtxt } from "./context.ts";
import type { AdtDef, Discr, FieldIdx, NumScalableVectors, ObligationCause, ParamEnv, Pattern, Range, VariantIdx } from "./decls.ts";
import { GenericArg, type GenericArgs } from "./generic_args.ts";
import type { GenericParamDef, Generics } from "./generics.ts";
import { type Clauses, type List, RawList } from "./list.ts";
import { debug_ParamEnv, debug_Ty, type FieldDef, Ty, type VariantDef } from "./mod.ts";
import { AdtFlags } from "./adt.ts";
import type { Clause } from "./predicate.ts";
import * as gen from "./sty.gen.ts";
import type { TyKind } from "./sty.gen.ts";
import { fold_Ty } from "./structural_impls.ts";
import { ValTree } from "./consts/valtree.ts";
import { ScalarInt } from "./consts/int.ts";
import { debug_ParamConst } from "./structural_impls.ts";

// The types of this file with their derived Debug / TypeVisitable / TypeFoldable impls are generated into sty.gen.ts
// (set rustc_ty of tools/codegen/types.ts, lane codegen-tyir); merged with the contract stub by merge-w13.
export * from "./sty.gen.ts";

// `impl fmt::Debug for ty::ParamTy` (structural_impls.rs:88): the stub lives in structural_impls.ts (merge-w15a: defining
// modules import it from there, not from this extension module); re-exported for generated code.
export { debug_ParamTy } from "./structural_impls.ts";

// PORT (init order): print/pretty.ts is an extension module that sty.ts must not load at its top level (generated
// rustc_type_ir modules reach sty.ts early for `debug_ParamTy`); `Display for Ty` is required at call time (same
// precedent as rustc_type_ir sty/mod.ts).
function pretty(): typeof import("./print/pretty.ts") {
  return (pretty__m ??= require("./print/pretty.ts") as typeof import("./print/pretty.ts"));
}
var pretty__m: typeof import("./print/pretty.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)

// ---- Article ------------------------------------------------------------------------------------------------------

// rustc-trait: compiler/rustc_middle/src/ty/sty.rs:65 Article
export interface Article<T> {
  // rustc: compiler/rustc_middle/src/ty/sty.rs:66 article
  article(self: T): string;
}

export const Article_TyKind: Article<TyKind> = {
  /// Get the article ("a" or "an") to use with this type.
  // rustc: compiler/rustc_middle/src/ty/sty.rs:71 article
  article(self: TyKind): string {
    if (self.$ === "Int" || self.$ === "Float" || self.$ === "Array") {
      return "an";
    } else if (self.$ === "Adt" && self._0.is_enum()) {
      return "an";
    } else if (self.$ === "Error") {
      // This should never happen, but ICEing and causing the user's code
      // to not compile felt too harsh.
      return "a";
    } else {
      return "a";
    }
  },
};

// ---- CoroutineArgsExt ---------------------------------------------------------------------------------------------

// PORT: `#[extension(pub trait CoroutineArgsExt<'tcx>)] impl ty::CoroutineArgs<TyCtxt<'tcx>>`: a companion taking
// `self` first (tyir-kind decision 1); its associated consts are fields.
export const CoroutineArgsExt = {
  /// Coroutine has not been resumed yet.
  UNRESUMED: 0,
  /// Coroutine has returned or is completed.
  RETURNED: 1,
  /// Coroutine has been poisoned.
  POISONED: 2,
  /// Number of variants to reserve in coroutine state. Corresponds to
  /// `UNRESUMED` (beginning of a coroutine) and `RETURNED`/`POISONED`
  /// (end of a coroutine) states.
  RESERVED_VARIANTS: 3,

  UNRESUMED_NAME: "Unresumed",
  RETURNED_NAME: "Returned",
  POISONED_NAME: "Panicked",

  /// The valid variant indices of this coroutine.
  // rustc: compiler/rustc_middle/src/ty/sty.rs:102 variant_range
  variant_range(self: CoroutineArgs, def_id: DefId, tcx: TyCtxt): Range<VariantIdx> {
    // FIXME requires optimized MIR
    return {
      start: FIRST_VARIANT,
      end: CoroutineLayout_variant_fields(unwrap_layout(tcx.coroutine_layout(def_id, self.args))).length as VariantIdx,
    };
  },

  /// The discriminant for the given variant. Panics if the `variant_index` is
  /// out of range.
  // rustc: compiler/rustc_middle/src/ty/sty.rs:110 discriminant_for_variant
  discriminant_for_variant(self: CoroutineArgs, def_id: DefId, tcx: TyCtxt, variant_index: VariantIdx): Discr {
    // Coroutines don't support explicit discriminant values, so they are
    // the same as the variant index.
    assert(range_contains(CoroutineArgsExt.variant_range(self, def_id, tcx), variant_index), "assertion failed: self.variant_range(def_id, tcx).contains(&variant_index)");
    return new (ty_util().Discr)(BigInt(variant_index), CoroutineArgsExt.discr_ty(self, tcx));
  },

  /// The set of all discriminants for the coroutine, enumerated with their
  /// variant indices.
  // PORT: `impl Iterator` is a generator (the range is computed eagerly, as upstream's `self.variant_range(..)`).
  // rustc: compiler/rustc_middle/src/ty/sty.rs:125 discriminants
  discriminants(self: CoroutineArgs, def_id: DefId, tcx: TyCtxt): Iterable<[VariantIdx, Discr]> {
    const range = CoroutineArgsExt.variant_range(self, def_id, tcx);
    return (function* (): Generator<[VariantIdx, Discr]> {
      for (let index = range.start; index < range.end; index = (index + 1) as VariantIdx) {
        yield [index, new (ty_util().Discr)(BigInt(index), CoroutineArgsExt.discr_ty(self, tcx))];
      }
    })();
  },

  /// Calls `f` with a reference to the name of the enumerator for the given
  /// variant `v`.
  // rustc: compiler/rustc_middle/src/ty/sty.rs:137 variant_name
  variant_name(v: VariantIdx): string {
    switch (v) {
      case CoroutineArgsExt.UNRESUMED:
        return CoroutineArgsExt.UNRESUMED_NAME;
      case CoroutineArgsExt.RETURNED:
        return CoroutineArgsExt.RETURNED_NAME;
      case CoroutineArgsExt.POISONED:
        return CoroutineArgsExt.POISONED_NAME;
      default:
        return `Suspend${v - CoroutineArgsExt.RESERVED_VARIANTS}`;
    }
  },

  /// The type of the state discriminant used in the coroutine type.
  // rustc: compiler/rustc_middle/src/ty/sty.rs:148 discr_ty
  discr_ty(_self: CoroutineArgs, tcx: TyCtxt): Ty {
    return tcx.types.u32;
  },

  /// This returns the types of the MIR locals which had to be stored across suspension points.
  /// It is calculated in rustc_mir_transform::coroutine::StateTransform.
  /// All the types here must be in the tuple in CoroutineInterior.
  ///
  /// The locals are grouped by their variant number. Note that some locals may
  /// be repeated in multiple variants.
  // PORT: the nested lazy iterators are generators.
  // rustc: compiler/rustc_middle/src/ty/sty.rs:159 state_tys
  state_tys(self: CoroutineArgs, def_id: DefId, tcx: TyCtxt): Iterable<Iterable<Ty>> {
    const layout = unwrap_layout(tcx.coroutine_layout(def_id, self.args));
    return (function* (): Generator<Iterable<Ty>> {
      for (const variant of CoroutineLayout_variant_fields(layout)) {
        yield (function* (): Generator<Ty> {
          for (const field of variant) {
            if (tcx.is_async_drop_in_place_coroutine(def_id)) {
              yield CoroutineLayout_field_ty(layout, field);
            } else {
              yield Unnormalized.skip_norm_wip(
                EarlyBinder.instantiate(EarlyBinder.bind(tcx, CoroutineLayout_field_ty(layout, field), fold_Ty), tcx, self.args, fold_Ty),
              );
            }
          }
        })();
      }
    })();
  },
};

// ---- UpvarArgs ----------------------------------------------------------------------------------------------------

export type UpvarArgs = gen.UpvarArgs;
export const UpvarArgs = {
  /// Returns an iterator over the list of types of captured paths by the closure/coroutine.
  /// In case there was a type error in figuring out the types of the captured path, an
  /// empty iterator is returned.
  // rustc: compiler/rustc_middle/src/ty/sty.rs:191 upvar_tys
  upvar_tys(self: UpvarArgs): List<Ty> {
    const ty = UpvarArgs.tupled_upvars_ty(self).kind();
    switch (ty.$) {
      case "Error":
        return RawList.empty() as List<Ty>;
      case "Tuple":
        return ty._0;
      case "Infer":
        return bug("upvar_tys called before capture types are inferred");
      default:
        return bug(`Unexpected representation of upvar types tuple ${debug_TyKind(ty, PLAIN)}`);
    }
  },

  // rustc: compiler/rustc_middle/src/ty/sty.rs:201 tupled_upvars_ty
  tupled_upvars_ty(self: UpvarArgs): Ty {
    switch (self.$) {
      case "Closure":
        return ClosureArgs.tupled_upvars_ty(self._0.as_closure());
      case "Coroutine":
        return CoroutineArgs.tupled_upvars_ty(self._0.as_coroutine());
      case "CoroutineClosure":
        return CoroutineClosureArgs.tupled_upvars_ty(self._0.as_coroutine_closure());
    }
  },
};

// ---- InlineConstArgs ----------------------------------------------------------------------------------------------

export type InlineConstArgs = gen.InlineConstArgs;
export const InlineConstArgs = {
  /// Construct `InlineConstArgs` from `InlineConstArgsParts`.
  // rustc: compiler/rustc_middle/src/ty/sty.rs:239 new
  new(tcx: TyCtxt, parts: gen.InlineConstArgsParts<Ty>): InlineConstArgs {
    return {
      args: tcx.mk_args_from_iter(
        (function* (): Generator<GenericArg> {
          yield* parts.parent_args;
          yield GenericArg.from_Ty(parts.ty);
        })(),
      ),
    };
  },

  /// Divides the inline const args into their respective components.
  /// The ordering assumed here must match that used by `InlineConstArgs::new` above.
  // rustc: compiler/rustc_middle/src/ty/sty.rs:252 split
  split(self: InlineConstArgs): gen.InlineConstArgsParts<GenericArg> {
    const args = self.args;
    if (args.length >= 1) {
      const parent_args = args.slice(0, args.length - 1);
      const ty = args[args.length - 1]!;
      return { parent_args, ty };
    } else {
      return bug("inline const args missing synthetics");
    }
  },

  /// Returns the generic parameters of the inline const's parent.
  // rustc: compiler/rustc_middle/src/ty/sty.rs:260 parent_args
  parent_args(self: InlineConstArgs): readonly GenericArg[] {
    return InlineConstArgs.split(self).parent_args;
  },

  /// Returns the type of this inline const.
  // rustc: compiler/rustc_middle/src/ty/sty.rs:265 ty
  ty(self: InlineConstArgs): Ty {
    return GenericArg.expect_ty(InlineConstArgs.split(self).ty);
  },
};

// ---- ParamTy ------------------------------------------------------------------------------------------------------

export type ParamTy = gen.ParamTy;
export const ParamTy = {
  // `impl rustc_type_ir::inherent::ParamLike for ParamTy`
  // rustc: compiler/rustc_middle/src/ty/sty.rs:281 index
  index(self: ParamTy): number {
    return self.index;
  },

  // rustc: compiler/rustc_middle/src/ty/sty.rs:287 new
  new(index: number, name: Symbol): ParamTy {
    return { index, name };
  },

  // rustc: compiler/rustc_middle/src/ty/sty.rs:291 for_def
  for_def(def: GenericParamDef): ParamTy {
    return ParamTy.new(def.index, def.name);
  },

  // rustc: compiler/rustc_middle/src/ty/sty.rs:296 to_ty
  to_ty(self: ParamTy, tcx: TyCtxt): Ty {
    return Ty.new_param(tcx, self.index, self.name);
  },

  // rustc: compiler/rustc_middle/src/ty/sty.rs:300 span_from_generics
  span_from_generics(self: ParamTy, tcx: TyCtxt, item_with_generics: DefId): Span {
    // PORT: the `generics_of` query value is typed `unknown` by queries.gen.ts (merge-w15a note).
    const generics = tcx.generics_of(item_with_generics) as Generics;
    const type_param = generics.type_param(self, tcx);
    return tcx.def_span(type_param.def_id);
  },
};

// ---- ParamConst ---------------------------------------------------------------------------------------------------

export type ParamConst = gen.ParamConst;
export const ParamConst = {
  // `impl rustc_type_ir::inherent::ParamLike for ParamConst`
  // rustc: compiler/rustc_middle/src/ty/sty.rs:315 index
  index(self: ParamConst): number {
    return self.index;
  },

  // rustc: compiler/rustc_middle/src/ty/sty.rs:321 new
  new(index: number, name: Symbol): ParamConst {
    return { index, name };
  },

  // rustc: compiler/rustc_middle/src/ty/sty.rs:325 for_def
  for_def(def: GenericParamDef): ParamConst {
    return ParamConst.new(def.index, def.name);
  },

  // rustc: compiler/rustc_middle/src/ty/sty.rs:330 find_const_ty_from_env
  find_const_ty_from_env(self: ParamConst, env: ParamEnv): Ty {
    // PORT: the lazy `filter_map` iterator is a generator (the closure runs as `next()` pulls), as tyir-binder's
    // `PlaceholderConst::find_const_ty_from_env`.
    const candidates = (function* (): Generator<Ty> {
      for (const clause of env.caller_bounds()) {
        // `ConstArgHasType` are never desugared to be higher ranked.
        const k = Binder.skip_binder(clause.kind());
        if (k.$ === "ConstArgHasType") {
          const param_ct = k._0;
          const ty = k._1;
          assert(!TypeVisitableExt.has_escaping_bound_vars<[Const, Ty]>([param_ct, ty], fold_tuple2(fold_Const, fold_Ty)), "assertion failed: !(param_ct, ty).has_escaping_bound_vars()");

          const ck = param_ct.kind();
          if (ck.$ === "Param" && ck._0.index === self.index) {
            yield ty;
          }
        }
      }
    })();

    // N.B. it may be tempting to fix ICEs by making this function return
    // `Option<Ty<'tcx>>` instead of `Ty<'tcx>`; however, this is generally
    // considered to be a bandaid solution, since it hides more important
    // underlying issues with how we construct generics and predicates of
    // items. It's advised to fix the underlying issue rather than trying
    // to modify this function.
    const first = candidates.next();
    if (first.done) {
      return bug(`cannot find \`${debug_ParamConst(self, PLAIN)}\` in param-env: ${debug_ParamEnv(env, PRETTY)}`);
    }
    const ty = first.value;
    if (candidates.next().done !== true) {
      // `assert!(candidates.next().is_none(), ..)`: the message is formatted only when the assertion fails.
      return panic(`did not expect duplicate \`ConstParamHasTy\` for \`${debug_ParamConst(self, PLAIN)}\` in param-env: ${debug_ParamEnv(env, PRETTY)}`);
    }
    return ty;
  },
};

// ---- Constructors for `Ty` ----------------------------------------------------------------------------------------

/// Constructors for `Ty`
// `Ty::new` (:368) is the class `static` in ty/mod.ts.

// rustc: compiler/rustc_middle/src/ty/sty.rs:373 new_infer
// rustc: compiler/rustc_middle/src/ty/sty.rs:938 new_infer
Ty.new_infer = function (tcx: TyCtxt, infer: InferTy): Ty {
  return Ty.new(tcx, { $: "Infer", _0: infer });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:378 new_var
// rustc: compiler/rustc_middle/src/ty/sty.rs:942 new_var
Ty.new_var = function (tcx: TyCtxt, v: TyVid): Ty {
  // Use a pre-interned one when possible.
  return tcx.types.ty_vars[v] ?? Ty.new(tcx, { $: "Infer", _0: { $: "TyVar", _0: v } });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:388 new_int_var
Ty.new_int_var = function (tcx: TyCtxt, v: IntVid): Ty {
  return Ty.new_infer(tcx, { $: "IntVar", _0: v });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:393 new_float_var
Ty.new_float_var = function (tcx: TyCtxt, v: FloatVid): Ty {
  return Ty.new_infer(tcx, { $: "FloatVar", _0: v });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:398 new_fresh
Ty.new_fresh = function (tcx: TyCtxt, n: number): Ty {
  // Use a pre-interned one when possible.
  return tcx.types.fresh_tys[n] ?? Ty.new_infer(tcx, { $: "FreshTy", _0: n });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:408 new_fresh_int
Ty.new_fresh_int = function (tcx: TyCtxt, n: number): Ty {
  // Use a pre-interned one when possible.
  return tcx.types.fresh_int_tys[n] ?? Ty.new_infer(tcx, { $: "FreshIntTy", _0: n });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:418 new_fresh_float
Ty.new_fresh_float = function (tcx: TyCtxt, n: number): Ty {
  // Use a pre-interned one when possible.
  return tcx.types.fresh_float_tys[n] ?? Ty.new_infer(tcx, { $: "FreshFloatTy", _0: n });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:428 new_param
Ty.new_param = function (tcx: TyCtxt, index: number, name: Symbol): Ty {
  return Ty.new(tcx, { $: "Param", _0: { index, name } });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:433 new_bound
// rustc: compiler/rustc_middle/src/ty/sty.rs:954 new_bound
Ty.new_bound = function (tcx: TyCtxt, index: DebruijnIndex, bound_ty: BoundTy): Ty {
  // Use a pre-interned one when possible.
  let inner: readonly Ty[] | undefined;
  let ty: Ty | undefined;
  if (
    bound_ty.kind.$ === "Anon" &&
    (inner = tcx.types.anon_bound_tys[index]) !== undefined &&
    (ty = inner[bound_ty.var]) !== undefined
  ) {
    return ty;
  } else {
    return Ty.new(tcx, { $: "Bound", _0: { $: "Bound", _0: index }, _1: bound_ty });
  }
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:450 new_canonical_bound
// rustc: compiler/rustc_middle/src/ty/sty.rs:966 new_canonical_bound
Ty.new_canonical_bound = function (tcx: TyCtxt, var_: BoundVar): Ty {
  // Use a pre-interned one when possible.
  const ty = tcx.types.anon_canonical_bound_tys[var_];
  if (ty !== undefined) {
    return ty;
  } else {
    return Ty.new(tcx, {
      $: "Bound",
      _0: { $: "Canonical" },
      _1: { var: var_, kind: { $: "Anon" } },
    });
  }
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:466 new_placeholder
// rustc: compiler/rustc_middle/src/ty/sty.rs:950 new_placeholder
Ty.new_placeholder = function (tcx: TyCtxt, placeholder: PlaceholderType): Ty {
  return Ty.new(tcx, { $: "Placeholder", _0: placeholder });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:471 new_alias
// rustc: compiler/rustc_middle/src/ty/sty.rs:970 new_alias
Ty.new_alias = function (tcx: TyCtxt, is_rigid: IsRigid, alias_ty: gen.AliasTy): Ty {
  return Ty.new(tcx, { $: "Alias", _0: is_rigid, _1: alias_ty });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:480 new_pat
// rustc: compiler/rustc_middle/src/ty/sty.rs:1102 new_pat
Ty.new_pat = function (tcx: TyCtxt, base: Ty, pat: Pattern): Ty {
  return Ty.new(tcx, { $: "Pat", _0: base, _1: pat });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:485 new_field_representing_type
Ty.new_field_representing_type = function (tcx: TyCtxt, base: Ty, variant: VariantIdx, field: FieldIdx): Ty {
  const did = tcx.lang_items().field_representing_type();
  if (did === undefined) {
    return bug("could not locate the `FieldRepresentingType` lang item");
  }
  // PORT: the `adt_def` query value is typed `unknown` by queries.gen.ts.
  const def = tcx.adt_def(did) as AdtDef;
  const args = tcx.mk_args([
    GenericArg.from_Ty(base),
    GenericArg.from_Const(Const.new_value(tcx, ValTree.from_scalar_int(tcx, ScalarInt.from_u32(variant)), tcx.types.u32)),
    GenericArg.from_Const(Const.new_value(tcx, ValTree.from_scalar_int(tcx, ScalarInt.from_u32(field)), tcx.types.u32)),
  ]);
  return Ty.new_adt(tcx, def, args);
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:515 new_opaque
Ty.new_opaque = function (tcx: TyCtxt, is_rigid: IsRigid, def_id: DefId, args: GenericArgs): Ty {
  return Ty.new_alias(tcx, is_rigid, AliasTy.new_from_args(tcx, { $: "Opaque", def_id }, args));
};

/// Constructs a `TyKind::Error` type with current `ErrorGuaranteed`
// rustc: compiler/rustc_middle/src/ty/sty.rs:525 new_error
// rustc: compiler/rustc_middle/src/ty/sty.rs:978 new_error
Ty.new_error = function (tcx: TyCtxt, guar: ErrorGuaranteed): Ty {
  return Ty.new(tcx, { $: "Error", _0: guar });
};

/// Constructs a `TyKind::Error` type and registers a `span_delayed_bug` to ensure it gets used.
// rustc: compiler/rustc_middle/src/ty/sty.rs:531 new_misc_error
Ty.new_misc_error = function (tcx: TyCtxt): Ty {
  return Ty.new_error_with_message(tcx, into_MultiSpan(DUMMY_SP), "TyKind::Error constructed but no error reported");
};

/// Constructs a `TyKind::Error` type and registers a `span_delayed_bug` with the given `msg` to
/// ensure it gets used.
// rustc: compiler/rustc_middle/src/ty/sty.rs:538 new_error_with_message
Ty.new_error_with_message = function (tcx: TyCtxt, span: MultiSpan, msg: string): Ty {
  const reported = tcx.dcx().span_delayed_bug(span, msg);
  return Ty.new(tcx, { $: "Error", _0: reported });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:548 new_int
Ty.new_int = function (tcx: TyCtxt, i: IntTy): Ty {
  switch (i) {
    case "Isize":
      return tcx.types.isize;
    case "I8":
      return tcx.types.i8;
    case "I16":
      return tcx.types.i16;
    case "I32":
      return tcx.types.i32;
    case "I64":
      return tcx.types.i64;
    case "I128":
      return tcx.types.i128;
  }
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:561 new_uint
Ty.new_uint = function (tcx: TyCtxt, ui: UintTy): Ty {
  switch (ui) {
    case "Usize":
      return tcx.types.usize;
    case "U8":
      return tcx.types.u8;
    case "U16":
      return tcx.types.u16;
    case "U32":
      return tcx.types.u32;
    case "U64":
      return tcx.types.u64;
    case "U128":
      return tcx.types.u128;
  }
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:574 new_float
Ty.new_float = function (tcx: TyCtxt, f: FloatTy): Ty {
  switch (f) {
    case "F16":
      return tcx.types.f16;
    case "F32":
      return tcx.types.f32;
    case "F64":
      return tcx.types.f64;
    case "F128":
      return tcx.types.f128;
  }
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:585 new_ref
// rustc: compiler/rustc_middle/src/ty/sty.rs:1042 new_ref
Ty.new_ref = function (tcx: TyCtxt, r: Region, ty: Ty, mutbl: Mutability): Ty {
  return Ty.new(tcx, { $: "Ref", _0: r, _1: ty, _2: mutbl });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:595 new_mut_ref
Ty.new_mut_ref = function (tcx: TyCtxt, r: Region, ty: Ty): Ty {
  return Ty.new_ref(tcx, r, ty, "Mut");
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:600 new_imm_ref
Ty.new_imm_ref = function (tcx: TyCtxt, r: Region, ty: Ty): Ty {
  return Ty.new_ref(tcx, r, ty, "Not");
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:604 new_pinned_ref
Ty.new_pinned_ref = function (tcx: TyCtxt, r: Region, ty: Ty, mutbl: Mutability): Ty {
  const pin = tcx.adt_def(tcx.require_lang_item(LangItem.Pin, DUMMY_SP)) as AdtDef;
  return Ty.new_adt(tcx, pin, tcx.mk_args([GenericArg.from_Ty(Ty.new_ref(tcx, r, ty, mutbl))]));
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:615 new_ptr
// rustc: compiler/rustc_middle/src/ty/sty.rs:1038 new_ptr
Ty.new_ptr = function (tcx: TyCtxt, ty: Ty, mutbl: Mutability): Ty {
  return Ty.new(tcx, { $: "RawPtr", _0: ty, _1: mutbl });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:620 new_mut_ptr
Ty.new_mut_ptr = function (tcx: TyCtxt, ty: Ty): Ty {
  return Ty.new_ptr(tcx, ty, "Mut");
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:625 new_imm_ptr
Ty.new_imm_ptr = function (tcx: TyCtxt, ty: Ty): Ty {
  return Ty.new_ptr(tcx, ty, "Not");
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:630 new_adt
// rustc: compiler/rustc_middle/src/ty/sty.rs:982 new_adt
Ty.new_adt = function (tcx: TyCtxt, def: AdtDef, args: GenericArgs): Ty {
  tcx.debug_assert_args_compatible(def.did(), args);
  // PORT: `if cfg!(debug_assertions) { match tcx.def_kind(def.did()) { Struct | Union | Enum => {} .. =>
  // bug!("not an adt: {def:?} ({:?})", tcx.def_kind(def.did())) } }`: off in the release oracle.
  return Ty.new(tcx, { $: "Adt", _0: def, _1: args });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:671 new_foreign
// rustc: compiler/rustc_middle/src/ty/sty.rs:990 new_foreign
Ty.new_foreign = function (tcx: TyCtxt, def_id: DefId): Ty {
  return Ty.new(tcx, { $: "Foreign", _0: def_id });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:676 new_array
Ty.new_array = function (tcx: TyCtxt, ty: Ty, n: number): Ty {
  return Ty.new(tcx, { $: "Array", _0: ty, _1: Const.from_target_usize(tcx, n) });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:681 new_array_with_const_len
// rustc: compiler/rustc_middle/src/ty/sty.rs:1051 new_array_with_const_len
Ty.new_array_with_const_len = function (tcx: TyCtxt, ty: Ty, ct: Const): Ty {
  return Ty.new(tcx, { $: "Array", _0: ty, _1: ct });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:690 new_slice
// rustc: compiler/rustc_middle/src/ty/sty.rs:1055 new_slice
Ty.new_slice = function (tcx: TyCtxt, ty: Ty): Ty {
  return Ty.new(tcx, { $: "Slice", _0: ty });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:695 new_tup
// rustc: compiler/rustc_middle/src/ty/sty.rs:1059 new_tup
Ty.new_tup = function (tcx: TyCtxt, ts: readonly Ty[]): Ty {
  return ts.length === 0 ? tcx.types.unit : Ty.new(tcx, { $: "Tuple", _0: tcx.mk_type_list(ts) });
};

// PORT: `T: CollectAndApply` dispatches on the item type, which TS cannot see: an overload pair (ty-contract
// decision 6), `CollectAndApply_Result` as the last argument for `Result` items.
// rustc: compiler/rustc_middle/src/ty/sty.rs:699 new_tup_from_iter
// rustc: compiler/rustc_middle/src/ty/sty.rs:1063 new_tup_from_iter
Ty.new_tup_from_iter = function (tcx: TyCtxt, iter: Iterable<unknown>, c?: CollectAndApply_Result): unknown {
  const f = (ts: readonly Ty[]): Ty => Ty.new_tup(tcx, ts);
  return c === undefined ? CollectAndApply_T.collect_and_apply(iter as Iterable<Ty>, f) : c.collect_and_apply(iter as Iterable<Result<Ty, unknown>>, f);
} as typeof Ty.new_tup_from_iter;

/// Prefer using the [TyCtxt::type_of] query over this, that makes it easier to get all the pieces correct
// rustc: compiler/rustc_middle/src/ty/sty.rs:709 new_fn_def
// rustc: compiler/rustc_middle/src/ty/sty.rs:1090 new_fn_def
Ty.new_fn_def = function (tcx: TyCtxt, def_id: DefId, args: Binder<Iterable<GenericArg>>): Ty {
  // debug_assert_matches!(
  //     tcx.def_kind(def_id),
  //     DefKind::AssocFn | DefKind::Fn | DefKind::Ctor(_, CtorKind::Fn)
  // );
  const args_ = Binder.map_bound(args, (args) => tcx.check_and_mk_args(def_id, args));
  return Ty.new(tcx, { $: "FnDef", _0: def_id, _1: args_ });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:723 new_fn_ptr
// rustc: compiler/rustc_middle/src/ty/sty.rs:1098 new_fn_ptr
Ty.new_fn_ptr = function (tcx: TyCtxt, fty: Binder<gen.FnSig>): Ty {
  const [sig_tys, hdr] = PolyFnSigC.split(fty);
  return Ty.new(tcx, { $: "FnPtr", _0: sig_tys, _1: hdr });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:729 new_unsafe_binder
// rustc: compiler/rustc_middle/src/ty/sty.rs:1106 new_unsafe_binder
Ty.new_unsafe_binder = function (tcx: TyCtxt, b: Binder<Ty>): Ty {
  return Ty.new(tcx, { $: "UnsafeBinder", _0: UnsafeBinderInner.from_Binder(b) });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:734 new_dynamic
// rustc: compiler/rustc_middle/src/ty/sty.rs:994 new_dynamic
Ty.new_dynamic = function (tcx: TyCtxt, obj: List<PolyExistentialPredicate>, reg: Region): Ty {
  // PORT: `if cfg!(debug_assertions) { .. assert_eq!(projection_count, expected_count, "expected {obj:?} to have
  // {expected_count} projections, but it has {projection_count}") }` (the projection bounds of `obj` not requiring
  // `Self: Sized` against the elaborated supertraits' equality-constrainable associated items): off in the release
  // oracle.
  return Ty.new(tcx, { $: "Dynamic", _0: obj, _1: reg });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:770 new_projection_from_args
Ty.new_projection_from_args = function (tcx: TyCtxt, is_rigid: IsRigid, item_def_id: DefId, args: GenericArgs): Ty {
  return Ty.new_alias(tcx, is_rigid, AliasTy.new_from_args(tcx, { $: "Projection", def_id: item_def_id }, args));
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:784 new_projection
Ty.new_projection = function (tcx: TyCtxt, is_rigid: IsRigid, item_def_id: DefId, args: Iterable<GenericArg>): Ty {
  return Ty.new_alias(tcx, is_rigid, AliasTy.new(tcx, { $: "Projection", def_id: item_def_id }, args));
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:798 new_closure
// rustc: compiler/rustc_middle/src/ty/sty.rs:1018 new_closure
Ty.new_closure = function (tcx: TyCtxt, def_id: DefId, closure_args: GenericArgs): Ty {
  tcx.debug_assert_args_compatible(def_id, closure_args);
  return Ty.new(tcx, { $: "Closure", _0: def_id, _1: closure_args });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:808 new_coroutine_closure
// rustc: compiler/rustc_middle/src/ty/sty.rs:1010 new_coroutine_closure
Ty.new_coroutine_closure = function (tcx: TyCtxt, def_id: DefId, closure_args: GenericArgs): Ty {
  tcx.debug_assert_args_compatible(def_id, closure_args);
  return Ty.new(tcx, { $: "CoroutineClosure", _0: def_id, _1: closure_args });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:818 new_coroutine
// rustc: compiler/rustc_middle/src/ty/sty.rs:1002 new_coroutine
Ty.new_coroutine = function (tcx: TyCtxt, def_id: DefId, coroutine_args: GenericArgs): Ty {
  tcx.debug_assert_args_compatible(def_id, coroutine_args);
  return Ty.new(tcx, { $: "Coroutine", _0: def_id, _1: coroutine_args });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:828 new_coroutine_witness
// rustc: compiler/rustc_middle/src/ty/sty.rs:1022 new_coroutine_witness
Ty.new_coroutine_witness = function (tcx: TyCtxt, def_id: DefId, args: GenericArgs): Ty {
  // PORT: `if cfg!(debug_assertions) { tcx.debug_assert_args_compatible(tcx.typeck_root_def_id(def_id), args); }`:
  // off in the release oracle.
  return Ty.new(tcx, { $: "CoroutineWitness", _0: def_id, _1: args });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:839 new_coroutine_witness_for_coroutine
// rustc: compiler/rustc_middle/src/ty/sty.rs:1030 new_coroutine_witness_for_coroutine
Ty.new_coroutine_witness_for_coroutine = function (tcx: TyCtxt, def_id: DefId, coroutine_args: GenericArgs): Ty {
  tcx.debug_assert_args_compatible(def_id, coroutine_args);
  // HACK: Coroutine witness types are lifetime erased, so they
  // never reference any lifetime args from the coroutine. We erase
  // the regions here since we may get into situations where a
  // coroutine is recursively contained within itself, leading to
  // witness types that differ by region args. This means that
  // cycle detection in fulfillment will not kick in, which leads
  // to unnecessary overflows in async code. See the issue:
  // <https://github.com/rust-lang/rust/issues/145151>.
  const args = RawList.for_item(tcx, tcx.typeck_root_def_id(def_id), (def, _) => {
    switch (def.kind.$) {
      case "Lifetime":
        return GenericArg.from_Region(tcx.lifetimes.re_erased);
      case "Type":
      case "Const":
        return index_slice(coroutine_args, def.index);
    }
  });
  return Ty.new_coroutine_witness(tcx, def_id, args);
};

// misc

// rustc: compiler/rustc_middle/src/ty/sty.rs:867 new_static_str
Ty.new_static_str = function (tcx: TyCtxt): Ty {
  return Ty.new_imm_ref(tcx, tcx.lifetimes.re_static, tcx.types.str_);
};

// lang and diagnostic tys

// rustc: compiler/rustc_middle/src/ty/sty.rs:873 new_generic_adt
Ty.new_generic_adt = function (tcx: TyCtxt, wrapper_def_id: DefId, ty_param: Ty): Ty {
  const adt_def = tcx.adt_def(wrapper_def_id) as AdtDef;
  const args = RawList.for_item(tcx, wrapper_def_id, (param, args) => {
    const kind = param.kind;
    switch (kind.$) {
      case "Lifetime":
      case "Const":
        return bug();
      case "Type": {
        const has_default = kind.has_default;
        if (param.index === 0) {
          return GenericArg.from_Ty(ty_param);
        } else {
          assert(has_default, "assertion failed: has_default");
          // PORT: the `type_of` query value is typed `unknown` by queries.gen.ts (merge-w15a note).
          return GenericArg.from_Ty(Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(param.def_id) as EarlyBinder<Ty>, tcx, args, fold_Ty)));
        }
      }
    }
  });
  return Ty.new_adt(tcx, adt_def, args);
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:890 new_lang_item
Ty.new_lang_item = function (tcx: TyCtxt, ty: Ty, item: LangItem): Ty | undefined {
  const def_id = tcx.lang_items().get(item);
  if (def_id === undefined) return undefined;
  return Ty.new_generic_adt(tcx, def_id, ty);
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:896 new_diagnostic_item
Ty.new_diagnostic_item = function (tcx: TyCtxt, ty: Ty, name: Symbol): Ty | undefined {
  const def_id = tcx.get_diagnostic_item(name);
  if (def_id === undefined) return undefined;
  return Ty.new_generic_adt(tcx, def_id, ty);
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:902 new_box
Ty.new_box = function (tcx: TyCtxt, ty: Ty): Ty {
  const def_id = tcx.require_lang_item(LangItem.OwnedBox, DUMMY_SP);
  return Ty.new_generic_adt(tcx, def_id, ty);
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:908 new_option
Ty.new_option = function (tcx: TyCtxt, ty: Ty): Ty {
  const def_id = tcx.require_lang_item(LangItem.Option, DUMMY_SP);
  return Ty.new_generic_adt(tcx, def_id, ty);
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:914 new_maybe_uninit
Ty.new_maybe_uninit = function (tcx: TyCtxt, ty: Ty): Ty {
  const def_id = tcx.require_lang_item(LangItem.MaybeUninit, DUMMY_SP);
  return Ty.new_generic_adt(tcx, def_id, ty);
};

/// Creates a `&mut Context<'_>` [`Ty`] with erased lifetimes.
// rustc: compiler/rustc_middle/src/ty/sty.rs:920 new_task_context
Ty.new_task_context = function (tcx: TyCtxt): Ty {
  const context_did = tcx.require_lang_item(LangItem.Context, DUMMY_SP);
  const context_adt_ref = tcx.adt_def(context_did) as AdtDef;
  const context_args = tcx.mk_args([GenericArg.from_Region(tcx.lifetimes.re_erased)]);
  const context_ty = Ty.new_adt(tcx, context_adt_ref, context_args);
  return Ty.new_mut_ref(tcx, tcx.lifetimes.re_erased, context_ty);
};

// ---- impl rustc_type_ir::inherent::Ty<TyCtxt<'tcx>> for Ty<'tcx> ---------------------------------------------------
// The fns forwarding to an inherent fn of the same name and signature are that fn (markers above it).

// rustc: compiler/rustc_middle/src/ty/sty.rs:930 new_bool
Ty.new_bool = function (tcx: TyCtxt): Ty {
  return tcx.types.bool;
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:934 new_u8
Ty.new_u8 = function (tcx: TyCtxt): Ty {
  return tcx.types.u8;
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:946 new_param
Ty.ir_new_param = function (tcx: TyCtxt, param: ParamTy): Ty {
  return Ty.new_param(tcx, param.index, param.name);
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:962 new_anon_bound
Ty.new_anon_bound = function (tcx: TyCtxt, debruijn: DebruijnIndex, var_: BoundVar): Ty {
  return Ty.new_bound(tcx, debruijn, { var: var_, kind: { $: "Anon" } });
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1110 new_unit
Ty.new_unit = function (interner: TyCtxt): Ty {
  return interner.types.unit;
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1114 new_usize
Ty.new_usize = function (interner: TyCtxt): Ty {
  return interner.types.usize;
};

// ---- Type utilities -----------------------------------------------------------------------------------------------

/// Type utilities
// `Ty::kind` (:1134) is the class method in ty/mod.ts.

// rustc: compiler/rustc_middle/src/ty/sty.rs:1139 is_unit
Ty.prototype.is_unit = function (this: Ty): boolean {
  const k = this.kind();
  switch (k.$) {
    case "Tuple":
      return k._0.length === 0;
    default:
      return false;
  }
};

/// Check if type is an `usize`.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1148 is_usize
Ty.prototype.is_usize = function (this: Ty): boolean {
  const k = this.kind();
  return k.$ === "Uint" && k._0 === UintTyC.Usize;
};

/// Check if type is an `usize` or an integral type variable.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1154 is_usize_like
Ty.prototype.is_usize_like = function (this: Ty): boolean {
  const k = this.kind();
  return (k.$ === "Uint" && k._0 === UintTyC.Usize) || (k.$ === "Infer" && k._0.$ === "IntVar");
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1159 is_never
Ty.prototype.is_never = function (this: Ty): boolean {
  return this.kind().$ === "Never";
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1164 is_primitive
Ty.prototype.is_primitive = function (this: Ty): boolean {
  const k = this.kind();
  return k.$ === "Bool" || k.$ === "Char" || k.$ === "Int" || k.$ === "Uint" || k.$ === "Float";
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1169 is_adt
Ty.prototype.is_adt = function (this: Ty): boolean {
  return this.kind().$ === "Adt";
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1174 is_self_param
Ty.prototype.is_self_param = function (this: Ty): boolean {
  const k = this.kind();
  if (k.$ === "Param") {
    const param = k._0;
    return param.index === 0 && param.name === kw.SelfUpper;
  } else {
    return false;
  }
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1183 is_ref
Ty.prototype.is_ref = function (this: Ty): boolean {
  return this.kind().$ === "Ref";
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1188 is_ty_var
Ty.prototype.is_ty_var = function (this: Ty): boolean {
  const k = this.kind();
  return k.$ === "Infer" && k._0.$ === "TyVar";
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1193 ty_vid
Ty.prototype.ty_vid = function (this: Ty): TyVid | undefined {
  const k = this.kind();
  if (k.$ === "Infer" && k._0.$ === "TyVar") {
    return k._0._0;
  }
  return undefined;
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1201 float_vid
Ty.prototype.float_vid = function (this: Ty): FloatVid | undefined {
  const k = this.kind();
  if (k.$ === "Infer" && k._0.$ === "FloatVar") {
    return k._0._0;
  }
  return undefined;
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1209 is_ty_or_numeric_infer
Ty.prototype.is_ty_or_numeric_infer = function (this: Ty): boolean {
  return this.kind().$ === "Infer";
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1214 is_phantom_data
Ty.prototype.is_phantom_data = function (this: Ty): boolean {
  const k = this.kind();
  if (k.$ === "Adt") {
    return k._0.is_phantom_data();
  } else {
    return false;
  }
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1219 is_unsafe_cell
Ty.prototype.is_unsafe_cell = function (this: Ty): boolean {
  const k = this.kind();
  if (k.$ === "Adt") {
    return k._0.is_unsafe_cell();
  } else {
    return false;
  }
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1224 is_bool
Ty.prototype.is_bool = function (this: Ty): boolean {
  return this.kind().$ === "Bool";
};

/// Returns `true` if this type is a `str`.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1230 is_str
Ty.prototype.is_str = function (this: Ty): boolean {
  return this.kind().$ === "Str";
};

/// Returns true if this type is `&str`. The reference's lifetime is ignored.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1236 is_imm_ref_str
Ty.prototype.is_imm_ref_str = function (this: Ty): boolean {
  const k = this.kind();
  return k.$ === "Ref" && k._2 === "Not" && k._1.is_str();
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1241 is_param
Ty.prototype.is_param = function (this: Ty, index: number): boolean {
  const k = this.kind();
  switch (k.$) {
    case "Param":
      return k._0.index === index;
    default:
      return false;
  }
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1249 is_slice
Ty.prototype.is_slice = function (this: Ty): boolean {
  return this.kind().$ === "Slice";
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1254 is_array_slice
Ty.prototype.is_array_slice = function (this: Ty): boolean {
  const k = this.kind();
  switch (k.$) {
    case "Slice":
      return true;
    case "RawPtr":
      return k._0.kind().$ === "Slice";
    case "Ref":
      return k._1.kind().$ === "Slice";
    default:
      return false;
  }
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1263 is_array
Ty.prototype.is_array = function (this: Ty): boolean {
  return this.kind().$ === "Array";
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1268 is_simd
Ty.prototype.is_simd = function (this: Ty): boolean {
  const k = this.kind();
  switch (k.$) {
    case "Adt":
      return k._0.repr().simd();
    default:
      return false;
  }
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1276 is_scalable_vector
Ty.prototype.is_scalable_vector = function (this: Ty): boolean {
  const k = this.kind();
  switch (k.$) {
    case "Adt":
      return k._0.repr().is_scalable();
    default:
      return false;
  }
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1283 sequence_element_type
Ty.prototype.sequence_element_type = function (this: Ty, tcx: TyCtxt): Ty {
  const k = this.kind();
  switch (k.$) {
    case "Array":
    case "Slice":
      return k._0;
    case "Str":
      return tcx.types.u8;
    default:
      return bug(`\`sequence_element_type\` called on non-sequence value: ${pretty().display_Ty(this)}`);
  }
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1291 scalable_vector_parts
Ty.prototype.scalable_vector_parts = function (this: Ty, tcx: TyCtxt): [number, Ty, NumScalableVectors] | undefined {
  const k = this.kind();
  if (k.$ !== "Adt") {
    return undefined;
  }
  const def = k._0;
  const args = k._1;
  const scalable = def.repr().scalable;
  if (scalable === undefined) return undefined;
  let num_vectors: NumScalableVectors;
  let vec_def: AdtDef;
  switch (scalable.$) {
    case "ElementCount":
      [num_vectors, vec_def] = [NumScalableVectors_for_non_tuple(), def];
      break;
    case "Container": {
      const n = NumScalableVectors_from_field_count(def.non_enum_variant().fields.length);
      if (n === undefined) return undefined;
      const field0 = index_slice(def.non_enum_variant().fields, 0);
      const adt = Unnormalized.skip_norm_wip(field0.ty(tcx, args)).ty_adt_def();
      if (adt === undefined) return undefined;
      [num_vectors, vec_def] = [n, adt];
      break;
    }
  }
  const vec_scalable = vec_def.repr().scalable;
  if (vec_scalable === undefined || vec_scalable.$ !== "ElementCount") {
    return undefined;
  }
  const element_count = vec_scalable._0;
  const variant = vec_def.non_enum_variant();
  assert_eq(variant.fields.length, 1, String);
  const field_ty = index_slice(variant.fields, 0).ty(tcx, args);
  return [element_count, Unnormalized.skip_norm_wip(field_ty), num_vectors];
};

// PORT: `u64` is `number` (decls: the lane length of a SIMD type stays far below 2^53).
// rustc: compiler/rustc_middle/src/ty/sty.rs:1317 simd_size_and_type
Ty.prototype.simd_size_and_type = function (this: Ty, tcx: TyCtxt): [number, Ty] {
  const k = this.kind();
  if (k.$ !== "Adt") {
    return bug("`simd_size_and_type` called on invalid type");
  }
  const def = k._0;
  const args = k._1;
  assert(def.repr().simd(), "`simd_size_and_type` called on non-SIMD type");
  const variant = def.non_enum_variant();
  assert_eq(variant.fields.length, 1, String);
  const field_ty = index_slice(variant.fields, 0).ty(tcx, args);
  const fk = Unnormalized.skip_norm_wip(field_ty).kind();
  if (fk.$ !== "Array") {
    return bug(`Simd type has non-array field type ${debug_Unnormalized(field_ty, PLAIN, debug_Ty)}`);
  }
  const f0_elem_ty = fk._0;
  const f0_len = fk._1;
  // FIXME(repr_simd): https://github.com/rust-lang/rust/pull/78863#discussion_r522784112
  // The way we evaluate the `N` in `[T; N]` here only works since we use
  // `simd_size_and_type` post-monomorphization. It will probably start to ICE
  // if we use it in generic code. See the `simd-array-trait` ui test.
  return [unwrap(f0_len.try_to_target_usize(tcx), "expected SIMD field to have definite array size"), f0_elem_ty];
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1341 is_mutable_ptr
Ty.prototype.is_mutable_ptr = function (this: Ty): boolean {
  const k = this.kind();
  return (k.$ === "RawPtr" && k._1 === "Mut") || (k.$ === "Ref" && k._2 === "Mut");
};

/// Get the mutability of the reference or `None` when not a reference
// rustc: compiler/rustc_middle/src/ty/sty.rs:1347 ref_mutability
Ty.prototype.ref_mutability = function (this: Ty): Mutability | undefined {
  const k = this.kind();
  switch (k.$) {
    case "Ref":
      return k._2;
    default:
      return undefined;
  }
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1355 is_raw_ptr
Ty.prototype.is_raw_ptr = function (this: Ty): boolean {
  return this.kind().$ === "RawPtr";
};

/// Tests if this is any kind of primitive pointer type (reference, raw pointer, fn pointer).
/// `Box` is *not* considered a pointer here!
// rustc: compiler/rustc_middle/src/ty/sty.rs:1362 is_any_ptr
Ty.prototype.is_any_ptr = function (this: Ty): boolean {
  return this.is_ref() || this.is_raw_ptr() || this.is_fn_ptr();
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1367 is_box
Ty.prototype.is_box = function (this: Ty): boolean {
  const k = this.kind();
  switch (k.$) {
    case "Adt":
      return k._0.is_box();
    default:
      return false;
  }
};

/// Tests whether this is a Box definitely using the global allocator.
///
/// If the allocator is still generic, the answer is `false`, but it may
/// later turn out that it does use the global allocator.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1379 is_box_global
Ty.prototype.is_box_global = function (this: Ty, tcx: TyCtxt): boolean {
  const k = this.kind();
  if (k.$ === "Adt" && k._0.is_box()) {
    const args = k._1;
    const alloc = args[1];
    if (alloc === undefined) {
      // Single-argument Box is always global. (for "minicore" tests)
      return true;
    }
    const alloc_adt = GenericArg.expect_ty(alloc).ty_adt_def();
    return alloc_adt !== undefined && tcx.is_lang_item(alloc_adt.did(), LangItem.GlobalAlloc);
  }
  return false;
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1394 boxed_ty
Ty.prototype.boxed_ty = function (this: Ty): Ty | undefined {
  const k = this.kind();
  if (k.$ === "Adt" && k._0.is_box()) {
    return k._1.type_at(0);
  }
  return undefined;
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1401 pinned_ty
Ty.prototype.pinned_ty = function (this: Ty): Ty | undefined {
  const k = this.kind();
  if (k.$ === "Adt" && k._0.is_pin()) {
    return k._1.type_at(0);
  }
  return undefined;
};

/// Returns the type, pinnedness, mutability, and the region of a reference (`&T` or `&mut T`)
/// or a pinned-reference type (`Pin<&T>` or `Pin<&mut T>`).
///
/// Regarding the [`pin_ergonomics`] feature, one of the goals is to make pinned references
/// (`Pin<&T>` and `Pin<&mut T>`) behaves similar to normal references (`&T` and `&mut T`).
/// This function is useful when references and pinned references are processed similarly.
///
/// [`pin_ergonomics`]: https://github.com/rust-lang/rust/issues/130494
// rustc: compiler/rustc_middle/src/ty/sty.rs:1416 maybe_pinned_ref
Ty.prototype.maybe_pinned_ref = function (this: Ty): [Ty, Pinnedness, Mutability, Region] | undefined {
  const k = this.kind();
  if (k.$ === "Adt" && k._0.is_pin()) {
    const inner = k._1.type_at(0).kind();
    if (inner.$ === "Ref") {
      const region = inner._0;
      const ty = inner._1;
      const mutbl = inner._2;
      return [ty, "Pinned", mutbl, region];
    }
  }
  if (k.$ === "Ref") {
    const region = k._0;
    const ty = k._1;
    const mutbl = k._2;
    return [ty, "Not", mutbl, region];
  }
  return undefined;
};

/// Panics if called on any type other than `Box<T>`.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1432 expect_boxed_ty
Ty.prototype.expect_boxed_ty = function (this: Ty): Ty {
  const boxed = this.boxed_ty();
  return boxed !== undefined ? boxed : bug(`\`expect_boxed_ty\` is called on non-box type ${debug_Ty(this, PLAIN)}`);
};

/// A scalar type is one that denotes an atomic datum, with no sub-components.
/// (A RawPtr is scalar because it represents a non-managed pointer, so its
/// contents are abstract to rustc.)
// rustc: compiler/rustc_middle/src/ty/sty.rs:1441 is_scalar
Ty.prototype.is_scalar = function (this: Ty): boolean {
  const k = this.kind();
  switch (k.$) {
    case "Bool":
    case "Char":
    case "Int":
    case "Float":
    case "Uint":
    case "FnDef":
    case "FnPtr":
    case "RawPtr":
      return true;
    case "Infer":
      return k._0.$ === "IntVar" || k._0.$ === "FloatVar";
    default:
      return false;
  }
};

/// Returns `true` if this type is a floating point type.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1457 is_floating_point
Ty.prototype.is_floating_point = function (this: Ty): boolean {
  const k = this.kind();
  return k.$ === "Float" || (k.$ === "Infer" && k._0.$ === "FloatVar");
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1462 is_trait
Ty.prototype.is_trait = function (this: Ty): boolean {
  return this.kind().$ === "Dynamic";
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1467 is_enum
Ty.prototype.is_enum = function (this: Ty): boolean {
  const k = this.kind();
  return k.$ === "Adt" && k._0.is_enum();
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1472 is_union
Ty.prototype.is_union = function (this: Ty): boolean {
  const k = this.kind();
  return k.$ === "Adt" && k._0.is_union();
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1477 is_closure
Ty.prototype.is_closure = function (this: Ty): boolean {
  return this.kind().$ === "Closure";
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1482 is_coroutine
Ty.prototype.is_coroutine = function (this: Ty): boolean {
  return this.kind().$ === "Coroutine";
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1487 is_coroutine_closure
Ty.prototype.is_coroutine_closure = function (this: Ty): boolean {
  return this.kind().$ === "CoroutineClosure";
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1492 is_integral
Ty.prototype.is_integral = function (this: Ty): boolean {
  const k = this.kind();
  return (k.$ === "Infer" && k._0.$ === "IntVar") || k.$ === "Int" || k.$ === "Uint";
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1497 is_fresh_ty
Ty.prototype.is_fresh_ty = function (this: Ty): boolean {
  const k = this.kind();
  return k.$ === "Infer" && k._0.$ === "FreshTy";
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1502 is_fresh
Ty.prototype.is_fresh = function (this: Ty): boolean {
  const k = this.kind();
  return k.$ === "Infer" && (k._0.$ === "FreshTy" || k._0.$ === "FreshIntTy" || k._0.$ === "FreshFloatTy");
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1507 is_char
Ty.prototype.is_char = function (this: Ty): boolean {
  return this.kind().$ === "Char";
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1512 is_numeric
Ty.prototype.is_numeric = function (this: Ty): boolean {
  return this.is_integral() || this.is_floating_point();
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1517 is_signed
Ty.prototype.is_signed = function (this: Ty): boolean {
  return this.kind().$ === "Int";
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1522 is_ptr_sized_integral
Ty.prototype.is_ptr_sized_integral = function (this: Ty): boolean {
  const k = this.kind();
  return (k.$ === "Int" && k._0 === IntTyC.Isize) || (k.$ === "Uint" && k._0 === UintTyC.Usize);
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1527 has_concrete_skeleton
Ty.prototype.has_concrete_skeleton = function (this: Ty): boolean {
  const k = this.kind();
  return !(k.$ === "Param" || k.$ === "Infer" || k.$ === "Error");
};

/// Checks whether a type recursively contains another type
///
/// Example: `Option<()>` contains `()`
// rustc: compiler/rustc_middle/src/ty/sty.rs:1534 contains
Ty.prototype.contains = function (this: Ty, other: Ty): boolean {
  class ContainsTyVisitor implements TypeVisitor<ControlFlow<null>> {
    readonly Result: VisitorResult<ControlFlow<null>, null> = VisitorResultC.ControlFlow<null>();

    constructor(public _0: Ty) {}

    // rustc: compiler/rustc_middle/src/ty/sty.rs:1540 visit_ty
    visit_ty(t: Ty): ControlFlow<null> {
      if (this._0 === t) {
        return ControlFlowC.Break(null);
      } else {
        return fold_Ty.super_visit_with(t, this);
      }
    }

    visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<null> {
      return TypeVisitor_provided.visit_binder(this, t, d);
    }
    visit_region(r: Region): ControlFlow<null> {
      return TypeVisitor_provided.visit_region(this, r);
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

  const cf = fold_Ty.visit_with(this, new ContainsTyVisitor(other));
  return cf.$ === "Break";
};

/// Checks whether a type recursively contains any closure
///
/// Example: `Option<{closure@file.rs:4:20}>` returns true
// rustc: compiler/rustc_middle/src/ty/sty.rs:1552 contains_closure
Ty.prototype.contains_closure = function (this: Ty): boolean {
  class ContainsClosureVisitor implements TypeVisitor<ControlFlow<null>> {
    readonly Result: VisitorResult<ControlFlow<null>, null> = VisitorResultC.ControlFlow<null>();

    // rustc: compiler/rustc_middle/src/ty/sty.rs:1558 visit_ty
    visit_ty(t: Ty): ControlFlow<null> {
      if (t.kind().$ === "Closure") {
        return ControlFlowC.Break(null);
      } else {
        return fold_Ty.super_visit_with(t, this);
      }
    }

    visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<null> {
      return TypeVisitor_provided.visit_binder(this, t, d);
    }
    visit_region(r: Region): ControlFlow<null> {
      return TypeVisitor_provided.visit_region(this, r);
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

  const cf = fold_Ty.visit_with(this, new ContainsClosureVisitor());
  return cf.$ === "Break";
};

/// Returns the deepest `async_drop_in_place::{closure}` implementation.
///
/// `async_drop_in_place<T>::{closure}`, when T is a coroutine, is a proxy-impl
/// to call async drop poll from impl coroutine.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1575 find_async_drop_impl_coroutine
Ty.prototype.find_async_drop_impl_coroutine = function (this: Ty, tcx: TyCtxt, f: (_0: Ty) => void): Ty {
  assert(this.is_coroutine(), "assertion failed: self.is_coroutine()");
  let cor_ty: Ty = this;
  let ty: Ty = cor_ty;
  for (;;) {
    const k = ty.kind();
    if (k.$ !== "Coroutine") return cor_ty;
    const def_id = k._0;
    const args = k._1;
    cor_ty = ty;
    f(ty);
    if (!tcx.is_async_drop_in_place_coroutine(def_id)) {
      return cor_ty;
    }
    ty = GenericArg.expect_ty(unwrap(args[0]));
  }
};

/// Returns the type of `*ty`.
///
/// The parameter `explicit` indicates if this is an *explicit* dereference.
/// Some types -- notably raw ptrs -- can only be dereferenced explicitly.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1598 builtin_deref
Ty.prototype.builtin_deref = function (this: Ty, explicit: boolean): Ty | undefined {
  const k = this.kind();
  const boxed = this.boxed_ty();
  if (boxed !== undefined) {
    return boxed;
  } else if (k.$ === "Ref") {
    return k._1;
  } else if (k.$ === "RawPtr" && explicit) {
    return k._0;
  } else {
    return undefined;
  }
};

/// Returns the type of `ty[i]`.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1608 builtin_index
Ty.prototype.builtin_index = function (this: Ty): Ty | undefined {
  const k = this.kind();
  switch (k.$) {
    case "Array":
    case "Slice":
      return k._0;
    default:
      return undefined;
  }
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1616 fn_sig
Ty.prototype.fn_sig = function (this: Ty, tcx: TyCtxt): Binder<gen.FnSig> {
  return TyKindC.fn_sig(this.kind(), tcx);
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1621 unnormalized_fn_sig
Ty.prototype.unnormalized_fn_sig = function (this: Ty, tcx: TyCtxt): Unnormalized<Binder<gen.FnSig>> {
  return TyKindC.unnormalized_fn_sig(this.kind(), tcx);
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1626 is_fn
Ty.prototype.is_fn = function (this: Ty): boolean {
  const k = this.kind();
  return k.$ === "FnDef" || k.$ === "FnPtr";
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1631 is_fn_ptr
Ty.prototype.is_fn_ptr = function (this: Ty): boolean {
  return this.kind().$ === "FnPtr";
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1636 is_opaque
Ty.prototype.is_opaque = function (this: Ty): boolean {
  const k = this.kind();
  return k.$ === "Alias" && k._1.kind.$ === "Opaque";
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:1641 ty_adt_def
Ty.prototype.ty_adt_def = function (this: Ty): AdtDef | undefined {
  const k = this.kind();
  switch (k.$) {
    case "Adt":
      return k._0;
    default:
      return undefined;
  }
};

/// Returns a list of tuple type arguments.
///
/// Panics when called on anything but a tuple.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1071 tuple_fields
// rustc: compiler/rustc_middle/src/ty/sty.rs:1652 tuple_fields
Ty.prototype.tuple_fields = function (this: Ty): List<Ty> {
  const k = this.kind();
  switch (k.$) {
    case "Tuple":
      return k._0;
    default:
      return bug(`tuple_fields called on non-tuple: ${debug_Ty(this, PLAIN)}`);
  }
};

/// Returns a list of tuple type arguments, or `None` if `self` isn't a tuple.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1661 opt_tuple_fields
Ty.prototype.opt_tuple_fields = function (this: Ty): List<Ty> | undefined {
  const k = this.kind();
  switch (k.$) {
    case "Tuple":
      return k._0;
    default:
      return undefined;
  }
};

/// If the type contains variants, returns the valid range of variant indices.
//
// FIXME: This requires the optimized MIR in the case of coroutines.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1672 variant_range
Ty.prototype.variant_range = function (this: Ty, tcx: TyCtxt): Range<VariantIdx> | undefined {
  const k = this.kind();
  switch (k.$) {
    case "Adt":
      return k._0.variant_range();
    case "Coroutine":
      return CoroutineArgsExt.variant_range(k._1.as_coroutine(), k._0, tcx);
    case "UnsafeBinder":
      return tcx.instantiate_bound_regions_with_erased(UnsafeBinderInner.into_Binder(k._0), fold_Ty).variant_range(tcx);
    default:
      return undefined;
  }
};

/// If the type contains variants, returns the variant for `variant_index`.
/// Panics if `variant_index` is out of range.
//
// FIXME: This requires the optimized MIR in the case of coroutines.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1690 discriminant_for_variant
Ty.prototype.discriminant_for_variant = function (this: Ty, tcx: TyCtxt, variant_index: VariantIdx): Discr | undefined {
  const k = this.kind();
  if (k.$ === "Adt" && k._0.is_enum()) {
    return k._0.discriminant_for_variant(tcx, variant_index);
  } else if (k.$ === "Coroutine") {
    return CoroutineArgsExt.discriminant_for_variant(k._1.as_coroutine(), k._0, tcx, variant_index);
  } else if (k.$ === "UnsafeBinder") {
    return tcx.instantiate_bound_regions_with_erased(UnsafeBinderInner.into_Binder(k._0), fold_Ty).discriminant_for_variant(tcx, variant_index);
  } else {
    return undefined;
  }
};

/// Returns the type of the discriminant of this type.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1118 discriminant_ty
// rustc: compiler/rustc_middle/src/ty/sty.rs:1710 discriminant_ty
Ty.prototype.discriminant_ty = function (this: Ty, tcx: TyCtxt): Ty {
  const k = this.kind();
  if (k.$ === "Adt" && k._0.is_enum()) {
    return ty_util().IntTypeExt.to_ty(k._0.repr().discr_type(), tcx);
  }
  switch (k.$) {
    case "Coroutine":
      return CoroutineArgsExt.discr_ty(k._1.as_coroutine(), tcx);

    case "Param":
    case "Alias":
    case "Infer":
      if (k.$ !== "Infer" || k._0.$ === "TyVar") {
        const assoc_items = tcx.associated_item_def_ids(tcx.require_lang_item(LangItem.DiscriminantKind, DUMMY_SP));
        return Ty.new_projection_from_args(tcx, "No", index_slice(assoc_items, 0), tcx.mk_args([GenericArg.from_Ty(this)]));
      }
      break;

    case "Pat":
      return k._0.discriminant_ty(tcx);
    case "UnsafeBinder":
      return tcx.instantiate_bound_regions_with_erased(UnsafeBinderInner.into_Binder(k._0), fold_Ty).discriminant_ty(tcx);

    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "Adt":
    case "Foreign":
    case "Str":
    case "Array":
    case "Slice":
    case "RawPtr":
    case "Ref":
    case "FnDef":
    case "FnPtr":
    case "Dynamic":
    case "Closure":
    case "CoroutineClosure":
    case "CoroutineWitness":
    case "Never":
    case "Tuple":
    case "Error":
      return tcx.types.u8;

    case "Bound":
    case "Placeholder":
      return bug(`\`discriminant_ty\` applied to unexpected type: ${debug_Ty(this, PLAIN)}`);
  }
  // `Infer(..)` but not `TyVar`
  const infer = k._0;
  switch (infer.$) {
    case "IntVar":
    case "FloatVar":
      return tcx.types.u8;
    case "FreshTy":
    case "FreshIntTy":
    case "FreshFloatTy":
      return bug(`\`discriminant_ty\` applied to unexpected type: ${debug_Ty(this, PLAIN)}`);
  }
};

/// Returns the type of metadata for (potentially wide) pointers to this type,
/// or the struct tail if the metadata type cannot be determined.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1765 ptr_metadata_ty_or_tail
Ty.prototype.ptr_metadata_ty_or_tail = function (this: Ty, tcx: TyCtxt, normalize: (_0: Unnormalized<Ty>) => Ty): Result<Ty, Ty> {
  const tail = tcx.struct_tail_raw(this, traits_mod().ObligationCause.dummy(), normalize, () => {});
  const k = tail.kind();
  switch (k.$) {
    // Sized types
    case "Infer":
      if (k._0.$ === "IntVar" || k._0.$ === "FloatVar") return Ok(tcx.types.unit);
      return bug(`\`ptr_metadata_ty_or_tail\` applied to unexpected type: ${debug_Ty(this, PLAIN)} (tail = ${debug_Ty(tail, PLAIN)})`);
    case "Uint":
    case "Int":
    case "Bool":
    case "Float":
    case "FnDef":
    case "FnPtr":
    case "RawPtr":
    case "Char":
    case "Ref":
    case "Coroutine":
    case "CoroutineWitness":
    case "Array":
    case "Closure":
    case "CoroutineClosure":
    case "Never":
    case "Error":
      return Ok(tcx.types.unit);
    // Extern types have metadata = ().
    case "Foreign":
      return Ok(tcx.types.unit);
    // If returned by `struct_tail_raw` this is a unit struct
    // without any fields, or not a struct, and therefore is Sized.
    case "Adt":
      return Ok(tcx.types.unit);
    // If returned by `struct_tail_raw` this is the empty tuple,
    // a.k.a. unit type, which is Sized
    case "Tuple":
      return Ok(tcx.types.unit);

    case "Str":
    case "Slice":
      return Ok(tcx.types.usize);

    case "Dynamic": {
      const dyn_metadata = tcx.require_lang_item(LangItem.DynMetadata, DUMMY_SP);
      return Ok(Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(dyn_metadata) as EarlyBinder<Ty>, tcx, [GenericArg.from_Ty(tail)], fold_Ty)));
    }

    // We don't know the metadata of `self`, but it must be equal to the
    // metadata of `tail`.
    case "Param":
    case "Alias":
      return Err(tail);

    case "UnsafeBinder":
      return panic("not implemented: FIXME(unsafe_binder)");

    case "Pat":
    case "Bound":
    case "Placeholder":
      return bug(`\`ptr_metadata_ty_or_tail\` applied to unexpected type: ${debug_Ty(this, PLAIN)} (tail = ${debug_Ty(tail, PLAIN)})`);
  }
};

/// Returns the type of metadata for (potentially wide) pointers to this type.
/// Causes an ICE if the metadata type cannot be determined.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1824 ptr_metadata_ty
Ty.prototype.ptr_metadata_ty = function (this: Ty, tcx: TyCtxt, normalize: (_0: Unnormalized<Ty>) => Ty): Ty {
  const r = this.ptr_metadata_ty_or_tail(tcx, normalize);
  switch (r.$) {
    case "Ok":
      return r._0;
    case "Err":
      return bug(`\`ptr_metadata_ty\` failed to get metadata for type: ${debug_Ty(this, PLAIN)} (tail = ${debug_Ty(r._0, PLAIN)})`);
  }
};

/// Given a pointer or reference type, returns the type of the *pointee*'s
/// metadata. If it can't be determined exactly (perhaps due to still
/// being generic) then a projection through `ptr::Pointee` will be returned.
///
/// This is particularly useful for getting the type of the result of
/// [`UnOp::PtrMetadata`](crate::mir::UnOp::PtrMetadata).
///
/// Panics if `self` is not dereferenceable.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1846 pointee_metadata_ty_or_projection
Ty.prototype.pointee_metadata_ty_or_projection = function (this: Ty, tcx: TyCtxt): Ty {
  const pointee_ty = this.builtin_deref(true);
  if (pointee_ty === undefined) {
    return bug(`Type ${debug_Ty(this, PLAIN)} is not a pointer or reference type`);
  }
  if (pointee_ty.has_trivial_sizedness(tcx, SizedTraitKind.Sized)) {
    return tcx.types.unit;
  } else {
    const r = pointee_ty.ptr_metadata_ty_or_tail(tcx, (x) => Unnormalized.skip_norm_wip(x));
    switch (r.$) {
      case "Ok":
        return r._0;
      case "Err": {
        const tail_ty = r._0;
        const metadata_def_id = tcx.require_lang_item(LangItem.Metadata, DUMMY_SP);
        return Ty.new_projection(tcx, "No", metadata_def_id, [GenericArg.from_Ty(tail_ty)]);
      }
    }
  }
};

/// When we create a closure, we record its kind (i.e., what trait
/// it implements, constrained by how it uses its borrows) into its
/// [`ty::ClosureArgs`] or [`ty::CoroutineClosureArgs`] using a type
/// parameter. This is kind of a phantom type, except that the
/// most convenient thing for us to are the integral types. This
/// function converts such a special type into the closure
/// kind. To go the other way, use [`Ty::from_closure_kind`].
///
/// Note that during type checking, we use an inference variable
/// to represent the closure kind, because it has not yet been
/// inferred. Once upvar inference (in `rustc_hir_analysis/src/check/upvar.rs`)
/// is complete, that type variable will be unified with one of
/// the integral types.
///
/// ```rust,ignore (snippet of compiler code)
/// if let TyKind::Closure(def_id, args) = closure_ty.kind()
///     && let Some(closure_kind) = args.as_closure().kind_ty().to_opt_closure_kind()
/// {
///     println!("{closure_kind:?}");
/// } else if let TyKind::CoroutineClosure(def_id, args) = closure_ty.kind()
///     && let Some(closure_kind) = args.as_coroutine_closure().kind_ty().to_opt_closure_kind()
/// {
///     println!("{closure_kind:?}");
/// }
/// ```
///
/// After upvar analysis, you should instead use [`ty::ClosureArgs::kind()`]
/// or [`ty::CoroutineClosureArgs::kind()`] to assert that the `ClosureKind`
/// has been constrained instead of manually calling this method.
///
/// ```rust,ignore (snippet of compiler code)
/// if let TyKind::Closure(def_id, args) = closure_ty.kind()
/// {
///     println!("{:?}", args.as_closure().kind());
/// } else if let TyKind::CoroutineClosure(def_id, args) = closure_ty.kind()
/// {
///     println!("{:?}", args.as_coroutine_closure().kind());
/// }
/// ```
// rustc: compiler/rustc_middle/src/ty/sty.rs:1075 to_opt_closure_kind
// rustc: compiler/rustc_middle/src/ty/sty.rs:1902 to_opt_closure_kind
Ty.prototype.to_opt_closure_kind = function (this: Ty): ClosureKind | undefined {
  const k = this.kind();
  switch (k.$) {
    case "Int":
      switch (k._0) {
        case "I8":
          return "Fn";
        case "I16":
          return "FnMut";
        case "I32":
          return "FnOnce";
        default:
          return bug(`cannot convert type \`${debug_Ty(this, PLAIN)}\` to a closure kind`);
      }

    // "Bound" types appear in canonical queries when the
    // closure type is not yet known, and `Placeholder` and `Param`
    // may be encountered in generic `AsyncFnKindHelper` goals.
    case "Bound":
    case "Placeholder":
    case "Param":
    case "Infer":
      return undefined;

    case "Error":
      return "Fn";

    default:
      return bug(`cannot convert type \`${debug_Ty(this, PLAIN)}\` to a closure kind`);
  }
};

/// Inverse of [`Ty::to_opt_closure_kind`]. See docs on that method
/// for explanation of the relationship between `Ty` and [`ty::ClosureKind`].
// rustc: compiler/rustc_middle/src/ty/sty.rs:1079 from_closure_kind
// rustc: compiler/rustc_middle/src/ty/sty.rs:1924 from_closure_kind
Ty.from_closure_kind = function (tcx: TyCtxt, kind: ClosureKind): Ty {
  switch (kind) {
    case "Fn":
      return tcx.types.i8;
    case "FnMut":
      return tcx.types.i16;
    case "FnOnce":
      return tcx.types.i32;
  }
};

/// Like [`Ty::to_opt_closure_kind`], but it caps the "maximum" closure kind
/// to `FnMut`. This is because although we have three capability states,
/// `AsyncFn`/`AsyncFnMut`/`AsyncFnOnce`, we only need to distinguish two coroutine
/// bodies: by-ref and by-value.
///
/// See the definition of `AsyncFn` and `AsyncFnMut` and the `CallRefFuture`
/// associated type for why we don't distinguish [`ty::ClosureKind::Fn`] and
/// [`ty::ClosureKind::FnMut`] for the purpose of the generated MIR bodies.
///
/// This method should be used when constructing a `Coroutine` out of a
/// `CoroutineClosure`, when the `Coroutine`'s `kind` field is being populated
/// directly from the `CoroutineClosure`'s `kind`.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1083 from_coroutine_closure_kind
// rustc: compiler/rustc_middle/src/ty/sty.rs:1944 from_coroutine_closure_kind
Ty.from_coroutine_closure_kind = function (tcx: TyCtxt, kind: ClosureKind): Ty {
  switch (kind) {
    case "Fn":
    case "FnMut":
      return tcx.types.i16;
    case "FnOnce":
      return tcx.types.i32;
  }
};

/// Fast path helper for testing if a type is `Sized` or `MetaSized`.
///
/// Returning true means the type is known to implement the sizedness trait. Returning `false`
/// means nothing -- could be sized, might not be.
///
/// Note that we could never rely on the fact that a type such as `[_]` is trivially `!Sized`
/// because we could be in a type environment with a bound such as `[_]: Copy`. A function with
/// such a bound obviously never can be called, but that doesn't mean it shouldn't typecheck.
/// This is why this method doesn't return `Option<bool>`.
// rustc: compiler/rustc_middle/src/ty/sty.rs:1961 has_trivial_sizedness
Ty.prototype.has_trivial_sizedness = function (this: Ty, tcx: TyCtxt, sizedness_: SizedTraitKind): boolean {
  const sizedness = sizedness_;
  const k = this.kind();
  switch (k.$) {
    case "Infer":
      switch (k._0.$) {
        case "IntVar":
        case "FloatVar":
          return true;
        case "TyVar":
          return false;
        case "FreshTy":
        case "FreshIntTy":
        case "FreshFloatTy":
          return bug(`\`has_trivial_sizedness\` applied to unexpected type: ${debug_Ty(this, PLAIN)}`);
      }
    // PORT: the arms `Infer(IntVar | FloatVar)` (true), `Infer(TyVar)` (false) and `Infer(Fresh*)` (bug) are this one case.
    case "Uint":
    case "Int":
    case "Bool":
    case "Float":
    case "FnDef":
    case "FnPtr":
    case "UnsafeBinder":
    case "RawPtr":
    case "Char":
    case "Ref":
    case "Coroutine":
    case "CoroutineWitness":
    case "Array":
    case "Pat":
    case "Closure":
    case "CoroutineClosure":
    case "Never":
    case "Error":
      return true;

    case "Str":
    case "Slice":
    case "Dynamic":
      switch (sizedness) {
        case "Sized":
          return false;
        case "MetaSized":
          return true;
      }
    case "Foreign":
      switch (sizedness) {
        case "Sized":
        case "MetaSized":
          return false;
      }
    case "Tuple": {
      const tys = k._0;
      const last = tys[tys.length - 1];
      return last === undefined || last.has_trivial_sizedness(tcx, sizedness_);
    }

    case "Adt": {
      const ty = k._0.sizedness_constraint(tcx, sizedness);
      return ty === undefined || Unnormalized.skip_norm_wip(EarlyBinder.instantiate(ty, tcx, k._1, fold_Ty)).has_trivial_sizedness(tcx, sizedness_);
    }

    case "Alias":
    case "Param":
    case "Placeholder":
    case "Bound":
      return false;
  }
};

/// Fast path helper for primitives which are always `Copy` and which
/// have a side-effect-free `Clone` impl.
///
/// Returning true means the type is known to be pure and `Copy+Clone`.
/// Returning `false` means nothing -- could be `Copy`, might not be.
///
/// This is mostly useful for optimizations, as these are the types
/// on which we can replace cloning with dereferencing.
// rustc: compiler/rustc_middle/src/ty/sty.rs:2016 is_trivially_pure_clone_copy
Ty.prototype.is_trivially_pure_clone_copy = function (this: Ty): boolean {
  const k = this.kind();
  switch (k.$) {
    case "Bool":
    case "Char":
    case "Never":
      return true;

    // These aren't even `Clone`
    case "Str":
    case "Slice":
    case "Foreign":
    case "Dynamic":
      return false;

    case "Infer":
      if (k._0.$ === "FloatVar" || k._0.$ === "IntVar") return true;
      // `ty::Infer(..)` below
      return false;
    case "Int":
    case "Uint":
    case "Float":
      return true;

    // ZST which can't be named are fine.
    case "FnDef":
      return true;

    case "Array":
      return k._0.is_trivially_pure_clone_copy();

    // A 100-tuple isn't "trivial", so doing this only for reasonable sizes.
    case "Tuple": {
      const field_tys = k._0;
      return field_tys.length <= 3 && field_tys.every((t) => t.is_trivially_pure_clone_copy());
    }

    case "Pat":
      return k._0.is_trivially_pure_clone_copy();

    // Sometimes traits aren't implemented for every ABI or arity,
    // because we can't be generic over everything yet.
    case "FnPtr":
      return false;

    case "Ref":
      switch (k._2) {
        // Definitely absolutely not copy.
        case "Mut":
          return false;
        // The standard library has a blanket Copy impl for shared references and raw pointers,
        // for all unsized types.
        case "Not":
          return true;
      }
    case "RawPtr":
      return true;

    case "Coroutine":
    case "CoroutineWitness":
      return false;

    // Might be, but not "trivial" so just giving the safe answer.
    case "Adt":
    case "Closure":
    case "CoroutineClosure":
      return false;

    case "UnsafeBinder":
      return false;

    // Needs normalization or revealing to determine, so no is the safe answer.
    case "Alias":
      return false;

    case "Param":
    case "Placeholder":
    case "Bound":
    case "Error":
      return false;
  }
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:2067 is_trivially_wf
Ty.prototype.is_trivially_wf = function (this: Ty, tcx: TyCtxt): boolean {
  const k = this.kind();
  switch (k.$) {
    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "Str":
    case "Never":
    case "Param":
    case "Placeholder":
    case "Bound":
      return true;

    case "Slice": {
      const ty = k._0;
      return ty.is_trivially_wf(tcx) && ty.has_trivial_sizedness(tcx, SizedTraitKind.Sized);
    }
    case "RawPtr":
      return k._0.is_trivially_wf(tcx);

    case "FnPtr":
      return Binder.skip_binder(k._0).inputs_and_output.every((ty) => ty.is_trivially_wf(tcx));
    case "Ref": {
      const ty = k._1;
      return TypeVisitableExt.is_global(ty, fold_Ty) && ty.is_trivially_wf(tcx);
    }

    case "Infer": {
      const infer = k._0;
      switch (infer.$) {
        case "TyVar":
          return false;
        case "IntVar":
        case "FloatVar":
          return true;
        case "FreshTy":
        case "FreshIntTy":
        case "FreshFloatTy":
          return true;
      }
    }
    case "Adt":
    case "Tuple":
    case "Array":
    case "Foreign":
    case "Pat":
    case "FnDef":
    case "UnsafeBinder":
    case "Dynamic":
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
    case "CoroutineWitness":
    case "Alias":
    case "Error":
      return false;
  }
};

/// If `self` is a primitive, return its [`Symbol`].
// rustc: compiler/rustc_middle/src/ty/sty.rs:2114 primitive_symbol
Ty.prototype.primitive_symbol = function (this: Ty): Symbol | undefined {
  const k = this.kind();
  switch (k.$) {
    case "Bool":
      return sym.bool;
    case "Char":
      return sym.char;
    case "Int":
      return IntTyC.name(k._0);
    case "Uint":
      return UintTyC.name(k._0);
    case "Float":
      return FloatTyC.name(k._0);
    case "Str":
      return sym.str;
    default:
      return undefined;
  }
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:2126 is_c_void
Ty.prototype.is_c_void = function (this: Ty, tcx: TyCtxt): boolean {
  const k = this.kind();
  switch (k.$) {
    case "Adt":
      return tcx.is_lang_item(k._0.did(), LangItem.CVoid);
    default:
      return false;
  }
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:2133 is_async_drop_in_place_coroutine
Ty.prototype.is_async_drop_in_place_coroutine = function (this: Ty, tcx: TyCtxt): boolean {
  const k = this.kind();
  switch (k.$) {
    case "Coroutine":
      return tcx.is_async_drop_in_place_coroutine(k._0);
    default:
      return false;
  }
};

/// Returns `true` when the outermost type cannot be further normalized,
/// resolved, or instantiated. This includes all primitive types, but also
/// things like ADTs and trait objects, since even if their arguments or
/// nested types may be further simplified, the outermost [`TyKind`] or
/// type constructor remains the same.
// rustc: compiler/rustc_middle/src/ty/sty.rs:2145 is_known_rigid
Ty.prototype.is_known_rigid = function (this: Ty): boolean {
  return TyKindC.is_known_rigid(this.kind());
};

/// Iterator that walks `self` and any types reachable from
/// `self`, in depth-first order. Note that just walks the types
/// that appear in `self`, it does not descend into the fields of
/// structs or variants. For example:
///
/// ```text
/// isize => { isize }
/// Foo<Bar<isize>> => { Foo<Bar<isize>>, Bar<isize>, isize }
/// [isize] => { [isize], isize }
/// ```
// rustc: compiler/rustc_middle/src/ty/sty.rs:2159 walk
Ty.prototype.walk = function (this: Ty): TypeWalker {
  return TypeWalker.new(GenericArg.from_Ty(this));
};

/// Returns `true` if this is a `MaybeDangling<T>`-like type, i.e., a type whose inner
/// references are not required to be dereferenceable and are not reborrowed.
// rustc: compiler/rustc_middle/src/ty/sty.rs:2166 is_like_maybe_dangling
Ty.prototype.is_like_maybe_dangling = function (this: Ty): boolean {
  const k = this.kind();
  switch (k.$) {
    case "Adt": {
      const def = k._0;
      // ManuallyDrop is "natively" like maybe-dangling so that we don't have
      // to nest field types even deeper.
      return AdtFlags.contains(def.flags(), AdtFlags.IS_MAYBE_DANGLING) || AdtFlags.contains(def.flags(), AdtFlags.IS_MANUALLY_DROP);
    }
    case "Coroutine":
      return true;
    default:
      return false;
  }
};

// `has_unsafe_fields` (:1122) is `Ty::has_unsafe_fields` of ty/util.rs:1275: util.ts's method carries both markers.

// ---- impl rustc_type_ir::inherent::Tys<TyCtxt<'tcx>> for &'tcx ty::List<Ty<'tcx>> ---------------------------------

// rustc: compiler/rustc_middle/src/ty/sty.rs:2181 inputs
RawList.prototype.inputs = function (this: List<Ty>): readonly Ty[] {
  return unwrap(split_last(this))[1];
};

// rustc: compiler/rustc_middle/src/ty/sty.rs:2185 output
RawList.prototype.output = function (this: List<Ty>): Ty {
  return unwrap(split_last(this))[0];
};

// ---- impl rustc_type_ir::inherent::Symbol<TyCtxt<'tcx>> for Symbol -------------------------------------------------

export const Symbol_inherent: Symbol_static = {
  KW_UNDERSCORE_LIFETIME: kw.UnderscoreLifetime,
  KW_STATIC_LIFETIME: kw.StaticLifetime,
  SYM_ANON: sym.anon,
};

// Some types are used a lot. Make sure they don't unintentionally get bigger.
// PORT: `mod size_asserts` (`static_assert_size!`, 64-bit only) has no TS counterpart.

// ---- PORT helpers -------------------------------------------------------------------------------------------------

/// `rustc_abi::FIRST_VARIANT` (`VariantIdx::ZERO`).
const FIRST_VARIANT = 0 as VariantIdx;

/// `Range::contains`
function range_contains(r: Range<VariantIdx>, i: VariantIdx): boolean {
  return r.start <= i && i < r.end;
}

/// `<[T]>::split_last`
function split_last<T>(xs: readonly T[]): [T, readonly T[]] | undefined {
  return xs.length === 0 ? undefined : [xs[xs.length - 1]!, xs.slice(0, xs.length - 1)];
}

/// `xs[i]` on a slice (panics like Rust when out of bounds).
function index_slice<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  if (x === undefined) panic(`index out of bounds: the len is ${xs.length} but the index is ${i}`);
  return x;
}

/// `Discr { val, ty }` (ty/util.rs:39; `Discr` is pending in ty/decls.ts).
/// `tcx.coroutine_layout(..).unwrap()`
function unwrap_layout(r: Result<CoroutineLayout, unknown>): CoroutineLayout {
  if (r.$ === "Err") return panic("called `Result::unwrap()` on an `Err` value");
  return r._0;
}

// ---- PORT stand-ins for fns of other files that are not ported yet ------------------------------------------------
// Not markers. Each calls `unported`; root repoints them at the real ports.

type CoroutineLayout = Pending<"CoroutineLayout">;
type CoroutineSavedLocal = number & { readonly __brand: "CoroutineSavedLocal" };

/** PORT: stand-in for `NumScalableVectors::for_non_tuple` (rustc_abi, not ported). */
function NumScalableVectors_for_non_tuple(): NumScalableVectors {
  return unported("rustc_abi::NumScalableVectors::for_non_tuple");
}
/** PORT: stand-in for `NumScalableVectors::from_field_count` (rustc_abi, not ported). */
function NumScalableVectors_from_field_count(_count: number): NumScalableVectors | undefined {
  return unported("rustc_abi::NumScalableVectors::from_field_count");
}
/** PORT: stand-in for the `CoroutineLayout::variant_fields` field (mir/query.rs; MIR, M4). */
function CoroutineLayout_variant_fields(_self: CoroutineLayout): readonly (readonly CoroutineSavedLocal[])[] {
  return unported("rustc_middle::mir::query::CoroutineLayout::variant_fields (MIR)");
}
/** PORT: stand-in for `layout.field_tys[field].ty` (mir/query.rs; MIR, M4). */
function CoroutineLayout_field_ty(_self: CoroutineLayout, _field: CoroutineSavedLocal): Ty {
  return unported("rustc_middle::mir::query::CoroutineLayout::field_tys (MIR)");
}

/** PORT (merge-w15b): ty/util.ts is another extension module of `Ty` / `TyCtxt`: reached lazily. */
function ty_util(): typeof import("./util.ts") {
  return (ty_util__m ??= require("./util.ts") as typeof import("./util.ts"));
}
var ty_util__m: typeof import("./util.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)

/** PORT (merge-w15b): rustc_middle traits/mod.ts reaches this module back through rustc_type_ir: loaded lazily. */
function traits_mod(): typeof import("../traits/mod.ts") {
  return (traits_mod__m ??= require("../traits/mod.ts") as typeof import("../traits/mod.ts"));
}
var traits_mod__m: typeof import("../traits/mod.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
