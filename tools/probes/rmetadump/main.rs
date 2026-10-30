//! Oracle probe for the `rmeta-*` suites (plan-m5 §4, D4; lane probe-rmetadump).
//!
//!   rmetadump [--content] <file.rmeta> <rustc arguments...>
//!
//! `--content` leaves out `root.layout` and `root.hash` (positions, widths, the SVH): what is left is what the
//! decoder reads, independent of where it is in the file (the `rmeta-ui` suite; byte identity is `check-*`'s).
//! Prints one `.rmeta` (the oracle's or the port's: same format, same decoder) as stable text, one section per
//! `== <key>` line, which scripts/lib/split.ts `splitRmetaDump` cuts into cases. The first line,
//! `rmetadump <crate name>`, and the `== ` lines are the skeleton; every other line belongs to the section above it
//! and is indented, so no value can start a section.
//!
//! 1. The raw file, mirrored from tools/probes/rmetaroot (`CrateRoot`, rmeta/mod.rs:270, `define_tables!` at :421,
//!    lazy distances as decoder.rs:203 `read_lazy_offset_then`), every leaf decoded by the oracle's own impls:
//!    - `== root`: the version string, `CrateHeader`, the scalar fields, every `LazyArray`'s length, every
//!      `LazyTable`'s length, `CrateRootUnhashed`;
//!    - `== root.layout`: the positions (root, unhashed, every lazy array / value / table) and the table widths
//!      (a width is the byte count of the table's largest entry, so position tables widen with the file);
//!    - `== root.hash`: the crate hash (SVH; `-Zmetadata-crate-hash`: a hash of the bytes, encoder.rs:2670);
//!    - `== crate_deps`: the `CrateDep`s (name, hash, host hash, kind, private), in encoded order.
//!    A stub or proc-macro crate stops here.
//! 2. A session of the oracle's `rustc_driver` (rustc-dev; the remaining arguments, e.g. `--target` and `--sysroot`,
//!    are rustc's) compiles `#![feature(no_core)] #![no_core] extern crate r#<name>;` (an `Input::Str`, edition 2021,
//!    `-Awarnings`) with `--extern <name>=<file.rmeta>` and, in `after_expansion`, prints through the oracle's queries (the extern
//!    providers of cstore_impl.rs, which decode the file):
//!    - one section per crate-level list (`lang_items`, `diagnostic_items`, `traits`, `impls`, ...), in the
//!      `CrateRoot`'s field order;
//!    - `== def <def path>` for every DefIndex, in index order (`to_string_no_crate_verbose`: the path with every
//!      disambiguator; not always unique: 18 paths repeat in core at the pin, e.g. a trait and its derive macro
//!      `def ::clone::Clone`, and scripts/lib/split.ts `uniqueIds` gives a repeat `@2`, `@3`, ...; so a missing or
//!      extra def shifts no other def's id, except among the repeats of its own path): `index <i>`, then one row per
//!      table that has an entry for it, in `define_tables!` order. Whether a table has an entry is read from the
//!      raw table (any nonzero byte: a default entry is all zeros, table.rs `FixedSizeEncoding`), so no query is
//!      asked for an entry that is not there. A fixed-size table's row is its raw entry bytes (`raw <hex>`, trailing
//!      zero bytes dropped: independent of the table width); a lazy one's is the query's value (`{:?}`, MIR through
//!      `MirWriter::write_mir_fn`), or `present` (`len=<n>` for arrays) where no query reads that table alone;
//!    - `== source_files`: the source files of the crate the session imported (sorted by name).
//!    A query that panics (a port rmeta the decoder cannot read) prints `!panic <message>` as its row, with the
//!    panic hook silenced, and the dump goes on; a panic outside a row is an ICE (exit 101) of the whole run.
//!
//! Stable text: values print with `with_no_trimmed_paths!`. A `Span`'s `{:?}` is `<file>:<l>:<c>: <l>:<c> (#<n>)`,
//! where `#<n>` numbers syntax contexts in the session's decoding order (which shifts after any difference), so
//! every ` (#<n>)` after a span is rewritten to its context's marks (` (#[<crate>:<expn>/<Transparency>, ..])`, `#[]`
//! for the root context, as tools/probes/rmetadefs); and `allocN` (interpreter allocation ids, numbered in decoding
//! order too) is renumbered within each section, by first occurrence.
//!
//! Blank lines: a row's multi-line value (`Out::row`; MIR text, multi-line `{:?}`) drops its empty lines, on both
//! sides, so that no line of a section is unindented. A difference made only of blank lines inside a value is
//! therefore invisible to the `rmeta-*` suites; the `check-*` suites (byte identity) still see it.
#![feature(rustc_private)]

extern crate rustc_data_structures;
extern crate rustc_driver;
extern crate rustc_hir;
extern crate rustc_interface;
extern crate rustc_metadata;
extern crate rustc_middle;
extern crate rustc_serialize;
extern crate rustc_session;
extern crate rustc_span;
extern crate rustc_target;
extern crate rustc_type_ir;

use std::collections::HashMap;
use std::fmt::Write as _;
use std::io::Write as _;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::process::ExitCode;

use rustc_data_structures::fingerprint::Fingerprint;
use rustc_data_structures::svh::Svh;
use rustc_driver::{Callbacks, Compilation};
use rustc_hir::def::{DefKind, Res};
use rustc_hir::def_id::{CrateNum, DefId, DefIndex};
use rustc_interface::interface;
use rustc_metadata::creader::{CStore, LoadedMacro};
use rustc_middle::mir::pretty::MirWriter;
use rustc_middle::ty::{self, TyCtxt};
use rustc_serialize::opaque::MemDecoder;
use rustc_serialize::{Decodable, Decoder};
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::{ErrorOutputType, Input, SymbolManglingVersion};
use rustc_span::def_id::StableCrateId;
use rustc_span::edition::Edition;
use rustc_span::hygiene::{ExpnId, SyntaxContext};
use rustc_span::{FileName, Span, Symbol};
use rustc_target::spec::{PanicStrategy, TargetTuple};
use rustc_type_ir::fast_reject::{TreatParams, simplify_type};

/// `define_tables!` (rmeta/mod.rs:421), in order, with whether the entry is a fixed-size value (`true`: bool, enums,
/// `u64`, `RawDefId`; printed raw) rather than a lazy value or array. scripts/rmeta-run.test.ts checks this list
/// against the pinned mod.rs.
const TABLES: &[(&str, bool)] = &[
    ("intrinsic", false),
    ("is_macro_rules", true),
    ("type_alias_is_checked", true),
    ("attr_flags", true),
    ("def_path_hashes", true),
    ("explicit_item_bounds", false),
    ("explicit_item_self_bounds", false),
    ("inferred_outlives_of", false),
    ("explicit_super_clauses_of", false),
    ("explicit_implied_clauses_of", false),
    ("explicit_implied_const_bounds", false),
    ("inherent_impls", false),
    ("opt_rpitit_info", false),
    ("module_children_reexports", false),
    ("ambig_module_children", false),
    ("cross_crate_inlinable", true),
    ("asyncness", true),
    ("constness", true),
    ("safety", true),
    ("defaultness", true),
    ("impl_is_fully_generic_for_reflection", true),
    ("attributes", false),
    ("module_children_non_reexports", false),
    ("associated_item_or_field_def_ids", false),
    // (Fixed-size, but printed through `def_kind`.)
    ("def_kind", false),
    ("visibility", false),
    ("def_span", false),
    ("def_ident_span", false),
    ("lookup_stability", false),
    ("lookup_const_stability", false),
    ("lookup_default_body_stability", false),
    ("lookup_deprecation_entry", false),
    ("explicit_clauses_of", false),
    ("generics_of", false),
    ("type_of", false),
    ("variances_of", false),
    ("fn_sig", false),
    ("codegen_fn_attrs", false),
    ("impl_trait_header", false),
    ("const_param_default", false),
    ("object_lifetime_default", false),
    ("optimized_mir", false),
    ("mir_for_ctfe", false),
    ("trivial_const", false),
    ("closure_saved_names_of_captured_variables", false),
    ("mir_coroutine_witnesses", false),
    ("promoted_mir", false),
    ("thir_abstract_const", false),
    ("impl_parent", true),
    ("const_conditions", false),
    ("coerce_unsized_info", false),
    ("mir_const_qualif", false),
    ("rendered_const", false),
    ("rendered_precise_capturing_args", false),
    ("fn_arg_idents", false),
    ("coroutine_kind", true),
    ("coroutine_for_closure", true),
    ("adt_destructor", false),
    ("adt_async_destructor", false),
    ("coroutine_by_move_body_def_id", true),
    ("eval_static_initializer", false),
    ("trait_def", false),
    ("expn_that_defined", false),
    ("default_fields", false),
    ("params_in_repr", false),
    ("repr_options", false),
    ("def_keys", false),
    ("variant_data", false),
    ("assoc_container", false),
    ("macro_definition", false),
    ("deduced_param_attrs", false),
    ("collect_return_position_impl_trait_in_trait_tys", false),
    ("doc_link_resolutions", false),
    ("doc_link_traits_in_scope", false),
    ("assumed_wf_types_for_rpitit", false),
    ("opaque_ty_origin", false),
    ("anon_const_kind", false),
    ("const_of_item", false),
    ("associated_types_for_impl_traits_in_trait_or_impl", false),
    ("live_args_for_alias_from_outlives_bounds", false),
    ("args_known_to_outlive_alias_params", false),
    ("mut_restriction", false),
];

/// The tables whose entry is a `LazyArray` (16 interleaved bytes: position, length), for their `len=<n>`.
const ARRAY_TABLES: &[&str] = &[
    "explicit_item_bounds", "explicit_item_self_bounds", "inferred_outlives_of", "explicit_super_clauses_of",
    "explicit_implied_clauses_of", "explicit_implied_const_bounds", "inherent_impls", "module_children_reexports",
    "ambig_module_children", "attributes", "module_children_non_reexports", "associated_item_or_field_def_ids",
    "variances_of", "rendered_precise_capturing_args", "fn_arg_idents", "deduced_param_attrs",
    "doc_link_traits_in_scope", "assumed_wf_types_for_rpitit",
];

/// The `CrateRoot`'s `LazyArray` fields from `externally_implementable_items` to `interpret_alloc_index`, in order.
const ROOT_ARRAYS: &[&str] = &[
    "externally_implementable_items", "crate_deps", "dylib_dependency_formats", "lib_features",
    "stability_implications", "lang_items", "lang_items_missing", "stripped_cfg_items", "diagnostic_items",
    "canonical_symbols", "fake_doc_items", "native_libraries", "foreign_modules", "traits", "impls",
    "incoherent_impls", "interpret_alloc_index",
];

/// The crate root read from the raw file (see the header).
struct Root {
    name: String,
    /// `== root` lines.
    root: Vec<String>,
    /// `== root.layout` lines.
    layout: Vec<String>,
    hash: String,
    /// position, length
    arrays: HashMap<&'static str, (usize, usize)>,
    /// position, width, length
    tables: HashMap<&'static str, (usize, usize, usize)>,
    /// A stub or a proc-macro crate: no tables to dump.
    stop: bool,
}

/// A `MemDecoder` with the `LazyState` of tools/probes/rmetaroot: `None` = NoNode, `Some((true, p))` = NodeStart(p),
/// `Some((false, p))` = Previous(p).
struct D<'a> {
    d: MemDecoder<'a>,
    state: Option<(bool, usize)>,
}

impl<'a> D<'a> {
    fn lazy(&mut self) -> usize {
        let distance = self.d.read_usize();
        let pos = match self.state {
            None => panic!("outside of a metadata node"),
            Some((true, start)) => start - distance,
            Some((false, last)) => last + distance,
        };
        self.state = Some((false, pos));
        pos
    }
    fn symbol(&mut self) -> Symbol {
        match self.d.read_u8() {
            0 => Symbol::intern(self.d.read_str()),
            1 => {
                let pos = self.d.read_usize();
                self.d.with_position(pos, |d| Symbol::intern(d.read_str()))
            }
            2 => Symbol::new(self.d.read_u32()),
            t => panic!("bad symbol tag {t}"),
        }
    }
}

fn read_root(blob: &[u8]) -> Root {
    let u64_at = |o: usize| u64::from_le_bytes(blob[o..o + 8].try_into().unwrap()) as usize;
    let root_pos = u64_at(8);
    let unhashed_pos = u64_at(16);
    let hash = Svh::new(Fingerprint::from_le_bytes(blob[24..40].try_into().unwrap()));
    let mut r = Root {
        name: String::new(),
        root: Vec::new(),
        layout: vec![format!("root_pos {root_pos}"), format!("unhashed_pos {unhashed_pos}")],
        hash: format!("{hash}"),
        arrays: HashMap::new(),
        tables: HashMap::new(),
        stop: false,
    };
    let mut v = MemDecoder::new(blob, 40).unwrap();
    r.root.push(format!("version {:?}", v.read_str()));

    let mut d = D { d: MemDecoder::new(blob, root_pos).unwrap(), state: Some((true, root_pos)) };
    let triple = TargetTuple::decode(&mut d.d);
    let name = d.symbol();
    let is_proc_macro_crate = d.d.read_bool();
    let is_stub = d.d.read_bool();
    r.name = name.to_string();
    r.root.push(format!("crate_header triple={} name={name} is_proc_macro_crate={is_proc_macro_crate} is_stub={is_stub}", triple.tuple()));
    if is_stub {
        r.stop = true;
        return r;
    }
    r.root.push(format!("stable_crate_id {:?}", StableCrateId::decode(&mut d.d)));
    r.root.push(format!("required_panic_strategy {:?}", Option::<PanicStrategy>::decode(&mut d.d)));
    r.root.push(format!("panic_in_drop_strategy {:?}", PanicStrategy::decode(&mut d.d)));
    r.root.push(format!("edition {}", Edition::decode(&mut d.d)));
    for n in ["has_global_allocator", "has_alloc_error_handler", "has_panic_handler", "has_default_lib_allocator"] {
        r.root.push(format!("{n} {}", d.d.read_bool()));
    }
    let array = |d: &mut D<'_>, r: &mut Root, name: &'static str| {
        let len = d.d.read_usize();
        let pos = if len == 0 { 0 } else { d.lazy() };
        r.root.push(format!("array {name} len={len}"));
        r.layout.push(format!("array {name} pos={pos}"));
        r.arrays.insert(name, (pos, len));
    };
    let table = |d: &mut D<'_>, r: &mut Root, name: &'static str| {
        let width = d.d.read_usize();
        let len = d.d.read_usize();
        let pos = d.lazy();
        r.root.push(format!("table {name} len={len}"));
        r.layout.push(format!("table {name} pos={pos} width={width}"));
        r.tables.insert(name, (pos, width, len));
    };
    for &n in ROOT_ARRAYS {
        array(&mut d, &mut r, n);
    }
    // proc_macro_data: Option<ProcMacroData>
    if d.d.read_u8() != 0 {
        r.root.push("proc_macro_data Some".to_string());
        r.stop = true;
        return r;
    }
    r.root.push("proc_macro_data None".to_string());
    for &(n, _) in TABLES {
        table(&mut d, &mut r, n);
    }
    array(&mut d, &mut r, "debugger_visualizers");
    for n in ["exportable_items", "stable_order_of_exportable_impls", "exported_non_generic_symbols", "exported_generic_symbols"] {
        array(&mut d, &mut r, n);
    }
    for n in ["syntax_contexts", "expn_data", "expn_hashes"] {
        table(&mut d, &mut r, n);
    }
    let pos = d.lazy();
    r.layout.push(format!("value def_path_hash_map pos={pos}"));
    table(&mut d, &mut r, "source_map");
    array(&mut d, &mut r, "target_modifiers");
    array(&mut d, &mut r, "denied_partial_mitigations");
    for n in ["compiler_builtins", "needs_allocator", "needs_panic_runtime", "no_builtins", "panic_runtime", "profiler_runtime"] {
        r.root.push(format!("{n} {}", d.d.read_bool()));
    }
    r.root.push(format!("symbol_mangling_version {:?}", SymbolManglingVersion::decode(&mut d.d)));
    r.root.push(format!("specialization_enabled_in {}", d.d.read_bool()));

    let mut u = MemDecoder::new(blob, unhashed_pos).unwrap();
    let extra_filename = u.read_str().to_owned();
    let deps = Vec::<String>::decode(&mut u);
    r.root.push(format!("unhashed extra_filename={extra_filename:?} dep_extra_filenames={deps:?}"));
    r
}

/// The `CrateDep`s (rmeta/mod.rs `CrateDep`: `Symbol`, `Svh`, `Option<Svh>`, `CrateDepKind`, `bool`), raw.
fn crate_deps(blob: &[u8], r: &Root) -> Vec<String> {
    let (pos, len) = r.arrays["crate_deps"];
    let mut out = Vec::new();
    if len == 0 {
        return out;
    }
    let mut d = D { d: MemDecoder::new(blob, pos).unwrap(), state: Some((true, pos)) };
    for _ in 0..len {
        let name = d.symbol();
        let hash = Svh::decode(&mut d.d);
        let host_hash = Option::<Svh>::decode(&mut d.d);
        // CrateDepKind (rustc_crate_store cstore.rs), a derived enum: its variant index as a u8.
        let kind = match d.d.read_u8() {
            0 => "MacrosOnly".to_string(),
            1 => "Conditional".to_string(),
            2 => "Unconditional".to_string(),
            k => format!("<bad kind {k}>"),
        };
        let is_private = d.d.read_bool();
        out.push(format!("{name} hash={hash} host_hash={host_hash:?} kind={kind} is_private={is_private}"));
    }
    out
}

/// A table's raw entry for `i`, `None` if it is the default (all zeros, or past the end).
fn entry<'b>(blob: &'b [u8], t: (usize, usize, usize), i: usize) -> Option<&'b [u8]> {
    let (pos, width, len) = t;
    if i >= len {
        return None;
    }
    let b = &blob[pos + width * i..pos + width * (i + 1)];
    if b.iter().all(|&x| x == 0) { None } else { Some(b) }
}

fn hex(b: &[u8]) -> String {
    let end = b.iter().rposition(|&x| x != 0).map_or(0, |p| p + 1);
    b[..end].iter().map(|x| format!("{x:02x}")).collect()
}

/// The length of a `LazyArray` entry (the odd bytes of the interleaved encoding, table.rs `decode_interleaved`).
fn array_len(b: &[u8]) -> u64 {
    let mut len = [0u8; 8];
    for i in 0..8 {
        if 2 * i + 1 < b.len() {
            len[i] = b[2 * i + 1];
        }
    }
    u64::from_le_bytes(len)
}

fn did(tcx: TyCtxt<'_>, d: DefId) -> String {
    format!("{}:{}", tcx.crate_name(d.krate), d.index.as_u32())
}

fn dids(tcx: TyCtxt<'_>, ds: &[DefId]) -> String {
    let v: Vec<String> = ds.iter().map(|&d| did(tcx, d)).collect();
    format!("[{}]", v.join(", "))
}

fn expn_short(tcx: TyCtxt<'_>, e: ExpnId) -> String {
    if e == ExpnId::root() { "root".to_string() } else { format!("{}:{}", tcx.crate_name(e.krate), e.local_id.as_u32()) }
}

/// `#[<expn>/<Transparency>, ..]` of a syntax context's `marks()` (outermost last), `#[]` for the root.
fn marks_str(tcx: TyCtxt<'_>, ctxt: SyntaxContext) -> String {
    let v: Vec<String> = ctxt.marks().iter().map(|(e, t)| format!("{}/{t:?}", expn_short(tcx, *e))).collect();
    format!("#[{}]", v.join(", "))
}

/// A span independent of the session's decoding order: `<file>:<lo>..<hi>` relative to the file start (`dummy` for
/// `lo == hi == 0`), then the context's marks (tools/probes/rmetadefs `span_str`).
fn span_str(tcx: TyCtxt<'_>, sp: Span) -> String {
    let data = sp.data();
    let ctxt = marks_str(tcx, data.ctxt);
    if data.lo.0 == 0 && data.hi.0 == 0 {
        return format!("dummy {ctxt}");
    }
    let sm = tcx.sess.source_map();
    let lo = sm.lookup_byte_offset(data.lo);
    let hi = data.hi.0 - lo.sf.start_pos.0;
    format!("{}:{}..{} {}", lo.sf.name.prefer_remapped_unconditionally(), lo.pos.0, hi, ctxt)
}

/// `SyntaxContext` is `pub struct SyntaxContext(u32)` and its `from_u32` is `pub(crate)`; the `#<n>` of its `{:?}`
/// is that `u32` (hygiene.rs `impl fmt::Debug for SyntaxContext`). Only numbers printed by a span's `{:?}` in this
/// session reach this, so they are valid contexts.
fn ctxt_from_u32(n: u32) -> SyntaxContext {
    const _: () = assert!(size_of::<SyntaxContext>() == size_of::<u32>());
    // SAFETY: a single-field struct of a `u32` (size checked above).
    unsafe { std::mem::transmute::<u32, SyntaxContext>(n) }
}

/// Rewrites every ` (#<n>)` that ends a span's `{:?}` (`<..>:<l>:<c>: <l>:<c> (#<n>)` or `no-location (#<n>)`,
/// rustc_span lib.rs `impl fmt::Debug for Span`) to the context's marks (see the header).
fn stabilize_spans(tcx: TyCtxt<'_>, s: &str) -> String {
    let b = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    let mut last = 0;
    while let Some(off) = s[i..].find(" (#") {
        let at = i + off;
        let mut j = at + 3;
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        let after_span = s[..at].ends_with("no-location") || ends_with_line_col(&s[..at]);
        if j > at + 3 && j < b.len() && b[j] == b')' && after_span {
            let n: u32 = s[at + 3..j].parse().unwrap();
            out.push_str(&s[last..at]);
            out.push_str(" (");
            out.push_str(&marks_str(tcx, ctxt_from_u32(n)));
            out.push(')');
            last = j + 1;
            i = j + 1;
        } else {
            i = at + 3;
        }
    }
    out.push_str(&s[last..]);
    out
}

/// Does `s` end with `: <digits>:<digits>` (the end of `span_to_diagnostic_string`, `<file>:<l>:<c>: <l>:<c>`)?
fn ends_with_line_col(s: &str) -> bool {
    let b = s.as_bytes();
    let digits = |mut k: usize| {
        let end = k;
        while k > 0 && b[k - 1].is_ascii_digit() {
            k -= 1;
        }
        (k < end).then_some(k)
    };
    let Some(k) = digits(b.len()) else { return false };
    if k == 0 || b[k - 1] != b':' {
        return false;
    }
    let Some(k) = digits(k - 1) else { return false };
    s[..k].ends_with(": ")
}

/// Renumbers `alloc<n>` (not inside a longer identifier) by first occurrence (see the header).
fn renumber_allocs(s: &str) -> String {
    let b = s.as_bytes();
    let ident = |c: u8| c.is_ascii_alphanumeric() || c == b'_';
    let mut map: HashMap<&str, usize> = HashMap::new();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    let mut last = 0;
    while let Some(off) = s[i..].find("alloc") {
        let at = i + off;
        let mut j = at + 5;
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        if j > at + 5 && (at == 0 || !ident(b[at - 1])) && (j == b.len() || !ident(b[j])) {
            let next = map.len();
            let k = *map.entry(&s[at + 5..j]).or_insert(next);
            out.push_str(&s[last..at]);
            write!(out, "alloc{k}").unwrap();
            last = j;
        }
        i = at + 5;
    }
    out.push_str(&s[last..]);
    out
}

fn mir_text<'tcx>(tcx: TyCtxt<'tcx>, body: &rustc_middle::mir::Body<'tcx>) -> String {
    let mut buf: Vec<u8> = Vec::new();
    MirWriter::new(tcx).write_mir_fn(body, &mut buf).unwrap();
    String::from_utf8(buf).unwrap()
}

fn clauses<'tcx, T: std::fmt::Debug>(tcx: TyCtxt<'tcx>, cs: &[(T, Span)]) -> String {
    let v: Vec<String> = cs.iter().map(|(c, sp)| format!("{c:?} @ {}", span_str(tcx, *sp))).collect();
    format!("[{}]", v.join(", "))
}

/// The row of table `name` for `def_id`, whose raw entry is `raw`.
fn row<'tcx>(tcx: TyCtxt<'tcx>, name: &str, def_id: DefId, raw: &[u8]) -> String {
    let len = || format!("len={}", array_len(raw));
    match name {
        "intrinsic" => format!("{:?}", tcx.intrinsic_raw(def_id)),
        "explicit_item_bounds" => clauses(tcx, tcx.explicit_item_bounds(def_id).skip_binder()),
        "explicit_item_self_bounds" => clauses(tcx, tcx.explicit_item_self_bounds(def_id).skip_binder()),
        "inferred_outlives_of" => clauses(tcx, tcx.inferred_outlives_of(def_id)),
        "explicit_super_clauses_of" => clauses(tcx, tcx.explicit_super_clauses_of(def_id).skip_binder()),
        "explicit_implied_clauses_of" => clauses(tcx, tcx.explicit_implied_clauses_of(def_id).skip_binder()),
        "explicit_implied_const_bounds" => clauses(tcx, tcx.explicit_implied_const_bounds(def_id).skip_binder()),
        "inherent_impls" => dids(tcx, tcx.inherent_impls(def_id)),
        "opt_rpitit_info" => format!("{:?}", tcx.opt_rpitit_info(def_id)),
        // `module_children` (both tables) is its own row, after the tables.
        "module_children_reexports" | "module_children_non_reexports" | "ambig_module_children" => len(),
        "attributes" => format!("{:?}", tcx.attrs_for_def(def_id)),
        "associated_item_or_field_def_ids" => dids(tcx, tcx.associated_item_def_ids(def_id)),
        "def_kind" => format!("{:?}", tcx.def_kind(def_id)),
        "visibility" => format!("{:?}", tcx.visibility(def_id).map_id(|m| did(tcx, m.into()))),
        "def_span" => span_str(tcx, tcx.def_span(def_id)),
        "def_ident_span" => match tcx.def_ident_span(def_id) {
            Some(sp) => span_str(tcx, sp),
            None => "None".to_string(),
        },
        "lookup_stability" => format!("{:?}", tcx.lookup_stability(def_id)),
        "lookup_const_stability" => format!("{:?}", tcx.lookup_const_stability(def_id)),
        "lookup_default_body_stability" => format!("{:?}", tcx.lookup_default_body_stability(def_id)),
        "lookup_deprecation_entry" => format!("{:?}", tcx.lookup_deprecation_entry(def_id)),
        "explicit_clauses_of" => {
            let g = tcx.explicit_clauses_of(def_id);
            format!("parent={} {}", g.parent.map_or("-".to_string(), |p| did(tcx, p)), clauses(tcx, g.clauses))
        }
        "generics_of" => format!("{:?}", tcx.generics_of(def_id)),
        "type_of" => format!("{:?}", tcx.type_of(def_id).skip_binder()),
        "variances_of" => format!("{:?}", tcx.variances_of(def_id)),
        "fn_sig" => format!("{:?}", tcx.fn_sig(def_id).skip_binder()),
        "codegen_fn_attrs" => format!("{:?}", tcx.codegen_fn_attrs(def_id)),
        "impl_trait_header" => format!("{:?}", tcx.impl_trait_header(def_id)),
        "const_param_default" => format!("{:?}", tcx.const_param_default(def_id).skip_binder()),
        "object_lifetime_default" => format!("{:?}", tcx.object_lifetime_default(def_id)),
        "optimized_mir" => format!("\n{}", mir_text(tcx, tcx.optimized_mir(def_id))),
        "mir_for_ctfe" => format!("\n{}", mir_text(tcx, tcx.mir_for_ctfe(def_id))),
        "trivial_const" => format!("{:?}", tcx.trivial_const(def_id)),
        "closure_saved_names_of_captured_variables" => format!("{:?}", tcx.closure_saved_names_of_captured_variables(def_id)),
        "mir_coroutine_witnesses" => format!("{:?}", tcx.mir_coroutine_witnesses(def_id)),
        "promoted_mir" => {
            let mut s = String::new();
            for (i, body) in tcx.promoted_mir(def_id).iter_enumerated() {
                write!(s, "\npromoted[{}]\n{}", i.as_u32(), mir_text(tcx, body)).unwrap();
            }
            s
        }
        "thir_abstract_const" => format!("{:?}", tcx.thir_abstract_const(def_id)),
        "const_conditions" => format!("{:?}", tcx.const_conditions(def_id)),
        "coerce_unsized_info" => format!("{:?}", tcx.coerce_unsized_info(def_id)),
        "mir_const_qualif" => format!("{:?}", tcx.mir_const_qualif(def_id)),
        "rendered_const" => format!("{:?}", tcx.rendered_const(def_id)),
        "rendered_precise_capturing_args" => format!("{:?}", tcx.rendered_precise_capturing_args(def_id)),
        "fn_arg_idents" => {
            let v: Vec<String> = tcx
                .fn_arg_idents(def_id)
                .iter()
                .map(|i| match i {
                    Some(i) => format!("{} @ {}", i.name, span_str(tcx, i.span)),
                    None => "None".to_string(),
                })
                .collect();
            format!("[{}]", v.join(", "))
        }
        "adt_destructor" => format!("{:?}", tcx.adt_destructor(def_id)),
        "adt_async_destructor" => format!("{:?}", tcx.adt_async_destructor(def_id)),
        "eval_static_initializer" => format!("{:?}", tcx.eval_static_initializer(def_id)),
        "trait_def" => format!("{:?}", tcx.trait_def(def_id)),
        "expn_that_defined" => {
            let e = tcx.expn_that_defined(def_id);
            if e == ExpnId::root() { "root".to_string() } else { format!("{} {:?}", expn_short(tcx, e), e.expn_data().kind) }
        }
        "default_fields" => format!("{:?}", tcx.default_field(def_id).map(|d| did(tcx, d))),
        "params_in_repr" => format!("{:?}", tcx.params_in_repr(def_id)),
        "repr_options" => {
            let adt = tcx.adt_def(def_id);
            format!("{:?} repr={:?} variants={:?}", adt.adt_kind(), adt.repr(), adt.variants())
        }
        "def_keys" => format!("{:?}", tcx.def_key(def_id)),
        "assoc_container" => format!("{:?}", tcx.associated_item(def_id)),
        "macro_definition" => match CStore::from_tcx(tcx).load_macro_untracked(tcx, def_id) {
            LoadedMacro::MacroDef { def, ident, span, edition, .. } => {
                format!("{} @ {} span={} edition={edition} macro_rules={} body={:?}", ident.name, span_str(tcx, ident.span), span_str(tcx, span), def.macro_rules, def.body)
            }
            LoadedMacro::ProcMacro(_) => "ProcMacro".to_string(),
        },
        "deduced_param_attrs" => format!("{:?}", tcx.deduced_param_attrs(def_id)),
        "collect_return_position_impl_trait_in_trait_tys" => {
            let mut v: Vec<String> = match tcx.collect_return_position_impl_trait_in_trait_tys(def_id) {
                Ok(m) => m.items().map(|(k, t)| format!("{} => {:?}", did(tcx, *k), t.skip_binder())).into_sorted_stable_ord(),
                Err(_) => vec!["Err".to_string()],
            };
            v.sort();
            format!("{{{}}}", v.join(", "))
        }
        "doc_link_traits_in_scope" => dids(tcx, tcx.doc_link_traits_in_scope(rustc_span::def_id::ModId::new_unchecked(def_id))),
        "assumed_wf_types_for_rpitit" => clauses(tcx, tcx.assumed_wf_types_for_rpitit(def_id)),
        "opaque_ty_origin" => format!("{:?}", tcx.opaque_ty_origin(def_id)),
        "anon_const_kind" => format!("{:?}", tcx.anon_const_kind(def_id)),
        "const_of_item" => format!("{:?}", tcx.const_of_item(def_id).map(|c| c.skip_binder())),
        "associated_types_for_impl_traits_in_trait_or_impl" => {
            let mut v: Vec<String> =
                tcx.associated_types_for_impl_traits_in_trait_or_impl(def_id).items().map(|(k, ds)| format!("{} => {}", did(tcx, *k), dids(tcx, ds))).into_sorted_stable_ord();
            v.sort();
            format!("{{{}}}", v.join(", "))
        }
        "args_known_to_outlive_alias_params" => format!("{:?}", tcx.args_known_to_outlive_alias_params(def_id)),
        // No query reads these alone: `variant_data` and `mut_restriction` are part of `adt_def` (the
        // `repr_options` row), `doc_link_resolutions` is rustdoc's, `live_args_for_alias_from_outlives_bounds` is
        // keyed by an alias kind.
        _ if ARRAY_TABLES.contains(&name) => len(),
        _ => "present".to_string(),
    }
}

fn panic_message(e: &(dyn std::any::Any + Send)) -> String {
    let s = if let Some(s) = e.downcast_ref::<&str>() {
        s.to_string()
    } else if let Some(s) = e.downcast_ref::<String>() {
        s.clone()
    } else {
        "<non-string payload>".to_string()
    };
    s.lines().next().unwrap_or("").to_string()
}

/// `f()`, or `!panic <message>` if it panics (the panic hook is silenced around the dump).
fn guarded(f: impl FnOnce() -> String) -> String {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(s) => s,
        Err(e) => format!("!panic {}", panic_message(&*e)),
    }
}

/// The dump's text, section by section.
struct Out<'tcx> {
    tcx: TyCtxt<'tcx>,
    text: String,
    /// The current section's lines (indented), stabilized when it ends.
    cur: String,
}

impl<'tcx> Out<'tcx> {
    fn section(&mut self, key: &str) {
        self.end();
        writeln!(self.text, "== {key}").unwrap();
    }
    /// A row: `  <name> <value>`, a multi-line value's later lines indented by 4; its empty lines are dropped (see
    /// the header: a blank-line-only difference is invisible here).
    fn row(&mut self, name: &str, value: &str) {
        let mut lines = value.split('\n');
        let first = lines.next().unwrap_or("");
        if first.is_empty() { writeln!(self.cur, "  {name}").unwrap() } else { writeln!(self.cur, "  {name} {first}").unwrap() }
        for l in lines {
            if !l.is_empty() {
                writeln!(self.cur, "    {l}").unwrap();
            }
        }
    }
    fn lines(&mut self, ls: &[String]) {
        for l in ls {
            writeln!(self.cur, "  {l}").unwrap();
        }
    }
    fn end(&mut self) {
        let s = std::mem::take(&mut self.cur);
        self.text.push_str(&renumber_allocs(&stabilize_spans(self.tcx, &s)));
    }
}

fn dump_session(tcx: TyCtxt<'_>, blob: &[u8], root: &Root, path: &str, out: &mut Out<'_>) {
    let cnum: CrateNum = *tcx
        .crates(())
        .iter()
        .find(|&&c| tcx.crate_name(c).as_str() == root.name && tcx.used_crate_source(c).paths().any(|p| p.to_str() == Some(path)))
        .unwrap_or_else(|| panic!("crate {} ({path}) is not loaded", root.name));

    // Crate-level lists, in `CrateRoot` order.
    out.section("externally_implementable_items");
    let v = guarded(|| format!("{:?}", tcx.externally_implementable_items(cnum)));
    out.row("eii", &v);
    out.section("dylib_dependency_formats");
    let v = guarded(|| format!("{:?}", tcx.dylib_dependency_formats(cnum)));
    out.row("formats", &v);
    out.section("lib_features");
    let v = guarded(|| {
        let mut v: Vec<String> = tcx.lib_features(cnum).stability.items().map(|(f, (s, sp))| format!("{f} {s:?} @ {}", span_str(tcx, *sp))).into_sorted_stable_ord();
        v.sort();
        v.join("\n")
    });
    out.row("features", &format!("\n{v}"));
    out.section("stability_implications");
    let v = guarded(|| {
        let mut v: Vec<String> = tcx.stability_implications(cnum).to_sorted_stable_ord().into_iter().map(|(a, b)| format!("{a} {b}")).collect();
        v.sort();
        v.join("\n")
    });
    out.row("implications", &format!("\n{v}"));
    out.section("lang_items");
    let v = guarded(|| tcx.defined_lang_items(cnum).iter().map(|(d, l)| format!("{l:?} {}", did(tcx, *d))).collect::<Vec<_>>().join("\n"));
    out.row("defined", &format!("\n{v}"));
    out.section("lang_items_missing");
    let v = guarded(|| format!("{:?}", tcx.missing_lang_items(cnum)));
    out.row("missing", &v);
    out.section("stripped_cfg_items");
    let v = guarded(|| tcx.stripped_cfg_items(cnum).iter().map(|c| format!("{:?}", c)).collect::<Vec<_>>().join("\n"));
    out.row("items", &format!("\n{v}"));
    out.section("diagnostic_items");
    let v = guarded(|| tcx.diagnostic_items(cnum).name_to_id.iter().map(|(n, d)| format!("{n} {}", did(tcx, *d))).collect::<Vec<_>>().join("\n"));
    out.row("items", &format!("\n{v}"));
    out.section("canonical_symbols");
    let v = guarded(|| tcx.canonical_symbols(cnum).iter().map(|c| format!("{} {}", c.symbol, did(tcx, c.def_id))).collect::<Vec<_>>().join("\n"));
    out.row("symbols", &format!("\n{v}"));
    out.section("fake_doc_items");
    let v = guarded(|| dids(tcx, tcx.fake_doc_items(cnum)));
    out.row("items", &v);
    out.section("native_libraries");
    let v = guarded(|| tcx.native_libraries(cnum).iter().map(|l| format!("{l:?}")).collect::<Vec<_>>().join("\n"));
    out.row("libs", &format!("\n{v}"));
    out.section("foreign_modules");
    let v = guarded(|| tcx.foreign_modules(cnum).values().map(|m| format!("{m:?}")).collect::<Vec<_>>().join("\n"));
    out.row("modules", &format!("\n{v}"));
    out.section("traits");
    let v = guarded(|| dids(tcx, tcx.traits(cnum)));
    out.row("traits", &v);
    out.section("impls");
    // `TraitImpls` per trait, through `trait_impls_in_crate` (every impl, in encoded order) and
    // `implementations_of_trait` of each trait in first-occurrence order.
    let v = guarded(|| {
        let mut traits: Vec<DefId> = Vec::new();
        for &i in tcx.trait_impls_in_crate(cnum) {
            let t = tcx.impl_trait_id(i);
            if !traits.contains(&t) {
                traits.push(t);
            }
        }
        let mut s = String::new();
        for t in traits {
            let impls: Vec<String> = tcx.implementations_of_trait((cnum, t)).iter().map(|(i, st)| format!("{} {st:?}", did(tcx, *i))).collect();
            writeln!(s, "{} => [{}]", did(tcx, t), impls.join(", ")).unwrap();
        }
        s
    });
    out.row("impls", &format!("\n{v}"));
    out.section("incoherent_impls");
    // `crate_incoherent_impls` of the simplified self type of every inherent impl of the crate (the key
    // rustc_hir_analysis coherence/inherent_impls.rs files incoherent impls under), in first-occurrence order.
    let v = guarded(|| {
        let n = CStore::from_tcx(tcx).num_def_ids_untracked(cnum);
        let mut keys = Vec::new();
        for i in 0..n {
            let d = DefId { krate: cnum, index: DefIndex::from_usize(i) };
            if let DefKind::Impl { of_trait: false } = tcx.def_kind(d) {
                if let Some(k) = simplify_type(tcx, tcx.type_of(d).skip_binder(), TreatParams::InstantiateWithInfer) {
                    if !keys.contains(&k) {
                        keys.push(k);
                    }
                }
            }
        }
        let mut s = String::new();
        for k in keys {
            let impls = tcx.crate_incoherent_impls((cnum, k));
            if !impls.is_empty() {
                writeln!(s, "{k:?} => {}", dids(tcx, impls)).unwrap();
            }
        }
        s
    });
    out.row("impls", &format!("\n{v}"));
    out.section("debugger_visualizers");
    let v = guarded(|| format!("{:?}", tcx.debugger_visualizers(cnum)));
    out.row("visualizers", &v);
    out.section("exportable_items");
    let v = guarded(|| dids(tcx, tcx.exportable_items(cnum)));
    out.row("items", &v);
    out.section("stable_order_of_exportable_impls");
    let v = guarded(|| tcx.stable_order_of_exportable_impls(cnum).iter().map(|(d, n)| format!("{} {n}", did(tcx, *d))).collect::<Vec<_>>().join(", "));
    out.row("impls", &v);
    out.section("exported_symbols");
    let v = guarded(|| format!("non_generic={:?}\ngeneric={:?}", tcx.exported_non_generic_symbols(cnum), tcx.exported_generic_symbols(cnum)));
    out.row("symbols", &format!("\n{v}"));

    // Every DefIndex.
    let n = CStore::from_tcx(tcx).num_def_ids_untracked(cnum);
    for i in 0..n {
        let def_id = DefId { krate: cnum, index: DefIndex::from_usize(i) };
        let path = guarded(|| tcx.def_path(def_id).to_string_no_crate_verbose());
        out.section(&format!("def {}", if path.is_empty() { "<crate root>" } else { &path }));
        out.lines(&[format!("index {i}")]);
        let mut children = false;
        for &(name, direct) in TABLES {
            let Some(raw) = entry(blob, root.tables[name], i) else { continue };
            let v = if direct { format!("raw {}", hex(raw)) } else { guarded(|| row(tcx, name, def_id, raw)) };
            out.row(name, &v);
            children |= name.starts_with("module_children");
        }
        if children {
            let v = guarded(|| {
                tcx.module_children(def_id)
                    .iter()
                    .map(|c| {
                        let res = match c.res {
                            Res::Def(kind, d) => format!("{kind:?} {}", did(tcx, d)),
                            other => format!("{other:?}"),
                        };
                        format!("{} @ {} res={res} vis={:?} reexport_chain={:?}", c.ident.name, span_str(tcx, c.ident.span), c.vis.map_id(|m| did(tcx, m.into())), c.reexport_chain)
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            });
            out.row("module_children", &format!("\n{v}"));
        }
    }

    // The crate's source files this session imported (every span above was decoded, so nearly all).
    out.section("source_files");
    let v = guarded(|| {
        let mut v: Vec<String> = tcx
            .sess
            .source_map()
            .files()
            .iter()
            .filter(|f| f.cnum == cnum)
            .map(|f| {
                format!(
                    "{} len={} src_hash={:?} checksum_hash={:?} lines={} multibyte={} normalized={} stable_id={:?}",
                    f.name.prefer_remapped_unconditionally(),
                    f.normalized_source_len.0,
                    f.src_hash,
                    f.checksum_hash,
                    f.count_lines(),
                    f.multibyte_chars.len(),
                    f.normalized_pos.len(),
                    f.stable_id,
                )
            })
            .collect();
        v.sort();
        v.join("\n")
    });
    out.row("files", &format!("\n{v}"));
    out.end();
}

struct Probe {
    path: String,
    blob: Vec<u8>,
    root: Root,
    text: Option<String>,
}

impl Callbacks for Probe {
    fn config(&mut self, config: &mut interface::Config) {
        config.input = Input::Str {
            name: FileName::Custom("rmetadump".to_string()),
            // `r#`: a crate may be named after a keyword (tests/ui has a `trait.rs`).
            input: format!("#![feature(no_core)]\n#![no_core]\nextern crate r#{};\n", self.root.name),
        };
    }

    fn after_expansion<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let mut out = Out { tcx, text: String::new(), cur: String::new() };
        let hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let r = catch_unwind(AssertUnwindSafe(|| ty::print::with_no_trimmed_paths!(dump_session(tcx, &self.blob, &self.root, &self.path, &mut out))));
        std::panic::set_hook(hook);
        if let Err(e) = r {
            std::panic::resume_unwind(e);
        }
        self.text = Some(out.text);
        Compilation::Stop
    }
}

fn main() -> ExitCode {
    let early_dcx = EarlyDiagCtxt::new(ErrorOutputType::default());
    rustc_driver::install_ice_hook(rustc_driver::DEFAULT_BUG_REPORT_URL, |_| ());
    let mut raw = rustc_driver::args::raw_args(&early_dcx);
    let content = raw.get(1).is_some_and(|a| a == "--content");
    if content {
        raw.remove(1);
    }
    if raw.len() < 2 {
        eprintln!("usage: rmetadump [--content] <file.rmeta> <rustc arguments...>");
        return ExitCode::from(2);
    }
    let path = std::fs::canonicalize(&raw[1]).unwrap().to_str().unwrap().to_string();
    let blob = std::fs::read(&path).unwrap();
    // The raw part runs in its own session globals (the driver makes the session's); `Root` holds no `Symbol`.
    let root = rustc_span::create_default_session_globals_then(|| {
        let root = read_root(&blob);
        let mut head = format!("rmetadump {}\n== root\n", root.name);
        for l in &root.root {
            writeln!(head, "  {l}").unwrap();
        }
        if !content {
            head.push_str("== root.layout\n");
            for l in &root.layout {
                writeln!(head, "  {l}").unwrap();
            }
            writeln!(head, "== root.hash\n  {}", root.hash).unwrap();
        }
        if !root.stop {
            head.push_str("== crate_deps\n");
            for l in crate_deps(&blob, &root) {
                writeln!(head, "  {l}").unwrap();
            }
        }
        std::io::stdout().write_all(head.as_bytes()).unwrap();
        root
    });
    if root.stop {
        return ExitCode::SUCCESS;
    }
    // `-Awarnings`: the host crate is not under test (e.g. creader's "found async drop types in dependency" warning
    // is about the host's features).
    let mut args = vec![raw[0].clone(), "rmetadump.rs".to_string(), "--crate-name".into(), "rmetadump_host".into(), "--crate-type".into(), "lib".into()];
    args.extend(["--edition=2021".to_string(), "-Awarnings".to_string()]);
    args.push("--extern".into());
    args.push(format!("{}={path}", root.name));
    args.extend(raw[2..].iter().cloned());
    let mut callbacks = Probe { path, blob, root, text: None };
    let code = rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&args, &mut callbacks));
    if let Some(text) = callbacks.text {
        let mut stdout = std::io::stdout().lock();
        stdout.write_all(text.as_bytes()).unwrap();
        stdout.flush().unwrap();
    }
    code
}
