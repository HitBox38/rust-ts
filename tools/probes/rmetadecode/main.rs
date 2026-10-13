//! Oracle probe for src/rustc_metadata/rmeta/decoder_b.oracle.test.ts (lane rmeta-decoder-b).
//!
//!   rmetadecode <rustc args...>
//!
//! Runs the oracle compiler (its own `rustc_driver`) with the given arguments and stops after expansion. Then, for
//! every crate in `tcx.crates(())`, it prints what the oracle's `CrateMetadata` answers through the queries
//! cstore_impl.rs provides from it:
//!   crate <name> cnum=<n> hash=<Svh> dep_kind=<CrateDepKind:?> num_def_ids=<n>
//!   def <index> key=<DefKey:?> hash=<DefPathHash:?> path=<def_path(..).to_string_no_crate_verbose()> mir=<bool> hidden=<bool>
//!       (`def_key`, `def_path_hash`, `def_path`, `is_item_mir_available`, `get_attr_flags` (IS_DOC_HIDDEN))
//!   child <name> <res> <vis>      (`module_children` of the crate root: `get_module_children`)
//!   lang <LangItem::name> <index> (`defined_lang_items`: `get_lang_items`)
//!   missing_lang <LangItem::name> (`missing_lang_items`: `get_missing_lang_items`)
//!   diag <name> <index>           (`diagnostic_items(cnum).name_to_id`: `get_diagnostic_items`)
//!   traits <n>                    (`traits(cnum)`: `get_traits`)
//! DefIds are printed as their `DefIndex` (all are in the crate itself, or `krate:index`), never through the
//! tcx-qualified `{:?}` of `DefId`.
#![feature(rustc_private)]

extern crate rustc_driver;
extern crate rustc_hir;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_span;

use rustc_driver::{Callbacks, Compilation};
use rustc_hir::def::Res;
use rustc_interface::interface;
use rustc_middle::ty::{TyCtxt, Visibility};
use rustc_span::def_id::{CrateNum, DefId, DefIndex};

fn did(cnum: CrateNum, d: DefId) -> String {
    if d.krate == cnum { format!("{}", d.index.as_u32()) } else { format!("{}:{}", d.krate.as_u32(), d.index.as_u32()) }
}

struct Probe;

impl Callbacks for Probe {
    fn after_expansion<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        for &cnum in tcx.crates(()) {
            let n = tcx.num_extern_def_ids(cnum);
            println!(
                "crate {} cnum={} hash={} dep_kind={:?} num_def_ids={}",
                tcx.crate_name(cnum),
                cnum.as_u32(),
                tcx.crate_hash(cnum),
                tcx.crate_dep_kind(cnum),
                n
            );
            for i in 0..n {
                let d = DefId { krate: cnum, index: DefIndex::from_usize(i) };
                println!(
                    "def {i} key={:?} hash={:?} path={} mir={} hidden={}",
                    tcx.def_key(d),
                    tcx.def_path_hash(d),
                    tcx.def_path(d).to_string_no_crate_verbose(),
                    tcx.is_mir_available(d),
                    tcx.is_doc_hidden(d)
                );
            }
            for child in tcx.module_children(cnum.as_def_id()) {
                let res = match child.res {
                    Res::Def(kind, d) => format!("Def({kind:?}, {})", did(cnum, d)),
                    r => format!("{r:?}"),
                };
                let vis = match child.vis {
                    Visibility::Public => "pub".to_string(),
                    Visibility::Restricted(m) => format!("restricted({})", did(cnum, m.to_def_id())),
                };
                println!("child {} {res} {vis}", child.ident.name);
            }
            for &(d, item) in tcx.defined_lang_items(cnum) {
                println!("lang {} {}", item.name(), did(cnum, d));
            }
            for item in tcx.missing_lang_items(cnum) {
                println!("missing_lang {}", item.name());
            }
            for (name, &d) in tcx.diagnostic_items(cnum).name_to_id.iter() {
                println!("diag {name} {}", did(cnum, d));
            }
            println!("traits {}", tcx.traits(cnum).len());
        }
        Compilation::Stop
    }
}

fn main() {
    let mut args: Vec<String> = vec!["rustc".to_string()];
    args.extend(std::env::args().skip(1));
    rustc_driver::compiler_entrypoint(&args, &mut Probe);
}
