// Port of compiler/rustc_passes/src/diagnostic_items.rs
//! Detecting diagnostic items.
//!
//! Diagnostic items are items that are not language-inherent, but can reasonably be expected to
//! exist for diagnostic purposes. This allows diagnostic authors to refer to specific items
//! directly, without having to guess module paths and crates.
//! Examples are:
//!
//! * Traits like `Debug`, that have no bearing on language semantics
//!
//! * Compiler internal types like `Ty` and `TyCtxt`
import { default_DiagnosticItems, type DiagnosticItems } from "../rustc_attr_ir/diagnostic_items.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { CRATE_OWNER_ID, HirId_from_OwnerId, type OwnerId } from "../rustc_hir_id/lib.ts";
import type { ModuleItems } from "../rustc_middle/hir/mod.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { type DefId, DefId_eq, LOCAL_CRATE } from "../rustc_span/def_id.ts";
import { type Symbol, sym } from "../rustc_span/symbol.ts";
import { DuplicateDiagnosticItemInCrate_diagnostic } from "./diagnostics.ts";

// rustc: compiler/rustc_passes/src/diagnostic_items.rs:22 observe_item
function observe_item(tcx: TyCtxt, diagnostic_items: DiagnosticItems, owner: OwnerId): void {
  const attrs = tcx.hir_attrs(HirId_from_OwnerId(owner));
  const name = find_attr(attrs, (k) => (k.$ === "RustcDiagnosticItem" ? k._0 : undefined));
  if (name !== undefined) {
    // insert into our table
    collect_item(tcx, diagnostic_items, name, owner.to_def_id());
  }
}

// rustc: compiler/rustc_passes/src/diagnostic_items.rs:30 collect_item
function collect_item(tcx: TyCtxt, items: DiagnosticItems, name: Symbol, item_def_id: DefId): void {
  items.id_to_name.set(item_def_id, name);
  // `name_to_id.insert(..)` returns the previous value (an `FxIndexMap` keeps the key's position).
  const original_def_id = items.name_to_id.get(name);
  items.name_to_id.set(name, item_def_id);
  if (original_def_id !== undefined) {
    if (!DefId_eq(original_def_id, item_def_id)) {
      report_duplicate_item(tcx, name, original_def_id, item_def_id);
    }
  }
}

// rustc: compiler/rustc_passes/src/diagnostic_items.rs:39 report_duplicate_item
function report_duplicate_item(tcx: TyCtxt, name: Symbol, original_def_id: DefId, item_def_id: DefId): void {
  const orig_span = tcx.hir_span_if_local(original_def_id);
  const duplicate_span = tcx.hir_span_if_local(item_def_id);
  tcx.dcx().emit_err(
    DuplicateDiagnosticItemInCrate_diagnostic({
      duplicate_span,
      orig_span,
      crate_name: tcx.crate_name(item_def_id.krate),
      orig_crate_name: tcx.crate_name(original_def_id.krate),
      different_crates: item_def_id.krate !== original_def_id.krate,
      name,
    }),
  );
}

/// Traverse and collect the diagnostic items in the current crate
// rustc: compiler/rustc_passes/src/diagnostic_items.rs:58 diagnostic_items
function diagnostic_items(tcx: TyCtxt, _: unknown): DiagnosticItems {
  // Initialize the collector.
  const diagnostic_items = default_DiagnosticItems();

  // Optimization: can this crate even define diagnostic items?
  // (But do not mark `rustc_attrs` as used while doing so)
  if (tcx.features().enabled_features().has(sym.rustc_attrs)) {
    // Collect diagnostic items in this crate.
    const crate_items = tcx.hir_crate_items(null) as ModuleItems;
    for (const id of [...crate_items.owners(), CRATE_OWNER_ID]) {
      observe_item(tcx, diagnostic_items, id);
    }
  }

  return diagnostic_items;
}

/// Traverse and collect all the diagnostic items in all crates.
// rustc: compiler/rustc_passes/src/diagnostic_items.rs:76 all_diagnostic_items
function all_diagnostic_items(tcx: TyCtxt, _: null): DiagnosticItems {
  // Initialize the collector.
  const items = default_DiagnosticItems();

  // Collect diagnostic items in visible crates.
  for (const cnum of [...tcx.crates(null).filter((cnum) => tcx.is_user_visible_dep(cnum)), LOCAL_CRATE]) {
    for (const [name, def_id] of tcx.diagnostic_items(cnum).name_to_id) {
      collect_item(tcx, items, name, def_id);
    }
  }

  return items;
}

// rustc: compiler/rustc_passes/src/diagnostic_items.rs:96 provide
export function provide(providers: Providers): void {
  providers.diagnostic_items = diagnostic_items;
  providers.all_diagnostic_items = all_diagnostic_items;
}
