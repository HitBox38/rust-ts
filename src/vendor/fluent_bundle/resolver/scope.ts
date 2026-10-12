// Port of fluent-bundle 0.16.0, src/resolver/scope.rs.
import { Ok, type Result } from "../../../std/result.ts";
import type {
  CallArguments,
  Expression,
  Identifier,
  InlineExpression,
  NamedArgument,
  Pattern,
  PatternElement,
  Variant,
  VariantKey,
} from "../../fluent_syntax/ast/mod.ts";
import { slice_eq } from "../../fluent_syntax/parser/slice.ts";
import type { FmtError, Write } from "../../fluent_syntax/unicode.ts";
import { FluentArgs } from "../args.ts";
import type { FluentBundle } from "../bundle.ts";
import { FluentError, type FluentError as FluentErrorT } from "../errors.ts";
import type { MemoizerKind } from "../memoizer.ts";
import type { FluentValue } from "../types/mod.ts";
import { ResolverError } from "./errors.ts";
import { WriteValue_for_Expression } from "./expression.ts";
import { ResolveValue_for_InlineExpression, WriteValue_for_InlineExpression } from "./inline_expression.ts";
import { WriteValue_for_Pattern } from "./pattern.ts";

/// State for a single `ResolveValue::to_value` call.
export class Scope<M extends MemoizerKind> {
  constructor(
    /// The current `FluentBundle` instance.
    public bundle: FluentBundle<M>,
    /// The current arguments passed by the developer.
    public args: FluentArgs | undefined,
    /// Local args
    public local_args: FluentArgs | undefined,
    /// The running count of resolved placeables. Used to detect the Billion
    /// Laughs and Quadratic Blowup attacks.
    public placeables: number,
    /// Tracks hashes to prevent infinite recursion.
    // PORT: `SmallVec<[&Pattern; 2]>` → array.
    public traveled: Pattern[],
    /// Track errors accumulated during resolving.
    public errors: FluentErrorT[] | undefined,
    /// Makes the resolver bail.
    public dirty: boolean,
  ) {}

  // crate: fluent-bundle-0.16.0/src/resolver/scope.rs:30 new
  static new<M extends MemoizerKind>(
    bundle: FluentBundle<M>,
    args: FluentArgs | undefined,
    errors: FluentErrorT[] | undefined,
  ): Scope<M> {
    return new Scope(bundle, args, undefined, 0, [], errors, false);
  }

  // crate: fluent-bundle-0.16.0/src/resolver/scope.rs:46 add_error
  add_error(error: ResolverError): void {
    const errors = this.errors;
    if (errors !== undefined) {
      errors.push(FluentError.from_ResolverError(error));
    }
  }

  /// This method allows us to lazily add Pattern on the stack, only if the
  /// `Pattern::resolve` has been called on an empty stack.
  ///
  /// This is the case when pattern is called from Bundle and it allows us to fast-path
  /// simple resolutions, and only use the stack for placeables.
  // crate: fluent-bundle-0.16.0/src/resolver/scope.rs:57 maybe_track
  maybe_track(w: Write, pattern: Pattern, exp: Expression): Result<null, FmtError> {
    if (this.traveled.length === 0) {
      this.traveled.push(pattern);
    }
    const r = WriteValue_for_Expression.write(exp, w, this);
    if (r.$ === "Err") return r;
    if (this.dirty) {
      const r1 = w.write_char(0x7b /* '{' */);
      if (r1.$ === "Err") return r1;
      const r2 = WriteValue_for_Expression.write_error(exp, w);
      if (r2.$ === "Err") return r2;
      return w.write_char(0x7d /* '}' */);
    } else {
      return Ok(null);
    }
  }

  // crate: fluent-bundle-0.16.0/src/resolver/scope.rs:81 track
  track(w: Write, pattern: Pattern, exp: InlineExpression): Result<null, FmtError> {
    // PORT: `SmallVec<[&Pattern]>::contains(&pattern)` compares the patterns by value
    // (`PartialEq` for `&T` derefs to the derived `PartialEq` of `ast::Pattern`).
    if (this.traveled.some((p) => Pattern_eq(p, pattern))) {
      this.add_error(ResolverError.Cyclic);
      const r1 = w.write_char(0x7b /* '{' */);
      if (r1.$ === "Err") return r1;
      const r2 = WriteValue_for_InlineExpression.write_error(exp, w);
      if (r2.$ === "Err") return r2;
      return w.write_char(0x7d /* '}' */);
    } else {
      this.traveled.push(pattern);
      const result = WriteValue_for_Pattern.write(pattern, w, this);
      this.traveled.pop();
      return result;
    }
  }

  // crate: fluent-bundle-0.16.0/src/resolver/scope.rs:105 write_ref_error
  write_ref_error(w: Write, exp: InlineExpression): Result<null, FmtError> {
    this.add_error(ResolverError.from(exp));
    const r1 = w.write_char(0x7b /* '{' */);
    if (r1.$ === "Err") return r1;
    const r2 = WriteValue_for_InlineExpression.write_error(exp, w);
    if (r2.$ === "Err") return r2;
    return w.write_char(0x7d /* '}' */);
  }

  // crate: fluent-bundle-0.16.0/src/resolver/scope.rs:119 get_arguments
  get_arguments(arguments_: CallArguments | undefined): [FluentValue[], FluentArgs] {
    if (arguments_ !== undefined) {
      const { positional: positional_, named: named_ } = arguments_;
      const positional = positional_.map((expr) => ResolveValue_for_InlineExpression.resolve(expr, this));

      // `.map(..).collect()` into `FluentArgs` (`FromIterator`; a `slice::Iter` map has an exact
      // size hint, and the values are resolved lazily as they are inserted).
      const self = this;
      const named = FluentArgs.from_iter(
        (function* () {
          for (const arg of named_) {
            yield [arg.name.name.toString(), ResolveValue_for_InlineExpression.resolve(arg.value, self)] as [
              string,
              FluentValue,
            ];
          }
        })(),
        named_.length,
      );

      return [positional, named];
    } else {
      return [[], FluentArgs.new()];
    }
  }
}

// ---------------------------------------------------------------------------------------------
// PORT: `#[derive(PartialEq)]` of the fluent_syntax AST types (`S = &str`, compared by content),
// needed by `track`. Belongs with fluent_syntax/ast (see handoff).
// ---------------------------------------------------------------------------------------------

function vec_eq<T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!eq(a[i]!, b[i]!)) return false;
  return true;
}

function option_eq<T>(a: T | undefined, b: T | undefined, eq: (x: T, y: T) => boolean): boolean {
  if (a === undefined || b === undefined) return a === b;
  return eq(a, b);
}

function Identifier_eq(a: Identifier, b: Identifier): boolean {
  return slice_eq(a.name, b.name);
}

export function Pattern_eq(a: Pattern, b: Pattern): boolean {
  return vec_eq(a.elements, b.elements, PatternElement_eq);
}

function PatternElement_eq(a: PatternElement, b: PatternElement): boolean {
  if (a.$ === "TextElement") return b.$ === "TextElement" && slice_eq(a.value, b.value);
  return b.$ === "Placeable" && Expression_eq(a.expression, b.expression);
}

function Expression_eq(a: Expression, b: Expression): boolean {
  if (a.$ === "Select") {
    return b.$ === "Select" && InlineExpression_eq(a.selector, b.selector) && vec_eq(a.variants, b.variants, Variant_eq);
  }
  return b.$ === "Inline" && InlineExpression_eq(a._0, b._0);
}

function Variant_eq(a: Variant, b: Variant): boolean {
  return VariantKey_eq(a.key, b.key) && Pattern_eq(a.value, b.value) && a.default === b.default;
}

function VariantKey_eq(a: VariantKey, b: VariantKey): boolean {
  if (a.$ === "Identifier") return b.$ === "Identifier" && slice_eq(a.name, b.name);
  return b.$ === "NumberLiteral" && slice_eq(a.value, b.value);
}

function CallArguments_eq(a: CallArguments, b: CallArguments): boolean {
  return vec_eq(a.positional, b.positional, InlineExpression_eq) && vec_eq(a.named, b.named, NamedArgument_eq);
}

function NamedArgument_eq(a: NamedArgument, b: NamedArgument): boolean {
  return Identifier_eq(a.name, b.name) && InlineExpression_eq(a.value, b.value);
}

function InlineExpression_eq(a: InlineExpression, b: InlineExpression): boolean {
  switch (a.$) {
    case "StringLiteral":
      return b.$ === "StringLiteral" && slice_eq(a.value, b.value);
    case "NumberLiteral":
      return b.$ === "NumberLiteral" && slice_eq(a.value, b.value);
    case "FunctionReference":
      return b.$ === "FunctionReference" && Identifier_eq(a.id, b.id) && CallArguments_eq(a.arguments, b.arguments);
    case "MessageReference":
      return b.$ === "MessageReference" && Identifier_eq(a.id, b.id) && option_eq(a.attribute, b.attribute, Identifier_eq);
    case "TermReference":
      return (
        b.$ === "TermReference" &&
        Identifier_eq(a.id, b.id) &&
        option_eq(a.attribute, b.attribute, Identifier_eq) &&
        option_eq(a.arguments, b.arguments, CallArguments_eq)
      );
    case "VariableReference":
      return b.$ === "VariableReference" && Identifier_eq(a.id, b.id);
    case "Placeable":
      return b.$ === "Placeable" && Expression_eq(a.expression, b.expression);
  }
}
