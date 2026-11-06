//! Oracle probe for src/rustc_monomorphize/collector.oracle.test.ts (lane mono-collector). A rustc-dev program: the pinned
//! nightly's own `rustc_driver`, stopped after `collect_and_partition_mono_items`.
//!
//! `collect_crate_mono_items` is `pub(crate)` and its sorted `Vec` is not observable from outside (`-Zprint-mono-items`
//! sorts again, by text), so this prints what that order is made of, for every item in a codegen unit:
//!     FP <fingerprint as 32 hex digits> <item, with_no_trimmed_paths>
//! `MonoItem::to_stable_hash_key`, the sort key of `into_sorted(hcx, true)`, is public. An item that no CGU holds has no
//! line here (the test reports how many of the `MONO_ITEM` lines were covered).
//!
//! It also prints, as `VT ` lines, what `tcx.vtable_allocation` holds, slot by slot, for every vtable reachable from the
//! crate's statics. `-Zprint-mono-items` only shows which instances a vtable reaches; this shows sizes, alignments, null
//! drop slots, vacant slots and, printed under its slot, the supertrait vtable a `TraitVPtr` slot points at. Blocks are sorted by header and deduplicated: `AllocId`s and the walk's order are not the
//! point. The same walk is in collector_oracle/run.ts.
//!
//! Built by collector_oracle/regen.ts with RUSTC_BOOTSTRAP=1; not in tools/probes, which lanes do not edit.
#![feature(rustc_private)]
extern crate rustc_abi;
extern crate rustc_data_structures;
extern crate rustc_driver;
extern crate rustc_hir;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_session;

use std::collections::{BTreeMap, BTreeSet};
use std::process::ExitCode;

use rustc_abi::Size;
use rustc_data_structures::fingerprint::Fingerprint;
use rustc_data_structures::stable_hash::ToStableHashKey;
use rustc_driver::{Callbacks, Compilation};
use rustc_hir::def::DefKind;
use rustc_interface::interface;
use rustc_middle::mir::interpret::{AllocId, Allocation, GlobalAlloc, Scalar, alloc_range};
use rustc_middle::ty::TyCtxt;
use rustc_middle::ty::print::with_no_trimmed_paths;
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;

fn slot<'tcx>(tcx: TyCtxt<'tcx>, id: AllocId) -> String {
    match tcx.global_alloc(id) {
        GlobalAlloc::Function { instance } => format!("fn {instance}"),
        GlobalAlloc::VTable(ty, dyn_ty) => format!("vtable {dyn_ty} for {ty}"),
        GlobalAlloc::Memory(_) => "memory".to_string(),
        GlobalAlloc::Static(_) => "static".to_string(),
        GlobalAlloc::TypeId { .. } => "typeid".to_string(),
    }
}

fn walk<'tcx>(tcx: TyCtxt<'tcx>, id: AllocId, seen: &mut BTreeSet<AllocId>, out: &mut BTreeMap<String, String>) {
    if !seen.insert(id) {
        return;
    }
    match tcx.global_alloc(id) {
        GlobalAlloc::Function { .. } | GlobalAlloc::TypeId { .. } => {}
        GlobalAlloc::Static(def_id) => {
            if let Ok(alloc) = tcx.eval_static_initializer(def_id) {
                for &(_, prov) in alloc.inner().provenance().ptrs().iter() {
                    walk(tcx, prov.alloc_id(), seen, out);
                }
            }
        }
        GlobalAlloc::Memory(alloc) => {
            for &(_, prov) in alloc.inner().provenance().ptrs().iter() {
                walk(tcx, prov.alloc_id(), seen, out);
            }
        }
        GlobalAlloc::VTable(ty, dyn_ty) => {
            let principal = dyn_ty.principal().map(|p| tcx.instantiate_bound_regions_with_erased(p));
            let vtable_id = tcx.vtable_allocation((ty, principal));
            let alloc = tcx.global_alloc(vtable_id).unwrap_memory();
            let body = dump_block(tcx, alloc.inner(), "", seen, out);
            out.insert(format!("VTABLE {dyn_ty} for {ty}"), body);
        }
    }
}

/// One block of a vtable, a line per pointer-sized slot. A slot holding a pointer to plain memory is a supertrait vtable
/// (`VtblEntry::TraitVPtr`): what it points at is printed under it, one level in, so a wrong upcasting target shows.
fn dump_block<'tcx>(
    tcx: TyCtxt<'tcx>,
    inner: &Allocation,
    indent: &str,
    seen: &mut BTreeSet<AllocId>,
    out: &mut BTreeMap<String, String>,
) -> String {
    let ptr_size = tcx.data_layout.pointer_size();
    let mut body = format!("{indent}size {} align {} {:?}\n", inner.size().bytes(), inner.align.bytes(), inner.mutability);
    let mut off = Size::ZERO;
    while off < inner.size() {
        let mut nested = String::new();
        let text = match inner.read_scalar(&tcx, alloc_range(off, ptr_size), true) {
            Err(_) => "uninit".to_string(),
            Ok(Scalar::Int(int)) => format!("int {}", int.to_bits(ptr_size)),
            Ok(Scalar::Ptr(ptr, _)) => {
                let (prov, offset) = ptr.prov_and_relative_offset();
                walk(tcx, prov.alloc_id(), seen, out);
                if let GlobalAlloc::Memory(alloc) = tcx.global_alloc(prov.alloc_id()) {
                    nested = dump_block(tcx, alloc.inner(), &format!("{indent}    "), seen, out);
                }
                format!("{} +{}", slot(tcx, prov.alloc_id()), offset.bytes())
            }
        };
        body.push_str(&format!("{indent}  {}: {text}\n{nested}", off.bytes()));
        off += ptr_size;
    }
    body
}

struct Probe;

impl Callbacks for Probe {
    #[allow(rustc::bad_opt_access)]
    fn config(&mut self, config: &mut interface::Config) {
        // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
        config.opts.trimmed_def_paths = true;
    }

    fn after_analysis<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let partitions = tcx.collect_and_partition_mono_items(());
        let mut out: BTreeMap<Fingerprint, String> = BTreeMap::new();
        tcx.with_stable_hashing_context(|mut hcx| {
            for cgu in partitions.codegen_units {
                for (item, _) in cgu.items() {
                    let fp: Fingerprint = item.to_stable_hash_key(&mut hcx);
                    out.insert(fp, with_no_trimmed_paths!(item.to_string()));
                }
            }
        });
        for (fp, item) in out {
            let (a, b) = fp.split();
            println!("FP {:016x}{:016x} {item}", a.as_u64(), b.as_u64());
        }
        let mut seen = BTreeSet::new();
        let mut vtables = BTreeMap::new();
        with_no_trimmed_paths!({
            for item in tcx.hir_crate_items(()).free_items() {
                let def_id = item.owner_id.to_def_id();
                if matches!(tcx.def_kind(def_id), DefKind::Static { .. }) {
                    walk(tcx, tcx.reserve_and_set_static_alloc(def_id), &mut seen, &mut vtables);
                }
            }
        });
        for (header, body) in vtables {
            println!("VT {header}");
            for line in body.lines() {
                println!("VT {line}");
            }
        }
        Compilation::Stop
    }
}

fn main() -> ExitCode {
    let early_dcx = EarlyDiagCtxt::new(ErrorOutputType::default());
    rustc_driver::init_rustc_env_logger(&early_dcx);
    rustc_driver::install_ice_hook(rustc_driver::DEFAULT_BUG_REPORT_URL, |_| ());
    let mut callbacks = Probe;
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&rustc_driver::args::raw_args(&early_dcx), &mut callbacks))
}
