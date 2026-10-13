// Port of compiler/rustc_structures/src/limit.rs
// The type is generated into limit.gen.ts (class `Limit { _0 }`); methods are attached below.
import type { DiagArgValue } from "../rustc_error_messages/lib.ts";
import { number_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import type { MutRef } from "../std/mut_ref.ts";
import * as gen from "./limit.gen.ts";

export * from "./limit.gen.ts";

/// New-type wrapper around `usize` for representing limits. Ensures that comparisons against
/// limits are consistent throughout the compiler.
// PORT: `usize::MAX` (the unlimited limit) is `Number.MAX_SAFE_INTEGER`, the convention used for
// usize::MAX sentinels elsewhere (source_map.ts, edit_distance.ts); Display / IntoDiagArg print it
// as the real `usize::MAX` (x86_64).
const USIZE_MAX = Number.MAX_SAFE_INTEGER;
const USIZE_MAX_STR = "18446744073709551615";

declare module "./limit.gen.ts" {
  interface Limit {
    value_within_limit(value: number): boolean;
  }
}

export type Limit = gen.Limit;
export const Limit = gen.Limit as typeof gen.Limit & {
  "new": (value: number) => Limit;
  unlimited: () => Limit;
};

/// Create a new limit from a `usize`.
// rustc: compiler/rustc_structures/src/limit.rs:15 new
Limit.new = function (value: number): Limit {
  return new gen.Limit(value);
};

/// Create a new unlimited limit.
// rustc: compiler/rustc_structures/src/limit.rs:20 unlimited
Limit.unlimited = function (): Limit {
  return new gen.Limit(USIZE_MAX);
};

/// Check that `value` is within the limit. Ensures that the same comparisons are used
/// throughout the compiler, as mismatches can cause ICEs, see #72540.
// rustc: compiler/rustc_structures/src/limit.rs:27 value_within_limit
gen.Limit.prototype.value_within_limit = function (this: Limit, value: number): boolean {
  return value <= this._0;
};

// rustc: compiler/rustc_structures/src/limit.rs:33 from
export function Limit_from_usize(value: number): Limit {
  return Limit.new(value);
}

// rustc: compiler/rustc_structures/src/limit.rs:39 fmt
export function display_Limit(v: Limit): string {
  return v._0 === USIZE_MAX ? USIZE_MAX_STR : String(v._0);
}

// rustc: compiler/rustc_structures/src/limit.rs:47 div
export function Limit_div(self: Limit, rhs: number): Limit {
  // `usize / usize` truncates
  return Limit.new(Math.floor(self._0 / rhs));
}

// rustc: compiler/rustc_structures/src/limit.rs:55 mul
export function Limit_mul(self: Limit, rhs: number): Limit {
  return Limit.new(self._0 * rhs);
}

// rustc: compiler/rustc_structures/src/limit.rs:62 into_diag_arg
export function Limit_into_diag_arg(self: Limit, _: MutRef<string | undefined>): DiagArgValue {
  return number_into_diag_arg(self._0 === USIZE_MAX ? 18446744073709551615n : self._0, { value: undefined });
}
