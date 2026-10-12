// Port of unic-langid-impl 0.9.6 `src/errors.rs`.
import { debug_tuple, type Fmt } from "../../std/fmt.ts";
import { debug_ParserError, display_ParserError, type ParserError } from "./parser/errors.ts";

/// Enum with errors that can be returned by LanguageIdentifier.
// #[derive(Debug, PartialEq)]
export type LanguageIdentifierError =
  /// An unknown error - currently covers all-but parser errors.
  | { readonly $: "Unknown" }
  /// A parser error.
  | { readonly $: "ParserError"; readonly _0: ParserError };

export const LanguageIdentifierError = {
  Unknown: { $: "Unknown" } as LanguageIdentifierError,

  // crate: unic-langid-impl-0.9.6/src/errors.rs:15 from
  /** `impl From<ParserError> for LanguageIdentifierError` */
  from(error: ParserError): LanguageIdentifierError {
    return { $: "ParserError", _0: error };
  },
} as const;

// impl Error for LanguageIdentifierError {}

// crate: unic-langid-impl-0.9.6/src/errors.rs:23 fmt
/** `impl Display for LanguageIdentifierError` */
export function display_LanguageIdentifierError(self: LanguageIdentifierError): string {
  switch (self.$) {
    case "Unknown":
      return "Unknown error";
    case "ParserError":
      return `Parser error: ${display_ParserError(self._0)}`;
  }
}

/** `#[derive(Debug)]` */
export function debug_LanguageIdentifierError(self: LanguageIdentifierError, f: Fmt): string {
  switch (self.$) {
    case "Unknown":
      return "Unknown";
    case "ParserError":
      return debug_tuple(f, "ParserError", [debug_ParserError(self._0)]);
  }
}

/** `#[derive(PartialEq)]` */
export function LanguageIdentifierError_eq(a: LanguageIdentifierError, b: LanguageIdentifierError): boolean {
  if (a.$ === "ParserError" && b.$ === "ParserError") return a._0 === b._0;
  return a.$ === b.$;
}
