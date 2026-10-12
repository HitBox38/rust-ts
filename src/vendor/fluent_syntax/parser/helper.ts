// Port of fluent-syntax-0.12.0/src/parser/helper.rs (`impl Parser` helpers).

import { is_ascii_alphabetic, is_ascii_digit, is_ascii_hexdigit } from "../../../std/char.ts";
import { Ok } from "../../../std/result.ts";
import type { Str } from "../../../std/str.ts";
import { Parser, type Result } from "./core.ts";
import { error } from "./errors.ts";
import { get_byte, get_current_byte } from "./macros.ts";
import { Slice_str } from "./slice.ts";

declare module "./core.ts" {
  interface Parser {
    is_current_byte(b: number): boolean;
    is_byte_at(b: number, pos: number): boolean;
    skip_to_next_entry_start(): void;
    skip_eol(): boolean;
    skip_unicode_escape_sequence(length: number): Result<null>;
    is_identifier_start(): boolean;
    take_byte_if(b: number): boolean;
    skip_blank_block(): number;
    skip_blank(): void;
    skip_blank_inline(): number;
    expect_byte(b: number): Result<null>;
    is_number_start(): boolean;
    is_eol(): boolean;
    skip_digits(): Result<null>;
    get_number_literal(): Result<Str>;
  }
  // PORT: associated fns (`Self::is_byte_pattern_continuation`, `Self::is_callee`) are statics.
  namespace Parser {
    function is_byte_pattern_continuation(b: number): boolean;
    function is_callee(name: Str): boolean;
  }
}

// crate: fluent-syntax-0.12.0/src/parser/helper.rs:8 is_current_byte
Parser.prototype.is_current_byte = function (this: Parser, b: number): boolean {
  return get_current_byte(this) === b;
};

// crate: fluent-syntax-0.12.0/src/parser/helper.rs:12 is_byte_at
Parser.prototype.is_byte_at = function (this: Parser, b: number, pos: number): boolean {
  return get_byte(this, pos) === b;
};

// crate: fluent-syntax-0.12.0/src/parser/helper.rs:16 skip_to_next_entry_start
Parser.prototype.skip_to_next_entry_start = function (this: Parser): void {
  let b: number | undefined;
  while ((b = get_current_byte(this)) !== undefined) {
    const new_line = this.ptr === 0 || get_byte(this, this.ptr - 1) === 0x0a; /* b'\n' */

    if (new_line && (is_ascii_alphabetic(b) || b === 0x2d /* b'-' */ || b === 0x23) /* b'#' */) {
      break;
    }

    this.ptr += 1;
  }
};

// crate: fluent-syntax-0.12.0/src/parser/helper.rs:28 skip_eol
Parser.prototype.skip_eol = function (this: Parser): boolean {
  const b = get_current_byte(this);
  if (b === 0x0a /* b'\n' */) {
    this.ptr += 1;
    return true;
  } else if (b === 0x0d /* b'\r' */ && this.is_byte_at(0x0a /* b'\n' */, this.ptr + 1)) {
    this.ptr += 2;
    return true;
  } else {
    return false;
  }
};

// crate: fluent-syntax-0.12.0/src/parser/helper.rs:42 skip_unicode_escape_sequence
Parser.prototype.skip_unicode_escape_sequence = function (this: Parser, length: number): Result<null> {
  const start = this.ptr;
  for (let i = 0; i < length; i++) {
    const b = get_current_byte(this);
    if (b !== undefined && is_ascii_hexdigit(b)) {
      this.ptr += 1;
    } else {
      break;
    }
  }
  if (this.ptr - start !== length) {
    const end = this.ptr >= this.length ? this.ptr : this.ptr + 1;
    const seq = Slice_str.slice(this.source, start, end).toString();
    return error({ $: "InvalidUnicodeEscapeSequence", _0: seq }, this.ptr);
  }
  return Ok(null);
};

// crate: fluent-syntax-0.12.0/src/parser/helper.rs:62 is_identifier_start
Parser.prototype.is_identifier_start = function (this: Parser): boolean {
  const b = get_current_byte(this);
  return b !== undefined && is_ascii_alphabetic(b);
};

// crate: fluent-syntax-0.12.0/src/parser/helper.rs:66 take_byte_if
Parser.prototype.take_byte_if = function (this: Parser, b: number): boolean {
  if (this.is_current_byte(b)) {
    this.ptr += 1;
    return true;
  } else {
    return false;
  }
};

// crate: fluent-syntax-0.12.0/src/parser/helper.rs:75 skip_blank_block
Parser.prototype.skip_blank_block = function (this: Parser): number {
  let count = 0;
  for (;;) {
    const start = this.ptr;
    this.skip_blank_inline();
    if (!this.skip_eol()) {
      this.ptr = start;
      break;
    }
    count += 1;
  }
  return count;
};

// crate: fluent-syntax-0.12.0/src/parser/helper.rs:89 skip_blank
Parser.prototype.skip_blank = function (this: Parser): void {
  for (;;) {
    const b = get_current_byte(this);
    if (b === 0x20 /* b' ' */ || b === 0x0a /* b'\n' */) this.ptr += 1;
    else if (b === 0x0d /* b'\r' */ && get_byte(this, this.ptr + 1) === 0x0a /* b'\n' */) this.ptr += 2;
    else break;
  }
};

// crate: fluent-syntax-0.12.0/src/parser/helper.rs:99 skip_blank_inline
Parser.prototype.skip_blank_inline = function (this: Parser): number {
  const start = this.ptr;
  while (get_current_byte(this) === 0x20 /* b' ' */) {
    this.ptr += 1;
  }
  return this.ptr - start;
};

// crate: fluent-syntax-0.12.0/src/parser/helper.rs:107 is_byte_pattern_continuation
Parser.is_byte_pattern_continuation = function (b: number): boolean {
  return !(b === 0x2e /* b'.' */ || b === 0x7d /* b'}' */ || b === 0x5b /* b'[' */ || b === 0x2a) /* b'*' */;
};

// crate: fluent-syntax-0.12.0/src/parser/helper.rs:111 is_callee
Parser.is_callee = function (name: Str): boolean {
  for (let i = 0; i < name.len(); i++) {
    const c = name.byte(i);
    if (!(is_ascii_uppercase(c) || is_ascii_digit(c) || c === 0x5f /* b'_' */ || c === 0x2d) /* b'-' */) return false;
  }
  return true;
};

// crate: fluent-syntax-0.12.0/src/parser/helper.rs:118 expect_byte
Parser.prototype.expect_byte = function (this: Parser, b: number): Result<null> {
  if (!this.is_current_byte(b)) {
    // PORT: `b as char`: a byte is the scalar value of the same number.
    return error({ $: "ExpectedToken", _0: b }, this.ptr);
  }
  this.ptr += 1;
  return Ok(null);
};

// crate: fluent-syntax-0.12.0/src/parser/helper.rs:126 is_number_start
Parser.prototype.is_number_start = function (this: Parser): boolean {
  const b = get_current_byte(this);
  return b !== undefined && (is_ascii_digit(b) || b === 0x2d) /* b'-' */;
};

// crate: fluent-syntax-0.12.0/src/parser/helper.rs:130 is_eol
Parser.prototype.is_eol = function (this: Parser): boolean {
  const b = get_current_byte(this);
  if (b === 0x0a /* b'\n' */) return true;
  else if (b === 0x0d /* b'\r' */ && this.is_byte_at(0x0a /* b'\n' */, this.ptr + 1)) return true;
  else if (b === undefined) return true;
  else return false;
};

// crate: fluent-syntax-0.12.0/src/parser/helper.rs:139 skip_digits
Parser.prototype.skip_digits = function (this: Parser): Result<null> {
  const start = this.ptr;
  for (;;) {
    const b = get_current_byte(this);
    if (b !== undefined && is_ascii_digit(b)) this.ptr += 1;
    else break;
  }
  if (start === this.ptr) {
    return error(
      {
        $: "ExpectedCharRange",
        range: "0-9",
      },
      this.ptr,
    );
  } else {
    return Ok(null);
  }
};

// crate: fluent-syntax-0.12.0/src/parser/helper.rs:159 get_number_literal
Parser.prototype.get_number_literal = function (this: Parser): Result<Str> {
  const start = this.ptr;
  this.take_byte_if(0x2d /* b'-' */);
  const d = this.skip_digits();
  if (d.$ === "Err") return d;
  if (this.take_byte_if(0x2e /* b'.' */)) {
    const d = this.skip_digits();
    if (d.$ === "Err") return d;
  }

  return Ok(Slice_str.slice(this.source, start, this.ptr));
};

// PORT: `u8::is_ascii_uppercase` (std/char.ts has the other `is_ascii_*` predicates; on bytes they coincide).
function is_ascii_uppercase(b: number): boolean {
  return b >= 0x41 && b <= 0x5a;
}
