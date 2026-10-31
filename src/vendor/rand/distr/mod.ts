//! Generating random samples from probability distributions
//!
//! This module is the home of the [`Distribution`] trait and several of its
//! implementations. It is the workhorse behind some of the convenient
//! functionality of the [`RngExt`] trait, e.g. [`RngExt::random`] and of course
//! [`RngExt::sample`].
//
// Port of rand =0.10.1 `src/distr/mod.rs` (the modules Miri's draws reach: distribution, integer, other (bool),
// bernoulli, uniform (integers), utils (wmul)). `float`, `slice`, `weighted` are not ported.
// PORT: `StandardUniform` is a unit struct; its `Distribution<T>` impls are the `StandardUniform_<T>` tables.
import type { Debug } from "../../../std/fmt.ts";

export { Bernoulli, type BernoulliError } from "./bernoulli.ts";
export { Distribution_provided, Iter, Map, type Distribution } from "./distribution.ts";
export * from "./integer.ts";
export { StandardUniform_bool } from "./other.ts";
export * as uniform from "./uniform.ts";
export { Uniform } from "./uniform.ts";
export * as uniform_int from "./uniform_int.ts";

/// The Standard Uniform distribution
///
/// This [`Distribution`] is the *standard* parameterization of [`Uniform`]. Bounds
/// are selected according to the output type.
export type StandardUniform = "StandardUniform";
export const debug_StandardUniform: Debug<StandardUniform> = () => "StandardUniform";
