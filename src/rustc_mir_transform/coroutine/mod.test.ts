// Unit tests of coroutine/mod.rs's CFG helpers on hand-built bodies (lane mt-coroutine-a): `create_cases`,
// `insert_switch`, `generate_poison_block_and_redirect_unwinds_there` and `Operation`. Expectations follow upstream's
// code: a case block re-`StorageLive`s the storage-live locals that are neither remapped nor always live, moves the resume
// argument out of `CTX_ARG` unless it is `CTX_ARG` itself, and jumps to the operation's target; the switch reads the
// discriminant of `SELF_ARG` into a fresh local and the former entry block moves to the end; unwinding terminators
// without a cleanup target, and `UnwindResume`s, are pointed at a new cleanup block that poisons the state.
import { expect, test } from "bun:test";
import "../../rustc_session/lib.ts";
import "../../rustc_middle/lib.ts";
import "../lib.ts";
import { VariantIdx, FieldIdx } from "../../rustc_abi/layout.ts";
import { DenseBitSet } from "../../rustc_index/bit_set.ts";
import {
  BasicBlock,
  BasicBlockData,
  Body,
  Local,
  LocalDecl,
  SourceInfo,
  START_BLOCK,
  type Statement,
  TerminatorKind,
  UnwindAction,
} from "../../rustc_middle/mir/mod.ts";
import { Place_from_Local } from "../../rustc_middle/mir/statement.ts";
import { Terminator } from "../../rustc_middle/mir/terminator.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { CTX_ARG, create_cases, generate_poison_block_and_redirect_unwinds_there, insert_switch, Operation, SELF_ARG, TransformVisitor } from "./mod.ts";

const bb = (n: number): BasicBlock => BasicBlock.from_u32(n);
const local = (n: number): Local => Local.from_u32(n);
const set = (domain: number, xs: number[]): DenseBitSet<Local> => {
  const s = DenseBitSet.new_empty<Local>(domain);
  for (const x of xs) s.insert(local(x));
  return s;
};
// Neither helper reads a type: a stand-in object is enough for the locals' declarations.
const TY = { stand_in: "ty" } as unknown as Ty;

function body(blocks: [TerminatorKind, boolean][], n_locals: number): Body {
  const b = Body.new_cfg_only(blocks.map(([kind, is_cleanup]) => BasicBlockData.new(new Terminator(SourceInfo.outermost(DUMMY_SP), kind), is_cleanup)));
  for (let i = 0; i < n_locals; i++) b.local_decls.push(LocalDecl.new(TY, DUMMY_SP));
  return b;
}
const RET: TerminatorKind = { $: "Return" };

function transform(): TransformVisitor {
  const remap: ([Ty, VariantIdx, FieldIdx] | undefined)[] = [undefined, undefined, undefined, [TY, VariantIdx.from_u32(3), FieldIdx.from_u32(0)], undefined];
  return new TransformVisitor(
    undefined as unknown as TyCtxt,
    { $: "Coroutine", _0: "Movable" },
    TY,
    remap,
    [],
    [
      // a yield whose resume argument is `_4`, with `_2`, `_3` (remapped) and `_4` storage-live
      { state: 3, resume: bb(1), resume_arg: Place_from_Local(local(4)), drop: bb(2), storage_liveness: set(5, [2, 3, 4]) },
      // a yield resuming into `CTX_ARG` itself, without a drop edge
      { state: 4, resume: bb(2), resume_arg: Place_from_Local(CTX_ARG), drop: undefined, storage_liveness: set(5, [0, 1]) },
    ],
    set(5, [0, 1]),
    local(0),
    TY,
    TY,
    undefined,
  );
}

function kinds(stmts: Statement[]): string[] {
  return stmts.map((s) => {
    const k = s.kind;
    switch (k.$) {
      case "StorageLive":
        return `StorageLive(${k._0})`;
      case "Assign": {
        const [lhs, rv] = k._0;
        const rhs = rv.$ === "Use" ? `${rv._0.$}(${rv._0.$ === "Constant" ? "" : rv._0._0.local})` : rv.$ === "Discriminant" ? `discriminant(${rv._0.local})` : rv.$;
        return `_${lhs.local}${lhs.projection.length === 0 ? "" : "+proj"} = ${rhs}`;
      }
      case "SetDiscriminant":
        return `discriminant(_${k.place.local}) = ${k.variant_index}`;
      default:
        return k.$;
    }
  });
}

test("Operation: target block and resume place per operation", () => {
  const t = transform();
  const [p0, p1] = t.suspension_points as [never, never];
  expect(Operation.target_block(Operation.Resume, p0)).toBe(bb(1));
  expect(Operation.target_block(Operation.Drop, p0)).toBe(bb(2));
  expect(Operation.target_block(Operation.AsyncDrop, p1)).toBeUndefined();
  expect(Operation.resume_place(Operation.Resume, p0)!.local).toBe(local(4));
  expect(Operation.resume_place(Operation.AsyncDrop, p0)!.local).toBe(local(4));
  expect(Operation.resume_place(Operation.Drop, p0)).toBeUndefined();
});

test("create_cases: StorageLive of live, non-remapped, not-always-live locals; resume arg moved out of CTX_ARG", () => {
  const t = transform();
  const b = body([[RET, false], [RET, false], [RET, false]], 5);

  const resume = create_cases(b, t, Operation.Resume);
  expect(resume).toEqual([
    [3, bb(3)],
    [4, bb(4)],
  ]);
  const blocks = b.basic_blocks.deref();
  expect(kinds(blocks[3]!.statements)).toEqual(["StorageLive(2)", "StorageLive(4)", "_4 = Move(2)"]);
  expect(TerminatorKind.as_goto(blocks[3]!.terminator_().kind)).toBe(bb(1));
  // the resume argument is `CTX_ARG`: no self-assignment
  expect(kinds(blocks[4]!.statements)).toEqual([]);
  expect(TerminatorKind.as_goto(blocks[4]!.terminator_().kind)).toBe(bb(2));

  // `Drop` targets the drop edge and does not move the resume argument; the second point has no drop edge
  const drop = create_cases(b, t, Operation.Drop);
  expect(drop).toEqual([[3, bb(5)]]);
  expect(kinds(b.basic_blocks.deref()[5]!.statements)).toEqual(["StorageLive(2)", "StorageLive(4)"]);
  expect(TerminatorKind.as_goto(b.basic_blocks.deref()[5]!.terminator_().kind)).toBe(bb(2));
});

test("insert_switch: discriminant switch as the entry block, the former entry moved to the end", () => {
  const t = transform();
  const goto1: TerminatorKind = TerminatorKind.goto(bb(1));
  const b = body([[goto1, false], [RET, false], [{ $: "Unreachable" }, false]], 5);
  insert_switch(b, [[0, START_BLOCK], [3, bb(1)]], t, bb(2));

  const blocks = b.basic_blocks.deref();
  expect(blocks.length).toBe(4);
  // the discriminant goes into a fresh local (`_5`)
  expect(b.local_decls.length).toBe(6);
  expect(kinds(blocks[0]!.statements)).toEqual([`_5 = discriminant(${SELF_ARG})`]);
  const sw = blocks[0]!.terminator_().kind;
  if (sw.$ !== "SwitchInt") throw new Error(sw.$);
  expect(sw.discr.$).toBe("Move");
  expect(sw.targets.values).toEqual([0n, 3n]);
  // `START_BLOCK` in the cases now names the former entry (bb3); the default is last
  expect(sw.targets.targets).toEqual([bb(3), bb(1), bb(2)]);
  expect(blocks[3]!.terminator_().kind).toEqual(goto1 as never);
});

test("generate_poison_block_and_redirect_unwinds_there", () => {
  const t = transform();
  const drop = (target: number): TerminatorKind => ({
    $: "Drop",
    place: Place_from_Local(local(3)),
    target: bb(target),
    unwind: UnwindAction.Continue,
    replace: false,
    drop: undefined,
  });
  const b = body(
    [
      [drop(1), false],
      [{ $: "UnwindResume" }, true],
      [drop(1), true],
      [RET, false],
    ],
    5,
  );
  generate_poison_block_and_redirect_unwinds_there(t, b);
  const blocks = b.basic_blocks.deref();
  expect(blocks.length).toBe(5);
  // the poison block: `discriminant(_1) = 2; resume;`, a cleanup block
  expect(kinds(blocks[4]!.statements)).toEqual([`discriminant(_${SELF_ARG}) = 2`]);
  expect(blocks[4]!.terminator_().kind.$).toBe("UnwindResume");
  expect(blocks[4]!.is_cleanup).toBe(true);
  // an unwinding terminator without a cleanup target unwinds into it
  const k0 = blocks[0]!.terminator_().kind;
  expect(k0.$ === "Drop" ? k0.unwind : undefined).toEqual({ $: "Cleanup", _0: bb(4) } as never);
  // an existing `UnwindResume` jumps to it
  expect(TerminatorKind.as_goto(blocks[1]!.terminator_().kind)).toBe(bb(4));
  // cleanup blocks keep `Continue`
  const k2 = blocks[2]!.terminator_().kind;
  expect(k2.$ === "Drop" ? k2.unwind.$ : undefined).toBe("Continue");
  expect(blocks[3]!.terminator_().kind.$).toBe("Return");
});
