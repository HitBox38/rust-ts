// Port of compiler/rustc_session/src/diagnostics.rs.
// The types and every `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` impl (`<T>_into_diag` +
// `<T>_diagnostic`, `<T>_add_to_diag` + `<T>_subdiagnostic`) are generated into diagnostics.gen.ts by
// tools/codegen/types.ts (set `rustc_session`). This module holds the hand-written fns of the file.
//
// PORT: same conventions as src/rustc_parse/diagnostics.ts: inherent fns of generated types live on a
// companion const defined here (`SuggestUpgradeCompiler.ui_testing()`); `impl Diagnostic for T` ->
// `T_into_diag(self, dcx, level)` + `T_diagnostic(self)`.
// The generated module imports the stand-in types and `*_into_diag_arg` fns below (type imports and
// call-time function uses only, so the module cycle is harmless).
import { token } from "../rustc_ast/lib.ts";
import type { LitError } from "../rustc_ast/util/literal.gen.ts";
import { into_DiagMessage, into_MultiSpan, type IntoDiagMessage, type IntoMultiSpan, type PathBuf } from "../rustc_error_messages/lib.ts";
import {
  Diag,
  type DiagArgValue,
  type DiagCtxtHandle,
  type Diagnostic,
  E0658,
  type ErrorGuaranteed,
  type Level,
  StashKey,
} from "../rustc_errors/lib.ts";
import { find_feature_issue, GateIssue, UnstableFeatures } from "../rustc_feature/lib.ts";
import { FutureIncompatibilityReason, Lint } from "../rustc_lint_defs/lib.ts";
import { UNSTABLE_SYNTAX_PRE_EXPANSION } from "../rustc_lint_defs/builtin.ts";
import type { MutRef } from "../rustc_span/hygiene.ts";
import type { Span } from "../rustc_span/lib.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { is_ascii_digit, to_digit } from "../std/char.ts";
import { unported, unreachable, unwrap } from "../std/panic.ts";
import { utf8_len } from "../std/str.ts";
import {
  BinaryFloatLiteralNotSupported_diagnostic,
  CliFeatureDiagnosticHelp_subdiagnostic,
  FeatureDiagnosticForIssue_subdiagnostic,
  FeatureDiagnosticHelp_subdiagnostic,
  FeatureDiagnosticSuggestion_subdiagnostic,
  type FeatureGateError,
  HexadecimalFloatLiteralNotSupported_diagnostic,
  IntLiteralTooLarge_diagnostic,
  InvalidFloatLiteralSuffix_diagnostic,
  InvalidFloatLiteralWidth_diagnostic,
  InvalidIntLiteralWidth_diagnostic,
  InvalidLiteralSuffix_diagnostic,
  InvalidNumLiteralBasePrefix_diagnostic,
  InvalidNumLiteralSuffix_diagnostic,
  OctalFloatLiteralNotSupported_diagnostic,
  type SuggestUpgradeCompiler as SuggestUpgradeCompilerT,
  SuggestUpgradeCompiler_subdiagnostic,
} from "./diagnostics.gen.ts";
import type { Session } from "./lib.ts";
import type { ParseSess } from "./parse.ts";

export * from "./diagnostics.gen.ts";

// ---- PORT: stand-ins for field types of the generated diagnostics whose crates are not ported ----

/** PORT: opaque stand-in for `std::num::ParseIntError` (std::num is not ported; AppleDeploymentTarget). */
export type ParseIntError = { readonly __standin: "std::num::ParseIntError" };
export type { SplitDebuginfo, StackProtector } from "../rustc_target/spec/mod.ts";
export type { TargetTuple } from "../rustc_target/spec/tuple.ts";
import type { SplitDebuginfo, StackProtector } from "../rustc_target/spec/mod.ts";
import type { TargetTuple } from "../rustc_target/spec/tuple.ts";
import { spec as target_spec } from "../rustc_target/lib.ts";
import { TargetTuple_into_diag_arg as TargetTuple_into_diag_arg_ } from "../rustc_target/spec/tuple.ts";

/** `into_diag_arg_using_display!(ParseIntError)` (rustc_error_messages). PORT: Display of std's ParseIntError is not ported. */
export function ParseIntError_into_diag_arg(_self: ParseIntError, _path: MutRef<PathBuf | undefined>): DiagArgValue {
  return unported("std::num::ParseIntError Display (IntoDiagArg)");
}
/** `into_diag_arg_using_display!(StackProtector)` (rustc_target/src/spec/mod.rs) */
export function StackProtector_into_diag_arg(self: StackProtector, path: MutRef<PathBuf | undefined>): DiagArgValue {
  return target_spec.StackProtector.into_diag_arg(self, path);
}
/** `into_diag_arg_using_display!(&TargetTuple)` (rustc_target/src/spec/tuple.rs) */
export function TargetTuple_into_diag_arg(self: TargetTuple, path: MutRef<PathBuf | undefined>): DiagArgValue {
  return TargetTuple_into_diag_arg_(self, path);
}
/** `into_diag_arg_using_display!(SplitDebuginfo)` (rustc_target/src/spec/mod.rs) */
export function SplitDebuginfo_into_diag_arg(self: SplitDebuginfo, path: MutRef<PathBuf | undefined>): DiagArgValue {
  return target_spec.SplitDebuginfo.into_diag_arg(self, path);
}

// ---- diagnostics.rs ----------------------------------------------------------------------------

/// Construct a diagnostic for a language feature error due to the given `span`.
/// The `feature`'s `Symbol` is the one you used in `unstable.rs` and `rustc_span::symbol`.
// #[track_caller]
// rustc: compiler/rustc_session/src/diagnostics.rs:21 feature_err
export function feature_err(sess: Session, feature: Symbol, span: IntoMultiSpan, explain: IntoDiagMessage): Diag {
  return feature_err_issue(sess, feature, span, GateIssue.Language, explain);
}

/// Construct a diagnostic for a feature gate error.
///
/// This variant allows you to control whether it is a library or language feature.
/// Almost always, you want to use this for a language feature. If so, prefer `feature_err`.
// #[track_caller]
// rustc: compiler/rustc_session/src/diagnostics.rs:35 feature_err_issue
export function feature_err_issue(
  sess: Session,
  feature: Symbol,
  span_: IntoMultiSpan,
  issue: GateIssue,
  explain: IntoDiagMessage,
): Diag {
  const span = into_MultiSpan(span_);

  // Cancel an earlier warning for this same error, if it exists.
  {
    const span_1 = span.primary_span();
    if (span_1 !== undefined) {
      const err = sess.dcx().steal_non_err(span_1, StashKey.EarlySyntaxWarning);
      if (err !== undefined) {
        err.cancel();
      }
    }
  }

  const err = sess.dcx().create_err(FeatureGateError_diagnostic({ span, explain: into_DiagMessage(explain) }));
  add_feature_diagnostics_for_issue(err, sess, feature, issue, false, undefined);
  return err;
}

/// Construct a future incompatibility diagnostic for a feature gate.
///
/// This diagnostic is only a warning and *does not cause compilation to fail*.
// #[track_caller]
// rustc: compiler/rustc_session/src/diagnostics.rs:60 feature_warn
export function feature_warn(sess: Session, feature: Symbol, span: Span, explain: string): void {
  feature_warn_issue(sess, feature, span, GateIssue.Language, explain);
}

/// Construct a future incompatibility diagnostic for a feature gate.
///
/// This diagnostic is only a warning and *does not cause compilation to fail*.
///
/// This variant allows you to control whether it is a library or language feature.
/// Almost always, you want to use this for a language feature. If so, prefer `feature_warn`.
// #[track_caller]
// rustc: compiler/rustc_session/src/diagnostics.rs:71 feature_warn_issue
export function feature_warn_issue(sess: Session, feature: Symbol, span: Span, issue: GateIssue, explain: string): void {
  const err = sess.dcx().struct_span_warn(span, explain);
  add_feature_diagnostics_for_issue(err, sess, feature, issue, false, undefined);

  // Decorate this as a future-incompatibility lint as in rustc_middle::lint::lint_level
  const lint = UNSTABLE_SYNTAX_PRE_EXPANSION;
  const future_incompatible = unwrap(lint.future_incompatible);
  err.is_lint(Lint.name_lower(lint), /* has_future_breakage */ false, /* rust_version */ undefined);
  err.warn(lint.desc);
  err.note(`for more information, see ${FutureIncompatibilityReason.reference(future_incompatible.reason)}`);

  // A later feature_err call can steal and cancel this warning.
  err.stash(span, StashKey.EarlySyntaxWarning);
}

/// Adds the diagnostics for a feature to an existing error.
/// Must be a language feature!
// rustc: compiler/rustc_session/src/diagnostics.rs:98 add_feature_diagnostics
export function add_feature_diagnostics(err: Diag, sess: Session, feature: Symbol): void {
  add_feature_diagnostics_for_issue(err, sess, feature, GateIssue.Language, false, undefined);
}

/// Adds the diagnostics for a feature to an existing error.
///
/// This variant allows you to control whether it is a library or language feature.
/// Almost always, you want to use this for a language feature. If so, prefer
/// `add_feature_diagnostics`.
// rustc: compiler/rustc_session/src/diagnostics.rs:107 add_feature_diagnostics_for_issue
export function add_feature_diagnostics_for_issue(
  err: Diag,
  sess: Session,
  feature: Symbol,
  issue: GateIssue,
  feature_from_cli: boolean,
  inject_span: Span | undefined,
): void {
  {
    const n = find_feature_issue(feature, issue);
    if (n !== undefined) {
      err.subdiagnostic(FeatureDiagnosticForIssue_subdiagnostic({ n }));
    }
  }

  // #23973: do not suggest `#![feature(...)]` if we are in beta/stable
  if (UnstableFeatures.is_nightly_build(sess.unstable_features)) {
    if (feature_from_cli) {
      err.subdiagnostic(CliFeatureDiagnosticHelp_subdiagnostic({ feature }));
    } else if (inject_span !== undefined) {
      const span = inject_span;
      err.subdiagnostic(FeatureDiagnosticSuggestion_subdiagnostic({ feature, span }));
    } else {
      err.subdiagnostic(FeatureDiagnosticHelp_subdiagnostic({ feature }));
    }
    if (feature === sym.rustc_attrs) {
      // We're unlikely to stabilize something out of `rustc_attrs`
      // without at least renaming it, so pointing out how old
      // the compiler is will do little good.
    } else if (sess.opts.unstable_opts.ui_testing) {
      err.subdiagnostic(SuggestUpgradeCompiler_subdiagnostic(SuggestUpgradeCompiler.ui_testing()));
    } else {
      const suggestion = SuggestUpgradeCompiler.new();
      if (suggestion !== undefined) {
        err.subdiagnostic(SuggestUpgradeCompiler_subdiagnostic(suggestion));
      }
    }
  }
}

/// This is only used by unstable_feature_bound as it does not have issue number information for now.
/// This is basically the same as `feature_err_issue`
/// but without the feature issue note. If we can do a lookup for issue number from feature name,
/// then we should directly use `feature_err_issue` for ambiguity error of
/// `#[unstable_feature_bound]`.
// #[track_caller]
// rustc: compiler/rustc_session/src/diagnostics.rs:146 feature_err_unstable_feature_bound
export function feature_err_unstable_feature_bound(
  sess: Session,
  feature: Symbol,
  span_: IntoMultiSpan,
  explain: IntoDiagMessage,
): Diag {
  const span = into_MultiSpan(span_);

  // Cancel an earlier warning for this same error, if it exists.
  {
    const span_1 = span.primary_span();
    if (span_1 !== undefined) {
      const err = sess.dcx().steal_non_err(span_1, StashKey.EarlySyntaxWarning);
      if (err !== undefined) {
        err.cancel();
      }
    }
  }

  const err = sess.dcx().create_err(FeatureGateError_diagnostic({ span, explain: into_DiagMessage(explain) }));

  // #23973: do not suggest `#![feature(...)]` if we are in beta/stable
  if (UnstableFeatures.is_nightly_build(sess.unstable_features)) {
    err.subdiagnostic(FeatureDiagnosticHelp_subdiagnostic({ feature }));

    if (feature === sym.rustc_attrs) {
      // We're unlikely to stabilize something out of `rustc_attrs`
      // without at least renaming it, so pointing out how old
      // the compiler is will do little good.
    } else if (sess.opts.unstable_opts.ui_testing) {
      err.subdiagnostic(SuggestUpgradeCompiler_subdiagnostic(SuggestUpgradeCompiler.ui_testing()));
    } else {
      const suggestion = SuggestUpgradeCompiler.new();
      if (suggestion !== undefined) {
        err.subdiagnostic(SuggestUpgradeCompiler_subdiagnostic(suggestion));
      }
    }
  }
  return err;
}

/** `impl<'a> Diagnostic<'a> for FeatureGateError` */
// #[track_caller]
// rustc: compiler/rustc_session/src/diagnostics.rs:197 into_diag
export function FeatureGateError_into_diag(self: FeatureGateError, dcx: DiagCtxtHandle, level: Level): Diag {
  return Diag.new(dcx, level, self.explain).with_span(self.span).with_code(E0658);
}
/** `FeatureGateError` as a `Diagnostic` trait object. */
export function FeatureGateError_diagnostic(self: FeatureGateError): Diagnostic {
  return { into_diag: (dcx, level) => FeatureGateError_into_diag(self, dcx, level) };
}

// PORT: `option_env!("CFG_VER_DATE")` is read when rustc is built: bootstrap sets it to the commit date
// of the build (`UPSTREAM.json` `rust.commitDate` = "2026-10-10"). Checked against the oracle:
// `rustc +nightly --edition 2021 --emit=metadata auto_trait.rs` (no -Zui-testing) prints
// "this compiler was built on 2026-10-10; consider upgrading it if it is out of date".
const CFG_VER_DATE: string | undefined = "2026-10-10";

export type SuggestUpgradeCompiler = SuggestUpgradeCompilerT;
export const SuggestUpgradeCompiler = {
  // rustc: compiler/rustc_session/src/diagnostics.rs:215 ui_testing
  ui_testing(): SuggestUpgradeCompiler {
    return { date: "YYYY-MM-DD" };
  },

  // rustc: compiler/rustc_session/src/diagnostics.rs:219 new
  new(): SuggestUpgradeCompiler | undefined {
    const date = CFG_VER_DATE;
    if (date === undefined) return undefined;

    return { date };
  },
};

// rustc: compiler/rustc_session/src/diagnostics.rs:585 report_lit_error
export function report_lit_error(psess: ParseSess, err: LitError, lit: token.Lit, span: Span): ErrorGuaranteed {
  return create_lit_error(psess, err, lit, span).emit_err();
}

// rustc: compiler/rustc_session/src/diagnostics.rs:594 create_lit_error
export function create_lit_error(psess: ParseSess, err: LitError, lit: token.Lit, span: Span): Diag {
  // Checks if `s` looks like i32 or u1234 etc.
  // rustc: compiler/rustc_session/src/diagnostics.rs:596 looks_like_width_suffix
  function looks_like_width_suffix(first_chars: readonly number[], s: string): boolean {
    return (
      utf8_len(s) > 1 &&
      first_chars.includes(s.codePointAt(0)!) &&
      // PORT: `s[1..]`: the first char is one of `first_chars` (ASCII), so byte 1 is UTF-16 unit 1.
      [...s.slice(1)].every((c) => is_ascii_digit(c.codePointAt(0)!))
    );
  }

  // Try to lowercase the prefix if the prefix and suffix are valid.
  // rustc: compiler/rustc_session/src/diagnostics.rs:601 fix_base_capitalisation
  function fix_base_capitalisation(prefix: string, suffix: string): string | undefined {
    const chars = [...suffix].map((c) => c.codePointAt(0)!);

    const base_char = unwrap(chars.shift());
    let base: number;
    switch (base_char) {
      case 0x42 /* 'B' */:
        base = 2;
        break;
      case 0x4f /* 'O' */:
        base = 8;
        break;
      case 0x58 /* 'X' */:
        base = 16;
        break;
      default:
        return undefined;
    }

    // check that the suffix contains only base-appropriate characters
    let valid = prefix === "0";
    if (valid) {
      // `chars.filter(|c| *c != '_').take_while(|c| *c != 'i' && *c != 'u').all(|c| c.to_digit(base).is_some())`
      for (const c of chars) {
        if (c === 0x5f /* '_' */) continue;
        if (c === 0x69 /* 'i' */ || c === 0x75 /* 'u' */) break;
        if (to_digit(c, base) === undefined) {
          valid = false;
          break;
        }
      }
    }

    // PORT: `base_char.to_ascii_lowercase()`: base_char is 'B', 'O' or 'X'; `&suffix[1..]` starts
    // after that ASCII char.
    return valid ? `0${String.fromCodePoint(base_char + 0x20)}${suffix.slice(1)}` : undefined;
  }

  const dcx = psess.dcx();
  switch (err.$) {
    case "InvalidSuffix": {
      const suffix = err._0;
      return dcx.create_err(InvalidLiteralSuffix_diagnostic({ span, kind: token.LitKind.descr(lit.kind), suffix }));
    }
    case "InvalidIntSuffix": {
      const suffix = err._0;
      const suf = Symbol.as_str(suffix);
      if (looks_like_width_suffix([0x69 /* 'i' */, 0x75 /* 'u' */], suf)) {
        // If it looks like a width, try to be helpful.
        return dcx.create_err(InvalidIntLiteralWidth_diagnostic({ span, width: suf.slice(1) }));
      } else {
        const fixed = fix_base_capitalisation(Symbol.as_str(lit.symbol), suf);
        if (fixed !== undefined) {
          return dcx.create_err(InvalidNumLiteralBasePrefix_diagnostic({ span, fixed }));
        } else {
          return dcx.create_err(InvalidNumLiteralSuffix_diagnostic({ span, suffix: suf }));
        }
      }
    }
    case "InvalidFloatSuffix": {
      const suffix = err._0;
      const suf = Symbol.as_str(suffix);
      if (looks_like_width_suffix([0x66 /* 'f' */], suf)) {
        // If it looks like a width, try to be helpful.
        return dcx.create_err(InvalidFloatLiteralWidth_diagnostic({ span, width: suf.slice(1) }));
      } else {
        return dcx.create_err(InvalidFloatLiteralSuffix_diagnostic({ span, suffix: suf }));
      }
    }
    case "NonDecimalFloat": {
      const base = err._0;
      switch (base) {
        case 16:
          return dcx.create_err(HexadecimalFloatLiteralNotSupported_diagnostic({ span }));
        case 8:
          return dcx.create_err(OctalFloatLiteralNotSupported_diagnostic({ span }));
        case 2:
          return dcx.create_err(BinaryFloatLiteralNotSupported_diagnostic({ span }));
        default:
          return unreachable();
      }
    }
    case "IntTooLarge": {
      const base = err._0;
      const max = (1n << 128n) - 1n; // u128::MAX
      let limit: string;
      switch (base) {
        case 2:
          limit = `0b${max.toString(2)}`; // format!("{max:#b}")
          break;
        case 8:
          limit = `0o${max.toString(8)}`; // format!("{max:#o}")
          break;
        case 16:
          limit = `0x${max.toString(16)}`; // format!("{max:#x}")
          break;
        default:
          limit = max.toString(); // format!("{max}")
      }
      return dcx.create_err(IntLiteralTooLarge_diagnostic({ span, limit }));
    }
  }
}
