// Port of compiler/rustc_resolve/src/imports.rs
// Stub (contract-first, lane res-lib): the methods of this file are declared in ./decls.ts
// and installed below as `unported(..)` placeholders; free fns and companions have their final
// signatures and `unported` bodies, without markers. The lane that ports compiler/rustc_resolve/src/imports.rs replaces each
// stub in place (adding its `// rustc:` marker) and removes the method's name from the
// `unported_methods` list (docs/handoff/res-lib.md, "How to fill a stub").
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other
// crates; another rustc_resolve module's exports are read inside function bodies only.
import type { Ident } from "../rustc_span/symbol.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { Debug, Fmt } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { Resolver } from "./decls.ts";
import * as gen from "./imports.gen.ts";
import type { BindingKey, Decl, ImportSummary, LocalModule } from "./lib.ts";
import type { Result } from "../std/result.ts";

export * from "./imports.gen.ts";
export type NameResolution = gen.NameResolution;
export type ImportData = gen.ImportData;
export const ImportData = gen.ImportData;

/** Stub (lane res-lib): `imports.rs:385` `pub_use_of_private_extern_crate_hack` (unported). */
export function pub_use_of_private_extern_crate_hack(import_: ImportSummary, decl: Decl): LocalDefId | undefined {
  return unported("rustc_resolve::imports::pub_use_of_private_extern_crate_hack");
}
/** Stub (lane res-lib): `imports.rs:401` `remove_same_import` (unported). */
export function remove_same_import(d1: Decl, d2: Decl): [Decl, Decl] {
  return unported("rustc_resolve::imports::remove_same_import");
}
/** Stub (lane res-lib): `imports.rs:1929` `import_path_to_string` (unported). */
export function import_path_to_string(names: readonly Ident[], import_kind: ImportKind, span: Span): string {
  return unported("rustc_resolve::imports::import_path_to_string");
}
/** Stub (lane res-lib): `imports.rs:1953` `import_kind_to_string` (unported). */
export function import_kind_to_string(import_kind: ImportKind): string {
  return unported("rustc_resolve::imports::import_kind_to_string");
}
export type PendingDecl = gen.PendingDecl;
export const PendingDecl = {
  ...gen.PendingDecl,
  /** Stub: `imports.rs:63` `PendingDecl::decl` (unported). */
  decl(self: PendingDecl): Decl | undefined {
    return unported("rustc_resolve::imports::PendingDecl::decl");
  },
};
export type ImportKind = gen.ImportKind;
export const ImportKind = gen.ImportKind;

/// Manually implement `Debug` for `ImportKind` because the `source/target_bindings`
/// contain `Cell`s which can introduce infinite loops while printing.
/** Stub: `imports.rs:121` `<ImportKind as Debug>::fmt` (unported). */
export const debug_ImportKind: Debug<ImportKind> = (_v: ImportKind, _f: Fmt): string => unported("rustc_resolve::imports::<ImportKind as Debug>::fmt");

// mod cycle_detection (types in imports.gen.ts `cycle_detection`)
/** Stub: `imports.rs:338` `<cycle_detection::ActiveResolutionGuard as Drop>::drop` (unported). */
export function ActiveResolutionGuard_drop(_self: gen.cycle_detection.ActiveResolutionGuard): void {
  unported("rustc_resolve::imports::cycle_detection::<ActiveResolutionGuard as Drop>::drop");
}
/// Returns `Err(())` if a cycle is detected, otherwise this returns a
/// guard that will remove the resolution when dropped.
/** Stub: `imports.rs:351` `cycle_detection::enter_cycle_detector` (unported). */
export function enter_cycle_detector(_module: LocalModule, _binding_key: BindingKey): Result<gen.cycle_detection.ActiveResolutionGuard, null> {
  return unported("rustc_resolve::imports::cycle_detection::enter_cycle_detector");
}
export const NameResolution = gen.NameResolution as typeof gen.NameResolution & {
  "new": (orig_ident_span: Span) => NameResolution;
};
/** Stub: `imports.rs:286` `NameResolution::new` (unported). */
NameResolution.new = function (orig_ident_span: Span): NameResolution {
  return unported("rustc_resolve::imports::NameResolution::new");
};
unported_methods(ImportData.prototype, "rustc_resolve::imports::ImportData", ["is_glob", "is_nested", "id", "def_id", "simplify", "summary"]);
unported_methods(NameResolution.prototype, "rustc_resolve::imports::NameResolution", ["determined_decl", "best_decl"]);
unported_methods(Resolver.prototype, "rustc_resolve::imports::Resolver", ["import_decl_vis", "import_decl_vis_ext", "new_import_decl", "is_noise_0_7_0", "is_rustybuzz_0_4_0", "is_pdf_0_9_0", "is_net2_0_2_39", "select_glob_decl", "try_plant_decl_into_local_module", "update_local_resolution", "import_dummy_binding", "resolve_imports", "write_import_resolutions", "finalize_imports", "lint_reexports", "resolve_import", "finalize_import", "report_cannot_reexport", "check_for_redundant_imports", "resolve_glob_import", "rust_embed_hack", "finalize_resolutions_in"]);
