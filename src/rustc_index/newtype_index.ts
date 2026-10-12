// PORT: stand-in for the expansion of `rustc_index::newtype_index!`
// (compiler/rustc_index_macros/src/newtype.rs) for branded-number handles (PORTING §5), shared by
// every hand-written newtype index until tools/codegen generates them.
import { assert } from "../std/panic.ts";
import type { Fmt } from "../std/fmt.ts";

/// PORT: expansion of `rustc_index::newtype_index!` (compiler/rustc_index_macros/src/newtype.rs)
/// for branded-number handles (PORTING §5). `debug_format` renders `write!(f, FMT, self.as_u32())`.
export function newtype_index<I extends number>(debug_format: (n: number) => string, max: number = 0xffff_ff00) {
  return {
    /// Maximum value the index can take, as a `u32`.
    MAX_AS_U32: max,
    /// Maximum value the index can take.
    MAX: max as I,
    /// Zero value of the index.
    ZERO: 0 as I,
    /// Creates a new index from a given `usize`.
    from_usize(value: number): I {
      assert(value <= max, "assertion failed: value <= (0xFFFF_FF00 as usize)");
      return value as I;
    },
    /// Creates a new index from a given `u32`.
    from_u32(value: number): I {
      assert(value <= max, "assertion failed: value <= 0xFFFF_FF00");
      return value as I;
    },
    /// Creates a new index from a given `u16`.
    from_u16(value: number): I {
      assert(value <= max, "assertion failed: value <= 0xFFFF_FF00");
      return value as I;
    },
    /// `Idx::new`
    new(idx: number): I {
      assert(idx <= max, "assertion failed: value <= (0xFFFF_FF00 as usize)");
      return idx as I;
    },
    /// Extracts the value of this index as a `usize`.
    index(self: I): number {
      return self;
    },
    /// Extracts the value of this index as a `u32`.
    as_u32(self: I): number {
      return self;
    },
    /// Extracts the value of this index as a `usize`.
    as_usize(self: I): number {
      return self;
    },
    /// `impl Debug`
    debug(self: I, _f: Fmt): string {
      return debug_format(self);
    },
  };
}

