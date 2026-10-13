// Port of compiler/rustc_attr_parsing/src/attributes/mod.rs.
//! Traits for parsing attributes.
//!
//! This module defines traits for attribute parsers, little state machines that recognize and parse
//! attributes out of a longer list of attributes. The main trait is called [`AttributeParser`].
//! You can find more docs about [`AttributeParser`]s on the trait itself.
//! However, for many types of attributes, implementing [`AttributeParser`] is not necessary.
//! It allows for a lot of flexibility you might not want.
//!
//! Specifically, you might not care about managing the state of your [`AttributeParser`]
//! state machine yourself. In this case you can choose to implement:
//!
//! - [`NoArgsAttributeParser`]: used for implementing an attribute that appears only once and
//! accepts no arguments
//! - [`SingleAttributeParser`]: makes it easy to implement an attribute which should error if it
//! appears more than once in a list of attributes
//! - [`CombineAttributeParser`]: makes it easy to implement an attribute which should combine the
//! contents of attributes, if an attribute appear multiple times in a list
//!
//! Attributes should be added to `crate::context::ATTRIBUTE_PARSERS` to be parsed.
//
// Trait representation (PORTING §5 "Traits", docs/handoff/attr-parse-a.md): a parser *type* is its trait
// table, an object holding the trait's associated consts (`PATH`, `TEMPLATE`, ...) and fns. Fns taking
// `self` take the state value as their first parameter. `Default` (a supertrait of `AttributeParser`) is
// the table's `default()`; the state it returns is a mutable object that accept fns update in place
// (`&mut T`), because context.rs keeps one state object per parser type (its `thread_local!`
// `STATE_OBJECT`). Provided trait items come from `<Trait>_provided(impl)` (PORTING §8).
//
// The `pub(crate) mod <name>;` declarations of mod.rs are not mirrored as re-exports here: the
// submodules import this module, and context.ts imports each submodule directly. `mod prelude;` only
// re-exports names; each submodule imports what it uses directly.
import type { AttributeKind } from "../../rustc_attr_ir/lib.ts";
import type { AttributeStability } from "../../rustc_feature/lib.ts";
import type { Edition } from "../../rustc_span/edition.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { display_Symbol, Symbol } from "../../rustc_span/symbol.ts";
import { unported } from "../../std/panic.ts";
import type { AcceptContext, FinalizeCheckContext, FinalizeCheckFn, FinalizeContext } from "../context.ts";
import { UnusedMultiple_diagnostic } from "../diagnostics.ts";
import type { ArgParser } from "../parser.ts";
import type { AllowedTargets } from "../target_checking.ts";
import { type AttributeTemplate, template } from "../template.ts";

/** `type AcceptFn<T> = for<'sess> fn(&mut T, &mut AcceptContext<'_, 'sess>, &ArgParser);` */
export type AcceptFn<T> = (self: T, cx: AcceptContext, args: ArgParser) => void;
/** `type AcceptMapping<T> = &'static [(&'static [Symbol], AttributeTemplate, AttributeStability, AcceptFn<T>)];` */
export type AcceptMapping<T> = readonly (readonly [
  path: readonly Symbol[],
  template: AttributeTemplate,
  stability: AttributeStability,
  accept_fn: AcceptFn<T>,
])[];

/// An [`AttributeParser`] is a type which searches for syntactic attributes.
///
/// Parsers are often tiny state machines that gets to see all syntactical attributes on an item.
/// [`Default::default`] creates a fresh instance that sits in some kind of initial state, usually that the
/// attribute it is looking for was not yet seen.
///
/// Then, it defines what paths this group will accept in [`AttributeParser::ATTRIBUTES`].
/// These are listed as pairs, of symbols and function pointers. The function pointer will
/// be called when that attribute is found on an item, which can influence the state of the little
/// state machine.
///
/// Finally, after all attributes on an item have been seen, and possibly been accepted,
/// the [`finalize`](AttributeParser::finalize) functions for all attribute parsers are called. Each can then report
/// whether it has seen the attribute it has been looking for.
///
/// The state machine is automatically reset to parse attributes on the next item.
///
/// For a simpler attribute parsing interface, consider using [`SingleAttributeParser`]
/// or [`CombineAttributeParser`] instead.
/** `pub(crate) trait AttributeParser: Default + 'static`, as the trait table of a parser type `T`. */
export interface AttributeParser<T> {
  /** `Default::default()` (supertrait). Returns a fresh mutable state object. */
  default(): T;
  /// The symbols for the attributes that this parser is interested in.
  ///
  /// If an attribute has this symbol, the `accept` function will be called on it.
  readonly ATTRIBUTES: AcceptMapping<T>;
  readonly ALLOWED_TARGETS: AllowedTargets;
  /** (provided) `AttributeSafety::Normal` */
  readonly SAFETY: AttributeSafety;

  /// The parser has gotten a chance to accept the attributes on an item,
  /// here it can produce an attribute.
  ///
  /// All finalize methods of all parsers are unconditionally called.
  /// This means you can't unconditionally return `Some` here,
  /// that'd be equivalent to unconditionally applying an attribute to
  /// every single syntax item that could have attributes applied to it.
  /// Your accept mappings should determine whether this returns something.
  // rustc: compiler/rustc_attr_parsing/src/attributes/mod.rs:119 finalize
  finalize(self: T, cx: FinalizeContext): AttributeKind | undefined;

  /** (provided) */
  deferred_finalize_check(self: T): [FinalizeCheckFn, Span] | undefined;
}

type AttributeParserProvided = "SAFETY" | "deferred_finalize_check";

/** The provided items of `AttributeParser`; an impl lists its required items and any overrides. */
export function AttributeParser_provided<T>(
  impl: Omit<AttributeParser<T>, AttributeParserProvided> & Partial<Pick<AttributeParser<T>, AttributeParserProvided>>,
): AttributeParser<T> {
  return {
    SAFETY: AttributeSafety.Normal,

    /// If this parser produced an attribute, optionally returns a cross-attribute check
    /// to run once *all* attributes on the item have been finalized, together with the
    /// span it should be reported at.
    ///
    /// Running after finalization means the check can inspect the fully parsed attributes
    /// via [`FinalizeCheckContext::parsed_attrs`], which are not yet all available during
    /// [`finalize`](Self::finalize). This is queried right before `finalize` consumes the
    /// parser state.
    ///
    /// Defaults to no check.
    // rustc: compiler/rustc_attr_parsing/src/attributes/mod.rs:131 deferred_finalize_check
    deferred_finalize_check(_self: T): [FinalizeCheckFn, Span] | undefined {
      return undefined;
    },

    ...impl,
  };
}

// PORT: the list in context.rs holds parser types with different state types (an existential over
// `T`); `any` is the erased state type of such a list element.
export type ErasedAttributeParser = AttributeParser<any>;

/// Alternative to [`AttributeParser`] that automatically handles state management.
/// A slightly simpler and more restricted way to convert attributes.
/// Assumes that an attribute can only appear a single time on an item,
/// and errors when it sees more.
///
/// [`Single<T> where T: SingleAttributeParser`](Single) implements [`AttributeParser`].
///
/// [`SingleAttributeParser`] can only convert attributes one-to-one, and cannot combine multiple
/// attributes together like is necessary for `#[stable()]` and `#[unstable()]` for example.
/** `pub(crate) trait SingleAttributeParser: 'static` */
export interface SingleAttributeParser {
  /// The single path of the attribute this parser accepts.
  ///
  /// If you need the parser to accept more than one path, use [`AttributeParser`] instead
  readonly PATH: readonly Symbol[];

  /// Configures what to do when when the same attribute is
  /// applied more than once on the same syntax node.
  /** (provided) `OnDuplicate::Error` */
  readonly ON_DUPLICATE: OnDuplicate;
  /** (provided) `AttributeSafety::Normal` */
  readonly SAFETY: AttributeSafety;
  readonly STABILITY: AttributeStability;

  readonly ALLOWED_TARGETS: AllowedTargets;

  /// The template this attribute parser should implement. Used for diagnostics.
  readonly TEMPLATE: AttributeTemplate;

  /// Converts a single syntactical attribute to a single semantic attribute, or [`AttributeKind`]
  // rustc: compiler/rustc_attr_parsing/src/attributes/mod.rs:163 convert
  convert(cx: AcceptContext, args: ArgParser): AttributeKind | undefined;

  /** (provided) no-op */
  finalize_check(cx: FinalizeCheckContext, attr_span: Span): void;
}

type SingleAttributeParserProvided = "ON_DUPLICATE" | "SAFETY" | "finalize_check";

/** The provided items of `SingleAttributeParser`; an impl lists its required items and any overrides. */
export function SingleAttributeParser_provided(
  impl: Omit<SingleAttributeParser, SingleAttributeParserProvided> & Partial<Pick<SingleAttributeParser, SingleAttributeParserProvided>>,
): SingleAttributeParser {
  return {
    ON_DUPLICATE: OnDuplicate.Error,
    SAFETY: AttributeSafety.Normal,

    /// Optional cross-attribute validation, run once *after* all attributes on the item
    /// have been finalized. Unlike [`convert`](Self::convert), this has access to the
    /// sibling attributes via [`FinalizeCheckContext::all_attrs`] and the fully parsed
    /// attributes via [`FinalizeCheckContext::parsed_attrs`], so it can reject incompatible
    /// combinations. `attr_span` is the span of this attribute.
    ///
    /// Defaults to a no-op.
    // rustc: compiler/rustc_attr_parsing/src/attributes/mod.rs:172 finalize_check
    finalize_check(_cx: FinalizeCheckContext, _attr_span: Span): void {},

    ...impl,
  };
}

/// Use in combination with [`SingleAttributeParser`].
/// `Single<T: SingleAttributeParser>` implements [`AttributeParser`].
// PORT: `struct Single<T>(PhantomData<T>, Option<(AttributeKind, Span)>)`: the state object holds field
// `1` as `_1`; the type parameter `T` is the argument of `Single(T)`, which returns `Single<T>`'s
// `AttributeParser` table.
export interface Single {
  _1: [AttributeKind, Span] | undefined;
}

export function Single(T: SingleAttributeParser): AttributeParser<Single> {
  return AttributeParser_provided<Single>({
    /** `impl<T: SingleAttributeParser> Default for Single<T>` */
    // rustc: compiler/rustc_attr_parsing/src/attributes/mod.rs:180 default
    default(): Single {
      return { _1: undefined };
    },

    ATTRIBUTES: [
      [
        T.PATH,
        T.TEMPLATE,
        T.STABILITY,
        (group: Single, cx, args) => {
          const pa = T.convert(cx, args);
          if (pa !== undefined) {
            if (group._1 !== undefined) {
              const [, used] = group._1;
              OnDuplicate.exec(T.ON_DUPLICATE, T, cx, used, cx.attr_span);
            } else {
              group._1 = [pa, cx.attr_span];
            }
          }
        },
      ],
    ],
    ALLOWED_TARGETS: T.ALLOWED_TARGETS,
    SAFETY: T.SAFETY,

    // rustc: compiler/rustc_attr_parsing/src/attributes/mod.rs:203 finalize
    finalize(self: Single, _cx: FinalizeContext): AttributeKind | undefined {
      if (self._1 === undefined) return undefined;
      const [kind, _span] = self._1;
      return kind;
    },

    // rustc: compiler/rustc_attr_parsing/src/attributes/mod.rs:208 deferred_finalize_check
    deferred_finalize_check(self: Single): [FinalizeCheckFn, Span] | undefined {
      if (self._1 === undefined) return undefined;
      const [, span] = self._1;
      return [(cx, attr_span) => T.finalize_check(cx, attr_span), span];
    },
  });
}

/** `pub(crate) enum OnDuplicate` */
export type OnDuplicate =
  /// Give a default warning
  | "Warn"
  /// Duplicates will be a warning, with a note that this will be an error in the future.
  | "WarnButFutureError"
  /// Give a default error
  | "Error"
  /// Ignore duplicates
  | "Ignore";
export const OnDuplicate = {
  Warn: "Warn",
  WarnButFutureError: "WarnButFutureError",
  Error: "Error",
  Ignore: "Ignore",

  // PORT: the type parameter `P: SingleAttributeParser` is the table `P`.
  // rustc: compiler/rustc_attr_parsing/src/attributes/mod.rs:229 exec
  exec(self: OnDuplicate, P: SingleAttributeParser, cx: AcceptContext, used: Span, unused: Span): void {
    switch (self) {
      case "Warn":
        cx.shared.warn_unused_duplicate(used, unused);
        break;
      case "WarnButFutureError":
        cx.shared.warn_unused_duplicate_future_error(used, unused);
        break;
      case "Error": {
        cx.shared.emit_err(
          UnusedMultiple_diagnostic({
            this: unused,
            other: used,
            name: Symbol.intern(P.PATH.map((i) => display_Symbol(i)).join("..")),
          }),
        );
        break;
      }
      case "Ignore":
        break;
    }
  },
} as const;

/** `#[derive(Copy, Clone, PartialEq, Debug)] pub enum AttributeSafety` */
export type AttributeSafety =
  /// Normal attribute that does not need `#[unsafe(...)]`
  | { readonly $: "Normal" }
  /// Unsafe attribute that requires safety obligations to be discharged.
  ///
  /// An error is emitted when `#[unsafe(...)]` is omitted, except when the attribute's edition
  /// is less than the one stored in `unsafe_since`. This handles attributes that were safe in
  /// earlier editions, but become unsafe in later ones.
  | {
      readonly $: "Unsafe";
      /// The `note` is emitted during the `unsafe_code`, and explains to the user why this attribute is unsafe.
      readonly note: string;
      readonly unsafe_since: Edition | undefined;
    };
export const AttributeSafety = {
  Normal: Object.freeze({ $: "Normal" as const }) as AttributeSafety,
};

/// An even simpler version of [`SingleAttributeParser`]:
/// now automatically check that there are no arguments provided to the attribute.
///
/// [`WithoutArgs<T> where T: NoArgsAttributeParser`](WithoutArgs) implements [`SingleAttributeParser`].
//
/** `pub(crate) trait NoArgsAttributeParser: 'static` */
export interface NoArgsAttributeParser {
  readonly PATH: readonly Symbol[];
  /** (provided) `OnDuplicate::Error` */
  readonly ON_DUPLICATE: OnDuplicate;
  readonly ALLOWED_TARGETS: AllowedTargets;
  /** (provided) `AttributeSafety::Normal` */
  readonly SAFETY: AttributeSafety;
  readonly STABILITY: AttributeStability;

  /// Create the [`AttributeKind`] given attribute's [`Span`].
  readonly CREATE: (span: Span) => AttributeKind;

  /** (provided) no-op */
  finalize_check(cx: FinalizeCheckContext, attr_span: Span): void;
}

type NoArgsAttributeParserProvided = "ON_DUPLICATE" | "SAFETY" | "finalize_check";

/** The provided items of `NoArgsAttributeParser`; an impl lists its required items and any overrides. */
export function NoArgsAttributeParser_provided(
  impl: Omit<NoArgsAttributeParser, NoArgsAttributeParserProvided> & Partial<Pick<NoArgsAttributeParser, NoArgsAttributeParserProvided>>,
): NoArgsAttributeParser {
  return {
    ON_DUPLICATE: OnDuplicate.Error,
    SAFETY: AttributeSafety.Normal,

    /// Optional cross-attribute validation, run once *after* all attributes on the item
    /// have been finalized. Has access to the sibling attributes via
    /// [`FinalizeCheckContext::all_attrs`] and the fully parsed attributes via
    /// [`FinalizeCheckContext::parsed_attrs`], so it can reject incompatible combinations.
    /// `attr_span` is the span of this attribute.
    ///
    /// Defaults to a no-op.
    // rustc: compiler/rustc_attr_parsing/src/attributes/mod.rs:290 finalize_check
    finalize_check(_cx: FinalizeCheckContext, _attr_span: Span): void {},

    ...impl,
  };
}

// PORT: `struct WithoutArgs<T>(PhantomData<T>)` carries no data; `WithoutArgs(T)` returns its
// `SingleAttributeParser` table.
export type WithoutArgs = Record<string, never>;

/** `impl<T: NoArgsAttributeParser> Default for WithoutArgs<T>` */
// rustc: compiler/rustc_attr_parsing/src/attributes/mod.rs:296 default
export function WithoutArgs_default(): WithoutArgs {
  return {};
}

export function WithoutArgs(T: NoArgsAttributeParser): SingleAttributeParser {
  return {
    PATH: T.PATH,
    ON_DUPLICATE: T.ON_DUPLICATE,
    SAFETY: T.SAFETY,
    STABILITY: T.STABILITY,
    ALLOWED_TARGETS: T.ALLOWED_TARGETS,
    TEMPLATE: template({ Word: true }),

    // rustc: compiler/rustc_attr_parsing/src/attributes/mod.rs:309 convert
    convert(cx: AcceptContext, args: ArgParser): AttributeKind | undefined {
      void cx.expect_no_args(args);
      return T.CREATE(cx.attr_span);
    },

    // rustc: compiler/rustc_attr_parsing/src/attributes/mod.rs:314 finalize_check
    finalize_check(cx: FinalizeCheckContext, attr_span: Span): void {
      T.finalize_check(cx, attr_span);
    },
  };
}

/** `type ConvertFn<E> = fn(ThinVec<E>, Span) -> AttributeKind;` */
export type ConvertFn<E> = (items: E[], span: Span) => AttributeKind;

/// Alternative to [`AttributeParser`] that automatically handles state management.
/// If multiple attributes appear on an element, combines the values of each into a
/// [`ThinVec`].
/// [`Combine<T> where T: CombineAttributeParser`](Combine) implements [`AttributeParser`].
///
/// [`CombineAttributeParser`] can only convert a single kind of attribute, and cannot combine multiple
/// attributes together like is necessary for `#[stable()]` and `#[unstable()]` for example.
/** `pub(crate) trait CombineAttributeParser: 'static` (`type Item` is the parameter `Item`). */
export interface CombineAttributeParser<Item> {
  readonly PATH: readonly Symbol[];

  /// A function that converts individual items (of type [`Item`](Self::Item)) into the final attribute.
  ///
  /// For example, individual representations from `#[repr(...)]` attributes into an `AttributeKind::Repr(x)`,
  ///  where `x` is a vec of these individual reprs.
  readonly CONVERT: ConvertFn<Item>;
  /** (provided) `AttributeSafety::Normal` */
  readonly SAFETY: AttributeSafety;
  readonly STABILITY: AttributeStability;

  readonly ALLOWED_TARGETS: AllowedTargets;

  /// The template this attribute parser should implement. Used for diagnostics.
  readonly TEMPLATE: AttributeTemplate;

  /// Converts a single syntactical attribute to a number of elements of the semantic attribute, or [`AttributeKind`]
  // rustc: compiler/rustc_attr_parsing/src/attributes/mod.rs:346 extend
  extend(cx: AcceptContext, args: ArgParser): Iterable<Item>;

  /** (provided) no-op */
  finalize_check(cx: FinalizeCheckContext, attr_span: Span): void;
}

type CombineAttributeParserProvided = "SAFETY" | "finalize_check";

/** The provided items of `CombineAttributeParser`; an impl lists its required items and any overrides. */
export function CombineAttributeParser_provided<Item>(
  impl: Omit<CombineAttributeParser<Item>, CombineAttributeParserProvided> &
    Partial<Pick<CombineAttributeParser<Item>, CombineAttributeParserProvided>>,
): CombineAttributeParser<Item> {
  return {
    SAFETY: AttributeSafety.Normal,

    /// Optional cross-attribute validation, run once *after* all attributes on the item
    /// have been finalized. Has access to the sibling attributes via
    /// [`FinalizeCheckContext::all_attrs`] and the fully parsed attributes via
    /// [`FinalizeCheckContext::parsed_attrs`], so it can reject incompatible combinations.
    /// `attr_span` is the span of the first attribute that was encountered.
    ///
    /// Defaults to a no-op.
    // rustc: compiler/rustc_attr_parsing/src/attributes/mod.rs:358 finalize_check
    finalize_check(_cx: FinalizeCheckContext, _attr_span: Span): void {},

    ...impl,
  };
}

// PORT: see `ErasedAttributeParser`.
export type ErasedCombineAttributeParser = CombineAttributeParser<any>;

/// Use in combination with [`CombineAttributeParser`].
/// `Combine<T: CombineAttributeParser>` implements [`AttributeParser`].
// PORT: `phantom: PhantomData<T>` is erased; `Combine(T)` returns `Combine<T>`'s `AttributeParser` table.
export interface Combine<Item> {
  /// A list of all items produced by parsing attributes so far. One attribute can produce any amount of items.
  items: Item[];
  /// The full span of the first attribute that was encountered.
  first_span: Span | undefined;
}

export function Combine<Item>(T: CombineAttributeParser<Item>): AttributeParser<Combine<Item>> {
  return AttributeParser_provided<Combine<Item>>({
    /** `impl<T: CombineAttributeParser> Default for Combine<T>` */
    // rustc: compiler/rustc_attr_parsing/src/attributes/mod.rs:372 default
    default(): Combine<Item> {
      return {
        items: [],
        first_span: undefined,
      };
    },

    ATTRIBUTES: [
      [
        T.PATH,
        T.TEMPLATE,
        T.STABILITY,
        (group: Combine<Item>, cx, args) => {
          // Keep track of the span of the first attribute, for diagnostics
          group.first_span ??= cx.attr_span;
          group.items.push(...T.extend(cx, args));
        },
      ],
    ],
    ALLOWED_TARGETS: T.ALLOWED_TARGETS,
    SAFETY: T.SAFETY,

    // rustc: compiler/rustc_attr_parsing/src/attributes/mod.rs:391 finalize
    finalize(self: Combine<Item>, _cx: FinalizeContext): AttributeKind | undefined {
      const first_span = self.first_span;
      if (first_span === undefined) return undefined;
      return T.CONVERT(self.items, first_span);
    },

    // rustc: compiler/rustc_attr_parsing/src/attributes/mod.rs:396 deferred_finalize_check
    deferred_finalize_check(self: Combine<Item>): [FinalizeCheckFn, Span] | undefined {
      if (self.first_span === undefined) return undefined;
      return [(cx, attr_span) => T.finalize_check(cx, attr_span), self.first_span];
    },
  });
}

/**
 * Stub scaffolding (not upstream): a trait table whose every member access reaches
 * `unported("<path>::<member>")`. Used by the attribute-parser stub modules until attr-parse-b
 * ports them; delete it when no stub uses it.
 */
export function unported_impl<T extends object>(path: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      if (typeof prop === "symbol") return undefined;
      return unported(`${path}::${prop}`);
    },
  });
}
