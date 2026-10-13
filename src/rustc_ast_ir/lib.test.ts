// Oracle-derived tests for rustc_ast_ir/lib.ts (upstream rustc_ast_ir/src/lib.rs has no `#[cfg(test)]` tests).
//
// EXPECTED below is, verbatim, the stdout of this rustc_private program run against the pinned nightly
// (`rustc 1.101.0-nightly (6f5da406b 2026-10-10)`, commit 6f5da406b56c2db6607202b63daee73aa8c61297):
//   rustc +nightly-2026-10-11 --edition 2024 ir_oracle.rs -o ir_oracle
//   DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib ./ir_oracle
// The test prints the same queries on the port in the same format and compares line by line.
//
// #![feature(rustc_private)]
// extern crate rustc_ast_ir;
// extern crate rustc_driver;
// extern crate rustc_span;
// use rustc_ast_ir::{FloatTy, IntTy, Movability, Mutability, Pinnedness, UintTy};
// use std::panic::{catch_unwind, set_hook};
//
// fn msg(r: std::thread::Result<String>) -> String {
//     match r {
//         Ok(s) => s,
//         Err(e) => match e.downcast_ref::<&str>() {
//             Some(s) => format!("panic: {s}"),
//             None => format!("panic: {}", e.downcast_ref::<String>().unwrap()),
//         },
//     }
// }
//
// fn main() {
//     set_hook(Box::new(|_| {}));
//     rustc_span::create_default_session_globals_then(|| {
//         use IntTy::*;
//         use UintTy::*;
//         for t in [Isize, I8, I16, I32, I64, I128] {
//             println!("IntTy::{t:?} name_str={} name={} bit_width={:?} to_unsigned={:?}", t.name_str(), t.name().as_str(), t.bit_width(), t.to_unsigned());
//             for w in [8u16, 16, 32, 64, 128] {
//                 println!("IntTy::{t:?} normalize({w})={}", msg(catch_unwind(|| format!("{:?}", t.normalize(w)))));
//             }
//         }
//         for t in [Usize, U8, U16, U32, U64, U128] {
//             println!("UintTy::{t:?} name_str={} name={} bit_width={:?} to_signed={:?}", t.name_str(), t.name().as_str(), t.bit_width(), t.to_signed());
//             for w in [8u16, 16, 32, 64, 128] {
//                 println!("UintTy::{t:?} normalize({w})={}", msg(catch_unwind(|| format!("{:?}", t.normalize(w)))));
//             }
//         }
//         for t in [FloatTy::F16, FloatTy::F32, FloatTy::F64, FloatTy::F128] {
//             println!("FloatTy::{t:?} name_str={} name={} bit_width={}", t.name_str(), t.name().as_str(), t.bit_width());
//         }
//         for m in [Movability::Static, Movability::Movable] {
//             println!("Movability::{m:?}");
//         }
//         for m in [Mutability::Not, Mutability::Mut] {
//             println!("Mutability::{m:?} invert={:?} prefix_str={:?} ref_prefix_str={:?} ptr_str={:?} mutably_str={:?} is_mut={} is_not={} cmp(Not)={:?} cmp(Mut)={:?}",
//                 m.invert(), m.prefix_str(), m.ref_prefix_str(), m.ptr_str(), m.mutably_str(), m.is_mut(), m.is_not(),
//                 m.cmp(&Mutability::Not), m.cmp(&Mutability::Mut));
//         }
//         for p in [Pinnedness::Not, Pinnedness::Pinned] {
//             println!("Pinnedness::{p:?} is_pinned={} prefix_str(Not)={:?} prefix_str(Mut)={:?}", p.is_pinned(), p.prefix_str(Mutability::Not), p.prefix_str(Mutability::Mut));
//         }
//     });
// }
import { expect, test } from "bun:test";
import { create_default_session_globals_then } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { PLAIN } from "../std/fmt.ts";
import { Panic } from "../std/panic.ts";
import {
  debug_FloatTy,
  debug_IntTy,
  debug_Movability,
  debug_Mutability,
  debug_Pinnedness,
  debug_UintTy,
  FloatTy,
  IntTy,
  Movability,
  Mutability,
  Mutability_cmp,
  Pinnedness,
  UintTy,
} from "./lib.ts";

const EXPECTED = `IntTy::isize name_str=isize name=isize bit_width=None to_unsigned=usize
IntTy::isize normalize(8)=panic: internal error: entered unreachable code
IntTy::isize normalize(16)=i16
IntTy::isize normalize(32)=i32
IntTy::isize normalize(64)=i64
IntTy::isize normalize(128)=panic: internal error: entered unreachable code
IntTy::i8 name_str=i8 name=i8 bit_width=Some(8) to_unsigned=u8
IntTy::i8 normalize(8)=i8
IntTy::i8 normalize(16)=i8
IntTy::i8 normalize(32)=i8
IntTy::i8 normalize(64)=i8
IntTy::i8 normalize(128)=i8
IntTy::i16 name_str=i16 name=i16 bit_width=Some(16) to_unsigned=u16
IntTy::i16 normalize(8)=i16
IntTy::i16 normalize(16)=i16
IntTy::i16 normalize(32)=i16
IntTy::i16 normalize(64)=i16
IntTy::i16 normalize(128)=i16
IntTy::i32 name_str=i32 name=i32 bit_width=Some(32) to_unsigned=u32
IntTy::i32 normalize(8)=i32
IntTy::i32 normalize(16)=i32
IntTy::i32 normalize(32)=i32
IntTy::i32 normalize(64)=i32
IntTy::i32 normalize(128)=i32
IntTy::i64 name_str=i64 name=i64 bit_width=Some(64) to_unsigned=u64
IntTy::i64 normalize(8)=i64
IntTy::i64 normalize(16)=i64
IntTy::i64 normalize(32)=i64
IntTy::i64 normalize(64)=i64
IntTy::i64 normalize(128)=i64
IntTy::i128 name_str=i128 name=i128 bit_width=Some(128) to_unsigned=u128
IntTy::i128 normalize(8)=i128
IntTy::i128 normalize(16)=i128
IntTy::i128 normalize(32)=i128
IntTy::i128 normalize(64)=i128
IntTy::i128 normalize(128)=i128
UintTy::usize name_str=usize name=usize bit_width=None to_signed=isize
UintTy::usize normalize(8)=panic: internal error: entered unreachable code
UintTy::usize normalize(16)=u16
UintTy::usize normalize(32)=u32
UintTy::usize normalize(64)=u64
UintTy::usize normalize(128)=panic: internal error: entered unreachable code
UintTy::u8 name_str=u8 name=u8 bit_width=Some(8) to_signed=i8
UintTy::u8 normalize(8)=u8
UintTy::u8 normalize(16)=u8
UintTy::u8 normalize(32)=u8
UintTy::u8 normalize(64)=u8
UintTy::u8 normalize(128)=u8
UintTy::u16 name_str=u16 name=u16 bit_width=Some(16) to_signed=i16
UintTy::u16 normalize(8)=u16
UintTy::u16 normalize(16)=u16
UintTy::u16 normalize(32)=u16
UintTy::u16 normalize(64)=u16
UintTy::u16 normalize(128)=u16
UintTy::u32 name_str=u32 name=u32 bit_width=Some(32) to_signed=i32
UintTy::u32 normalize(8)=u32
UintTy::u32 normalize(16)=u32
UintTy::u32 normalize(32)=u32
UintTy::u32 normalize(64)=u32
UintTy::u32 normalize(128)=u32
UintTy::u64 name_str=u64 name=u64 bit_width=Some(64) to_signed=i64
UintTy::u64 normalize(8)=u64
UintTy::u64 normalize(16)=u64
UintTy::u64 normalize(32)=u64
UintTy::u64 normalize(64)=u64
UintTy::u64 normalize(128)=u64
UintTy::u128 name_str=u128 name=u128 bit_width=Some(128) to_signed=i128
UintTy::u128 normalize(8)=u128
UintTy::u128 normalize(16)=u128
UintTy::u128 normalize(32)=u128
UintTy::u128 normalize(64)=u128
UintTy::u128 normalize(128)=u128
FloatTy::f16 name_str=f16 name=f16 bit_width=16
FloatTy::f32 name_str=f32 name=f32 bit_width=32
FloatTy::f64 name_str=f64 name=f64 bit_width=64
FloatTy::f128 name_str=f128 name=f128 bit_width=128
Movability::Static
Movability::Movable
Mutability::Not invert=Mut prefix_str="" ref_prefix_str="&" ptr_str="const" mutably_str="" is_mut=false is_not=true cmp(Not)=Equal cmp(Mut)=Less
Mutability::Mut invert=Not prefix_str="mut " ref_prefix_str="&mut " ptr_str="mut" mutably_str="mutably " is_mut=true is_not=false cmp(Not)=Greater cmp(Mut)=Equal
Pinnedness::Not is_pinned=false prefix_str(Not)="" prefix_str(Mut)="mut "
Pinnedness::Pinned is_pinned=true prefix_str(Not)="pin const " prefix_str(Mut)="pin mut "
`;

/** `msg(catch_unwind(..))` of ir_oracle.rs: the value, or `panic: <message>` for a Rust panic. */
function msg(f: () => string): string {
  try {
    return f();
  } catch (e) {
    if (!(e instanceof Panic)) throw e;
    return `panic: ${e.message}`;
  }
}

/** Rust's `{:?}` of a `&str` (the strings here need no escapes). */
const dstr = (s: string): string => `"${s}"`;
const opt = (n: number | undefined): string => (n === undefined ? "None" : `Some(${n})`);
const ordering = (o: -1 | 0 | 1): string => (o < 0 ? "Less" : o > 0 ? "Greater" : "Equal");
const WIDTHS = [8, 16, 32, 64, 128];

function port_output(): string {
  const out: string[] = [];
  const p = (s: string): number => out.push(s);
  create_default_session_globals_then(() => {
    for (const t of [IntTy.Isize, IntTy.I8, IntTy.I16, IntTy.I32, IntTy.I64, IntTy.I128]) {
      const d = debug_IntTy(t, PLAIN);
      p(
        `IntTy::${d} name_str=${IntTy.name_str(t)} name=${Symbol.as_str(IntTy.name(t))} bit_width=${opt(IntTy.bit_width(t))}` +
          ` to_unsigned=${debug_UintTy(IntTy.to_unsigned(t), PLAIN)}`,
      );
      for (const w of WIDTHS) p(`IntTy::${d} normalize(${w})=${msg(() => debug_IntTy(IntTy.normalize(t, w), PLAIN))}`);
    }
    for (const t of [UintTy.Usize, UintTy.U8, UintTy.U16, UintTy.U32, UintTy.U64, UintTy.U128]) {
      const d = debug_UintTy(t, PLAIN);
      p(
        `UintTy::${d} name_str=${UintTy.name_str(t)} name=${Symbol.as_str(UintTy.name(t))} bit_width=${opt(UintTy.bit_width(t))}` +
          ` to_signed=${debug_IntTy(UintTy.to_signed(t), PLAIN)}`,
      );
      for (const w of WIDTHS) p(`UintTy::${d} normalize(${w})=${msg(() => debug_UintTy(UintTy.normalize(t, w), PLAIN))}`);
    }
    for (const t of [FloatTy.F16, FloatTy.F32, FloatTy.F64, FloatTy.F128]) {
      p(`FloatTy::${debug_FloatTy(t, PLAIN)} name_str=${FloatTy.name_str(t)} name=${Symbol.as_str(FloatTy.name(t))} bit_width=${FloatTy.bit_width(t)}`);
    }
    for (const m of [Movability.Static, Movability.Movable]) p(`Movability::${debug_Movability(m, PLAIN)}`);
    for (const m of [Mutability.Not, Mutability.Mut]) {
      p(
        `Mutability::${debug_Mutability(m, PLAIN)} invert=${debug_Mutability(Mutability.invert(m), PLAIN)}` +
          ` prefix_str=${dstr(Mutability.prefix_str(m))} ref_prefix_str=${dstr(Mutability.ref_prefix_str(m))}` +
          ` ptr_str=${dstr(Mutability.ptr_str(m))} mutably_str=${dstr(Mutability.mutably_str(m))}` +
          ` is_mut=${Mutability.is_mut(m)} is_not=${Mutability.is_not(m)}` +
          ` cmp(Not)=${ordering(Mutability_cmp(m, "Not"))} cmp(Mut)=${ordering(Mutability_cmp(m, "Mut"))}`,
      );
    }
    for (const q of [Pinnedness.Not, Pinnedness.Pinned]) {
      p(
        `Pinnedness::${debug_Pinnedness(q, PLAIN)} is_pinned=${Pinnedness.is_pinned(q)}` +
          ` prefix_str(Not)=${dstr(Pinnedness.prefix_str(q, "Not"))} prefix_str(Mut)=${dstr(Pinnedness.prefix_str(q, "Mut"))}`,
      );
    }
  });
  return `${out.join("\n")}\n`;
}

test("IntTy/UintTy/FloatTy/Movability/Mutability/Pinnedness fns and Debug equal the rustc_private oracle (ir_oracle.rs)", () => {
  const oracle = EXPECTED.split("\n");
  const port = port_output().split("\n");
  for (let k = 0; k < Math.max(port.length, oracle.length); k++) {
    expect(`line ${k + 1}: ${port[k]}`).toBe(`line ${k + 1}: ${oracle[k]}`);
  }
});

test("normalize: an unsupported target width is `unreachable!()` (lib.rs:73, lib.rs:149)", () => {
  expect(() => IntTy.normalize("Isize", 8)).toThrow(new Panic("internal error: entered unreachable code"));
  expect(() => UintTy.normalize("Usize", 128)).toThrow(new Panic("internal error: entered unreachable code"));
});
