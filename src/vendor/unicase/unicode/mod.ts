// Port of unicase-2.8.1/src/unicode/mod.rs (with `S = &str`/`String`: a JS string).
// PORT: `Unicode<S>` is a class over the string. `Fold` (the iterator over 0..3 chars) is a `$`-tagged
// union; its `Iterator::next` takes a `MutRef<Fold>`, and `fold_chars` drains it (`flat_map(lookup)`).
// `Hash` writes through a `write_u8` callback (see lib.ts `UniCase_key`).
// Init order: map.ts imports only the `Fold` type from here.
import type { MutRef } from "../../../std/mut_ref.ts";
import { lookup } from "./map.ts";

export class Unicode {
  constructor(public _0: string) {}

  // crate: unicase-2.8.1/src/unicode/mod.rs:12 to_folded_case
  to_folded_case(): string {
    let s = "";
    for (const c of fold_str(this._0)) s += String.fromCodePoint(c);
    return s;
  }

  // crate: unicase-2.8.1/src/unicode/mod.rs:19 eq
  eq(other: Unicode): boolean {
    const left = fold_str(this._0)[Symbol.iterator]();
    const right = fold_str(other._0)[Symbol.iterator]();

    // inline Iterator::eq since not added until Rust 1.5
    for (;;) {
      const xn = left.next();
      if (xn.done) return right.next().done === true;
      const x = xn.value;

      const yn = right.next();
      if (yn.done) return false;
      const y = yn.value;

      if (x !== y) {
        return false;
      }
    }
  }

  // crate: unicase-2.8.1/src/unicode/mod.rs:46 partial_cmp
  partial_cmp(other: Unicode): -1 | 0 | 1 {
    return this.cmp(other);
  }

  // crate: unicase-2.8.1/src/unicode/mod.rs:53 cmp
  cmp(other: Unicode): -1 | 0 | 1 {
    const self_chars = fold_str(this._0)[Symbol.iterator]();
    const other_chars = fold_str(other._0)[Symbol.iterator]();
    // `Iterator::cmp`
    for (;;) {
      const a = self_chars.next();
      const b = other_chars.next();
      if (a.done) return b.done ? 0 : -1;
      if (b.done) return 1;
      if (a.value !== b.value) return a.value < b.value ? -1 : 1;
    }
  }

  // crate: unicase-2.8.1/src/unicode/mod.rs:62 hash
  hash(write_u8: (b: number) => void): void {
    const buf = [0, 0, 0, 0];
    for (const c of fold_str(this._0)) {
      const len = char_to_utf8(c, buf);
      // we can't use `write(buf)` because the ASCII variant uses
      // `write_u8`. The docs for Hash say that's technically different.
      // ¯\_(ツ)_/¯
      for (let i = 0; i < len; i++) {
        write_u8(buf[i]!);
      }
    }
    // prefix-freedom
    write_u8(0xff);
  }
}

/** `s.chars().flat_map(lookup)` */
export function* fold_str(s: string): Generator<number> {
  for (const ch of s) {
    const f: MutRef<Fold> = { value: lookup(ch.codePointAt(0)!) };
    for (let c = Fold.next(f); c !== undefined; c = Fold.next(f)) yield c;
  }
}

// crate: unicase-2.8.1/src/unicode/mod.rs:79 char_to_utf8
function char_to_utf8(c: number, dst: number[]): number {
  const TAG_CONT = 0b1000_0000;
  const TAG_TWO_B = 0b1100_0000;
  const TAG_THREE_B = 0b1110_0000;
  const TAG_FOUR_B = 0b1111_0000;

  const code = c;
  if (code <= 0x7f) {
    dst[0] = code;
    return 1;
  } else if (code <= 0x7ff) {
    dst[0] = ((code >> 6) & 0x1f) | TAG_TWO_B;
    dst[1] = (code & 0x3f) | TAG_CONT;
    return 2;
  } else if (code <= 0xffff) {
    dst[0] = ((code >> 12) & 0x0f) | TAG_THREE_B;
    dst[1] = ((code >> 6) & 0x3f) | TAG_CONT;
    dst[2] = (code & 0x3f) | TAG_CONT;
    return 3;
  } else {
    dst[0] = ((code >> 18) & 0x07) | TAG_FOUR_B;
    dst[1] = ((code >> 12) & 0x3f) | TAG_CONT;
    dst[2] = ((code >> 6) & 0x3f) | TAG_CONT;
    dst[3] = (code & 0x3f) | TAG_CONT;
    return 4;
  }
}

// internal mod so that the enum can be 'pub'
// thanks privacy-checker :___(
// mod fold
export type Fold =
  | { $: "Zero" }
  | { $: "One"; _0: number }
  | { $: "Two"; _0: number; _1: number }
  | { $: "Three"; _0: number; _1: number; _2: number };

export const Fold = {
  Zero: { $: "Zero" } as Fold,

  // crate: unicase-2.8.1/src/unicode/mod.rs:121 next
  next(self: MutRef<Fold>): number | undefined {
    const v = self.value;
    switch (v.$) {
      case "Zero":
        return undefined;
      case "One": {
        self.value = Fold.Zero;
        return v._0;
      }
      case "Two": {
        self.value = { $: "One", _0: v._1 };
        return v._0;
      }
      case "Three": {
        // PORT: as upstream: `Three(one, two, three)` yields `three` first, then becomes `Two(one, two)`.
        self.value = { $: "Two", _0: v._0, _1: v._1 };
        return v._2;
      }
    }
  },

  // crate: unicase-2.8.1/src/unicode/mod.rs:140 size_hint
  size_hint(self: Fold): [number, number | undefined] {
    switch (self.$) {
      case "Zero":
        return [0, 0];
      case "One":
        return [1, 1];
      case "Two":
        return [2, 2];
      case "Three":
        return [3, 3];
    }
  },

  // crate: unicase-2.8.1/src/unicode/mod.rs:151 from
  from_1([one]: [number]): Fold {
    return { $: "One", _0: one };
  },

  // crate: unicase-2.8.1/src/unicode/mod.rs:158 from
  from_2([one, two]: [number, number]): Fold {
    return { $: "Two", _0: one, _1: two };
  },

  // crate: unicase-2.8.1/src/unicode/mod.rs:165 from
  from_3([one, two, three]: [number, number, number]): Fold {
    return { $: "Three", _0: one, _1: two, _2: three };
  },
};
