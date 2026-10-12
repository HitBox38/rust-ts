//! `FluentBundle` is a collection of localization messages in Fluent.
//!
//! It stores a list of messages in a single locale which can reference one another, use the same
//! internationalization formatters, functions, scopeironmental variables and are expected to be used
//! together.
//
// Port of fluent-bundle 0.16.0, src/bundle.rs. (Doc examples are ported as tests in
// doc_examples.test.ts.)
// PORT: `FluentBundle<R, M>`: `R: Borrow<FluentResource>` is erased (resources are stored as
// `FluentResource`s; `FluentResource`, `&FluentResource`, `Rc`/`Arc` all borrow the same value).
// `M` is the memoizer (`IntlLangMemoizer` or `concurrent::IntlLangMemoizer`), constrained to
// `MemoizerKind` at the class (upstream bounds the methods). The `GetEntry` impl lives in
// entry.ts and `new_concurrent` in concurrent.ts (extension files, loaded by lib.ts).
import type { Result } from "../../std/result.ts";
import { Err, Ok } from "../../std/result.ts";
import { unreachable } from "../../std/panic.ts";
import type { Pattern } from "../fluent_syntax/ast/mod.ts";
import type { FmtError, Write } from "../fluent_syntax/unicode.ts";
import { IntlLangMemoizer, type Memoizable } from "../intl_memoizer/lib.ts";
import { LanguageIdentifier } from "../unic_langid/lib.ts";
import type { FluentArgs } from "./args.ts";
import { NUMBER } from "./builtins.ts";
import type { Entry, FluentFunction } from "./entry.ts";
import { EntryKind, type FluentError } from "./errors.ts";
import type { MemoizerKind, MemoizerKindStatic } from "./memoizer.ts";
import { FluentMessage } from "./message.ts";
import { ResolveValue_for_Pattern, Scope, WriteValue_for_Pattern } from "./resolver/mod.ts";
import type { FluentResource } from "./resource.ts";
import { FluentValue, type FluentType } from "./types/mod.ts";

/// A collection of localization messages for a single locale, which are meant
/// to be used together in a single view, widget or any other UI abstraction.
///
/// # `FluentBundle` Life Cycle
///
/// ## Create a bundle
///
/// To create a bundle, call [`FluentBundle::new`] with a locale list that represents the best
/// possible fallback chain for a given locale. The simplest case is a one-locale list.
///
/// Fluent uses [`LanguageIdentifier`] which can be created using `langid!` macro.
///
/// ## Add Resources
///
/// Next, call [`add_resource`](FluentBundle::add_resource) one or more times, supplying translations in the FTL syntax.
///
/// Since [`FluentBundle`] is generic over anything that can borrow a [`FluentResource`],
/// one can use [`FluentBundle`] to own its resources, store references to them,
/// or even [`Rc<FluentResource>`](std::rc::Rc) or [`Arc<FluentResource>`](std::sync::Arc).
///
/// The [`FluentBundle`] instance is now ready to be used for localization.
///
/// ## Format
///
/// To format a translation, call [`get_message`](FluentBundle::get_message) to retrieve a [`FluentMessage`],
/// and then call [`format_pattern`](FluentBundle::format_pattern) on the message value or attribute in order to
/// retrieve the translated string.
///
/// The result of [`format_pattern`](FluentBundle::format_pattern) is an
/// [`Cow<str>`](std::borrow::Cow). It is
/// recommended to treat the result as opaque from the perspective of the program and use it only
/// to display localized messages. Do not examine it or alter in any way before displaying.  This
/// is a general good practice as far as all internationalization operations are concerned.
///
/// If errors were encountered during formatting, they will be
/// accumulated in the [`Vec<FluentError>`](FluentError) passed as the third argument.
///
/// While they are not fatal, they usually indicate problems with the translation,
/// and should be logged or reported in a way that allows the developer to notice
/// and fix them.
///
///
/// # Locale Fallback Chain
///
/// [`FluentBundle`] stores messages in a single locale, but keeps a locale fallback chain for the
/// purpose of language negotiation with i18n formatters. For instance, if date and time formatting
/// are not available in the first locale, [`FluentBundle`] will use its `locales` fallback chain
/// to negotiate a sensible fallback for date and time formatting.
///
/// # Concurrency
///
/// As you may have noticed, [`fluent_bundle::FluentBundle`](crate::FluentBundle) is a specialization of [`fluent_bundle::bundle::FluentBundle`](crate::bundle::FluentBundle)
/// which works with an [`IntlLangMemoizer`] over [`RefCell`](std::cell::RefCell).
/// In scenarios where the memoizer must work concurrently, there's an implementation of
/// [`IntlLangMemoizer`][concurrent::IntlLangMemoizer] that uses [`Mutex`](std::sync::Mutex) and there's [`FluentBundle::new_concurrent`] which works with that.
///
/// [concurrent::IntlLangMemoizer]: https://docs.rs/intl-memoizer/latest/intl_memoizer/concurrent/struct.IntlLangMemoizer.html
export class FluentBundle<M extends MemoizerKind = IntlLangMemoizer> {
  constructor(
    public locales: LanguageIdentifier[],
    public resources: FluentResource[],
    public entries: Map<string, Entry>,
    public intls: M,
    public use_isolating: boolean,
    public transform: ((s: string) => string) | undefined,
    public formatter: ((v: FluentValue, m: M) => string | undefined) | undefined,
  ) {}

  /// Adds a resource to the bundle, returning an empty [`Result<T>`] on success.
  ///
  /// If any entry in the resource uses the same identifier as an already
  /// existing key in the bundle, the new entry will be ignored and a
  /// `FluentError::Overriding` will be added to the result.
  ///
  /// The method can take any type that can be borrowed to [`FluentResource`]:
  ///   - `FluentResource`
  ///   - `&FluentResource`
  ///   - `Rc<FluentResource>`
  ///   - `Arc<FluentResource>`
  ///
  /// This allows the user to introduce custom resource management and share
  /// resources between instances of `FluentBundle`.
  ///
  /// # Whitespace
  ///
  /// Message ids must have no leading whitespace. Message values that span
  /// multiple lines must have leading whitespace on all but the first line. These
  /// are standard FTL syntax rules that may prove a bit troublesome in source
  /// code formatting. The [`indoc!`] crate can help with stripping extra indentation
  /// if you wish to indent your entire message.
  ///
  /// [FTL syntax]: https://projectfluent.org/fluent/guide/
  /// [`indoc!`]: https://github.com/dtolnay/indoc
  /// [`Result<T>`]: https://doc.rust-lang.org/std/result/enum.Result.html
  // crate: fluent-bundle-0.16.0/src/bundle.rs:192 add_resource
  add_resource(r: FluentResource): Result<null, FluentError[]> {
    const errors: FluentError[] = [];

    const res = r;
    const res_pos = this.resources.length;

    const entries = res.entries();
    for (let entry_pos = 0; entry_pos < entries.length; entry_pos++) {
      const entry_ = entries[entry_pos]!;
      let id: string;
      let entry: Entry;
      if (entry_.$ === "Message") {
        id = entry_._0.id.name.toString();
        entry = { $: "Message", _0: [res_pos, entry_pos] };
      } else if (entry_.$ === "Term") {
        id = entry_._0.id.name.toString();
        entry = { $: "Term", _0: [res_pos, entry_pos] };
      } else {
        continue;
      }

      if (!this.entries.has(id)) {
        this.entries.set(id, entry);
      } else {
        let kind: EntryKind;
        switch (entry.$) {
          case "Message":
            kind = EntryKind.Message;
            break;
          case "Term":
            kind = EntryKind.Term;
            break;
          default:
            return unreachable();
        }
        errors.push({
          $: "Overriding",
          kind,
          id: id,
        });
      }
    }
    this.resources.push(r);

    if (errors.length === 0) {
      return Ok(null);
    } else {
      return Err(errors);
    }
  }

  /// Adds a resource to the bundle, returning an empty [`Result<T>`] on success.
  ///
  /// If any entry in the resource uses the same identifier as an already
  /// existing key in the bundle, the entry will override the previous one.
  ///
  /// The method can take any type that can be borrowed as [`FluentResource`]:
  ///   - `FluentResource`
  ///   - `&FluentResource`
  ///   - `Rc<FluentResource>`
  ///   - `Arc<FluentResource>`
  ///
  /// This allows the user to introduce custom resource management and share
  /// resources between instances of `FluentBundle`.
  ///
  /// # Whitespace
  ///
  /// Message ids must have no leading whitespace. Message values that span
  /// multiple lines must have leading whitespace on all but the first line. These
  /// are standard FTL syntax rules that may prove a bit troublesome in source
  /// code formatting. The [`indoc!`] crate can help with stripping extra indentation
  /// if you wish to indent your entire message.
  ///
  /// [FTL syntax]: https://projectfluent.org/fluent/guide/
  /// [`indoc!`]: https://github.com/dtolnay/indoc
  /// [`Result<T>`]: https://doc.rust-lang.org/std/result/enum.Result.html
  // crate: fluent-bundle-0.16.0/src/bundle.rs:297 add_resource_overriding
  add_resource_overriding(r: FluentResource): void {
    const res = r;
    const res_pos = this.resources.length;

    const entries = res.entries();
    for (let entry_pos = 0; entry_pos < entries.length; entry_pos++) {
      const entry_ = entries[entry_pos]!;
      let id: string;
      let entry: Entry;
      if (entry_.$ === "Message") {
        id = entry_._0.id.name.toString();
        entry = { $: "Message", _0: [res_pos, entry_pos] };
      } else if (entry_.$ === "Term") {
        id = entry_._0.id.name.toString();
        entry = { $: "Term", _0: [res_pos, entry_pos] };
      } else {
        continue;
      }

      this.entries.set(id, entry);
    }
    this.resources.push(r);
  }

  /// When formatting patterns, `FluentBundle` inserts
  /// Unicode Directionality Isolation Marks to indicate
  /// that the direction of a placeable may differ from
  /// the surrounding message.
  ///
  /// This is important for cases such as when a
  /// right-to-left user name is presented in the
  /// left-to-right message.
  ///
  /// In some cases, such as testing, the user may want
  /// to disable the isolating.
  // crate: fluent-bundle-0.16.0/src/bundle.rs:331 set_use_isolating
  set_use_isolating(value: boolean): void {
    this.use_isolating = value;
  }

  /// This method allows to specify a function that will
  /// be called on all textual fragments of the pattern
  /// during formatting.
  ///
  /// This is currently primarily used for pseudolocalization,
  /// and `fluent-pseudo` crate provides a function
  /// that can be passed here.
  // crate: fluent-bundle-0.16.0/src/bundle.rs:342 set_transform
  set_transform(func: ((s: string) => string) | undefined): void {
    this.transform = func;
  }

  /// This method allows to specify a function that will
  /// be called before any `FluentValue` is formatted
  /// allowing overrides.
  ///
  /// It's particularly useful for plugging in an external
  /// formatter for `FluentValue::Number`.
  // crate: fluent-bundle-0.16.0/src/bundle.rs:352 set_formatter
  set_formatter(func: ((v: FluentValue, m: M) => string | undefined) | undefined): void {
    this.formatter = func;
  }

  /// Returns true if this bundle contains a message with the given id.
  // crate: fluent-bundle-0.16.0/src/bundle.rs:374 has_message
  has_message(id: string): boolean {
    return this.get_entry_message(id) !== undefined;
  }

  /// Retrieves a `FluentMessage` from a bundle.
  // crate: fluent-bundle-0.16.0/src/bundle.rs:402 get_message
  get_message(id: string): FluentMessage | undefined {
    const m = this.get_entry_message(id);
    return m === undefined ? undefined : FluentMessage.from(m);
  }

  /// Writes a formatted pattern which comes from a `FluentMessage`.
  // crate: fluent-bundle-0.16.0/src/bundle.rs:440 write_pattern
  write_pattern(
    w: Write,
    pattern: Pattern,
    args: FluentArgs | undefined,
    errors: FluentError[],
  ): Result<null, FmtError> {
    const scope = Scope.new(this, args, errors);
    return WriteValue_for_Pattern.write(pattern, w, scope);
  }

  /// Formats a pattern which comes from a `FluentMessage`.
  // crate: fluent-bundle-0.16.0/src/bundle.rs:485 format_pattern
  format_pattern(pattern: Pattern, args: FluentArgs | undefined, errors: FluentError[]): string {
    const scope = Scope.new(this, args, errors);
    const value = ResolveValue_for_Pattern.resolve(pattern, scope);
    return FluentValue.into_string(value, scope);
  }

  /// Makes the provided rust function available to messages with the name `id`. See
  /// the [FTL syntax guide] to learn how these are used in messages.
  ///
  /// FTL functions accept both positional and named args. The rust function you
  /// provide therefore has two parameters: a slice of values for the positional
  /// args, and a `FluentArgs` for named args.
  ///
  /// [FTL syntax guide]: https://projectfluent.org/fluent/guide/functions.html
  // crate: fluent-bundle-0.16.0/src/bundle.rs:535 add_function
  add_function(id: string, func: FluentFunction): Result<null, FluentError> {
    if (!this.entries.has(id)) {
      this.entries.set(id, { $: "Function", _0: func });
      return Ok(null);
    } else {
      return Err({
        $: "Overriding",
        kind: EntryKind.Function,
        id: id,
      });
    }
  }

  /// Adds the builtin functions described in the [FTL syntax guide] to the bundle, making them
  /// available in messages.
  ///
  /// [FTL syntax guide]: https://projectfluent.org/fluent/guide/functions.html
  // crate: fluent-bundle-0.16.0/src/bundle.rs:599 add_builtins
  add_builtins(): Result<null, FluentError> {
    const r = this.add_function("NUMBER", NUMBER);
    if (r.$ === "Err") return r;
    // TODO: DATETIME()

    return Ok(null);
  }

  /** `impl<R> Default for FluentBundle<R, IntlLangMemoizer>` */
  // crate: fluent-bundle-0.16.0/src/bundle.rs:608 default
  static default(): FluentBundle<IntlLangMemoizer> {
    return FluentBundle.new([LanguageIdentifier.default()]);
  }

  /// Constructs a `FluentBundle`. The first element in `locales` should be the
  /// language this bundle represents, and will be used to determine the
  /// correct plural rules for this bundle. You can optionally provide extra
  /// languages in the list; they will be used as fallback date and time
  /// formatters if a formatter for the primary language is unavailable.
  ///
  /// # Errors
  ///
  /// This will panic if no formatters can be found for the locales.
  // crate: fluent-bundle-0.16.0/src/bundle.rs:634 new
  static new(locales: LanguageIdentifier[]): FluentBundle<IntlLangMemoizer> {
    const first_locale = locales.length > 0 ? locales[0]!.clone() : LanguageIdentifier.default();
    return new FluentBundle<IntlLangMemoizer>(
      locales,
      [],
      new Map(),
      IntlLangMemoizer.new(first_locale),
      true,
      undefined,
      undefined,
    );
  }
}

/** `impl crate::memoizer::MemoizerKind for IntlLangMemoizer` (`new`; the methods follow). */
export const MemoizerKind_for_IntlLangMemoizer: MemoizerKindStatic<IntlLangMemoizer> = {
  // crate: fluent-bundle-0.16.0/src/bundle.rs:649 new
  new(lang: LanguageIdentifier): IntlLangMemoizer {
    return IntlLangMemoizer.new(lang);
  },
};

declare module "../intl_memoizer/lib.ts" {
  interface IntlLangMemoizer extends MemoizerKind {}
}

// crate: fluent-bundle-0.16.0/src/bundle.rs:656 with_try_get_threadsafe
IntlLangMemoizer.prototype.with_try_get_threadsafe = function <I, Args, E, R>(
  this: IntlLangMemoizer,
  I: Memoizable<I, Args, E>,
  args: Args,
  cb: (i: I) => R,
): Result<R, E> {
  return this.with_try_get(I, args, cb);
};

// crate: fluent-bundle-0.16.0/src/bundle.rs:666 stringify_value
IntlLangMemoizer.prototype.stringify_value = function (this: IntlLangMemoizer, value: FluentType): string {
  return value.as_string(this);
};
