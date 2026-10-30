// Port of compiler/rustc_passes/src/lib.rs (the modules ported so far).
//! Various checks
//!
//! # Note
//!
//! This API is completely unstable and subject to change.
import type { Providers } from "../rustc_middle/queries.gen.ts";
import * as canonical_symbols from "./canonical_symbols.ts";
import * as check_attr from "./check_attr.ts";
import * as check_export from "./check_export.ts";
import * as dead from "./dead.ts";
import * as debugger_visualizer from "./debugger_visualizer.ts";
import * as diagnostic_items from "./diagnostic_items.ts";
import * as fake_doc_items from "./fake_doc_items.ts";
import * as eii from "./eii.ts";
import * as entry from "./entry.ts";
import * as lang_items from "./lang_items.ts";
import * as lib_features from "./lib_features.ts";
import * as reachable from "./reachable.ts";
import * as stability from "./stability.ts";
import * as upvars from "./upvars.ts";

// pub mod abi_test;
export * as abi_test from "./abi_test.ts";
// mod canonical_symbols;      (private: imported above for `provide`)
// mod check_attr;             (private: imported above for `provide`)
// mod check_export;           (private: imported above for `provide`)
// pub mod dead;
export * as dead from "./dead.ts";
export * as debugger_visualizer from "./debugger_visualizer.ts";
// pub mod delegation;
export * as delegation from "./delegation.ts";
// mod diagnostic_items;       (private: imported above for `provide`)
export * as diagnostics from "./diagnostics.ts";
// mod eii;                    (private: imported above for `provide`)
export * as entry from "./entry.ts";
// mod fake_doc_items;        (private: imported above for `provide`)
// pub mod hir_id_validator;    (not ported)
// pub mod input_stats;         (not ported)
export * as lang_items from "./lang_items.ts";
// pub mod layout_test;
export * as layout_test from "./layout_test.ts";
// mod lib_features;           (private: imported above for `provide`)
// mod reachable;             (private: imported above for `provide`)
export * as stability from "./stability.ts";
// mod upvars;                 (private: imported above for `provide`)
export * as weak_lang_items from "./weak_lang_items.ts";

// rustc: compiler/rustc_passes/src/lib.rs:36 provide
export function provide(providers: Providers): void {
  // PORT: the `provide` fns of the modules not ported yet are skipped (their queries keep the default provider).
  canonical_symbols.provide(providers);
  check_attr.provide(providers);
  dead.provide(providers);
  debugger_visualizer.provide(providers);
  diagnostic_items.provide(providers);
  entry.provide(providers);
  lang_items.provide(providers);
  lib_features.provide(providers);
  reachable.provide(providers);
  stability.provide(providers);
  upvars.provide(providers);
  check_export.provide(providers);
  fake_doc_items.provide(providers);
  providers.check_externally_implementable_items = eii.check_externally_implementable_items;
}
