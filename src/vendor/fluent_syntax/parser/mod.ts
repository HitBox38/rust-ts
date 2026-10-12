//! Fluent Translation List parsing utilities
//!
//! FTL resources can be parsed using one of two methods:
//! * [`parse`] - parses an input into a complete Abstract Syntax Tree representation with all source information preserved.
//! * [`parse_runtime`] - parses an input into a runtime optimized Abstract Syntax Tree
//!   representation with comments stripped.
//!
//! # Example
//!
//! ```
//! use fluent_syntax::parser;
//! use fluent_syntax::ast;
//!
//! let ftl = r#"
//! #### Resource Level Comment
//!
//! ## This is a message comment
//! hello-world = Hello World!
//!
//! "#;
//!
//! let resource = parser::parse(ftl)
//!     .expect("Failed to parse an FTL resource.");
//!
//! assert_eq!(
//!     resource.body[0],
//!     ast::Entry::ResourceComment(
//!         ast::Comment {
//!             content: vec![
//!                 "Resource Level Comment"
//!             ]
//!         }
//!     )
//! );
//! assert_eq!(
//!     resource.body[1],
//!     ast::Entry::Message(
//!         ast::Message {
//!             id: ast::Identifier {
//!                 name: "hello-world"
//!             },
//!             value: Some(ast::Pattern {
//!                 elements: vec![
//!                     ast::PatternElement::TextElement {
//!                         value: "Hello World!"
//!                     },
//!                 ]
//!             }),
//!             attributes: vec![],
//!             comment: Some(
//!                 ast::Comment {
//!                     content: vec!["This is a message comment"]
//!                 }
//!             )
//!         }
//!     ),
//! );
//! ```
//!
//! # Error Recovery
//!
//! In both modes the parser is lenient, attempting to recover from errors.
//!
//! The [`Result`] return the resulting AST in both scenarios, and in the
//! error scenario a vector of [`ParserError`] elements is returned as well.
//!
//! Any unparsed parts of the input are returned as [`ast::Entry::Junk`] elements.
//
// Port of fluent-syntax-0.12.0/src/parser/mod.rs.
// PORT: `mod x;` → imports. `core.ts` defines `Parser`; comment/expression/helper/pattern/runtime add
// its methods and are imported here (after core) for their side effects, so importing this module
// yields a complete parser. `S` is `Str` (`&str`): pass `Str.from(text)`.

import { debug_list, debug_tuple, type Debug } from "../../../std/fmt.ts";
import { debug_result, type Result as StdResult } from "../../../std/result.ts";
import type { Str } from "../../../std/str.ts";
import { debug_Resource, type Resource } from "../ast/mod.ts";
import { debug_ParserError, type ParserError } from "./errors.ts";
import "./macros.ts";
import "./comment.ts";
import { Parser } from "./core.ts";
import "./expression.ts";
import "./helper.ts";
import "./pattern.ts";
import "./runtime.ts";
import "./slice.ts";

export { debug_ErrorKind, debug_ParserError, display_ErrorKind, display_ParserError, ErrorKind, type ParserError } from "./errors.ts";
export { matches_fluent_ws } from "./slice.ts";
export { Slice_str, Slice_String, type Slice } from "./slice.ts";

/// Parser result always returns an AST representation of the input,
/// and if parsing errors were encountered, a list of [`ParserError`] elements
/// is also returned.
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
export type Result = StdResult<Resource, [Resource, ParserError[]]>;

/** PORT: `{:?}`/`{:#?}` of `parser::Result<&str>`: `Ok(Resource { .. })` / `Err((Resource { .. }, [ParserError { .. }, ..]))`. */
export const debug_Result: Debug<Result> = (v, f) =>
  debug_result(v, f, debug_Resource, (e, f) =>
    debug_tuple(f, "", [
      debug_Resource(e[0], f),
      debug_list(
        f,
        e[1].map((x) => debug_ParserError(x, f)),
      ),
    ]),
  );

/// Parses an input into a complete Abstract Syntax Tree representation with
/// all source information preserved.
///
/// This mode is intended for tooling, linters and other scenarios where
/// complete representation, with comments, is preferred over speed and memory
/// utilization.
///
/// # Example
///
/// ```
/// use fluent_syntax::parser;
/// use fluent_syntax::ast;
///
/// let ftl = r#"
/// #### Resource Level Comment
///
/// ## This is a message comment
/// hello-world = Hello World!
///
/// "#;
///
/// let resource = parser::parse(ftl)
///     .expect("Failed to parse an FTL resource.");
///
/// assert_eq!(
///     resource.body[0],
///     ast::Entry::ResourceComment(
///         ast::Comment {
///             content: vec![
///                 "Resource Level Comment"
///             ]
///         }
///     )
/// );
/// assert_eq!(
///     resource.body[1],
///     ast::Entry::Message(
///         ast::Message {
///             id: ast::Identifier {
///                 name: "hello-world"
///             },
///             value: Some(ast::Pattern {
///                 elements: vec![
///                     ast::PatternElement::TextElement {
///                         value: "Hello World!"
///                     },
///                 ]
///             }),
///             attributes: vec![],
///             comment: Some(
///                 ast::Comment {
///                     content: vec!["This is a message comment"]
///                 }
///             )
///         }
///     ),
/// );
/// ```
// crate: fluent-syntax-0.12.0/src/parser/mod.rs:225 parse
export function parse(input: Str): Result {
  return Parser.new(input).parse();
}

/// Parses an input into an Abstract Syntax Tree representation with comments stripped.
///
/// This mode is intended for runtime use of Fluent. It currently strips all
/// comments improving parsing performance and reducing the size of the AST tree.
///
/// # Example
///
/// ```
/// use fluent_syntax::parser;
/// use fluent_syntax::ast;
///
/// let ftl = r#"
/// #### Resource Level Comment
///
/// ## This is a message comment
/// hello-world = Hello World!
///
/// "#;
///
/// let resource = parser::parse_runtime(ftl)
///     .expect("Failed to parse an FTL resource.");
///
/// assert_eq!(
///     resource.body[0],
///     ast::Entry::Message(
///         ast::Message {
///             id: ast::Identifier {
///                 name: "hello-world"
///             },
///             value: Some(ast::Pattern {
///                 elements: vec![
///                     ast::PatternElement::TextElement {
///                         value: "Hello World!"
///                     },
///                 ]
///             }),
///             attributes: vec![],
///             comment: None,
///         }
///     ),
/// );
/// ```
// crate: fluent-syntax-0.12.0/src/parser/mod.rs:274 parse_runtime
export function parse_runtime(input: Str): Result {
  return Parser.new(input).parse_runtime();
}
