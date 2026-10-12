// Port of fluent-bundle 0.16.0, src/resolver/errors.rs.
import { debug_option, debug_str, debug_struct, debug_tuple, type Fmt } from "../../../std/fmt.ts";
import { unreachable } from "../../../std/panic.ts";
import type { InlineExpression } from "../../fluent_syntax/ast/mod.ts";

/// Maps an [`InlineExpression`] into the kind of reference, with owned strings
/// that identify the expression. This makes it so that the [`InlineExpression`] can
/// be used to generate an error string.
// #[derive(Clone, Debug, Eq, PartialEq)]
export type ReferenceKind =
  | { readonly $: "Function"; readonly id: string }
  | { readonly $: "Message"; readonly id: string; readonly attribute: string | undefined }
  | { readonly $: "Term"; readonly id: string; readonly attribute: string | undefined }
  | { readonly $: "Variable"; readonly id: string };

export const ReferenceKind = {
  /** `impl<T: ToString> From<&InlineExpression<T>> for ReferenceKind` */
  // crate: fluent-bundle-0.16.0/src/resolver/errors.rs:29 from
  from(exp: InlineExpression): ReferenceKind {
    switch (exp.$) {
      case "FunctionReference":
        return {
          $: "Function",
          id: exp.id.name.toString(),
        };
      case "MessageReference":
        return {
          $: "Message",
          id: exp.id.name.toString(),
          attribute: exp.attribute === undefined ? undefined : exp.attribute.name.toString(),
        };
      case "TermReference":
        return {
          $: "Term",
          id: exp.id.name.toString(),
          attribute: exp.attribute === undefined ? undefined : exp.attribute.name.toString(),
        };
      case "VariableReference":
        return {
          $: "Variable",
          id: exp.id.name.toString(),
        };
      default:
        return unreachable();
    }
  },
};

/** `#[derive(Debug)]` */
export function debug_ReferenceKind(v: ReferenceKind, f: Fmt): string {
  switch (v.$) {
    case "Function":
      return debug_struct(f, "Function", [["id", debug_str(v.id)]]);
    case "Message":
      return debug_struct(f, "Message", [
        ["id", debug_str(v.id)],
        ["attribute", debug_option(v.attribute, f, (s) => debug_str(s))],
      ]);
    case "Term":
      return debug_struct(f, "Term", [
        ["id", debug_str(v.id)],
        ["attribute", debug_option(v.attribute, f, (s) => debug_str(s))],
      ]);
    case "Variable":
      return debug_struct(f, "Variable", [["id", debug_str(v.id)]]);
  }
}

/** `#[derive(PartialEq)]` */
export function ReferenceKind_eq(a: ReferenceKind, b: ReferenceKind): boolean {
  if (a.$ !== b.$ || a.id !== b.id) return false;
  if ((a.$ === "Message" || a.$ === "Term") && (b.$ === "Message" || b.$ === "Term")) return a.attribute === b.attribute;
  return true;
}

/// Errors generated during the process of resolving a fluent message into a string.
/// This process takes place in the `write` method of the `WriteValue` trait.
// #[derive(Clone, Debug, Eq, PartialEq)]
export type ResolverError =
  | { readonly $: "Reference"; readonly _0: ReferenceKind }
  | { readonly $: "NoValue"; readonly _0: string }
  | { readonly $: "MissingDefault" }
  | { readonly $: "Cyclic" }
  | { readonly $: "TooManyPlaceables" };

export const ResolverError = {
  MissingDefault: Object.freeze({ $: "MissingDefault" }) as ResolverError,
  Cyclic: Object.freeze({ $: "Cyclic" }) as ResolverError,
  TooManyPlaceables: Object.freeze({ $: "TooManyPlaceables" }) as ResolverError,

  /** `impl std::fmt::Display for ResolverError` */
  // crate: fluent-bundle-0.16.0/src/resolver/errors.rs:62 fmt
  fmt(self: ResolverError): string {
    switch (self.$) {
      case "Reference": {
        const exp = self._0;
        switch (exp.$) {
          case "Function":
            return `Unknown function: ${exp.id}()`;
          case "Message":
            if (exp.attribute === undefined) {
              return `Unknown message: ${exp.id}`;
            } else {
              return `Unknown attribute: ${exp.id}.${exp.attribute}`;
            }
          case "Term":
            if (exp.attribute === undefined) {
              return `Unknown term: -${exp.id}`;
            } else {
              return `Unknown attribute: -${exp.id}.${exp.attribute}`;
            }
          case "Variable":
            return `Unknown variable: $${exp.id}`;
        }
      }
      case "NoValue":
        return `No value: ${self._0}`;
      case "MissingDefault":
        return "No default";
      case "Cyclic":
        return "Cyclical dependency detected";
      case "TooManyPlaceables":
        return "Too many placeables";
    }
  },

  /** `impl<T: ToString> From<&InlineExpression<T>> for ResolverError` */
  // crate: fluent-bundle-0.16.0/src/resolver/errors.rs:96 from
  from(exp: InlineExpression): ResolverError {
    return { $: "Reference", _0: ReferenceKind.from(exp) };
  },
};

/** `impl Display for ResolverError` (`to_string()`). */
export const display_ResolverError = (v: ResolverError): string => ResolverError.fmt(v);

/** `#[derive(Debug)]` */
export function debug_ResolverError(v: ResolverError, f: Fmt): string {
  switch (v.$) {
    case "Reference":
      return debug_tuple(f, "Reference", [debug_ReferenceKind(v._0, f)]);
    case "NoValue":
      return debug_tuple(f, "NoValue", [debug_str(v._0)]);
    case "MissingDefault":
    case "Cyclic":
    case "TooManyPlaceables":
      return v.$;
  }
}

/** `#[derive(PartialEq)]` */
export function ResolverError_eq(a: ResolverError, b: ResolverError): boolean {
  if (a.$ !== b.$) return false;
  if (a.$ === "Reference") return ReferenceKind_eq(a._0, (b as typeof a)._0);
  if (a.$ === "NoValue") return a._0 === (b as typeof a)._0;
  return true;
}

// impl Error for ResolverError {}
