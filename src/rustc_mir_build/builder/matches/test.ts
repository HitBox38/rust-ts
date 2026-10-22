// Port of compiler/rustc_mir_build/src/builder/matches/test.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// mb-matches-c; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type Mutability } from "../../../rustc_ast_ir/lib.ts";
import { type BasicBlock, type BinOp, type Const, type Operand, type Place, type SourceInfo } from "../../../rustc_middle/mir/mod.ts";
import { type TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { type GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import { type Ty } from "../../../rustc_middle/ty/mod.ts";
import { type MatchPairTree, type Test } from "./mod.gen.ts";
import { type TestBranch } from "./mod.ts";
import { Builder } from "../mod.ts";
import { type DefId } from "../../../rustc_span/def_id.ts";
import { type Span } from "../../../rustc_span/lib.ts";
import { type Symbol } from "../../../rustc_span/symbol.ts";
import { unported } from "../../../std/panic.ts";

declare module "../mod.ts" {
  interface Builder {
    // test.rs:30 (lane mb-matches-c)
    pick_test_for_match_pair(match_pair: MatchPairTree): Test;
    // test.rs:66 (lane mb-matches-c)
    perform_test(match_start_span: Span, scrutinee_span: Span, block: BasicBlock, otherwise_block: BasicBlock, place: Place, test: Test, target_blocks: Map<TestBranch, BasicBlock>): void;
    // test.rs:335 (lane mb-matches-c)
    call_deref(block: BasicBlock, target_block: BasicBlock, place: Place, mutability: Mutability, ty: Ty, temp: Place, span: Span): void;
    // test.rs:385 (lane mb-matches-c)
    compare(block: BasicBlock, success_block: BasicBlock, fail_block: BasicBlock, source_info: SourceInfo, op: BinOp, left: Operand, right: Operand): void;
    // test.rs:415 (lane mb-matches-c)
    string_compare(block: BasicBlock, success_block: BasicBlock, fail_block: BasicBlock, source_info: SourceInfo, expect: Operand, val: Operand): void;
  }
}

// stub: compiler/rustc_mir_build/src/builder/matches/test.rs:30 pick_test_for_match_pair (lane mb-matches-c)
Builder.prototype.pick_test_for_match_pair = function (this: Builder, match_pair: MatchPairTree): Test {
  return unported("rustc_mir_build::builder::matches::test::Builder::pick_test_for_match_pair");
};

// stub: compiler/rustc_mir_build/src/builder/matches/test.rs:66 perform_test (lane mb-matches-c)
Builder.prototype.perform_test = function (this: Builder, match_start_span: Span, scrutinee_span: Span, block: BasicBlock, otherwise_block: BasicBlock, place: Place, test: Test, target_blocks: Map<TestBranch, BasicBlock>): void {
  return unported("rustc_mir_build::builder::matches::test::Builder::perform_test");
};

// stub: compiler/rustc_mir_build/src/builder/matches/test.rs:335 call_deref (lane mb-matches-c)
Builder.prototype.call_deref = function (this: Builder, block: BasicBlock, target_block: BasicBlock, place: Place, mutability: Mutability, ty: Ty, temp: Place, span: Span): void {
  return unported("rustc_mir_build::builder::matches::test::Builder::call_deref");
};

// stub: compiler/rustc_mir_build/src/builder/matches/test.rs:385 compare (lane mb-matches-c)
Builder.prototype.compare = function (this: Builder, block: BasicBlock, success_block: BasicBlock, fail_block: BasicBlock, source_info: SourceInfo, op: BinOp, left: Operand, right: Operand): void {
  return unported("rustc_mir_build::builder::matches::test::Builder::compare");
};

// stub: compiler/rustc_mir_build/src/builder/matches/test.rs:415 string_compare (lane mb-matches-c)
Builder.prototype.string_compare = function (this: Builder, block: BasicBlock, success_block: BasicBlock, fail_block: BasicBlock, source_info: SourceInfo, expect: Operand, val: Operand): void {
  return unported("rustc_mir_build::builder::matches::test::Builder::string_compare");
};

// stub: compiler/rustc_mir_build/src/builder/matches/test.rs:469 trait_method (lane mb-matches-c)
export function trait_method(tcx: TyCtxt, trait_def_id: DefId, method_name: Symbol, args: readonly GenericArg[]): Const {
  return unported("rustc_mir_build::builder::matches::test::trait_method");
}
