// Port of unicode-security =0.1.2 `src/restriction_level.rs`.

//! For detecting the [restriction level](https://www.unicode.org/reports/tr39/#Restriction_Level_Detection)
//! a string conforms to

import { Script_is_recommended } from "../unicode_script/lib.ts";
import { GeneralSecurityProfile_char } from "./general_security_profile.ts";
import { AugmentedScriptSet } from "./mixed_script.ts";

// #[derive(Copy, Clone, PartialEq, PartialOrd, Eq, Ord, Debug, Hash)]
/// The [Restriction level](https://www.unicode.org/reports/tr39/#Restriction_Level_Detection)
/// a string conforms to
export type RestrictionLevel =
  /// https://www.unicode.org/reports/tr39/#ascii_only
  | "ASCIIOnly"
  /// https://www.unicode.org/reports/tr39/#single_script
  | "SingleScript"
  /// https://www.unicode.org/reports/tr39/#highly_restrictive
  | "HighlyRestrictive"
  /// https://www.unicode.org/reports/tr39/#moderately_restrictive
  | "ModeratelyRestrictive"
  /// https://www.unicode.org/reports/tr39/#minimally_restrictive
  | "MinimallyRestrictive"
  /// https://www.unicode.org/reports/tr39/#unrestricted
  | "Unrestricted";
export const RestrictionLevel = {
  ASCIIOnly: "ASCIIOnly",
  SingleScript: "SingleScript",
  HighlyRestrictive: "HighlyRestrictive",
  ModeratelyRestrictive: "ModeratelyRestrictive",
  MinimallyRestrictive: "MinimallyRestrictive",
  Unrestricted: "Unrestricted",
} as const;
/** Variant order (`#[derive(PartialOrd, Ord)]`). */
export const RestrictionLevel_discriminant: Readonly<Record<RestrictionLevel, number>> = {
  ASCIIOnly: 0,
  SingleScript: 1,
  HighlyRestrictive: 2,
  ModeratelyRestrictive: 3,
  MinimallyRestrictive: 4,
  Unrestricted: 5,
};

/// Utilities for determining which [restriction level](https://www.unicode.org/reports/tr39/#Restriction_Level_Detection)
/// a string satisfies
export interface RestrictionLevelDetection<T> {
  /// Detect the [restriction level](https://www.unicode.org/reports/tr39/#Restriction_Level_Detection)
  ///
  /// This will _not_ check identifier well-formedness, as different applications may have different notions of well-formedness
  // crate: unicode-security-0.1.2/src/restriction_level.rs:32 detect_restriction_level
  detect_restriction_level(self: T): RestrictionLevel;

  /// Check if a string satisfies the supplied [restriction level](https://www.unicode.org/reports/tr39/#Restriction_Level_Detection)
  ///
  /// This will _not_ check identifier well-formedness, as different applications may have different notions of well-formedness
  // (provided) check_restriction_level
  check_restriction_level(self: T, level: RestrictionLevel): boolean;
}

/** The provided methods of `RestrictionLevelDetection`. */
export const RestrictionLevelDetection_provided = {
  // crate: unicode-security-0.1.2/src/restriction_level.rs:37 check_restriction_level
  check_restriction_level<T>(impl_: RestrictionLevelDetection<T>, self: T, level: RestrictionLevel): boolean {
    return RestrictionLevel_discriminant[impl_.detect_restriction_level(self)] <= RestrictionLevel_discriminant[level];
  },
};

/** `impl RestrictionLevelDetection for &'_ str` */
export const RestrictionLevelDetection_str: RestrictionLevelDetection<string> = {
  // crate: unicode-security-0.1.2/src/restriction_level.rs:43 detect_restriction_level
  detect_restriction_level(self: string): RestrictionLevel {
    let ascii_only = true;
    const set = AugmentedScriptSet.default();
    const exclude_latin_set = AugmentedScriptSet.default();
    for (const s of self) {
      const ch = s.codePointAt(0)!;
      if (!GeneralSecurityProfile_char.identifier_allowed(ch)) {
        return "Unrestricted";
      }
      if (ch >= 0x80) {
        ascii_only = false;
      }
      const ch_set = AugmentedScriptSet.from_char(ch);
      set.intersect_with(ch_set);
      if (!ch_set.base.contains_script("Latin")) {
        exclude_latin_set.intersect_with(ch_set);
      }
    }

    if (ascii_only) {
      return "ASCIIOnly";
    } else if (!set.is_empty()) {
      return "SingleScript";
    } else if (exclude_latin_set.kore || exclude_latin_set.hanb || exclude_latin_set.jpan) {
      return "HighlyRestrictive";
    } else if (exclude_latin_set.base.len() === 1) {
      const script = exclude_latin_set.base.iter().next()!;
      if (Script_is_recommended(script) && script !== "Cyrillic" && script !== "Greek") {
        return "ModeratelyRestrictive";
      }
    }
    return "MinimallyRestrictive";
  },

  check_restriction_level(self: string, level: RestrictionLevel): boolean {
    return RestrictionLevelDetection_provided.check_restriction_level(RestrictionLevelDetection_str, self, level);
  },
};
