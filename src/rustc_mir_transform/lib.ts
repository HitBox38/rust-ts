// Port of compiler/rustc_mir_transform/src/lib.rs (lane mt-skeleton).
//
// Module layout (docs/handoff/mt-skeleton.md): one TS module per upstream module, at the mirrored path. Every module
// that lib.rs / pass_manager.rs reference exists: ported by lane mt-skeleton (pass_manager, simplify, trivial_const,
// required_consts, sanity_check, patch) or a stub module naming its porting lane, which declares only the passes / fns
// referenced here and stops as UNPORTED with the upstream path. A porting lane replaces its stub module with the whole
// port; this file and the pass lists below need no edit for that.
//
// Init order (TDZ-free): pass_manager.ts first (it defines `MirPass` / `MirLint`, which every pass module extends at
// load, and imports no pass module); then the other modules. Pass modules import `./pass_manager.ts` (`crate::MirPass`,
// `crate::PassPolicy`, ...) directly, never this file. `PASS_NAMES` is read by pass_manager.ts lazily.
//
// PORT: `&[&dyn MirPass<'tcx>]` pass lists are arrays of `MirPass` objects: a unit-struct pass is `new X()`, a pass enum
// variant is the frozen instance `X.Variant` (pass_manager.ts header).
import * as pass_manager from "./pass_manager.ts";
import { Lint, type MirPass, PassCtx, WithMinOptLevel } from "./pass_manager.ts";
import * as abort_unwinding_calls from "./abort_unwinding_calls.ts";
import * as add_call_guards from "./add_call_guards.ts";
import * as add_moves_for_packed_drops from "./add_moves_for_packed_drops.ts";
import * as add_subtyping_projections from "./add_subtyping_projections.ts";
import * as check_inline from "./check_inline.ts";
import * as check_call_recursion from "./check_call_recursion.ts";
import * as check_alignment from "./check_alignment.ts";
import * as check_enums from "./check_enums.ts";
import * as check_const_item_mutation from "./check_const_item_mutation.ts";
import * as check_null from "./check_null.ts";
import * as check_packed_ref from "./check_packed_ref.ts";
import * as check_mut_restriction from "./check_mut_restriction.ts";
import * as cleanup_post_borrowck from "./cleanup_post_borrowck.ts";
import * as copy_prop from "./copy_prop.ts";
import * as coroutine from "./coroutine/mod.ts";
import * as coverage from "./coverage/mod.ts";
import * as ctfe_limit from "./ctfe_limit.ts";
import * as dataflow_const_prop from "./dataflow_const_prop.ts";
import * as dead_store_elimination from "./dead_store_elimination.ts";
import * as deref_separator from "./deref_separator.ts";
import * as dest_prop from "./dest_prop.ts";
import * as early_otherwise_branch from "./early_otherwise_branch.ts";
import * as erase_deref_temps from "./erase_deref_temps.ts";
import * as elaborate_box_derefs from "./elaborate_box_derefs.ts";
import * as elaborate_drops from "./elaborate_drops.ts";
import * as function_item_references from "./function_item_references.ts";
import * as gvn from "./gvn.ts";
import * as inline from "./inline.ts";
import * as impossible_clauses from "./impossible_clauses.ts";
import * as instsimplify from "./instsimplify.ts";
import * as jump_threading from "./jump_threading.ts";
import * as known_panics_lint from "./known_panics_lint.ts";
import * as lint_and_remove_uninhabited from "./lint_and_remove_uninhabited.ts";
import * as lower_intrinsics from "./lower_intrinsics.ts";
import * as lower_slice_len from "./lower_slice_len.ts";
import * as match_branches from "./match_branches.ts";
import * as mentioned_items from "./mentioned_items.ts";
import * as multiple_return_terminators from "./multiple_return_terminators.ts";
import * as post_drop_elaboration from "./post_drop_elaboration.ts";
import * as prettify from "./prettify.ts";
import * as promote_consts from "./promote_consts.ts";
import * as ref_prop from "./ref_prop.ts";
import * as remove_noop_landing_pads from "./remove_noop_landing_pads.ts";
import * as remove_place_mention from "./remove_place_mention.ts";
import * as remove_storage_markers from "./remove_storage_markers.ts";
import * as remove_uninit_drops from "./remove_uninit_drops.ts";
import * as remove_unneeded_drops from "./remove_unneeded_drops.ts";
import * as remove_zsts from "./remove_zsts.ts";
import { RequiredConstsVisitor } from "./required_consts.ts";
import * as post_analysis_normalize from "./post_analysis_normalize.ts";
import * as sanity_check from "./sanity_check.ts";
import * as simplify from "./simplify.ts";
import * as simplify_branches from "./simplify_branches.ts";
import * as simplify_comparison_integral from "./simplify_comparison_integral.ts";
import * as single_use_consts from "./single_use_consts.ts";
import * as sroa from "./sroa.ts";
import * as strip_debuginfo from "./strip_debuginfo.ts";
import * as ssa_range_prop from "./ssa_range_prop.ts";
import * as tail_copy_to_move from "./tail_copy_to_move.ts";
import * as unreachable_enum_branching from "./unreachable_enum_branching.ts";
import * as unreachable_prop from "./unreachable_prop.ts";
import * as cross_crate_inline from "./cross_crate_inline.ts";
import * as deduce_param_attrs from "./deduce_param_attrs.ts";
import * as ffi_unwind_calls from "./ffi_unwind_calls.ts";
import * as lint_tail_expr_drop_order from "./lint_tail_expr_drop_order.ts";
import * as liveness from "./liveness.ts";
import * as shim from "./shim.ts";
import * as trivial_const from "./trivial_const.ts";
import type { Steal } from "../rustc_data_structures/steal.ts";
import type * as hir from "../rustc_hir/hir.ts";
import { debug_ConstContext } from "../rustc_hir/hir.gen.ts";
import { FieldIdx } from "../rustc_abi/layout.ts";
import {
  type Body,
  ClearCrossCrate,
  clone_Body,
  clone_Operand,
  Const,
  type ConstQualifs,
  Local,
  LocalDecl,
  type MirPhase,
  MirPhase_cmp,
  Operand,
  Place,
  Place_from_Local,
  type PlaceElem,
  SourceInfo,
  START_BLOCK,
  Statement,
} from "../rustc_middle/mir/mod.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty } from "../rustc_middle/ty/decls.ts";
import type { Providers } from "../rustc_middle/util/mod.ts";
import { debug_LocalDefId, type DefId, LocalDefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP, type Spanned } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { sym } from "../rustc_span/symbol.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert, panic, unported, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { field_mut, type MutRef } from "../std/mut_ref.ts";
import { DefKind } from "../rustc_hir/def.ts";
import type { ModuleItems } from "../rustc_middle/hir/mod.ts";

// tidy-alphabetical-start
// #![feature(const_type_name)]
// #![feature(cow_is_borrowed)]
// #![feature(deref_patterns)]
// #![feature(impl_trait_in_assoc_type)]
// #![feature(iterator_try_collect)]
// #![feature(option_into_flat_iter)]
// #![feature(try_blocks)]
// #![feature(yeet_expr)]
// tidy-alphabetical-end

// #[macro_use]
// mod pass_manager;            (pass_manager.ts, imported first)
//
// mod check_pointers;          (not referenced here: lane mt-kpl-ubchecks adds check_pointers.ts)
// mod cost_checker;            (not referenced here: lane mt-inline adds cost_checker.ts)
// mod cross_crate_inline;      (stub, lane mt-inline)
// mod deduce_param_attrs;      (stub, lane mt-opt2)
// mod diagnostics;             (generated by tools/codegen: lane mt-built-lints)
// mod elaborate_drop;          (not referenced here: lane mt-drops adds elaborate_drop.ts)
// mod ffi_unwind_calls;        (stub, lane mt-built-lints)
// mod lint;                    (stub, lane mt-validate)
// mod lint_tail_expr_drop_order; (stub, lane mt-built-lints)
// mod liveness;                (stub, lane mt-liveness)
// mod patch;                   (patch.ts)
// mod shim;                    (stub, lane mt-shim)
// mod ssa;                     (not referenced here: lane mt-opt1 adds ssa.ts)
// mod trivial_const;           (trivial_const.ts)

/// Exposed for rustc drivers.
export { build_drop_shim } from "./shim.ts";

/// We import passes via this macro so that we can have a static list of pass names
/// (used to verify CLI arguments). It takes a list of modules, followed by the passes
/// declared within them.
/// ```ignore,macro-test
/// declare_passes! {
///     // Declare a single pass from the module `abort_unwinding_calls`
///     mod abort_unwinding_calls : AbortUnwindingCalls;
///     // When passes are grouped together as an enum, declare the two constituent passes
///     mod add_call_guards : AddCallGuards {
///         AllCallEdges,
///         CriticalCallEdges
///     };
///     // Declares multiple pass groups, each containing their own constituent passes
///     mod simplify : SimplifyCfg {
///         Initial,
///         /* omitted */
///     }, SimplifyLocals {
///         BeforeConstProp,
///         /* omitted */
///     };
/// }
/// ```
// PORT: `declare_passes!` / `pass_names!` expanded by hand: the `mod`s are the imports above; `PASS_NAMES` below lists,
// in macro order, `stringify!($pass_name)` for a lone pass and `$mod_name::$pass_group::$pass_name.name()` for each
// pass of a group.

/** The `pass_names!` arms: a lone pass name, or the passes of a group (their `name()`). */
type PassNames = string | readonly MirPass[];

/** The arguments of `declare_passes! { .. }` (lib.rs:122), the `pub` markers dropped. */
function declared_passes(): PassNames[] {
  return [
    // mod abort_unwinding_calls : AbortUnwindingCalls;
    "AbortUnwindingCalls",
    // mod add_call_guards : AddCallGuards { AllCallEdges, CriticalCallEdges };
    [add_call_guards.AddCallGuards.AllCallEdges, add_call_guards.AddCallGuards.CriticalCallEdges],
    // mod add_moves_for_packed_drops : AddMovesForPackedDrops;
    "AddMovesForPackedDrops",
    // mod add_subtyping_projections : Subtyper;
    "Subtyper",
    // mod check_inline : CheckForceInline;
    "CheckForceInline",
    // mod check_call_recursion : CheckCallRecursion, CheckDropRecursion;
    "CheckCallRecursion",
    "CheckDropRecursion",
    // mod check_alignment : CheckAlignment;
    "CheckAlignment",
    // mod check_enums : CheckEnums;
    "CheckEnums",
    // mod check_const_item_mutation : CheckConstItemMutation;
    "CheckConstItemMutation",
    // mod check_null : CheckNull;
    "CheckNull",
    // mod check_packed_ref : CheckPackedRef;
    "CheckPackedRef",
    // mod check_mut_restriction : CheckMutRestriction;
    "CheckMutRestriction",
    // This pass is public to allow external drivers to perform MIR cleanup
    // pub mod cleanup_post_borrowck : CleanupPostBorrowck;
    "CleanupPostBorrowck",

    // mod copy_prop : CopyProp;
    "CopyProp",
    // mod coroutine : StateTransform;
    "StateTransform",
    // mod coverage : InstrumentCoverage;
    "InstrumentCoverage",
    // mod ctfe_limit : CtfeLimit;
    "CtfeLimit",
    // mod dataflow_const_prop : DataflowConstProp;
    "DataflowConstProp",
    // mod dead_store_elimination : DeadStoreElimination { Initial, Final };
    [dead_store_elimination.DeadStoreElimination.Initial, dead_store_elimination.DeadStoreElimination.Final],
    // mod deref_separator : Derefer;
    "Derefer",
    // mod dest_prop : DestinationPropagation;
    "DestinationPropagation",
    // mod early_otherwise_branch : EarlyOtherwiseBranch;
    "EarlyOtherwiseBranch",
    // mod erase_deref_temps : EraseDerefTemps;
    "EraseDerefTemps",
    // mod elaborate_box_derefs : ElaborateBoxDerefs;
    "ElaborateBoxDerefs",
    // mod elaborate_drops : ElaborateDrops;
    "ElaborateDrops",
    // mod function_item_references : FunctionItemReferences;
    "FunctionItemReferences",
    // mod gvn : GVN;
    "GVN",
    // Made public so that `mir_drops_elaborated_and_const_checked` can be overridden
    // by custom rustc drivers, running all the steps by themselves. See #114628.
    // pub mod inline : Inline, ForceInline;
    "Inline",
    "ForceInline",
    // mod impossible_clauses : ImpossibleClauses;
    "ImpossibleClauses",
    // mod instsimplify : InstSimplify { BeforeInline, AfterSimplifyCfg };
    [instsimplify.InstSimplify.BeforeInline, instsimplify.InstSimplify.AfterSimplifyCfg],
    // mod jump_threading : JumpThreading;
    "JumpThreading",
    // mod known_panics_lint : KnownPanicsLint;
    "KnownPanicsLint",
    // mod lint_and_remove_uninhabited : LintAndRemoveUninhabited;
    "LintAndRemoveUninhabited",
    // mod lower_intrinsics : LowerIntrinsics;
    "LowerIntrinsics",
    // mod lower_slice_len : LowerSliceLenCalls;
    "LowerSliceLenCalls",
    // mod match_branches : MatchBranchSimplification;
    "MatchBranchSimplification",
    // mod mentioned_items : MentionedItems;
    "MentionedItems",
    // mod multiple_return_terminators : MultipleReturnTerminators;
    "MultipleReturnTerminators",
    // mod post_drop_elaboration : CheckLiveDrops;
    "CheckLiveDrops",
    // mod prettify : ReorderBasicBlocks, ReorderLocals;
    "ReorderBasicBlocks",
    "ReorderLocals",
    // mod promote_consts : PromoteTemps;
    "PromoteTemps",
    // mod ref_prop : ReferencePropagation;
    "ReferencePropagation",
    // mod remove_noop_landing_pads : RemoveNoopLandingPads;
    "RemoveNoopLandingPads",
    // mod remove_place_mention : RemovePlaceMention;
    "RemovePlaceMention",
    // mod remove_storage_markers : RemoveStorageMarkers;
    "RemoveStorageMarkers",
    // mod remove_uninit_drops : RemoveUninitDrops;
    "RemoveUninitDrops",
    // mod remove_unneeded_drops : RemoveUnneededDrops;
    "RemoveUnneededDrops",
    // mod remove_zsts : RemoveZsts;
    "RemoveZsts",
    // mod required_consts : RequiredConstsVisitor;
    "RequiredConstsVisitor",
    // mod post_analysis_normalize : PostAnalysisNormalize;
    "PostAnalysisNormalize",
    // mod sanity_check : SanityCheck;
    "SanityCheck",
    // This pass is public to allow external drivers to perform MIR cleanup
    // pub mod simplify :
    //     SimplifyCfg { Initial, PromoteConsts, RemoveFalseEdges, PostAnalysis, PreOptimizations, Final, MakeShim,
    //                   AfterUnreachableEnumBranching },
    //     SimplifyLocals { BeforeConstProp, AfterGVN, Final };
    [
      simplify.SimplifyCfg.Initial,
      simplify.SimplifyCfg.PromoteConsts,
      simplify.SimplifyCfg.RemoveFalseEdges,
      simplify.SimplifyCfg.PostAnalysis,
      simplify.SimplifyCfg.PreOptimizations,
      simplify.SimplifyCfg.Final,
      simplify.SimplifyCfg.MakeShim,
      simplify.SimplifyCfg.AfterUnreachableEnumBranching,
    ],
    [simplify.SimplifyLocals.BeforeConstProp, simplify.SimplifyLocals.AfterGVN, simplify.SimplifyLocals.Final],
    // mod simplify_branches : SimplifyConstCondition { AfterInstSimplify, AfterConstProp, Final };
    [
      simplify_branches.SimplifyConstCondition.AfterInstSimplify,
      simplify_branches.SimplifyConstCondition.AfterConstProp,
      simplify_branches.SimplifyConstCondition.Final,
    ],
    // mod simplify_comparison_integral : SimplifyComparisonIntegral;
    "SimplifyComparisonIntegral",
    // mod single_use_consts : SingleUseConsts;
    "SingleUseConsts",
    // mod sroa : ScalarReplacementOfAggregates;
    "ScalarReplacementOfAggregates",
    // mod strip_debuginfo : StripDebugInfo;
    "StripDebugInfo",
    // mod ssa_range_prop: SsaRangePropagation;
    "SsaRangePropagation",
    // mod tail_copy_to_move : TailCopyToMove;
    "TailCopyToMove",
    // mod unreachable_enum_branching : UnreachableEnumBranching;
    "UnreachableEnumBranching",
    // mod unreachable_prop : UnreachablePropagation;
    "UnreachablePropagation",
    // mod validate : Validator;
    "Validator",
  ];
}

let PASS_NAMES_: Set<string> | undefined;
/** `static PASS_NAMES: LazyLock<FxIndexSet<&str>>` (an insertion-ordered `Set`). */
export function PASS_NAMES(): Set<string> {
  if (PASS_NAMES_ === undefined) {
    const set = new Set<string>();
    for (const names of declared_passes()) {
      if (typeof names === "string") {
        set.add(names);
      } else {
        for (const pass of names) set.add(pass.name());
      }
    }
    PASS_NAMES_ = set;
  }
  return PASS_NAMES_;
}

// rustc: compiler/rustc_mir_transform/src/lib.rs:214 provide
export function provide(providers: Providers): void {
  coverage.query.provide(providers);
  ffi_unwind_calls.provide(providers.queries);
  shim.provide(providers.queries);
  cross_crate_inline.provide(providers.queries);
  providers.hooks.find_noop_landing_pads_for_instance = remove_noop_landing_pads.find_noop_landing_pads_for_instance as unknown as Providers["hooks"]["find_noop_landing_pads_for_instance"];
  // providers.queries = query::Providers { mir_keys, mir_built, .., ..providers.queries };
  // PORT: the query values typed `unknown` by queries.gen.ts (`check_liveness`) take the ported fn as is.
  const q = providers.queries;
  q.mir_keys = mir_keys;
  q.mir_built = mir_built;
  q.mir_const_qualif = mir_const_qualif;
  q.mir_promoted = mir_promoted;
  q.mir_drops_elaborated_and_const_checked = mir_drops_elaborated_and_const_checked;
  q.mir_for_ctfe = mir_for_ctfe;
  q.mir_coroutine_witnesses = coroutine.mir_coroutine_witnesses;
  q.optimized_mir = optimized_mir;
  q.check_liveness = liveness.check_liveness;
  q.is_mir_available = is_mir_available;
  q.mir_callgraph_cyclic = inline.cycle.mir_callgraph_cyclic;
  q.mir_inliner_callees = inline.cycle.mir_inliner_callees;
  q.promoted_mir = promoted_mir;
  q.deduced_param_attrs = deduce_param_attrs.deduced_param_attrs;
  q.coroutine_by_move_body_def_id = coroutine.coroutine_by_move_body_def_id;
  q.trivial_const = trivial_const.trivial_const_provider;
}

// rustc: compiler/rustc_mir_transform/src/lib.rs:242 remap_mir_for_const_eval_select
function remap_mir_for_const_eval_select(tcx: TyCtxt, body: Body, context: hir.Constness): Body {
  for (const bb of body.basic_blocks.as_mut()) {
    const terminator = unwrap(bb.terminator, "invalid terminator");
    const kind = terminator.kind;
    let def_id: DefId | undefined;
    if (
      kind.$ === "Call" &&
      kind.func.$ === "Constant" &&
      (def_id = fn_def_id(Const.ty(kind.func._0.const_))) !== undefined &&
      tcx.is_intrinsic(def_id, sym.const_eval_select)
    ) {
      const { destination, target, unwind, fn_span } = kind;
      const taken = take_array(field_mut(kind, "args"), 3);
      if (taken.$ !== "Ok") {
        unreachable();
      }
      const [tupled_args, called_in_const, called_at_rt] = taken._0 as [Spanned<Operand>, Spanned<Operand>, Spanned<Operand>];
      const ty = Operand.ty(tupled_args.node, body.local_decls, tcx);
      const fields = ty.tuple_fields();
      const num_args = fields.length;
      let func: Spanned<Operand>;
      switch (context.$) {
        // Using `const_eval_select` in always-const code is useful when used in macros
        // that you don't know whether they are going to be used in `const fn` or in `const` items.
        case "Const":
          func = called_in_const;
          break;
        case "NotConst":
          func = called_at_rt;
          break;
      }
      let method: (place: Place) => Operand;
      let place: Place;
      switch (tupled_args.node.$) {
        case "Constant":
        case "RuntimeChecks": {
          // There is no good way of extracting a tuple arg from a constant
          // (const generic stuff) so we just create a temporary and deconstruct
          // that.
          // `body.local_decls.push(..)` returns the new local
          const local = Local.new(body.local_decls.length);
          body.local_decls.push(LocalDecl.new(ty, fn_span));
          bb.statements.push(
            Statement.new(SourceInfo.outermost(fn_span), {
              $: "Assign",
              _0: [Place_from_Local(local), { $: "Use", _0: clone_Operand(tupled_args.node), _1: "Yes" }],
            }),
          );
          [method, place] = [(p) => ({ $: "Move", _0: p }), Place_from_Local(local)];
          break;
        }
        case "Move":
          [method, place] = [(p) => ({ $: "Move", _0: p }), tupled_args.node._0];
          break;
        case "Copy":
          [method, place] = [(p) => ({ $: "Copy", _0: p }), tupled_args.node._0];
          break;
      }
      const place_elems = place.projection;
      const arguments_: Spanned<Operand>[] = [];
      for (let x = 0; x < num_args; x++) {
        const place_elems_: PlaceElem[] = [...place_elems];
        place_elems_.push({ $: "Field", _0: FieldIdx.from_usize(x), _1: fields[x]! });
        const projection = tcx.mk_place_elems(place_elems_);
        const place_ = new Place(place.local, projection);
        arguments_.push({ node: method(place_), span: DUMMY_SP });
      }
      terminator.kind = {
        $: "Call",
        func: func.node,
        args: arguments_,
        destination,
        target,
        unwind,
        call_source: "Misc",
        fn_span,
      };
    }
  }
  return body;
}

/** `if let ty::FnDef(def_id, _) = *ty.kind()`. */
function fn_def_id(ty: Ty): DefId | undefined {
  const k = ty.kind();
  return k.$ === "FnDef" ? k._0 : undefined;
}

// PORT: the const generic `N` is the parameter `n`; `Box<[T; N]>::try_from(Box<[T]>)` succeeds iff the length is `n`.
// rustc: compiler/rustc_mir_transform/src/lib.rs:318 take_array
function take_array<T>(b: MutRef<T[]>, n: number): Result<T[], T[]> {
  const taken = b.value;
  b.value = [];
  if (taken.length !== n) return Err(taken);
  return Ok(taken);
}

// rustc: compiler/rustc_mir_transform/src/lib.rs:323 is_mir_available
function is_mir_available(tcx: TyCtxt, def_id: LocalDefId): boolean {
  return tcx.mir_keys(null).has(def_id);
}

/// Finds the full set of `DefId`s within the current crate that have
/// MIR associated with them.
// rustc: compiler/rustc_mir_transform/src/lib.rs:329 mir_keys
function mir_keys(tcx: TyCtxt, _: null): Set<LocalDefId> {
  // All body-owners have MIR associated with them.
  const all: Set<LocalDefId> = new Set(tcx.hir_body_owners());

  // Remove the fake bodies for `global_asm!`, since they're not useful
  // to be emitted (`--emit=mir`) or encoded (in metadata).
  // `FxIndexSet::retain` keeps the order of the kept elements.
  const set: Set<LocalDefId> = new Set();
  for (const def_id of all) {
    if (!(tcx.def_kind(def_id).$ === "GlobalAsm")) set.add(def_id);
  }

  // Coroutine-closures (e.g. async closures) have an additional by-move MIR
  // body that isn't in the HIR.
  for (const body_owner of tcx.hir_body_owners()) {
    if (tcx.def_kind(body_owner).$ === "Closure" && tcx.needs_coroutine_by_move_body_def_id(LocalDefId.to_def_id(body_owner))) {
      set.add(tcx.coroutine_by_move_body_def_id(body_owner).expect_local());
    }
  }

  // tuple struct/variant constructors have MIR, but they don't have a BodyId,
  // so we need to build them separately.
  // PORT: the `hir_crate_items` query value is `unknown` in queries.gen.ts.
  for (const item of (tcx.hir_crate_items(null) as ModuleItems).free_items()) {
    const k = tcx.def_kind(item.owner_id);
    if (k.$ === "Struct" || k.$ === "Enum") {
      // PORT: the `adt_def` query value is `unknown` in queries.gen.ts.
      for (const variant of (tcx.adt_def(item.owner_id) as AdtDef).variants()) {
        const ctor = variant.ctor;
        if (ctor !== undefined && ctor[0] === "Fn") {
          const ctor_def_id = ctor[1];
          set.add(ctor_def_id.expect_local());
        }
      }
    }
  }

  return set;
}

/** `ConstQualifs::default()` (`#[derive(Default)]`). */
function ConstQualifs_default(): ConstQualifs {
  return { has_mut_interior: false, needs_drop: false, needs_non_const_drop: false, tainted_by_errors: undefined };
}

// rustc: compiler/rustc_mir_transform/src/lib.rs:362 mir_const_qualif
function mir_const_qualif(tcx: TyCtxt, def: LocalDefId): ConstQualifs {
  // N.B., this `borrow()` is guaranteed to be valid (i.e., the value
  // cannot yet be stolen), because `mir_promoted()`, which steals
  // from `mir_built()`, forces this query to execute before
  // performing the steal.
  const _body = tcx.mir_built(def).borrow();
  // PORT: rustc_const_eval's check_consts is not ported (lanes mt-promote / const-check): the rest of this fn is
  //   let ccx = check_consts::ConstCx::new(tcx, body);
  //   // No need to const-check a non-const `fn`.
  //   match ccx.const_kind {
  //       Some(ConstContext::Const { .. } | ConstContext::Static(_) | ConstContext::ConstFn) => {}
  //       None => span_bug!(tcx.def_span(def), "`mir_const_qualif` should only be called on const fns and const items"),
  //   }
  //   if body.return_ty().references_error() {
  //       // It's possible to reach here without an error being emitted (#121103).
  //       tcx.dcx().span_delayed_bug(body.span, "mir_const_qualif: MIR had errors");
  //       return Default::default();
  //   }
  //   let mut validator = check_consts::check::Checker::new(&ccx);
  //   validator.check_body();
  //   // We return the qualifs in the return place for every MIR body, even though it is only used
  //   // when deciding to promote a reference to a `const` for now.
  //   validator.qualifs_in_return_place()
  return unported("rustc_const_eval::check_consts::ConstCx::new (mir_const_qualif; lanes mt-promote / const-check)");
}

/// Implementation of the `mir_built` query.
// rustc: compiler/rustc_mir_transform/src/lib.rs:393 mir_built
function mir_built(tcx: TyCtxt, def: LocalDefId): Steal<Body> {
  // Delegate to the main MIR building code in the `rustc_mir_build` crate.
  // This is the one place that is allowed to call `build_mir_inner_impl`.
  // PORT: the hook's value is `unknown` in rustc_middle/hooks.ts (`Body`).
  const body = tcx.build_mir_inner_impl(def) as Body;

  // Identifying trivial consts based on their mir_built is easy, but a little wasteful.
  // Trying to push this logic earlier in the compiler and never even produce the Body would
  // probably improve compile time.
  if (trivial_const.trivial_const(tcx, def, () => body) !== undefined) {
    // Skip all the passes below for trivial consts.
    const body_ = tcx.alloc_steal_mir(body);
    pass_manager.dump_mir_for_phase_change(tcx, body_.borrow());
    return body_;
  }

  pass_manager.dump_mir_for_phase_change(tcx, body);

  pass_manager.run_passes(
    tcx,
    body,
    [
      // This used to be part of MIR building,
      // now done separately to separate concerns.
      new lint_and_remove_uninhabited.LintAndRemoveUninhabited(),
      // MIR-level lints.
      new Lint(new check_inline.CheckForceInline()),
      new Lint(new check_call_recursion.CheckCallRecursion()),
      new Lint(new check_packed_ref.CheckPackedRef()),
      new Lint(new check_const_item_mutation.CheckConstItemMutation()),
      new Lint(new check_mut_restriction.CheckMutRestriction()),
      new Lint(new function_item_references.FunctionItemReferences()),
      // What we need to do constant evaluation.
      simplify.SimplifyCfg.Initial,
      new Lint(new sanity_check.SanityCheck()),
    ],
    undefined,
  );
  return tcx.alloc_steal_mir(body);
}

/// Compute the main MIR body and the list of MIR bodies of the promoteds.
// rustc: compiler/rustc_mir_transform/src/lib.rs:434 mir_promoted
function mir_promoted(tcx: TyCtxt, def: LocalDefId): [Steal<Body>, Steal<Body[]>] {
  // debug_assert!(!tcx.is_trivial_const(def), "Tried to get mir_promoted of a trivial const");
  // debug_assert!(!tcx.is_constructor(def.to_def_id()));

  // Ensure that we compute the `mir_const_qualif` for constants at
  // this point, before we steal the mir-const result.
  // Also this means promotion can rely on all const checks having been done.

  let const_qualifs: ConstQualifs;
  const def_kind = tcx.def_kind(def);
  // PORT: the `constness` query value is `unknown` in queries.gen.ts.
  if ((def_kind.$ === "Fn" || def_kind.$ === "AssocFn" || def_kind.$ === "Closure") && (tcx.constness(def) as hir.Constness).$ === "Const") {
    const_qualifs = tcx.mir_const_qualif(def);
  } else if (def_kind.$ === "AssocConst" || def_kind.$ === "Const" || def_kind.$ === "Static" || def_kind.$ === "AnonConst") {
    const_qualifs = tcx.mir_const_qualif(def);
  } else {
    const_qualifs = ConstQualifs_default();
  }

  // the `has_ffi_unwind_calls` query uses the raw mir, so make sure it is run.
  tcx.ensure_done().has_ffi_unwind_calls(def);

  // the `by_move_body` query uses the raw mir, so make sure it is run.
  if (tcx.needs_coroutine_by_move_body_def_id(LocalDefId.to_def_id(def))) {
    tcx.ensure_done().coroutine_by_move_body_def_id(def);
  }

  // the `trivial_const` query uses mir_built, so make sure it is run.
  tcx.ensure_done().trivial_const(def);

  const body = tcx.mir_built(def).steal();
  const error_reported = const_qualifs.tainted_by_errors;
  if (error_reported !== undefined) {
    body.tainted_by_errors = error_reported;
  }

  // Collect `required_consts` *before* promotion, so if there are any consts being promoted
  // we still add them to the list in the outer MIR body.
  RequiredConstsVisitor.compute_required_consts(body);

  // What we need to run borrowck etc.
  // `promote_consts::PromoteTemps::default()`
  const promote_pass = new promote_consts.PromoteTemps([]);
  pass_manager.run_passes(tcx, body, [promote_pass, simplify.SimplifyCfg.PromoteConsts, new coverage.InstrumentCoverage()], {
    $: "Analysis",
    _0: "Initial",
  });

  // Avoid over-capacity in the vectors of basic blocks, which can take up substantial memory.
  // This costs a tiny bit of performance to save a lot of memory.
  // for bb in body.basic_blocks.as_mut_preserves_cfg() { bb.statements.shrink_to_fit(); }  (capacity only)
  body.basic_blocks.as_mut_preserves_cfg();

  lint_tail_expr_drop_order.run_lint(tcx, def, body);

  const promoted = promote_pass.promoted_fragments;
  return [tcx.alloc_steal_mir(body), tcx.alloc_steal_promoted(promoted)];
}

/// Compute the MIR that is used during CTFE (and thus has no optimizations run on it)
// rustc: compiler/rustc_mir_transform/src/lib.rs:499 mir_for_ctfe
function mir_for_ctfe(tcx: TyCtxt, def_id: LocalDefId): Body {
  // debug_assert!(!tcx.is_trivial_const(def_id), "Tried to get mir_for_ctfe of a trivial const");
  return inner_mir_for_ctfe(tcx, def_id);
}

// rustc: compiler/rustc_mir_transform/src/lib.rs:504 inner_mir_for_ctfe
function inner_mir_for_ctfe(tcx: TyCtxt, def: LocalDefId): Body {
  if (tcx.is_constructor(LocalDefId.to_def_id(def))) {
    // There's no reason to run all of the MIR passes on constructors when
    // we can just output the MIR we want directly. This also saves const
    // qualification and borrow checking the trouble of special casing
    // constructors.
    return shim.build_adt_ctor(tcx, LocalDefId.to_def_id(def));
  }

  const body_ = tcx.mir_drops_elaborated_and_const_checked(def);
  let body: Body;
  let always: boolean;
  const ctx = tcx.hir_body_const_context(def);
  if (ctx !== undefined && (ctx.$ === "Const" || ctx.$ === "Static")) {
    // consts and statics do not have `optimized_mir`, so we can steal the body instead of
    // cloning it.
    [body, always] = [body_.steal(), true];
  } else if (ctx !== undefined && ctx.$ === "ConstFn") {
    [body, always] = [clone_Body(body_.borrow()), false];
  } else {
    return bug(`\`mir_for_ctfe\` called on non-const ${debug_LocalDefId(def, PLAIN)}`);
  }

  body = remap_mir_for_const_eval_select(tcx, body, { $: "Const", always });
  // FIXME(reflection): probably need to look at this for comptime closures
  let passes: MirPass[];
  const def_kind = tcx.def_kind(def);
  let constness: hir.Constness;
  if (
    (def_kind.$ === "Fn" || def_kind.$ === "AssocFn") &&
    // PORT: the `constness` query value is `unknown` in queries.gen.ts.
    (constness = tcx.constness(def) as hir.Constness).$ === "Const" &&
    constness.always
  ) {
    // Need to generate mentioned items, as all functions are expected to have them, but for const
    // fns we just look at the optimized MIR, which generates it. For comptime fns, there is no
    // optimized MIR.
    passes = [new ctfe_limit.CtfeLimit(), new mentioned_items.MentionedItems()];
  } else {
    passes = [new ctfe_limit.CtfeLimit()];
  }
  pass_manager.run_passes(tcx, body, passes, undefined);

  return body;
}

/// Obtain just the main MIR (no promoteds) and run some cleanups on it. This also runs
/// mir borrowck *before* doing so in order to ensure that borrowck can be run and doesn't
/// end up missing the source MIR due to stealing happening.
// rustc: compiler/rustc_mir_transform/src/lib.rs:544 mir_drops_elaborated_and_const_checked
function mir_drops_elaborated_and_const_checked(tcx: TyCtxt, def: LocalDefId): Steal<Body> {
  if (tcx.is_coroutine(LocalDefId.to_def_id(def))) {
    tcx.ensure_done().mir_coroutine_witnesses(def);
  }

  // We only need to borrowck non-synthetic MIR.
  let tainted_by_errors;
  if (!tcx.is_synthetic_mir(def)) {
    const r = tcx.mir_borrowck(tcx.typeck_root_def_id_local(def));
    tainted_by_errors = r.$ === "Err" ? r._0 : undefined;
  } else {
    tainted_by_errors = undefined;
  }

  const is_fn_like = DefKind.is_fn_like(tcx.def_kind(def));
  if (is_fn_like) {
    // Do not compute the mir call graph without said call graph actually being used.
    if (
      pass_manager.should_run_pass(new inline.Inline(), PassCtx.for_body(tcx, LocalDefId.to_def_id(def))) ||
      inline.ForceInline.should_run_pass_for_callee(tcx, LocalDefId.to_def_id(def))
    ) {
      tcx.ensure_done().mir_inliner_callees({ $: "Item", _0: LocalDefId.to_def_id(def) });
    }
  }

  tcx.ensure_done().check_liveness(def);

  const [body_] = tcx.mir_promoted(def);
  const body = body_.steal();

  if (tainted_by_errors !== undefined) {
    body.tainted_by_errors = tainted_by_errors;
  }

  const root = tcx.typeck_root_def_id_local(def);
  const transmutes = tcx.check_transmutes(root);
  if (transmutes.$ === "Err") {
    body.tainted_by_errors = transmutes._0;
  }

  // Also taint the body if it's within a top-level item that is not well formed.
  //
  // We do this check here and not during `mir_promoted` because that may result
  // in borrowck cycles if WF requires looking into an opaque hidden type.
  switch (tcx.def_kind(root).$) {
    case "Fn":
    case "AssocFn":
    case "Static":
    case "Const":
    case "AssocConst": {
      const wf = tcx.ensure_result().check_well_formed(root);
      if (wf.$ === "Err") {
        body.tainted_by_errors = wf._0;
      }
      break;
    }
    default:
      break;
  }

  run_analysis_to_runtime_passes(tcx, body);

  return tcx.alloc_steal_mir(body);
}

/** `body.phase == phase` (`#[derive(PartialEq)]` of `MirPhase`). */
function phase_eq(a: MirPhase, b: MirPhase): boolean {
  return MirPhase_cmp(a, b) === 0;
}

/**
 * `check_consts::post_drop_elaboration::checking_enabled(&ConstCx::new(tcx, body))`. PORT: rustc_const_eval's
 * check_consts is not ported (lane mt-promote); this stand-in stops there.
 */
function checking_enabled_ConstCx_new(_tcx: TyCtxt, _body: Body): boolean {
  return unported("rustc_const_eval::check_consts::post_drop_elaboration::checking_enabled (lane mt-promote)");
}

// Made public so that `mir_drops_elaborated_and_const_checked` can be overridden
// by custom rustc drivers, running all the steps by themselves. See #114628.
// rustc: compiler/rustc_mir_transform/src/lib.rs:604 run_analysis_to_runtime_passes
export function run_analysis_to_runtime_passes(tcx: TyCtxt, body: Body): void {
  assert(phase_eq(body.phase, { $: "Analysis", _0: "Initial" }), "assertion failed: body.phase == MirPhase::Analysis(AnalysisPhase::Initial)");
  const _did = body.source.def_id();

  // debug!("analysis_mir_cleanup({:?})", did);
  run_analysis_cleanup_passes(tcx, body);
  assert(phase_eq(body.phase, { $: "Analysis", _0: "PostCleanup" }), "assertion failed: body.phase == MirPhase::Analysis(AnalysisPhase::PostCleanup)");

  // Do a little drop elaboration before const-checking if `const_precise_live_drops` is enabled.
  if (checking_enabled_ConstCx_new(tcx, body)) {
    pass_manager.run_passes(
      tcx,
      body,
      [new remove_uninit_drops.RemoveUninitDrops(), simplify.SimplifyCfg.RemoveFalseEdges, new Lint(new post_drop_elaboration.CheckLiveDrops())],
      undefined,
    );
  }

  // debug!("runtime_mir_lowering({:?})", did);
  run_runtime_lowering_passes(tcx, body);
  assert(phase_eq(body.phase, { $: "Runtime", _0: "Initial" }), "assertion failed: body.phase == MirPhase::Runtime(RuntimePhase::Initial)");

  // debug!("runtime_mir_cleanup({:?})", did);
  run_runtime_cleanup_passes(tcx, body);
  assert(phase_eq(body.phase, { $: "Runtime", _0: "PostCleanup" }), "assertion failed: body.phase == MirPhase::Runtime(RuntimePhase::PostCleanup)");
}

// FIXME(JakobDegen): Can we make these lists of passes consts?

/// After this series of passes, no lifetime analysis based on borrowing can be done.
// rustc: compiler/rustc_mir_transform/src/lib.rs:638 run_analysis_cleanup_passes
function run_analysis_cleanup_passes(tcx: TyCtxt, body: Body): void {
  const passes: MirPass[] = [
    new impossible_clauses.ImpossibleClauses(),
    new cleanup_post_borrowck.CleanupPostBorrowck(),
    new remove_noop_landing_pads.RemoveNoopLandingPads(),
    simplify.SimplifyCfg.PostAnalysis,
    new deref_separator.Derefer(),
  ];

  pass_manager.run_passes(tcx, body, passes, { $: "Analysis", _0: "PostCleanup" });
}

/// Returns the sequence of passes that lowers analysis to runtime MIR.
// rustc: compiler/rustc_mir_transform/src/lib.rs:651 run_runtime_lowering_passes
function run_runtime_lowering_passes(tcx: TyCtxt, body: Body): void {
  const passes: MirPass[] = [
    // These next passes must be executed together.
    add_call_guards.CriticalCallEdges,
    // Must be done before drop elaboration because we need to drop opaque types, too.
    new post_analysis_normalize.PostAnalysisNormalize(),
    // Calling this after `PostAnalysisNormalize` ensures that we don't deal with opaque types.
    new add_subtyping_projections.Subtyper(),
    new elaborate_drops.ElaborateDrops(),
    // Needs to happen after drop elaboration.
    new Lint(new check_call_recursion.CheckDropRecursion()),
    // This will remove extraneous landing pads which are no longer
    // necessary as well as forcing any call in a non-unwinding
    // function calling a possibly-unwinding function to abort the process.
    new abort_unwinding_calls.AbortUnwindingCalls(),
    // AddMovesForPackedDrops needs to run after drop
    // elaboration.
    new add_moves_for_packed_drops.AddMovesForPackedDrops(),
    new erase_deref_temps.EraseDerefTemps(),
    new elaborate_box_derefs.ElaborateBoxDerefs(),
    new coroutine.StateTransform(),
    new Lint(new known_panics_lint.KnownPanicsLint()),
  ];
  pass_manager.run_passes_no_validate(tcx, body, passes, { $: "Runtime", _0: "Initial" });
}

/// Returns the sequence of passes that do the initial cleanup of runtime MIR.
// rustc: compiler/rustc_mir_transform/src/lib.rs:678 run_runtime_cleanup_passes
function run_runtime_cleanup_passes(tcx: TyCtxt, body: Body): void {
  const passes: MirPass[] = [new lower_intrinsics.LowerIntrinsics(), new remove_place_mention.RemovePlaceMention(), simplify.SimplifyCfg.PreOptimizations];

  pass_manager.run_passes(tcx, body, passes, { $: "Runtime", _0: "PostCleanup" });

  // Clear this by anticipation. Optimizations and runtime MIR have no reason to look
  // into this information, which is meant for borrowck diagnostics.
  for (const decl of body.local_decls) {
    decl.local_info = ClearCrossCrate.Clear;
  }
}

// rustc: compiler/rustc_mir_transform/src/lib.rs:694 run_optimization_passes
export function run_optimization_passes(tcx: TyCtxt, body: Body): void {
  // rustc: compiler/rustc_mir_transform/src/lib.rs:695 o1
  function o1<T extends MirPass>(x: T): WithMinOptLevel<T> {
    return new WithMinOptLevel(1, x);
  }

  // The main optimizations that we do on MIR.
  pass_manager.run_passes(
    tcx,
    body,
    [
      // Add some UB checks before any UB gets optimized away.
      new check_alignment.CheckAlignment(),
      new check_null.CheckNull(),
      new check_enums.CheckEnums(),
      // Before inlining: trim down MIR with passes to reduce inlining work.

      // Has to be done before inlining, otherwise actual call will be almost always inlined.
      // Also simple, so can just do first.
      new lower_slice_len.LowerSliceLenCalls(),
      // Perform instsimplify before inline to eliminate some trivial calls (like clone
      // shims).
      instsimplify.InstSimplify.BeforeInline,
      // Perform inlining of `#[rustc_force_inline]`-annotated callees.
      new inline.ForceInline(),
      // Perform inlining, which may add a lot of code.
      new inline.Inline(),
      // Inlining may have introduced a lot of redundant code and a large move pattern.
      // Now, we need to shrink the generated MIR.
      // Code from other crates may have storage markers, so this needs to happen after
      // inlining.
      new remove_storage_markers.RemoveStorageMarkers(),
      // Inlining and instantiation may introduce ZST and useless drops.
      new remove_zsts.RemoveZsts(),
      new remove_unneeded_drops.RemoveUnneededDrops(),
      // Type instantiation may create uninhabited enums.
      // Also eliminates some unreachable branches based on variants of enums.
      new unreachable_enum_branching.UnreachableEnumBranching(),
      new unreachable_prop.UnreachablePropagation(),
      o1(simplify.SimplifyCfg.AfterUnreachableEnumBranching),
      new multiple_return_terminators.MultipleReturnTerminators(),
      // After simplifycfg, it allows us to discover new opportunities for peephole
      // optimizations. This invalidates CFG caches, so avoid putting between
      // `ReferencePropagation` and `GVN` which both use the dominator tree.
      instsimplify.InstSimplify.AfterSimplifyCfg,
      // After `InstSimplify-after-simplifycfg` with `-Zub_checks=false`, simplify
      // ```
      // _13 = const false;
      // assume(copy _13);
      // Call(precondition_check);
      // ```
      // to unreachable to eliminate the call to help later passes.
      // This invalidates CFG caches also.
      o1(simplify_branches.SimplifyConstCondition.AfterInstSimplify),
      new ref_prop.ReferencePropagation(),
      new sroa.ScalarReplacementOfAggregates(),
      simplify.SimplifyLocals.BeforeConstProp,
      dead_store_elimination.DeadStoreElimination.Initial,
      new gvn.GVN(),
      simplify.SimplifyLocals.AfterGVN,
      // This pass does attempt to track assignments.
      // Keep it close to GVN which merges identical values into the same local.
      new ssa_range_prop.SsaRangePropagation(),
      new match_branches.MatchBranchSimplification(),
      new dataflow_const_prop.DataflowConstProp(),
      new single_use_consts.SingleUseConsts(),
      o1(simplify_branches.SimplifyConstCondition.AfterConstProp),
      new jump_threading.JumpThreading(),
      new early_otherwise_branch.EarlyOtherwiseBranch(),
      new simplify_comparison_integral.SimplifyComparisonIntegral(),
      o1(simplify_branches.SimplifyConstCondition.Final),
      o1(new remove_noop_landing_pads.RemoveNoopLandingPads()),
      o1(simplify.SimplifyCfg.Final),
      // After the last SimplifyCfg, because this wants one-block functions.
      new strip_debuginfo.StripDebugInfo(),
      new copy_prop.CopyProp(),
      dead_store_elimination.DeadStoreElimination.Final,
      new dest_prop.DestinationPropagation(),
      new tail_copy_to_move.TailCopyToMove(),
      simplify.SimplifyLocals.Final,
      new multiple_return_terminators.MultipleReturnTerminators(),
      // Some cleanup necessary at least for LLVM and potentially other codegen backends.
      add_call_guards.CriticalCallEdges,
      // Cleanup for human readability, off by default.
      new prettify.ReorderBasicBlocks(),
      new prettify.ReorderLocals(),
    ],
    { $: "Runtime", _0: "Optimized" },
  );
}

/// Optimize the MIR and prepare it for codegen.
// rustc: compiler/rustc_mir_transform/src/lib.rs:785 optimized_mir
function optimized_mir(tcx: TyCtxt, did: LocalDefId): Body {
  if (tcx.is_constructor(LocalDefId.to_def_id(did))) {
    // There's no reason to run all of the MIR passes on constructors when
    // we can just output the MIR we want directly. This also saves const
    // qualification and borrow checking the trouble of special casing
    // constructors.
    return tcx.mir_for_ctfe(did);
  }

  return inner_optimized_mir(tcx, did);
}

// rustc: compiler/rustc_mir_transform/src/lib.rs:797 inner_optimized_mir
function inner_optimized_mir(tcx: TyCtxt, did: LocalDefId): Body {
  const ctx = tcx.hir_body_const_context(did);
  if (ctx !== undefined && ctx.$ === "ConstFn") {
    // Run the `mir_for_ctfe` query, which depends on `mir_drops_elaborated_and_const_checked`
    // which we are going to steal below. Thus we need to run `mir_for_ctfe` first, so it
    // computes and caches its result.
    tcx.ensure_done().mir_for_ctfe(did);
  } else if (ctx === undefined) {
    // None => {}
  } else {
    panic(`do not use \`optimized_mir\` for constants: ${debug_ConstContext(ctx, PLAIN)}`);
  }
  // debug!("about to call mir_drops_elaborated...");
  const body_ = tcx.mir_drops_elaborated_and_const_checked(did).steal();
  const body = remap_mir_for_const_eval_select(tcx, body_, { $: "NotConst" });

  if (body.tainted_by_errors !== undefined) {
    return body;
  }

  // Before doing anything, remember which items are being mentioned so that the set of items
  // visited does not depend on the optimization level.
  // We do not use `run_passes` for this as that might skip the pass if `injection_phase` is set.
  new mentioned_items.MentionedItems().run_pass(tcx, body);

  // If `mir_drops_elaborated_and_const_checked` found that the current body has unsatisfiable
  // predicates, it will shrink the MIR to a single `unreachable` terminator.
  // More generally, if MIR is a lone `unreachable`, there is nothing to optimize.
  const start = body.basic_blocks.deref()[START_BLOCK]!;
  if (start.terminator_().kind.$ === "Unreachable" && start.statements.length === 0) {
    return body;
  }

  run_optimization_passes(tcx, body);

  return body;
}

/// Fetch all the promoteds of an item and prepare their MIR bodies to be ready for
/// constant evaluation once all generic parameters become known.
// rustc: compiler/rustc_mir_transform/src/lib.rs:835 promoted_mir
function promoted_mir(tcx: TyCtxt, def: LocalDefId): Body[] {
  if (tcx.is_constructor(LocalDefId.to_def_id(def))) {
    return [];
  }

  if (!tcx.is_synthetic_mir(def)) {
    tcx.ensure_done().mir_borrowck(tcx.typeck_root_def_id_local(def));
  }
  const promoted = tcx.mir_promoted(def)[1].steal();

  for (const body of promoted) {
    run_analysis_to_runtime_passes(tcx, body);
  }

  return promoted;
}
