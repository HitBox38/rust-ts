import { panic, unwrap } from "../../std/panic.ts";

/// A view onto a finite range of an infinitely long sequence of T.
///
/// The Ts are indexed 0..infinity. A RingBuffer begins as a view of elements
/// 0..0 (i.e. nothing). The user of the RingBuffer advances its left and right
/// position independently, although only in the positive direction, and only
/// with left <= right at all times.
///
/// Holding a RingBuffer whose view is elements left..right gives the ability to
/// use Index and IndexMut to access elements i in the infinitely long queue for
/// which left <= i < right.
export class RingBuffer<T> {
  constructor(
    // PORT: `VecDeque<T>` is a plain JS array; `pop_front` is `Array.prototype.shift`.
    public data: T[],
    // Abstract index of data[0] in the infinitely sized queue.
    public offset: number,
  ) {}

  // rustc: compiler/rustc_ast_pretty/src/pp/ring.rs:21 new
  static new<T>(): RingBuffer<T> {
    return new RingBuffer<T>([], 0);
  }

  // rustc: compiler/rustc_ast_pretty/src/pp/ring.rs:25 is_empty
  is_empty(): boolean {
    return this.data.length === 0;
  }

  // rustc: compiler/rustc_ast_pretty/src/pp/ring.rs:29 push
  push(value: T): number {
    const index = this.offset + this.data.length;
    this.data.push(value);
    return index;
  }

  // rustc: compiler/rustc_ast_pretty/src/pp/ring.rs:35 clear
  clear(): void {
    this.data.length = 0;
  }

  // rustc: compiler/rustc_ast_pretty/src/pp/ring.rs:39 index_of_first
  index_of_first(): number {
    return this.offset;
  }

  // rustc: compiler/rustc_ast_pretty/src/pp/ring.rs:43 first
  first(): T | undefined {
    return this.data[0];
  }

  // rustc: compiler/rustc_ast_pretty/src/pp/ring.rs:47 first_mut
  first_mut(): T | undefined {
    return this.data[0];
  }

  // rustc: compiler/rustc_ast_pretty/src/pp/ring.rs:51 pop_first
  pop_first(): T | undefined {
    if (this.data.length === 0) return undefined;
    const first = this.data.shift() as T;
    this.offset += 1;
    return first;
  }

  // rustc: compiler/rustc_ast_pretty/src/pp/ring.rs:57 last
  last(): T | undefined {
    return this.data[this.data.length - 1];
  }

  // rustc: compiler/rustc_ast_pretty/src/pp/ring.rs:61 last_mut
  last_mut(): T | undefined {
    return this.data[this.data.length - 1];
  }

  // rustc: compiler/rustc_ast_pretty/src/pp/ring.rs:68 index
  index(index: number): T {
    return vec_deque_index(this.data, checked_sub_unwrap(index, this.offset));
  }

  // rustc: compiler/rustc_ast_pretty/src/pp/ring.rs:74 index_mut
  index_mut(index: number): T {
    return vec_deque_index(this.data, checked_sub_unwrap(index, this.offset));
  }
}

/** `index.checked_sub(offset).unwrap()` on `usize`. */
function checked_sub_unwrap(index: number, offset: number): number {
  return unwrap(index >= offset ? index - offset : undefined);
}

/** `VecDeque`'s `Index` impl: `self.get(index).expect("Out of bounds access")`. */
function vec_deque_index<T>(data: T[], i: number): T {
  if (i >= data.length) panic("Out of bounds access");
  return data[i] as T;
}
