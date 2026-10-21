// Port of compiler/rustc_lint/src/lifetime_syntax.rs. The lint static and the `declare_lint_pass!` expansion are
// generated (lifetime_syntax.lints.gen.ts).
import { KeyedMap } from "../rust_ts/keyed.ts";
import type { AmbigArg, Body, FnDecl, ForeignItem, Lifetime, LifetimeKind, TraitItem, Ty } from "../rustc_hir/hir.ts";
import { type FnKind, Visitor, walk_ty, walk_unambig_ty } from "../rustc_hir/intravisit.ts";
import { type HirId, HirId_key } from "../rustc_hir_id/lib.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { Span } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { type Debug, debug_struct } from "../std/fmt.ts";
import { panic, unwrap } from "../std/panic.ts";
import type { LateContext } from "./context.ts";
import { MismatchedLifetimeSyntaxes_diagnostic, type MismatchedLifetimeSyntaxesSuggestion } from "./diagnostics.ts";
import { LifetimeSyntax, MISMATCHED_LIFETIME_SYNTAXES } from "./lifetime_syntax.lints.gen.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./lifetime_syntax.lints.gen.ts";

declare module "./lifetime_syntax.lints.gen.ts" {
  interface LifetimeSyntax extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for LifetimeSyntax
// #[instrument(skip_all)]
// rustc: compiler/rustc_lint/src/lifetime_syntax.rs:79 check_fn
LifetimeSyntax.prototype.check_fn = function (
  this: LifetimeSyntax,
  cx: LateContext,
  _: FnKind,
  fd: FnDecl,
  __: Body,
  ___: Span,
  ____: LocalDefId,
): void {
  check_fn_like(cx, fd);
};

// #[instrument(skip_all)]
// rustc: compiler/rustc_lint/src/lifetime_syntax.rs:92 check_trait_item
LifetimeSyntax.prototype.check_trait_item = function (this: LifetimeSyntax, cx: LateContext, ti: TraitItem): void {
  switch (ti.kind.$) {
    case "Const":
      break;
    case "Fn": {
      const fn_sig = ti.kind._0;
      check_fn_like(cx, fn_sig.decl);
      break;
    }
    case "Type":
      break;
  }
};

// #[instrument(skip_all)]
// rustc: compiler/rustc_lint/src/lifetime_syntax.rs:101 check_foreign_item
LifetimeSyntax.prototype.check_foreign_item = function (this: LifetimeSyntax, cx: LateContext, fi: ForeignItem): void {
  switch (fi.kind.$) {
    case "Fn": {
      const fn_sig = fi.kind._0;
      check_fn_like(cx, fn_sig.decl);
      break;
    }
    case "Static":
      break;
    case "Type":
      break;
  }
};

/** PORT: `FxIndexMap<hir::LifetimeKind, _>` key: the derived `Hash`/`Eq` of `LifetimeKind` (`LocalDefId` is a handle;
 * `ErrorGuaranteed` compares equal). */
function LifetimeKind_key(kind: LifetimeKind): string {
  return kind.$ === "Param" ? `Param(${kind._0})` : kind.$;
}

// rustc: compiler/rustc_lint/src/lifetime_syntax.rs:110 check_fn_like
function check_fn_like(cx: LateContext, fd: FnDecl): void {
  if (fd.inputs.length === 0) {
    return;
  }
  if (fd.output.$ !== "Return") {
    return;
  }
  const output = fd.output._0;

  const map: KeyedMap<LifetimeKind, LifetimeGroup> = new KeyedMap(LifetimeKind_key);

  LifetimeInfoCollector.collect(output, (info) => {
    // `map.entry(info.lifetime.kind).or_default()`
    let group = map.get(info.lifetime.kind);
    if (group === undefined) {
      group = LifetimeGroup_default();
      map.set(info.lifetime.kind, group);
    }
    group.outputs.push(info);
  });
  if (map.size === 0) {
    return;
  }

  for (const input of fd.inputs) {
    LifetimeInfoCollector.collect(input, (info) => {
      const group = map.get(info.lifetime.kind);
      if (group !== undefined) {
        group.inputs.push(info);
      }
    });
  }

  for (const { inputs, outputs } of map.values()) {
    if (inputs.length === 0) {
      continue;
    }
    if (!lifetimes_use_matched_syntax(inputs, outputs)) {
      emit_mismatch_diagnostic(cx, inputs, outputs);
    }
  }
}

// #[derive(Default)]
interface LifetimeGroup {
  inputs: Info[];
  outputs: Info[];
}

function LifetimeGroup_default(): LifetimeGroup {
  return { inputs: [], outputs: [] };
}

// #[derive(Debug, Copy, Clone, PartialEq)]
type LifetimeSyntaxCategory = "Hidden" | "Elided" | "Named";
const LifetimeSyntaxCategory = {
  Hidden: "Hidden",
  Elided: "Elided",
  Named: "Named",

  // rustc: compiler/rustc_lint/src/lifetime_syntax.rs:160 new
  new(lifetime: Lifetime): LifetimeSyntaxCategory | undefined {
    const syntax = lifetime.syntax;
    const source = lifetime.source.$;
    if (
      // E.g. `&T`.
      (syntax === "Implicit" && source === "Reference") ||
      // E.g. `&'_ T`.
      (syntax === "ExplicitAnonymous" && source === "Reference") ||
      // E.g. `ContainsLifetime<'_>`.
      (syntax === "ExplicitAnonymous" && source === "Path") ||
      // E.g. `+ '_`, `+ use<'_>`.
      (syntax === "ExplicitAnonymous" && (source === "OutlivesBound" || source === "PreciseCapturing"))
    ) {
      return "Elided";
    }

    // E.g. `ContainsLifetime`.
    if (syntax === "Implicit" && source === "Path") return "Hidden";

    if (
      // E.g. `&'a T`.
      (syntax === "ExplicitBound" && source === "Reference") ||
      // E.g. `ContainsLifetime<'a>`.
      (syntax === "ExplicitBound" && source === "Path") ||
      // E.g. `+ 'a`, `+ use<'a>`.
      (syntax === "ExplicitBound" && (source === "OutlivesBound" || source === "PreciseCapturing"))
    ) {
      return "Named";
    }

    // (Implicit, OutlivesBound | PreciseCapturing) | (_, Other)
    return undefined;
  },
} as const;

// #[derive(Debug, Default)]
export interface LifetimeSyntaxCategories<T> {
  hidden: T;
  elided: T;
  named: T;
}

/** `#[derive(Debug)]` of `LifetimeSyntaxCategories<T>` */
export function debug_LifetimeSyntaxCategories<T>(debug_T: Debug<T>): Debug<LifetimeSyntaxCategories<T>> {
  return (v, f) =>
    debug_struct(f, "LifetimeSyntaxCategories", [
      ["hidden", debug_T(v.hidden, f)],
      ["elided", debug_T(v.elided, f)],
      ["named", debug_T(v.named, f)],
    ]);
}

export const LifetimeSyntaxCategories = {
  // impl<T> LifetimeSyntaxCategories<T>
  // PORT: `&mut T` result: returns the field name to read/write (`self[select(..)]`).
  // rustc: compiler/rustc_lint/src/lifetime_syntax.rs:197 select
  select<T>(self: LifetimeSyntaxCategories<T>, category: LifetimeSyntaxCategory): keyof LifetimeSyntaxCategories<T> {
    void self;
    switch (category) {
      case "Elided":
        return "elided";
      case "Hidden":
        return "hidden";
      case "Named":
        return "named";
    }
  },

  // impl<T> LifetimeSyntaxCategories<Vec<T>>
  // rustc: compiler/rustc_lint/src/lifetime_syntax.rs:209 len
  len<T>(self: LifetimeSyntaxCategories<readonly T[]>): LifetimeSyntaxCategories<number> {
    return {
      hidden: self.hidden.length,
      elided: self.elided.length,
      named: self.named.length,
    };
  },

  // rustc: compiler/rustc_lint/src/lifetime_syntax.rs:217 iter_unnamed
  iter_unnamed<T>(self: LifetimeSyntaxCategories<readonly T[]>): T[] {
    const { hidden, elided } = self;
    return [...hidden, ...elided];
  },

  // impl std::ops::Add for LifetimeSyntaxCategories<usize>
  // rustc: compiler/rustc_lint/src/lifetime_syntax.rs:226 add
  add(self: LifetimeSyntaxCategories<number>, rhs: LifetimeSyntaxCategories<number>): LifetimeSyntaxCategories<number> {
    return {
      hidden: self.hidden + rhs.hidden,
      elided: self.elided + rhs.elided,
      named: self.named + rhs.named,
    };
  },
};

// rustc: compiler/rustc_lint/src/lifetime_syntax.rs:235 lifetimes_use_matched_syntax
function lifetimes_use_matched_syntax(input_info: readonly Info[], output_info: readonly Info[]): boolean {
  // `input_info.split_first().unwrap()`
  const first = unwrap(input_info[0]);
  const inputs = input_info.slice(1);
  return [...inputs, ...output_info].every((info) => info.syntax_category === first.syntax_category);
}

// rustc: compiler/rustc_lint/src/lifetime_syntax.rs:240 emit_mismatch_diagnostic
function emit_mismatch_diagnostic(cx: LateContext, input_info: readonly Info[], output_info: readonly Info[]): void {
  // There can only ever be zero or one bound lifetime
  // for a given lifetime resolution.
  let bound_lifetime: Info | undefined = undefined;

  // We offer the following kinds of suggestions (when appropriate
  // such that the suggestion wouldn't violate the lint):
  //
  // 1. Every lifetime becomes named, when there is already a
  //    user-provided name.
  //
  // 2. A "mixed" signature, where references become implicit
  //    and paths become explicitly anonymous.
  //
  // 3. Every lifetime becomes implicit.
  //
  // 4. Every lifetime becomes explicitly anonymous.
  //
  // Number 2 is arguably the most common pattern and the one we
  // should push strongest. Number 3 is likely the next most common,
  // followed by number 1. Coming in at a distant last would be
  // number 4.
  //
  // Beyond these, there are variants of acceptable signatures that
  // we won't suggest because they are very low-value. For example,
  // we will never suggest `fn(&T1, &'_ T2) -> &T3` even though that
  // would pass the lint.
  //
  // The following collections are the lifetime instances that we
  // suggest changing to a given alternate style.

  // 1. Convert all to named.
  const suggest_change_to_explicit_bound: Info[] = [];

  // 2. Convert to mixed. We track each kind of change separately.
  const suggest_change_to_mixed_implicit: Info[] = [];
  const suggest_change_to_mixed_explicit_anonymous: Info[] = [];

  // 3. Convert all to implicit.
  const suggest_change_to_implicit: Info[] = [];

  // 4. Convert all to explicit anonymous.
  const suggest_change_to_explicit_anonymous: Info[] = [];

  // Some styles prevent using implicit syntax at all.
  let allow_suggesting_implicit = true;

  // It only makes sense to suggest mixed if we have both sources.
  let saw_a_reference = false;
  let saw_a_path = false;

  for (const info of [...input_info, ...output_info]) {
    const lifetime = info.lifetime;

    if (lifetime.syntax === "ExplicitBound") {
      bound_lifetime = info;
    }

    const syntax = lifetime.syntax;
    const source = lifetime.source.$;
    if (syntax === "Implicit" && source === "Reference") {
      // E.g. `&T`.
      suggest_change_to_explicit_anonymous.push(info);
      suggest_change_to_explicit_bound.push(info);
    } else if (syntax === "ExplicitAnonymous" && source === "Reference") {
      // E.g. `&'_ T`.
      suggest_change_to_implicit.push(info);
      suggest_change_to_explicit_bound.push(info);
    } else if (syntax === "Implicit" && source === "Path") {
      // E.g. `ContainsLifetime`.
      suggest_change_to_mixed_explicit_anonymous.push(info);
      suggest_change_to_explicit_anonymous.push(info);
      suggest_change_to_explicit_bound.push(info);
    } else if (syntax === "ExplicitAnonymous" && (source === "Path" || source === "OutlivesBound" || source === "PreciseCapturing")) {
      // E.g. `ContainsLifetime<'_>`, `+ '_`, `+ use<'_>`.
      suggest_change_to_explicit_bound.push(info);
    } else if (syntax === "ExplicitBound" && source === "Reference") {
      // E.g. `&'a T`.
      suggest_change_to_implicit.push(info);
      suggest_change_to_mixed_implicit.push(info);
      suggest_change_to_explicit_anonymous.push(info);
    } else if (syntax === "ExplicitBound" && (source === "Path" || source === "OutlivesBound" || source === "PreciseCapturing")) {
      // E.g. `ContainsLifetime<'a>`, `+ 'a`, `+ use<'a>`.
      suggest_change_to_mixed_explicit_anonymous.push(info);
      suggest_change_to_explicit_anonymous.push(info);
    } else if (syntax === "Implicit" && (source === "OutlivesBound" || source === "PreciseCapturing")) {
      panic("This syntax / source combination is not possible");
    } else {
      // (_, Other)
      panic("This syntax / source combination has already been skipped");
    }

    if (source === "Path" || source === "OutlivesBound" || source === "PreciseCapturing") {
      allow_suggesting_implicit = false;
    }

    switch (source) {
      case "Reference":
        saw_a_reference = true;
        break;
      case "Path":
        saw_a_path = true;
        break;
      default:
        break;
    }
  }

  const categorize = (infos: readonly Info[]): LifetimeSyntaxCategories<Span[]> => {
    const categories: LifetimeSyntaxCategories<Span[]> = { hidden: [], elided: [], named: [] };
    for (const info of infos) {
      categories[LifetimeSyntaxCategories.select(categories, info.syntax_category)].push(info.reporting_span());
    }
    return categories;
  };

  const inputs = categorize(input_info);
  const outputs = categorize(output_info);

  const make_implicit_suggestions = (infos: readonly Info[]): Span[] => infos.map((i) => i.removing_span());

  const explicit_bound_suggestion =
    bound_lifetime === undefined
      ? undefined
      : build_mismatch_suggestion(Symbol.as_str(bound_lifetime.lifetime.ident.name), suggest_change_to_explicit_bound);

  // tracing::debug!(?bound_lifetime, ?explicit_bound_suggestion);

  const should_suggest_mixed =
    // Do we have a mixed case?
    saw_a_reference &&
    saw_a_path &&
    // Is there anything to change?
    (suggest_change_to_mixed_implicit.length !== 0 || suggest_change_to_mixed_explicit_anonymous.length !== 0) &&
    // If we have a named lifetime, prefer consistent naming.
    bound_lifetime === undefined;

  let mixed_suggestion: MismatchedLifetimeSyntaxesSuggestion | undefined = undefined;
  if (should_suggest_mixed) {
    const implicit_suggestions = make_implicit_suggestions(suggest_change_to_mixed_implicit);

    const explicit_anonymous_suggestions = build_mismatch_suggestions_for_lifetime("'_", suggest_change_to_mixed_explicit_anonymous);

    mixed_suggestion = {
      $: "Mixed",
      implicit_suggestions,
      explicit_anonymous_suggestions,
      optional_alternative: false,
    };
  }

  // tracing::debug!(?suggest_change_to_mixed_implicit, ?suggest_change_to_mixed_explicit_anonymous, ?mixed_suggestion);

  const should_suggest_implicit =
    // Is there anything to change?
    suggest_change_to_implicit.length !== 0 &&
    // We never want to hide the lifetime in a path (or similar).
    allow_suggesting_implicit &&
    // If we have a named lifetime, prefer consistent naming.
    bound_lifetime === undefined;

  let implicit_suggestion: MismatchedLifetimeSyntaxesSuggestion | undefined = undefined;
  if (should_suggest_implicit) {
    const suggestions = make_implicit_suggestions(suggest_change_to_implicit);

    implicit_suggestion = {
      $: "Implicit",
      suggestions,
      optional_alternative: false,
    };
  }

  // tracing::debug!(?should_suggest_implicit, ?suggest_change_to_implicit, allow_suggesting_implicit, ?implicit_suggestion);

  const should_suggest_explicit_anonymous =
    // Is there anything to change?
    suggest_change_to_explicit_anonymous.length !== 0 &&
    // If we already have a mixed suggestion, avoid overlapping alternatives.
    mixed_suggestion === undefined &&
    // If we have a named lifetime, prefer consistent naming.
    bound_lifetime === undefined;

  const explicit_anonymous_suggestion = should_suggest_explicit_anonymous
    ? build_mismatch_suggestion("'_", suggest_change_to_explicit_anonymous)
    : undefined;

  // tracing::debug!(?should_suggest_explicit_anonymous, ?suggest_change_to_explicit_anonymous, ?explicit_anonymous_suggestion);

  // We can produce a number of suggestions which may overwhelm
  // the user. Instead, we order the suggestions based on Rust
  // idioms. The "best" choice is shown to the user and the
  // remaining choices are shown to tools only.
  const suggestions: MismatchedLifetimeSyntaxesSuggestion[] = [];
  if (explicit_bound_suggestion !== undefined) suggestions.push(explicit_bound_suggestion);
  if (mixed_suggestion !== undefined) suggestions.push(mixed_suggestion);
  if (implicit_suggestion !== undefined) suggestions.push(implicit_suggestion);
  if (explicit_anonymous_suggestion !== undefined) suggestions.push(explicit_anonymous_suggestion);

  cx.emit_span_lint(
    MISMATCHED_LIFETIME_SYNTAXES,
    [...LifetimeSyntaxCategories.iter_unnamed(inputs), ...LifetimeSyntaxCategories.iter_unnamed(outputs)],
    MismatchedLifetimeSyntaxes_diagnostic({ inputs, outputs, suggestions }),
  );
}

// rustc: compiler/rustc_lint/src/lifetime_syntax.rs:471 build_mismatch_suggestion
function build_mismatch_suggestion(lifetime_name_: string, infos: readonly Info[]): MismatchedLifetimeSyntaxesSuggestion {
  const lifetime_name = lifetime_name_;

  const suggestions = build_mismatch_suggestions_for_lifetime(lifetime_name, infos);

  return {
    $: "Explicit",
    lifetime_name,
    suggestions,
    optional_alternative: false,
  };
}

// rustc: compiler/rustc_lint/src/lifetime_syntax.rs:486 build_mismatch_suggestions_for_lifetime
function build_mismatch_suggestions_for_lifetime(lifetime_name: string, infos: readonly Info[]): [Span, string][] {
  // #[derive(Clone, Copy, PartialEq, Eq, Hash)]
  type PathSuggestionKind = "Missing" | "Empty" | "Full";

  const suggestions: [Span, string][] = [];
  // PORT: `FxIndexMap<(hir::HirId, PathSuggestionKind), (Span, usize)>` keyed by the derived `Hash`/`Eq` of the tuple.
  const path_counts = new KeyedMap<[HirId, PathSuggestionKind], [Span, number]>((k) => `${HirId_key(k[0])}:${k[1]}`);

  for (const info of infos) {
    const lifetime = info.lifetime;
    if (lifetime.syntax === "Implicit") {
      if (lifetime.source.$ === "Path") {
        const angle_brackets = lifetime.source.angle_brackets;
        let span: Span;
        let kind: PathSuggestionKind;
        switch (angle_brackets) {
          case "Missing":
            [span, kind] = [Span.shrink_to_hi(lifetime.ident.span), "Missing"];
            break;
          case "Empty":
            [span, kind] = [lifetime.ident.span, "Empty"];
            break;
          case "Full":
            [span, kind] = [lifetime.ident.span, "Full"];
            break;
        }
        // `path_counts.entry((info.ty.hir_id, kind)).or_insert((span, 0))`
        const key: [HirId, PathSuggestionKind] = [info.ty.hir_id, kind];
        let entry = path_counts.get(key);
        if (entry === undefined) {
          entry = [span, 0];
          path_counts.set(key, entry);
        }
        entry[1] += 1;
        continue;
      }
    }
    suggestions.push(info.suggestion(lifetime_name));
  }

  for (const [[_ty_hir_id, kind], [span, count]] of path_counts) {
    const repeated = Array.from({ length: count }, () => lifetime_name).join(", ");

    let suggestion: string;
    switch (kind) {
      case "Missing":
        suggestion = `<${repeated}>`;
        break;
      case "Empty":
        suggestion = repeated;
        break;
      case "Full":
        suggestion = `${repeated}, `;
        break;
    }

    suggestions.push([span, suggestion]);
  }

  return suggestions;
}

// #[derive(Debug)]
class Info {
  constructor(
    public lifetime: Lifetime,
    public syntax_category: LifetimeSyntaxCategory,
    public ty: Ty,
  ) {}

  /// When reporting a lifetime that is implicit, we expand the span
  /// to include the type. Otherwise we end up pointing at nothing,
  /// which is a bit confusing.
  // rustc: compiler/rustc_lint/src/lifetime_syntax.rs:548 reporting_span
  reporting_span(): Span {
    if (this.lifetime.is_implicit()) {
      return this.ty.span;
    } else {
      return this.lifetime.ident.span;
    }
  }

  /// When removing an explicit lifetime from a reference,
  /// we want to remove the whitespace after the lifetime.
  ///
  /// ```rust
  /// fn x(a: &'_ u8) {}
  /// ```
  ///
  /// Should become:
  ///
  /// ```rust
  /// fn x(a: &u8) {}
  /// ```
  // FIXME: Ideally, we'd also remove the lifetime declaration.
  // rustc: compiler/rustc_lint/src/lifetime_syntax.rs:565 removing_span
  removing_span(): Span {
    let span = this.lifetime.ident.span;
    if (this.ty.kind.$ === "Ref") {
      const ty = this.ty.kind._1;
      span = Span.until(span, ty.span);
    }
    return span;
  }

  // rustc: compiler/rustc_lint/src/lifetime_syntax.rs:573 suggestion
  suggestion(lifetime_name: string): [Span, string] {
    return this.lifetime.suggestion(lifetime_name);
  }
}

class LifetimeInfoCollector extends Visitor {
  constructor(
    public info_func: (info: Info) => void,
    public ty: Ty,
  ) {
    super();
  }

  // rustc: compiler/rustc_lint/src/lifetime_syntax.rs:587 collect
  static collect(ty: Ty, info_func: (info: Info) => void): void {
    const this_ = new LifetimeInfoCollector(info_func, ty);

    walk_unambig_ty(this_, ty);
  }

  // impl<'tcx, F> Visitor<'tcx> for LifetimeInfoCollector<'tcx, F>
  // #[instrument(skip(self))]
  // rustc: compiler/rustc_lint/src/lifetime_syntax.rs:599 visit_lifetime
  override visit_lifetime(lifetime: Lifetime): undefined {
    const syntax_category = LifetimeSyntaxCategory.new(lifetime);
    if (syntax_category !== undefined) {
      const info = new Info(lifetime, syntax_category, this.ty);
      this.info_func(info);
    }
    return undefined;
  }

  // #[instrument(skip(self))]
  // rustc: compiler/rustc_lint/src/lifetime_syntax.rs:607 visit_ty
  override visit_ty(ty: Ty<AmbigArg>): undefined {
    const old_ty = this.ty;
    this.ty = ty.as_unambig_ty();
    walk_ty(this, ty);
    this.ty = old_ty;
    return undefined;
  }
}
