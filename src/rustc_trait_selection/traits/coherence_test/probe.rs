// Oracle probe for `src/rustc_trait_selection/traits/coherence.test.ts` (lane trait-sel-traits-c; not part of the build).
//
// Runs the pinned rustc (rustc-dev) up to expansion and, for the local items of the crate, prints (all `{:?}` under
// `with_no_trimmed_paths!`, DefIds in `hir_crate_items(()).definitions()` order):
// - `== trait <DefId>` for every trait, then
//   - `  graph ...`: `specialization_graph_of(trait)`: `Err`, or every `parent` edge (child order) and every `children`
//     entry (node order) with its `blanket_impls` and its `non_blanket_impls` in `IndexMap` order;
//   - `  overlap <a> <b> <bool>`: `overlapping_trait_impls(a, b, SkipLeakCheck::default(), OverlapMode::get(trait))`
//     for every pair `a < b` of the trait's local impls;
//   - `  specializes <a> <b> <bool>`: `tcx.specializes((a, b))` for every ordered pair `a != b`;
// - `== impl <DefId>` for every trait impl: the orphan check of its trait ref under fresh inference args
//   (`TypingMode::Coherence`) in `InCrate::Local { Proper }`, `Local { Compat }` and `Remote` modes, and
//   `trait_ref_is_knowable`, all with a `lazily_normalize_ty` that returns the type unchanged; then
//   `translate_args` of its identity args to `Node::Trait` and to `Node::Impl(self)` (empty `ParamEnv`, which those
//   two nodes never read);
// - `== inherent <a> <b> <bool>`: `overlapping_inherent_impls(a, b, ..)` for every pair of inherent impls.
// coherence_test/run.ts `facts` prints the same lines from the port.
//
// Regenerate (the toolchain is UPSTREAM.json `nightlyName`, with the rustc-dev component):
//   rustc +nightly-2026-10-11 --edition 2024 probe.rs -o $RUST_TS_DATA/tmp/trait-sel-traits-c/probe
//   for f in graph orphan; do DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib \
//     $RUST_TS_DATA/tmp/trait-sel-traits-c/probe --sysroot $(rustc +nightly-2026-10-11 --print sysroot) \
//     --edition=2021 --crate-type lib $f.rs > $f.stdout; done
#![feature(rustc_private)]
extern crate rustc_data_structures;
extern crate rustc_driver;
extern crate rustc_hir;
extern crate rustc_infer;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_next_trait_solver;
extern crate rustc_session;
extern crate rustc_span;
extern crate rustc_trait_selection;

use std::fmt::Write as _;
use std::io::Write as _;
use std::process::ExitCode;

use rustc_driver::{Callbacks, Compilation};
use rustc_hir::def::DefKind;
use rustc_hir::def_id::DefId;
use rustc_infer::infer::TyCtxtInferExt;
use rustc_interface::interface;
use rustc_middle::traits::specialization_graph::{Node, OverlapMode};
use rustc_middle::ty::print::with_no_trimmed_paths;
use rustc_middle::ty::{self, GenericArgs, Ty, TyCtxt, TypingMode};
use rustc_next_trait_solver::coherence::trait_ref_is_knowable;
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;
use rustc_span::DUMMY_SP;
use rustc_trait_selection::traits::{
    InCrate, OrphanCheckMode, SkipLeakCheck, orphan_check_trait_ref, overlapping_inherent_impls,
    overlapping_trait_impls, translate_args,
};

struct Probe;

impl Callbacks for Probe {
    fn after_expansion<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let out = with_no_trimmed_paths!(dump(tcx));
        let mut stdout = std::io::stdout().lock();
        stdout.write_all(out.as_bytes()).unwrap();
        stdout.flush().unwrap();
        Compilation::Stop
    }
}

/// The items of an `UnordMap`, in its (unspecified) iteration order: callers sort them.
fn unord_vec<T, I: Iterator<Item = T>>(items: rustc_data_structures::unord::UnordItems<T, I>) -> Vec<T> {
    let v = std::cell::RefCell::new(Vec::new());
    items.all(|x| {
        v.borrow_mut().push(x);
        true
    });
    v.into_inner()
}

fn dump<'tcx>(tcx: TyCtxt<'tcx>) -> String {
    let mut out = String::new();
    let defs: Vec<DefId> = tcx.hir_crate_items(()).definitions().map(|d| d.to_def_id()).collect();
    let trait_impls: Vec<DefId> =
        defs.iter().copied().filter(|&d| matches!(tcx.def_kind(d), DefKind::Impl { of_trait: true })).collect();
    let inherent_impls: Vec<DefId> =
        defs.iter().copied().filter(|&d| matches!(tcx.def_kind(d), DefKind::Impl { of_trait: false })).collect();

    for &trait_id in defs.iter().filter(|&&d| tcx.def_kind(d) == DefKind::Trait) {
        writeln!(out, "== trait {trait_id:?}").unwrap();
        match tcx.specialization_graph_of(trait_id) {
            Err(_) => writeln!(out, "  graph Err").unwrap(),
            Ok(g) => {
                let mut parents: Vec<(DefId, DefId)> = unord_vec(g.parent.items().map(|(c, p)| (*c, *p)));
                parents.sort_by_key(|(c, _)| c.index);
                for (c, p) in parents {
                    writeln!(out, "  graph parent {c:?} -> {p:?}").unwrap();
                }
                let mut nodes: Vec<DefId> = unord_vec(g.children.items().map(|(n, _)| *n));
                nodes.sort_by_key(|n| n.index);
                for n in nodes {
                    let ch = &g.children[&n];
                    writeln!(out, "  graph children {n:?} blanket {:?}", ch.blanket_impls).unwrap();
                    for (st, v) in &ch.non_blanket_impls {
                        writeln!(out, "    {st:?} => {v:?}").unwrap();
                    }
                }
            }
        }
        let impls: Vec<DefId> = trait_impls.iter().copied().filter(|&i| tcx.impl_trait_id(i) == trait_id).collect();
        let mode = OverlapMode::get(tcx, trait_id);
        for (i, &a) in impls.iter().enumerate() {
            for &b in &impls[i + 1..] {
                let o = overlapping_trait_impls(tcx, a, b, SkipLeakCheck::default(), mode).is_some();
                writeln!(out, "  overlap {a:?} {b:?} {o}").unwrap();
            }
        }
        for &a in &impls {
            for &b in &impls {
                if a != b {
                    writeln!(out, "  specializes {a:?} {b:?} {}", tcx.specializes((a, b))).unwrap();
                }
            }
        }
    }

    for &impl_id in &trait_impls {
        writeln!(out, "== impl {impl_id:?}").unwrap();
        let infcx = tcx.infer_ctxt().build(TypingMode::Coherence);
        let args = infcx.fresh_args_for_item(DUMMY_SP, impl_id);
        let trait_ref = tcx.impl_trait_ref(impl_id).instantiate(tcx, args).skip_norm_wip();
        let lazily = |ty: Ty<'tcx>| Ok::<_, ()>(ty);
        let r = orphan_check_trait_ref(&infcx, trait_ref, InCrate::Local { mode: OrphanCheckMode::Proper }, lazily);
        writeln!(out, "  orphan local-proper {r:?}").unwrap();
        let r = orphan_check_trait_ref(&infcx, trait_ref, InCrate::Local { mode: OrphanCheckMode::Compat }, lazily);
        writeln!(out, "  orphan local-compat {r:?}").unwrap();
        let r = orphan_check_trait_ref(&infcx, trait_ref, InCrate::Remote, lazily);
        writeln!(out, "  orphan remote {r:?}").unwrap();
        let r = trait_ref_is_knowable(&infcx, trait_ref, lazily);
        writeln!(out, "  knowable {r:?}").unwrap();

        let infcx = tcx.infer_ctxt().build(TypingMode::non_body_analysis());
        let param_env = ty::ParamEnv::empty();
        let identity = GenericArgs::identity_for_item(tcx, impl_id);
        let trait_id = tcx.impl_trait_id(impl_id);
        let t = translate_args(&infcx, param_env, impl_id, identity, Node::Trait(trait_id));
        writeln!(out, "  translate_args trait {t:?}").unwrap();
        let t = translate_args(&infcx, param_env, impl_id, identity, Node::Impl(impl_id));
        writeln!(out, "  translate_args self {t:?}").unwrap();
    }

    for (i, &a) in inherent_impls.iter().enumerate() {
        for &b in &inherent_impls[i + 1..] {
            let o = overlapping_inherent_impls(tcx, a, b, SkipLeakCheck::default(), OverlapMode::Stable).is_some();
            writeln!(out, "== inherent {a:?} {b:?} {o}").unwrap();
        }
    }
    out
}

fn main() -> ExitCode {
    let early_dcx = EarlyDiagCtxt::new(ErrorOutputType::default());
    rustc_driver::install_ice_hook(rustc_driver::DEFAULT_BUG_REPORT_URL, |_| ());
    let mut callbacks = Probe;
    rustc_driver::catch_with_exit_code(|| {
        rustc_driver::compiler_entrypoint(&rustc_driver::args::raw_args(&early_dcx), &mut callbacks)
    })
}
