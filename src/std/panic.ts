// Rust panics. rustc turns an uncaught panic into an ICE (exit 101); the driver does the same.

/**
 * PORT: Rust runs the panic hook at the panic, before unwinding starts, so the query context is still live when the
 * hook prints it. The one place every panic passes is this constructor, which calls `panic_with_hook` (std/panicking.ts)
 * once a hook is installed. `resume_unwind` runs no hook, which here is `run_hook = false` (a re-raised payload:
 * proc_macro/bridge/panic_message.ts `into_payload`). A subclass sets its `name` after `super()`, so the hook must tell
 * subclasses apart with `instanceof` and never read `name`.
 */
export class Panic extends Error {
  /** The panic hook has told the user about this panic, so an entry point's last-resort banner stays silent. */
  reported: boolean;

  constructor(message: string, run_hook: boolean = true) {
    super(message);
    this.name = "Panic";
    this.reported = !run_hook && PANIC_WITH_HOOK !== undefined;
    if (run_hook && PANIC_WITH_HOOK !== undefined) PANIC_WITH_HOOK(this);
  }

  /** `payload_as_str`: the text of a `&str`/`String` payload; `panic_any` subclasses have none (`Box<dyn Any>`). */
  payload_as_str(): string | undefined {
    return this.message;
  }
}

/** Set by std/panicking.ts when a hook is installed. PORT: a function here keeps this module free of imports, since
 *  everything imports it. `undefined` means no hook: entry points without one report at top level. */
let PANIC_WITH_HOOK: ((payload: Panic) => void) | undefined;

export function set_panic_with_hook(f: ((payload: Panic) => void) | undefined): void {
  PANIC_WITH_HOOK = f;
}

/**
 * Keeps the calling frame on the stack where a call returns a value and `#[track_caller]` needs that frame: JSC's proper
 * tail calls drop it on `return f(..)`. Write `return keep_frame(f(..))`, or a bare `f(..);` for a `never` call. Other shapes
 * do not work: Bun 1.4.3 folds `const r = f(); return r;` back into a tail call (src/rust_ts/track_caller.test.ts pins this).
 */
export function keep_frame<T>(value: T): T {
  return value;
}

/** Code path not ported yet. The driver maps this to exit code 70 ("UNPORTED"), never to a rustc status. */
export class Unported extends Error {
  constructor(readonly what: string) {
    super(`unported: ${what}`);
    this.name = "Unported";
  }
}

export function panic(message = "explicit panic"): never {
  throw new Panic(message);
}

export function unported(what: string): never {
  throw new Unported(what);
}

/** `assert!`: the message may be a thunk so that, as in Rust, it is only formatted when the assertion fails. */
export function assert(cond: boolean, message: string | (() => string) = "assertion failed"): asserts cond {
  if (!cond) throw new Panic(typeof message === "function" ? message() : message);
}

export function unreachable(message = "internal error: entered unreachable code"): never {
  throw new Panic(message);
}

/** `Option::unwrap` */
export function unwrap<T>(v: T | undefined, message = "called `Option::unwrap()` on a `None` value"): T {
  if (v === undefined) throw new Panic(message);
  return v;
}

/**
 * `assert_eq!(left, right)`: panics with core's text (library/core/src/panicking.rs
 * `assert_failed_inner`, `AssertKind::Eq`, no args) when `eq(left, right)` is false.
 * `debug` renders each side with `{:?}`. `eq` defaults to `===`.
 */
// PORT: (perf) the default `eq` is one shared function, not a closure allocated per call.
const strict_eq = (a: unknown, b: unknown): boolean => a === b;

export function assert_eq<T>(left: T, right: T, debug: (v: T) => string, eq: (a: T, b: T) => boolean = strict_eq): void {
  if (!eq(left, right)) {
    throw new Panic(`assertion \`left == right\` failed\n  left: ${debug(left)}\n right: ${debug(right)}`);
  }
}

/**
 * `assert_matches!(left, <pattern>)`: panics with core's text (`assert_matches_failed` →
 * `assert_failed_inner`, `AssertKind::Match`, no args) when `matches` is false. `pattern` is
 * the macro's `stringify!` of the pattern (e.g. `"Error | Warning(_)"`).
 */
export function assert_matches<T>(left: T, matches: boolean, pattern: string, debug: (v: T) => string): void {
  if (!matches) {
    throw new Panic(`assertion \`left matches right\` failed\n  left: ${debug(left)}\n right: ${pattern}`);
  }
}

// `std::thread::panicking()`. JS has no unwinding destructors: code that upstream runs in `Drop`
// impls while a panic unwinds (e.g. dropping the `Session`/`DiagCtxt` after `resume_unwind`) is
// called explicitly by the driver inside `while_unwinding`, which is when `panicking()` is true.
let panic_count = 0;

/** `std::thread::panicking()` */
export function panicking(): boolean {
  return panic_count > 0;
}

/** `panic_count::get_count()` */
export function panic_count_get(): number {
  return panic_count;
}

/** Runs `f` as destructor code during unwinding: `panicking()` is true inside `f`. Also the panic hook's count. */
export function while_unwinding<R>(f: () => R): R {
  panic_count += 1;
  try {
    return f();
  } finally {
    panic_count -= 1;
  }
}
