// Port of compiler/rustc_parse/src/diagnostics.rs.
// The types, their derived Debug and every `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` impl
// (`<T>_into_diag` + `<T>_diagnostic`, `<T>_add_to_diag` + `<T>_subdiagnostic`) are generated into
// diagnostics.gen.ts by tools/codegen/types.ts (+ tools/codegen/diagnostics.ts, the port of
// rustc_macros' diagnostic derives). This module holds the hand-written fns of the file.
//
// PORT: method placement (PORTING §8): inherent fns of generated types live on a companion const
// re-defined here (`{ ...gen.X, fn }` when the generated module has one), like rustc_ast/token.ts.
// Hand-written trait impls follow the generated naming: `impl Diagnostic for T` ->
// `T_into_diag(self, dcx, level)` + `T_diagnostic(self)`, `impl Subdiagnostic for T` ->
// `T_add_to_diag(self, diag)` + `T_subdiagnostic(self)`, `impl IntoDiagArg for T` ->
// `T_into_diag_arg(self, path)`.
import type { Token } from "../rustc_ast/token.ts";
import { Cow_into_diag_arg, String_into_diag_arg, str_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import type { PathBuf } from "../rustc_error_messages/lib.ts";
import {
  Diag,
  type DiagArgValue,
  type DiagCtxtHandle,
  type DiagMessage,
  type Diagnostic,
  IntoDiagArg,
  type Level,
  type Subdiagnostic,
  SuggestionStyle,
} from "../rustc_errors/lib.ts";
import { LATEST_STABLE_EDITION } from "../rustc_span/edition.ts";
import type { MutRef } from "../rustc_span/hygiene.ts";
import { Span } from "../rustc_span/lib.ts";
import { display_Ident } from "../rustc_span/symbol.ts";
import { debug_char } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import * as gen from "./diagnostics.gen.ts";
import {
  type Case,
  type ExpectedIdentifier,
  type ExpectedSemi,
  type FnTraitMissingParen,
  type HiddenUnicodeCodepointsDiagLabels,
  type HiddenUnicodeCodepointsDiagSub,
  type UseDerefMacro,
  ExpectedSemiSugg_add_to_diag,
  ExpectedIdentifierFound_add_to_diag,
  HelpIdentifierStartsWithNumber_add_to_diag,
  SuggEscapeIdentifier_add_to_diag,
  SuggRemoveComma_add_to_diag,
} from "./diagnostics.gen.ts";

export * from "./diagnostics.gen.ts";

// PORT: rustc_ast_pretty and rustc_session::utils are not ported yet; the calls below go through
// these leaves so that the hand-written logic around them is complete.
/** `rustc_ast_pretty::pprust::token_to_string` */
function pprust_token_to_string(_token: Token): string {
  return unported("rustc_ast_pretty::pprust::token_to_string");
}
/** `rustc_session::utils::was_invoked_from_cargo` */
function was_invoked_from_cargo(): boolean {
  return unported("rustc_session::utils::was_invoked_from_cargo");
}

/** `msg!("...")`: `DiagMessage::Inline(Cow::Borrowed("..."))` */
const msg = (s: string): DiagMessage => ({ $: "Inline", _0: s });

export type ExprParenthesesNeeded = gen.ExprParenthesesNeeded;
export const ExprParenthesesNeeded = {
  // rustc: compiler/rustc_parse/src/diagnostics.rs:938 surrounding
  surrounding(s: Span): ExprParenthesesNeeded {
    return { left: Span.shrink_to_lo(s), right: Span.shrink_to_hi(s) };
  },
};

export type ExpectedIdentifierFound = gen.ExpectedIdentifierFound;
export const ExpectedIdentifierFound = {
  // rustc: compiler/rustc_parse/src/diagnostics.rs:1518 new
  new(token_descr: TokenDescription | undefined, span: Span): ExpectedIdentifierFound {
    let ctor: (_0: Span) => ExpectedIdentifierFound;
    switch (token_descr?.$) {
      case "ReservedIdentifier":
        ctor = (_0) => ({ $: "ReservedIdentifier", _0 });
        break;
      case "Keyword":
        ctor = (_0) => ({ $: "Keyword", _0 });
        break;
      case "ReservedKeyword":
        ctor = (_0) => ({ $: "ReservedKeyword", _0 });
        break;
      case "DocComment":
        ctor = (_0) => ({ $: "DocComment", _0 });
        break;
      case "MetaVar":
        ctor = (_0) => ({ $: "MetaVar", _0 });
        break;
      case undefined:
        ctor = (_0) => ({ $: "Other", _0 });
        break;
    }
    return ctor(span);
  },
};

/** `impl<'a> Diagnostic<'a> for ExpectedIdentifier` */
// rustc: compiler/rustc_parse/src/diagnostics.rs:1542 into_diag
export function ExpectedIdentifier_into_diag(self: ExpectedIdentifier, dcx: DiagCtxtHandle, level: Level): Diag {
  const token_descr = TokenDescription.from_token(self.token);

  let add_token = true;
  let message: DiagMessage;
  switch (token_descr?.$) {
    case "ReservedIdentifier":
      message = msg("expected identifier, found reserved identifier `{$token}`");
      break;
    case "Keyword":
      message = msg("expected identifier, found keyword `{$token}`");
      break;
    case "ReservedKeyword":
      message = msg("expected identifier, found reserved keyword `{$token}`");
      break;
    case "DocComment":
      message = msg("expected identifier, found doc comment `{$token}`");
      break;
    case "MetaVar":
      add_token = false;
      message = msg("expected identifier, found metavariable");
      break;
    case undefined:
      message = msg("expected identifier, found `{$token}`");
      break;
  }
  const diag = Diag.new(dcx, level, message);
  diag.span(self.span);
  if (add_token) {
    diag.arg("token", IntoDiagArg.of(pprust_token_to_string(self.token), Cow_into_diag_arg));
  }

  const sugg = self.suggest_raw;
  if (sugg !== undefined) {
    SuggEscapeIdentifier_add_to_diag(sugg, diag);
  }

  ExpectedIdentifierFound_add_to_diag(ExpectedIdentifierFound.new(token_descr, self.span), diag);

  const sugg2 = self.suggest_remove_comma;
  if (sugg2 !== undefined) {
    SuggRemoveComma_add_to_diag(sugg2, diag);
  }

  const help = self.help_cannot_start_number;
  if (help !== undefined) {
    HelpIdentifierStartsWithNumber_add_to_diag(help, diag);
  }

  return diag;
}
/** `ExpectedIdentifier` as a `Diagnostic` trait object. */
export function ExpectedIdentifier_diagnostic(self: ExpectedIdentifier): Diagnostic {
  return { into_diag: (dcx, level) => ExpectedIdentifier_into_diag(self, dcx, level) };
}

/** `impl<'a> Diagnostic<'a> for ExpectedSemi` */
// rustc: compiler/rustc_parse/src/diagnostics.rs:1608 into_diag
export function ExpectedSemi_into_diag(self: ExpectedSemi, dcx: DiagCtxtHandle, level: Level): Diag {
  const token_descr = TokenDescription.from_token(self.token);

  let add_token = true;
  let message: DiagMessage;
  switch (token_descr?.$) {
    case "ReservedIdentifier":
      message = msg("expected `;`, found reserved identifier `{$token}`");
      break;
    case "Keyword":
      message = msg("expected `;`, found keyword `{$token}`");
      break;
    case "ReservedKeyword":
      message = msg("expected `;`, found reserved keyword `{$token}`");
      break;
    case "DocComment":
      message = msg("expected `;`, found doc comment `{$token}`");
      break;
    case "MetaVar":
      add_token = false;
      message = msg("expected `;`, found metavariable");
      break;
    case undefined:
      message = msg("expected `;`, found `{$token}`");
      break;
  }
  const diag = Diag.new(dcx, level, message);
  diag.span(self.span);
  if (add_token) {
    diag.arg("token", IntoDiagArg.of(pprust_token_to_string(self.token), Cow_into_diag_arg));
  }

  const unexpected_token_label = self.unexpected_token_label;
  if (unexpected_token_label !== undefined) {
    diag.span_label(unexpected_token_label, msg("unexpected token"));
  }

  ExpectedSemiSugg_add_to_diag(self.sugg, diag);

  return diag;
}
/** `ExpectedSemi` as a `Diagnostic` trait object. */
export function ExpectedSemi_diagnostic(self: ExpectedSemi): Diagnostic {
  return { into_diag: (dcx, level) => ExpectedSemi_into_diag(self, dcx, level) };
}

/** `impl Subdiagnostic for FnTraitMissingParen` */
// rustc: compiler/rustc_parse/src/diagnostics.rs:2013 add_to_diag
export function FnTraitMissingParen_add_to_diag(self: FnTraitMissingParen, diag: Diag): void {
  diag.span_label(self.span, msg("`Fn` bounds require arguments in parentheses"));
  diag.span_suggestion_short(Span.shrink_to_hi(self.span), msg("try adding parentheses"), "()", "MachineApplicable");
}
/** `FnTraitMissingParen` as a `Subdiagnostic` trait object. */
export function FnTraitMissingParen_subdiagnostic(self: FnTraitMissingParen): Subdiagnostic {
  return { add_to_diag: (diag) => FnTraitMissingParen_add_to_diag(self, diag) };
}

export type UnexpectedTokenAfterStructName = gen.UnexpectedTokenAfterStructName;
export const UnexpectedTokenAfterStructName = {
  // rustc: compiler/rustc_parse/src/diagnostics.rs:2592 new
  new(span: Span, orig_token: Token): UnexpectedTokenAfterStructName {
    const token = pprust_token_to_string(orig_token);
    const d = TokenDescription.from_token(orig_token);
    switch (d?.$) {
      case "ReservedIdentifier":
        return { $: "ReservedIdentifier", span, token };
      case "Keyword":
        return { $: "Keyword", span, token };
      case "ReservedKeyword":
        return { $: "ReservedKeyword", span, token };
      case "DocComment":
        return { $: "DocComment", span, token };
      case "MetaVar":
        return { $: "MetaVar", span };
      case undefined:
        return { $: "Other", span, token };
    }
  },
};

export type HelpUseLatestEdition = gen.HelpUseLatestEdition;
export const HelpUseLatestEdition = {
  // rustc: compiler/rustc_parse/src/diagnostics.rs:3683 new
  new(): HelpUseLatestEdition {
    const edition = LATEST_STABLE_EDITION;
    if (was_invoked_from_cargo()) {
      return { $: "Cargo", edition };
    } else {
      return { $: "Standalone", edition };
    }
  },
};

/** `impl Subdiagnostic for UseDerefMacro` */
// rustc: compiler/rustc_parse/src/diagnostics.rs:3717 add_to_diag
export function UseDerefMacro_add_to_diag(self: UseDerefMacro, diag: Diag): void {
  const { field, before, after } = self;

  const parts: [Span, string][] = [];
  if (field !== undefined) {
    const [span, field_] = field;
    parts.push([span, `${display_Ident(field_)}: `]);
  }
  parts.push([before, "deref!("]);
  parts.push([after, ")"]);
  diag.multipart_suggestion("...otherwise replace it with an invocation of macro `deref`", parts, "MaybeIncorrect");
}
/** `UseDerefMacro` as a `Subdiagnostic` trait object. */
export function UseDerefMacro_subdiagnostic(self: UseDerefMacro): Subdiagnostic {
  return { add_to_diag: (diag) => UseDerefMacro_add_to_diag(self, diag) };
}

/** `impl IntoDiagArg for Case` */
// rustc: compiler/rustc_parse/src/diagnostics.rs:4079 into_diag_arg
export function Case_into_diag_arg(self: Case, path: MutRef<PathBuf | undefined>): DiagArgValue {
  let s: string;
  switch (self) {
    case "Upper":
      s = "uppercase";
      break;
    case "Lower":
      s = "lowercase";
      break;
    case "Mixed":
      s = "the correct case";
      break;
  }
  return str_into_diag_arg(s, path);
}

/** `impl Subdiagnostic for HiddenUnicodeCodepointsDiagLabels` */
// rustc: compiler/rustc_parse/src/diagnostics.rs:4375 add_to_diag
export function HiddenUnicodeCodepointsDiagLabels_add_to_diag(self: HiddenUnicodeCodepointsDiagLabels, diag: Diag): void {
  for (const [c, span] of self.spans) {
    diag.span_label(span, debug_char(c));
  }
}
/** `HiddenUnicodeCodepointsDiagLabels` as a `Subdiagnostic` trait object. */
export function HiddenUnicodeCodepointsDiagLabels_subdiagnostic(self: HiddenUnicodeCodepointsDiagLabels): Subdiagnostic {
  return { add_to_diag: (diag) => HiddenUnicodeCodepointsDiagLabels_add_to_diag(self, diag) };
}

/** `impl Subdiagnostic for HiddenUnicodeCodepointsDiagSub` (used because of multiple multipart_suggestion and note) */
// rustc: compiler/rustc_parse/src/diagnostics.rs:4389 add_to_diag
export function HiddenUnicodeCodepointsDiagSub_add_to_diag(self: HiddenUnicodeCodepointsDiagSub, diag: Diag): void {
  switch (self.$) {
    case "Escape": {
      const spans = self.spans;
      diag.multipart_suggestion_with_style(
        msg("if their presence wasn't intentional, you can remove them"),
        spans.map(([, span]): [Span, string] => [span, ""]),
        "MachineApplicable",
        SuggestionStyle.HideCodeAlways,
      );
      diag.multipart_suggestion(
        msg("if you want to keep them but make them visible in your source code, you can escape them"),
        spans.map(([c, span]): [Span, string] => {
          const c_ = debug_char(c);
          // `c[1..c.len() - 1]`: drop the quotes (one byte each)
          return [span, c_.slice(1, c_.length - 1)];
        }),
        "MachineApplicable",
      );
      return;
    }
    case "NoEscape": {
      const { spans, is_doc_comment } = self;
      // FIXME: in other suggestions we've reversed the inner spans of doc comments. We
      // should do the same here to provide the same good suggestions as we do for
      // literals above.
      diag.arg(
        "escaped",
        IntoDiagArg.of(
          spans.map(([c]) => debug_char(c)).join(", "),
          String_into_diag_arg,
        ),
      );
      diag.note(msg("if their presence wasn't intentional, you can remove them"));
      if (is_doc_comment) {
        diag.note(
          msg(
            'if you need to keep them and make them explicit in source, rewrite this doc comment as a `#[doc = "..."]` attribute and use Unicode escapes such as {$escaped}',
          ),
        );
      } else {
        diag.note(msg("if you want to keep them but make them visible in your source code, you can escape them: {$escaped}"));
      }
      return;
    }
  }
}
/** `HiddenUnicodeCodepointsDiagSub` as a `Subdiagnostic` trait object. */
export function HiddenUnicodeCodepointsDiagSub_subdiagnostic(self: HiddenUnicodeCodepointsDiagSub): Subdiagnostic {
  return { add_to_diag: (diag) => HiddenUnicodeCodepointsDiagSub_add_to_diag(self, diag) };
}

export type TokenDescription = gen.TokenDescription;
export const TokenDescription = {
  ...gen.TokenDescription,

  // rustc: compiler/rustc_parse/src/diagnostics.rs:4530 from_token
  from_token(token: Token): TokenDescription | undefined {
    const kind = token.kind;
    if (token.is_special_ident()) return gen.TokenDescription.ReservedIdentifier;
    if (token.is_used_keyword()) return gen.TokenDescription.Keyword;
    if (token.is_unused_keyword()) return gen.TokenDescription.ReservedKeyword;
    if (kind.$ === "DocComment") return gen.TokenDescription.DocComment;
    if (kind.$ === "OpenInvisible" && kind._0.$ === "MetaVar") return { $: "MetaVar", _0: kind._0._0 };
    return undefined;
  },
};
