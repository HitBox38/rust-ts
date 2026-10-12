// Port of fluent-bundle 0.16.0, src/errors.rs.
import { debug_str, debug_struct, debug_tuple, type Fmt } from "../../std/fmt.ts";
import { debug_ParserError, display_ParserError, type ParserError } from "../fluent_syntax/parser/mod.ts";
import { debug_ResolverError, display_ResolverError, ResolverError_eq, type ResolverError } from "./resolver/errors.ts";

// #[derive(Clone, Debug, Eq, PartialEq)]
export type EntryKind = "Message" | "Term" | "Function";
export const EntryKind = { Message: "Message", Term: "Term", Function: "Function" } as const;

/** `#[derive(Debug)]` */
export function debug_EntryKind(v: EntryKind, _f: Fmt): string {
  return v;
}

/** `impl std::fmt::Display for EntryKind` */
// crate: fluent-bundle-0.16.0/src/errors.rs:13 fmt
export function display_EntryKind(self: EntryKind): string {
  switch (self) {
    case "Message":
      return "message";
    case "Term":
      return "term";
    case "Function":
      return "function";
  }
}

/// Core error type for Fluent runtime system.
///
/// It contains three main types of errors that may come up
/// during runtime use of the fluent-bundle crate.
// #[derive(Clone, Debug, Eq, PartialEq)]
export type FluentError =
  /// An error which occurs when
  /// [`FluentBundle::add_resource`](crate::bundle::FluentBundle::add_resource)
  /// adds entries that are already registered in a given [`FluentBundle`](crate::FluentBundle).
  ///
  /// # Example
  ///
  /// ```
  /// use fluent_bundle::{FluentBundle, FluentResource};
  /// use unic_langid::langid;
  ///
  /// let ftl_string = String::from("intro = Welcome, { $name }.");
  /// let res1 = FluentResource::try_new(ftl_string)
  ///     .expect("Could not parse an FTL string.");
  ///
  /// let ftl_string = String::from("intro = Hi, { $name }.");
  /// let res2 = FluentResource::try_new(ftl_string)
  ///     .expect("Could not parse an FTL string.");
  ///
  /// let langid_en = langid!("en-US");
  /// let mut bundle = FluentBundle::new(vec![langid_en]);
  ///
  /// bundle.add_resource(&res1)
  ///     .expect("Failed to add FTL resources to the bundle.");
  ///
  /// assert!(bundle.add_resource(&res2).is_err());
  /// ```
  | { readonly $: "Overriding"; readonly kind: EntryKind; readonly id: string }
  | { readonly $: "ParserError"; readonly _0: ParserError }
  | { readonly $: "ResolverError"; readonly _0: ResolverError };

export const FluentError = {
  /** `impl std::fmt::Display for FluentError` */
  // crate: fluent-bundle-0.16.0/src/errors.rs:63 fmt
  fmt(self: FluentError): string {
    switch (self.$) {
      case "Overriding": {
        const { kind, id } = self;
        return `Attempt to override an existing ${display_EntryKind(kind)}: "${id}".`;
      }
      case "ParserError":
        return `Parser error: ${display_ParserError(self._0)}`;
      case "ResolverError":
        return `Resolver error: ${display_ResolverError(self._0)}`;
    }
  },

  /** `impl From<ResolverError> for FluentError` */
  // crate: fluent-bundle-0.16.0/src/errors.rs:77 from
  from_ResolverError(error: ResolverError): FluentError {
    return { $: "ResolverError", _0: error };
  },

  /** `impl From<ParserError> for FluentError` */
  // crate: fluent-bundle-0.16.0/src/errors.rs:83 from
  from_ParserError(error: ParserError): FluentError {
    return { $: "ParserError", _0: error };
  },
};

/** `impl Display for FluentError` (`to_string()`). */
export const display_FluentError = (v: FluentError): string => FluentError.fmt(v);

/** `#[derive(Debug)]` */
export function debug_FluentError(v: FluentError, f: Fmt): string {
  switch (v.$) {
    case "Overriding":
      return debug_struct(f, "Overriding", [
        ["kind", debug_EntryKind(v.kind, f)],
        ["id", debug_str(v.id)],
      ]);
    case "ParserError":
      return debug_tuple(f, "ParserError", [debug_ParserError(v._0, f)]);
    case "ResolverError":
      return debug_tuple(f, "ResolverError", [debug_ResolverError(v._0, f)]);
  }
}

/** `#[derive(PartialEq)]` */
export function FluentError_eq(a: FluentError, b: FluentError): boolean {
  switch (a.$) {
    case "Overriding":
      return b.$ === "Overriding" && a.kind === b.kind && a.id === b.id;
    case "ParserError":
      // PORT: `ParserError`'s derived `PartialEq`, via its derived Debug (injective over its fields).
      return b.$ === "ParserError" && debug_ParserError(a._0, { alternate: false }) === debug_ParserError(b._0, { alternate: false });
    case "ResolverError":
      return b.$ === "ResolverError" && ResolverError_eq(a._0, b._0);
  }
}

// impl Error for FluentError {}
