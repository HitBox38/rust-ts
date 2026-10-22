// Port of compiler/rustc_target/src/callconv/x86_64.rs (lane fn-abi).
//
// PORT: `Result<[Option<Class>; MAX_EIGHTBYTES], Memory>` is `(Class | undefined)[] | Memory` (`Memory` is a unit
// struct: the `MEMORY` sentinel); `&mut usize` out-parameters are `{ value }` (`MutRef`, PORTING §8). `Class` derives
// `Ord` (`old.min(c)`): `Class_discriminant`.

// The classification code for the x86_64 ABI is taken from the clay language
// https://github.com/jckarter/clay/blob/db0bd2702ab0b6e48965cd85f8859bbd5f60e48e/compiler/externals.cpp

import { BackendRepr, FieldsShape, type HasDataLayout, Scalar, Size, VariantIdx } from "../../rustc_abi/lib.ts";
import { Reg, Reg_eq, debug_Reg } from "../../rustc_abi/callconv/reg.ts";
import { PLAIN, debug_option } from "../../std/fmt.ts";
import type { TyAndLayout } from "../../rustc_abi/layout/ty.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { assert_eq, panic, unreachable, unwrap } from "../../std/panic.ts";
import type { HasTargetSpec } from "../spec/mod.ts";
import { type ArgAbi, CastTarget, CastTarget_from_Reg, type FnAbi } from "./mod.ts";

/// Classification of "eightbyte" components.
// N.B., the order of the variants is from general to specific,
// such that `unify(a, b)` is the "smaller" of `a` and `b`.
// #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
type Class = "Int" | "Sse" | "SseUp";
const Class_discriminant: Record<Class, number> = { Int: 0, Sse: 1, SseUp: 2 };
/** `Ord::min` (the first on a tie). */
function Class_min(a: Class, b: Class): Class {
  return Class_discriminant[b] < Class_discriminant[a] ? b : a;
}

// #[derive(Clone, Copy, Debug)]
// struct Memory;
const MEMORY = Symbol("Memory");
type Memory = typeof MEMORY;

// Currently supported vector size (AVX-512).
const LARGEST_VECTOR_SIZE = 512;
const MAX_EIGHTBYTES = LARGEST_VECTOR_SIZE / 64;

// rustc: compiler/rustc_target/src/callconv/x86_64.rs:29 classify_arg
function classify_arg<Ty>(cx: HasDataLayout, arg: ArgAbi<Ty>): (Class | undefined)[] | Memory {
  // rustc: compiler/rustc_target/src/callconv/x86_64.rs:37 classify
  function classify(cx: HasDataLayout, layout: TyAndLayout<Ty>, cls: (Class | undefined)[], off: Size): Memory | undefined {
    if (!off.is_aligned(layout.align.abi)) {
      if (!layout.is_zst()) {
        return MEMORY;
      }
      return undefined;
    }

    let c: Class;
    const backend_repr = layout.backend_repr;
    switch (backend_repr.$) {
      case "Scalar":
        switch (Scalar.primitive(backend_repr._0).$) {
          case "Int":
          case "Pointer":
            c = "Int";
            break;
          case "Float":
            c = "Sse";
            break;
        }
        break;

      case "SimdVector":
        c = "Sse";
        break;

      case "SimdScalableVector":
        return panic("scalable vectors are unsupported");

      case "ScalarPair":
      case "Memory": {
        for (let i = 0; i < FieldsShape.count(layout.fields); i++) {
          const field_off = off.add(FieldsShape.offset(layout.fields, i));
          if (classify(cx, layout.field(cx, i), cls, field_off) === MEMORY) return MEMORY;
        }

        const variants = layout.variants;
        switch (variants.$) {
          case "Single":
          case "Empty":
            break;
          case "Multiple":
            // Treat enum variants like union members.
            // `variants.indices()`
            for (let variant_idx = 0; variant_idx < variants.variants.length; variant_idx++) {
              if (classify(cx, layout.for_variant(cx, VariantIdx.from_usize(variant_idx)), cls, off) === MEMORY) return MEMORY;
            }
            break;
        }

        return undefined;
      }
    }

    // Fill in `cls` for scalars (Int/Sse) and vectors (Sse).
    const first = Math.floor(off.bytes() / 8);
    const last = Math.floor((off.bytes() + layout.size.bytes() - 1) / 8);
    for (let j = first; j <= last; j++) {
      const old = cls[j];
      cls[j] = old === undefined ? c : Class_min(old, c);

      // Everything after the first Sse "eightbyte"
      // component is the upper half of a register.
      if (c === "Sse") {
        c = "SseUp";
      }
    }

    return undefined;
  }

  const n = Math.ceil(arg.layout.size.bytes() / 8);
  if (n > MAX_EIGHTBYTES) {
    return MEMORY;
  }

  const cls: (Class | undefined)[] = new Array<Class | undefined>(MAX_EIGHTBYTES).fill(undefined);
  if (classify(cx, arg.layout, cls, Size.ZERO) === MEMORY) return MEMORY;
  if (n > 2) {
    if (cls[0] !== "Sse") {
      return MEMORY;
    }
    if (cls.slice(1, n).some((c) => c !== "SseUp")) {
      return MEMORY;
    }
  } else {
    let i = 0;
    while (i < n) {
      if (cls[i] === "SseUp") {
        cls[i] = "Sse";
      } else if (cls[i] === "Sse") {
        i += 1;
        while (i !== n && cls[i] === "SseUp") {
          i += 1;
        }
      } else {
        i += 1;
      }
    }
  }

  return cls;
}

// rustc: compiler/rustc_target/src/callconv/x86_64.rs:133 reg_component
function reg_component(cls: readonly (Class | undefined)[], i: MutRef<number>, size: Size): Reg | undefined {
  const class_ = cls[i.value];
  if (class_ === undefined) {
    return undefined;
  }

  switch (class_) {
    case "Int":
      i.value += 1;
      return size.bytes() < 8 ? new Reg(/* kind */ { $: "Integer" }, size) : Reg.i64();
    case "Sse": {
      let take = 0;
      for (const c of cls.slice(i.value + 1)) {
        if (c !== "SseUp") break;
        take += 1;
      }
      const vec_len = 1 + take;
      i.value += vec_len;
      if (vec_len === 1) {
        switch (size.bytes()) {
          case 4:
            return Reg.f32();
          default:
            return Reg.f64();
        }
      } else {
        return Reg.opaque_vector(Size.from_bytes(8).mul(vec_len));
      }
    }
    default: {
      const c = class_;
      return unreachable(`reg_component: unhandled class ${c}`);
    }
  }
}

// rustc: compiler/rustc_target/src/callconv/x86_64.rs:160 cast_target
function cast_target(cls: readonly (Class | undefined)[], size: Size): CastTarget {
  const i: MutRef<number> = { value: 0 };
  const lo = unwrap(reg_component(cls, i, size));
  const offset = Size.from_bytes(8).mul(i.value);
  let target = CastTarget_from_Reg(lo);
  if (size.bytes() > offset.bytes()) {
    const hi = reg_component(cls, i, size.sub(offset));
    if (hi !== undefined) {
      target = CastTarget.pair(lo, hi);
    }
  }
  assert_eq(reg_component(cls, i, Size.ZERO), undefined, (r) => debug_option(r, PLAIN, debug_Reg), (a, b) => (a === undefined ? b === undefined : b !== undefined && Reg_eq(a, b)));
  return target;
}

const MAX_INT_REGS = 6; // RDI, RSI, RDX, RCX, R8, R9
const MAX_SSE_REGS = 8; // XMM0-7

// rustc: compiler/rustc_target/src/callconv/x86_64.rs:177 compute_abi_info
export function compute_abi_info<Ty>(cx: HasDataLayout & HasTargetSpec, fn_abi: FnAbi<Ty>): void {
  let int_regs = MAX_INT_REGS;
  let sse_regs = MAX_SSE_REGS;

  const x86_64_arg_or_ret = (arg: ArgAbi<Ty>, is_arg: boolean): void => {
    if (!arg.layout.is_sized()) {
      // FIXME: Update int_regs?
      // Not touching this...
      return;
    }
    if (is_arg && arg.layout.pass_indirectly_in_non_rustic_abis(cx)) {
      int_regs = Math.max(int_regs - 1, 0);
      arg.make_indirect();
      return;
    }
    let cls_or_mem = classify_arg(cx, arg);

    if (is_arg) {
      if (cls_or_mem !== MEMORY) {
        const cls = cls_or_mem;
        let needed_int = 0;
        let needed_sse = 0;
        for (const c of cls) {
          switch (c) {
            case "Int":
              needed_int += 1;
              break;
            case "Sse":
              needed_sse += 1;
              break;
            default:
              break;
          }
        }
        // `(int_regs.checked_sub(needed_int), sse_regs.checked_sub(needed_sse))`
        if (int_regs >= needed_int && sse_regs >= needed_sse) {
          const left_int = int_regs - needed_int;
          const left_sse = sse_regs - needed_sse;
          int_regs = left_int;
          sse_regs = left_sse;
        } else {
          // Not enough registers for this argument, so it will be
          // passed on the stack, but we only mark aggregates
          // explicitly as indirect `byval` arguments, as LLVM will
          // automatically put immediates on the stack itself.
          if (arg.layout.is_aggregate()) {
            cls_or_mem = MEMORY;
          }
        }
      }
    }

    if (cls_or_mem === MEMORY) {
      if (is_arg) {
        // The x86_64 ABI doesn't have any special requirements for `byval` alignment,
        // the type's alignment is always used.
        arg.pass_by_stack_offset(undefined);
      } else {
        // `sret` parameter thus one less integer register available
        arg.make_indirect();
        // NOTE(eddyb) return is handled first, so no registers
        // should've been used yet.
        assert_eq(int_regs, MAX_INT_REGS, String);
        int_regs -= 1;
      }
    } else {
      const cls = cls_or_mem;
      // split into sized chunks passed individually
      if (arg.layout.is_aggregate()) {
        const size = arg.layout.size;
        arg.cast_to(cast_target(cls, size));
      } else if (is_arg || cx.target_spec().is_like_darwin) {
        arg.extend_integer_width_to(32);
      }
      // The x86_64 psABI requires bools to be zero-extended to 8-bits, with high bits unspecified.
      // zeroext i1 has this behavior in the LLVM X86 backend.
      if (!is_arg && BackendRepr.is_bool(arg.layout.backend_repr)) {
        arg.extend_integer_width_to(8);
      }
    }
  };

  if (!fn_abi.ret.is_ignore()) {
    x86_64_arg_or_ret(fn_abi.ret, false);
  }

  for (const arg of fn_abi.args) {
    if (arg.is_ignore()) {
      continue;
    }
    x86_64_arg_or_ret(arg, true);
  }
}
