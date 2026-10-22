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
import { BinOpKind, InlineAsmOptions } from "../../rustc_ast/lib.ts";
import type { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { bug } from "../../rustc_span/macros.ts";
import { type Debug, format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import { field_mut, type MutRef } from "../../std/mut_ref.ts";
import { panic, unwrap } from "../../std/panic.ts";
import type { FmtResult, FmtWrite } from "../../vendor/anstream/stream.ts";
import type { BasicBlock, Place } from "./mod.ts";
import {
  AssertKind,
  BinOp,
  CallSource,
  clone_Place,
  debug_BinOp,
  InlineAsmMacro,
  type Operand,
  SwitchTargets,
  TerminatorKind,
  UnwindAction,
  UnwindTerminateReason,
} from "./syntax.ts";
import { type CallReturnPlaces as gen_CallReturnPlaces, Terminator, TerminatorEdges } from "./terminator.gen.ts";
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
  // #[inline]
  // rustc: compiler/rustc_middle/src/mir/terminator.rs:118 next
  next(): IteratorResult<[bigint, BasicBlock]> {
    // `self.inner.next().map(|(val, bb)| (val.get(), *bb))`: the zip ends with its shorter slice.
    if (this.index < this.values.length && this.index < this.targets.length) {
      const i = this.index++;
      return { done: false, value: [this.values[i]!, this.targets[i]!] };
    }
    return { done: true, value: undefined };
  }

  // #[inline]
  // rustc: compiler/rustc_middle/src/mir/terminator.rs:123 size_hint
  size_hint(): [number, number | undefined] {
    const n = Math.max(0, Math.min(this.values.length, this.targets.length) - this.index);
    return [n, n];
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

/// Creates switch targets from an iterator of values and target blocks.
///
/// The iterator may be empty, in which case the `SwitchInt` instruction is equivalent to
/// `goto otherwise;`.
// rustc: compiler/rustc_middle/src/mir/terminator.rs:20 new
(SwitchTargets as unknown as { new: typeof SwitchTargets.new }).new = function (targets: Iterable<[bigint, BasicBlock]>, otherwise: BasicBlock): SwitchTargets {
  const values: bigint[] = [];
  const targets_: BasicBlock[] = [];
  for (const [v, t] of targets) {
    values.push(v);
    targets_.push(t);
  }
  targets_.push(otherwise);
  return new SwitchTargets(values, targets_);
};

/// Builds a switch targets definition that jumps to `then` if the tested value equals `value`,
/// and to `else_` if not.
// rustc: compiler/rustc_middle/src/mir/terminator.rs:29 static_if
(SwitchTargets as unknown as { static_if: typeof SwitchTargets.static_if }).static_if = function (value: bigint, then: BasicBlock, else_: BasicBlock): SwitchTargets {
  return new SwitchTargets([value], [then, else_]);
};

/// Inverse of `SwitchTargets::static_if`.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:35 as_static_if
SwitchTargets.prototype.as_static_if = function (this: SwitchTargets): [bigint, BasicBlock, BasicBlock] | undefined {
  if (this.values.length === 1 && this.targets.length === 2) {
    const value = this.values[0]!;
    const [then, else_] = [this.targets[0]!, this.targets[1]!];
    return [value, then, else_];
  } else {
    return undefined;
  }
};

/// Returns the fallback target that is jumped to when none of the values match the operand.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:47 otherwise
SwitchTargets.prototype.otherwise = function (this: SwitchTargets): BasicBlock {
  return unwrap(this.targets[this.targets.length - 1]);
};

/// Returns an iterator over the switch targets.
///
/// The iterator will yield tuples containing the value and corresponding target to jump to, not
/// including the `otherwise` fallback target.
///
/// Note that this may yield 0 elements. Only the `otherwise` branch is mandatory.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:58 iter
SwitchTargets.prototype.iter = function (this: SwitchTargets): SwitchTargetsIter {
  return new SwitchTargetsIter(this.values, this.targets, 0);
};

/// Returns a slice with all possible jump targets (including the fallback target).
// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:64 all_targets
SwitchTargets.prototype.all_targets = function (this: SwitchTargets): readonly BasicBlock[] {
  return this.targets;
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:69 all_targets_mut
SwitchTargets.prototype.all_targets_mut = function (this: SwitchTargets): BasicBlock[] {
  return this.targets;
};

/// Returns a slice with all considered values (not including the fallback).
// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:75 all_values
SwitchTargets.prototype.all_values = function (this: SwitchTargets): readonly bigint[] {
  return this.values;
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:80 all_values_mut
SwitchTargets.prototype.all_values_mut = function (this: SwitchTargets): bigint[] {
  return this.values;
};

/// Finds the `BasicBlock` to which this `SwitchInt` will branch given the
/// specific value. This cannot fail, as it'll return the `otherwise`
/// branch if there's not a specific match for the value.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:88 target_for_value
SwitchTargets.prototype.target_for_value = function (this: SwitchTargets, value: bigint): BasicBlock {
  for (const [v, t] of this.iter()) {
    if (v === value) return t;
  }
  return this.otherwise();
};

/// Adds a new target to the switch. Panics if you add an already present value.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:94 add_target
SwitchTargets.prototype.add_target = function (this: SwitchTargets, value: bigint, bb: BasicBlock): void {
  if (this.values.includes(value)) {
    // `Pu128`'s Debug prints the `u128`.
    bug(`target value ${value} already present`);
  }
  this.values.push(value);
  this.targets.splice(this.targets.length - 1, 0, bb);
};

/// Returns true if all targets (including the fallback target) are distinct.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:105 is_distinct
SwitchTargets.prototype.is_distinct = function (this: SwitchTargets): boolean {
  return new Set(this.targets).size === this.targets.length;
};

// rustc: compiler/rustc_middle/src/mir/terminator.rs:131 cleanup_block
UnwindAction.cleanup_block = function (self: UnwindAction): BasicBlock | undefined {
  switch (self.$) {
    case "Cleanup":
      return self._0;
    case "Continue":
    case "Unreachable":
    case "Terminate":
      return undefined;
  }
};

// rustc: compiler/rustc_middle/src/mir/terminator.rs:140 as_str
UnwindTerminateReason.as_str = function (self: UnwindTerminateReason): string {
  // Keep this in sync with the messages in `core/src/panicking.rs`.
  switch (self) {
    case "Abi":
      return "panic in a function that cannot unwind";
    case "InCleanup":
      return "panic in a destructor during cleanup";
  }
};

/// A short representation of this used for MIR printing.
// rustc: compiler/rustc_middle/src/mir/terminator.rs:149 as_short_str
UnwindTerminateReason.as_short_str = function (self: UnwindTerminateReason): string {
  switch (self) {
    case "Abi":
      return "abi";
    case "InCleanup":
      return "cleanup";
  }
};

// rustc: compiler/rustc_middle/src/mir/terminator.rs:156 lang_item
UnwindTerminateReason.lang_item = function (self: UnwindTerminateReason): LangItem {
  switch (self) {
    case "Abi":
      return "PanicCannotUnwind";
    case "InCleanup":
      return "PanicInCleanup";
  }
};

/// Returns true if this an overflow checking assertion controlled by -C overflow-checks.
// rustc: compiler/rustc_middle/src/mir/terminator.rs:166 is_optional_overflow_check
AssertKind.is_optional_overflow_check = function <O>(self: AssertKind<O>): boolean {
  return (
    self.$ === "OverflowNeg" ||
    (self.$ === "Overflow" && (self._0 === "Add" || self._0 === "Sub" || self._0 === "Mul" || self._0 === "Shl" || self._0 === "Shr"))
  );
};

/// Get the lang item that is invoked to print a static message when this assert fires.
///
/// The caller is expected to handle `BoundsCheck` and `MisalignedPointerDereference` by
/// invoking the appropriate lang item (panic_bounds_check/panic_misaligned_pointer_dereference)
/// instead of printing a static message. Those have dynamic arguments that aren't present for
/// the rest of the messages here.
// rustc: compiler/rustc_middle/src/mir/terminator.rs:178 panic_function
AssertKind.panic_function = function <O>(self: AssertKind<O>): LangItem {
  switch (self.$) {
    case "Overflow":
      switch (self._0) {
        case "Add":
          return "PanicAddOverflow";
        case "Sub":
          return "PanicSubOverflow";
        case "Mul":
          return "PanicMulOverflow";
        case "Div":
          return "PanicDivOverflow";
        case "Rem":
          return "PanicRemOverflow";
        case "Shr":
          return "PanicShrOverflow";
        case "Shl":
          return "PanicShlOverflow";
        default:
          return bug(`${debug_BinOp(self._0, PLAIN)} cannot overflow`);
      }
    case "OverflowNeg":
      return "PanicNegOverflow";
    case "DivisionByZero":
      return "PanicDivZero";
    case "RemainderByZero":
      return "PanicRemZero";
    case "ResumedAfterReturn": {
      const k = self._0;
      if (k.$ === "Coroutine") return "PanicCoroutineResumed";
      switch (k._0) {
        case "Async":
          return "PanicAsyncFnResumed";
        case "AsyncGen":
          return "PanicAsyncGenFnResumed";
        case "Gen":
          return "PanicGenFnNone";
      }
      break;
    }
    case "ResumedAfterPanic": {
      const k = self._0;
      if (k.$ === "Coroutine") return "PanicCoroutineResumedPanic";
      switch (k._0) {
        case "Async":
          return "PanicAsyncFnResumedPanic";
        case "AsyncGen":
          return "PanicAsyncGenFnResumedPanic";
        case "Gen":
          return "PanicGenFnNonePanic";
      }
      break;
    }
    case "NullPointerDereference":
      return "PanicNullPointerDereference";
    case "NullReferenceConstructed":
      return "PanicNullReferenceConstructed";
    case "InvalidEnumConstruction":
      return "PanicInvalidEnumConstruction";
    case "ResumedAfterDrop": {
      const k = self._0;
      if (k.$ === "Coroutine") return "PanicCoroutineResumedDrop";
      switch (k._0) {
        case "Async":
          return "PanicAsyncFnResumedDrop";
        case "AsyncGen":
          return "PanicAsyncGenFnResumedDrop";
        case "Gen":
          return "PanicGenFnNoneDrop";
      }
      break;
    }

    case "BoundsCheck":
    case "MisalignedPointerDereference":
      return bug("Unexpected AssertKind");
  }
};

/// Format the message arguments for the `assert(cond, msg..)` terminator in MIR printing.
///
/// Needs to be kept in sync with the run-time behavior (which is defined by
/// `AssertKind::panic_function` and the lang items mentioned in its docs).
/// Note that we deliberately show more details here than we do at runtime, such as the actual
/// numbers that overflowed -- it is much easier to do so here than at runtime.
// PORT: each `write!(f, ..)` is one `write_str` of the formatted text (`{x:?}` is `debug_O(x, PLAIN)`).
// rustc: compiler/rustc_middle/src/mir/terminator.rs:238 fmt_assert_args
AssertKind.fmt_assert_args = function <O>(self: AssertKind<O>, f: FmtWrite, debug_O: Debug<O>): FmtResult {
  const d = (o: O): string => debug_O(o, PLAIN);
  switch (self.$) {
    case "BoundsCheck":
      return f.write_str(`"index out of bounds: the length is {} but the index is {}", ${d(self.len)}, ${d(self.index)}`);

    case "OverflowNeg":
      return f.write_str(`"attempt to negate \`{}\`, which would overflow", ${d(self._0)}`);
    case "DivisionByZero":
      return f.write_str(`"attempt to divide \`{}\` by zero", ${d(self._0)}`);
    case "RemainderByZero":
      return f.write_str(`"attempt to calculate the remainder of \`{}\` with a divisor of zero", ${d(self._0)}`);
    case "Overflow": {
      const [l, r] = [self._1, self._2];
      switch (self._0) {
        case "Add":
          return f.write_str(`"attempt to compute \`{} + {}\`, which would overflow", ${d(l)}, ${d(r)}`);
        case "Sub":
          return f.write_str(`"attempt to compute \`{} - {}\`, which would overflow", ${d(l)}, ${d(r)}`);
        case "Mul":
          return f.write_str(`"attempt to compute \`{} * {}\`, which would overflow", ${d(l)}, ${d(r)}`);
        case "Div":
          return f.write_str(`"attempt to compute \`{} / {}\`, which would overflow", ${d(l)}, ${d(r)}`);
        case "Rem":
          return f.write_str(`"attempt to compute the remainder of \`{} % {}\`, which would overflow", ${d(l)}, ${d(r)}`);
        case "Shr":
          return f.write_str(`"attempt to shift right by \`{}\`, which would overflow", ${d(r)}`);
        case "Shl":
          return f.write_str(`"attempt to shift left by \`{}\`, which would overflow", ${d(r)}`);
        default:
          return bug(`${debug_BinOp(self._0, PLAIN)} cannot overflow`);
      }
    }
    case "MisalignedPointerDereference":
      return f.write_str(
        `"misaligned pointer dereference: address must be a multiple of {} but is {}", ${d(self.required)}, ${d(self.found)}`,
      );
    case "NullPointerDereference":
      return f.write_str(`"null pointer dereference occurred"`);
    case "NullReferenceConstructed":
      return f.write_str(`"null reference produced"`);
    case "InvalidEnumConstruction":
      return f.write_str(`"trying to construct an enum from an invalid value {}", ${d(self._0)}`);
    case "ResumedAfterReturn": {
      const k = self._0;
      if (k.$ === "Coroutine") return f.write_str(`"coroutine resumed after completion"`);
      switch (k._0) {
        case "Async":
          return f.write_str(`"\`async fn\` resumed after completion"`);
        case "AsyncGen":
          return f.write_str(`"\`async gen fn\` resumed after completion"`);
        case "Gen":
          return f.write_str(`"\`gen fn\` should just keep returning \`None\` after completion"`);
      }
      break;
    }
    case "ResumedAfterPanic": {
      const k = self._0;
      if (k.$ === "Coroutine") return f.write_str(`"coroutine resumed after panicking"`);
      switch (k._0) {
        case "Async":
          return f.write_str(`"\`async fn\` resumed after panicking"`);
        case "AsyncGen":
          return f.write_str(`"\`async gen fn\` resumed after panicking"`);
        case "Gen":
          return f.write_str(`"\`gen fn\` should just keep returning \`None\` after panicking"`);
      }
      break;
    }
    case "ResumedAfterDrop": {
      const k = self._0;
      if (k.$ === "Coroutine") return f.write_str(`"coroutine resumed after async drop"`);
      switch (k._0) {
        case "Async":
          return f.write_str(`"\`async fn\` resumed after async drop"`);
        case "AsyncGen":
          return f.write_str(`"\`async gen fn\` resumed after async drop"`);
        case "Gen":
          return f.write_str(`"\`gen fn\` resumed after drop"`);
      }
      break;
    }
  }
};

/// Format the diagnostic message for use in a lint (e.g. when the assertion fails during const-eval).
///
/// Needs to be kept in sync with the run-time behavior (which is defined by
/// `AssertKind::panic_function` and the lang items mentioned in its docs).
/// Note that we deliberately show more details here than we do at runtime, such as the actual
/// numbers that overflowed -- it is much easier to do so here than at runtime.
// impl<O: fmt::Debug> fmt::Display for AssertKind<O>
// PORT: `{x:?}` is `debug_O(x, PLAIN)`, `{x:#?}` is `format_debug(x, debug_O, PRETTY)`; the fn returns the text.
// rustc: compiler/rustc_middle/src/mir/terminator.rs:342 fmt
export function display_AssertKind<O>(self: AssertKind<O>, debug_O: Debug<O>): string {
  const d = (o: O): string => debug_O(o, PLAIN);
  const p = (o: O): string => format_debug(o, debug_O, PRETTY);
  switch (self.$) {
    case "BoundsCheck":
      return `index out of bounds: the length is ${d(self.len)} but the index is ${d(self.index)}`;
    case "Overflow": {
      if (self._0 === "Shl") {
        return `attempt to shift left by \`${p(self._2)}\`, which would overflow`;
      }
      if (self._0 === "Shr") {
        return `attempt to shift right by \`${p(self._2)}\`, which would overflow`;
      }
      const [binop, left, right] = [self._0, self._1, self._2];
      const op = BinOpKind.as_str(BinOp.to_hir_binop(binop));
      return `attempt to compute \`${p(left)} ${op} ${p(right)}\`, which would overflow`;
    }
    case "OverflowNeg":
      return `attempt to negate \`${p(self._0)}\`, which would overflow`;
    case "DivisionByZero":
      return `attempt to divide \`${p(self._0)}\` by zero`;
    case "RemainderByZero":
      return `attempt to calculate the remainder of \`${p(self._0)}\` with a divisor of zero`;
    case "ResumedAfterReturn": {
      const k = self._0;
      if (k.$ === "Desugared") {
        switch (k._0) {
          case "Async":
            return "`async fn` resumed after completion";
          case "AsyncGen":
            return panic("not implemented");
          case "Gen":
            return bug("gen blocks can be resumed after they return and will keep returning `None`");
        }
      }
      return "coroutine resumed after completion";
    }
    case "ResumedAfterPanic": {
      const k = self._0;
      if (k.$ === "Desugared") {
        switch (k._0) {
          case "Async":
            return "`async fn` resumed after panicking";
          case "AsyncGen":
            return panic("not implemented");
          case "Gen":
            return "`gen` fn or block cannot be further iterated on after it panicked";
        }
      }
      return "coroutine resumed after panicking";
    }
    case "NullPointerDereference":
      return "null pointer dereference occurred";
    case "NullReferenceConstructed":
      return "null reference produced";
    case "InvalidEnumConstruction":
      return `trying to construct an enum from an invalid value \`${p(self._0)}\``;
    case "ResumedAfterDrop": {
      const k = self._0;
      if (k.$ === "Desugared") {
        switch (k._0) {
          case "Async":
            return "`async fn` resumed after async drop";
          case "AsyncGen":
            return panic("not implemented");
          case "Gen":
            return "`gen` fn or block cannot be further iterated on after it async dropped";
        }
      }
      return "coroutine resumed after async drop";
    }

    case "MisalignedPointerDereference":
      return `misaligned pointer dereference: address must be a multiple of ${p(self.required)} but is ${p(self.found)}`;
  }
}

// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:425 successors
Terminator.prototype.successors = function (this: Terminator): Successors {
  return TerminatorKind.successors(this.kind);
};

/// Return `Some` if all successors are identical.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:431 identical_successor
Terminator.prototype.identical_successor = function (this: Terminator): BasicBlock | undefined {
  const successors = this.successors();
  const first = successors.next();
  if (first.done) return undefined;
  const first_succ = first.value;
  for (const succ of successors) {
    if (first_succ !== succ) return undefined;
  }
  return first_succ;
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:438 successors_mut
Terminator.prototype.successors_mut = function (this: Terminator, f: (bb: MutRef<BasicBlock>) => void): void {
  TerminatorKind.successors_mut(this.kind, f);
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:443 unwind
Terminator.prototype.unwind = function (this: Terminator): UnwindAction | undefined {
  return TerminatorKind.unwind(this.kind);
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:448 unwind_mut
Terminator.prototype.unwind_mut = function (this: Terminator): MutRef<UnwindAction> | undefined {
  return TerminatorKind.unwind_mut(this.kind);
};

/// Returns a simple string representation of a `TerminatorKind` variant, independent of any
/// values it might hold (e.g. `TerminatorKind::Call` always returns `"Call"`).
// rustc: compiler/rustc_middle/src/mir/terminator.rs:456 name
TerminatorKind.name = function (self: TerminatorKind): string {
  switch (self.$) {
    case "Goto":
      return "Goto";
    case "SwitchInt":
      return "SwitchInt";
    case "UnwindResume":
      return "UnwindResume";
    case "UnwindTerminate":
      return "UnwindTerminate";
    case "Return":
      return "Return";
    case "Unreachable":
      return "Unreachable";
    case "Drop":
      return "Drop";
    case "Call":
      return "Call";
    case "TailCall":
      return "TailCall";
    case "Assert":
      return "Assert";
    case "Yield":
      return "Yield";
    case "CoroutineDrop":
      return "CoroutineDrop";
    case "FalseEdge":
      return "FalseEdge";
    case "FalseUnwind":
      return "FalseUnwind";
    case "InlineAsm":
      return "InlineAsm";
  }
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:477 if_
TerminatorKind.if_ = function (cond: Operand, t: BasicBlock, f: BasicBlock): TerminatorKind {
  return { $: "SwitchInt", discr: cond, targets: SwitchTargets.static_if(0n, f, t) };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:482 goto
TerminatorKind.goto = function (target: BasicBlock): TerminatorKind {
  return { $: "Goto", target, loop_hint_attrs: [] };
};

// pub use helper::*;
// mod helper {

// Note: this method ensures all paths below produce an iterator with the same concrete type.
// #[inline]
// #[define_opaque(Successors)]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:496 mk_successors
function mk_successors(slice: readonly BasicBlock[], option1: BasicBlock | undefined, option2: BasicBlock | undefined): Successors {
  const items = slice.slice();
  if (option1 !== undefined) items.push(option1);
  if (option2 !== undefined) items.push(option2);
  return new Successors(items);
}

/// Like [`SwitchTargets::target_for_value`], but returning the same type as
/// [`Terminator::successors`].
// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:508 successors_for_value
SwitchTargets.prototype.successors_for_value = function (this: SwitchTargets, value: bigint): Successors {
  const target = this.target_for_value(value);
  return mk_successors([], target, undefined);
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:516 successors
TerminatorKind.successors = function (self: TerminatorKind): Successors {
  switch (self.$) {
    case "Drop": {
      const t = self.target;
      // 3-successors for async drop: target, unwind, dropline (parent coroutine drop)
      if (self.unwind.$ === "Cleanup" && self.drop !== undefined) {
        return mk_successors([t], self.unwind._0, self.drop);
      }
      // 2-successors
      if (self.unwind.$ === "Cleanup" && self.drop === undefined) {
        return mk_successors([t], self.unwind._0, undefined);
      }
      if (self.drop !== undefined) {
        return mk_successors([t], self.drop, undefined);
      }
      // single successor
      return mk_successors([t], undefined, undefined);
    }
    case "Call":
      // 2-successors
      if (self.target !== undefined && self.unwind.$ === "Cleanup") {
        return mk_successors([self.target], self.unwind._0, undefined);
      }
      // single successor
      if (self.target === undefined && self.unwind.$ === "Cleanup") {
        return mk_successors([self.unwind._0], undefined, undefined);
      }
      if (self.target !== undefined) {
        return mk_successors([self.target], undefined, undefined);
      }
      // No successors
      return mk_successors([], undefined, undefined);
    case "Yield":
      // 2-successors
      if (self.drop !== undefined) {
        return mk_successors([self.resume], self.drop, undefined);
      }
      // single successor
      return mk_successors([self.resume], undefined, undefined);
    case "Assert":
      // 2-successors
      if (self.unwind.$ === "Cleanup") {
        return mk_successors([self.target], self.unwind._0, undefined);
      }
      // single successor
      return mk_successors([self.target], undefined, undefined);
    case "FalseUnwind":
      // 2-successors
      if (self.unwind.$ === "Cleanup") {
        return mk_successors([self.real_target], self.unwind._0, undefined);
      }
      // single successor
      return mk_successors([self.real_target], undefined, undefined);
    // single successor
    case "Goto":
      return mk_successors([self.target], undefined, undefined);
    // No successors
    case "UnwindResume":
    case "UnwindTerminate":
    case "CoroutineDrop":
    case "Return":
    case "Unreachable":
    case "TailCall":
      return mk_successors([], undefined, undefined);
    // Multiple successors
    case "InlineAsm":
      if (self.unwind.$ === "Cleanup") {
        return mk_successors(self.targets, self.unwind._0, undefined);
      }
      return mk_successors(self.targets, undefined, undefined);
    case "SwitchInt":
      return mk_successors(self.targets.targets, undefined, undefined);
    // FalseEdge
    case "FalseEdge":
      return mk_successors([self.real_target], self.imaginary_target, undefined);
  }
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:564 successors_mut
TerminatorKind.successors_mut = function (self: TerminatorKind, f: (bb: MutRef<BasicBlock>) => void): void {
  switch (self.$) {
    case "Drop": {
      f(field_mut(self, "target"));
      const unwind = self.unwind;
      if (unwind.$ === "Cleanup") {
        f(field_mut(unwind, "_0"));
      }
      if (self.drop !== undefined) {
        f(field_mut(self, "drop") as MutRef<BasicBlock>);
      }
      break;
    }
    case "Call": {
      if (self.target !== undefined) {
        f(field_mut(self, "target") as MutRef<BasicBlock>);
      }
      const unwind = self.unwind;
      if (unwind.$ === "Cleanup") {
        f(field_mut(unwind, "_0"));
      }
      break;
    }
    case "Yield":
      f(field_mut(self, "resume"));
      if (self.drop !== undefined) {
        f(field_mut(self, "drop") as MutRef<BasicBlock>);
      }
      break;
    case "Assert":
    case "FalseUnwind": {
      if (self.$ === "Assert") f(field_mut(self, "target"));
      else f(field_mut(self, "real_target"));
      const unwind = self.unwind;
      if (unwind.$ === "Cleanup") {
        f(field_mut(unwind, "_0"));
      }
      break;
    }
    case "Goto":
      f(field_mut(self, "target"));
      break;
    case "UnwindResume":
    case "UnwindTerminate":
    case "CoroutineDrop":
    case "Return":
    case "Unreachable":
    case "TailCall":
      break;
    case "InlineAsm": {
      const targets = self.targets;
      for (let i = 0; i < targets.length; i++) {
        f(field_mut(targets, i));
      }
      const unwind = self.unwind;
      if (unwind.$ === "Cleanup") {
        f(field_mut(unwind, "_0"));
      }
      break;
    }
    case "SwitchInt": {
      const targets = self.targets.targets;
      for (let i = 0; i < targets.length; i++) {
        f(field_mut(targets, i));
      }
      break;
    }
    case "FalseEdge":
      f(field_mut(self, "real_target"));
      f(field_mut(self, "imaginary_target"));
      break;
  }
};

// } (mod helper)

// #[inline]
// PORT: `Option<&UnwindAction>` is the action itself (unit variants are shared frozen objects; `Cleanup`'s block is
// read, not written, through it; `unwind_mut` hands out the `MutRef`).
// rustc: compiler/rustc_middle/src/mir/terminator.rs:629 unwind
TerminatorKind.unwind = function (self: TerminatorKind): UnwindAction | undefined {
  switch (self.$) {
    case "Goto":
    case "UnwindResume":
    case "UnwindTerminate":
    case "Return":
    case "TailCall":
    case "Unreachable":
    case "CoroutineDrop":
    case "Yield":
    case "SwitchInt":
    case "FalseEdge":
      return undefined;
    case "Call":
    case "Assert":
    case "Drop":
    case "FalseUnwind":
    case "InlineAsm":
      return self.unwind;
  }
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:650 unwind_mut
TerminatorKind.unwind_mut = function (self: TerminatorKind): MutRef<UnwindAction> | undefined {
  switch (self.$) {
    case "Goto":
    case "UnwindResume":
    case "UnwindTerminate":
    case "Return":
    case "TailCall":
    case "Unreachable":
    case "CoroutineDrop":
    case "Yield":
    case "SwitchInt":
    case "FalseEdge":
      return undefined;
    case "Call":
    case "Assert":
    case "Drop":
    case "FalseUnwind":
    case "InlineAsm":
      return field_mut(self, "unwind");
  }
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:671 as_switch
TerminatorKind.as_switch = function (self: TerminatorKind): [Operand, SwitchTargets] | undefined {
  switch (self.$) {
    case "SwitchInt":
      return [self.discr, self.targets];
    default:
      return undefined;
  }
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/terminator.rs:679 as_goto
TerminatorKind.as_goto = function (self: TerminatorKind): BasicBlock | undefined {
  switch (self.$) {
    case "Goto":
      return self.target;
    default:
      return undefined;
  }
};

// rustc: compiler/rustc_middle/src/mir/terminator.rs:718 for_each
CallReturnPlaces.for_each = function (self: CallReturnPlaces, f: (place: Place) => void): void {
  switch (self.$) {
    case "Call":
    case "Yield":
      f(clone_Place(self._0));
      break;
    case "InlineAsm": {
      const operands = self._0;
      for (const op of operands) {
        if (op.$ === "Out" && op.place !== undefined) {
          f(clone_Place(op.place));
        } else if (op.$ === "InOut" && op.out_place !== undefined) {
          f(clone_Place(op.out_place));
        }
      }
      break;
    }
  }
};

// rustc: compiler/rustc_middle/src/mir/terminator.rs:735 edges
Terminator.prototype.edges = function (this: Terminator): TerminatorEdges {
  return TerminatorKind.edges(this.kind);
};

// rustc: compiler/rustc_middle/src/mir/terminator.rs:741 edges
TerminatorKind.edges = function (self: TerminatorKind): TerminatorEdges {
  switch (self.$) {
    case "Return":
    case "TailCall":
    case "UnwindResume":
    case "UnwindTerminate":
    case "CoroutineDrop":
    case "Unreachable":
      return TerminatorEdges.None;

    case "Goto":
      return { $: "Single", _0: self.target };

    // FIXME: Maybe we need also TerminatorEdges::Trio for async drop
    // (target + unwind + dropline)
    case "Assert":
    case "Drop":
    case "FalseUnwind": {
      const target = self.$ === "FalseUnwind" ? self.real_target : self.target;
      const unwind = self.unwind;
      switch (unwind.$) {
        case "Cleanup":
          return { $: "Double", _0: target, _1: unwind._0 };
        case "Continue":
        case "Terminate":
        case "Unreachable":
          return { $: "Single", _0: target };
      }
      break;
    }

    case "FalseEdge":
      return { $: "Double", _0: self.real_target, _1: self.imaginary_target };

    case "Yield": {
      const [target, drop, resume_arg] = [self.resume, self.drop, self.resume_arg];
      const return_ = [target];
      if (drop !== undefined) return_.push(drop);
      return { $: "AssignOnReturn", return_, cleanup: undefined, place: { $: "Yield", _0: clone_Place(resume_arg) } };
    }

    case "Call": {
      const [unwind, destination, target] = [self.unwind, self.destination, self.target];
      return {
        $: "AssignOnReturn",
        return_: target !== undefined ? [target] : [],
        cleanup: UnwindAction.cleanup_block(unwind),
        place: { $: "Call", _0: clone_Place(destination) },
      };
    }

    case "InlineAsm": {
      const [operands, targets, unwind] = [self.operands, self.targets, self.unwind];
      return {
        $: "AssignOnReturn",
        return_: targets.slice(),
        cleanup: UnwindAction.cleanup_block(unwind),
        place: { $: "InlineAsm", _0: operands },
      };
    }

    case "SwitchInt":
      return { $: "SwitchInt", targets: self.targets, discr: self.discr };
  }
};

// rustc: compiler/rustc_middle/src/mir/terminator.rs:804 from_hir_call
CallSource.from_hir_call = function (self: CallSource): boolean {
  return self === "Normal";
};

// rustc: compiler/rustc_middle/src/mir/terminator.rs:810 diverges
InlineAsmMacro.diverges = function (self: InlineAsmMacro, options: InlineAsmOptions): boolean {
  switch (self) {
    case "Asm":
      return InlineAsmOptions.contains(options, InlineAsmOptions.NORETURN);
    case "NakedAsm":
      return true;
  }
};
