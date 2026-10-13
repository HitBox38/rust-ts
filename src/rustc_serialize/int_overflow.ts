// Port of compiler/rustc_serialize/src/int_overflow.rs.
//
// This would belong to `rustc_data_structures`, but `rustc_serialize` needs it too.
//
// PORT: TS has no trait methods on `number`, so `x.debug_strict_add(y)` is `debug_strict_add(x, y)`.
// rustc is built without debug assertions, so both are the wrapping operation. The `number` widths
// used here (`usize` offsets/lengths, LEB128 shifts) stay far below 2^53, where wrapping never
// happens, so they are plain `+` / `-`. (The `bigint` widths never call these.)

/// Addition, but only overflow checked when `cfg(debug_assertions)` is set
/// instead of respecting `-Coverflow-checks`.
///
/// This exists for performance reasons, as we ship rustc with overflow checks.
/// While overflow checks are perf neutral in almost all of the compiler, there
/// are a few particularly hot areas where we don't want overflow checks in our
/// dist builds. Overflow is still a bug there, so we want overflow check for
/// builds with debug assertions.
///
/// That's a long way to say that this should be used in areas where overflow
/// is a bug but overflow checking is too slow.
// rustc: compiler/rustc_serialize/src/int_overflow.rs:16 debug_strict_add
// rustc: compiler/rustc_serialize/src/int_overflow.rs:24 debug_strict_add
export function debug_strict_add(self: number, other: number): number {
  // `cfg!(debug_assertions)` is false in rustc: `self.wrapping_add(other)`.
  return self + other;
}

/// See [`DebugStrictAdd`].
// rustc: compiler/rustc_serialize/src/int_overflow.rs:39 debug_strict_sub
// rustc: compiler/rustc_serialize/src/int_overflow.rs:47 debug_strict_sub
export function debug_strict_sub(self: number, other: number): number {
  // `cfg!(debug_assertions)` is false in rustc: `self.wrapping_sub(other)`.
  return self - other;
}
