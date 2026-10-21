// Port of compiler/rustc_passes/src/canonical_symbols.rs (lane passes-dead).
//
// PORT notes:
// - The `canonical_symbols` / `all_canonical_symbols` / `symbol_name` query values are `unknown` in queries.gen.ts;
//   they are cast to `CanonicalSymbols` / `SymbolName` here.
// - `find_attr!(attrs, RustcCanonicalSymbol)` is `find_attr(attrs, (k) => ...) !== undefined` (rustc_attr_ir/lib.ts).
import { CanonicalSymbols } from "../rustc_attr_ir/canonical_symbols.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import type { ForeignItemId } from "../rustc_hir/hir.ts";
import { DefId_from_OwnerId, HirId_from_OwnerId } from "../rustc_hir_id/lib.ts";
import type { ModuleItems } from "../rustc_middle/hir/mod.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import type { SymbolName } from "../rustc_middle/ty/mod.ts";
import { type DefId, LOCAL_CRATE, LocalDefId } from "../rustc_span/def_id.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { DuplicateCanonicalSymbolInCrate_diagnostic } from "./diagnostics.ts";

// rustc: compiler/rustc_passes/src/canonical_symbols.rs:10 observe_item
function observe_item(tcx: TyCtxt, canonical_symbols: CanonicalSymbols, fid: ForeignItemId): void {
  const attrs = tcx.hir_attrs(HirId_from_OwnerId(fid.owner_id));
  if (find_attr(attrs, (k) => (k.$ === "RustcCanonicalSymbol" ? null : undefined)) !== undefined) {
    const did = fid.owner_id.def_id;
    const instance = Instance.new_raw(LocalDefId.to_def_id(did), RawList.identity_for_item(tcx, LocalDefId.to_def_id(did)));
    const symbol_name_ = tcx.symbol_name(instance) as SymbolName;
    const symbol_name = Symbol.intern(symbol_name_.name);

    // insert into our table
    collect_item(tcx, canonical_symbols, symbol_name, DefId_from_OwnerId(fid.owner_id));
  }
}

// rustc: compiler/rustc_passes/src/canonical_symbols.rs:27 collect_item
function collect_item(tcx: TyCtxt, canonical_symbols: CanonicalSymbols, symbol: Symbol, item_def_id: DefId): void {
  const original_def_id = canonical_symbols.set(symbol, item_def_id);
  if (original_def_id !== undefined) {
    report_duplicate_item(tcx, symbol, original_def_id, item_def_id);
  }
}

// rustc: compiler/rustc_passes/src/canonical_symbols.rs:38 report_duplicate_item
function report_duplicate_item(tcx: TyCtxt, name: Symbol, original_def_id: DefId, item_def_id: DefId): void {
  const orig_span = tcx.hir_span_if_local(original_def_id);
  const duplicate_span = tcx.hir_span_if_local(item_def_id);
  tcx.dcx().emit_err(
    DuplicateCanonicalSymbolInCrate_diagnostic({
      duplicate_span,
      orig_span,
      crate_name: tcx.crate_name(item_def_id.krate),
      orig_crate_name: tcx.crate_name(original_def_id.krate),
      different_crates: item_def_id.krate !== original_def_id.krate,
      name,
    }),
  );
}

/// Traverse and collect the canonical symbols in the current crate
// rustc: compiler/rustc_passes/src/canonical_symbols.rs:57 canonical_symbols
function canonical_symbols(tcx: TyCtxt, _: "LocalCrate"): CanonicalSymbols {
  // Initialize the collector.
  const canonical_symbols = CanonicalSymbols.new();

  // Optimization: can this crate even define canonical items?
  // (But do not mark `rustc_attrs` as used while doing so)
  if (tcx.features().enabled_features().has(sym.rustc_attrs)) {
    // Collect canonical symbols in this crate.
    const crate_items = tcx.hir_crate_items(null) as ModuleItems;
    for (const id of crate_items.foreign_items()) {
      observe_item(tcx, canonical_symbols, id);
    }
  }
  return canonical_symbols;
}

/// Traverse and collect all the canonical symbols in all crates.
// rustc: compiler/rustc_passes/src/canonical_symbols.rs:74 all_canonical_symbols
function all_canonical_symbols(tcx: TyCtxt, _: null): CanonicalSymbols {
  // Initialize the collector.
  const items = CanonicalSymbols.new();

  // Collect all canonical symbols
  for (const cnum of [...tcx.crates(null), LOCAL_CRATE]) {
    for (const cs of (tcx.canonical_symbols(cnum) as CanonicalSymbols).iter()) {
      collect_item(tcx, items, cs.symbol, cs.def_id);
    }
  }

  return items;
}

// rustc: compiler/rustc_passes/src/canonical_symbols.rs:88 provide
export function provide(providers: Providers): void {
  providers.canonical_symbols = canonical_symbols;
  providers.all_canonical_symbols = all_canonical_symbols;
}
