// Port of icu_locale_core 2.3.0 `src/parser/mod.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

// pub mod errors; mod langid; mod locale;
export { ParseError } from "./errors.ts";
export * from "./langid.ts";
export * from "./locale.ts";

// Safety-usable invariant: returns a prefix of `slice`
// crate: icu_locale_core-2.3.0/src/parser/mod.rs:15 skip_before_separator
export function skip_before_separator(slice: Uint8Array): Uint8Array {
  let end = 0;
  // Invariant: end ≤ slice.len() since len is a nonnegative integer and end is 0

  while (end < slice.length && slice[end] !== 0x2d /* b'-' */) {
    // Invariant at beginning of loop: end < slice.len()
    // Advance until we reach end of slice or a separator.
    end += 1;
    // Invariant at end of loop: end ≤ slice.len()
  }

  // Notice: this slice may be empty for cases like `"en-"` or `"en--US"`
  // SAFETY: end ≤ slice.len() by while loop
  // Safety-usable invariant upheld: returned a prefix of the slice
  return slice.subarray(0, end);
}

// `SubtagIterator` is a helper iterator for [`LanguageIdentifier`] and [`Locale`] parsing.
//
// It is quite extraordinary due to focus on performance and Rust limitations for `const`
// functions.
//
// The iterator is eager and fallible allowing it to reject invalid slices such as `"-"`, `"-en"`,
// `"en-"` etc.
//
// The iterator provides methods available for static users - `next_manual` and `peek_manual`,
// as well as typical `Peekable` iterator APIs - `next` and `peek`.
//
// All methods return an `Option` of a `Result`.
// #[derive(Copy, Clone, Debug)]
// PORT: the type is `Copy`; `next_const` returns a new iterator and leaves `this` unchanged,
// `next` (the `Iterator` impl) updates `this` in place.
export class SubtagIterator {
  constructor(
    public remaining: Uint8Array,
    // Safety invariant: current is a prefix of remaining
    public current: Uint8Array | undefined,
  ) {}

  // crate: icu_locale_core-2.3.0/src/parser/mod.rs:53 new
  static new(rest: Uint8Array): SubtagIterator {
    // Safety invariant upheld: skip_before_separator() returns a prefix of `rest`
    return new SubtagIterator(rest, skip_before_separator(rest));
  }

  // crate: icu_locale_core-2.3.0/src/parser/mod.rs:61 next_const
  next_const(): [SubtagIterator, Uint8Array | undefined] {
    const self = new SubtagIterator(this.remaining, this.current);
    const result = self.current;
    if (result === undefined) {
      return [self, undefined];
    }

    if (result.length < self.remaining.length) {
      // If there is more after `result`, by construction `current` starts with a separator
      // SAFETY: `self.remaining` is strictly longer than `result` due to `result` being a prefix (from the safety invariant)
      self.remaining = self.remaining.subarray(result.length + 1);
      // Safety invariant upheld: skip_before_separator() returns a prefix of `rest`, and we don't
      // mutate self.remaining after this
      self.current = skip_before_separator(self.remaining);
    } else {
      self.current = undefined;
    }
    return [self, result];
  }

  // crate: icu_locale_core-2.3.0/src/parser/mod.rs:79 peek
  peek(): Uint8Array | undefined {
    return this.current;
  }

  // impl Iterator for SubtagIterator
  // crate: icu_locale_core-2.3.0/src/parser/mod.rs:87 next
  next(): Uint8Array | undefined {
    const [s, res] = this.next_const();
    this.remaining = s.remaining;
    this.current = s.current;
    return res;
  }

  /** `Iterator` adapter (`for x in iter`). */
  *[Symbol.iterator](): Iterator<Uint8Array> {
    for (let x = this.next(); x !== undefined; x = this.next()) yield x;
  }
}
