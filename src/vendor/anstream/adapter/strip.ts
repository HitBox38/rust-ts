// Port of anstream =0.6.21 `src/adapter/strip.rs`.
//
// PORT: `&str` data is a JS `string` (encoded to UTF-8 bytes up front); `&'s str` items are
// decoded back from the byte slices. `&[u8]` items are `Uint8Array` views (`subarray`) into the
// input. Iterators have `next(): T | undefined` (Rust's `Iterator::next`) and are JS-iterable.
// `&mut` borrows of a field held by an iterator are `MutRef`s whose accessors read/write the
// owner's field.

import { debug_struct, type Debug } from "../../../std/fmt.ts";
import { utf8 } from "../../../std/str.ts";
import { state_change, debug_State, type Action, type State } from "../../anstyle_parse/state/mod.ts";
import * as utf8parse from "../../utf8parse/lib.ts";

/** `&mut T` to a place. */
export interface MutRef<T> {
  value: T;
}

/** `&mut obj.key` */
function field_ref<T, K extends keyof T>(obj: T, key: K): MutRef<T[K]> {
  return {
    get value(): T[K] {
      return obj[key];
    },
    set value(v: T[K]) {
      obj[key] = v;
    },
  };
}

const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });

/// Strip ANSI escapes from a `&str`, returning the printable content
///
/// This can be used to take output from a program that includes escape sequences and write it
/// somewhere that does not easily support them, such as a log file.
///
/// For non-contiguous data, see [`StripStr`].
///
/// # Example
///
/// ```rust
/// use std::io::Write as _;
///
/// let styled_text = "\x1b[32mfoo\x1b[m bar";
/// let plain_str = anstream::adapter::strip_str(&styled_text).to_string();
/// assert_eq!(plain_str, "foo bar");
/// ```
// crate: anstream-0.6.21/src/adapter/strip.rs:22 strip_str
export function strip_str(data: string): StrippedStr {
  return StrippedStr.new(data);
}

/// See [`strip_str`]
export class StrippedStr {
  constructor(
    public bytes: Uint8Array,
    public state: State,
  ) {}

  // crate: anstream-0.6.21/src/adapter/strip.rs:35 new
  static new(data: string): StrippedStr {
    return new StrippedStr(utf8(data), "Ground");
  }

  /// Create a [`String`] of the printable content
  // crate: anstream-0.6.21/src/adapter/strip.rs:45 to_string
  to_string(): string {
    let stripped = "";
    stripped += this.fmt();
    return stripped;
  }

  // impl std::fmt::Display for StrippedStr<'_>
  /// **Note:** this does *not* exhaust the [`Iterator`]
  // crate: anstream-0.6.21/src/adapter/strip.rs:56 fmt
  fmt(): string {
    const iter = new StrippedStr(this.bytes, this.state);
    let f = "";
    for (const printable of iter) {
      f += printable;
    }
    return f;
  }

  // crate: anstream-0.6.21/src/adapter/strip.rs:72 next
  next(): string | undefined {
    return next_str(field_ref(this, "bytes"), field_ref(this, "state"));
  }

  *[Symbol.iterator](): Generator<string, void, undefined> {
    for (let x = this.next(); x !== undefined; x = this.next()) yield x;
  }
}

/// Incrementally strip non-contiguous data
export class StripStr {
  constructor(public state: State) {}

  /// Initial state
  // crate: anstream-0.6.21/src/adapter/strip.rs:85 new
  static new(): StripStr {
    return StripStr.default_();
  }

  /** `#[derive(Default)]` */
  static default_(): StripStr {
    return new StripStr("Ground");
  }

  /// Strip the next segment of data
  // crate: anstream-0.6.21/src/adapter/strip.rs:90 strip_next
  strip_next(data: string): StripStrIter {
    return new StripStrIter(utf8(data), field_ref(this, "state"));
  }
}

/** `#[derive(Debug)]` */
export const debug_StripStr: Debug<StripStr> = (v, f) => debug_struct(f, "StripStr", [["state", debug_State(v.state)]]);

/// See [`StripStr`]
export class StripStrIter {
  constructor(
    public bytes: Uint8Array,
    public state: MutRef<State>,
  ) {}

  // crate: anstream-0.6.21/src/adapter/strip.rs:109 next
  next(): string | undefined {
    return next_str(field_ref(this, "bytes"), this.state);
  }

  *[Symbol.iterator](): Generator<string, void, undefined> {
    for (let x = this.next(); x !== undefined; x = this.next()) yield x;
  }
}

// crate: anstream-0.6.21/src/adapter/strip.rs:115 next_str
function next_str(bytes: MutRef<Uint8Array>, state: MutRef<State>): string | undefined {
  let offset: number | undefined = undefined;
  {
    const b = bytes.value;
    for (let i = 0; i < b.length; i++) {
      const byte = b[i]!;
      const [next_state, action] = state_change(state.value, byte);
      if (next_state !== "Anywhere") {
        state.value = next_state;
      }
      if (is_printable_bytes(action, byte)) {
        offset = i;
        break;
      }
    }
  }
  const next = bytes.value.subarray(offset ?? bytes.value.length);
  bytes.value = next;
  state.value = "Ground";

  offset = undefined;
  {
    const b = bytes.value;
    for (let i = 0; i < b.length; i++) {
      const byte = b[i]!;
      const [_next_state, action] = state_change("Ground", byte);
      if (!(is_printable_bytes(action, byte) || is_utf8_continuation(byte))) {
        offset = i;
        break;
      }
    }
  }
  const split = offset ?? bytes.value.length;
  const printable = bytes.value.subarray(0, split);
  bytes.value = bytes.value.subarray(split);
  if (printable.length === 0) {
    return undefined;
  } else {
    const printable_ = from_utf8_unchecked(printable, "`bytes` was validated as UTF-8, the parser preserves UTF-8 continuations");
    return printable_;
  }
}

// PORT: rustc is built without `debug_assertions`, so this is the `from_utf8_unchecked` arm (the
// lossy decoder never fails; on valid UTF-8 it is exact).
// crate: anstream-0.6.21/src/adapter/strip.rs:147 from_utf8_unchecked
function from_utf8_unchecked(bytes: Uint8Array, _safety_justification: string): string {
  return decoder.decode(bytes);
}

// crate: anstream-0.6.21/src/adapter/strip.rs:159 is_utf8_continuation
function is_utf8_continuation(b: number): boolean {
  return b >= 0x80 && b <= 0xbf;
}

/// Strip ANSI escapes from bytes, returning the printable content
///
/// This can be used to take output from a program that includes escape sequences and write it
/// somewhere that does not easily support them, such as a log file.
///
/// # Example
///
/// ```rust
/// use std::io::Write as _;
///
/// let styled_text = "\x1b[32mfoo\x1b[m bar";
/// let plain_str = anstream::adapter::strip_bytes(styled_text.as_bytes()).into_vec();
/// assert_eq!(plain_str.as_slice(), &b"foo bar"[..]);
/// ```
// crate: anstream-0.6.21/src/adapter/strip.rs:178 strip_bytes
export function strip_bytes(data: Uint8Array): StrippedBytes {
  return StrippedBytes.new(data);
}

/// See [`strip_bytes`]
export class StrippedBytes {
  constructor(
    public bytes: Uint8Array,
    public state: State,
    public utf8parser: Utf8Parser,
  ) {}

  /// See [`strip_bytes`]
  // crate: anstream-0.6.21/src/adapter/strip.rs:193 new
  static new(bytes: Uint8Array): StrippedBytes {
    return new StrippedBytes(bytes, "Ground", Utf8Parser.default_());
  }

  /// Strip the next slice of bytes
  ///
  /// Used when the content is in several non-contiguous slices
  ///
  /// # Panic
  ///
  /// May panic if it is not exhausted / empty
  // crate: anstream-0.6.21/src/adapter/strip.rs:209 extend
  extend(bytes: Uint8Array): void {
    // debug_assert!(self.is_empty(), "current bytes must be processed to ensure we end at the right state");
    this.bytes = bytes;
  }

  /// Report the bytes has been exhausted
  // crate: anstream-0.6.21/src/adapter/strip.rs:219 is_empty
  is_empty(): boolean {
    return this.bytes.length === 0;
  }

  /// Create a [`Vec`] of the printable content
  // crate: anstream-0.6.21/src/adapter/strip.rs:225 into_vec
  into_vec(): Uint8Array {
    const stripped: Uint8Array[] = [];
    let len = 0;
    for (const printable of this) {
      stripped.push(printable);
      len += printable.length;
    }
    const out = new Uint8Array(len);
    let at = 0;
    for (const p of stripped) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }

  // crate: anstream-0.6.21/src/adapter/strip.rs:238 next
  next(): Uint8Array | undefined {
    return next_bytes(field_ref(this, "bytes"), field_ref(this, "state"), this.utf8parser);
  }

  *[Symbol.iterator](): Generator<Uint8Array, void, undefined> {
    for (let x = this.next(); x !== undefined; x = this.next()) yield x;
  }
}

/// Incrementally strip non-contiguous data
export class StripBytes {
  constructor(
    public state: State,
    public utf8parser: Utf8Parser,
  ) {}

  /// Initial state
  // crate: anstream-0.6.21/src/adapter/strip.rs:252 new
  static new(): StripBytes {
    return StripBytes.default_();
  }

  /** `#[derive(Default)]` */
  static default_(): StripBytes {
    return new StripBytes("Ground", Utf8Parser.default_());
  }

  /** `#[derive(Clone)]` */
  clone(): StripBytes {
    return new StripBytes(this.state, this.utf8parser.clone());
  }

  /// Strip the next segment of data
  // crate: anstream-0.6.21/src/adapter/strip.rs:257 strip_next
  strip_next(bytes: Uint8Array): StripBytesIter {
    return new StripBytesIter(bytes, field_ref(this, "state"), this.utf8parser);
  }
}

/** `#[derive(Debug)]` */
export const debug_StripBytes: Debug<StripBytes> = (v, f) =>
  debug_struct(f, "StripBytes", [
    ["state", debug_State(v.state)],
    ["utf8parser", debug_Utf8Parser(v.utf8parser, f)],
  ]);

/// See [`StripBytes`]
export class StripBytesIter {
  constructor(
    public bytes: Uint8Array,
    public state: MutRef<State>,
    public utf8parser: Utf8Parser,
  ) {}

  // crate: anstream-0.6.21/src/adapter/strip.rs:278 next
  next(): Uint8Array | undefined {
    return next_bytes(field_ref(this, "bytes"), this.state, this.utf8parser);
  }

  /** `Iterator::last` (drives the iterator to the end). */
  last(): Uint8Array | undefined {
    let last: Uint8Array | undefined = undefined;
    for (let x = this.next(); x !== undefined; x = this.next()) last = x;
    return last;
  }

  *[Symbol.iterator](): Generator<Uint8Array, void, undefined> {
    for (let x = this.next(); x !== undefined; x = this.next()) yield x;
  }
}

// crate: anstream-0.6.21/src/adapter/strip.rs:284 next_bytes
function next_bytes(bytes: MutRef<Uint8Array>, state: MutRef<State>, utf8parser: Utf8Parser): Uint8Array | undefined {
  let offset: number | undefined = undefined;
  {
    const b = bytes.value;
    for (let i = 0; i < b.length; i++) {
      const byte = b[i]!;
      let found: boolean;
      if (state.value === "Utf8") {
        found = true;
      } else {
        const [next_state, action] = state_change(state.value, byte);
        if (next_state !== "Anywhere") {
          state.value = next_state;
        }
        found = is_printable_bytes(action, byte);
      }
      if (found) {
        offset = i;
        break;
      }
    }
  }
  const next = bytes.value.subarray(offset ?? bytes.value.length);
  bytes.value = next;

  offset = undefined;
  {
    const b = bytes.value;
    for (let i = 0; i < b.length; i++) {
      const byte = b[i]!;
      let found: boolean;
      if (state.value === "Utf8") {
        if (utf8parser.add(byte)) {
          state.value = "Ground";
        }
        found = false;
      } else {
        const [next_state, action] = state_change("Ground", byte);
        if (next_state !== "Anywhere") {
          state.value = next_state;
        }
        if (state.value === "Utf8") {
          utf8parser.add(byte);
          found = false;
        } else {
          found = !is_printable_bytes(action, byte);
        }
      }
      if (found) {
        offset = i;
        break;
      }
    }
  }
  const split = offset ?? bytes.value.length;
  const printable = bytes.value.subarray(0, split);
  bytes.value = bytes.value.subarray(split);
  if (printable.length === 0) {
    return undefined;
  } else {
    return printable;
  }
}

export class Utf8Parser {
  constructor(public utf8_parser: utf8parse.Parser) {}

  /** `#[derive(Default)]` */
  static default_(): Utf8Parser {
    return new Utf8Parser(utf8parse.Parser.default_());
  }

  /** `#[derive(Clone)]` */
  clone(): Utf8Parser {
    return new Utf8Parser(this.utf8_parser.clone());
  }

  // crate: anstream-0.6.21/src/adapter/strip.rs:337 add
  add(byte: number): boolean {
    const b: MutRef<boolean> = { value: false };
    const receiver = new VtUtf8Receiver(b);
    this.utf8_parser.advance(receiver, byte);
    return b.value;
  }
}

/** `#[derive(Debug)]` */
export const debug_Utf8Parser: Debug<Utf8Parser> = (v, f) =>
  debug_struct(f, "Utf8Parser", [["utf8_parser", utf8parse.debug_Parser(v.utf8_parser, f)]]);

class VtUtf8Receiver implements utf8parse.Receiver {
  constructor(public _0: MutRef<boolean>) {}

  // crate: anstream-0.6.21/src/adapter/strip.rs:348 codepoint
  codepoint(_: number): void {
    this._0.value = true;
  }

  // crate: anstream-0.6.21/src/adapter/strip.rs:352 invalid_sequence
  invalid_sequence(): void {
    this._0.value = true;
  }
}

// crate: anstream-0.6.21/src/adapter/strip.rs:358 is_printable_bytes
function is_printable_bytes(action: Action, byte: number): boolean {
  // VT320 considered 0x7f to be `Print`able but we expect to be working in UTF-8 systems and not
  // ISO Latin-1, making it DEL and non-printable
  const DEL = 0x7f;

  // Continuations aren't included as they may also be control codes, requiring more context
  return (action === "Print" && byte !== DEL) || action === "BeginUtf8" || (action === "Execute" && is_ascii_whitespace(byte));
}

/** `u8::is_ascii_whitespace`: `\t`, `\n`, `\x0C`, `\r`, ` ` (not `\x0B`). */
function is_ascii_whitespace(b: number): boolean {
  return b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d || b === 0x20;
}
