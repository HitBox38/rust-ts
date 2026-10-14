// rust-ts: `TransitiveRelation`, `Sccs` and `VecGraph` against the oracle. graph_oracle.json is the output of
// `graphprobe` (src/rustc_data_structures/graph_probe/main.rs, a rustc-dev probe built against the pinned nightly):
// for a battery of deterministic graphs, what the pinned rustc_data_structures computes. The relation cases check the
// element order, the base-edge order (`FxHashSet<Edge>` bucket order, which `Assumptions::new` and `maybe_map` depend
// on), `{:?}` / `{:#?}` and the lattice queries; the SCC cases check SCC numbering, successors, `reverse` and the
// `VecGraph` / DFS orders.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLAIN, PRETTY } from "../std/fmt.ts";
import { depth_first_search, depth_first_search_as_undirected, DirectedGraph_provided } from "./graph/mod.ts";
import { post_order_from } from "./graph/iterate/mod.ts";
import { Sccs } from "./graph/scc/mod.ts";
import { VecGraph } from "./graph/vec_graph/mod.ts";
import { debug_TransitiveRelation, debug_TransitiveRelationBuilder, TransitiveRelationBuilder } from "./transitive_relation.ts";

interface RelationCase {
  name: string;
  edges: [number, number][];
  elements: number[];
  base_edges: [number, number][];
  mapped_elements: number[];
  mapped_base_edges: [number, number][];
  none_map: boolean;
  builder_debug: string;
  debug: string | null;
  debug_alt: string | null;
  mubs: number[][];
  pdub: (number | null)[];
  parents: number[][];
  reachable: number[][];
  reps: number[];
  contains: (0 | 1)[];
}

interface SccCase {
  name: string;
  num_nodes: number;
  edges: [number, number][];
  scc_indices: number[];
  scc_successors: number[][];
  reverse_successors: number[][];
  successors: number[][];
  predecessors: number[][];
  dfs: number[];
  dfs_undirected: number[];
  post_order: number[];
}

const oracle = JSON.parse(readFileSync(join(import.meta.dir, "graph_oracle.json"), "utf8")) as {
  relations: RelationCase[];
  sccs: SccCase[];
};

const debug_u32 = (v: number): string => String(v);

for (const c of oracle.relations) {
  test(`transitive_relation ${c.name}`, () => {
    const b = TransitiveRelationBuilder.default<number>();
    for (const [x, y] of c.edges) b.add(x, y);
    expect([...b.elements()]).toEqual(c.elements);
    expect(debug_TransitiveRelationBuilder(b, PLAIN, debug_u32)).toBe(c.builder_debug);
    const r = b.freeze();
    expect([...r.base_edges()]).toEqual(c.base_edges);
    const mapped = r.maybe_map((x) => x + 1000)!;
    expect([...mapped.elements()]).toEqual(c.mapped_elements);
    expect([...mapped.base_edges()]).toEqual(c.mapped_base_edges);
    const mid = c.elements[Math.floor(c.elements.length / 2)];
    expect(r.maybe_map((x) => (x === mid ? undefined : x)) === undefined).toBe(c.none_map);
    if (c.debug !== null) expect(debug_TransitiveRelation(r, PLAIN, debug_u32)).toBe(c.debug);
    if (c.debug_alt !== null) expect(debug_TransitiveRelation(r, PRETTY, debug_u32)).toBe(c.debug_alt);

    const firsts = c.elements.slice(0, 16);
    const mubs: number[][] = [];
    const pdub: (number | null)[] = [];
    for (const a of firsts) {
      for (const x of firsts) {
        mubs.push(r.minimal_upper_bounds(a, x));
        pdub.push(r.postdom_upper_bound(a, x) ?? null);
      }
    }
    expect(mubs).toEqual(c.mubs);
    expect(pdub).toEqual(c.pdub);
    expect(c.elements.map((a) => r.parents(a))).toEqual(c.parents);
    expect(c.elements.map((a) => r.reachable_from(a))).toEqual(c.reachable);
    expect(c.elements.map((a) => r.minimal_scc_representative(a))).toEqual(c.reps);
    const contains: (0 | 1)[] = [];
    for (const a of firsts) for (const x of c.elements) contains.push(r.contains(a, x) ? 1 : 0);
    expect(contains).toEqual(c.contains);
  });
}

for (const c of oracle.sccs) {
  test(`sccs ${c.name}`, () => {
    const g = VecGraph.new<number>(
      c.num_nodes,
      c.edges.map(([a, b]) => [a, b]),
    );
    const gb = VecGraph.new<number>(
      c.num_nodes,
      c.edges.map(([a, b]) => [a, b]),
      true,
    );
    const sccs = Sccs.new<number, number>(g);
    expect([...sccs.scc_indices()]).toEqual(c.scc_indices);
    expect(sccs.all_sccs().map((s) => [...sccs.successors(s)])).toEqual(c.scc_successors);
    const rev = sccs.reverse();
    expect(DirectedGraph_provided.iter_nodes(rev).map((s) => [...rev.successors(s)])).toEqual(c.reverse_successors);
    expect(DirectedGraph_provided.iter_nodes(g).map((n) => [...g.successors(n)])).toEqual(c.successors);
    expect(DirectedGraph_provided.iter_nodes(gb).map((n) => [...gb.predecessors(n)])).toEqual(c.predecessors);
    expect([...depth_first_search(g, 0)]).toEqual(c.dfs);
    expect([...depth_first_search_as_undirected(gb, 0)]).toEqual(c.dfs_undirected);
    expect(post_order_from(g, 0)).toEqual(c.post_order);
  });
}
