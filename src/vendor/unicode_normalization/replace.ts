// Port of unicode-normalization =0.1.25 `src/replace.rs`.
//
// Copyright 2012-2015 The Rust Project Developers. See the COPYRIGHT
// file at the top-level directory of this distribution and at
// http://rust-lang.org/COPYRIGHT.
//
// Licensed under the Apache License, Version 2.0 <LICENSE-APACHE or
// http://www.apache.org/licenses/LICENSE-2.0> or the MIT license
// <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. This file may not be copied, modified, or distributed
// except according to those terms.
import { assert, unported } from "../../std/panic.ts";
import type { CharIterator, CloneCharIterator } from "./lib.ts";
// PORT: `super::char::decompose_cjk_compat_variants`, imported from its module (see decompose.ts).
import { decompose_cjk_compat_variants } from "./normalize.ts";

/// External iterator for replacements for a string's characters.
// #[derive(Clone)]
export class Replacements<I extends CharIterator> implements CharIterator {
  constructor(
    public iter: I,
    // At this time, the longest replacement sequence has length 2, so we just
    // need buffer space for 1 codepoint.
    public buffer: number | undefined,
  ) {}

  /// Create a new iterator that replaces [CJK Compatibility Ideograph] codepoints with normal forms using [Standardized Variation Sequences].
  ///
  /// Note that this iterator can also be obtained by directly calling [`.cjk_compat_variants()`] on the iterator.
  ///
  /// [CJK Compatibility Ideograph]: https://www.unicode.org/glossary/#compatibility_ideograph
  /// [Standardized Variation Sequences]: https://www.unicode.org/glossary/#standardized_variation_sequence
  /// [`.cjk_compat_variants()`]: crate::UnicodeNormalization::cjk_compat_variants
  // crate: unicode-normalization-0.1.25/src/replace.rs:34 new_cjk_compat_variants
  static new_cjk_compat_variants<I extends CharIterator>(iter: I): Replacements<I> {
    return new Replacements(iter, undefined);
  }

  // crate: unicode-normalization-0.1.25/src/replace.rs:43 next
  next(): number | undefined {
    if (this.buffer !== undefined) {
      // `self.buffer.take()`
      const c = this.buffer;
      this.buffer = undefined;
      return c;
    }

    const ch = this.iter.next();
    if (ch !== undefined) {
      // At this time, the longest replacement sequence has length 2.
      // PORT: `ArrayVec<[char; 2]>`: a plain array; `push` past capacity panics like ArrayVec's.
      const buffer: number[] = [];
      decompose_cjk_compat_variants(ch, (d) => {
        assert(buffer.length < 2, "ArrayVec::push> capacity overflow!");
        buffer.push(d);
      });
      this.buffer = buffer[1];
      return buffer[0]!;
    } else {
      return undefined;
    }
  }

  // crate: unicode-normalization-0.1.25/src/replace.rs:60 size_hint
  size_hint(): [number, number | undefined] {
    if (this.iter.size_hint === undefined) return unported("Iterator::size_hint of this char iterator");
    const [lower] = this.iter.size_hint();
    return [lower, undefined];
  }

  /** `#[derive(Clone)]` */
  clone(this: Replacements<I & CloneCharIterator>): Replacements<I> {
    return new Replacements<I>(this.iter.clone(), this.buffer);
  }

  [Symbol.iterator](): Iterator<number> {
    return { next: () => {
      const value = this.next();
      return value === undefined ? { done: true, value: undefined } : { done: false, value };
    } };
  }
}

// crate: unicode-normalization-0.1.25/src/replace.rs:69 fmt
/** `impl<I: Iterator<Item = char> + Clone> fmt::Display for Replacements<I>` */
export function display_Replacements<I extends CloneCharIterator>(self: Replacements<I>): string {
  let f = "";
  const it = self.clone();
  for (let c = it.next(); c !== undefined; c = it.next()) {
    f += String.fromCodePoint(c);
  }
  return f;
}
