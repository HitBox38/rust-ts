// Port of src/tools/clippy/clippy_utils/src/diagnostics.rs (crate `clippy_utils`, plan-m8 D4; lane clippy-contract-b2,
// wave 41).
//
//! Clippy wrappers around rustc's diagnostic functions.
//!
//! These functions are used by the `INTERNAL_METADATA_COLLECTOR` lint to collect the corresponding
//! lint applicability. Please make sure that you update the `LINT_EMISSION_FUNCTIONS` variable in
//! `clippy_lints::utils::internal_lints::metadata_collector` when a new function is added
//! or renamed.
//!
//! Thank you!
//! ~The `INTERNAL_METADATA_COLLECTOR` lint
//
// PORT: generic `T: LintContext` / `C: LintContext` parameters are `LintContext<unknown>` (both `EarlyContext` and
// `LateContext` implement it); `impl Into<MultiSpan>` / `impl Into<DiagMessage>` are `IntoMultiSpan` / `IntoDiagMessage`
// with `.into()` as `into_MultiSpan` / `into_DiagMessage`, as in rustc_errors. `FnOnce(&mut Diag<'_>)` is
// `(diag: Diag) => void`.
// PORT: `#[track_caller]` is kept as a comment on each fn; `DiagLocation::caller()` is `DiagLocation.caller_()`, whose
// display (only `-Ztrack-diagnostics`) walks the JS stack back to the upstream call site (src/rust_ts/track_caller.ts),
// which skips the frames of these `#[track_caller]` fns by their markers. Calls between them are statements, never
// `return f(..)`, so no frame is lost to a tail call.
import {
  type Applicability,
  Diag,
  type DiagCtxtHandle,
  DiagDecorator,
  DiagLocation,
  type Diagnostic,
  type IntoDiagMessage,
  type IntoMultiSpan,
  type Level,
  into_DiagMessage,
  into_MultiSpan,
} from "../rustc_errors/lib.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import type { LateContext, LintContext } from "../rustc_lint/context.ts";
import { Lint } from "../rustc_lint_defs/lib.ts";
import type { Span } from "../rustc_span/lib.ts";
import { var_ as env_var } from "../std/env.ts";

/** PORT: `option_env!("CFG_RELEASE_CHANNEL")` when the oracle's clippy-driver was built (a nightly tarball, as in
 *  rustc_driver_impl/lib.ts and rustc_ast_passes/feature_gate.ts); the oracle's docs links say `/main/`. */
const CFG_RELEASE_CHANNEL: string | undefined = "nightly";
/** PORT: `env!("CARGO_PKG_VERSION_PATCH")` of clippy_utils at the pin (its Cargo.toml `version = "0.1.101"`). Read only
 *  on the `stable` channel, which the oracle is not. */
const CARGO_PKG_VERSION_PATCH = "101";

// rustc: src/tools/clippy/clippy_utils/src/diagnostics.rs:19 docs_link
function docs_link(diag: Diag, lint: Lint): void {
  let stripped: string | undefined;
  if (env_var("CLIPPY_DISABLE_DOCS_LINKS").$ === "Err" && (stripped = strip_prefix(Lint.name_lower(lint), "clippy::")) !== undefined) {
    const lint = stripped;
    let channel: string;
    switch (CFG_RELEASE_CHANNEL) {
      // Clippy version is 0.1.xx
      //
      // Always use .0 because we do not generate separate lint doc pages for rust patch releases
      case "stable":
        channel = `rust-1.${CARGO_PKG_VERSION_PATCH}.0`;
        break;
      case "beta":
        channel = "beta";
        break;
      default:
        channel = "main";
        break;
    }
    diag.help(`for further information visit https://rust-lang.github.io/rust-clippy/${channel}/index.html#${lint}`);
  }
}

/** `str::strip_prefix` */
function strip_prefix(s: string, prefix: string): string | undefined {
  return s.startsWith(prefix) ? s.slice(prefix.length) : undefined;
}

/// Makes sure that a diagnostic is well formed.
///
/// rustc debug asserts a few properties about spans,
/// but the clippy repo uses a distributed rustc build with debug assertions disabled,
/// so this has historically led to problems during subtree syncs where those debug assertions
/// only started triggered there.
///
/// This function makes sure we also validate them in debug clippy builds.
// rustc-skip: src/tools/clippy/clippy_utils/src/diagnostics.rs:46 validate_diag #[cfg(debug_assertions)]-only: the oracle clippy-driver is a release build without debug_assertions (its only callers are cfg'd out too)

/// Emit a basic lint message with a `msg` and a `span`.
///
/// This is the most primitive of our lint emission methods and can
/// be a good way to get a new lint started.
///
/// Usually it's nicer to provide more context for lint messages.
/// Be sure the output is understandable when you use this method.
///
/// NOTE: Lint emissions are always bound to a node in the HIR, which is used to determine
/// the lint level.
/// For the `span_lint` function, the node that was passed into the `LintPass::check_*` function is
/// used.
///
/// If you're emitting the lint at the span of a different node than the one provided by the
/// `LintPass::check_*` function, consider using [`span_lint_hir`] instead.
/// This is needed for `#[allow]` and `#[expect]` attributes to work on the node
/// highlighted in the displayed warning.
///
/// If you're unsure which function you should use, you can test if the `#[expect]` attribute works
/// where you would expect it to.
/// If it doesn't, you likely need to use [`span_lint_hir`] instead.
///
/// # Example
///
/// ```ignore
/// error: usage of mem::forget on Drop type
///   --> tests/ui/mem_forget.rs:17:5
///    |
/// 17 |     std::mem::forget(seven);
///    |     ^^^^^^^^^^^^^^^^^^^^^^^
/// ```
// #[track_caller]
// rustc: src/tools/clippy/clippy_utils/src/diagnostics.rs:106 span_lint
export function span_lint(cx: LintContext<unknown>, lint: Lint, sp: IntoMultiSpan, msg: IntoDiagMessage): void {
  span_lint_and_then(cx, lint, sp, msg, (_) => {});
}

/// Same as [`span_lint`] but with an extra `help` message.
///
/// Use this if you want to provide some general help but
/// can't provide a specific machine applicable suggestion.
///
/// The `help` message can be optionally attached to a `Span`.
///
/// If you change the signature, remember to update the internal lint `CollapsibleCalls`
///
/// NOTE: Lint emissions are always bound to a node in the HIR, which is used to determine
/// the lint level.
/// For the `span_lint_and_help` function, the node that was passed into the `LintPass::check_*`
/// function is used.
///
/// If you're emitting the lint at the span of a different node than the one provided by the
/// `LintPass::check_*` function, consider using [`span_lint_hir_and_then`] instead.
/// This is needed for `#[allow]` and `#[expect]` attributes to work on the node
/// highlighted in the displayed warning.
///
/// If you're unsure which function you should use, you can test if the `#[expect]` attribute works
/// where you would expect it to.
/// If it doesn't, you likely need to use [`span_lint_hir_and_then`] instead.
///
/// # Example
///
/// ```text
/// error: constant division of 0.0 with 0.0 will always result in NaN
///   --> tests/ui/zero_div_zero.rs:6:25
///    |
/// 6  |     let other_f64_nan = 0.0f64 / 0.0;
///    |                         ^^^^^^^^^^^^
///    |
///    = help: consider using `f64::NAN` if you would like a constant representing NaN
/// ```
// #[track_caller]
// rustc: src/tools/clippy/clippy_utils/src/diagnostics.rs:145 span_lint_and_help
export function span_lint_and_help(
  cx: LintContext<unknown>,
  lint: Lint,
  span: IntoMultiSpan,
  msg: IntoDiagMessage,
  help_span: Span | undefined,
  help: IntoDiagMessage,
): void {
  span_lint_and_then(cx, lint, span, msg, (diag) => {
    if (help_span !== undefined) {
      diag.span_help(help_span, into_DiagMessage(help));
    } else {
      diag.help(into_DiagMessage(help));
    }
  });
}

/// Like [`span_lint`] but with a `note` section instead of a `help` message.
///
/// The `note` message is presented separately from the main lint message
/// and is attached to a specific span:
///
/// If you change the signature, remember to update the internal lint `CollapsibleCalls`
///
/// NOTE: Lint emissions are always bound to a node in the HIR, which is used to determine
/// the lint level.
/// For the `span_lint_and_note` function, the node that was passed into the `LintPass::check_*`
/// function is used.
///
/// If you're emitting the lint at the span of a different node than the one provided by the
/// `LintPass::check_*` function, consider using [`span_lint_hir_and_then`] instead.
/// This is needed for `#[allow]` and `#[expect]` attributes to work on the node
/// highlighted in the displayed warning.
///
/// If you're unsure which function you should use, you can test if the `#[expect]` attribute works
/// where you would expect it to.
/// If it doesn't, you likely need to use [`span_lint_hir_and_then`] instead.
///
/// # Example
///
/// ```text
/// error: calls to `std::mem::forget` with a reference instead of an owned value. Forgetting a reference does nothing.
///   --> tests/ui/drop_forget_ref.rs:10:5
///    |
/// 10 |     forget(&SomeStruct);
///    |     ^^^^^^^^^^^^^^^^^^^
///    |
///    = note: `-D clippy::forget-ref` implied by `-D warnings`
/// note: argument has type &SomeStruct
///   --> tests/ui/drop_forget_ref.rs:10:12
///    |
/// 10 |     forget(&SomeStruct);
///    |            ^^^^^^^^^^^
/// ```
// #[track_caller]
// rustc: src/tools/clippy/clippy_utils/src/diagnostics.rs:200 span_lint_and_note
export function span_lint_and_note(
  cx: LintContext<unknown>,
  lint: Lint,
  span: IntoMultiSpan,
  msg: IntoDiagMessage,
  note_span: Span | undefined,
  note: IntoDiagMessage,
): void {
  span_lint_and_then(cx, lint, span, msg, (diag) => {
    if (note_span !== undefined) {
      diag.span_note(note_span, into_DiagMessage(note));
    } else {
      diag.note(into_DiagMessage(note));
    }
  });
}

/// Like [`span_lint`] but allows to add notes, help and suggestions using a closure.
///
/// If you need to customize your lint output a lot, use this function.
/// If you change the signature, remember to update the internal lint `CollapsibleCalls`
///
/// NOTE: Lint emissions are always bound to a node in the HIR, which is used to determine
/// the lint level.
/// For the `span_lint_and_then` function, the node that was passed into the `LintPass::check_*`
/// function is used.
///
/// If you're emitting the lint at the span of a different node than the one provided by the
/// `LintPass::check_*` function, consider using [`span_lint_hir_and_then`] instead.
/// This is needed for `#[allow]` and `#[expect]` attributes to work on the node
/// highlighted in the displayed warning.
///
/// If you're unsure which function you should use, you can test if the `#[expect]` attribute works
/// where you would expect it to.
/// If it doesn't, you likely need to use [`span_lint_hir_and_then`] instead.
// #[track_caller]
// rustc: src/tools/clippy/clippy_utils/src/diagnostics.rs:236 span_lint_and_then
export function span_lint_and_then(cx: LintContext<unknown>, lint: Lint, sp: IntoMultiSpan, msg: IntoDiagMessage, f: (diag: Diag) => void): void {
  // struct ClippyDiag<F: FnOnce(&mut Diag<'_>)>(F);
  // PORT: the local `ClippyDiag(F)` and its `Diagnostic` impl are a `Diagnostic` object built by `ClippyDiag(f)`.
  function ClippyDiag(f: (diag: Diag) => void): Diagnostic {
    return {
      // rustc: src/tools/clippy/clippy_utils/src/diagnostics.rs:246 into_diag
      into_diag(dcx: DiagCtxtHandle, level: Level): Diag {
        const lint = Diag.new(dcx, level, "");
        f(lint);
        return lint;
      },
    };
  }

  const sp_ = into_MultiSpan(sp);
  const emitted_at = DiagLocation.caller_();

  // #[expect(clippy::disallowed_methods)]
  cx.emit_span_lint(
    lint,
    sp_.clone(),
    ClippyDiag((diag: Diag) => {
      diag.primary_message(msg);
      diag.deref_mut().emitted_at = emitted_at;
      diag.span(sp_);
      f(diag);
      docs_link(diag, lint);

      // #[cfg(debug_assertions)]
      // validate_diag(diag);
    }),
  );
}

/// Like [`span_lint`], but emits the lint at the node identified by the given `HirId`.
///
/// This is in contrast to [`span_lint`], which always emits the lint at the node that was last
/// passed to the `LintPass::check_*` function.
///
/// The `HirId` is used for checking lint level attributes and to fulfill lint expectations defined
/// via the `#[expect]` attribute.
///
/// For example:
/// ```ignore
/// fn f() { /* <node_1> */
///
///     #[allow(clippy::some_lint)]
///     let _x = /* <expr_1> */;
/// }
/// ```
/// If `some_lint` does its analysis in `LintPass::check_fn` (at `<node_1>`) and emits a lint at
/// `<expr_1>` using [`span_lint`], then allowing the lint at `<expr_1>` as attempted in the snippet
/// will not work!
/// Even though that is where the warning points at, which would be confusing to users.
///
/// Instead, use this function and also pass the `HirId` of `<expr_1>`, which will let
/// the compiler check lint level attributes at the place of the expression and
/// the `#[allow]` will work.
// #[track_caller]
// rustc: src/tools/clippy/clippy_utils/src/diagnostics.rs:298 span_lint_hir
export function span_lint_hir(cx: LateContext, lint: Lint, hir_id: HirId, sp: Span, msg: IntoDiagMessage): void {
  span_lint_hir_and_then(cx, lint, hir_id, sp, msg, (_) => {});
}

/// Like [`span_lint_and_then`], but emits the lint at the node identified by the given `HirId`.
///
/// This is in contrast to [`span_lint_and_then`], which always emits the lint at the node that was
/// last passed to the `LintPass::check_*` function.
///
/// The `HirId` is used for checking lint level attributes and to fulfill lint expectations defined
/// via the `#[expect]` attribute.
///
/// For example:
/// ```ignore
/// fn f() { /* <node_1> */
///
///     #[allow(clippy::some_lint)]
///     let _x = /* <expr_1> */;
/// }
/// ```
/// If `some_lint` does its analysis in `LintPass::check_fn` (at `<node_1>`) and emits a lint at
/// `<expr_1>` using [`span_lint`], then allowing the lint at `<expr_1>` as attempted in the snippet
/// will not work!
/// Even though that is where the warning points at, which would be confusing to users.
///
/// Instead, use this function and also pass the `HirId` of `<expr_1>`, which will let
/// the compiler check lint level attributes at the place of the expression and
/// the `#[allow]` will work.
// #[track_caller]
// rustc: src/tools/clippy/clippy_utils/src/diagnostics.rs:327 span_lint_hir_and_then
export function span_lint_hir_and_then(
  cx: LateContext,
  lint: Lint,
  hir_id: HirId,
  sp: IntoMultiSpan,
  msg: IntoDiagMessage,
  f: (diag: Diag) => void,
): void {
  const emitted_at = DiagLocation.caller_();

  // #[expect(clippy::disallowed_methods)]
  cx.tcx.emit_node_span_lint(
    lint,
    hir_id,
    sp,
    DiagDecorator((diag) => {
      diag.primary_message(msg);
      diag.deref_mut().emitted_at = emitted_at;
      f(diag);
      docs_link(diag, lint);

      // #[cfg(debug_assertions)]
      // validate_diag(diag);
    }),
  );
}

/// Add a span lint with a suggestion on how to fix it.
///
/// These suggestions can be parsed by rustfix to allow it to automatically fix your code.
/// In the example below, `help` is `"try"` and `sugg` is the suggested replacement `".any(|x| x >
/// 2)"`.
///
/// If you change the signature, remember to update the internal lint `CollapsibleCalls`
///
/// NOTE: Lint emissions are always bound to a node in the HIR, which is used to determine
/// the lint level.
/// For the `span_lint_and_sugg` function, the node that was passed into the `LintPass::check_*`
/// function is used.
///
/// If you're emitting the lint at the span of a different node than the one provided by the
/// `LintPass::check_*` function, consider using [`span_lint_hir_and_then`] instead.
/// This is needed for `#[allow]` and `#[expect]` attributes to work on the node
/// highlighted in the displayed warning.
///
/// If you're unsure which function you should use, you can test if the `#[expect]` attribute works
/// where you would expect it to.
/// If it doesn't, you likely need to use [`span_lint_hir_and_then`] instead.
///
/// # Example
///
/// ```text
/// error: This `.fold` can be more succinctly expressed as `.any`
/// --> tests/ui/methods.rs:390:13
///     |
/// 390 |     let _ = (0..3).fold(false, |acc, x| acc || x > 2);
///     |                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ help: try: `.any(|x| x > 2)`
///     |
///     = note: `-D fold-any` implied by `-D warnings`
/// ```
// #[track_caller]
// rustc: src/tools/clippy/clippy_utils/src/diagnostics.rs:388 span_lint_and_sugg
export function span_lint_and_sugg(
  cx: LintContext<unknown>,
  lint: Lint,
  sp: Span,
  msg: IntoDiagMessage,
  help: IntoDiagMessage,
  sugg: string,
  applicability: Applicability,
): void {
  span_lint_and_then(cx, lint, sp, into_DiagMessage(msg), (diag) => {
    diag.span_suggestion(sp, into_DiagMessage(help), sugg, applicability);

    // This dummy construct is here to prevent the internal `clippy::collapsible_span_lint_calls`
    // lint from triggering. We don't want to allow/expect it as internal lints might or might
    // not be activated when linting, and we don't want an unknown lint warning either.
    // std::hint::black_box(());
  });
}
