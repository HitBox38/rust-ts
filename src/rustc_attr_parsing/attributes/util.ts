// Port of compiler/rustc_attr_parsing/src/attributes/util.rs.
import type { AttrItem } from "../../rustc_ast/lib.ts";
import { RustcVersion } from "../../rustc_ast/attr/version.ts";
import { is_builtin_attr_name } from "../../rustc_feature/lib.ts";
import { u32_from_str, usize_from_str } from "../../rustc_session/options.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { Limit } from "../../rustc_structures/limit.ts";
import { panic } from "../../std/panic.ts";
import { AcceptContext, ExpectStringLiteral } from "../context.ts";
import { LimitInvalid_diagnostic } from "../diagnostics.ts";
import { type ArgParser, MetaItemOrLitParser, type NameValueParser } from "../parser.ts";

// PORT: `str::parse::<u16>()`: `u32::from_str`, then values above `u16::MAX` are `PosOverflow`
// (core reports the overflow as soon as the accumulated value exceeds the type's max, which yields the
// same error kind).
function u16_parse(s: string): number | undefined {
  const r = u32_from_str(s);
  if (r.$ === "Err" || r._0 > 0xffff) return undefined;
  return r._0;
}

/// Parse a rustc version number written inside string literal in an attribute,
/// like appears in `since = "1.0.0"`. Suffixes like "-dev" and "-nightly" are
/// not accepted in this position, unlike when parsing `CFG_RELEASE`.
// rustc: compiler/rustc_attr_parsing/src/attributes/util.rs:16 parse_version
export function parse_version(s: Symbol): RustcVersion | undefined {
  const components = Symbol.as_str(s).split("-");
  const d = components[0]!;
  if (components.length > 1) {
    return undefined;
  }
  // `d.splitn(3, '.')`
  const parts = d.split(".");
  const digits = parts.length > 3 ? [parts[0]!, parts[1]!, parts.slice(2).join(".")] : parts;
  const major = u16_parse(digits[0]!);
  if (major === undefined) return undefined;
  if (digits[1] === undefined) return undefined;
  const minor = u16_parse(digits[1]);
  if (minor === undefined) return undefined;
  const patch = u16_parse(digits[2] ?? "0");
  if (patch === undefined) return undefined;
  return new RustcVersion(major, minor, patch);
}

// rustc: compiler/rustc_attr_parsing/src/attributes/util.rs:29 is_builtin_attr
export function is_builtin_attr(attr: AttrItem): boolean {
  const name = attr.name();
  return name !== undefined && is_builtin_attr_name(name);
}

/// Parse a single integer.
///
/// Used by attributes that take a single integer as argument, such as
/// `#[link_ordinal]`.
/// `cx` is the context given to the attribute.
/// `args` is the parser for the attribute arguments.
// rustc: compiler/rustc_attr_parsing/src/attributes/util.rs:39 parse_single_integer
export function parse_single_integer(cx: AcceptContext, args: ArgParser): bigint | undefined {
  const single = cx.expect_single_element_list(args, cx.attr_span);
  if (single === undefined) return undefined;
  const lit = MetaItemOrLitParser.as_lit(single);
  if (lit === undefined) {
    cx.adcx().expected_integer_literal(MetaItemOrLitParser.span(single));
    return undefined;
  }
  const kind = lit.kind;
  if (kind.$ !== "Int") {
    cx.adcx().expected_integer_literal(MetaItemOrLitParser.span(single));
    return undefined;
  }
  const num = kind._0;
  return num;
}

declare module "../context.ts" {
  interface AcceptContext {
    parse_limit_int(nv: NameValueParser): Limit | undefined;
  }
}

// rustc: compiler/rustc_attr_parsing/src/attributes/util.rs:56 parse_limit_int
function parse_limit_int(this: AcceptContext, nv: NameValueParser): Limit | undefined {
  const limit = this.expect_string_literal(nv, ExpectStringLiteral.NameValueParser);
  if (limit === undefined) return undefined;

  let error_str: string;
  const r = usize_from_str(Symbol.as_str(limit));
  if (r.$ === "Ok") {
    return Limit.new(r._0);
  }
  switch (r._0) {
    case "PosOverflow":
      error_str = "`limit` is too large";
      break;
    case "Empty":
      error_str = "`limit` must be a non-negative integer";
      break;
    case "InvalidDigit":
      error_str = "not a valid integer";
      break;
    case "NegOverflow":
      panic(
        "`limit` should never negatively overflow since we're parsing into a usize and we'd get Empty instead",
      );
    case "Zero":
      panic("zero is a valid `limit` so should have returned Ok() when parsing");
  }

  this.shared.emit_err(LimitInvalid_diagnostic({ span: this.attr_span, value_span: nv.value_span, error_str }));

  return undefined;
}

// PORT: the `impl AcceptContext` fn is installed by `install()`, called from rustc_attr_parsing/lib.ts:
// attribute parser modules import this module while context.ts is still evaluating its imports (see
// target_checking.ts).
export function install(): void {
  AcceptContext.prototype.parse_limit_int = parse_limit_int;
}
