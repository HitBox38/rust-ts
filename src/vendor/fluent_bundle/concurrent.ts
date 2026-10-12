// Port of fluent-bundle 0.16.0, src/concurrent.rs.
// PORT: extension file (loaded by lib.ts after bundle.ts): `new_concurrent` is a static added to
// `FluentBundle`, and `impl MemoizerKind for concurrent::IntlLangMemoizer` is attached to that
// class's prototype (see memoizer.ts).
import type { Result } from "../../std/result.ts";
import { IntlLangMemoizer } from "../intl_memoizer/concurrent.ts";
import type { Memoizable } from "../intl_memoizer/lib.ts";
import { LanguageIdentifier } from "../unic_langid/lib.ts";
import { FluentBundle as BundleFluentBundle } from "./bundle.ts";
import type { MemoizerKind, MemoizerKindStatic } from "./memoizer.ts";
import type { FluentType } from "./types/mod.ts";

/// Specialized [`FluentBundle`](crate::bundle::FluentBundle) over
/// concurrent [`IntlLangMemoizer`].
///
/// A concurrent `FluentBundle` can be constructed with the
/// [`FluentBundle::new_concurrent`] method.
///
/// See [`FluentBundle`](crate::FluentBundle) for the non-concurrent specialization.
export type FluentBundle = BundleFluentBundle<IntlLangMemoizer>;

declare module "./bundle.ts" {
  namespace FluentBundle {
    let new_concurrent: (locales: LanguageIdentifier[]) => FluentBundle<IntlLangMemoizer>;
  }
}

/// A constructor analogous to [`FluentBundle::new`] but operating
/// on a concurrent version of [`IntlLangMemoizer`] over [`Mutex`](std::sync::Mutex).
// crate: fluent-bundle-0.16.0/src/concurrent.rs:32 new_concurrent
BundleFluentBundle.new_concurrent = function (locales: LanguageIdentifier[]): FluentBundle {
  const first_locale = locales.length > 0 ? locales[0]!.clone() : LanguageIdentifier.default();
  return new BundleFluentBundle<IntlLangMemoizer>(
    locales,
    [],
    new Map(),
    IntlLangMemoizer.new(first_locale),
    true,
    undefined,
    undefined,
  );
};

/** `impl MemoizerKind for IntlLangMemoizer` (concurrent; `new`, the methods follow). */
export const MemoizerKind_for_IntlLangMemoizer: MemoizerKindStatic<IntlLangMemoizer> = {
  // crate: fluent-bundle-0.16.0/src/concurrent.rs:47 new
  new(lang: LanguageIdentifier): IntlLangMemoizer {
    return IntlLangMemoizer.new(lang);
  },
};

declare module "../intl_memoizer/concurrent.ts" {
  interface IntlLangMemoizer extends MemoizerKind {}
}

// crate: fluent-bundle-0.16.0/src/concurrent.rs:54 with_try_get_threadsafe
IntlLangMemoizer.prototype.with_try_get_threadsafe = function <I, Args, E, R>(
  this: IntlLangMemoizer,
  I: Memoizable<I, Args, E>,
  args: Args,
  cb: (i: I) => R,
): Result<R, E> {
  return this.with_try_get(I, args, cb);
};

// crate: fluent-bundle-0.16.0/src/concurrent.rs:64 stringify_value
IntlLangMemoizer.prototype.stringify_value = function (this: IntlLangMemoizer, value: FluentType): string {
  return value.as_string_threadsafe(this);
};
