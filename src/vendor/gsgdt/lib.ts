// Port of gsgdt 0.1.2 (the version in upstream's Cargo.lock), src/lib.rs. Used by rustc_middle's
// mir/generic_graph.rs + mir/graphviz.rs (`-Zunpretty=mir-cfg`).
//
// PORT: `mod diff` (diff/*.rs) and `mod levenshtein` are not ported: rustc never calls them (the graph diffing is for
// external tools), and `match_graph` iterates `std::collections::HashMap`s with a random hasher, which has no
// deterministic port.
// #![allow(rustc::default_hash_types)]
// mod diff;
// mod levenshtein;
export * from "./graph.ts";
export * from "./multi_graph.ts";
export * from "./node.ts";
// mod util;
