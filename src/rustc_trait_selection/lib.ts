// Port of compiler/rustc_trait_selection/src/lib.rs (the crate root; lane infcx-contract started it with the modules
// that hold the `#[extension]` traits on rustc_infer's types; the other modules are added by their lanes, wave 17+).
//
// Load order: rustc_infer first (its classes must exist before the extension modules assign onto their prototypes), then
// decls.ts (types only), then the modules in upstream `mod` order. A module's top-level code touches only rustc_infer and
// other crates. Consumers outside the crate import this file.
import "../rustc_infer/lib.ts";
import "./decls.ts";
// pub mod error_reporting;
import "./error_reporting/mod.ts";
// pub mod infer;
import "./infer.ts";
// pub mod regions;
import "./regions.ts";
// pub mod solve;
import "./solve/select.ts";
import "./solve/inspect/analyse.ts";
// pub mod traits;
import "./traits/mod.ts";
import "./traits/engine.ts";
import "./traits/misc.ts";
import "./traits/normalize.ts";
import "./traits/outlives_bounds.ts";
import "./traits/query/evaluate_obligation.ts";
import "./traits/query/normalize.ts";
import "./traits/structural_normalize.ts";
import "./traits/util.ts";

export * as infer from "./infer.ts";
export * as regions from "./regions.ts";
export * as traits from "./traits/mod.ts";
