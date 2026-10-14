// Oracle probe for src/rustc_type_ir/search_graph (lane tyir-solve): drives the pinned nightly's own
// `rustc_type_ir::search_graph::SearchGraph` (rustc-dev) with a fake `Cx` / `Delegate` over small goal graphs and
// prints one event trace per case. search_graph.test.ts runs the same cases through the TS port with the same fake
// delegate and compares the traces (via the hashes in fixture.txt).
//
// Build (pinned nightly, rustc-dev component):
//   rustc +nightly --edition 2024 -O main.rs -o searchgraph \
//     -C link-arg=-Wl,-rpath,$(rustc +nightly --print sysroot)/lib
// Run:  ./searchgraph < cases.txt > traces.txt   (cases.txt from `bun cases.ts gen <seed> <n>`)
//
// Case format (one line of integers):
//   root_depth inspect_noop nroots (root mode)* nnodes (node)*
//   node = base op ncands (cand)*; cand = nchildren (child kind lower)*
//   kind: 0 Inductive, 1 Unknown, 2 Coinductive, 3 ForcedAmbiguity; lower: 1 Yes, 0 No;
//   mode: 0 = `evaluate_goal` on a fresh `SearchGraph`, 1 = `evaluate_root_goal_for_proof_tree`.
// The global cache lives in the `Cx` and is shared by all roots of a case.
//
// `./searchgraph certainty` instead prints `a.and(b)` / `a.or(b)` (`{:?}`) of `rustc_type_ir::solve::Certainty`
// for every pair of its 21 values, and `and` / `or` of every pair of `VisibleForLeakCheck`s (solve/mod.ts tests).
// `./searchgraph opaques` prints, for every sequence of 4 `AccessedOpaques<TyCtxt>` updates (op 0
// `rerun_if_in_post_analysis`, 1..=4 `rerun_if_opaque_in_opaque_type_storage(LocalDefId(op))`, 5
// `rerun_if_any_opaque_has_infer_as_hidden_type`, 6 `rerun_always`; reason `RerunReason` #(3 * step + op) % 9),
// each step's `{:?}` of the returned `Result` and the state, plus `might_rerun`.
//
// Case lines may start with a negative-free flag: `inspect_noop` 2 means "inspect is a no-op and
// `enter_validation_scope` returns `Some`" (the global cache is validated instead of used).
#![feature(rustc_private)]

extern crate rustc_driver;
extern crate rustc_middle;
extern crate rustc_span;
extern crate rustc_type_ir;

use std::cell::RefCell;
use std::io::{BufRead, Write};

use rustc_middle::ty::TyCtxt;
use rustc_span::def_id::{DefIndex, LocalDefId};
use rustc_type_ir::solve::{
    AccessedOpaques, RerunReason, Certainty, MaybeCause, MaybeInfo, OpaqueTypesJank, StalledOnCoroutines, VisibleForLeakCheck,
};
use rustc_type_ir::search_graph::{
    Cx, Delegate, GlobalCache, LowerAvailableDepth, PathKind, SearchGraph,
};

struct Node {
    base: u32,
    op: u32,
    cands: Vec<Vec<(u32, PathKind, LowerAvailableDepth)>>,
}

struct Graph {
    nodes: Vec<Node>,
}

#[derive(Copy, Clone)]
struct MyCx<'a> {
    graph: &'a Graph,
    cache: &'a RefCell<GlobalCache<MyCx<'a>>>,
    trace: &'a RefCell<Vec<String>>,
    validate: bool,
}

impl<'a> Cx for MyCx<'a> {
    type Input = u32;
    type Result = u32;
    type AmbiguityKind = u32;
    type DepNodeIndex = ();
    type Tracked<T: std::fmt::Debug + Clone> = T;
    fn mk_tracked<T: std::fmt::Debug + Clone>(self, data: T, _: ()) -> T {
        data
    }
    fn get_tracked<T: std::fmt::Debug + Clone>(self, tracked: &T) -> T {
        tracked.clone()
    }
    fn with_cached_task<T>(self, task: impl FnOnce() -> T) -> (T, ()) {
        (task(), ())
    }
    fn with_global_cache<R>(self, f: impl FnOnce(&mut GlobalCache<Self>) -> R) -> R {
        f(&mut *self.cache.borrow_mut())
    }
    fn assert_evaluation_is_concurrent(&self) {}
}

// Results: 0..=4 plain values; 100 NoSolution (initial inductive), 101 Yes (initial coinductive),
// 102 initial Unknown/ForcedAmbiguity, 103 stack overflow, 104 fixpoint overflow, 105 ambiguity.
fn combine(op: u32, acc: u32, r: u32) -> u32 {
    match op {
        0 => acc.min(r),
        1 => acc.max(r),
        _ => (acc + r) % 5,
    }
}

struct MyDelegate;

impl Delegate for MyDelegate {
    type Cx = MyCx<'static>;
    const ENABLE_PROVISIONAL_CACHE: bool = true;
    type ValidationScope = ();
    fn enter_validation_scope(cx: Self::Cx, _: u32) -> Option<()> {
        if cx.validate { Some(()) } else { None }
    }
    const FIXPOINT_STEP_LIMIT: usize = 3;
    type ProofTreeBuilder = bool;
    fn inspect_is_noop(inspect: &mut bool) -> bool {
        *inspect
    }
    const DIVIDE_AVAILABLE_DEPTH_ON_OVERFLOW: usize = 2;
    fn initial_provisional_result(_: Self::Cx, kind: PathKind, _: u32) -> u32 {
        match kind {
            PathKind::Inductive => 100,
            PathKind::Coinductive => 101,
            PathKind::Unknown | PathKind::ForcedAmbiguity => 102,
        }
    }
    fn is_initial_provisional_result(result: u32) -> Option<PathKind> {
        match result {
            100 => Some(PathKind::Inductive),
            101 => Some(PathKind::Coinductive),
            102 => Some(PathKind::Unknown),
            _ => None,
        }
    }
    fn stack_overflow_result(_: Self::Cx, _: u32) -> u32 {
        103
    }
    const FIXPOINT_OVERFLOW_AMBIGUITY_KIND: u32 = 4;
    fn fixpoint_overflow_result(_: Self::Cx, _: u32) -> u32 {
        104
    }
    fn is_ambiguous_result(result: u32) -> Option<u32> {
        if (102..=105).contains(&result) { Some(result - 100) } else { None }
    }
    fn compute_goal(
        search_graph: &mut SearchGraph<Self>,
        cx: Self::Cx,
        input: u32,
        inspect: &mut bool,
    ) -> u32 {
        cx.trace.borrow_mut().push(format!("C{input}"));
        let node = &cx.graph.nodes[input as usize];
        let mut best: Option<u32> = None;
        let mut kept = None;
        for cand in &node.cands {
            search_graph.enter_single_candidate();
            let mut acc = node.base;
            for &(child, kind, lower) in cand {
                let r = search_graph.evaluate_goal(cx, child, kind, lower, inspect);
                cx.trace.borrow_mut().push(format!("{child}={r}"));
                acc = combine(node.op, acc, r);
            }
            let usages = search_graph.finish_single_candidate();
            match best {
                None => {
                    best = Some(acc);
                    kept = Some(usages);
                }
                Some(b) if acc > b => {
                    search_graph.ignore_candidate_head_usages(kept.take().unwrap());
                    best = Some(acc);
                    kept = Some(usages);
                }
                Some(b) if acc == b => kept.as_mut().unwrap().merge_usages(usages),
                Some(_) => search_graph.ignore_candidate_head_usages(usages),
            }
        }
        let result = best.unwrap_or(node.base);
        cx.trace.borrow_mut().push(format!("={result}"));
        result
    }
}

fn kind_of(k: u32) -> PathKind {
    match k {
        0 => PathKind::Inductive,
        1 => PathKind::Unknown,
        2 => PathKind::Coinductive,
        _ => PathKind::ForcedAmbiguity,
    }
}

fn certainty() {
    let mut all = vec![Certainty::Yes];
    let causes = [
        MaybeCause::Ambiguity,
        MaybeCause::Overflow { suggest_increasing_limit: false, keep_constraints: false },
        MaybeCause::Overflow { suggest_increasing_limit: false, keep_constraints: true },
        MaybeCause::Overflow { suggest_increasing_limit: true, keep_constraints: false },
        MaybeCause::Overflow { suggest_increasing_limit: true, keep_constraints: true },
    ];
    for cause in causes {
        for opaque_types_jank in [OpaqueTypesJank::AllGood, OpaqueTypesJank::ErrorIfRigidSelfTy] {
            for stalled_on_coroutines in [StalledOnCoroutines::Yes, StalledOnCoroutines::No] {
                all.push(Certainty::Maybe(MaybeInfo { cause, opaque_types_jank, stalled_on_coroutines }));
            }
        }
    }
    for &a in &all {
        for &b in &all {
            println!("{:?}", a.and(b));
            if let (Certainty::Maybe(x), Certainty::Maybe(y)) = (a, b) {
                println!("{:?}", x.or(y));
            }
        }
    }
    println!("{:?} {:?}", Certainty::AMBIGUOUS, Certainty::overflow(true));
    let v = [VisibleForLeakCheck::Yes, VisibleForLeakCheck::No, VisibleForLeakCheck::Unreachable];
    for a in v {
        for b in v {
            println!("{:?} {:?}", a.and(b), a.or(b));
        }
    }
}

fn opaques() {
    let reasons = [
        RerunReason::NormalizeOpaqueTypeRemoteCrate,
        RerunReason::NormalizeOpaqueType,
        RerunReason::MayUseUnstableFeature,
        RerunReason::EvaluateConst,
        RerunReason::SkipErasedAttempt,
        RerunReason::SelfTyInfer,
        RerunReason::FetchEligibleAssocItem,
        RerunReason::AutoTraitLeakage,
        RerunReason::TryStallCoroutine,
    ];
    for n in 0..7u32.pow(4) {
        let mut a: AccessedOpaques<TyCtxt<'static>> = AccessedOpaques::default();
        let mut line = vec![];
        for step in 0..4u32 {
            let op = (n / 7u32.pow(step)) % 7;
            let reason = reasons[((3 * step + op) % 9) as usize];
            let r = match op {
                0 => format!("{:?}", a.rerun_if_in_post_analysis(reason)),
                1..=4 => {
                    let defid = LocalDefId { local_def_index: DefIndex::from_u32(op) };
                    format!("{:?}", a.rerun_if_opaque_in_opaque_type_storage(reason, defid))
                }
                5 => format!("{:?}", a.rerun_if_any_opaque_has_infer_as_hidden_type(reason)),
                _ => format!("{:?}", a.rerun_always(reason)),
            };
            line.push(format!("{r} {a:?} {}", a.might_rerun()));
        }
        println!("{}", line.join(" | "));
    }
}

fn main() {
    if std::env::args().nth(1).as_deref() == Some("certainty") {
        return certainty();
    }
    if std::env::args().nth(1).as_deref() == Some("opaques") {
        return opaques();
    }
    let stdin = std::io::stdin();
    let mut out = std::io::BufWriter::new(std::io::stdout());
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        if line.trim().is_empty() {
            continue;
        }
        let mut it = line.split_ascii_whitespace().map(|t| t.parse::<u32>().unwrap());
        let mut next = || it.next().unwrap();
        let root_depth = next() as usize;
        let flag = next();
        let inspect_noop = flag >= 1;
        let validate = flag == 2;
        let nroots = next();
        let roots: Vec<(u32, u32)> = (0..nroots).map(|_| (next(), next())).collect();
        let nnodes = next();
        let mut nodes = vec![];
        for _ in 0..nnodes {
            let base = next();
            let op = next();
            let ncands = next();
            let mut cands = vec![];
            for _ in 0..ncands {
                let nchildren = next();
                let mut children = vec![];
                for _ in 0..nchildren {
                    let child = next();
                    let kind = kind_of(next());
                    let lower = if next() == 1 { LowerAvailableDepth::Yes } else { LowerAvailableDepth::No };
                    children.push((child, kind, lower));
                }
                cands.push(children);
            }
            nodes.push(Node { base, op, cands });
        }
        let graph = Graph { nodes };
        // SAFETY (probe only): the borrows live until the end of this loop iteration; `'static` lets the
        // `Delegate` name a concrete `Cx` type.
        let graph: &'static Graph = unsafe { &*(&graph as *const Graph) };
        let cache: RefCell<GlobalCache<MyCx<'static>>> = RefCell::new(GlobalCache::default());
        let cache: &'static RefCell<GlobalCache<MyCx<'static>>> = unsafe { &*(&cache as *const _) };
        let trace: RefCell<Vec<String>> = RefCell::new(vec![]);
        let trace: &'static RefCell<Vec<String>> = unsafe { &*(&trace as *const _) };
        let cx = MyCx { graph, cache, trace, validate };
        for &(root, mode) in &roots {
            let mut inspect = inspect_noop;
            if mode == 0 {
                let mut sg = SearchGraph::<MyDelegate>::new(root_depth);
                let r = sg.evaluate_goal(
                    cx,
                    root,
                    PathKind::Inductive,
                    LowerAvailableDepth::Yes,
                    &mut inspect,
                );
                assert!(sg.is_empty());
                trace.borrow_mut().push(format!("R{root}={r}"));
            } else {
                let (r, d) = SearchGraph::<MyDelegate>::evaluate_root_goal_for_proof_tree(
                    cx,
                    root_depth,
                    root,
                    &mut inspect,
                );
                trace.borrow_mut().push(format!("P{root}={r}/{}", d.0));
            }
        }
        writeln!(out, "{}", trace.borrow().join(" ")).unwrap();
    }
}
