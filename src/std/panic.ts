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
