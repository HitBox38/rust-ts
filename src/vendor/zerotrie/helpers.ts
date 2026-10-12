// Port of zerotrie 0.2.5 `src/helpers.rs` (the reader helpers).
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
//
// PORT: debug assertions are off in rustc's build, so `debug_assert!(false, ..)` is a comment and
// the GIGO value is returned.

/** `MaybeSplitAt::debug_split_at` for `[u8]` */
// crate-skip: zerotrie-0.2.5/src/helpers.rs:8 debug_split_at trait method declaration (the impl below)
// crate: zerotrie-0.2.5/src/helpers.rs:13 debug_split_at
export function debug_split_at(self: Uint8Array, mid: number): [Uint8Array, Uint8Array] {
  if (mid <= self.length) {
    return [self.subarray(0, mid), self.subarray(mid)];
  }
  // debug_assert!(false, "debug_split_at: {mid} expected to be in range");
  return [self, new Uint8Array(0)];
}

/// Unwraps the option or panics in debug mode, returning the `gigo_value`
// crate-skip: zerotrie-0.2.5/src/helpers.rs:23 debug_unwrap_or trait method declaration (the impl below)
// crate: zerotrie-0.2.5/src/helpers.rs:28 debug_unwrap_or
export function debug_unwrap_or<T>(self: T | undefined, gigo_value: T): T {
  if (self !== undefined) {
    return self;
  }
  // debug_assert!(false, "debug_unwrap_or called on a None value");
  return gigo_value;
}

// crate-skip: zerotrie-0.2.5/src/helpers.rs:77 const_fmt_int used by the const builder's error messages; the builder is not ported
// crate-skip: zerotrie-0.2.5/src/helpers.rs:109 test_const_fmt_int tests `const_fmt_int` (not ported)
