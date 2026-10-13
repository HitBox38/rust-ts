// Port of compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs
//
// PORT:
// - `impl AttributeParser { fn unknown_diagnostic_attr }` is an extension method: it is attached to
//   `AttributeParser.prototype` here (PORTING §5 "Methods defined in another file");
//   rustc_attr_parsing/lib.ts imports this module after interface.ts.
// - The `pub(crate) mod <name>;` declarations are not mirrored as re-exports: the submodules import
//   this module (their `use crate::attributes::diagnostic::*`), and context.ts imports each submodule.
// - The private items the submodules reach through `use crate::attributes::diagnostic::*` (`Mode`,
//   `gate_diagnostic_attr`, `parse_list`, `parse_directive_items`, `merge_directives`) are exported.
// - `&mut Option<(Span, T)>` places (`merge_directives`, `merge`) are `MutRef`s (PORTING §8).
import type { PathSegment } from "../../../rustc_ast/lib.ts";
import { diagnostic } from "../../../rustc_attr_ir/lib.ts";
import { LintId, MultiSpan } from "../../../rustc_errors/lib.ts";
import {
  MALFORMED_DIAGNOSTIC_ATTRIBUTES,
  MALFORMED_DIAGNOSTIC_FILTERS,
  MALFORMED_DIAGNOSTIC_FORMAT_LITERALS,
  UNKNOWN_DIAGNOSTIC_ATTRIBUTES,
} from "../../../rustc_lint_defs/builtin.ts";
import {
  type Argument,
  type FormatSpec,
  type ParseError,
  ParseMode,
  Parser,
  type Piece as RpfPiece,
} from "../../../rustc_parse_format/lib.ts";
import { find_best_match_for_name } from "../../../rustc_span/edit_distance.ts";
import { InnerSpan, Span } from "../../../rustc_span/lib.ts";
import { type Ident, kw, Symbol, sym } from "../../../rustc_span/symbol.ts";
import { type MutRef, field_mut } from "../../../std/mut_ref.ts";
import { Err, Ok, ok, type Result } from "../../../std/result.ts";
import { Str } from "../../../std/str.ts";
import type { AcceptContext } from "../../context.ts";
import {
  type FormatWarning,
  FormatWarning_diagnostic,
  IgnoredDiagnosticOption_diagnostic,
  type InvalidOnClause,
  InvalidOnClause_diagnostic,
  MalFormedDiagnosticAttributeLint_diagnostic,
  MissingOptionsForDiagnosticAttribute_diagnostic,
  NonMetaItemDiagnosticAttribute_diagnostic,
  UnknownDiagnosticAttribute_into_diag,
  type UnknownDiagnosticAttributeTypo,
  UnstableDiagnosticAttribute_diagnostic,
  WrappedParserError_diagnostic,
} from "../../diagnostics.ts";
import { AttributeParser, EmitAttribute, type EmitLintFn } from "../../interface.ts";
import { ArgParser, type MetaItemListParser, MetaItemOrLitParser, type MetaItemParser } from "../../parser.ts";

type Directive = diagnostic.Directive;
const Directive = diagnostic.Directive;
type Filter = diagnostic.Filter;
const Filter = diagnostic.Filter;
type FilterFormatString = diagnostic.FilterFormatString;
const FilterFormatString = diagnostic.FilterFormatString;
type Flag = diagnostic.Flag;
const Flag = diagnostic.Flag;
type FormatArg = diagnostic.FormatArg;
const FormatArg = diagnostic.FormatArg;
type FormatString = diagnostic.FormatString;
const FormatString = diagnostic.FormatString;
type LitOrArg = diagnostic.LitOrArg;
type Name = diagnostic.Name;
const Name = diagnostic.Name;
type NameValue = diagnostic.NameValue;
const NameValue = diagnostic.NameValue;
type Piece = diagnostic.Piece;
type Predicate = diagnostic.Predicate;

declare module "../../interface.ts" {
  interface AttributeParser {
    unknown_diagnostic_attr(segment: PathSegment, emit_lint: EmitLintFn): void;
  }
}

// rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs:39 unknown_diagnostic_attr
AttributeParser.prototype.unknown_diagnostic_attr = function (
  this: AttributeParser,
  segment: PathSegment,
  emit_lint: EmitLintFn,
): void {
  const DIAGNOSTIC_ATTRIBUTES: readonly (readonly [
    Symbol /* name */,
    Symbol | undefined /* feature gate */,
  ])[] = [
    [sym.on_unimplemented, undefined],
    [sym.do_not_recommend, undefined],
    [sym.on_move, sym.diagnostic_on_move],
    [sym.on_const, sym.diagnostic_on_const],
    [sym.on_unknown, sym.diagnostic_on_unknown],
    [sym.on_unmatched_args, sym.diagnostic_on_unmatched_args],
    [sym.on_type_error, sym.diagnostic_on_type_error],
    [sym.opaque, sym.diagnostic_opaque],
  ];
  // No need to emit a lint if features aren't available.
  const features = this.features_;
  if (features === undefined) return;
  const span = segment.span();
  const candidates: Symbol[] = [];
  for (const [attr, feature] of DIAGNOSTIC_ATTRIBUTES) {
    if (feature === undefined || features.enabled(feature)) candidates.push(attr);
  }

  const typo_name = find_best_match_for_name(candidates, segment.ident.name, undefined);
  const typo: UnknownDiagnosticAttributeTypo | undefined = typo_name === undefined ? undefined : { span, typo_name };
  emit_lint(
    LintId.of(UNKNOWN_DIAGNOSTIC_ATTRIBUTES),
    MultiSpan.from_Span(span),
    new EmitAttribute((dcx, level, _) => {
      return UnknownDiagnosticAttribute_into_diag({ typo }, dcx, level);
    }),
  );
};

/** The `$feature` idents `gate_diagnostic_attr!` is invoked with (a `Features` accessor and a `sym::`). */
export type DiagnosticAttrFeature =
  | "diagnostic_on_const"
  | "diagnostic_on_move"
  | "diagnostic_on_type_error"
  | "diagnostic_on_unknown"
  | "diagnostic_on_unmatched_args"
  | "diagnostic_opaque";

// #[rustc_macro_transparency = "transparent"]
// PORT: `macro gate_diagnostic_attr($feature:ident)` is a helper fn over the invoking accept
// closure's `cx` / `args`; `$feature` is the feature name, used both as the `Features` accessor
// (`features.$feature()`) and as `sym::$feature`. It returns `true` where the macro `return`s from
// the invoking closure, so callers write `if (gate_diagnostic_attr(cx, args, "x")) return;`.
export function gate_diagnostic_attr(cx: AcceptContext, args: ArgParser, feature: DiagnosticAttrFeature): boolean {
  const features = cx.shared.cx.features_option();
  if (features !== undefined && !features[feature]()) {
    ArgParser.ignore_args(args);
    const nightly_build = cx.shared.cx.sess().is_nightly_build();
    const span = cx.attr_span;
    cx.shared.emit_lint(
      UNKNOWN_DIAGNOSTIC_ATTRIBUTES,
      UnstableDiagnosticAttribute_diagnostic({
        feature: sym[feature],
        nightly_build,
      }),
      span,
    );
    return true;
  }
  return false;
}

/** `#[derive(Copy, Clone)] pub(crate) enum Mode` */
export type Mode =
  /// `#[rustc_on_unimplemented]`
  | "RustcOnUnimplemented"
  /// `#[diagnostic::on_unimplemented]`
  | "DiagnosticOnUnimplemented"
  /// `#[diagnostic::on_const]`
  | "DiagnosticOnConst"
  /// `#[diagnostic::on_move]`
  | "DiagnosticOnMove"
  /// `#[diagnostic::on_unknown]`
  | "DiagnosticOnUnknown"
  /// `#[diagnostic::on_unmatched_args]`
  | "DiagnosticOnUnmatchedArgs"
  /// `#[diagnostic::on_type_error]`
  | "DiagnosticOnTypeError";

export const Mode = {
  RustcOnUnimplemented: "RustcOnUnimplemented",
  DiagnosticOnUnimplemented: "DiagnosticOnUnimplemented",
  DiagnosticOnConst: "DiagnosticOnConst",
  DiagnosticOnMove: "DiagnosticOnMove",
  DiagnosticOnUnknown: "DiagnosticOnUnknown",
  DiagnosticOnUnmatchedArgs: "DiagnosticOnUnmatchedArgs",
  DiagnosticOnTypeError: "DiagnosticOnTypeError",

  // rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs:118 as_str
  as_str(self: Mode): string {
    switch (self) {
      case "RustcOnUnimplemented":
        return "rustc_on_unimplemented";
      case "DiagnosticOnUnimplemented":
        return "diagnostic::on_unimplemented";
      case "DiagnosticOnConst":
        return "diagnostic::on_const";
      case "DiagnosticOnMove":
        return "diagnostic::on_move";
      case "DiagnosticOnUnknown":
        return "diagnostic::on_unknown";
      case "DiagnosticOnUnmatchedArgs":
        return "diagnostic::on_unmatched_args";
      case "DiagnosticOnTypeError":
        return "diagnostic::on_type_error";
    }
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs:130 expected_options
  expected_options(self: Mode): string {
    const DEFAULT = "at least one of the `message`, `note` and `label` options are expected";
    const DIAGNOSTIC_ON_TYPE_ERROR_EXPECTED_OPTIONS = "at least a single `note` option is expected";
    switch (self) {
      case "RustcOnUnimplemented": {
        return "see <https://rustc-dev-guide.rust-lang.org/diagnostics.html#rustc_on_unimplemented>";
      }
      case "DiagnosticOnUnimplemented":
      case "DiagnosticOnConst":
      case "DiagnosticOnMove":
      case "DiagnosticOnUnknown":
      case "DiagnosticOnUnmatchedArgs":
        return DEFAULT;
      case "DiagnosticOnTypeError":
        return DIAGNOSTIC_ON_TYPE_ERROR_EXPECTED_OPTIONS;
    }
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs:148 allowed_options
  allowed_options(self: Mode): string {
    const DEFAULT = "only `message`, `note` and `label` are allowed as options";
    const DIAGNOSTIC_ON_TYPE_ERROR_ALLOWED_OPTIONS = "only `note` is allowed as option for `diagnostic::on_type_error`";
    switch (self) {
      case "RustcOnUnimplemented": {
        return "see <https://rustc-dev-guide.rust-lang.org/diagnostics.html#rustc_on_unimplemented>";
      }
      case "DiagnosticOnUnimplemented":
      case "DiagnosticOnConst":
      case "DiagnosticOnMove":
      case "DiagnosticOnUnknown":
      case "DiagnosticOnUnmatchedArgs":
        return DEFAULT;
      case "DiagnosticOnTypeError":
        return DIAGNOSTIC_ON_TYPE_ERROR_ALLOWED_OPTIONS;
    }
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs:165 allowed_format_arguments
  allowed_format_arguments(self: Mode): string {
    switch (self) {
      case "RustcOnUnimplemented": {
        return "see <https://rustc-dev-guide.rust-lang.org/diagnostics.html#rustc_on_unimplemented> for allowed format arguments";
      }
      case "DiagnosticOnUnimplemented": {
        return "only `Self` and generics of the trait are allowed as a format argument";
      }
      case "DiagnosticOnConst": {
        return "only `Self` and generics of the implementation are allowed as a format argument";
      }
      case "DiagnosticOnMove": {
        return "only `This`, `Self` and generics of the type are allowed as a format argument";
      }
      case "DiagnosticOnUnknown": {
        return "only `This` is allowed as a format argument, referring to the failed import";
      }
      case "DiagnosticOnUnmatchedArgs": {
        return "only `This` is allowed as a format argument, referring to the macro's name";
      }
      case "DiagnosticOnTypeError": {
        return "only `note` is allowed as option for `diagnostic::on_type_error`";
      }
    }
  },
} as const;

// rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs:192 merge_directives
export function merge_directives(
  cx: AcceptContext,
  first: MutRef<[Span, Directive] | undefined>,
  later: [Span, Directive],
): void {
  if (first.value !== undefined) {
    const first_ = first.value[1];
    const { is_rustc_attr, filters, message, label, notes, parent_label } = later[1];

    first_.is_rustc_attr ||= is_rustc_attr;
    first_.filters.push(...filters);
    merge(cx, field_mut(first_, "message"), message, sym.message);
    merge(cx, field_mut(first_, "label"), label, sym.label);
    first_.notes.push(...notes);
    merge(cx, field_mut(first_, "parent_label"), parent_label, sym.parent_label);
  } else {
    first.value = later;
  }
}

// rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs:211 merge
function merge<T>(
  cx: AcceptContext,
  first: MutRef<[Span, T] | undefined>,
  later: [Span, T] | undefined,
  option_name: Symbol,
): void {
  if (later === undefined) {
    // (Some(_) | None, None) => {}
  } else if (first.value !== undefined) {
    const first_span = first.value[0];
    const later_span = later[0];
    cx.shared.emit_lint(
      MALFORMED_DIAGNOSTIC_ATTRIBUTES,
      IgnoredDiagnosticOption_diagnostic({ first_span, later_span, option_name }),
      later_span,
    );
  } else {
    // `first.get_or_insert(later)`
    first.value = later;
  }
}

// rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs:233 parse_list
export function parse_list(cx: AcceptContext, args: ArgParser, mode: Mode): MetaItemListParser | undefined {
  const span = cx.attr_span;
  switch (args.$) {
    case "List": {
      const items = args._0;
      if (items.len() !== 0) return items;
      const list = args._0;
      // We're dealing with `#[diagnostic::attr()]`.
      // This can be because that is what the user typed, but that's also what we'd see
      // if the user used non-metaitem syntax. See `ArgParser::from_attr_args`.
      cx.shared.emit_lint(MALFORMED_DIAGNOSTIC_ATTRIBUTES, NonMetaItemDiagnosticAttribute_diagnostic({}), list.span);
      break;
    }
    case "NoArgs": {
      cx.shared.emit_lint(
        MALFORMED_DIAGNOSTIC_ATTRIBUTES,
        MissingOptionsForDiagnosticAttribute_diagnostic({
          attribute: Mode.as_str(mode),
          options: Mode.expected_options(mode),
        }),
        span,
      );
      break;
    }
    case "NameValue": {
      cx.shared.emit_lint(
        MALFORMED_DIAGNOSTIC_ATTRIBUTES,
        MalFormedDiagnosticAttributeLint_diagnostic({
          attribute: Mode.as_str(mode),
          options: Mode.allowed_options(mode),
          span,
        }),
        span,
      );
      break;
    }
  }
  return undefined;
}

// rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs:276 parse_directive_items
export function parse_directive_items(
  cx: AcceptContext,
  mode: Mode,
  items: Iterable<MetaItemOrLitParser>,
  is_root: boolean,
): Directive | undefined {
  let message: [Span, FormatString] | undefined = undefined;
  let label: [Span, FormatString] | undefined = undefined;
  const notes: FormatString[] = [];
  let parent_label: [Span, FormatString] | undefined = undefined;
  const filters: [Filter, Directive][] = [];

  // PORT: the item-local macros `malformed!` / `or_malformed!` / `duplicate!` -> the closures
  // `malformed()` / `duplicate(..)`; `malformed!()`'s `continue` and `or_malformed!(x?)`'s
  // `let Some(ret) = try { x? } else { malformed!() }` are written out at each use as
  // `if (x === undefined) { malformed(); continue; }`.
  for (const item_ of items) {
    const span = MetaItemOrLitParser.span(item_);

    const malformed = (): void => {
      cx.shared.emit_lint(
        MALFORMED_DIAGNOSTIC_ATTRIBUTES,
        MalFormedDiagnosticAttributeLint_diagnostic({
          attribute: Mode.as_str(mode),
          options: Mode.allowed_options(mode),
          span,
        }),
        span,
      );
    };

    const duplicate = (name: Symbol, first_span: Span): void => {
      cx.shared.emit_lint(
        MALFORMED_DIAGNOSTIC_ATTRIBUTES,
        IgnoredDiagnosticOption_diagnostic({
          first_span,
          later_span: span,
          option_name: name,
        }),
        span,
      );
    };

    const item: MetaItemParser | undefined = MetaItemOrLitParser.meta_item(item_);
    if (item === undefined) {
      malformed();
      continue;
    }
    const ident = item.ident();
    if (ident === undefined) {
      malformed();
      continue;
    }
    const name = ident.name;

    // Currently, as of April 2026, all arguments of all diagnostic attrs
    // must have a value, like `message = "message"`. Thus in a well-formed
    // diagnostic attribute this is never `None`.
    //
    // But we don't assert its presence yet because we don't want to mention it
    // if someone does something like `#[diagnostic::on_unimplemented(doesnt_exist)]`.
    // That happens in the big `match` below.
    let value: Ident | undefined;
    const nv = ArgParser.as_name_value(item.args());
    if (nv !== undefined) {
      const v = nv.value_as_ident();
      if (v === undefined) {
        malformed();
        continue;
      }
      value = v;
    } else {
      value = undefined;
    }

    const parse_format = (input: Ident): FormatString => {
      const snippet = ok(cx.shared.cx.sess().source_map().span_to_snippet(input.span));
      const is_snippet = snippet !== undefined;
      const r = parse_format_string(input.name, snippet, input.span, mode);
      switch (r.$) {
        case "Ok": {
          const [f, warnings] = r._0;
          for (const warning of warnings) {
            // `let (FormatWarning::InvalidSpecifier { span } | .. ) = warning;`: every variant has `span`.
            const span = warning.span;
            cx.shared.emit_lint(MALFORMED_DIAGNOSTIC_FORMAT_LITERALS, FormatWarning_diagnostic(warning), span);
          }

          return f;
        }
        case "Err": {
          const e = r._0;
          cx.shared.emit_lint(
            MALFORMED_DIAGNOSTIC_FORMAT_LITERALS,
            WrappedParserError_diagnostic({
              description: e.description,
              label: e.label,
              span: slice_span(input.span, e.span, is_snippet),
            }),
            input.span,
          );
          // We could not parse the input, just use it as-is.
          return new FormatString(input.name, input.span, [{ $: "Lit", _0: input.name }]);
        }
      }
    };
    if (
      (mode === "RustcOnUnimplemented" ||
        mode === "DiagnosticOnUnimplemented" ||
        mode === "DiagnosticOnConst" ||
        mode === "DiagnosticOnMove" ||
        mode === "DiagnosticOnUnknown" ||
        mode === "DiagnosticOnUnmatchedArgs") &&
      name === sym.message
    ) {
      if (value === undefined) {
        malformed();
        continue;
      }
      if (message !== undefined) {
        duplicate(name, message[0]);
      } else {
        message = [item.span(), parse_format(value)];
      }
    } else if (
      (mode === "RustcOnUnimplemented" ||
        mode === "DiagnosticOnUnimplemented" ||
        mode === "DiagnosticOnConst" ||
        mode === "DiagnosticOnMove" ||
        mode === "DiagnosticOnUnknown" ||
        mode === "DiagnosticOnUnmatchedArgs") &&
      name === sym.label
    ) {
      if (value === undefined) {
        malformed();
        continue;
      }
      if (label !== undefined) {
        duplicate(name, label[0]);
      } else {
        label = [item.span(), parse_format(value)];
      }
    } else if (name === sym.note) {
      if (value === undefined) {
        malformed();
        continue;
      }
      notes.push(parse_format(value));
    } else if (mode === "RustcOnUnimplemented" && name === sym.parent_label) {
      if (value === undefined) {
        malformed();
        continue;
      }
      if (parent_label !== undefined) {
        duplicate(name, parent_label[0]);
      } else {
        const format = parse_format(value);
        parent_label = [format.span, format];
      }
    } else if (mode === "RustcOnUnimplemented" && name === sym.on) {
      if (is_root) {
        const items = ArgParser.as_list(item.args());
        if (items === undefined) {
          malformed();
          continue;
        }
        const iter = items.mixed();
        const c = iter.next();
        let filter_: MetaItemOrLitParser;
        if (!c.done) {
          filter_ = c.value;
        } else {
          cx.shared.emit_lint(MALFORMED_DIAGNOSTIC_FILTERS, InvalidOnClause_diagnostic({ $: "Empty", span }), span);
          continue;
        }

        const filter = parse_filter(filter_);

        if (items.len() < 2) {
          // Something like `#[rustc_on_unimplemented(on(.., /* nothing */))]`
          // There's a filter but no directive behind it, this is a mistake.
          malformed();
          continue;
        }

        switch (filter.$) {
          case "Ok": {
            const directive = parse_directive_items(cx, mode, iter, false);
            if (directive === undefined) {
              malformed();
              continue;
            }
            filters.push([filter._0, directive]);
            break;
          }
          case "Err": {
            const e = filter._0;
            cx.shared.emit_lint(MALFORMED_DIAGNOSTIC_FILTERS, InvalidOnClause_diagnostic(e), span);
            break;
          }
        }
      } else {
        malformed();
        continue;
      }
    } else {
      // _other
      malformed();
      continue;
    }
  }

  return new Directive(
    mode === "RustcOnUnimplemented",
    filters,
    message,
    label,
    notes,
    parent_label,
  );
}

// rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs:476 parse_format_string
export function parse_format_string(
  input: Symbol,
  snippet: Str | undefined,
  span: Span,
  mode: Mode,
): Result<[FormatString, FormatWarning[]], ParseError> {
  const s = Str.from(Symbol.as_str(input));
  const parser = Parser.new(s, undefined, snippet, false, ParseMode.Diagnostic);
  const pieces_: RpfPiece[] = parser.collect();

  const err = parser.errors[0];
  if (err !== undefined) {
    return Err(err);
  }
  const warnings: FormatWarning[] = [];

  const pieces: Piece[] = pieces_.map((piece): Piece => {
    switch (piece.$) {
      case "Lit":
        return { $: "Lit", _0: Symbol.intern(piece._0) };
      case "NextArgument":
        return { $: "Arg", _0: parse_arg(piece._0, mode, warnings, span, parser.is_source_literal) };
    }
  });

  return Ok([new FormatString(input, span, pieces), warnings]);
}

// rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs:504 parse_arg
function parse_arg(
  arg: Argument,
  mode: Mode,
  warnings: FormatWarning[],
  input_span: Span,
  is_source_literal: boolean,
): FormatArg {
  const span = slice_span(input_span, arg.position_span, is_source_literal);

  let check_format = true;

  let ret: FormatArg;
  switch (arg.position.$) {
    // Something like "hello {name}"
    case "ArgumentNamed": {
      const name = Symbol.intern(arg.position._0);
      if (mode === "RustcOnUnimplemented" && name === sym.ItemContext) {
        ret = FormatArg.ItemContext;
      }
      // `{This:ty}`
      else if (mode === "RustcOnUnimplemented" && name === sym.This) {
        switch (arg.format.ty) {
          case "resolved": {
            check_format = false;
            ret = FormatArg.ThisResolved;
            break;
          }
          case "path": {
            check_format = false;
            ret = FormatArg.ThisPath;
            break;
          }
          default:
            ret = FormatArg.This;
        }
      } else if (mode === "DiagnosticOnTypeError" && name === sym.Found) {
        ret = FormatArg.Found;
      } else if (mode === "DiagnosticOnTypeError" && name === sym.Expected) {
        ret = FormatArg.Expected;
      } else if (mode === "DiagnosticOnUnknown" && name === sym.Unresolved) {
        ret = FormatArg.Unresolved;
      }
      // Some diagnostic attributes can use `{This}` to refer to the annotated item.
      // For those that don't, we continue and maybe use it as a generic parameter.
      //
      // FIXME(mejrs) `DiagnosticOnUnimplemented` is intentionally not here;
      // that requires lang approval which is best kept for a standalone PR.
      else if (
        (mode === "DiagnosticOnUnknown" ||
          mode === "DiagnosticOnMove" ||
          mode === "DiagnosticOnUnmatchedArgs" ||
          mode === "DiagnosticOnTypeError") &&
        name === sym.This
      ) {
        ret = FormatArg.This;
      }
      // `{Self}`; the self type.
      // - For trait declaration attributes that's the type that does not implement it.
      // - for trait impl attributes, the implemented for type.
      // - For ADT attributes, that's the type (which will be identical to `{This}`)
      // - For everything else it doesn't make sense.
      else if (
        (mode === "RustcOnUnimplemented" ||
          mode === "DiagnosticOnUnimplemented" ||
          mode === "DiagnosticOnMove" ||
          mode === "DiagnosticOnConst") &&
        name === kw.SelfUpper
      ) {
        ret = FormatArg.SelfUpper;
      }
      // Generic parameters.
      // FIXME(mejrs) unfortunately, all the "special" symbols above might fall through,
      // but at this time we are not aware of what generic parameters the trait actually has.
      // If we find `ItemContext` or something we have to assume that's a generic parameter.
      // We lint against that in `check_attr.rs` though.
      else if (
        mode === "RustcOnUnimplemented" ||
        mode === "DiagnosticOnUnimplemented" ||
        mode === "DiagnosticOnMove" ||
        mode === "DiagnosticOnConst" ||
        mode === "DiagnosticOnTypeError"
      ) {
        const generic_param = name;
        ret = { $: "GenericParam", generic_param, span };
      }
      // Generics are explicitly not allowed, we print those back as is.
      else {
        // (Mode::DiagnosticOnUnknown | Mode::DiagnosticOnUnmatchedArgs, as_is)
        const as_is = name;
        warnings.push({
          $: "DisallowedPlaceholder",
          span,
          attr: Mode.as_str(mode),
          allowed: Mode.allowed_format_arguments(mode),
        });
        ret = { $: "AsIs", _0: Symbol.intern(`{${Symbol.as_str(as_is)}}`) };
      }
      break;
    }

    // `{1}` and `{}` are ignored
    case "ArgumentIs": {
      const idx = arg.position._0;
      warnings.push({ $: "IndexedArgument", span });
      ret = { $: "AsIs", _0: Symbol.intern(`{${idx}}`) };
      break;
    }
    case "ArgumentImplicitlyIs": {
      warnings.push({ $: "PositionalArgument", span });
      ret = { $: "AsIs", _0: sym.empty_braces };
      break;
    }
  }
  if (check_format) {
    warn_on_format_spec(arg.format, warnings, input_span, is_source_literal);
  }
  return ret;
}

/// `#[rustc_on_unimplemented]` and `#[diagnostic::...]` don't actually do anything
/// with specifiers, so emit a warning if they are used.
// rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs:606 warn_on_format_spec
function warn_on_format_spec(
  spec: FormatSpec,
  warnings: FormatWarning[],
  input_span: Span,
  is_source_literal: boolean,
): void {
  const ty_span = spec.ty_span;
  if (ty_span !== undefined) {
    const span = slice_span(input_span, ty_span, is_source_literal);
    warnings.push({ $: "InvalidSpecifier", span });
  }
}

// rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs:618 slice_span
function slice_span(input: Span, { start, end }: { start: number; end: number }, is_source_literal: boolean): Span {
  if (is_source_literal) {
    return Span.from_inner(input, new InnerSpan(start, end));
  } else {
    return input;
  }
}

// rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs:622 parse_filter
export function parse_filter(input: MetaItemOrLitParser): Result<Filter, InvalidOnClause> {
  const span = MetaItemOrLitParser.span(input);
  const pred = parse_predicate(input);
  if (pred.$ === "Err") return pred;
  return Ok(new Filter(span, pred._0));
}

// rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs:628 parse_predicate
function parse_predicate(input: MetaItemOrLitParser): Result<Predicate, InvalidOnClause> {
  const meta_item = MetaItemOrLitParser.meta_item(input);
  if (meta_item === undefined) {
    return Err({ $: "UnsupportedLiteral", span: MetaItemOrLitParser.span(input) });
  }

  const predicate = meta_item.ident();
  if (predicate === undefined) {
    return Err({
      $: "ExpectedIdentifier",
      span: meta_item.path().span(),
      path: meta_item.path().get_attribute_path(),
    });
  }

  const args = meta_item.args();
  switch (args.$) {
    case "List": {
      const mis = args._0;
      switch (predicate.name) {
        case sym.any: {
          const seq = parse_predicate_sequence(mis);
          if (seq.$ === "Err") return seq;
          return Ok({ $: "Any", _0: seq._0 });
        }
        case sym.all: {
          const seq = parse_predicate_sequence(mis);
          if (seq.$ === "Err") return seq;
          return Ok({ $: "All", _0: seq._0 });
        }
        case sym.not: {
          const single = mis.as_single();
          if (single !== undefined) {
            const pred = parse_predicate(single);
            if (pred.$ === "Err") return pred;
            return Ok({ $: "Not", _0: pred._0 });
          } else {
            return Err({ $: "ExpectedOnePredInNot", span: mis.span });
          }
        }
        default: {
          const invalid_pred = predicate.name;
          return Err({ $: "InvalidPredicate", span: predicate.span, invalid_pred });
        }
      }
    }
    case "NameValue": {
      const p = args._0;
      const value = p.value_as_ident();
      if (value === undefined) {
        return Err({ $: "UnsupportedLiteral", span: p.args_span() });
      }
      const name = parse_name(predicate.name);
      const value_ = parse_filter_format(value.name);
      const kv = new NameValue(name, value_);
      return Ok({ $: "Match", _0: kv });
    }
    case "NoArgs": {
      const flag = parse_flag(predicate);
      if (flag.$ === "Err") return flag;
      return Ok({ $: "Flag", _0: flag._0 });
    }
  }
}

// rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs:671 parse_predicate_sequence
function parse_predicate_sequence(sequence: MetaItemListParser): Result<Predicate[], InvalidOnClause> {
  // `sequence.mixed().map(parse_predicate).collect()` (stops at the first `Err`)
  const out: Predicate[] = [];
  for (const mi of sequence.mixed()) {
    const pred = parse_predicate(mi);
    if (pred.$ === "Err") return pred;
    out.push(pred._0);
  }
  return Ok(out);
}

// rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs:677 parse_flag
function parse_flag({ name, span }: Ident): Result<Flag, InvalidOnClause> {
  switch (name) {
    case sym.crate_local:
      return Ok(Flag.CrateLocal);
    case sym.direct:
      return Ok(Flag.Direct);
    case sym.from_desugaring:
      return Ok(Flag.FromDesugaring);
    default: {
      const invalid_flag = name;
      return Err({ $: "InvalidFlag", invalid_flag, span });
    }
  }
}

// rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs:686 parse_name
function parse_name(name: Symbol): Name {
  switch (name) {
    case kw.SelfUpper:
      return Name.SelfUpper;
    case sym.from_desugaring:
      return Name.FromDesugaring;
    case sym.cause:
      return Name.Cause;
    default: {
      const generic = name;
      return { $: "GenericArg", _0: generic };
    }
  }
}

// rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs:695 parse_filter_format
function parse_filter_format(input: Symbol): FilterFormatString {
  const parser = Parser.new(Str.from(Symbol.as_str(input)), undefined, undefined, false, ParseMode.Diagnostic);
  const pieces: LitOrArg[] = [];
  for (let p = parser.next(); p !== undefined; p = parser.next()) {
    let piece: LitOrArg;
    switch (p.$) {
      case "Lit":
        piece = { $: "Lit", _0: Symbol.intern(p._0) };
        break;
      // We just ignore formatspecs here
      case "NextArgument": {
        const a = p._0;
        const position = a.position;
        switch (position.$) {
          // In `TypeErrCtxt::on_unimplemented_note` we substitute `"{integral}"` even
          // if the integer type has been resolved, to allow targeting all integers.
          // `"{integer}"` and `"{float}"` come from numerics that haven't been inferred yet,
          // from the `Display` impl of `InferTy` to be precise.
          // `"{union|enum|struct}"` is used as a special selector for ADTs.
          //
          // Don't try to format these later!
          case "ArgumentNamed": {
            const arg = position._0;
            if (
              arg === "integer" ||
              arg === "integral" ||
              arg === "float" ||
              arg === "union" ||
              arg === "enum" ||
              arg === "struct"
            ) {
              piece = { $: "Lit", _0: Symbol.intern(`{${arg}}`) };
            } else {
              piece = { $: "Arg", _0: Symbol.intern(arg) };
            }
            break;
          }
          case "ArgumentImplicitlyIs":
            piece = { $: "Lit", _0: sym.empty_braces };
            break;
          case "ArgumentIs": {
            const idx = position._0;
            piece = { $: "Lit", _0: Symbol.intern(`{${idx}}`) };
            break;
          }
        }
        break;
      }
    }
    pieces.push(piece);
  }
  return new FilterFormatString(pieces);
}
