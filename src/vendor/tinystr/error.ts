// Port of tinystr 0.8.4 `src/error.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import { debug_struct, type Debug } from "../../std/fmt.ts";

// impl core::error::Error for ParseError {}

/// An error type for tinystr
// #[derive(Display, Debug, PartialEq, Eq)] #[non_exhaustive]
export type ParseError =
  /// found string of larger length {len} when constructing string of length {max}
  | { readonly $: "TooLong"; readonly max: number; readonly len: number }
  /// tinystr types do not support strings with null bytes
  | { readonly $: "ContainsNull" }
  /// attempted to construct TinyAsciiStr from a non-ASCII string
  | { readonly $: "NonAscii" };

export const ParseError = {
  ContainsNull: { $: "ContainsNull" } as ParseError,
  NonAscii: { $: "NonAscii" } as ParseError,
} as const;

/** `#[derive(displaydoc::Display)]` */
export function display_ParseError(self: ParseError): string {
  switch (self.$) {
    case "TooLong":
      return `found string of larger length ${self.len} when constructing string of length ${self.max}`;
    case "ContainsNull":
      return "tinystr types do not support strings with null bytes";
    case "NonAscii":
      return "attempted to construct TinyAsciiStr from a non-ASCII string";
  }
}

/** `#[derive(Debug)]` */
export const debug_ParseError: Debug<ParseError> = (v, f) => {
  switch (v.$) {
    case "TooLong":
      return debug_struct(f, "TooLong", [
        ["max", String(v.max)],
        ["len", String(v.len)],
      ]);
    case "ContainsNull":
    case "NonAscii":
      return v.$;
  }
};

/** `#[derive(PartialEq)]` */
export function ParseError_eq(a: ParseError, b: ParseError): boolean {
  if (a.$ === "TooLong" && b.$ === "TooLong") return a.max === b.max && a.len === b.len;
  return a.$ === b.$;
}
