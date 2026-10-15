//! Declares [`rustc_middle::arena::Arena`], which can allocate values of any
//! `Copy` type, and any `!Copy` type explicitly listed below.
// Port of compiler/rustc_middle/src/arena.rs (lane small-gaps-18): the decoding half only.
//
// PORT:
// - Arenas are erased (PORTING §5): `rustc_arena::declare_arena!` (the `Arena` type) has no TS counterpart and
//   `arena.alloc(value)` / `arena.alloc_from_iter(iter)` are the value / the collected array.
// - `impl_ref_decodable_into_arena!` (`impl RefDecodable for $ty` and `for [$ty]`) is generic over its element:
//   `decode_RefDecodable_into_arena` / `decode_RefDecodable_slice_into_arena` take the element's `Decodable` fn.
//   tools/codegen's serialize.json names them for the derive's reference fields (`&'tcx [(Clause, Span)]`, ...).
import type { Decodable, Decoder } from "../rustc_serialize/serialize.ts";

// rustc: compiler/rustc_middle/src/arena.rs:147 decode_arena_allocatable
function decode_arena_allocatable<T, D extends Decoder>(decoder: D, decode_T: Decodable<T, D>): T {
  const value: T = decode_T(decoder);
  // PORT: `decoder.interner().arena.alloc(value)`: arenas are erased.
  return value;
}

// rustc: compiler/rustc_middle/src/arena.rs:157 decode_arena_allocatable_slice
function decode_arena_allocatable_slice<T, D extends Decoder>(decoder: D, decode_T: Decodable<T, D>): T[] {
  // The decoder for slices must match the decoder for `Vec<T>`,
  // which is a `usize` length followed by that many `T`.
  const len = decoder.read_usize();
  // PORT: `decoder.interner().arena.alloc_from_iter((0..len).map(|_| T::decode(decoder)))`: arenas are erased.
  const out: T[] = [];
  for (let i = 0; i < len; i++) out.push(decode_T(decoder));
  return out;
}

// macro_rules! impl_ref_decodable_into_arena: `impl<'tcx> RefDecodable<'tcx> for $ty`
// #[inline]
// rustc: compiler/rustc_middle/src/arena.rs:177 decode
export function decode_RefDecodable_into_arena<T, D extends Decoder>(decoder: D, decode_T: Decodable<T, D>): T {
  return decode_arena_allocatable(decoder, decode_T);
}

// macro_rules! impl_ref_decodable_into_arena: `impl<'tcx> RefDecodable<'tcx> for [$ty]`
// #[inline]
// rustc: compiler/rustc_middle/src/arena.rs:184 decode
export function decode_RefDecodable_slice_into_arena<T, D extends Decoder>(decoder: D, decode_T: Decodable<T, D>): T[] {
  return decode_arena_allocatable_slice(decoder, decode_T);
}
