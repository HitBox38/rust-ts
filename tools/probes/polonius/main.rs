//! Oracle probe for src/vendor/polonius_engine/polonius.oracle.test.ts (lane polonius-legacy).
//!
//! Reads commands from stdin, one per line (tokens separated by single spaces), and prints one line each:
//!
//!   facts <algorithm> <dump 0|1> <field>=<tuples> ...
//!       `Output::compute(&all_facts, algorithm, dump)` (`Algorithm::from_str(algorithm)`) of the
//!       `AllFacts` with the given fields (missing fields are empty). `<tuples>` is `-` (none) or
//!       comma-separated tuples of `.`-separated atoms (`universal_region`: single atoms).
//!       Prints every `Output` field as `<name>=<entries>`, space-separated, in declaration order
//!       (`dump_enabled` excluded). Map entries are sorted by key and joined by `;`: `<key>:<value>`,
//!       a `Vec` / `BTreeSet` value is its elements in order joined by `,` (tuples `.`-joined), a
//!       `BTreeMap` value is `<k>=<set>` entries joined by `/`.
//!   reach <tuples>
//!       datafrog's `reachable_with_var_join` (src/test.rs) of the edge pairs: the result's tuples.
//!
//! A command that panics prints `panic <message>` (the panic is caught; the hook is silenced).
#![feature(rustc_private)]

extern crate datafrog;
extern crate polonius_engine;
extern crate rustc_driver;

use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufRead, Write};
use std::str::FromStr;

use datafrog::{Iteration, Relation};
use polonius_engine::{Algorithm, AllFacts, Atom, FactTypes, Output};

#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct A(usize);

impl From<usize> for A {
    fn from(v: usize) -> A {
        A(v)
    }
}
impl From<A> for usize {
    fn from(a: A) -> usize {
        a.0
    }
}
impl Atom for A {
    fn index(self) -> usize {
        self.0
    }
}

#[derive(Copy, Clone, Debug)]
struct F;
impl FactTypes for F {
    type Origin = A;
    type Loan = A;
    type Point = A;
    type Variable = A;
    type Path = A;
}

fn tuples(s: &str) -> Vec<Vec<usize>> {
    if s == "-" {
        return Vec::new();
    }
    s.split(',').map(|t| t.split('.').map(|a| a.parse().unwrap()).collect()).collect()
}

fn t2(v: Vec<Vec<usize>>) -> Vec<(A, A)> {
    v.into_iter().map(|t| (A(t[0]), A(t[1]))).collect()
}
fn t3(v: Vec<Vec<usize>>) -> Vec<(A, A, A)> {
    v.into_iter().map(|t| (A(t[0]), A(t[1]), A(t[2]))).collect()
}

fn join<I: IntoIterator<Item = String>>(i: I, sep: &str) -> String {
    i.into_iter().collect::<Vec<_>>().join(sep)
}

fn vec_map(m: &std::collections::HashMap<A, Vec<A>, impl std::hash::BuildHasher>) -> String {
    let sorted: BTreeMap<_, _> = m.iter().collect();
    join(sorted.into_iter().map(|(k, v)| format!("{}:{}", k.0, join(v.iter().map(|a| a.0.to_string()), ","))), ";")
}
fn set_map(m: &std::collections::HashMap<A, BTreeSet<A>, impl std::hash::BuildHasher>) -> String {
    let sorted: BTreeMap<_, _> = m.iter().collect();
    join(sorted.into_iter().map(|(k, v)| format!("{}:{}", k.0, join(v.iter().map(|a| a.0.to_string()), ","))), ";")
}
fn pair_set_map(m: &std::collections::HashMap<A, BTreeSet<(A, A)>, impl std::hash::BuildHasher>) -> String {
    let sorted: BTreeMap<_, _> = m.iter().collect();
    join(
        sorted.into_iter().map(|(k, v)| format!("{}:{}", k.0, join(v.iter().map(|(a, b)| format!("{}.{}", a.0, b.0)), ","))),
        ";",
    )
}
fn btree_map(m: &std::collections::HashMap<A, BTreeMap<A, BTreeSet<A>>, impl std::hash::BuildHasher>) -> String {
    let sorted: BTreeMap<_, _> = m.iter().collect();
    join(
        sorted.into_iter().map(|(k, v)| {
            format!(
                "{}:{}",
                k.0,
                join(v.iter().map(|(k2, s)| format!("{}={}", k2.0, join(s.iter().map(|a| a.0.to_string()), ","))), "/")
            )
        }),
        ";",
    )
}

fn facts(toks: &[&str]) -> String {
    let algorithm = Algorithm::from_str(toks[0]).unwrap();
    let dump = toks[1] == "1";
    let mut f: AllFacts<F> = AllFacts::default();
    for tok in &toks[2..] {
        let (name, v) = tok.split_once('=').unwrap();
        let v = tuples(v);
        match name {
            "loan_issued_at" => f.loan_issued_at = t3(v),
            "universal_region" => f.universal_region = v.into_iter().map(|t| A(t[0])).collect(),
            "cfg_edge" => f.cfg_edge = t2(v),
            "loan_killed_at" => f.loan_killed_at = t2(v),
            "subset_base" => f.subset_base = t3(v),
            "loan_invalidated_at" => f.loan_invalidated_at = t2(v),
            "var_used_at" => f.var_used_at = t2(v),
            "var_defined_at" => f.var_defined_at = t2(v),
            "var_dropped_at" => f.var_dropped_at = t2(v),
            "use_of_var_derefs_origin" => f.use_of_var_derefs_origin = t2(v),
            "drop_of_var_derefs_origin" => f.drop_of_var_derefs_origin = t2(v),
            "child_path" => f.child_path = t2(v),
            "path_is_var" => f.path_is_var = t2(v),
            "path_assigned_at_base" => f.path_assigned_at_base = t2(v),
            "path_moved_at_base" => f.path_moved_at_base = t2(v),
            "path_accessed_at_base" => f.path_accessed_at_base = t2(v),
            "known_placeholder_subset" => f.known_placeholder_subset = t2(v),
            "placeholder" => f.placeholder = t2(v),
            _ => panic!("unknown field {name}"),
        }
    }
    let o: Output<F> = Output::compute(&f, algorithm, dump);
    let fields = [
        format!("errors={}", vec_map(&o.errors)),
        format!("subset_errors={}", pair_set_map(&o.subset_errors)),
        format!("move_errors={}", vec_map(&o.move_errors)),
        format!("loan_live_at={}", vec_map(&o.loan_live_at)),
        format!("origin_contains_loan_at={}", btree_map(&o.origin_contains_loan_at)),
        format!("origin_contains_loan_anywhere={}", set_map(&o.origin_contains_loan_anywhere)),
        format!("origin_live_on_entry={}", vec_map(&o.origin_live_on_entry)),
        format!("loan_invalidated_at={}", vec_map(&o.loan_invalidated_at)),
        format!("subset={}", btree_map(&o.subset)),
        format!("subset_anywhere={}", set_map(&o.subset_anywhere)),
        format!("var_live_on_entry={}", vec_map(&o.var_live_on_entry)),
        format!("var_drop_live_on_entry={}", vec_map(&o.var_drop_live_on_entry)),
        format!("path_maybe_initialized_on_exit={}", vec_map(&o.path_maybe_initialized_on_exit)),
        format!("path_maybe_uninitialized_on_exit={}", vec_map(&o.path_maybe_uninitialized_on_exit)),
        format!("known_contains={}", set_map(&o.known_contains)),
        format!("var_maybe_partly_initialized_on_exit={}", vec_map(&o.var_maybe_partly_initialized_on_exit)),
    ];
    fields.join(" ")
}

/// datafrog-2.0.1/src/test.rs `reachable_with_var_join`.
fn reach(toks: &[&str]) -> String {
    let edges: Vec<(u32, u32)> =
        tuples(toks.first().copied().unwrap_or("-")).into_iter().map(|t| (t[0] as u32, t[1] as u32)).collect();
    let edges: Relation<_> = edges.iter().collect();
    let mut iteration = Iteration::new();
    let edges_by_successor = iteration.variable::<(u32, u32)>("edges_invert");
    edges_by_successor.extend(edges.iter().map(|&(n1, n2)| (n2, n1)));
    let reachable = iteration.variable::<(u32, u32)>("reachable");
    reachable.insert(edges);
    while iteration.changed() {
        reachable.from_join(&reachable, &edges_by_successor, |&_, &n3, &n1| (n1, n3));
    }
    join(reachable.complete().elements.iter().map(|(a, b)| format!("{a}.{b}")), ",")
}

fn main() {
    std::panic::set_hook(Box::new(|_| {}));
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = std::io::BufWriter::new(stdout.lock());
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        let toks: Vec<&str> = line.split(' ').collect();
        let r = std::panic::catch_unwind(|| match toks[0] {
            "facts" => facts(&toks[1..]),
            "reach" => reach(&toks[1..]),
            c => panic!("unknown command {c}"),
        });
        match r {
            Ok(s) => writeln!(out, "{s}").unwrap(),
            Err(e) => {
                let msg = e
                    .downcast_ref::<String>()
                    .cloned()
                    .or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string()))
                    .unwrap_or_default();
                writeln!(out, "panic {msg}").unwrap()
            }
        }
    }
}
