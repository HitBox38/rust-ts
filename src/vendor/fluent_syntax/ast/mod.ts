// Port of fluent-syntax-0.12.0/src/ast/mod.rs (types and derived Debug; the file has no fns).
//! Abstract Syntax Tree representation of the Fluent Translation List.
//!
//! The AST of Fluent contains all nodes structures to represent a complete
//! representation of the FTL resource.
//!
//! The tree preserves all semantic information and allow for round-trip
//! of a canonically written FTL resource.
//!
//! The root node is called [`Resource`] and contains a list of [`Entry`] nodes
//! representing all possible entries in the Fluent Translation List.
//!
//! # Example
//!
//! ```
//! use fluent_syntax::parser;
//! use fluent_syntax::ast;
//!
//! let ftl = r#"
//!
//! ## This is a message comment
//! hello-world = Hello World!
//!     .tooltip = Tooltip for you, { $userName }.
//!
//! "#;
//!
//! let resource = parser::parse(ftl)
//!     .expect("Failed to parse an FTL resource.");
//!
//! assert_eq!(
//!     resource.body[0],
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
//!             attributes: vec![
//!                 ast::Attribute {
//!                     id: ast::Identifier {
//!                         name: "tooltip"
//!                     },
//!                     value: ast::Pattern {
//!                         elements: vec![
//!                             ast::PatternElement::TextElement {
//!                                 value: "Tooltip for you, "
//!                             },
//!                             ast::PatternElement::Placeable {
//!                                 expression: ast::Expression::Inline(
//!                                     ast::InlineExpression::VariableReference {
//!                                         id: ast::Identifier {
//!                                             name: "userName"
//!                                         }
//!                                     }
//!                                 )
//!                             },
//!                             ast::PatternElement::TextElement {
//!                                 value: "."
//!                             },
//!                         ]
//!                     }
//!                 }
//!             ],
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
//! ## Errors
//!
//! Fluent AST preserves blocks containing invalid syntax as [`Entry::Junk`].
//!
//! ## White space
//!
//! At the moment, AST does not preserve white space. In result only a
//! canonical form of the AST is suitable for a round-trip.
// mod helper; (private; `helper::CommentDef` is only used by the serde deserializer, see ./helper.ts)

import { debug_bool, debug_option, debug_str, debug_struct, debug_tuple, debug_vec, type Debug } from "../../../std/fmt.ts";
import type { Str } from "../../../std/str.ts";

// PORT: the `S` type parameter (`S: Slice<'s>`, the type of every source slice in the AST) is fixed
// to `Str` (`&str`, a byte-indexed view of the parsed source): rust-ts only instantiates
// `Resource<&str>`. Its Debug is `<str as Debug>` (`debug_S`), so the dumps equal `{:?}`/`{:#?}` of
// `Resource<&str>`. `Box<Expression>` is the plain value. Structs are interfaces (data only);
// enums are `$`-tagged unions (PORTING.md §5).
// PORT: `#[cfg_attr(feature = "serde", ...)]` derives are not ported (feature off in rustc).
// PORT: derived `Clone`/`PartialEq`/`Eq`/`Default` are not hand-written (PORTING.md §5); the
// parser's one use of `PartialEq` on `S` goes through `slice_eq` (parser/slice.ts).

/** `<S as Debug>::fmt` for `S = &str`. */
export const debug_S: Debug<Str> = (v) => debug_str(v.toString());

/// Root node of a Fluent Translation List.
///
/// A [`Resource`] contains a body with a list of [`Entry`] nodes.
///
/// # Example
///
/// ```
/// use fluent_syntax::parser;
/// use fluent_syntax::ast;
///
/// let ftl = "";
///
/// let resource = parser::parse(ftl)
///     .expect("Failed to parse an FTL resource.");
///
/// assert_eq!(
///     resource,
///     ast::Resource {
///         body: vec![]
///     }
/// );
/// ```
export interface Resource {
  body: Entry[];
}

export const debug_Resource: Debug<Resource> = (v, f) => debug_struct(f, "Resource", [["body", debug_vec(v.body, f, debug_Entry)]]);

/// A top-level node representing an entry of a [`Resource`].
///
/// Every [`Entry`] is a standalone element and the parser is capable
/// of recovering from errors by identifying a beginning of a next entry.
///
/// # Example
///
/// ```
/// use fluent_syntax::parser;
/// use fluent_syntax::ast;
///
/// let ftl = r#"
///
/// key = Value
///
/// "#;
///
/// let resource = parser::parse(ftl)
///     .expect("Failed to parse an FTL resource.");
///
/// assert_eq!(
///     resource,
///     ast::Resource {
///         body: vec![
///             ast::Entry::Message(
///                 ast::Message {
///                     id: ast::Identifier {
///                         name: "key"
///                     },
///                     value: Some(ast::Pattern {
///                         elements: vec![
///                             ast::PatternElement::TextElement {
///                                 value: "Value"
///                             },
///                         ]
///                     }),
///                     attributes: vec![],
///                     comment: None,
///                 }
///             )
///         ]
///     }
/// );
/// ```
///
/// # Junk Entry
///
/// If FTL source contains invalid FTL content, it will be preserved
/// in form of [`Entry::Junk`] nodes.
///
/// # Example
///
/// ```
/// use fluent_syntax::parser;
/// use fluent_syntax::ast;
///
/// let ftl = r#"
///
/// g@rb@ge En!ry
///
/// "#;
///
/// let (resource, _) = parser::parse(ftl)
///     .expect_err("Failed to parse an FTL resource.");
///
/// assert_eq!(
///     resource,
///     ast::Resource {
///         body: vec![
///             ast::Entry::Junk {
///                 content: "g@rb@ge En!ry\n\n"
///             }
///         ]
///     }
/// );
/// ```
export type Entry =
  | { $: "Message"; _0: Message }
  | { $: "Term"; _0: Term }
  | { $: "Comment"; _0: Comment }
  | { $: "GroupComment"; _0: Comment }
  | { $: "ResourceComment"; _0: Comment }
  | { $: "Junk"; content: Str };

export const debug_Entry: Debug<Entry> = (v, f) => {
  switch (v.$) {
    case "Message":
      return debug_tuple(f, "Message", [debug_Message(v._0, f)]);
    case "Term":
      return debug_tuple(f, "Term", [debug_Term(v._0, f)]);
    case "Comment":
      return debug_tuple(f, "Comment", [debug_Comment(v._0, f)]);
    case "GroupComment":
      return debug_tuple(f, "GroupComment", [debug_Comment(v._0, f)]);
    case "ResourceComment":
      return debug_tuple(f, "ResourceComment", [debug_Comment(v._0, f)]);
    case "Junk":
      return debug_struct(f, "Junk", [["content", debug_S(v.content, f)]]);
  }
};

/// Message node represents the most common [`Entry`] in an FTL [`Resource`].
///
/// A message is a localization unit with a [`Identifier`] unique within a given
/// [`Resource`], and a value or attributes with associated [`Pattern`].
///
/// A message can contain a simple text value, or a compound combination of value
/// and attributes which together can be used to localize a complex User Interface
/// element.
///
/// Finally, each [`Message`] may have an associated [`Comment`].
///
/// # Example
///
/// ```
/// use fluent_syntax::parser;
/// use fluent_syntax::ast;
///
/// let ftl = r#"
///
/// hello-world = Hello, World!
///
/// "#;
///
/// let resource = parser::parse(ftl)
///     .expect("Failed to parse an FTL resource.");
///
/// assert_eq!(
///     resource,
///     ast::Resource {
///         body: vec![
///             ast::Entry::Message(ast::Message {
///                 id: ast::Identifier {
///                     name: "hello-world"
///                 },
///                 value: Some(ast::Pattern {
///                     elements: vec![
///                         ast::PatternElement::TextElement {
///                             value: "Hello, World!"
///                         }
///                     ]
///                 }),
///                 attributes: vec![],
///                 comment: None,
///             })
///         ]
///     }
/// );
/// ```
export interface Message {
  id: Identifier;
  value: Pattern | undefined;
  attributes: Attribute[];
  comment: Comment | undefined;
}

export const debug_Message: Debug<Message> = (v, f) =>
  debug_struct(f, "Message", [
    ["id", debug_Identifier(v.id, f)],
    ["value", debug_option(v.value, f, debug_Pattern)],
    ["attributes", debug_vec(v.attributes, f, debug_Attribute)],
    ["comment", debug_option(v.comment, f, debug_Comment)],
  ]);

/// A Fluent [`Term`].
///
/// Terms are semantically similar to [`Message`] nodes, but
/// they represent a separate concept in Fluent system.
///
/// Every term has to have a value, and the parser will
/// report errors when term references are used in wrong positions.
///
/// # Example
///
/// ```
/// use fluent_syntax::parser;
/// use fluent_syntax::ast;
///
/// let ftl = r#"
///
/// -brand-name = Nightly
///
/// "#;
///
/// let resource = parser::parse(ftl)
///     .expect("Failed to parse an FTL resource.");
///
/// assert_eq!(
///     resource,
///     ast::Resource {
///         body: vec![
///             ast::Entry::Term(ast::Term {
///                 id: ast::Identifier {
///                     name: "brand-name"
///                 },
///                 value: ast::Pattern {
///                     elements: vec![
///                         ast::PatternElement::TextElement {
///                             value: "Nightly"
///                         }
///                     ]
///                 },
///                 attributes: vec![],
///                 comment: None,
///             })
///         ]
///     }
/// );
/// ```
export interface Term {
  id: Identifier;
  value: Pattern;
  attributes: Attribute[];
  comment: Comment | undefined;
}

export const debug_Term: Debug<Term> = (v, f) =>
  debug_struct(f, "Term", [
    ["id", debug_Identifier(v.id, f)],
    ["value", debug_Pattern(v.value, f)],
    ["attributes", debug_vec(v.attributes, f, debug_Attribute)],
    ["comment", debug_option(v.comment, f, debug_Comment)],
  ]);

/// Pattern contains a value of a [`Message`], [`Term`] or an [`Attribute`].
///
/// Each pattern is a list of [`PatternElement`] nodes representing
/// either a simple textual value, or a combination of text literals
/// and placeholder [`Expression`] nodes.
///
/// # Example
///
/// ```
/// use fluent_syntax::parser;
/// use fluent_syntax::ast;
///
/// let ftl = r#"
///
/// hello-world = Hello, World!
///
/// welcome = Welcome, { $userName }.
///
/// "#;
///
/// let resource = parser::parse(ftl)
///     .expect("Failed to parse an FTL resource.");
///
/// assert_eq!(
///     resource,
///     ast::Resource {
///         body: vec![
///             ast::Entry::Message(ast::Message {
///                 id: ast::Identifier {
///                     name: "hello-world"
///                 },
///                 value: Some(ast::Pattern {
///                     elements: vec![
///                         ast::PatternElement::TextElement {
///                             value: "Hello, World!"
///                         }
///                     ]
///                 }),
///                 attributes: vec![],
///                 comment: None,
///             }),
///             ast::Entry::Message(ast::Message {
///                 id: ast::Identifier {
///                     name: "welcome"
///                 },
///                 value: Some(ast::Pattern {
///                     elements: vec![
///                         ast::PatternElement::TextElement {
///                             value: "Welcome, "
///                         },
///                         ast::PatternElement::Placeable {
///                             expression: ast::Expression::Inline(
///                                 ast::InlineExpression::VariableReference {
///                                     id: ast::Identifier {
///                                         name: "userName"
///                                     }
///                                 }
///                             )
///                         },
///                         ast::PatternElement::TextElement {
///                             value: "."
///                         }
///                     ]
///                 }),
///                 attributes: vec![],
///                 comment: None,
///             }),
///         ]
///     }
/// );
/// ```
export interface Pattern {
  elements: PatternElement[];
}

export const debug_Pattern: Debug<Pattern> = (v, f) => debug_struct(f, "Pattern", [["elements", debug_vec(v.elements, f, debug_PatternElement)]]);

/// `PatternElement` is an element of a [`Pattern`].
///
/// Each [`PatternElement`] node represents
/// either a simple textual value, or a combination of text literals
/// and placeholder [`Expression`] nodes.
///
/// # Example
///
/// ```
/// use fluent_syntax::parser;
/// use fluent_syntax::ast;
///
/// let ftl = r#"
///
/// hello-world = Hello, World!
///
/// welcome = Welcome, { $userName }.
///
/// "#;
///
/// let resource = parser::parse(ftl)
///     .expect("Failed to parse an FTL resource.");
///
/// assert_eq!(
///     resource,
///     ast::Resource {
///         body: vec![
///             ast::Entry::Message(ast::Message {
///                 id: ast::Identifier {
///                     name: "hello-world"
///                 },
///                 value: Some(ast::Pattern {
///                     elements: vec![
///                         ast::PatternElement::TextElement {
///                             value: "Hello, World!"
///                         }
///                     ]
///                 }),
///                 attributes: vec![],
///                 comment: None,
///             }),
///             ast::Entry::Message(ast::Message {
///                 id: ast::Identifier {
///                     name: "welcome"
///                 },
///                 value: Some(ast::Pattern {
///                     elements: vec![
///                         ast::PatternElement::TextElement {
///                             value: "Welcome, "
///                         },
///                         ast::PatternElement::Placeable {
///                             expression: ast::Expression::Inline(
///                                 ast::InlineExpression::VariableReference {
///                                     id: ast::Identifier {
///                                         name: "userName"
///                                     }
///                                 }
///                             )
///                         },
///                         ast::PatternElement::TextElement {
///                             value: "."
///                         }
///                     ]
///                 }),
///                 attributes: vec![],
///                 comment: None,
///             }),
///         ]
///     }
/// );
/// ```
export type PatternElement = { $: "TextElement"; value: Str } | { $: "Placeable"; expression: Expression };

export const debug_PatternElement: Debug<PatternElement> = (v, f) => {
  switch (v.$) {
    case "TextElement":
      return debug_struct(f, "TextElement", [["value", debug_S(v.value, f)]]);
    case "Placeable":
      return debug_struct(f, "Placeable", [["expression", debug_Expression(v.expression, f)]]);
  }
};

/// Attribute represents a part of a [`Message`] or [`Term`].
///
/// Attributes are used to express a compound list of keyed
/// [`Pattern`] elements on an entry.
///
/// # Example
///
/// ```
/// use fluent_syntax::parser;
/// use fluent_syntax::ast;
///
/// let ftl = r#"
///
/// hello-world =
///     .title = This is a title
///     .accesskey = T
///
/// "#;
///
/// let resource = parser::parse(ftl)
///     .expect("Failed to parse an FTL resource.");
///
/// assert_eq!(
///     resource,
///     ast::Resource {
///         body: vec![
///             ast::Entry::Message(ast::Message {
///                 id: ast::Identifier {
///                     name: "hello-world"
///                 },
///                 value: None,
///                 attributes: vec![
///                     ast::Attribute {
///                         id: ast::Identifier {
///                             name: "title"
///                         },
///                         value: ast::Pattern {
///                             elements: vec![
///                                 ast::PatternElement::TextElement {
///                                     value: "This is a title"
///                                 },
///                             ]
///                         }
///                     },
///                     ast::Attribute {
///                         id: ast::Identifier {
///                             name: "accesskey"
///                         },
///                         value: ast::Pattern {
///                             elements: vec![
///                                 ast::PatternElement::TextElement {
///                                     value: "T"
///                                 },
///                             ]
///                         }
///                     }
///                 ],
///                 comment: None,
///             }),
///         ]
///     }
/// );
/// ```
export interface Attribute {
  id: Identifier;
  value: Pattern;
}

export const debug_Attribute: Debug<Attribute> = (v, f) =>
  debug_struct(f, "Attribute", [
    ["id", debug_Identifier(v.id, f)],
    ["value", debug_Pattern(v.value, f)],
  ]);

/// Identifier is part of nodes such as [`Message`], [`Term`] and [`Attribute`].
///
/// It is used to associate a unique key with an [`Entry`] or an [`Attribute`]
/// and in [`Expression`] nodes to refer to another entry.
///
/// # Example
///
/// ```
/// use fluent_syntax::parser;
/// use fluent_syntax::ast;
///
/// let ftl = r#"
///
/// hello-world = Value
///
/// "#;
///
/// let resource = parser::parse(ftl)
///     .expect("Failed to parse an FTL resource.");
///
/// assert_eq!(
///     resource,
///     ast::Resource {
///         body: vec![
///             ast::Entry::Message(ast::Message {
///                 id: ast::Identifier {
///                     name: "hello-world"
///                 },
///                 value: Some(ast::Pattern {
///                     elements: vec![
///                         ast::PatternElement::TextElement {
///                             value: "Value"
///                         }
///                     ]
///                 }),
///                 attributes: vec![],
///                 comment: None,
///             }),
///         ]
///     }
/// );
/// ```
export interface Identifier {
  name: Str;
}

export const debug_Identifier: Debug<Identifier> = (v, f) => debug_struct(f, "Identifier", [["name", debug_S(v.name, f)]]);

/// Variant is a single branch of a value in a [`Select`](Expression::Select) expression.
///
/// It's a pair of [`VariantKey`] and [`Pattern`]. If the selector match the
/// key, then the value of the variant is returned as the value of the expression.
///
/// # Example
///
/// ```
/// use fluent_syntax::parser;
/// use fluent_syntax::ast;
///
/// let ftl = r#"
///
/// hello-world = { $var ->
///     [key1] Value 1
///    *[other] Value 2
/// }
///
/// "#;
///
/// let resource = parser::parse(ftl)
///     .expect("Failed to parse an FTL resource.");
///
/// assert_eq!(
///     resource,
///     ast::Resource {
///         body: vec![
///             ast::Entry::Message(ast::Message {
///                 id: ast::Identifier {
///                     name: "hello-world"
///                 },
///                 value: Some(ast::Pattern {
///                     elements: vec![
///                         ast::PatternElement::Placeable {
///                             expression: ast::Expression::Select {
///                                 selector: ast::InlineExpression::VariableReference {
///                                     id: ast::Identifier { name: "var" },
///                                 },
///                                 variants: vec![
///                                     ast::Variant {
///                                         key: ast::VariantKey::Identifier {
///                                             name: "key1"
///                                         },
///                                         value: ast::Pattern {
///                                             elements: vec![
///                                                 ast::PatternElement::TextElement {
///                                                     value: "Value 1",
///                                                 }
///                                             ]
///                                         },
///                                         default: false,
///                                     },
///                                     ast::Variant {
///                                         key: ast::VariantKey::Identifier {
///                                             name: "other"
///                                         },
///                                         value: ast::Pattern {
///                                             elements: vec![
///                                                 ast::PatternElement::TextElement {
///                                                     value: "Value 2",
///                                                 }
///                                             ]
///                                         },
///                                         default: true,
///                                     },
///                                 ]
///                             }
///                         }
///                     ]
///                 }),
///                 attributes: vec![],
///                 comment: None,
///             }),
///         ]
///     }
/// );
/// ```
export interface Variant {
  key: VariantKey;
  value: Pattern;
  default: boolean;
}

export const debug_Variant: Debug<Variant> = (v, f) =>
  debug_struct(f, "Variant", [
    ["key", debug_VariantKey(v.key, f)],
    ["value", debug_Pattern(v.value, f)],
    ["default", debug_bool(v.default, f)],
  ]);

/// A key of a [`Variant`].
///
/// Variant key can be either an identifier or a number.
///
/// # Example
///
/// ```
/// use fluent_syntax::parser;
/// use fluent_syntax::ast;
///
/// let ftl = r#"
///
/// hello-world = { $var ->
///     [0] Value 1
///    *[other] Value 2
/// }
///
/// "#;
///
/// let resource = parser::parse(ftl)
///     .expect("Failed to parse an FTL resource.");
///
/// assert_eq!(
///     resource,
///     ast::Resource {
///         body: vec![
///             ast::Entry::Message(ast::Message {
///                 id: ast::Identifier {
///                     name: "hello-world"
///                 },
///                 value: Some(ast::Pattern {
///                     elements: vec![
///                         ast::PatternElement::Placeable {
///                             expression: ast::Expression::Select {
///                                 selector: ast::InlineExpression::VariableReference {
///                                     id: ast::Identifier { name: "var" },
///                                 },
///                                 variants: vec![
///                                     ast::Variant {
///                                         key: ast::VariantKey::NumberLiteral {
///                                             value: "0"
///                                         },
///                                         value: ast::Pattern {
///                                             elements: vec![
///                                                 ast::PatternElement::TextElement {
///                                                     value: "Value 1",
///                                                 }
///                                             ]
///                                         },
///                                         default: false,
///                                     },
///                                     ast::Variant {
///                                         key: ast::VariantKey::Identifier {
///                                             name: "other"
///                                         },
///                                         value: ast::Pattern {
///                                             elements: vec![
///                                                 ast::PatternElement::TextElement {
///                                                     value: "Value 2",
///                                                 }
///                                             ]
///                                         },
///                                         default: true,
///                                     },
///                                 ]
///                             }
///                         }
///                     ]
///                 }),
///                 attributes: vec![],
///                 comment: None,
///             }),
///         ]
///     }
/// );
/// ```
export type VariantKey = { $: "Identifier"; name: Str } | { $: "NumberLiteral"; value: Str };

export const debug_VariantKey: Debug<VariantKey> = (v, f) => {
  switch (v.$) {
    case "Identifier":
      return debug_struct(f, "Identifier", [["name", debug_S(v.name, f)]]);
    case "NumberLiteral":
      return debug_struct(f, "NumberLiteral", [["value", debug_S(v.value, f)]]);
  }
};

/// Fluent [`Comment`].
///
/// In Fluent, comments may be standalone, or associated with
/// an entry such as [`Term`] or [`Message`].
///
/// When used as a standalone [`Entry`], comments may appear in one of
/// three levels:
///
/// * Standalone comment
/// * Group comment associated with a group of messages
/// * Resource comment associated with the whole resource
///
/// # Example
///
/// ```
/// use fluent_syntax::parser;
/// use fluent_syntax::ast;
///
/// let ftl = r#"
/// ## A standalone level comment
/// "#;
///
/// let resource = parser::parse(ftl)
///     .expect("Failed to parse an FTL resource.");
///
/// assert_eq!(
///     resource,
///     ast::Resource {
///         body: vec![
///             ast::Entry::Comment(ast::Comment {
///                 content: vec![
///                     "A standalone level comment"
///                 ]
///             })
///         ]
///     }
/// );
/// ```
export interface Comment {
  content: Str[];
}

export const debug_Comment: Debug<Comment> = (v, f) => debug_struct(f, "Comment", [["content", debug_vec(v.content, f, debug_S)]]);

/// List of arguments for a [`FunctionReference`](InlineExpression::FunctionReference) or a
/// [`TermReference`](InlineExpression::TermReference).
///
/// Function and Term reference may contain a list of positional and
/// named arguments passed to them.
///
/// # Example
///
/// ```
/// use fluent_syntax::parser;
/// use fluent_syntax::ast;
///
/// let ftl = r#"
///
/// key = { FUNC($var1, "literal", style: "long") }
///
/// "#;
///
/// let resource = parser::parse(ftl)
///     .expect("Failed to parse an FTL resource.");
///
/// assert_eq!(
///     resource,
///     ast::Resource {
///         body: vec![
///             ast::Entry::Message(
///                 ast::Message {
///                     id: ast::Identifier {
///                         name: "key"
///                     },
///                     value: Some(ast::Pattern {
///                         elements: vec![
///                             ast::PatternElement::Placeable {
///                                 expression: ast::Expression::Inline(
///                                     ast::InlineExpression::FunctionReference {
///                                         id: ast::Identifier {
///                                             name: "FUNC"
///                                         },
///                                         arguments: ast::CallArguments {
///                                             positional: vec![
///                                                 ast::InlineExpression::VariableReference {
///                                                     id: ast::Identifier {
///                                                         name: "var1"
///                                                     }
///                                                 },
///                                                 ast::InlineExpression::StringLiteral {
///                                                     value: "literal",
///                                                 }
///                                             ],
///                                             named: vec![
///                                                 ast::NamedArgument {
///                                                     name: ast::Identifier {
///                                                         name: "style"
///                                                     },
///                                                     value: ast::InlineExpression::StringLiteral
///                                                     {
///                                                         value: "long"
///                                                     }
///                                                 }
///                                             ],
///                                         }
///                                     }
///                                 )
///                             },
///                         ]
///                     }),
///                     attributes: vec![],
///                     comment: None,
///                 }
///             )
///         ]
///     }
/// );
/// ```
export interface CallArguments {
  positional: InlineExpression[];
  named: NamedArgument[];
}

export const debug_CallArguments: Debug<CallArguments> = (v, f) =>
  debug_struct(f, "CallArguments", [
    ["positional", debug_vec(v.positional, f, debug_InlineExpression)],
    ["named", debug_vec(v.named, f, debug_NamedArgument)],
  ]);

/// A key-value pair used in [`CallArguments`].
///
/// # Example
///
/// ```
/// use fluent_syntax::parser;
/// use fluent_syntax::ast;
///
/// let ftl = r#"
///
/// key = { FUNC(style: "long") }
///
/// "#;
///
/// let resource = parser::parse(ftl)
///     .expect("Failed to parse an FTL resource.");
///
/// assert_eq!(
///     resource,
///     ast::Resource {
///         body: vec![
///             ast::Entry::Message(
///                 ast::Message {
///                     id: ast::Identifier {
///                         name: "key"
///                     },
///                     value: Some(ast::Pattern {
///                         elements: vec![
///                             ast::PatternElement::Placeable {
///                                 expression: ast::Expression::Inline(
///                                     ast::InlineExpression::FunctionReference {
///                                         id: ast::Identifier {
///                                             name: "FUNC"
///                                         },
///                                         arguments: ast::CallArguments {
///                                             positional: vec![],
///                                             named: vec![
///                                                 ast::NamedArgument {
///                                                     name: ast::Identifier {
///                                                         name: "style"
///                                                     },
///                                                     value: ast::InlineExpression::StringLiteral
///                                                     {
///                                                         value: "long"
///                                                     }
///                                                 }
///                                             ],
///                                         }
///                                     }
///                                 )
///                             },
///                         ]
///                     }),
///                     attributes: vec![],
///                     comment: None,
///                 }
///             )
///         ]
///     }
/// );
/// ```
export interface NamedArgument {
  name: Identifier;
  value: InlineExpression;
}

export const debug_NamedArgument: Debug<NamedArgument> = (v, f) =>
  debug_struct(f, "NamedArgument", [
    ["name", debug_Identifier(v.name, f)],
    ["value", debug_InlineExpression(v.value, f)],
  ]);

/// A subset of expressions which can be used as [`Placeable`](PatternElement::Placeable),
/// [`selector`](Expression::Select), or in [`CallArguments`].
///
/// # Example
///
/// ```
/// use fluent_syntax::parser;
/// use fluent_syntax::ast;
///
/// let ftl = r#"
///
/// key = { $emailCount }
///
/// "#;
///
/// let resource = parser::parse(ftl)
///     .expect("Failed to parse an FTL resource.");
///
/// assert_eq!(
///     resource,
///     ast::Resource {
///         body: vec![
///             ast::Entry::Message(
///                 ast::Message {
///                     id: ast::Identifier {
///                         name: "key"
///                     },
///                     value: Some(ast::Pattern {
///                         elements: vec![
///                             ast::PatternElement::Placeable {
///                                 expression: ast::Expression::Inline(
///                                     ast::InlineExpression::VariableReference {
///                                         id: ast::Identifier {
///                                             name: "emailCount"
///                                         },
///                                     }
///                                 )
///                             },
///                         ]
///                     }),
///                     attributes: vec![],
///                     comment: None,
///                 }
///             )
///         ]
///     }
/// );
/// ```
export type InlineExpression =
  /// Single line string literal enclosed in `"`.
  ///
  /// # Example
  ///
  /// ```
  /// use fluent_syntax::parser;
  /// use fluent_syntax::ast;
  ///
  /// let ftl = r#"
  ///
  /// key = { "this is a literal" }
  ///
  /// "#;
  ///
  /// let resource = parser::parse(ftl)
  ///     .expect("Failed to parse an FTL resource.");
  ///
  /// assert_eq!(
  ///     resource,
  ///     ast::Resource {
  ///         body: vec![
  ///             ast::Entry::Message(
  ///                 ast::Message {
  ///                     id: ast::Identifier {
  ///                         name: "key"
  ///                     },
  ///                     value: Some(ast::Pattern {
  ///                         elements: vec![
  ///                             ast::PatternElement::Placeable {
  ///                                 expression: ast::Expression::Inline(
  ///                                     ast::InlineExpression::StringLiteral {
  ///                                         value: "this is a literal",
  ///                                     }
  ///                                 )
  ///                             },
  ///                         ]
  ///                     }),
  ///                     attributes: vec![],
  ///                     comment: None,
  ///                 }
  ///             )
  ///         ]
  ///     }
  /// );
  /// ```
  | { $: "StringLiteral"; value: Str }
  /// A number literal.
  ///
  /// # Example
  ///
  /// ```
  /// use fluent_syntax::parser;
  /// use fluent_syntax::ast;
  ///
  /// let ftl = r#"
  ///
  /// key = { -0.5 }
  ///
  /// "#;
  ///
  /// let resource = parser::parse(ftl)
  ///     .expect("Failed to parse an FTL resource.");
  ///
  /// assert_eq!(
  ///     resource,
  ///     ast::Resource {
  ///         body: vec![
  ///             ast::Entry::Message(
  ///                 ast::Message {
  ///                     id: ast::Identifier {
  ///                         name: "key"
  ///                     },
  ///                     value: Some(ast::Pattern {
  ///                         elements: vec![
  ///                             ast::PatternElement::Placeable {
  ///                                 expression: ast::Expression::Inline(
  ///                                     ast::InlineExpression::NumberLiteral {
  ///                                         value: "-0.5",
  ///                                     }
  ///                                 )
  ///                             },
  ///                         ]
  ///                     }),
  ///                     attributes: vec![],
  ///                     comment: None,
  ///                 }
  ///             )
  ///         ]
  ///     }
  /// );
  /// ```
  | { $: "NumberLiteral"; value: Str }
  /// A function reference.
  ///
  /// # Example
  ///
  /// ```
  /// use fluent_syntax::parser;
  /// use fluent_syntax::ast;
  ///
  /// let ftl = r#"
  ///
  /// key = { FUNC() }
  ///
  /// "#;
  ///
  /// let resource = parser::parse(ftl)
  ///     .expect("Failed to parse an FTL resource.");
  ///
  /// assert_eq!(
  ///     resource,
  ///     ast::Resource {
  ///         body: vec![
  ///             ast::Entry::Message(
  ///                 ast::Message {
  ///                     id: ast::Identifier {
  ///                         name: "key"
  ///                     },
  ///                     value: Some(ast::Pattern {
  ///                         elements: vec![
  ///                             ast::PatternElement::Placeable {
  ///                                 expression: ast::Expression::Inline(
  ///                                     ast::InlineExpression::FunctionReference {
  ///                                         id: ast::Identifier {
  ///                                             name: "FUNC"
  ///                                         },
  ///                                         arguments: ast::CallArguments::default(),
  ///                                     }
  ///                                 )
  ///                             },
  ///                         ]
  ///                     }),
  ///                     attributes: vec![],
  ///                     comment: None,
  ///                 }
  ///             )
  ///         ]
  ///     }
  /// );
  /// ```
  | { $: "FunctionReference"; id: Identifier; arguments: CallArguments }
  /// A reference to another message.
  ///
  /// # Example
  ///
  /// ```
  /// use fluent_syntax::parser;
  /// use fluent_syntax::ast;
  ///
  /// let ftl = r#"
  ///
  /// key = { key2 }
  ///
  /// "#;
  ///
  /// let resource = parser::parse(ftl)
  ///     .expect("Failed to parse an FTL resource.");
  ///
  /// assert_eq!(
  ///     resource,
  ///     ast::Resource {
  ///         body: vec![
  ///             ast::Entry::Message(
  ///                 ast::Message {
  ///                     id: ast::Identifier {
  ///                         name: "key"
  ///                     },
  ///                     value: Some(ast::Pattern {
  ///                         elements: vec![
  ///                             ast::PatternElement::Placeable {
  ///                                 expression: ast::Expression::Inline(
  ///                                     ast::InlineExpression::MessageReference {
  ///                                         id: ast::Identifier {
  ///                                             name: "key2"
  ///                                         },
  ///                                         attribute: None,
  ///                                     }
  ///                                 )
  ///                             },
  ///                         ]
  ///                     }),
  ///                     attributes: vec![],
  ///                     comment: None,
  ///                 }
  ///             )
  ///         ]
  ///     }
  /// );
  /// ```
  | { $: "MessageReference"; id: Identifier; attribute: Identifier | undefined }
  /// A reference to a term.
  ///
  /// # Example
  ///
  /// ```
  /// use fluent_syntax::parser;
  /// use fluent_syntax::ast;
  ///
  /// let ftl = r#"
  ///
  /// key = { -brand-name }
  ///
  /// "#;
  ///
  /// let resource = parser::parse(ftl)
  ///     .expect("Failed to parse an FTL resource.");
  ///
  /// assert_eq!(
  ///     resource,
  ///     ast::Resource {
  ///         body: vec![
  ///             ast::Entry::Message(
  ///                 ast::Message {
  ///                     id: ast::Identifier {
  ///                         name: "key"
  ///                     },
  ///                     value: Some(ast::Pattern {
  ///                         elements: vec![
  ///                             ast::PatternElement::Placeable {
  ///                                 expression: ast::Expression::Inline(
  ///                                     ast::InlineExpression::TermReference {
  ///                                         id: ast::Identifier {
  ///                                             name: "brand-name"
  ///                                         },
  ///                                         attribute: None,
  ///                                         arguments: None,
  ///                                     }
  ///                                 )
  ///                             },
  ///                         ]
  ///                     }),
  ///                     attributes: vec![],
  ///                     comment: None,
  ///                 }
  ///             )
  ///         ]
  ///     }
  /// );
  /// ```
  | { $: "TermReference"; id: Identifier; attribute: Identifier | undefined; arguments: CallArguments | undefined }
  /// A reference to a variable.
  ///
  /// # Example
  ///
  /// ```
  /// use fluent_syntax::parser;
  /// use fluent_syntax::ast;
  ///
  /// let ftl = r#"
  ///
  /// key = { $var1 }
  ///
  /// "#;
  ///
  /// let resource = parser::parse(ftl)
  ///     .expect("Failed to parse an FTL resource.");
  ///
  /// assert_eq!(
  ///     resource,
  ///     ast::Resource {
  ///         body: vec![
  ///             ast::Entry::Message(
  ///                 ast::Message {
  ///                     id: ast::Identifier {
  ///                         name: "key"
  ///                     },
  ///                     value: Some(ast::Pattern {
  ///                         elements: vec![
  ///                             ast::PatternElement::Placeable {
  ///                                 expression: ast::Expression::Inline(
  ///                                     ast::InlineExpression::VariableReference {
  ///                                         id: ast::Identifier {
  ///                                             name: "var1"
  ///                                         },
  ///                                     }
  ///                                 )
  ///                             },
  ///                         ]
  ///                     }),
  ///                     attributes: vec![],
  ///                     comment: None,
  ///                 }
  ///             )
  ///         ]
  ///     }
  /// );
  /// ```
  | { $: "VariableReference"; id: Identifier }
  /// A placeable which may contain another expression.
  ///
  /// # Example
  ///
  /// ```
  /// use fluent_syntax::parser;
  /// use fluent_syntax::ast;
  ///
  /// let ftl = r#"
  ///
  /// key = { { "placeable" } }
  ///
  /// "#;
  ///
  /// let resource = parser::parse(ftl)
  ///     .expect("Failed to parse an FTL resource.");
  ///
  /// assert_eq!(
  ///     resource,
  ///     ast::Resource {
  ///         body: vec![
  ///             ast::Entry::Message(
  ///                 ast::Message {
  ///                     id: ast::Identifier {
  ///                         name: "key"
  ///                     },
  ///                     value: Some(ast::Pattern {
  ///                         elements: vec![
  ///                             ast::PatternElement::Placeable {
  ///                                 expression: ast::Expression::Inline(
  ///                                     ast::InlineExpression::Placeable {
  ///                                         expression: Box::new(
  ///                                             ast::Expression::Inline(
  ///                                                 ast::InlineExpression::StringLiteral {
  ///                                                     value: "placeable"
  ///                                                 }
  ///                                             )
  ///                                         )
  ///                                     }
  ///                                 )
  ///                             },
  ///                         ]
  ///                     }),
  ///                     attributes: vec![],
  ///                     comment: None,
  ///                 }
  ///             )
  ///         ]
  ///     }
  /// );
  /// ```
  | { $: "Placeable"; expression: Expression };

export const debug_InlineExpression: Debug<InlineExpression> = (v, f) => {
  switch (v.$) {
    case "StringLiteral":
      return debug_struct(f, "StringLiteral", [["value", debug_S(v.value, f)]]);
    case "NumberLiteral":
      return debug_struct(f, "NumberLiteral", [["value", debug_S(v.value, f)]]);
    case "FunctionReference":
      return debug_struct(f, "FunctionReference", [
        ["id", debug_Identifier(v.id, f)],
        ["arguments", debug_CallArguments(v.arguments, f)],
      ]);
    case "MessageReference":
      return debug_struct(f, "MessageReference", [
        ["id", debug_Identifier(v.id, f)],
        ["attribute", debug_option(v.attribute, f, debug_Identifier)],
      ]);
    case "TermReference":
      return debug_struct(f, "TermReference", [
        ["id", debug_Identifier(v.id, f)],
        ["attribute", debug_option(v.attribute, f, debug_Identifier)],
        ["arguments", debug_option(v.arguments, f, debug_CallArguments)],
      ]);
    case "VariableReference":
      return debug_struct(f, "VariableReference", [["id", debug_Identifier(v.id, f)]]);
    case "Placeable":
      return debug_struct(f, "Placeable", [["expression", debug_Expression(v.expression, f)]]);
  }
};

/// An expression that is either a select expression or an inline expression.
///
/// # Example
///
/// ```
/// use fluent_syntax::parser;
/// use fluent_syntax::ast;
///
/// let ftl = r#"
///
/// key = { $var ->
///     [key1] Value 1
///    *[other] Value 2
/// }
///
/// "#;
///
/// let resource = parser::parse(ftl)
///     .expect("Failed to parse an FTL resource.");
///
/// assert_eq!(
///     resource,
///     ast::Resource {
///         body: vec![
///             ast::Entry::Message(ast::Message {
///                 id: ast::Identifier {
///                     name: "key"
///                 },
///                 value: Some(ast::Pattern {
///                     elements: vec![
///                         ast::PatternElement::Placeable {
///                             expression: ast::Expression::Select {
///                                 selector: ast::InlineExpression::VariableReference {
///                                     id: ast::Identifier { name: "var" },
///                                 },
///                                 variants: vec![
///                                     ast::Variant {
///                                         key: ast::VariantKey::Identifier {
///                                             name: "key1"
///                                         },
///                                         value: ast::Pattern {
///                                             elements: vec![
///                                                 ast::PatternElement::TextElement {
///                                                     value: "Value 1",
///                                                 }
///                                             ]
///                                         },
///                                         default: false,
///                                     },
///                                     ast::Variant {
///                                         key: ast::VariantKey::Identifier {
///                                             name: "other"
///                                         },
///                                         value: ast::Pattern {
///                                             elements: vec![
///                                                 ast::PatternElement::TextElement {
///                                                     value: "Value 2",
///                                                 }
///                                             ]
///                                         },
///                                         default: true,
///                                     },
///                                 ]
///                             }
///                         }
///                     ]
///                 }),
///                 attributes: vec![],
///                 comment: None,
///             }),
///         ]
///     }
/// );
/// ```
export type Expression =
  /// A select expression such as:
  /// ```ftl
  /// key = { $var ->
  ///     [key1] Value 1
  ///    *[other] Value 2
  /// }
  /// ```
  | { $: "Select"; selector: InlineExpression; variants: Variant[] }

  /// An inline expression such as `${ username }`:
  ///
  /// ```ftl
  /// hello-user = Hello ${ username }
  /// ```
  | { $: "Inline"; _0: InlineExpression };

export const debug_Expression: Debug<Expression> = (v, f) => {
  switch (v.$) {
    case "Select":
      return debug_struct(f, "Select", [
        ["selector", debug_InlineExpression(v.selector, f)],
        ["variants", debug_vec(v.variants, f, debug_Variant)],
      ]);
    case "Inline":
      return debug_tuple(f, "Inline", [debug_InlineExpression(v._0, f)]);
  }
};
