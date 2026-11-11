// Unit tests for common.ts (compiler/rustc_codegen_ssa/src/common.rs) and the two comparison-predicate mappings of
// base.ts (base.rs:58, :74), lane ssa-contract. Upstream has no tests for these; each expectation is read off the
// upstream source (cited per case), and the cases cover every arm.
import { describe, expect, test } from "bun:test";
import { Align, Size } from "../rustc_abi/lib.ts";
import { DllImport } from "../rustc_crate_store/cstore.gen.ts";
import { DllCallingConvention, type DllImportSymbolType } from "../rustc_crate_store/cstore.gen.ts";
import { PeImportNameType } from "../rustc_attr_ir/data_structures.gen.ts";
import type { CtfeProvenance } from "../rustc_middle/mir/interpret/pointer.ts";
import { Scalar } from "../rustc_middle/mir/interpret/value.ts";
import type { BinOp } from "../rustc_middle/mir/syntax.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { ScalarInt } from "../rustc_middle/ty/consts/int.ts";
import type { TyAndLayout } from "../rustc_middle/ty/layout.ts";
import { create_default_session_globals_then } from "../rustc_span/lib.ts";
import { DUMMY_SP } from "../rustc_span/span_encoding.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import type { Target } from "../rustc_target/spec/mod.ts";
import { bin_op_to_fcmp_predicate, bin_op_to_icmp_predicate } from "./base.ts";
import {
  asm_const_ptr_clean,
  asm_const_to_str,
  i686_decorated_name,
  type IntPredicate,
  is_using_dlltool,
  type RealPredicate,
  shift_mask_val,
} from "./common.ts";
import type { BackendTypes } from "./traits/backend.ts";
import type { BuilderMethods } from "./traits/builder.ts";

describe("base.rs bin_op_to_icmp_predicate / bin_op_to_fcmp_predicate", () => {
  // base.rs:58-71: one arm per (op, signed); Eq/Ne ignore signedness.
  const icmp: [BinOp, boolean, IntPredicate][] = [
    ["Eq", true, "IntEQ"],
    ["Eq", false, "IntEQ"],
    ["Ne", true, "IntNE"],
    ["Ne", false, "IntNE"],
    ["Lt", true, "IntSLT"],
    ["Lt", false, "IntULT"],
    ["Le", true, "IntSLE"],
    ["Le", false, "IntULE"],
    ["Gt", true, "IntSGT"],
    ["Gt", false, "IntUGT"],
    ["Ge", true, "IntSGE"],
    ["Ge", false, "IntUGE"],
  ];
  for (const [op, signed, want] of icmp) {
    test(`icmp ${op} signed=${signed} -> ${want}`, () => {
      expect(bin_op_to_icmp_predicate(op, signed)).toBe(want);
    });
  }

  // base.rs:74-83: ordered predicates except `Ne`, which is unordered-not-equal.
  const fcmp: [BinOp, RealPredicate][] = [
    ["Eq", "RealOEQ"],
    ["Ne", "RealUNE"],
    ["Lt", "RealOLT"],
    ["Le", "RealOLE"],
    ["Gt", "RealOGT"],
    ["Ge", "RealOGE"],
  ];
  for (const [op, want] of fcmp) {
    test(`fcmp ${op} -> ${want}`, () => {
      expect(bin_op_to_fcmp_predicate(op)).toBe(want);
    });
  }

  test("non-comparison operators are a bug!", () => {
    expect(() => bin_op_to_icmp_predicate("Add", true)).toThrow(
      "bin_op_to_icmp_predicate: expected comparison operator, found Add",
    );
    expect(() => bin_op_to_fcmp_predicate("Cmp")).toThrow("bin_op_to_fcmp_predicate: expected comparison operator, found Cmp");
  });
});

describe("shift_mask_val", () => {
  // A recording builder: types are strings ("i8", "<4 x i16>"), values the calls that made them.
  type T = BackendTypes & { Type: string; Value: string };
  const fake = {
    type_kind: (ty: string) => (ty.startsWith("<") ? "Vector" : "Integer"),
    int_width: (ty: string) => Number(ty.slice(1)),
    element_type: (ty: string) => ty.slice(ty.indexOf("x ") + 2, -1),
    vector_length: (ty: string) => Number(ty.slice(1, ty.indexOf(" "))),
    const_int: (t: string, i: bigint) => `const_int(${t}, ${i})`,
    const_uint: (t: string, i: bigint) => `const_uint(${t}, ${i})`,
    vector_splat: (n: number, elt: string) => `splat(${n}, ${elt})`,
  } as unknown as BuilderMethods<T>;

  test("integer: width - 1, or its bitwise not as i64 when inverted (common.rs:135-143)", () => {
    expect(shift_mask_val(fake, "i8", "i8", false)).toBe("const_uint(i8, 7)");
    expect(shift_mask_val(fake, "i32", "i64", false)).toBe("const_uint(i64, 31)");
    // `!31u64 as i64` == -32
    expect(shift_mask_val(fake, "i32", "i32", true)).toBe("const_int(i32, -32)");
    expect(shift_mask_val(fake, "i128", "i128", true)).toBe("const_int(i128, -128)");
  });

  test("vector: the element mask, splatted to the mask vector's length (common.rs:144-148)", () => {
    expect(shift_mask_val(fake, "<4 x i16>", "<4 x i16>", false)).toBe("splat(4, const_uint(i16, 15))");
    expect(shift_mask_val(fake, "<2 x i64>", "<2 x i64>", true)).toBe("splat(2, const_int(i64, -64))");
  });

  test("anything else is a bug! (common.rs:149)", () => {
    const bad = { ...(fake as object), type_kind: () => "Pointer" } as unknown as BuilderMethods<T>;
    expect(() => shift_mask_val(bad, "ptr", "ptr", false)).toThrow("shift_mask_val: expected Integer or Vector, found Pointer");
  });
});

describe("asm_const_to_str", () => {
  const tcx = (pointer_width: number) => ({ sess: { target: { pointer_width } } }) as unknown as TyCtxt;
  const layout = (bytes: number, kind: unknown) =>
    ({ size: Size.from_bytes(bytes), ty: { kind: () => kind } }) as unknown as TyAndLayout;

  test("unsigned integers and pointers print the raw value (common.rs:161, :171)", () => {
    expect(asm_const_to_str(tcx(64), DUMMY_SP, ScalarInt.raw(0xffn, Size.from_bytes(1)), layout(1, { $: "Uint", _0: "U8" }))).toBe("255");
    const ptr = ScalarInt.raw(0xffff_ffff_ffff_fff0n, Size.from_bytes(8));
    expect(asm_const_to_str(tcx(64), DUMMY_SP, ptr, layout(8, { $: "RawPtr" }))).toBe("18446744073709551600");
    expect(asm_const_to_str(tcx(64), DUMMY_SP, ptr, layout(8, { $: "Ref" }))).toBe("18446744073709551600");
    expect(asm_const_to_str(tcx(64), DUMMY_SP, ptr, layout(8, { $: "FnPtr" }))).toBe("18446744073709551600");
  });

  test("signed integers are reinterpreted at their width (common.rs:162-167)", () => {
    expect(asm_const_to_str(tcx(64), DUMMY_SP, ScalarInt.raw(0xffn, Size.from_bytes(1)), layout(1, { $: "Int", _0: "I8" }))).toBe("-1");
    expect(asm_const_to_str(tcx(64), DUMMY_SP, ScalarInt.raw(0x8000n, Size.from_bytes(2)), layout(2, { $: "Int", _0: "I16" }))).toBe("-32768");
    expect(asm_const_to_str(tcx(64), DUMMY_SP, ScalarInt.raw(0x7fff_ffffn, Size.from_bytes(4)), layout(4, { $: "Int", _0: "I32" }))).toBe("2147483647");
    expect(asm_const_to_str(tcx(64), DUMMY_SP, ScalarInt.raw(1n << 127n, Size.from_bytes(16)), layout(16, { $: "Int", _0: "I128" }))).toBe(
      "-170141183460469231731687303715884105728",
    );
  });

  test("isize normalizes to the target's pointer width first (common.rs:162)", () => {
    const v32 = ScalarInt.raw(0xffff_ffffn, Size.from_bytes(4));
    expect(asm_const_to_str(tcx(32), DUMMY_SP, v32, layout(4, { $: "Int", _0: "Isize" }))).toBe("-1");
    const v64 = ScalarInt.raw(0xffff_ffff_ffff_fffen, Size.from_bytes(8));
    expect(asm_const_to_str(tcx(64), DUMMY_SP, v64, layout(8, { $: "Int", _0: "Isize" }))).toBe("-2");
  });
});

describe("asm_const_ptr_clean", () => {
  test("a scalar without provenance is returned as is (common.rs:181-183)", () => {
    const s: Scalar = Scalar.from_u64<CtfeProvenance>(42n);
    expect(asm_const_ptr_clean({} as TyCtxt, s)).toBe(s);
  });

  const ptr_to = (global_alloc: unknown, offset: number) => {
    const tcx = { global_alloc: () => global_alloc } as unknown as TyCtxt;
    const ptr = { prov_and_relative_offset: () => [1n as CtfeProvenance, Size.from_bytes(offset)] };
    const scalar = { $: "Ptr", _0: ptr, _1: 8 } as unknown as Scalar;
    return [tcx, scalar] as const;
  };

  test("a `TypeId` provenance becomes its offset (common.rs:187-190)", () => {
    const [tcx, scalar] = ptr_to({ $: "TypeId", ty: undefined }, 24);
    const r = asm_const_ptr_clean(tcx, scalar);
    expect(r.$).toBe("Int");
    expect(r.$ === "Int" && r._0.to_bits(Size.from_bytes(8))).toBe(24n);
  });

  test("other allocations keep their provenance (common.rs:197-198)", () => {
    const nonzst = { $: "Memory", _0: { inner: () => ({ len: () => 4, align: Align.from_bytes(8) }) } };
    for (const ga of [nonzst, { $: "Static", _0: undefined }, { $: "Function", instance: undefined }]) {
      const [tcx, scalar] = ptr_to(ga, 8);
      expect(asm_const_ptr_clean(tcx, scalar)).toBe(scalar);
    }
  });
});

describe("is_using_dlltool", () => {
  const target = (os: string, env: string, cfg_abi: string) => ({ os: { $: os }, env: { $: env }, cfg_abi: { $: cfg_abi } }) as unknown as Target;
  test("only windows-gnu with no cfg abi (common.rs:203)", () => {
    expect(is_using_dlltool(target("Windows", "Gnu", "Unspecified"))).toBe(true);
    expect(is_using_dlltool(target("Windows", "Msvc", "Unspecified"))).toBe(false);
    expect(is_using_dlltool(target("Windows", "Gnu", "Llvm"))).toBe(false);
    expect(is_using_dlltool(target("Linux", "Gnu", "Unspecified"))).toBe(false);
  });
});

describe("i686_decorated_name", () => {
  const imp = (
    calling_convention: DllImport["calling_convention"],
    import_name_type: DllImport["import_name_type"],
    symbol_type: DllImportSymbolType = "Function",
  ) => new DllImport(Symbol.intern("foo"), import_name_type, calling_convention, DUMMY_SP, symbol_type, Size.from_bytes(0));
  const dec = (d: DllImport, mingw: boolean, disable: boolean, force: boolean) => i686_decorated_name(d, mingw, disable, force);

  test("functions: prefix and suffix per calling convention (common.rs:231-264)", () => {
    create_default_session_globals_then(() => {
      // C: no prefix (LLVM adds it), no suffix
      expect(dec(imp(DllCallingConvention.C, undefined), false, false, false)).toBe("foo");
      // stdcall: `_` on MSVC, none on MinGW unless `Decorated`; `@<bytes>` suffix
      expect(dec(imp({ $: "Stdcall", _0: 8 }, undefined), false, false, false)).toBe("_foo@8");
      expect(dec(imp({ $: "Stdcall", _0: 8 }, undefined), true, false, false)).toBe("foo@8");
      expect(dec(imp({ $: "Stdcall", _0: 8 }, PeImportNameType.Decorated), true, false, false)).toBe("_foo@8");
      // fastcall: `@` prefix, `@<bytes>` suffix
      expect(dec(imp({ $: "Fastcall", _0: 12 }, undefined), false, false, false)).toBe("@foo@12");
      // vectorcall: no prefix, `@@<bytes>` suffix
      expect(dec(imp({ $: "Vectorcall", _0: 16 }, undefined), false, false, false)).toBe("foo@@16");
    });
  });

  test("import name types (common.rs:214-220)", () => {
    create_default_session_globals_then(() => {
      // NoPrefix: suffix only, even when fully decorated is forced
      expect(dec(imp({ $: "Stdcall", _0: 8 }, PeImportNameType.NoPrefix), false, false, true)).toBe("foo@8");
      // Undecorated: nothing, unless fully decorated is forced
      expect(dec(imp({ $: "Stdcall", _0: 8 }, PeImportNameType.Undecorated), false, false, false)).toBe("foo");
      expect(dec(imp({ $: "Stdcall", _0: 8 }, PeImportNameType.Undecorated), false, false, true)).toBe("_foo@8");
    });
  });

  test("statics: `_` on MSVC only, never a suffix (common.rs:239-241)", () => {
    create_default_session_globals_then(() => {
      expect(dec(imp(DllCallingConvention.C, undefined, "Static"), false, false, false)).toBe("_foo");
      expect(dec(imp({ $: "Stdcall", _0: 8 }, undefined, "Static"), false, false, false)).toBe("_foo");
      expect(dec(imp(DllCallingConvention.C, undefined, "Static"), true, false, false)).toBe("foo");
      // the `else if` arm does not look at `add_prefix`: NoPrefix still gets `_` on a static
      expect(dec(imp(DllCallingConvention.C, PeImportNameType.NoPrefix, "ThreadLocal"), false, false, false)).toBe("_foo");
    });
  });

  test("disable_name_mangling prepends \\x01 (common.rs:225-229)", () => {
    create_default_session_globals_then(() => {
      expect(dec(imp({ $: "Stdcall", _0: 8 }, undefined), false, true, false)).toBe("\x01_foo@8");
    });
  });
});
