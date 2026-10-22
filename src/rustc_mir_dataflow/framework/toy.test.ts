// Framework tests with toy analyses over hand-built CFGs (lane dataflow-contract; not an upstream file). Expected
// values are worked out by hand from the upstream semantics (framework/mod.rs, direction.rs, cursor.rs):
// - forward reaching definitions on a loop (gen/kill, `SwitchInt` without edge data, back edge, cursor seeks);
// - `SwitchInt` edge effects (`get_switch_int_data` / `apply_switch_int_edge_effect`: a clone per normal target,
//   the exit state itself for `otherwise`);
// - `Call` edges (`AssignOnReturn`: the cleanup edge is propagated *before* `apply_call_return_effect`);
// - backward liveness (entry states are block exits, cursor seeks in reverse, an unreachable predecessor is skipped,
//   the call-return effect on the predecessor edge);
// - `MaybeReachable` domains (unreachable blocks stay `Unreachable`), `visit_results`, and the `DebugWithContext`
//   output of bit sets (fmt.rs).
// The bodies are real MIR (`Body::new_cfg_only`): `nop` statements carrying a test payload (a side table), and real
// `return` / `goto` / `switchInt` / `call` terminators, so predecessors and the reverse postorder are the real caches.
import { describe, expect, test } from "bun:test";
import { DenseBitSet } from "../../rustc_index/bit_set.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { PLAIN, PRETTY } from "../../std/fmt.ts";
import { Panic } from "../../std/panic.ts";
import "../../rustc_middle/lib.ts";
import {
  BasicBlock,
  BasicBlockData,
  Body,
  type CallReturnPlaces,
  Local,
  Location,
  type Operand,
  Place,
  SourceInfo,
  Statement,
  StatementKind,
  SwitchTargets,
  Terminator,
  TerminatorKind,
  UnwindAction,
} from "../../rustc_middle/mir/mod.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { DebugWithContext_DenseBitSet, DebugWithContext_Local, DebugWithContext_MaybeReachable } from "./fmt.ts";
import { FlatSet, JoinSemiLattice_FlatSet, MaybeReachable } from "./lattice.ts";
import {
  AnalysisBase,
  Backward,
  type Domain,
  Domain_DenseBitSet,
  Domain_MaybeReachable,
  GenKill_DenseBitSet,
  GenKill_MaybeReachable,
  ResultsVisitorBase,
  type SwitchTargetIndex,
  visit_results,
} from "./mod.ts";

// ---- toy MIR ---------------------------------------------------------------------------------------------------

/** A toy statement: defines `def` (a definition id / local) and uses `uses`. */
interface ToyStmt {
  def?: number;
  local?: number;
  uses?: number[];
}
type ToyTerm =
  | { $: "Return" }
  | { $: "Goto"; target: number }
  | { $: "Switch"; targets: number[]; otherwise: number }
  | { $: "Call"; target: number; cleanup?: number; dest: number };

const payloads = new WeakMap<Statement, ToyStmt>();
const si = (): SourceInfo => SourceInfo.outermost(DUMMY_SP);
function stmt(s: ToyStmt): Statement {
  const st = Statement.new(si(), StatementKind.Nop);
  payloads.set(st, s);
  return st;
}
const payload = (s: Statement): ToyStmt => payloads.get(s)!;
const place = (local: number): Place => new Place(Local.from_u32(local), RawList.empty());

function kind_of(t: ToyTerm): TerminatorKind {
  switch (t.$) {
    case "Return":
      return TerminatorKind.Return;
    case "Goto":
      return TerminatorKind.goto(BasicBlock.from_u32(t.target));
    case "Switch":
      return {
        $: "SwitchInt",
        discr: { $: "Copy", _0: place(0) },
        targets: SwitchTargets.new(
          t.targets.map((bb, i): [bigint, BasicBlock] => [BigInt(i), BasicBlock.from_u32(bb)]),
          BasicBlock.from_u32(t.otherwise),
        ),
      };
    case "Call":
      return {
        $: "Call",
        func: { $: "Copy", _0: place(0) },
        args: [],
        destination: place(t.dest),
        target: BasicBlock.from_u32(t.target),
        unwind: t.cleanup === undefined ? UnwindAction.Continue : { $: "Cleanup", _0: BasicBlock.from_u32(t.cleanup) },
        call_source: "Misc",
        fn_span: DUMMY_SP,
      };
  }
}

/** A real body (`Body::new_cfg_only`): its predecessors and reverse postorder are `BasicBlocks`' caches. */
function toy_body(blocks: [ToyStmt[], ToyTerm][]): Body {
  return Body.new_cfg_only(blocks.map(([stmts, term]) => BasicBlockData.new_stmts(stmts.map(stmt), new Terminator(si(), kind_of(term)), false)));
}

const tcx = { sess: { opts: { unstable_opts: { dump_mir_dataflow: false } } } } as unknown as TyCtxt;
const set = (s: DenseBitSet<number>): number[] => [...s.iter()];
const loc = (block: number, statement_index: number): Location => new Location(BasicBlock.from_u32(block), statement_index);

// ---- reaching definitions (forward) ----------------------------------------------------------------------------

//   bb0: d0: x = ..; d1: y = ..; goto bb1
//   bb1: switchInt -> [bb2], otherwise bb3
//   bb2: d2: x = ..; goto bb1            (back edge)
//   bb3: d3: y = ..; return
const DEF_LOCAL = [0, 1, 0, 1]; // d0 x, d1 y, d2 x, d3 y
const loop_body = (): Body =>
  toy_body([
    [[{ def: 0 }, { def: 1 }], { $: "Goto", target: 1 }],
    [[], { $: "Switch", targets: [2], otherwise: 3 }],
    [[{ def: 2 }], { $: "Goto", target: 1 }],
    [[{ def: 3 }], { $: "Return" }],
  ]);

class ReachingDefs extends AnalysisBase<DenseBitSet<number>> {
  readonly Domain: Domain<DenseBitSet<number>> = Domain_DenseBitSet(DebugWithContext_Local as never);
  readonly NAME = "reaching_defs";
  bottom_value(_body: Body): DenseBitSet<number> {
    return DenseBitSet.new_empty(DEF_LOCAL.length);
  }
  initialize_start_block(_body: Body, _state: DenseBitSet<number>): void {}
  apply_primary_statement_effect(state: DenseBitSet<number>, statement: Statement, _location: Location): void {
    const d = payload(statement).def;
    if (d === undefined) return;
    GenKill_DenseBitSet<number>().kill_all(
      state,
      DEF_LOCAL.flatMap((l, i) => (l === DEF_LOCAL[d] ? [i] : [])),
    );
    GenKill_DenseBitSet<number>().gen_(state, d);
  }
}

describe("forward: reaching definitions on a loop", () => {
  const body = loop_body();
  const results = new ReachingDefs().iterate_to_fixpoint(tcx, body, undefined);

  test("entry states at fixpoint", () => {
    expect(results.entry_states.map(set)).toEqual([[], [0, 1, 2], [0, 1, 2], [0, 1, 2]]);
  });

  test("cursor seeks", () => {
    const cursor = results.into_results_cursor(body);
    cursor.seek_to_block_end(0 as BasicBlock);
    expect(set(cursor.get())).toEqual([0, 1]);
    cursor.seek_after_primary_effect(loc(2, 0));
    expect(set(cursor.get())).toEqual([1, 2]);
    cursor.seek_before_primary_effect(loc(2, 0));
    expect(set(cursor.get())).toEqual([0, 1, 2]);
    cursor.seek_to_block_end(3 as BasicBlock);
    expect(set(cursor.get())).toEqual([0, 2, 3]);
    cursor.seek_to_block_start(1 as BasicBlock);
    expect(set(cursor.get())).toEqual([0, 1, 2]);
    cursor.seek_after_primary_effect(loc(0, 0));
    expect(set(cursor.get())).toEqual([0]);
    // a custom effect forces a reset before the next seek
    cursor.apply_custom_effect((_a, state) => state.insert(3));
    expect(set(cursor.get())).toEqual([0, 3]);
    cursor.seek_after_primary_effect(loc(0, 0));
    expect(set(cursor.get())).toEqual([0]);
  });

  test("visit_results sees the state after each primary effect, in block order", () => {
    const seen: string[] = [];
    class Collect extends ResultsVisitorBase<DenseBitSet<number>, ReachingDefs> {
      override visit_after_primary_statement_effect(state: DenseBitSet<number>, _s: Statement, l: Location): void {
        seen.push(`bb${l.block}[${l.statement_index}] ${set(state)}`);
      }
      override visit_block_exit(state: DenseBitSet<number>, block: BasicBlock): void {
        seen.push(`exit bb${block} ${set(state)}`);
      }
    }
    // the real reverse postorder: `Postorder` takes bb1's successors from the back (bb3 first), so bb2 precedes bb3
    expect(body.basic_blocks.reverse_postorder().map(Number)).toEqual([0, 1, 2, 3]);
    visit_results(body, body.basic_blocks.reverse_postorder(), results, new Collect());
    expect(seen).toEqual([
      "bb0[0] 0",
      "bb0[1] 0,1",
      "exit bb0 0,1",
      "exit bb1 0,1,2",
      "bb2[0] 1,2",
      "exit bb2 1,2",
      "bb3[0] 0,2,3",
      "exit bb3 0,2,3",
    ]);
  });
});

// ---- SwitchInt edge effects (forward) ---------------------------------------------------------------------------

class EdgeMarks extends AnalysisBase<DenseBitSet<number>, "data"> {
  readonly Domain: Domain<DenseBitSet<number>> = Domain_DenseBitSet(DebugWithContext_Local as never);
  readonly NAME = "edge_marks";
  bottom_value(_body: Body): DenseBitSet<number> {
    return DenseBitSet.new_empty(32);
  }
  initialize_start_block(_body: Body, _state: DenseBitSet<number>): void {}
  apply_primary_statement_effect(): void {}
  override get_switch_int_data(_block: BasicBlock, _targets: SwitchTargets, _discr: Operand): "data" | undefined {
    return "data";
  }
  override apply_switch_int_edge_effect(state: DenseBitSet<number>, data: "data", target_idx: SwitchTargetIndex): void {
    expect(data).toBe("data");
    state.insert(target_idx.$ === "Normal" ? 10 + target_idx._0 : 20);
  }
}

test("forward: SwitchInt edge effects (clone per normal target, exit state for otherwise)", () => {
  const results = new EdgeMarks().iterate_to_fixpoint(tcx, loop_body(), undefined);
  // bb1 -> bb2 (Normal(0)) gets {10}; bb1 -> bb3 (Otherwise) gets {20}; the back edge brings 10 into bb1 and bb3.
  expect(results.entry_states.map(set)).toEqual([[], [10], [10], [10, 20]]);
});

// ---- Call edges (forward) ---------------------------------------------------------------------------------------

//   bb0: s0 (gen 0); call -> return bb1, cleanup bb2      (the call-return effect gens 1)
class CallGen extends AnalysisBase<DenseBitSet<number>> {
  readonly Domain: Domain<DenseBitSet<number>> = Domain_DenseBitSet(DebugWithContext_Local as never);
  readonly NAME = "call_gen";
  bottom_value(_body: Body): DenseBitSet<number> {
    return DenseBitSet.new_empty(4);
  }
  initialize_start_block(_body: Body, _state: DenseBitSet<number>): void {}
  apply_primary_statement_effect(state: DenseBitSet<number>, statement: Statement): void {
    state.insert(payload(statement).def!);
  }
  override apply_call_return_effect(state: DenseBitSet<number>, _block: BasicBlock, _places: CallReturnPlaces): void {
    state.insert(1);
  }
}

test("forward: the cleanup edge does not see the call-return effect", () => {
  const body = toy_body([
    [[{ def: 0 }], { $: "Call", target: 1, cleanup: 2, dest: 1 }],
    [[], { $: "Return" }],
    [[], { $: "Return" }],
  ]);
  const results = new CallGen().iterate_to_fixpoint(tcx, body, undefined);
  expect(results.entry_states.map(set)).toEqual([[], [0, 1], [0]]);
});

// ---- liveness (backward) ----------------------------------------------------------------------------------------

//   bb0: x = 1; y = 2; goto bb1
//   bb1: use x; switchInt -> [bb2], otherwise bb3
//   bb2: x = x + 1; goto bb1
//   bb3: use y; return
//   bb4: (unreachable) goto bb1
const X = 0;
const Y = 1;
class Liveness extends AnalysisBase<DenseBitSet<number>> {
  readonly Domain: Domain<DenseBitSet<number>> = Domain_DenseBitSet(DebugWithContext_Local as never);
  override readonly Direction = Backward;
  readonly NAME = "liveness";
  constructor(readonly start_live: number[] = []) {
    super();
  }
  bottom_value(_body: Body): DenseBitSet<number> {
    return DenseBitSet.new_empty(3);
  }
  initialize_start_block(_body: Body, state: DenseBitSet<number>): void {
    for (const l of this.start_live) state.insert(l);
  }
  apply_primary_statement_effect(state: DenseBitSet<number>, statement: Statement): void {
    const s = payload(statement);
    if (s.local !== undefined) GenKill_DenseBitSet<number>().kill(state, s.local);
    GenKill_DenseBitSet<number>().gen_all(state, s.uses ?? []);
  }
  override apply_call_return_effect(state: DenseBitSet<number>, _block: BasicBlock, places: CallReturnPlaces): void {
    // the call's destination is defined on return
    if (places.$ !== "Call") throw new Error("ERROR: test: a Call terminator");
    state.remove(places._0.local);
  }
}

describe("backward: liveness", () => {
  const body = toy_body([
    [[{ local: X }, { local: Y }], { $: "Goto", target: 1 }],
    [[{ uses: [X] }], { $: "Switch", targets: [2], otherwise: 3 }],
    [[{ local: X, uses: [X] }], { $: "Goto", target: 1 }],
    [[{ uses: [Y] }], { $: "Return" }],
    [[], { $: "Goto", target: 1 }],
  ]);
  const results = new Liveness().iterate_to_fixpoint(tcx, body, undefined);

  test("entry states (block exits) at fixpoint; the unreachable predecessor bb4 stays bottom", () => {
    expect(results.entry_states.map(set)).toEqual([[X, Y], [X, Y], [X, Y], [], []]);
  });

  test("cursor seeks run against the statement order", () => {
    const cursor = results.into_results_cursor(body);
    cursor.seek_to_block_start(0 as BasicBlock);
    expect(set(cursor.get())).toEqual([]);
    cursor.seek_before_primary_effect(loc(0, 1));
    expect(set(cursor.get())).toEqual([X, Y]);
    cursor.seek_after_primary_effect(loc(0, 1));
    expect(set(cursor.get())).toEqual([X]);
    cursor.seek_after_primary_effect(loc(0, 0));
    expect(set(cursor.get())).toEqual([]);
    cursor.seek_before_primary_effect(loc(0, 1)); // backwards in a backward analysis: reset to the block entry
    expect(set(cursor.get())).toEqual([X, Y]);
    cursor.seek_to_block_end(3 as BasicBlock);
    expect(set(cursor.get())).toEqual([]);
    cursor.seek_to_block_start(3 as BasicBlock);
    expect(set(cursor.get())).toEqual([Y]);
    cursor.seek_to_block_start(2 as BasicBlock);
    expect(set(cursor.get())).toEqual([X, Y]);
  });

  test("initialize_start_block is not supported for backward analyses", () => {
    expect(() => new Liveness([X]).iterate_to_fixpoint(tcx, body, undefined)).toThrow(
      new Panic("`initialize_start_block` is not yet supported for backward dataflow analyses"),
    );
  });

  test("the call-return effect applies on the predecessor edge into the return block", () => {
    //   bb0: call _2 = f() -> return bb1, cleanup bb2
    //   bb1: use _2, use y; return
    //   bb2: use x; return
    const call_body = toy_body([
      [[], { $: "Call", target: 1, cleanup: 2, dest: 2 }],
      [[{ uses: [2, Y] }], { $: "Return" }],
      [[{ uses: [X] }], { $: "Return" }],
    ]);
    const r = new Liveness().iterate_to_fixpoint(tcx, call_body, undefined);
    // bb0's exit joins bb1's start minus the destination (_2) with bb2's start.
    expect(r.entry_states.map(set)).toEqual([[X, Y], [], []]);
  });
});

// ---- MaybeReachable domain (forward) ----------------------------------------------------------------------------

class MaybeInit extends AnalysisBase<MaybeReachable<DenseBitSet<number>>> {
  readonly Domain: Domain<MaybeReachable<DenseBitSet<number>>> = Domain_MaybeReachable(
    Domain_DenseBitSet(DebugWithContext_Local as never),
  );
  readonly NAME = "maybe_init";
  bottom_value(_body: Body): MaybeReachable<DenseBitSet<number>> {
    // bottom = unreachable
    return MaybeReachable.Unreachable();
  }
  initialize_start_block(_body: Body, state: MaybeReachable<DenseBitSet<number>>): void {
    MaybeReachable.assign(state, MaybeReachable.Reachable(DenseBitSet.new_empty(4)));
  }
  apply_primary_statement_effect(state: MaybeReachable<DenseBitSet<number>>, statement: Statement): void {
    GenKill_MaybeReachable(GenKill_DenseBitSet<number>()).gen_(state, payload(statement).def!);
  }
}

test("MaybeReachable: unreachable blocks stay Unreachable, reachable ones join", () => {
  const body = toy_body([
    [[{ def: 0 }], { $: "Switch", targets: [1], otherwise: 2 }],
    [[{ def: 1 }], { $: "Goto", target: 2 }],
    [[], { $: "Return" }],
    [[{ def: 3 }], { $: "Goto", target: 2 }], // unreachable
  ]);
  const results = new MaybeInit().iterate_to_fixpoint(tcx, body, undefined);
  const show = (s: MaybeReachable<DenseBitSet<number>>): string =>
    DebugWithContext_MaybeReachable(DebugWithContext_DenseBitSet(DebugWithContext_Local)).fmt_with(s as never, undefined, PLAIN);
  expect(results.entry_states.map(show)).toEqual(["{}", "{_0}", "{_0, _1}", "unreachable"]);
  // gen on an unreachable state is a no-op
  const u = MaybeReachable.Unreachable<DenseBitSet<number>>();
  GenKill_MaybeReachable(GenKill_DenseBitSet<number>()).gen_(u, 1);
  expect(u.$).toBe("Unreachable");
});

// ---- DebugWithContext (fmt.rs) and FlatSet (lattice.rs) ----------------------------------------------------------

test("DebugWithContext of bit sets: fmt_with and fmt_diff_with", () => {
  const d = DebugWithContext_DenseBitSet(DebugWithContext_Local);
  const a = DenseBitSet.new_empty<never>(5);
  const b = DenseBitSet.new_empty<never>(5);
  for (const i of [0, 2, 3]) a.insert(i as never);
  for (const i of [1, 2]) b.insert(i as never);
  expect(d.fmt_with(a, undefined, PLAIN)).toBe("{_0, _2, _3}");
  expect(d.fmt_with(a, undefined, PRETTY)).toBe("{\n    _0,\n    _2,\n    _3,\n}");
  expect(d.fmt_diff_with(a, b, undefined, PLAIN)).toBe("\u001f+_0, _3\t\u001f-_1");
  expect(d.fmt_diff_with(a, b, undefined, PRETTY)).toBe("\u001f+_0\n\u001f+_3\n\u001f-_1");
  expect(d.fmt_diff_with(a, a, undefined, PLAIN)).toBe("");
  const m = DebugWithContext_MaybeReachable(d);
  expect(m.fmt_diff_with(MaybeReachable.Unreachable(), MaybeReachable.Reachable(b), undefined, PLAIN)).toBe("\u001f+{_1, _2}");
  expect(m.fmt_diff_with(MaybeReachable.Reachable(a), MaybeReachable.Unreachable(), undefined, PLAIN)).toBe("\u001f-{_0, _2, _3}");
});

test("FlatSet join", () => {
  const j = JoinSemiLattice_FlatSet<number>(
    (a, b) => a === b,
    (v) => v,
  );
  const slot = { value: FlatSet.Bottom as FlatSet<number> };
  expect(j.join(slot, FlatSet.Bottom)).toBe(false);
  expect(j.join(slot, FlatSet.Elem(3))).toBe(true);
  expect(slot.value).toEqual(FlatSet.Elem(3));
  expect(j.join(slot, FlatSet.Elem(3))).toBe(false);
  expect(j.join(slot, FlatSet.Elem(4))).toBe(true);
  expect(slot.value).toBe(FlatSet.Top);
  expect(j.join(slot, FlatSet.Elem(5))).toBe(false);
});
