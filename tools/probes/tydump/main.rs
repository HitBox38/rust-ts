//! Oracle probe for the `tydump-*` suites (plan-m3 D1/D1a, §6): runs a compilation with the
//! pinned nightly's own `rustc_driver` (rustc-dev component, `#![feature(rustc_private)]`), stops
//! it after type checking, and prints per-item type facts and every body's typeck results.
//!
//!   tydump <rustc arguments...>
//!
//! The arguments are rustc's. The probe does what `rustc_driver_impl::main` does
//! (`init_rustc_env_logger` (`RUSTC_LOG`; unset: tracing WARN/ERROR events on stderr, as rustc prints them),
//! `install_ice_hook(DEFAULT_BUG_REPORT_URL)`,
//! `catch_with_exit_code(|| compiler_entrypoint(&raw_args(..), &mut callbacks))`) with callbacks
//! that:
//! - in `config`, do what rustc's `TimePassesCallbacks::config` does to the options
//!   (`trimmed_def_paths = true`; time-passes itself is not supported);
//! - in `after_expansion` (called right after `tcx.resolver_for_lowering()`, before
//!   `write_dep_info`, `write_interface` and `analysis`): run the D1 prefix (below), print the
//!   dump to stdout and return `Compilation::Stop`.
//!
//! Stop point (D1, D1a). `prefix.rs` (shared with `thirdump`) runs what `analysis` runs before
//! MIR: `run_required_analyses` (rustc_interface/src/passes.rs:1100) up to and including
//! `definitions.freeze()` (:1161): `hir_crate_items` (AST lowering, which runs the early lints),
//! `commit_end_of_determinism`, the delegation check, misc_checking_1 (entry_fn,
//! check_externally_implementable_items, proc_macro_decls_static, report_unused_deps,
//! exportable_items, stable_order_of_exportable_impls, check_mod_attrs and
//! check_mod_unstable_api_usage per module, limits), `emit_delayed_lints`, then
//! `rustc_hir_analysis::check_crate` (lib.rs:145: check_type_wf, coherent_trait per local trait
//! impl, the inherent-impl checks, `typeck` per body owner, coroutine by-move bodies, the
//! `#[rustc_dump_*]` dumps, check_unused_traits) **without its static/const evaluation arm**
//! (lib.rs:166-184; D1a: CTFE is M4/M6), then `definitions.freeze()`. Not run: the debug-assertion
//! `hir_id_validator` (not in the release oracle either), MIR_borrow_checking and everything after
//! it. The header of `prefix.rs` lists every difference from upstream. The prefix's diagnostics go
//! to stderr as usual; the dump is printed even if there were errors (a fatal error ends the
//! process before it).
//!
//! stderr therefore holds the diagnostics up to and including type checking (plus any the dump's
//! own query calls emit, in dump order), then rustc's `aborting due to ..` summary if there were
//! errors. Nothing is written to disk. The exit code is rustc's.
//!
//! Output (stdout). Every value is printed with its upstream `{:?}`, formatted under
//! `with_no_trimmed_paths!` (the query calls themselves are not, so diagnostics they emit keep
//! rustc's settings); DefId/Span print through the tcx and source map as in rustc's own debug
//! output, `Ty` through its Display. Two sections, each headed `== <name> (<number of entries>)`:
//!
//! `== items (<n>)`: every local DefId, `0..num_definitions()` in DefIndex order (the definitions
//! table after `freeze`, so it includes the DefIds typeck and check_crate created; this is the
//! iteration of `TyCtxt::iter_local_def_id`, which cannot be used because it calls `analysis`).
//! Per DefId, a header line then indented facts, each line starting with its name:
//!   `<LocalDefId:?> <DefKind:?>`
//!   `  generics_of <Generics:?>`                      if should_encode_generics(def_kind)
//!   `  clauses_of <GenericClauses:?>`                 if should_encode_generics(def_kind)
//!                                                    (`predicates_of` before its rename)
//!   `  type_of <EarlyBinder<Ty>:?>`                   if should_encode_type(tcx, def_id, def_kind)
//!   `  fn_sig <EarlyBinder<PolyFnSig>:?>`             if should_encode_fn_sig(def_kind)
//!   `  variances_of <[Variance]:?>`                   if should_encode_variances(tcx, def_id, def_kind)
//!   `  explicit_item_bounds <EarlyBinder<[(Clause, Span)]>:?>`
//!                                                    if OpaqueTy, or an AssocTy whose
//!                                                    `associated_item(..).container` is `Trait`
//!   `  impl_trait_header <ImplTraitHeader:?>`         if `DefKind::Impl { of_trait: true }`
//!   `  typeck` + the lines below                      if `check_crate` type-checked it
//! The `should_encode_*` predicates are copied verbatim from rustc_metadata/src/rmeta/encoder.rs
//! (private there): they are upstream's own answer to "which of these queries is defined for this
//! DefKind" (the metadata encoder calls the same queries for every local DefId after analysis).
//! As in `encode_def_ids`, an AnonConst whose HIR node is a `ConstArg` or a const `InferArg` gets
//! only its header line (its DefId is never used, and the queries need not be defined for it).
//! The encoder only runs on crates without errors; this dump also runs on erroneous ones, where a
//! DefId can exist without HIR (e.g. a closure inside an attribute's expression: resolved, never
//! lowered), and any query on it ICEs in `lower_to_hir`. So a DefId gets facts only if it has HIR
//! (a HIR owner, or a key of its owner's `lower_to_hir(..).children`, which is where
//! `lower_to_hir` looks a non-owner up) or was created after AST lowering (index >= the number of
//! definitions right after `hir_crate_items`, returned by the prefix: RPITIT associated types,
//! coroutine by-move bodies, opaque lifetimes, all fed by the queries that create them); others
//! get only their header line.
//! Queries are called in the order above; a query that was not run during the prefix runs here.
//!
//! `typeck`: for a body owner that `check_crate` passed to `typeck` (`hir_body_owners` minus
//! type-system anon consts and typeck children; `prefix::check_crate_typecks`), the fields of its
//! `TypeckResults`, one line per entry, each prefixed with the field name (`    <field> ...`):
//!   hir_owner                    `<OwnerId:?>`                                    (one line)
//!   tainted_by_errors            `<Option<ErrorGuaranteed>:?>`                    (one line)
//!   type_dependent_defs          `<ItemLocalId:?> <Result<(DefKind, DefId), ErrorGuaranteed>:?>`  (6)
//!   field_indices                `<ItemLocalId:?> <FieldIdx:?>`                   (6)
//!   node_types                   `<ItemLocalId:?> <Ty:?>`                         (6)
//!   node_args                    `<ItemLocalId:?> <GenericArgsRef:?>`             (7)
//!   user_provided_types          `<ItemLocalId:?> <CanonicalUserType:?>`          (6)
//!   user_provided_sigs           `<LocalDefId:?> <CanonicalPolyFnSig:?>`          (1)
//!   adjustments                  `<ItemLocalId:?> <[Adjustment]:?>`               (6)
//!   pat_binding_modes            `<ItemLocalId:?> <BindingMode:?>`                (6)
//!   rust_2024_migration_desugared_pats `<ItemLocalId:?> <Rust2024IncompatiblePatInfo:?>` (6)
//!   pat_adjustments              `<ItemLocalId:?> <[PatAdjustment]:?>`            (6)
//!   skipped_ref_pats             `<ItemLocalId:?>`                                (7)
//!   closure_kind_origins         `<ItemLocalId:?> <(Span, HirPlace):?>`           (6)
//!   liberated_fn_sigs            `<ItemLocalId:?> <FnSig:?>`                      (6)
//!   fru_field_types              `<ItemLocalId:?> <[Ty]:?>`                       (6)
//!   coercion_casts               `<ItemLocalId:?>`                                (6)
//!   used_trait_imports           `<LocalDefId:?>`                                 (1)
//!   hidden_types                 `<LocalDefId:?> <DefinitionSiteHiddenType:?>`    index order
//!   closure_min_captures         `<LocalDefId:?> <HirId:?> <[CapturedPlace]:?>`   (1), inner index order
//!   closure_fake_reads           `<LocalDefId:?> <[(HirPlace, FakeReadCause, HirId)]:?>`  (1)
//!   coroutine_stalled_predicates `<(Predicate, ObligationCause):?>`               index order
//!   transmutes_to_check          `<(Ty, Ty, HirId):?>`                            Vec order
//!   offset_of_data               `<ItemLocalId:?> <[(Ty, VariantIdx, FieldIdx)]:?>`  (6)
//! Not printed: `splatted_defs` (no accessor that lists it; unstable `splat` feature),
//! `potentially_region_dependent_goals`, `closure_size_eval` and `offloads_to_check` (used only by
//! MIR building / codegen-side features).
//!
//! Order. (1) a `LocalDefIdMap`/`UnordSet<LocalDefId>` (hash order upstream) sorted by DefIndex.
//! (6) an `ItemLocalMap`/`ItemLocalSet` (hash order upstream) sorted by ItemLocalId, i.e.
//! `LocalTableInContext::items_in_stable_order`. (7) a table with no listing accessor
//! (`node_args`, `skipped_ref_pats`): every ItemLocalId of the owner's HIR
//! (`0..hir_owner_nodes(hir_owner).nodes.len()`) in order, printed when present. "index order" is
//! an `FxIndexMap`/`FxIndexSet`'s insertion order, printed as is (deterministic and visible
//! upstream); "Vec order" is the order upstream built.
#![feature(rustc_private)]
extern crate rustc_attr_ir;
extern crate rustc_data_structures;
extern crate rustc_driver;
extern crate rustc_errors;
extern crate rustc_hir;
extern crate rustc_interface;
extern crate rustc_metadata;
extern crate rustc_middle;
extern crate rustc_passes;
extern crate rustc_session;
extern crate rustc_span;

mod prefix;

use std::cell::RefCell;
use std::collections::HashSet;
use std::fmt::{Debug, Write as _};
use std::io::Write as _;
use std::process::ExitCode;

use rustc_data_structures::unord::UnordItems;
use rustc_driver::{Callbacks, Compilation};
use rustc_hir as hir;
use rustc_hir::def::{CtorKind, DefKind};
use rustc_hir::def_id::{DefId, LocalDefId};
use rustc_hir::{HirId, ItemLocalId};
use rustc_interface::interface;
use rustc_middle::ty::print::with_no_trimmed_paths;
use rustc_middle::ty::{self, TyCtxt};
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;

struct TyDump;

impl Callbacks for TyDump {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    #[allow(rustc::bad_opt_access)]
    fn config(&mut self, config: &mut interface::Config) {
        config.opts.trimmed_def_paths = true;
    }

    fn after_expansion<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let num_definitions_after_lowering = prefix::run_required_analyses_prefix(tcx);
        let out = dump(tcx, num_definitions_after_lowering);
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

/// `{:?}` under `with_no_trimmed_paths!`.
fn dbg<T: Debug>(v: T) -> String {
    with_no_trimmed_paths!(format!("{v:?}"))
}

/// One fact line: `  <name> <value:?>`.
fn fact<T: Debug>(out: &mut String, name: &str, v: T) {
    let s = dbg(v);
    writeln!(out, "  {name} {s}").unwrap();
}

// rustc_metadata/src/rmeta/encoder.rs:1213 should_encode_variances, verbatim.
fn should_encode_variances<'tcx>(tcx: TyCtxt<'tcx>, def_id: DefId, def_kind: DefKind) -> bool {
    match def_kind {
        DefKind::Struct
        | DefKind::Union
        | DefKind::Enum
        | DefKind::OpaqueTy
        | DefKind::Fn
        | DefKind::Ctor(..)
        | DefKind::AssocFn => true,
        DefKind::AssocTy => {
            // Only encode variances for RPITITs (for traits)
            matches!(tcx.opt_rpitit_info(def_id), Some(ty::ImplTraitInTraitData::Trait { .. }))
        }
        DefKind::Mod
        | DefKind::Variant
        | DefKind::Field
        | DefKind::AssocConst
        | DefKind::TyParam
        | DefKind::ConstParam
        | DefKind::Static { .. }
        | DefKind::Const
        | DefKind::ForeignMod
        | DefKind::TyAlias
        | DefKind::Impl { .. }
        | DefKind::Trait
        | DefKind::TraitAlias
        | DefKind::Macro(..)
        | DefKind::ForeignTy
        | DefKind::Use
        | DefKind::LifetimeParam
        | DefKind::AnonConst
        | DefKind::GlobalAsm
        | DefKind::Closure
        | DefKind::ExternCrate
        | DefKind::SyntheticCoroutineBody
        | DefKind::TestBinderConstraints => false,
    }
}

// rustc_metadata/src/rmeta/encoder.rs:1252 should_encode_generics, verbatim.
fn should_encode_generics(def_kind: DefKind) -> bool {
    match def_kind {
        DefKind::Struct
        | DefKind::Union
        | DefKind::Enum
        | DefKind::Variant
        | DefKind::Trait
        | DefKind::TyAlias
        | DefKind::ForeignTy
        | DefKind::TraitAlias
        | DefKind::AssocTy
        | DefKind::Fn
        | DefKind::Const
        | DefKind::Static { .. }
        | DefKind::Ctor(..)
        | DefKind::AssocFn
        | DefKind::AssocConst
        | DefKind::AnonConst
        | DefKind::OpaqueTy
        | DefKind::Impl { .. }
        | DefKind::Field
        | DefKind::TyParam
        | DefKind::Closure
        | DefKind::SyntheticCoroutineBody => true,
        DefKind::Mod
        | DefKind::ForeignMod
        | DefKind::ConstParam
        | DefKind::Macro(..)
        | DefKind::Use
        | DefKind::LifetimeParam
        | DefKind::GlobalAsm
        | DefKind::ExternCrate
        | DefKind::TestBinderConstraints => false,
    }
}

// rustc_metadata/src/rmeta/encoder.rs:1288 should_encode_type, verbatim.
fn should_encode_type(tcx: TyCtxt<'_>, def_id: LocalDefId, def_kind: DefKind) -> bool {
    match def_kind {
        DefKind::Struct
        | DefKind::Union
        | DefKind::Enum
        | DefKind::Variant
        | DefKind::Ctor(..)
        | DefKind::Field
        | DefKind::Fn
        | DefKind::Const
        | DefKind::Static { nested: false, .. }
        | DefKind::TyAlias
        | DefKind::ForeignTy
        | DefKind::Impl { .. }
        | DefKind::AssocFn
        | DefKind::AssocConst
        | DefKind::Closure
        | DefKind::ConstParam
        | DefKind::AnonConst
        | DefKind::SyntheticCoroutineBody => true,

        DefKind::OpaqueTy => {
            let origin = tcx.local_opaque_ty_origin(def_id);
            if let hir::OpaqueTyOrigin::FnReturn { parent, .. }
            | hir::OpaqueTyOrigin::AsyncFn { parent, .. } = origin
                && let hir::Node::TraitItem(trait_item) = tcx.hir_node_by_def_id(parent)
                && let (_, hir::TraitFn::Required(..)) = trait_item.expect_fn()
            {
                false
            } else {
                true
            }
        }

        DefKind::AssocTy => {
            let assoc_item = tcx.associated_item(def_id);
            match assoc_item.container {
                ty::AssocContainer::InherentImpl | ty::AssocContainer::TraitImpl(_) => true,
                ty::AssocContainer::Trait => assoc_item.defaultness(tcx).has_value(),
            }
        }
        DefKind::TyParam => {
            let hir::Node::GenericParam(param) = tcx.hir_node_by_def_id(def_id) else { rustc_span::bug!() };
            let hir::GenericParamKind::Type { default, .. } = param.kind else { rustc_span::bug!() };
            default.is_some()
        }

        DefKind::Trait
        | DefKind::TraitAlias
        | DefKind::Mod
        | DefKind::ForeignMod
        | DefKind::Macro(..)
        | DefKind::Static { nested: true, .. }
        | DefKind::Use
        | DefKind::LifetimeParam
        | DefKind::GlobalAsm
        | DefKind::ExternCrate
        | DefKind::TestBinderConstraints => false,
    }
}

// rustc_metadata/src/rmeta/encoder.rs:1349 should_encode_fn_sig, verbatim.
fn should_encode_fn_sig(def_kind: DefKind) -> bool {
    match def_kind {
        DefKind::Fn | DefKind::AssocFn | DefKind::Ctor(_, CtorKind::Fn) => true,

        DefKind::Struct
        | DefKind::Union
        | DefKind::Enum
        | DefKind::Variant
        | DefKind::Field
        | DefKind::Const
        | DefKind::Static { .. }
        | DefKind::Ctor(..)
        | DefKind::TyAlias
        | DefKind::OpaqueTy
        | DefKind::ForeignTy
        | DefKind::Impl { .. }
        | DefKind::AssocConst
        | DefKind::Closure
        | DefKind::ConstParam
        | DefKind::AnonConst
        | DefKind::AssocTy
        | DefKind::TyParam
        | DefKind::Trait
        | DefKind::TraitAlias
        | DefKind::Mod
        | DefKind::ForeignMod
        | DefKind::Macro(..)
        | DefKind::Use
        | DefKind::LifetimeParam
        | DefKind::GlobalAsm
        | DefKind::ExternCrate
        | DefKind::SyntheticCoroutineBody
        | DefKind::TestBinderConstraints => false,
    }
}

/// The DefIds that have HIR: every HIR owner and every key of its `lower_to_hir(..).children` (what
/// `lower_to_hir`'s `fallback_to_ancestor` looks a non-owner DefId up in).
fn defs_with_hir(tcx: TyCtxt<'_>) -> HashSet<LocalDefId> {
    let mut set = HashSet::new();
    let owners = std::iter::once(hir::CRATE_OWNER_ID).chain(tcx.hir_crate_items(()).owners());
    for owner in owners {
        set.insert(owner.def_id);
        if let hir::MaybeOwner::Owner(info) = tcx.lower_to_hir(owner.def_id) {
            set.extend(unord_vec(info.children.items()).into_iter().map(|(id, _)| *id));
        }
    }
    set
}

fn dump(tcx: TyCtxt<'_>, num_definitions_after_lowering: usize) -> String {
    let mut out = String::new();
    let num_definitions = tcx.definitions_untracked().num_definitions();
    let typecked: HashSet<LocalDefId> =
        tcx.hir_body_owners().filter(|&id| prefix::check_crate_typecks(tcx, id)).collect();
    let with_hir = defs_with_hir(tcx);

    writeln!(out, "== items ({num_definitions})").unwrap();
    for i in 0..num_definitions {
        let local_id = LocalDefId { local_def_index: rustc_hir::def_id::DefIndex::from_usize(i) };
        let def_id = local_id.to_def_id();
        let def_kind = tcx.def_kind(local_id);
        writeln!(out, "{} {}", dbg(local_id), dbg(def_kind)).unwrap();

        // A DefId without HIR that lowering did not create either (e.g. one defined inside an
        // attribute's expression, which is never lowered) has none of the facts: its queries would
        // ICE in `lower_to_hir`.
        if !(with_hir.contains(&local_id) || i >= num_definitions_after_lowering) {
            continue;
        }

        // As `encode_def_ids`: these DefIds are never used.
        if def_kind == DefKind::AnonConst
            && matches!(
                tcx.hir_node_by_def_id(local_id),
                hir::Node::ConstArg(_) | hir::Node::Infer(hir::InferArg { kind: hir::InferArgKind::Const, .. })
            )
        {
            continue;
        }

        if should_encode_generics(def_kind) {
            fact(&mut out, "generics_of", tcx.generics_of(def_id));
            fact(&mut out, "clauses_of", tcx.clauses_of(def_id));
        }
        if should_encode_type(tcx, local_id, def_kind) {
            fact(&mut out, "type_of", tcx.type_of(def_id));
        }
        if should_encode_fn_sig(def_kind) {
            fact(&mut out, "fn_sig", tcx.fn_sig(def_id));
        }
        if should_encode_variances(tcx, def_id, def_kind) {
            fact(&mut out, "variances_of", tcx.variances_of(def_id));
        }
        let trait_assoc_ty = def_kind == DefKind::AssocTy
            && matches!(tcx.associated_item(def_id).container, ty::AssocContainer::Trait);
        if def_kind == DefKind::OpaqueTy || trait_assoc_ty {
            fact(&mut out, "explicit_item_bounds", tcx.explicit_item_bounds(def_id));
        }
        if def_kind == (DefKind::Impl { of_trait: true }) {
            fact(&mut out, "impl_trait_header", tcx.impl_trait_header(local_id));
        }
        if typecked.contains(&local_id) {
            writeln!(out, "  typeck").unwrap();
            dump_typeck(&mut out, tcx, tcx.typeck(local_id));
        }
    }
    out
}

/// `    <name> <a> <b>` lines of an `items_in_stable_order` table.
fn table<V: Debug>(out: &mut String, name: &str, items: Vec<(ItemLocalId, &V)>) {
    for (id, v) in items {
        let (a, b) = (dbg(id), dbg(v));
        writeln!(out, "    {name} {a} {b}").unwrap();
    }
}

fn dump_typeck<'tcx>(out: &mut String, tcx: TyCtxt<'tcx>, r: &ty::TypeckResults<'tcx>) {
    let owner = r.hir_owner;
    let n_nodes = tcx.hir_owner_nodes(owner).nodes.len();
    let hir_id = |i: usize| HirId { owner, local_id: ItemLocalId::from_usize(i) };

    writeln!(out, "    hir_owner {}", dbg(owner)).unwrap();
    writeln!(out, "    tainted_by_errors {}", dbg(r.tainted_by_errors)).unwrap();
    table(out, "type_dependent_defs", r.type_dependent_defs().items_in_stable_order());
    table(out, "field_indices", r.field_indices().items_in_stable_order());
    table(out, "node_types", r.node_types().items_in_stable_order());
    // No listing accessor (only `node_args_mut`): every ItemLocalId of the owner, in order (7).
    for i in 0..n_nodes {
        if let Some(args) = r.node_args_opt(hir_id(i)) {
            writeln!(out, "    node_args {} {}", dbg(ItemLocalId::from_usize(i)), dbg(args)).unwrap();
        }
    }
    table(out, "user_provided_types", r.user_provided_types().items_in_stable_order());
    let mut v = unord_vec(r.user_provided_sigs.items());
    v.sort_by_key(|(id, _)| di(**id));
    for (id, sig) in v {
        writeln!(out, "    user_provided_sigs {} {}", dbg(id), dbg(sig)).unwrap();
    }
    table(out, "adjustments", r.adjustments().items_in_stable_order());
    table(out, "pat_binding_modes", r.pat_binding_modes().items_in_stable_order());
    table(out, "rust_2024_migration_desugared_pats", r.rust_2024_migration_desugared_pats().items_in_stable_order());
    table(out, "pat_adjustments", r.pat_adjustments().items_in_stable_order());
    // No listing accessor: every ItemLocalId of the owner, in order (7).
    let skipped = r.skipped_ref_pats();
    for i in 0..n_nodes {
        if skipped.contains(hir_id(i)) {
            writeln!(out, "    skipped_ref_pats {}", dbg(ItemLocalId::from_usize(i))).unwrap();
        }
    }
    table(out, "closure_kind_origins", r.closure_kind_origins().items_in_stable_order());
    table(out, "liberated_fn_sigs", r.liberated_fn_sigs().items_in_stable_order());
    table(out, "fru_field_types", r.fru_field_types().items_in_stable_order());
    let mut v: Vec<ItemLocalId> = unord_vec(r.coercion_casts().items().copied());
    v.sort();
    for id in v {
        writeln!(out, "    coercion_casts {}", dbg(id)).unwrap();
    }
    let mut v: Vec<LocalDefId> = unord_vec(r.used_trait_imports.items().copied());
    v.sort_by_key(|id| di(*id));
    for id in v {
        writeln!(out, "    used_trait_imports {}", dbg(id)).unwrap();
    }
    for (id, h) in r.hidden_types.iter() {
        writeln!(out, "    hidden_types {} {}", dbg(id), dbg(h)).unwrap();
    }
    let mut v = unord_vec(r.closure_min_captures.items());
    v.sort_by_key(|(id, _)| di(**id));
    for (id, roots) in v {
        for (root, places) in roots.iter() {
            writeln!(out, "    closure_min_captures {} {} {}", dbg(id), dbg(root), dbg(places)).unwrap();
        }
    }
    let mut v = unord_vec(r.closure_fake_reads.items());
    v.sort_by_key(|(id, _)| di(**id));
    for (id, reads) in v {
        writeln!(out, "    closure_fake_reads {} {}", dbg(id), dbg(reads)).unwrap();
    }
    for p in r.coroutine_stalled_predicates.iter() {
        writeln!(out, "    coroutine_stalled_predicates {}", dbg(p)).unwrap();
    }
    for t in r.transmutes_to_check.iter() {
        writeln!(out, "    transmutes_to_check {}", dbg(t)).unwrap();
    }
    table(out, "offset_of_data", r.offset_of_data().items_in_stable_order());
}

fn main() -> ExitCode {
    let early_dcx = EarlyDiagCtxt::new(ErrorOutputType::default());
    // As rustc_driver_impl::main: tracing's default filter (`RUSTC_LOG` unset) prints WARN and ERROR events.
    rustc_driver::init_rustc_env_logger(&early_dcx);
    rustc_driver::install_ice_hook(rustc_driver::DEFAULT_BUG_REPORT_URL, |_| ());
    let mut callbacks = TyDump;
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&rustc_driver::args::raw_args(&early_dcx), &mut callbacks))
}
