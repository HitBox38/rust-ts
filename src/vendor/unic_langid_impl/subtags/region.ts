// Port of unic-langid-impl 0.9.6 `src/subtags/region.rs`.
import { debug_tuple, type Fmt } from "../../../std/fmt.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { utf8 } from "../../../std/str.ts";
import { debug_TinyAsciiStr, TinyAsciiStr } from "../../tinystr/ascii.ts";
import { u32_from_le_bytes, u32_to_le_bytes } from "../../tinystr/int_ops.ts";
import type { ParserError } from "../parser/errors.ts";

// #[derive(Debug, PartialEq, Eq, Clone, Hash, PartialOrd, Ord, Copy)]
export class Region {
  constructor(public _0: TinyAsciiStr /* TinyStr4 */) {}

  // crate: unic-langid-impl-0.9.6/src/subtags/region.rs:9 from_bytes
  static from_bytes(v: Uint8Array): Result<Region, ParserError> {
    const slen = v.length;

    switch (slen) {
      case 2: {
        const r = TinyAsciiStr.try_from_utf8(4, v);
        if (r.$ === "Err") return Err("InvalidSubtag");
        const s = r._0;
        if (!s.is_ascii_alphabetic()) {
          return Err("InvalidSubtag");
        }
        return Ok(new Region(s.to_ascii_uppercase()));
      }
      case 3: {
        const r = TinyAsciiStr.try_from_utf8(4, v);
        if (r.$ === "Err") return Err("InvalidSubtag");
        const s = r._0;
        if (!s.is_ascii_numeric()) {
          return Err("InvalidSubtag");
        }
        return Ok(new Region(s));
      }
      default:
        return Err("InvalidSubtag");
    }
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/region.rs:31 as_str
  as_str(): string {
    return this._0.as_str();
  }

  /// # Safety
  ///
  /// This function accepts any u64 that is exected to be a valid
  /// `TinyStr4` and a valid `Region` subtag.
  // crate: unic-langid-impl-0.9.6/src/subtags/region.rs:39 from_raw_unchecked
  static from_raw_unchecked(v: number): Region {
    return new Region(TinyAsciiStr.from_utf8_unchecked(u32_to_le_bytes(v)));
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/region.rs:45 from
  /** `impl From<Region> for u32` */
  into_u32(): number {
    return u32_from_le_bytes(this._0.all_bytes());
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/region.rs:51 from
  /** `impl<'l> From<&'l Region> for &'l str` */
  into_str(): string {
    return this._0.as_str();
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/region.rs:59 from_str
  static from_str(source: string): Result<Region, ParserError> {
    return Region.from_bytes(utf8(source));
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/region.rs:71 eq
  /** `impl PartialEq<&str> for Region` */
  eq_str(other: string): boolean {
    return this.as_str() === other;
  }

  /** `#[derive(PartialEq)]` */
  eq(other: Region): boolean {
    return this._0.eq(other._0);
  }

  /** `#[derive(Ord)]` */
  cmp(other: Region): -1 | 0 | 1 {
    return this._0.cmp(other._0);
  }
}

// crate: unic-langid-impl-0.9.6/src/subtags/region.rs:65 fmt
/** `impl std::fmt::Display for Region` */
export function display_Region(self: Region): string {
  return self._0.deref();
}

/** `#[derive(Debug)]` */
export function debug_Region(self: Region, f: Fmt): string {
  return debug_tuple(f, "Region", [debug_TinyAsciiStr(self._0, f)]);
}
