// Search graph oracle cases (lane tyir-solve; our own test helper, not a port).
//
// `gen(seed, n)` makes `n` small goal graphs (cycles of every `PathKind`, several candidates per goal, overflow
// through small root depths and `LowerAvailableDepth::No` edges, roots evaluated with `evaluate_goal` or
// `evaluate_root_goal_for_proof_tree`, inspect on/off, global cache validation scopes) in the line format read by oracle/main.rs. `run_case` runs a
// case through the TS port with the same fake `Cx` / `Delegate` as oracle/main.rs and returns its event trace.
//
// CLI:
//   bun src/rustc_type_ir/search_graph/oracle/cases.ts gen <seed> <n> > cases.txt
//   ./searchgraph < cases.txt > traces.txt            (the probe, see oracle/main.rs)
//   bun src/rustc_type_ir/search_graph/oracle/cases.ts fixture <seed> <n> traces.txt > fixture.txt
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { CandidateHeadUsages, type Cx, type Delegate, GlobalCache, type LowerAvailableDepth, type PathKind, SearchGraph } from "../mod.ts";
import { unwrap } from "../../../std/panic.ts";

// ---- case generation -----------------------------------------------------------------------------------------------

/** splitmix32-style PRNG (deterministic per seed). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

const BASES = [0, 1, 2, 3, 4, 100, 101, 105];

export function gen(seed: number, n: number): string[] {
  const r = rng(seed);
  const pick = (k: number): number => r() % k;
  const lines: string[] = [];
  for (let c = 0; c < n; c++) {
    const nnodes = 1 + pick(6);
    const root_depth = 1 + pick(7);
    // 0: inspect (no global cache), 1: no-op inspect, 2: no-op inspect + validation scope (global cache validated)
    const inspect_noop = [0, 2, 1, 1, 1, 1, 1, 1, 1, 1][pick(10)]!;
    const nroots = 1 + pick(4);
    const toks: number[] = [root_depth, inspect_noop, nroots];
    for (let i = 0; i < nroots; i++) toks.push(pick(nnodes), pick(5) === 0 ? 1 : 0);
    toks.push(nnodes);
    for (let i = 0; i < nnodes; i++) {
      toks.push(BASES[pick(BASES.length)]!, pick(3));
      const ncands = [0, 1, 1, 1, 2, 2, 3][pick(7)]!;
      toks.push(ncands);
      for (let j = 0; j < ncands; j++) {
        const nchildren = [0, 1, 1, 2, 2, 3][pick(6)]!;
        toks.push(nchildren);
        for (let k = 0; k < nchildren; k++) {
          // kind: mostly inductive / coinductive, sometimes unknown / forced ambiguity
          const kind = [0, 0, 0, 2, 2, 1, 3][pick(7)]!;
          const lower = pick(6) === 0 ? 0 : 1;
          toks.push(pick(nnodes), kind, lower);
        }
      }
    }
    lines.push(toks.join(" "));
  }
  return lines;
}

// ---- the fake Cx / Delegate (same as oracle/main.rs) ---------------------------------------------------------------

interface Node {
  base: number;
  op: number;
  cands: [number, PathKind, LowerAvailableDepth][][];
}

interface FakeCxValue {
  graph: Node[];
  cache: GlobalCache<FakeX>;
  trace: string[];
  validate: boolean;
}

interface FakeX {
  Self: FakeCxValue;
  Input: number;
  Result: number;
  AmbiguityKind: number;
  DepNodeIndex: null;
  Tracked: number;
}

interface FakeD {
  Cx: FakeX;
  ValidationScope: null;
  ProofTreeBuilder: { noop: boolean };
}

const FakeCx: Cx<FakeX> = {
  debug_Input: (v) => String(v),
  debug_Result: (v) => String(v),
  Result_eq: (a, b) => a === b,
  AmbiguityKind_eq: (a, b) => a === b,
  mk_tracked: (_self, data) => data as number,
  get_tracked: <T>(_self: FakeCxValue, tracked: number) => tracked as T,
  with_cached_task: (_self, task) => [task(), null],
  with_global_cache: (self, f) => f(self.cache),
  assert_evaluation_is_concurrent: () => {},
};

function combine(op: number, acc: number, r: number): number {
  switch (op) {
    case 0:
      return Math.min(acc, r);
    case 1:
      return Math.max(acc, r);
    default:
      return (acc + r) % 5;
  }
}

const FakeDelegate: Delegate<FakeD> = {
  Cx: FakeCx,
  ENABLE_PROVISIONAL_CACHE: true,
  enter_validation_scope: (cx) => (cx.validate ? null : undefined),
  FIXPOINT_STEP_LIMIT: 3,
  inspect_is_noop: (inspect) => inspect.noop,
  DIVIDE_AVAILABLE_DEPTH_ON_OVERFLOW: 2,
  initial_provisional_result: (_cx, kind) => {
    switch (kind) {
      case "Inductive":
        return 100;
      case "Coinductive":
        return 101;
      case "Unknown":
      case "ForcedAmbiguity":
        return 102;
    }
  },
  is_initial_provisional_result: (result) =>
    result === 100 ? "Inductive" : result === 101 ? "Coinductive" : result === 102 ? "Unknown" : undefined,
  stack_overflow_result: () => 103,
  FIXPOINT_OVERFLOW_AMBIGUITY_KIND: 4,
  fixpoint_overflow_result: () => 104,
  is_ambiguous_result: (result) => (result >= 102 && result <= 105 ? result - 100 : undefined),
  compute_goal(search_graph, cx, input, inspect) {
    cx.trace.push(`C${input}`);
    const node = cx.graph[input]!;
    let best: number | undefined;
    let kept: CandidateHeadUsages | undefined;
    for (const cand of node.cands) {
      search_graph.enter_single_candidate();
      let acc = node.base;
      for (const [child, kind, lower] of cand) {
        const r = search_graph.evaluate_goal(cx, child, kind, lower, inspect);
        cx.trace.push(`${child}=${r}`);
        acc = combine(node.op, acc, r);
      }
      const usages = search_graph.finish_single_candidate();
      if (best === undefined) {
        best = acc;
        kept = usages;
      } else if (acc > best) {
        search_graph.ignore_candidate_head_usages(unwrap(kept));
        best = acc;
        kept = usages;
      } else if (acc === best) {
        unwrap(kept).merge_usages(usages);
      } else {
        search_graph.ignore_candidate_head_usages(usages);
      }
    }
    const result = best ?? node.base;
    cx.trace.push(`=${result}`);
    return result;
  },
};

const KINDS: PathKind[] = ["Inductive", "Unknown", "Coinductive", "ForcedAmbiguity"];

/** Runs one case line through the TS search graph; returns the trace (oracle/main.rs prints the same). */
export function run_case(line: string): string {
  const toks = line.trim().split(/\s+/).map(Number);
  let p = 0;
  const next = (): number => toks[p++]!;
  const root_depth = next();
  const flag = next();
  const inspect_noop = flag >= 1;
  const validate = flag === 2;
  const nroots = next();
  const roots: [number, number][] = [];
  for (let i = 0; i < nroots; i++) roots.push([next(), next()]);
  const nnodes = next();
  const graph: Node[] = [];
  for (let i = 0; i < nnodes; i++) {
    const base = next();
    const op = next();
    const ncands = next();
    const cands: Node["cands"] = [];
    for (let j = 0; j < ncands; j++) {
      const nchildren = next();
      const children: Node["cands"][number] = [];
      for (let k = 0; k < nchildren; k++) {
        const child = next();
        const kind = KINDS[next()]!;
        const lower: LowerAvailableDepth = next() === 1 ? "Yes" : "No";
        children.push([child, kind, lower]);
      }
      cands.push(children);
    }
    graph.push({ base, op, cands });
  }
  const cx: FakeCxValue = { graph, cache: GlobalCache.default_(), trace: [], validate };
  for (const [root, mode] of roots) {
    const inspect = { noop: inspect_noop };
    if (mode === 0) {
      const sg = SearchGraph.new<FakeD>(FakeDelegate, root_depth);
      const r = sg.evaluate_goal(cx, root, "Inductive", "Yes", inspect);
      if (!sg.is_empty()) throw new Error("search graph not empty after a root goal");
      cx.trace.push(`R${root}=${r}`);
    } else {
      const [r, d] = SearchGraph.evaluate_root_goal_for_proof_tree<FakeD>(FakeDelegate, cx, root_depth, root, inspect);
      cx.trace.push(`P${root}=${r}/${d}`);
    }
  }
  return cx.trace.join(" ");
}

export function trace_hash(trace: string): string {
  return createHash("sha256").update(trace).digest("hex").slice(0, 16);
}

if (import.meta.main) {
  const [cmd, seed, n, traces] = process.argv.slice(2);
  if (cmd === "gen") {
    process.stdout.write(gen(Number(seed), Number(n)).join("\n") + "\n");
  } else if (cmd === "fixture") {
    const lines = readFileSync(unwrap(traces), "utf8").split("\n").filter((l) => l !== "");
    if (lines.length !== Number(n)) throw new Error(`ERROR: ${lines.length} traces for ${n} cases`);
    process.stdout.write(`# search graph oracle: sha256[0..16] of oracle/main.rs's trace for gen(${seed}, ${n})\n`);
    process.stdout.write(`# seed ${seed} n ${n}\n`);
    process.stdout.write(lines.map(trace_hash).join("\n") + "\n");
  } else {
    console.log("ERROR: usage: cases.ts gen <seed> <n> | fixture <seed> <n> <traces.txt>");
    process.exit(2);
  }
}
