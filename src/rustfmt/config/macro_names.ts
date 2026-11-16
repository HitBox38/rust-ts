// Port of src/tools/rustfmt/src/config/macro_names.rs (lane rustfmt-contract-1).
//! This module contains types and functions to support formatting specific macros.
// The types and their derives (Debug, Clone, serde) are generated into macro_names.gen.ts (tools/codegen/rustfmt.ts); the
// manual impls are here: inherent and `From` fns on the classes (`declare module` + `Object.assign`), `FromStr` on the companion
// consts (PORTING §8), `Display` as `display_<T>`.
import * as gen from "./macro_names.gen.ts";
import { MacroName } from "./macro_names.gen.ts";
import { type Debug, debug_tuple } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import { Err, Ok, type Result, expect_result } from "../../std/result.ts";
import { deserialize_String } from "../../vendor/serde_core/de/impls.ts";
import type { Deserializer } from "../../vendor/serde_core/de/mod.ts";

export * from "./macro_names.gen.ts";

declare module "./macro_names.gen.ts" {
  namespace MacroName {
    function new_(other: string): MacroName;
    export { new_ as new };
  }
}

Object.assign(MacroName, {
  // rustc: src/tools/rustfmt/src/config/macro_names.rs:15 new
  new(other: string): MacroName {
    return new MacroName(other);
  },
});

// rustc: src/tools/rustfmt/src/config/macro_names.rs:21 fmt
export function display_MacroName(self: MacroName): string {
  return self._0;
}

// `impl From<MacroName> for String`
// rustc: src/tools/rustfmt/src/config/macro_names.rs:27 from
export function String_from_MacroName(other: MacroName): string {
  return other._0;
}

/** `#[derive(PartialEq)]` of `MacroName` (used by `MacroSelectors_eq`). */
export function MacroName_eq(self: MacroName, other: MacroName): boolean {
  return self._0 === other._0;
}

/// Defines a selector to match against a macro.
export type MacroSelector = gen.MacroSelector;
export const MacroSelector = {
  ...gen.MacroSelector,

  // `impl str::FromStr for MacroSelector` (`type Err = std::convert::Infallible`)
  // rustc: src/tools/rustfmt/src/config/macro_names.rs:61 from_str
  from_str(s: string): Result<MacroSelector, never> {
    return Ok(s === "*" ? MacroSelector.All : { $: "Name", _0: new MacroName(s) });
  },
};

// rustc: src/tools/rustfmt/src/config/macro_names.rs:40 deserialize
export function deserialize_MacroSelector<E>(de: Deserializer<E>): Result<MacroSelector, E> {
  const s = deserialize_String(de);
  if (s.$ === "Err") return s;
  // PORT: `.map_err(serde::de::Error::custom)` of an `Infallible` error never applies.
  return MacroSelector.from_str(s._0);
}

// rustc: src/tools/rustfmt/src/config/macro_names.rs:50 fmt
export function display_MacroSelector(self: MacroSelector): string {
  switch (self.$) {
    case "Name":
      return display_MacroName(self._0);
    case "All":
      return "*";
  }
}

/** `#[derive(PartialEq)]` of `MacroSelector` (used by `MacroSelectors_eq`). */
export function MacroSelector_eq(self: MacroSelector, other: MacroSelector): boolean {
  if (self.$ !== other.$) return false;
  if (self.$ === "Name" && other.$ === "Name") return MacroName_eq(self._0, other._0);
  return true;
}

/// A set of macro selectors.
export type MacroSelectors = gen.MacroSelectors;

// rustc: src/tools/rustfmt/src/config/macro_names.rs:74 fmt
export function display_MacroSelectors(self: MacroSelectors): string {
  // `self.0.iter().format(", ")` (itertools): each item's Display, joined.
  return self._0.map(display_MacroSelector).join(", ");
}

/** `#[derive(PartialEq)]` of `MacroSelectors`. */
export function MacroSelectors_eq(self: MacroSelectors, other: MacroSelectors): boolean {
  return self._0.length === other._0.length && self._0.every((s, i) => MacroSelector_eq(s, other._0[i]!));
}

/** `serde_json::Error`: not ported until the serde_json lane (plan-m8 D6: "only what `--emit json` and `file_lines` reach"). */
export type JsonError = { readonly __serde_json_Error: never };

/** `#[derive(Error, Debug)] pub enum MacroSelectorsError { #[error("{0}")] Json(json::Error) }` */
export type MacroSelectorsError = { readonly $: "Json"; _0: JsonError };
export const debug_MacroSelectorsError: Debug<MacroSelectorsError> = (v, f) =>
  debug_tuple(f, "Json", [unported("vendor-serde_json: Debug for serde_json::Error")]);
export function display_MacroSelectorsError(_v: MacroSelectorsError): string {
  return unported("vendor-serde_json: Display for serde_json::Error");
}

/** `serde_json::from_str::<Vec<&str>>` (serde_json is not ported yet). */
function json_from_str_Vec_str(_s: string): Result<string[], JsonError> {
  return unported("vendor-serde_json: serde_json::from_str (MacroSelectors::from_str)");
}

// This impl is needed for `Config::override_value` to work for use in tests.
export const MacroSelectors = {
  // `impl str::FromStr for MacroSelectors`
  // rustc: src/tools/rustfmt/src/config/macro_names.rs:89 from_str
  from_str(s: string): Result<MacroSelectors, MacroSelectorsError> {
    const raw_r = json_from_str_Vec_str(s);
    if (raw_r.$ === "Err") return Err({ $: "Json", _0: raw_r._0 });
    const raw: string[] = raw_r._0;
    return Ok({
      _0: raw.map((raw) => expect_result(MacroSelector.from_str(raw), "MacroSelector from_str is infallible", (e: never) => e)),
    });
  },
};
