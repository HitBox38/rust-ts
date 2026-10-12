// Port of fluent-syntax-0.12.0/src/parser/core.rs.
//
// PORT: `Parser<S>` is instantiated with `S = &str` only (`source: Str`); `self.source.slice(a..b)`
// is `Slice_str.slice(this.source, a, b)`. Methods defined in the other parser files (comment.rs,
// expression.rs, helper.rs, pattern.rs, runtime.rs) are added to `Parser.prototype` by the mirrored
// TS files, which `parser/mod.ts` imports for their side effects (PORTING.md §5). This module only
// imports types from them, so it has no runtime import cycle.
// PORT: `comment::Level` variants are matched as their string literals ("Regular", ...) so this
// module needs no runtime import of comment.ts.

import { is_ascii_alphanumeric } from "../../../std/char.ts";
import { unreachable } from "../../../std/panic.ts";
import { Err, Ok, type Result as StdResult } from "../../../std/result.ts";
import type { Str } from "../../../std/str.ts";
import type * as ast from "../ast/mod.ts";
import { error, ErrorKind, type ParserError } from "./errors.ts";
import { get_byte, get_current_byte } from "./macros.ts";
import { Slice_str } from "./slice.ts";

export type Result<T> = StdResult<T, ParserError>;

export class Parser {
  constructor(
    public source: Str,
    public ptr: number,
    public length: number,
  ) {}

  // crate: fluent-syntax-0.12.0/src/parser/core.rs:20 new
  static new(source: Str): Parser {
    const length = source.len();
    return new Parser(source, 0, length);
  }

  // crate: fluent-syntax-0.12.0/src/parser/core.rs:29 parse
  parse(): StdResult<ast.Resource, [ast.Resource, ParserError[]]> {
    const errors: ParserError[] = [];

    const body: ast.Entry[] = [];

    this.skip_blank_block();
    let last_comment: ast.Comment | undefined = undefined;
    let last_blank_count = 0;

    while (this.ptr < this.length) {
      const entry_start = this.ptr;
      const entry = this.get_entry(entry_start);

      // PORT: `last_comment.take()`
      const comment = last_comment;
      last_comment = undefined;
      if (comment !== undefined) {
        if (entry.$ === "Ok" && entry._0.$ === "Message" && last_blank_count < 2) {
          const msg = entry._0._0;
          msg.comment = comment;
        } else if (entry.$ === "Ok" && entry._0.$ === "Term" && last_blank_count < 2) {
          const term = entry._0._0;
          term.comment = comment;
        } else {
          body.push({ $: "Comment", _0: comment });
        }
      }

      if (entry.$ === "Ok" && entry._0.$ === "Comment") {
        const comment = entry._0._0;
        last_comment = comment;
      } else if (entry.$ === "Ok") {
        body.push(entry._0);
      } else {
        const err = entry._0;
        this.skip_to_next_entry_start();
        err.slice = { start: entry_start, end: this.ptr };
        errors.push(err);
        const content = Slice_str.slice(this.source, entry_start, this.ptr);
        body.push({ $: "Junk", content });
      }
      last_blank_count = this.skip_blank_block();
    }

    if (last_comment !== undefined) {
      body.push({ $: "Comment", _0: last_comment });
      last_comment = undefined;
    }
    if (errors.length === 0) {
      return Ok({ body });
    } else {
      return Err<[ast.Resource, ParserError[]]>([{ body }, errors]);
    }
  }

  // crate: fluent-syntax-0.12.0/src/parser/core.rs:86 get_entry
  get_entry(entry_start: number): Result<ast.Entry> {
    let entry: ast.Entry;
    switch (get_current_byte(this)) {
      case 0x23 /* b'#' */: {
        const r = this.get_comment();
        if (r.$ === "Err") return r;
        const [comment, level] = r._0;
        switch (level) {
          case "Regular":
            entry = { $: "Comment", _0: comment };
            break;
          case "Group":
            entry = { $: "GroupComment", _0: comment };
            break;
          case "Resource":
            entry = { $: "ResourceComment", _0: comment };
            break;
          case "None":
            unreachable();
        }
        break;
      }
      case 0x2d /* b'-' */: {
        const r = this.get_term(entry_start);
        if (r.$ === "Err") return r;
        entry = { $: "Term", _0: r._0 };
        break;
      }
      default: {
        const r = this.get_message(entry_start);
        if (r.$ === "Err") return r;
        entry = { $: "Message", _0: r._0 };
      }
    }
    return Ok(entry);
  }

  // crate: fluent-syntax-0.12.0/src/parser/core.rs:103 get_message
  get_message(entry_start: number): Result<ast.Message> {
    const id_r = this.get_identifier();
    if (id_r.$ === "Err") return id_r;
    const id = id_r._0;
    this.skip_blank_inline();
    const eq = this.expect_byte(0x3d /* b'=' */);
    if (eq.$ === "Err") return eq;
    const pattern_r = this.get_pattern();
    if (pattern_r.$ === "Err") return pattern_r;
    const pattern = pattern_r._0;

    this.skip_blank_block();

    const attributes = this.get_attributes();

    if (pattern === undefined && attributes.length === 0) {
      const entry_id = id.name.toString();
      return error({ $: "ExpectedMessageField", entry_id }, entry_start, this.ptr);
    }

    return Ok({
      id,
      value: pattern,
      attributes,
      comment: undefined,
    });
  }

  // crate: fluent-syntax-0.12.0/src/parser/core.rs:129 get_term
  get_term(entry_start: number): Result<ast.Term> {
    const dash = this.expect_byte(0x2d /* b'-' */);
    if (dash.$ === "Err") return dash;
    const id_r = this.get_identifier();
    if (id_r.$ === "Err") return id_r;
    const id = id_r._0;
    this.skip_blank_inline();
    const eq = this.expect_byte(0x3d /* b'=' */);
    if (eq.$ === "Err") return eq;
    this.skip_blank_inline();

    const value_r = this.get_pattern();
    if (value_r.$ === "Err") return value_r;
    const value = value_r._0;

    this.skip_blank_block();

    const attributes = this.get_attributes();

    if (value !== undefined) {
      return Ok({
        id,
        value,
        attributes,
        comment: undefined,
      });
    } else {
      return error(
        {
          $: "ExpectedTermField",
          entry_id: id.name.toString(),
        },
        entry_start,
        this.ptr,
      );
    }
  }

  // crate: fluent-syntax-0.12.0/src/parser/core.rs:159 get_attributes
  get_attributes(): ast.Attribute[] {
    const attributes: ast.Attribute[] = [];

    for (;;) {
      const line_start = this.ptr;
      this.skip_blank_inline();
      if (!this.take_byte_if(0x2e /* b'.' */)) {
        this.ptr = line_start;
        break;
      }

      const attr = this.get_attribute();
      if (attr.$ === "Ok") {
        attributes.push(attr._0);
      } else {
        this.ptr = line_start;
        break;
      }
    }
    return attributes;
  }

  // crate: fluent-syntax-0.12.0/src/parser/core.rs:180 get_attribute
  get_attribute(): Result<ast.Attribute> {
    const id_r = this.get_identifier();
    if (id_r.$ === "Err") return id_r;
    const id = id_r._0;
    this.skip_blank_inline();
    const eq = this.expect_byte(0x3d /* b'=' */);
    if (eq.$ === "Err") return eq;
    const pattern_r = this.get_pattern();
    if (pattern_r.$ === "Err") return pattern_r;
    const pattern = pattern_r._0;

    if (pattern !== undefined) {
      return Ok({ id, value: pattern });
    } else {
      return error(ErrorKind.MissingValue, this.ptr);
    }
  }

  // crate: fluent-syntax-0.12.0/src/parser/core.rs:192 get_identifier_unchecked
  get_identifier_unchecked(): ast.Identifier {
    let ptr = this.ptr;

    for (;;) {
      const b = get_byte(this, ptr);
      if (!(b !== undefined && (is_ascii_alphanumeric(b) || b === 0x2d /* b'-' */ || b === 0x5f) /* b'_' */)) break;
      ptr += 1;
    }

    const name = Slice_str.slice(this.source, this.ptr - 1, ptr);
    this.ptr = ptr;

    return { name };
  }

  // crate: fluent-syntax-0.12.0/src/parser/core.rs:206 get_identifier
  get_identifier(): Result<ast.Identifier> {
    if (!this.is_identifier_start()) {
      return error(
        {
          $: "ExpectedCharRange",
          range: "a-zA-Z",
        },
        this.ptr,
      );
    }
    this.ptr += 1;
    return Ok(this.get_identifier_unchecked());
  }

  // crate: fluent-syntax-0.12.0/src/parser/core.rs:219 get_attribute_accessor
  get_attribute_accessor(): Result<ast.Identifier | undefined> {
    if (this.take_byte_if(0x2e /* b'.' */)) {
      const ident = this.get_identifier();
      if (ident.$ === "Err") return ident;
      return Ok(ident._0);
    } else {
      return Ok(undefined);
    }
  }

  // crate: fluent-syntax-0.12.0/src/parser/core.rs:228 get_variant_key
  get_variant_key(): Result<ast.VariantKey> {
    this.skip_blank();

    let key: ast.VariantKey;
    if (this.is_number_start()) {
      const value = this.get_number_literal();
      if (value.$ === "Err") return value;
      key = {
        $: "NumberLiteral",
        value: value._0,
      };
    } else {
      const id = this.get_identifier();
      if (id.$ === "Err") return id;
      key = {
        $: "Identifier",
        name: id._0.name,
      };
    }

    this.skip_blank();

    const close = this.expect_byte(0x5d /* b']' */);
    if (close.$ === "Err") return close;

    return Ok(key);
  }

  // crate: fluent-syntax-0.12.0/src/parser/core.rs:248 get_variants
  get_variants(): Result<ast.Variant[]> {
    const variants: ast.Variant[] = [];
    let has_default = false;

    for (;;) {
      const default_ = this.take_byte_if(0x2a /* b'*' */);
      if (default_) {
        if (has_default) {
          return error(ErrorKind.MultipleDefaultVariants, this.ptr);
        } else {
          has_default = true;
        }
      }

      if (!this.take_byte_if(0x5b /* b'[' */)) {
        break;
      }

      const key_r = this.get_variant_key();
      if (key_r.$ === "Err") return key_r;
      const key = key_r._0;

      const value_r = this.get_pattern();
      if (value_r.$ === "Err") return value_r;
      const value = value_r._0;

      if (value !== undefined) {
        variants.push({
          key,
          value,
          default: default_,
        });
        this.skip_blank();
      } else {
        return error(ErrorKind.MissingValue, this.ptr);
      }
    }

    if (has_default) {
      return Ok(variants);
    } else {
      return error(ErrorKind.MissingDefaultVariant, this.ptr);
    }
  }

  // crate: fluent-syntax-0.12.0/src/parser/core.rs:289 get_placeable
  get_placeable(): Result<ast.Expression> {
    this.skip_blank();
    const exp_r = this.get_expression();
    if (exp_r.$ === "Err") return exp_r;
    const exp = exp_r._0;
    this.skip_blank_inline();
    const close = this.expect_byte(0x7d /* b'}' */);
    if (close.$ === "Err") return close;

    let invalid_expression_found: boolean;
    if (exp.$ === "Inline" && exp._0.$ === "TermReference") {
      const attribute = exp._0.attribute;
      invalid_expression_found = attribute !== undefined;
    } else {
      invalid_expression_found = false;
    }
    if (invalid_expression_found) {
      return error(ErrorKind.TermAttributeAsPlaceable, this.ptr);
    }

    return Ok(exp);
  }
}
