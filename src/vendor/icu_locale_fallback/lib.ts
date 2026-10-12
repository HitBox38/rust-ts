// Port of icu_locale_fallback 2.3.0 `src/lib.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! Tools for locale fallback, enabling arbitrary input locales to be mapped into the nearest
//! locale with data.
import type { Result } from "../../std/result.ts";
import { Ok } from "../../std/result.ts";
import { DataLocale } from "../icu_locale_core/data.ts";
import { Language } from "../icu_locale_core/subtags/language.ts";
import { region, type Region } from "../icu_locale_core/subtags/region.ts";
import { script, type Script } from "../icu_locale_core/subtags/script.ts";
import type { Subtag } from "../icu_locale_core/subtags/mod.ts";
import type { Variant } from "../icu_locale_core/subtags/variant.ts";
import type { DataProvider } from "../icu_provider/data_provider.ts";
import type { DataError } from "../icu_provider/error.ts";
import { LocaleFallbackConfig, LocaleFallbackPriority } from "../icu_provider/fallback.ts";
import { DataIdentifierBorrowed, DataRequest } from "../icu_provider/request.ts";
import { DataPayload } from "../icu_provider/response.ts";
import { ZeroMap } from "../zerovec/map/map.ts";
import { Baked, type LikelySubtagsForLanguage, LocaleLikelySubtagsLanguageV1, LocaleParentsV1, type Parents } from "./provider.ts";
import { LocaleFallbackIteratorInner_step, LocaleFallbackerWithConfig_normalize } from "./algorithms.ts";

export { LocaleFallbackConfig, LocaleFallbackPriority } from "../icu_provider/fallback.ts";
// mod algorithms; pub mod provider;
export * as provider from "./provider.ts";

/// Implements the algorithm defined in *[UTS #35: Locale Inheritance and Matching]*.
///
/// Note that this implementation performs some additional steps compared to the *UTS #35*
/// algorithm. See *[the design doc]* for a detailed description and [#2243](
/// https://github.com/unicode-org/icu4x/issues/2243) to track alignment with *UTS #35*.
///
/// If running fallback in a loop, use [`DataLocale::is_unknown()`] to break from the loop.
///
/// [UTS #35: Locale Inheritance and Matching]: https://www.unicode.org/reports/tr35/#Locale_Inheritance
/// [the design doc]: https://docs.google.com/document/d/1Mp7EUyl-sFh_HZYgyeVwj88vJGpCBIWxzlCwGgLCDwM/edit
// #[derive(Debug, Clone, PartialEq)]
export class LocaleFallbacker {
  constructor(
    public likely_subtags: DataPayload<LikelySubtagsForLanguage>,
    public parents: DataPayload<Parents>,
  ) {}

  /// Creates a [`LocaleFallbacker`] with compiled fallback data (likely subtags and parent locales).
  ///
  /// ✨ *Enabled with the `compiled_data` Cargo feature.*
  // crate: icu_locale_fallback-2.3.0/src/lib.rs:143 new
  static new(): LocaleFallbackerBorrowed {
    // Safety: we're transmuting down from LocaleFallbackerBorrowed<'static> to LocaleFallbackerBorrowed<'a>
    return LocaleFallbackerBorrowed.new();
  }

  // icu_provider::gen_buffer_data_constructors!(() -> error: DataError, functions: [new: skip, try_new_with_buffer_provider, try_new_unstable, Self]);
  // (buffer providers are not ported)

  // crate: icu_locale_fallback-2.3.0/src/lib.rs:165 try_new_unstable
  static try_new_unstable(provider: DataProvider): Result<LocaleFallbacker, DataError> {
    const likely_subtags = provider.load(LocaleLikelySubtagsLanguageV1, DataRequest(DataIdentifierBorrowed.default()));
    if (likely_subtags.$ === "Err") return likely_subtags;
    const parents = provider.load(LocaleParentsV1, DataRequest(DataIdentifierBorrowed.default()));
    if (parents.$ === "Err") return parents;
    return Ok(new LocaleFallbacker(likely_subtags._0.payload, parents._0.payload));
  }

  /// Creates a [`LocaleFallbacker`] without fallback data. Using this constructor may result in
  /// surprising behavior, especially in multi-script languages.
  // crate: icu_locale_fallback-2.3.0/src/lib.rs:179 new_without_data
  static new_without_data(): LocaleFallbacker {
    return new LocaleFallbacker(
      DataPayload.from_owned<LikelySubtagsForLanguage>({
        language: ZeroMap.from_parts_unchecked([], []),
        language_region: ZeroMap.from_parts_unchecked([], []),
        language_script: ZeroMap.from_parts_unchecked([], []),
        // Unused
        und: [Language.UNKNOWN, script("Zzzz"), region("ZZ")],
      }),
      DataPayload.from_owned<Parents>({ parents: ZeroMap.from_parts_unchecked([], []) }),
    );
  }

  /// Associates a configuration with this fallbacker.
  // crate: icu_locale_fallback-2.3.0/src/lib.rs:194 for_config
  for_config(config: LocaleFallbackConfig): LocaleFallbackerWithConfig {
    return this.as_borrowed().for_config(config);
  }

  /// Creates a borrowed version of this fallbacker for performance.
  // crate: icu_locale_fallback-2.3.0/src/lib.rs:199 as_borrowed
  as_borrowed(): LocaleFallbackerBorrowed {
    return new LocaleFallbackerBorrowed(this.likely_subtags.get(), this.parents.get());
  }
}

/// Borrowed version of [`LocaleFallbacker`].
// #[derive(Debug, Clone, Copy, PartialEq)]
export class LocaleFallbackerBorrowed {
  constructor(
    public likely_subtags: LikelySubtagsForLanguage,
    public parents: Parents,
  ) {}

  /// Associates a configuration with this fallbacker.
  // crate: icu_locale_fallback-2.3.0/src/lib.rs:210 for_config
  for_config(config: LocaleFallbackConfig): LocaleFallbackerWithConfig {
    return new LocaleFallbackerWithConfig(this.likely_subtags, this.parents, config);
  }

  /// Creates a [`LocaleFallbackerBorrowed`] with compiled fallback data (likely subtags and parent locales).
  // crate: icu_locale_fallback-2.3.0/src/lib.rs:227 new
  static new(): LocaleFallbackerBorrowed {
    return new LocaleFallbackerBorrowed(Baked.SINGLETON_LOCALE_LIKELY_SUBTAGS_LANGUAGE_V1, Baked.SINGLETON_LOCALE_PARENTS_V1);
  }

  /// Cheaply converts a [`LocaleFallbackerBorrowed<'static>`] into a [`LocaleFallbacker`].
  ///
  /// Note: Due to branching and indirection, using [`LocaleFallbacker`] might inhibit some
  /// compile-time optimizations that are possible with [`LocaleFallbackerBorrowed`].
  // crate: icu_locale_fallback-2.3.0/src/lib.rs:238 static_to_owned
  static_to_owned(): LocaleFallbacker {
    return new LocaleFallbacker(DataPayload.from_static_ref(this.likely_subtags), DataPayload.from_static_ref(this.parents));
  }
}

/// A [`LocaleFallbackerBorrowed`] with an associated [`LocaleFallbackConfig`].
// #[derive(Debug, Clone, Copy, PartialEq)]
export class LocaleFallbackerWithConfig {
  constructor(
    public likely_subtags: LikelySubtagsForLanguage,
    public parents: Parents,
    public config: LocaleFallbackConfig,
  ) {}

  /// Creates an iterator based on a [`DataLocale`].
  ///
  /// If you have a [`Locale`](icu_locale_core::Locale), call `.into()` to get a [`DataLocale`].
  ///
  /// When first initialized, the locale is normalized according to the fallback algorithm.
  // crate: icu_locale_fallback-2.3.0/src/lib.rs:255 fallback_for
  fallback_for(locale: DataLocale): LocaleFallbackIterator {
    locale = locale.clone(); // `mut locale: DataLocale` (Copy)
    const default_script: { value: Script | undefined } = { value: undefined };
    LocaleFallbackerWithConfig_normalize(this, locale, default_script);
    const max_script = locale.script ?? default_script.value;
    return new LocaleFallbackIterator(
      locale,
      new LocaleFallbackIteratorInner(this.likely_subtags, this.parents, this.config, undefined, undefined, undefined, max_script),
    );
  }

  /// Returns the fallback configuration for this iterator.
  // crate: icu_locale_fallback-2.3.0/src/lib.rs:274 config
  config_(): LocaleFallbackConfig {
    return this.config;
  }
}

export class LocaleFallbackIteratorInner {
  constructor(
    public likely_subtags: LikelySubtagsForLanguage,
    public parents: Parents,
    public config: LocaleFallbackConfig,
    public backup_subdivision: Subtag | undefined,
    public backup_variant: Variant | undefined,
    public backup_region: Region | undefined,
    public max_script: Script | undefined,
  ) {}
}

/// Iteration type for locale fallback operations.
///
/// Because the `Iterator` trait does not allow items to borrow from the iterator, this class does
/// not implement that trait. Instead, use `.step()` and `.get()`.
// #[derive(Debug)]
export class LocaleFallbackIterator {
  constructor(
    public current: DataLocale,
    public inner: LocaleFallbackIteratorInner,
  ) {}

  /// Borrows the current [`DataLocale`] under fallback.
  // crate: icu_locale_fallback-2.3.0/src/lib.rs:281 get
  get(): DataLocale {
    return this.current;
  }

  /// Takes the current [`DataLocale`] under fallback.
  // crate: icu_locale_fallback-2.3.0/src/lib.rs:286 take
  take(): DataLocale {
    return this.current;
  }

  /// Performs one step of the locale fallback algorithm.
  ///
  /// The fallback is completed once the inner [`DataLocale`] becomes [`DataLocale::default()`].
  // crate: icu_locale_fallback-2.3.0/src/lib.rs:293 step
  step(): LocaleFallbackIterator {
    LocaleFallbackIteratorInner_step(this.inner, this.current);
    return this;
  }
}


