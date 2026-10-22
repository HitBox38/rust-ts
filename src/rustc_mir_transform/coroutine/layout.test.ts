// Unit tests of coroutine/layout.rs's `CoroutineSavedLocals` and coroutine/drop.rs's `has_async_drops` on hand-built
// values (lane mt-coroutine-b; the oracle checks are layout.oracle.test.ts). Expectations follow upstream's code:
// `CoroutineSavedLocal::new(i)` is the `i`-th local of the set, `renumber_bitset` asserts a subset, and a coroutine needs
// async drop iff a non-cleanup block reachable from a `Yield`'s `drop` edge (in reverse postorder) yields again.
import { expect, test } from "bun:test";
import "../../rustc_session/lib.ts";
import "../../rustc_middle/lib.ts";
import { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { BasicBlock, BasicBlockData, Body, Local, SourceInfo, type TerminatorKind } from "../../rustc_middle/mir/mod.ts";
import { Place_from_Local } from "../../rustc_middle/mir/statement.ts";
import { Terminator } from "../../rustc_middle/mir/terminator.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { Panic } from "../../std/panic.ts";
import { has_async_drops } from "./drop.ts";
import { CoroutineSavedLocals } from "./layout.ts";

const bb = (n: number): BasicBlock => BasicBlock.from_u32(n);
const local = (n: number): Local => Local.from_u32(n);
const set = (domain: number, xs: number[]): DenseBitSet<Local> => {
  const s = DenseBitSet.new_empty<Local>(domain);
  for (const x of xs) s.insert(local(x));
  return s;
};

test("CoroutineSavedLocals: iter_enumerated / get / renumber_bitset", () => {
  const saved = new CoroutineSavedLocals(set(8, [2, 3, 6]));
  expect([...saved.iter_enumerated()].map(([s, l]) => [Number(s), Number(l)])).toEqual([
    [0, 2],
    [1, 3],
    [2, 6],
  ]);
  expect(saved.get(local(6))).toBe(2 as never);
  expect(saved.get(local(2))).toBe(0 as never);
  expect(saved.get(local(4))).toBeUndefined();
  const renumbered = saved.renumber_bitset(set(8, [3, 6]));
  expect(renumbered.domain_size()).toBe(3);
  expect([...renumbered.iter()].map(Number)).toEqual([1, 2]);
  expect(saved.deref()).toBe(saved._0);
  // `assert!(self.superset(input), "{:?} not a superset of {:?}", self.0, input)`
  expect(() => saved.renumber_bitset(set(8, [1, 3]))).toThrow(Panic);
  expect(() => saved.renumber_bitset(set(8, [1, 3]))).toThrow("[_2, _3, _6] not a superset of [_1, _3]");
});

function yield_(resume: number, drop: number | undefined): TerminatorKind {
  return { $: "Yield", value: { $: "Copy", _0: Place_from_Local(local(1)) }, resume: bb(resume), resume_arg: Place_from_Local(local(2)), drop: drop === undefined ? undefined : bb(drop) };
}
function body(blocks: [TerminatorKind, boolean][]): Body {
  return Body.new_cfg_only(blocks.map(([kind, is_cleanup]) => BasicBlockData.new(new Terminator(SourceInfo.outermost(DUMMY_SP), kind), is_cleanup)));
}
const RET: TerminatorKind = { $: "Return" };

test("has_async_drops: a yield reachable through a `drop` edge", () => {
  // bb0: yield -> resume bb1, drop bb2; bb2 yields again: async drop
  expect(has_async_drops(body([[yield_(1, 2), false], [RET, false], [yield_(3, undefined), false], [RET, false]]))).toBe(true);
  // through a goto: bb2 -> bb4 (yield)
  expect(
    has_async_drops(
      body([[yield_(1, 2), false], [RET, false], [{ $: "Goto", target: bb(4), loop_hint_attrs: [] }, false], [RET, false], [yield_(3, undefined), false]]),
    ),
  ).toBe(true);
  // the second yield is on the resume path only
  expect(has_async_drops(body([[yield_(1, 2), false], [yield_(3, undefined), false], [RET, false], [RET, false]]))).toBe(false);
  // cleanup blocks are not async drops
  expect(has_async_drops(body([[yield_(1, 2), false], [RET, false], [yield_(3, undefined), true], [RET, false]]))).toBe(false);
  // no yield at all
  expect(has_async_drops(body([[RET, false]]))).toBe(false);
});
