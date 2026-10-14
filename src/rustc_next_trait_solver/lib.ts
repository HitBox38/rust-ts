//! Crate containing the implementation of the next-generation trait solver.
//!
//! This crate may also contain things that are used by the old trait solver,
//! but were uplifted in the process of making the new trait solver generic.
//! So if you got to this crate from the old solver, it's totally normal.
//
// Port of compiler/rustc_next_trait_solver/src/lib.rs (lane evalctxt-contract): the crate root. lib.rs has no fns, only
// its `#![allow(..)]` lints (no TS counterpart) and the module tree below.
//
// Init order (docs/handoff/evalctxt-contract.md "Init order"; a TDZ ReferenceError at load otherwise): decls.ts (the
// `EvalCtxt` class, types only otherwise) is evaluated first; then every module that assigns `EvalCtxt` methods or holds
// the crate's other items, in module order. A module's top-level code may touch only decls.ts and other crates, never
// another module of this crate. Consumers outside the crate import this file only.
import "./decls.ts";
import "./delegate.ts";
import "./solve/eval_ctxt/mod.ts";
import "./solve/eval_ctxt/fast_path.ts";
import "./solve/eval_ctxt/probe.ts";
import "./solve/eval_ctxt/solver_region_constraints.ts";
import "./solve/mod.ts";
import "./solve/assembly/mod.ts";
import "./solve/assembly/structural_traits.ts";
import "./solve/effect_goals.ts";
import "./solve/inspect/build.ts";
import "./solve/inspect/mod.ts";
import "./solve/normalizes_to.ts";
import "./solve/project_goals/mod.ts";
import "./solve/project_goals/anon_const.ts";
import "./solve/project_goals/free_alias.ts";
import "./solve/project_goals/inherent.ts";
import "./solve/project_goals/opaque_types.ts";
import "./solve/search_graph.ts";
import "./solve/trait_goals.ts";
import "./canonical/mod.ts";
import "./canonical/canonicalizer.ts";
import "./coherence.ts";
import "./normalize.ts";
import "./placeholder.ts";

// `pub mod canonical; pub mod coherence; pub mod delegate; pub mod normalize; pub mod placeholder; pub mod solve;`
export * as canonical from "./canonical/mod.ts";
export * as coherence from "./coherence.ts";
export * as delegate from "./delegate.ts";
export * as normalize from "./normalize.ts";
export * as placeholder from "./placeholder.ts";
export * as solve from "./solve/mod.ts";
