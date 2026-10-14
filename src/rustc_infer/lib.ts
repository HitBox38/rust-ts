// Port of compiler/rustc_infer/src/lib.rs (the crate root; lane infcx-contract).
//
//! This crates defines the type inference engine.
//!
//! - **Type inference.** The type inference code can be found in the `infer` module;
//!   this code handles low-level equality and subtyping operations. The
//!   type check pass in the compiler is found in the `rustc_hir_analysis` crate.
//!
//! For more information about how rustc works, see the [rustc dev guide].
//!
//! [rustc dev guide]: https://rustc-dev-guide.rust-lang.org/
//!
//! # Note
//!
//! This API is completely unstable and subject to change.
//
// Load order (PORTING §5 "Methods defined in another file"; docs/handoff/infcx-contract.md "Init order"):
// 1. rustc_middle (TyCtxt and the type classes; `TyCtxtInferExt` puts `infer_ctxt` on `TyCtxt.prototype`);
// 2. decls.ts, the contract classes (`InferCtxt`, `InferCtxtInner`, `InferCtxtBuilder`, `At`), which imports types only;
// 3. every module of the crate, each assigning its methods (or `unported` placeholders) onto the prototypes. Their
//    top-level code touches only decls.ts, their own .gen.ts and other crates, so the order below (upstream `mod` order)
//    is free.
// Consumers outside the crate import this file (never infer/mod.ts or decls.ts alone).
import "../rustc_middle/lib.ts";
import "./decls.ts";
// mod diagnostics;
import "./diagnostics.ts";
// pub mod infer; (infer/mod.rs `mod` order)
import "./infer/mod.ts";
import "./infer/at.ts";
import "./infer/canonical/mod.ts";
import "./infer/canonical/canonicalizer.ts";
import "./infer/canonical/instantiate.ts";
import "./infer/canonical/query_response.ts";
import "./infer/context.ts";
import "./infer/free_regions.ts";
import "./infer/freshen.ts";
import "./infer/lexical_region_resolve/mod.ts";
import "./infer/lexical_region_resolve/indexed_edges.ts";
import "./infer/opaque_types/mod.ts";
import "./infer/opaque_types/table.ts";
import "./infer/outlives/mod.ts";
import "./infer/outlives/env.ts";
import "./infer/outlives/obligations.ts";
import "./infer/outlives/test_type_match.ts";
import "./infer/outlives/verify.ts";
import "./infer/projection.ts";
import "./infer/region_constraints/mod.ts";
import "./infer/region_constraints/leak_check.ts";
import "./infer/relate/mod.ts";
import "./infer/relate/generalize.ts";
import "./infer/relate/higher_ranked.ts";
import "./infer/relate/lattice.ts";
import "./infer/relate/type_relating.ts";
import "./infer/resolve.ts";
import "./infer/snapshot/mod.ts";
import "./infer/snapshot/fudge.ts";
import "./infer/snapshot/undo_log.ts";
import "./infer/solver_region_constraints.ts";
import "./infer/type_variable.ts";
import "./infer/unify_key.ts";
// pub mod traits;
import "./traits/mod.ts";
import "./traits/engine.ts";
import "./traits/project.ts";
import "./traits/structural_impls.ts";
import "./traits/util.ts";

export * as infer from "./infer/mod.ts";
export * as traits from "./traits/mod.ts";
