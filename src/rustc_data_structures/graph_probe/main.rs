//! Scratch rustc-dev probe for the rds-graph lane (rust-ts). Links the pinned nightly's own
//! rustc_data_structures (`#![feature(rustc_private)]`) and prints, as JSON, what its
//! `TransitiveRelation`, `Sccs` and `VecGraph` compute for a battery of deterministic graphs:
//! element and base-edge orders (the `FxHashSet<Edge>` bucket order), `maybe_map`, `{:?}`, the
//! lattice queries, SCC numbering and the reversed SCC graph.
#![feature(rustc_private)]
extern crate rustc_data_structures;
extern crate rustc_driver;

use std::fmt::Write as _;

use rustc_data_structures::graph::scc::Sccs;
use rustc_data_structures::graph::vec_graph::VecGraph;
use rustc_data_structures::graph::{self, DirectedGraph};
use rustc_data_structures::transitive_relation::{TransitiveRelation, TransitiveRelationBuilder};

struct Lcg(u64);
impl Lcg {
    fn next(&mut self, n: u32) -> u32 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.0 >> 33) % n as u64) as u32
    }
}

fn arr(v: impl IntoIterator<Item = String>) -> String {
    format!("[{}]", v.into_iter().collect::<Vec<_>>().join(","))
}
fn nums<T: ToString>(v: impl IntoIterator<Item = T>) -> String {
    arr(v.into_iter().map(|x| x.to_string()))
}
fn pairs(v: impl IntoIterator<Item = (u32, u32)>) -> String {
    arr(v.into_iter().map(|(a, b)| format!("[{a},{b}]")))
}
fn opt(v: Option<u32>) -> String {
    v.map_or("null".to_string(), |x| x.to_string())
}
fn json_str(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn relation_case(name: &str, edges: &[(u32, u32)]) -> String {
    let mut b = TransitiveRelationBuilder::default();
    for &(x, y) in edges {
        b.add(x, y);
    }
    let elements: Vec<u32> = b.elements().copied().collect();
    let builder_debug = format!("{b:?}");
    let r: TransitiveRelation<u32> = b.freeze();
    let base: Vec<(u32, u32)> = r.base_edges().collect();
    let mapped = r.maybe_map(|x| Some(x + 1000)).unwrap();
    let mapped_elements: Vec<u32> = mapped.elements().copied().collect();
    let mapped_base: Vec<(u32, u32)> = mapped.base_edges().collect();
    let none_map = r.maybe_map(|x| if x == elements[elements.len() / 2] { None } else { Some(x) }).is_none();
    let mut q = String::new();
    let mut mubs = vec![];
    let mut pdub = vec![];
    // Pairs of the first 16 elements (keeps the fixture small).
    for &a in elements.iter().take(16) {
        for &c in elements.iter().take(16) {
            mubs.push(nums(r.minimal_upper_bounds(a, c)));
            pdub.push(opt(r.postdom_upper_bound(a, c)));
        }
    }
    let parents: Vec<String> = elements.iter().map(|&a| nums(r.parents(a))).collect();
    let reach: Vec<String> = elements.iter().map(|&a| nums(r.reachable_from(a))).collect();
    let reps: Vec<u32> = elements.iter().map(|&a| r.minimal_scc_representative(a)).collect();
    let contains: Vec<String> = elements
        .iter()
        .take(16)
        .flat_map(|&a| elements.iter().map(move |&c| (a, c)))
        .map(|(a, c)| if r.contains(a, c) { "1".into() } else { "0".into() })
        .collect();
    write!(
        q,
        "{{\"name\":{},\"edges\":{},\"elements\":{},\"base_edges\":{},\"mapped_elements\":{},\"mapped_base_edges\":{},\"none_map\":{},\"builder_debug\":{},\"debug\":{},\"debug_alt\":{},\"mubs\":{},\"pdub\":{},\"parents\":{},\"reachable\":{},\"reps\":{},\"contains\":{}}}",
        json_str(name),
        pairs(edges.iter().copied()),
        nums(elements.iter()),
        pairs(base),
        nums(mapped_elements),
        pairs(mapped_base),
        none_map,
        json_str(&builder_debug),
        // `{:?}` / `{:#?}` only for the smaller relations (keeps the fixture small).
        if elements.len() <= 24 { json_str(&format!("{r:?}")) } else { "null".into() },
        if elements.len() <= 10 { json_str(&format!("{r:#?}")) } else { "null".into() },
        arr(mubs),
        arr(pdub),
        arr(parents),
        arr(reach),
        nums(reps),
        arr(contains),
    )
    .unwrap();
    q
}

fn scc_case(name: &str, num_nodes: usize, edges: &[(u32, u32)]) -> String {
    let pairs_usize: Vec<(usize, usize)> = edges.iter().map(|&(a, b)| (a as usize, b as usize)).collect();
    let g: VecGraph<usize> = VecGraph::new(num_nodes, pairs_usize.clone());
    let gb: VecGraph<usize, true> = VecGraph::new(num_nodes, pairs_usize);
    let sccs: Sccs<usize, usize> = Sccs::new(&g);
    let succ: Vec<String> = sccs.all_sccs().map(|s| nums(sccs.successors(s).iter())).collect();
    let rev = sccs.reverse();
    let rev_succ: Vec<String> = rev.iter_nodes().map(|s| nums(rev.successors(s).iter())).collect();
    let g_succ: Vec<String> = g.iter_nodes().map(|n| nums(g.successors(n).iter())).collect();
    let g_pred: Vec<String> = gb.iter_nodes().map(|n| nums(gb.predecessors(n).iter())).collect();
    let dfs: Vec<usize> = graph::depth_first_search(&g, 0).collect();
    let undirected: Vec<usize> = graph::depth_first_search_as_undirected(&gb, 0).collect();
    let post = graph::iterate::post_order_from(&g, 0);
    format!(
        "{{\"name\":{},\"num_nodes\":{},\"edges\":{},\"scc_indices\":{},\"scc_successors\":{},\"reverse_successors\":{},\"successors\":{},\"predecessors\":{},\"dfs\":{},\"dfs_undirected\":{},\"post_order\":{}}}",
        json_str(name),
        num_nodes,
        pairs(edges.iter().copied()),
        nums(sccs.scc_indices().iter()),
        arr(succ),
        arr(rev_succ),
        arr(g_succ),
        arr(g_pred),
        nums(dfs),
        nums(undirected),
        nums(post),
    )
}

fn main() {
    let mut rel = vec![];
    // tyir-misc D6: a 4-edge graph.
    rel.push(relation_case("d6_four", &[(1, 2), (2, 3), (3, 4), (4, 5)]));
    rel.push(relation_case("crisscross", &[(0, 2), (0, 3), (1, 2), (1, 3), (2, 4), (3, 4)]));
    rel.push(relation_case("self_loops", &[(2, 0), (2, 2), (0, 0), (0, 0), (1, 0), (1, 1), (3, 0), (3, 3), (4, 0), (4, 1), (1, 3)]));
    let mut lcg = Lcg(0x5eed);
    for (i, &(n, m)) in [(6u32, 8usize), (10, 20), (16, 40), (24, 90), (40, 200), (60, 330)].iter().enumerate() {
        let mut edges = vec![];
        for _ in 0..m {
            edges.push((lcg.next(n) * 7 + 3, lcg.next(n) * 7 + 3));
        }
        rel.push(relation_case(&format!("random{i}"), &edges));
    }
    let mut scc = vec![];
    scc.push(scc_case("three", 4, &[(0, 1), (1, 2), (2, 1), (3, 2)]));
    for (i, &(n, m)) in [(5usize, 7usize), (12, 20), (30, 45), (60, 140), (100, 160)].iter().enumerate() {
        let mut edges = vec![];
        for _ in 0..m {
            edges.push((lcg.next(n as u32), lcg.next(n as u32)));
        }
        scc.push(scc_case(&format!("random{i}"), n, &edges));
    }
    println!("{{\"relations\":{},\"sccs\":{}}}", arr(rel), arr(scc));
}
