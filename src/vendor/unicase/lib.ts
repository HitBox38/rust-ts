// Port of unicase-2.8.1/src/lib.rs (with `S` a JS string: the subset pulldown-cmark uses).
//
// PORT: `UniCase<S>` is a class over `Encoding` (a `$`-tagged union of `Ascii` / `Unicode`).
// `Hash` is ported as `hash(write_u8)`; `UniCase_key` turns that byte stream into a string, which is
// the JS `Map` key standing in for `HashMap<UniCase<_>, _>` (two values hash-stream-equal exactly when
// they are `==`, since both encodings write the case-folded UTF-8 bytes plus 0xFF).
// `Deref`/`AsRef`/`Display`/`Debug` give the inner string; the `From`/`Into` macro impls are
// `UniCase.unicode(..)` / `into_inner()`. `#![no_std]`, nightly benches and tests' `DefaultHasher` are
// not ported.
import { Ascii } from "./ascii.ts";
import { Unicode } from "./unicode/mod.ts";

export { Ascii } from "./ascii.ts";

type Encoding = { $: "Ascii"; _0: Ascii } | { $: "Unicode"; _0: Unicode };

function is_ascii_str(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) >= 0x80) return false;
  return true;
}

// crate: unicase-2.8.1/src/lib.rs:80 eq
export function eq(left: string, right: string): boolean {
  return UniCase.new(left).eq(UniCase.new(right));
}

// crate: unicase-2.8.1/src/lib.rs:88 eq_ascii
export function eq_ascii(left: string, right: string): boolean {
  return new Ascii(left).eq(right);
}

export class UniCase {
  constructor(public _0: Encoding) {}

  // crate: unicase-2.8.1/src/lib.rs:114 default
  static default_(): UniCase {
    return UniCase.new("");
  }

  // crate: unicase-2.8.1/src/lib.rs:123 new
  static new(s: string): UniCase {
    if (is_ascii_str(s)) {
      return new UniCase({ $: "Ascii", _0: new Ascii(s) });
    } else {
      return new UniCase({ $: "Unicode", _0: new Unicode(s) });
    }
  }

  // crate: unicase-2.8.1/src/lib.rs:138 to_folded_case
  to_folded_case(): string {
    switch (this._0.$) {
      case "Ascii": {
        // `to_ascii_lowercase`
        let out = "";
        for (const c of this._0._0._0) {
          const cp = c.codePointAt(0)!;
          out += cp >= 0x41 && cp <= 0x5a ? String.fromCharCode(cp + 0x20) : c;
        }
        return out;
      }
      case "Unicode":
        return this._0._0.to_folded_case();
    }
  }

  // crate: unicase-2.8.1/src/lib.rs:148 unicode
  static unicode(s: string): UniCase {
    return new UniCase({ $: "Unicode", _0: new Unicode(s) });
  }

  // crate: unicase-2.8.1/src/lib.rs:153 ascii
  static ascii(s: string): UniCase {
    return new UniCase({ $: "Ascii", _0: new Ascii(s) });
  }

  // crate: unicase-2.8.1/src/lib.rs:158 is_ascii
  is_ascii(): boolean {
    switch (this._0.$) {
      case "Ascii":
        return true;
      case "Unicode":
        return false;
    }
  }

  // crate: unicase-2.8.1/src/lib.rs:167 into_inner
  into_inner(): string {
    return this._0._0._0;
  }

  // crate: unicase-2.8.1/src/lib.rs:178 deref
  deref(): string {
    return this._0._0._0;
  }

  // crate: unicase-2.8.1/src/lib.rs:192 as_ref
  as_ref(): string {
    return this._0._0._0;
  }

  // crate: unicase-2.8.1/src/lib.rs:213 eq
  eq(other: UniCase): boolean {
    const a = this._0;
    const b = other._0;
    if (a.$ === "Ascii" && b.$ === "Ascii") return a._0.eq(b._0._0);
    if (a.$ === "Unicode" && b.$ === "Unicode") return a._0.eq(b._0);
    if (a.$ === "Ascii" && b.$ === "Unicode") return new Unicode(a._0.as_ref()).eq(b._0);
    if (a.$ === "Unicode" && b.$ === "Ascii") return a._0.eq(new Unicode(b._0.as_ref()));
    throw new Error("unreachable");
  }

  // crate: unicase-2.8.1/src/lib.rs:227 hash
  hash(write_u8: (b: number) => void): void {
    switch (this._0.$) {
      case "Ascii":
        return this._0._0.hash(write_u8);
      case "Unicode":
        return this._0._0.hash(write_u8);
    }
  }

  // crate: unicase-2.8.1/src/lib.rs:280 partial_cmp
  partial_cmp(other: UniCase): -1 | 0 | 1 {
    return this.cmp(other);
  }

  // crate: unicase-2.8.1/src/lib.rs:287 cmp
  cmp(other: UniCase): -1 | 0 | 1 {
    const a = this._0;
    const b = other._0;
    if (a.$ === "Ascii" && b.$ === "Ascii") return a._0.cmp(b._0);
    if (a.$ === "Unicode" && b.$ === "Unicode") return a._0.cmp(b._0);
    if (a.$ === "Ascii" && b.$ === "Unicode") return new Unicode(a._0.as_ref()).cmp(new Unicode(b._0._0));
    if (a.$ === "Unicode" && b.$ === "Ascii") return new Unicode(a._0._0).cmp(new Unicode(b._0.as_ref()));
    throw new Error("unreachable");
  }
}

/** PORT: the `Hash` byte stream of `u` as a string: the JS `Map` key for a `HashMap<UniCase<_>, _>`. */
export function UniCase_key(u: UniCase): string {
  let k = "";
  u.hash((b) => {
    k += String.fromCharCode(b);
  });
  return k;
}
