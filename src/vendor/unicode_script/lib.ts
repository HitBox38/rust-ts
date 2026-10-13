// Port of unicode-script =0.5.7 `src/lib.rs` (vendored for rustc_lint's non_ascii_idents through unicode-security).
// Table data and lookups: `tables.ts` (generated from the crate's tables.rs; see its header).
// `u64` bitsets are `bigint`s; `Copy` values are immutable (`&mut self` methods return the new value).

//! This crate exposes the Unicode `Script` and `Script_Extension` properties from [UAX #24](http://www.unicode.org/reports/tr24/)

import { type Result, Ok, Err } from "../../std/result.ts";
import {
  get_script,
  get_script_extension,
  NEXT_SCRIPT,
  Script,
  Script_discriminant,
  Script_for_integer,
  Script_inner_from_full_name,
  Script_inner_from_short_name,
  Script_inner_full_name,
  Script_inner_short_name,
} from "./tables.ts";

export { script_extensions, type ScriptExtensions, Script, Script_discriminant, UNICODE_VERSION, NEXT_SCRIPT } from "./tables.ts";

const U64_MAX = 0xffff_ffff_ffff_ffffn;

/** `u64::count_ones` */
function count_ones(x: bigint): number {
  let n = 0;
  for (; x !== 0n; x &= x - 1n) n++;
  return n;
}

/** `u64::trailing_zeros` of a non-zero value. */
function trailing_zeros(x: bigint): number {
  let n = 0;
  for (; (x & 1n) === 0n; x >>= 1n) n++;
  return n;
}

// impl Script
/// Get the full name of a script.
// crate: unicode-script-0.5.7/src/lib.rs:18 full_name
export function Script_full_name(self: Script): string {
  return Script_inner_full_name(self);
}

/// Attempts to parse script name from the provided string.
/// Returns `None` if the provided string does not represent a valid
/// script full name.
// crate: unicode-script-0.5.7/src/lib.rs:25 from_full_name
export function Script_from_full_name(input: string): Script | undefined {
  return Script_inner_from_full_name(input);
}

/// Get the four-character short name of a script.
// crate: unicode-script-0.5.7/src/lib.rs:30 short_name
export function Script_short_name(self: Script): string {
  return Script_inner_short_name(self);
}

/// Attempts to parse script name from the provided string.
/// Returns `None` if the provided string does not represent a valid
/// script four-character short name.
// crate: unicode-script-0.5.7/src/lib.rs:37 from_short_name
export function Script_from_short_name(input: string): Script | undefined {
  return Script_inner_from_short_name(input);
}

/// Is this script "Recommended" according to
/// [UAX #31](www.unicode.org/reports/tr31/#Table_Recommended_Scripts)?
// crate: unicode-script-0.5.7/src/lib.rs:43 is_recommended
export function Script_is_recommended(self: Script): boolean {
  // use Script::*;
  switch (self) {
    case "Common":
    case "Inherited":
    case "Arabic":
    case "Armenian":
    case "Bengali":
    case "Bopomofo":
    case "Cyrillic":
    case "Devanagari":
    case "Ethiopic":
    case "Georgian":
    case "Greek":
    case "Gujarati":
    case "Gurmukhi":
    case "Han":
    case "Hangul":
    case "Hebrew":
    case "Hiragana":
    case "Kannada":
    case "Katakana":
    case "Khmer":
    case "Lao":
    case "Latin":
    case "Malayalam":
    case "Myanmar":
    case "Oriya":
    case "Sinhala":
    case "Tamil":
    case "Telugu":
    case "Thaana":
    case "Thai":
    case "Tibetan":
      return true;
    default:
      return false;
  }
}

/** `impl From<Script> for ScriptExtension` */
// crate: unicode-script-0.5.7/src/lib.rs:56 from
export function ScriptExtension_from_Script(script: Script): ScriptExtension {
  if (script === "Common") {
    return ScriptExtension.new_common();
  } else if (script === "Inherited") {
    return ScriptExtension.new_inherited();
  } else if (script === "Unknown") {
    return ScriptExtension.new_unknown();
  } else {
    let first = 0n;
    let second = 0n;
    let third = 0n;
    const bit = Script_discriminant[script];
    // Find out which field it's in, and set the appropriate bit there
    if (bit < 64) {
      first = 1n << BigInt(bit);
    } else if (bit < 128) {
      // offset by 64 since `bit` is an absolute number,
      // not relative to the chunk
      second = 1n << BigInt(bit - 64);
    } else {
      third = 1n << BigInt(bit - 128);
    }
    return ScriptExtension.new(first, second, third);
  }
}

/** `impl TryFrom<ScriptExtension> for Script` */
// crate: unicode-script-0.5.7/src/lib.rs:85 try_from
export function Script_try_from(ext: ScriptExtension): Result<Script, null> {
  if (ext.is_common_or_inherited()) {
    if (ext.common) {
      return Ok("Common");
    } else {
      return Ok("Inherited");
    }
  } else if (ext.is_empty()) {
    return Ok("Unknown");
  } else {
    // filled elements will have set ones
    const fo = count_ones(ext.first);
    const so = count_ones(ext.second);
    const to = count_ones(ext.third);
    // only one bit set, in the first chunk
    if (fo === 1 && so === 0 && to === 0) {
      // use trailing_zeroes() to figure out which bit it is
      return Ok(Script_for_integer(trailing_zeros(ext.first)));
      // only one bit set, in the second chunk
    } else if (fo === 0 && so === 1 && to === 0) {
      return Ok(Script_for_integer(64 + trailing_zeros(ext.second)));
      // only one bit set, in the third chunk
    } else if (fo === 0 && so === 0 && to === 1) {
      return Ok(Script_for_integer(128 + trailing_zeros(ext.third)));
    } else {
      return Err(null);
    }
  }
}

/** `impl Default for Script` */
// crate: unicode-script-0.5.7/src/lib.rs:117 default
export function Script_default(): Script {
  return "Common";
}

/** `impl From<char> for Script` */
// crate: unicode-script-0.5.7/src/lib.rs:123 from
export function Script_from_char(o: number): Script {
  return UnicodeScript_char.script(o);
}

/** `impl fmt::Display for Script` */
// crate: unicode-script-0.5.7/src/lib.rs:129 fmt
export function display_Script(self: Script): string {
  return Script_full_name(self);
}

// #[derive(Clone, Copy, PartialEq, Eq, Hash)]
// #[non_exhaustive]
/// A value for the `Script_Extension` property
///
/// [`ScriptExtension`] is one or more [`Script`]
///
/// This is essentially an optimized version of `Vec<Script>` that uses bitfields
export class ScriptExtension {
  constructor(
    // A bitset for the first 64 scripts
    readonly first: bigint,
    // A bitset for the scripts 65-128
    readonly second: bigint,
    // A bitset for scripts after 128
    readonly third: bigint,
    // Both Common and Inherited are represented by all used bits being set,
    // this flag lets us distinguish the two.
    readonly common: boolean,
  ) {}

  // We don't use the complete u64 of `third`, so the "all" value is not just u32::MAX
  // Instead, we take the number of the next (unused) script bit, subtract 128 to bring
  // it in the range of `third`, create a u64 with just that bit set, and subtract 1
  // to create one with all the lower bits set.
  static get THIRD_MAX(): bigint {
    return (1n << BigInt(NEXT_SCRIPT - 128)) - 1n;
  }

  // crate: unicode-script-0.5.7/src/lib.rs:160 new
  static new(first: bigint, second: bigint, third: bigint): ScriptExtension {
    return new ScriptExtension(first, second, third, false);
  }

  // crate: unicode-script-0.5.7/src/lib.rs:169 new_common
  static new_common(): ScriptExtension {
    return new ScriptExtension(U64_MAX, U64_MAX, ScriptExtension.THIRD_MAX, true);
  }

  // crate: unicode-script-0.5.7/src/lib.rs:178 new_inherited
  static new_inherited(): ScriptExtension {
    return new ScriptExtension(U64_MAX, U64_MAX, ScriptExtension.THIRD_MAX, false);
  }

  // crate: unicode-script-0.5.7/src/lib.rs:187 new_unknown
  static new_unknown(): ScriptExtension {
    return new ScriptExtension(0n, 0n, 0n, false);
  }

  // crate: unicode-script-0.5.7/src/lib.rs:196 is_common_or_inherited
  is_common_or_inherited(): boolean {
    return this.first === U64_MAX && this.second === U64_MAX && this.third === ScriptExtension.THIRD_MAX;
  }

  /// Checks if the script extension is Common
  // crate: unicode-script-0.5.7/src/lib.rs:201 is_common
  is_common(): boolean {
    return this.is_common_or_inherited() && this.common;
  }

  /// Checks if the script extension is Inherited
  // crate: unicode-script-0.5.7/src/lib.rs:206 is_inherited
  is_inherited(): boolean {
    return this.is_common_or_inherited() && !this.common;
  }

  /// Checks if the script extension is empty (unknown)
  // crate: unicode-script-0.5.7/src/lib.rs:211 is_empty
  is_empty(): boolean {
    return this.first === 0n && this.second === 0n && this.third === 0n;
  }

  /// Returns the number of scripts in the script extension
  // crate: unicode-script-0.5.7/src/lib.rs:216 len
  len(): number {
    if (this.is_common_or_inherited()) {
      return 1;
    } else {
      return count_ones(this.first) + count_ones(this.second) + count_ones(this.third);
    }
  }

  /// Intersect this `ScriptExtension` with another `ScriptExtension`. Produces `Unknown` if things
  /// do not intersect. This is equivalent to [`ScriptExtension::intersection`] but it stores the result
  /// in `self`
  ///
  /// "Common" (`Zyyy`) and "Inherited" (`Zinh`) are considered as intersecting
  /// everything, the intersection of `Common` and `Inherited` is `Inherited`
  // PORT: `&mut self` on a `Copy` value: returns the new value (`*self = self.intersection(other)`).
  // crate: unicode-script-0.5.7/src/lib.rs:230 intersect_with
  intersect_with(other: ScriptExtension): ScriptExtension {
    return this.intersection(other);
  }

  /// Find the intersection between two ScriptExtensions. Returns Unknown if things
  /// do not intersect.
  ///
  /// "Common" (`Zyyy`) and "Inherited" (`Zinh`) are considered as intersecting
  /// everything, the intersection of `Common` and `Inherited` is `Inherited`
  // crate: unicode-script-0.5.7/src/lib.rs:239 intersection
  intersection(other: ScriptExtension): ScriptExtension {
    const first = this.first & other.first;
    const second = this.second & other.second;
    const third = this.third & other.third;
    const common = this.common && other.common;
    return new ScriptExtension(first, second, third, common);
  }

  /// Find the union between two ScriptExtensions.
  ///
  /// "Common" (`Zyyy`) and "Inherited" (`Zinh`) are considered as intersecting
  /// everything, the union of `Common` and `Inherited` is `Common`
  // crate: unicode-script-0.5.7/src/lib.rs:256 union
  union(other: ScriptExtension): ScriptExtension {
    const first = this.first | other.first;
    const second = this.second | other.second;
    const third = this.third | other.third;
    const common = this.common || other.common;
    return new ScriptExtension(first, second, third, common);
  }

  /// Check if this ScriptExtension contains the given script
  ///
  /// Should be used with specific scripts only, this will
  /// return `true` if `self` is not `Unknown` and `script` is
  /// `Common` or `Inherited`
  // crate: unicode-script-0.5.7/src/lib.rs:274 contains_script
  contains_script(script: Script): boolean {
    return !this.intersection(ScriptExtension_from_Script(script)).is_empty();
  }

  /// Get the intersection of script extensions of all characters
  /// in a string.
  // crate: unicode-script-0.5.7/src/lib.rs:280 for_str
  static for_str(x: string): ScriptExtension {
    let ext = ScriptExtension.default();
    for (const ch of x) {
      ext = ext.intersect_with(ScriptExtension.from_char(ch.codePointAt(0)!));
    }
    return ext;
  }

  /// Iterate over the scripts in this script extension
  ///
  /// Will never yield Script::Unknown
  // crate: unicode-script-0.5.7/src/lib.rs:291 iter
  iter(): ScriptIterator {
    return new ScriptIterator(this);
  }

  /** `impl Default for ScriptExtension` */
  // crate: unicode-script-0.5.7/src/lib.rs:297 default
  static default(): ScriptExtension {
    return ScriptExtension.new_common();
  }

  /** `impl From<char> for ScriptExtension` */
  // crate: unicode-script-0.5.7/src/lib.rs:303 from
  static from_char(o: number): ScriptExtension {
    return UnicodeScript_char.script_extension(o);
  }

  /** `impl From<&'_ str> for ScriptExtension` */
  // crate: unicode-script-0.5.7/src/lib.rs:309 from
  static from_str(o: string): ScriptExtension {
    return ScriptExtension.for_str(o);
  }

  /** `#[derive(PartialEq)]` */
  eq(other: ScriptExtension): boolean {
    return this.first === other.first && this.second === other.second && this.third === other.third && this.common === other.common;
  }
}

/** `impl fmt::Debug for ScriptExtension` */
// crate: unicode-script-0.5.7/src/lib.rs:315 fmt
export function debug_ScriptExtension(self: ScriptExtension): string {
  return `ScriptExtension(${display_ScriptExtension(self)})`;
}

/** `impl fmt::Display for ScriptExtension` */
// crate: unicode-script-0.5.7/src/lib.rs:323 fmt
export function display_ScriptExtension(self: ScriptExtension): string {
  let f = "";
  if (self.is_common()) {
    f += "Common";
  } else if (self.is_inherited()) {
    f += "Inherited";
  } else if (self.is_empty()) {
    f += "Unknown";
  } else {
    let first = true;
    const it = self.iter();
    for (let script = it.next(); script !== undefined; script = it.next()) {
      if (!first) {
        f += " + ";
        first = false;
      }
      f += Script_full_name(script);
    }
  }
  return f;
}

/// Extension trait on `char` for calculating script properties
export interface UnicodeScript<T> {
  /// Get the script for a given character
  // crate: unicode-script-0.5.7/src/lib.rs:347 script
  script(self: T): Script;
  /// Get the Script_Extension for a given character
  // crate: unicode-script-0.5.7/src/lib.rs:349 script_extension
  script_extension(self: T): ScriptExtension;
}

/** `impl UnicodeScript for char` */
export const UnicodeScript_char: UnicodeScript<number> = {
  // crate: unicode-script-0.5.7/src/lib.rs:353 script
  script(self: number): Script {
    return get_script(self) ?? "Unknown";
  },

  // crate: unicode-script-0.5.7/src/lib.rs:357 script_extension
  script_extension(self: number): ScriptExtension {
    return get_script_extension(self) ?? ScriptExtension_from_Script(UnicodeScript_char.script(self));
  },
};

/// Iterator over scripts in a [ScriptExtension].
///
/// Can be obtained ia [ScriptExtension::iter()]
export class ScriptIterator {
  constructor(private ext: ScriptExtension) {}

  /** `impl Iterator for ScriptIterator` */
  // crate: unicode-script-0.5.7/src/lib.rs:372 next
  next(): Script | undefined {
    const ext = this.ext;
    if (ext.is_common_or_inherited()) {
      const common = ext.common;
      this.ext = ScriptExtension.new_unknown();
      if (common) {
        return "Common";
      } else {
        return "Inherited";
      }
      // Are there bits left in the first chunk?
    } else if (ext.first !== 0n) {
      // Find the next bit
      const bit = trailing_zeros(ext.first);
      // unset just that bit
      this.ext = new ScriptExtension(ext.first & ~(1n << BigInt(bit)), ext.second, ext.third, ext.common);
      return Script_for_integer(bit);
      // Are there bits left in the second chunk?
    } else if (ext.second !== 0n) {
      const bit = trailing_zeros(ext.second);
      this.ext = new ScriptExtension(ext.first, ext.second & ~(1n << BigInt(bit)), ext.third, ext.common);
      return Script_for_integer(64 + bit);
      // Are there bits left in the third chunk?
    } else if (ext.third !== 0n) {
      const bit = trailing_zeros(ext.third);
      this.ext = new ScriptExtension(ext.first, ext.second, ext.third & ~(1n << BigInt(bit)), ext.common);
      return Script_for_integer(128 + bit);
    } else {
      // Script::Unknown
      return undefined;
    }
  }
}

// Benchmarks (`#[cfg(feature = "bench")]`) are not ported:
// crate-skip: unicode-script-0.5.7/src/lib.rs:504 bench_script_intersection benchmark, not library code or a test
// crate-skip: unicode-script-0.5.7/src/lib.rs:514 bench_ext_to_script benchmark, not library code or a test
// crate-skip: unicode-script-0.5.7/src/lib.rs:525 bench_script_to_ext benchmark, not library code or a test
// crate-skip: unicode-script-0.5.7/src/lib.rs:535 bench_ext_intersection benchmark, not library code or a test
// crate-skip: unicode-script-0.5.7/src/lib.rs:545 bench_to_vec benchmark, not library code or a test
// crate-skip: unicode-script-0.5.7/src/lib.rs:554 bench_string_ext benchmark, not library code or a test
