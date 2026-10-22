// Port of compiler/rustc_mir_build/src/builder/cfg.rs (lane builder-contract): `impl CFG` (the generated class of
// mod.gen.ts) is put on its prototype here (PORTING §5 "Methods defined in another file"; builder/mod.ts header).
//! Routines for manipulating the control-flow graph.
import type { UnrollAttr } from "../../rustc_attr_ir/lib.ts";
import {
  type BasicBlock,
  BasicBlockData,
  Const,
  ConstOperand,
  type FakeReadCause,
  type Place,
  type Rvalue,
  type SourceInfo,
  Statement,
  type StatementKind,
  Terminator,
  type TerminatorKind,
} from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { CFG } from "./mod.ts";

declare module "./mod.gen.ts" {
  interface CFG {
    block_data(blk: BasicBlock): BasicBlockData;
    block_data_mut(blk: BasicBlock): BasicBlockData;
    start_new_block(): BasicBlock;
    start_new_cleanup_block(): BasicBlock;
    push(block: BasicBlock, statement: Statement): void;
    push_assign(block: BasicBlock, source_info: SourceInfo, place: Place, rvalue: Rvalue): void;
    push_assign_constant(block: BasicBlock, source_info: SourceInfo, temp: Place, constant: ConstOperand): void;
    push_assign_unit(block: BasicBlock, source_info: SourceInfo, place: Place, tcx: TyCtxt): void;
    push_fake_read(block: BasicBlock, source_info: SourceInfo, cause: FakeReadCause, place: Place): void;
    push_place_mention(block: BasicBlock, source_info: SourceInfo, place: Place): void;
    terminate(block: BasicBlock, source_info: SourceInfo, kind: TerminatorKind): Terminator;
    goto(origin: BasicBlock, source_info: SourceInfo, target: BasicBlock): Terminator;
    goto_with_hints(origin: BasicBlock, source_info: SourceInfo, target: BasicBlock, loop_hint_attrs: UnrollAttr[]): Terminator;
  }
}

// rustc: compiler/rustc_mir_build/src/builder/cfg.rs:12 block_data
CFG.prototype.block_data = function (this: CFG, blk: BasicBlock): BasicBlockData {
  return this.basic_blocks[blk]!;
};

// rustc: compiler/rustc_mir_build/src/builder/cfg.rs:16 block_data_mut
CFG.prototype.block_data_mut = function (this: CFG, blk: BasicBlock): BasicBlockData {
  return this.basic_blocks[blk]!;
};

// llvm.org/PR32488 makes this function use an excess of stack space. Mark
// it as #[inline(never)] to keep rustc's stack use in check.
// #[inline(never)]
// rustc: compiler/rustc_mir_build/src/builder/cfg.rs:23 start_new_block
CFG.prototype.start_new_block = function (this: CFG): BasicBlock {
  // `IndexVec::push` returns the index of the new element.
  this.basic_blocks.push(BasicBlockData.new(undefined, false));
  return (this.basic_blocks.length - 1) as BasicBlock;
};

// rustc: compiler/rustc_mir_build/src/builder/cfg.rs:27 start_new_cleanup_block
CFG.prototype.start_new_cleanup_block = function (this: CFG): BasicBlock {
  const bb = this.start_new_block();
  this.block_data_mut(bb).is_cleanup = true;
  return bb;
};

// rustc: compiler/rustc_mir_build/src/builder/cfg.rs:33 push
CFG.prototype.push = function (this: CFG, block: BasicBlock, statement: Statement): void {
  // debug!("push({:?}, {:?})", block, statement);
  this.block_data_mut(block).statements.push(statement);
};

// rustc: compiler/rustc_mir_build/src/builder/cfg.rs:38 push_assign
CFG.prototype.push_assign = function (this: CFG, block: BasicBlock, source_info: SourceInfo, place: Place, rvalue: Rvalue): void {
  const kind: StatementKind = { $: "Assign", _0: [place, rvalue] };
  this.push(block, Statement.new(source_info, kind));
};

// rustc: compiler/rustc_mir_build/src/builder/cfg.rs:51 push_assign_constant
CFG.prototype.push_assign_constant = function (this: CFG, block: BasicBlock, source_info: SourceInfo, temp: Place, constant: ConstOperand): void {
  this.push_assign(block, source_info, temp, { $: "Use", _0: { $: "Constant", _0: constant }, _1: "Yes" });
};

// rustc: compiler/rustc_mir_build/src/builder/cfg.rs:66 push_assign_unit
CFG.prototype.push_assign_unit = function (this: CFG, block: BasicBlock, source_info: SourceInfo, place: Place, tcx: TyCtxt): void {
  this.push_assign(block, source_info, place, {
    $: "Use",
    _0: { $: "Constant", _0: new ConstOperand(source_info.span, undefined, Const.zero_sized(tcx.types.unit)) },
    _1: "Yes",
  });
};

// rustc: compiler/rustc_mir_build/src/builder/cfg.rs:88 push_fake_read
CFG.prototype.push_fake_read = function (this: CFG, block: BasicBlock, source_info: SourceInfo, cause: FakeReadCause, place: Place): void {
  const kind: StatementKind = { $: "FakeRead", _0: [cause, place] };
  const stmt = Statement.new(source_info, kind);
  this.push(block, stmt);
};

// rustc: compiler/rustc_mir_build/src/builder/cfg.rs:100 push_place_mention
CFG.prototype.push_place_mention = function (this: CFG, block: BasicBlock, source_info: SourceInfo, place: Place): void {
  const kind: StatementKind = { $: "PlaceMention", _0: place };
  const stmt = Statement.new(source_info, kind);
  this.push(block, stmt);
};

// rustc: compiler/rustc_mir_build/src/builder/cfg.rs:111 terminate
CFG.prototype.terminate = function (this: CFG, block: BasicBlock, source_info: SourceInfo, kind: TerminatorKind): Terminator {
  // debug!("terminating block {:?} <- {:?}", block, kind);
  // debug_assert!(
  //     self.block_data(block).terminator.is_none(),
  //     "terminate: block {:?}={:?} already has a terminator set",
  //     block,
  //     self.block_data(block)
  // );
  this.block_data_mut(block).terminator = new Terminator(source_info, kind);
  return this.block_data_mut(block).terminator!;
};

/// In the `origin` block, push a `goto -> target` terminator.
// rustc: compiler/rustc_mir_build/src/builder/cfg.rs:129 goto
CFG.prototype.goto = function (this: CFG, origin: BasicBlock, source_info: SourceInfo, target: BasicBlock): Terminator {
  return this.goto_with_hints(origin, source_info, target, []);
};

// #[inline(always)]
// rustc: compiler/rustc_mir_build/src/builder/cfg.rs:139 goto_with_hints
CFG.prototype.goto_with_hints = function (this: CFG, origin: BasicBlock, source_info: SourceInfo, target: BasicBlock, loop_hint_attrs: UnrollAttr[]): Terminator {
  return this.terminate(origin, source_info, { $: "Goto", target, loop_hint_attrs });
};
