// Port of compiler/rustc_ast/src/util/literal.rs
//! Code related to parsing literals.
//
// Types and derived Debug impls are generated into literal.gen.ts (tools/codegen/types.ts).
//
// PORT: `impl ast::LitKind` and `impl MetaItemLit` live in this file upstream.
// - `ast::LitKind` has no companion value in ast.ts, so this module exports one:
//   `LitKind.from_token_lit(..)` (import `LitKind` from here for the methods).
// - `MetaItemLit` is a generated class: its statics are assigned onto the class and the class is
//   re-exported here with the extended type; `as_token_lit` goes on the prototype.
// - `debug!` (tracing) calls are kept as comments.
import * as ast from "../ast.ts";
import { Lit as TokenLit, LitKind as TokenLitKind, type Token } from "../token.ts";
import { FloatTy, IntTy, UintTy } from "../../rustc_ast_ir/lib.ts";
import { type Span } from "../../rustc_span/lib.ts";
import { ByteSymbol, kw, Symbol, sym } from "../../rustc_span/symbol.ts";
import { len_utf8, to_digit } from "../../std/char.ts";
import { assert, panic } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { Str, utf8 } from "../../std/str.ts";
import {
  EscapeError,
  unescape_byte,
  unescape_byte_str,
  unescape_c_str,
  unescape_char,
  unescape_str,
} from "../../vendor/rustc_literal_escaper/lib.ts";
import type { LitError } from "./literal.gen.ts";

export * from "./literal.gen.ts";

// Escapes a string, represented as a symbol. Reuses the original symbol,
// avoiding interning, if no changes are required.
// rustc: compiler/rustc_ast/src/util/literal.rs:17 escape_string_symbol
export function escape_string_symbol(symbol: Symbol): Symbol {
  const s = Symbol.as_str(symbol);

  // rustc: compiler/rustc_ast/src/util/literal.rs:20 requires_escape
  function requires_escape(b: number): boolean {
    if (b === 0x5c || b === 0x27 || b === 0x22) return true;
    if (b >= 0x20 && b <= 0x7e) return false;
    return true;
  }

  // Fast-path: if we don't need escaping, just return the original symbol
  const bytes = utf8(s);
  const position = bytes.findIndex(requires_escape);
  if (position === -1) {
    return symbol;
  }

  // At this point we know that we need to escape something in `suffix`
  // PORT: the bytes before `position` are printable ASCII, so the byte index is the UTF-16 index.
  const prefix = s.slice(0, position);
  const suffix = s.slice(position);

  // We set the capacity to the original size + 1, because the resulting string will be at least
  // one character larger than the original, because of escaping.
  let escaped = "";
  escaped += prefix;

  // Don't use escape_default() here, because using it is slower than escaping manually.
  for (const c of suffix) {
    const cp = c.codePointAt(0)!;
    switch (c) {
      case "\t":
        escaped += "\\t";
        break;
      case "\r":
        escaped += "\\r";
        break;
      case "\n":
        escaped += "\\n";
        break;
      case "\\":
        escaped += "\\\\";
        break;
      case "'":
        escaped += "\\'";
        break;
      case '"':
        escaped += '\\"';
        break;
      default:
        if (cp >= 0x20 && cp <= 0x7e) {
          escaped += c;
        } else {
          escaped += `\\u{${cp.toString(16)}}`;
        }
    }
  }
  return Symbol.intern(escaped);
}

// Escapes a char.
// rustc: compiler/rustc_ast/src/util/literal.rs:58 escape_char_symbol
export function escape_char_symbol(ch: number): Symbol {
  const s = char_escape_default(ch);
  return Symbol.intern(s);
}

// Escapes a byte string.
// rustc: compiler/rustc_ast/src/util/literal.rs:64 escape_byte_str_symbol
export function escape_byte_str_symbol(bytes: Uint8Array): Symbol {
  let s = "";
  for (const b of bytes) s += ascii_escape_default(b);
  return Symbol.intern(s);
}

/** `char::escape_default` */
function char_escape_default(c: number): string {
  switch (c) {
    case 0x09:
      return "\\t";
    case 0x0d:
      return "\\r";
    case 0x0a:
      return "\\n";
    case 0x5c:
    case 0x27:
    case 0x22:
      return "\\" + String.fromCodePoint(c);
    default:
      if (c >= 0x20 && c <= 0x7e) return String.fromCodePoint(c);
      return `\\u{${c.toString(16)}}`;
  }
}

/** `core::ascii::escape_default` (also what `<[u8]>::escape_ascii` yields per byte). */
function ascii_escape_default(b: number): string {
  switch (b) {
    case 0x09:
      return "\\t";
    case 0x0d:
      return "\\r";
    case 0x0a:
      return "\\n";
    case 0x5c:
    case 0x27:
    case 0x22:
      return "\\" + String.fromCharCode(b);
    default:
      if (b >= 0x20 && b <= 0x7e) return String.fromCharCode(b);
      return `\\x${b.toString(16).padStart(2, "0")}`;
  }
}

export type LitKind = ast.LitKind;
export const LitKind = {
  /// Converts literal token into a semantic literal.
  // rustc: compiler/rustc_ast/src/util/literal.rs:80 from_token_lit
  from_token_lit(lit: TokenLit): Result<LitKind, LitError> {
    const { kind, symbol, suffix } = lit;
    if (suffix !== undefined && !TokenLitKind.may_have_suffix(kind)) {
      return Err({ $: "InvalidSuffix", _0: suffix });
    }

    // For byte/char/string literals, chars and escapes have already been
    // checked in the lexer (in `cook_lexer_literal`). So we can assume all
    // chars and escapes are valid here.
    let r: LitKind;
    switch (kind.$) {
      case "Bool":
        assert(Symbol.is_bool_lit(symbol), "assertion failed: symbol.is_bool_lit()");
        r = { $: "Bool", _0: symbol === kw.True };
        break;
      case "Byte": {
        const res = unescape_byte(Str.from(Symbol.as_str(symbol)));
        if (res.$ === "Err") panic("failed to unescape byte literal");
        return Ok<LitKind>({ $: "Byte", _0: res._0 });
      }
      case "Char": {
        const res = unescape_char(Str.from(Symbol.as_str(symbol)));
        if (res.$ === "Err") panic("failed to unescape char literal");
        return Ok<LitKind>({ $: "Char", _0: res._0 });
      }

      // There are some valid suffixes for integer and float literals,
      // so all the handling is done internally.
      case "Integer":
        return integer_lit(symbol, suffix);
      case "Float":
        return float_lit(symbol, suffix);

      case "Str": {
        // If there are no characters requiring special treatment we can
        // reuse the symbol from the token. Otherwise, we must generate a
        // new symbol because the string in the LitKind is different to the
        // string in the token.
        const s = Symbol.as_str(symbol);
        // Vanilla strings are so common we optimize for the common case where no chars
        // requiring special behaviour are present.
        let symbol_: Symbol;
        if (s.includes("\\")) {
          let buf = "";
          // Force-inlining here is aggressive but the closure is
          // called on every char in the string, so it can be hot in
          // programs with many long strings containing escapes.
          unescape_str(Str.from(s), (_start, _end, res) => {
            if (res.$ === "Ok") {
              buf += String.fromCodePoint(res._0);
            } else {
              assert(!EscapeError.is_fatal(res._0), "failed to unescape string literal");
            }
          });
          symbol_ = Symbol.intern(buf);
        } else {
          symbol_ = symbol;
        }
        r = { $: "Str", _0: symbol_, _1: ast.StrStyle.Cooked };
        break;
      }
      case "StrRaw":
        // Raw strings have no escapes so no work is needed here.
        r = { $: "Str", _0: symbol, _1: { $: "Raw", _0: kind._0 } };
        break;
      case "ByteStr": {
        const s = Symbol.as_str(symbol);
        const buf: number[] = [];
        unescape_byte_str(Str.from(s), (_start, _end, res) => {
          if (res.$ === "Ok") {
            buf.push(res._0);
          } else {
            assert(!EscapeError.is_fatal(res._0), "failed to unescape string literal");
          }
        });
        r = { $: "ByteStr", _0: ByteSymbol.intern(Uint8Array.from(buf)), _1: ast.StrStyle.Cooked };
        break;
      }
      case "ByteStrRaw": {
        // Raw byte strings have no escapes so no work is needed here.
        const buf = utf8(Symbol.as_str(symbol));
        r = { $: "ByteStr", _0: ByteSymbol.intern(buf), _1: { $: "Raw", _0: kind._0 } };
        break;
      }
      case "CStr": {
        const s = Symbol.as_str(symbol);
        const buf: number[] = [];
        unescape_c_str(Str.from(s), (_span_start, _span_end, res) => {
          if (res.$ === "Ok" && res._0.$ === "Char") {
            const c = res._0._0;
            push_utf8(buf, c);
          } else if (res.$ === "Ok" && res._0.$ === "HighByte") {
            buf.push(res._0._0);
          } else if (res.$ === "Err") {
            assert(!EscapeError.is_fatal(res._0), "failed to unescape C string literal");
          }
        });
        buf.push(0);
        r = { $: "CStr", _0: ByteSymbol.intern(Uint8Array.from(buf)), _1: ast.StrStyle.Cooked };
        break;
      }
      case "CStrRaw": {
        // Raw strings have no escapes so we can convert the symbol
        // directly to a `Arc<u8>` after appending the terminating NUL
        // char.
        const buf = Array.from(utf8(Symbol.as_str(symbol)));
        buf.push(0);
        r = { $: "CStr", _0: ByteSymbol.intern(Uint8Array.from(buf)), _1: { $: "Raw", _0: kind._0 } };
        break;
      }
      case "Err":
        r = { $: "Err", _0: kind._0 };
        break;
    }
    return Ok(r);
  },
};

/** `char::encode_utf8` appended to a byte buffer. */
function push_utf8(buf: number[], c: number): void {
  const n = len_utf8(c);
  if (n === 1) {
    buf.push(c);
  } else if (n === 2) {
    buf.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
  } else if (n === 3) {
    buf.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  } else {
    buf.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
}

/** `str::from_utf8(bytes).unwrap()` */
function from_utf8_unwrap(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return panic("called `Result::unwrap()` on an `Err` value: Utf8Error");
  }
}

// impl fmt::Display for LitKind
// rustc: compiler/rustc_ast/src/util/literal.rs:190 fmt
export function display_LitKind(self: LitKind): string {
  let f = "";
  switch (self.$) {
    case "Byte": {
      const b = ascii_escape_default(self._0);
      f += `b'${b}'`;
      break;
    }
    case "Char":
      f += `'${Symbol.as_str(escape_char_symbol(self._0))}'`;
      break;
    case "Str":
      if (self._1.$ === "Cooked") {
        f += `"${Symbol.as_str(escape_string_symbol(self._0))}"`;
      } else {
        const delim = "#".repeat(self._1._0);
        f += `r${delim}"${Symbol.as_str(self._0)}"${delim}`;
      }
      break;
    case "ByteStr":
      if (self._1.$ === "Cooked") {
        f += `b"${Symbol.as_str(escape_byte_str_symbol(ByteSymbol.as_byte_str(self._0)))}"`;
      } else {
        // Unwrap because raw byte string literals can only contain ASCII.
        const symbol = from_utf8_unwrap(ByteSymbol.as_byte_str(self._0));
        const delim = "#".repeat(self._1._0);
        f += `br${delim}"${symbol}"${delim}`;
      }
      break;
    case "CStr":
      if (self._1.$ === "Cooked") {
        f += `c"${Symbol.as_str(escape_byte_str_symbol(ByteSymbol.as_byte_str(self._0)))}"`;
      } else {
        // This can only be valid UTF-8.
        const symbol = from_utf8_unwrap(ByteSymbol.as_byte_str(self._0));
        const delim = "#".repeat(self._1._0);
        f += `cr${delim}"${symbol}"${delim}`;
      }
      break;
    case "Int": {
      f += self._0.toString();
      const ty = self._1;
      switch (ty.$) {
        case "Unsigned":
          f += UintTy.name_str(ty._0);
          break;
        case "Signed":
          f += IntTy.name_str(ty._0);
          break;
        case "Unsuffixed":
          break;
      }
      break;
    }
    case "Float": {
      f += Symbol.as_str(self._0);
      const ty = self._1;
      switch (ty.$) {
        case "Suffixed":
          f += FloatTy.name_str(ty._0);
          break;
        case "Unsuffixed":
          break;
      }
      break;
    }
    case "Bool":
      f += self._0 ? "true" : "false";
      break;
    case "Err":
      // This only shows up in places like `-Zunpretty=hir` output, so we
      // don't bother to produce something useful.
      f += "<bad-literal>";
      break;
  }

  return f;
}

declare module "../ast.gen.ts" {
  interface MetaItemLit {
    as_token_lit(): TokenLit;
  }
}

export type MetaItemLit = ast.MetaItemLit;
// PORT: statics of the generated `MetaItemLit` class, attached below in upstream order.
export const MetaItemLit = ast.MetaItemLit as typeof ast.MetaItemLit & {
  from_token_lit: (token_lit: TokenLit, span: Span) => Result<MetaItemLit, LitError>;
  from_token: (token: Token) => MetaItemLit | undefined;
};

/// Converts a token literal into a meta item literal.
// rustc: compiler/rustc_ast/src/util/literal.rs:254 from_token_lit
MetaItemLit.from_token_lit = function (token_lit: TokenLit, span: Span): Result<MetaItemLit, LitError> {
  const kind = LitKind.from_token_lit(token_lit);
  if (kind.$ === "Err") return kind;
  return Ok(new ast.MetaItemLit(token_lit.symbol, token_lit.suffix, kind._0, span));
};

/// Cheaply converts a meta item literal into a token literal.
// rustc: compiler/rustc_ast/src/util/literal.rs:264 as_token_lit
ast.MetaItemLit.prototype.as_token_lit = function (this: MetaItemLit): TokenLit {
  let kind: TokenLitKind;
  const k = this.kind;
  switch (k.$) {
    case "Bool":
      kind = TokenLitKind.Bool;
      break;
    case "Str":
      kind = k._1.$ === "Cooked" ? TokenLitKind.Str : { $: "StrRaw", _0: k._1._0 };
      break;
    case "ByteStr":
      kind = k._1.$ === "Cooked" ? TokenLitKind.ByteStr : { $: "ByteStrRaw", _0: k._1._0 };
      break;
    case "CStr":
      kind = k._1.$ === "Cooked" ? TokenLitKind.CStr : { $: "CStrRaw", _0: k._1._0 };
      break;
    case "Byte":
      kind = TokenLitKind.Byte;
      break;
    case "Char":
      kind = TokenLitKind.Char;
      break;
    case "Int":
      kind = TokenLitKind.Integer;
      break;
    case "Float":
      kind = TokenLitKind.Float;
      break;
    case "Err":
      kind = { $: "Err", _0: k._0 };
      break;
  }

  return TokenLit.new(kind, this.symbol, this.suffix);
};

/// Converts an arbitrary token into meta item literal.
// rustc: compiler/rustc_ast/src/util/literal.rs:284 from_token
MetaItemLit.from_token = function (token: Token): MetaItemLit | undefined {
  const token_lit = TokenLit.from_token(token);
  if (token_lit === undefined) return undefined;
  const r = MetaItemLit.from_token_lit(token_lit, token.span);
  return r.$ === "Ok" ? r._0 : undefined;
};

// rustc: compiler/rustc_ast/src/util/literal.rs:290 strip_underscores
function strip_underscores(symbol: Symbol): Symbol {
  // Do not allocate a new string unless necessary.
  const s = Symbol.as_str(symbol);
  if (s.includes("_")) {
    const s_ = s.replaceAll("_", "");
    return Symbol.intern(s_);
  }
  return symbol;
}

// rustc: compiler/rustc_ast/src/util/literal.rs:301 filtered_float_lit
function filtered_float_lit(symbol: Symbol, suffix: Symbol | undefined, base: number): Result<LitKind, LitError> {
  // debug!("filtered_float_lit: {:?}, {:?}, {:?}", symbol, suffix, base);
  if (base !== 10) {
    return Err({ $: "NonDecimalFloat", _0: base });
  }
  if (suffix !== undefined) {
    let ty: FloatTy;
    switch (suffix) {
      case sym.f16:
        ty = FloatTy.F16;
        break;
      case sym.f32:
        ty = FloatTy.F32;
        break;
      case sym.f64:
        ty = FloatTy.F64;
        break;
      case sym.f128:
        ty = FloatTy.F128;
        break;
      default:
        return Err({ $: "InvalidFloatSuffix", _0: suffix });
    }
    return Ok<LitKind>({ $: "Float", _0: symbol, _1: { $: "Suffixed", _0: ty } });
  } else {
    return Ok<LitKind>({ $: "Float", _0: symbol, _1: ast.LitFloatType.Unsuffixed });
  }
}

// rustc: compiler/rustc_ast/src/util/literal.rs:325 float_lit
function float_lit(symbol: Symbol, suffix: Symbol | undefined): Result<LitKind, LitError> {
  // debug!("float_lit: {:?}, {:?}", symbol, suffix);
  return filtered_float_lit(strip_underscores(symbol), suffix, 10);
}

// rustc: compiler/rustc_ast/src/util/literal.rs:330 integer_lit
function integer_lit(symbol_: Symbol, suffix: Symbol | undefined): Result<LitKind, LitError> {
  // debug!("integer_lit: {:?}, {:?}", symbol, suffix);
  const symbol = strip_underscores(symbol_);
  const s = Symbol.as_str(symbol);

  let base: number;
  if (s.startsWith("0x")) base = 16;
  else if (s.startsWith("0o")) base = 8;
  else if (s.startsWith("0b")) base = 2;
  else base = 10;

  let ty: ast.LitIntType;
  if (suffix !== undefined) {
    const suf = suffix;
    switch (suf) {
      case sym.isize:
        ty = { $: "Signed", _0: IntTy.Isize };
        break;
      case sym.i8:
        ty = { $: "Signed", _0: IntTy.I8 };
        break;
      case sym.i16:
        ty = { $: "Signed", _0: IntTy.I16 };
        break;
      case sym.i32:
        ty = { $: "Signed", _0: IntTy.I32 };
        break;
      case sym.i64:
        ty = { $: "Signed", _0: IntTy.I64 };
        break;
      case sym.i128:
        ty = { $: "Signed", _0: IntTy.I128 };
        break;
      case sym.usize:
        ty = { $: "Unsigned", _0: UintTy.Usize };
        break;
      case sym.u8:
        ty = { $: "Unsigned", _0: UintTy.U8 };
        break;
      case sym.u16:
        ty = { $: "Unsigned", _0: UintTy.U16 };
        break;
      case sym.u32:
        ty = { $: "Unsigned", _0: UintTy.U32 };
        break;
      case sym.u64:
        ty = { $: "Unsigned", _0: UintTy.U64 };
        break;
      case sym.u128:
        ty = { $: "Unsigned", _0: UintTy.U128 };
        break;
      default:
        // `1f64` and `2f32` etc. are valid float literals, and
        // `fxxx` looks more like an invalid float literal than invalid integer literal.
        if (Symbol.as_str(suf).startsWith("f")) return filtered_float_lit(symbol, suffix, base);
        return Err({ $: "InvalidIntSuffix", _0: suf });
    }
  } else {
    ty = ast.LitIntType.Unsuffixed;
  }

  const s_ = s.slice(base !== 10 ? 2 : 0);
  const i = u128_from_str_radix(s_, base);
  if (i === undefined) return Err({ $: "IntTooLarge", _0: base });
  return Ok<LitKind>({ $: "Int", _0: i, _1: ty });
}

const U128_MAX = (1n << 128n) - 1n;

/** `u128::from_str_radix(s, radix).ok()` */
// PORT: `undefined` for any `ParseIntError` (the caller maps every error to `IntTooLarge`).
function u128_from_str_radix(s: string, radix: number): bigint | undefined {
  if (s.length === 0) return undefined;
  let digits = s;
  if (s[0] === "+" || s[0] === "-") {
    if (s.length === 1) return undefined;
    if (s[0] === "+") digits = s.slice(1);
  }
  const r = BigInt(radix);
  let acc = 0n;
  for (const c of digits) {
    const d = to_digit(c.codePointAt(0)!, radix);
    if (d === undefined) return undefined;
    acc = acc * r + BigInt(d);
    if (acc > U128_MAX) return undefined;
  }
  return acc;
}

