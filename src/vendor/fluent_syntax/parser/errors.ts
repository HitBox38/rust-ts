// Port of fluent-syntax-0.12.0/src/parser/errors.rs.
//
// PORT: `std::ops::Range<usize>` → the local `Range` interface (`{ start, end }`, Debug `start..end`);
// no shared std Range exists yet. `thiserror`'s `#[derive(Error)]` + `#[error("...")]` → hand-written
// `display_ParserError` / `display_ErrorKind` producing exactly the `#[error]` strings. `String`
// payloads hold no byte offsets, so they are JS `string`s; `char` is a number.

import { debug_char, debug_int, debug_option, debug_str, debug_struct, debug_tuple, type Debug } from "../../../std/fmt.ts";
import { Err } from "../../../std/result.ts";

/** PORT: `std::ops::Range<usize>`. */
export interface Range {
  start: number;
  end: number;
}

/** `<Range<usize> as Debug>::fmt`: `start..end` (the formatter is forwarded to both bounds). */
export const debug_Range: Debug<Range> = (v, f) => debug_int(v.start, f) + ".." + debug_int(v.end, f);

/// Error containing information about an error encountered by the Fluent Parser.
///
/// Errors in Fluent Parser are non-fatal, and the syntax has been
/// designed to allow for strong recovery.
///
/// In result [`ParserError`] is designed to point at the slice of
/// the input that is most likely to be a complete fragment from after
/// the end of a valid entry, to the start of the next valid entry, with
/// the invalid syntax in the middle.
///
///
/// # Example
///
/// ```
/// use fluent_syntax::parser;
/// use fluent_syntax::ast;
///
/// let ftl = r#"
/// key1 = Value 1
///
/// g@Rb@ge = #2y ds
///
/// key2 = Value 2
///
/// "#;
///
/// let (resource, errors) = parser::parse_runtime(ftl)
///     .expect_err("Resource should contain errors.");
///
/// assert_eq!(
///     errors,
///     vec![
///         parser::ParserError {
///             pos: 18..19,
///             slice: Some(17..35),
///             kind: parser::ErrorKind::ExpectedToken('=')
///         }
///     ]
/// );
///
/// assert_eq!(
///     resource.body[0],
///     ast::Entry::Message(
///         ast::Message {
///             id: ast::Identifier {
///                 name: "key1"
///             },
///             value: Some(ast::Pattern {
///                 elements: vec![
///                     ast::PatternElement::TextElement {
///                         value: "Value 1"
///                     },
///                 ]
///             }),
///             attributes: vec![],
///             comment: None,
///         }
///     ),
/// );
///
/// assert_eq!(
///     resource.body[1],
///     ast::Entry::Junk {
///         content: "g@Rb@ge = #2y ds\n\n"
///     }
/// );
///
/// assert_eq!(
///     resource.body[2],
///     ast::Entry::Message(
///         ast::Message {
///             id: ast::Identifier {
///                 name: "key2"
///             },
///             value: Some(ast::Pattern {
///                 elements: vec![
///                     ast::PatternElement::TextElement {
///                         value: "Value 2"
///                     },
///                 ]
///             }),
///             attributes: vec![],
///             comment: None,
///         }
///     ),
/// );
/// ```
///
/// The information contained in the `ParserError` should allow the tooling
/// to display rich contextual annotations of the error slice, using
/// crates such as `annotate-snippers`.
export interface ParserError {
  /// Precise location of where the parser encountered the error.
  pos: Range;
  /// Slice of the input from the end of the last valid entry to the beginning
  /// of the next valid entry with the invalid syntax in the middle.
  slice: Range | undefined;
  /// The type of the error that the parser encountered.
  kind: ErrorKind;
}

export const debug_ParserError: Debug<ParserError> = (v, f) =>
  debug_struct(f, "ParserError", [
    ["pos", debug_Range(v.pos, f)],
    ["slice", debug_option(v.slice, f, debug_Range)],
    ["kind", debug_ErrorKind(v.kind, f)],
  ]);

/** `#[error("{}", self.kind)]` */
export function display_ParserError(v: ParserError): string {
  return display_ErrorKind(v.kind);
}

/**
 * PORT: `macro_rules! error` → a function. `error(kind, start)` is the `($kind, $start)` arm
 * (`pos: start..start + 1`), `error(kind, start, end)` the `($kind, $start, $end)` arm.
 */
export function error(kind: ErrorKind, start: number, end?: number): { readonly $: "Err"; readonly _0: ParserError } {
  if (end === undefined) {
    return Err({
      pos: { start, end: start + 1 },
      slice: undefined,
      kind: kind,
    });
  }
  return Err({
    pos: { start, end },
    slice: undefined,
    kind: kind,
  });
}

/// Kind of an error associated with the [`ParserError`].
export type ErrorKind =
  | { $: "ExpectedToken"; _0: number }
  | { $: "ExpectedCharRange"; range: string }
  | { $: "ExpectedMessageField"; entry_id: string }
  | { $: "ExpectedTermField"; entry_id: string }
  | { $: "ForbiddenCallee" }
  | { $: "MissingDefaultVariant" }
  | { $: "MissingValue" }
  | { $: "MultipleDefaultVariants" }
  | { $: "MessageReferenceAsSelector" }
  | { $: "TermReferenceAsSelector" }
  | { $: "MessageAttributeAsSelector" }
  | { $: "TermAttributeAsPlaceable" }
  | { $: "UnterminatedStringLiteral" }
  | { $: "PositionalArgumentFollowsNamed" }
  | { $: "DuplicatedNamedArgument"; _0: string }
  | { $: "UnknownEscapeSequence"; _0: string }
  | { $: "InvalidUnicodeEscapeSequence"; _0: string }
  | { $: "UnbalancedClosingBrace" }
  | { $: "ExpectedInlineExpression" }
  | { $: "ExpectedSimpleExpressionAsSelector" }
  | { $: "ExpectedLiteral" };

export const ErrorKind = {
  ForbiddenCallee: Object.freeze({ $: "ForbiddenCallee" as const }),
  MissingDefaultVariant: Object.freeze({ $: "MissingDefaultVariant" as const }),
  MissingValue: Object.freeze({ $: "MissingValue" as const }),
  MultipleDefaultVariants: Object.freeze({ $: "MultipleDefaultVariants" as const }),
  MessageReferenceAsSelector: Object.freeze({ $: "MessageReferenceAsSelector" as const }),
  TermReferenceAsSelector: Object.freeze({ $: "TermReferenceAsSelector" as const }),
  MessageAttributeAsSelector: Object.freeze({ $: "MessageAttributeAsSelector" as const }),
  TermAttributeAsPlaceable: Object.freeze({ $: "TermAttributeAsPlaceable" as const }),
  UnterminatedStringLiteral: Object.freeze({ $: "UnterminatedStringLiteral" as const }),
  PositionalArgumentFollowsNamed: Object.freeze({ $: "PositionalArgumentFollowsNamed" as const }),
  UnbalancedClosingBrace: Object.freeze({ $: "UnbalancedClosingBrace" as const }),
  ExpectedInlineExpression: Object.freeze({ $: "ExpectedInlineExpression" as const }),
  ExpectedSimpleExpressionAsSelector: Object.freeze({ $: "ExpectedSimpleExpressionAsSelector" as const }),
  ExpectedLiteral: Object.freeze({ $: "ExpectedLiteral" as const }),
} as const;

export const debug_ErrorKind: Debug<ErrorKind> = (v, f) => {
  switch (v.$) {
    case "ExpectedToken":
      return debug_tuple(f, "ExpectedToken", [debug_char(v._0)]);
    case "ExpectedCharRange":
      return debug_struct(f, "ExpectedCharRange", [["range", debug_str(v.range)]]);
    case "ExpectedMessageField":
      return debug_struct(f, "ExpectedMessageField", [["entry_id", debug_str(v.entry_id)]]);
    case "ExpectedTermField":
      return debug_struct(f, "ExpectedTermField", [["entry_id", debug_str(v.entry_id)]]);
    case "DuplicatedNamedArgument":
    case "UnknownEscapeSequence":
    case "InvalidUnicodeEscapeSequence":
      return debug_tuple(f, v.$, [debug_str(v._0)]);
    default:
      return v.$;
  }
};

/** The `#[error("...")]` strings of `ErrorKind` (thiserror `Display`). */
export function display_ErrorKind(v: ErrorKind): string {
  switch (v.$) {
    case "ExpectedToken":
      return `Expected a token starting with "${String.fromCodePoint(v._0)}"`;
    case "ExpectedCharRange":
      return `Expected one of "${v.range}"`;
    case "ExpectedMessageField":
      return `Expected a message field for "${v.entry_id}"`;
    case "ExpectedTermField":
      return `Expected a term field for "${v.entry_id}"`;
    case "ForbiddenCallee":
      return "Callee is not allowed here";
    case "MissingDefaultVariant":
      return "The select expression must have a default variant";
    case "MissingValue":
      return "Expected a value";
    case "MultipleDefaultVariants":
      return "A select expression can only have one default variant";
    case "MessageReferenceAsSelector":
      return "Message references can't be used as a selector";
    case "TermReferenceAsSelector":
      return "Term references can't be used as a selector";
    case "MessageAttributeAsSelector":
      return "Message attributes can't be used as a selector";
    case "TermAttributeAsPlaceable":
      return "Term attributes can't be used as a selector";
    case "UnterminatedStringLiteral":
      return "Unterminated string literal";
    case "PositionalArgumentFollowsNamed":
      return "Positional arguments must come before named arguments";
    case "DuplicatedNamedArgument":
      return `The "${v._0}" argument appears twice`;
    case "UnknownEscapeSequence":
      return "Unknown escape sequence";
    case "InvalidUnicodeEscapeSequence":
      return `Invalid unicode escape sequence, "${v._0}"`;
    case "UnbalancedClosingBrace":
      return "Unbalanced closing brace";
    case "ExpectedInlineExpression":
      return "Expected an inline expression";
    case "ExpectedSimpleExpressionAsSelector":
      return "Expected a simple expression as selector";
    case "ExpectedLiteral":
      return "Expected a string or number literal";
  }
}
