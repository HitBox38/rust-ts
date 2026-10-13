// Port of unicode-security =0.1.2 `src/confusable_detection.rs`.

//! [Confusable detection](https://www.unicode.org/reports/tr39/#Confusable_Detection)

import { Str } from "../../std/str.ts";
import { type CharIterator, UnicodeNormalization_iter } from "../unicode_normalization/lib.ts";
import { char_confusable_prototype } from "./tables.ts";

// PORT: `enum OnceOrMore<T, I> { Once(iter::Once<T>), More(I) }` over chars: `Once` holds the pending char (or
// `undefined` once yielded), `More` the cloned-slice iterator as the slice and a position.
type OnceOrMore = { $: "Once"; _0: number | undefined } | { $: "More"; _0: readonly number[]; pos: number };

/** `impl<T, I> Iterator for OnceOrMore<T, I>` */
// crate: unicode-security-0.1.2/src/confusable_detection.rs:16 next
function OnceOrMore_next(self: OnceOrMore): number | undefined {
  // use OnceOrMore::*;
  switch (self.$) {
    case "Once": {
      const v = self._0;
      self._0 = undefined;
      return v;
    }
    case "More":
      return self.pos < self._0.length ? self._0[self.pos++] : undefined;
  }
}

// type StaticSliceIterCloned = core::iter::Cloned<core::slice::Iter<'static, char>>;

// crate: unicode-security-0.1.2/src/confusable_detection.rs:27 char_prototype
function char_prototype(c: number): OnceOrMore {
  // use crate::tables::confusable_detection::char_confusable_prototype;
  const l = char_confusable_prototype(c);
  if (l === undefined) {
    return { $: "Once", _0: c };
  } else {
    return { $: "More", _0: l, pos: 0 };
  }
}

/** `Iterator::flat_map(char_prototype)` over a char iterator. */
class FlatMapCharPrototype implements CharIterator {
  private front: OnceOrMore | undefined = undefined;
  constructor(private readonly iter: CharIterator) {}
  next(): number | undefined {
    for (;;) {
      if (this.front !== undefined) {
        const c = OnceOrMore_next(this.front);
        if (c !== undefined) return c;
        this.front = undefined;
      }
      const n = this.iter.next();
      if (n === undefined) return undefined;
      this.front = char_prototype(n);
    }
  }
}

/// Calculate skeleton for string, as defined by UTS 39
// crate: unicode-security-0.1.2/src/confusable_detection.rs:36 skeleton
export function skeleton(s: string): CharIterator {
  // use unicode_normalization::UnicodeNormalization;
  return UnicodeNormalization_iter.nfd(new FlatMapCharPrototype(UnicodeNormalization_iter.nfd(Str.from(s).chars())));
}
