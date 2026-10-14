// Port of compiler/rustc_infer/src/infer/relate/type_relating.rs (lane infer-relate).
//
// Contract stub (lane infcx-contract): every fn of this file that ../decls.ts declares is an `unported`
// placeholder below. Fill them per docs/handoff/infcx-contract.md "How to fill a stub": port each fn in upstream
// order with its `// rustc:` marker, then delete its name from the `unported_methods` list (and the call when
// the list is empty) or replace the stub `export const`. Init order: top-level code here may touch only
// ../decls.ts (or ../../decls.ts), this file's .gen.ts and other crates.

import { unported_methods } from "../../../rust_ts/stubs.ts";

export * from "./type_relating.gen.ts";

import type { ParamEnv, Ty } from "../../../rustc_middle/ty/decls.ts";
import type { DelayedSet } from "../../../rustc_type_ir/data_structures/mod.ts";
import type { Variance } from "../../../rustc_type_ir/decls.ts";
import type { InferCtxt } from "../../decls.ts";
import type { PredicateObligations } from "../../traits/mod.gen.ts";
import type { DefineOpaqueTypes } from "../at.gen.ts";
import type { TypeTrace } from "../mod.gen.ts";

// rustc-type: compiler/rustc_infer/src/infer/relate/type_relating.rs:15 TypeRelating
// PORT: hand class (codegen `hand`): the field `param_env` is `param_env_` (`PredicateEmittingRelation::param_env`).
export class TypeRelating {
  constructor(
    public infcx: InferCtxt,

    // Immutable fields
    public trace: TypeTrace,
    public param_env_: ParamEnv,
    public define_opaque_types: DefineOpaqueTypes,

    // Mutable fields.
    public ambient_variance: Variance,
    public obligations: PredicateObligations,
    /// The cache only tracks the `ambient_variance` as it's the
    /// only field which is mutable and which meaningfully changes
    /// the result when relating types.
    ///
    /// The cache does not track whether the state of the
    /// `InferCtxt` has been changed or whether we've added any
    /// obligations to `self.goals`. Whether a goal is added
    /// once or multiple times is not really meaningful.
    ///
    /// Changes in the inference state may delay some type inference to
    /// the next fulfillment loop. Given that this loop is already
    /// necessary, this is also not a meaningful change. Consider
    /// the following three relations:
    /// ```text
    /// Vec<?0> sub Vec<?1>
    /// ?0 eq u32
    /// Vec<?0> sub Vec<?1>
    /// ```
    /// Without a cache, the second `Vec<?0> sub Vec<?1>` would eagerly
    /// constrain `?1` to `u32`. When using the cache entry from the
    /// first time we've related these types, this only happens when
    /// later proving the `Subtype(?0, ?1)` goal from the first relation.
    // PORT: `DelayedSet<(Variance, Ty, Ty)>`: tuple keys need a by-value key (rust_ts/keyed.ts) in the port.
    public cache: DelayedSet<[Variance, Ty, Ty]>,
  ) {}
}

unported_methods(TypeRelating.prototype, "rustc_infer::infer::relate::type_relating::TypeRelating", ["into_obligations"]);
unported_methods(TypeRelating, "rustc_infer::infer::relate::type_relating::TypeRelating", ["new"]);
