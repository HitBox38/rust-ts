// Port of compiler/rustc_middle/src/mir/query.rs (lane mir-contract, plan-m4 D3): every type of the file (coroutine
// layouts, `ConstQualifs`, `ConstraintCategory`, ...) is generated with its derived impls into query.gen.ts (set
// rustc_middle_mir); the file's one fn (the manual `Debug` of `CoroutineLayout`) is ported below (lane mir-body-a).
//! Values computed by queries that use MIR.
import "./mod.ts";
import { debug_BitMatrix } from "../../rustc_index/bit_set.ts";
import { type Debug, debug_map, debug_struct, debug_vec, PLAIN } from "../../std/fmt.ts";
import type { VariantIdx } from "../ty/decls.ts";
import { type CoroutineLayout, debug_CoroutineSavedLocal, debug_CoroutineSavedTy, type CoroutineSavedLocal } from "./query.gen.ts";
export * from "./query.gen.ts";

// impl Debug for CoroutineLayout<'_>
// rustc: compiler/rustc_middle/src/mir/query.rs:59 fmt
export const debug_CoroutineLayout: Debug<CoroutineLayout> = (self, fmt) => {
  return debug_struct(fmt, "CoroutineLayout", [
    ["field_tys", debug_map(fmt, self.field_tys.map((v, i): [string, string] => [debug_CoroutineSavedLocal(i as CoroutineSavedLocal, fmt), debug_CoroutineSavedTy(v, fmt)]))],
    [
      "variant_fields",
      (() => {
        const map: [string, string][] = [];
        for (let i = 0; i < self.variant_fields.length; i++) {
          const idx = i as VariantIdx;
          const fields = self.variant_fields[i]!;
          // PORT: `write!(fmt, ..)` formats its arguments with fresh flags; `{variant_name:9}` pads to 9 chars (left
          // aligned, a `str`), `{idx:?}` is `VariantIdx`'s plain Debug (its index).
          let key: string;
          const variant_name = sty().CoroutineArgsExt.variant_name(idx);
          if (fmt.alternate) {
            key = `${variant_name.padEnd(9)}(${idx})`;
          } else {
            key = `${variant_name}`;
          }
          // Force variant fields to print in regular mode instead of alternate mode.
          map.push([key, debug_vec(fields, PLAIN, debug_CoroutineSavedLocal)]);
        }
        return debug_map(fmt, map);
      })(),
    ],
    ["storage_conflicts", debug_BitMatrix(self.storage_conflicts, fmt)],
  ]);
};

/** ty/sty.ts (`CoroutineArgs::variant_name`), read lazily (init order R2: mir/ is in ty/context.ts's import closure). */
function sty(): typeof import("../ty/sty.ts") {
  return (sty__m ??= require("../ty/sty.ts") as typeof import("../ty/sty.ts"));
}
var sty__m: typeof import("../ty/sty.ts") | undefined;
