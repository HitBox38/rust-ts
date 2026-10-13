// Port of compiler/rustc_errors/src/diagnostic.rs.
// Types are generated into diagnostic.gen.ts, except `Diag` (hand-written below: it is a `Deref`
// wrapper with a drop bomb).
import type { RustcVersion } from "../rustc_ast/attr/version.ts";
import {
  type DiagArgName,
  type DiagMessage,
  type IntoDiagArg,
  type IntoDiagMessage,
  type IntoMultiSpan,
  type PathBuf,
  DiagMessage as DiagMessageC,
  MultiSpan,
  into_DiagMessage,
  into_MultiSpan,
} from "../rustc_error_messages/lib.ts";
import type { Hash128 } from "../rustc_hashes/lib.ts";
import { SyntaxContext } from "../rustc_span/hygiene.ts";
import { type ErrorGuaranteed, Span, type Spanned } from "../rustc_span/lib.ts";
import { FatalError } from "../rustc_span/fatal_error.ts";
import { ExplicitBug, type Location } from "../rustc_span/macros.ts";
import { debug_option, PLAIN, type Debug, type Fmt } from "../std/fmt.ts";
import { assert, assert_eq, panic, panicking, unported, unwrap } from "../std/panic.ts";
import { utf8_len } from "../std/str.ts";
import * as track_caller from "../rust_ts/track_caller.ts";
import type { ErrCode } from "./codes.ts";
import { index_map_swap_remove } from "./decorate_diag.ts";
import {
  DedupHashEncoder,
  DedupHasher,
  encode_DiagArgMap,
  encode_DiagMessage,
  encode_MultiSpan,
  encode_option,
  encode_RustcVersion,
} from "./dedup_hash.ts";
import {
  DiagInner,
  DiagLocation,
  DiagStyledString,
  type IsLint,
  StringPart,
  Subdiag,
  debug_DiagInner,
} from "./diagnostic.gen.ts";
import { debug_Level, Level as LevelC } from "./lib.gen.ts";
import type { Applicability, CodeSuggestion, DiagCtxtHandle, Level, StashKey, Style, Sublevel, SuggestionStyle, Suggestions } from "./lib.ts";

export * from "./diagnostic.gen.ts";

/// Trait implemented by error types. This is rarely implemented manually. Instead, use
/// `#[derive(Diagnostic)]` -- see [rustc_macros::Diagnostic].
export interface Diagnostic {
  /// Write out as a diagnostic out of `DiagCtxt`.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:32 into_diag
  into_diag(dcx: DiagCtxtHandle, level: Level): Diag;
}

/** `impl<'a, T> Diagnostic<'a> for Spanned<T> where T: Diagnostic<'a>` */
// rustc: compiler/rustc_errors/src/diagnostic.rs:39 into_diag
export function Spanned_into_diag(self: Spanned<Diagnostic>, dcx: DiagCtxtHandle, level: Level): Diag {
  return self.node.into_diag(dcx, level).with_span(self.span);
}

/// Type used to emit diagnostic through a closure instead of implementing the `Diagnostic` trait.
// PORT: `DiagDecorator<F>` (diagnostic.gen.ts) with `F = (diag: Diag) => void`.
export function DiagDecorator(f: (diag: Diag) => void): Diagnostic {
  return {
    // rustc: compiler/rustc_errors/src/diagnostic.rs:48 into_diag
    into_diag(dcx: DiagCtxtHandle, level: Level): Diag {
      const diag = Diag.new(dcx, level, "");
      f(diag);
      return diag;
    },
  };
}

/// Trait implemented by error types. This should not be implemented manually. Instead, use
/// `#[derive(Subdiagnostic)]` -- see [rustc_macros::Subdiagnostic].
export interface Subdiagnostic {
  /// Add a subdiagnostic to an existing diagnostic.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:59 add_to_diag
  add_to_diag(diag: Diag): void;
}

// PORT: `#[track_caller]` / `panic::Location::caller()` has no JS equivalent. `DiagLocation::caller()`
// records the JS stack (src/rust_ts/track_caller.ts) under a placeholder `file`; displaying it (only
// `-Ztrack-diagnostics` and delayed-bug notes do) maps the stack back to the upstream call site, or is
// `unported` when that cannot be done exactly. `dedup_hash` ignores `emitted_at`, as upstream does.
declare module "./diagnostic.gen.ts" {
  namespace DiagLocation {
    export let from_location: (loc: Location) => DiagLocation;
    export let caller_: () => DiagLocation;
  }
}

// rustc: compiler/rustc_errors/src/diagnostic.rs:70 from_location
DiagLocation.from_location = function (loc: Location): DiagLocation {
  return new DiagLocation(loc.file, loc.line, loc.col);
};

// rustc: compiler/rustc_errors/src/diagnostic.rs:75 caller
// PORT: `Function.caller` is a restricted property in JS, so the static is `caller_`.
DiagLocation.caller_ = function (): DiagLocation {
  // Self::from_location(panic::Location::caller())
  return new DiagLocation(track_caller.capture(), 0, 0);
};

/** `impl fmt::Display for DiagLocation` */
// rustc: compiler/rustc_errors/src/diagnostic.rs:81 fmt
export function display_DiagLocation(self: DiagLocation): string {
  if (self.file.startsWith(track_caller.CAPTURE_PREFIX)) {
    const loc = track_caller.resolve(self.file);
    if (!loc.ok) return unported(`std::panic::Location::caller (DiagLocation Display: ${loc.why})`);
    return `${loc.file}:${loc.line}:${loc.col}`;
  }
  return `${self.file}:${self.line}:${self.col}`;
}

declare module "./diagnostic.gen.ts" {
  interface DiagStyledString {
    push_normal(t: string): void;
    push_highlighted(t: string): void;
    push(t: string, highlight: boolean): void;
    content(): string;
    compact(): void;
    shorten(): void;
  }
  namespace DiagStyledString {
    function new_(): DiagStyledString;
    export { new_ as new };
    export let normal: (t: string) => DiagStyledString;
    export let highlighted: (t: string) => DiagStyledString;
  }
  namespace StringPart {
    export let normal: (content: string) => StringPart;
    export let highlighted: (content: string) => StringPart;
  }
}

// rustc: compiler/rustc_errors/src/diagnostic.rs:100 new
(DiagStyledString as unknown as { new: () => DiagStyledString }).new = function (): DiagStyledString {
  return new DiagStyledString([]);
};
// rustc: compiler/rustc_errors/src/diagnostic.rs:103 push_normal
DiagStyledString.prototype.push_normal = function (this: DiagStyledString, t: string): void {
  this._0.push(StringPart.normal(t));
};
// rustc: compiler/rustc_errors/src/diagnostic.rs:106 push_highlighted
DiagStyledString.prototype.push_highlighted = function (this: DiagStyledString, t: string): void {
  this._0.push(StringPart.highlighted(t));
};
// rustc: compiler/rustc_errors/src/diagnostic.rs:109 push
DiagStyledString.prototype.push = function (this: DiagStyledString, t: string, highlight: boolean): void {
  if (highlight) {
    this.push_highlighted(t);
  } else {
    this.push_normal(t);
  }
};
// rustc: compiler/rustc_errors/src/diagnostic.rs:116 normal
DiagStyledString.normal = function (t: string): DiagStyledString {
  return new DiagStyledString([StringPart.normal(t)]);
};

// rustc: compiler/rustc_errors/src/diagnostic.rs:120 highlighted
DiagStyledString.highlighted = function (t: string): DiagStyledString {
  return new DiagStyledString([StringPart.highlighted(t)]);
};

// rustc: compiler/rustc_errors/src/diagnostic.rs:124 content
DiagStyledString.prototype.content = function (this: DiagStyledString): string {
  return this._0.map((x) => x.content).join("");
};

/// Merge segments of the same style.
// rustc: compiler/rustc_errors/src/diagnostic.rs:129 compact
DiagStyledString.prototype.compact = function (this: DiagStyledString): void {
  const segments = this._0;
  this._0 = [];
  if (segments.length === 0) return;
  let prev = segments[0]!;
  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i]!;
    if (prev.style === segment.style) {
      prev.content += segment.content;
    } else {
      this._0.push(prev);
      prev = segment;
    }
  }
  this._0.push(prev);
};

/// Remove the middle of all long segments for shorter rendering.
// rustc: compiler/rustc_errors/src/diagnostic.rs:145 shorten
DiagStyledString.prototype.shorten = function (this: DiagStyledString): void {
  this.compact();
  /// The marker for removed text.
  const ELLIPSIS = "...";
  /// How many chars at the start and end will remain.
  const PADDING = 6;
  /// The distance after which it is not worth it to reduce the text.
  const DELTA = 3;

  for (const segment of this._0) {
    const chars = Array.from(segment.content);
    const char_len = chars.length;
    if (char_len > PADDING * 2 + Array.from(ELLIPSIS).length + DELTA) {
      // `left`/`right` are the char boundaries of chars `PADDING` and `char_len - PADDING`.
      segment.content = chars.slice(0, PADDING).join("") + ELLIPSIS + chars.slice(char_len - PADDING).join("");
    }
  }
};

// rustc: compiler/rustc_errors/src/diagnostic.rs:173 normal
StringPart.normal = function (content: string): StringPart {
  return new StringPart(content, "NoStyle");
};

// rustc: compiler/rustc_errors/src/diagnostic.rs:177 highlighted
StringPart.highlighted = function (content: string): StringPart {
  return new StringPart(content, "Highlight");
};

declare module "./diagnostic.gen.ts" {
  interface DiagInner {
    level_(): Level;
    is_error(): boolean;
    has_future_breakage(): boolean;
    rust_version(): RustcVersion | undefined;
    sub(level: Sublevel, message: IntoDiagMessage, span: MultiSpan): void;
    arg(name: DiagArgName, arg: IntoDiagArg): void;
    remove_arg(name: string): void;
    emitted_at_sub_diag(): Subdiag;
    dedup_hash(): Hash128;
    clone(): DiagInner;
  }
  namespace DiagInner {
    function new_(level: Level, message: IntoDiagMessage): DiagInner;
    export { new_ as new };
    export let new_with_messages: (level: Level, messages: [DiagMessage, Style][]) => DiagInner;
  }
  interface Subdiag {
    dedup_hash(): Hash128;
    clone(): Subdiag;
  }
}

// rustc: compiler/rustc_errors/src/diagnostic.rs:208 new
(DiagInner as unknown as { new: (level: Level, message: IntoDiagMessage) => DiagInner }).new = function (
  level: Level,
  message: IntoDiagMessage,
): DiagInner {
  return DiagInner.new_with_messages(level, [[into_DiagMessage(message), "NoStyle"]]);
};

// rustc: compiler/rustc_errors/src/diagnostic.rs:213 new_with_messages
DiagInner.new_with_messages = function (level: Level, messages: [DiagMessage, Style][]): DiagInner {
  return new DiagInner(
    level,
    messages,
    undefined,
    MultiSpan.new(),
    [],
    { $: "Enabled", _0: [] },
    new Map(),
    undefined,
    undefined,
    DiagLocation.caller_(),
  );
};

// PORT: the getter `level()` shares its name with the field, so it is `level_()`.
// rustc: compiler/rustc_errors/src/diagnostic.rs:229 level
DiagInner.prototype.level_ = function (this: DiagInner): Level {
  return this.level;
};

// rustc: compiler/rustc_errors/src/diagnostic.rs:233 is_error
DiagInner.prototype.is_error = function (this: DiagInner): boolean {
  switch (this.level.$) {
    case "Bug":
    case "Fatal":
    case "Error":
    case "DelayedBug":
      return true;

    case "Warning":
    case "Note":
    case "Help":
    case "FailureNote":
      return false;
  }
};

/// Indicates whether this diagnostic should show up in cargo's future breakage report.
// rustc: compiler/rustc_errors/src/diagnostic.rs:242 has_future_breakage
DiagInner.prototype.has_future_breakage = function (this: DiagInner): boolean {
  return this.is_lint !== undefined && this.is_lint.has_future_breakage;
};

/// Indicates the minimum rust version this lint applies to.
// rustc: compiler/rustc_errors/src/diagnostic.rs:247 rust_version
DiagInner.prototype.rust_version = function (this: DiagInner): RustcVersion | undefined {
  return this.is_lint?.rust_version;
};

// rustc: compiler/rustc_errors/src/diagnostic.rs:251 sub
DiagInner.prototype.sub = function (this: DiagInner, level: Sublevel, message: IntoDiagMessage, span: MultiSpan): void {
  const sub = new Subdiag(level, [[into_DiagMessage(message), "NoStyle"]], span);
  this.children.push(sub);
};

// rustc: compiler/rustc_errors/src/diagnostic.rs:261 arg
DiagInner.prototype.arg = function (this: DiagInner, name: DiagArgName, arg: IntoDiagArg): void {
  const path = { value: this.long_ty_path };
  const value = arg.into_diag_arg(path);
  this.long_ty_path = path.value;
  // This assertion is to avoid subdiagnostics overwriting an existing diagnostic arg.
  // debug_assert!(!self.args.contains_key(&name) || self.args.get(&name) == Some(&value), "arg {} already exists", name);
  this.args.set(name, value);
};

// rustc: compiler/rustc_errors/src/diagnostic.rs:273 remove_arg
DiagInner.prototype.remove_arg = function (this: DiagInner, name: string): void {
  index_map_swap_remove(this.args, name);
};

// rustc: compiler/rustc_errors/src/diagnostic.rs:277 emitted_at_sub_diag
DiagInner.prototype.emitted_at_sub_diag = function (this: DiagInner): Subdiag {
  const track = `-Ztrack-diagnostics: created at ${display_DiagLocation(this.emitted_at)}`;
  return new Subdiag("Note", [[{ $: "Str", _0: track }, "NoStyle"]], MultiSpan.new());
};

/// Hash used to determine if two diagnostics are the same. Used by
/// `DiagCtxtInner::emitted_diagnostics`. Some fields are ignored for the hash.
// rustc: compiler/rustc_errors/src/diagnostic.rs:288 dedup_hash
DiagInner.prototype.dedup_hash = function (this: DiagInner): Hash128 {
  // Deconstruct to ensure all fields are considered.
  const { level, messages, code, span, children, suggestions, args, is_lint } = this;
  // long_ty_path: _, // ignore
  // emitted_at: _,   // ignore

  const e = new DedupHashEncoder(DedupHasher.new());

  // We use `discriminant` because we want to ignore the field within `Warning`.
  // `Encoder`/`SpanEncoder` can't traverse a `Discriminant<T>` so we hash it directly.
  e.emit_str(level.$);

  // All the other fields are hashed via `encode`.
  encode_messages(e, messages);
  encode_option(e, code, (e, c) => e.emit_u32(c));
  encode_MultiSpan(e, span);
  e.emit_usize(children.length);
  for (const c of children) encode_Subdiag(e, c);
  encode_Suggestions(e, suggestions);
  encode_DiagArgMap(e, args);
  encode_option(e, is_lint, encode_IsLint);

  return e._0.finish();
};

/** `#[derive(Clone)]` */
DiagInner.prototype.clone = function (this: DiagInner): DiagInner {
  return new DiagInner(
    this.level,
    this.messages.map(([m, s]) => [m, s] as [DiagMessage, Style]),
    this.code,
    this.span.clone(),
    this.children.map((c) => c.clone()),
    clone_Suggestions(this.suggestions),
    new Map(this.args),
    this.is_lint === undefined ? undefined : { ...this.is_lint },
    this.long_ty_path,
    this.emitted_at,
  );
};

/// Hash used to determine if two subdiagnostics are the same. Used by
/// `DiagCtxtInner::emitted_diagnostics`.
// rustc: compiler/rustc_errors/src/diagnostic.rs:334 dedup_hash
Subdiag.prototype.dedup_hash = function (this: Subdiag): Hash128 {
  const e = new DedupHashEncoder(DedupHasher.new());
  encode_Subdiag(e, this);
  return e._0.finish();
};

/** `#[derive(Clone)]` */
Subdiag.prototype.clone = function (this: Subdiag): Subdiag {
  return new Subdiag(this.level, this.messages.map(([m, s]) => [m, s] as [DiagMessage, Style]), this.span.clone());
};

// ---- `derive(Encodable)` traversals for `dedup_hash` (PORT, see dedup_hash.ts) ----

function encode_messages(e: DedupHashEncoder, messages: readonly [DiagMessage, Style][]): void {
  e.emit_usize(messages.length);
  for (const [m, s] of messages) {
    encode_DiagMessage(e, m);
    e.emit_str(s);
  }
}

function encode_Subdiag(e: DedupHashEncoder, sub: Subdiag): void {
  e.emit_str(sub.level);
  encode_messages(e, sub.messages);
  encode_MultiSpan(e, sub.span);
}

function encode_CodeSuggestion(e: DedupHashEncoder, s: CodeSuggestion): void {
  e.emit_usize(s.substitutions.length);
  for (const subst of s.substitutions) {
    e.emit_usize(subst.parts.length);
    for (const part of subst.parts) {
      e.encode_span(part.span);
      e.emit_str(part.snippet);
    }
  }
  encode_DiagMessage(e, s.msg);
  e.emit_str(s.style);
  e.emit_str(s.applicability);
}

function encode_Suggestions(e: DedupHashEncoder, s: Suggestions): void {
  e.emit_str(s.$);
  if (s.$ !== "Disabled") {
    e.emit_usize(s._0.length);
    for (const c of s._0) encode_CodeSuggestion(e, c);
  }
}

function encode_IsLint(e: DedupHashEncoder, l: IsLint): void {
  e.emit_str(l.name);
  e.emit_bool(l.has_future_breakage);
  encode_option(e, l.rust_version, encode_RustcVersion);
}

function clone_Suggestions(s: Suggestions): Suggestions {
  switch (s.$) {
    case "Enabled":
      return { $: "Enabled", _0: [...s._0] };
    case "Sealed":
      return { $: "Sealed", _0: [...s._0] };
    case "Disabled":
      return s;
  }
}

/// Used for emitting structured error messages and other diagnostic information.
/// Wraps a `DiagInner`, adding some useful things.
/// - The `dcx` field, allowing it to (a) emit itself, and (b) do a drop check
///   that it has been emitted or cancelled.
///
/// Each constructed `Diag` must be consumed by a function such as
/// `emit_bug`/`emit_fatal`/`emit_err`/`emit`, `cancel`, or `delay_as_bug`. A
/// panic occurs if a `Diag` is dropped without being consumed by one of these
/// functions.
///
/// If there is some state in a downstream crate you would like to access in
/// the methods of `Diag` here, consider extending `DiagCtxtFlags`.
// PORT: hand-written (not generated): `Deref<Target = DiagInner>` becomes explicit `deref()` /
// `deref_mut()` calls (field names such as `span`, `code`, `is_lint` clash with `Diag` methods);
// the `with_fn!` `with_*` variants are methods returning `this`; JS has no destructors, so the
// `Drop` bomb is the explicit `drop()` method. A `Diag` holding a `DiagInner` is recorded in its
// `DiagCtxtInner.live_diags` (constructor) until the inner is taken (`forget_live`), and
// `DiagCtxtInner.drop()` drops whatever is still recorded.
export class Diag {
  constructor(
    public dcx: DiagCtxtHandle,
    /// Why the `Option`? It is always `Some` until the `Diag` is consumed via
    /// `emit`, `cancel`, etc. At that point it is consumed and replaced with
    /// `None`. Then `drop` checks that it is `None`; if not, it panics because
    /// a diagnostic was built but not used.
    ///
    /// Why the Box? `DiagInner` is a large type, and `Diag` is often used as a
    /// return value, especially within the frequently-used `PResult` type. In
    /// theory, return value optimization (RVO) should avoid unnecessary
    /// copying. In practice, it does not (at the time of writing).
    public diag: DiagInner | undefined,
  ) {
    if (diag !== undefined) {
      const inner = dcx.dcx.inner;
      (inner.live_diags ??= new Set()).add(this);
    }
  }

  /** PORT: no upstream counterpart. `self.diag.take()`: also leaves the drop-bomb registry. */
  private take_inner(): DiagInner | undefined {
    const diag = this.diag;
    this.diag = undefined;
    this.dcx.dcx.inner.live_diags?.delete(this);
    return diag;
  }

  // rustc: compiler/rustc_errors/src/diagnostic.rs:378 deref
  deref(): DiagInner {
    return unwrap(this.diag);
  }

  // rustc: compiler/rustc_errors/src/diagnostic.rs:384 deref_mut
  deref_mut(): DiagInner {
    return unwrap(this.diag);
  }

  // rustc: compiler/rustc_errors/src/diagnostic.rs:440 new
  static new(dcx: DiagCtxtHandle, level: Level, message: IntoDiagMessage): Diag {
    return Diag.new_diagnostic(dcx, DiagInner.new(level, message));
  }

  /// Allow moving diagnostics between different error tainting contexts
  // rustc: compiler/rustc_errors/src/diagnostic.rs:445 with_dcx
  with_dcx(dcx: DiagCtxtHandle): Diag {
    const diag = this.take_inner();
    return new Diag(dcx, diag);
  }

  /// Creates a new `Diag` with an already constructed diagnostic.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:451 new_diagnostic
  static new_diagnostic(dcx: DiagCtxtHandle, diag: DiagInner): Diag {
    // debug!("Created new diagnostic");
    return new Diag(dcx, diag);
  }

  /// Delay emission of this diagnostic as a bug.
  ///
  /// This can be useful in contexts where an error indicates a bug but
  /// typically this only happens when other compilation errors have already
  /// happened. In those cases this can be used to defer emission of this
  /// diagnostic as a bug in the compiler only if no other errors have been
  /// emitted.
  ///
  /// In the meantime, though, callsites are required to deal with the "bug"
  /// locally in whichever way makes the most sense.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:467 downgrade_to_delayed_bug
  downgrade_to_delayed_bug(): void {
    const level = this.deref().level;
    assert(
      level.$ === "Error" || level.$ === "DelayedBug",
      `downgrade_to_delayed_bug: cannot downgrade ${debug_level(level)} to DelayedBug: not an error`,
    );
    this.deref_mut().level = { $: "DelayedBug" };
  }

  /// Make emitting this diagnostic fatal.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:478 upgrade_to_fatal
  upgrade_to_fatal(): Diag {
    const level = this.deref().level;
    assert(level.$ === "Error", `upgrade_to_fatal: cannot upgrade ${debug_level(level)} to Fatal: not an error`);
    this.deref_mut().level = { $: "Fatal" };

    // Take is okay since we immediately rewrap it in another diagnostic.
    // i.e. we do emit it despite defusing the original diagnostic's drop bomb.
    const diag = this.take_inner();
    return new Diag(this.dcx, diag);
  }

  /// Appends a labeled span to the diagnostic.
  ///
  /// Labels are used to convey additional context for the diagnostic's primary span. They will
  /// be shown together with the original diagnostic's span, *not* with spans added by
  /// `span_note`, `span_help`, etc. Therefore, if the primary span is not displayable (because
  /// the span is `DUMMY_SP` or the source code isn't found), labels will not be displayed
  /// either.
  ///
  /// Implementation-wise, the label span is pushed onto the [`MultiSpan`] that was created when
  /// the diagnostic was constructed. However, the label span is *not* considered a
  /// ["primary span"][`MultiSpan`]; only the `Span` supplied when creating the diagnostic is
  /// primary.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:505 span_label
  span_label(span: Span, label: IntoDiagMessage): this {
    this.deref_mut().span.push_span_label(span, into_DiagMessage(label));
    return this;
  }
  with_span_label(span: Span, label: IntoDiagMessage): this {
    this.span_label(span, label);
    return this;
  }

  // rustc: compiler/rustc_errors/src/diagnostic.rs:511 span_context
  span_context(span: Span): this {
    this.deref_mut().span.push_span_context(span);
    return this;
  }
  with_span_context(span: Span): this {
    this.span_context(span);
    return this;
  }

  /// Labels all the given spans with the provided label.
  /// See [`Self::span_label()`] for more information.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:519 span_labels
  span_labels(spans: Iterable<Span>, label: string): this {
    for (const span of spans) {
      this.span_label(span, label);
    }
    return this;
  }
  with_span_labels(spans: Iterable<Span>, label: string): this {
    this.span_labels(spans, label);
    return this;
  }

  // rustc: compiler/rustc_errors/src/diagnostic.rs:526 replace_span_with
  replace_span_with(after: Span, keep_label: boolean): this {
    const before = this.deref().span.clone();
    this.span(after);
    for (const span_label of before.span_labels_()) {
      const label = span_label.label;
      if (label !== undefined) {
        if (span_label.is_primary && keep_label) {
          this.deref_mut().span.push_span_label(after, label);
        } else {
          this.deref_mut().span.push_span_label(span_label.span, label);
        }
      }
    }
    return this;
  }

  // rustc: compiler/rustc_errors/src/diagnostic.rs:541 note_expected_found
  note_expected_found(
    expected_label: string,
    expected: DiagStyledString,
    found_label: string,
    found: DiagStyledString,
  ): this {
    return this.note_expected_found_extra(
      expected_label,
      expected,
      found_label,
      found,
      DiagStyledString.normal(""),
      DiagStyledString.normal(""),
    );
  }

  // rustc: compiler/rustc_errors/src/diagnostic.rs:558 note_expected_found_extra
  note_expected_found_extra(
    expected_label_: string,
    expected: DiagStyledString,
    found_label_: string,
    found: DiagStyledString,
    expected_extra: DiagStyledString,
    found_extra: DiagStyledString,
  ): this {
    const expected_label = expected_label_ === "" ? "expected" : `expected ${expected_label_}`;
    const found_label = found_label_ === "" ? "found" : `found ${found_label_}`;
    const [found_padding, expected_padding] =
      utf8_len(expected_label) > utf8_len(found_label)
        ? [utf8_len(expected_label) - utf8_len(found_label), 0]
        : [0, utf8_len(found_label) - utf8_len(expected_label)];
    const msg = [StringPart.normal(`${" ".repeat(expected_padding)}${expected_label} \``)];
    msg.push(...expected._0);
    msg.push(StringPart.normal("`"));
    msg.push(...expected_extra._0);
    msg.push(StringPart.normal("\n"));
    msg.push(StringPart.normal(`${" ".repeat(found_padding)}${found_label} \``));
    msg.push(...found._0);
    msg.push(StringPart.normal("`"));
    msg.push(...found_extra._0);

    // For now, just attach these as notes.
    this.highlighted_note(msg);
    return this;
  }

  // rustc: compiler/rustc_errors/src/diagnostic.rs:603 note_trait_signature
  note_trait_signature(name: string, signature: string): this {
    // PORT: `name: Symbol` is passed as its `Display` string.
    this.highlighted_note([
      StringPart.normal(`\`${name}\` from trait: \``),
      StringPart.highlighted(signature),
      StringPart.normal("`"),
    ]);
    return this;
  }

  /// Add a note attached to this diagnostic.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:614 note
  note(msg: IntoDiagMessage): this {
    this.sub("Note", msg, MultiSpan.new());
    return this;
  }
  with_note(msg: IntoDiagMessage): this {
    this.note(msg);
    return this;
  }

  // rustc: compiler/rustc_errors/src/diagnostic.rs:619 highlighted_note
  highlighted_note(msg: StringPart[]): this {
    this.sub_with_highlights("Note", msg, MultiSpan.new());
    return this;
  }

  // rustc: compiler/rustc_errors/src/diagnostic.rs:624 highlighted_span_note
  highlighted_span_note(span: IntoMultiSpan, msg: StringPart[]): this {
    this.sub_with_highlights("Note", msg, into_MultiSpan(span));
    return this;
  }

  /// This is like [`Diag::note()`], but it's only printed once.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:634 note_once
  note_once(msg: IntoDiagMessage): this {
    this.sub("OnceNote", msg, MultiSpan.new());
    return this;
  }

  /// Prints the span with a note above it.
  /// This is like [`Diag::note()`], but it gets its own span.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:642 span_note
  span_note(sp: IntoMultiSpan, msg: IntoDiagMessage): this {
    this.sub("Note", msg, into_MultiSpan(sp));
    return this;
  }
  with_span_note(sp: IntoMultiSpan, msg: IntoDiagMessage): this {
    this.span_note(sp, msg);
    return this;
  }

  /// Prints the span with a note above it.
  /// This is like [`Diag::note_once()`], but it gets its own span.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:653 span_note_once
  span_note_once(sp: IntoMultiSpan, msg: IntoDiagMessage): this {
    this.sub("OnceNote", msg, into_MultiSpan(sp));
    return this;
  }

  /// Add a warning attached to this diagnostic.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:664 warn
  warn(msg: IntoDiagMessage): this {
    this.sub("Warning", msg, MultiSpan.new());
    return this;
  }
  with_warn(msg: IntoDiagMessage): this {
    this.warn(msg);
    return this;
  }

  /// Prints the span with a warning above it.
  /// This is like [`Diag::warn()`], but it gets its own span.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:671 span_warn
  span_warn(sp: IntoMultiSpan, msg: IntoDiagMessage): this {
    this.sub("Warning", msg, into_MultiSpan(sp));
    return this;
  }

  /// Add a help message attached to this diagnostic.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:682 help
  help(msg: IntoDiagMessage): this {
    this.sub("Help", msg, MultiSpan.new());
    return this;
  }
  with_help(msg: IntoDiagMessage): this {
    this.help(msg);
    return this;
  }

  /// This is like [`Diag::help()`], but it's only printed once.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:688 help_once
  help_once(msg: IntoDiagMessage): this {
    this.sub("OnceHelp", msg, MultiSpan.new());
    return this;
  }

  /// Add a help message attached to this diagnostic with a customizable highlighted message.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:694 highlighted_help
  highlighted_help(msg: StringPart[]): this {
    this.sub_with_highlights("Help", msg, MultiSpan.new());
    return this;
  }

  /// Add a help message attached to this diagnostic with a customizable highlighted message.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:700 highlighted_span_help
  highlighted_span_help(span: IntoMultiSpan, msg: StringPart[]): this {
    this.sub_with_highlights("Help", msg, into_MultiSpan(span));
    return this;
  }

  /// Prints the span with some help above it.
  /// This is like [`Diag::help()`], but it gets its own span.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:712 span_help
  span_help(sp: IntoMultiSpan, msg: IntoDiagMessage): this {
    this.sub("Help", msg, into_MultiSpan(sp));
    return this;
  }
  with_span_help(sp: IntoMultiSpan, msg: IntoDiagMessage): this {
    this.span_help(sp, msg);
    return this;
  }

  /// Disallow attaching suggestions to this diagnostic.
  /// Any suggestions attached e.g. with the `span_suggestion_*` methods
  /// (before and after the call to `disable_suggestions`) will be ignored.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:724 disable_suggestions
  disable_suggestions(): this {
    this.deref_mut().suggestions = { $: "Disabled" };
    return this;
  }

  /// Prevent new suggestions from being added to this diagnostic.
  ///
  /// Suggestions added before the call to `.seal_suggestions()` will be preserved
  /// and new suggestions will be ignored.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:733 seal_suggestions
  seal_suggestions(): this {
    const suggestions = this.deref().suggestions;
    if (suggestions.$ === "Enabled") {
      const suggestions_slice = suggestions._0;
      suggestions._0 = [];
      this.deref_mut().suggestions = { $: "Sealed", _0: suggestions_slice };
    }
    return this;
  }

  /// Helper for pushing to `self.suggestions`.
  ///
  /// A new suggestion is added if suggestions are enabled for this diagnostic.
  /// Otherwise, they are ignored.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:745 push_suggestion
  private push_suggestion(suggestion: CodeSuggestion): void {
    for (const subst of suggestion.substitutions) {
      for (const part of subst.parts) {
        const span = part.span;
        const call_site = SyntaxContext.outer_expn_data(Span.ctxt(span)).call_site;
        if (Span.in_derive_expansion(span) && Span.overlaps_or_adjacent(span, call_site)) {
          // Ignore if spans is from derive macro.
          return;
        }
      }
    }

    const suggestions = this.deref_mut().suggestions;
    if (suggestions.$ === "Enabled") {
      suggestions._0.push(suggestion);
    }
  }

  /// Show a suggestion that has multiple parts to it, always as its own subdiagnostic.
  /// In other words, multiple changes need to be applied as part of this suggestion.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:765 multipart_suggestion
  multipart_suggestion(msg: IntoDiagMessage, suggestion: [Span, string][], applicability: Applicability): this {
    return this.multipart_suggestion_with_style(msg, suggestion, applicability, "ShowAlways");
  }
  with_multipart_suggestion(msg: IntoDiagMessage, suggestion: [Span, string][], applicability: Applicability): this {
    this.multipart_suggestion(msg, suggestion, applicability);
    return this;
  }

  /// [`Diag::multipart_suggestion()`] but you can set the [`SuggestionStyle`].
  // rustc: compiler/rustc_errors/src/diagnostic.rs:780 multipart_suggestion_with_style
  multipart_suggestion_with_style(
    msg: IntoDiagMessage,
    suggestion_: [Span, string][],
    applicability: Applicability,
    style: SuggestionStyle,
  ): this {
    const seen = new Set<string>();
    const suggestion = suggestion_.filter(([span, msg]) => {
      const key = JSON.stringify([Span.lo(span), Span.hi(span), msg]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const parts = suggestion.map(([span, snippet]) => ({ snippet, span }));

    assert(parts.length !== 0, "assertion failed: !parts.is_empty()");
    // debug_assert_eq!(parts.iter().find(|part| part.span.is_empty() && part.snippet.is_empty()), None, "Span must not be empty and have no suggestion");
    // debug_assert_eq!(parts.array_windows().find(|[a, b]| a.span.overlaps(b.span)), None, "suggestion must not have overlapping parts");

    this.push_suggestion({
      substitutions: [{ parts }],
      msg: into_DiagMessage(msg),
      style,
      applicability,
    });
    return this;
  }

  /// Prints out a message with for a multipart suggestion without showing the suggested code.
  ///
  /// This is intended to be used for suggestions that are obvious in what the changes need to
  /// be from the message, showing the span label inline would be visually unpleasant
  /// (marginally overlapping spans or multiline spans) and showing the snippet window wouldn't
  /// improve understandability.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:822 tool_only_multipart_suggestion
  tool_only_multipart_suggestion(msg: IntoDiagMessage, suggestion: [Span, string][], applicability: Applicability): this {
    return this.multipart_suggestion_with_style(msg, suggestion, applicability, "CompletelyHidden");
  }

  /// Prints out a message with a suggested edit of the code.
  ///
  /// In case of short messages and a simple suggestion, rustc displays it as a label:
  ///
  /// ```text
  /// try adding parentheses: `(tup.0).1`
  /// ```
  ///
  /// The message
  ///
  /// * should not end in any punctuation (a `:` is added automatically)
  /// * should not be a question (avoid language like "did you mean")
  /// * should not contain any phrases like "the following", "as shown", etc.
  /// * may look like "to do xyz, use" or "to do xyz, use abc"
  /// * may contain a name of a function, variable, or type, but not whole expressions
  ///
  /// See [`CodeSuggestion`] for more information.
  // PORT: `suggestion: impl ToString` is passed as the string.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:854 span_suggestion
  span_suggestion(sp: Span, msg: IntoDiagMessage, suggestion: string, applicability: Applicability): this {
    this.span_suggestion_with_style(sp, msg, suggestion, applicability, "ShowCode");
    return this;
  }
  with_span_suggestion(sp: Span, msg: IntoDiagMessage, suggestion: string, applicability: Applicability): this {
    this.span_suggestion(sp, msg, suggestion, applicability);
    return this;
  }

  /// [`Diag::span_suggestion()`] but you can set the [`SuggestionStyle`].
  // rustc: compiler/rustc_errors/src/diagnostic.rs:873 span_suggestion_with_style
  span_suggestion_with_style(
    sp: Span,
    msg: IntoDiagMessage,
    suggestion: string,
    applicability: Applicability,
    style: SuggestionStyle,
  ): this {
    // debug_assert!(!(sp.is_empty() && suggestion.to_string().is_empty()), "Span must not be empty and have no suggestion");
    this.push_suggestion({
      substitutions: [{ parts: [{ snippet: suggestion, span: sp }] }],
      msg: into_DiagMessage(msg),
      style,
      applicability,
    });
    return this;
  }
  with_span_suggestion_with_style(
    sp: Span,
    msg: IntoDiagMessage,
    suggestion: string,
    applicability: Applicability,
    style: SuggestionStyle,
  ): this {
    this.span_suggestion_with_style(sp, msg, suggestion, applicability, style);
    return this;
  }

  /// Always show the suggested change.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:898 span_suggestion_verbose
  span_suggestion_verbose(sp: Span, msg: IntoDiagMessage, suggestion: string, applicability: Applicability): this {
    this.span_suggestion_with_style(sp, msg, suggestion, applicability, "ShowAlways");
    return this;
  }
  with_span_suggestion_verbose(sp: Span, msg: IntoDiagMessage, suggestion: string, applicability: Applicability): this {
    this.span_suggestion_verbose(sp, msg, suggestion, applicability);
    return this;
  }

  /// Prints out a message with multiple suggested edits of the code.
  /// See also [`Diag::span_suggestion()`].
  // rustc: compiler/rustc_errors/src/diagnostic.rs:918 span_suggestions
  span_suggestions(sp: Span, msg: IntoDiagMessage, suggestions: Iterable<string>, applicability: Applicability): this {
    return this.span_suggestions_with_style(sp, msg, suggestions, applicability, "ShowAlways");
  }
  with_span_suggestions(sp: Span, msg: IntoDiagMessage, suggestions: Iterable<string>, applicability: Applicability): this {
    this.span_suggestions(sp, msg, suggestions, applicability);
    return this;
  }

  // rustc: compiler/rustc_errors/src/diagnostic.rs:934 span_suggestions_with_style
  span_suggestions_with_style(
    sp: Span,
    msg: IntoDiagMessage,
    suggestions: Iterable<string>,
    applicability: Applicability,
    style: SuggestionStyle,
  ): this {
    const substitutions = [...suggestions].map((snippet) => {
      // debug_assert!(!(sp.is_empty() && snippet.is_empty()), "Span `{sp:?}` must not be empty and have no suggestion");
      return { parts: [{ snippet, span: sp }] };
    });
    this.push_suggestion({
      substitutions,
      msg: into_DiagMessage(msg),
      style,
      applicability,
    });
    return this;
  }

  /// Prints out a message with multiple suggested edits of the code, where each edit consists of
  /// multiple parts.
  /// See also [`Diag::multipart_suggestion()`].
  // rustc: compiler/rustc_errors/src/diagnostic.rs:964 multipart_suggestions
  multipart_suggestions(msg: IntoDiagMessage, suggestions: Iterable<[Span, string][]>, applicability: Applicability): this {
    const substitutions = [...suggestions].map((sugg) => {
      const parts = sugg.map(([span, snippet]) => ({ snippet, span }));

      // PORT: `sort_unstable_by_key(|part| part.span.lo_hi())`; JS sort is stable. Only parts
      // with identical `(lo, hi)` could be ordered differently.
      parts.sort((a, b) => {
        const [alo, ahi] = Span.lo_hi(a.span);
        const [blo, bhi] = Span.lo_hi(b.span);
        return alo !== blo ? alo - blo : ahi - bhi;
      });

      assert(parts.length !== 0, "assertion failed: !parts.is_empty()");
      // debug_assert_eq!(parts.iter().find(|part| part.span.is_empty() && part.snippet.is_empty()), None, "Span must not be empty and have no suggestion");
      // debug_assert_eq!(parts.array_windows().find(|[a, b]| a.span.overlaps(b.span)), None, "suggestion must not have overlapping parts");

      return { parts };
    });

    this.push_suggestion({
      substitutions,
      msg: into_DiagMessage(msg),
      style: "ShowAlways",
      applicability,
    });
    return this;
  }

  /// Prints out a message with a suggested edit of the code. If the suggestion is presented
  /// inline, it will only show the message and not the suggestion.
  ///
  /// See [`CodeSuggestion`] for more information.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1010 span_suggestion_short
  span_suggestion_short(sp: Span, msg: IntoDiagMessage, suggestion: string, applicability: Applicability): this {
    this.span_suggestion_with_style(sp, msg, suggestion, applicability, "HideCodeInline");
    return this;
  }
  with_span_suggestion_short(sp: Span, msg: IntoDiagMessage, suggestion: string, applicability: Applicability): this {
    this.span_suggestion_short(sp, msg, suggestion, applicability);
    return this;
  }

  /// Prints out a message for a suggestion without showing the suggested code.
  ///
  /// This is intended to be used for suggestions that are obvious in what the changes need to
  /// be from the message, showing the span label inline would be visually unpleasant
  /// (marginally overlapping spans or multiline spans) and showing the snippet window wouldn't
  /// improve understandability.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1033 span_suggestion_hidden
  span_suggestion_hidden(sp: Span, msg: IntoDiagMessage, suggestion: string, applicability: Applicability): this {
    this.span_suggestion_with_style(sp, msg, suggestion, applicability, "HideCodeAlways");
    return this;
  }

  /// Adds a suggestion to the JSON output that will not be shown in the CLI.
  ///
  /// This is intended to be used for suggestions that are *very* obvious in what the changes
  /// need to be from the message, but we still want other tools to be able to apply them.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1055 tool_only_span_suggestion
  tool_only_span_suggestion(sp: Span, msg: IntoDiagMessage, suggestion: string, applicability: Applicability): this {
    this.span_suggestion_with_style(sp, msg, suggestion, applicability, "CompletelyHidden");
    return this;
  }
  with_tool_only_span_suggestion(sp: Span, msg: IntoDiagMessage, suggestion: string, applicability: Applicability): this {
    this.tool_only_span_suggestion(sp, msg, suggestion, applicability);
    return this;
  }

  /// Add a subdiagnostic from a type that implements `Subdiagnostic` (see
  /// [rustc_macros::Subdiagnostic]). Performs eager formatting of any messages
  /// used in the subdiagnostic, so suitable for use with repeated messages (i.e. re-use of
  /// interpolated variables).
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1076 subdiagnostic
  subdiagnostic(subdiagnostic: Subdiagnostic): this {
    subdiagnostic.add_to_diag(this);
    return this;
  }

  /// Add a span.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1083 span
  span(sp: IntoMultiSpan): this {
    this.deref_mut().span = into_MultiSpan(sp);
    return this;
  }
  with_span(sp: IntoMultiSpan): this {
    this.span(sp);
    return this;
  }

  // rustc: compiler/rustc_errors/src/diagnostic.rs:1088 is_lint
  is_lint(name: string, has_future_breakage: boolean, rust_version: RustcVersion | undefined): this {
    this.deref_mut().is_lint = { name, has_future_breakage, rust_version };
    return this;
  }

  /// Add an error code.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1100 code
  code(code: ErrCode): this {
    this.deref_mut().code = code;
    return this;
  }
  with_code(code: ErrCode): this {
    this.code(code);
    return this;
  }

  /// Add a primary message.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1107 primary_message
  primary_message(msg: IntoDiagMessage): this {
    this.deref_mut().messages[0] = [into_DiagMessage(msg), "NoStyle"];
    return this;
  }
  with_primary_message(msg: IntoDiagMessage): this {
    this.primary_message(msg);
    return this;
  }

  /// Add an argument.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1114 arg
  arg(name: DiagArgName, arg: IntoDiagArg): this {
    this.deref_mut().arg(name, arg);
    return this;
  }
  with_arg(name: DiagArgName, arg: IntoDiagArg): this {
    this.arg(name, arg);
    return this;
  }

  /// Convenience function for internal use, clients should use one of the
  /// public methods above.
  ///
  /// Used by `proc_macro_server` for implementing `server::Diagnostic`.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1127 sub
  sub(level: Sublevel, message: IntoDiagMessage, span: MultiSpan): void {
    this.deref_mut().sub(level, message, span);
  }

  /// Convenience function for internal use, clients should use one of the
  /// public methods above.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1133 sub_with_highlights
  private sub_with_highlights(level: Sublevel, messages_: StringPart[], span: MultiSpan): void {
    const messages = messages_.map((m) => [DiagMessageC.from_String(m.content), m.style] as [DiagMessage, Style]);
    const sub = new Subdiag(level, messages, span);
    this.deref_mut().children.push(sub);
  }

  /// Takes the diagnostic. For use by methods that consume the Diag: `emit`,
  /// `cancel`, etc. Afterwards, `drop` is the only code that will be run on
  /// `self`.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1142 take_diag
  private take_diag(): DiagInner {
    const path = this.deref().long_ty_path;
    if (path !== undefined) {
      this.note(`the full name for the type has been written to '${path}'`);
      this.note("consider using `--verbose` to print the full type name to the console");
    }
    return unwrap(this.take_inner());
  }

  /// This method allows us to access the path of the file where "long types" are written to.
  ///
  /// When calling `Diag::emit`, as part of that we will check if a `long_ty_path` has been set,
  /// and if it has been then we add a note mentioning the file where the "long types" were
  /// written to.
  ///
  /// When calling `tcx.short_string()` after a `Diag` is constructed, the preferred way of doing
  /// so is `tcx.short_string(ty, diag.long_ty_path())`. The diagnostic itself is the one that
  /// keeps the existence of a "long type" anywhere in the diagnostic, so the note telling the
  /// user where we wrote the file to is only printed once at most, *and* it makes it much harder
  /// to forget to set it.
  ///
  /// If the diagnostic hasn't been created before a "short ty string" is created, then you should
  /// ensure that this method is called to set it `*diag.long_ty_path() = path`.
  ///
  /// As a rule of thumb, if you see or add at least one `tcx.short_string()` call anywhere, in a
  /// scope, `diag.long_ty_path()` should be called once somewhere close by.
  // PORT: `&mut Option<PathBuf>` -> a `MutRef` view onto the field.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1170 long_ty_path
  long_ty_path(): { value: PathBuf | undefined } {
    const inner = this.deref_mut();
    return {
      get value() {
        return inner.long_ty_path;
      },
      set value(v: PathBuf | undefined) {
        inner.long_ty_path = v;
      },
    };
  }

  // rustc: compiler/rustc_errors/src/diagnostic.rs:1174 with_long_ty_path
  with_long_ty_path(long_ty_path: PathBuf | undefined): this {
    this.deref_mut().long_ty_path = long_ty_path;
    return this;
  }

  /// Emit the diagnostic. Will also abort appropriately if the level is `Bug` or `Fatal`.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1181 emit
  emit(): void {
    const level = this.deref().level; // get level before taking the inner diag
    const diag = this.take_diag();
    this.dcx.emit_diagnostic(diag);

    switch (level.$) {
      case "Bug":
        throw new ExplicitBug();
      case "Fatal":
        new FatalError().raise();
        break;
      default:
        break;
    }
  }

  /// Use this on a `Bug` diagnostic if you need the `!` return type. Otherwise `emit` suffices.
  /// Aborts if used on a non-`Bug` diagnostic.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1196 emit_bug
  emit_bug(): never {
    assert_eq(this.deref().level, LevelC.Bug, debug_level, level_eq_fieldless);
    this.emit();
    return panic("internal error: entered unreachable code"); // `emit` will have aborted
  }

  /// Use this on a `Fatal` diagnostic if you need the `!` return type. Otherwise `emit`
  /// suffices. Aborts if used on a non-`Fatal` diagnostic.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1205 emit_fatal
  emit_fatal(): never {
    assert_eq(this.deref().level, LevelC.Fatal, debug_level, level_eq_fieldless);
    this.emit();
    return panic("internal error: entered unreachable code"); // `emit` will have aborted
  }

  /// Use this on an `Error`/`DelayedBug` diagnostic if you need the `ErrorGuaranteed` return
  /// type. Otherwise `emit` suffices. Aborts if used on a non-`Error`/`DelayedBug` diagnostic.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1214 emit_err
  emit_err(): ErrorGuaranteed {
    const diag = this.take_diag();

    // The only error levels that should reach here are `Error` and `DelayedBug`.
    // (Also, even though `level` isn't `pub`, the whole `DiagInner` could
    // be overwritten with a new one thanks to `DerefMut`. So this assert
    // protects against that, too.)
    assert(
      diag.level.$ === "Error" || diag.level.$ === "DelayedBug",
      `invalid diagnostic level (${debug_level(diag.level)})`,
    );

    const guar = this.dcx.emit_diagnostic(diag);
    return unwrap(guar);
  }

  /// Emit the diagnostic unless `delay` is true,
  /// in which case the emission will be delayed as a bug.
  ///
  /// See `emit` and `delay_as_bug` for details.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1236 emit_err_unless_delay
  emit_err_unless_delay(delay: boolean): ErrorGuaranteed {
    if (delay) {
      this.downgrade_to_delayed_bug();
    }
    return this.emit_err();
  }

  /// Cancel and consume the diagnostic. (A diagnostic must either be emitted or
  /// cancelled or it will panic when dropped).
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1245 cancel
  cancel(): void {
    this.take_inner();
    this.drop();
  }

  /// Cancels this diagnostic and returns its first message, if it exists.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1251 cancel_into_message
  cancel_into_message(): string | undefined {
    // PORT: each `?` early return drops `self` (the second one with `diag` still `Some`).
    if (this.diag === undefined) {
      this.drop();
      return undefined;
    }
    const first = this.diag.messages[0];
    if (first === undefined) {
      this.drop();
      return undefined;
    }
    const s = DiagMessageC.as_str(first[0]);
    this.cancel();
    return s;
  }

  /// See `DiagCtxtHandle::stash_diagnostic` for details.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1258 stash
  stash(span: Span, key: StashKey): ErrorGuaranteed | undefined {
    const diag = this.take_diag();
    return this.dcx.stash_diagnostic(span, key, diag);
  }

  /// Delay emission of this diagnostic as a bug.
  ///
  /// This can be useful in contexts where an error indicates a bug but
  /// typically this only happens when other compilation errors have already
  /// happened. In those cases this can be used to defer emission of this
  /// diagnostic as a bug in the compiler only if no other errors have been
  /// emitted.
  ///
  /// In the meantime, though, callsites are required to deal with the "bug"
  /// locally in whichever way makes the most sense.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1274 delay_as_bug
  delay_as_bug(): ErrorGuaranteed {
    this.downgrade_to_delayed_bug();
    return this.emit_err();
  }

  /// Destructor bomb: every `Diag` must be consumed (emitted, cancelled, etc.)
  /// or we emit a bug.
  // PORT: `impl Drop for Diag`; JS has no destructors, so this runs when called explicitly
  // (`cancel` does) and from `DiagCtxtInner.drop()` for every `Diag` still in `live_diags`.
  // rustc: compiler/rustc_errors/src/diagnostic.rs:1283 drop
  drop(): void {
    const diag = this.take_inner();
    if (diag !== undefined && !panicking()) {
      this.dcx.emit_diagnostic(
        DiagInner.new({ $: "Bug" }, DiagMessageC.from_str("the following error was constructed but not emitted")),
      );
      this.dcx.emit_diagnostic(diag);
      panic("error was constructed but not emitted");
    }
  }
}

/** `impl Debug for Diag<'_>`: `self.diag.fmt(f)` (an `Option<Box<DiagInner>>`). */
// rustc: compiler/rustc_errors/src/diagnostic.rs:390 fmt
export const debug_Diag: Debug<Diag> = (v: Diag, f: Fmt) => debug_option(v.diag, f, debug_DiagInner);

/** `{:?}` of a `Level` inside assertion messages (uses the generated Debug). */
function debug_level(level: Level): string {
  return debug_Level(level, PLAIN);
}

/** `Level: PartialEq` against a fieldless variant (`Bug`, `Fatal`): only the variant matters. */
function level_eq_fieldless(a: Level, b: Level): boolean {
  return a.$ === b.$;
}

/** `struct_span_code_err!($dcx, $span, $code, $($message)*)` (PORT: the message is pre-formatted). */
export function struct_span_code_err(dcx: DiagCtxtHandle, span: IntoMultiSpan, code: ErrCode, message: string): Diag {
  return dcx.struct_span_err(span, message).with_code(code);
}

