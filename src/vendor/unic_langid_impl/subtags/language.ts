// Port of unic-langid-impl 0.9.6 `src/subtags/language.rs`.
import { debug_option, debug_tuple, type Fmt } from "../../../std/fmt.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { utf8 } from "../../../std/str.ts";
import { debug_TinyAsciiStr, TinyAsciiStr } from "../../tinystr/ascii.ts";
import { u64_from_le_bytes, u64_to_le_bytes } from "../../tinystr/int_ops.ts";
import type { ParserError } from "../parser/errors.ts";

// PORT: `From<Language> for Option<u64>` and `from_raw_unchecked(u64)` use `bigint`: an 8-letter
// language subtag packs into a u64 above 2^53.

// #[derive(Default, Debug, PartialEq, Eq, Clone, Hash, PartialOrd, Ord, Copy)]
export class Language {
  constructor(public _0: TinyAsciiStr /* TinyStr8 */ | undefined) {}

  /** `#[derive(Default)]` */
  static default(): Language {
    return new Language(undefined);
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/language.rs:11 from_bytes
  static from_bytes(v: Uint8Array): Result<Language, ParserError> {
    const slen = v.length;

    const r = TinyAsciiStr.try_from_utf8(8, v);
    if (r.$ === "Err") return Err("InvalidLanguage");
    const s = r._0;
    if (!(2 <= slen && slen <= 8) || slen === 4 || !s.is_ascii_alphabetic()) {
      return Err("InvalidLanguage");
    }

    const value = s.to_ascii_lowercase();

    if (value.eq_str("und")) {
      return Ok(new Language(undefined));
    } else {
      return Ok(new Language(value));
    }
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/language.rs:28 as_str
  as_str(): string {
    return this._0 !== undefined ? this._0.deref() : "und";
  }

  /// # Safety
  ///
  /// This function accepts any u64 that is exected to be a valid
  /// `TinyStr8` and a valid `Language` subtag.
  // crate: unic-langid-impl-0.9.6/src/subtags/language.rs:36 from_raw_unchecked
  static from_raw_unchecked(v: bigint): Language {
    return new Language(TinyAsciiStr.from_utf8_unchecked(u64_to_le_bytes(v)));
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/language.rs:40 matches
  matches(other: Language, self_as_range: boolean, other_as_range: boolean): boolean {
    return (self_as_range && this._0 === undefined) || (other_as_range && other._0 === undefined) || this.eq(other);
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/language.rs:51 clear
  clear(): void {
    this._0 = undefined;
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/language.rs:55 is_empty
  is_empty(): boolean {
    return this._0 === undefined;
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/language.rs:61 from
  /** `impl From<Language> for Option<u64>` */
  into_u64(): bigint | undefined {
    return this._0 !== undefined ? u64_from_le_bytes(this._0.all_bytes()) : undefined;
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/language.rs:67 from
  /** `impl From<&Language> for Option<u64>` */
  ref_into_u64(): bigint | undefined {
    return this._0 !== undefined ? u64_from_le_bytes(this._0.all_bytes()) : undefined;
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/language.rs:78 try_from
  /** `impl<T: AsRef<[u8]>> TryFrom<Option<T>> for Language` */
  static try_from(v: Uint8Array | string | undefined): Result<Language, ParserError> {
    if (v !== undefined) {
      const l = typeof v === "string" ? utf8(v) : v; // PORT: `AsRef<[u8]>` for `String`/`&str`
      const r = Language.from_bytes(l);
      if (r.$ === "Err") return r;
      return Ok(r._0);
    } else {
      return Ok(new Language(undefined));
    }
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/language.rs:89 from_str
  static from_str(source: string): Result<Language, ParserError> {
    return Language.from_bytes(utf8(source));
  }

  // crate: unic-langid-impl-0.9.6/src/subtags/language.rs:105 eq
  /** `impl PartialEq<&str> for Language` */
  eq_str(other: string): boolean {
    return this.as_str() === other;
  }

  /** `#[derive(Clone, Copy)]`: `clear` mutates in place, so copies must not alias. */
  clone(): Language {
    return new Language(this._0);
  }

  /** `#[derive(PartialEq)]` */
  eq(other: Language): boolean {
    return this.cmp(other) === 0;
  }

  /** `#[derive(Ord)]`: `Option<TinyStr8>` (`None` first). */
  cmp(other: Language): -1 | 0 | 1 {
    if (this._0 === undefined) return other._0 === undefined ? 0 : -1;
    if (other._0 === undefined) return 1;
    return this._0.cmp(other._0);
  }
}

// crate: unic-langid-impl-0.9.6/src/subtags/language.rs:95 fmt
/** `impl std::fmt::Display for Language` */
export function display_Language(self: Language): string {
  if (self._0 !== undefined) {
    return self._0.deref();
  } else {
    return "und";
  }
}

/** `#[derive(Debug)]` */
export function debug_Language(self: Language, f: Fmt): string {
  return debug_tuple(f, "Language", [debug_option(self._0, f, debug_TinyAsciiStr)]);
}
