// Port of unicode-security =0.1.2 `src/mixed_script.rs`.

//! [Mixed-script detection](https://www.unicode.org/reports/tr39/#Mixed_Script_Detection)

import { type Script, ScriptExtension, Script_full_name, Script_short_name, ScriptExtension_from_Script } from "../unicode_script/lib.ts";
import { potential_mixed_script_confusable } from "./tables.ts";

/// An Augmented script set, as defined by UTS 39
///
/// https://www.unicode.org/reports/tr39/#def-augmented-script-set
// #[derive(Copy, Clone, PartialEq, Hash, Eq)]
// PORT: a `Copy` struct: `intersect_with` mutates in place, so callers copy with `clone()` where Rust copies.
export class AugmentedScriptSet {
  constructor(
    /// The base ScriptExtension value
    public base: ScriptExtension,
    /// Han With Bopomofo
    public hanb: boolean,
    /// Japanese
    public jpan: boolean,
    /// Korean
    public kore: boolean,
  ) {}

  clone(): AugmentedScriptSet {
    return new AugmentedScriptSet(this.base, this.hanb, this.jpan, this.kore);
  }

  /** `#[derive(PartialEq)]` */
  eq(other: AugmentedScriptSet): boolean {
    return this.base.eq(other.base) && this.hanb === other.hanb && this.jpan === other.jpan && this.kore === other.kore;
  }

  /** PORT: `#[derive(Hash, Eq)]`: a string key with the same equality, for `Map` keys. */
  hash_key(): string {
    const b = this.base;
    return `${b.first}:${b.second}:${b.third}:${+b.common}:${+this.hanb}${+this.jpan}${+this.kore}`;
  }

  /** `impl From<ScriptExtension> for AugmentedScriptSet` */
  // crate: unicode-security-0.1.2/src/mixed_script.rs:22 from
  static from_ScriptExtension(ext: ScriptExtension): AugmentedScriptSet {
    let hanb = false;
    let jpan = false;
    let kore = false;

    if (ext.is_common() || ext.is_inherited() || ext.contains_script("Han")) {
      hanb = true;
      jpan = true;
      kore = true;
    } else {
      if (ext.contains_script("Hiragana") || ext.contains_script("Katakana")) {
        jpan = true;
      }

      if (ext.contains_script("Hangul")) {
        kore = true;
      }

      if (ext.contains_script("Bopomofo")) {
        hanb = true;
      }
    }
    return new AugmentedScriptSet(ext, hanb, jpan, kore);
  }

  /** `impl From<char> for AugmentedScriptSet` */
  // crate: unicode-security-0.1.2/src/mixed_script.rs:54 from
  static from_char(c: number): AugmentedScriptSet {
    return AugmentedScriptSet.for_char(c);
  }

  /** `impl From<&'_ str> for AugmentedScriptSet` */
  // crate: unicode-security-0.1.2/src/mixed_script.rs:60 from
  static from_str(s: string): AugmentedScriptSet {
    return AugmentedScriptSet.for_str(s);
  }

  /** `impl Default for AugmentedScriptSet` */
  // crate: unicode-security-0.1.2/src/mixed_script.rs:66 default
  static default(): AugmentedScriptSet {
    return new AugmentedScriptSet(ScriptExtension_from_Script("Common"), true, true, true);
  }

  /// Intersect this set with another
  // crate: unicode-security-0.1.2/src/mixed_script.rs:144 intersect_with
  intersect_with(other: AugmentedScriptSet): void {
    this.base = this.base.intersect_with(other.base);
    this.hanb = this.hanb && other.hanb;
    this.jpan = this.jpan && other.jpan;
    this.kore = this.kore && other.kore;
  }

  /// Check if the set is empty
  // crate: unicode-security-0.1.2/src/mixed_script.rs:152 is_empty
  is_empty(): boolean {
    return this.base.is_empty() && !this.hanb && !this.jpan && !this.kore;
  }

  /// Check if the set is "All" (Common or Inherited)
  // crate: unicode-security-0.1.2/src/mixed_script.rs:157 is_all
  is_all(): boolean {
    return this.base.is_common() || this.base.is_inherited();
  }

  /// Construct an AugmentedScriptSet for a given character
  // crate: unicode-security-0.1.2/src/mixed_script.rs:162 for_char
  static for_char(c: number): AugmentedScriptSet {
    return AugmentedScriptSet.from_ScriptExtension(ScriptExtension.from_char(c));
  }

  /// Find the [resolved script set](https://www.unicode.org/reports/tr39/#def-resolved-script-set) of a given string
  // crate: unicode-security-0.1.2/src/mixed_script.rs:167 for_str
  static for_str(s: string): AugmentedScriptSet {
    const set = AugmentedScriptSet.default();
    for (const ch of s) {
      set.intersect_with(AugmentedScriptSet.from_char(ch.codePointAt(0)!));
    }
    return set;
  }
}

/** `impl Debug for AugmentedScriptSet` */
// crate: unicode-security-0.1.2/src/mixed_script.rs:77 fmt
export function debug_AugmentedScriptSet(self: AugmentedScriptSet): string {
  let f = "";
  if (self.is_empty()) {
    f += "AugmentedScriptSet {∅}";
  } else if (self.is_all()) {
    f += "AugmentedScriptSet {ALL}";
  } else {
    f += "AugmentedScriptSet {";
    let first_entry = true;
    const hanb = self.hanb ? "Hanb" : undefined;
    const jpan = self.jpan ? "Jpan" : undefined;
    const kore = self.kore ? "Kore" : undefined;
    const scripts: string[] = [];
    const it = self.base.iter();
    for (let s: Script | undefined = it.next(); s !== undefined; s = it.next()) scripts.push(Script_short_name(s));
    for (const writing_system of [hanb, jpan, kore, ...scripts]) {
      if (writing_system === undefined) continue;
      if (!first_entry) {
        f += ", ";
      } else {
        first_entry = false;
      }
      f += writing_system;
    }
    f += "}";
  }
  return f;
}

/** `impl fmt::Display for AugmentedScriptSet` */
// crate: unicode-security-0.1.2/src/mixed_script.rs:109 fmt
export function display_AugmentedScriptSet(self: AugmentedScriptSet): string {
  let f = "";
  if (self.is_empty()) {
    f += "Empty";
  } else if (self.is_all()) {
    f += "All";
  } else {
    let first_entry = true;
    const hanb = self.hanb ? "Han with Bopomofo" : undefined;
    const jpan = self.jpan ? "Japanese" : undefined;
    const kore = self.kore ? "Korean" : undefined;
    const scripts: string[] = [];
    const it = self.base.iter();
    for (let s: Script | undefined = it.next(); s !== undefined; s = it.next()) scripts.push(Script_full_name(s));
    for (const writing_system of [hanb, jpan, kore, ...scripts]) {
      if (writing_system === undefined) continue;
      if (!first_entry) {
        f += ", ";
      } else {
        first_entry = false;
      }
      f += writing_system;
    }
  }
  return f;
}

/// Extension trait for [mixed-script detection](https://www.unicode.org/reports/tr39/#Mixed_Script_Detection)
export interface MixedScript<T> {
  /// Check if a string is [single-script](https://www.unicode.org/reports/tr39/#def-single-script)
  ///
  /// Note that a single-script string may still contain multiple Script properties!
  // crate: unicode-security-0.1.2/src/mixed_script.rs:181 is_single_script
  is_single_script(self: T): boolean;

  /// Find the [resolved script set](https://www.unicode.org/reports/tr39/#def-resolved-script-set) of a given string
  // crate: unicode-security-0.1.2/src/mixed_script.rs:184 resolve_script_set
  resolve_script_set(self: T): AugmentedScriptSet;
}

/** `impl MixedScript for &'_ str` */
export const MixedScript_str: MixedScript<string> = {
  // crate: unicode-security-0.1.2/src/mixed_script.rs:188 is_single_script
  is_single_script(self: string): boolean {
    return !AugmentedScriptSet.for_str(self).is_empty();
  },

  // crate: unicode-security-0.1.2/src/mixed_script.rs:192 resolve_script_set
  resolve_script_set(self: string): AugmentedScriptSet {
    return AugmentedScriptSet.from_str(self);
  },
};

/// Check if a character is considered potential mixed script confusable.
///
/// If the specified character is not restricted from use for identifiers,
/// this function returns whether it is considered mixed script confusable
/// with another character that is not restricted from use for identifiers.
///
/// If the specified character is restricted from use for identifiers,
/// the return value is unspecified.
// crate: unicode-security-0.1.2/src/mixed_script.rs:205 is_potential_mixed_script_confusable_char
export function is_potential_mixed_script_confusable_char(c: number): boolean {
  // use crate::tables::potential_mixed_script_confusable::potential_mixed_script_confusable;

  return potential_mixed_script_confusable(c);
}
