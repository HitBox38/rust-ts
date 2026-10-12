//! Fluent Translation List serialization utilities
//!
//! This modules provides a way to serialize an abstract syntax tree representing a
//! Fluent Translation List. Use cases include normalization and programmatic
//! manipulation of a Fluent Translation List.
//!
//! # Example
//!
//! ```
//! use fluent_syntax::parser;
//! use fluent_syntax::serializer;
//!
//! let ftl = r#"# This is a message comment
//! hello-world = Hello World!
//! "#;
//!
//! let resource = parser::parse(ftl).expect("Failed to parse an FTL resource.");
//!
//! let serialized = serializer::serialize(&resource);
//!
//! assert_eq!(ftl, serialized);
//! ```
//
// Port of fluent-syntax-0.12.0/src/serializer.rs.
// PORT: the output `String` is a JS `string` (not byte-indexed); AST slices are `Str` and are
// written with `toString()`. `impl Pattern { .. }` (private methods) → `Pattern_<method>(self)`
// functions. Derived `Default` → hand-written `<Type>_default()` (needed by `serialize`). Private
// structs are exported for the ported unit tests.

import { debug_bool, debug_int, debug_str, debug_struct, type Debug } from "../../std/fmt.ts";
import { panic } from "../../std/panic.ts";
import type { Str } from "../../std/str.ts";
import type { Attribute, CallArguments, Comment, Expression, InlineExpression, Message, Pattern, PatternElement, Resource, Term, Variant, VariantKey } from "./ast/mod.ts";
import { matches_fluent_ws } from "./parser/slice.ts";

/** PORT: `str::trim_matches(matches_fluent_ws).is_empty()`: every char is fluent whitespace. */
function trim_matches_fluent_ws_is_empty(s: Str): boolean {
  for (let i = 0; i < s.len(); i++) if (!matches_fluent_ws(s.byte(i))) return false;
  return true;
}

/// Serializes an abstract syntax tree representing a Fluent Translation List into a
/// String.
///
/// # Example
///
/// ```
/// use fluent_syntax::parser;
/// use fluent_syntax::serializer;
///
/// let ftl = r#"
/// unnormalized-message=This message has
///   abnormal spacing and indentation"#;
///
/// let resource = parser::parse(ftl).expect("Failed to parse an FTL resource.");
///
/// let serialized = serializer::serialize(&resource);
///
/// let expected = r#"unnormalized-message =
///     This message has
///     abnormal spacing and indentation
/// "#;
///
/// assert_eq!(expected, serialized);
/// ```
// crate: fluent-syntax-0.12.0/src/serializer.rs:51 serialize
export function serialize(resource: Resource): string {
  return serialize_with_options(resource, Options_default());
}

/// Serializes an abstract syntax tree representing a Fluent Translation List into a
/// String accepting custom options.
// crate: fluent-syntax-0.12.0/src/serializer.rs:57 serialize_with_options
export function serialize_with_options(resource: Resource, options: Options): string {
  const ser = Serializer.new(options);
  ser.serialize_resource(resource);
  return ser.into_serialized_text();
}

export class Serializer {
  constructor(
    public writer: TextWriter,
    public options: Options,
    public state: State,
  ) {}

  // crate: fluent-syntax-0.12.0/src/serializer.rs:74 new
  static new(options: Options): Serializer {
    return new Serializer(TextWriter_default(), options, State_default());
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:82 serialize_resource
  serialize_resource(res: Resource): void {
    for (const entry of res.body) {
      switch (entry.$) {
        case "Message":
          this.serialize_message(entry._0);
          break;
        case "Term":
          this.serialize_term(entry._0);
          break;
        case "Comment":
          this.serialize_free_comment(entry._0, "#");
          break;
        case "GroupComment":
          this.serialize_free_comment(entry._0, "##");
          break;
        case "ResourceComment":
          this.serialize_free_comment(entry._0, "###");
          break;
        case "Junk": {
          const content = entry.content;
          if (this.options.with_junk) {
            this.serialize_junk(content.toString());
          }
          break;
        }
      }

      this.state.wrote_non_junk_entry = !(entry.$ === "Junk");
    }
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:101 into_serialized_text
  into_serialized_text(): string {
    return this.writer.buffer;
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:105 serialize_junk
  serialize_junk(junk: string): void {
    this.writer.write_literal(junk);
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:109 serialize_free_comment
  serialize_free_comment(comment: Comment, prefix: string): void {
    if (this.state.wrote_non_junk_entry) {
      this.writer.newline();
    }
    this.serialize_comment(comment, prefix);
    this.writer.newline();
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:117 serialize_comment
  serialize_comment(comment: Comment, prefix: string): void {
    for (const line of comment.content) {
      this.writer.write_literal(prefix);

      if (!trim_matches_fluent_ws_is_empty(line)) {
        this.writer.write_literal(" ");
        this.writer.write_literal(line.toString());
      }

      this.writer.newline();
    }
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:130 serialize_message
  serialize_message(msg: Message): void {
    const comment = msg.comment;
    if (comment !== undefined) {
      this.serialize_comment(comment, "#");
    }

    this.writer.write_literal(msg.id.name.toString());
    this.writer.write_literal(" =");

    const value = msg.value;
    if (value !== undefined) {
      this.serialize_pattern(value);
    }

    this.serialize_attributes(msg.attributes);

    this.writer.newline();
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:147 serialize_term
  serialize_term(term: Term): void {
    const comment = term.comment;
    if (comment !== undefined) {
      this.serialize_comment(comment, "#");
    }

    this.writer.write_literal("-");
    this.writer.write_literal(term.id.name.toString());
    this.writer.write_literal(" =");
    this.serialize_pattern(term.value);

    this.serialize_attributes(term.attributes);

    this.writer.newline();
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:162 serialize_pattern
  serialize_pattern(pattern: Pattern): void {
    const start_on_newline = Pattern_starts_on_new_line(pattern);

    if (start_on_newline) {
      this.writer.newline();
      this.writer.indent();
    } else {
      this.writer.write_literal(" ");
    }

    for (const element of pattern.elements) {
      this.serialize_element(element);
    }

    if (start_on_newline) {
      this.writer.dedent();
    }
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:181 serialize_attributes
  serialize_attributes(attrs: readonly Attribute[]): void {
    if (attrs.length === 0) {
      return;
    }

    this.writer.indent();

    for (const attr of attrs) {
      this.writer.newline();
      this.serialize_attribute(attr);
    }

    this.writer.dedent();
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:196 serialize_attribute
  serialize_attribute(attr: Attribute): void {
    this.writer.write_literal(".");
    this.writer.write_literal(attr.id.name.toString());
    this.writer.write_literal(" =");

    this.serialize_pattern(attr.value);
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:204 serialize_element
  serialize_element(elem: PatternElement): void {
    switch (elem.$) {
      case "TextElement":
        this.writer.write_literal(elem.value.toString());
        break;
      case "Placeable": {
        const expression = elem.expression;
        if (expression.$ === "Inline" && expression._0.$ === "Placeable") {
          const inner = expression._0.expression;
          // A placeable inside a placeable is a special case because we
          // don't want the braces to look silly (e.g. "{ { Foo() } }").
          this.writer.write_literal("{{ ");
          this.serialize_expression(inner);
          this.writer.write_literal(" }}");
        } else if (expression.$ === "Select") {
          // select adds its own newline and indent, emit the brace
          // *without* a space so we don't get 5 spaces instead of 4
          this.writer.write_literal("{ ");
          this.serialize_expression(expression);
          this.writer.write_literal("}");
        } else {
          this.writer.write_literal("{ ");
          this.serialize_expression(expression);
          this.writer.write_literal(" }");
        }
        break;
      }
    }
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:231 serialize_expression
  serialize_expression(expr: Expression): void {
    switch (expr.$) {
      case "Inline":
        this.serialize_inline_expression(expr._0);
        break;
      case "Select":
        this.serialize_select_expression(expr.selector, expr.variants);
        break;
    }
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:240 serialize_inline_expression
  serialize_inline_expression(expr: InlineExpression): void {
    switch (expr.$) {
      case "StringLiteral":
        this.writer.write_literal('"');
        this.writer.write_literal(expr.value.toString());
        this.writer.write_literal('"');
        break;
      case "NumberLiteral":
        this.writer.write_literal(expr.value.toString());
        break;
      case "VariableReference": {
        const value = expr.id.name;
        this.writer.write_literal("$");
        this.writer.write_literal(value.toString());
        break;
      }
      case "FunctionReference":
        this.writer.write_literal(expr.id.name.toString());
        this.serialize_call_arguments(expr.arguments);
        break;
      case "MessageReference": {
        this.writer.write_literal(expr.id.name.toString());

        const attr = expr.attribute;
        if (attr !== undefined) {
          this.writer.write_literal(".");
          this.writer.write_literal(attr.name.toString());
        }
        break;
      }
      case "TermReference": {
        this.writer.write_literal("-");
        this.writer.write_literal(expr.id.name.toString());

        const attr = expr.attribute;
        if (attr !== undefined) {
          this.writer.write_literal(".");
          this.writer.write_literal(attr.name.toString());
        }
        const args = expr.arguments;
        if (args !== undefined) {
          this.serialize_call_arguments(args);
        }
        break;
      }
      case "Placeable":
        this.writer.write_literal("{");
        this.serialize_expression(expr.expression);
        this.writer.write_literal("}");
        break;
    }
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:290 serialize_select_expression
  serialize_select_expression(selector: InlineExpression, variants: readonly Variant[]): void {
    this.serialize_inline_expression(selector);
    this.writer.write_literal(" ->");

    this.writer.newline();
    this.writer.indent();

    for (const variant of variants) {
      this.serialize_variant(variant);
      this.writer.newline();
    }

    this.writer.dedent();
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:309 serialize_variant
  serialize_variant(variant: Variant): void {
    if (variant.default) {
      this.writer.write_char_into_indent(0x2a /* '*' */);
    }

    this.writer.write_literal("[");
    this.serialize_variant_key(variant.key);
    this.writer.write_literal("]");
    this.serialize_pattern(variant.value);
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:320 serialize_variant_key
  serialize_variant_key(key: VariantKey): void {
    const value = key.$ === "NumberLiteral" ? key.value : key.name;
    this.writer.write_literal(value.toString());
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:328 serialize_call_arguments
  serialize_call_arguments(args: CallArguments): void {
    let argument_written = false;

    this.writer.write_literal("(");

    for (const positional of args.positional) {
      if (argument_written) {
        this.writer.write_literal(", ");
      }

      this.serialize_inline_expression(positional);
      argument_written = true;
    }

    for (const named of args.named) {
      if (argument_written) {
        this.writer.write_literal(", ");
      }

      this.writer.write_literal(named.name.name.toString());
      this.writer.write_literal(": ");
      this.serialize_inline_expression(named.value);
      argument_written = true;
    }

    this.writer.write_literal(")");
  }
}

export const debug_Serializer: Debug<Serializer> = (v, f) =>
  debug_struct(f, "Serializer", [
    ["writer", debug_TextWriter(v.writer, f)],
    ["options", debug_Options(v.options, f)],
    ["state", debug_State(v.state, f)],
  ]);

// crate: fluent-syntax-0.12.0/src/serializer.rs:358 starts_on_new_line
function Pattern_starts_on_new_line(self: Pattern): boolean {
  return !Pattern_has_leading_text_dot(self) && Pattern_is_multiline(self);
}

// crate: fluent-syntax-0.12.0/src/serializer.rs:362 is_multiline
function Pattern_is_multiline(self: Pattern): boolean {
  return self.elements.some((elem) => {
    switch (elem.$) {
      case "TextElement":
        return elem.value.find("\n") !== undefined;
      case "Placeable":
        return is_select_expr(elem.expression);
    }
  });
}

// crate: fluent-syntax-0.12.0/src/serializer.rs:369 has_leading_text_dot
function Pattern_has_leading_text_dot(self: Pattern): boolean {
  const first = self.elements[0];
  if (first !== undefined && first.$ === "TextElement") {
    return first.value.starts_with(".");
  } else {
    return false;
  }
}

// crate: fluent-syntax-0.12.0/src/serializer.rs:378 is_select_expr
function is_select_expr(expr: Expression): boolean {
  if (expr.$ === "Select") {
    return true;
  } else if (expr._0.$ === "Placeable") {
    return is_select_expr(expr._0.expression);
  } else {
    return false;
  }
}

/// Options for serializing an abstract syntax tree.
export interface Options {
  /// Whether invalid text fragments should be serialized, too.
  with_junk: boolean;
}

/** `Options::default()` (derived). */
export function Options_default(): Options {
  return { with_junk: false };
}

export const debug_Options: Debug<Options> = (v, f) => debug_struct(f, "Options", [["with_junk", debug_bool(v.with_junk, f)]]);

export interface State {
  wrote_non_junk_entry: boolean;
}

/** `State::default()` (derived). */
export function State_default(): State {
  return { wrote_non_junk_entry: false };
}

export const debug_State: Debug<State> = (v, f) => debug_struct(f, "State", [["wrote_non_junk_entry", debug_bool(v.wrote_non_junk_entry, f)]]);

export class TextWriter {
  constructor(
    public buffer: string,
    public indent_level: number,
  ) {}

  // crate: fluent-syntax-0.12.0/src/serializer.rs:407 indent
  indent(): void {
    this.indent_level += 1;
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:411 dedent
  dedent(): void {
    // PORT: `checked_sub(1).expect(..)`; `Option::expect` panics with the bare message.
    if (this.indent_level === 0) panic("Dedenting without a corresponding indent");
    this.indent_level = this.indent_level - 1;
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:418 write_indent
  write_indent(): void {
    for (let i = 0; i < this.indent_level; i++) {
      this.buffer += "    ";
    }
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:424 newline
  newline(): void {
    if (this.buffer.endsWith("\r")) {
      // handle rare edge case, where the trailing `\r` would get confused
      // as part of the line ending
      this.buffer += "\r";
    }
    this.buffer += "\n";
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:433 write_literal
  write_literal(item: string): void {
    if (this.buffer.endsWith("\n")) {
      // we've just added a newline, make sure it's properly indented
      this.write_indent();
    }

    this.buffer += item;
  }

  // crate: fluent-syntax-0.12.0/src/serializer.rs:442 write_char_into_indent
  write_char_into_indent(ch: number): void {
    if (this.buffer.endsWith("\n")) {
      this.write_indent();
    }
    // PORT: `String::pop` removes the last char (a whole code point, never half a surrogate pair).
    if (this.buffer.length > 0) {
      const lo = this.buffer.charCodeAt(this.buffer.length - 1);
      const n = lo >= 0xdc00 && lo <= 0xdfff && this.buffer.length >= 2 ? 2 : 1;
      this.buffer = this.buffer.slice(0, this.buffer.length - n);
    }
    this.buffer += String.fromCodePoint(ch);
  }
}

/** `TextWriter::default()` (derived). */
export function TextWriter_default(): TextWriter {
  return new TextWriter("", 0);
}

export const debug_TextWriter: Debug<TextWriter> = (v, f) =>
  debug_struct(f, "TextWriter", [
    ["buffer", debug_str(v.buffer)],
    ["indent_level", debug_int(v.indent_level, f)],
  ]);
