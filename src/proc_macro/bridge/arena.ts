// Port of library/proc_macro/src/bridge/arena.rs
//
//! A minimal arena allocator inspired by `rustc_arena::DroplessArena`.
//!
//! This is unfortunately a minimal re-implementation rather than a dependency
//! as it is difficult to depend on crates from within `proc_macro`, due to it
//! being built at the same time as `std`.
//
// PORT: chunks are `Uint8Array`s; `start` / `end` are byte offsets into the last chunk (`end` moves down as bytes
// are allocated, like the raw pointers upstream). `alloc_str` copies the string's UTF-8 bytes into the arena as
// upstream does and returns the JS string (JS strings are immutable values, so the arena copy is never read back).

import { unwrap } from "../../std/panic.ts";
import { utf8 } from "../../std/str.ts";

/// A minimal arena allocator inspired by `rustc_arena::DroplessArena`.
///
/// This is unfortunately a complete re-implementation rather than a dependency
/// as it is difficult to depend on crates from within `proc_macro`, due to it
/// being built at the same time as `std`.
///
/// This arena doesn't have support for allocating anything other than byte
/// slices, as that is all that is necessary.
// std-type: library/proc_macro/src/bridge/arena.rs:20 Arena
export class Arena {
  constructor(
    public start: number,
    public end: number,
    public chunks: Uint8Array[],
  ) {}

  // std: library/proc_macro/src/bridge/arena.rs:27 new
  static new(): Arena {
    return new Arena(0, 0, []);
  }

  /// Add a new chunk with at least `additional` free bytes.
  // std: library/proc_macro/src/bridge/arena.rs:38 grow
  grow(additional: number): void {
    // The arenas start with PAGE-sized chunks, and then each new chunk is twice as
    // big as its predecessor, up until we reach HUGE_PAGE-sized chunks, whereupon
    // we stop growing. This scales well, from arenas that are barely used up to
    // arenas that are used for 100s of MiBs. Note also that the chosen sizes match
    // the usual sizes of pages and huge pages on Linux.
    const PAGE = 4096;
    // any(target_pointer_width = "64", target_pointer_width = "32")
    const HUGE_PAGE = 2 * 1024 * 1024;

    const chunks = this.chunks;
    let new_cap: number;
    const last_chunk = chunks[chunks.length - 1];
    if (last_chunk !== undefined) {
      // If the previous chunk's len is less than HUGE_PAGE
      // bytes, then this chunk will be least double the previous
      // chunk's size.
      new_cap = Math.min(last_chunk.length, HUGE_PAGE / 2);
      new_cap *= 2;
    } else {
      new_cap = PAGE;
    }
    // Also ensure that this chunk can fit `additional`.
    new_cap = Math.max(additional, new_cap);

    const chunk = new Uint8Array(new_cap);
    chunks.push(chunk);
    this.start = 0;
    this.end = chunk.length;
  }

  /// Allocates a byte slice with specified size from the current memory
  /// chunk. Returns `None` if there is no free space left to satisfy the
  /// request.
  // std: library/proc_macro/src/bridge/arena.rs:75 alloc_raw_without_grow
  alloc_raw_without_grow(bytes: number): Uint8Array | undefined {
    const start = this.start;
    const end = this.end;

    // `end.checked_sub(bytes)?`
    if (end < bytes) return undefined;
    const new_end = end - bytes;
    if (start <= new_end) {
      this.end = new_end;
      // SAFETY: `bytes` bytes starting at `new_end` were just reserved.
      const chunk = this.chunks[this.chunks.length - 1]!;
      return chunk.subarray(new_end, new_end + bytes);
    } else {
      return undefined;
    }
  }

  // std: library/proc_macro/src/bridge/arena.rs:91 alloc_raw
  alloc_raw(bytes: number): Uint8Array {
    if (bytes === 0) {
      return new Uint8Array(0);
    }

    const a = this.alloc_raw_without_grow(bytes);
    if (a !== undefined) {
      return a;
    }
    // No free space left. Allocate a new chunk to satisfy the request.
    // On failure the grow will panic or abort.
    this.grow(bytes);
    return unwrap(this.alloc_raw_without_grow(bytes));
  }

  // std: library/proc_macro/src/bridge/arena.rs:106 alloc_str
  alloc_str(string: string): string {
    const src = utf8(string);
    const alloc = this.alloc_raw(src.length);
    alloc.set(src);

    // SAFETY: we convert from `&str` to `&[u8]`, clone it into the arena,
    // and immediately convert the clone back to `&str`.
    return string;
  }
}
