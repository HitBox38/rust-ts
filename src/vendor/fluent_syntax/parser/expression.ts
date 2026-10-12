// Port of fluent-syntax-0.12.0/src/parser/expression.rs.

import { is_ascii_alphabetic, is_ascii_digit } from "../../../std/char.ts";
import { Ok } from "../../../std/result.ts";
import type { Str } from "../../../std/str.ts";
import type * as ast from "../ast/mod.ts";
import { Parser, type Result } from "./core.ts";
import { error, ErrorKind } from "./errors.ts";
import { get_byte, get_current_byte } from "./macros.ts";
import { Slice_str, slice_eq } from "./slice.ts";

declare module "./core.ts" {
  interface Parser {
    get_expression(): Result<ast.Expression>;
    get_inline_expression(only_literal: boolean): Result<ast.InlineExpression>;
    get_call_arguments(): Result<ast.CallArguments | undefined>;
  }
}

// crate: fluent-syntax-0.12.0/src/parser/expression.rs:9 get_expression
Parser.prototype.get_expression = function (this: Parser): Result<ast.Expression> {
  const exp_r = this.get_inline_expression(false);
  if (exp_r.$ === "Err") return exp_r;
  const exp = exp_r._0;

  this.skip_blank();

  if (!this.is_current_byte(0x2d /* b'-' */) || !this.is_byte_at(0x3e /* b'>' */, this.ptr + 1)) {
    if (exp.$ === "TermReference") {
      const attribute = exp.attribute;
      if (attribute !== undefined) {
        return error(ErrorKind.TermAttributeAsPlaceable, this.ptr);
      }
    }
    return Ok({ $: "Inline", _0: exp });
  }

  switch (exp.$) {
    case "MessageReference": {
      const attribute = exp.attribute;
      if (attribute === undefined) {
        return error(ErrorKind.MessageReferenceAsSelector, this.ptr);
      } else {
        return error(ErrorKind.MessageAttributeAsSelector, this.ptr);
      }
    }
    case "TermReference": {
      const attribute = exp.attribute;
      if (attribute === undefined) {
        return error(ErrorKind.TermReferenceAsSelector, this.ptr);
      }
      break;
    }
    case "StringLiteral":
    case "NumberLiteral":
    case "VariableReference":
    case "FunctionReference":
      break;
    default: {
      return error(ErrorKind.ExpectedSimpleExpressionAsSelector, this.ptr);
    }
  }

  this.ptr += 2; // ->

  this.skip_blank_inline();
  if (!this.skip_eol()) {
    return error(
      {
        $: "ExpectedCharRange",
        range: "\n | \r\n",
      },
      this.ptr,
    );
  }
  this.skip_blank();

  const variants = this.get_variants();
  if (variants.$ === "Err") return variants;

  return Ok({
    $: "Select",
    selector: exp,
    variants: variants._0,
  });
};

// crate: fluent-syntax-0.12.0/src/parser/expression.rs:66 get_inline_expression
Parser.prototype.get_inline_expression = function (this: Parser, only_literal: boolean): Result<ast.InlineExpression> {
  const b0 = get_current_byte(this);
  if (b0 === 0x22 /* b'"' */) {
    this.ptr += 1; // "
    const start = this.ptr;
    let b: number | undefined;
    loop: while ((b = get_current_byte(this)) !== undefined) {
      switch (b) {
        case 0x5c /* b'\\' */: {
          const b = get_byte(this, this.ptr + 1);
          if (b === 0x5c /* b'\\' */ || b === 0x7b /* b'{' */ || b === 0x22 /* b'"' */) {
            this.ptr += 2;
          } else if (b === 0x75 /* b'u' */) {
            this.ptr += 2;
            const r = this.skip_unicode_escape_sequence(4);
            if (r.$ === "Err") return r;
          } else if (b === 0x55 /* b'U' */) {
            this.ptr += 2;
            const r = this.skip_unicode_escape_sequence(6);
            if (r.$ === "Err") return r;
          } else {
            // PORT: `b.unwrap_or(&b' ').to_string()` formats the *byte* (`u8: Display`), i.e. its
            // decimal value ("110" for `\n`), not the character.
            const seq = String(b ?? 0x20 /* b' ' */);
            return error({ $: "UnknownEscapeSequence", _0: seq }, this.ptr);
          }
          break;
        }
        case 0x22 /* b'"' */: {
          break loop;
        }
        case 0x0a /* b'\n' */: {
          return error(ErrorKind.UnterminatedStringLiteral, this.ptr);
        }
        default:
          this.ptr += 1;
      }
    }

    const q = this.expect_byte(0x22 /* b'"' */);
    if (q.$ === "Err") return q;
    const slice = Slice_str.slice(this.source, start, this.ptr - 1);
    return Ok({ $: "StringLiteral", value: slice });
  } else if (b0 !== undefined && is_ascii_digit(b0)) {
    const num = this.get_number_literal();
    if (num.$ === "Err") return num;
    return Ok({ $: "NumberLiteral", value: num._0 });
  } else if (b0 === 0x2d /* b'-' */ && !only_literal) {
    this.ptr += 1; // -
    if (this.is_identifier_start()) {
      this.ptr += 1;
      const id = this.get_identifier_unchecked();
      const attribute = this.get_attribute_accessor();
      if (attribute.$ === "Err") return attribute;
      const arguments_ = this.get_call_arguments();
      if (arguments_.$ === "Err") return arguments_;
      return Ok({
        $: "TermReference",
        id,
        attribute: attribute._0,
        arguments: arguments_._0,
      });
    } else {
      this.ptr -= 1;
      const num = this.get_number_literal();
      if (num.$ === "Err") return num;
      return Ok({ $: "NumberLiteral", value: num._0 });
    }
  } else if (b0 === 0x24 /* b'$' */ && !only_literal) {
    this.ptr += 1; // $
    const id = this.get_identifier();
    if (id.$ === "Err") return id;
    return Ok({ $: "VariableReference", id: id._0 });
  } else if (b0 !== undefined && is_ascii_alphabetic(b0)) {
    this.ptr += 1;
    const id = this.get_identifier_unchecked();
    const arguments_r = this.get_call_arguments();
    if (arguments_r.$ === "Err") return arguments_r;
    const arguments_ = arguments_r._0;
    if (arguments_ !== undefined) {
      if (!Parser.is_callee(id.name)) {
        return error(ErrorKind.ForbiddenCallee, this.ptr);
      }

      return Ok({ $: "FunctionReference", id, arguments: arguments_ });
    } else {
      const attribute = this.get_attribute_accessor();
      if (attribute.$ === "Err") return attribute;
      return Ok({ $: "MessageReference", id, attribute: attribute._0 });
    }
  } else if (b0 === 0x7b /* b'{' */ && !only_literal) {
    this.ptr += 1; // {
    const exp = this.get_placeable();
    if (exp.$ === "Err") return exp;
    return Ok({
      $: "Placeable",
      expression: exp._0,
    });
  } else if (only_literal) {
    return error(ErrorKind.ExpectedLiteral, this.ptr);
  } else {
    return error(ErrorKind.ExpectedInlineExpression, this.ptr);
  }
};

// crate: fluent-syntax-0.12.0/src/parser/expression.rs:159 get_call_arguments
Parser.prototype.get_call_arguments = function (this: Parser): Result<ast.CallArguments | undefined> {
  this.skip_blank();
  if (!this.take_byte_if(0x28 /* b'(' */)) {
    return Ok(undefined);
  }

  const positional: ast.InlineExpression[] = [];
  const named: ast.NamedArgument[] = [];
  const argument_names: Str[] = [];

  this.skip_blank();

  while (this.ptr < this.length) {
    if (this.is_current_byte(0x29 /* b')' */)) {
      break;
    }

    const expr_r = this.get_inline_expression(false);
    if (expr_r.$ === "Err") return expr_r;
    const expr = expr_r._0;

    if (expr.$ === "MessageReference" && expr.attribute === undefined) {
      const id = expr.id;
      this.skip_blank();
      if (this.is_current_byte(0x3a /* b':' */)) {
        if (argument_names.some((n) => slice_eq(n, id.name))) {
          return error({ $: "DuplicatedNamedArgument", _0: id.name.toString() }, this.ptr);
        }
        this.ptr += 1;
        this.skip_blank();
        const val = this.get_inline_expression(true);
        if (val.$ === "Err") return val;

        argument_names.push(id.name);
        named.push({
          name: {
            name: id.name,
          },
          value: val._0,
        });
      } else {
        if (argument_names.length !== 0) {
          return error(ErrorKind.PositionalArgumentFollowsNamed, this.ptr);
        }
        positional.push(expr);
      }
    } else {
      if (argument_names.length !== 0) {
        return error(ErrorKind.PositionalArgumentFollowsNamed, this.ptr);
      }
      positional.push(expr);
    }

    this.skip_blank();
    this.take_byte_if(0x2c /* b',' */);
    this.skip_blank();
  }

  const close = this.expect_byte(0x29 /* b')' */);
  if (close.$ === "Err") return close;

  return Ok({ positional, named });
};
