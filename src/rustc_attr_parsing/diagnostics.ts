// Port of compiler/rustc_attr_parsing/src/diagnostics.rs.
// The types and every `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` impl (`<T>_into_diag` +
// `<T>_diagnostic`, `<T>_add_to_diag` + `<T>_subdiagnostic`) are generated into diagnostics.gen.ts by
// tools/codegen/types.ts (set `rustc_attr_parsing`). This module holds the hand-written fns of the file.
// The inline modules `unexpected_cfg_name` / `unexpected_cfg_value` are generated as namespaces.
//
// PORT: same conventions as src/rustc_parse/diagnostics.ts: inherent fns of generated types live on a
// companion const defined here (`IllFormedAttributeInput.new(..)`); `impl Diagnostic for T` ->
// `T_into_diag(self, dcx, level)` + `T_diagnostic(self)`.
import { display_AttrPath } from "../rustc_attr_ir/lib.ts";
import { type DiagArgValue, type PathBuf } from "../rustc_error_messages/lib.ts";
import { Diag, type DiagCtxtHandle, type Diagnostic, E0538, E0539, E0565, E0805, type Level } from "../rustc_errors/lib.ts";
import { type DiagSymbolList, DiagSymbolList_into_diag_arg } from "../rustc_errors/diagnostic_impls.ts";
import { Applicability } from "../rustc_lint_defs/lib.ts";
import type { IntErrorKind } from "../rustc_session/options.ts";
import type { MutRef } from "../rustc_span/hygiene.ts";
import type { Span } from "../rustc_span/lib.ts";
import { display_Symbol, type Symbol } from "../rustc_span/symbol.ts";
import type * as gen from "./diagnostics.gen.ts";

export * from "./diagnostics.gen.ts";

/**
 * PORT: `impl<S: Display> IntoDiagArg for DiagSymbolList<S>` (rustc_errors/src/diagnostic_impls.rs) as a
 * `(self, path) => DiagArgValue` fn for the generated derives (diag_args.json `$display0`): binds `S`'s Display.
 */
export function DiagSymbolList_into_diag_arg_with<S>(display: (s: S) => string): (self: DiagSymbolList<S>, path: MutRef<PathBuf | undefined>) => DiagArgValue {
  return (self, path) => DiagSymbolList_into_diag_arg(self, path, display);
}

export type IllFormedAttributeInput = gen.IllFormedAttributeInput;
export const IllFormedAttributeInput = {
  // rustc: compiler/rustc_attr_parsing/src/diagnostics.rs:141 new
  new(suggestions: readonly string[], docs: string | undefined, help: string | undefined): IllFormedAttributeInput {
    return {
      num_suggestions: suggestions.length,
      suggestions: { $: "StrListSepByAnd", _0: suggestions.map((s) => `\`${s}\``) } satisfies DiagArgValue,
      has_docs: docs !== undefined,
      docs: docs ?? "",
      help: help === undefined ? undefined : { lint: help },
    };
  },
};

export type UnexpectedCfgCargoHelp = gen.UnexpectedCfgCargoHelp;
export const UnexpectedCfgCargoHelp = {
  // rustc: compiler/rustc_attr_parsing/src/diagnostics.rs:485 cargo_toml_lint_cfg
  cargo_toml_lint_cfg(unescaped: string): string {
    return `\n [lints.rust]\n unexpected_cfgs = { level = "warn", check-cfg = ['${unescaped}'] }`;
  },

  // rustc: compiler/rustc_attr_parsing/src/diagnostics.rs:491 lint_cfg
  lint_cfg(unescaped: string): UnexpectedCfgCargoHelp {
    return {
      $: "LintCfg",
      cargo_toml_lint_cfg: UnexpectedCfgCargoHelp.cargo_toml_lint_cfg(unescaped),
    };
  },

  // rustc: compiler/rustc_attr_parsing/src/diagnostics.rs:497 lint_cfg_and_build_rs
  lint_cfg_and_build_rs(unescaped: string, escaped: string): UnexpectedCfgCargoHelp {
    return {
      $: "LintCfgAndBuildRs",
      cargo_toml_lint_cfg: UnexpectedCfgCargoHelp.cargo_toml_lint_cfg(unescaped),
      build_rs_println: `println!("cargo::rustc-check-cfg=${escaped}");`,
    };
  },
};

export type UnexpectedCfgRustcHelp = gen.UnexpectedCfgRustcHelp;
export const UnexpectedCfgRustcHelp = {
  // rustc: compiler/rustc_attr_parsing/src/diagnostics.rs:512 new
  new(unescaped: string): UnexpectedCfgRustcHelp {
    return { cmdline_arg: `--check-cfg=${unescaped}` };
  },
};

export type InvalidIssueStringCause = gen.InvalidIssueStringCause;
export const InvalidIssueStringCause = {
  // rustc: compiler/rustc_attr_parsing/src/diagnostics.rs:1153 from_int_error_kind
  from_int_error_kind(span: Span, kind: IntErrorKind): InvalidIssueStringCause | undefined {
    switch (kind) {
      case "Empty":
        return { $: "Empty", span };
      case "InvalidDigit":
        return { $: "InvalidDigit", span };
      case "PosOverflow":
        return { $: "PosOverflow", span };
      case "NegOverflow":
        return { $: "NegOverflow", span };
      case "Zero":
        return { $: "MustNotBeZero", span };
      default:
        return undefined;
    }
  },
};

export type AttributeParseError = gen.AttributeParseError;
export const AttributeParseError = {
  // rustc: compiler/rustc_attr_parsing/src/diagnostics.rs:1541 render_expected_specific_argument
  render_expected_specific_argument(self: AttributeParseError, diag: Diag, possibilities: readonly Symbol[], strings: boolean): void {
    const quote = strings ? '"' : "`";
    if (possibilities.length === 0) {
    } else if (possibilities.length === 1) {
      const x = possibilities[0]!;
      diag.span_label(self.span, `the only valid argument here is ${quote}${display_Symbol(x)}${quote}`);
    } else if (possibilities.length === 2) {
      const [first, second] = possibilities as [Symbol, Symbol];
      diag.span_label(self.span, `valid arguments are ${quote}${display_Symbol(first)}${quote} or ${quote}${display_Symbol(second)}${quote}`);
    } else {
      const first = possibilities.slice(0, -2);
      const second_to_last = possibilities[possibilities.length - 2]!;
      const last = possibilities[possibilities.length - 1]!;
      let res = "";
      for (const i of first) {
        res += `${quote}${display_Symbol(i)}${quote}, `;
      }
      res += `${quote}${display_Symbol(second_to_last)}${quote} or ${quote}${display_Symbol(last)}${quote}`;

      diag.span_label(self.span, `valid arguments are ${res}`);
    }
  },

  // rustc: compiler/rustc_attr_parsing/src/diagnostics.rs:1574 render_expected_specific_argument_list
  render_expected_specific_argument_list(self: AttributeParseError, diag: Diag, possibilities: readonly Symbol[], strings: boolean): void {
    const description = AttributeParseError.description(self);

    const quote = strings ? '"' : "`";
    if (possibilities.length === 0) {
    } else if (possibilities.length === 1) {
      const x = possibilities[0]!;
      diag.span_label(self.span, `this ${description} is only valid with ${quote}${display_Symbol(x)}${quote} as an argument`);
    } else if (possibilities.length === 2) {
      const [first, second] = possibilities as [Symbol, Symbol];
      diag.span_label(
        self.span,
        `this ${description} is only valid with either ${quote}${display_Symbol(first)}${quote} or ${quote}${display_Symbol(second)}${quote} as an argument`,
      );
    } else {
      const first = possibilities.slice(0, -2);
      const second_to_last = possibilities[possibilities.length - 2]!;
      const last = possibilities[possibilities.length - 1]!;
      let res = "";
      for (const i of first) {
        res += `${quote}${display_Symbol(i)}${quote}, `;
      }
      res += `${quote}${display_Symbol(second_to_last)}${quote} or ${quote}${display_Symbol(last)}${quote}`;

      diag.span_label(self.span, `this ${description} is only valid with one of the following arguments: ${res}`);
    }
  },

  // rustc: compiler/rustc_attr_parsing/src/diagnostics.rs:1608 render_suggestions
  render_suggestions(self: AttributeParseError, diag: Diag): void {
    const description = AttributeParseError.description(self);

    switch (self.suggestions.$) {
      case "CreatedByTemplate": {
        const suggestions = self.suggestions._0;
        diag.span_suggestions(
          self.inner_span,
          suggestions.length === 1 ? "must be of the form" : `try changing it to one of the following valid forms of the ${description}`,
          suggestions.slice(),
          Applicability.HasPlaceholders,
        );
        break;
      }

      case "CreatedByParser": {
        const suggestions = self.suggestions._0;
        for (const { msg, sp, code } of suggestions) {
          diag.span_suggestion_verbose(sp, msg, code, Applicability.MaybeIncorrect);
        }
        break;
      }
    }
  },

  // rustc: compiler/rustc_attr_parsing/src/diagnostics.rs:1640 description
  description(self: AttributeParseError): string {
    switch (self.description) {
      case "Attribute":
        return "attribute";
      case "Macro":
        return "macro";
    }
  },
};

export type AttributeParseErrorSuggestions = gen.AttributeParseErrorSuggestions;
export const AttributeParseErrorSuggestions = {
  // rustc: compiler/rustc_attr_parsing/src/diagnostics.rs:1649 len
  len(self: AttributeParseErrorSuggestions): number {
    switch (self.$) {
      case "CreatedByTemplate":
        return self._0.length;
      case "CreatedByParser":
        return self._0.length;
    }
  },
};

/** `impl<'a> Diagnostic<'a> for AttributeParseError<'_>` */
// rustc: compiler/rustc_attr_parsing/src/diagnostics.rs:1658 into_diag
export function AttributeParseError_into_diag(self: AttributeParseError, dcx: DiagCtxtHandle, level: Level): Diag {
  const name = display_AttrPath(self.path);

  const description = AttributeParseError.description(self);

  const diag = Diag.new(dcx, level, `malformed \`${name}\` ${description} input`);
  diag.span(self.inner_span);
  diag.code(E0539);
  const reason = self.reason;
  switch (reason.$) {
    case "ExpectedStringLiteral": {
      const byte_string = reason.byte_string;
      if (byte_string !== undefined) {
        const start_point_span = byte_string;
        diag.span_suggestion_short(start_point_span, "consider removing the prefix", "", Applicability.MaybeIncorrect);
        diag.note("expected a normal string literal, not a byte string literal");

        // Avoid emitting an "attribute must be of the form" suggestion, as the
        // attribute is likely to be well-formed already.
        return diag;
      }
      diag.span_label(self.span, "expected a string literal here");
      break;
    }
    case "ExpectedFilenameLiteral":
      diag.span_label(self.span, "expected a filename string literal here");
      break;
    case "ExpectedIntegerLiteral":
      diag.span_label(self.span, "expected an integer literal here");
      break;
    case "ExpectedIntegerLiteralInRange": {
      const { lower_bound, upper_bound } = reason;
      diag.span_label(self.span, `expected an integer literal in the range of ${lower_bound}..=${upper_bound}`);
      break;
    }
    case "ExpectedSingleArgument":
      diag.span_label(self.span, "expected a single argument here");
      diag.code(E0805);
      break;
    case "ExpectedArgument":
      diag.span_label(self.span, "expected an argument here");
      diag.code(E0805);
      break;
    case "ExpectedAtLeastOneArgument":
      diag.span_label(self.span, "expected at least 1 argument here");
      break;
    case "ExpectedList":
      diag.span_label(self.span, "expected this to be a list");
      break;
    case "ExpectedListOrNoArgs":
      diag.span_label(self.span, "expected a list or no arguments here");
      break;
    case "ExpectedListWithNumArgsOrMore":
      diag.span_label(self.span, `expected ${reason.args} or more items`);
      break;
    case "ExpectedNameValueOrNoArgs":
      diag.span_label(self.span, "didn't expect a list here");
      break;
    case "ExpectedNonEmptyStringLiteral":
      diag.span_label(self.span, "string is not allowed to be empty");
      break;
    case "DuplicateKey": {
      const key = reason._0;
      diag.span_label(self.span, `found \`${display_Symbol(key)}\` used as a key more than once`);
      diag.code(E0538);
      break;
    }
    case "ExpectedNotLiteral":
      diag.span_label(self.span, "didn't expect a literal here");
      diag.code(E0565);
      break;
    case "ExpectedNoArgs":
      diag.span_label(self.span, "didn't expect any arguments here");
      diag.code(E0565);
      break;
    case "ExpectedNameValue":
      if (reason._0 === undefined) {
        // If the span is the entire attribute inner, the suggestion we add below this
        // match already contains enough information.
        if (self.span !== self.inner_span) {
          diag.span_label(self.span, 'expected this to be of the form `... = "..."`');
        }
      } else {
        const name = reason._0;
        diag.span_label(self.span, `expected this to be of the form \`${display_Symbol(name)} = "..."\``);
      }
      break;
    case "MissingNameValue": {
      const name = reason._0;
      diag.span_label(self.span, `missing argument \`${display_Symbol(name)} = "..."\``);
      break;
    }
    case "ExpectedSpecificArgument":
      if (!reason.list) {
        AttributeParseError.render_expected_specific_argument(self, diag, reason.possibilities, reason.strings);
      } else {
        AttributeParseError.render_expected_specific_argument_list(self, diag, reason.possibilities, reason.strings);
      }
      break;
    case "ExpectedIdentifier":
      diag.span_label(self.span, "expected a valid identifier here");
      diag.code(E0565);
      break;
  }

  const link = self.template.docs;
  if (link !== undefined) {
    diag.note(`for more information, visit <${link}>`);
  }

  if (AttributeParseErrorSuggestions.len(self.suggestions) < 4) {
    AttributeParseError.render_suggestions(self, diag);
  }

  return diag;
}
/** `AttributeParseError` as a `Diagnostic` trait object. */
export function AttributeParseError_diagnostic(self: AttributeParseError): Diagnostic {
  return { into_diag: (dcx, level) => AttributeParseError_into_diag(self, dcx, level) };
}
