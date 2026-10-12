// Port of writeable 0.6.4 `src/ops.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
//
// PORT: operator traits become functions (`a + b` → `add(a, b)`, `a + n` → `add_usize(a, n)`,
// `a * n` → `mul(a, n)`, `a | b` → `bitor(a, b)`; the `*_assign` forms return the new value).
// `usize` is a JS number; `saturating_*` clamps and `checked_*` fails above `USIZE_MAX`. 2^64 - 1
// is not representable as a double, so the bound is the nearest double (2^64); list-formatting
// lengths never come near it.
import { LengthHint } from "./lib.ts";

const USIZE_MAX = 2 ** 64;

function saturating_add(a: number, b: number): number {
  return Math.min(a + b, USIZE_MAX);
}
function checked_add(a: number, b: number): number | undefined {
  const r = a + b;
  return r > USIZE_MAX ? undefined : r;
}
function saturating_mul(a: number, b: number): number {
  return Math.min(a * b, USIZE_MAX);
}
function checked_mul(a: number, b: number): number | undefined {
  const r = a * b;
  return r > USIZE_MAX ? undefined : r;
}

// impl core::ops::Add<LengthHint> for LengthHint
// crate: writeable-0.6.4/src/ops.rs:10 add
export function add(self: LengthHint, other: LengthHint): LengthHint {
  return new LengthHint(
    saturating_add(self._0, other._0),
    self._1 !== undefined && other._1 !== undefined ? checked_add(self._1, other._1) : undefined,
  );
}

// impl core::ops::AddAssign<LengthHint> for LengthHint
// crate: writeable-0.6.4/src/ops.rs:22 add_assign
export function add_assign(self: LengthHint, other: LengthHint): LengthHint {
  return add(self, other);
}

// impl core::iter::Sum<LengthHint> for LengthHint
// crate: writeable-0.6.4/src/ops.rs:28 sum
export function sum(iter: Iterable<LengthHint>): LengthHint {
  let acc = LengthHint.exact(0);
  for (const x of iter) acc = add(acc, x);
  return acc;
}

// impl core::ops::Add<usize> for LengthHint
// crate: writeable-0.6.4/src/ops.rs:39 add
export function add_usize(self: LengthHint, other: number): LengthHint {
  return new LengthHint(saturating_add(self._0, other), self._1 !== undefined ? checked_add(self._1, other) : undefined);
}

// impl core::ops::AddAssign<usize> for LengthHint
// crate: writeable-0.6.4/src/ops.rs:48 add_assign
export function add_assign_usize(self: LengthHint, other: number): LengthHint {
  return add_usize(self, other);
}

// impl core::ops::Mul<usize> for LengthHint
// crate: writeable-0.6.4/src/ops.rs:56 mul
export function mul(self: LengthHint, other: number): LengthHint {
  return new LengthHint(saturating_mul(self._0, other), self._1 !== undefined ? checked_mul(self._1, other) : undefined);
}

// impl core::ops::MulAssign<usize> for LengthHint
// crate: writeable-0.6.4/src/ops.rs:65 mul_assign
export function mul_assign(self: LengthHint, other: number): LengthHint {
  return mul(self, other);
}

// impl core::ops::BitOr<LengthHint> for LengthHint
/// Returns a new hint that is correct wherever `self` is correct, and wherever
/// `other` is correct.
///
/// Example:
/// ```
/// # use writeable::{LengthHint, Writeable};
/// # use core::fmt;
/// # fn coin_flip() -> bool { true }
///
/// struct NonDeterministicWriteable(String, String);
///
/// impl Writeable for NonDeterministicWriteable {
///     fn write_to<W: fmt::Write + ?Sized>(&self, sink: &mut W) -> fmt::Result {
///         sink.write_str(if coin_flip() { &self.0 } else { &self.1 })
///     }
///
///     fn writeable_length_hint(&self) -> LengthHint {
///         LengthHint::exact(self.0.len()) | LengthHint::exact(self.1.len())
///     }
/// }
///
/// writeable::impl_display_with_writeable!(NonDeterministicWriteable);
/// ```
// crate: writeable-0.6.4/src/ops.rs:99 bitor
export function bitor(self: LengthHint, other: LengthHint): LengthHint {
  return new LengthHint(
    Math.min(self._0, other._0),
    self._1 !== undefined && other._1 !== undefined ? Math.max(self._1, other._1) : undefined,
  );
}

// impl core::ops::BitOrAssign<LengthHint> for LengthHint
// crate: writeable-0.6.4/src/ops.rs:111 bitor_assign
export function bitor_assign(self: LengthHint, other: LengthHint): LengthHint {
  return bitor(self, other);
}

// impl core::iter::Sum<usize> for LengthHint
// crate: writeable-0.6.4/src/ops.rs:117 sum
export function sum_usize(iter: Iterable<number>): LengthHint {
  let s = 0;
  for (const x of iter) s += x;
  return LengthHint.exact(s);
}
