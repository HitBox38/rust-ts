// Port of unic-langid-impl 0.9.6 `src/lib.rs`.
//
// PORT: cargo features. `likelysubtags` is off in rustc's build (rustc_error_messages enables only
// unic-langid's `macros`; no crate in upstream's Cargo.lock enables it). The `likelysubtags`
// module and `maximize`/`minimize` are ported anyway (they are only reachable when the feature is
// on); the one place where the feature changes the behaviour of always-present code, the
// `#[cfg(feature = "likelysubtags")]` block in `character_direction`, reads `FEATURES.likelysubtags`
// (default `false`, as in rustc; the crate's tests flip it to cover both cfgs). `serde` is off:
// serde.rs is not ported.
import { debug_option, debug_struct, debug_vec, type Fmt } from "../../std/fmt.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { utf8 } from "../../std/str.ts";
import { debug_LanguageIdentifierError, display_LanguageIdentifierError, LanguageIdentifierError } from "./errors.ts";
import * as layout_table from "./layout_table.ts";
import * as likelysubtags from "./likelysubtags/mod.ts";
import * as parser from "./parser/mod.ts";
import type { Peekable } from "./parser/mod.ts";
import { debug_Language, display_Language, Language } from "./subtags/language.ts";
import { debug_Region, display_Region, Region } from "./subtags/region.ts";
import { debug_Script, display_Script, Script } from "./subtags/script.ts";
import { debug_Variant, display_Variant, Variant } from "./subtags/variant.ts";

// mod errors; mod layout_table;
// #[cfg(feature = "likelysubtags")] pub mod likelysubtags;
// #[doc(hidden)] pub mod parser;
// #[cfg(feature = "serde")] mod serde;  (not ported: feature off)
// pub mod subtags;
export * as likelysubtags from "./likelysubtags/mod.ts";
export * as parser from "./parser/mod.ts";
export * as subtags from "./subtags/mod.ts";

export { debug_LanguageIdentifierError, display_LanguageIdentifierError, LanguageIdentifierError };

/** Cargo features of this crate as built for rustc (see the header). */
export const FEATURES = { likelysubtags: false };

/// Enum representing available character direction orientations.
// #[derive(Clone, Copy, Debug, PartialEq)]
export type CharacterDirection =
  /// Right To Left
  ///
  /// Used in languages such as Arabic, Hebrew, Fula, Kurdish etc.
  | "RTL"
  /// Left To Right
  ///
  /// Used in languages such as French, Spanish, English, German etc.
  | "LTR"
  /// Top To Bottom
  ///
  /// Used in Traditional Mongolian
  | "TTB";
export const CharacterDirection = { RTL: "RTL", LTR: "LTR", TTB: "TTB" } as const;

type PartsTuple = [Language, Script | undefined, Region | undefined, Variant[]];

/// `LanguageIdentifier` is a core struct representing a Unicode Language Identifier.
///
/// # Examples
///
/// ```
/// use unic_langid_impl::LanguageIdentifier;
///
/// let li: LanguageIdentifier = "en-US".parse()
///     .expect("Failed to parse.");
///
/// assert_eq!(li.language, "en");
/// assert_eq!(li.script, None);
/// assert_eq!(li.region.as_ref().map(Into::into), Some("US"));
/// assert_eq!(li.variants().len(), 0);
/// ```
///
/// # Parsing
///
/// Unicode recognizes three levels of standard conformance for any language identifier:
///
///  * *well-formed* - syntactically correct
///  * *valid* - well-formed and only uses registered language subtags, extensions, keywords, types...
///  * *canonical* - valid and no deprecated codes or structure.
///
/// At the moment parsing normalizes a well-formed language identifier converting
/// `_` separators to `-` and adjusting casing to conform to the Unicode standard.
///
/// Any bogus subtags will cause the parsing to fail with an error.
/// No subtag validation is performed.
///
/// # Examples:
///
/// ```
/// use unic_langid_impl::LanguageIdentifier;
///
/// let li: LanguageIdentifier = "eN_latn_Us-Valencia".parse()
///     .expect("Failed to parse.");
///
/// assert_eq!(li.language, "en");
/// assert_eq!(li.script.as_ref().map(Into::into), Some("Latn"));
/// assert_eq!(li.region.as_ref().map(Into::into), Some("US"));
/// assert_eq!(li.variants().map(|v| v.as_str()).collect::<Vec<_>>(), &["valencia"]);
/// ```
// #[derive(Default, Debug, PartialEq, Eq, Clone, Hash, PartialOrd, Ord)]
export class LanguageIdentifier {
  // PORT: the private field `variants` is `variants_`: a JS class cannot have a field and a method
  // (`variants()`) with the same name. Debug still prints `variants`.
  constructor(
    public language: Language,
    public script: Script | undefined,
    public region: Region | undefined,
    public variants_: Variant[] | undefined,
  ) {}

  /** `#[derive(Default)]` */
  static default(): LanguageIdentifier {
    return new LanguageIdentifier(Language.default(), undefined, undefined, undefined);
  }

  /// A constructor which takes a utf8 slice, parses it and
  /// produces a well-formed `LanguageIdentifier`.
  ///
  /// # Examples
  ///
  /// ```
  /// use unic_langid_impl::LanguageIdentifier;
  ///
  /// let li = LanguageIdentifier::from_bytes("en-US".as_bytes())
  ///     .expect("Parsing failed.");
  ///
  /// assert_eq!(li.to_string(), "en-US");
  /// ```
  // crate: unic-langid-impl-0.9.6/src/lib.rs:105 from_bytes
  static from_bytes(v: Uint8Array): Result<LanguageIdentifier, LanguageIdentifierError> {
    const r = parser.parse_language_identifier(v);
    if (r.$ === "Err") return Err(LanguageIdentifierError.from(r._0));
    return Ok(r._0);
  }

  /// A constructor which takes optional subtags as `AsRef<[u8]>`, parses them and
  /// produces a well-formed `LanguageIdentifier`.
  ///
  /// # Examples
  ///
  /// ```
  /// use unic_langid_impl::LanguageIdentifier;
  ///
  /// let li = LanguageIdentifier::from_parts(
  ///     "fr".parse().expect("Parsing failed."),
  ///     None,
  ///     Some("CA".parse().expect("Parsing failed.")),
  ///     &[]
  /// );
  ///
  /// assert_eq!(li.to_string(), "fr-CA");
  /// ```
  // crate: unic-langid-impl-0.9.6/src/lib.rs:126 from_parts
  static from_parts(
    language: Language,
    script: Script | undefined,
    region: Region | undefined,
    variants: readonly Variant[],
  ): LanguageIdentifier {
    let variants_: Variant[] | undefined;
    if (variants.length !== 0) {
      const v = variants.slice();
      parser.sort_unstable_dedup(v);
      variants_ = v;
    } else {
      variants_ = undefined;
    }

    return new LanguageIdentifier(language, script, region, variants_);
  }

  /// # Unchecked
  ///
  /// This function accepts subtags expecting variants
  /// to be deduplicated and ordered.
  // crate: unic-langid-impl-0.9.6/src/lib.rs:153 from_raw_parts_unchecked
  static from_raw_parts_unchecked(
    language: Language,
    script: Script | undefined,
    region: Region | undefined,
    variants: Variant[] | undefined,
  ): LanguageIdentifier {
    return new LanguageIdentifier(language, script, region, variants);
  }

  /// This method is used by `unic-locale` to handle partial
  /// subtag iterator.
  ///
  /// Not stable.
  // crate: unic-langid-impl-0.9.6/src/lib.rs:172 try_from_iter
  static try_from_iter(iter: Peekable<Uint8Array>, allow_extension: boolean): Result<LanguageIdentifier, LanguageIdentifierError> {
    const r = parser.parse_language_identifier_from_iter(iter, allow_extension);
    if (r.$ === "Err") return Err(LanguageIdentifierError.from(r._0));
    return Ok(r._0);
  }

  /// Consumes `LanguageIdentifier` and produces raw internal representations
  /// of all subtags in form of `u64`/`u32`.
  ///
  /// Primarily used for storing internal representation and restoring via
  /// `from_raw_parts_unchecked`.
  // crate: unic-langid-impl-0.9.6/src/lib.rs:208 into_parts
  into_parts(): PartsTuple {
    return [this.language, this.script, this.region, this.variants_ === undefined ? [] : this.variants_.slice()];
  }

  /// Compares a `LanguageIdentifier` to another `AsRef<LanguageIdentifier`
  /// allowing for either side to use the missing fields as wildcards.
  ///
  /// This allows for matching between `en` (treated as `en-*-*-*`) and `en-US`.
  ///
  /// # Examples
  ///
  /// ```
  /// use unic_langid_impl::LanguageIdentifier;
  ///
  /// let li1: LanguageIdentifier = "en".parse()
  ///     .expect("Parsing failed.");
  ///
  /// let li2: LanguageIdentifier = "en-US".parse()
  ///     .expect("Parsing failed.");
  ///
  /// assert_ne!(li1, li2); // "en" != "en-US"
  /// assert_ne!(li1.to_string(), li2.to_string()); // "en" != "en-US"
  ///
  /// assert_eq!(li1.matches(&li2, false, false), false); // "en" != "en-US"
  /// assert_eq!(li1.matches(&li2, true, false), true); // "en-*-*-*" == "en-US"
  /// assert_eq!(li1.matches(&li2, false, true), false); // "en" != "en-*-US-*"
  /// assert_eq!(li1.matches(&li2, true, true), true); // "en-*-*-*" == "en-*-US-*"
  /// ```
  // crate: unic-langid-impl-0.9.6/src/lib.rs:241 matches
  matches(other_: LanguageIdentifier, self_as_range: boolean, other_as_range: boolean): boolean {
    const other = other_.as_ref();
    return (
      this.language.matches(other.language, self_as_range, other_as_range) &&
      subtag_matches(this.script, other.script, self_as_range, other_as_range, (a, b) => a.eq(b)) &&
      subtag_matches(this.region, other.region, self_as_range, other_as_range, (a, b) => a.eq(b)) &&
      subtags_match(this.variants_, other.variants_, self_as_range, other_as_range, (a, b) => a.eq(b))
    );
  }

  /// Returns a vector of variants subtags of the `LanguageIdentifier`.
  ///
  /// # Examples
  ///
  /// ```
  /// use unic_langid_impl::LanguageIdentifier;
  ///
  /// let li1: LanguageIdentifier = "ca-ES-valencia".parse()
  ///     .expect("Parsing failed.");
  ///
  /// assert_eq!(li1.variants().map(|v| v.as_str()).collect::<Vec<_>>(), &["valencia"]);
  ///
  /// let li2: LanguageIdentifier = "de".parse()
  ///     .expect("Parsing failed.");
  ///
  /// assert_eq!(li2.variants().len(), 0);
  /// ```
  // crate: unic-langid-impl-0.9.6/src/lib.rs:277 variants
  variants(): readonly Variant[] {
    // PORT: `impl ExactSizeIterator<Item = &Variant>` → the slice itself.
    let variants: readonly Variant[];
    if (this.variants_ !== undefined) {
      variants = this.variants_;
    } else {
      variants = [];
    }

    return variants;
  }

  /// Sets variant subtags of the `LanguageIdentifier`.
  ///
  /// # Examples
  ///
  /// ```
  /// use unic_langid_impl::LanguageIdentifier;
  ///
  /// let mut li: LanguageIdentifier = "ca-ES".parse()
  ///     .expect("Parsing failed.");
  ///
  /// li.set_variants(&["valencia".parse().expect("Parsing failed.")]);
  ///
  /// assert_eq!(li.to_string(), "ca-ES-valencia");
  /// ```
  // crate: unic-langid-impl-0.9.6/src/lib.rs:300 set_variants
  set_variants(variants: readonly Variant[]): void {
    const v = variants.slice();

    if (v.length === 0) {
      this.variants_ = undefined;
    } else {
      parser.sort_unstable_dedup(v);
      this.variants_ = v;
    }
  }

  /// Tests if a variant subtag is present in the `LanguageIdentifier`.
  ///
  /// # Examples
  ///
  /// ```
  /// use unic_langid_impl::LanguageIdentifier;
  ///
  /// let mut li: LanguageIdentifier = "ca-ES-macos".parse()
  ///     .expect("Parsing failed.");
  ///
  /// assert_eq!(li.has_variant("valencia".parse().unwrap()), false);
  /// assert_eq!(li.has_variant("macos".parse().unwrap()), true);
  /// ```
  // crate: unic-langid-impl-0.9.6/src/lib.rs:325 has_variant
  has_variant(variant: Variant): boolean {
    const variants = this.variants_;
    if (variants !== undefined) {
      return variants.some((v) => v.eq(variant));
    } else {
      return false;
    }
  }

  /// Clears variant subtags of the `LanguageIdentifier`.
  ///
  /// # Examples
  ///
  /// ```
  /// use unic_langid_impl::LanguageIdentifier;
  ///
  /// let mut li: LanguageIdentifier = "ca-ES-valencia".parse()
  ///     .expect("Parsing failed.");
  ///
  /// li.clear_variants();
  ///
  /// assert_eq!(li.to_string(), "ca-ES");
  /// ```
  // crate: unic-langid-impl-0.9.6/src/lib.rs:347 clear_variants
  clear_variants(): void {
    this.variants_ = undefined;
  }

  /// Extends the `LanguageIdentifier` adding likely subtags based
  /// on tables provided by CLDR.
  ///
  /// # Examples
  ///
  /// ```
  /// use unic_langid_impl::LanguageIdentifier;
  ///
  /// let mut li: LanguageIdentifier = "en-US".parse()
  ///     .expect("Parsing failed.");
  ///
  /// assert_eq!(li.maximize(), true);
  /// assert_eq!(li.to_string(), "en-Latn-US");
  /// ```
  // #[cfg(feature = "likelysubtags")]
  // crate: unic-langid-impl-0.9.6/src/lib.rs:366 maximize
  maximize(): boolean {
    const new_li = likelysubtags.maximize(this.language, this.script, this.region);
    if (new_li !== undefined) {
      this.language = new_li[0];
      this.script = new_li[1];
      this.region = new_li[2];
      return true;
    } else {
      return false;
    }
  }

  /// Extends the `LanguageIdentifier` removing likely subtags based
  /// on tables provided by CLDR.
  ///
  /// # Examples
  ///
  /// ```
  /// use unic_langid_impl::LanguageIdentifier;
  ///
  /// let mut li: LanguageIdentifier = "en-Latn-US".parse()
  ///     .expect("Parsing failed.");
  ///
  /// assert_eq!(li.minimize(), true);
  /// assert_eq!(li.to_string(), "en");
  /// ```
  // #[cfg(feature = "likelysubtags")]
  // crate: unic-langid-impl-0.9.6/src/lib.rs:392 minimize
  minimize(): boolean {
    const new_li = likelysubtags.minimize(this.language, this.script, this.region);
    if (new_li !== undefined) {
      this.language = new_li[0];
      this.script = new_li[1];
      this.region = new_li[2];
      return true;
    } else {
      return false;
    }
  }

  /// Returns character direction of the `LanguageIdentifier`.
  ///
  /// # Examples
  ///
  /// ```
  /// use unic_langid_impl::{LanguageIdentifier, CharacterDirection};
  ///
  /// let li1: LanguageIdentifier = "es-AR".parse()
  ///     .expect("Parsing failed.");
  /// let li2: LanguageIdentifier = "fa".parse()
  ///     .expect("Parsing failed.");
  ///
  /// assert_eq!(li1.character_direction(), CharacterDirection::LTR);
  /// assert_eq!(li2.character_direction(), CharacterDirection::RTL);
  /// ```
  // crate: unic-langid-impl-0.9.6/src/lib.rs:418 character_direction
  character_direction(): CharacterDirection {
    const lang = this.language.into_u64();
    const script = this.script;
    if (script !== undefined && layout_table.SCRIPTS_CHARACTER_DIRECTION_LTR.includes(script.into_u32())) {
      return CharacterDirection.LTR;
    } else if (script !== undefined && layout_table.SCRIPTS_CHARACTER_DIRECTION_RTL.includes(script.into_u32())) {
      return CharacterDirection.RTL;
    } else if (script !== undefined && layout_table.SCRIPTS_CHARACTER_DIRECTION_TTB.includes(script.into_u32())) {
      return CharacterDirection.TTB;
    } else if (lang !== undefined && layout_table.LANGS_CHARACTER_DIRECTION_RTL.includes(lang)) {
      // #[cfg(feature = "likelysubtags")]
      if (FEATURES.likelysubtags) {
        const max = likelysubtags.maximize(this.language, undefined, this.region);
        if (max !== undefined && max[1] !== undefined) {
          const script = max[1];
          if (layout_table.SCRIPTS_CHARACTER_DIRECTION_LTR.includes(script.into_u32())) {
            return CharacterDirection.LTR;
          }
        }
      }
      return CharacterDirection.RTL;
    } else {
      return CharacterDirection.LTR;
    }
  }

  // crate: unic-langid-impl-0.9.6/src/lib.rs:454 from_str
  static from_str(source: string): Result<LanguageIdentifier, LanguageIdentifierError> {
    return LanguageIdentifier.from_bytes(utf8(source));
  }

  // crate: unic-langid-impl-0.9.6/src/lib.rs:461 as_ref
  as_ref(): LanguageIdentifier {
    return this;
  }

  // crate: unic-langid-impl-0.9.6/src/lib.rs:488 eq
  /** `impl PartialEq<&str> for LanguageIdentifier` */
  eq_str(other: string): boolean {
    return display_LanguageIdentifier(this) === other;
  }

  /** `#[derive(PartialEq)]` */
  eq(other: LanguageIdentifier): boolean {
    return this.cmp(other) === 0;
  }

  /** `#[derive(Ord)]`: fields in declaration order; `None` sorts first; slices lexicographically. */
  cmp(other: LanguageIdentifier): -1 | 0 | 1 {
    const c = this.language.cmp(other.language);
    if (c !== 0) return c;
    const cs = cmp_option(this.script, other.script, (a, b) => a.cmp(b));
    if (cs !== 0) return cs;
    const cr = cmp_option(this.region, other.region, (a, b) => a.cmp(b));
    if (cr !== 0) return cr;
    return cmp_option(this.variants_, other.variants_, (a, b) => {
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) {
        const ci = a[i]!.cmp(b[i]!);
        if (ci !== 0) return ci;
      }
      return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
    });
  }

  /** `#[derive(Clone)]` (PORT: `Language` is `Copy` but mutable through `clear`, so it is copied) */
  clone(): LanguageIdentifier {
    return new LanguageIdentifier(this.language.clone(), this.script, this.region, this.variants_?.slice());
  }
}

function cmp_option<T>(a: T | undefined, b: T | undefined, cmp: (a: T, b: T) => -1 | 0 | 1): -1 | 0 | 1 {
  if (a === undefined) return b === undefined ? 0 : -1;
  if (b === undefined) return 1;
  return cmp(a, b);
}

// crate: unic-langid-impl-0.9.6/src/lib.rs:467 fmt
/** `impl std::fmt::Display for LanguageIdentifier` (`to_string()`). */
export function display_LanguageIdentifier(self: LanguageIdentifier): string {
  let f = display_Language(self.language);
  const script = self.script;
  if (script !== undefined) {
    f += "-";
    f += display_Script(script);
  }
  const region = self.region;
  if (region !== undefined) {
    f += "-";
    f += display_Region(region);
  }
  const variants = self.variants_;
  if (variants !== undefined) {
    for (const variant of variants) {
      f += "-";
      f += display_Variant(variant);
    }
  }
  return f;
}

/** `#[derive(Debug)]` */
export function debug_LanguageIdentifier(self: LanguageIdentifier, f: Fmt): string {
  return debug_struct(f, "LanguageIdentifier", [
    ["language", debug_Language(self.language, f)],
    ["script", debug_option(self.script, f, debug_Script)],
    ["region", debug_option(self.region, f, debug_Region)],
    ["variants", debug_option(self.variants_, f, (v, f) => debug_vec(v, f, debug_Variant))],
  ]);
}

// crate: unic-langid-impl-0.9.6/src/lib.rs:493 subtag_matches
function subtag_matches<P>(
  subtag1: P | undefined,
  subtag2: P | undefined,
  as_range1: boolean,
  as_range2: boolean,
  eq: (a: P, b: P) => boolean,
): boolean {
  return (as_range1 && subtag1 === undefined) || (as_range2 && subtag2 === undefined) || option_eq(subtag1, subtag2, eq);
}

// crate: unic-langid-impl-0.9.6/src/lib.rs:502 is_option_empty
function is_option_empty<P>(subtag: readonly P[] | undefined): boolean {
  return subtag === undefined || subtag.length === 0;
}

// crate: unic-langid-impl-0.9.6/src/lib.rs:506 subtags_match
function subtags_match<P>(
  subtag1: readonly P[] | undefined,
  subtag2: readonly P[] | undefined,
  as_range1: boolean,
  as_range2: boolean,
  eq: (a: P, b: P) => boolean,
): boolean {
  // or is some and is empty!
  return (
    (as_range1 && is_option_empty(subtag1)) ||
    (as_range2 && is_option_empty(subtag2)) ||
    option_eq(subtag1, subtag2, (a, b) => a.length === b.length && a.every((x, i) => eq(x, b[i]!)))
  );
}

/** `<Option<P> as PartialEq>::eq` */
function option_eq<P>(a: P | undefined, b: P | undefined, eq: (a: P, b: P) => boolean): boolean {
  if (a === undefined || b === undefined) return a === b;
  return eq(a, b);
}

/// This is a best-effort operation that performs all available levels of canonicalization.
///
/// At the moment the operation will normalize casing and the separator, but in the future
/// it may also validate and update from deprecated subtags to canonical ones.
///
/// # Examples
///
/// ```
/// use unic_langid_impl::canonicalize;
///
/// assert_eq!(canonicalize("pL_latn_pl"), Ok("pl-Latn-PL".to_string()));
/// ```
// crate: unic-langid-impl-0.9.6/src/lib.rs:530 canonicalize
export function canonicalize(input: Uint8Array | string): Result<string, LanguageIdentifierError> {
  // PORT: `S: AsRef<[u8]>`: a JS string is taken as its UTF-8 bytes.
  const r = LanguageIdentifier.from_bytes(typeof input === "string" ? utf8(input) : input);
  if (r.$ === "Err") return r;
  const lang_id = r._0;
  return Ok(display_LanguageIdentifier(lang_id));
}

// Not ported: serde.rs (feature "serde" off) and the src/bin/* table generators (feature "binary";
// tools/codegen/vendor-tables.ts translates their output, tables.rs and layout_table.rs, instead).
// crate-skip: unic-langid-impl-0.9.6/src/serde.rs:5 serialize feature "serde" off
// crate-skip: unic-langid-impl-0.9.6/src/serde.rs:14 deserialize feature "serde" off
// crate-skip: unic-langid-impl-0.9.6/src/serde.rs:23 expecting feature "serde" off
// crate-skip: unic-langid-impl-0.9.6/src/serde.rs:27 visit_str feature "serde" off
// crate-skip: unic-langid-impl-0.9.6/src/serde.rs:41 serialize feature "serde" off
// crate-skip: unic-langid-impl-0.9.6/src/serde.rs:52 deserialize feature "serde" off
// crate-skip: unic-langid-impl-0.9.6/src/bin/generate_layout.rs:9 langid_to_direction_map data generator binary
// crate-skip: unic-langid-impl-0.9.6/src/bin/generate_layout.rs:39 check_all_script_variants data generator binary
// crate-skip: unic-langid-impl-0.9.6/src/bin/generate_layout.rs:56 main data generator binary
// crate-skip: unic-langid-impl-0.9.6/src/bin/generate_likelysubtags.rs:8 serialize_val data generator binary
// crate-skip: unic-langid-impl-0.9.6/src/bin/generate_likelysubtags.rs:17 serialize_lang_option data generator binary
// crate-skip: unic-langid-impl-0.9.6/src/bin/generate_likelysubtags.rs:25 serialize_script_option data generator binary
// crate-skip: unic-langid-impl-0.9.6/src/bin/generate_likelysubtags.rs:33 serialize_region_option data generator binary
// crate-skip: unic-langid-impl-0.9.6/src/bin/generate_likelysubtags.rs:41 main data generator binary

