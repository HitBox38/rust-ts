// Port of compiler/rustc_borrowck/src/universal_regions.rs (lane borrowck-contract: declarations; fill lane bck-nll, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//! Code to extract the universally quantified regions declared on a
//! function. For example:
//!
//! ```
//! fn foo<'a, 'b, 'c: 'b>() { }
//! ```
//!
//! here we would return a map assigning each of `{'a, 'b, 'c}`
//! to an index.
//!
//! The code in this file doesn't *do anything* with those results; it
//! just returns them for other code to use.
// PORT: `DefiningTy` (an enum with methods) has no generated companion: `DefiningTy` is `{} as DefiningTy_methods`;
// its `new` is `new_` (dataflow-contract `SplitPointIndex::new_` precedent: `new` would be a construct signature).
// PORT: the `#[extension(trait InferCtxtExt)] impl BorrowckInferCtxt` methods augment lib.gen.ts's `BorrowckInferCtxt`.
// PORT: `T: TypeFoldable` adds the descriptor `d_T` (errctxt-contract signature rule); `impl FnMut(Region)` is an
// arrow; `impl Iterator<Item = T>` is `Iterable<T>`; `IndexVec<RegionVid, Region>` is `Region[]`.
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import type { Diag } from "../rustc_errors/lib.ts";
import { NllRegionVariableOrigin } from "../rustc_infer/infer/mod.ts";
import { type Body, RETURN_PLACE } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { type GenericArgs, type GenericArgsRef, fold_GenericArgs, fold_List_Ty } from "../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../rustc_middle/ty/generics.ts";
import { type List, RawList } from "../rustc_middle/ty/list.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { display_GenericArg, display_Ty, with_no_trimmed_paths } from "../rustc_middle/ty/print/pretty.ts";
import { LateParamRegionKind } from "../rustc_middle/ty/region.ts";
import { debug_Ty, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { InlineConstArgs } from "../rustc_middle/ty/sty.ts";
import { type DefId, debug_LocalDefId, LocalDefId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { kw, sym } from "../rustc_span/symbol.ts";
import { Binder, type BoundRegion, BoundRegionKind, type BoundVariableKind, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import { fold_regions, set_aliases_to_rigid, type TypeFoldable } from "../rustc_type_ir/fold.ts";
import { BoundVar, INNERMOST } from "../rustc_type_ir/lib.ts";
import { debug_RegionVid, RegionVid } from "../rustc_type_ir/region_kind.gen.ts";
import { debug_Region, Region } from "../rustc_type_ir/sty/mod.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs, CoroutineClosureSignature } from "../rustc_type_ir/ty_kind/closure.ts";
import { FnSig, PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { format_debug, PLAIN } from "../std/fmt.ts";
import { assert, assert_eq, panic, unreachable, unwrap } from "../std/panic.ts";
import { BorrowckInferCtxt } from "./lib.gen.ts";
import * as gen from "./universal_regions.gen.ts";
import { type RegionClassification, UniversalRegionIndices, UniversalRegions, UniversalRegionsBuilder } from "./universal_regions.gen.ts";

export * from "./universal_regions.gen.ts";

declare module "./universal_regions.gen.ts" {
  interface UniversalRegions {
    // universal_regions.rs:551 (lane bck-nll)
    is_universal_region(r: RegionVid): boolean;
    // universal_regions.rs:557 (lane bck-nll)
    region_classification(r: RegionVid): RegionClassification | undefined;
    // universal_regions.rs:572 (lane bck-nll)
    universal_regions_iter(): Iterable<RegionVid>;
    // universal_regions.rs:577 (lane bck-nll)
    is_local_free_region(r: RegionVid): boolean;
    // universal_regions.rs:581 (lane bck-nll)
    is_external_free_region(r: RegionVid): boolean;
    // universal_regions.rs:586 (lane bck-nll)
    len(): number;
    // universal_regions.rs:595 (lane bck-nll)
    num_global_and_external_regions(): number;
    // universal_regions.rs:600 (lane bck-nll)
    named_universal_regions_iter(): Iterable<[Region, RegionVid]>;
    // universal_regions.rs:607 (lane bck-nll)
    to_region_vid(r: Region): RegionVid;
    // universal_regions.rs:617 (lane bck-nll)
    annotate(tcx: TyCtxt, err: Diag): void;
    // universal_regions.rs:683 (lane bck-nll)
    implicit_region_bound(): RegionVid;
    // universal_regions.rs:687 (lane bck-nll)
    encountered_re_error(): ErrorGuaranteed | undefined;
  }
  namespace UniversalRegions {
    // universal_regions.rs:512 (lane bck-nll)
    function new_(infcx: BorrowckInferCtxt, mir_def: LocalDefId): UniversalRegions;
    export { new_ as new };
    // universal_regions.rs:525 (lane bck-nll)
    export function closure_mapping(tcx: TyCtxt, closure_args: GenericArgsRef, expected_num_vars: number, closure_def_id: LocalDefId): Region[];
  }
  interface UniversalRegionsBuilder {
    // universal_regions.rs:698 (lane bck-nll)
    build(): UniversalRegions;
    // universal_regions.rs:829 (lane bck-nll)
    defining_ty(): DefiningTy;
    // universal_regions.rs:852 (lane bck-nll)
    compute_indices(fr_static: RegionVid, defining_ty: DefiningTy): UniversalRegionIndices;
    // universal_regions.rs:876 (lane bck-nll)
    compute_inputs_and_output(indices: UniversalRegionIndices, defining_ty: DefiningTy): Binder<List<Ty>>;
  }
  interface UniversalRegionIndices {
    // universal_regions.rs:940 (lane bck-nll)
    insert_late_bound_region(r: Region, vid: RegionVid): void;
    // universal_regions.rs:957 (lane bck-nll)
    to_region_vid(r: Region): RegionVid;
    // universal_regions.rs:976 (lane bck-nll)
    fold_to_region_vids<T>(tcx: TyCtxt, value: T, d_T: TypeFoldable<T>): T;
  }
}

declare module "./lib.gen.ts" {
  interface BorrowckInferCtxt {
    // universal_regions.rs:897 (lane bck-nll; `InferCtxtExt`)
    replace_free_regions_with_nll_infer_vars<T>(origin: NllRegionVariableOrigin, value: T, d_T: TypeFoldable<T>): T;
    // universal_regions.rs:914 (lane bck-nll; `InferCtxtExt`)
    replace_bound_regions_with_nll_infer_vars<T>(all_outlive_scope: LocalDefId, value: Binder<T>, indices: UniversalRegionIndices, d_T: TypeFoldable<T>): T;
  }
}

export interface DefiningTy_methods {
  // universal_regions.rs:137 (lane bck-nll)
  new_(tcx: TyCtxt, body_def_id: LocalDefId): DefiningTy;
  // universal_regions.rs:198 (lane bck-nll)
  bound_vars(self: DefiningTy, tcx: TyCtxt): List<BoundVariableKind>;
  // universal_regions.rs:235 (lane bck-nll)
  inputs_and_output(self: DefiningTy, tcx: TyCtxt): Binder<List<Ty>>;
  // universal_regions.rs:378 (lane bck-nll)
  upvar_tys(self: DefiningTy): List<Ty>;
  // universal_regions.rs:393 (lane bck-nll)
  implicit_inputs(self: DefiningTy): number;
  // universal_regions.rs:405 (lane bck-nll)
  is_fn_def(self: DefiningTy): boolean;
  // universal_regions.rs:409 (lane bck-nll)
  is_const(self: DefiningTy): boolean;
  // universal_regions.rs:413 (lane bck-nll)
  def_id(self: DefiningTy): DefId;
  // universal_regions.rs:427 (lane bck-nll)
  args(self: DefiningTy): GenericArgsRef;
}
export type DefiningTy = gen.DefiningTy;
export const DefiningTy = {} as DefiningTy_methods;

// #[instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:137 new
DefiningTy.new_ = function (tcx: TyCtxt, body_def_id: LocalDefId): DefiningTy {
  const owner_kind = tcx.hir_body_owner_kind(body_def_id);
  switch (owner_kind.$) {
    case "Closure":
    case "Fn": {
      let defining_ty = Unnormalized.skip_normalization(EarlyBinder.instantiate_identity(tcx.type_of(LocalDefId.to_def_id(body_def_id)) as EarlyBinder<Ty>));
      defining_ty = tcx.next_trait_solver_globally()
        ? // Closure types come from HIR typeck results, where they were already
          // normalized during writeback. Wrapping them in an `EarlyBinder`
          // conservatively makes aliases non-rigid, so restore their rigidness
          // instead of normalizing them again during borrowck.
          set_aliases_to_rigid(tcx, defining_ty, fold_Ty)
        : defining_ty;
      const k = defining_ty.kind();
      switch (k.$) {
        case "Closure":
          return { $: "Closure", _0: k._0, _1: k._1 };
        case "Coroutine":
          return { $: "Coroutine", _0: k._0, _1: k._1 };
        case "CoroutineClosure":
          return { $: "CoroutineClosure", _0: k._0, _1: k._1 };
        case "FnDef":
          return { $: "FnDef", _0: k._0, _1: unwrap(Binder.no_bound_vars(k._1, fold_GenericArgs)) };
        default:
          return span_bug(
            tcx.def_span(LocalDefId.to_def_id(body_def_id)),
            `expected defining type for \`${format_debug(body_def_id, debug_LocalDefId, PLAIN)}\`: \`${format_debug(defining_ty, debug_Ty, PLAIN)}\``,
          );
      }
    }

    case "Const":
      if (owner_kind.inline) {
        // This is required for `AscribeUserType` canonical query, which will call
        // `type_of(inline_const_def_id)`. That `type_of` would inject erased lifetimes
        // into borrowck, which is ICE #78174.
        //
        // As a workaround, inline consts have an additional generic param (`ty`
        // below), so that `type_of(inline_const_def_id).substs(substs)` uses the
        // proper type with NLL infer vars.
        //
        // Fetch the actual type from MIR, as `type_of` returns something useless
        // like `<const_ty>`.
        const body: Body = tcx.mir_promoted(body_def_id)[0].borrow();
        const ty = body.local_decls[RETURN_PLACE]!.ty;
        const typeck_root_def_id = tcx.typeck_root_def_id(LocalDefId.to_def_id(body_def_id));
        const parent_args = RawList.identity_for_item(tcx, typeck_root_def_id);
        const args = InlineConstArgs.new(tcx, { parent_args, ty }).args;
        return { $: "InlineConst", _0: LocalDefId.to_def_id(body_def_id), _1: args };
      } else {
        // `BodyOwnerKind::Const { inline: false } | BodyOwnerKind::Static(..)` (shared arm, below)
        const args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(body_def_id));
        return { $: "Const", _0: LocalDefId.to_def_id(body_def_id), _1: args };
      }

    case "Static": {
      const args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(body_def_id));
      return { $: "Const", _0: LocalDefId.to_def_id(body_def_id), _1: args };
    }

    case "GlobalAsm":
      return { $: "GlobalAsm", _0: LocalDefId.to_def_id(body_def_id) };
  }
};

/// The bound variables for a given defining type. This differs from their usual bound vars
/// in that closures and coroutine closures have an additional `'env`, while C-variadic
/// functions have an additional region for their implicit `VaList` input.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:198 bound_vars
DefiningTy.bound_vars = function (self: DefiningTy, tcx: TyCtxt): List<BoundVariableKind> {
  switch (self.$) {
    case "Closure": {
      const args = self._1;
      const closure_sig = ClosureArgs.sig(args.as_closure());
      const inputs_and_output = PolyFnSig.inputs_and_output(closure_sig);
      return tcx.mk_bound_variable_kinds_from_iter([
        ...Binder.bound_vars(inputs_and_output),
        { $: "Region", _0: BoundRegionKind.ClosureEnv } as BoundVariableKind,
      ]);
    }

    case "CoroutineClosure": {
      const args = self._1;
      const closure_sig = CoroutineClosureArgs.coroutine_closure_sig(args.as_coroutine_closure());
      return tcx.mk_bound_variable_kinds_from_iter([
        ...Binder.bound_vars(closure_sig),
        { $: "Region", _0: BoundRegionKind.ClosureEnv } as BoundVariableKind,
      ]);
    }

    case "FnDef": {
      const def_id = self._0;
      const sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>));
      if (FnSig.c_variadic(Binder.skip_binder(sig))) {
        // FIXME(#160495): Don't use an anonymous region here
        return tcx.mk_bound_variable_kinds_from_iter([...Binder.bound_vars(sig), { $: "Region", _0: BoundRegionKind.Anon } as BoundVariableKind]);
      } else {
        return Binder.bound_vars(sig);
      }
    }

    case "Coroutine":
    case "Const":
    case "InlineConst":
    case "GlobalAsm":
      return RawList.empty();
  }
};

// #[instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:235 inputs_and_output
DefiningTy.inputs_and_output = function (self: DefiningTy, tcx: TyCtxt): Binder<List<Ty>> {
  switch (self.$) {
    case "Closure": {
      const [def_id, args] = [self._0, self._1];
      const closure_sig = ClosureArgs.sig(args.as_closure());
      const inputs_and_output = PolyFnSig.inputs_and_output(closure_sig);
      const bound_vars = DefiningTy.bound_vars(self, tcx);
      const br: BoundRegion = {
        var: BoundVar.from_usize(bound_vars.length - 1),
        kind: BoundRegionKind.ClosureEnv,
      };
      const env_region = Region.new_bound(tcx, INNERMOST, br);
      const closure_ty = tcx.closure_env_ty(Ty.new_closure(tcx, def_id, args), ClosureArgs.kind(args.as_closure()), env_region);

      // The "inputs" of the closure in the
      // signature appear as a tuple. The MIR side
      // flattens this tuple.
      const [output, tuplized_inputs] = unwrap(split_last(Binder.skip_binder(inputs_and_output)));
      if (tuplized_inputs.length !== 1) {
        panic(`assertion \`left == right\` failed: multiple closure inputs\n  left: ${tuplized_inputs.length}\n right: 1`);
      }
      const k = tuplized_inputs[0]!.kind();
      if (k.$ !== "Tuple") {
        return bug(`closure inputs not a tuple: ${format_debug(tuplized_inputs[0]!, debug_Ty, PLAIN)}`);
      }
      const inputs = k._0;

      return Binder.bind_with_vars(tcx.mk_type_list_from_iter([closure_ty, ...inputs, output]), bound_vars);
    }

    case "Coroutine": {
      const [def_id, args] = [self._0, self._1];
      const resume_ty = CoroutineArgs.resume_ty(args.as_coroutine());
      const output = CoroutineArgs.return_ty(args.as_coroutine());
      const coroutine_ty = Ty.new_coroutine(tcx, def_id, args);
      const inputs_and_output = tcx.mk_type_list([coroutine_ty, resume_ty, output]);
      return Binder.dummy(inputs_and_output, fold_List_Ty);
    }

    // Construct the signature of the CoroutineClosure for the purposes of borrowck.
    // This is pretty straightforward -- we:
    // 1. first grab the `coroutine_closure_sig`,
    // 2. compute the self type (`&`/`&mut`/no borrow),
    // 3. flatten the tupled_input_tys,
    // 4. construct the correct generator type to return with
    //    `CoroutineClosureSignature::to_coroutine_given_kind_and_upvars`.
    // Then we wrap it all up into a list of inputs and output.
    case "CoroutineClosure": {
      const [def_id, args] = [self._0, self._1];
      const closure_sig = CoroutineClosureArgs.coroutine_closure_sig(args.as_coroutine_closure());
      const bound_vars = DefiningTy.bound_vars(self, tcx);
      const br: BoundRegion = {
        var: BoundVar.from_usize(bound_vars.length - 1),
        kind: BoundRegionKind.ClosureEnv,
      };
      const env_region = Region.new_bound(tcx, INNERMOST, br);
      const closure_kind = CoroutineClosureArgs.kind(args.as_coroutine_closure());

      const closure_ty = tcx.closure_env_ty(Ty.new_coroutine_closure(tcx, def_id, args), closure_kind, env_region);

      const inputs = Binder.skip_binder(closure_sig).tupled_inputs_ty.tuple_fields();
      const output = CoroutineClosureSignature.to_coroutine_given_kind_and_upvars(
        Binder.skip_binder(closure_sig),
        tcx,
        CoroutineClosureArgs.parent_args(args.as_coroutine_closure()),
        tcx.coroutine_for_closure(def_id),
        closure_kind,
        env_region,
        CoroutineClosureArgs.tupled_upvars_ty(args.as_coroutine_closure()),
        CoroutineClosureArgs.coroutine_captures_by_ref_ty(args.as_coroutine_closure()),
      );

      return Binder.bind_with_vars(tcx.mk_type_list_from_iter([closure_ty, ...inputs, output]), bound_vars);
    }

    case "FnDef": {
      const def_id = self._0;
      const sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>));
      const inputs_and_output = PolyFnSig.inputs_and_output(sig);

      // C-variadic fns also have a `VaList` input that's not listed in the signature
      // (as it's created inside the body itself, not passed in from outside).
      if (PolyFnSig.c_variadic(EarlyBinder.skip_binder(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>))) {
        const va_list_did = tcx.require_lang_item(LangItem.VaList, tcx.def_span(def_id));

        const bound_vars = DefiningTy.bound_vars(self, tcx);
        const br: BoundRegion = {
          var: BoundVar.from_usize(bound_vars.length - 1),
          kind: BoundRegionKind.Anon,
        };
        const region = Region.new_bound(tcx, INNERMOST, br);
        const va_list_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(va_list_did) as EarlyBinder<Ty>, tcx, [region], fold_Ty));

        // The signature needs to follow the order [input_tys, va_list_ty, output_ty]
        const [output_ty, input_tys] = unwrap(split_last(Binder.skip_binder(inputs_and_output)));
        return Binder.bind_with_vars(tcx.mk_type_list_from_iter([...input_tys, va_list_ty, output_ty]), bound_vars);
      }

      return inputs_and_output;
    }

    case "Const": {
      const def_id = self._0;
      // For a constant body, there are no inputs, and one
      // "output" (the type of the constant).
      const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>));
      return Binder.dummy(tcx.mk_type_list([ty]), fold_List_Ty);
    }

    case "InlineConst": {
      const args = self._1;
      const ty = InlineConstArgs.ty(args.as_inline_const());
      return Binder.dummy(tcx.mk_type_list([ty]), fold_List_Ty);
    }

    case "GlobalAsm": {
      const def_id = self._0;
      return Binder.dummy(tcx.mk_type_list([Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>))]), fold_List_Ty);
    }
  }
};

/// Returns a list of all the upvar types for this MIR. If this is
/// not a closure or coroutine, there are no upvars, and hence it
/// will be an empty list. The order of types in this list will
/// match up with the upvar order in the HIR, typesystem, and MIR.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:378 upvar_tys
DefiningTy.upvar_tys = function (self: DefiningTy): List<Ty> {
  switch (self.$) {
    case "Closure":
      return ClosureArgs.upvar_tys(self._1.as_closure());
    case "CoroutineClosure":
      return CoroutineClosureArgs.upvar_tys(self._1.as_coroutine_closure());
    case "Coroutine":
      return CoroutineArgs.upvar_tys(self._1.as_coroutine());
    case "FnDef":
    case "Const":
    case "InlineConst":
    case "GlobalAsm":
      return RawList.empty();
  }
};

/// Number of implicit inputs -- notably the "environment"
/// parameter for closures -- that appear in MIR but not in the
/// user's code.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:393 implicit_inputs
DefiningTy.implicit_inputs = function (self: DefiningTy): number {
  switch (self.$) {
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
      return 1;
    case "FnDef":
    case "Const":
    case "InlineConst":
    case "GlobalAsm":
      return 0;
  }
};

// rustc: compiler/rustc_borrowck/src/universal_regions.rs:405 is_fn_def
DefiningTy.is_fn_def = function (self: DefiningTy): boolean {
  return self.$ === "FnDef";
};

// rustc: compiler/rustc_borrowck/src/universal_regions.rs:409 is_const
DefiningTy.is_const = function (self: DefiningTy): boolean {
  return self.$ === "Const" || self.$ === "InlineConst";
};

// rustc: compiler/rustc_borrowck/src/universal_regions.rs:413 def_id
DefiningTy.def_id = function (self: DefiningTy): DefId {
  switch (self.$) {
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
    case "FnDef":
    case "Const":
    case "InlineConst":
    case "GlobalAsm":
      return self._0;
  }
};

/// Returns the args of the `DefiningTy`. These are equivalent to the identity
/// substs of the body, but replaced with region vids.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:427 args
DefiningTy.args = function (self: DefiningTy): GenericArgsRef {
  switch (self.$) {
    case "Closure":
    case "Coroutine":
    case "CoroutineClosure":
    case "FnDef":
    case "Const":
    case "InlineConst":
      return self._1;
    case "GlobalAsm":
      return RawList.empty();
  }
};

const FIRST_GLOBAL_INDEX: number = 0;

/** PORT: `<[T]>::split_last` (std; no shared helper). */
function split_last<T>(xs: readonly T[]): [T, readonly T[]] | undefined {
  return xs.length === 0 ? undefined : [xs[xs.length - 1]!, xs.slice(0, xs.length - 1)];
}

/// Creates a new and fully initialized `UniversalRegions` that
/// contains indices for all the free regions found in the given
/// MIR -- that is, all the regions that appear in the function's
/// signature.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:512 new
(UniversalRegions as unknown as { new: typeof UniversalRegions.new }).new = function (infcx: BorrowckInferCtxt, mir_def: LocalDefId): UniversalRegions {
  return new UniversalRegionsBuilder(infcx, mir_def).build();
};

/// Given a reference to a closure type, extracts all the values
/// from its free regions and returns a vector with them. This is
/// used when the closure's creator checks that the
/// `ClosureRegionRequirements` are met. The requirements from
/// `ClosureRegionRequirements` are expressed in terms of
/// `RegionVid` entries that map into the returned vector `V`: so
/// if the `ClosureRegionRequirements` contains something like
/// `'1: '2`, then the caller would impose the constraint that
/// `V[1]: V[2]`.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:525 closure_mapping
(UniversalRegions as unknown as { closure_mapping: typeof UniversalRegions.closure_mapping }).closure_mapping = function (
  tcx: TyCtxt,
  closure_args: GenericArgsRef,
  expected_num_vars: number,
  closure_def_id: LocalDefId,
): Region[] {
  const region_mapping: Region[] = [];
  region_mapping.push(tcx.lifetimes.re_static);
  tcx.for_each_free_region(
    closure_args,
    (fr) => {
      region_mapping.push(fr);
    },
    fold_GenericArgs,
  );

  for_each_late_bound_region_in_recursive_scope(tcx, tcx.local_parent(closure_def_id), (r) => {
    region_mapping.push(r);
  });

  if (region_mapping.length !== expected_num_vars) {
    panic(
      `assertion \`left == right\` failed: index vec had unexpected number of variables\n  left: ${region_mapping.length}\n right: ${expected_num_vars}`,
    );
  }

  return region_mapping;
};

/// Returns `true` if `r` is a member of this set of universal regions.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:551 is_universal_region
UniversalRegions.prototype.is_universal_region = function (this: UniversalRegions, r: RegionVid): boolean {
  const i = RegionVid.index(r);
  return FIRST_GLOBAL_INDEX <= i && i < this.num_universals;
};

/// Classifies `r` as a universal region, returning `None` if this
/// is not a member of this set of universal regions.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:557 region_classification
UniversalRegions.prototype.region_classification = function (this: UniversalRegions, r: RegionVid): RegionClassification | undefined {
  const index = RegionVid.index(r);
  if (FIRST_GLOBAL_INDEX <= index && index < this.first_extern_index) {
    return "Global";
  } else if (this.first_extern_index <= index && index < this.first_local_index) {
    return "External";
  } else if (this.first_local_index <= index && index < this.num_universals) {
    return "Local";
  } else {
    return undefined;
  }
};

/// Returns an iterator over all the RegionVids corresponding to
/// universally quantified free regions.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:572 universal_regions_iter
UniversalRegions.prototype.universal_regions_iter = function* (this: UniversalRegions): Iterable<RegionVid> {
  const end = this.num_universals;
  for (let i = FIRST_GLOBAL_INDEX; i < end; i++) yield RegionVid.from_usize(i);
};

/// Returns `true` if `r` is classified as a local region.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:577 is_local_free_region
UniversalRegions.prototype.is_local_free_region = function (this: UniversalRegions, r: RegionVid): boolean {
  return this.region_classification(r) === "Local";
};

// rustc: compiler/rustc_borrowck/src/universal_regions.rs:581 is_external_free_region
UniversalRegions.prototype.is_external_free_region = function (this: UniversalRegions, r: RegionVid): boolean {
  return this.region_classification(r) === "External";
};

/// Returns the number of universal regions created in any category.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:586 len
UniversalRegions.prototype.len = function (this: UniversalRegions): number {
  return this.num_universals;
};

/// Returns the number of global plus external universal regions.
/// For closures, these are the regions that appear free in the
/// closure type (versus those bound in the closure
/// signature). They are therefore the regions between which the
/// closure may impose constraints that its creator must verify.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:595 num_global_and_external_regions
UniversalRegions.prototype.num_global_and_external_regions = function (this: UniversalRegions): number {
  return this.first_local_index;
};

/// Gets an iterator over all early bound regions starting with `'static`.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:600 named_universal_regions_iter
UniversalRegions.prototype.named_universal_regions_iter = function (this: UniversalRegions): Iterable<[Region, RegionVid]> {
  return this.indices.indices.entries();
};

/// See [UniversalRegionIndices::to_region_vid].
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:607 to_region_vid
UniversalRegions.prototype.to_region_vid = function (this: UniversalRegions, r: Region): RegionVid {
  return this.indices.to_region_vid(r);
};

/// As part of the NLL unit tests, you can annotate a function with
/// `#[rustc_regions]`, and we will emit information about the region
/// inference context and -- in particular -- the external constraints
/// that this region imposes on others. The methods in this file
/// handle the part about dumping the inference context internal
/// state.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:617 annotate
UniversalRegions.prototype.annotate = function (this: UniversalRegions, tcx: TyCtxt, err: Diag): void {
  const defining_ty = this.defining_ty;
  switch (defining_ty.$) {
    case "Closure": {
      const [def_id, args] = [defining_ty._0, defining_ty._1];
      const v = with_no_trimmed_paths(() => {
        const out: string[] = [];
        for (let i = (tcx.generics_of(def_id) as Generics).parent_count; i < args.length; i++) out.push(display_GenericArg(args[i]!));
        return out;
      });
      err.note(`defining type: ${tcx.def_path_str_with_args(def_id, args)} with closure args [\n    ${v.join(",\n    ")},\n]`);

      // FIXME: It'd be nice to print the late-bound regions
      // here, but unfortunately these wind up stored into
      // tests, and the resulting print-outs include def-ids
      // and other things that are not stable across tests!
      // So we just include the region-vid. Annoying.
      for_each_late_bound_region_in_recursive_scope(tcx, def_id.expect_local(), (r) => {
        err.note(`late-bound region is ${format_debug(this.to_region_vid(r), debug_RegionVid, PLAIN)}`);
      });
      break;
    }
    case "CoroutineClosure":
      return panic("not implemented");
    case "Coroutine": {
      const [def_id, args] = [defining_ty._0, defining_ty._1];
      const v = with_no_trimmed_paths(() => {
        const out: string[] = [];
        for (let i = (tcx.generics_of(def_id) as Generics).parent_count; i < args.length; i++) out.push(display_GenericArg(args[i]!));
        return out;
      });
      err.note(`defining type: ${tcx.def_path_str_with_args(def_id, args)} with coroutine args [\n    ${v.join(",\n    ")},\n]`);

      // FIXME: As above, we'd like to print out the region
      // `r` but doing so is not stable across architectures
      // and so forth.
      for_each_late_bound_region_in_recursive_scope(tcx, def_id.expect_local(), (r) => {
        err.note(`late-bound region is ${format_debug(this.to_region_vid(r), debug_RegionVid, PLAIN)}`);
      });
      break;
    }
    case "FnDef": {
      const [def_id, args] = [defining_ty._0, defining_ty._1];
      err.note(`defining type: ${tcx.def_path_str_with_args(def_id, args)}`);
      break;
    }
    case "Const": {
      const [def_id, args] = [defining_ty._0, defining_ty._1];
      err.note(`defining constant type: ${tcx.def_path_str_with_args(def_id, args)}`);
      break;
    }
    case "InlineConst": {
      const [def_id, args] = [defining_ty._0, defining_ty._1];
      err.note(`defining inline constant type: ${tcx.def_path_str_with_args(def_id, args)}`);
      break;
    }
    case "GlobalAsm":
      return unreachable();
  }
};

// rustc: compiler/rustc_borrowck/src/universal_regions.rs:683 implicit_region_bound
UniversalRegions.prototype.implicit_region_bound = function (this: UniversalRegions): RegionVid {
  return this.fr_fn_body;
};

/// Use this to see if we encountered a `ReError` while
/// collecting free regions.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:687 encountered_re_error
UniversalRegions.prototype.encountered_re_error = function (this: UniversalRegions): ErrorGuaranteed | undefined {
  return this.indices.encountered_re_error;
};

// rustc: compiler/rustc_borrowck/src/universal_regions.rs:698 build
UniversalRegionsBuilder.prototype.build = function (this: UniversalRegionsBuilder): UniversalRegions {
  // debug!("build(mir_def={:?})", self.mir_def);

  const _param_env = this.infcx.param_env;
  // debug!("build: param_env={:?}", param_env);

  assert_eq(FIRST_GLOBAL_INDEX, this.infcx.num_region_vars(), (v) => `${v}`);

  // Create the "global" region that is always free in all contexts: 'static.
  const fr_static = this.infcx.next_nll_region_var(NllRegionVariableOrigin.FreeRegion, () => ({ $: "Free", _0: kw.Static })).as_var();

  // We've now added all the global regions. The next ones we
  // add will be external.
  const first_extern_index = this.infcx.num_region_vars();

  const defining_ty = this.defining_ty();
  // debug!("build: defining_ty={:?}", defining_ty);

  const indices = this.compute_indices(fr_static, defining_ty);
  // debug!("build: indices={:?}", indices);

  // If this is a 'root' body (not a closure/coroutine/inline const), then
  // there are no extern regions, so the local regions start at the same
  // position as the (empty) sub-list of extern regions
  let first_local_index: number;
  if (!this.infcx.tcx.is_typeck_child(LocalDefId.to_def_id(this.mir_def))) {
    first_local_index = first_extern_index;
  } else {
    // If this is a closure, coroutine, or inline-const, then the late-bound regions from the enclosing
    // function/closures are actually external regions to us. For example, here, 'a is not local
    // to the closure c (although it is local to the fn foo). We need to add them as they could be
    // explicitly named in this body:
    //
    // fn foo<'a>() {
    //     let c = || { let x: &'a u32 = ...; }
    // }
    for_each_late_bound_region_in_recursive_scope(this.infcx.tcx, this.infcx.tcx.local_parent(this.mir_def), (r) => {
      // debug!(?r);
      const name = r.get_name_or_anon(this.infcx.tcx);
      const region_vid = this.infcx.next_nll_region_var(NllRegionVariableOrigin.FreeRegion, () => ({ $: "LateBound", _0: name }));

      // debug!(?region_vid);
      indices.insert_late_bound_region(r, region_vid.as_var());
    });

    // Any regions created during the execution of `defining_ty` or during the above
    // late-bound region replacement are all considered 'extern' regions
    first_local_index = this.infcx.num_region_vars();
  }

  // Converse of above, if this is a function/closure then the late-bound regions declared
  // on its signature are local.
  //
  // We manually loop over `bound_inputs_and_output` instead of using
  // `for_each_late_bound_region_in_item` as both closures and function
  // definitions have implicit late bound regions. Closures have a `'env`
  // regions while c-variadic function definitions have a `&VaList` argument.
  const bound_inputs_and_output = this.compute_inputs_and_output(indices, defining_ty);
  Binder.bound_vars(bound_inputs_and_output).forEach((bound_var, idx) => {
    if (bound_var.$ === "Region") {
      const kind = LateParamRegionKind.from_bound(BoundVar.from_usize(idx), bound_var._0);
      const r = Region.new_late_param(this.infcx.tcx, LocalDefId.to_def_id(this.mir_def), kind);
      const name = r.get_name_or_anon(this.infcx.tcx);
      const region_vid = this.infcx.next_nll_region_var(NllRegionVariableOrigin.FreeRegion, () => ({ $: "LateBound", _0: name }));

      // debug!(?region_vid);
      indices.insert_late_bound_region(r, region_vid.as_var());
    }
  });
  const inputs_and_output = this.infcx.replace_bound_regions_with_nll_infer_vars(this.mir_def, bound_inputs_and_output, indices, fold_List_Ty);

  const [unnormalized_output_ty, unnormalized_input_tys] = unwrap(split_last(inputs_and_output));

  const fr_fn_body = this.infcx.next_nll_region_var(NllRegionVariableOrigin.FreeRegion, () => ({ $: "Free", _0: sym.fn_body })).as_var();

  const num_universals = this.infcx.num_region_vars();

  // debug!("build: global regions = {}..{}", FIRST_GLOBAL_INDEX, first_extern_index);
  // debug!("build: extern regions = {}..{}", first_extern_index, first_local_index);
  // debug!("build: local regions  = {}..{}", first_local_index, num_universals);

  let resume_ty: Ty | undefined;
  let yield_ty: Ty | undefined;
  if (defining_ty.$ === "Coroutine") {
    const tys = defining_ty._1.as_coroutine();
    [resume_ty, yield_ty] = [CoroutineArgs.resume_ty(tys), CoroutineArgs.yield_ty(tys)];
  } else {
    [resume_ty, yield_ty] = [undefined, undefined];
  }

  return new UniversalRegions(
    indices,
    fr_static,
    fr_fn_body,
    first_extern_index,
    first_local_index,
    num_universals,
    defining_ty,
    unnormalized_output_ty,
    unnormalized_input_tys,
    yield_ty,
    resume_ty,
  );
};

/// Returns the "defining type" of the current MIR; see `DefiningTy` for details.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:829 defining_ty
UniversalRegionsBuilder.prototype.defining_ty = function (this: UniversalRegionsBuilder): DefiningTy {
  const defining_ty = DefiningTy.new_(this.infcx.tcx, this.mir_def);
  const f = (args: GenericArgs): GenericArgs => {
    const fr = NllRegionVariableOrigin.FreeRegion;
    return this.infcx.replace_free_regions_with_nll_infer_vars(fr, args, fold_GenericArgs);
  };
  switch (defining_ty.$) {
    case "Closure":
      return { $: "Closure", _0: defining_ty._0, _1: f(defining_ty._1) };
    case "Coroutine":
      return { $: "Coroutine", _0: defining_ty._0, _1: f(defining_ty._1) };
    case "CoroutineClosure":
      return { $: "CoroutineClosure", _0: defining_ty._0, _1: f(defining_ty._1) };
    case "FnDef":
      return { $: "FnDef", _0: defining_ty._0, _1: f(defining_ty._1) };
    case "Const":
      return { $: "Const", _0: defining_ty._0, _1: f(defining_ty._1) };
    case "InlineConst":
      return { $: "InlineConst", _0: defining_ty._0, _1: f(defining_ty._1) };
    case "GlobalAsm":
      return { $: "GlobalAsm", _0: defining_ty._0 };
  }
};

/// Builds a hashmap that maps from the universal regions that are
/// in scope (as a `ty::Region<'tcx>`) to their indices (as a
/// `RegionVid`). The map returned by this function contains only
/// the early-bound regions.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:852 compute_indices
UniversalRegionsBuilder.prototype.compute_indices = function (this: UniversalRegionsBuilder, fr_static: RegionVid, defining_ty: DefiningTy): UniversalRegionIndices {
  const tcx = this.infcx.tcx;
  const typeck_root_def_id = tcx.typeck_root_def_id_local(this.mir_def);
  const identity_args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(typeck_root_def_id));
  const renumbered_args = DefiningTy.args(defining_ty);

  const indices = new Map<Region, RegionVid>();
  // let global_mapping = iter::once((tcx.lifetimes.re_static, fr_static));
  indices.set(tcx.lifetimes.re_static, fr_static);
  // This relies on typeck roots being generics_of parents with their
  // parameters at the start of nested bodies' generics.
  assert(renumbered_args.length >= identity_args.length, "assertion failed: renumbered_args.len() >= identity_args.len()");
  // let arg_mapping = iter::zip(identity_args.regions(), renumbered_args.regions().map(|r| r.as_var()));
  const renumbered_regions = renumbered_args.regions()[globalThis.Symbol.iterator]();
  for (const identity_region of identity_args.regions()) {
    const next = renumbered_regions.next();
    if (next.done === true) break;
    indices.set(identity_region, next.value.as_var());
  }

  return new UniversalRegionIndices(indices, fr_static, undefined);
};

// rustc: compiler/rustc_borrowck/src/universal_regions.rs:876 compute_inputs_and_output
UniversalRegionsBuilder.prototype.compute_inputs_and_output = function (
  this: UniversalRegionsBuilder,
  indices: UniversalRegionIndices,
  defining_ty: DefiningTy,
): Binder<List<Ty>> {
  const tcx = this.infcx.tcx;
  const inputs_and_output_ = DefiningTy.inputs_and_output(defining_ty, tcx);
  const inputs_and_output = indices.fold_to_region_vids(tcx, inputs_and_output_, fold_Binder(fold_List_Ty));

  // FIXME(#129952): We probably want a more principled approach here.
  const r = TypeVisitableExt.error_reported(inputs_and_output, fold_Binder(fold_List_Ty));
  if (r.$ === "Err") {
    this.infcx.set_tainted_by_errors(r._0);
  }

  return inputs_and_output;
};

// #[extension(trait InferCtxtExt<'tcx>)] impl<'tcx> BorrowckInferCtxt<'tcx>
// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:897 replace_free_regions_with_nll_infer_vars
BorrowckInferCtxt.prototype.replace_free_regions_with_nll_infer_vars = function <T>(
  this: BorrowckInferCtxt,
  origin: NllRegionVariableOrigin,
  value: T,
  d_T: TypeFoldable<T>,
): T {
  return fold_regions(
    this.infcx.tcx,
    value,
    (region, _depth) => {
      const name = region.get_name_or_anon(this.infcx.tcx);
      // debug!(?region, ?name);

      return this.next_nll_region_var(origin, () => ({ $: "Free", _0: name }));
    },
    d_T,
  );
};

// #[instrument(level = "debug", skip(self, indices))]
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:914 replace_bound_regions_with_nll_infer_vars
BorrowckInferCtxt.prototype.replace_bound_regions_with_nll_infer_vars = function <T>(
  this: BorrowckInferCtxt,
  all_outlive_scope: LocalDefId,
  value: Binder<T>,
  indices: UniversalRegionIndices,
  d_T: TypeFoldable<T>,
): T {
  const [value_, _map] = this.tcx.instantiate_bound_regions(
    value,
    (br) => {
      // debug!(?br);
      const kind = LateParamRegionKind.from_bound(br.var, br.kind);
      const liberated_region = Region.new_late_param(this.tcx, LocalDefId.to_def_id(all_outlive_scope), kind);
      return Region.new_var(this.tcx, indices.to_region_vid(liberated_region));
    },
    d_T,
  );
  return value_;
};

/// Initially, the `UniversalRegionIndices` map contains only the
/// early-bound regions in scope. Once that is all setup, we come
/// in later and instantiate the late-bound regions, and then we
/// insert the `ReLateParam` version of those into the map as
/// well. These are used for error reporting.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:940 insert_late_bound_region
UniversalRegionIndices.prototype.insert_late_bound_region = function (this: UniversalRegionIndices, r: Region, vid: RegionVid): void {
  // debug!("insert_late_bound_region({:?}, {:?})", r, vid);
  const prev = this.indices.get(r);
  this.indices.set(r, vid);
  if (prev !== undefined) {
    panic(`assertion \`left == right\` failed\n  left: Some(${format_debug(prev, debug_RegionVid, PLAIN)})\n right: None`);
  }
};

/// Converts `r` into a local inference variable: `r` can either
/// be a `ReVar` (i.e., already a reference to an inference
/// variable) or it can be `'static` or some early-bound
/// region. This is useful when taking the results from
/// type-checking and trait-matching, which may sometimes
/// reference those regions from the `ParamEnv`. It is also used
/// during initialization. Relies on the `indices` map having been
/// fully initialized.
///
/// Panics if `r` is not a registered universal region, most notably
/// if it is a placeholder. Handling placeholders requires access to the
/// `MirTypeckRegionConstraints`.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:957 to_region_vid
UniversalRegionIndices.prototype.to_region_vid = function (this: UniversalRegionIndices, r: Region): RegionVid {
  const k = r.kind();
  switch (k.$) {
    case "ReVar":
      return r.as_var();
    case "ReError": {
      const guar = k._0;
      this.encountered_re_error = guar;
      // We use the `'static` `RegionVid` because `ReError` doesn't actually exist in the
      // `UniversalRegionIndices`. This is fine because 1) it is a fallback only used if
      // errors are being emitted and 2) it leaves the happy path unaffected.
      return this.fr_static;
    }
    default: {
      const vid = this.indices.get(r);
      return vid !== undefined ? vid : bug(`cannot convert \`${format_debug(r, debug_Region, PLAIN)}\` to a region vid`);
    }
  }
};

/// Replaces all free regions in `value` with region vids, as
/// returned by `to_region_vid`.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:976 fold_to_region_vids
UniversalRegionIndices.prototype.fold_to_region_vids = function <T>(this: UniversalRegionIndices, tcx: TyCtxt, value: T, d_T: TypeFoldable<T>): T {
  return fold_regions(tcx, value, (region, _) => Region.new_var(tcx, this.to_region_vid(region)), d_T);
};

/// Iterates over the late-bound regions defined on `mir_def_id` and all of its
/// parents, up to the typeck root, and invokes `f` with the liberated form
/// of each one.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:987 for_each_late_bound_region_in_recursive_scope
export function for_each_late_bound_region_in_recursive_scope(tcx: TyCtxt, mir_def_id: LocalDefId, f: (a0: Region) => void): void {
  // Walk up the tree, collecting late-bound regions until we hit the typeck root
  for (;;) {
    for_each_late_bound_region_in_item(tcx, mir_def_id, f);

    if (tcx.is_typeck_child(LocalDefId.to_def_id(mir_def_id))) {
      mir_def_id = tcx.local_parent(mir_def_id);
    } else {
      break;
    }
  }
}

/// Iterates over the late-bound regions defined on `mir_def_id` and all of its
/// parents, up to the typeck root, and invokes `f` with the liberated form
/// of each one.
// rustc: compiler/rustc_borrowck/src/universal_regions.rs:1007 for_each_late_bound_region_in_item
export function for_each_late_bound_region_in_item(tcx: TyCtxt, mir_def_id: LocalDefId, f: (a0: Region) => void): void {
  let bound_vars: List<BoundVariableKind>;
  const def_kind = tcx.def_kind(mir_def_id);
  switch (def_kind.$) {
    case "Fn":
    case "AssocFn":
      bound_vars = tcx.late_bound_vars(tcx.local_def_id_to_hir_id(mir_def_id));
      break;
    // We extract the bound vars from the deduced closure signature, since we may have
    // only deduced that a param in the closure signature is late-bound from a constraint
    // that we discover during typeck.
    case "Closure": {
      const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(LocalDefId.to_def_id(mir_def_id)) as EarlyBinder<Ty>));
      const k = ty.kind();
      switch (k.$) {
        case "Closure":
          bound_vars = Binder.bound_vars(ClosureArgs.sig(k._1.as_closure()));
          break;
        case "CoroutineClosure":
          bound_vars = Binder.bound_vars(CoroutineClosureArgs.coroutine_closure_sig(k._1.as_coroutine_closure()));
          break;
        case "Coroutine":
        case "Error":
          return;
        default:
          return unreachable(`internal error: entered unreachable code: unexpected type for closure: ${display_Ty(ty)}`);
      }
      break;
    }
    default:
      return;
  }

  bound_vars.forEach((bound_var, idx) => {
    if (bound_var.$ === "Region") {
      const kind = LateParamRegionKind.from_bound(BoundVar.from_usize(idx), bound_var._0);
      const liberated_region = Region.new_late_param(tcx, LocalDefId.to_def_id(mir_def_id), kind);
      f(liberated_region);
    }
  });
}
