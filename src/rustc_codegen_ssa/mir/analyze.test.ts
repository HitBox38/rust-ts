// Tests of lane ssa-mir-core: mir/analyze.rs (`non_ssa_locals`, `cleanup_kinds`) and mir/mod.rs (`codegen_mir`'s local
// allocation and block order) over real MIR bodies, through the real driver (analyze_oracle/driver.ts runs `codegen_mir`
// over a mock backend after `analysis`).
//
// Where the expected values come from:
// 1. The oracle. With names kept (`--emit=llvm-ir` keeps them), upstream's `debug_introduce_local` names every local's
//    value after its `VarDebugInfo` (or `_N`), so at -C opt-level=0 with -C no-prepopulate-passes a local that
//    `non_ssa_locals` put in memory is exactly a `%<name> = alloca` of its fn (the fixtures pass no argument indirectly,
//    the one case where a memory local has no alloca). On x86_64-pc-windows-msvc, `landing_pad_for_uncached`
//    (block.rs) appends `funclet_bbN` exactly for the blocks `cleanup_kinds` marks `Funclet` that an unwind edge reaches.
//    And a fn gets a `personality` iff `codegen_mir` called `set_personality_fn`. analyze_oracle/oracle.json holds
//    these facts, read off the pinned nightly's IR (`REGEN=1 bun test <this file>` rewrites it).
// 2. The source. `HAND` below derives each fn's memory locals, and `cleanup_kinds` of the msvc fixture, from the rules in
//    analyze.rs and the -O0 MIR (`rustc -Copt-level=0 --emit=mir`), rule by rule.
//
// Skips (visibly) if the pinned rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO } from "../../../scripts/lib/common.ts";
import type { MockResult } from "./analyze_oracle/mock.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const DIR = join(import.meta.dir, "analyze_oracle");
const RUSTC = ["rustc", `+${PIN.toolchain}`];
const WORK = join(DATA, "tmp", "ssa-mir-core-analyze", process.env.RUST_TS_AGENT ?? "default");
const ENV = { ...process.env, RUSTC_ICE: "0" };

function sysrootOrUndefined(): string | undefined {
  try {
    if (!Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`)) return undefined;
    return Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim();
  } catch {
    return undefined;
  }
}
const SYSROOT = sysrootOrUndefined();
const SKIP = SYSROOT === undefined && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const LOCALS_ARGS = ["--edition=2021", "-Copt-level=0", "-Awarnings"];
const FUNCLETS_ARGS = ["--target", "x86_64-pc-windows-msvc", "--edition=2021", "-Copt-level=0", "-Cpanic=unwind", "-Awarnings"];

interface OracleFacts {
  allocas: Record<string, string[]>;
  funclets: Record<string, number[]>;
  personality: string[];
}
interface Oracle {
  locals: OracleFacts;
  funclets: OracleFacts;
}

/** Facts read off one oracle IR file (header, point 1). */
function facts(ll: string): OracleFacts {
  const out: OracleFacts = { allocas: {}, funclets: {}, personality: [] };
  let fn: string | undefined;
  for (const l of ll.split("\n")) {
    const d = /^define .*?@([A-Za-z_][A-Za-z0-9_]*)\(/.exec(l);
    if (d !== undefined && d !== null) {
      fn = d[1]!.startsWith("_R") ? undefined : d[1]!;
      if (fn !== undefined) {
        out.allocas[fn] = [];
        out.funclets[fn] = [];
        if (/ personality /.test(l)) out.personality.push(fn);
      }
      continue;
    }
    if (fn === undefined) continue;
    const a = /^\s+%([A-Za-z_][A-Za-z0-9_.]*) = alloca /.exec(l);
    if (a !== null) out.allocas[fn]!.push(a[1]!);
    const f = /^funclet_bb(\d+):/.exec(l);
    if (f !== null) out.funclets[fn]!.push(Number(f[1]));
  }
  for (const k of Object.keys(out.allocas)) out.allocas[k]!.sort();
  for (const k of Object.keys(out.funclets)) out.funclets[k]!.sort((x, y) => x - y);
  out.personality.sort();
  return out;
}

if (REGEN) {
  mkdirSync(WORK, { recursive: true });
  const ir = (file: string, args: string[]): string => {
    const out = join(WORK, `${file}.ll`);
    const r = Bun.spawnSync([...RUSTC, join(DIR, file), ...args, "-Cno-prepopulate-passes", "--emit=llvm-ir", "-o", out], { cwd: WORK, env: ENV, stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`ERROR: oracle rustc ${file} exit ${r.exitCode}: ${r.stderr.toString()}`);
    const text = readFileSync(out, "utf8");
    rmSync(out, { force: true });
    return text;
  };
  const oracle: Oracle = { locals: facts(ir("locals.rs", LOCALS_ARGS)), funclets: facts(ir("funclets.rs", FUNCLETS_ARGS)) };
  writeFileSync(join(DIR, "oracle.json"), `${JSON.stringify(oracle, null, 1)}\n`);
}
const ORACLE = JSON.parse(readFileSync(join(DIR, "oracle.json"), "utf8")) as Oracle;

function run_driver(file: string, args: string[]): Map<string, MockResult> {
  mkdirSync(WORK, { recursive: true });
  const out = join(WORK, `driver-${process.pid}-${file}.jsonl`);
  rmSync(out, { force: true });
  const r = Bun.spawnSync([process.execPath, join(DIR, "driver.ts"), join(DIR, file), ...args, "--sysroot", SYSROOT ?? ""], {
    cwd: WORK,
    env: { ...ENV, RUST_TS_SSA_OUT: out },
    stdout: "pipe",
    stderr: "pipe",
  });
  const lines = readFileSync(out, "utf8").split("\n").filter((l) => l !== "");
  rmSync(out, { force: true });
  if (r.exitCode !== 0 || !lines.some((l) => l === '{"kind":"DONE"}')) {
    throw new Error(`ERROR: driver ${file} exit ${r.exitCode}: ${r.stderr.toString().slice(0, 2000)}`);
  }
  const m = new Map<string, MockResult>();
  for (const l of lines) {
    const o = JSON.parse(l) as MockResult | { kind: "DONE" };
    if (o.kind === "FN") m.set(o.name, o);
  }
  return m;
}

/** The memory locals of one fn, by their IR names. */
const memory_names = (r: MockResult): string[] => r.non_ssa.map((l) => r.names[l]!).sort();

// Memory locals derived from the source (header, point 2). The -O0 MIR locals are given as `name (_N)`.
const HAND: Record<string, string[]> = {
  // `s` and `t` are each assigned once (SSA); the checked add/mul temporaries `_4`, `_5` (`(u32, bool)`, a scalar pair)
  // are read only through `Field` projections (`move (_4.0: u32)`, `!move (_4.1: bool)`), which `process_place` walks
  // with `layout.field` and then treats as a `Copy`/`Move` dominated by the definition: nothing is memory.
  scalars: [],
  // `_3 = &_2` is a `SharedBorrow` of `x` (`_2`): memory. `r` (`_3`) is read through `Deref`, a read of the pointer.
  borrowed: ["x"],
  // `(_2.1: u32) = copy _1` is a `MutatingUse(Store)` with a projection, so `p` (`_2`) becomes memory
  // (`MutatingUseContext::Projection`).
  mutated_field: ["p"],
  // `p` (`_3`) is defined once and read through `Field` projections only: SSA.
  read_fields: [],
  // `bg` (`_3`, `Big`) and the array temporary `_4` (`[u64; 8]`) have `BackendRepr::Memory`, so `define` puts them in
  // memory at their first assignment.
  big: ["_4", "bg"],
  // `n` (`_2`, `Noisy`) is dropped (`drop(_2)`) and `Noisy` needs drop: memory.
  dropper: ["n"],
  // `y` (`_3`) is assigned on both arms: the second `define` turns `SSA` into `Memory`.
  branches: ["y"],
  // `s` (`_2`) and `i` (`_3`) are reassigned in the loop body: memory.
  loop_sum: ["i", "s"],
  // `_0` is assigned on both arms (memory). `o` (`_1`, `Option<u32>`) is read as `((_1 as Some).0: u32)`: a `Downcast`
  // of a layout with `Variants::Multiple` is not one `process_place` accepts, so `o` is memory.
  opt: ["_0", "o"],
  // `_1` (`()`, a ZST) is borrowed (`&_1`): `SharedBorrow` sets `Memory` even for a ZST (an empty alloca).
  unit_borrow: ["_1"],
  // One definition of the return place; the argument is read by `Copy`.
  tuple_ret: [],
  // `k` (`_2`) is a call destination (`MutatingUse(Call)`, `DefLocation::CallReturn`) whose callee is
  // `core::hint::black_box`, a plain fn (not the intrinsic), and its read in the return block is dominated by the call's
  // target: SSA.
  call_result: [],
};

// `cleanup_kinds` of the msvc fixture, from its -O0 MIR (header, point 2).
const HAND_CLEANUP: Record<string, string[]> = {
  // No unwind edge to a cleanup block.
  plain: ["NotCleanup", "NotCleanup"],
  // bb0's call unwinds to bb3 (`discover_masters`: Funclet); bb3's successor bb4 (resume) is `NotCleanup` and becomes
  // `Internal { funclet: bb3 }` in `propagate`.
  one: ["NotCleanup", "NotCleanup", "NotCleanup", "Funclet", "Internal(3)"],
  // bb0's call unwinds to bb4 and bb1's `drop(_3)` to bb5: both Funclets. In reverse postorder bb4 (funclet bb4) reaches
  // bb5, a Funclet != bb4, so `set_successor(bb4, bb5)`; bb5 reaches bb6, which becomes `Internal { funclet: bb5 }`.
  two: ["NotCleanup", "NotCleanup", "NotCleanup", "NotCleanup", "Funclet", "Funclet", "Internal(5)"],
  // Both calls (bb1, bb2) unwind to bb5 (Funclet); bb5's `drop(_3)` returns to bb6 (resume), `Internal { funclet: bb5 }`.
  branchy: ["NotCleanup", "NotCleanup", "NotCleanup", "NotCleanup", "NotCleanup", "Funclet", "Internal(5)", "NotCleanup", "NotCleanup"],
};

describe.skipIf(SKIP)("non_ssa_locals and codegen_mir's locals (host target, locals.rs)", () => {
  const results = SKIP ? new Map<string, MockResult>() : run_driver("locals.rs", LOCALS_ARGS);

  test("every #[no_mangle] fn of the fixture ran", () => {
    expect([...results.keys()].sort()).toEqual(Object.keys(HAND).sort());
    expect(Object.keys(ORACLE.locals.allocas).sort()).toEqual(Object.keys(HAND).sort());
  });

  for (const name of Object.keys(HAND)) {
    test(`${name}: memory locals = the oracle's named allocas = the hand derivation`, () => {
      const r = results.get(name)!;
      const local_names = new Set(r.names);
      const oracle = ORACLE.locals.allocas[name]!.filter((n) => local_names.has(n)).sort();
      expect(memory_names(r)).toEqual(oracle);
      expect(memory_names(r)).toEqual([...HAND[name]!].sort());
    });
  }

  test("codegen_mir gives memory locals a place and every other local an operand (no indirect args here)", () => {
    for (const r of results.values()) {
      const places = r.locals.flatMap((k, i) => (k === "Place" || k === "UnsizedPlace" ? [i] : []));
      expect({ name: r.name, places }).toEqual({ name: r.name, places: r.non_ssa });
      // ZST non-memory locals are `Operand(zero_sized)` at once; others wait for their definition.
      for (let i = 0; i < r.locals.length; i++) {
        if (!r.non_ssa.includes(i)) expect(["Operand", "PendingOperand"]).toContain(r.locals[i]!);
      }
    }
  });

  test("allocas: one per memory local, in local order, with the local's size (after the args' get_param calls)", () => {
    const b = results.get("big")!;
    expect(b.calls.filter((c) => c.startsWith("alloca") || c.startsWith("get_param"))).toEqual(["get_param 0", "get_param 1", "alloca 64", "alloca 64"]);
    // `opt`'s `o` (`Option<u32>`, passed as a `Pair`) is a memory argument: `arg_local_refs` allocas it and stores the
    // argument (`store_fn_arg` from `llarg_idx` 0) before the vars and temps are allocated (`_0`, size 4, is the return
    // place, allocated first by `codegen_mir` but after `arg_local_refs` runs).
    const o = results.get("opt")!;
    expect(o.calls.filter((c) => c.startsWith("alloca") || c.startsWith("store_fn_arg"))).toEqual(["alloca 8", "store_fn_arg 0", "alloca 4"]);
  });

  test("block creation and order: one `start` block from append_block, then codegen_block in a dominance-respecting order", () => {
    for (const r of results.values()) {
      expect(r.calls[0]).toBe(`append_block fn:${r.name} start`);
      expect(r.calls[1]).toBe("build llbb0:start");
      expect(r.calls.filter((c) => c.startsWith("append_block")).length).toBe(1);
      const order = r.calls.filter((c) => c.startsWith("codegen_block ")).map((c) => Number(c.split(" ")[1]));
      const unreached = r.calls.filter((c) => c.startsWith("codegen_block_as_unreachable")).map((c) => Number(c.split(" ")[1]));
      // Every block is generated exactly once, reachable ones first, starting with bb0.
      expect([...order, ...unreached].sort((x, y) => x - y)).toEqual(r.succs.map((_, i) => i));
      expect(order[0]).toBe(0);
      // Reverse postorder: every block but bb0 comes after one of its predecessors.
      for (let k = 1; k < order.length; k++) {
        const bb = order[k]!;
        expect({ bb, has_earlier_pred: order.slice(0, k).some((p) => r.succs[p]!.includes(bb)) }).toEqual({ bb, has_earlier_pred: true });
      }
    }
    // `branches`: bb0 switches to bb2 (else arm) / bb1 (then arm); bb2 asserts to bb3; bb1 and bb3 go to bb4.
    expect(results.get("branches")!.calls.filter((c) => c.startsWith("codegen_block")).map((c) => c.split(" ")[1])).toEqual(["0", "2", "3", "1", "4"]);
  });

  test("set_personality_fn iff a reachable block is cleanup (the oracle's `personality` fns)", () => {
    const with_personality = [...results.values()].filter((r) => r.calls.some((c) => c.startsWith("set_personality_fn"))).map((r) => r.name).sort();
    expect(with_personality).toEqual(ORACLE.locals.personality);
  });

  test("no cleanup_kinds on a target without the new EH instructions", () => {
    for (const r of results.values()) expect(r.cleanup_kinds).toBeUndefined();
  });
});

describe.skipIf(SKIP)("cleanup_kinds (x86_64-pc-windows-msvc, funclets.rs)", () => {
  const results = SKIP ? new Map<string, MockResult>() : run_driver("funclets.rs", FUNCLETS_ARGS);

  for (const name of Object.keys(HAND_CLEANUP)) {
    test(`${name}: Funclet blocks = the oracle's funclet_bbN; the whole result = the hand derivation`, () => {
      const r = results.get(name)!;
      const funclets = r.cleanup_kinds!.flatMap((k, i) => (k === "Funclet" ? [i] : []));
      expect(funclets).toEqual(ORACLE.funclets.funclets[name]!);
      expect(r.cleanup_kinds).toEqual(HAND_CLEANUP[name]!);
    });
  }

  test("memory locals match the oracle's allocas here too, and personality as the oracle", () => {
    for (const r of results.values()) {
      const local_names = new Set(r.names);
      expect({ name: r.name, mem: memory_names(r) }).toEqual({ name: r.name, mem: ORACLE.funclets.allocas[r.name]!.filter((n) => local_names.has(n)).sort() });
    }
    const with_personality = [...results.values()].filter((r) => r.calls.some((c) => c.startsWith("set_personality_fn"))).map((r) => r.name).sort();
    expect(with_personality).toEqual(ORACLE.funclets.personality);
  });
});
