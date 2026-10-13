// Port of unicase-2.8.1/src/ascii.rs (with `S` a JS string; the subset pulldown-cmark reaches through
// `UniCase`). `Deref`/`DerefMut`/`Display`/`FromStr` are the field / `String(..)`; the
// `PartialEq<Ascii<S1>> for String / &str` mirrors are `Ascii.eq` with the operands swapped.
// Init order: lib.ts imports this file; `UniCase` is used only inside function bodies.
import { UniCase } from "./lib.ts";

function to_ascii_lowercase(c: number): number {
  return c >= 0x41 && c <= 0x5a ? c + 0x20 : c;
}

export class Ascii {
  constructor(public _0: string) {}

  // crate: unicase-2.8.1/src/ascii.rs:15 new
  static new(s: string): Ascii {
    return new Ascii(s);
  }

  // crate: unicase-2.8.1/src/ascii.rs:20 into_unicase
  into_unicase(): UniCase {
    return new UniCase({ $: "Ascii", _0: this });
  }

  // crate: unicase-2.8.1/src/ascii.rs:26 into_inner
  into_inner(): string {
    return this._0;
  }

  // crate: unicase-2.8.1/src/ascii.rs:55 cmp
  cmp(other: Ascii): -1 | 0 | 1 {
    const a = this._0;
    const b = other._0;
    // `Iterator::cmp` over `chars().map(to_ascii_lowercase)`
    const ai = a[Symbol.iterator]();
    const bi = b[Symbol.iterator]();
    for (;;) {
      const x = ai.next();
      const y = bi.next();
      if (x.done) return y.done ? 0 : -1;
      if (y.done) return 1;
      const cx = to_ascii_lowercase(x.value.codePointAt(0)!);
      const cy = to_ascii_lowercase(y.value.codePointAt(0)!);
      if (cx !== cy) return cx < cy ? -1 : 1;
    }
  }

  // crate: unicase-2.8.1/src/ascii.rs:64 as_ref
  as_ref(): string {
    return this._0;
  }

  // crate: unicase-2.8.1/src/ascii.rs:92 eq
  /** `self.as_ref().eq_ignore_ascii_case(other.as_ref())` */
  eq(other: string): boolean {
    const a = this._0;
    if (a.length !== other.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (to_ascii_lowercase(a.charCodeAt(i)) !== to_ascii_lowercase(other.charCodeAt(i))) return false;
    }
    return true;
  }

  // crate: unicase-2.8.1/src/ascii.rs:108 hash
  hash(write_u8: (b: number) => void): void {
    // PORT: `self.as_ref().bytes()`: the UTF-8 bytes (an `Ascii` holds ASCII in practice; non-ASCII
    // code units are encoded so the stream matches Rust's bytes).
    for (const byte of new TextEncoder().encode(this._0)) {
      write_u8(to_ascii_lowercase(byte));
    }
    // prefix-freedom
    write_u8(0xff);
  }
}
