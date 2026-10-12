// Port of unic-langid-impl 0.9.6 `src/subtags/script.rs`.
import { debug_tuple, type Fmt } from "../../../std/fmt.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { utf8 } from "../../../std/str.ts";
import { debug_TinyAsciiStr, TinyAsciiStr } from "../../tinystr/ascii.ts";
import { u32_from_le_bytes, u32_to_le_bytes } from "../../tinystr/int_ops.ts";
import type { ParserError } from "../parser/errors.ts";

// #[derive(Debug, PartialEq, Eq, Clone, Hash, PartialOrd, Ord, Copy)]
export class Script {
  constructor(public _0: TinyAsciiStr /* TinyStr4 */) {}

  // crate: unic-langid-impl-0.9.6/src/subtags/script.rs:9 from_bytes
  static from_bytes(v: Uint8Array): Result<Script, ParserError> {
    const slen = v.length;

    const r = TinyAsciiStr.try_from_utf8(4, v);
    if (r.$ === "Err") return Err("InvalidSubtag");
    const s = r._0;
    if (slen !== 4 || !s.is_ascii_alphabetic()) {
      return Err("InvalidSubtag");
    }
    return Ok(new Script(s.to_ascii_titlecase()));
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/script.rs:19 as_str
  as_str(): string {
    return this._0.as_str();
  }

  /// # Safety
  ///
  /// This function accepts any u64 that is exected to be a valid
  /// `TinyStr4` and a valid `Script` subtag.
  // crate: unic-langid-impl-0.9.6/src/subtags/script.rs:27 from_raw_unchecked
  static from_raw_unchecked(v: number): Script {
    return new Script(TinyAsciiStr.from_utf8_unchecked(u32_to_le_bytes(v)));
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/script.rs:33 from
  /** `impl From<Script> for u32` */
  into_u32(): number {
    return u32_from_le_bytes(this._0.all_bytes());
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/script.rs:39 from
  /** `impl<'l> From<&'l Script> for &'l str` */
  into_str(): string {
    return this._0.as_str();
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/script.rs:47 from_str
  static from_str(source: string): Result<Script, ParserError> {
    return Script.from_bytes(utf8(source));
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/script.rs:59 eq
  /** `impl PartialEq<&str> for Script` */
  eq_str(other: string): boolean {
    return this.as_str() === other;
  }

  /** `#[derive(PartialEq)]` */
  eq(other: Script): boolean {
    return this._0.eq(other._0);
  }

  /** `#[derive(Ord)]` */
  cmp(other: Script): -1 | 0 | 1 {
    return this._0.cmp(other._0);
  }
}

// crate: unic-langid-impl-0.9.6/src/subtags/script.rs:53 fmt
/** `impl std::fmt::Display for Script` */
export function display_Script(self: Script): string {
  return self._0.deref();
}

/** `#[derive(Debug)]` */
export function debug_Script(self: Script, f: Fmt): string {
  return debug_tuple(f, "Script", [debug_TinyAsciiStr(self._0, f)]);
}
