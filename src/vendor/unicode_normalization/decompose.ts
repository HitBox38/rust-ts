// Port of unicode-normalization =0.1.25 `src/decompose.rs`.
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
import { unported } from "../../std/panic.ts";
import type { CharIterator, CloneCharIterator } from "./lib.ts";
// PORT: `super::char::{canonical_combining_class, decompose_canonical, decompose_compatible}` are
// re-exports of these modules; imported directly to keep lib.ts out of the runtime import cycle.
import { canonical_combining_class } from "./lookups.ts";
import { decompose_canonical, decompose_compatible } from "./normalize.ts";

/** `#[derive(Clone)] enum DecompositionType` */
type DecompositionType = "Canonical" | "Compatible";
const DecompositionType = { Canonical: "Canonical", Compatible: "Compatible" } as const;

/**
 * `core::iter::Fuse<I>`: after the inner iterator returns `None` once, always `None`.
 * PORT: std adapter (not crate code), kept minimal for `Decompositions::iter`.
 */
export class Fuse<I extends CharIterator> {
  constructor(public iter: I | undefined) {}

  next(): number | undefined {
    if (this.iter === undefined) return undefined;
    const x = this.iter.next();
    if (x === undefined) this.iter = undefined;
    return x;
  }

  size_hint(): [number, number | undefined] {
    if (this.iter === undefined) return [0, 0];
    if (this.iter.size_hint === undefined) return unported("Iterator::size_hint of this char iterator");
    return this.iter.size_hint();
  }

  clone(this: Fuse<I & CloneCharIterator>): Fuse<I> {
    return new Fuse(this.iter === undefined ? undefined : (this.iter.clone()));
  }
}

/// External iterator for a string decomposition's characters.
// #[derive(Clone)]
export class Decompositions<I extends CharIterator> implements CharIterator {
  constructor(
    public kind: DecompositionType,
    public iter: Fuse<I>,

    // This buffer stores pairs of (canonical combining class, character),
    // pushed onto the end in text order.
    //
    // It's divided into up to three sections:
    // 1) A prefix that is free space;
    // 2) "Ready" characters which are sorted and ready to emit on demand;
    // 3) A "pending" block which stills needs more characters for us to be able
    //    to sort in canonical order and is not safe to emit.
    public buffer: [number, number][],
    // PORT: `Range<usize>` -> `{ start, end }`.
    public ready: { start: number; end: number },
  ) {}

  /// Create a new decomposition iterator for canonical decompositions (NFD)
  ///
  /// Note that this iterator can also be obtained by directly calling [`.nfd()`](crate::UnicodeNormalization::nfd)
  /// on the iterator.
  // crate: unicode-normalization-0.1.25/src/decompose.rs:45 new_canonical
  static new_canonical<I extends CharIterator>(iter: I): Decompositions<I> {
    return new Decompositions<I>(DecompositionType.Canonical, new Fuse(iter), [], { start: 0, end: 0 });
  }

  /// Create a new decomposition iterator for compatability decompositions (NFkD)
  ///
  /// Note that this iterator can also be obtained by directly calling [`.nfkd()`](crate::UnicodeNormalization::nfkd)
  /// on the iterator.
  // crate: unicode-normalization-0.1.25/src/decompose.rs:59 new_compatible
  static new_compatible<I extends CharIterator>(iter: I): Decompositions<I> {
    return new Decompositions<I>(DecompositionType.Compatible, new Fuse(iter), [], { start: 0, end: 0 });
  }

  // crate: unicode-normalization-0.1.25/src/decompose.rs:71 push_back
  push_back(ch: number): void {
    const class_ = canonical_combining_class(ch);

    if (class_ === 0) {
      this.sort_pending();
      this.buffer.push([class_, ch]);
      this.ready.end = this.buffer.length;
    } else {
      this.buffer.push([class_, ch]);
    }
  }

  // crate: unicode-normalization-0.1.25/src/decompose.rs:84 sort_pending
  sort_pending(): void {
    // NB: `sort_by_key` is stable, so it will preserve the original text's
    // order within a combining class.
    // PORT: `Array.prototype.sort` is stable too; sort the `ready.end..` tail in place.
    const tail = this.buffer.slice(this.ready.end);
    tail.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < tail.length; i++) this.buffer[this.ready.end + i] = tail[i]!;
  }

  // crate: unicode-normalization-0.1.25/src/decompose.rs:91 reset_buffer
  reset_buffer(): void {
    // Equivalent to `self.buffer.drain(0..self.ready.end)`
    // but faster than drain() if the buffer is a SmallVec or TinyVec
    const pending = this.buffer.length - this.ready.end;
    for (let i = 0; i < pending; i++) {
      this.buffer[i] = this.buffer[i + this.ready.end]!;
    }
    this.buffer.length = pending;
    this.ready = { start: 0, end: 0 };
  }

  // crate: unicode-normalization-0.1.25/src/decompose.rs:103 increment_next_ready
  increment_next_ready(): void {
    const next = this.ready.start + 1;
    if (next === this.ready.end) {
      this.reset_buffer();
    } else {
      this.ready.start = next;
    }
  }

  // crate: unicode-normalization-0.1.25/src/decompose.rs:117 next
  next(): number | undefined {
    while (this.ready.end === 0) {
      const ch = this.iter.next();
      if (ch !== undefined && this.kind === DecompositionType.Canonical) {
        decompose_canonical(ch, (d) => this.push_back(d));
      } else if (ch !== undefined && this.kind === DecompositionType.Compatible) {
        decompose_compatible(ch, (d) => this.push_back(d));
      } else {
        if (this.buffer.length === 0) {
          return undefined;
        } else {
          this.sort_pending();
          this.ready.end = this.buffer.length;

          // This implementation means that we can call `next`
          // on an exhausted iterator; the last outer `next` call
          // will result in an inner `next` call. To make this
          // safe, we use `fuse`.
          break;
        }
      }
    }

    // We can assume here that, if `self.ready.end` is greater than zero,
    // it's also greater than `self.ready.start`. That's because we only
    // increment `self.ready.start` inside `increment_next_ready`, and
    // whenever it reaches equality with `self.ready.end`, we reset both
    // to zero, maintaining the invariant that:
    //      self.ready.start < self.ready.end || self.ready.end == self.ready.start == 0
    //
    // This less-than-obviously-safe implementation is chosen for performance,
    // minimizing the number & complexity of branches in `next` in the common
    // case of buffering then unbuffering a single character with each call.
    const [, ch] = this.buffer[this.ready.start]!;
    this.increment_next_ready();
    return ch;
  }

  // crate: unicode-normalization-0.1.25/src/decompose.rs:158 size_hint
  size_hint(): [number, number | undefined] {
    const [lower] = this.iter.size_hint();
    return [lower, undefined];
  }

  /** `#[derive(Clone)]` */
  clone(this: Decompositions<I & CloneCharIterator>): Decompositions<I> {
    return new Decompositions<I>(
      this.kind,
      this.iter.clone(),
      this.buffer.map(([c, ch]) => [c, ch]),
      { start: this.ready.start, end: this.ready.end },
    );
  }

  [Symbol.iterator](): Iterator<number> {
    return { next: () => {
      const value = this.next();
      return value === undefined ? { done: true, value: undefined } : { done: false, value };
    } };
  }
}

// crate: unicode-normalization-0.1.25/src/decompose.rs:167 fmt
/** `impl<I: Iterator<Item = char> + Clone> fmt::Display for Decompositions<I>` */
export function display_Decompositions<I extends CloneCharIterator>(self: Decompositions<I>): string {
  let f = "";
  const it = self.clone();
  for (let c = it.next(); c !== undefined; c = it.next()) {
    f += String.fromCodePoint(c);
  }
  return f;
}
