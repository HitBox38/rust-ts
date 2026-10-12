// Port of unic-langid-impl 0.9.6 `src/subtags/variant.rs`.
import { is_ascii_alphanumeric, is_ascii_digit } from "../../../std/char.ts";
import { debug_tuple, type Fmt } from "../../../std/fmt.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { utf8 } from "../../../std/str.ts";
import { debug_TinyAsciiStr, TinyAsciiStr } from "../../tinystr/ascii.ts";
import { u64_from_le_bytes, u64_to_le_bytes } from "../../tinystr/int_ops.ts";
import type { ParserError } from "../parser/errors.ts";

// PORT: the `u64` raw value is a `bigint` (an 8-byte variant packs above 2^53).

// #[derive(Debug, PartialEq, Eq, Clone, Hash, PartialOrd, Ord, Copy)]
export class Variant {
  constructor(public _0: TinyAsciiStr /* TinyStr8 */) {}

  // crate: unic-langid-impl-0.9.6/src/subtags/variant.rs:9 from_bytes
  static from_bytes(v: Uint8Array): Result<Variant, ParserError> {
    const slen = v.length;

    if (!(4 <= slen && slen <= 8)) {
      return Err("InvalidSubtag");
    }

    const r = TinyAsciiStr.try_from_utf8(8, v);
    if (r.$ === "Err") return Err("InvalidSubtag");
    const s = r._0;

    if (
      (slen >= 5 && !s.is_ascii_alphanumeric()) ||
      (slen === 4 && !is_ascii_digit(v[0]!) && v.subarray(1).some((c: number) => !is_ascii_alphanumeric(c)))
    ) {
      return Err("InvalidSubtag");
    }

    return Ok(new Variant(s.to_ascii_lowercase()));
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/variant.rs:29 as_str
  as_str(): string {
    return this._0.as_str();
  }

  /// # Safety
  ///
  /// This function accepts any u64 that is exected to be a valid
  /// `TinyStr8` and a valid `Variant` subtag.
  // crate: unic-langid-impl-0.9.6/src/subtags/variant.rs:37 from_raw_unchecked
  static from_raw_unchecked(v: bigint): Variant {
    return new Variant(TinyAsciiStr.from_utf8_unchecked(u64_to_le_bytes(v)));
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/variant.rs:43 from
  /** `impl From<Variant> for u64` */
  into_u64(): bigint {
    return u64_from_le_bytes(this._0.all_bytes());
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/variant.rs:49 from
  /** `impl From<&Variant> for u64` */
  ref_into_u64(): bigint {
    return u64_from_le_bytes(this._0.all_bytes());
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/variant.rs:57 from_str
  static from_str(source: string): Result<Variant, ParserError> {
    return Variant.from_bytes(utf8(source));
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/variant.rs:69 eq
  /** `impl PartialEq<&str> for Variant` */
  eq_str(other: string): boolean {
    return this.as_str() === other;
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/variant.rs:75 eq
  /** `impl PartialEq<str> for Variant` */
  eq_str_unsized(other: string): boolean {
    return this.as_str() === other;
  }

  /** `#[derive(PartialEq)]` */
  eq(other: Variant): boolean {
    return this._0.eq(other._0);
  }

  /** `#[derive(Ord)]` */
  cmp(other: Variant): -1 | 0 | 1 {
    return this._0.cmp(other._0);
  }
}

// crate: unic-langid-impl-0.9.6/src/subtags/variant.rs:63 fmt
/** `impl std::fmt::Display for Variant` */
export function display_Variant(self: Variant): string {
  return self._0.deref();
}

/** `#[derive(Debug)]` */
export function debug_Variant(self: Variant, f: Fmt): string {
  return debug_tuple(f, "Variant", [debug_TinyAsciiStr(self._0, f)]);
}
