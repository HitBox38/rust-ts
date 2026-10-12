// Port of unicode-normalization =0.1.25 `src/stream_safe.rs` (its `#[cfg(test)] mod tests` is in
// stream_safe.test.ts).
import { debug_struct, type Debug } from "../../std/fmt.ts";
import type { CharIterator } from "./lib.ts";
import { canonical_combining_class, canonical_fully_decomposed, compatibility_fully_decomposed, stream_safe_trailing_nonstarters } from "./lookups.ts";
import { hangul_decomposition_length, is_hangul_syllable } from "./normalize.ts";
import { stream_safe_leading_nonstarters } from "./tables.ts";

export const MAX_NONSTARTERS = 30;
const COMBINING_GRAPHEME_JOINER = 0x034f;

/// [UAX15-D4]: This iterator keeps track of how many non-starters there have been
/// since the last starter in *NFKD* and will emit a Combining Grapheme Joiner
/// (U+034F) if the count exceeds 30.
///
/// [UAX15-D4]: https://www.unicode.org/reports/tr15/#UAX15-D4
export class StreamSafe<I extends CharIterator> implements CharIterator {
  constructor(
    public iter: I,
    public nonstarter_count: number,
    public buffer: number | undefined,
  ) {}

  /// Create a new stream safe iterator.
  ///
  /// Note that this iterator can also be obtained by directly calling [`.stream_safe()`](crate::UnicodeNormalization::stream_safe)
  /// on the iterator.
  // crate: unicode-normalization-0.1.25/src/stream_safe.rs:30 new
  static new<I extends CharIterator>(iter: I): StreamSafe<I> {
    return new StreamSafe(iter, 0, undefined);
  }

  // crate: unicode-normalization-0.1.25/src/stream_safe.rs:43 next
  next(): number | undefined {
    // `self.buffer.take().or_else(|| self.iter.next())?`
    let next_ch = this.buffer;
    this.buffer = undefined;
    if (next_ch === undefined) next_ch = this.iter.next();
    if (next_ch === undefined) return undefined;
    const d = classify_nonstarters(next_ch);
    if (this.nonstarter_count + d.leading_nonstarters > MAX_NONSTARTERS) {
      // Since we're emitting a CGJ, the suffix of the emitted string in NFKD has no trailing
      // nonstarters, so we can reset the counter to zero. Put `next_ch` back into the
      // iterator (via `self.buffer`), and we'll reclassify it next iteration.
      this.nonstarter_count = 0;
      this.buffer = next_ch;
      return COMBINING_GRAPHEME_JOINER;
    }

    // Is the character all nonstarters in NFKD? If so, increment our counter of contiguous
    // nonstarters in NKFD.
    if (d.leading_nonstarters === d.decomposition_len) {
      this.nonstarter_count += d.decomposition_len;
    }
    // Otherwise, reset the counter to the decomposition's number of trailing nonstarters.
    else {
      this.nonstarter_count = d.trailing_nonstarters;
    }
    return next_ch;
  }

  [Symbol.iterator](): Iterator<number> {
    return { next: () => {
      const value = this.next();
      return value === undefined ? { done: true, value: undefined } : { done: false, value };
    } };
  }
}

/** `#[derive(Debug)] pub(crate) struct Decomposition` */
export interface Decomposition {
  leading_nonstarters: number;
  trailing_nonstarters: number;
  decomposition_len: number;
}
export const debug_Decomposition: Debug<Decomposition> = (v, f) =>
  debug_struct(f, "Decomposition", [
    ["leading_nonstarters", String(v.leading_nonstarters)],
    ["trailing_nonstarters", String(v.trailing_nonstarters)],
    ["decomposition_len", String(v.decomposition_len)],
  ]);

// crate: unicode-normalization-0.1.25/src/stream_safe.rs:78 classify_nonstarters
export function classify_nonstarters(c: number): Decomposition {
  // As usual, fast path for ASCII (which is always a starter)
  if (c <= 0x7f) {
    return {
      leading_nonstarters: 0,
      trailing_nonstarters: 0,
      decomposition_len: 1,
    };
  }
  // Next, special case Hangul, since it's not handled by our tables.
  if (is_hangul_syllable(c)) {
    return {
      leading_nonstarters: 0,
      trailing_nonstarters: 0,
      decomposition_len: hangul_decomposition_length(c),
    };
  }
  const decomp = compatibility_fully_decomposed(c) ?? canonical_fully_decomposed(c);
  if (decomp !== undefined) {
    return {
      leading_nonstarters: stream_safe_leading_nonstarters(c),
      trailing_nonstarters: stream_safe_trailing_nonstarters(c),
      decomposition_len: decomp.length,
    };
  } else {
    const is_nonstarter = canonical_combining_class(c) !== 0;
    const nonstarter = is_nonstarter ? 1 : 0;
    return {
      leading_nonstarters: nonstarter,
      trailing_nonstarters: nonstarter,
      decomposition_len: 1,
    };
  }
}
