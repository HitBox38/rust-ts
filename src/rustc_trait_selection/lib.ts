// Port of compiler/rustc_trait_selection/src/lib.rs (the crate root; lane infcx-contract started it with the modules
// that hold the `#[extension]` traits on rustc_infer's types; the other modules are added by their lanes, wave 17+).
//
// Load order: rustc_infer first (its classes must exist before the extension modules assign onto their prototypes), then
// decls.ts (types only), then the modules in upstream `mod` order. A module's top-level code touches only rustc_infer and
// other crates. Consumers outside the crate import this file.
import "../rustc_infer/lib.ts";
import { install_derefs } from "../rust_ts/deref.ts";
import "./decls.ts";
// pub mod diagnostics;
import "./diagnostics.ts";
import "./diagnostics/note_and_explain.ts";
// pub mod error_reporting;
import "./error_reporting/mod.ts";
import "./error_reporting/infer/mod.ts";
import "./error_reporting/infer/note_and_explain.ts";
import "./error_reporting/infer/suggest.ts";
import "./error_reporting/infer/need_type_info.ts";
import "./error_reporting/infer/nice_region_error/mod.ts";
import "./error_reporting/infer/nice_region_error/different_lifetimes.ts";
import "./error_reporting/infer/nice_region_error/find_anon_type.ts";
import "./error_reporting/infer/nice_region_error/mismatched_static_lifetime.ts";
import "./error_reporting/infer/nice_region_error/named_anon_conflict.ts";
import "./error_reporting/infer/nice_region_error/placeholder_error.ts";
import "./error_reporting/infer/nice_region_error/placeholder_relation.ts";
import "./error_reporting/infer/nice_region_error/static_impl_trait.ts";
import "./error_reporting/infer/nice_region_error/trait_impl_difference.ts";
import "./error_reporting/infer/nice_region_error/util.ts";
import "./error_reporting/infer/region.ts";
import "./error_reporting/traits/mod.ts";
import "./error_reporting/traits/ambiguity.ts";
import "./error_reporting/traits/call_kind.ts";
import "./error_reporting/traits/fulfillment_errors.ts";
import "./error_reporting/traits/on_unimplemented.ts";
import "./error_reporting/traits/overflow.ts";
import "./error_reporting/traits/suggestions.ts";
// pub mod infer;
import "./infer.ts";
// pub mod opaque_types;
import "./opaque_types.ts";
// pub mod regions;
import "./regions.ts";
// pub mod solve;
import "../rustc_next_trait_solver/lib.ts";
import "./solve.ts";
import "./solve/delegate.ts";
import "./solve/fulfill.ts";
import "./solve/fulfill/derive_errors.ts";
import "./solve/inspect.ts";
import "./solve/inspect/analyse.ts";
import "./solve/normalize.ts";
import "./solve/select.ts";
// pub mod traits;
import "./traits/mod.ts";
import "./traits/coherence.ts";
import "./traits/auto_trait.ts";
import "./traits/const_evaluatable.ts";
import "./traits/dyn_compatibility.ts";
import "./traits/effects.ts";
import "./traits/engine.ts";
import "./traits/fulfill.ts";
import "./traits/implied_outlives_bounds.ts";
import "./traits/misc.ts";
import "./traits/normalize.ts";
import "./traits/outlives_bounds.ts";
import "./traits/outlives_for_liveness.ts";
import "./traits/project.ts";
import "./traits/query/mod.ts";
import "./traits/query/dropck_outlives.ts";
import "./traits/query/evaluate_obligation.ts";
import "./traits/query/method_autoderef.ts";
import "./traits/query/normalize.ts";
import "./traits/query/type_op/mod.ts";
import "./traits/query/type_op/ascribe_user_type.ts";
import "./traits/query/type_op/custom.ts";
import "./traits/query/type_op/normalize.ts";
import "./traits/query/type_op/outlives.ts";
import "./traits/query/type_op/prove_predicate.ts";
import "./traits/select/mod.ts";
import "./traits/select/_match.ts";
import "./traits/select/candidate_assembly.ts";
import "./traits/select/confirmation.ts";
import "./traits/specialize/mod.ts";
import "./traits/specialize/specialization_graph.ts";
import "./traits/structural_normalize.ts";
import "./traits/util.ts";
import "./traits/vtable.ts";
import "./traits/wf.ts";

// The `Deref` forwarders of `TypeErrCtxt -> InferCtxt` (error_reporting/mod.ts): every `InferCtxt` prototype method
// (rustc_infer's and this crate's extension methods) and every `TypeErrCtxt` method / placeholder exists by now.
install_derefs();

export * as diagnostics from "./diagnostics.ts";
export * as error_reporting from "./error_reporting/mod.ts";
export * as infer from "./infer.ts";
export * as regions from "./regions.ts";
export * as solve from "./solve.ts";
export * as traits from "./traits/mod.ts";
