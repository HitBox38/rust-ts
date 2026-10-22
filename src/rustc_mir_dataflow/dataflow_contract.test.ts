// The dataflow contract (lane dataflow-contract, docs/handoff/dataflow-contract.md, plan-m4 D5) against upstream:
// - every fn of compiler/rustc_mir_dataflow is either ported (a `// rustc:` marker) or declared (a `// stub: <path>:<line>
//   <name> (lane <lane>)` comment over a declaration whose body calls `unported(..)` with a path in the fn's own
//   module), never both; the framework (framework/{mod, cursor, direction, fmt, lattice, results, visitor, tests}.rs) and
//   lib.rs have no stubs;
// - the crate root loads, the stubs stop as UNPORTED at runtime (representative calls), and `iterate_to_fixpoint` under
//   `-Zdump-mir-dataflow` reaches the graphviz stub;
// - the pending stand-ins (../pending.ts) behave as upstream's `DenseBitSet` / `MixedBitSet` methods.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { upstreamFns } from "../../scripts/coverage.ts";
import { REPO } from "../../scripts/lib/common.ts";
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { Unported } from "../std/panic.ts";
import { drop_flag_effects_for_location, DropFlagState } from "./drop_flag_effects.ts";
import { DebugWithContext_Local } from "./framework/fmt.ts";
import { write_graphviz_results } from "./framework/graphviz.ts";
import { AnalysisBase, type Domain, Domain_DenseBitSet } from "./framework/mod.ts";
import * as lib from "./lib.ts";
import { MaybeLiveLocals } from "./impls/liveness.ts";
import { MoveData, MovePath, MovePathIndex } from "./move_paths/mod.ts";
import { mir_pretty_extra_data } from "./pretty.ts";
import { sanity_check } from "./rustc_peek.ts";
import { type BasicBlock, type Body, DenseBitSet_eq, MixedBitSet } from "./pending.ts";

const CRATE = "compiler/rustc_mir_dataflow/src";
const FILES: string[] = [
  "lib.rs",
  "debuginfo.rs",
  "diagnostics.rs",
  "drop_flag_effects.rs",
  "framework/cursor.rs",
  "framework/direction.rs",
  "framework/fmt.rs",
  "framework/graphviz.rs",
  "framework/lattice.rs",
  "framework/mod.rs",
  "framework/results.rs",
  "framework/tests.rs",
  "framework/visitor.rs",
  "impls/borrowed_locals.rs",
  "impls/initialized.rs",
  "impls/liveness.rs",
  "impls/mod.rs",
  "impls/precise_liveness.rs",
  "impls/storage_liveness.rs",
  "move_paths/builder.rs",
  "move_paths/mod.rs",
  "points.rs",
  "pretty.rs",
  "rustc_peek.rs",
  "un_derefer.rs",
  "value_analysis.rs",
];
/** Files ported in full by this lane. */
const PORTED = [
  "lib.rs",
  "framework/cursor.rs",
  "framework/direction.rs",
  "framework/fmt.rs",
  "framework/lattice.rs",
  "framework/mod.rs",
  "framework/results.rs",
  "framework/tests.rs",
  "framework/visitor.rs",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

interface Decl {
  file: string;
  path: string;
  line: number;
  name: string;
  lane: string | undefined;
  /** the `unported("..")` path of the body below a stub */
  unported: string | undefined;
}
const markers: Decl[] = [];
const stubs: Decl[] = [];
for (const f of walk(join(REPO, "src"))) {
  const lines = readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /\/\/ (rustc|stub): (\S+):(\d+) (\w+)(?: \(lane ([\w-]+)\))?/.exec(lines[i]!);
    if (!m || !m[2]!.startsWith(CRATE)) continue;
    const d: Decl = { file: relative(REPO, f), path: m[2]!, line: Number(m[3]), name: m[4]!, lane: m[5], unported: undefined };
    if (m[1] === "rustc") {
      markers.push(d);
      continue;
    }
    for (let j = i + 1; j < Math.min(lines.length, i + 16); j++) {
      if (/\/\/ (rustc|stub): /.test(lines[j]!)) break;
      const u = /unported\(["`]([^"`]+)["`]/.exec(lines[j]!);
      if (u) {
        d.unported = u[1];
        break;
      }
    }
    stubs.push(d);
  }
}

/** `impls/initialized.rs` -> `rustc_mir_dataflow::impls::initialized` (`lib.rs` / `mod.rs` name their directory). */
function module_of(file: string): string {
  const parts = file.replace(/\.rs$/, "").split("/");
  if (parts[parts.length - 1] === "mod" || parts[parts.length - 1] === "lib") parts.pop();
  return ["rustc_mir_dataflow", ...parts].join("::");
}

const LANES = ["dataflow-move-paths", "dataflow-impls", "dataflow-graphviz", "mt-opt2-a"];

test("every fn of rustc_mir_dataflow is ported or declared as a stub, never both", () => {
  let total = 0;
  for (const file of FILES) {
    const path = `${CRATE}/${file}`;
    const fns = upstreamFns(path);
    total += fns.length;
    for (const fn of fns) {
      const key = `${fn.path}:${fn.line} ${fn.name}`;
      const m = markers.filter((d) => d.path === fn.path && d.line === fn.line && d.name === fn.name);
      const s = stubs.filter((d) => d.path === fn.path && d.line === fn.line && d.name === fn.name);
      expect(`${key}: ${m.length + s.length}`).toBe(`${key}: 1`);
      for (const d of s) {
        // the stub's body stops with a path in the fn's own module, and names a fill lane
        expect(`${key}: ${d.unported?.startsWith(module_of(file)) ?? "no unported(..)"}`).toBe(`${key}: true`);
        expect(`${key}: ${LANES.includes(d.lane ?? "")}`).toBe(`${key}: true`);
      }
    }
    // a stub or marker names an upstream fn of the file
    for (const d of [...stubs, ...markers].filter((d) => d.path === path)) {
      expect(`${d.path}:${d.line} ${d.name}: ${fns.some((fn) => fn.line === d.line && fn.name === d.name)}`).toBe(
        `${d.path}:${d.line} ${d.name}: true`,
      );
    }
    if (PORTED.includes(file)) expect(`${file}: ${stubs.filter((d) => d.path === path).length} stubs`).toBe(`${file}: 0 stubs`);
  }
  // nothing outside the crate's files
  for (const d of [...stubs, ...markers]) expect(FILES.some((f) => `${CRATE}/${f}` === d.path)).toBe(true);
  expect(total).toBe(378);
  expect(markers.length).toBe(109);
  expect(stubs.length).toBe(269);
});

test("the crate root loads and re-exports the framework", () => {
  expect(typeof lib.provide).toBe("function");
  expect(lib.Forward.IS_FORWARD).toBe(true);
  expect(lib.Backward.IS_BACKWARD).toBe(true);
  expect(typeof lib.visit_results).toBe("function");
  expect(typeof lib.move_paths.MoveData).toBe("function");
});

/** `bb0: return` (pending mir-contract stand-ins). */
function one_block_body(): Body {
  const data = { statements: [], terminator: () => ({ edges: () => ({ $: "None" as const }) }) };
  return {
    basic_blocks: { len: () => 1, predecessors: () => [[]], reverse_postorder: () => [0 as BasicBlock] },
    index: () => data,
    terminator_loc: (bb) => ({ block: bb, statement_index: 0 }),
  };
}

function stops(f: () => unknown, what: string): void {
  let err: unknown;
  try {
    f();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Unported);
  expect((err as Unported).what).toBe(what);
}

test("stubs stop as UNPORTED in their own module", () => {
  const tcx = {} as TyCtxt;
  const body = {} as Body;
  stops(() => MoveData.gather_moves(body, tcx, () => true), "rustc_mir_dataflow::move_paths::MoveData::gather_moves");
  stops(
    () => new MovePath(undefined, undefined, undefined, {} as never).find_descendant([], () => true),
    "rustc_mir_dataflow::move_paths::MovePath::find_descendant",
  );
  stops(() => MovePathIndex.Atom.index(MovePathIndex.from_u32(0)), "rustc_mir_dataflow::move_paths::MovePathIndex::Atom::index");
  stops(
    () => drop_flag_effects_for_location(body, {} as MoveData, { block: 0 as BasicBlock, statement_index: 0 }, () => {}),
    "rustc_mir_dataflow::drop_flag_effects::drop_flag_effects_for_location",
  );
  stops(() => DropFlagState.value("Present"), "rustc_mir_dataflow::drop_flag_effects::DropFlagState::value");
  stops(() => write_graphviz_results(tcx, body, {} as never, undefined), "rustc_mir_dataflow::framework::graphviz::write_graphviz_results");
  // an analysis declared by the contract runs the framework up to its first stub
  stops(() => new MaybeLiveLocals().iterate_to_fixpoint(tcx, one_block_body(), undefined), "rustc_mir_dataflow::impls::liveness::MaybeLiveLocals::bottom_value");
  expect(new MaybeLiveLocals().Direction.IS_BACKWARD).toBe(true);
  stops(() => sanity_check(tcx, body), "rustc_mir_dataflow::rustc_peek::sanity_check");
  stops(() => mir_pretty_extra_data(tcx, body), "rustc_mir_dataflow::pretty::mir_pretty_extra_data");
});

class Empty extends AnalysisBase<DenseBitSet<number>> {
  readonly Domain: Domain<DenseBitSet<number>> = Domain_DenseBitSet(DebugWithContext_Local as never);
  readonly NAME = "empty";
  bottom_value(_body: Body): DenseBitSet<number> {
    return DenseBitSet.new_empty(1);
  }
  initialize_start_block(): void {}
  apply_primary_statement_effect(): void {}
}

test("iterate_to_fixpoint under -Zdump-mir-dataflow reaches the graphviz stub", () => {
  const body = one_block_body();
  const tcx = (dump: boolean) => ({ sess: { opts: { unstable_opts: { dump_mir_dataflow: dump } } } }) as unknown as TyCtxt;
  expect(new Empty().iterate_to_fixpoint(tcx(false), body, undefined).entry_states.length).toBe(1);
  stops(() => new Empty().iterate_to_fixpoint(tcx(true), body, "pass"), "rustc_mir_dataflow::framework::graphviz::write_graphviz_results");
});

test("pending index-ds stand-ins behave as upstream", () => {
  const a = DenseBitSet.new_empty<number>(130);
  const b = DenseBitSet.new_empty<number>(130);
  for (const i of [3, 64, 129]) a.insert(i);
  for (const i of [3, 70]) b.insert(i);
  expect(a.first_set_at_or_after(4)).toBe(64);
  expect(a.first_set_at_or_after(65)).toBe(129);
  expect(b.first_set_at_or_after(71)).toBe(undefined);
  expect(a.union(b)).toBe(true);
  expect(a.union(b)).toBe(false);
  expect([...a.iter()]).toEqual([3, 64, 70, 129]);
  const c = a.clone();
  expect(DenseBitSet_eq(a, c)).toBe(true);
  c.remove(3);
  expect(DenseBitSet_eq(a, c)).toBe(false);
  b.clone_from(c);
  expect([...b.iter()]).toEqual([64, 70, 129]);
  expect(a.subtract(b)).toBe(true);
  expect([...a.iter()]).toEqual([3]);
  // MixedBitSet: Small up to CHUNK_BITS (2048), Large (ChunkedBitSet) pending index-ds
  const m = MixedBitSet.new_empty<number>(2048);
  expect(m.$).toBe("Small");
  expect(MixedBitSet.insert(m, 2047)).toBe(true);
  expect(MixedBitSet.contains(m, 2047)).toBe(true);
  stops(() => MixedBitSet.new_empty(2049), "rustc_index::bit_set::ChunkedBitSet (pending index-ds)");
});
