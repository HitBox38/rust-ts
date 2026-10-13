// Port of rustc-stable-hash =0.1.2 `src/int_overflow.rs`.
//
//! Weaker version of `-Coverflow-checks`.
//
// PORT: the traits are implemented for `usize` only (upstream too); TS has no trait methods on
// `number`, so `x.debug_strict_add(y)` is `debug_strict_add(x, y)`. rustc is built without debug
// assertions, so both are the wrapping operation; `usize` values here are buffer offsets and byte
// counts far below 2^53, where wrapping never happens, so they are plain `+` / `-`.

// FIXME: These two traits seems overkill for this crate, we should probably
// replace these by two simple free floating function instead since we only
// operate on `usize`.

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
// crate: rustc-stable-hash-0.1.2/src/int_overflow.rs:20 debug_strict_add
// crate: rustc-stable-hash-0.1.2/src/int_overflow.rs:27 debug_strict_add
export function debug_strict_add(self: number, other: number): number {
  // `cfg!(debug_assertions)` is false in rustc: `self.wrapping_add(other)`.
  return self + other;
}

/// See [`DebugStrictAdd`].
// crate: rustc-stable-hash-0.1.2/src/int_overflow.rs:42 debug_strict_sub
// crate: rustc-stable-hash-0.1.2/src/int_overflow.rs:49 debug_strict_sub
export function debug_strict_sub(self: number, other: number): number {
  // `cfg!(debug_assertions)` is false in rustc: `self.wrapping_sub(other)`.
  return self - other;
}
