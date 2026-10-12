// Rust panics. rustc turns an uncaught panic into an ICE (exit 101); the driver does the same.

export class Panic extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Panic";
  }
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

export function assert(cond: boolean, message = "assertion failed"): asserts cond {
  if (!cond) throw new Panic(message);
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
export function assert_eq<T>(left: T, right: T, debug: (v: T) => string, eq: (a: T, b: T) => boolean = (a, b) => a === b): void {
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

/** Runs `f` as destructor code during unwinding: `panicking()` is true inside `f`. */
export function while_unwinding<R>(f: () => R): R {
  panic_count += 1;
  try {
    return f();
  } finally {
    panic_count -= 1;
  }
}
