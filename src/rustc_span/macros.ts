import { Panic } from "../std/panic.ts";
import type { Span } from "./span_encoding.ts";

/// Signifies that the compiler died with an explicit call to `.bug` or `.span_bug` rather than a
/// failed assertion, etc.
// PORT: extends `Panic` so an uncaught `ExplicitBug` is an ICE (exit 101) like upstream's
// `panic_any(ExplicitBug)`.
export class ExplicitBug extends Panic {
  constructor() {
    super("ExplicitBug");
    this.name = "ExplicitBug";
  }
}

// PORT: `std::panic::Location` (from `#[track_caller]`) has no JS equivalent; callers pass
// `undefined`. Only the bug-diagnostic hook reads it.
export interface Location {
  readonly file: string;
  readonly line: number;
  readonly col: number;
}

/// A macro for triggering an ICE.
/// Calling `bug` instead of panicking will result in a nicer error message and should
/// therefore be preferred over `panic`/`unreachable` or others.
///
/// If you have a span available, you should use [`span_bug`] instead.
// PORT: `bug!(...)` -> `bug(message)`; `format_args!` is pre-formatted by the caller.
export function bug(args: string = "impossible case reached"): never {
  return bug_impl(undefined, args, undefined);
}

/// A macro for triggering an ICE with a span.
/// Calling `span_bug!` instead of panicking will result in a nicer error message and point
/// at the code the compiler was compiling when it ICEd. This is the preferred way to trigger
/// ICEs.
// PORT: `span_bug!(span, ...)` -> `span_bug(span, message)`.
export function span_bug(span: Span, args: string): never {
  return bug_impl(span, args, undefined);
}

// rustc: compiler/rustc_span/src/macros.rs:51 bug_impl
export function bug_impl(span: Span | undefined, args: string, location: Location | undefined): never {
  // Emit the bug without aborting.
  const emitted = EMIT_BUG_DIAGNOSTIC.f(span, args, location);

  if (emitted) {
    // Panic with `ExplicitBug`, which tells `report_ice` that it's expected, e.g. originating
    // from `bug!` or `dcx.emit_bug(..)`.
    throw new ExplicitBug();
  } else {
    // Panic with just a string, which means it's unexpected.
    throw new Panic(`${args}`);
  }
}

/** `AtomicRef<fn(Option<Span>, fmt::Arguments, &Location) -> bool>`; rustc_errors swaps `f`. */
export const EMIT_BUG_DIAGNOSTIC: { f: (span: Span | undefined, args: string, location: Location | undefined) => boolean } = {
  f: default_emit_bug_diagnostic,
};

// rustc: compiler/rustc_span/src/macros.rs:73 default_emit_bug_diagnostic
function default_emit_bug_diagnostic(_: Span | undefined, _args: string, _location: Location | undefined): boolean {
  return false;
}
