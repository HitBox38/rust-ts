// Port of compiler/rustc_passes/src/lib.rs (the modules ported so far).
//! Various checks
//!
//! # Note
//!
//! This API is completely unstable and subject to change.
import type { Providers } from "../rustc_middle/queries.gen.ts";
import * as check_export from "./check_export.ts";
import * as debugger_visualizer from "./debugger_visualizer.ts";
import * as diagnostic_items from "./diagnostic_items.ts";
import * as eii from "./eii.ts";
import * as entry from "./entry.ts";
import * as lang_items from "./lang_items.ts";
import * as lib_features from "./lib_features.ts";

// pub mod abi_test;            (not ported)
// mod canonical_symbols;       (not ported)
// mod check_attr;              (not ported)
// mod check_export;           (private: imported above for `provide`)
// pub mod dead;                (not ported, M4)
export * as debugger_visualizer from "./debugger_visualizer.ts";
// pub mod delegation;          (not ported)
// mod diagnostic_items;       (private: imported above for `provide`)
export * as diagnostics from "./diagnostics.ts";
// mod eii;                    (private: imported above for `provide`)
export * as entry from "./entry.ts";
// mod fake_doc_items;          (not ported)
// pub mod hir_id_validator;    (not ported)
// pub mod input_stats;         (not ported)
export * as lang_items from "./lang_items.ts";
// pub mod layout_test;         (not ported)
// mod lib_features;           (private: imported above for `provide`)
// mod reachable;               (not ported, M4)
// pub mod stability;           (not ported)
// mod upvars;                  (not ported)
export * as weak_lang_items from "./weak_lang_items.ts";

// rustc: compiler/rustc_passes/src/lib.rs:36 provide
export function provide(providers: Providers): void {
  // PORT: the `provide` fns of the modules not ported yet are skipped (their queries keep the default provider).
  // canonical_symbols::provide(providers);
  // check_attr::provide(providers);
  // dead::provide(providers);
  debugger_visualizer.provide(providers);
  diagnostic_items.provide(providers);
  entry.provide(providers);
  lang_items.provide(providers);
  lib_features.provide(providers);
  // reachable::provide(providers);
  // stability::provide(providers);
  // upvars::provide(providers);
  check_export.provide(providers);
  // fake_doc_items::provide(providers);
  providers.check_externally_implementable_items = eii.check_externally_implementable_items;
}
