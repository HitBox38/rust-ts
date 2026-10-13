//! Oracle probe for the `resdump-nocore` suite: runs a compilation with the pinned nightly's own
//! `rustc_driver` (rustc-dev component, `#![feature(rustc_private)]`) and, right after name
//! resolution, prints the resolver's outputs.
//!
//!   resdump <rustc arguments...>
//!
//! The arguments are rustc's (the suite passes the `expanded-nocore` arguments without
//! `-Zunpretty`, which would take the pretty-printing path that never calls the callbacks). The
//! probe does what `rustc_driver_impl::main` does (`install_ice_hook(DEFAULT_BUG_REPORT_URL)`,
//! `catch_with_exit_code(|| compiler_entrypoint(&raw_args(..), &mut callbacks))`) with callbacks
//! that:
//! - in `config`, do what rustc's `TimePassesCallbacks::config` does to the options
//!   (`trimmed_def_paths = true`; time-passes itself is not supported);
//! - in `after_expansion` (called right after `tcx.resolver_for_lowering()`, i.e. after
//!   `configure_and_expand` + `Resolver::into_outputs`, before `write_dep_info`, early lints or
//!   analysis), print the dump below to stdout and return `Compilation::Stop`.
//! So stderr holds the diagnostics up to and including name resolution, then rustc's
//! `aborting due to ..` summary; nothing is written to disk. The exit code is rustc's.
//!
//! Output (stdout). Every value is printed with its upstream `{:?}` (DefId/Span print through
//! the tcx and source map as in rustc's own debug output). One section per collection, in
//! this order, each headed `== <name> (<number of entries>)`:
//!
//! From `tcx.resolutions(())` (ResolverGlobalCtxt):
//!   visibilities_for_hashing    `<LocalDefId:?> <Visibility:?>`               Vec order
//!   expn_that_defined           `<LocalDefId:?> <ExpnId:?>`                   sorted (1)
//!   effective_visibilities      `<LocalDefId:?> <EffectiveVisibility:?>`      sorted (1)
//!   macro_reachable_adts        `<LocalDefId:?> [<LocalDefId:?>, ..]`         sorted (1), set sorted (1)
//!   extern_crate_map            `<LocalDefId:?> <CrateNum:?>`                 sorted (1)
//!   maybe_unused_trait_imports  `<LocalDefId:?>`                              sorted (1)
//!   module_children             `<LocalDefId:?>` then `  <ModChild:?>` lines  sorted (1), Vec order
//!   ambig_module_children       `<LocalDefId:?>` then `  <AmbigModChild:?>`   sorted (1), Vec order
//!   glob_map                    `<LocalDefId:?> [<Symbol:?>, ..]`             sorted (1), set sorted (3)
//!   main_def                    `<Option<MainDefinition>:?>`                  (one line)
//!   trait_impls                 `<DefId:?> [<LocalDefId:?>, ..]`              sorted (2), Vec order
//!   proc_macros                 `<LocalDefId:?>`                              Vec order
//!   paths_matching_assoc_types  `<Span:?>`                                    sorted (4)
//!   confused_type_with_std_module `<Span:?> <Span:?>`                         sorted (4) by key
//!   doc_link_resolutions        `<LocalModId:?>` then `  <Symbol:?> <Namespace:?> <Option<Res>:?>`
//!                                                                             sorted (1), inner sorted (3) then ns
//!   doc_link_traits_in_scope    `<LocalModId:?> [<DefId:?>, ..]`              sorted (1), Vec order
//!   all_macro_rules             `<Symbol:?>`                                  sorted (3)
//!   stripped_cfg_items          `<StrippedCfgItem:?>`                         Vec order
//!   delegation_infos            `<LocalDefId:?> <DelegationInfo:?>`           sorted (1)
//!   delegation_inherent_fn_map  `<LocalDefId:?>` then `  <Ident:?> <DelegationInherentFnKind:?>`
//!                                                                             sorted (1), inner sorted (3) then (4)
//! From `tcx.resolver_for_lowering().0` (ResolverAstLowering):
//!   next_node_id                `<NodeId:?>`                                  (one line)
//!   partial_res_map             `<NodeId:?> <PartialRes:?>`                   sorted (5)
//!   owners                      `<NodeId:?> def_id=<LocalDefId:?> lifetime_elision_allowed=<bool>`
//!                               then, per owner, its maps, each line prefixed with the map name:
//!     `  node_id_to_def_id <NodeId:?> <LocalDefId:?>`                         sorted (5)
//!     `  label_res <NodeId:?> <NodeId:?>`                                     sorted (5)
//!     `  lifetime_res <NodeId:?> <LifetimeRes:?>`                             sorted (5)
//!     `  trait_map <NodeId:?> <[TraitCandidate]:?>`                           sorted (5), slice order
//!     `  import_res <NodeId:?> <PerNS<Option<Res>>:?>`                        sorted (5)
//!     `  extra_lifetime_params <NodeId:?> <[(Ident, NodeId, MissingLifetimeKind)]:?>`
//!                                                                             sorted (5), Vec order
//!                               owners sorted (5)
//!   lint_buffer                 `<NodeId:?> <lint NAME> <primary spans:?>`    sorted (5), buffer order
//!   disambiguators              `<LocalDefId:?>`                              sorted (1); the per-parent
//!                               state (a private FxHashMap) is not printed: it is implied by the
//!                               DefKeys below
//! From `tcx.definitions_untracked()`:
//!   definitions                 `<LocalDefId:?> <DefKind:?> <DefKey:?> <DefPathHash:?>`
//!                                                                             DefIndex order
//!
//! Sort keys (never a hash-map iteration order): (1) the `DefIndex` of a LocalDefId/LocalModId;
//! (2) a DefId's (CrateNum, DefIndex); (3) the Symbol's string (byte order), then the `{:?}` text;
//! (4) a Span's (lo, hi), then its `{:?}` text; (5) the NodeId. Sorts are stable, so equal keys
//! keep the upstream order. "Vec order" / "slice order" / "buffer order" is the order upstream
//! built (insertion into a Vec or an IndexMap during deterministic traversals), kept as is.
#![feature(rustc_private)]
extern crate rustc_ast;
extern crate rustc_data_structures;
extern crate rustc_driver;
extern crate rustc_errors;
extern crate rustc_hir;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_session;
extern crate rustc_span;

use std::cell::RefCell;
use std::fmt::{Debug, Write as _};
use std::io::Write as _;
use std::process::ExitCode;

use rustc_ast::NodeId;
use rustc_data_structures::unord::UnordItems;
use rustc_driver::{Callbacks, Compilation};
use rustc_hir::def_id::{DefId, LocalDefId};
use rustc_interface::interface;
use rustc_middle::ty::TyCtxt;
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;
use rustc_span::{Span, Symbol};

struct ResDump;

impl Callbacks for ResDump {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    #[allow(rustc::bad_opt_access)]
    fn config(&mut self, config: &mut interface::Config) {
        config.opts.trimmed_def_paths = true;
    }

    fn after_expansion<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let out = dump(tcx);
        let mut stdout = std::io::stdout().lock();
        stdout.write_all(out.as_bytes()).unwrap();
        stdout.flush().unwrap();
        Compilation::Stop
    }
}

/// The items of an `UnordMap`/`UnordSet`, in its (unspecified) iteration order: callers sort them.
fn unord_vec<T, I: Iterator<Item = T>>(items: UnordItems<T, I>) -> Vec<T> {
    let v = RefCell::new(Vec::new());
    items.all(|x| {
        v.borrow_mut().push(x);
        true
    });
    v.into_inner()
}

fn di(id: LocalDefId) -> u32 {
    id.local_def_index.as_u32()
}

fn did(id: DefId) -> (u32, u32) {
    (id.krate.as_u32(), id.index.as_u32())
}

fn span_key(s: Span) -> (u32, u32, String) {
    let d = s.data();
    (d.lo.0, d.hi.0, format!("{s:?}"))
}

fn sym_key(s: Symbol) -> (String, String) {
    (s.as_str().to_owned(), format!("{s:?}"))
}

/// `== <name> (<n>)` followed by the lines.
fn section(out: &mut String, name: &str, lines: Vec<String>) {
    writeln!(out, "== {name} ({})", lines.len()).unwrap();
    for l in lines {
        out.push_str(&l);
        out.push('\n');
    }
}

fn dbg<T: Debug>(v: T) -> String {
    format!("{v:?}")
}

fn dump(tcx: TyCtxt<'_>) -> String {
    let mut out = String::new();
    let g = tcx.resolutions(());

    section(&mut out, "visibilities_for_hashing", g.visibilities_for_hashing.iter().map(|(id, vis)| format!("{id:?} {vis:?}")).collect());

    let mut v = unord_vec(g.expn_that_defined.items().map(|(id, e)| (*id, *e)));
    v.sort_by_key(|(id, _)| di(*id));
    section(&mut out, "expn_that_defined", v.into_iter().map(|(id, e)| format!("{id:?} {e:?}")).collect());

    let mut v: Vec<_> = g.effective_visibilities.iter().collect();
    v.sort_by_key(|(id, _)| di(**id));
    section(&mut out, "effective_visibilities", v.into_iter().map(|(id, e)| format!("{id:?} {e:?}")).collect());

    let mut v: Vec<_> = g.macro_reachable_adts.iter().collect();
    v.sort_by_key(|(id, _)| di(**id));
    section(
        &mut out,
        "macro_reachable_adts",
        v.into_iter()
            .map(|(id, set)| {
                let mut s: Vec<LocalDefId> = set.iter().copied().collect();
                s.sort_by_key(|x| di(*x));
                format!("{id:?} {s:?}")
            })
            .collect(),
    );

    let mut v = unord_vec(g.extern_crate_map.items().map(|(id, c)| (*id, *c)));
    v.sort_by_key(|(id, _)| di(*id));
    section(&mut out, "extern_crate_map", v.into_iter().map(|(id, c)| format!("{id:?} {c:?}")).collect());

    let mut v: Vec<LocalDefId> = g.maybe_unused_trait_imports.iter().copied().collect();
    v.sort_by_key(|x| di(*x));
    section(&mut out, "maybe_unused_trait_imports", v.into_iter().map(dbg).collect());

    let mut v = unord_vec(g.module_children.items());
    v.sort_by_key(|(id, _)| di(**id));
    let mut lines = Vec::new();
    for (id, children) in v {
        lines.push(format!("{id:?}"));
        lines.extend(children.iter().map(|c| format!("  {c:?}")));
    }
    writeln!(out, "== module_children ({})", g.module_children.len()).unwrap();
    lines.iter().for_each(|l| writeln!(out, "{l}").unwrap());

    let mut v = unord_vec(g.ambig_module_children.items());
    v.sort_by_key(|(id, _)| di(**id));
    let mut lines = Vec::new();
    for (id, children) in v {
        lines.push(format!("{id:?}"));
        lines.extend(children.iter().map(|c| format!("  {c:?}")));
    }
    writeln!(out, "== ambig_module_children ({})", g.ambig_module_children.len()).unwrap();
    lines.iter().for_each(|l| writeln!(out, "{l}").unwrap());

    let mut v: Vec<_> = g.glob_map.iter().collect();
    v.sort_by_key(|(id, _)| di(**id));
    section(
        &mut out,
        "glob_map",
        v.into_iter()
            .map(|(id, set)| {
                let mut s: Vec<Symbol> = set.iter().copied().collect();
                s.sort_by_cached_key(|x| sym_key(*x));
                format!("{id:?} {s:?}")
            })
            .collect(),
    );

    writeln!(out, "== main_def").unwrap();
    writeln!(out, "{:?}", g.main_def).unwrap();

    let mut v: Vec<_> = g.trait_impls.iter().collect();
    v.sort_by_key(|(id, _)| did(**id));
    section(&mut out, "trait_impls", v.into_iter().map(|(id, impls)| format!("{id:?} {impls:?}")).collect());

    section(&mut out, "proc_macros", g.proc_macros.iter().map(dbg).collect());

    let mut v: Vec<Span> = unord_vec(g.paths_matching_assoc_types.items().copied());
    v.sort_by_cached_key(|s| span_key(*s));
    section(&mut out, "paths_matching_assoc_types", v.into_iter().map(dbg).collect());

    let mut v: Vec<_> = g.confused_type_with_std_module.iter().collect();
    v.sort_by_cached_key(|(k, _)| span_key(**k));
    section(&mut out, "confused_type_with_std_module", v.into_iter().map(|(k, s)| format!("{k:?} {s:?}")).collect());

    let mut v: Vec<_> = g.doc_link_resolutions.iter().collect();
    v.sort_by_key(|(id, _)| di(id.to_local_def_id()));
    let mut lines = Vec::new();
    for (id, map) in v {
        lines.push(format!("{id:?}"));
        let mut inner: Vec<_> = map.iter().collect();
        inner.sort_by_cached_key(|((sym, ns), _)| (sym_key(*sym), format!("{ns:?}")));
        lines.extend(inner.into_iter().map(|((sym, ns), res)| format!("  {sym:?} {ns:?} {res:?}")));
    }
    writeln!(out, "== doc_link_resolutions ({})", g.doc_link_resolutions.len()).unwrap();
    lines.iter().for_each(|l| writeln!(out, "{l}").unwrap());

    let mut v: Vec<_> = g.doc_link_traits_in_scope.iter().collect();
    v.sort_by_key(|(id, _)| di(id.to_local_def_id()));
    section(&mut out, "doc_link_traits_in_scope", v.into_iter().map(|(id, traits)| format!("{id:?} {traits:?}")).collect());

    let mut v: Vec<Symbol> = unord_vec(g.all_macro_rules.items().copied());
    v.sort_by_cached_key(|s| sym_key(*s));
    section(&mut out, "all_macro_rules", v.into_iter().map(dbg).collect());

    section(&mut out, "stripped_cfg_items", g.stripped_cfg_items.iter().map(dbg).collect());

    let mut v: Vec<_> = g.delegation_infos.iter().collect();
    v.sort_by_key(|(id, _)| di(**id));
    section(&mut out, "delegation_infos", v.into_iter().map(|(id, info)| format!("{id:?} {info:?}")).collect());

    let mut v: Vec<_> = g.delegation_inherent_fn_map.iter().collect();
    v.sort_by_key(|(id, _)| di(**id));
    let mut lines = Vec::new();
    for (id, map) in v {
        lines.push(format!("{id:?}"));
        let mut inner: Vec<_> = map.iter().collect();
        inner.sort_by_cached_key(|(ident, _)| (sym_key(ident.name), span_key(ident.span)));
        lines.extend(inner.into_iter().map(|(ident, kind)| format!("  {ident:?} {kind:?}")));
    }
    writeln!(out, "== delegation_inherent_fn_map ({})", g.delegation_inherent_fn_map.len()).unwrap();
    lines.iter().for_each(|l| writeln!(out, "{l}").unwrap());

    // ResolverAstLowering.
    let (resolver, _krate) = tcx.resolver_for_lowering();
    let r = resolver.borrow();

    writeln!(out, "== next_node_id").unwrap();
    writeln!(out, "{:?}", r.next_node_id).unwrap();

    let mut v = unord_vec(r.partial_res_map.items());
    v.sort_by_key(|(id, _)| **id);
    section(&mut out, "partial_res_map", v.into_iter().map(|(id, res)| format!("{id:?} {res:?}")).collect());

    let mut owners = unord_vec(r.owners.items());
    owners.sort_by_key(|(id, _)| **id);
    writeln!(out, "== owners ({})", owners.len()).unwrap();
    for (id, o) in owners {
        writeln!(out, "{id:?} def_id={:?} lifetime_elision_allowed={}", o.def_id, o.lifetime_elision_allowed).unwrap();
        fn sub<V: Debug>(out: &mut String, name: &str, map: &rustc_ast::node_id::NodeMap<V>) {
            let mut v: Vec<(&NodeId, &V)> = unord_vec(map.items());
            v.sort_by_key(|(id, _)| **id);
            for (id, val) in v {
                writeln!(out, "  {name} {id:?} {val:?}").unwrap();
            }
        }
        sub(&mut out, "node_id_to_def_id", &o.node_id_to_def_id);
        sub(&mut out, "label_res", &o.label_res_map);
        sub(&mut out, "lifetime_res", &o.lifetimes_res_map);
        sub(&mut out, "trait_map", &o.trait_map);
        sub(&mut out, "import_res", &o.import_res);
        sub(&mut out, "extra_lifetime_params", &o.extra_lifetime_params_map);
    }

    {
        let lb = r.lint_buffer.borrow();
        let mut v: Vec<_> = lb.map.iter().collect();
        v.sort_by_key(|(id, _)| **id);
        let mut lines = Vec::new();
        for (id, lints) in v {
            for l in lints {
                let spans: Vec<Span> = l.span.as_ref().map_or_else(Vec::new, |s| s.primary_spans().to_vec());
                lines.push(format!("{id:?} {} {spans:?}", l.lint_id.lint.name));
            }
        }
        section(&mut out, "lint_buffer", lines);
    }

    let mut v: Vec<LocalDefId> = unord_vec(r.disambiguators.keys().copied());
    v.sort_by_key(|id| di(*id));
    section(&mut out, "disambiguators", v.into_iter().map(dbg).collect());
    drop(r);

    // The definitions table.
    let defs = tcx.definitions_untracked();
    let mut lines = Vec::new();
    for (index, key, hash) in defs.enumerated_keys_and_path_hashes() {
        let id = LocalDefId { local_def_index: index };
        lines.push(format!("{id:?} {:?} {key:?} {hash:?}", tcx.def_kind(id)));
    }
    drop(defs);
    section(&mut out, "definitions", lines);
    out
}

fn main() -> ExitCode {
    let early_dcx = EarlyDiagCtxt::new(ErrorOutputType::default());
    rustc_driver::install_ice_hook(rustc_driver::DEFAULT_BUG_REPORT_URL, |_| ());
    let mut callbacks = ResDump;
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&rustc_driver::args::raw_args(&early_dcx), &mut callbacks))
}
