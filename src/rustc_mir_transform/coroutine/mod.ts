//! This is the implementation of the pass which transforms coroutines into state machines.
//!
//! MIR generation for coroutines creates a function which has a self argument which
//! passes by value. This argument is effectively a coroutine type which only contains upvars and
//! is only used for this argument inside the MIR for the coroutine.
//! It is passed by value to enable upvars to be moved out of it. Drop elaboration runs on that
//! MIR before this pass and creates drop flags for MIR locals.
//! It will also drop the coroutine argument (which only consists of upvars) if any of the upvars
//! are moved out of. This pass elaborates the drops of upvars / coroutine argument in the case
//! that none of the upvars were moved out of. This is because we cannot have any drops of this
//! coroutine in the MIR, since it is used to create the drop glue for the coroutine. We'd get
//! infinite recursion otherwise.
//!
//! This pass creates the implementation for either the `Coroutine::resume` or `Future::poll`
//! function and the drop shim for the coroutine based on the MIR input.
//! It converts the coroutine argument from Self to &mut Self adding derefs in the MIR as needed.
//! It computes the final layout of the coroutine struct which looks like this:
//!     First upvars are stored
//!     It is followed by the coroutine state field.
//!     Then finally the MIR locals which are live across a suspension point are stored.
//!     ```ignore (illustrative)
//!     struct Coroutine {
//!         upvars...,
//!         state: u32,
//!         mir_locals...,
//!     }
//!     ```
//! This pass computes the meaning of the state field and the MIR locals which are live
//! across a suspension point. There are however three hardcoded coroutine states:
//!     0 - Coroutine have not been resumed yet
//!     1 - Coroutine has returned / is completed
//!     2 - Coroutine has been poisoned
//!
//! It also rewrites `return x` and `yield y` as setting a new coroutine state and returning
//! `CoroutineState::Complete(x)` and `CoroutineState::Yielded(y)`,
//! or `Poll::Ready(x)` and `Poll::Pending` respectively.
//! MIR locals which are live across a suspension point are moved to the coroutine struct
//! with references to them being updated with references to the coroutine struct.
//!
//! The pass creates two functions which have a switch on the coroutine state giving
//! the action to take.
//!
//! One of them is the implementation of `Coroutine::resume` / `Future::poll`.
//! For coroutines with state 0 (unresumed) it starts the execution of the coroutine.
//! For coroutines with state 1 (returned) and state 2 (poisoned) it panics.
//! Otherwise it continues the execution from the last suspension point.
//!
//! The other function is the drop glue for the coroutine.
//! For coroutines with state 0 (unresumed) it drops the upvars of the coroutine.
//! For coroutines with state 1 (returned) and state 2 (poisoned) it does nothing.
//! Otherwise it drops all the values in scope at the last suspension point.
// Port of compiler/rustc_mir_transform/src/coroutine/mod.rs (lane mt-coroutine-a, wave 24).
//
// PORT: the visitors `extends MutVisitor` / `Visitor` (mir/visit.ts, D4); `visit_local` takes a `MutRef<Local>`.
// PORT: `IndexVec<Local, Option<(Ty, VariantIdx, FieldIdx)>>` is `([Ty, VariantIdx, FieldIdx] | undefined)[]` (as
// layout.ts); `remap.get(l)` / `remap.contains(l)` (`IndexSlice<I, Option<T>>::contains`) read the slot, `undefined`
// out of bounds. `IndexVec::push` returns the old length.
// PORT: `Place` / `SourceInfo` / `Operand` values that upstream copies (`Copy` / `.clone()`) are `clone_Place` /
// `clone_SourceInfo` / `clone_Operand` where the copy is stored in the MIR (PORTING §8; MutVisitors edit in place).
// PORT: `deref_separator::deref_finder` (lane mt-cleanup) is not exported by its stub module yet: a module-local
// stand-in at the end of this file (not a marker; stops UNPORTED with its upstream path), as coroutine/drop.ts does.
// PORT: `impl MirPass for StateTransform` (mod.rs:1008) sits in the class body (PORTING §8); `Operation`'s methods are
// on its companion const. Items drop.rs reaches through `use super::*` (`SELF_ARG`, `TransformVisitor`, `Operation`,
// `create_cases`, `insert_switch`, ...) are exported. `IndexVec::swap` of `local_decls` is an inline swap; the
// `(usize, BasicBlock)` cases become `SwitchTargets::new`'s `u128` values as `bigint`.
// PORT: `#[tracing::instrument]` / `debug!` / `trace!` are comments (no tracing subscriber).
// Init order: drop.ts imports this module back (`use super::*`); neither reads the other at load time.
import { FieldIdx, VariantIdx } from "../../rustc_abi/layout.ts";
import { Movability } from "../../rustc_ast_ir/lib.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { type CoroutineKind, CoroutineKind as CoroutineKindC } from "../../rustc_hir/hir.ts";
import type { BitMatrix, DenseBitSet } from "../../rustc_index/bit_set.ts";
import {
  type AssertMessage,
  BasicBlockData,
  type BasicBlock,
  CastKind,
  type Body,
  clone_Operand,
  clone_Place,
  clone_SourceInfo,
  Const,
  ConstOperand,
  type CoroutineSavedLocal,
  debug_Local,
  debug_Location,
  Local,
  LocalDecl,
  Location,
  Operand,
  Place,
  Place_from_Local,
  type PlaceElem,
  RETURN_PLACE,
  type Rvalue,
  SourceInfo,
  START_BLOCK,
  Statement,
  SwitchTargets,
  Terminator,
  TerminatorKind,
  UnevaluatedConst,
  UnwindAction,
} from "../../rustc_middle/mir/mod.ts";
import { debug_CoroutineSavedLocal } from "../../rustc_middle/mir/query.ts";
import { MirDumper } from "../../rustc_middle/mir/pretty.ts";
import { MutVisitor, type PlaceContext, PlaceContext as PlaceContextC, Visitor } from "../../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { AdtDef } from "../../rustc_middle/ty/decls.ts";
import { GenericArg, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { Ty, type TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { CoroutineArgsExt } from "../../rustc_middle/ty/sty.ts";
import type { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { always_storage_live_locals } from "../../rustc_mir_dataflow/impls/storage_liveness.ts";
import { type DefId, DefId_eq } from "../../rustc_span/def_id.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { PanicStrategy } from "../../rustc_target/spec/mod.ts";
import { PLAIN } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { assert, panic, unported, unwrap } from "../../std/panic.ts";

import * as abort_unwinding_calls from "../abort_unwinding_calls.ts";
import { MirPass, type PassCtx, PassPolicy } from "../pass_manager.ts";
import * as pm from "../pass_manager.ts";
import { MirPatch } from "../patch.ts";
import * as simplify from "../simplify.ts";

// mod by_move_body;
// mod drop;
// mod layout;

// pub(super) use by_move_body::coroutine_by_move_body_def_id;
export { coroutine_by_move_body_def_id } from "./by_move_body.ts";
import {
  create_coroutine_drop_shim,
  create_coroutine_drop_shim_async,
  create_coroutine_drop_shim_proxy_async,
  elaborate_coroutine_drops,
  has_async_drops,
  insert_clean_drop,
} from "./drop.ts";
// pub(super) use layout::mir_coroutine_witnesses;
export { mir_coroutine_witnesses } from "./layout.ts";
import { type CoroutineSavedLocals, compute_layout, locals_live_across_suspend_points } from "./layout.ts";

// rustc-type: compiler/rustc_mir_transform/src/coroutine/mod.rs:84 StateTransform
export class StateTransform extends MirPass {
  readonly type_name = "rustc_mir_transform::coroutine::StateTransform";

  // ---- impl crate::MirPass for StateTransform (mod.rs:1008) ----

  // #[instrument(level = "debug", skip(self, tcx, body), ret)]
  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:1010 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // debug!(def_id = ?body.source.def_id());

    const old_yield_ty = body.yield_ty();
    if (old_yield_ty === undefined) {
      // This only applies to coroutines
      return;
    }
    // tracing::trace!(def_id = ?body.source.def_id());

    const old_ret_ty = body.return_ty();

    assert(body.coroutine_drop() === undefined && body.coroutine_drop_async() === undefined, "assertion failed: body.coroutine_drop().is_none() && body.coroutine_drop_async().is_none()");

    {
      const dumper = MirDumper.new(tcx, "coroutine_before", body);
      if (dumper !== undefined) {
        dumper.dump_mir(body);
      }
    }

    // The first argument is the coroutine type passed by value
    const coroutine_ty = body.local_decls[1]!.ty;
    const coroutine_kind = unwrap(body.coroutine_kind());

    // Get the discriminant type and args which typeck computed
    const coroutine_ty_kind = coroutine_ty.kind();
    if (coroutine_ty_kind.$ !== "Coroutine") {
      return tcx.dcx().span_bug(body.span, `unexpected coroutine type ${display_Ty(coroutine_ty)}`);
    }
    const args = coroutine_ty_kind._1;
    const discr_ty = CoroutineArgsExt.discr_ty(args.as_coroutine(), tcx);

    let new_ret_ty: Ty;
    if (coroutine_kind.$ === "Desugared" && coroutine_kind._0 === "Async") {
      // Compute Poll<return_ty>
      const poll_did = tcx.require_lang_item(LangItem.Poll, body.span);
      const poll_adt_ref = tcx.adt_def(poll_did) as AdtDef;
      const poll_args = tcx.mk_args([GenericArg.from_Ty(old_ret_ty)]);
      new_ret_ty = Ty.new_adt(tcx, poll_adt_ref, poll_args);
    } else if (coroutine_kind.$ === "Desugared" && coroutine_kind._0 === "Gen") {
      // Compute Option<yield_ty>
      const option_did = tcx.require_lang_item(LangItem.Option, body.span);
      const option_adt_ref = tcx.adt_def(option_did) as AdtDef;
      const option_args = tcx.mk_args([GenericArg.from_Ty(old_yield_ty)]);
      new_ret_ty = Ty.new_adt(tcx, option_adt_ref, option_args);
    } else if (coroutine_kind.$ === "Desugared" && coroutine_kind._0 === "AsyncGen") {
      // The yield ty is already `Poll<Option<yield_ty>>`
      new_ret_ty = old_yield_ty;
    } else {
      // CoroutineKind::Coroutine(_)
      // Compute CoroutineState<yield_ty, return_ty>
      const state_did = tcx.require_lang_item(LangItem.CoroutineState, body.span);
      const state_adt_ref = tcx.adt_def(state_did) as AdtDef;
      const state_args = tcx.mk_args([GenericArg.from_Ty(old_yield_ty), GenericArg.from_Ty(old_ret_ty)]);
      new_ret_ty = Ty.new_adt(tcx, state_adt_ref, state_args);
    }

    // We need to insert clean drop for unresumed state and perform drop elaboration
    // (finally in open_drop_for_tuple) before async drop expansion.
    // Async drops, produced by this drop elaboration, will be expanded,
    // and corresponding futures kept in layout.
    const has_async_drops_ = has_async_drops(body);

    if (CoroutineKindC.is_async_desugaring(coroutine_kind)) {
      eliminate_get_context_calls(tcx, body);
    }

    const always_live_locals = always_storage_live_locals(body);
    const movable = CoroutineKindC.movability(coroutine_kind) === Movability.Movable;
    const liveness_info = locals_live_across_suspend_points(tcx, body, always_live_locals, movable);

    if (tcx.sess.opts.unstable_opts.validate_mir) {
      const vis = new EnsureCoroutineFieldAssignmentsNeverAlias(
        liveness_info.saved_locals,
        liveness_info.storage_conflicts,
        undefined,
      );

      vis.visit_body(body);
    }

    // Extract locals which are live across suspension point into `layout`
    // `remap` gives a mapping from local indices onto coroutine struct indices
    // `storage_liveness` tells us which locals have live storage at suspension points
    const [remap, layout, storage_liveness] = compute_layout(liveness_info, body);

    const can_return_ = can_return(tcx, body, body.typing_env(tcx));

    // We rename RETURN_PLACE which has type mir.return_ty to new_ret_local
    // RETURN_PLACE then is a fresh unused local with type ret_ty.
    const new_ret_local = body.local_decls.length as Local;
    body.local_decls.push(LocalDecl.new(new_ret_ty, body.span));
    // tracing::trace!(?new_ret_local);

    // Run the transformation which converts Places from Local to coroutine struct
    // accesses for locals in `remap`.
    // It also rewrites `return x` and `yield y` as writing a new coroutine state and returning
    // either `CoroutineState::Complete(x)` and `CoroutineState::Yielded(y)`,
    // or `Poll::Ready(x)` and `Poll::Pending` respectively depending on the coroutine kind.
    const transform = new TransformVisitor(
      tcx,
      coroutine_kind,
      discr_ty,
      remap,
      storage_liveness,
      [],
      always_live_locals,
      new_ret_local,
      old_yield_ty,
      old_ret_ty,
      MirPatch.new(body),
    );
    transform.visit_body(body);

    // Swap the actual `RETURN_PLACE` and the provisional `new_ret_local`.
    transform.replace_local(RETURN_PLACE, new_ret_local, body);

    // MIR parameters are not explicitly assigned-to when entering the MIR body.
    // If we want to save their values inside the coroutine state, we need to do so explicitly.
    const source_info = SourceInfo.outermost(body.span);
    const args_iter = body.args_iter();
    const arg_assigns: Statement[] = [];
    for (const local of args_iter) {
      const entry = transform.remap[local];
      if (entry === undefined) continue;
      const [ty, variant_index, idx] = entry;
      const lhs = transform.make_field(variant_index, idx, ty);
      const rhs: Rvalue = { $: "Use", _0: { $: "Move", _0: Place_from_Local(local) }, _1: "Yes" };
      const assign = { $: "Assign" as const, _0: [lhs, rhs] as [Place, Rvalue] };
      arg_assigns.push(Statement.new(clone_SourceInfo(source_info), assign));
    }
    body.basic_blocks.as_mut()[START_BLOCK]!.statements.splice(0, 0, ...arg_assigns);
    const patch = unwrap(transform.patch);
    transform.patch = undefined;
    patch.apply(body);

    // Remove the context argument within generator bodies.
    if (coroutine_kind.$ === "Desugared" && coroutine_kind._0 === "Gen") {
      body.arg_count = 1;
    }

    // The original arguments to the function are no longer arguments, mark them as such.
    // Otherwise they'll conflict with our new arguments, which although they don't have
    // argument_index set, will get emitted as unnamed arguments.
    for (const var_ of body.var_debug_info) {
      var_.argument_index = undefined;
    }

    unwrap(body.coroutine).yield_ty = undefined;
    unwrap(body.coroutine).resume_ty = undefined;
    unwrap(body.coroutine).coroutine_layout = layout;

    // Insert `drop(coroutine_struct)` which is used to drop upvars for coroutines in
    // the unresumed state.
    // This is expanded to a drop ladder in `elaborate_coroutine_drops`.
    const drop_clean = insert_clean_drop(tcx, body, has_async_drops_);

    {
      const dumper = MirDumper.new(tcx, "coroutine_pre-elab", body);
      if (dumper !== undefined) {
        dumper.dump_mir(body);
      }
    }

    // Expand `drop(coroutine_struct)` to a drop ladder which destroys upvars.
    // If any upvars are moved out of, drop elaboration will handle upvar destruction.
    // However we need to also elaborate the code generated by `insert_clean_drop`.
    elaborate_coroutine_drops(tcx, body);

    {
      const dumper = MirDumper.new(tcx, "coroutine_post-transform", body);
      if (dumper !== undefined) {
        dumper.dump_mir(body);
      }
    }

    const can_unwind_ = can_unwind(tcx, body);

    // Create a copy of our MIR and use it to create the drop shim for the coroutine
    if (has_async_drops_) {
      // If coroutine has async drops, generating async drop shim
      const drop_shim = create_coroutine_drop_shim_async(tcx, transform, body, drop_clean, can_unwind_);
      unwrap(body.coroutine).coroutine_drop_async = drop_shim;
    } else {
      // If coroutine has no async drops, generating sync drop shim
      const drop_shim = create_coroutine_drop_shim(tcx, transform, coroutine_ty, body, drop_clean);
      unwrap(body.coroutine).coroutine_drop = drop_shim;

      // For coroutine with sync drop, generating async proxy for `future_drop_poll` call
      const proxy_shim = create_coroutine_drop_shim_proxy_async(tcx, body, coroutine_kind);
      unwrap(body.coroutine).coroutine_drop_proxy_async = proxy_shim;
    }

    // Create the Coroutine::resume / Future::poll function
    create_coroutine_resume_function(tcx, transform, body, can_return_, can_unwind_);
  }

  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:1198 policy
  policy(_ctx: PassCtx): PassPolicy {
    // Implements coroutine semantics by lowering the coroutine body to a state machine.
    return PassPolicy.Required;
  }
}

// rustc-type: compiler/rustc_mir_transform/src/coroutine/mod.rs:86 RenameLocalVisitor
class RenameLocalVisitor extends MutVisitor {
  constructor(
    public from: Local,
    public to: Local,
    public tcx_: TyCtxt,
  ) {
    super();
  }

  // ---- impl MutVisitor for RenameLocalVisitor ----

  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:93 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:97 visit_local
  override visit_local(local: MutRef<Local>, _: PlaceContext, _location: Location): void {
    if (local.value === this.from) {
      local.value = this.to;
    } else if (local.value === this.to) {
      local.value = this.from;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:105 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    switch (terminator.kind.$) {
      case "Return":
        // Do not replace the implicit `_0` access here, as that's not possible. The
        // transform already handles `return` correctly.
        break;
      default:
        this.super_terminator(terminator, location);
    }
  }
}

// rustc-type: compiler/rustc_mir_transform/src/coroutine/mod.rs:116 SelfArgVisitor
class SelfArgVisitor extends MutVisitor {
  constructor(
    public tcx_: TyCtxt,
    public new_base: Place,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:122 new
  static new(tcx: TyCtxt, new_base: Place): SelfArgVisitor {
    return new SelfArgVisitor(tcx, new_base);
  }

  // ---- impl MutVisitor for SelfArgVisitor ----

  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:128 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:132 visit_local
  override visit_local(local: MutRef<Local>, _: PlaceContext, _location: Location): void {
    assert_ne_Local(local.value, SELF_ARG);
  }

  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:136 visit_place
  override visit_place(place: Place, _: PlaceContext, _location: Location): void {
    if (place.local === SELF_ARG) {
      replace_base(place, this.new_base, this.tcx_);
    }

    for (const elem of place.projection) {
      if (elem.$ === "Index") {
        const local = elem._0;
        assert_ne_Local(local, SELF_ARG);
      }
    }
  }
}

/** `assert_ne!(left, right)` of two `Local`s (core's `assert_failed_inner` text, `AssertKind::Ne`). */
function assert_ne_Local(left: Local, right: Local): void {
  if (left === right) {
    panic(`assertion \`left != right\` failed\n  left: ${debug_Local(left, PLAIN)}\n right: ${debug_Local(right, PLAIN)}`);
  }
}

// #[tracing::instrument(level = "trace", skip(tcx))]
// rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:150 replace_base
function replace_base(place: Place, new_base: Place, tcx: TyCtxt): void {
  place.local = new_base.local;

  const new_projection: PlaceElem[] = [...new_base.projection];
  new_projection.push(...place.projection);

  place.projection = tcx.mk_place_elems(new_projection);
  // tracing::trace!(?place);
}

export const SELF_ARG: Local = Local.arg(0);
export const CTX_ARG: Local = Local.arg(1);

/// A `yield` point in the coroutine.
// rustc-type: compiler/rustc_mir_transform/src/coroutine/mod.rs:164 SuspensionPoint
interface SuspensionPoint {
  /// State discriminant used when suspending or resuming at this point.
  state: number;
  /// The block to jump to after resumption.
  resume: BasicBlock;
  /// Where to move the resume argument after resumption.
  resume_arg: Place;
  /// Which block to jump to if the coroutine is dropped in this state.
  drop: BasicBlock | undefined;
  /// Set of locals that have live storage while at this suspension point.
  storage_liveness: DenseBitSet<Local>;
}

// rustc-type: compiler/rustc_mir_transform/src/coroutine/mod.rs:177 TransformVisitor
export class TransformVisitor extends MutVisitor {
  constructor(
    public tcx_: TyCtxt,
    public coroutine_kind: CoroutineKind,

    // The type of the discriminant in the coroutine struct
    public discr_ty: Ty,

    // Mapping from Local to (type of local, coroutine struct index)
    public remap: ([Ty, VariantIdx, FieldIdx] | undefined)[],

    // A map from a suspension point in a block to the locals which have live storage at that point
    public storage_liveness: (DenseBitSet<Local> | undefined)[],

    // A list of suspension points, generated during the transform
    public suspension_points: SuspensionPoint[],

    // The set of locals that have no `StorageLive`/`StorageDead` annotations.
    public always_live_locals: DenseBitSet<Local>,

    // New local we just create to hold the `CoroutineState` value.
    public new_ret_local: Local,

    public old_yield_ty: Ty,

    public old_ret_ty: Ty,

    public patch: MirPatch | undefined,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:207 insert_none_ret_block
  insert_none_ret_block(body: Body): BasicBlock {
    const block = body.basic_blocks.deref().length as BasicBlock;
    const source_info = SourceInfo.outermost(body.span);

    let none_value: Rvalue;
    const ck = this.coroutine_kind;
    if (ck.$ === "Desugared" && ck._0 === "Async") {
      return span_bug(body.span, "`Future`s are not fused inherently");
    } else if (ck.$ === "Coroutine") {
      return span_bug(body.span, "`Coroutine`s cannot be fused");
    } else if (ck.$ === "Desugared" && ck._0 === "Gen") {
      // `gen` continues return `None`
      const option_def_id = this.tcx_.require_lang_item(LangItem.Option, body.span);
      none_value = make_aggregate_adt(option_def_id, VariantIdx.ZERO, this.tcx_.mk_args([GenericArg.from_Ty(this.old_yield_ty)]), []);
    } else {
      // `async gen` continues to return `Poll::Ready(None)`
      const poll_kind = this.old_yield_ty.kind();
      if (poll_kind.$ !== "Adt") return bug();
      const option_kind = poll_kind._1.type_at(0).kind();
      if (option_kind.$ !== "Adt") return bug();
      const yield_ty = option_kind._1.type_at(0);
      none_value = {
        $: "Use",
        _0: {
          $: "Constant",
          _0: new ConstOperand(
            source_info.span,
            undefined,
            {
              $: "Unevaluated",
              _0: UnevaluatedConst.new(
                this.tcx_.require_lang_item(LangItem.AsyncGenFinished, body.span),
                this.tcx_.mk_args([GenericArg.from_Ty(yield_ty)]),
              ),
              _1: this.old_yield_ty,
            },
          ),
        },
        _1: "Yes",
      };
    }

    const statements = [Statement.new(clone_SourceInfo(source_info), { $: "Assign", _0: [Place.return_place(), none_value] })];

    body.basic_blocks_mut().push(
      BasicBlockData.new_stmts(statements, new Terminator(source_info, TerminatorKind.Return), false),
    );

    return block;
  }

  // Make a `CoroutineState` or `Poll` variant assignment.
  //
  // `core::ops::CoroutineState` only has single element tuple variants,
  // so we can just write to the downcasted first field and then set the
  // discriminant to the appropriate variant.
  // #[tracing::instrument(level = "trace", skip(self, statements))]
  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:268 make_state
  make_state(val: Operand, source_info: SourceInfo, is_return: boolean, statements: Statement[]): void {
    const ZERO: VariantIdx = VariantIdx.ZERO;
    const ONE: VariantIdx = VariantIdx.from_usize(1);
    let rvalue: Rvalue;
    const ck = this.coroutine_kind;
    if (ck.$ === "Desugared" && ck._0 === "Async") {
      const poll_def_id = this.tcx_.require_lang_item(LangItem.Poll, source_info.span);
      const args = this.tcx_.mk_args([GenericArg.from_Ty(this.old_ret_ty)]);
      let variant_idx: VariantIdx;
      let operands: Operand[];
      if (is_return) {
        [variant_idx, operands] = [ZERO, [val]]; // Poll::Ready(val)
      } else {
        [variant_idx, operands] = [ONE, []]; // Poll::Pending
      }
      rvalue = make_aggregate_adt(poll_def_id, variant_idx, args, operands);
    } else if (ck.$ === "Desugared" && ck._0 === "Gen") {
      const option_def_id = this.tcx_.require_lang_item(LangItem.Option, source_info.span);
      const args = this.tcx_.mk_args([GenericArg.from_Ty(this.old_yield_ty)]);
      let variant_idx: VariantIdx;
      let operands: Operand[];
      if (is_return) {
        [variant_idx, operands] = [ZERO, []]; // None
      } else {
        [variant_idx, operands] = [ONE, [val]]; // Some(val)
      }
      rvalue = make_aggregate_adt(option_def_id, variant_idx, args, operands);
    } else if (ck.$ === "Desugared" && ck._0 === "AsyncGen") {
      if (is_return) {
        const poll_kind = this.old_yield_ty.kind();
        if (poll_kind.$ !== "Adt") return bug();
        const option_kind = poll_kind._1.type_at(0).kind();
        if (option_kind.$ !== "Adt") return bug();
        const yield_ty = option_kind._1.type_at(0);
        rvalue = {
          $: "Use",
          _0: {
            $: "Constant",
            _0: new ConstOperand(
              source_info.span,
              undefined,
              {
                $: "Unevaluated",
                _0: UnevaluatedConst.new(
                  this.tcx_.require_lang_item(LangItem.AsyncGenFinished, source_info.span),
                  this.tcx_.mk_args([GenericArg.from_Ty(yield_ty)]),
                ),
                _1: this.old_yield_ty,
              },
            ),
          },
          _1: "Yes",
        };
      } else {
        rvalue = { $: "Use", _0: val, _1: "Yes" };
      }
    } else {
      // CoroutineKind::Coroutine(_)
      const coroutine_state_def_id = this.tcx_.require_lang_item(LangItem.CoroutineState, source_info.span);
      const args = this.tcx_.mk_args([GenericArg.from_Ty(this.old_yield_ty), GenericArg.from_Ty(this.old_ret_ty)]);
      const variant_idx = is_return
        ? ONE // CoroutineState::Complete(val)
        : ZERO; // CoroutineState::Yielded(val)
      rvalue = make_aggregate_adt(coroutine_state_def_id, variant_idx, args, [val]);
    }

    // Assign to `new_ret_local`, which will be replaced by `RETURN_PLACE` later.
    statements.push(Statement.new(clone_SourceInfo(source_info), { $: "Assign", _0: [Place_from_Local(this.new_ret_local), rvalue] }));
  }

  // Create a Place referencing a coroutine struct field
  // #[tracing::instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:346 make_field
  make_field(variant_index: VariantIdx, idx: FieldIdx, ty: Ty): Place {
    const self_place = Place_from_Local(SELF_ARG);
    const base = this.tcx_.mk_place_downcast_unnamed(self_place, variant_index);
    const projection: PlaceElem[] = [...base.projection];
    projection.push({ $: "Field", _0: idx, _1: ty });

    return new Place(base.local, this.tcx_.mk_place_elems(projection));
  }

  // Create a statement which changes the discriminant
  // #[tracing::instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:357 set_discr
  set_discr(state_disc: VariantIdx, source_info: SourceInfo): Statement {
    const self_place = Place_from_Local(SELF_ARG);
    return Statement.new(clone_SourceInfo(source_info), {
      $: "SetDiscriminant",
      place: self_place,
      variant_index: state_disc,
    });
  }

  // Create a statement which reads the discriminant into a temporary
  // #[tracing::instrument(level = "trace", skip(self, body))]
  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:370 get_discr
  get_discr(body: Body): [Statement, Place] {
    const temp_decl = LocalDecl.new(this.discr_ty, body.span);
    const local_decls_len = body.local_decls.length as Local;
    body.local_decls.push(temp_decl);
    const temp = Place_from_Local(local_decls_len);

    const self_place = Place_from_Local(SELF_ARG);
    const assign = Statement.new(SourceInfo.outermost(body.span), {
      $: "Assign",
      _0: [clone_Place(temp), { $: "Discriminant", _0: self_place }],
    });
    return [assign, temp];
  }

  /// Swaps all references of `old_local` and `new_local`.
  // #[tracing::instrument(level = "trace", skip(self, body))]
  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:385 replace_local
  replace_local(old_local: Local, new_local: Local, body: Body): void {
    // body.local_decls.swap(old_local, new_local);
    const tmp = body.local_decls[old_local]!;
    body.local_decls[old_local] = body.local_decls[new_local]!;
    body.local_decls[new_local] = tmp;

    const visitor = new RenameLocalVisitor(old_local, new_local, this.tcx_);
    visitor.visit_body(body);
    for (const suspension of this.suspension_points) {
      const ctxt: PlaceContext = { $: "MutatingUse", _0: "Yield" };
      const location = Location.START;
      visitor.visit_place(suspension.resume_arg, ctxt, location);
    }
  }

  // ---- impl MutVisitor for TransformVisitor ----

  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:399 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // #[tracing::instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:404 visit_local
  override visit_local(local: MutRef<Local>, _: PlaceContext, _location: Location): void {
    assert(!remap_contains(this.remap, local.value), "assertion failed: !self.remap.contains(*local)");
  }

  // #[tracing::instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:409 visit_place
  override visit_place(place: Place, _: PlaceContext, location: Location): void {
    // Replace an Local in the remap with a coroutine struct access
    const entry = this.remap[place.local];
    if (entry !== undefined) {
      const [ty, variant_index, idx] = entry;
      replace_base(place, this.make_field(variant_index, idx, ty), this.tcx_);
    }
    const new_projection = this.process_projection(place.projection, location);
    if (new_projection !== undefined) {
      place.projection = this.tcx_.mk_place_elems(new_projection);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:419 process_projection_elem
  override process_projection_elem(elem: PlaceElem, location: Location): PlaceElem | undefined {
    switch (elem.$) {
      case "Index": {
        const local = elem._0;
        const entry = this.remap[local];
        if (entry !== undefined) {
          const [ty, variant, idx] = entry;
          // `PlaceElem::Index` only accepts a `Local`, not an arbitrary `Place`.
          // If the local in indexing was saved across a yield point and remapped to a
          // coroutine struct field, we cannot inline the struct field access into
          // the index projection.
          // For example, an local storing the counter to track which element to drop in
          // an array is one such case.
          //
          // Instead, we inject an assignment before this location to restore the
          // saved local from the coroutine struct (`local = copy $projection`),
          // and leave the `PlaceElem::Index(local)` projection unchanged.
          const field = this.make_field(variant, idx, ty);
          unwrap(this.patch).add_assign(location, Place_from_Local(local), { $: "Use", _0: { $: "Copy", _0: field }, _1: "No" });
        }
        return undefined;
      }
      case "Field":
      case "OpaqueCast":
      case "UnwrapUnsafeBinder":
      case "Deref":
      case "ConstantIndex":
      case "Subslice":
      case "Downcast":
      case "PhantomDeref":
        return undefined;
    }
  }

  // #[tracing::instrument(level = "trace", skip(self, stmt), ret)]
  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:458 visit_statement
  override visit_statement(stmt: Statement, location: Location): void {
    // Remove StorageLive and StorageDead statements for remapped locals
    if ((stmt.kind.$ === "StorageLive" || stmt.kind.$ === "StorageDead") && remap_contains(this.remap, stmt.kind._0)) {
      stmt.make_nop(true);
    }
    this.super_statement(stmt, location);
  }

  // #[tracing::instrument(level = "trace", skip(self, term), ret)]
  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:469 visit_terminator
  override visit_terminator(term: Terminator, location: Location): void {
    if (term.kind.$ === "Return") {
      // `visit_basic_block_data` introduces `Return` terminators which read `RETURN_PLACE`.
      // But this `RETURN_PLACE` is already remapped, so we should not touch it again.
      return;
    }
    this.super_terminator(term, location);
  }

  // #[tracing::instrument(level = "trace", skip(self, data), ret)]
  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:479 visit_basic_block_data
  override visit_basic_block_data(block: BasicBlock, data: BasicBlockData): void {
    const kind = data.terminator_().kind;
    switch (kind.$) {
      case "Return": {
        const source_info = clone_SourceInfo(data.terminator_().source_info);
        // We must assign the value first in case it gets declared dead below
        this.make_state({ $: "Move", _0: Place.return_place() }, source_info, true, data.statements);
        // Return state.
        const state = VariantIdx.new(CoroutineArgsExt.RETURNED);
        data.statements.push(this.set_discr(state, source_info));
        data.terminator_mut().kind = TerminatorKind.Return;
        break;
      }
      case "Yield": {
        const value = kind.value;
        const resume = kind.resume;
        const resume_arg = clone_Place(kind.resume_arg);
        const drop = kind.drop;
        const source_info = clone_SourceInfo(data.terminator_().source_info);
        // We must assign the value first in case it gets declared dead below
        this.make_state(clone_Operand(value), source_info, false, data.statements);
        // Yield state.
        const state = CoroutineArgsExt.RESERVED_VARIANTS + this.suspension_points.length;

        // The resume arg target location might itself be remapped if its base local is
        // live across a yield.
        const entry = this.remap[resume_arg.local];
        if (entry !== undefined) {
          const [ty, variant, idx] = entry;
          replace_base(resume_arg, this.make_field(variant, idx, ty), this.tcx_);
        }

        const storage_liveness: DenseBitSet<Local> = unwrap(this.storage_liveness[block]).clone();

        for (let i = 0; i < this.always_live_locals.domain_size(); i++) {
          const l = Local.new(i);
          const needs_storage_dead = storage_liveness.contains(l) && !remap_contains(this.remap, l) && !this.always_live_locals.contains(l);
          if (needs_storage_dead) {
            data.statements.push(Statement.new(clone_SourceInfo(source_info), { $: "StorageDead", _0: l }));
          }
        }

        this.suspension_points.push({
          state,
          resume,
          resume_arg,
          drop,
          storage_liveness,
        });

        const state_ = VariantIdx.new(state);
        data.statements.push(this.set_discr(state_, source_info));
        data.terminator_mut().kind = TerminatorKind.Return;
        break;
      }
      default:
        break;
    }

    this.super_basic_block_data(block, data);
  }
}

/** `IndexSlice<Local, Option<T>>::contains(index)`: `self.get(index).and_then(Option::as_ref).is_some()`. */
function remap_contains(remap: readonly ([Ty, VariantIdx, FieldIdx] | undefined)[], local: Local): boolean {
  return remap[local] !== undefined;
}

// rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:541 make_aggregate_adt
function make_aggregate_adt(def_id: DefId, variant_idx: VariantIdx, args: GenericArgs, operands: Operand[]): Rvalue {
  return { $: "Aggregate", _0: { $: "Adt", _0: def_id, _1: variant_idx, _2: args, _3: undefined, _4: undefined }, _1: operands };
}

// #[tracing::instrument(level = "trace", skip(tcx, body))]
// rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:551 make_coroutine_state_argument_indirect
export function make_coroutine_state_argument_indirect(tcx: TyCtxt, body: Body): void {
  const coroutine_ty = body.local_decls[SELF_ARG]!.ty;

  const ref_coroutine_ty = Ty.new_mut_ref(tcx, tcx.lifetimes.re_erased, coroutine_ty);

  // Replace the by value coroutine argument
  body.local_decls[SELF_ARG]!.ty = ref_coroutine_ty;

  // Add a deref to accesses of the coroutine state
  SelfArgVisitor.new(tcx, tcx.mk_place_deref(Place_from_Local(SELF_ARG))).visit_body(body);
}

// #[tracing::instrument(level = "trace", skip(tcx, body))]
// rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:564 make_coroutine_state_argument_pinned
export function make_coroutine_state_argument_pinned(tcx: TyCtxt, body: Body): void {
  const coroutine_ty = body.local_decls[SELF_ARG]!.ty;

  const ref_coroutine_ty = Ty.new_mut_ref(tcx, tcx.lifetimes.re_erased, coroutine_ty);

  const pin_did = tcx.require_lang_item(LangItem.Pin, body.span);
  const pin_adt_ref = tcx.adt_def(pin_did) as AdtDef;
  const args = tcx.mk_args([GenericArg.from_Ty(ref_coroutine_ty)]);
  const pin_ref_coroutine_ty = Ty.new_adt(tcx, pin_adt_ref, args);

  // Replace the by ref coroutine argument
  body.local_decls[SELF_ARG]!.ty = pin_ref_coroutine_ty;

  const unpinned_local = body.local_decls.length as Local;
  body.local_decls.push(LocalDecl.new(ref_coroutine_ty, body.span));

  // Add the Pin field access to accesses of the coroutine state
  SelfArgVisitor.new(tcx, tcx.mk_place_deref(Place_from_Local(unpinned_local))).visit_body(body);

  const source_info = SourceInfo.outermost(body.span);
  const pin_field = tcx.mk_place_field(Place_from_Local(SELF_ARG), FieldIdx.ZERO, ref_coroutine_ty);

  const statements = body.basic_blocks.as_mut_preserves_cfg()[START_BLOCK]!.statements;
  statements.splice(
    0,
    0,
    Statement.new(source_info, {
      $: "Assign",
      _0: [Place_from_Local(unpinned_local), { $: "Use", _0: { $: "Copy", _0: pin_field }, _1: "Yes" }],
    }),
  );
}

/// Async desugaring uses an unsafe binder type `ResumeTy` to circumvert borrow-checking.
/// The `ResumeTy` hides a `&mut Context<'_>` behind an unsafe raw pointer, and the
/// `get_context` function is being used to convert that back to a `&mut Context<'_>`.
///
/// The actual should be `&mut Context<'_>`. This performs the substitution:
/// - create a new local `_r` of type `ResumeTy`;
/// - assign `ResumeTy(transmute::<&mut Context<'_>, NonNull<Context<'_>>>(_2))` to that local;
/// - let all the code use `_r` instead of `_2`.
///
/// Ideally the async lowering would not use the `ResumeTy`/`get_context` indirection,
/// but rather directly use `&mut Context<'_>`, however that would currently
/// lead to higher-kinded lifetime errors.
/// See <https://github.com/rust-lang/rust/issues/105501>.
///
/// The async lowering step and the type / lifetime inference / checking are
/// still using the `ResumeTy` indirection for the time being, and that indirection
/// is removed here. After this transform, the coroutine body only knows about `&mut Context<'_>`.
// #[tracing::instrument(level = "trace", skip(tcx, body), ret)]
// rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:616 transform_async_context
export function transform_async_context(tcx: TyCtxt, body: Body): void {
  const context_mut_ref = Ty.new_task_context(tcx);
  const resume_ty_def_id = tcx.require_lang_item(LangItem.ResumeTy, body.span);
  const resume_nonnull_ty = tcx.instantiate_and_normalize_erasing_regions(
    RawList.empty<GenericArg>(),
    body.typing_env(tcx),
    tcx.type_of((tcx.adt_def(resume_ty_def_id) as AdtDef).non_enum_variant().fields[FieldIdx.ZERO]!.did) as EarlyBinder<Ty>,
    fold_Ty,
  );

  // Replace all occurrences of `CTX_ARG` with `resume_local: ResumeTy`,
  // and set `CTX_ARG: &mut Context<'_>`.
  const resume_local = body.local_decls.length as Local;
  body.local_decls.push(LocalDecl.new(context_mut_ref, body.span));
  // body.local_decls.swap(CTX_ARG, resume_local);
  const tmp = body.local_decls[CTX_ARG]!;
  body.local_decls[CTX_ARG] = body.local_decls[resume_local]!;
  body.local_decls[resume_local] = tmp;
  new RenameLocalVisitor(CTX_ARG, resume_local, tcx).visit_body(body);

  // Now `CTX_ARG` is `&mut Context` and `resume_local` is a `ResumeTy`.
  // Insert a `resume_local = ResumeTy(CTX_ARG as *mut Context<'static>)`
  // at the function entry to make the bridge.
  const source_info = SourceInfo.outermost(body.span);
  const nonnull_local = body.local_decls.length as Local;
  body.local_decls.push(LocalDecl.new(resume_nonnull_ty, body.span));
  const nonnull_rhs: Rvalue = { $: "Cast", _0: CastKind.Transmute, _1: { $: "Move", _0: Place_from_Local(CTX_ARG) }, _2: resume_nonnull_ty };
  const nonnull_assign = { $: "Assign" as const, _0: [Place_from_Local(nonnull_local), nonnull_rhs] as [Place, Rvalue] };
  const resume_rhs: Rvalue = {
    $: "Aggregate",
    _0: { $: "Adt", _0: resume_ty_def_id, _1: VariantIdx.ZERO, _2: RawList.empty<GenericArg>(), _3: undefined, _4: undefined },
    _1: [{ $: "Move", _0: Place_from_Local(nonnull_local) }],
  };
  const resume_assign = { $: "Assign" as const, _0: [Place_from_Local(resume_local), resume_rhs] as [Place, Rvalue] };
  body.basic_blocks
    .as_mut_preserves_cfg()
    [START_BLOCK]!.statements.splice(0, 0, Statement.new(clone_SourceInfo(source_info), nonnull_assign), Statement.new(source_info, resume_assign));
}

/// HIR uses `get_context` to unwrap a `&mut Context<'_>` from a `ResumeTy`.
/// Both types are just a single pointer, but liveness analysis does not know that and
/// supposes that the operand and the destination are live at the same time.
/// Forcibly inline those calls to avoid this.
// rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:660 eliminate_get_context_calls
function eliminate_get_context_calls(tcx: TyCtxt, body: Body): void {
  const context_mut_ref = Ty.new_task_context(tcx);
  const resume_ty_def_id = tcx.require_lang_item(LangItem.ResumeTy, body.span);
  const resume_nonnull_ty = tcx.instantiate_and_normalize_erasing_regions(
    RawList.empty<GenericArg>(),
    body.typing_env(tcx),
    tcx.type_of((tcx.adt_def(resume_ty_def_id) as AdtDef).non_enum_variant().fields[FieldIdx.ZERO]!.did) as EarlyBinder<Ty>,
    fold_Ty,
  );

  const get_context_def_id = tcx.require_lang_item(LangItem.GetContext, body.span);
  for (const bb_data of body.basic_blocks.as_mut()) {
    if (bb_data.is_cleanup) {
      continue;
    }

    const terminator = bb_data.terminator_mut();
    const kind = terminator.kind;
    if (kind.$ !== "Call") continue;
    const { func, args, destination, target } = kind;
    const func_ty = Operand.ty(func, body.local_decls, tcx);
    const func_ty_kind = func_ty.kind();
    if (!(func_ty_kind.$ === "FnDef")) continue;
    const def_id = func_ty_kind._0;
    if (!DefId_eq(def_id, get_context_def_id)) continue;
    if (args.length !== 1) continue;
    const arg_ = args[0]!;
    const place = Operand.place(arg_.node);
    if (place === undefined) continue;

    const arg: Rvalue = {
      $: "Cast",
      _0: CastKind.Transmute,
      _1: { $: "Copy", _0: place.project_deeper([{ $: "Field", _0: FieldIdx.ZERO, _1: resume_nonnull_ty }], tcx) },
      _2: context_mut_ref,
    };
    const assign = Statement.new(clone_SourceInfo(terminator.source_info), { $: "Assign", _0: [clone_Place(destination), arg] });
    terminator.kind = TerminatorKind.goto(unwrap(target));
    bb_data.statements.push(assign);
  }
}

/// Replaces the entry point of `body` with a block that switches on the coroutine discriminant and
/// dispatches to blocks according to `cases`.
///
/// After this function, the former entry point of the function will be the last block.
// rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:706 insert_switch
export function insert_switch(body: Body, cases: [number, BasicBlock][], transform: TransformVisitor, default_block: BasicBlock): void {
  const [assign, discr] = transform.get_discr(body);

  // MIR validation ensures that no block targets `ENTRY_BLOCK`.
  // #[cfg(debug_assertions)] for bb in body.basic_blocks.iter() { for target in bb.terminator().successors() {
  //     assert_ne!(target, START_BLOCK); } }

  // Add the switch as entry block, and put the former entry block at the end.
  const bbs = body.basic_blocks_mut();
  const former_entry_data = bbs[START_BLOCK]!;
  bbs[START_BLOCK] = BasicBlockData.new_stmts([assign], undefined, false);
  const former_entry = body.basic_blocks_mut().length as BasicBlock;
  body.basic_blocks_mut().push(former_entry_data);

  // We may point to `START_BLOCK` in our `cases`, replace it with `former_entry`.
  const switch_targets = SwitchTargets.new(
    cases.map(([i, bb]): [bigint, BasicBlock] => [BigInt(i), bb]),
    default_block,
  );
  const all_targets = switch_targets.all_targets_mut();
  for (let k = 0; k < all_targets.length; k++) {
    if (all_targets[k] === START_BLOCK) {
      all_targets[k] = former_entry;
    }
  }

  const switch_: TerminatorKind = { $: "SwitchInt", discr: { $: "Move", _0: discr }, targets: switch_targets };
  body.basic_blocks_mut()[START_BLOCK]!.terminator = new Terminator(SourceInfo.outermost(body.span), switch_);
}

// rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:743 insert_term_block
export function insert_term_block(body: Body, kind: TerminatorKind): BasicBlock {
  const source_info = SourceInfo.outermost(body.span);
  const bbs = body.basic_blocks_mut();
  const bb = bbs.length as BasicBlock;
  bbs.push(BasicBlockData.new(new Terminator(source_info, kind), false));
  return bb;
}

// rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:748 return_poll_ready_assign
export function return_poll_ready_assign(tcx: TyCtxt, source_info: SourceInfo): Statement {
  // Poll::Ready(())
  const poll_def_id = tcx.require_lang_item(LangItem.Poll, source_info.span);
  const args = tcx.mk_args([GenericArg.from_Ty(tcx.types.unit)]);
  const val: Operand = {
    $: "Constant",
    _0: new ConstOperand(source_info.span, undefined, Const.zero_sized(tcx.types.unit)),
  };
  const ready_val: Rvalue = {
    $: "Aggregate",
    _0: { $: "Adt", _0: poll_def_id, _1: VariantIdx.from_usize(0), _2: args, _3: undefined, _4: undefined },
    _1: [val],
  };
  return Statement.new(source_info, { $: "Assign", _0: [Place.return_place(), ready_val] });
}

// rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:764 insert_poll_ready_block
export function insert_poll_ready_block(tcx: TyCtxt, body: Body): BasicBlock {
  const source_info = SourceInfo.outermost(body.span);
  const bbs = body.basic_blocks_mut();
  const bb = bbs.length as BasicBlock;
  bbs.push(
    BasicBlockData.new_stmts(
      [return_poll_ready_assign(tcx, clone_SourceInfo(source_info))],
      new Terminator(source_info, TerminatorKind.Return),
      false,
    ),
  );
  return bb;
}

// rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:773 insert_panic_block
export function insert_panic_block(tcx: TyCtxt, body: Body, message: AssertMessage): BasicBlock {
  const assert_block = body.basic_blocks.deref().length as BasicBlock;
  const kind: TerminatorKind = {
    $: "Assert",
    cond: {
      $: "Constant",
      _0: new ConstOperand(body.span, undefined, Const.from_bool(tcx, false)),
    },
    expected: true,
    msg: message,
    target: assert_block,
    unwind: UnwindAction.Continue,
  };

  return insert_term_block(body, kind);
}

// rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:794 can_return
function can_return(tcx: TyCtxt, body: Body, typing_env: TypingEnv): boolean {
  // Returning from a function with an uninhabited return type is undefined behavior.
  if (body.return_ty().is_privately_uninhabited(tcx, typing_env)) {
    return false;
  }

  // If there's a return terminator the function may return.
  return body.basic_blocks.deref().some((block) => block.terminator_().kind.$ === "Return");
  // Otherwise the function can't return.
}

// rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:805 can_unwind
function can_unwind(tcx: TyCtxt, body: Body): boolean {
  // Nothing can unwind when landing pads are off.
  if (!PanicStrategy.unwinds(tcx.sess.panic_strategy())) {
    return false;
  }

  // If we don't find an unwinding terminator, the function cannot unwind.
  return body.basic_blocks.deref().some((block) => block.terminator_().unwind() !== undefined);
}

// Poison the coroutine when it unwinds
// rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:816 generate_poison_block_and_redirect_unwinds_there
export function generate_poison_block_and_redirect_unwinds_there(transform: TransformVisitor, body: Body): void {
  const source_info = SourceInfo.outermost(body.span);
  const poison_block = body.basic_blocks_mut().length as BasicBlock;
  body.basic_blocks_mut().push(
    BasicBlockData.new_stmts(
      [transform.set_discr(VariantIdx.new(CoroutineArgsExt.POISONED), source_info)],
      new Terminator(clone_SourceInfo(source_info), TerminatorKind.UnwindResume),
      true,
    ),
  );

  const blocks = body.basic_blocks_mut();
  for (let i = 0; i < blocks.length; i++) {
    const idx = i as BasicBlock;
    const block = blocks[i]!;
    const source_info = block.terminator_().source_info;

    if (block.terminator_().kind.$ === "UnwindResume") {
      // An existing `Resume` terminator is redirected to jump to our dedicated
      // "poisoning block" above.
      if (idx !== poison_block) {
        block.terminator = new Terminator(source_info, TerminatorKind.goto(poison_block));
      }
    } else if (!block.is_cleanup) {
      // Any terminators that *can* unwind but don't have an unwind target set are also
      // pointed at our poisoning block (unless they're part of the cleanup path).
      const unwind = block.terminator_mut().unwind_mut();
      if (unwind !== undefined && unwind.value.$ === "Continue") {
        unwind.value = { $: "Cleanup", _0: poison_block };
      }
    }
  }
}

// #[tracing::instrument(level = "trace", skip(tcx, transform, body))]
// rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:848 create_coroutine_resume_function
function create_coroutine_resume_function(
  tcx: TyCtxt,
  transform: TransformVisitor,
  body: Body,
  can_return: boolean,
  can_unwind: boolean,
): void {
  // Poison the coroutine when it unwinds
  if (can_unwind) {
    generate_poison_block_and_redirect_unwinds_there(transform, body);
  }

  const cases = create_cases(body, transform, Operation.Resume);

  // use rustc_middle::mir::AssertKind::{ResumedAfterPanic, ResumedAfterReturn};

  // Jump to the entry point on the unresumed
  cases.splice(0, 0, [CoroutineArgsExt.UNRESUMED, START_BLOCK]);

  // Panic when resumed on the returned or poisoned state
  if (can_unwind) {
    cases.splice(1, 0, [
      CoroutineArgsExt.POISONED,
      insert_panic_block(tcx, body, { $: "ResumedAfterPanic", _0: transform.coroutine_kind }),
    ]);
  }

  if (can_return) {
    let block: BasicBlock;
    const ck = transform.coroutine_kind;
    if ((ck.$ === "Desugared" && ck._0 === "Async") || ck.$ === "Coroutine") {
      // For `async_drop_in_place<T>::{closure}` we just keep return Poll::Ready,
      // because async drop of such coroutine keeps polling original coroutine
      if (tcx.is_async_drop_in_place_coroutine(body.source.def_id())) {
        block = insert_poll_ready_block(tcx, body);
      } else {
        block = insert_panic_block(tcx, body, { $: "ResumedAfterReturn", _0: transform.coroutine_kind });
      }
    } else {
      // CoroutineDesugaring::AsyncGen | CoroutineDesugaring::Gen
      block = transform.insert_none_ret_block(body);
    }
    cases.splice(1, 0, [CoroutineArgsExt.RETURNED, block]);
  }

  const default_block = insert_term_block(body, TerminatorKind.Unreachable);
  insert_switch(body, cases, transform, default_block);

  {
    const ck = transform.coroutine_kind;
    if (ck.$ === "Coroutine" || (ck.$ === "Desugared" && (ck._0 === "Async" || ck._0 === "AsyncGen"))) {
      make_coroutine_state_argument_pinned(tcx, body);
    } else {
      // Iterator::next doesn't accept a pinned argument,
      // unlike for all other coroutine kinds.
      // CoroutineKind::Desugared(CoroutineDesugaring::Gen, _)
      make_coroutine_state_argument_indirect(tcx, body);
    }
  }

  // Make sure we remove dead blocks to remove
  // unrelated code from the drop part of the function
  simplify.remove_dead_blocks(body);

  pm.run_passes_no_validate(tcx, body, [new abort_unwinding_calls.AbortUnwindingCalls()], undefined);

  // Run derefer to fix Derefs that are not in the first place
  deref_finder(tcx, body, false);

  if (CoroutineKindC.is_async_desugaring(transform.coroutine_kind)) {
    transform_async_context(tcx, body);
  }

  const dumper = MirDumper.new(tcx, "coroutine_resume", body);
  if (dumper !== undefined) {
    dumper.dump_mir(body);
  }
}

/// An operation that can be performed on a coroutine.
// #[derive(PartialEq, Copy, Clone, Debug)]
// rustc-type: compiler/rustc_mir_transform/src/coroutine/mod.rs:934 Operation
export type Operation = "Resume" | "Drop" | "AsyncDrop";
export const Operation = {
  Resume: "Resume",
  Drop: "Drop",
  AsyncDrop: "AsyncDrop",

  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:941 target_block
  target_block(self: Operation, point: SuspensionPoint): BasicBlock | undefined {
    switch (self) {
      case "Resume":
        return point.resume;
      case "Drop":
      case "AsyncDrop":
        return point.drop;
    }
  },

  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:948 resume_place
  resume_place(self: Operation, point: SuspensionPoint): Place | undefined {
    switch (self) {
      case "Resume":
      case "AsyncDrop":
        return point.resume_arg;
      case "Drop":
        return undefined;
    }
  },
} as const;

// #[tracing::instrument(level = "trace", skip(transform, body))]
// rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:957 create_cases
export function create_cases(body: Body, transform: TransformVisitor, operation: Operation): [number, BasicBlock][] {
  const source_info = SourceInfo.outermost(body.span);

  const out: [number, BasicBlock][] = [];
  for (const point of transform.suspension_points) {
    // Find the target for this suspension point, if applicable
    const target = Operation.target_block(operation, point);
    if (target === undefined) continue;
    const statements: Statement[] = [];

    // Create StorageLive instructions for locals with live storage
    for (let i = 0; i < body.local_decls.length; i++) {
      const l = i as Local;
      const needs_storage_live =
        point.storage_liveness.contains_loose(l) && !remap_contains(transform.remap, l) && !transform.always_live_locals.contains(l);
      if (needs_storage_live) {
        statements.push(Statement.new(clone_SourceInfo(source_info), { $: "StorageLive", _0: l }));
      }
    }

    // Move the resume argument to the destination place of the `Yield` terminator
    const resume_arg = Operation.resume_place(operation, point);
    if (resume_arg !== undefined && !(resume_arg.local === CTX_ARG && resume_arg.projection.length === 0)) {
      statements.push(
        Statement.new(clone_SourceInfo(source_info), {
          $: "Assign",
          _0: [clone_Place(resume_arg), { $: "Use", _0: { $: "Move", _0: Place_from_Local(CTX_ARG) }, _1: "Yes" }],
        }),
      );
    }

    // Then jump to the real target
    const bbs = body.basic_blocks_mut();
    const block = bbs.length as BasicBlock;
    bbs.push(BasicBlockData.new_stmts(statements, new Terminator(clone_SourceInfo(source_info), TerminatorKind.goto(target)), false));

    out.push([point.state, block]);
  }
  return out;
}

/// Looks for any assignments between locals (e.g., `_4 = _5`) that will both be converted to fields
/// in the coroutine state machine but whose storage is not marked as conflicting
///
/// Validation needs to happen immediately *before* `TransformVisitor` is invoked, not after.
///
/// This condition would arise when the assignment is the last use of `_5` but the initial
/// definition of `_4` if we weren't extra careful to mark all locals used inside a statement as
/// conflicting. Non-conflicting coroutine saved locals may be stored at the same location within
/// the coroutine state machine, which would result in ill-formed MIR: the left-hand and right-hand
/// sides of an assignment may not alias. This caused a miscompilation in [#73137].
///
/// [#73137]: https://github.com/rust-lang/rust/issues/73137
// rustc-type: compiler/rustc_mir_transform/src/coroutine/mod.rs:1216 EnsureCoroutineFieldAssignmentsNeverAlias
class EnsureCoroutineFieldAssignmentsNeverAlias extends Visitor {
  constructor(
    public saved_locals: CoroutineSavedLocals,
    public storage_conflicts: BitMatrix<CoroutineSavedLocal, CoroutineSavedLocal>,
    public assigned_local: CoroutineSavedLocal | undefined,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:1223 saved_local_for_direct_place
  saved_local_for_direct_place(place: Place): CoroutineSavedLocal | undefined {
    if (place.is_indirect()) {
      return undefined;
    }

    return this.saved_locals.get(place.local);
  }

  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:1231 check_assigned_place
  check_assigned_place(place: Place, f: (this_: EnsureCoroutineFieldAssignmentsNeverAlias) => void): void {
    const assigned_local = this.saved_local_for_direct_place(place);
    if (assigned_local !== undefined) {
      assert(this.assigned_local === undefined, "`check_assigned_place` must not recurse");

      this.assigned_local = assigned_local;
      f(this);
      this.assigned_local = undefined;
    }
  }

  // ---- impl Visitor for EnsureCoroutineFieldAssignmentsNeverAlias ----

  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:1243 visit_place
  override visit_place(place: Place, context: PlaceContext, location: Location): void {
    const lhs = this.assigned_local;
    if (lhs === undefined) {
      // This visitor only invokes `visit_place` for the right-hand side of an assignment
      // and only after setting `self.assigned_local`. However, the default impl of
      // `Visitor::super_body` may call `visit_place` with a `NonUseContext` for places
      // with debuginfo. Ignore them here.
      assert(!PlaceContextC.is_use(context), "assertion failed: !context.is_use()");
      return;
    }

    const rhs = this.saved_local_for_direct_place(place);
    if (rhs === undefined) return;

    if (!this.storage_conflicts.contains(lhs, rhs)) {
      bug(
        `Assignment between coroutine saved locals whose storage is not marked as conflicting: ${debug_Location(location, PLAIN)}: ${debug_CoroutineSavedLocal(lhs, PLAIN)} = ${debug_CoroutineSavedLocal(rhs, PLAIN)}`,
      );
    }
  }

  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:1266 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    const kind = statement.kind;
    switch (kind.$) {
      case "Assign": {
        const [lhs, rhs] = kind._0;
        this.check_assigned_place(lhs, (this_) => this_.visit_rvalue(rhs, location));
        break;
      }

      case "FakeRead":
      case "SetDiscriminant":
      case "StorageLive":
      case "StorageDead":
      case "AscribeUserType":
      case "PlaceMention":
      case "Coverage":
      case "Intrinsic":
      case "ConstEvalCounter":
      case "BackwardIncompatibleDropHint":
      case "Nop":
        break;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/coroutine/mod.rs:1286 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    // Checking for aliasing in terminators is probably overkill, but until we have actual
    // semantics, we should be conservative here.
    const kind = terminator.kind;
    if (kind.$ === "Call" && kind.target !== undefined) {
      const { func, args, destination } = kind;
      this.check_assigned_place(destination, (this_) => {
        this_.visit_operand(func, location);
        for (const arg of args) {
          this_.visit_operand(arg.node, location);
        }
      });
    } else if (kind.$ === "Yield") {
      const { value, resume_arg } = kind;
      this.check_assigned_place(resume_arg, (this_) => this_.visit_operand(value, location));
    } else if (kind.$ === "InlineAsm") {
      // FIXME: Does `asm!` have any aliasing requirements?
    } else {
      // TerminatorKind::Call { .. } | Goto | SwitchInt | UnwindResume | UnwindTerminate | Return | TailCall
      // | Unreachable | Drop | Assert | CoroutineDrop | FalseEdge | FalseUnwind => {}
    }
  }
}

// ---- PORT stand-ins for items of other files that are not ported yet ----------------------------------------------
// Not markers. Each calls `unported`; the owning lanes repoint them at the real ports (see the header).

/** PORT: stand-in for `deref_separator::deref_finder` (deref_separator.rs, lane mt-cleanup). */
function deref_finder(_tcx: TyCtxt, _body: Body, _storage_to_remove: boolean): void {
  return unported("rustc_mir_transform::deref_separator::deref_finder (lane mt-cleanup)");
}
