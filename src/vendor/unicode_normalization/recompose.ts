// Port of unicode-normalization =0.1.25 `src/recompose.rs`.
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
import { Decompositions } from "./decompose.ts";
import type { CharIterator, CloneCharIterator } from "./lib.ts";
// PORT: `super::char::{canonical_combining_class, compose}`, imported from their modules (see decompose.ts).
import { canonical_combining_class } from "./lookups.ts";
import { compose } from "./normalize.ts";

/** `#[derive(Clone)] enum RecompositionState` */
type RecompositionState =
  | { readonly $: "Composing" }
  | { readonly $: "Purging"; _0: number }
  | { readonly $: "Finished"; _0: number };
const RecompositionState = {
  Composing: Object.freeze({ $: "Composing" as const }),
};

/// External iterator for a string recomposition's characters.
// #[derive(Clone)]
export class Recompositions<I extends CharIterator> implements CharIterator {
  constructor(
    public iter: Decompositions<I>,
    public state: RecompositionState,
    public buffer: number[],
    public composee: number | undefined,
    public last_ccc: number | undefined,
  ) {}

  /// Create a new recomposition iterator for canonical compositions (NFC)
  ///
  /// Note that this iterator can also be obtained by directly calling [`.nfc()`](crate::UnicodeNormalization::nfc)
  /// on the iterator.
  // crate: unicode-normalization-0.1.25/src/recompose.rs:41 new_canonical
  static new_canonical<I extends CharIterator>(iter: I): Recompositions<I> {
    return new Recompositions<I>(Decompositions.new_canonical(iter), RecompositionState.Composing, [], undefined, undefined);
  }

  /// Create a new recomposition iterator for compatability compositions (NFkC)
  ///
  /// Note that this iterator can also be obtained by directly calling [`.nfkc()`](crate::UnicodeNormalization::nfkc)
  /// on the iterator.
  // crate: unicode-normalization-0.1.25/src/recompose.rs:56 new_compatible
  static new_compatible<I extends CharIterator>(iter: I): Recompositions<I> {
    return new Recompositions<I>(Decompositions.new_compatible(iter), RecompositionState.Composing, [], undefined, undefined);
  }

  // crate: unicode-normalization-0.1.25/src/recompose.rs:71 next
  next(): number | undefined {
    for (;;) {
      const state = this.state;
      switch (state.$) {
        case "Composing": {
          for (let ch = this.iter.next(); ch !== undefined; ch = this.iter.next()) {
            const ch_class = canonical_combining_class(ch);
            let k: number;
            if (this.composee === undefined) {
              if (ch_class !== 0) {
                return ch;
              }
              this.composee = ch;
              continue;
            } else {
              k = this.composee;
            }
            if (this.last_ccc === undefined) {
              const r = compose(k, ch);
              if (r !== undefined) {
                this.composee = r;
                continue;
              } else {
                if (ch_class === 0) {
                  this.composee = ch;
                  return k;
                }
                this.buffer.push(ch);
                this.last_ccc = ch_class;
              }
            } else {
              const l_class = this.last_ccc;
              if (l_class >= ch_class) {
                // `ch` is blocked from `composee`
                if (ch_class === 0) {
                  this.composee = ch;
                  this.last_ccc = undefined;
                  this.state = { $: "Purging", _0: 0 };
                  return k;
                }
                this.buffer.push(ch);
                this.last_ccc = ch_class;
                continue;
              }
              const r = compose(k, ch);
              if (r !== undefined) {
                this.composee = r;
                continue;
              } else {
                this.buffer.push(ch);
                this.last_ccc = ch_class;
              }
            }
          }
          this.state = { $: "Finished", _0: 0 };
          if (this.composee !== undefined) {
            // `self.composee.take()`
            const c = this.composee;
            this.composee = undefined;
            return c;
          }
          break;
        }
        case "Purging": {
          const next = state._0;
          const s = this.buffer[next];
          if (s === undefined) {
            this.buffer.length = 0;
            this.state = RecompositionState.Composing;
          } else {
            this.state = { $: "Purging", _0: next + 1 };
            return s;
          }
          break;
        }
        case "Finished": {
          const next = state._0;
          const s = this.buffer[next];
          if (s === undefined) {
            this.buffer.length = 0;
            // `self.composee.take()`
            const c = this.composee;
            this.composee = undefined;
            return c;
          } else {
            this.state = { $: "Finished", _0: next + 1 };
            return s;
          }
        }
      }
    }
  }

  /** `#[derive(Clone)]` */
  clone(this: Recompositions<I & CloneCharIterator>): Recompositions<I> {
    return new Recompositions<I>(this.iter.clone(), this.state, this.buffer.slice(), this.composee, this.last_ccc);
  }

  [Symbol.iterator](): Iterator<number> {
    return { next: () => {
      const value = this.next();
      return value === undefined ? { done: true, value: undefined } : { done: false, value };
    } };
  }
}

// crate: unicode-normalization-0.1.25/src/recompose.rs:163 fmt
/** `impl<I: Iterator<Item = char> + Clone> fmt::Display for Recompositions<I>` */
export function display_Recompositions<I extends CloneCharIterator>(self: Recompositions<I>): string {
  let f = "";
  const it = self.clone();
  for (let c = it.next(); c !== undefined; c = it.next()) {
    f += String.fromCodePoint(c);
  }
  return f;
}
