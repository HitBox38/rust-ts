//! Oracle probe for src/rustc_metadata/rmeta/decoder_a.oracle.test.ts (lane rmeta-decoder-a).
//!
//!   rmetadefs <crate>[,<crate>...] <rustc arguments...>
//!
//! Runs a compilation with the pinned nightly's own `rustc_driver` (rustc-dev component) and, in
//! `after_expansion`, prints for every listed (loaded) crate, in list order:
//!
//!   crate <name> num_def_ids=<n>
//!   diag <name> <index>                      `diagnostic_items(cnum).name_to_id`, map order
//!   stab_impl <a> <b>                        `stability_implications(cnum)`, sorted by (a, b)
//!   canon <symbol> <index>                   `canonical_symbols(cnum).iter()`
//!   fake_doc <index>                         `fake_doc_items(cnum)`
//!   <index>\tkind=..\tvis=..\tspan=..\texpn=..\tname=..\tpath=..\tdefault=..
//!
//! The per-DefIndex lines cover `chunks(n)`: [0, 200), [n/2, n/2 + 100), [n - 100, n), clamped and
//! merged. Fields:
//! - `kind`: `{:?}` of `def_kind`;
//! - `vis`: `visibility` (`Public` / `Restricted(<index of the module>)`), `-` unless the encoder records
//!   one (`should_encode_visibility`, copied from encoder.rs);
//! - `span`: `def_span` (`should_encode_span`), `-` otherwise;
//! - `expn`: `expn_that_defined` (`should_encode_expn_that_defined`): `root` or `<crate>:<local index>
//!   <ExpnKind:?>`;
//! - `name`: `CrateMetadata::opt_item_name` (decoder.rs:1048) over `tcx.def_key`, `-` for `None`;
//! - `path`: `tcx.def_path(..).to_string_no_crate_verbose()`;
//! - `default`: `default_field` for `DefKind::Field` (`<crate>:<index>` / `-`), `-` otherwise.
//!
//! Spans and syntax contexts are printed independently of the session's decoding order (the source map
//! positions and `SyntaxContext` numbers depend on it): `<file name (prefer remapped)>:<lo>..<hi>` relative
//! to the file start, or `dummy` for `lo == hi == 0`, then ` #[<expn>/<Transparency>, ..]` (the context's
//! `marks()`, outermost last) when the context is not the root. An `ExpnId` is `<crate name>:<local index>`.
#![feature(rustc_private)]

extern crate rustc_driver;
extern crate rustc_hir;
extern crate rustc_interface;
extern crate rustc_metadata;
extern crate rustc_middle;
extern crate rustc_session;
extern crate rustc_span;

use std::fmt::Write as _;
use std::io::Write as _;
use std::process::ExitCode;

use rustc_driver::{Callbacks, Compilation};
use rustc_hir::def::DefKind;
use rustc_hir::def_id::{CrateNum, DefId, DefIndex};
use rustc_hir::definitions::DefPathData;
use rustc_interface::interface;
use rustc_metadata::creader::CStore;
use rustc_middle::ty::{TyCtxt, Visibility};
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;
use rustc_span::hygiene::{ExpnId, SyntaxContext};
use rustc_span::{Span, Symbol};

/// The DefIndex ranges printed for a crate with `n` DefIndexes (the TS test uses the same rule).
fn chunks(n: usize) -> Vec<(usize, usize)> {
    let mut out: Vec<(usize, usize)> = Vec::new();
    let mid = n / 2;
    for (a, b) in [(0, 200.min(n)), (mid, (mid + 100).min(n)), (n.saturating_sub(100), n)] {
        if let Some(last) = out.last_mut() {
            if a <= last.1 {
                last.1 = last.1.max(b);
                continue;
            }
        }
        out.push((a, b));
    }
    out
}

// encoder.rs:974
fn should_encode_span(def_kind: DefKind) -> bool {
    match def_kind {
        DefKind::Mod
        | DefKind::Struct
        | DefKind::Union
        | DefKind::Enum
        | DefKind::Variant
        | DefKind::Trait
        | DefKind::TyAlias
        | DefKind::ForeignTy
        | DefKind::TraitAlias
        | DefKind::AssocTy
        | DefKind::TyParam
        | DefKind::ConstParam
        | DefKind::LifetimeParam
        | DefKind::Fn
        | DefKind::Const
        | DefKind::Static { .. }
        | DefKind::Ctor(..)
        | DefKind::AssocFn
        | DefKind::AssocConst
        | DefKind::Macro(_)
        | DefKind::ExternCrate
        | DefKind::Use
        | DefKind::AnonConst
        | DefKind::OpaqueTy
        | DefKind::Field
        | DefKind::Impl { .. }
        | DefKind::Closure
        | DefKind::SyntheticCoroutineBody => true,
        DefKind::ForeignMod | DefKind::GlobalAsm | DefKind::TestBinderConstraints => false,
    }
}

// encoder.rs:1052
fn should_encode_expn_that_defined(def_kind: DefKind) -> bool {
    match def_kind {
        DefKind::Mod
        | DefKind::Struct
        | DefKind::Union
        | DefKind::Enum
        | DefKind::Variant
        | DefKind::Trait
        | DefKind::Impl { .. } => true,
        DefKind::TyAlias
        | DefKind::ForeignTy
        | DefKind::TraitAlias
        | DefKind::AssocTy
        | DefKind::TyParam
        | DefKind::Fn
        | DefKind::Const
        | DefKind::ConstParam
        | DefKind::Static { .. }
        | DefKind::Ctor(..)
        | DefKind::AssocFn
        | DefKind::AssocConst
        | DefKind::Macro(_)
        | DefKind::ExternCrate
        | DefKind::Use
        | DefKind::ForeignMod
        | DefKind::AnonConst
        | DefKind::OpaqueTy
        | DefKind::Field
        | DefKind::LifetimeParam
        | DefKind::GlobalAsm
        | DefKind::Closure
        | DefKind::SyntheticCoroutineBody
        | DefKind::TestBinderConstraints => false,
    }
}

// encoder.rs:1088
fn should_encode_visibility(def_kind: DefKind) -> bool {
    match def_kind {
        DefKind::Mod
        | DefKind::Struct
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
        | DefKind::Static { nested: false, .. }
        | DefKind::Ctor(..)
        | DefKind::AssocFn
        | DefKind::AssocConst
        | DefKind::Macro(..)
        | DefKind::Field => true,
        DefKind::Use
        | DefKind::ForeignMod
        | DefKind::TyParam
        | DefKind::ConstParam
        | DefKind::LifetimeParam
        | DefKind::AnonConst
        | DefKind::Static { nested: true, .. }
        | DefKind::OpaqueTy
        | DefKind::GlobalAsm
        | DefKind::Impl { .. }
        | DefKind::Closure
        | DefKind::ExternCrate
        | DefKind::SyntheticCoroutineBody
        | DefKind::TestBinderConstraints => false,
    }
}

/// `CrateMetadata::opt_item_name` (decoder.rs:1048), over the query system's `def_key`.
fn opt_item_name(tcx: TyCtxt<'_>, def_id: DefId) -> Option<Symbol> {
    let def_key = tcx.def_key(def_id);
    def_key.disambiguated_data.data.get_opt_name().or_else(|| {
        if def_key.disambiguated_data.data == DefPathData::Ctor {
            let parent_index = def_key.parent.expect("no parent for a constructor");
            tcx.def_key(DefId { krate: def_id.krate, index: parent_index }).disambiguated_data.data.get_opt_name()
        } else {
            None
        }
    })
}

fn expn_short(tcx: TyCtxt<'_>, e: ExpnId) -> String {
    if e == ExpnId::root() { "root".to_string() } else { format!("{}:{}", tcx.crate_name(e.krate), e.local_id.as_u32()) }
}

fn ctxt_str(tcx: TyCtxt<'_>, ctxt: SyntaxContext) -> String {
    let marks = ctxt.marks();
    if marks.is_empty() {
        return String::new();
    }
    let v: Vec<String> = marks.iter().map(|(e, t)| format!("{}/{t:?}", expn_short(tcx, *e))).collect();
    format!(" #[{}]", v.join(", "))
}

fn span_str(tcx: TyCtxt<'_>, sp: Span) -> String {
    let data = sp.data();
    let ctxt = ctxt_str(tcx, data.ctxt);
    if data.lo.0 == 0 && data.hi.0 == 0 {
        return format!("dummy{ctxt}");
    }
    let sm = tcx.sess.source_map();
    let lo = sm.lookup_byte_offset(data.lo);
    let hi = data.hi.0 - lo.sf.start_pos.0;
    format!("{}:{}..{}{}", lo.sf.name.prefer_remapped_unconditionally(), lo.pos.0, hi, ctxt)
}

fn dump(tcx: TyCtxt<'_>, wanted: &[String]) -> String {
    let mut out = String::new();
    for want in wanted {
        let Some(&cnum) = tcx.crates(()).iter().find(|&&c| tcx.crate_name(c).as_str() == want) else {
            panic!("crate {want} is not loaded");
        };
        let cnum: CrateNum = cnum;
        let n = CStore::from_tcx(tcx).num_def_ids_untracked(cnum);
        writeln!(out, "crate {want} num_def_ids={n}").unwrap();

        for (name, id) in tcx.diagnostic_items(cnum).name_to_id.iter() {
            writeln!(out, "diag {name} {}", id.index.as_u32()).unwrap();
        }
        let mut si: Vec<(String, String)> =
            tcx.stability_implications(cnum).to_sorted_stable_ord().into_iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
        si.sort();
        for (a, b) in si {
            writeln!(out, "stab_impl {a} {b}").unwrap();
        }
        for c in tcx.canonical_symbols(cnum).iter() {
            writeln!(out, "canon {} {}", c.symbol, c.def_id.index.as_u32()).unwrap();
        }
        for id in tcx.fake_doc_items(cnum).iter() {
            writeln!(out, "fake_doc {}", id.index.as_u32()).unwrap();
        }

        for (a, b) in chunks(n) {
            for i in a..b {
                let def_id = DefId { krate: cnum, index: DefIndex::from_usize(i) };
                let kind = tcx.def_kind(def_id);
                let vis = if should_encode_visibility(kind) {
                    match tcx.visibility(def_id) {
                        Visibility::Public => "Public".to_string(),
                        Visibility::Restricted(m) => format!("Restricted({})", m.to_def_id().index.as_u32()),
                    }
                } else {
                    "-".to_string()
                };
                let span = if should_encode_span(kind) { span_str(tcx, tcx.def_span(def_id)) } else { "-".to_string() };
                let expn = if should_encode_expn_that_defined(kind) {
                    let e = tcx.expn_that_defined(def_id);
                    if e == ExpnId::root() { "root".to_string() } else { format!("{} {:?}", expn_short(tcx, e), e.expn_data().kind) }
                } else {
                    "-".to_string()
                };
                let name = match opt_item_name(tcx, def_id) {
                    Some(s) => s.to_string(),
                    None => "-".to_string(),
                };
                let path = tcx.def_path(def_id).to_string_no_crate_verbose();
                let default = if kind == DefKind::Field {
                    match tcx.default_field(def_id) {
                        Some(d) => format!("{}:{}", tcx.crate_name(d.krate), d.index.as_u32()),
                        None => "-".to_string(),
                    }
                } else {
                    "-".to_string()
                };
                writeln!(out, "{i}\tkind={kind:?}\tvis={vis}\tspan={span}\texpn={expn}\tname={name}\tpath={path}\tdefault={default}").unwrap();
            }
        }
    }
    out
}

struct Probe {
    wanted: Vec<String>,
}

impl Callbacks for Probe {
    fn after_expansion<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let out = dump(tcx, &self.wanted);
        let mut stdout = std::io::stdout().lock();
        stdout.write_all(out.as_bytes()).unwrap();
        stdout.flush().unwrap();
        Compilation::Stop
    }
}

fn main() -> ExitCode {
    let early_dcx = EarlyDiagCtxt::new(ErrorOutputType::default());
    rustc_driver::install_ice_hook(rustc_driver::DEFAULT_BUG_REPORT_URL, |_| ());
    let raw = rustc_driver::args::raw_args(&early_dcx);
    if raw.len() < 3 {
        eprintln!("usage: rmetadefs <crate>[,<crate>...] <rustc arguments...>");
        return ExitCode::from(2);
    }
    let wanted: Vec<String> = raw[1].split(',').map(|s| s.to_string()).collect();
    let mut args = vec![raw[0].clone()];
    args.extend(raw[2..].iter().cloned());
    let mut callbacks = Probe { wanted };
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&args, &mut callbacks))
}
