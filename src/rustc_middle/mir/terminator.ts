// Port of compiler/rustc_middle/src/mir/terminator.rs (lane mir-contract, plan-m4 D3). `Terminator`, `TerminatorEdges`
// and `CallReturnPlaces` are generated (terminator.gen.ts, set rustc_middle_mir); `SwitchTargetsIter` and the
// `helper::Successors` iterator are hand classes below. This module declares (and stubs, for lane mir-body-b) the file's
// fns: methods of `Terminator`, of syntax.rs's class `SwitchTargets` (prototype) and of syntax.rs's enums (companions in
// syntax.ts). docs/handoff/mir-contract.md has the conventions ("How to fill a stub").
// PORT: `&mut BasicBlock` / `&mut UnwindAction` handed to callers are `MutRef`s (PORTING §8; D4): `successors_mut(f)`
// calls `f` with a `MutRef<BasicBlock>` whose writes go back into the terminator, `unwind_mut()` returns one.
// PORT: `W: fmt::Write` is vendor/anstream's `FmtWrite` (the `std::fmt::Write` port) and `fmt::Result` its `FmtResult`.
// PORT: `Iterator` impls are JS iterators (`next()` returns an `IteratorResult`; precedent rustc_data_structures
// graph/iterate `DepthFirstSearch`).
//! Functionality for terminators and helper types that appear in terminators.
import "./mod.ts";
import type { InlineAsmOptions } from "../../rustc_ast/lib.ts";
import type { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type { Debug } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { unported } from "../../std/panic.ts";
import type { FmtResult, FmtWrite } from "../../vendor/anstream/stream.ts";
import type { BasicBlock, Place } from "./mod.ts";
import {
  AssertKind,
  CallSource,
  InlineAsmMacro,
  type Operand,
  SwitchTargets,
  TerminatorKind,
  UnwindAction,
  UnwindTerminateReason,
} from "./syntax.ts";
import { type CallReturnPlaces as gen_CallReturnPlaces, Terminator, type TerminatorEdges } from "./terminator.gen.ts";
export * from "./terminator.gen.ts";

/** pretty.ts (`impl Debug for Terminator` lives in pretty.rs), read lazily (init order). */
function mir_pretty(): typeof import("./pretty.ts") {
  return (mir_pretty__m ??= require("./pretty.ts") as typeof import("./pretty.ts"));
}
var mir_pretty__m: typeof import("./pretty.ts") | undefined;
/** `impl Debug for Terminator` (pretty.rs:981). */
export const debug_Terminator: Debug<Terminator> = (v, f) => mir_pretty().debug_Terminator(v, f);

/**
 * `SwitchTargetsIter<'a> { inner: iter::Zip<slice::Iter<'a, Pu128>, slice::Iter<'a, BasicBlock>> }`.
 * PORT: the `Zip` of the two slice iterators is the two slices (`values`, `targets`) and the position `index`.
 */
// rustc-type: compiler/rustc_middle/src/mir/terminator.rs:110 SwitchTargetsIter
export class SwitchTargetsIter implements IterableIterator<[bigint, BasicBlock]> {
  constructor(
    public values: readonly bigint[],
    public targets: readonly BasicBlock[],
    public index: number,
  ) {}

  [Symbol.iterator](): this {
    return this;
  }

  // impl<'a> Iterator for SwitchTargetsIter<'a>
  // stub: compiler/rustc_middle/src/mir/terminator.rs:118 next (lane mir-body-b)
  next(): IteratorResult<[bigint, BasicBlock]> {
    return unported("rustc_middle::mir::terminator::<SwitchTargetsIter as Iterator>::next");
  }

  // stub: compiler/rustc_middle/src/mir/terminator.rs:123 size_hint (lane mir-body-b)
  size_hint(): [number, number | undefined] {
    return unported("rustc_middle::mir::terminator::<SwitchTargetsIter as Iterator>::size_hint");
  }
}

/**
 * `helper::Successors<'a> = impl DoubleEndedIterator<Item = BasicBlock> + 'a` (terminator.rs:491).
 * PORT: the chain `mk_successors` builds (`slice.iter().copied().chain(option1).chain(option2)`) as the array of its items
 * with a front and a back cursor: a JS iterator (`next()` / `for..of`) that is also double-ended (`next_back()`, `rev()`)
 * and exact-size (`len()`). Contract glue, not an upstream fn.
 */
// rustc-type: compiler/rustc_middle/src/mir/terminator.rs:491 Successors
export class Successors implements IterableIterator<BasicBlock> {
  private front = 0;
  private back: number;
  constructor(readonly items: readonly BasicBlock[]) {
    this.back = items.length;
  }
  [Symbol.iterator](): this {
    return this;
  }
  next(): IteratorResult<BasicBlock> {
    return this.front < this.back ? { done: false, value: this.items[this.front++]! } : { done: true, value: undefined };
  }
  next_back(): IteratorResult<BasicBlock> {
    return this.front < this.back ? { done: false, value: this.items[--this.back]! } : { done: true, value: undefined };
  }
  /** `ExactSizeIterator::len` */
  len(): number {
    return this.back - this.front;
  }
  /** `DoubleEndedIterator::rev`, collected. */
  rev(): BasicBlock[] {
    const out: BasicBlock[] = [];
    for (let r = this.next_back(); !r.done; r = this.next_back()) out.push(r.value);
    return out;
  }
}

export interface CallReturnPlaces_methods {
  // terminator.rs:718 (lane mir-body-b)
  for_each(self: CallReturnPlaces, f: (place: Place) => void): void;
}
export type CallReturnPlaces = gen_CallReturnPlaces;
export const CallReturnPlaces = {} as CallReturnPlaces_methods;

declare module "./syntax.gen.ts" {
  namespace SwitchTargets {
    // terminator.rs:20 (lane mir-body-b)
    function new_(targets: Iterable<[bigint, BasicBlock]>, otherwise: BasicBlock): SwitchTargets;
    export { new_ as new };
    // terminator.rs:29 (lane mir-body-b)
    export function static_if(value: bigint, then: BasicBlock, else_: BasicBlock): SwitchTargets;
  }
}

declare module "./syntax.gen.ts" {
  interface SwitchTargets {
    // terminator.rs:35 (lane mir-body-b)
    as_static_if(): [bigint, BasicBlock, BasicBlock] | undefined;
    // terminator.rs:47 (lane mir-body-b)
    otherwise(): BasicBlock;
    // terminator.rs:58 (lane mir-body-b)
    iter(): SwitchTargetsIter;
    // terminator.rs:64 (lane mir-body-b)
    all_targets(): readonly BasicBlock[];
    // terminator.rs:69 (lane mir-body-b)
    all_targets_mut(): BasicBlock[];
    // terminator.rs:75 (lane mir-body-b)
    all_values(): readonly bigint[];
    // terminator.rs:80 (lane mir-body-b)
    all_values_mut(): bigint[];
    // terminator.rs:88 (lane mir-body-b)
    target_for_value(value: bigint): BasicBlock;
    // terminator.rs:94 (lane mir-body-b)
    add_target(value: bigint, bb: BasicBlock): void;
    // terminator.rs:105 (lane mir-body-b)
    is_distinct(): boolean;
    // terminator.rs:508 (lane mir-body-b)
    successors_for_value(value: bigint): Successors;
  }
}

declare module "./syntax.ts" {
  interface UnwindAction_methods {
    // terminator.rs:131 (lane mir-body-b)
    cleanup_block(self: UnwindAction): BasicBlock | undefined;
  }
}

declare module "./syntax.ts" {
  interface UnwindTerminateReason_methods {
    // terminator.rs:140 (lane mir-body-b)
    as_str(self: UnwindTerminateReason): string;
    // terminator.rs:149 (lane mir-body-b)
    as_short_str(self: UnwindTerminateReason): string;
    // terminator.rs:156 (lane mir-body-b)
    lang_item(self: UnwindTerminateReason): LangItem;
  }
}

declare module "./syntax.ts" {
  interface AssertKind_methods {
    // terminator.rs:166 (lane mir-body-b)
    is_optional_overflow_check<O>(self: AssertKind<O>): boolean;
    // terminator.rs:178 (lane mir-body-b)
    panic_function<O>(self: AssertKind<O>): LangItem;
    // terminator.rs:238 (lane mir-body-b)
    fmt_assert_args<O>(self: AssertKind<O>, f: FmtWrite, debug_O: Debug<O>): FmtResult;
  }
}

declare module "./terminator.gen.ts" {
  interface Terminator {
    // terminator.rs:425 (lane mir-body-b)
    successors(): Successors;
    // terminator.rs:431 (lane mir-body-b)
    identical_successor(): BasicBlock | undefined;
    // terminator.rs:438 (lane mir-body-b)
    successors_mut(f: (bb: MutRef<BasicBlock>) => void): void;
    // terminator.rs:443 (lane mir-body-b)
    unwind(): UnwindAction | undefined;
    // terminator.rs:448 (lane mir-body-b)
    unwind_mut(): MutRef<UnwindAction> | undefined;
    // terminator.rs:735 (lane mir-body-b)
    edges(): TerminatorEdges;
  }
}

declare module "./syntax.ts" {
  interface TerminatorKind_methods {
    // terminator.rs:456 (lane mir-body-b)
    name(self: TerminatorKind): string;
    // terminator.rs:477 (lane mir-body-b)
    if_(cond: Operand, t: BasicBlock, f: BasicBlock): TerminatorKind;
    // terminator.rs:482 (lane mir-body-b)
    goto(target: BasicBlock): TerminatorKind;
    // terminator.rs:516 (lane mir-body-b)
    successors(self: TerminatorKind): Successors;
    // terminator.rs:564 (lane mir-body-b)
    successors_mut(self: TerminatorKind, f: (bb: MutRef<BasicBlock>) => void): void;
    // terminator.rs:629 (lane mir-body-b)
    unwind(self: TerminatorKind): UnwindAction | undefined;
    // terminator.rs:650 (lane mir-body-b)
    unwind_mut(self: TerminatorKind): MutRef<UnwindAction> | undefined;
    // terminator.rs:671 (lane mir-body-b)
    as_switch(self: TerminatorKind): [Operand, SwitchTargets] | undefined;
    // terminator.rs:679 (lane mir-body-b)
    as_goto(self: TerminatorKind): BasicBlock | undefined;
    // terminator.rs:741 (lane mir-body-b)
    edges(self: TerminatorKind): TerminatorEdges;
  }
}


declare module "./syntax.ts" {
  interface CallSource_methods {
    // terminator.rs:804 (lane mir-body-b)
    from_hir_call(self: CallSource): boolean;
  }
}

declare module "./syntax.ts" {
  interface InlineAsmMacro_methods {
    // terminator.rs:810 (lane mir-body-b)
    diverges(self: InlineAsmMacro, options: InlineAsmOptions): boolean;
  }
}

// stub: compiler/rustc_middle/src/mir/terminator.rs:20 new (lane mir-body-b)
(SwitchTargets as unknown as { new: typeof SwitchTargets.new }).new = function (targets: Iterable<[bigint, BasicBlock]>, otherwise: BasicBlock): SwitchTargets {
  return unported("rustc_middle::mir::terminator::SwitchTargets::new");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:29 static_if (lane mir-body-b)
(SwitchTargets as unknown as { static_if: typeof SwitchTargets.static_if }).static_if = function (value: bigint, then: BasicBlock, else_: BasicBlock): SwitchTargets {
  return unported("rustc_middle::mir::terminator::SwitchTargets::static_if");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:35 as_static_if (lane mir-body-b)
SwitchTargets.prototype.as_static_if = function (this: SwitchTargets): [bigint, BasicBlock, BasicBlock] | undefined {
  return unported("rustc_middle::mir::terminator::SwitchTargets::as_static_if");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:47 otherwise (lane mir-body-b)
SwitchTargets.prototype.otherwise = function (this: SwitchTargets): BasicBlock {
  return unported("rustc_middle::mir::terminator::SwitchTargets::otherwise");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:58 iter (lane mir-body-b)
SwitchTargets.prototype.iter = function (this: SwitchTargets): SwitchTargetsIter {
  return unported("rustc_middle::mir::terminator::SwitchTargets::iter");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:64 all_targets (lane mir-body-b)
SwitchTargets.prototype.all_targets = function (this: SwitchTargets): readonly BasicBlock[] {
  return unported("rustc_middle::mir::terminator::SwitchTargets::all_targets");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:69 all_targets_mut (lane mir-body-b)
SwitchTargets.prototype.all_targets_mut = function (this: SwitchTargets): BasicBlock[] {
  return unported("rustc_middle::mir::terminator::SwitchTargets::all_targets_mut");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:75 all_values (lane mir-body-b)
SwitchTargets.prototype.all_values = function (this: SwitchTargets): readonly bigint[] {
  return unported("rustc_middle::mir::terminator::SwitchTargets::all_values");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:80 all_values_mut (lane mir-body-b)
SwitchTargets.prototype.all_values_mut = function (this: SwitchTargets): bigint[] {
  return unported("rustc_middle::mir::terminator::SwitchTargets::all_values_mut");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:88 target_for_value (lane mir-body-b)
SwitchTargets.prototype.target_for_value = function (this: SwitchTargets, value: bigint): BasicBlock {
  return unported("rustc_middle::mir::terminator::SwitchTargets::target_for_value");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:94 add_target (lane mir-body-b)
SwitchTargets.prototype.add_target = function (this: SwitchTargets, value: bigint, bb: BasicBlock): void {
  return unported("rustc_middle::mir::terminator::SwitchTargets::add_target");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:105 is_distinct (lane mir-body-b)
SwitchTargets.prototype.is_distinct = function (this: SwitchTargets): boolean {
  return unported("rustc_middle::mir::terminator::SwitchTargets::is_distinct");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:131 cleanup_block (lane mir-body-b)
UnwindAction.cleanup_block = function (self: UnwindAction): BasicBlock | undefined {
  return unported("rustc_middle::mir::terminator::UnwindAction::cleanup_block");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:140 as_str (lane mir-body-b)
UnwindTerminateReason.as_str = function (self: UnwindTerminateReason): string {
  return unported("rustc_middle::mir::terminator::UnwindTerminateReason::as_str");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:149 as_short_str (lane mir-body-b)
UnwindTerminateReason.as_short_str = function (self: UnwindTerminateReason): string {
  return unported("rustc_middle::mir::terminator::UnwindTerminateReason::as_short_str");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:156 lang_item (lane mir-body-b)
UnwindTerminateReason.lang_item = function (self: UnwindTerminateReason): LangItem {
  return unported("rustc_middle::mir::terminator::UnwindTerminateReason::lang_item");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:166 is_optional_overflow_check (lane mir-body-b)
AssertKind.is_optional_overflow_check = function <O>(self: AssertKind<O>): boolean {
  return unported("rustc_middle::mir::terminator::AssertKind::is_optional_overflow_check");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:178 panic_function (lane mir-body-b)
AssertKind.panic_function = function <O>(self: AssertKind<O>): LangItem {
  return unported("rustc_middle::mir::terminator::AssertKind::panic_function");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:238 fmt_assert_args (lane mir-body-b)
AssertKind.fmt_assert_args = function <O>(self: AssertKind<O>, f: FmtWrite, debug_O: Debug<O>): FmtResult {
  return unported("rustc_middle::mir::terminator::AssertKind::fmt_assert_args");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:342 fmt (lane mir-body-b)
export function display_AssertKind<O>(self: AssertKind<O>, debug_O: Debug<O>): string {
  return unported("rustc_middle::mir::terminator::<AssertKind as Display>::fmt");
}


// stub: compiler/rustc_middle/src/mir/terminator.rs:425 successors (lane mir-body-b)
Terminator.prototype.successors = function (this: Terminator): Successors {
  return unported("rustc_middle::mir::terminator::Terminator::successors");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:431 identical_successor (lane mir-body-b)
Terminator.prototype.identical_successor = function (this: Terminator): BasicBlock | undefined {
  return unported("rustc_middle::mir::terminator::Terminator::identical_successor");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:438 successors_mut (lane mir-body-b)
Terminator.prototype.successors_mut = function (this: Terminator, f: (bb: MutRef<BasicBlock>) => void): void {
  return unported("rustc_middle::mir::terminator::Terminator::successors_mut");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:443 unwind (lane mir-body-b)
Terminator.prototype.unwind = function (this: Terminator): UnwindAction | undefined {
  return unported("rustc_middle::mir::terminator::Terminator::unwind");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:448 unwind_mut (lane mir-body-b)
Terminator.prototype.unwind_mut = function (this: Terminator): MutRef<UnwindAction> | undefined {
  return unported("rustc_middle::mir::terminator::Terminator::unwind_mut");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:456 name (lane mir-body-b)
TerminatorKind.name = function (self: TerminatorKind): string {
  return unported("rustc_middle::mir::terminator::TerminatorKind::name");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:477 if_ (lane mir-body-b)
TerminatorKind.if_ = function (cond: Operand, t: BasicBlock, f: BasicBlock): TerminatorKind {
  return unported("rustc_middle::mir::terminator::TerminatorKind::if_");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:482 goto (lane mir-body-b)
TerminatorKind.goto = function (target: BasicBlock): TerminatorKind {
  return unported("rustc_middle::mir::terminator::TerminatorKind::goto");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:496 mk_successors (lane mir-body-b)
function mk_successors(slice: readonly BasicBlock[], option1: BasicBlock | undefined, option2: BasicBlock | undefined): Successors {
  return unported("rustc_middle::mir::terminator::mk_successors");
}


// stub: compiler/rustc_middle/src/mir/terminator.rs:508 successors_for_value (lane mir-body-b)
SwitchTargets.prototype.successors_for_value = function (this: SwitchTargets, value: bigint): Successors {
  return unported("rustc_middle::mir::terminator::SwitchTargets::successors_for_value");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:516 successors (lane mir-body-b)
TerminatorKind.successors = function (self: TerminatorKind): Successors {
  return unported("rustc_middle::mir::terminator::TerminatorKind::successors");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:564 successors_mut (lane mir-body-b)
TerminatorKind.successors_mut = function (self: TerminatorKind, f: (bb: MutRef<BasicBlock>) => void): void {
  return unported("rustc_middle::mir::terminator::TerminatorKind::successors_mut");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:629 unwind (lane mir-body-b)
TerminatorKind.unwind = function (self: TerminatorKind): UnwindAction | undefined {
  return unported("rustc_middle::mir::terminator::TerminatorKind::unwind");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:650 unwind_mut (lane mir-body-b)
TerminatorKind.unwind_mut = function (self: TerminatorKind): MutRef<UnwindAction> | undefined {
  return unported("rustc_middle::mir::terminator::TerminatorKind::unwind_mut");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:671 as_switch (lane mir-body-b)
TerminatorKind.as_switch = function (self: TerminatorKind): [Operand, SwitchTargets] | undefined {
  return unported("rustc_middle::mir::terminator::TerminatorKind::as_switch");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:679 as_goto (lane mir-body-b)
TerminatorKind.as_goto = function (self: TerminatorKind): BasicBlock | undefined {
  return unported("rustc_middle::mir::terminator::TerminatorKind::as_goto");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:718 for_each (lane mir-body-b)
CallReturnPlaces.for_each = function (self: CallReturnPlaces, f: (place: Place) => void): void {
  return unported("rustc_middle::mir::terminator::CallReturnPlaces::for_each");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:735 edges (lane mir-body-b)
Terminator.prototype.edges = function (this: Terminator): TerminatorEdges {
  return unported("rustc_middle::mir::terminator::Terminator::edges");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:741 edges (lane mir-body-b)
TerminatorKind.edges = function (self: TerminatorKind): TerminatorEdges {
  return unported("rustc_middle::mir::terminator::TerminatorKind::edges");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:804 from_hir_call (lane mir-body-b)
CallSource.from_hir_call = function (self: CallSource): boolean {
  return unported("rustc_middle::mir::terminator::CallSource::from_hir_call");
};


// stub: compiler/rustc_middle/src/mir/terminator.rs:810 diverges (lane mir-body-b)
InlineAsmMacro.diverges = function (self: InlineAsmMacro, options: InlineAsmOptions): boolean {
  return unported("rustc_middle::mir::terminator::InlineAsmMacro::diverges");
};
