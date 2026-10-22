// Port of compiler/rustc_mir_build/src/builder/misc.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// mb-mod; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type BasicBlock, type Const, type Operand, type Place, type SourceInfo } from "../../rustc_middle/mir/mod.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { Builder } from "./mod.ts";
import { type Span } from "../../rustc_span/lib.ts";
import { unported } from "../../std/panic.ts";

declare module "./mod.ts" {
  interface Builder {
    // misc.rs:18 (lane mb-mod)
    temp(ty: Ty, span: Span): Place;
    // misc.rs:27 (lane mb-mod)
    literal_operand(span: Span, const_: Const): Operand;
    // misc.rs:34 (lane mb-mod)
    zero_literal(span: Span, ty: Ty): Operand;
    // misc.rs:40 (lane mb-mod)
    push_usize(block: BasicBlock, source_info: SourceInfo, value: number): Place;
    // misc.rs:61 (lane mb-mod)
    consume_by_copy_or_move(place: Place): Operand;
  }
}

// stub: compiler/rustc_mir_build/src/builder/misc.rs:18 temp (lane mb-mod)
Builder.prototype.temp = function (this: Builder, ty: Ty, span: Span): Place {
  return unported("rustc_mir_build::builder::misc::Builder::temp");
};

// stub: compiler/rustc_mir_build/src/builder/misc.rs:27 literal_operand (lane mb-mod)
Builder.prototype.literal_operand = function (this: Builder, span: Span, const_: Const): Operand {
  return unported("rustc_mir_build::builder::misc::Builder::literal_operand");
};

// stub: compiler/rustc_mir_build/src/builder/misc.rs:34 zero_literal (lane mb-mod)
Builder.prototype.zero_literal = function (this: Builder, span: Span, ty: Ty): Operand {
  return unported("rustc_mir_build::builder::misc::Builder::zero_literal");
};

// stub: compiler/rustc_mir_build/src/builder/misc.rs:40 push_usize (lane mb-mod)
Builder.prototype.push_usize = function (this: Builder, block: BasicBlock, source_info: SourceInfo, value: number): Place {
  return unported("rustc_mir_build::builder::misc::Builder::push_usize");
};

// stub: compiler/rustc_mir_build/src/builder/misc.rs:61 consume_by_copy_or_move (lane mb-mod)
Builder.prototype.consume_by_copy_or_move = function (this: Builder, place: Place): Operand {
  return unported("rustc_mir_build::builder::misc::Builder::consume_by_copy_or_move");
};
