// Port of compiler/rustc_symbol_mangling/src/lib.rs (lane symbol-mangling).
//
//! The Rust Linkage Model and Symbol Names
//! =======================================
//!
//! The semantic model of Rust linkage is, broadly, that "there's no global
//! namespace" between crates. Our aim is to preserve the illusion of this
//! model despite the fact that it's not *quite* possible to implement on
//! modern linkers. We initially didn't use system linkers at all, but have
//! been convinced of their utility.
//!
//! There are a few issues to handle:
//!
//!  - Linkers operate on a flat namespace, so we have to flatten names.
//!    We do this using the C++ namespace-mangling technique. Foo::bar
//!    symbols and such.
//!
//!  - Symbols for distinct items with the same *name* need to get different
//!    linkage-names. Examples of this are monomorphizations of functions or
//!    items within anonymous scopes that end up having the same path.
//!
//!  - Symbols in different crates but with same names "within" the crate need
//!    to get different linkage-names.
//!
//!  - Symbol names should be deterministic: Two consecutive runs of the
//!    compiler over the same code base should produce the same symbol names for
//!    the same items.
//!
//!  - Symbol names should not depend on any global properties of the code base,
//!    so that small modifications to the code base do not result in all symbols
//!    changing. In previous versions of the compiler, symbol names incorporated
//!    the SVH (Stable Version Hash) of the crate. This scheme turned out to be
//!    infeasible when used in conjunction with incremental compilation because
//!    small code changes would invalidate all symbols generated previously.
//!
//!  - Even symbols from different versions of the same crate should be able to
//!    live next to each other without conflict.
//!
//! In order to fulfill the above requirements the following scheme is used by
//! the compiler:
//!
//! The main tool for avoiding naming conflicts is the incorporation of a 64-bit
//! hash value into every exported symbol name. Anything that makes a difference
//! to the symbol being named, but does not show up in the regular path needs to
//! be fed into this hash:
//!
//! - Different monomorphizations of the same item have the same path but differ
//!   in their concrete type parameters, so these parameters are part of the
//!   data being digested for the symbol hash.
//!
//! - Rust allows items to be defined in anonymous scopes, such as in
//!   `fn foo() { { fn bar() {} } { fn bar() {} } }`. Both `bar` functions have
//!   the path `foo::bar`, since the anonymous scopes do not contribute to the
//!   path of an item. The compiler already handles this case via so-called
//!   disambiguating `DefPaths` which use indices to distinguish items with the
//!   same name. The DefPaths of the functions above are thus `foo[0]::bar[0]`
//!   and `foo[0]::bar[1]`. In order to incorporate this disambiguation
//!   information into the symbol name too, these indices are fed into the
//!   symbol hash, so that the above two symbols would end up with different
//!   hash values.
//!
//! The two measures described above suffice to avoid intra-crate conflicts. In
//! order to also avoid inter-crate conflicts two more measures are taken:
//!
//! - The name of the crate containing the symbol is prepended to the symbol
//!   name, i.e., symbols are "crate qualified". For example, a function `foo` in
//!   module `bar` in crate `baz` would get a symbol name like
//!   `baz::bar::foo::{hash}` instead of just `bar::foo::{hash}`. This avoids
//!   simple conflicts between functions from different crates.
//!
//! - In order to be able to also use symbols from two versions of the same
//!   crate (which naturally also have the same name), a stronger measure is
//!   required: The compiler accepts an arbitrary "disambiguator" value via the
//!   `-C metadata` command-line argument. This disambiguator is then fed into
//!   the symbol hash of every exported item. Consequently, the symbols in two
//!   identical crates but with different disambiguators are not in conflict
//!   with each other. This facility is mainly intended to be used by build
//!   tools like Cargo.
//!
//! A note on symbol name stability
//! -------------------------------
//! Previous versions of the compiler resorted to feeding NodeIds into the
//! symbol hash in order to disambiguate between items with the same path. The
//! current version of the name generation algorithm takes great care not to do
//! that, since NodeIds are notoriously unstable: A small change to the
//! code base will offset all NodeIds after the change and thus, much as using
//! the SVH in the hash, invalidate an unbounded number of symbol names. This
//! makes re-using previously compiled code for incremental compilation
//! virtually impossible. Thus, symbol hash generation exclusively relies on
//! DefPaths which are much more robust in the face of changes to the code base.
//
// PORT: `compute_instantiating_crate: impl FnOnce() -> CrateNum` is a closure; `bool::then(f)` calls it only when
// `true`. `mangled_name.len()` is the UTF-8 length (`utf8_len`).
import { DefKind } from "../rustc_hir/def.ts";
import { CodegenFnAttrFlags, CodegenFnAttrs, TyCtxt_codegen_instance_attrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import { MonoItem } from "../rustc_middle/mono.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { type Instance, Instance as InstanceC, type InstanceKind, InstanceKind as InstanceKindC } from "../rustc_middle/ty/instance.ts";
import { SymbolName } from "../rustc_middle/ty/mod.ts";
import { Options_impl, type SymbolManglingVersion } from "../rustc_session/config.ts";
import { generate_proc_macro_decls_symbol } from "../rustc_session/session.ts";
import { type CrateNum, LOCAL_CRATE } from "../rustc_span/def_id.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import type { ExistentialTraitRef } from "../rustc_type_ir/predicate.ts";
import { utf8_len } from "../std/str.ts";
import * as export_ from "./export.ts";
import * as hashed from "./hashed.ts";
import * as legacy from "./legacy.ts";
import * as v0 from "./v0.ts";

// mod export;
// mod hashed;
// mod legacy;
// mod v0;

// pub mod test;
export * as test from "./test.ts";

export { mangle_cgu, mangle_internal_symbol } from "./v0.ts";

/// Offload kernels need custom v0 symbol treatment because the host
/// and device compilation passes run with different `stable_crate_id`s
/// so they cannot rely on the regular export-hash path.
// rustc: compiler/rustc_symbol_mangling/src/lib.rs:112 is_offload_kernel
export function is_offload_kernel(attrs: CodegenFnAttrs): boolean {
  return CodegenFnAttrFlags.intersects(attrs.flags, CodegenFnAttrFlags.OFFLOAD_KERNEL);
}

/// This function computes the symbol name for the given `instance` and the
/// given instantiating crate. That is, if you know that instance X is
/// instantiated in crate Y, this is the symbol name this instance would have.
// rustc: compiler/rustc_symbol_mangling/src/lib.rs:119 symbol_name_for_instance_in_crate
export function symbol_name_for_instance_in_crate(tcx: TyCtxt, instance: Instance, instantiating_crate: CrateNum): string {
  return compute_symbol_name(tcx, instance, () => instantiating_crate);
}

// rustc: compiler/rustc_symbol_mangling/src/lib.rs:127 provide
export function provide(providers: Providers): void {
  providers.symbol_name = symbol_name_provider;
}

/// Compute the v0 symbol name for an offload kernel instance. Forces
/// `is_exportable: true` to omit the `stable_crate_id` disambiguator
/// (which differs between host and device passes).
// rustc: compiler/rustc_symbol_mangling/src/lib.rs:134 mangle_offload_export
export function mangle_offload_export(tcx: TyCtxt, instance: Instance): string {
  const instantiating_crate = is_generic(instance) ? (InstanceC.upstream_monomorphization(instance, tcx) ?? LOCAL_CRATE) : undefined;
  return v0.mangle(tcx, instance, instantiating_crate as CrateNum | undefined, true);
}

// The `symbol_name` query provides the symbol name for calling a given
// instance from the local crate. In particular, it will also look up the
// correct symbol name of instances from upstream crates.
// rustc: compiler/rustc_symbol_mangling/src/lib.rs:146 symbol_name_provider
function symbol_name_provider(tcx: TyCtxt, instance: Instance): SymbolName {
  const symbol_name = compute_symbol_name(tcx, instance, () => {
    // This closure determines the instantiating crate for instances that
    // need an instantiating-crate-suffix for their symbol name, in order
    // to differentiate between local copies.
    if (is_generic(instance)) {
      // For generics we might find re-usable upstream instances. If there
      // is one, we rely on the symbol being instantiated locally.
      return (InstanceC.upstream_monomorphization(instance, tcx) ?? LOCAL_CRATE) as CrateNum;
    } else {
      // For non-generic things that need to avoid naming conflicts, we
      // always instantiate a copy in the local crate.
      return LOCAL_CRATE;
    }
  });

  return SymbolName.new(tcx, symbol_name);
}

// rustc: compiler/rustc_symbol_mangling/src/lib.rs:165 typeid_for_trait_ref
export function typeid_for_trait_ref(tcx: TyCtxt, trait_ref: ExistentialTraitRef): string {
  return v0.mangle_typeid_for_trait_ref(tcx, trait_ref);
}

// rustc: compiler/rustc_symbol_mangling/src/lib.rs:172 symbol_name_from_attrs
export function symbol_name_from_attrs(tcx: TyCtxt, instance_kind: InstanceKind): string | undefined {
  const def_id = InstanceKindC.def_id(instance_kind);

  const local = def_id.as_local();
  if (local !== undefined) {
    if (tcx.proc_macro_decls_static(null) === local) {
      const stable_crate_id = tcx.stable_crate_id(LOCAL_CRATE);
      return generate_proc_macro_decls_symbol(stable_crate_id);
    }
  }

  // FIXME(eddyb) Precompute a custom symbol name based on attributes.
  const attrs = DefKind.has_codegen_attrs(tcx.def_kind(def_id)) ? TyCtxt_codegen_instance_attrs(tcx, instance_kind) : CodegenFnAttrs.EMPTY;

  if (CodegenFnAttrFlags.contains(attrs.flags, CodegenFnAttrFlags.RUSTC_STD_INTERNAL_SYMBOL)) {
    // Items marked as #[rustc_std_internal_symbol] need to have a fixed
    // symbol name because it is used to import items from another crate
    // without a direct dependency. As such it is not possible to look up
    // the mangled name for the `Instance` from the crate metadata of the
    // defining crate.
    // Weak lang items automatically get #[rustc_std_internal_symbol]
    // applied by the code computing the CodegenFnAttrs.
    // We are mangling all #[rustc_std_internal_symbol] items as a
    // combination of the rustc version and the unmangled linkage name.
    // This is to ensure that if we link against a staticlib compiled by a
    // different rustc version, we don't get symbol conflicts or even UB
    // due to a different implementation/ABI. Rust staticlibs currently
    // export all symbols, including those that are hidden in cdylibs.
    // We are using the v0 symbol mangling scheme here as we need to be
    // consistent across all crates and in some contexts the legacy symbol
    // mangling scheme can't be used. For example both the GCC backend and
    // Rust-for-Linux don't support some of the characters used by the
    // legacy symbol mangling scheme.
    const name = attrs.symbol_name !== undefined ? attrs.symbol_name : tcx.item_name(def_id);

    return v0.mangle_internal_symbol(tcx, Symbol.as_str(name));
  }

  // * On the wasm32 targets there is a bug (or feature) in LLD [1] where the
  //   same-named symbol when imported from different wasm modules will get
  //   hooked up incorrectly. As a result foreign symbols, on the wasm target,
  //   with a wasm import module, get mangled. Additionally our codegen will
  //   deduplicate symbols based purely on the symbol name, but for wasm this
  //   isn't quite right because the same-named symbol on wasm can come from
  //   different modules. For these reasons if `#[link(wasm_import_module)]`
  //   is present we mangle everything on wasm because the demangled form will
  //   show up in the `wasm-import-name` custom attribute in LLVM IR.
  //
  // [1]: https://bugs.llvm.org/show_bug.cgi?id=44316
  //
  // So, on wasm if a foreign item loses its `#[no_mangle]`, it might *still*
  // be mangled if we're forced to. Note: I don't like this.
  // These kinds of exceptions should be added during the `codegen_attrs` query.
  // However, we don't have the wasm import module map there yet.
  const wasm_import_module_exception_force_mangling =
    tcx.is_foreign_item(def_id) && tcx.sess.target.is_like_wasm && tcx.wasm_import_module_map(def_id.krate).has(def_id);

  if (!wasm_import_module_exception_force_mangling) {
    const name = attrs.symbol_name;
    if (name !== undefined) {
      // Use provided name
      return Symbol.as_str(name);
    }

    if (CodegenFnAttrFlags.contains(attrs.flags, CodegenFnAttrFlags.NO_MANGLE)) {
      // Don't mangle
      return Symbol.as_str(tcx.item_name(def_id));
    }
  }

  return undefined;
}

/// Computes the symbol name for the given instance. This function will call
/// `compute_instantiating_crate` if it needs to factor the instantiating crate
/// into the symbol name.
// rustc: compiler/rustc_symbol_mangling/src/lib.rs:256 compute_symbol_name
function compute_symbol_name(tcx: TyCtxt, instance: Instance, compute_instantiating_crate: () => CrateNum): string {
  const def_id = InstanceC.def_id(instance);
  // const args = instance.args;
  const def_kind = tcx.def_kind(InstanceC.def_id(instance));
  if (def_kind.$ === "Fn" || def_kind.$ === "AssocFn") {
    // debug_assert!(tcx.constness(instance.def_id()) != hir::Constness::Const { always: true });
  }

  // debug!("symbol_name(def_id={:?}, args={:?})", def_id, args);

  const symbol_ = symbol_name_from_attrs(tcx, instance.def);
  if (symbol_ !== undefined) {
    return symbol_;
  }

  // If we're dealing with an instance of a function that's inlined from
  // another crate but we're marking it as globally shared to our
  // compilation (aka we're not making an internal copy in each of our
  // codegen units) then this symbol may become an exported (but hidden
  // visibility) symbol. This means that multiple crates may do the same
  // and we want to be sure to avoid any symbol conflicts here.
  let is_globally_shared_function = false;
  if (
    def_kind.$ === "Fn" ||
    def_kind.$ === "AssocFn" ||
    def_kind.$ === "Closure" ||
    def_kind.$ === "SyntheticCoroutineBody" ||
    def_kind.$ === "Ctor"
  ) {
    const mode = MonoItem.instantiation_mode({ $: "Fn", _0: instance }, tcx);
    is_globally_shared_function = mode.$ === "GloballyShared" && mode.may_conflict === true;
  }

  // If this is an instance of a generic function, we also hash in
  // the ID of the instantiating crate. This avoids symbol conflicts
  // in case the same instances is emitted in two crates of the same
  // project.
  const avoid_cross_crate_conflicts = is_generic(instance) || is_globally_shared_function;

  const instantiating_crate = avoid_cross_crate_conflicts ? compute_instantiating_crate() : undefined;

  // Pick the crate responsible for the symbol mangling version, which has to:
  // 1. be stable for each instance, whether it's being defined or imported
  // 2. obey each crate's own `-C symbol-mangling-version`, as much as possible
  // We solve these as follows:
  // 1. because symbol names depend on both `def_id` and `instantiating_crate`,
  // both their `CrateNum`s are stable for any given instance, so we can pick
  // either and have a stable choice of symbol mangling version
  // 2. we favor `instantiating_crate` where possible (i.e. when `Some`)
  const mangling_version_crate = instantiating_crate ?? def_id.krate;
  // PORT: the `symbol_mangling_version` query value is `unknown` in queries.gen.ts.
  const mangling_version: SymbolManglingVersion =
    mangling_version_crate === LOCAL_CRATE
      ? Options_impl.get_symbol_mangling_version(tcx.sess.opts)
      : (tcx.symbol_mangling_version(mangling_version_crate) as SymbolManglingVersion);

  // Offload kernels must omit the stable_crate_id disambiguator because
  // host and device passes have different stable_crate_ids.
  // PORT: the `codegen_fn_attrs` query value is `unknown` in queries.gen.ts.
  const is_offload_kernel =
    DefKind.has_codegen_attrs(tcx.def_kind(def_id)) &&
    CodegenFnAttrFlags.contains((tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).flags, CodegenFnAttrFlags.OFFLOAD_KERNEL);
  let symbol: string;
  if (is_offload_kernel) {
    symbol = v0.mangle(tcx, instance, instantiating_crate, true);
  } else {
    switch (tcx.is_exportable(def_id)) {
      case true:
        symbol = `${v0.mangle(tcx, instance, instantiating_crate, true)}.${export_.compute_hash_of_export_fn(tcx, instance)}`;
        break;
      case false:
        switch (mangling_version) {
          case "Legacy": {
            const mangled_name = legacy.mangle(tcx, instance, instantiating_crate);

            // The PDB debug info format cannot store mangled symbol names for which its
            // internal record exceeds u16::MAX bytes, a limit multiple Rust projects have been
            // hitting due to the verbosity of legacy name mangling. Depending on the linker version
            // in use, such symbol names can lead to linker crashes or incomprehensible linker error
            // about a limit being hit.
            // Mangle those symbols with v0 mangling instead, which gives us more room to breathe
            // as v0 mangling is more compact.
            // Empirical testing has shown the limit for the symbol name to be 65521 bytes; use
            // 65000 bytes to leave some room for prefixes / suffixes as well as unknown scenarios
            // with a different limit.
            const MAX_SYMBOL_LENGTH = 65000;

            const mangled_name_too_long = tcx.sess.target.uses_pdb_debuginfo() && utf8_len(mangled_name) > MAX_SYMBOL_LENGTH;

            if (mangled_name_too_long) {
              symbol = v0.mangle(tcx, instance, instantiating_crate, false);
            } else {
              symbol = mangled_name;
            }
            break;
          }
          case "V0":
            symbol = v0.mangle(tcx, instance, instantiating_crate, false);
            break;
          case "Hashed":
            symbol = hashed.mangle(tcx, instance, instantiating_crate, () => v0.mangle(tcx, instance, instantiating_crate, false));
            break;
        }
        break;
    }
  }

  // debug_assert!(
  //     rustc_demangle::try_demangle(&symbol).is_ok(),
  //     "compute_symbol_name: `{symbol}` cannot be demangled"
  // );

  return symbol;
}

// rustc: compiler/rustc_symbol_mangling/src/lib.rs:373 is_generic
function is_generic(instance: Instance): boolean {
  return !instance.args.non_erasable_generics()[globalThis.Symbol.iterator]().next().done;
}
