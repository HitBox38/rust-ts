//! This crate contains a memoizer for internationalization formatters. Often it is
//! expensive (in terms of performance and memory) to construct a formatter, but then
//! relatively cheap to run the format operation.
//!
//! The [`IntlMemoizer`] is the main struct that creates a per-locale [`IntlLangMemoizer`].
//
// Port of intl-memoizer 0.5.3 (the version in upstream's Cargo.lock), src/lib.rs.
//
// PORT: generics over `I: Memoizable`:
// - `Memoizable` is implemented by the *static side* of a formatter class (`construct` is an
//   associated fn), so `with_try_get::<I, _, _>(args, cb)` becomes `with_try_get(I, args, cb)`
//   with the class (or an impl table) as `I`.
// - `map.entry::<HashMap<I::Args, I>>()` needs `TypeId::of::<HashMap<I::Args, I>>()`: each
//   `Memoizable` provides that token as `memoizer_cache` (see type_map's header).
// - `HashMap<I::Args, I>` is a `Map` keyed by `args_key(args)`: `I::Args: Eq + Hash` becomes a
//   primitive key with `args_key(a) === args_key(b)` iff `a == b`.
import { panic } from "../../std/panic.ts";
import { Ok, type Result } from "../../std/result.ts";
import { display_LanguageIdentifier, type LanguageIdentifier } from "../unic_langid/lib.ts";
import { Entry, type TypeId, TypeMap } from "../type_map/lib.ts";

export * as concurrent from "./concurrent.ts";

/// The trait that needs to be implemented for each intl formatter that needs to be
/// memoized.
export interface Memoizable<I, Args, E> {
  /// Type of the arguments that are used to construct the formatter.
  // type Args: 'static + Eq + Hash + Clone;
  /** PORT: `Eq + Hash` of `Self::Args` (see the header). */
  args_key(args: Args): string;

  /// Type of any errors that can occur during the construction process.
  // type Error;

  /** PORT: `TypeId::of::<HashMap<Self::Args, Self>>()` (see the header). */
  readonly memoizer_cache: TypeId<Map<string, I>>;

  /// Construct a formatter. This maps the [`Self::Args`] type to the actual constructor
  /// for an intl formatter.
  // crate: intl-memoizer-0.5.3/src/lib.rs:27 construct
  construct(lang: LanguageIdentifier, args: Args): Result<I, E>;
}

/// The [`IntlLangMemoizer`] can memoize multiple constructed internationalization
/// formatters, and their configuration for a single locale. For instance, given "en-US",
/// a memorizer could retain 3 `DateTimeFormat` instances, and a `PluralRules`.
///
/// For memoizing with multiple locales, see [`IntlMemoizer`].
///
/// # Example
///
/// The code example does the following steps:
///
/// 1. Create a static counter
/// 2. Create an `ExampleFormatter`
/// 3. Implement [`Memoizable`] for `ExampleFormatter`.
/// 4. Use `IntlLangMemoizer::with_try_get` to run `ExampleFormatter::format`
/// 5. Demonstrate the memoization using the static counter
///
/// (The example is ported as a test in lib.test.ts.)
// #[derive(Debug)]
export class IntlLangMemoizer {
  /**
   * PORT: `map: RefCell<TypeMap>`: the cell is the field itself; `map_borrowed` is the RefCell's
   * borrow flag, so the `try_borrow_mut().expect(..)` reentrancy panic is kept.
   */
  map_borrowed = false;

  constructor(
    public lang: LanguageIdentifier,
    public map: TypeMap,
  ) {}

  /// Create a new [`IntlLangMemoizer`] that is unique to a specific
  /// [`LanguageIdentifier`]
  // crate: intl-memoizer-0.5.3/src/lib.rs:185 new
  static new(lang: LanguageIdentifier): IntlLangMemoizer {
    return new IntlLangMemoizer(lang, TypeMap.new());
  }

  /// `with_try_get` means `with` an internationalization formatter, `try` and `get` a result.
  /// The (potentially expensive) constructor for the formatter (such as `PluralRules` or
  /// `DateTimeFormat`) will be memoized and only constructed once for a given
  /// `construct_args`. After that the format operation can be run multiple times
  /// inexpensively.
  ///
  /// The first generic argument `I` must be provided, but the `R` and `U` will be
  /// deduced by the typing of the `callback` argument that is provided.
  ///
  /// I - The memoizable intl object, for instance a `PluralRules` instance. This
  ///     must implement the Memoizable trait.
  ///
  /// R - The return result from the callback `U`.
  ///
  /// U - The callback function. Takes an instance of `I` as the first parameter and
  ///     returns the R value.
  // crate: intl-memoizer-0.5.3/src/lib.rs:208 with_try_get
  with_try_get<I, Args, E, R>(I: Memoizable<I, Args, E>, construct_args: Args, callback: (i: I) => R): Result<R, E> {
    if (this.map_borrowed) {
      return panic("Cannot use memoizer reentrantly: BorrowMutError"); // `.expect(..)` of `Err(BorrowMutError)`
    }
    this.map_borrowed = true;
    try {
      const map = this.map;
      const cache = Entry.or_insert_with(map.entry(I.memoizer_cache), () => new Map<string, I>());

      let e: I;
      const key = I.args_key(construct_args);
      if (cache.has(key)) {
        e = cache.get(key)!;
      } else {
        const val = I.construct(this.lang.clone(), construct_args);
        if (val.$ === "Err") return val;
        cache.set(key, val._0);
        e = val._0;
      }
      return Ok(callback(e));
    } finally {
      this.map_borrowed = false;
    }
  }
}

/// [`IntlMemoizer`] is designed to handle lazily-initialized references to
/// internationalization formatters.
///
/// Constructing a new formatter is often expensive in terms of memory and performance,
/// and the instance is often read-only during its lifetime. The format operations in
/// comparison are relatively cheap.
///
/// Because of this relationship, it can be helpful to memoize the constructors, and
/// re-use them across multiple format operations. This strategy is used where all
/// instances of intl APIs such as `PluralRules`, `DateTimeFormat` etc. are memoized
/// between all `FluentBundle` instances.
///
/// # Example
///
/// For a more complete example of the memoization, see the [`IntlLangMemoizer`] documentation.
/// This example provides a higher-level overview.
///
/// (The example is ported as a test in lib.test.ts.)
// #[derive(Default)]
export class IntlMemoizer {
  /**
   * PORT: `HashMap<LanguageIdentifier, Weak<IntlLangMemoizer>>`: keyed by the identifier's
   * Display (injective over its derived `Eq`); `Weak` → `WeakRef`. When the last `Rc` is dropped
   * upstream the memoizer is rebuilt; here that happens once the GC has collected it, which only
   * changes how often formatters are re-constructed, never a result.
   */
  constructor(public map: Map<string, WeakRef<IntlLangMemoizer>>) {}

  /** `#[derive(Default)]` */
  static default(): IntlMemoizer {
    return new IntlMemoizer(new Map());
  }

  /// Get a [`IntlLangMemoizer`] for a given language. If one does not exist for
  /// a locale, it will be constructed and weakly retained. See [`IntlLangMemoizer`]
  /// for more detailed documentation how to use it.
  // crate: intl-memoizer-0.5.3/src/lib.rs:333 get_for_lang
  get_for_lang(lang: LanguageIdentifier): IntlLangMemoizer {
    const key = display_LanguageIdentifier(lang.clone());
    const occupied = this.map.get(key);
    if (occupied === undefined) {
      const entry = IntlLangMemoizer.new(lang);
      this.map.set(key, new WeakRef(entry));
      return entry;
    } else {
      const entry = occupied.deref();
      if (entry !== undefined) {
        return entry;
      } else {
        const e = IntlLangMemoizer.new(lang);
        this.map.set(key, new WeakRef(e));
        return e;
      }
    }
  }
}
