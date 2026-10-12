//! Diagnostics creation and emission for `rustc`.
//!
//! This module contains the code for creating and emitting diagnostics.
// Port of compiler/rustc_errors/src/lib.rs. Types are generated into lib.gen.ts; `DiagCtxtHandle`
// and `DelayedBugPanic` are hand-written here.
import { appendFileSync } from "node:fs";
import type { RustcVersion } from "../rustc_ast/attr/version.ts";
import { AtomicRef } from "../rustc_data_structures/atomic_ref.ts";
import {
  Backtrace,
  type DiagArgValue,
  type DiagMessage,
  IntoDiagArg,
  type IntoDiagMessage,
  type IntoMultiSpan,
  MultiSpan,
  type PathBuf,
} from "../rustc_error_messages/lib.ts";
import type { MutRef } from "../rustc_span/hygiene.ts";
import { DUMMY_SP, ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import type { SourceMap } from "../rustc_span/source_map.ts";
import { type Debug, PLAIN } from "../std/fmt.ts";
import { is_whitespace } from "../std/char.ts";
import { assert, assert_eq, assert_matches, Panic, panic, panicking, unported, unwrap } from "../std/panic.ts";
import { utf8_len } from "../std/str.ts";
import { type ErrCode, display_ErrCode, try_find_description } from "./codes.ts";
import { Diag, type Diagnostic, DiagInner } from "./diagnostic.ts";
import { type ElidedLifetimeInPathSubdiag, DiagLocation_into_diag_arg as DiagLocation_into_diag_arg_lazy } from "./diagnostic_impls.ts";
import { Backtrace_into_diag_arg as Backtrace_into_diag_arg_lazy } from "../rustc_error_messages/lib.ts";
import { index_map_swap_remove } from "./decorate_diag.ts";
import { DiagMessage_arg } from "./formatting.ts";
import { type DynEmitter, type Emitter, SilentEmitter, Style_anstyle, TimingEvent } from "./emitter.ts";
import type { TimingRecord } from "./timings.ts";
import {
  DelayedDiagInner,
  DiagCtxt,
  type DiagCtxtFlags,
  DiagCtxtInner,
  type EmissionOverride,
  Level as LevelGen,
  type Level as Level_,
  type StashKey,
  Sublevel as SublevelGen,
  type Sublevel as Sublevel_,
  Style as StyleGen,
  type Style as Style_,
  SuggestionStyle as SuggestionStyleGen,
  type SuggestionStyle as SuggestionStyle_,
  Suggestions as SuggestionsGen,
  type Suggestions as Suggestions_,
  type CodeSuggestion,
  TrimmedSubstitutionPart,
  debug_Level,
} from "./lib.gen.ts";

export * from "./lib.gen.ts";
export * from "./codes.ts";
export { type BufferedEarlyLint, DecorateDiagCompat, LintBuffer, LintBuffer_default } from "./decorate_diag.ts";
export {
  Diag,
  DiagDecorator,
  DiagInner,
  DiagLocation,
  DiagStyledString,
  type Diagnostic,
  StringPart,
  Subdiag,
  type Subdiagnostic,
  debug_Diag,
  struct_span_code_err,
} from "./diagnostic.ts";
export * from "./diagnostic_impls.ts";
export {
  Backtrace,
  type DiagArg,
  DiagArgFromDisplay,
  type DiagArgMap,
  type DiagArgName,
  DiagArgValue,
  DiagMessage,
  IntoDiagArg,
  type IntoDiagMessage,
  type IntoMultiSpan,
  type LanguageIdentifier,
  MultiSpan,
  type SpanLabel,
  into_DiagMessage,
  into_MultiSpan,
  into_diag_arg_using_display,
} from "../rustc_error_messages/lib.ts";
export { ErrorGuaranteed } from "../rustc_span/lib.ts";
export { FatalError, FatalErrorMarker, catch_fatal_errors } from "../rustc_span/fatal_error.ts";
export { ExplicitBug } from "../rustc_span/macros.ts";
export { format_diag_message } from "./formatting.ts";
export * as formatting from "./formatting.ts";
export * as lock from "./lock.ts";
// Used by external projects such as `rust-gpu`.
// See https://github.com/rust-lang/rust/pull/115393.
export { AutoStream, ColorChoice } from "../vendor/anstream/lib.ts";
export { Ansi256Color, AnsiColor, Color, EffectIter, Effects, Reset, RgbColor, Style as Anstyle } from "../vendor/anstyle/lib.ts";
export { ColorConfig } from "./emitter.ts";
// PORT: `use emitter::{DynEmitter, Emitter}` is a private `use` upstream; the types are re-exported
// because lib.gen.ts (DiagCtxtInner.emitter) imports them from this module.
export type { DynEmitter, Emitter } from "./emitter.ts";
// `pub mod emitter; pub mod timings;`
// PORT: `pub mod annotate_snippet_emitter_writer;` is not re-exported here: its class extends
// `emitter::Emitter`, so loading it from this module would hit the class before emitter.ts finished
// evaluating whenever emitter.ts is the entry point (ESM cycle). Import it directly.
export * as emitter from "./emitter.ts";
export * as timings from "./timings.ts";

// ---- Stand-ins for crates that are not ported yet (PORT) ----------------------------------------

// rustc_lint_defs: `use rustc_lint_defs::LintExpectationId; pub use rustc_lint_defs::{Applicability, listify,
// pluralize};` and `rustc_lint_defs::{Level, builtin::RECURSION_DEPTH_EXCEEDING_LIMIT}` by path.
// PORT: `Lint`, `LintId`, `LintExpectationId` and `LintLevel` (= `rustc_lint_defs::Level`) are also re-exported
// here because decorate_diag.ts and the emitter port import them from this module.
import { type LintExpectationId, Level as LintLevel, type Lint, LintId } from "../rustc_lint_defs/lib.ts";
import { RECURSION_DEPTH_EXCEEDING_LIMIT } from "../rustc_lint_defs/builtin.ts";
export { Applicability, debug_Applicability, listify, pluralize } from "../rustc_lint_defs/lib.ts";
export { type Lint, LintId, type LintExpectationId, LintLevel };

/** PORT: `std::thread::ThreadId`; rust-ts is single-threaded, so every id is the main thread's. */
export type ThreadId = number;
function current_thread_id(): ThreadId {
  return 1;
}


/** `rustc_macros::msg!("..")` expands to `DiagMessage::Inline(Cow::Borrowed(".."))` (rustc_macros/src/diagnostics/message.rs:72). */
export function msg(s: string): DiagMessage {
  return { $: "Inline", _0: s };
}

/// Signifies that the compiler died due to a delayed bug rather than a failed
/// assertion, etc.
// PORT: extends `Panic` so `panic_any(DelayedBugPanic)` is an ICE, like `ExplicitBug`.
export class DelayedBugPanic extends Panic {
  constructor() {
    super("DelayedBugPanic");
    this.name = "DelayedBugPanic";
  }
}

// ---- SuggestionStyle / Suggestions ---------------------------------------------------------------

export type SuggestionStyle = SuggestionStyle_;
export const SuggestionStyle = {
  ...SuggestionStyleGen,

  // rustc: compiler/rustc_errors/src/lib.rs:107 hide_inline
  hide_inline(self: SuggestionStyle): boolean {
    return !(self === "ShowCode");
  },
};

/// Represents the help messages seen on a diagnostic.
export type Suggestions = Suggestions_;
export const Suggestions = {
  ...SuggestionsGen,

  /// Returns the underlying list of suggestions.
  // rustc: compiler/rustc_errors/src/lib.rs:132 unwrap_tag
  unwrap_tag(self: Suggestions): CodeSuggestion[] {
    switch (self.$) {
      case "Enabled":
        return self._0;
      case "Sealed":
        return self._0;
      case "Disabled":
        return [];
    }
  },

  // rustc: compiler/rustc_errors/src/lib.rs:140 len
  len(self: Suggestions): number {
    switch (self.$) {
      case "Enabled":
        return self._0.length;
      case "Sealed":
        return self._0.length;
      case "Disabled":
        return 0;
    }
  },

  // rustc: compiler/rustc_errors/src/lib.rs:150 default
  default(): Suggestions {
    return { $: "Enabled", _0: [] };
  },
};

declare module "./lib.gen.ts" {
  interface TrimmedSubstitutionPart {
    is_addition(sm: SourceMap): boolean;
    is_deletion(sm: SourceMap): boolean;
    is_replacement(sm: SourceMap): boolean;
    is_destructive_replacement(sm: SourceMap): boolean;
    replaces_meaningful_content(sm: SourceMap): boolean;
  }
}

// rustc: compiler/rustc_errors/src/lib.rs:210 is_addition
TrimmedSubstitutionPart.prototype.is_addition = function (this: TrimmedSubstitutionPart, sm: SourceMap): boolean {
  return this.snippet !== "" && !this.replaces_meaningful_content(sm);
};

// rustc: compiler/rustc_errors/src/lib.rs:214 is_deletion
TrimmedSubstitutionPart.prototype.is_deletion = function (this: TrimmedSubstitutionPart, sm: SourceMap): boolean {
  return str_trim(this.snippet) === "" && this.replaces_meaningful_content(sm);
};

// rustc: compiler/rustc_errors/src/lib.rs:218 is_replacement
TrimmedSubstitutionPart.prototype.is_replacement = function (this: TrimmedSubstitutionPart, sm: SourceMap): boolean {
  return this.snippet !== "" && this.replaces_meaningful_content(sm);
};

/// Whether this is a replacement that overwrites source with a snippet
/// in a way that isn't a superset of the original string. For example,
/// replacing "abc" with "abcde" is not destructive, but replacing it
/// it with "abx" is, since the "c" character is lost.
// rustc: compiler/rustc_errors/src/lib.rs:226 is_destructive_replacement
TrimmedSubstitutionPart.prototype.is_destructive_replacement = function (
  this: TrimmedSubstitutionPart,
  sm: SourceMap,
): boolean {
  if (!this.is_replacement(sm)) return false;
  const r = sm.span_to_snippet(this.span);
  const is_ok_and = r.$ === "Ok" && as_substr(str_trim(r._0.toString()), str_trim(this.snippet)) !== undefined;
  return !is_ok_and;
};

// rustc: compiler/rustc_errors/src/lib.rs:233 replaces_meaningful_content
TrimmedSubstitutionPart.prototype.replaces_meaningful_content = function (
  this: TrimmedSubstitutionPart,
  sm: SourceMap,
): boolean {
  const r = sm.span_to_snippet(this.span);
  return r.$ === "Ok" ? str_trim(r._0.toString()) !== "" : !Span.is_empty(this.span);
};

/** PORT: `str::trim` (Unicode `White_Space`, unlike JS `trim`, which also strips U+FEFF). Belongs in src/std/str.ts. */
export function str_trim(s: string): string {
  const cps = Array.from(s);
  let a = 0;
  let b = cps.length;
  while (a < b && is_whitespace(cps[a]!.codePointAt(0)!)) a++;
  while (b > a && is_whitespace(cps[b - 1]!.codePointAt(0)!)) b--;
  return cps.slice(a, b).join("");
}

/// Given an original string like `AACC`, and a suggestion like `AABBCC`, try to detect
/// the case where a substring of the suggestion is "sandwiched" in the original, like
/// `BB` is. Return the length of the prefix, the "trimmed" suggestion, and the length
/// of the suffix.
// PORT: lengths are UTF-8 byte lengths as upstream; slicing is done on code points.
// rustc: compiler/rustc_errors/src/lib.rs:243 as_substr
export function as_substr(original_: string, suggestion_: string): [number, string, number] | undefined {
  const oc = Array.from(original_);
  const sc = Array.from(suggestion_);
  let n = 0;
  while (n < oc.length && n < sc.length && oc[n] === sc[n]) n++;
  const common_prefix = utf8_len(oc.slice(0, n).join(""));
  const original = oc.slice(n).join("");
  const suggestion = sc.slice(n).join("");
  if (suggestion.endsWith(original)) {
    const common_suffix = utf8_len(original);
    return [common_prefix, suggestion.slice(0, suggestion.length - original.length), common_suffix];
  } else {
    return undefined;
  }
}

// ---- DiagCtxt -----------------------------------------------------------------------------------

// rustc: compiler/rustc_errors/src/lib.rs:396 default_track_diagnostic
function default_track_diagnostic<R>(diag: DiagInner, f: (diag: DiagInner) => R): R {
  return f(diag);
}

/// Diagnostics emitted by `DiagCtxtInner::emit_diagnostic` are passed through this function. Used
/// for tracking by incremental, to replay diagnostics as necessary.
export const TRACK_DIAGNOSTIC: AtomicRef<
  (diag: DiagInner, f: (diag: DiagInner) => ErrorGuaranteed | undefined) => ErrorGuaranteed | undefined
> = AtomicRef.new(default_track_diagnostic);

/** `#[derive(Default)]` for `DiagCtxtFlags`. */
export function DiagCtxtFlags_default(): DiagCtxtFlags {
  return {
    can_emit_warnings: false,
    treat_err_as_bug: undefined,
    eagerly_emit_delayed_bugs: false,
    macro_backtrace: false,
    deduplicate_diagnostics: false,
    track_diagnostics: false,
  };
}

declare module "./lib.gen.ts" {
  interface DiagCtxt {
    disable_warnings(): DiagCtxt;
    with_flags(flags: DiagCtxtFlags): DiagCtxt;
    with_ice_file(ice_file: PathBuf): DiagCtxt;
    with_msrv(msrv: RustcVersion): DiagCtxt;
    handle(): DiagCtxtHandle;
  }
  namespace DiagCtxt {
    function new_(emitter: Emitter): DiagCtxt;
    export { new_ as new };
  }
  interface DiagCtxtInner {
    /// PORT: drop-bomb registry, no upstream field. Every `Diag` that still holds its
    /// `DiagInner`, in creation order (see `Diag` in diagnostic.ts). Created lazily.
    live_diags?: Set<Diag>;
    drop(): void;
    emit_stashed_diagnostics(): ErrorGuaranteed | undefined;
    emit_diagnostic(diagnostic: DiagInner, taint: MutRef<ErrorGuaranteed | undefined> | undefined): ErrorGuaranteed | undefined;
    treat_err_as_bug(): boolean;
    treat_next_err_as_bug(): boolean;
    has_errors_excluding_lint_errors(): ErrorGuaranteed | undefined;
    has_errors(): ErrorGuaranteed | undefined;
    has_errors_or_delayed_bugs(): ErrorGuaranteed | undefined;
    flush_delayed(): void;
    panic_if_treat_err_as_bug(): void;
  }
  namespace DiagCtxtInner {
    function new_(emitter: Emitter): DiagCtxtInner;
    export { new_ as new };
  }
  interface DelayedDiagInner {
    decorate(): DiagInner;
  }
  namespace DelayedDiagInner {
    export let with_backtrace: (diagnostic: DiagInner, backtrace: Backtrace) => DelayedDiagInner;
  }
}

// PORT: `impl Drop for DiagCtxtInner`. JS has no destructors: the driver calls this where
// upstream drops the `Session` (`drop_compiler_dcx` in src/rust_ts/driver.ts; inside
// `while_unwinding` on the panic path, so `std::thread::panicking()` is true there as upstream).
// Upstream every `Diag` borrows the `DiagCtxt` and is dropped before it; JS cannot run those
// drops at scope end, so the `Diag`s still alive (`live_diags`) are dropped first, in creation
// order. An unconsumed one fires its bomb here (outside `while_unwinding`).
// rustc: compiler/rustc_errors/src/lib.rs:427 drop
DiagCtxtInner.prototype.drop = function (this: DiagCtxtInner): void {
  if (this.live_diags !== undefined) {
    for (const diag of [...this.live_diags]) diag.drop();
  }

  // For tools using `interface::run_compiler` (e.g. rustc, rustdoc)
  // stashed diagnostics will have already been emitted. But for others
  // that don't use `interface::run_compiler` (e.g. rustfmt, some clippy
  // lints) this fallback is necessary.
  //
  // Important: it is sound to produce an `ErrorGuaranteed` when stashing
  // errors because they are guaranteed to be emitted here or earlier.
  this.emit_stashed_diagnostics();

  // Important: it is sound to produce an `ErrorGuaranteed` when emitting
  // delayed bugs because they are guaranteed to be emitted here if
  // necessary.
  this.flush_delayed();

  // Sanity check: did we use some of the expensive `trimmed_def_paths` functions
  // unexpectedly, that is, without producing diagnostics? If so, for debugging purposes, we
  // suggest where this happened and how to avoid it.
  if (!this.has_printed && !this.suppressed_expected_diag && !panicking()) {
    const backtrace = this.must_produce_diag;
    if (backtrace !== undefined) {
      let suggestion: string;
      switch (backtrace.status()) {
        case "Disabled":
          suggestion =
            "Backtraces are currently disabled: set `RUST_BACKTRACE=1` and re-run to see where it happened.";
          break;
        case "Captured":
          suggestion = `This happened in the following \`must_produce_diag\` call's backtrace:\n${backtrace.to_string()}`;
          break;
        default:
          suggestion = "(impossible to capture backtrace where this happened)";
      }
      panic(
        `\`trimmed_def_paths\` called, diagnostics were expected but none were emitted. Use \`with_no_trimmed_paths\` for debugging. ${suggestion}`,
      );
    }
  }
};

// rustc: compiler/rustc_errors/src/lib.rs:468 disable_warnings
DiagCtxt.prototype.disable_warnings = function (this: DiagCtxt): DiagCtxt {
  this.inner.flags.can_emit_warnings = false;
  return this;
};

// rustc: compiler/rustc_errors/src/lib.rs:473 with_flags
DiagCtxt.prototype.with_flags = function (this: DiagCtxt, flags: DiagCtxtFlags): DiagCtxt {
  this.inner.flags = flags;
  return this;
};

// rustc: compiler/rustc_errors/src/lib.rs:478 with_ice_file
DiagCtxt.prototype.with_ice_file = function (this: DiagCtxt, ice_file: PathBuf): DiagCtxt {
  this.inner.ice_file = ice_file;
  return this;
};

// rustc: compiler/rustc_errors/src/lib.rs:483 with_msrv
DiagCtxt.prototype.with_msrv = function (this: DiagCtxt, msrv: RustcVersion): DiagCtxt {
  this.inner.msrv = msrv;
  return this;
};

// rustc: compiler/rustc_errors/src/lib.rs:488 new
(DiagCtxt as unknown as { new: (emitter: Emitter) => DiagCtxt }).new = function (emitter: Emitter): DiagCtxt {
  return new DiagCtxt(DiagCtxtInner.new(emitter));
};

// rustc: compiler/rustc_errors/src/lib.rs:492 handle
DiagCtxt.prototype.handle = function (this: DiagCtxt): DiagCtxtHandle {
  return new DiagCtxtHandle(this, undefined);
};

/** `#[derive(Copy, Clone)] pub struct DiagCtxtHandle<'a>` */
// PORT: hand-written: `tainted_with_errors: Option<&'a Cell<Option<ErrorGuaranteed>>>` is a shared
// mutable cell, modelled as a `MutRef`.
export class DiagCtxtHandle {
  constructor(
    public dcx: DiagCtxt,
    /// Some contexts create `DiagCtxtHandle` with this field set, and thus all
    /// errors emitted with it will automatically taint when emitting errors.
    public tainted_with_errors: MutRef<ErrorGuaranteed | undefined> | undefined,
  ) {}

  // rustc: compiler/rustc_errors/src/lib.rs:498 make_silent
  make_silent(): void {
    const inner = this.dcx.inner;
    inner.emitter = new SilentEmitter();
  }

  // rustc: compiler/rustc_errors/src/lib.rs:503 set_emitter
  set_emitter(emitter: Emitter): void {
    this.dcx.inner.emitter = emitter;
  }

  // This is here to not allow mutation of flags; as of this writing it's used in
  // `emit_lint_base` and in tests in `rustc_interface`.
  // rustc: compiler/rustc_errors/src/lib.rs:509 can_emit_warnings
  can_emit_warnings(): boolean {
    return this.dcx.inner.flags.can_emit_warnings;
  }

  /// Resets the diagnostic error count as well as the cached emitted diagnostics.
  ///
  /// NOTE: *do not* call this function from rustc. It is only meant to be called from external
  /// tools that want to reuse a `Parser` cleaning the previously emitted diagnostics as well as
  /// the overall count of emitted error diagnostics.
  // rustc: compiler/rustc_errors/src/lib.rs:518 reset_err_count
  reset_err_count(): void {
    const inner = this.dcx.inner;
    // For the `Vec`s and `HashMap`s, we overwrite with an empty container to free the
    // underlying memory (which `clear` would not do).
    inner.err_guars = [];
    inner.lint_err_guars = [];
    inner.delayed_bugs = [];
    inner.deduplicated_err_count = 0;
    inner.deduplicated_warn_count = 0;
    inner.must_produce_diag = undefined;
    inner.has_printed = false;
    inner.suppressed_expected_diag = false;
    inner.taught_diagnostics = new Set();
    inner.emitted_diagnostic_codes = new Set();
    inner.emitted_diagnostics = new Set();
    inner.emitted_recursion_depth_exceeding_limit = false;
    inner.stashed_diagnostics = new Map();
    inner.future_breakage_diagnostics = [];
    inner.fulfilled_expectations = new Set();
  }

  /// Link this to a taintable context so that emitting errors will automatically set
  /// the `Option<ErrorGuaranteed>` instead of having to do that manually at every error
  /// emission site.
  // rustc: compiler/rustc_errors/src/lib.rs:566 into_taintable
  into_taintable(tainted_with_errors: MutRef<ErrorGuaranteed | undefined>): DiagCtxtHandle {
    return new DiagCtxtHandle(this.dcx, tainted_with_errors);
  }

  /// Stashes a diagnostic for possible later improvement in a different,
  /// later stage of the compiler. Possible actions depend on the diagnostic
  /// level:
  /// - Level::Bug, Level:Fatal: not allowed, will trigger a panic.
  /// - Level::Error: immediately counted as an error that has occurred, because it
  ///   is guaranteed to be emitted eventually. Can be later accessed with the
  ///   provided `span` and `key` through
  ///   [`DiagCtxtHandle::try_steal_modify_and_emit_err`] or
  ///   [`DiagCtxtHandle::try_steal_replace_and_emit_err`]. These do not allow
  ///   cancellation or downgrading of the error. Returns
  ///   `Some(ErrorGuaranteed)`.
  /// - Level::DelayedBug: this does happen occasionally with errors that are
  ///   downgraded to delayed bugs. It is not stashed, but immediately
  ///   emitted as a delayed bug. This is because stashing it would cause it
  ///   to be counted by `err_count` which we don't want. It doesn't matter
  ///   that we cannot steal and improve it later, because it's not a
  ///   user-facing error. Returns `Some(ErrorGuaranteed)` as is normal for
  ///   delayed bugs.
  /// - Level::Warning and lower (i.e. !is_error()): can be accessed with the
  ///   provided `span` and `key` through [`DiagCtxtHandle::steal_non_err()`]. This
  ///   allows cancelling and downgrading of the diagnostic. Returns `None`.
  // rustc: compiler/rustc_errors/src/lib.rs:594 stash_diagnostic
  stash_diagnostic(span: Span, key: StashKey, diag: DiagInner): ErrorGuaranteed | undefined {
    let guar: ErrorGuaranteed | undefined;
    switch (diag.level.$) {
      case "Bug":
      case "Fatal":
        return this.span_bug(span, `invalid level in \`stash_diagnostic\`: ${debug_Level(diag.level, PLAIN)}`);
      // We delay a bug here so that `-Ztreat-err-as-bug -Zeagerly-emit-delayed-bugs`
      // can be used to create a backtrace at the stashing site instead of whenever the
      // diagnostic context is dropped and thus delayed bugs are emitted.
      case "Error":
        guar = this.span_delayed_bug(span, `stashing ${key}`);
        break;
      case "DelayedBug":
        return this.dcx.inner.emit_diagnostic(diag, this.tainted_with_errors);
      case "Warning":
      case "Note":
      case "Help":
      case "FailureNote":
        guar = undefined;
        break;
    }

    // FIXME(Centril, #69537): Consider reintroducing panic on overwriting a stashed diagnostic
    // if/when we have a more robust macro-friendly replacement for `(span, key)` as a key.
    // See the PR for a discussion.
    const stashed = this.dcx.inner.stashed_diagnostics;
    let by_span = stashed.get(key);
    if (by_span === undefined) {
      by_span = new Map();
      stashed.set(key, by_span);
    }
    by_span.set(Span.with_parent(span, undefined), [diag, guar, current_thread_id()]);

    return guar;
  }

  /// Steal a previously stashed non-error diagnostic with the given `Span`
  /// and [`StashKey`] as the key. Panics if the found diagnostic is an
  /// error.
  // rustc: compiler/rustc_errors/src/lib.rs:634 steal_non_err
  steal_non_err(span: Span, key: StashKey): Diag | undefined {
    // FIXME(#120456) - is `swap_remove` correct?
    const stashed_diagnostics = this.dcx.inner.stashed_diagnostics.get(key);
    const found =
      stashed_diagnostics === undefined
        ? undefined
        : index_map_swap_remove(stashed_diagnostics, Span.with_parent(span, undefined));
    if (found === undefined) return undefined;
    const [diag, guar, _] = found;
    assert(!diag.is_error(), "assertion failed: !diag.is_error()");
    assert(guar === undefined, "assertion failed: guar.is_none()");
    return Diag.new_diagnostic(this, diag);
  }

  /// Steals a previously stashed error with the given `Span` and
  /// [`StashKey`] as the key, modifies it, and emits it. Returns `None` if
  /// no matching diagnostic is found. Panics if the found diagnostic's level
  /// isn't `Level::Error`.
  // rustc: compiler/rustc_errors/src/lib.rs:649 try_steal_modify_and_emit_err
  try_steal_modify_and_emit_err(span: Span, key: StashKey, modify_err: (err: Diag) => void): ErrorGuaranteed | undefined {
    // FIXME(#120456) - is `swap_remove` correct?
    const stashed_diagnostics = this.dcx.inner.stashed_diagnostics.get(key);
    const err =
      stashed_diagnostics === undefined
        ? undefined
        : index_map_swap_remove(stashed_diagnostics, Span.with_parent(span, undefined));
    if (err === undefined) return undefined;
    const [err_inner, guar, _] = err;
    assert_eq(err_inner.level, Level.Error, debug_level, Level_eq);
    assert(guar !== undefined, "assertion failed: guar.is_some()");
    const diag = Diag.new_diagnostic(this, err_inner);
    modify_err(diag);
    assert_eq(diag.deref().level, Level.Error, debug_level, Level_eq);
    return diag.emit_err();
  }

  /// Steals a previously stashed error with the given `Span` and
  /// [`StashKey`] as the key, cancels it if found, and emits `new_err`.
  /// Panics if the found diagnostic's level isn't `Level::Error`.
  // rustc: compiler/rustc_errors/src/lib.rs:675 try_steal_replace_and_emit_err
  try_steal_replace_and_emit_err(span: Span, key: StashKey, new_err: Diag): ErrorGuaranteed {
    // FIXME(#120456) - is `swap_remove` correct?
    const stashed_diagnostics = this.dcx.inner.stashed_diagnostics.get(key);
    const old_err =
      stashed_diagnostics === undefined
        ? undefined
        : index_map_swap_remove(stashed_diagnostics, Span.with_parent(span, undefined));
    if (old_err !== undefined) {
      const [old, guar, _] = old_err;
      assert_eq(old.level, Level.Error, debug_level, Level_eq);
      assert(guar !== undefined, "assertion failed: guar.is_some()");
      // Because `old_err` has already been counted, it can only be
      // safely cancelled because the `new_err` supplants it.
      Diag.new_diagnostic(this, old).cancel();
    }
    return new_err.emit_err();
  }

  // rustc: compiler/rustc_errors/src/lib.rs:698 has_stashed_diagnostic
  has_stashed_diagnostic(span: Span, key: StashKey): boolean {
    const inner = this.dcx.inner;
    const stashed_diagnostics = inner.stashed_diagnostics.get(key);
    if (stashed_diagnostics !== undefined && stashed_diagnostics.size !== 0) {
      return stashed_diagnostics.has(Span.with_parent(span, undefined));
    } else {
      return false;
    }
  }

  /// Emit all stashed diagnostics.
  // rustc: compiler/rustc_errors/src/lib.rs:710 emit_stashed_diagnostics
  emit_stashed_diagnostics(): ErrorGuaranteed | undefined {
    return this.dcx.inner.emit_stashed_diagnostics();
  }

  /// This excludes delayed bugs.
  // rustc: compiler/rustc_errors/src/lib.rs:716 err_count
  err_count(): number {
    const inner = this.dcx.inner;
    let stashed = 0;
    for (const a of inner.stashed_diagnostics.values()) {
      for (const [_, guar, _t] of a.values()) if (guar !== undefined) stashed++;
    }
    return inner.err_guars.length + inner.lint_err_guars.length + stashed;
  }

  /// The number of errors that have been emitted on the *current thread*.
  ///
  /// Like [`DiagCtxtHandle::err_count`], but only counts errors whose recorded
  /// emitting thread is the calling thread.
  // rustc: compiler/rustc_errors/src/lib.rs:731 err_count_on_current_thread
  err_count_on_current_thread(): number {
    const inner = this.dcx.inner;
    const current = current_thread_id();
    let stashed = 0;
    for (const a of inner.stashed_diagnostics.values()) {
      for (const [_, guar, thread] of a.values()) if (guar !== undefined && thread === current) stashed++;
    }
    return (
      inner.err_guars.filter(([_, thread]) => thread === current).length +
      inner.lint_err_guars.filter(([_, thread]) => thread === current).length +
      stashed
    );
  }

  /// This excludes lint errors and delayed bugs. Unless absolutely
  /// necessary, prefer `has_errors` to this method.
  // rustc: compiler/rustc_errors/src/lib.rs:749 has_errors_excluding_lint_errors
  has_errors_excluding_lint_errors(): ErrorGuaranteed | undefined {
    return this.dcx.inner.has_errors_excluding_lint_errors();
  }

  /// This excludes delayed bugs.
  // rustc: compiler/rustc_errors/src/lib.rs:754 has_errors
  has_errors(): ErrorGuaranteed | undefined {
    return this.dcx.inner.has_errors();
  }

  /// This excludes nothing. Unless absolutely necessary, prefer `has_errors`
  /// to this method.
  // rustc: compiler/rustc_errors/src/lib.rs:760 has_errors_or_delayed_bugs
  has_errors_or_delayed_bugs(): ErrorGuaranteed | undefined {
    return this.dcx.inner.has_errors_or_delayed_bugs();
  }

  // rustc: compiler/rustc_errors/src/lib.rs:764 print_error_count
  print_error_count(): void {
    const inner = this.dcx.inner;

    // Any stashed diagnostics should have been handled by
    // `emit_stashed_diagnostics` by now.
    assert(inner.stashed_diagnostics.size === 0, "assertion failed: inner.stashed_diagnostics.is_empty()");

    if (inner.treat_err_as_bug()) {
      return;
    }

    const warnings =
      inner.deduplicated_warn_count === 0
        ? ""
        : inner.deduplicated_warn_count === 1
          ? "1 warning emitted"
          : `${inner.deduplicated_warn_count} warnings emitted`;
    const errors =
      inner.deduplicated_err_count === 0
        ? ""
        : inner.deduplicated_err_count === 1
          ? "aborting due to 1 previous error"
          : `aborting due to ${inner.deduplicated_err_count} previous errors`;

    if (errors.length === 0 && warnings.length === 0) {
      return;
    } else if (errors.length === 0) {
      // Force emission so this message always prints.
      const diag = DiagInner.new(
        { $: "Warning", _0: { $: "Forced", lint_id: undefined } },
        { $: "Str", _0: warnings },
      );
      inner.emit_diagnostic(diag, undefined);
    } else if (warnings.length === 0) {
      inner.emit_diagnostic(DiagInner.new(Level.Error, errors), this.tainted_with_errors);
    } else {
      inner.emit_diagnostic(DiagInner.new(Level.Error, `${errors}; ${warnings}`), this.tainted_with_errors);
    }

    const can_show_explain = inner.emitter.should_show_explain();
    const are_there_diagnostics = inner.emitted_diagnostic_codes.size !== 0;
    if (can_show_explain && are_there_diagnostics) {
      const error_codes: string[] = [];
      for (const code of inner.emitted_diagnostic_codes) {
        if (try_find_description(code).$ === "Ok") {
          error_codes.push(display_ErrCode(code));
        }
      }
      if (error_codes.length !== 0) {
        // `Vec<String>::sort`: byte-wise; the codes are ASCII, so UTF-16 order is the same.
        error_codes.sort();
        if (error_codes.length > 1) {
          const limit = error_codes.length > 9 ? 9 : error_codes.length;
          const msg1 = `Some errors have detailed explanations: ${error_codes.slice(0, limit).join(", ")}${
            error_codes.length > 9 ? "..." : "."
          }`;
          const msg2 = `For more information about an error, try \`rustc --explain ${error_codes[0]}\`.`;
          inner.emit_diagnostic(DiagInner.new(Level.FailureNote, msg1), undefined);
          inner.emit_diagnostic(DiagInner.new(Level.FailureNote, msg2), undefined);
        } else {
          const msg = `For more information about this error, try \`rustc --explain ${error_codes[0]}\`.`;
          inner.emit_diagnostic(DiagInner.new(Level.FailureNote, msg), undefined);
        }
      }
    }
  }

  /// This excludes delayed bugs. Used for early aborts after errors occurred
  /// -- e.g. because continuing in the face of errors is likely to lead to
  /// bad results, such as spurious/uninteresting additional errors -- when
  /// returning an error `Result` is difficult.
  // rustc: compiler/rustc_errors/src/lib.rs:851 abort_if_errors
  abort_if_errors(): void {
    const guar = this.has_errors();
    if (guar !== undefined) {
      guar.raise_fatal();
    }
  }

  /// `true` if we haven't taught a diagnostic with this code already.
  /// The caller must then teach the user about such a diagnostic.
  ///
  /// Used to suppress emitting the same error multiple times with extended explanation when
  /// calling `-Zteach`.
  // rustc: compiler/rustc_errors/src/lib.rs:862 must_teach
  must_teach(code: ErrCode): boolean {
    const set = this.dcx.inner.taught_diagnostics;
    if (set.has(code)) return false;
    set.add(code);
    return true;
  }

  // rustc: compiler/rustc_errors/src/lib.rs:866 emit_diagnostic
  emit_diagnostic(diagnostic: DiagInner): ErrorGuaranteed | undefined {
    return this.dcx.inner.emit_diagnostic(diagnostic, this.tainted_with_errors);
  }

  // rustc: compiler/rustc_errors/src/lib.rs:870 emit_artifact_notification
  emit_artifact_notification(path: string, artifact_type: string): void {
    this.dcx.inner.emitter.emit_artifact_notification(path, artifact_type);
  }

  // rustc: compiler/rustc_errors/src/lib.rs:874 emit_timing_section_start
  emit_timing_section_start(record: TimingRecord): void {
    this.dcx.inner.emitter.emit_timing_section(record, TimingEvent.Start);
  }

  // rustc: compiler/rustc_errors/src/lib.rs:878 emit_timing_section_end
  emit_timing_section_end(record: TimingRecord): void {
    this.dcx.inner.emitter.emit_timing_section(record, TimingEvent.End);
  }

  // rustc: compiler/rustc_errors/src/lib.rs:882 emit_future_breakage_report
  emit_future_breakage_report(): void {
    const inner = this.dcx.inner;
    const diags = inner.future_breakage_diagnostics;
    inner.future_breakage_diagnostics = [];
    if (diags.length !== 0) {
      inner.emitter.emit_future_breakage_report(diags);
    }
  }

  // rustc: compiler/rustc_errors/src/lib.rs:890 emit_unused_externs
  emit_unused_externs(lint_level: LintLevel, loud: boolean, unused_externs: readonly string[]): void {
    const inner = this.dcx.inner;

    // This "error" is an odd duck.
    // - It's only produce with JSON output.
    // - It's not emitted the usual way, via `emit_diagnostic`.
    // - The `$message_type` field is "unused_externs" rather than the usual
    //   "diagnostic".
    //
    // We count it as a lint error because it has a lint level. The value
    // of `loud` (which comes from "unused-externs" or
    // "unused-externs-silent"), also affects whether it's treated like a
    // hard error or not.
    if (loud && LintLevel.is_error(lint_level)) {
      // This `unchecked_error_guaranteed` is valid. It is where the
      // `ErrorGuaranteed` for unused_extern errors originates.
      const guar = ErrorGuaranteed.unchecked_error_guaranteed();
      inner.lint_err_guars.push([guar, current_thread_id()]);
      inner.panic_if_treat_err_as_bug();
    }

    inner.emitter.emit_unused_externs(lint_level, unused_externs);
  }

  /// We need to make sure that submitted expectation ids are correctly fulfilled, suppressed,
  /// and stored between compilation sessions. To avoid doing these steps manually, we create a
  /// dummy diagnostic and emit it as usual, which will be suppressed and stored like a normal
  /// expected lint diagnostic.
  // rustc: compiler/rustc_errors/src/lib.rs:925 fulfill_expectation
  fulfill_expectation(expectation: LintExpectationId): void {
    const emission_override: EmissionOverride = { $: "Expected", lint_id: expectation };
    const msg = "this is a dummy diagnostic, to submit and store an expectation";
    Diag.new(this, { $: "Warning", _0: emission_override }, msg).emit();
  }

  /// This methods steals all [`LintExpectationId`]s that are stored inside
  /// [`DiagCtxtInner`] and indicate that the linked expectation has been fulfilled.
  // rustc: compiler/rustc_errors/src/lib.rs:934 steal_fulfilled_expectation_ids
  steal_fulfilled_expectation_ids(): Set<LintExpectationId> {
    const s = this.dcx.inner.fulfilled_expectations;
    this.dcx.inner.fulfilled_expectations = new Set();
    return s;
  }

  /// Trigger an ICE if there are any delayed bugs and no hard errors.
  ///
  /// This will panic if there are any stashed diagnostics. You can call
  /// `emit_stashed_diagnostics` to emit those before calling `flush_delayed`.
  // rustc: compiler/rustc_errors/src/lib.rs:942 flush_delayed
  flush_delayed(): void {
    this.dcx.inner.flush_delayed();
  }

  /// Used when trimmed_def_paths is called and we must produce a diagnostic
  /// to justify its cost.
  // rustc: compiler/rustc_errors/src/lib.rs:949 set_must_produce_diag
  set_must_produce_diag(): void {
    assert(this.dcx.inner.must_produce_diag === undefined, "should only need to collect a backtrace once");
    this.dcx.inner.must_produce_diag = Backtrace.capture();
  }

  // This `impl` block contains only the public diagnostic creation/emission API.
  //
  // Functions beginning with `struct_`/`create_` create a diagnostic. Other
  // functions create and emit a diagnostic all in one go.

  // rustc: compiler/rustc_errors/src/lib.rs:964 struct_bug
  struct_bug(msg: string): Diag {
    return Diag.new(this, Level.Bug, msg);
  }

  // rustc: compiler/rustc_errors/src/lib.rs:969 bug
  bug(msg: string): never {
    return this.struct_bug(msg).emit_bug();
  }

  // rustc: compiler/rustc_errors/src/lib.rs:974 struct_span_bug
  struct_span_bug(span: IntoMultiSpan, msg: string): Diag {
    return this.struct_bug(msg).with_span(span);
  }

  // rustc: compiler/rustc_errors/src/lib.rs:983 span_bug
  span_bug(span: IntoMultiSpan, msg: string): never {
    return this.struct_span_bug(span, msg).emit_bug();
  }

  // rustc: compiler/rustc_errors/src/lib.rs:988 create_bug
  create_bug(bug: Diagnostic): Diag {
    return bug.into_diag(this, Level.Bug);
  }

  // rustc: compiler/rustc_errors/src/lib.rs:993 emit_bug
  emit_bug(bug: Diagnostic): never {
    return this.create_bug(bug).emit_bug();
  }

  // rustc: compiler/rustc_errors/src/lib.rs:998 struct_fatal
  struct_fatal(msg: IntoDiagMessage): Diag {
    return Diag.new(this, Level.Fatal, msg);
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1003 fatal
  fatal(msg: IntoDiagMessage): never {
    return this.struct_fatal(msg).emit_fatal();
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1008 struct_span_fatal
  struct_span_fatal(span: IntoMultiSpan, msg: IntoDiagMessage): Diag {
    return this.struct_fatal(msg).with_span(span);
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1017 span_fatal
  span_fatal(span: IntoMultiSpan, msg: IntoDiagMessage): never {
    return this.struct_span_fatal(span, msg).emit_fatal();
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1022 create_fatal
  create_fatal(fatal: Diagnostic): Diag {
    return fatal.into_diag(this, Level.Fatal);
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1027 emit_fatal
  emit_fatal(fatal: Diagnostic): never {
    return this.create_fatal(fatal).emit_fatal();
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1032 struct_err
  struct_err(msg: IntoDiagMessage): Diag {
    return Diag.new(this, Level.Error, msg);
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1037 err
  err(msg: IntoDiagMessage): ErrorGuaranteed {
    return this.struct_err(msg).emit_err();
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1042 struct_span_err
  struct_span_err(span: IntoMultiSpan, msg: IntoDiagMessage): Diag {
    return this.struct_err(msg).with_span(span);
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1051 span_err
  span_err(span: IntoMultiSpan, msg: IntoDiagMessage): ErrorGuaranteed {
    return this.struct_span_err(span, msg).emit_err();
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1060 create_err
  create_err(err: Diagnostic): Diag {
    return err.into_diag(this, Level.Error);
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1065 emit_err
  emit_err(err: Diagnostic): ErrorGuaranteed {
    return this.create_err(err).emit_err();
  }

  /// Ensures that an error is printed. See [`Level::DelayedBug`].
  // rustc: compiler/rustc_errors/src/lib.rs:1071 delayed_bug
  delayed_bug(msg: string): ErrorGuaranteed {
    return Diag.new(this, Level.DelayedBug, msg).emit_err();
  }

  /// Ensures that an error is printed. See [`Level::DelayedBug`].
  ///
  /// Note: this function used to be called `delay_span_bug`. It was renamed
  /// to match similar functions like `span_err`, `span_warn`, etc.
  // rustc: compiler/rustc_errors/src/lib.rs:1080 span_delayed_bug
  span_delayed_bug(sp: IntoMultiSpan, msg: string): ErrorGuaranteed {
    return Diag.new(this, Level.DelayedBug, msg).with_span(sp).emit_err();
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1089 struct_warn
  struct_warn(msg: IntoDiagMessage): Diag {
    return Diag.new(this, { $: "Warning", _0: undefined }, msg);
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1094 warn
  warn(msg: IntoDiagMessage): void {
    this.struct_warn(msg).emit();
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1099 struct_span_warn
  struct_span_warn(span: IntoMultiSpan, msg: IntoDiagMessage): Diag {
    return this.struct_warn(msg).with_span(span);
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1108 span_warn
  span_warn(span: IntoMultiSpan, msg: IntoDiagMessage): void {
    this.struct_span_warn(span, msg).emit();
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1113 create_warn
  create_warn(warning: Diagnostic): Diag {
    return warning.into_diag(this, { $: "Warning", _0: undefined });
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1118 emit_warn
  emit_warn(warning: Diagnostic): void {
    this.create_warn(warning).emit();
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1123 struct_note
  struct_note(msg: IntoDiagMessage): Diag {
    return Diag.new(this, Level.Note, msg);
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1128 note
  note(msg: IntoDiagMessage): void {
    this.struct_note(msg).emit();
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1133 struct_span_note
  struct_span_note(span: IntoMultiSpan, msg: IntoDiagMessage): Diag {
    return this.struct_note(msg).with_span(span);
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1142 span_note
  span_note(span: IntoMultiSpan, msg: IntoDiagMessage): void {
    this.struct_span_note(span, msg).emit();
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1147 create_note
  create_note(note: Diagnostic): Diag {
    return note.into_diag(this, Level.Note);
  }

  // rustc: compiler/rustc_errors/src/lib.rs:1152 emit_note
  emit_note(note: Diagnostic): void {
    this.create_note(note).emit();
  }
}

// rustc: compiler/rustc_errors/src/lib.rs:1158 new
(DiagCtxtInner as unknown as { new: (emitter: Emitter) => DiagCtxtInner }).new = function (
  emitter: Emitter,
): DiagCtxtInner {
  return new DiagCtxtInner(
    { ...DiagCtxtFlags_default(), can_emit_warnings: true },
    [],
    [],
    [],
    0,
    0,
    emitter,
    undefined,
    false,
    false,
    new Set(),
    new Set(),
    new Set(),
    false,
    new Map(),
    [],
    new Set(),
    undefined,
    undefined,
  );
};

/// Emit all stashed diagnostics.
// rustc: compiler/rustc_errors/src/lib.rs:1183 emit_stashed_diagnostics
DiagCtxtInner.prototype.emit_stashed_diagnostics = function (this: DiagCtxtInner): ErrorGuaranteed | undefined {
  let guar: ErrorGuaranteed | undefined = undefined;
  const has_errors = this.err_guars.length !== 0;
  const stashed = this.stashed_diagnostics;
  this.stashed_diagnostics = new Map();
  for (const [_, stashed_diagnostics] of stashed) {
    for (const [_s, [diag, _guar, _thread]] of stashed_diagnostics) {
      // When there are errors, skip flushing of stashed unforced warnings, to avoid
      // warning overload. (They would have been stolen already if they were important.)
      if (has_errors && diag.level.$ === "Warning") {
        const emission_override = diag.level._0;
        if (!(emission_override !== undefined && emission_override.$ === "Forced")) {
          continue;
        }
      }
      const g = this.emit_diagnostic(diag, undefined);
      guar = guar ?? g;
    }
  }
  return guar;
};

// Return value is only `Some` if the level is `Error` or `DelayedBug`.
// rustc: compiler/rustc_errors/src/lib.rs:1203 emit_diagnostic
DiagCtxtInner.prototype.emit_diagnostic = function (
  this: DiagCtxtInner,
  diagnostic: DiagInner,
  taint: MutRef<ErrorGuaranteed | undefined> | undefined,
): ErrorGuaranteed | undefined {
  if (diagnostic.has_future_breakage()) {
    // About the `allow`/`expect` lint sub-cases of `Warning`: future breakages aren't
    // emitted for them, but they still need to be handled below so they'll trigger the
    // `must_produce_diag` check.
    assert_matches(
      diagnostic.level,
      diagnostic.level.$ === "Error" || diagnostic.level.$ === "Warning",
      "Error | Warning(_)",
      debug_level,
    );
    this.future_breakage_diagnostics.push(diagnostic.clone());
  }

  // We call TRACK_DIAGNOSTIC with an empty closure for the cases that
  // return early *and* have some kind of side-effect, except where
  // noted.
  const level = diagnostic.level;
  switch (level.$) {
    case "Bug":
      break;
    case "Fatal":
    case "Error":
      if (this.treat_next_err_as_bug()) {
        // `Fatal` and `Error` can be promoted to `Bug`.
        diagnostic.level = Level.Bug;
      }
      break;
    case "DelayedBug":
      // Note that because we check these conditions first,
      // `-Zeagerly-emit-delayed-bugs` and `-Ztreat-err-as-bug`
      // continue to work even after we've issued an error and
      // stopped recording new delayed bugs.
      if (this.flags.eagerly_emit_delayed_bugs) {
        // `DelayedBug` can be promoted to `Error` or `Bug`.
        if (this.treat_next_err_as_bug()) {
          diagnostic.level = Level.Bug;
        } else {
          diagnostic.level = Level.Error;
        }
      } else {
        // If we have already emitted at least one error, we don't need
        // to record the delayed bug, because it'll never be used.
        const guar = this.has_errors();
        if (guar !== undefined) {
          return guar;
        } else {
          // No `TRACK_DIAGNOSTIC` call is needed, because the
          // incremental session is deleted if there is a delayed
          // bug. This also saves us from cloning the diagnostic.
          const backtrace = Backtrace.capture();
          // This `unchecked_error_guaranteed` is valid. It is where the
          // `ErrorGuaranteed` for delayed bugs originates. See
          // `DiagCtxtInner::drop`.
          const guar = ErrorGuaranteed.unchecked_error_guaranteed();
          this.delayed_bugs.push([DelayedDiagInner.with_backtrace(diagnostic, backtrace), guar]);
          return guar;
        }
      }
      break;
    case "Warning": {
      const emission_override = level._0;
      if (emission_override === undefined) {
        if (!this.flags.can_emit_warnings) {
          // We are not emitting warnings.
          if (diagnostic.has_future_breakage()) {
            // The side-effect is at the top of this method.
            TRACK_DIAGNOSTIC.deref()(diagnostic, (_) => undefined);
          }
          return undefined;
        }
      } else if (emission_override.$ === "Forced" && emission_override.lint_id === undefined) {
        // nothing
      } else if (emission_override.$ === "Forced") {
        this.fulfilled_expectations.add(emission_override.lint_id!);
      } else if (emission_override.$ === "Allowed") {
        assert(diagnostic.has_future_breakage(), "assertion failed: diagnostic.has_future_breakage()");
        TRACK_DIAGNOSTIC.deref()(diagnostic, (_) => undefined);
        this.suppressed_expected_diag = true;
        return undefined;
      } else {
        this.fulfilled_expectations.add(emission_override.lint_id);
        TRACK_DIAGNOSTIC.deref()(diagnostic, (_) => undefined);
        this.suppressed_expected_diag = true;
        return undefined;
      }
      break;
    }
    case "Note":
    case "Help":
    case "FailureNote":
      break;
  }

  const msrv = this.msrv;
  const diag_msrv = diagnostic.rust_version();
  if (msrv !== undefined && diag_msrv !== undefined && RustcVersion_gt(diag_msrv, msrv)) {
    return undefined;
  }

  return TRACK_DIAGNOSTIC.deref()(diagnostic, (diagnostic) => {
    const code = diagnostic.code;
    if (code !== undefined) {
      this.emitted_diagnostic_codes.add(code);
    }

    const hash = diagnostic.dedup_hash();
    const already_emitted = this.emitted_diagnostics.has(hash);
    this.emitted_diagnostics.add(hash);

    const is_error = diagnostic.is_error();
    const is_lint = diagnostic.is_lint !== undefined;
    // We only emit the first occurrence of `recursion_depth_exceeding_limit`.
    let silence_recursion_depth_exceeded_limit = false;
    if (diagnostic.is_lint !== undefined && eq_ignore_ascii_case(diagnostic.is_lint.name, RECURSION_DEPTH_EXCEEDING_LIMIT.name)) {
      silence_recursion_depth_exceeded_limit = this.emitted_recursion_depth_exceeding_limit;
      this.emitted_recursion_depth_exceeding_limit = true;
    }

    // Only emit the diagnostic if deduplication is disabled or we
    // haven't already emitted an equivalent diagnostic.
    if (!silence_recursion_depth_exceeded_limit && !(this.flags.deduplicate_diagnostics && already_emitted)) {
      // debug!(?diagnostic);
      // debug!(?self.emitted_diagnostics);

      const show_sub = (sub: import("./diagnostic.ts").Subdiag): boolean => {
        // debug!(?sub);
        switch (sub.level) {
          case "Error":
          case "Warning":
          case "Note":
          case "Help":
            return true;
          case "OnceNote":
          case "OnceHelp": {
            const h = sub.dedup_hash();
            if (this.emitted_diagnostics.has(h)) return false;
            this.emitted_diagnostics.add(h);
            return true;
          }
        }
      };
      diagnostic.children = diagnostic.children.filter(show_sub);
      if (already_emitted) {
        const msg = "duplicate diagnostic emitted due to `-Z deduplicate-diagnostics=no`";
        diagnostic.sub("Note", msg, MultiSpan.new());
      }

      if (is_error) {
        this.deduplicated_err_count += 1;
      } else if (diagnostic.level.$ === "Warning") {
        this.deduplicated_warn_count += 1;
      }
      this.has_printed = true;

      this.emitter.emit_diagnostic(diagnostic);
    }

    if (is_error) {
      // If we have any delayed bugs recorded, we can discard them
      // because they won't be used. (This should only occur if there
      // have been no errors previously emitted, because we don't add
      // new delayed bugs once the first error is emitted.)
      if (this.delayed_bugs.length !== 0) {
        assert_eq(this.lint_err_guars.length + this.err_guars.length, 0, String);
        this.delayed_bugs = [];
      }

      // This `unchecked_error_guaranteed` is valid. It is where the
      // `ErrorGuaranteed` for errors and lint errors originates.
      const guar = ErrorGuaranteed.unchecked_error_guaranteed();
      const thread = current_thread_id();
      if (is_lint) {
        this.lint_err_guars.push([guar, thread]);
      } else {
        if (taint !== undefined) {
          taint.value = guar;
        }
        this.err_guars.push([guar, thread]);
      }
      this.panic_if_treat_err_as_bug();
      return guar;
    } else {
      return undefined;
    }
  });
};

/** `str::eq_ignore_ascii_case` */
function eq_ignore_ascii_case(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const lower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
  return lower(a) === lower(b);
}

/** `#[derive(PartialOrd)]` on `RustcVersion` (major, minor, patch): `a > b`. */
function RustcVersion_gt(a: RustcVersion, b: RustcVersion): boolean {
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch > b.patch;
}

// rustc: compiler/rustc_errors/src/lib.rs:1383 treat_err_as_bug
DiagCtxtInner.prototype.treat_err_as_bug = function (this: DiagCtxtInner): boolean {
  const c = this.flags.treat_err_as_bug;
  return c !== undefined && this.err_guars.length + this.lint_err_guars.length >= c;
};

// Use this one before incrementing `err_count`.
// rustc: compiler/rustc_errors/src/lib.rs:1390 treat_next_err_as_bug
DiagCtxtInner.prototype.treat_next_err_as_bug = function (this: DiagCtxtInner): boolean {
  const c = this.flags.treat_err_as_bug;
  return c !== undefined && this.err_guars.length + this.lint_err_guars.length + 1 >= c;
};

// rustc: compiler/rustc_errors/src/lib.rs:1396 has_errors_excluding_lint_errors
DiagCtxtInner.prototype.has_errors_excluding_lint_errors = function (this: DiagCtxtInner): ErrorGuaranteed | undefined {
  const first = this.err_guars[0];
  if (first !== undefined) return first[0];
  for (const stashed_diagnostics of this.stashed_diagnostics.values()) {
    for (const [diag, guar, _] of stashed_diagnostics.values()) {
      if (guar !== undefined && diag.is_lint === undefined) {
        return guar;
      }
    }
  }
  return undefined;
};

// rustc: compiler/rustc_errors/src/lib.rs:1411 has_errors
DiagCtxtInner.prototype.has_errors = function (this: DiagCtxtInner): ErrorGuaranteed | undefined {
  const e = this.err_guars[0];
  if (e !== undefined) return e[0];
  const l = this.lint_err_guars[0];
  if (l !== undefined) return l[0];
  for (const stashed_diagnostics of this.stashed_diagnostics.values()) {
    for (const [_, guar, _t] of stashed_diagnostics.values()) {
      if (guar !== undefined) return guar;
    }
  }
  return undefined;
};

// rustc: compiler/rustc_errors/src/lib.rs:1423 has_errors_or_delayed_bugs
DiagCtxtInner.prototype.has_errors_or_delayed_bugs = function (this: DiagCtxtInner): ErrorGuaranteed | undefined {
  return this.has_errors() ?? this.delayed_bugs[0]?.[1];
};

// rustc: compiler/rustc_errors/src/lib.rs:1427 flush_delayed
DiagCtxtInner.prototype.flush_delayed = function (this: DiagCtxtInner): void {
  // Stashed diagnostics must be emitted before delayed bugs are flushed.
  // Otherwise, we might ICE prematurely when errors would have
  // eventually happened.
  assert(this.stashed_diagnostics.size === 0, "assertion failed: self.stashed_diagnostics.is_empty()");

  if (this.err_guars.length !== 0) {
    // If an error happened already. We shouldn't expose delayed bugs.
    return;
  }

  if (this.delayed_bugs.length === 0) {
    // Nothing to do.
    return;
  }

  const bugs = this.delayed_bugs.map(([b, _]) => b);
  this.delayed_bugs = [];

  const backtrace = process.env["RUST_BACKTRACE"] !== "0";
  const decorate = backtrace || this.ice_file === undefined;
  // PORT: `File::options().create(true).append(true).open(file).ok()` + `write!` -> appendFileSync
  // per bug; open/write errors are ignored as upstream ignores them.
  const out = this.ice_file;

  // Put the overall explanation before the `DelayedBug`s, to frame them
  // better (e.g. separate warnings from them). Also, use notes, which
  // don't count as errors, to avoid possibly triggering
  // `-Ztreat-err-as-bug`, which we don't want.
  const note1 = "no errors encountered even though delayed bugs were created";
  const note2 = "those delayed bugs will now be shown as internal compiler errors";
  this.emit_diagnostic(DiagInner.new(Level.Note, note1), undefined);
  this.emit_diagnostic(DiagInner.new(Level.Note, note2), undefined);

  for (const bug_ of bugs) {
    if (out !== undefined) {
      try {
        const text = bug_.inner.messages
          .map(([msg, _]) => DiagMessageAsStr(msg))
          .filter((s) => s !== undefined)
          .join("");
        appendFileSync(out, `delayed bug: ${text}\n${bug_.note.to_string()}\n`);
      } catch {
        // `_ = write!(..)`
      }
    }

    const bug = decorate ? bug_.decorate() : bug_.inner;

    // "Undelay" the delayed bugs into plain bugs.
    if (bug.level.$ !== "DelayedBug") {
      // NOTE(eddyb) not panicking here because we're already producing
      // an ICE, and the more information the merrier.
      //
      // We are at the `DiagInner`/`DiagCtxtInner` level rather than
      // the usual `Diag`/`DiagCtxt` level, so we must augment `bug`
      // in a lower-level fashion.
      const m = DiagMessage_arg(
        msg("`flushed_delayed` got diagnostic with level {$level}, instead of the expected `DelayedBug`"),
        "level",
        IntoDiagArg.of(bug.level, Level.into_diag_arg),
      ).format();
      bug.sub("Note", m, MultiSpan.from_Span(unwrap(bug.span.primary_span())));
    }
    bug.level = Level.Bug;

    this.emit_diagnostic(bug, undefined);
  }

  // Panic with `DelayedBugPanic` to avoid "unexpected panic" messages.
  throw new DelayedBugPanic();
};

function DiagMessageAsStr(m: DiagMessage): string | undefined {
  return m.$ === "Str" ? m._0 : undefined;
}

// rustc: compiler/rustc_errors/src/lib.rs:1499 panic_if_treat_err_as_bug
DiagCtxtInner.prototype.panic_if_treat_err_as_bug = function (this: DiagCtxtInner): void {
  if (this.treat_err_as_bug()) {
    const n = unwrap(this.flags.treat_err_as_bug);
    assert_eq(n, this.err_guars.length + this.lint_err_guars.length, String);
    if (n === 1) {
      panic("aborting due to `-Z treat-err-as-bug=1`");
    } else {
      panic(`aborting after ${n} errors due to \`-Z treat-err-as-bug=${n}\``);
    }
  }
};

// rustc: compiler/rustc_errors/src/lib.rs:1518 with_backtrace
DelayedDiagInner.with_backtrace = function (diagnostic: DiagInner, backtrace: Backtrace): DelayedDiagInner {
  return new DelayedDiagInner(diagnostic, backtrace);
};

// rustc: compiler/rustc_errors/src/lib.rs:1522 decorate
DelayedDiagInner.prototype.decorate = function (this: DelayedDiagInner): DiagInner {
  // We are at the `DiagInner`/`DiagCtxtInner` level rather than the
  // usual `Diag`/`DiagCtxt` level, so we must construct `diag` in a
  // lower-level fashion.
  const diag = this.inner;
  const m =
    this.note.status() === "Captured"
      ? msg(`delayed at {$emitted_at}
                {$note}`)
      : // Avoid the needless newline when no backtrace has been captured,
        // the display impl should just be a single line.
        msg("delayed at {$emitted_at} - {$note}");
  const formatted = DiagMessage_arg(m, "emitted_at", IntoDiagArg.of(diag.emitted_at, DiagLocation_into_diag_arg_lazy))
    .arg("note", IntoDiagArg.of(this.note, Backtrace_into_diag_arg_lazy))
    .format();
  diag.sub("Note", formatted, MultiSpan.from_Span(diag.span.primary_span() ?? DUMMY_SP));
  return diag;
};

// ---- Level / Sublevel ---------------------------------------------------------------------------

/// | Level        | is_error | usable emit fns  | Top-level | Used in lints?
/// | -----        | -------- | ---------------  | --------- | --------------
/// | Bug          | yes      | emit, emit_bug   | yes       | -
/// | Fatal        | yes      | emit, emit_fatal | yes       | -
/// | Error        | yes      | emit, emit_err   | yes       | yes
/// | DelayedBug   | yes      | emit, emit_err   | yes       | -
/// | Warning      | -        | emit             | yes       | yes
/// | Note         | -        | emit             | rare      | -
/// | Help         | -        | emit             | don't use | -
/// | FailureNote  | -        | emit             | rare      | -
export type Level = Level_;

/** `impl fmt::Display for Level` */
// rustc: compiler/rustc_errors/src/lib.rs:1623 fmt
export function display_Level(self: Level): string {
  return Level.to_str(self);
}

export const Level = {
  ...LevelGen,

  // rustc: compiler/rustc_errors/src/lib.rs:1629 to_str
  to_str(self: Level): string {
    switch (self.$) {
      case "Bug":
      case "DelayedBug":
        return "error: internal compiler error";
      case "Fatal":
      case "Error":
        return "error";
      case "Warning":
        return "warning";
      case "Note":
        return "note";
      case "Help":
        return "help";
      case "FailureNote":
        return "failure-note";
    }
  },

  // rustc: compiler/rustc_errors/src/lib.rs:1640 is_failure_note
  is_failure_note(self: Level): boolean {
    return self.$ === "FailureNote";
  },

  /** `impl IntoDiagArg for Level` */
  // rustc: compiler/rustc_errors/src/lib.rs:1646 into_diag_arg
  into_diag_arg(self: Level, _: MutRef<PathBuf | undefined>): DiagArgValue {
    return { $: "Str", _0: display_Level(self) };
  },
};

/** `{:?}` of a `Level` inside assertion messages. */
function debug_level(level: Level): string {
  return debug_Level(level, PLAIN);
}

/** `#[derive(PartialEq)]` on `Level` (`LintExpectationId`s are interned, so `===` compares them by value). */
export function Level_eq(a: Level, b: Level): boolean {
  if (a.$ !== b.$) return false;
  if (a.$ !== "Warning") return true;
  const x = a._0;
  const y = (b as typeof a)._0;
  if (x === undefined || y === undefined) return x === y;
  if (x.$ !== y.$) return false;
  if (x.$ === "Allowed") return true;
  return x.lint_id === (y as typeof x).lint_id;
}

/// The level for a subdiagnostic.
export type Sublevel = Sublevel_;
export const Sublevel = {
  ...SublevelGen,

  // rustc: compiler/rustc_errors/src/lib.rs:1677 to_str
  to_str(self: Sublevel): string {
    switch (self) {
      case "Error":
        return "error";
      case "Warning":
        return "warning";
      case "Note":
      case "OnceNote":
        return "note";
      case "Help":
      case "OnceHelp":
        return "help";
    }
  },
};

export type Style = Style_;
// PORT: `impl Style { fn anstyle }` is defined in emitter.rs; it is ported there as
// `Style_anstyle` and attached to the companion const here.
export const Style = {
  ...StyleGen,
  anstyle: Style_anstyle,
};

// FIXME(eddyb) this doesn't belong here AFAICT, should be moved to callsite.
// rustc: compiler/rustc_errors/src/lib.rs:1694 elided_lifetime_in_path_suggestion
export function elided_lifetime_in_path_suggestion(
  source_map: SourceMap,
  n: number,
  path_span: Span,
  incl_angl_brckt: boolean,
  insertion_span: Span,
): ElidedLifetimeInPathSubdiag {
  const expected = { span: path_span, count: n };
  // Do not try to suggest anything if generated by a proc-macro.
  let indicate = undefined;
  if (source_map.is_span_accessible(insertion_span)) {
    const anon_lts = Array<string>(n).fill("'_").join(", ");
    const suggestion = incl_angl_brckt ? `<${anon_lts}>` : `${anon_lts}, `;

    indicate = { span: Span.shrink_to_hi(insertion_span), count: n, suggestion };
  }

  return { expected, indicate };
}

/// Grammatical tool for displaying messages to end users in a nice form.
///
/// Returns "an" if the given string starts with a vowel, and "a" otherwise.
// rustc: compiler/rustc_errors/src/lib.rs:1717 a_or_an
export function a_or_an(s: string): string {
  const chars = Array.from(s);
  let first_alpha_char = chars[0];
  if (first_alpha_char === undefined) {
    return "a";
  }
  if (first_alpha_char === "`") {
    const next = chars[1];
    if (next === undefined) {
      return "a";
    }
    first_alpha_char = next;
  }
  if (["a", "e", "i", "o", "u", "&"].includes(first_alpha_char.toLowerCase())) {
    return "an";
  } else {
    return "a";
  }
}
