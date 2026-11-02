// Tests of src/miri/shims/sig.ts (lane miri-shims-b): the `shim_sig!` / `shim_varargs!` spelling and the argument-count
// checks' messages.
import { expect, test } from "bun:test";
import "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { shim_sig, shim_varargs } from "./sig.ts";
import { CanonAbi } from "../../rustc_abi/canon_abi.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { create_default_session_globals_then } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { Ok } from "../../std/result.ts";

const TYPES = ["i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize", "unit", "never", "bool"];
function fake_ecx(): MiriInterpCx {
  const types = Object.fromEntries(TYPES.map((t) => [t, `ty:${t}`]));
  const ecx = {
    tcx: { deref: () => ({ types }) },
    machine: { layouts: { void_ptr_mut: { ty: "ty:*mut c_void" }, fn_ptr: { ty: "ty:fn()" } } },
    windows_ty_layout: (n: string) => ({ ty: `ty:winapi::${n}` }),
    eval_context_ref: () => ecx,
    check_shim_symbol_clash: () => Ok(undefined),
    check_shim_sig_deprecated: InterpCx.prototype.check_shim_sig_deprecated,
    check_shim_sig_llvm_intrinsic: InterpCx.prototype.check_shim_sig_llvm_intrinsic,
    check_varargs: InterpCx.prototype.check_varargs,
  };
  return ecx as unknown as MiriInterpCx;
}

test("shim_sig: the macro's type spellings, `...` for c-variadic", () => {
  const ecx = fake_ecx();
  const s = shim_sig("C", ["i32", "usize", "()", "!", "bool", "*_", "fn(..) -> _", "winapi::BOOL", "..."], "isize")(ecx);
  expect(s.args).toEqual(["ty:i32", "ty:usize", "ty:unit", "ty:never", "ty:bool", "ty:*mut c_void", "ty:fn()", "ty:winapi::BOOL"] as never);
  expect(s.ret).toBe("ty:isize" as never);
  expect(s.c_variadic).toBe(true);
  expect(s.abi).toEqual(shim_sig("C", [], "()")(ecx).abi);
  expect(shim_sig("Rust", ["u64"], "usize")(ecx).c_variadic).toBe(false);
  expect(() => shim_sig("C", ["f32"], "()")(ecx)).toThrow("unsupported signature type: f32");
  expect(() => shim_sig("not an abi", [], "()")(ecx)).toThrow("incorrect abi specified");
  expect(shim_varargs("i32", "u32")(ecx)).toEqual(["ty:i32", "ty:u32"] as never);
  expect(() => shim_varargs("i32", "...")(ecx)).toThrow();
});

test("check_shim_sig_deprecated / check_shim_sig_llvm_intrinsic: argument count and ABI messages", () => create_default_session_globals_then(() => {
  const ecx = fake_ecx();
  const abi = { conv: CanonAbi.C, c_variadic: false } as never;
  const name = Symbol.intern("cbrt");
  const args = [{}, {}] as never[];
  expect(ecx.check_shim_sig_deprecated(abi, CanonAbi.C, name, args, 2)).toEqual(Ok(args));
  const bad = ecx.check_shim_sig_deprecated(abi, CanonAbi.C, name, args, 1);
  expect(JSON.stringify(bad)).toContain("incorrect number of arguments for `cbrt`: got 2, expected 1");
  const variadic = ecx.check_shim_sig_deprecated({ conv: CanonAbi.C, c_variadic: true } as never, CanonAbi.C, name, args, 2);
  expect(JSON.stringify(variadic)).toContain("calling a non-variadic function with a c-variadic caller-side signature");
  // `CanonAbi`'s Display prints the `ExternAbi` string it shares (canon_abi.rs:79).
  const rust = ecx.check_shim_sig_deprecated({ conv: { $: "Rust" }, c_variadic: false } as never, CanonAbi.C, name, args, 2);
  expect(JSON.stringify(rust)).toContain('calling a function with calling convention \\"C\\" using caller calling convention \\"Rust\\"');
  const llvm = Symbol.intern("llvm.x86.foo");
  expect(ecx.check_shim_sig_llvm_intrinsic(llvm, args, 2)).toEqual(Ok(args));
  expect(JSON.stringify(ecx.check_shim_sig_llvm_intrinsic(llvm, args, 3))).toContain("incorrect number of arguments for `llvm.x86.foo`: got 2, expected 3");
  expect(() => ecx.check_shim_sig_llvm_intrinsic(name, args, 2)).toThrow();
}));

test("check_varargs: not enough arguments counts the fixed ones", () => {
  const ecx = fake_ecx();
  const r = ecx.check_varargs(shim_varargs("i32", "i32"), { args: [{}] as never[], already_gone: 2 }, "fcntl(fd, F_SETFL, ...)");
  expect(JSON.stringify(r)).toContain("not enough arguments for `fcntl(fd, F_SETFL, ...)`: got 3, expected at least 4");
  const empty = ecx.check_varargs(shim_varargs(), { args: [{}] as never[], already_gone: 2 }, "f");
  expect(empty.$ === "Ok" && empty._0[1]).toEqual({ args: [{}] as never[], already_gone: 2 });
});
