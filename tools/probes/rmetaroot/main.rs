//! Oracle probe for src/rustc_metadata/rmeta/rmeta_root.oracle.test.ts (lane rmeta-contract).
//!
//!   rmetaroot <target-tuple> <sysroot> <file>...
//!
//! For every `.rlib` (through the oracle's `DefaultMetadataLoader`) or `.rmeta` (the whole file, as the
//! locator maps it): the metadata header (version string, root / unhashed positions, crate hash), the
//! `CrateHeader`, and unless it is a stub, the `CrateRoot` field by field: scalars with their values,
//! `LazyArray`s as position + length, `LazyValue`s as position, `LazyTable`s as position + width + length,
//! and the `CrateRootUnhashed`.
//!
//! `CrateRoot` is private to rustc_metadata, so its layout (rmeta/mod.rs:270, `define_tables!` at :421) and the
//! lazy-distance scheme (decoder.rs:203 `read_lazy_offset_then`) are mirrored here; every leaf value is
//! decoded by the oracle's own impls, symbols by the metadata symbol scheme (`decode_symbol_or_byte_symbol`)
//! over the oracle's interner.
#![feature(rustc_private)]

extern crate rustc_codegen_ssa;
extern crate rustc_data_structures;
extern crate rustc_driver;
extern crate rustc_metadata;
extern crate rustc_serialize;
extern crate rustc_session;
extern crate rustc_span;
extern crate rustc_target;

use std::path::Path;

use rustc_codegen_ssa::back::metadata::DefaultMetadataLoader;
use rustc_data_structures::fingerprint::Fingerprint;
use rustc_data_structures::svh::Svh;
use rustc_metadata::creader::MetadataLoader;
use rustc_serialize::opaque::MemDecoder;
use rustc_serialize::{Decodable, Decoder};
use rustc_session::config::SymbolManglingVersion;
use rustc_span::def_id::StableCrateId;
use rustc_span::edition::Edition;
use rustc_span::Symbol;
use rustc_target::spec::{PanicStrategy, Target, TargetTuple};

const TABLES: &[&str] = &["intrinsic", "is_macro_rules", "type_alias_is_checked", "attr_flags", "def_path_hashes", "explicit_item_bounds", "explicit_item_self_bounds", "inferred_outlives_of", "explicit_super_clauses_of", "explicit_implied_clauses_of", "explicit_implied_const_bounds", "inherent_impls", "opt_rpitit_info", "module_children_reexports", "ambig_module_children", "cross_crate_inlinable", "asyncness", "constness", "safety", "defaultness", "impl_is_fully_generic_for_reflection", "attributes", "module_children_non_reexports", "associated_item_or_field_def_ids", "def_kind", "visibility", "def_span", "def_ident_span", "lookup_stability", "lookup_const_stability", "lookup_default_body_stability", "lookup_deprecation_entry", "explicit_clauses_of", "generics_of", "type_of", "variances_of", "fn_sig", "codegen_fn_attrs", "impl_trait_header", "const_param_default", "object_lifetime_default", "optimized_mir", "mir_for_ctfe", "trivial_const", "closure_saved_names_of_captured_variables", "mir_coroutine_witnesses", "promoted_mir", "thir_abstract_const", "impl_parent", "const_conditions", "coerce_unsized_info", "mir_const_qualif", "rendered_const", "rendered_precise_capturing_args", "fn_arg_idents", "coroutine_kind", "coroutine_for_closure", "adt_destructor", "adt_async_destructor", "coroutine_by_move_body_def_id", "eval_static_initializer", "trait_def", "expn_that_defined", "default_fields", "params_in_repr", "repr_options", "def_keys", "variant_data", "assoc_container", "macro_definition", "deduced_param_attrs", "collect_return_position_impl_trait_in_trait_tys", "doc_link_resolutions", "doc_link_traits_in_scope", "assumed_wf_types_for_rpitit", "opaque_ty_origin", "anon_const_kind", "const_of_item", "associated_types_for_impl_traits_in_trait_or_impl", "live_args_for_alias_from_outlives_bounds", "args_known_to_outlive_alias_params", "mut_restriction", ];

struct D<'a> {
    d: MemDecoder<'a>,
    /// `LazyState`: `None` = NoNode, `Some((true, p))` = NodeStart(p), `Some((false, p))` = Previous(p)
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
    fn array(&mut self, name: &str) {
        let len = self.d.read_usize();
        if len == 0 {
            println!("  array {name} pos=1 len=0");
        } else {
            let pos = self.lazy();
            println!("  array {name} pos={pos} len={len}");
        }
    }
    fn value(&mut self, name: &str) {
        let pos = self.lazy();
        println!("  value {name} pos={pos}");
    }
    fn table(&mut self, name: &str) {
        let width = self.d.read_usize();
        let len = self.d.read_usize();
        let pos = self.lazy();
        println!("  table {name} pos={pos} width={width} len={len}");
    }
    fn symbol(&mut self) -> Symbol {
        match self.d.read_u8() {
            0 => Symbol::intern(self.d.read_str()),
            1 => {
                let pos = self.d.read_usize();
                self.d.with_position(pos, |d| Symbol::intern(d.read_str()))
            }
            2 => Symbol::new(self.d.read_u32()),
            _ => unreachable!(),
        }
    }
    fn bool(&mut self, name: &str) {
        let v = self.d.read_bool();
        println!("  {name} {v}");
    }
}

fn dump(blob: &[u8]) {
    let u64_at = |o: usize| u64::from_le_bytes(blob[o..o + 8].try_into().unwrap()) as usize;
    let root_pos = u64_at(8);
    let unhashed_pos = u64_at(16);
    let hash = Svh::new(Fingerprint::from_le_bytes(blob[24..40].try_into().unwrap()));
    let mut v = MemDecoder::new(blob, 40).unwrap();
    let version = v.read_str().to_owned();
    println!("  header version={version:?} root_pos={root_pos} unhashed_pos={unhashed_pos} hash={hash}");

    let mut d = D { d: MemDecoder::new(blob, root_pos).unwrap(), state: Some((true, root_pos)) };
    let triple = TargetTuple::decode(&mut d.d);
    let name = d.symbol();
    let is_proc_macro_crate = d.d.read_bool();
    let is_stub = d.d.read_bool();
    println!(
        "  crate_header triple={} name={name} is_proc_macro_crate={is_proc_macro_crate} is_stub={is_stub}",
        triple.tuple()
    );
    if is_stub {
        return;
    }
    let stable_crate_id = StableCrateId::decode(&mut d.d);
    println!("  stable_crate_id {stable_crate_id:?}");
    let required_panic_strategy = Option::<PanicStrategy>::decode(&mut d.d);
    println!("  required_panic_strategy {required_panic_strategy:?}");
    let panic_in_drop_strategy = PanicStrategy::decode(&mut d.d);
    println!("  panic_in_drop_strategy {panic_in_drop_strategy:?}");
    let edition = Edition::decode(&mut d.d);
    println!("  edition {edition}");
    for n in ["has_global_allocator", "has_alloc_error_handler", "has_panic_handler", "has_default_lib_allocator"] {
        d.bool(n);
    }
    for n in [
        "externally_implementable_items", "crate_deps", "dylib_dependency_formats", "lib_features",
        "stability_implications", "lang_items", "lang_items_missing", "stripped_cfg_items",
        "diagnostic_items", "canonical_symbols", "fake_doc_items", "native_libraries", "foreign_modules",
        "traits", "impls", "incoherent_impls", "interpret_alloc_index",
    ] {
        d.array(n);
    }
    // proc_macro_data: Option<ProcMacroData>
    match d.d.read_u8() {
        0 => println!("  proc_macro_data None"),
        _ => {
            println!("  proc_macro_data Some");
            return;
        }
    }
    for n in TABLES {
        d.table(n);
    }
    d.array("debugger_visualizers");
    for n in ["exportable_items", "stable_order_of_exportable_impls", "exported_non_generic_symbols", "exported_generic_symbols"] {
        d.array(n);
    }
    for n in ["syntax_contexts", "expn_data", "expn_hashes"] {
        d.table(n);
    }
    d.value("def_path_hash_map");
    d.table("source_map");
    d.array("target_modifiers");
    d.array("denied_partial_mitigations");
    for n in ["compiler_builtins", "needs_allocator", "needs_panic_runtime", "no_builtins", "panic_runtime", "profiler_runtime"] {
        d.bool(n);
    }
    let symbol_mangling_version = SymbolManglingVersion::decode(&mut d.d);
    println!("  symbol_mangling_version {symbol_mangling_version:?}");
    d.bool("specialization_enabled_in");

    let mut u = MemDecoder::new(blob, unhashed_pos).unwrap();
    let extra_filename = u.read_str().to_owned();
    let deps = Vec::<String>::decode(&mut u);
    println!("  unhashed extra_filename={extra_filename:?} dep_extra_filenames={deps:?}");
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let tuple = TargetTuple::from_tuple(&args[1]);
    let (target, _) = Target::search(&tuple, Path::new(&args[2]), false).expect("target");
    rustc_span::create_default_session_globals_then(|| {
        for p in &args[3..] {
            println!("file {}", Path::new(p).file_name().unwrap().to_str().unwrap());
            let bytes: Vec<u8> = if p.ends_with(".rmeta") {
                std::fs::read(p).unwrap()
            } else {
                match DefaultMetadataLoader.get_rlib_metadata(&target, Path::new(p)) {
                    Ok(s) => s.to_vec(),
                    Err(e) => {
                        println!("  err {e}");
                        continue;
                    }
                }
            };
            dump(&bytes);
        }
    });
}
