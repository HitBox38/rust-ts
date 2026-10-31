// Port of library/proc_macro/src/diagnostic.rs.
//
// PORT: `proc_macro` is a library crate (`compiler/rustc_proc_macro` builds `library/proc_macro`), so it is
// ported like `src/std/` with `// std:` markers pointing at `library/proc_macro/src/...` (decision 2026-10-13;
// coverage.ts only counts `compiler/` files). `Level` is also named by the server side
// (`rustc_expand::proc_macro_server`); the `Diagnostic` builder is the client side (plan-m6 D8).
// `T: Into<String>` message arguments are JS strings.

import { type Debug, debug_str, debug_struct, debug_tuple, debug_vec, type Fmt } from "../std/fmt.ts";
import type { Diagnostic as BridgeDiagnostic } from "./bridge/mod.ts";
// PORT: value imports come from bridge/client.ts, not lib.ts: client.ts → bridge/mod.ts → diagnostic.ts would
// otherwise evaluate lib.ts before client.ts finishes (lib.ts installs client.ts's `crate_TokenStream.new_` at load).
import { debug_Span as debug_client_Span, Methods as BridgeMethods, type Span as client_Span } from "./bridge/client.ts";
import type { Span } from "./lib.ts";

/// An enum representing a diagnostic level.
// std-type: library/proc_macro/src/diagnostic.rs:7 Level
// PORT: `#[non_exhaustive]` has no TS counterpart; matches over `Level` keep their `_ =>` arms.
export type Level =
  /// An error.
  | "Error"
  /// A warning.
  | "Warning"
  /// A note.
  | "Note"
  /// A help message.
  | "Help";
export const Level = { Error: "Error", Warning: "Warning", Note: "Note", Help: "Help" } as const;
/** `#[derive(Debug)]` */
export const debug_Level: Debug<Level> = (v) => v;

/// Trait implemented by types that can be converted into a set of `Span`s.
// std-type: library/proc_macro/src/diagnostic.rs:20 MultiSpan
// PORT: the implementors are `Span`, `Vec<Span>` and `&[Span]`; `MultiSpan` is their union and `into_spans`
// dispatches on it (an array is the `Vec<Span>` impl, which takes ownership as the `&[Span]` one copies).
export type MultiSpan = Span | Span[];
export const MultiSpan = {
  /// Converts `self` into a `Vec<Span>`.
  // std: library/proc_macro/src/diagnostic.rs:22 into_spans
  into_spans(self: MultiSpan): Span[] {
    return Array.isArray(self) ? MultiSpan_for_Vec.into_spans(self) : MultiSpan_for_Span.into_spans(self);
  },
};

export const MultiSpan_for_Span = {
  // std: library/proc_macro/src/diagnostic.rs:27 into_spans
  into_spans(self: Span): Span[] {
    return [self];
  },
};

export const MultiSpan_for_Vec = {
  // std: library/proc_macro/src/diagnostic.rs:34 into_spans
  into_spans(self: Span[]): Span[] {
    return self;
  },
};

export const MultiSpan_for_slice = {
  // std: library/proc_macro/src/diagnostic.rs:41 into_spans
  into_spans(self: readonly Span[]): Span[] {
    return self.slice();
  },
};

/// A structure representing a diagnostic message and associated children
/// messages.
// std-type: library/proc_macro/src/diagnostic.rs:50 Diagnostic
export class Diagnostic {
  constructor(
    private level_: Level,
    private message_: string,
    private spans_: Span[],
    private children_: Diagnostic[],
  ) {}

  /** `#[derive(Clone)]` (spans are `Copy`). */
  clone(): Diagnostic {
    return new Diagnostic(
      this.level_,
      this.message_,
      this.spans_.slice(),
      this.children_.map((c) => c.clone()),
    );
  }

  /** The fields, for `#[derive(Debug)]` (Rust field names `level`, `message`, `spans`, `children`). */
  fields(): { level: Level; message: string; spans: readonly Span[]; children: readonly Diagnostic[] } {
    return { level: this.level_, message: this.message_, spans: this.spans_, children: this.children_ };
  }

  /// Creates a new diagnostic with the given `level` and `message`.
  // std: library/proc_macro/src/diagnostic.rs:99 new
  static new(level: Level, message: string): Diagnostic {
    return new Diagnostic(level, message, [], []);
  }

  /// Creates a new diagnostic with the given `level` and `message` pointing to
  /// the given set of `spans`.
  // std: library/proc_macro/src/diagnostic.rs:106 spanned
  static spanned(spans: MultiSpan, level: Level, message: string): Diagnostic {
    return new Diagnostic(level, message, MultiSpan.into_spans(spans), []);
  }

  // diagnostic_child_methods!(span_error, error, Level::Error);
  /// Adds a new child diagnostics message to `self` with the [`Level::Error`] level, and the given `spans` and `message`.
  span_error(spans: MultiSpan, message: string): Diagnostic {
    this.children_.push(Diagnostic.spanned(spans, Level.Error, message));
    return this;
  }
  /// Adds a new child diagnostic message to `self` with the [`Level::Error`] level, and the given `message`.
  error(message: string): Diagnostic {
    this.children_.push(Diagnostic.new(Level.Error, message));
    return this;
  }
  // diagnostic_child_methods!(span_warning, warning, Level::Warning);
  /// Adds a new child diagnostics message to `self` with the [`Level::Warning`] level, and the given `spans` and `message`.
  span_warning(spans: MultiSpan, message: string): Diagnostic {
    this.children_.push(Diagnostic.spanned(spans, Level.Warning, message));
    return this;
  }
  /// Adds a new child diagnostic message to `self` with the [`Level::Warning`] level, and the given `message`.
  warning(message: string): Diagnostic {
    this.children_.push(Diagnostic.new(Level.Warning, message));
    return this;
  }
  // diagnostic_child_methods!(span_note, note, Level::Note);
  /// Adds a new child diagnostics message to `self` with the [`Level::Note`] level, and the given `spans` and `message`.
  span_note(spans: MultiSpan, message: string): Diagnostic {
    this.children_.push(Diagnostic.spanned(spans, Level.Note, message));
    return this;
  }
  /// Adds a new child diagnostic message to `self` with the [`Level::Note`] level, and the given `message`.
  note(message: string): Diagnostic {
    this.children_.push(Diagnostic.new(Level.Note, message));
    return this;
  }
  // diagnostic_child_methods!(span_help, help, Level::Help);
  /// Adds a new child diagnostics message to `self` with the [`Level::Help`] level, and the given `spans` and `message`.
  span_help(spans: MultiSpan, message: string): Diagnostic {
    this.children_.push(Diagnostic.spanned(spans, Level.Help, message));
    return this;
  }
  /// Adds a new child diagnostic message to `self` with the [`Level::Help`] level, and the given `message`.
  help(message: string): Diagnostic {
    this.children_.push(Diagnostic.new(Level.Help, message));
    return this;
  }

  /// Returns the diagnostic `level` for `self`.
  // std: library/proc_macro/src/diagnostic.rs:121 level
  level(): Level {
    return this.level_;
  }

  /// Sets the level in `self` to `level`.
  // std: library/proc_macro/src/diagnostic.rs:127 set_level
  set_level(level: Level): void {
    this.level_ = level;
  }

  /// Returns the message in `self`.
  // std: library/proc_macro/src/diagnostic.rs:133 message
  message(): string {
    return this.message_;
  }

  /// Sets the message in `self` to `message`.
  // std: library/proc_macro/src/diagnostic.rs:139 set_message
  set_message(message: string): void {
    this.message_ = message;
  }

  /// Returns the `Span`s in `self`.
  // std: library/proc_macro/src/diagnostic.rs:145 spans
  spans(): readonly Span[] {
    return this.spans_;
  }

  /// Sets the `Span`s in `self` to `spans`.
  // std: library/proc_macro/src/diagnostic.rs:151 set_spans
  set_spans(spans: MultiSpan): void {
    this.spans_ = MultiSpan.into_spans(spans);
  }

  /// Returns an iterator over the children diagnostics of `self`.
  // std: library/proc_macro/src/diagnostic.rs:157 children
  children(): Children {
    return new Children(this.children_, 0);
  }

  /// Emit the diagnostic.
  // std: library/proc_macro/src/diagnostic.rs:163 emit
  emit(): void {
    // std: library/proc_macro/src/diagnostic.rs:164 to_internal
    function to_internal(diag: Diagnostic): BridgeDiagnostic<client_Span> {
      return {
        level: diag.level_,
        message: diag.message_,
        spans: diag.spans_.map((s) => s._0),
        children: diag.children_.map(to_internal),
      };
    }

    BridgeMethods.emit_diagnostic(to_internal(this));
  }
}

/** `#[derive(Debug)]` */
export const debug_Diagnostic: Debug<Diagnostic> = (v, f) => {
  const d = v.fields();
  return debug_struct(f, "Diagnostic", [
    ["level", debug_Level(d.level, f)],
    ["message", debug_str(d.message)],
    ["spans", debug_vec(d.spans, f, (v: Span, f: Fmt) => debug_client_Span(v._0, f))], // lib.ts `debug_Span`
    ["children", debug_vec(d.children, f, debug_Diagnostic)],
  ]);
};

/// Iterator over the children diagnostics of a `Diagnostic`.
// std-type: library/proc_macro/src/diagnostic.rs:84 Children
// PORT: `std::slice::Iter` is the slice plus a cursor.
export class Children {
  constructor(
    private readonly slice: readonly Diagnostic[],
    private pos: number,
  ) {}

  /** `#[derive(Clone)]` */
  clone(): Children {
    return new Children(this.slice, this.pos);
  }

  // std: library/proc_macro/src/diagnostic.rs:90 next
  next(): Diagnostic | undefined {
    if (this.pos >= this.slice.length) return undefined;
    return this.slice[this.pos++];
  }
}

/** `#[derive(Debug)]`: `Children(Iter([..]))` (`slice::Iter`'s Debug lists the remaining items). */
export const debug_Children: Debug<Children> = (v, f: Fmt) => {
  const rest: Diagnostic[] = [];
  const it = v.clone();
  for (let d = it.next(); d !== undefined; d = it.next()) rest.push(d);
  return debug_tuple(f, "Children", [debug_tuple(f, "Iter", [debug_vec(rest, f, debug_Diagnostic)])]);
};
