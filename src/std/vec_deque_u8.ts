// `std::collections::VecDeque<u8>`, the part of it Miri's virtual sockets read and write through (moved from
// src/miri/shims/unix/virtual_socket.ts, review miri-tail-b N5). PORT: not generic, on a `Uint8Array`, and only what the sockets
// observe: their short reads depend on where the buffer wraps, so capacity growth and head movement are upstream's. Checked
// against the real `VecDeque<u8>` of the pinned nightly over 884,895 operations by that review. Paths in the comments are under
// library/alloc/src/collections/vec_deque/.
import { Ok } from "./result.ts";
import { type IoResult } from "./io.ts";

/** `VecDeque<u8>`: head, length and the physical buffer, whose length is the capacity (header). */
export class VecDeque_u8 {
  private buf: Uint8Array = new Uint8Array(0);
  private head = 0;
  len = 0;

  // std: library/alloc/src/collections/vec_deque/mod.rs:1083 capacity
  capacity(): number {
    return this.buf.length;
  }

  // std: library/alloc/src/collections/vec_deque/mod.rs:1825 is_empty
  is_empty(): boolean {
    return this.len === 0;
  }

  /** `wrap_add(self.head, idx)` (mod.rs:251) */
  private to_wrapped_index(idx: number): number {
    const i = this.head + idx;
    return i >= this.capacity() ? i - this.capacity() : i;
  }

  // std: library/alloc/src/collections/vec_deque/mod.rs:1141 reserve
  /** `VecDeque::reserve`, with `RawVec::reserve` → `grow_amortized` (raw_vec/mod.rs:524; `size == 1`, so the
   *  minimum non-zero capacity is 8). */
  private reserve(additional: number): void {
    const new_cap = this.len + additional;
    const old_cap = this.capacity();

    if (new_cap > old_cap) {
      const cap = Math.max(8, Math.max(old_cap * 2, new_cap));
      const buf = new Uint8Array(cap);
      buf.set(this.buf);
      this.buf = buf;
      this.handle_capacity_increase(old_cap);
    }
  }

  // std: library/alloc/src/collections/vec_deque/mod.rs:692 handle_capacity_increase
  /** Moves the shortest contiguous section of the ring buffer. */
  private handle_capacity_increase(old_capacity: number): void {
    const new_capacity = this.capacity();
    if (this.head <= old_capacity - this.len) {
      // A: nop
    } else {
      const head_len = old_capacity - this.head;
      const tail_len = this.len - head_len;
      if (head_len > tail_len && new_capacity - old_capacity >= tail_len) {
        // B
        this.buf.copyWithin(old_capacity, 0, tail_len);
      } else {
        // C
        const new_head = new_capacity - head_len;
        this.buf.copyWithin(new_head, this.head, this.head + head_len);
        this.head = new_head;
      }
    }
  }

  /** `<VecDeque<u8> as io::Write>::write` (library/alloc/src/io/impls.rs:564): `extend`, i.e. the `slice::Iter` `spec_extend`
   *  (vec_deque/spec_extend.rs:109): `reserve`, then `copy_slice` (mod.rs:564) at the back. */
  write(src: Uint8Array): IoResult<number> {
    this.reserve(src.length);
    const dst = this.to_wrapped_index(this.len);
    const head_room = this.capacity() - dst;
    if (src.length <= head_room) {
      this.buf.set(src, dst);
    } else {
      this.buf.set(src.subarray(0, head_room), dst);
      this.buf.set(src.subarray(head_room), 0);
    }
    this.len += src.length;
    return Ok(src.length);
  }

  /** `<VecDeque<u8> as io::Read>::read` (library/alloc/src/io/impls.rs:458): the front slice of `as_slices` (`slice_ranges`,
   *  mod.rs:1841) into `out`, then `drain(..n)` (`Drop for Drain`, vec_deque/drain.rs: with nothing in front of the drain the
   *  head moves past it, and an emptied deque resets the head to 0). */
  read(out: Uint8Array): IoResult<number> {
    // The front slice is `head..head + len`, or `head..capacity` when the buffer wraps (empty when `len == 0`).
    const front_len = Math.min(this.len, this.capacity() - this.head);
    const n = Math.min(front_len, out.length);
    out.set(this.buf.subarray(this.head, this.head + n));
    const new_len = this.len - n;
    if (new_len === 0) {
      this.head = 0;
    } else {
      this.head = this.to_wrapped_index(n);
    }
    this.len = new_len;
    return Ok(n);
  }

  // std: library/alloc/src/collections/vec_deque/mod.rs:1674 iter
  /** The elements in order (`Debug` of a `VecDeque`). */
  iter(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.len; i++) out.push(this.buf[this.to_wrapped_index(i)]!);
    return out;
  }
}
