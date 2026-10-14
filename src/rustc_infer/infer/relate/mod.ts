// Port of compiler/rustc_infer/src/infer/relate/mod.rs (lane infer-relate; no fns).
//
//! This module contains the definitions of most `TypeRelation`s in the type system
//! (except for some relations used for diagnostics and heuristics in the compiler).
//! As well as the implementation of `Relate` for interned things (`Ty`/`Const`/etc).

// `pub use rustc_middle::ty::relate::combine::PredicateEmittingRelation;`
export type { PredicateEmittingRelation } from "../../../rustc_type_ir/relate/combine.ts";
// `pub use rustc_middle::ty::relate::{RelateResult, *};`
export * from "../../../rustc_type_ir/relate.ts";

// `mod generalize; mod higher_ranked; pub(super) mod lattice; pub(super) mod type_relating;` are loaded by ../../lib.ts.
export * as lattice from "./lattice.ts";
export * as type_relating from "./type_relating.ts";
