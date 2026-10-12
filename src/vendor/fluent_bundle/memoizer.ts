// Port of fluent-bundle 0.16.0, src/memoizer.rs.
//
// PORT: `pub trait MemoizerKind` is an interface implemented (by prototype augmentation, see
// bundle.ts and concurrent.ts) on both `IntlLangMemoizer`s, so `scope.bundle.intls.<method>`
// dispatches like the monomorphized Rust call. The associated fn `new` is the separate interface
// `MemoizerKindStatic`. Generic `I: Memoizable` is passed as a value (see intl_memoizer's header).
import type { Result } from "../../std/result.ts";
import type { LanguageIdentifier } from "../unic_langid/lib.ts";
import type { Memoizable } from "../intl_memoizer/lib.ts";
import type { FluentType } from "./types/mod.ts";

/// This trait contains thread-safe methods which extend [`intl_memoizer::IntlLangMemoizer`].
/// It is used as the generic bound in this crate when a memoizer is needed.
export interface MemoizerKindStatic<M> {
  // crate: fluent-bundle-0.16.0/src/memoizer.rs:8 new
  "new"(lang: LanguageIdentifier): M;
}

/// This trait contains thread-safe methods which extend [`intl_memoizer::IntlLangMemoizer`].
/// It is used as the generic bound in this crate when a memoizer is needed.
export interface MemoizerKind {
  /// A threadsafe variant of `with_try_get` from [`intl_memoizer::IntlLangMemoizer`].
  /// The generics enforce that `Self` and its arguments are actually threadsafe.
  ///
  /// `I` - The [Memoizable](intl_memoizer::Memoizable) internationalization formatter.
  ///
  /// `R` - The result from the format operation.
  ///
  /// `U` - The callback that accepts the instance of the intl formatter, and generates
  ///       some kind of results `R`.
  // crate: fluent-bundle-0.16.0/src/memoizer.rs:21 with_try_get_threadsafe
  with_try_get_threadsafe<I, Args, E, R>(I: Memoizable<I, Args, E>, args: Args, callback: (i: I) => R): Result<R, E>;

  /// Wires up the `as_string` or `as_string_threadsafe` variants for [`FluentType`].
  // crate: fluent-bundle-0.16.0/src/memoizer.rs:29 stringify_value
  stringify_value(value: FluentType): string;
}
