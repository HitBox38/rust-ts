//! Drops and async drops related logic for coroutine transformation pass
// Port of compiler/rustc_mir_transform/src/coroutine/drop.rs (lane mt-coroutine-b, wave 23).
//
// PORT: `use super::*;` reaches coroutine/mod.rs (lane mt-coroutine-a, wave 24; a stub at this lane's base), whose
// items this file uses (`TransformVisitor`, `Operation`, `create_cases`, `insert_switch`, `insert_term_block`,
// `insert_poll_ready_block`, `insert_panic_block`, `return_poll_ready_assign`, `make_coroutine_state_argument_indirect`,
// `make_coroutine_state_argument_pinned`, `generate_poison_block_and_redirect_unwinds_there`, `transform_async_context`)
// as do `elaborate_drop::{Unwind, elaborate_drop}` (lane mt-drops) and `shim::DropShimElaborator` (lane mt-shim)
// (`deref_separator::deref_finder` is imported from its port, lane mt-cleanup). They are module-local stand-ins at the
// end of this file (not
// markers; each stops UNPORTED with its upstream path) that those lanes repoint at their ports. `SELF_ARG` is mod.rs's
// constant (`Local::arg(0)`, mod.rs:160), declared here with the same value. Nothing imports this module yet:
// coroutine/mod.ts (`mod drop;` + the `use drop::{..}` list) is mt-coroutine-a's.
// PORT: `FixReturnPendingVisitor` `extends MutVisitor` (mir/visit.ts, D4). `*rvalue = ..` replaces the caller's `Rvalue`
// object in place (`replace_in_place`); `*args = ..` writes the `Adt` aggregate's `_2` field.
// PORT: `body.clone()` is the generated `clone_Body`; `Option::take` of `body.coroutine` sets it to `undefined`.
// PORT: a `SourceInfo` (`Copy`) passed by value more than once is copied with `clone_SourceInfo` (PORTING §8).
// PORT: `#[tracing::instrument]` is a comment (no tracing subscriber).
import { VariantIdx } from "../../rustc_abi/layout.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type { CoroutineKind } from "../../rustc_hir/hir.ts";
import { CoroutineKind as CoroutineKindC } from "../../rustc_hir/hir.ts";
import { DenseBitSet } from "../../rustc_index/bit_set.ts";
import {
  type BasicBlock,
  BasicBlockData,
  type Body,
  clone_Body,
  clone_SourceInfo,
  Local,
  LocalDecl,
  type Location,
  RETURN_PLACE,
  SourceInfo,
  type Statement,
} from "../../rustc_middle/mir/mod.ts";
import { BasicBlocks } from "../../rustc_middle/mir/basic_blocks.ts";
import { MirDumper } from "../../rustc_middle/mir/pretty.ts";
import { Place_from_Local } from "../../rustc_middle/mir/statement.ts";
import { type AssertKind, type Operand, type Place, type Rvalue, TerminatorKind, UnwindAction } from "../../rustc_middle/mir/syntax.ts";
import { Terminator } from "../../rustc_middle/mir/terminator.ts";
import * as traversal from "../../rustc_middle/mir/traversal.ts";
import { MutVisitor } from "../../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { InstanceKind } from "../../rustc_middle/ty/instance.ts";
import type { AdtDef } from "../../rustc_middle/ty/decls.ts";
import { Ty, type TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { CoroutineArgsExt } from "../../rustc_middle/ty/sty.ts";
import { DefId_eq } from "../../rustc_span/def_id.ts";
import { replace_in_place } from "../../std/mut_ref.ts";
import { unported, unwrap } from "../../std/panic.ts";

import * as abort_unwinding_calls from "../abort_unwinding_calls.ts";
import { deref_finder } from "../deref_separator.ts";
import * as pm from "../pass_manager.ts";
import { MirPatch } from "../patch.ts";
import * as simplify from "../simplify.ts";

// PORT: coroutine/mod.rs:160 `const SELF_ARG: Local = Local::arg(0);` (see the header).
const SELF_ARG: Local = Local.arg(0);

// Fix return Poll<Rv>::Pending statement into Poll<()>::Pending for async drop function
// rustc-type: compiler/rustc_mir_transform/src/coroutine/drop.rs:6 FixReturnPendingVisitor
class FixReturnPendingVisitor extends MutVisitor {
  constructor(public tcx_: TyCtxt) {
    super();
  }

  // ---- impl MutVisitor for FixReturnPendingVisitor ----

  // rustc: compiler/rustc_mir_transform/src/coroutine/drop.rs:11 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/coroutine/drop.rs:15 visit_assign
  override visit_assign(place: Place, rvalue: Rvalue, _location: Location): void {
    if (place.local !== RETURN_PLACE) {
      return;
    }

    // Converting `_0 = Poll::<Rv>::Pending` to `_0 = Poll::<()>::Pending`
    if (rvalue.$ === "Aggregate" && rvalue._0.$ === "Adt") {
      const kind = rvalue._0;
      kind._2 = this.tcx_.mk_args([GenericArg.from_Ty(this.tcx_.types.unit)]);
    } else if (rvalue.$ === "Use" && rvalue._0.$ === "Constant") {
      const constant = rvalue._0._0;
      const async_gen_pending_def_id = this.tcx_.lang_items().async_gen_pending();
      if (
        async_gen_pending_def_id !== undefined &&
        constant.const_.$ === "Unevaluated" &&
        DefId_eq(constant.const_._0.def, async_gen_pending_def_id)
      ) {
        const poll_def_id = unwrap(this.tcx_.lang_items().poll());
        replace_in_place<Rvalue>(rvalue, {
          $: "Aggregate",
          _0: {
            $: "Adt",
            _0: poll_def_id,
            _1: VariantIdx.from_u32(1),
            _2: this.tcx_.mk_args([GenericArg.from_Ty(this.tcx_.types.unit)]),
            _3: undefined,
            _4: undefined,
          },
          _1: [],
        });
      }
    }
  }
}

/// Drop elaboration has transformed all async drops into `yield` loops.
/// The resulting coroutine needs `async drop` if it yields on a path
/// reachable through 'drop' targets of a Yield terminator.
// #[tracing::instrument(level = "trace", skip(body), ret)]
// rustc: compiler/rustc_mir_transform/src/coroutine/drop.rs:55 has_async_drops
export function has_async_drops(body: Body): boolean {
  let has_async_drops = false;

  const dropline: DenseBitSet<BasicBlock> = DenseBitSet.new_empty<BasicBlock>(body.basic_blocks.deref().length);
  for (const [bb, data] of traversal.reverse_postorder(body)) {
    // Cleanup edges are not async drops.
    if (data.is_cleanup) {
      continue;
    }

    const kind = data.terminator_().kind;
    if (kind.$ === "Yield") {
      const drop = kind.drop;
      if (dropline.contains(bb)) {
        has_async_drops = true;
      }
      if (drop !== undefined) {
        const v = drop;
        dropline.insert(v);
      }
    }

    if (dropline.contains(bb)) {
      for (const v of data.terminator_().successors()) {
        dropline.insert(v);
      }
    }
  }

  return has_async_drops;
}

// #[tracing::instrument(level = "trace", skip(tcx, body))]
// rustc: compiler/rustc_mir_transform/src/coroutine/drop.rs:85 elaborate_coroutine_drops
export function elaborate_coroutine_drops(tcx: TyCtxt, body: Body): void {
  // use crate::elaborate_drop::{Unwind, elaborate_drop};
  // use crate::patch::MirPatch;
  // use crate::shim::DropShimElaborator;

  // Note that `elaborate_drops` only drops the upvars of a coroutine, and
  // this is ok because `open_drop` can only be reached within that own
  // coroutine's resume function.
  const typing_env = body.typing_env(tcx);

  const elaborator: DropShimElaborator = {
    body,
    patch: MirPatch.new(body),
    tcx,
    typing_env,
    // FIXME(async_drop): Drops, produced by insert_clean_drop + elaborate_coroutine_drops, are
    // currently sync only. To allow async for them, flip this flag and fix the related
    // problems.
    produce_async_drops: false,
  };

  const blocks = body.basic_blocks.deref();
  for (let i = 0; i < blocks.length; i++) {
    const block = i as BasicBlock;
    const block_data = blocks[i]!;
    const term = block_data.terminator_();
    if (term.kind.$ !== "Drop") continue;
    const { place, target, unwind: unwind_, drop } = term.kind;
    const source_info = term.source_info;
    const local = place.as_local();
    if (!(local !== undefined && local === SELF_ARG)) {
      continue;
    }
    const dropline = drop;
    let unwind: Unwind;
    if (block_data.is_cleanup) {
      unwind = Unwind.InCleanup;
    } else {
      let tgt: BasicBlock;
      switch (unwind_.$) {
        case "Cleanup":
          tgt = unwind_._0;
          break;
        case "Continue":
          tgt = elaborator.patch.resume_block_();
          break;
        case "Unreachable":
          tgt = elaborator.patch.unreachable_cleanup_block_();
          break;
        case "Terminate":
          tgt = elaborator.patch.terminate_block_(unwind_._0);
          break;
      }
      unwind = { $: "To", _0: tgt };
    }
    elaborate_drop(elaborator, clone_SourceInfo(source_info), Place_from_Local(SELF_ARG), null, target, unwind, block, dropline);
  }
  elaborator.patch.apply(body);
}

// #[tracing::instrument(level = "trace", skip(tcx, body), ret)]
// rustc: compiler/rustc_mir_transform/src/coroutine/drop.rs:148 insert_clean_drop
export function insert_clean_drop(tcx: TyCtxt, body: Body, has_async_drops: boolean): BasicBlock {
  const return_block = has_async_drops
    ? insert_poll_ready_block(tcx, body)
    : insert_term_block(body, TerminatorKind.Return);

  // FIXME: When move insert_clean_drop + elaborate_coroutine_drops before async drops expand,
  // also set dropline here:
  // let dropline = if has_async_drops { Some(return_block) } else { None };
  const dropline: BasicBlock | undefined = undefined;

  const term: TerminatorKind = {
    $: "Drop",
    place: Place_from_Local(SELF_ARG),
    target: return_block,
    unwind: UnwindAction.Continue,
    replace: false,
    drop: dropline,
  };

  // Create a block to destroy an unresumed coroutines. This can only destroy upvars.
  return insert_term_block(body, term);
}

// #[tracing::instrument(level = "trace", skip(tcx, transform, body))]
// rustc: compiler/rustc_mir_transform/src/coroutine/drop.rs:177 create_coroutine_drop_shim
export function create_coroutine_drop_shim(
  tcx: TyCtxt,
  transform: TransformVisitor,
  coroutine_ty: Ty,
  body_: Body,
  drop_clean: BasicBlock,
): Body {
  const body = clone_Body(body_);
  // Take the coroutine info out of the body, since the drop shim is
  // not a coroutine body itself; it just has its drop built out of it.
  body.coroutine = undefined;
  // Make sure the resume argument is not included here, since we're
  // building a body for `drop_glue`.
  body.arg_count = 1;

  const source_info = SourceInfo.outermost(body.span);

  const cases = create_cases(body, transform, Operation.Drop);

  cases.splice(0, 0, [CoroutineArgsExt.UNRESUMED, drop_clean]);

  // The returned state and the poisoned state fall through to the default
  // case which is just to return

  const default_block = insert_term_block(body, TerminatorKind.Return);
  insert_switch(body, cases, transform, default_block);

  for (const block of body.basic_blocks_mut()) {
    const terminator = block.terminator_mut();
    if (terminator.kind.$ === "CoroutineDrop") {
      terminator.kind = TerminatorKind.Return;
    }
  }

  // Replace the return variable
  body.local_decls[RETURN_PLACE] = LocalDecl.with_source_info(tcx.types.unit, source_info);

  make_coroutine_state_argument_indirect(tcx, body);

  // Make sure we remove dead blocks to remove
  // unrelated code from the resume part of the function
  simplify.remove_dead_blocks(body);

  // Run derefer to fix Derefs that are not in the first place
  deref_finder(tcx, body, false);

  // Update the body's def to become the drop glue.
  const coroutine_instance = body.source.instance;
  const drop_glue = tcx.require_lang_item(LangItem.DropGlue, body.span);
  const drop_instance: InstanceKind = { $: "Shim", _0: { $: "DropGlue", _0: drop_glue, _1: coroutine_ty } };

  // Temporary change MirSource to coroutine's instance so that dump_mir produces more sensible
  // filename.
  body.source.instance = coroutine_instance;
  const dumper = MirDumper.new(tcx, "coroutine_drop", body);
  if (dumper !== undefined) {
    dumper.dump_mir(body);
  }
  body.source.instance = drop_instance;

  // Creating a coroutine drop shim happens on `Analysis(PostCleanup) -> Runtime(Initial)`
  // but the pass manager doesn't update the phase of the coroutine drop shim. Update the
  // phase of the drop shim so that later on when we run the pass manager on the shim, in
  // the `mir_shims` query, we don't ICE on the intra-pass validation before we've updated
  // the phase of the body from analysis.
  body.phase = { $: "Runtime", _0: "Initial" };

  return body;
}

// Create async drop shim function to drop coroutine itself
// #[tracing::instrument(level = "trace", skip(tcx, transform, body))]
// rustc: compiler/rustc_mir_transform/src/coroutine/drop.rs:248 create_coroutine_drop_shim_async
export function create_coroutine_drop_shim_async(
  tcx: TyCtxt,
  transform: TransformVisitor,
  body_: Body,
  drop_clean: BasicBlock,
  can_unwind: boolean,
): Body {
  const body = clone_Body(body_);
  // Take the coroutine info out of the body, since the drop shim is
  // not a coroutine body itself; it just has its drop built out of it.
  body.coroutine = undefined;

  new FixReturnPendingVisitor(tcx).visit_body(body);

  // Poison the coroutine when it unwinds
  if (can_unwind) {
    generate_poison_block_and_redirect_unwinds_there(transform, body);
  }

  const source_info = SourceInfo.outermost(body.span);

  const cases = create_cases(body, transform, Operation.AsyncDrop);

  cases.splice(0, 0, [CoroutineArgsExt.UNRESUMED, drop_clean]);

  // use rustc_middle::mir::AssertKind::ResumedAfterPanic;
  // Panic when resumed on the returned or poisoned state
  if (can_unwind) {
    cases.splice(1, 0, [
      CoroutineArgsExt.POISONED,
      insert_panic_block(tcx, body, { $: "ResumedAfterPanic", _0: transform.coroutine_kind }),
    ]);
  }

  // RETURNED state also goes to default_block with `return Ready<()>`.
  // For fully-polled coroutine, async drop has nothing to do.
  const default_block = insert_poll_ready_block(tcx, body);
  insert_switch(body, cases, transform, default_block);

  for (const block of body.basic_blocks_mut()) {
    const terminator = block.terminator_mut();
    if (terminator.kind.$ === "CoroutineDrop") {
      terminator.kind = TerminatorKind.Return;
      block.statements.push(return_poll_ready_assign(tcx, clone_SourceInfo(source_info)));
    }
  }

  // Replace the return variable: Poll<RetT> to Poll<()>
  const poll_adt_ref = tcx.adt_def(tcx.require_lang_item(LangItem.Poll, body.span)) as AdtDef;
  const poll_enum = Ty.new_adt(tcx, poll_adt_ref, tcx.mk_args([GenericArg.from_Ty(tcx.types.unit)]));
  body.local_decls[RETURN_PLACE] = LocalDecl.with_source_info(poll_enum, source_info);

  const ck = transform.coroutine_kind;
  if (ck.$ === "Desugared" && ck._0 === "Gen") {
    // Iterator::next doesn't accept a pinned argument,
    // unlike for all other coroutine kinds.
    make_coroutine_state_argument_indirect(tcx, body);
  } else {
    make_coroutine_state_argument_pinned(tcx, body);
  }

  // Make sure we remove dead blocks to remove
  // unrelated code from the resume part of the function
  simplify.remove_dead_blocks(body);

  pm.run_passes_no_validate(tcx, body, [new abort_unwinding_calls.AbortUnwindingCalls()], undefined);

  // Run derefer to fix Derefs that are not in the first place
  deref_finder(tcx, body, false);

  if (CoroutineKindC.is_async_desugaring(transform.coroutine_kind)) {
    transform_async_context(tcx, body);
  }

  const dumper = MirDumper.new(tcx, "coroutine_drop_async", body);
  if (dumper !== undefined) {
    dumper.dump_mir(body);
  }

  return body;
}

// Create async drop shim proxy function for future_drop_poll
// It is just { call coroutine_drop(); return Poll::Ready(); }
// rustc: compiler/rustc_mir_transform/src/coroutine/drop.rs:342 create_coroutine_drop_shim_proxy_async
export function create_coroutine_drop_shim_proxy_async(tcx: TyCtxt, body_: Body, coroutine_kind: CoroutineKind): Body {
  const body = clone_Body(body_);
  // Take the coroutine info out of the body, since the drop shim is
  // not a coroutine body itself; it just has its drop built out of it.
  body.coroutine = undefined;
  const basic_blocks: BasicBlockData[] = [];
  body.basic_blocks = BasicBlocks.new(basic_blocks);
  body.var_debug_info.length = 0;

  // Keeping return value and args
  body.local_decls.length = Math.min(body.local_decls.length, 1 + body.arg_count);

  const source_info = SourceInfo.outermost(body.span);

  // Replace the return variable: Poll<RetT> to Poll<()>
  const poll_adt_ref = tcx.adt_def(tcx.require_lang_item(LangItem.Poll, body.span)) as AdtDef;
  const poll_enum = Ty.new_adt(tcx, poll_adt_ref, tcx.mk_args([GenericArg.from_Ty(tcx.types.unit)]));
  body.local_decls[RETURN_PLACE] = LocalDecl.with_source_info(poll_enum, source_info);

  // call coroutine_drop()
  const bbs = body.basic_blocks_mut();
  const call_bb = bbs.length as BasicBlock;
  bbs.push(BasicBlockData.new(undefined, false));

  // return Poll::Ready()
  const ret_bb = insert_poll_ready_block(tcx, body);

  const kind: TerminatorKind = {
    $: "Drop",
    place: Place_from_Local(SELF_ARG),
    target: ret_bb,
    unwind: UnwindAction.Continue,
    replace: false,
    drop: undefined,
  };
  body.basic_blocks_mut()[call_bb]!.terminator = new Terminator(clone_SourceInfo(source_info), kind);

  // Run derefer to fix Derefs that are not in the first place
  deref_finder(tcx, body, false);

  if (CoroutineKindC.is_async_desugaring(coroutine_kind)) {
    transform_async_context(tcx, body);
  }

  const dumper = MirDumper.new(tcx, "coroutine_drop_proxy_async", body);
  if (dumper !== undefined) {
    dumper.dump_mir(body);
  }

  return body;
}

// ---- PORT stand-ins for items of other files that are not ported yet ----------------------------------------------
// Not markers. Each calls `unported`; the owning lanes repoint them at the real ports (see the header).

/** PORT: stand-in for `TransformVisitor` (coroutine/mod.rs:177, lane mt-coroutine-a): the one field read here. */
interface TransformVisitor {
  readonly coroutine_kind: CoroutineKind;
}

/** PORT: stand-in for `Operation` (coroutine/mod.rs:934, lane mt-coroutine-a). */
type Operation = "Resume" | "Drop" | "AsyncDrop";
const Operation = { Resume: "Resume", Drop: "Drop", AsyncDrop: "AsyncDrop" } as const;

/** PORT: stand-in for `create_cases` (coroutine/mod.rs:957, lane mt-coroutine-a). */
function create_cases(_body: Body, _transform: TransformVisitor, _operation: Operation): [number, BasicBlock][] {
  return unported("rustc_mir_transform::coroutine::create_cases (lane mt-coroutine-a)");
}
/** PORT: stand-in for `insert_switch` (coroutine/mod.rs:706, lane mt-coroutine-a). */
function insert_switch(_body: Body, _cases: [number, BasicBlock][], _transform: TransformVisitor, _default_block: BasicBlock): void {
  return unported("rustc_mir_transform::coroutine::insert_switch (lane mt-coroutine-a)");
}
/** PORT: stand-in for `insert_term_block` (coroutine/mod.rs:743, lane mt-coroutine-a). */
function insert_term_block(_body: Body, _kind: TerminatorKind): BasicBlock {
  return unported("rustc_mir_transform::coroutine::insert_term_block (lane mt-coroutine-a)");
}
/** PORT: stand-in for `return_poll_ready_assign` (coroutine/mod.rs:748, lane mt-coroutine-a). */
function return_poll_ready_assign(_tcx: TyCtxt, _source_info: SourceInfo): Statement {
  return unported("rustc_mir_transform::coroutine::return_poll_ready_assign (lane mt-coroutine-a)");
}
/** PORT: stand-in for `insert_poll_ready_block` (coroutine/mod.rs:764, lane mt-coroutine-a). */
function insert_poll_ready_block(_tcx: TyCtxt, _body: Body): BasicBlock {
  return unported("rustc_mir_transform::coroutine::insert_poll_ready_block (lane mt-coroutine-a)");
}
/** PORT: stand-in for `insert_panic_block` (coroutine/mod.rs:773, lane mt-coroutine-a). */
function insert_panic_block(_tcx: TyCtxt, _body: Body, _message: AssertKind<Operand>): BasicBlock {
  return unported("rustc_mir_transform::coroutine::insert_panic_block (lane mt-coroutine-a)");
}
/** PORT: stand-in for `make_coroutine_state_argument_indirect` (coroutine/mod.rs:551, lane mt-coroutine-a). */
function make_coroutine_state_argument_indirect(_tcx: TyCtxt, _body: Body): void {
  return unported("rustc_mir_transform::coroutine::make_coroutine_state_argument_indirect (lane mt-coroutine-a)");
}
/** PORT: stand-in for `make_coroutine_state_argument_pinned` (coroutine/mod.rs:564, lane mt-coroutine-a). */
function make_coroutine_state_argument_pinned(_tcx: TyCtxt, _body: Body): void {
  return unported("rustc_mir_transform::coroutine::make_coroutine_state_argument_pinned (lane mt-coroutine-a)");
}
/** PORT: stand-in for `transform_async_context` (coroutine/mod.rs:616, lane mt-coroutine-a). */
function transform_async_context(_tcx: TyCtxt, _body: Body): void {
  return unported("rustc_mir_transform::coroutine::transform_async_context (lane mt-coroutine-a)");
}
/** PORT: stand-in for `generate_poison_block_and_redirect_unwinds_there` (coroutine/mod.rs:816, lane mt-coroutine-a). */
function generate_poison_block_and_redirect_unwinds_there(_transform: TransformVisitor, _body: Body): void {
  return unported("rustc_mir_transform::coroutine::generate_poison_block_and_redirect_unwinds_there (lane mt-coroutine-a)");
}


/** PORT: stand-in for `shim::DropShimElaborator` (shim.rs, lane mt-shim): its fields, as built here. */
interface DropShimElaborator {
  body: Body;
  patch: MirPatch;
  tcx: TyCtxt;
  typing_env: TypingEnv;
  produce_async_drops: boolean;
}

/** PORT: stand-in for `elaborate_drop::Unwind` (elaborate_drop.rs, lane mt-drops). */
type Unwind = { readonly $: "To"; _0: BasicBlock } | { readonly $: "InCleanup" };
const Unwind = { InCleanup: Object.freeze({ $: "InCleanup" as const }) };

/** PORT: stand-in for `elaborate_drop::elaborate_drop` (elaborate_drop.rs, lane mt-drops); `path` is `()` (`null`). */
function elaborate_drop(
  _elaborator: DropShimElaborator,
  _source_info: SourceInfo,
  _place: Place,
  _path: null,
  _succ: BasicBlock,
  _unwind: Unwind,
  _bb: BasicBlock,
  _dropline: BasicBlock | undefined,
): void {
  return unported("rustc_mir_transform::elaborate_drop::elaborate_drop (lane mt-drops)");
}
