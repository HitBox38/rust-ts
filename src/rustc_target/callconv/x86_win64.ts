// Port of compiler/rustc_target/src/callconv/x86_win64.rs (lane gaps-30c).

import { type BackendRepr, Scalar, Size } from "../../rustc_abi/lib.ts";
import { Reg } from "../../rustc_abi/callconv/reg.ts";
import { panic } from "../../std/panic.ts";
import type { HasTargetSpec } from "../spec/mod.ts";
import type { ArgAbi, FnAbi } from "./mod.ts";

// Win64 ABI: https://docs.microsoft.com/en-us/cpp/build/parameter-passing

// rustc: compiler/rustc_target/src/callconv/x86_win64.rs:8 compute_abi_info
export function compute_abi_info<Ty>(cx: HasTargetSpec, fn_abi: FnAbi<Ty>): void {
  const fixup = (a: ArgAbi<Ty>, is_ret: boolean): void => {
    const repr: BackendRepr = a.layout.backend_repr;
    if (repr.$ === "Memory" && !repr.sized) {
      // (nothing)
    } else if (repr.$ === "ScalarPair" || repr.$ === "Memory") {
      switch (a.layout.size.bits()) {
        case 8:
          a.cast_to(Reg.i8());
          break;
        case 16:
          a.cast_to(Reg.i16());
          break;
        case 32:
          a.cast_to(Reg.i32());
          break;
        case 64:
          a.cast_to(Reg.i64());
          break;
        default:
          a.make_indirect();
          break;
      }
    } else if (repr.$ === "SimdVector") {
      // FIXME(eddyb) there should be a size cap here
      // (probably what clang calls "illegal vectors").
    } else if (repr.$ === "SimdScalableVector") {
      panic("scalable vectors are unsupported");
    } else {
      const scalar = repr._0;
      const prim = Scalar.primitive(scalar);
      if (is_ret && prim.$ === "Int" && prim._0 === "I128") {
        if (cx.target_spec().rustc_abi === "Softfloat") {
          // Use the native `i128` LLVM type for the softfloat ABI -- in other words, adjust nothing.
        } else {
          // `i128` is returned in xmm0 by Clang and GCC
          // FIXME(#134288): This may change for the `-msvc` targets in the future.
          a.cast_to(Reg.opaque_vector(Size.from_bits(128)));
        }
      } else if (a.layout.size.bytes() > 8) {
        a.make_indirect();
      } else {
        a.extend_integer_width_to(32);
      }
    }
  };

  // Windows ABIs do not talk about ZST since such types do not exist in MSVC.
  // However, clang and gcc allow ZST in their windows-gnu targets, and pass them by pointer indirection.
  // We follow that for `repr(C)` ZSTs (and `repr(transparent)` wrappers around them),
  // but `repr(Rust)` ones are always ignored (ensuring that `()` matches C `void`).

  if (fn_abi.ret.is_ignore()) {
    if (fn_abi.ret.layout.is_repr_c()) {
      fn_abi.ret.make_indirect_from_ignore();
    }
  } else {
    fixup(fn_abi.ret, true);
  }

  for (const arg of fn_abi.args) {
    if (arg.is_ignore()) {
      if (arg.layout.is_repr_c()) {
        arg.make_indirect_from_ignore();
      }

      continue;
    }
    if (arg.layout.pass_indirectly_in_non_rustic_abis(cx)) {
      arg.make_indirect();
      continue;
    }
    fixup(arg, false);
  }
}
