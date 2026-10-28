// Port of compiler/rustc_mir_transform/src/elaborate_drop.rs (lane mt-drops, wave 24).
//
// PORT: `trait DropElaborator<'a, 'tcx>` is the interface `DropElaborator<Path>`; its associated type `Path` is the type
// parameter. `Path` values must not be `undefined` (`Option<Path>` is `Path | undefined`): `ElaborateDropsCtxt` uses
// `MovePathIndex`, the shim elaborators use `()` = `null`. The `fmt::Debug` supertrait is not required (only
// `#[instrument]` / `debug!` print elaborators and `DropCtxt`, all compiled out of release rustc); for the same reason
// `DropCtxt`'s `#[derive(Debug)]` is not ported.
// PORT: `DropCtxt<'a, 'b, 'tcx, D>` is a class generic over `Path`; `DropCtxt { elaborator: self.elaborator, .. }` is a
// new `DropCtxt` sharing the elaborator object.
// PORT: `Place`, `SourceInfo` and `Operand` are `Copy`/`Clone` but edited in place by MIR `MutVisitor`s, so every copy
// stored into a new statement / terminator is `clone_Place` / `clone_SourceInfo` / `clone_Operand` (PORTING §8).
// Init order: `crate::coroutine::CTX_ARG` is imported from coroutine/mod.ts, which reaches this module back through
// coroutine/drop.ts; `CTX_ARG` is only read inside fns, never at load.
// PORT: `#[instrument]` / `debug!` are comments (compiled out of release rustc).
import { FIRST_VARIANT, FieldIdx, type VariantIdx } from "../rustc_abi/layout.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { type CoroutineKind, CoroutineKind as CoroutineKindC, debug_CoroutineKind } from "../rustc_hir/hir.ts";
import {
  BasicBlock,
  BasicBlockData,
  type Body,
  clone_Operand,
  clone_Place,
  clone_SourceInfo,
  Const,
  ConstOperand,
  Local,
  type Operand,
  Operand as OperandC,
  type Place,
  type PlaceElem,
  type Rvalue,
  SourceInfo,
  type Statement as StatementT,
  SwitchTargets,
  TerminatorKind,
  type UnwindAction,
  UnwindTerminateReason,
  debug_Place,
} from "../rustc_middle/mir/mod.ts";
import { Statement } from "../rustc_middle/mir/statement.ts";
import { Place_from_Local, PlaceTy } from "../rustc_middle/mir/statement.ts";
import { Terminator } from "../rustc_middle/mir/terminator.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg, type GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { Ty, type TypingEnv, type VariantDef } from "../rustc_middle/ty/mod.ts";
import { debug_Ty, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { IntTypeExt } from "../rustc_middle/ty/util.ts";
import { DropFlagState } from "../rustc_mir_dataflow/drop_flag_effects.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP, dummy_spanned } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { Binder, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import { TypingMode } from "../rustc_type_ir/infer_ctxt.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs } from "../rustc_type_ir/ty_kind/closure.ts";
import { type FnSig, FnSig as FnSigC, fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { type Debug, PLAIN } from "../std/fmt.ts";
import { assert, panic, unwrap } from "../std/panic.ts";
import type { MirPatch } from "./patch.ts";
import { CTX_ARG } from "./coroutine/mod.ts";
import { u64_to_number } from "../rust_ts/u64.ts";

/// Describes how/if a value should be dropped.
// #[derive(Debug)]
// rustc-type: compiler/rustc_mir_transform/src/elaborate_drop.rs:22 DropStyle
export type DropStyle =
  /// The value is already dead at the drop location, no drop will be executed.
  | "Dead"

  /// The value is known to always be initialized at the drop location, drop will always be
  /// executed.
  | "Static"

  /// Whether the value needs to be dropped depends on its drop flag.
  | "Conditional"

  /// An "open" drop is one where only the fields of a value are dropped.
  ///
  /// For example, this happens when moving out of a struct field: The rest of the struct will be
  /// dropped in such an "open" drop. It is also used to generate drop glue for the individual
  /// components of a value, for example for dropping array elements.
  | "Open";
export const DropStyle = { Dead: "Dead", Static: "Static", Conditional: "Conditional", Open: "Open" } as const;
export const debug_DropStyle: Debug<DropStyle> = (v) => v;

/// Which drop flags to affect/check with an operation.
// #[derive(Debug)]
// rustc-type: compiler/rustc_mir_transform/src/elaborate_drop.rs:43 DropFlagMode
export type DropFlagMode =
  /// Only affect the top-level drop flag, not that of any contained fields.
  | "Shallow"
  /// Affect all nested drop flags in addition to the top-level one.
  | "Deep";
export const DropFlagMode = { Shallow: "Shallow", Deep: "Deep" } as const;
export const debug_DropFlagMode: Debug<DropFlagMode> = (v) => v;

/// Describes if unwinding is necessary and where to unwind to if a panic occurs.
// #[derive(Copy, Clone, Debug)]
// rustc-type: compiler/rustc_mir_transform/src/elaborate_drop.rs:52 Unwind
export type Unwind =
  /// Unwind to this block.
  | { readonly $: "To"; readonly _0: BasicBlock }
  /// Already in an unwind path, any panic will cause an abort.
  | { readonly $: "InCleanup" };
export const Unwind = {
  InCleanup: Object.freeze({ $: "InCleanup" as const }) as Unwind,
  To(bb: BasicBlock): Unwind {
    return { $: "To", _0: bb };
  },

  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:60 is_cleanup
  is_cleanup(self: Unwind): boolean {
    switch (self.$) {
      case "To":
        return false;
      case "InCleanup":
        return true;
    }
  },

  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:67 into_action
  into_action(self: Unwind): UnwindAction {
    switch (self.$) {
      case "To":
        return { $: "Cleanup", _0: self._0 };
      case "InCleanup":
        return { $: "Terminate", _0: UnwindTerminateReason.InCleanup };
    }
  },

  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:74 map
  map(self: Unwind, f: (bb: BasicBlock) => BasicBlock): Unwind {
    switch (self.$) {
      case "To":
        return { $: "To", _0: f(self._0) };
      case "InCleanup":
        return Unwind.InCleanup;
    }
  },
};
export const debug_Unwind: Debug<Unwind> = (v, f) => (v.$ === "To" ? `To(${BasicBlock.debug(v._0, f)})` : "InCleanup");

// rustc-trait: compiler/rustc_mir_transform/src/elaborate_drop.rs:85 DropElaborator
export interface DropElaborator<Path> {
  /// The type representing paths that can be moved out of.
  ///
  /// Users can move out of individual fields of a struct, such as `a.b.c`. This type is used to
  /// represent such move paths. Sometimes tracking individual move paths is not necessary, in
  /// which case this may be set to (for example) `()`.
  // type Path: Copy + fmt::Debug;

  // Accessors

  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:95 patch_ref
  patch_ref(): MirPatch;
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:96 patch
  patch(): MirPatch;
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:97 body
  body(): Body;
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:98 tcx
  tcx(): TyCtxt;
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:99 typing_env
  typing_env(): TypingEnv;
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:100 allow_async_drops
  allow_async_drops(): boolean;

  // Drop logic

  /// Returns how `path` should be dropped, given `mode`.
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:105 drop_style
  drop_style(path: Path, mode: DropFlagMode): DropStyle;

  /// Returns the drop flag of `path` as a MIR `Operand` (or `None` if `path` has no drop flag).
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:108 get_drop_flag
  get_drop_flag(path: Path): Operand | undefined;

  /// Return the drop flag of `path`, if any.
  ///
  /// If `mode` is deep, drop flags of all child paths should be returned.
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:113 drop_flags_for
  drop_flags_for(path: Path, mode: DropFlagMode): Place[];

  // Subpaths

  /// Returns the subpath of a field of `path` (or `None` if there is no dedicated subpath).
  ///
  /// If this returns `None`, `field` will not get a dedicated drop flag.
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:120 field_subpath
  field_subpath(path: Path, field: FieldIdx): Path | undefined;

  /// Returns the subpath of a dereference of `path` (or `None` if there is no dedicated subpath).
  ///
  /// If this returns `None`, `*path` will not get a dedicated drop flag.
  ///
  /// This is only relevant for `Box<T>`, where the contained `T` can be moved out of the box.
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:127 deref_subpath
  deref_subpath(path: Path): Path | undefined;

  /// Returns the subpath of downcasting `path` to one of its variants.
  ///
  /// If this returns `None`, the downcast of `path` will not get a dedicated drop flag.
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:132 downcast_subpath
  downcast_subpath(path: Path, variant: VariantIdx): Path | undefined;

  /// Returns the subpath of indexing a fixed-size array `path`.
  ///
  /// If this returns `None`, elements of `path` will not get a dedicated drop flag.
  ///
  /// This is only relevant for array patterns, which can move out of individual array elements.
  // PORT: `index` / `size` are `u64` array lengths, `number` as in `ProjectionElem::ConstantIndex`.
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:139 array_subpath
  array_subpath(path: Path, index: number, size: number): Path | undefined;
}

/// "Elaborates" a drop of `place`/`path` and patches `bb`'s terminator to execute it.
///
/// The passed `elaborator` is used to determine what should happen at the drop terminator. It
/// decides whether the drop can be statically determined or whether it needs a dynamic drop flag,
/// and whether the drop is "open", i.e. should be expanded to drop all subfields of the dropped
/// value.
///
/// When this returns, the MIR patch in the `elaborator` contains the necessary changes.
// rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:166 elaborate_drop
export function elaborate_drop<Path>(
  elaborator: DropElaborator<Path>,
  source_info: SourceInfo,
  place: Place,
  path: Path,
  succ: BasicBlock,
  unwind: Unwind,
  bb: BasicBlock,
  dropline: BasicBlock | undefined,
): void {
  new DropCtxt<Path>(elaborator, source_info, place, path, succ, unwind, dropline).elaborate_drop(bb);
}

// #[derive(Debug)]
// rustc-type: compiler/rustc_mir_transform/src/elaborate_drop.rs:143 DropCtxt
class DropCtxt<Path> {
  constructor(
    public elaborator: DropElaborator<Path>,

    public source_info: SourceInfo,

    public place: Place,
    public path: Path,
    public succ: BasicBlock,
    public unwind: Unwind,
    public dropline: BasicBlock | undefined,
  ) {}

  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:188 place_ty
  place_ty(place: Place): Ty {
    if (place.local < this.elaborator.body().local_decls.length) {
      return place.ty(this.elaborator.body(), this.tcx()).ty;
    } else {
      // We don't have a slice with all the locals, since some are in the patch.
      return PlaceTy.from_ty(this.elaborator.patch_ref().local_ty(place.local)).multi_projection_ty(this.elaborator.tcx(), place.projection)
        .ty;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:199 tcx
  tcx(): TyCtxt {
    return this.elaborator.tcx();
  }

  /// Async-drop `place: drop_ty`.
  ///
  /// Conceptually, we want to run `async_drop_in_place(&mut obj).await`.
  ///
  /// Await syntax does not exist in MIR, so we need to manually expand it into a poll-yield
  /// loop, essentially:
  /// ```mir
  ///   let fut = async_drop_in_place(&mut obj);
  ///   loop {
  ///     let pin_fut = Pin::new_unchecked(&mut fut);
  ///     match Future::poll(pin_fut, CTX_ARG) {
  ///       Poll::Ready => break,
  ///       Poll::Pending(..) => CTX_ARG = yield (),
  ///     }
  ///   }
  ///   // continue to `succ`
  /// ```
  ///
  /// We also need to ensure that async drop also happens on the coroutine drop path, ie. when
  /// `yield` branches along its `drop` target. This requires a second loop, this time jumping to
  /// `dropline`.
  ///
  /// Arguments:
  ///   `call_destructor_only`: call only `AsyncDrop::drop`, not full `async_drop_in_place` glue
  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:228 build_async_drop
  build_async_drop(
    place: Place,
    drop_ty: Ty,
    succ: BasicBlock,
    unwind: Unwind,
    dropline: BasicBlock | undefined,
    call_destructor_only: boolean,
  ): BasicBlock {
    const tcx = this.tcx();
    const span = this.source_info.span;
    const obj_ref_ty = Ty.new_mut_ref(tcx, tcx.lifetimes.re_erased, drop_ty);

    let async_drop_fn_def_id: DefId;
    if (call_destructor_only) {
      // Resolving obj.<AsyncDrop::drop>()
      const async_drop_trait = tcx.require_lang_item(LangItem.AsyncDrop, span);
      async_drop_fn_def_id = (tcx.associated_item_def_ids(async_drop_trait) as readonly DefId[])[0]!;
    } else {
      // Resolving async_drop_in_place<T> function for drop_ty
      async_drop_fn_def_id = tcx.require_lang_item(LangItem.AsyncDropInPlace, span);
    }

    const fut_ty = FnSigC.output(
      tcx.instantiate_bound_regions_with_erased(
        Unnormalized.skip_norm_wip(
          EarlyBinder.instantiate(tcx.fn_sig(async_drop_fn_def_id) as EarlyBinder<Binder<FnSig>>, tcx, [GenericArg.from_Ty(drop_ty)], fold_Binder(fold_FnSig)),
        ),
        fold_FnSig,
      ),
    );
    const fut = this.new_temp(fut_ty);

    // Create an intermediate block that does StorageDead(fut) then jumps to succ.
    // This is necessary because we do not want to modify statements
    // in existing blocks, in case those are used somewhere else in MIR.
    const succ_with_dead = this.new_block_with_statements(unwind, [this.storage_dead(fut)], TerminatorKind.goto(succ));
    const dropline_with_dead =
      dropline === undefined ? undefined : this.new_block_with_statements(unwind, [this.storage_dead(fut)], TerminatorKind.goto(dropline));
    const unwind_with_dead = Unwind.map(unwind, (target) =>
      this.new_block_with_statements(Unwind.InCleanup, [this.storage_dead(fut)], TerminatorKind.goto(target)),
    );

    // The yielded value depends on the kind of coroutine, to match what AST lowering does.
    const coroutine_kind = unwrap(this.elaborator.body().coroutine_kind());
    let yield_value: Operand;
    if (coroutine_kind.$ === "Desugared" && coroutine_kind._0 === "AsyncGen") {
      // For async gen, we need `yield Poll<OptRet>::Pending`.
      const full_yield_ty = unwrap(this.elaborator.body().yield_ty());
      const k0 = full_yield_ty.kind();
      if (k0.$ !== "Adt") {
        return bug();
      }
      const k1 = k0._1.type_at(0).kind();
      if (k1.$ !== "Adt") {
        return bug();
      }
      const yield_ty = k1._1.type_at(0);
      yield_value = OperandC.unevaluated_constant(
        tcx,
        tcx.require_lang_item(LangItem.AsyncGenPending, span),
        tcx.mk_args([GenericArg.from_Ty(yield_ty)]),
        span,
      );
    } else if (coroutine_kind.$ === "Desugared" && coroutine_kind._0 === "Async") {
      // For regular async fn, we need `yield ()`.
      yield_value = OperandC.zero_sized_constant(tcx.types.unit, span);
    } else {
      // `is_async_drop` should have checked that.
      return panic(`unexpected coroutine for async drop ${debug_CoroutineKind(coroutine_kind, PLAIN)}`);
    }

    // The branching here is tricky and deserves some explanation.
    //
    // If we are in the drop code path, ie. we are currently dropping the coroutine.
    // The state machine follows the `drop` branch in the `yield` terminator.
    // To repeatedly poll the future, the `drop` branch must loop.
    // Meanwhile, the `resume` branch corresponds to anomalous execution,
    // trying to resume the coroutine while it is being dropped. So that branch panics
    // (`panic_bb`).
    const panic_bb = this.build_resumed_after_drop_abort_block(unwind_with_dead, coroutine_kind);
    const [drop_pin_bb, drop_resume_bb, drop_drop_bb] = this.build_pin_poll_yield_loop(
      Place_from_Local(CTX_ARG),
      Place_from_Local(fut),
      clone_Operand(yield_value),
      // If `dropline_with_dead` is set, it points to the continuation of the drop execution.
      // Otherwise, we are already dropping the coroutine, and `succ_with_dead` does.
      dropline_with_dead ?? succ_with_dead,
      unwind_with_dead,
    );
    this.elaborator.patch().patch_terminator(drop_resume_bb, TerminatorKind.goto(panic_bb));
    this.elaborator.patch().patch_terminator(drop_drop_bb, TerminatorKind.goto(drop_pin_bb));

    // If we are in the regular code path, `dropline_with_dead` is `Some`.
    //
    // In that case, the logic is reversed. Normal execution branches on `resume` from the
    // `yield` terminator. To repeatedly poll the future, that `resume` branch must loop.
    // When the future is dropped, the `yield` terminator branches to `drop`, which follows to
    // the previous loop `drop_pin_bb`.
    let succ_yield_loop: BasicBlock;
    if (dropline_with_dead !== undefined) {
      const [pin_bb, resume_bb, drop_bb] = this.build_pin_poll_yield_loop(
        Place_from_Local(CTX_ARG),
        Place_from_Local(fut),
        yield_value,
        // `dropline_with_dead` is `Some`, so the previous loop point to it.
        succ_with_dead,
        unwind_with_dead,
      );
      this.elaborator.patch().patch_terminator(resume_bb, TerminatorKind.goto(pin_bb));
      this.elaborator.patch().patch_terminator(drop_bb, TerminatorKind.goto(drop_pin_bb));
      succ_yield_loop = pin_bb;
    } else {
      // We were already in the drop line, so return the loop we created for it.
      succ_yield_loop = drop_pin_bb;
    }

    // #2:call_drop_bb >>>
    //    call AsyncDrop::drop(pin_obj)
    // OR call async_drop_in_place(pin_obj.pointer)
    const pin_adt_def = tcx.adt_def(tcx.require_lang_item(LangItem.Pin, span)) as AdtDef;
    const pin_obj_ty = Ty.new_adt(tcx, pin_adt_def, tcx.mk_args([GenericArg.from_Ty(obj_ref_ty)]));
    // Where we store the result of Pin<&drop_ty>::new_unchecked(&mut place).
    const pin_obj_local = this.new_temp(pin_obj_ty);
    let drop_arg: Operand;
    if (call_destructor_only) {
      // `AsyncDrop::drop` takes `self: Pin<&mut Self>`.
      drop_arg = { $: "Move", _0: Place_from_Local(pin_obj_local) };
    } else {
      // `async_drop_in_place` takes `obj: &mut T`.
      drop_arg = { $: "Copy", _0: tcx.mk_place_field(Place_from_Local(pin_obj_local), FieldIdx.ZERO, obj_ref_ty) };
    }
    const call_drop_bb = this.new_block_with_statements(unwind_with_dead, [this.storage_live(fut)], {
      $: "Call",
      func: OperandC.function_handle(tcx, async_drop_fn_def_id, [GenericArg.from_Ty(drop_ty)], span),
      args: [dummy_spanned(drop_arg)],
      destination: Place_from_Local(fut),
      target: succ_yield_loop,
      unwind: Unwind.into_action(unwind_with_dead),
      call_source: "Misc",
      fn_span: this.source_info.span,
    });

    // #1:pin_obj_bb >>> call Pin<ObjTy>::new_unchecked(&mut obj)
    const obj_ref_place = Place_from_Local(this.new_temp(obj_ref_ty));
    const pin_obj_new_unchecked_fn = tcx.require_lang_item(LangItem.PinNewUnchecked, span);
    const assign_obj_ref_place = this.assign(clone_Place(obj_ref_place), {
      $: "Ref",
      _0: tcx.lifetimes.re_erased,
      _1: { $: "Mut", kind: "Default" },
      _2: clone_Place(place),
    });
    return this.new_block_with_statements(unwind, [assign_obj_ref_place], {
      $: "Call",
      func: OperandC.function_handle(tcx, pin_obj_new_unchecked_fn, [GenericArg.from_Ty(obj_ref_ty)], span),
      args: [dummy_spanned<Operand>({ $: "Move", _0: clone_Place(obj_ref_place) })],
      destination: Place_from_Local(pin_obj_local),
      target: call_drop_bb,
      unwind: Unwind.into_action(unwind),
      call_source: "Misc",
      fn_span: span,
    });
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:409 build_resumed_after_drop_abort_block
  build_resumed_after_drop_abort_block(unwind: Unwind, coroutine_kind: CoroutineKind): BasicBlock {
    const tcx = this.tcx();
    const panic_bb = this.new_block(unwind, { $: "Unreachable" });
    const msg = { $: "ResumedAfterDrop" as const, _0: coroutine_kind };
    const false_op: Operand = {
      $: "Constant",
      _0: new ConstOperand(this.source_info.span, undefined, Const.from_bool(tcx, false)),
    };
    this.elaborator.patch().patch_terminator(panic_bb, {
      $: "Assert",
      cond: false_op,
      expected: true,
      msg: msg,
      target: panic_bb,
      unwind: Unwind.into_action(unwind),
    });
    return panic_bb;
  }

  /// Build a small MIR loop that pins and polls a future, yielding when
  /// the future returns `Poll::Pending` and continuing to `ready_target`
  /// when it returns `Poll::Ready`.
  ///
  /// Pseudo-code:
  /// ```mir
  /// pin_bb:
  ///   let pin_fut = Pin::new_unchecked(&mut fut_place);
  ///   match Future::poll(pin_fut, CTX_ARG) {
  ///     Poll::Ready => goto succ,
  ///     Poll::Pending(..) => CTX_ARG = yield () [resume: resume_bb, drop: drop_bb],
  ///   }
  /// ```
  ///
  ///  Returns: the tuple `(pin_bb, resume_bb, drop_bb)`.
  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:451 build_pin_poll_yield_loop
  build_pin_poll_yield_loop(
    resume_place: Place,
    fut_place: Place,
    yield_value: Operand,
    succ: BasicBlock,
    unwind: Unwind,
  ): [BasicBlock, BasicBlock, BasicBlock] {
    const tcx = this.tcx();
    const source_info = this.source_info;

    const resume_arg_ty = resume_place.ty(this.elaborator.body(), tcx).ty;
    const context_ref_ty = Ty.new_task_context(tcx);

    const poll_adt_def = tcx.adt_def(tcx.require_lang_item(LangItem.Poll, source_info.span)) as AdtDef;
    const poll_enum = Ty.new_adt(tcx, poll_adt_def, tcx.mk_args([GenericArg.from_Ty(tcx.types.unit)]));

    const fut_ty = this.elaborator.patch_ref().local_ty(fut_place.local);
    const fut_ref_ty = Ty.new_mut_ref(tcx, tcx.lifetimes.re_erased, fut_ty);

    const pin_adt_def = tcx.adt_def(tcx.require_lang_item(LangItem.Pin, source_info.span)) as AdtDef;
    const fut_pin_ty = Ty.new_adt(tcx, pin_adt_def, tcx.mk_args([GenericArg.from_Ty(fut_ref_ty)]));

    // Coroutine `transform_async_context` assumes that the local `resume_arg` to a yield
    // is not used once, so create a special temp for it.
    const yield_resume_local = this.new_temp(resume_arg_ty);
    const resume_bb = this.new_block_with_statements(
      unwind,
      [
        this.assign(clone_Place(resume_place), { $: "Use", _0: { $: "Move", _0: Place_from_Local(yield_resume_local) }, _1: "Yes" }),
        this.storage_dead(yield_resume_local),
      ],
      // This will be transformed by the caller.
      { $: "Unreachable" },
    );
    const dropline_bb = this.new_block_with_statements(
      unwind,
      [
        this.assign(clone_Place(resume_place), { $: "Use", _0: { $: "Move", _0: Place_from_Local(yield_resume_local) }, _1: "Yes" }),
        this.storage_dead(yield_resume_local),
      ],
      // This will be transformed by the caller.
      { $: "Unreachable" },
    );
    const yield_bb = this.new_block_with_statements(unwind, [this.storage_live(yield_resume_local)], {
      $: "Yield",
      value: yield_value,
      resume: resume_bb,
      resume_arg: Place_from_Local(yield_resume_local),
      drop: dropline_bb,
    });

    const poll_unit_local = this.new_temp(poll_enum);
    let switch_bb: BasicBlock;
    {
      const poll_ready_variant = tcx.require_lang_item(LangItem.PollReady, this.source_info.span);
      const poll_ready_variant_idx = poll_adt_def.variant_index_with_id(poll_ready_variant);
      const poll_pending_variant = tcx.require_lang_item(LangItem.PollPending, this.source_info.span);
      const poll_pending_variant_idx = poll_adt_def.variant_index_with_id(poll_pending_variant);

      const { val: poll_ready_discr, ty: poll_discr_ty } = unwrap(poll_enum.discriminant_for_variant(tcx, poll_ready_variant_idx));
      const { val: poll_pending_discr } = unwrap(poll_enum.discriminant_for_variant(tcx, poll_pending_variant_idx));

      const poll_discr_local = this.new_temp(poll_discr_ty);
      const otherwise_bb = this.elaborator.patch().unreachable_no_cleanup_block_();
      switch_bb = this.new_block_with_statements(
        unwind,
        [this.assign(Place_from_Local(poll_discr_local), { $: "Discriminant", _0: Place_from_Local(poll_unit_local) })],
        {
          $: "SwitchInt",
          discr: { $: "Move", _0: Place_from_Local(poll_discr_local) },
          targets: SwitchTargets.new(
            [
              // on `Ready`, exit the loop, jump to `succ`
              [poll_ready_discr, succ],
              // on `Pending`, yield and resume back into the loop
              [poll_pending_discr, yield_bb],
            ],
            // otherwise: unreachable
            otherwise_bb,
          ),
        },
      );
    }

    const fut_pin_local = this.new_temp(fut_pin_ty);
    const context_ref_local = this.new_temp(context_ref_ty);

    const poll_fn = tcx.require_lang_item(LangItem.FuturePoll, source_info.span);
    const poll_bb = this.new_block_with_statements(unwind, [], {
      $: "Call",
      func: OperandC.function_handle(tcx, poll_fn, [GenericArg.from_Ty(fut_ty)], source_info.span),
      args: [
        dummy_spanned<Operand>({ $: "Move", _0: Place_from_Local(fut_pin_local) }),
        dummy_spanned<Operand>({ $: "Move", _0: Place_from_Local(context_ref_local) }),
      ],
      destination: Place_from_Local(poll_unit_local),
      target: switch_bb,
      unwind: Unwind.into_action(unwind),
      call_source: "Misc",
      fn_span: source_info.span,
    });

    const get_context_fn = tcx.require_lang_item(LangItem.GetContext, source_info.span);
    let get_context_bb: BasicBlock;
    {
      // Coroutine `transform_async_context` assumes that the local argument to `GetContext`
      // is not used once, so create a special temp for it.
      const entry_resume_local = this.new_temp(resume_arg_ty);
      get_context_bb = this.new_block_with_statements(
        unwind,
        [this.assign(Place_from_Local(entry_resume_local), { $: "Use", _0: { $: "Move", _0: clone_Place(resume_place) }, _1: "Yes" })],
        {
          $: "Call",
          func: OperandC.function_handle(
            tcx,
            get_context_fn,
            [GenericArg.from_Region(tcx.lifetimes.re_erased), GenericArg.from_Region(tcx.lifetimes.re_erased)],
            source_info.span,
          ),
          args: [dummy_spanned<Operand>({ $: "Move", _0: Place_from_Local(entry_resume_local) })],
          destination: Place_from_Local(context_ref_local),
          target: poll_bb,
          unwind: Unwind.into_action(unwind),
          call_source: "Misc",
          fn_span: source_info.span,
        },
      );
    }

    const fut_ref_local = this.new_temp(fut_ref_ty);
    const fut_pin_new_unchecked_fn = tcx.require_lang_item(LangItem.PinNewUnchecked, source_info.span);
    const pin_bb = this.new_block_with_statements(
      unwind,
      [
        this.assign(Place_from_Local(fut_ref_local), {
          $: "Ref",
          _0: tcx.lifetimes.re_erased,
          _1: { $: "Mut", kind: "Default" },
          _2: clone_Place(fut_place),
        }),
      ],
      {
        $: "Call",
        func: OperandC.function_handle(tcx, fut_pin_new_unchecked_fn, [GenericArg.from_Ty(fut_ref_ty)], source_info.span),
        args: [dummy_spanned<Operand>({ $: "Move", _0: Place_from_Local(fut_ref_local) })],
        destination: Place_from_Local(fut_pin_local),
        target: get_context_bb,
        unwind: Unwind.into_action(unwind),
        call_source: "Misc",
        fn_span: source_info.span,
      },
    );

    return [pin_bb, resume_bb, dropline_bb];
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:635 build_drop
  build_drop(bb: BasicBlock): void {
    const drop_ty = this.place_ty(this.place);
    if (!this.elaborator.patch_ref().block(this.elaborator.body(), bb).is_cleanup && this.check_if_can_async_drop(drop_ty, false)) {
      const async_drop_bb = this.build_async_drop(this.place, drop_ty, this.succ, this.unwind, this.dropline, false);
      this.elaborator.patch().patch_terminator(bb, TerminatorKind.goto(async_drop_bb));
    } else {
      this.elaborator.patch().patch_terminator(bb, {
        $: "Drop",
        place: clone_Place(this.place),
        target: this.succ,
        unwind: Unwind.into_action(this.unwind),
        replace: false,
        drop: undefined,
      });
    }
  }

  /// Function to check if we can generate an async drop here
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:664 check_if_can_async_drop
  check_if_can_async_drop(drop_ty: Ty, call_destructor_only: boolean): boolean {
    const coroutine = this.elaborator.body().coroutine;
    if (!this.elaborator.allow_async_drops() || !(coroutine !== undefined && CoroutineKindC.is_async_desugaring(coroutine.coroutine_kind))) {
      return false;
    }

    if (drop_ty === this.place_ty(Place_from_Local(Local.arg(0)))) {
      return false;
    }

    let is_async_drop_feature_enabled: boolean;
    if (this.tcx().features().async_drop()) {
      is_async_drop_feature_enabled = true;
    } else {
      // Check if the type needing async drop comes from a dependency crate.
      const k = drop_ty.kind();
      if (k.$ === "Adt") {
        const adt_def = k._0;
        is_async_drop_feature_enabled = !adt_def.did().is_local() && adt_def.async_destructor(this.tcx()) !== undefined;
      } else {
        is_async_drop_feature_enabled = false;
      }
    }

    // Short-circuit before calling needs_async_drop/is_async_drop, as those
    // require the `async_drop` lang item to exist (which may not be present
    // in minimal/custom core environments like cranelift's mini_core).
    if (!is_async_drop_feature_enabled) {
      return false;
    }

    const needs_async_drop = call_destructor_only
      ? drop_ty.is_async_drop(this.tcx(), this.elaborator.typing_env())
      : drop_ty.needs_async_drop(this.tcx(), this.elaborator.typing_env());

    // Async drop in libstd/libcore would become insta-stable — catch that mistake.
    if (needs_async_drop && this.tcx().features().staged_api()) {
      span_bug(this.source_info.span, "don't use async drop in libstd, it becomes insta-stable");
    }

    return needs_async_drop;
  }

  /// This elaborates a single drop instruction, located at `bb`, and
  /// patches over it.
  ///
  /// The elaborated drop checks the drop flags to only drop what
  /// is initialized.
  ///
  /// In addition, the relevant drop flags also need to be cleared
  /// to avoid double-drops. However, in the middle of a complex
  /// drop, one must avoid clearing some of the flags before they
  /// are read, as that would cause a memory leak.
  ///
  /// In particular, when dropping an ADT, multiple fields may be
  /// joined together under the `rest` subpath. They are all controlled
  /// by the primary drop flag, but only the last rest-field dropped
  /// should clear it (and it must also not clear anything else).
  //
  // FIXME: I think we should just control the flags externally,
  // and then we do not need this machinery.
  // #[instrument(level = "debug")]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:734 elaborate_drop
  elaborate_drop(bb: BasicBlock): void {
    switch (this.elaborator.drop_style(this.path, DropFlagMode.Deep)) {
      case "Dead": {
        this.elaborator.patch().patch_terminator(bb, TerminatorKind.goto(this.succ));
        break;
      }
      case "Static": {
        this.build_drop(bb);
        break;
      }
      case "Conditional": {
        const drop_bb = this.complete_drop(this.succ, this.unwind);
        this.elaborator.patch().patch_terminator(bb, TerminatorKind.goto(drop_bb));
        break;
      }
      case "Open": {
        const drop_bb = this.open_drop();
        this.elaborator.patch().patch_terminator(bb, TerminatorKind.goto(drop_bb));
        break;
      }
    }
  }

  /// Returns the place and move path for each field of `variant`,
  /// (the move path is `None` if the field is a rest field).
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:755 move_paths_for_fields
  move_paths_for_fields(base_place: Place, variant_path: Path, variant: VariantDef, args: GenericArgs): [Place, Path | undefined][] {
    const out: [Place, Path | undefined][] = [];
    for (let i = 0; i < variant.fields.length; i++) {
      const field_idx = FieldIdx.from_usize(i);
      const field = variant.fields[i]!;
      const subpath = this.elaborator.field_subpath(variant_path, field_idx);
      const tcx = this.tcx();

      const mode = TypingMode.assert_not_erased(this.elaborator.typing_env().typing_mode());
      switch (mode.$) {
        case "PostAnalysis":
        case "Codegen":
          break;
        case "Coherence":
        case "Reflection":
        case "Typeck":
        case "PostTypeckUntilBorrowck":
        case "PostBorrowck":
          bug();
      }

      const field_ty_ = field.ty(tcx, args);
      // We silently leave an unnormalized type here to support polymorphic drop
      // elaboration for users of rustc internal APIs
      const r = tcx.try_normalize_erasing_regions(this.elaborator.typing_env(), field_ty_, fold_Ty);
      const field_ty = r.$ === "Ok" ? r._0 : Unnormalized.skip_norm_wip(field_ty_);

      const path: [Place, Path | undefined] = [tcx.mk_place_field(base_place, field_idx, field_ty), subpath];
      if (this.should_retain_for_ladder(path)) {
        out.push(path);
      }
    }
    return out;
  }

  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:794 drop_subpath
  drop_subpath(place: Place, path: Path | undefined, succ: BasicBlock, unwind: Unwind, dropline: BasicBlock | undefined): BasicBlock {
    if (path !== undefined) {
      return new DropCtxt<Path>(this.elaborator, this.source_info, place, path, succ, unwind, dropline).elaborated_drop_block();
    } else {
      return new DropCtxt<Path>(
        this.elaborator,
        this.source_info,
        place,
        // Using `self.path` here to condition the drop on our own drop flag.
        this.path,
        succ,
        unwind,
        dropline,
      ).complete_drop(succ, unwind);
    }
  }

  /// Creates one-half of the drop ladder for a list of fields, and return
  /// the list of steps in it in reverse order, with the first step
  /// dropping 0 fields and so on.
  ///
  /// `unwind_ladder` is such a list of steps in reverse order,
  /// which is called if the matching step of the drop glue panics.
  ///
  /// `dropline_ladder` is a similar list of steps in reverse order,
  /// which is called if the matching step of the drop glue will contain async drop
  /// (expanded later to Yield) and the containing coroutine will be dropped at this point.
  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:839 drop_halfladder
  drop_halfladder(
    unwind_ladder: readonly Unwind[],
    dropline_ladder: readonly (BasicBlock | undefined)[],
    succ: BasicBlock,
    fields: readonly [Place, Path | undefined][],
  ): BasicBlock[] {
    const out: BasicBlock[] = [succ];
    // PORT: `izip!(fields.iter().rev(), unwind_ladder, dropline_ladder)` stops at the shortest of the three.
    const n = Math.min(fields.length, unwind_ladder.length, dropline_ladder.length);
    for (let i = 0; i < n; i++) {
      const [place, path] = fields[fields.length - 1 - i]!;
      const unwind_succ = unwind_ladder[i]!;
      const dropline_to = dropline_ladder[i];
      succ = this.drop_subpath(place, path, succ, unwind_succ, dropline_to);
      out.push(succ);
    }
    return out;
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:856 drop_ladder_bottom
  drop_ladder_bottom(): [BasicBlock, Unwind, BasicBlock | undefined] {
    // Clear the "master" drop flag at the end. This is needed
    // because the "master" drop protects the ADT's discriminant,
    // which is invalidated after the ADT is dropped.
    return [this.drop_flag_reset_block(DropFlagMode.Shallow, this.succ, this.unwind), this.unwind, this.dropline];
  }

  /// Whether this drop is useful. This is purely an optimization to avoid generating useless blocks.
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:868 should_retain_for_ladder
  should_retain_for_ladder([place, subpath]: readonly [Place, Path | undefined]): boolean {
    if (!this.place_ty(place).needs_drop(this.tcx(), this.elaborator.typing_env())) {
      return false;
    }
    if (subpath !== undefined && this.elaborator.drop_style(subpath, DropFlagMode.Deep) === "Dead") {
      return false;
    }
    return true;
  }

  /// Creates a full drop ladder, consisting of 2 connected half-drop-ladders
  ///
  /// For example, with 3 fields, the drop ladder is
  ///
  /// ```text
  /// .d0:
  ///     ELAB(drop location.0 [target=.d1, unwind=.c1])
  /// .d1:
  ///     ELAB(drop location.1 [target=.d2, unwind=.c2])
  /// .d2:
  ///     ELAB(drop location.2 [target=`self.succ`, unwind=`self.unwind`])
  /// .c1:
  ///     ELAB(drop location.1 [target=.c2])
  /// .c2:
  ///     ELAB(drop location.2 [target=`self.unwind`])
  /// ```
  ///
  /// For possible-async drops in coroutines we also need dropline ladder
  /// ```text
  /// .d0 (mainline):
  ///     ELAB(drop location.0 [target=.d1, unwind=.c1, drop=.e1])
  /// .d1 (mainline):
  ///     ELAB(drop location.1 [target=.d2, unwind=.c2, drop=.e2])
  /// .d2 (mainline):
  ///     ELAB(drop location.2 [target=`self.succ`, unwind=`self.unwind`, drop=`self.drop`])
  /// .c1 (unwind):
  ///     ELAB(drop location.1 [target=.c2])
  /// .c2 (unwind):
  ///     ELAB(drop location.2 [target=`self.unwind`])
  /// .e1 (dropline):
  ///     ELAB(drop location.1 [target=.e2, unwind=.c2])
  /// .e2 (dropline):
  ///     ELAB(drop location.2 [target=`self.drop`, unwind=`self.unwind`])
  /// ```
  ///
  /// NOTE: this does not clear the master drop flag, so you need
  /// to point succ/unwind on a `drop_ladder_bottom`.
  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:918 drop_ladder
  drop_ladder(
    fields: [Place, Path | undefined][],
    succ: BasicBlock,
    unwind: Unwind,
    dropline: BasicBlock | undefined,
  ): [BasicBlock, Unwind, BasicBlock | undefined] {
    assert(Unwind.is_cleanup(unwind) ? dropline === undefined : true, "Dropline is set for cleanup drop ladder");

    fields = fields.filter((path) => this.should_retain_for_ladder(path));

    // debug!("drop_ladder - fields needing drop: {:?}", fields);

    let dropline_ladder: (BasicBlock | undefined)[] = Array.from({ length: fields.length + 1 }, () => undefined);
    let unwind_ladder: Unwind[] = Array.from({ length: fields.length + 1 }, () => Unwind.InCleanup);
    if (unwind.$ === "To") {
      const halfladder = this.drop_halfladder(unwind_ladder, dropline_ladder, unwind._0, fields);
      unwind_ladder = halfladder.map((bb) => Unwind.To(bb));
    }
    if (dropline !== undefined) {
      const halfladder = this.drop_halfladder(unwind_ladder, dropline_ladder, dropline, fields);
      dropline_ladder = halfladder;
    }

    const normal_ladder = this.drop_halfladder(unwind_ladder, dropline_ladder, succ, fields);

    return [unwrap(normal_ladder.at(-1)), unwrap(unwind_ladder.at(-1)), dropline_ladder[dropline_ladder.length - 1]];
  }

  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:959 open_drop_for_tuple
  open_drop_for_tuple(tys: readonly Ty[]): BasicBlock {
    const fields: [Place, Path | undefined][] = tys.map((ty, i) => [
      this.tcx().mk_place_field(this.place, FieldIdx.new(i), ty),
      this.elaborator.field_subpath(this.path, FieldIdx.new(i)),
    ]);

    const [succ, unwind, dropline] = this.drop_ladder_bottom();
    return this.drop_ladder(fields, succ, unwind, dropline)[0];
  }

  /// Drops the T contained in a `Box<T>` if it has not been moved out of
  // #[instrument(level = "debug", ret)]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:977 open_drop_for_box_contents
  open_drop_for_box_contents(adt: AdtDef, args: GenericArgs, succ: BasicBlock, unwind: Unwind, dropline: BasicBlock | undefined): BasicBlock {
    // drop glue is sent straight to codegen
    // box cannot be directly dereferenced
    const unique_ty = Unnormalized.skip_norm_wip(adt.non_enum_variant().fields[FieldIdx.ZERO]!.ty(this.tcx(), args));
    const unique_variant = unwrap(unique_ty.ty_adt_def()).non_enum_variant();
    const nonnull_ty = Unnormalized.skip_norm_wip(unique_variant.fields[FieldIdx.ZERO]!.ty(this.tcx(), args));
    const ptr_ty = Ty.new_imm_ptr(this.tcx(), GenericArg.expect_ty(args[0]!));

    const unique_place = this.tcx().mk_place_field(this.place, FieldIdx.ZERO, unique_ty);
    const nonnull_place = this.tcx().mk_place_field(unique_place, FieldIdx.ZERO, nonnull_ty);

    const ptr_local = this.new_temp(ptr_ty);

    const interior = this.tcx().mk_place_deref(Place_from_Local(ptr_local));
    const interior_path = this.elaborator.deref_subpath(this.path);

    const do_drop_bb = this.drop_subpath(interior, interior_path, succ, unwind, dropline);

    return this.new_block_with_statements(
      unwind,
      [this.assign(Place_from_Local(ptr_local), { $: "Cast", _0: { $: "Transmute" }, _1: { $: "Copy", _0: nonnull_place }, _2: ptr_ty })],
      TerminatorKind.goto(do_drop_bb),
    );
  }

  // #[instrument(level = "debug", ret)]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1014 open_drop_for_adt
  open_drop_for_adt(adt: AdtDef, args: GenericArgs): BasicBlock {
    if (adt.variants().length === 0) {
      return this.new_block(this.unwind, { $: "Unreachable" });
    }

    const skip_contents = adt.is_union() || adt.is_manually_drop();
    let contents_succ: BasicBlock;
    let contents_unwind: Unwind;
    let contents_dropline: BasicBlock | undefined;
    if (skip_contents) {
      if (adt.has_dtor(this.tcx()) && this.elaborator.get_drop_flag(this.path) !== undefined) {
        // the top-level drop flag is usually cleared by open_drop_for_adt_contents
        // types with destructors would still need an empty drop ladder to clear it

        // however, these types are only open dropped in `DropShimElaborator`
        // which does not have drop flags
        // a future box-like "DerefMove" trait would allow for this case to happen
        span_bug(this.source_info.span, "open dropping partially moved union");
      }

      [contents_succ, contents_unwind, contents_dropline] = [this.succ, this.unwind, this.dropline];
    } else {
      [contents_succ, contents_unwind, contents_dropline] = this.open_drop_for_adt_contents(adt, args);
    }

    if (adt.has_dtor(this.tcx())) {
      let destructor_block: BasicBlock;
      if (adt.is_box()) {
        // we need to drop the inside of the box before running the destructor
        const succ = this.destructor_call_block_sync(contents_succ, contents_unwind);
        const unwind = Unwind.map(contents_unwind, (unwind) => this.destructor_call_block_sync(unwind, Unwind.InCleanup));
        const dropline =
          contents_dropline === undefined ? undefined : this.destructor_call_block_sync(contents_dropline, contents_unwind);
        destructor_block = this.open_drop_for_box_contents(adt, args, succ, unwind, dropline);
      } else {
        destructor_block = this.destructor_call_block(contents_succ, contents_unwind, contents_dropline);
      }

      return this.drop_flag_test_block(destructor_block, contents_succ, contents_unwind);
    } else {
      return contents_succ;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1059 open_drop_for_adt_contents
  open_drop_for_adt_contents(adt: AdtDef, args: GenericArgs): [BasicBlock, Unwind, BasicBlock | undefined] {
    const [succ, unwind, dropline] = this.drop_ladder_bottom();
    if (!adt.is_enum()) {
      const fields = this.move_paths_for_fields(this.place, this.path, adt.variant(FIRST_VARIANT), args);
      return this.drop_ladder(fields, succ, unwind, dropline);
    } else {
      return this.open_drop_for_multivariant(adt, args, succ, unwind, dropline);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1074 open_drop_for_multivariant
  open_drop_for_multivariant(
    adt: AdtDef,
    args: GenericArgs,
    succ: BasicBlock,
    unwind: Unwind,
    dropline: BasicBlock | undefined,
  ): [BasicBlock, Unwind, BasicBlock | undefined] {
    const values: bigint[] = [];
    const normal_blocks: BasicBlock[] = [];
    const unwind_blocks: BasicBlock[] = [];
    const dropline_blocks: BasicBlock[] = [];

    let have_otherwise_with_drop_glue = false;
    let have_otherwise = false;
    const tcx = this.tcx();

    for (const [variant_index, discr] of adt.discriminants(tcx)) {
      const variant = adt.variant(variant_index);
      const subpath = this.elaborator.downcast_subpath(this.path, variant_index);

      if (subpath !== undefined) {
        const variant_path = subpath;
        const base_place = tcx.mk_place_elem(this.place, { $: "Downcast", _0: variant.name, _1: variant_index });
        const fields = this.move_paths_for_fields(base_place, variant_path, variant, args);
        values.push(discr.val);
        if (unwind.$ === "To") {
          // We can't use the half-ladder from the original
          // drop ladder, because this breaks the
          // "funclet can't have 2 successor funclets"
          // requirement from MSVC:
          //
          //           switch       unwind-switch
          //          /      \         /        \
          //         v1.0    v2.0  v2.0-unwind  v1.0-unwind
          //         |        |      /             |
          //    v1.1-unwind  v2.1-unwind           |
          //      ^                                |
          //       \-------------------------------/
          //
          // Create a duplicate half-ladder to avoid that. We
          // could technically only do this on MSVC, but I
          // I want to minimize the divergence between MSVC
          // and non-MSVC.

          const unwind_ladder: Unwind[] = Array.from({ length: fields.length + 1 }, () => Unwind.InCleanup);
          const dropline_ladder: (BasicBlock | undefined)[] = Array.from({ length: fields.length + 1 }, () => undefined);
          const halfladder = this.drop_halfladder(unwind_ladder, dropline_ladder, unwind._0, fields);
          unwind_blocks.push(unwrap(halfladder.at(-1)));
        }
        const [normal, , drop_bb] = this.drop_ladder(fields, succ, unwind, dropline);
        normal_blocks.push(normal);
        if (dropline !== undefined) {
          dropline_blocks.push(unwrap(drop_bb));
        }
      } else {
        have_otherwise = true;

        const typing_env = this.elaborator.typing_env();
        const have_field_with_drop_glue = variant.fields.some((field) =>
          Unnormalized.skip_norm_wip(field.ty(tcx, args)).needs_drop(tcx, typing_env),
        );
        if (have_field_with_drop_glue) {
          have_otherwise_with_drop_glue = true;
        }
      }
    }

    if (!have_otherwise) {
      values.pop();
    } else if (!have_otherwise_with_drop_glue) {
      normal_blocks.push(succ);
      if (unwind.$ === "To") {
        unwind_blocks.push(unwind._0);
      }
      if (dropline !== undefined) {
        dropline_blocks.push(dropline);
      }
    } else {
      normal_blocks.push(this.drop_block(succ, unwind));
      if (unwind.$ === "To") {
        unwind_blocks.push(this.drop_block(unwind._0, Unwind.InCleanup));
      }
      if (dropline !== undefined) {
        dropline_blocks.push(this.drop_block(dropline, unwind));
      }
    }

    return [
      this.adt_switch_block(adt, normal_blocks, values, succ, unwind),
      Unwind.map(unwind, (unwind_) => this.adt_switch_block(adt, unwind_blocks, values, unwind_, Unwind.InCleanup)),
      dropline === undefined ? undefined : this.adt_switch_block(adt, dropline_blocks, values, dropline, unwind),
    ];
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1179 adt_switch_block
  adt_switch_block(adt: AdtDef, blocks: BasicBlock[], values: readonly bigint[], succ: BasicBlock, unwind: Unwind): BasicBlock {
    // PORT: `blocks.iter().copied().all_equal_value()` is `Ok(v)` iff `blocks` is non-empty and all equal.
    const all_equal = blocks.length > 0 && blocks.every((b) => b === blocks[0]);
    let switch_block: BasicBlock;
    if (all_equal) {
      switch_block = blocks[0]!;
    } else {
      // If there are multiple variants, then if something
      // is present within the enum the discriminant, tracked
      // by the rest path, must be initialized.
      //
      // Additionally, we do not want to switch on the
      // discriminant after it is free-ed, because that
      // way lies only trouble.
      const discr_ty = IntTypeExt.to_ty(adt.repr().discr_type(), this.tcx());
      const discr = Place_from_Local(this.new_temp(discr_ty));
      const discr_rv: Rvalue = { $: "Discriminant", _0: clone_Place(this.place) };
      // PORT: `values.iter().copied().zip(blocks.iter().copied())` stops at the shorter of the two.
      const n = Math.min(values.length, blocks.length);
      const targets: [bigint, BasicBlock][] = [];
      for (let i = 0; i < n; i++) {
        targets.push([values[i]!, blocks[i]!]);
      }
      switch_block = this.new_block_with_statements(unwind, [this.assign(clone_Place(discr), discr_rv)], {
        $: "SwitchInt",
        discr: { $: "Move", _0: discr },
        targets: SwitchTargets.new(targets, unwrap(blocks.at(-1))),
      });
    }
    return this.drop_flag_test_block(switch_block, succ, unwind);
  }

  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1214 destructor_call_block_sync
  destructor_call_block_sync(succ: BasicBlock, unwind: Unwind): BasicBlock {
    const tcx = this.tcx();
    const drop_trait = tcx.require_lang_item(LangItem.Drop, DUMMY_SP);
    const drop_fn = (tcx.associated_item_def_ids(drop_trait) as readonly DefId[])[0]!;
    const ty = this.place_ty(this.place);

    const ref_ty = Ty.new_mut_ref(tcx, tcx.lifetimes.re_erased, ty);
    const ref_place = this.new_temp(ref_ty);
    const unit_temp = Place_from_Local(this.new_temp(tcx.types.unit));

    return this.new_block_with_statements(
      unwind,
      [
        this.assign(Place_from_Local(ref_place), {
          $: "Ref",
          _0: tcx.lifetimes.re_erased,
          _1: { $: "Mut", kind: "Default" },
          _2: clone_Place(this.place),
        }),
      ],
      {
        $: "Call",
        func: OperandC.function_handle(tcx, drop_fn, [GenericArg.from_Ty(ty)], this.source_info.span),
        args: [dummy_spanned<Operand>({ $: "Move", _0: Place_from_Local(ref_place) })],
        destination: unit_temp,
        target: succ,
        unwind: Unwind.into_action(unwind),
        call_source: "Misc",
        fn_span: this.source_info.span,
      },
    );
  }

  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1247 destructor_call_block
  destructor_call_block(succ: BasicBlock, unwind: Unwind, dropline: BasicBlock | undefined): BasicBlock {
    const ty = this.place_ty(this.place);
    if (!Unwind.is_cleanup(unwind) && this.check_if_can_async_drop(ty, true)) {
      return this.build_async_drop(this.place, ty, succ, unwind, dropline, true);
    } else {
      return this.destructor_call_block_sync(succ, unwind);
    }
  }

  /// Create a loop that drops an array:
  ///
  /// ```text
  /// loop-block:
  ///    can_go = cur == len
  ///    if can_go then succ else drop-block
  /// drop-block:
  ///    ptr = &raw mut P[cur]
  ///    cur = cur + 1
  ///    drop(ptr)
  /// ```
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1272 drop_loop
  drop_loop(succ: BasicBlock, cur: Local, len: Local, ety: Ty, unwind: Unwind, dropline: BasicBlock | undefined): BasicBlock {
    const copy = (place: Place): Operand => ({ $: "Copy", _0: clone_Place(place) });
    const move_ = (place: Place): Operand => ({ $: "Move", _0: clone_Place(place) });
    const tcx = this.tcx();

    const ptr_ty = Ty.new_mut_ptr(tcx, ety);
    const ptr = Place_from_Local(this.new_temp(ptr_ty));
    const can_go = Place_from_Local(this.new_temp(tcx.types.bool));
    const one = this.constant_usize(1);

    const drop_block = this.new_block_with_statements(
      unwind,
      [
        this.assign(clone_Place(ptr), { $: "RawPtr", _0: "Mut", _1: tcx.mk_place_index(this.place, cur) }),
        this.assign(Place_from_Local(cur), { $: "BinaryOp", _0: "Add", _1: [move_(Place_from_Local(cur)), one] }),
      ],
      // this gets overwritten by drop elaboration.
      { $: "Unreachable" },
    );

    const loop_block = this.new_block_with_statements(
      unwind,
      [this.assign(clone_Place(can_go), { $: "BinaryOp", _0: "Eq", _1: [copy(Place_from_Local(cur)), copy(Place_from_Local(len))] })],
      TerminatorKind.if_(move_(can_go), succ, drop_block),
    );

    const place = tcx.mk_place_deref(ptr);
    if (!Unwind.is_cleanup(unwind) && this.check_if_can_async_drop(ety, false)) {
      const async_drop_bb = this.build_async_drop(place, ety, loop_block, unwind, dropline, false);
      this.elaborator.patch().patch_terminator(drop_block, TerminatorKind.goto(async_drop_bb));
    } else {
      this.elaborator.patch().patch_terminator(drop_block, {
        $: "Drop",
        place,
        target: loop_block,
        unwind: Unwind.into_action(unwind),
        replace: false,
        drop: undefined,
      });
    }
    return loop_block;
  }

  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1338 open_drop_for_array
  open_drop_for_array(array_ty: Ty, ety: Ty, opt_size: number | undefined): BasicBlock {
    const tcx = this.tcx();

    if (opt_size !== undefined) {
      const size = opt_size;
      // enum ProjectionKind<Path> { Drop(std::ops::Range<u64>), Keep(u64, Path) }
      type ProjectionKind = { $: "Drop"; start: number; end: number } | { $: "Keep"; _0: number; _1: Path };
      // Previously, we'd make a projection for every element in the array and create a drop
      // ladder if any `array_subpath` was `Some`, i.e. moving out with an array pattern.
      // This caused huge memory usage when generating the drops for large arrays, so we instead
      // record the *subslices* which are dropped and the *indexes* which are kept
      const drop_ranges: ProjectionKind[] = [];
      let dropping = true;
      let start = 0;
      for (let i = 0; i < size; i++) {
        const path = this.elaborator.array_subpath(this.path, i, size);
        if (dropping && path !== undefined) {
          drop_ranges.push({ $: "Drop", start, end: i });
          dropping = false;
        } else if (!dropping && path === undefined) {
          dropping = true;
          start = i;
        }
        if (path !== undefined) {
          drop_ranges.push({ $: "Keep", _0: i, _1: path });
        }
      }
      if (drop_ranges.length !== 0) {
        if (dropping) {
          drop_ranges.push({ $: "Drop", start, end: size });
        }
        const fields: [Place, Path | undefined][] = [];
        for (let j = drop_ranges.length - 1; j >= 0; j--) {
          const p = drop_ranges[j]!;
          let project: PlaceElem;
          let path: Path | undefined;
          switch (p.$) {
            case "Drop":
              [project, path] = [{ $: "Subslice", from: p.start, to: p.end, from_end: false }, undefined];
              break;
            case "Keep":
              [project, path] = [{ $: "ConstantIndex", offset: p._0, min_length: size, from_end: false }, p._1];
              break;
          }
          fields.push([tcx.mk_place_elem(this.place, project), path]);
        }
        const [succ, unwind, dropline] = this.drop_ladder_bottom();
        return this.drop_ladder(fields, succ, unwind, dropline)[0];
      }
    }

    const array_ptr_ty = Ty.new_mut_ptr(tcx, array_ty);
    const array_ptr = this.new_temp(array_ptr_ty);

    const slice_ty = Ty.new_slice(tcx, ety);
    const slice_ptr_ty = Ty.new_mut_ptr(tcx, slice_ty);
    const slice_ptr = this.new_temp(slice_ptr_ty);

    // mem::replace(&mut self.place, ..)
    const array_place = this.place;
    this.place = Place_from_Local(slice_ptr).project_deeper([{ $: "Deref" }], tcx);
    const slice_block = this.drop_loop_trio_for_slice(ety);
    this.place = array_place;

    return this.new_block_with_statements(
      this.unwind,
      [
        this.assign(Place_from_Local(array_ptr), { $: "RawPtr", _0: "Mut", _1: clone_Place(this.place) }),
        this.assign(Place_from_Local(slice_ptr), {
          $: "Cast",
          _0: { $: "PointerCoercion", _0: { $: "Unsize" }, _1: "Implicit" },
          _1: { $: "Move", _0: Place_from_Local(array_ptr) },
          _2: slice_ptr_ty,
        }),
      ],
      TerminatorKind.goto(slice_block),
    );
  }

  /// Creates a trio of drop-loops of `place`, which drops its contents, even
  /// in the case of 1 panic or in the case of coroutine drop
  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1442 drop_loop_trio_for_slice
  drop_loop_trio_for_slice(ety: Ty): BasicBlock {
    const tcx = this.tcx();
    const len = this.new_temp(tcx.types.usize);
    const cur = this.new_temp(tcx.types.usize);

    const unwind = Unwind.map(this.unwind, (unwind) => this.drop_loop(unwind, cur, len, ety, Unwind.InCleanup, undefined));

    const dropline = this.dropline === undefined ? undefined : this.drop_loop(this.dropline, cur, len, ety, unwind, undefined);

    const loop_block = this.drop_loop(this.succ, cur, len, ety, unwind, dropline);

    const proj = this.place.projection;
    if (!(proj.length === 1 && proj[0]!.$ === "Deref")) {
      span_bug(this.source_info.span, `Expected place for slice drop shim to be *_n, but it's ${debug_Place(this.place, PLAIN)}`);
    }

    const zero = this.constant_usize(0);
    const drop_block = this.new_block_with_statements(
      unwind,
      [
        this.assign(Place_from_Local(len), { $: "UnaryOp", _0: "PtrMetadata", _1: { $: "Copy", _0: Place_from_Local(this.place.local) } }),
        this.assign(Place_from_Local(cur), { $: "Use", _0: zero, _1: "Yes" }),
      ],
      TerminatorKind.goto(loop_block),
    );

    // FIXME(#34708): handle partially-dropped array/slice elements.
    const reset_block = this.drop_flag_reset_block(DropFlagMode.Deep, drop_block, unwind);
    return this.drop_flag_test_block(reset_block, this.succ, unwind);
  }

  /// The slow-path - create an "open", elaborated drop for a type
  /// which is moved-out-of only partially, and patch `bb` to a jump
  /// to it. This must not be called on ADTs with a destructor,
  /// as these can't be moved-out-of, except for `Box<T>`, which is
  /// special-cased.
  ///
  /// This creates a "drop ladder" that drops the needed fields of the
  /// ADT, both in the success case or if one of the destructors fail.
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1493 open_drop
  open_drop(): BasicBlock {
    const ty = this.place_ty(this.place);
    const k = ty.kind();
    switch (k.$) {
      case "Closure":
        return this.open_drop_for_tuple(ClosureArgs.upvar_tys(k._1.as_closure()));
      case "CoroutineClosure":
        return this.open_drop_for_tuple(CoroutineClosureArgs.upvar_tys(k._1.as_coroutine_closure()));
      // Note that `elaborate_drops` only drops the upvars of a coroutine,
      // and this is ok because `open_drop` here can only be reached
      // within that own coroutine's resume function.
      // This should only happen for the self argument on the resume function.
      // It effectively only contains upvars until the coroutine transformation runs.
      // See librustc_body/transform/coroutine.rs for more details.
      case "Coroutine":
        return this.open_drop_for_tuple(CoroutineArgs.upvar_tys(k._1.as_coroutine()));
      case "Tuple":
        return this.open_drop_for_tuple(k._0);
      case "Adt":
        return this.open_drop_for_adt(k._0, k._1);
      case "Dynamic":
        return this.complete_drop(this.succ, this.unwind);
      case "Array": {
        const size = k._1.try_to_target_usize(this.tcx());
        return this.open_drop_for_array(ty, k._0, size === undefined ? undefined : u64_to_number(size, "open_drop_for_array"));
      }
      case "Slice":
        return this.drop_loop_trio_for_slice(k._0);

      case "UnsafeBinder": {
        // Unsafe binders may elaborate drops if their inner type isn't copy.
        // This is enforced in typeck, so this should never happen.
        this.tcx().dcx().span_delayed_bug(this.source_info.span, "open drop for unsafe binder shouldn't be encountered");
        return this.new_block(this.unwind, { $: "Unreachable" });
      }

      default:
        return span_bug(this.source_info.span, `open drop from non-ADT \`${debug_Ty(ty, PLAIN)}\``);
    }
  }

  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1531 complete_drop
  complete_drop(succ: BasicBlock, unwind: Unwind): BasicBlock {
    const drop_block = this.drop_block(succ, unwind);
    return this.drop_flag_test_block(drop_block, succ, unwind);
  }

  /// Creates a block that resets the drop flag. If `mode` is deep, all children drop flags will
  /// also be cleared.
  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1539 drop_flag_reset_block
  drop_flag_reset_block(mode: DropFlagMode, succ: BasicBlock, unwind: Unwind): BasicBlock {
    if (Unwind.is_cleanup(unwind)) {
      // The drop flag isn't read again on the unwind path, so don't
      // bother setting it.
      return succ;
    }
    const flags = this.elaborator.drop_flags_for(this.path, mode);
    const statements: StatementT[] = flags.map((flag) =>
      this.assign(flag, { $: "Use", _0: this.constant_bool(DropFlagState.value(DropFlagState.Absent)), _1: "Yes" }),
    );
    if (statements.length === 0) {
      return succ;
    }
    return this.new_block_with_statements(unwind, statements, TerminatorKind.goto(succ));
  }

  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1567 elaborated_drop_block
  elaborated_drop_block(): BasicBlock {
    const blk = this.new_block(this.unwind, {
      $: "Drop",
      place: clone_Place(this.place),
      target: this.succ,
      unwind: Unwind.into_action(this.unwind),
      replace: false,
      drop: this.dropline,
    });
    this.elaborate_drop(blk);
    return blk;
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1582 drop_block
  drop_block(target: BasicBlock, unwind: Unwind): BasicBlock {
    const drop_ty = this.place_ty(this.place);
    if (!Unwind.is_cleanup(unwind) && this.check_if_can_async_drop(drop_ty, false)) {
      return this.build_async_drop(this.place, drop_ty, this.succ, unwind, this.dropline, false);
    } else {
      return this.new_block(unwind, {
        $: "Drop",
        place: clone_Place(this.place),
        target,
        unwind: Unwind.into_action(unwind),
        replace: false,
        drop: undefined,
      });
    }
  }

  /// Returns the block to jump to in order to test the drop flag and execute the drop.
  ///
  /// Depending on the required `DropStyle`, this might be a generated block with an `if`
  /// terminator (for dynamic/open drops), or it might be `on_set` or `on_unset` itself, in case
  /// the drop can be statically determined.
  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1606 drop_flag_test_block
  drop_flag_test_block(on_set: BasicBlock, on_unset: BasicBlock, unwind: Unwind): BasicBlock {
    const style = this.elaborator.drop_style(this.path, DropFlagMode.Shallow);
    switch (style) {
      case "Dead":
        return on_unset;
      case "Static":
        return on_set;
      case "Conditional":
      case "Open": {
        const flag = unwrap(this.elaborator.get_drop_flag(this.path));
        const term = TerminatorKind.if_(flag, on_set, on_unset);
        return this.new_block(unwind, term);
      }
    }
  }

  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1625 new_block
  new_block(unwind: Unwind, k: TerminatorKind): BasicBlock {
    return this.elaborator.patch().new_block(BasicBlockData.new(new Terminator(clone_SourceInfo(this.source_info), k), Unwind.is_cleanup(unwind)));
  }

  // #[instrument(level = "trace", skip(self, statements), ret)]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1633 new_block_with_statements
  new_block_with_statements(unwind: Unwind, statements: StatementT[], k: TerminatorKind): BasicBlock {
    return this.elaborator
      .patch()
      .new_block(BasicBlockData.new_stmts(statements, new Terminator(clone_SourceInfo(this.source_info), k), Unwind.is_cleanup(unwind)));
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1646 new_temp
  new_temp(ty: Ty): Local {
    return this.elaborator.patch().new_temp(ty, this.source_info.span);
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1650 constant_usize
  constant_usize(val: number): Operand {
    return { $: "Constant", _0: new ConstOperand(this.source_info.span, undefined, Const.from_usize(this.tcx(), val)) };
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1658 constant_bool
  constant_bool(val: boolean): Operand {
    return { $: "Constant", _0: new ConstOperand(this.source_info.span, undefined, Const.from_bool(this.tcx(), val)) };
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1666 assign
  assign(lhs: Place, rhs: Rvalue): StatementT {
    return Statement.new(clone_SourceInfo(this.source_info), { $: "Assign", _0: [lhs, rhs] });
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1670 storage_live
  storage_live(local: Local): StatementT {
    return Statement.new(clone_SourceInfo(this.source_info), { $: "StorageLive", _0: local });
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drop.rs:1674 storage_dead
  storage_dead(local: Local): StatementT {
    return Statement.new(clone_SourceInfo(this.source_info), { $: "StorageDead", _0: local });
  }
}
