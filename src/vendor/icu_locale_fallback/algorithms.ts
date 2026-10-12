// Port of icu_locale_fallback 2.3.0 `src/algorithms.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
//
// PORT: `&mut DataLocale` is the (mutable) DataLocale object; `&mut Option<Script>` is a `{ value }` cell.
// Map keys are the concatenated ULE bytes of the `to_unvalidated()` subtags (see zerovec/map/map.ts).
import type { DataLocale } from "../icu_locale_core/data.ts";
import { Language } from "../icu_locale_core/subtags/language.ts";
import type { Region } from "../icu_locale_core/subtags/region.ts";
import type { Script } from "../icu_locale_core/subtags/script.ts";
import { to_unvalidated } from "../tinystr/unvalidated.ts";
import { reverse } from "../writeable/cmp.ts";
import type { LocaleFallbackerWithConfig, LocaleFallbackIteratorInner } from "./lib.ts";

/** The ULE bytes of a tuple of `UnvalidatedTinyAsciiStr`s (the fields' bytes, concatenated). */
function ule(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

const eq_script = (a: Script | undefined, b: Script | undefined) => (a === undefined || b === undefined ? a === b : a.eq(b));

// impl LocaleFallbackerWithConfig<'_>
// crate: icu_locale_fallback-2.3.0/src/algorithms.rs:11 normalize
export function LocaleFallbackerWithConfig_normalize(
  self: LocaleFallbackerWithConfig,
  locale: DataLocale,
  default_script: { value: Script | undefined },
): void {
  // 0. If there is an invalid or trivial "sd" subtag, drop it
  {
    const subdivision = locale.subdivision;
    locale.subdivision = undefined;
    const region = locale.region;
    if (
      subdivision !== undefined &&
      region !== undefined &&
      subdivision.as_str().startsWith(region.to_tinystr().to_ascii_lowercase().as_str()) &&
      !subdivision.as_str().endsWith("zzzz")
    ) {
      locale.subdivision = subdivision;
    }
  }
  const language = locale.language;
  // 1. Populate the region (required for region fallback only)
  if (self.config.priority === "Region" && locale.region === undefined) {
    // 1a. First look for region based on language+script
    if (locale.script !== undefined) {
      const script = locale.script;
      locale.region = self.likely_subtags.language_script.get(ule(to_unvalidated(language.to_tinystr())._0, to_unvalidated(script.to_tinystr())._0));
    }
    // 1b. If that fails, try language only
    if (locale.region === undefined) {
      const sr = self.likely_subtags.language.get_copied(to_unvalidated(language.to_tinystr())._0);
      locale.region = sr !== undefined ? sr[1] : undefined;
    }
  }
  // 2. Remove the script if it is implied by the other subtags
  if (locale.script !== undefined || locale.region !== undefined || self.config.priority === "Script") {
    let ds: Script | undefined = undefined;
    if (locale.region !== undefined) {
      const region = locale.region;
      ds = self.likely_subtags.language_region.get_copied(ule(to_unvalidated(language.to_tinystr())._0, to_unvalidated(region.to_tinystr())._0));
    }
    if (ds === undefined) {
      const sr = self.likely_subtags.language.get_copied(to_unvalidated(language.to_tinystr())._0);
      ds = sr !== undefined ? sr[0] : undefined;
    }
    default_script.value = ds;
    if (eq_script(locale.script, default_script.value)) {
      locale.script = undefined;
    }
  }
}

// impl LocaleFallbackIteratorInner<'_>
// crate: icu_locale_fallback-2.3.0/src/algorithms.rs:72 step
export function LocaleFallbackIteratorInner_step(self: LocaleFallbackIteratorInner, locale: DataLocale): void {
  switch (self.config.priority) {
    case "Language":
      return step_language(self, locale);
    case "Script":
      return step_script(self, locale);
    case "Region":
      return step_region(self, locale);
  }
}

// crate: icu_locale_fallback-2.3.0/src/algorithms.rs:90 step_language
function step_language(self: LocaleFallbackIteratorInner, locale: DataLocale): void {
  // 2. Remove the subdivision keyword
  if (locale.subdivision !== undefined) {
    self.backup_subdivision = locale.subdivision;
    locale.subdivision = undefined;
    return;
  }
  // 4. Remove variants
  if (locale.variant !== undefined) {
    self.backup_variant = locale.variant;
    locale.variant = undefined;
    return;
  }
  // 5. Check for parent override
  const parent = get_explicit_parent(self, locale);
  if (parent !== undefined) {
    const [language, script, region] = parent;
    locale.language = language;
    locale.script = script;
    locale.region = region;
    locale.variant = self.backup_variant;
    self.backup_variant = undefined;
    return;
  }
  // 7. Remove region
  if (locale.region !== undefined) {
    // note: self.backup_region is not used right now
    // 6. Add or remove the script subtag if necessary
    const sr = self.likely_subtags.language.get_copied(to_unvalidated(locale.language.to_tinystr())._0);
    const language_implied_script = sr !== undefined ? sr[0] : undefined;
    if (!eq_script(language_implied_script, self.max_script)) {
      locale.script = self.max_script;
    } else {
      locale.script = undefined;
    }
    locale.region = undefined;
    locale.variant = self.backup_variant;
    self.backup_variant = undefined;
    return;
  }
  // 8. Remove language+script
  // debug_assert!(!locale.language.is_unknown() || locale.script.is_some()); // don't call .step() on und
  locale.script = undefined;
  locale.language = Language.UNKNOWN;
}

// crate: icu_locale_fallback-2.3.0/src/algorithms.rs:133 step_region
function step_region(self: LocaleFallbackIteratorInner, locale: DataLocale): void {
  // 2. Remove the subdivision keyword
  if (locale.subdivision !== undefined) {
    self.backup_subdivision = locale.subdivision;
    locale.subdivision = undefined;
    return;
  }
  // 4. Remove variants
  if (locale.variant !== undefined) {
    self.backup_variant = locale.variant;
    locale.variant = undefined;
    return;
  }
  // 5. Remove language+script
  if (!locale.language.is_unknown() || locale.script !== undefined) {
    locale.script = undefined;
    locale.language = Language.UNKNOWN;
    // Don't produce und-variant
    if (locale.region !== undefined) {
      locale.variant = self.backup_variant;
      self.backup_variant = undefined;
      locale.subdivision = self.backup_subdivision;
      self.backup_subdivision = undefined;
    }
    return;
  }
  // 6. Remove region
  // debug_assert!(locale.region.is_some()); // don't call .step() on und
  locale.region = undefined;
}

// crate: icu_locale_fallback-2.3.0/src/algorithms.rs:160 step_script
function step_script(self: LocaleFallbackIteratorInner, locale: DataLocale): void {
  // Remove the subdivision keyword
  if (locale.subdivision !== undefined) {
    self.backup_subdivision = locale.subdivision;
    locale.subdivision = undefined;
    return;
  }
  // Remove variants
  if (locale.variant !== undefined) {
    self.backup_variant = locale.variant;
    locale.variant = undefined;
    return;
  }
  // Check for parent override
  const parent = get_explicit_parent(self, locale);
  if (parent !== undefined) {
    const [language, script, region] = parent;
    locale.language = language;
    locale.script = script;
    locale.region = region;
    locale.variant = self.backup_variant;
    self.backup_variant = undefined;
    return;
  }
  // Remove the region
  if (locale.region !== undefined) {
    self.backup_region = locale.region;
    const sr = self.likely_subtags.language.get_copied(to_unvalidated(locale.language.to_tinystr())._0);
    const language_implied_script = sr !== undefined ? sr[0] : undefined;
    if (!eq_script(language_implied_script, self.max_script)) {
      locale.script = self.max_script;
    } else {
      locale.script = undefined;
    }
    locale.region = undefined;
    locale.variant = self.backup_variant;
    self.backup_variant = undefined;
    return;
  }

  // Remove the script if we have a language
  if (!locale.language.is_unknown()) {
    const sr = self.likely_subtags.language.get_copied(to_unvalidated(locale.language.to_tinystr())._0);
    const language_implied_script = sr !== undefined ? sr[0] : undefined;
    if (locale.script !== undefined && eq_script(language_implied_script, locale.script)) {
      locale.script = undefined;
      if (self.backup_region !== undefined) {
        const region: Region = self.backup_region;
        self.backup_region = undefined;
        locale.region = region;
        locale.subdivision = self.backup_subdivision;
        self.backup_subdivision = undefined;
        locale.variant = self.backup_variant;
        self.backup_variant = undefined;
      }
      // needed if more fallback is added at the end
    } else {
      // 3. Remove the language and apply the maximized script
      locale.language = Language.UNKNOWN;
      locale.script = self.max_script;
      // Don't produce und-variant
      if (locale.script !== undefined) {
        locale.variant = self.backup_variant;
        self.backup_variant = undefined;
      }
      // needed if more fallback is added at the end
    }
  } else if (locale.script !== undefined) {
    // note: UTS #35 wants us to apply "other associated scripts" now. ICU4C/J does not do this,
    // so we don't either. They would be found here if they are ever needed:
    // https://github.com/unicode-cldr/cldr-core/blob/master/supplemental/languageData.json

    // 6. Remove script
    locale.script = undefined;
  }
}

// crate: icu_locale_fallback-2.3.0/src/algorithms.rs:232 get_explicit_parent
function get_explicit_parent(
  self: LocaleFallbackIteratorInner,
  locale: DataLocale,
): [Language, Script | undefined, Region | undefined] | undefined {
  return self.parents.parents.get_copied_by((uvstr) => reverse(locale.strict_cmp(uvstr)));
}


