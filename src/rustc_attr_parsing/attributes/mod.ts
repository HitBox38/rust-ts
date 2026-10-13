// STUB for compiler/rustc_attr_parsing/src/attributes/mod.rs (owned by lane attr-parse-b).
//
// Created by lane attr-parse-a. It holds the contract that the crate core (context.ts / interface.ts)
// relies on: the TS shape of the parser traits, `AttributeSafety`, and the generic parser types
// `Single` / `Combine` / `WithoutArgs` (here `unported`, no markers). attr-parse-b ports the fns of
// mod.rs (the trait impls of `Single`/`Combine`/`WithoutArgs`, `OnDuplicate::exec`, the provided
// trait items as `<Trait>_provided` helpers) in place, keeping these names and shapes; see
// docs/handoff/attr-parse-a.md "Contract for attr-parse-b".
//
// Trait representation (PORTING §5 "Traits"): a parser *type* is its trait table, a frozen object
// holding the trait's associated consts (`PATH`, `TEMPLATE`, ...) and fns. Fns taking `self` take the
// state value as their first parameter. `Default` (a supertrait of `AttributeParser`) is the table's
// `default()`; the state it returns is a mutable object that accept fns update in place (`&mut T`),
// because context.rs keeps one state object per parser type (its `thread_local!` `STATE_OBJECT`).
//
// The `pub(crate) mod <name>;` declarations of mod.rs are not mirrored as re-exports here: the
// submodules import this module, and context.ts imports each submodule directly.
import type { AttributeKind } from "../../rustc_attr_ir/lib.ts";
import type { AttributeStability } from "../../rustc_feature/lib.ts";
import type { Edition } from "../../rustc_span/edition.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import { unported } from "../../std/panic.ts";
import type { AcceptContext, FinalizeCheckContext, FinalizeCheckFn, FinalizeContext } from "../context.ts";
import type { ArgParser } from "../parser.ts";
import type { AllowedTargets } from "../target_checking.ts";
import type { AttributeTemplate } from "../template.ts";

/** `type AcceptFn<T> = for<'sess> fn(&mut T, &mut AcceptContext<'_, 'sess>, &ArgParser);` */
export type AcceptFn<T> = (self: T, cx: AcceptContext, args: ArgParser) => void;
/** `type AcceptMapping<T> = &'static [(&'static [Symbol], AttributeTemplate, AttributeStability, AcceptFn<T>)];` */
export type AcceptMapping<T> = readonly (readonly [
  path: readonly Symbol[],
  template: AttributeTemplate,
  stability: AttributeStability,
  accept_fn: AcceptFn<T>,
])[];

/** `pub(crate) trait AttributeParser: Default + 'static`, as the trait table of a parser type `T`. */
export interface AttributeParser<T> {
  /** `Default::default()` (supertrait). Returns a fresh mutable state object. */
  default(): T;
  readonly ATTRIBUTES: AcceptMapping<T>;
  readonly ALLOWED_TARGETS: AllowedTargets;
  /** (provided) `AttributeSafety::Normal` */
  readonly SAFETY: AttributeSafety;

  finalize(self: T, cx: FinalizeContext): AttributeKind | undefined;

  /** (provided) `None` */
  deferred_finalize_check(self: T): [FinalizeCheckFn, Span] | undefined;
}

// PORT: the list in context.rs holds parser types with different state types (an existential over
// `T`); `any` is the erased state type of such a list element.
export type ErasedAttributeParser = AttributeParser<any>;

/** `pub(crate) trait SingleAttributeParser: 'static` */
export interface SingleAttributeParser {
  readonly PATH: readonly Symbol[];
  /** (provided) `OnDuplicate::Error` */
  readonly ON_DUPLICATE: OnDuplicate;
  /** (provided) `AttributeSafety::Normal` */
  readonly SAFETY: AttributeSafety;
  readonly STABILITY: AttributeStability;
  readonly ALLOWED_TARGETS: AllowedTargets;
  readonly TEMPLATE: AttributeTemplate;

  convert(cx: AcceptContext, args: ArgParser): AttributeKind | undefined;

  /** (provided) no-op */
  finalize_check(cx: FinalizeCheckContext, attr_span: Span): void;
}

/** `pub(crate) enum OnDuplicate` */
export type OnDuplicate = "Warn" | "WarnButFutureError" | "Error" | "Ignore";
export const OnDuplicate = { Warn: "Warn", WarnButFutureError: "WarnButFutureError", Error: "Error", Ignore: "Ignore" } as const;

/** `#[derive(Copy, Clone, PartialEq, Debug)] pub enum AttributeSafety` */
export type AttributeSafety =
  /// Normal attribute that does not need `#[unsafe(...)]`
  | { readonly $: "Normal" }
  /// Unsafe attribute that requires safety obligations to be discharged.
  ///
  /// An error is emitted when `#[unsafe(...)]` is omitted, except when the attribute's edition
  /// is less than the one stored in `unsafe_since`. This handles attributes that were safe in
  /// earlier editions, but become unsafe in later ones.
  | { readonly $: "Unsafe"; readonly note: string; readonly unsafe_since: Edition | undefined };
export const AttributeSafety = {
  Normal: Object.freeze({ $: "Normal" as const }) as AttributeSafety,
};

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

/** `type ConvertFn<E> = fn(ThinVec<E>, Span) -> AttributeKind;` */
export type ConvertFn<E> = (items: E[], span: Span) => AttributeKind;

/** `pub(crate) trait CombineAttributeParser: 'static` (`type Item` is the parameter `Item`). */
export interface CombineAttributeParser<Item> {
  readonly PATH: readonly Symbol[];
  readonly CONVERT: ConvertFn<Item>;
  /** (provided) `AttributeSafety::Normal` */
  readonly SAFETY: AttributeSafety;
  readonly STABILITY: AttributeStability;
  readonly ALLOWED_TARGETS: AllowedTargets;
  readonly TEMPLATE: AttributeTemplate;

  extend(cx: AcceptContext, args: ArgParser): Iterable<Item>;

  /** (provided) no-op */
  finalize_check(cx: FinalizeCheckContext, attr_span: Span): void;
}

// PORT: see `ErasedAttributeParser`.
export type ErasedCombineAttributeParser = CombineAttributeParser<any>;

/** `pub(crate) struct Single<T: SingleAttributeParser>` + `impl AttributeParser for Single<T>`. */
export function Single(_t: SingleAttributeParser): ErasedAttributeParser {
  return unported("rustc_attr_parsing::attributes::Single");
}

/** `pub(crate) struct WithoutArgs<T: NoArgsAttributeParser>` + `impl SingleAttributeParser for WithoutArgs<T>`. */
export function WithoutArgs(_t: NoArgsAttributeParser): SingleAttributeParser {
  return unported("rustc_attr_parsing::attributes::WithoutArgs");
}

/** `pub(crate) struct Combine<T: CombineAttributeParser>` + `impl AttributeParser for Combine<T>`. */
export function Combine(_t: ErasedCombineAttributeParser): ErasedAttributeParser {
  return unported("rustc_attr_parsing::attributes::Combine");
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
