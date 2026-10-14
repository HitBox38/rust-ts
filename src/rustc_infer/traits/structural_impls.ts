// Port of compiler/rustc_infer/src/traits/structural_impls.rs (lane infer-opaque-snapshot): the manual `Debug` impls
// of `Normalized`, `Obligation` and `MismatchedProjectionTypes` (re-exported by traits/mod.ts and traits/project.ts,
// where codegen looks for them).
// PORT: `write!(f, "{:?}", x)` formats `x` with fresh options (`PLAIN`), as rustc_type_ir predicate.ts.

import { debug_ObligationCause } from "../../rustc_middle/traits/mod.ts";
import { with_ } from "../../rustc_middle/ty/context/tls.ts";
import { debug_ParamEnv } from "../../rustc_middle/ty/mod.ts";
import { debug_Predicate } from "../../rustc_middle/ty/predicate.ts";
import { debug_TypeError } from "../../rustc_type_ir/error.ts";
import { type Debug, debug_vec, type Fmt, PLAIN } from "../../std/fmt.ts";
import type { Obligation } from "./mod.ts";
import type { MismatchedProjectionTypes, Normalized } from "./project.ts";

// Structural impls for the structs in `traits`.

// rustc: compiler/rustc_infer/src/traits/structural_impls.rs:11 fmt
export function debug_Normalized<T>(v: Normalized<T>, _f: Fmt, debug_T: Debug<T>): string {
  return `Normalized(${debug_T(v.value, PLAIN)}, ${debug_vec(v.obligations, PLAIN, (o, f) => debug_Obligation(o, f, debug_Predicate))})`;
}

// rustc: compiler/rustc_infer/src/traits/structural_impls.rs:17 fmt
export function debug_Obligation<T>(v: Obligation<T>, _f: Fmt, debug_T: Debug<T>): string {
  if (with_((tcx) => tcx.sess.verbose_internals())) {
    return `Obligation(predicate=${debug_T(v.predicate, PLAIN)}, cause=${debug_ObligationCause(v.cause, PLAIN)}, param_env=${debug_ParamEnv(v.param_env, PLAIN)}, depth=${v.recursion_depth})`;
  } else {
    return `Obligation(predicate=${debug_T(v.predicate, PLAIN)}, depth=${v.recursion_depth})`;
  }
}

// rustc: compiler/rustc_infer/src/traits/structural_impls.rs:31 fmt
export const debug_MismatchedProjectionTypes: Debug<MismatchedProjectionTypes> = (v, _f) =>
  `MismatchedProjectionTypes(${debug_TypeError(v.err, PLAIN)})`;
