// Tests of src/miri/operator.ts (lane miri-eval): `binary_ptr_op_` (operator.rs:13) on a real `TyCtxt` (a `#![no_core]`
// crate, the rustc_const_eval intern.test.ts setup). The interpreter is a CTFE `InterpCx` with the two Miri machine
// members the pointer ops read (`layouts.usize`; Miri's `Provenance` impl is imported by operator.ts itself): the
// comparison and the pointer arithmetic paths do not reach any other machine hook.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA } from "../../scripts/lib/common.ts";
import "./lib.ts";
import { type ImmTy, type Scalar } from "./lib.ts";
import { type MiriInterpCx, type Provenance } from "./machine.ts";
import { MiriImmTy, imm_to_scalar } from "./operator.ts";
import { Size } from "../rustc_abi/lib.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../rustc_interface/passes.ts";
import { CanAccessMutGlobal, CheckAlignment, CompileTimeMachine } from "../rustc_const_eval/const_eval/mod.ts";
import { InterpCx } from "../rustc_const_eval/interpret/eval_context.ts";
import { type AllocId, Pointer, Scalar as interp_Scalar } from "../rustc_middle/mir/interpret/mod.ts";
import { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { type BorTag } from "./borrow_tracker/mod.ts";
import { Panic } from "../std/panic.ts";

class CaptureConfig extends Error {}
function config_from_args(args: string[]): Config {
  let config: Config | undefined;
  try {
    compiler_entrypoint(["rustc", ...args], {
      config(c: Config) {
        config = c;
        throw new CaptureConfig();
      },
    });
  } catch (e) {
    if (!(e instanceof CaptureConfig)) throw e;
  }
  if (config === undefined) throw new Error("ERROR: no config");
  return config;
}

const SRC = [
  "#![feature(no_core, lang_items)]",
  "#![no_core]",
  "#![allow(internal_features)]",
  '#[lang = "pointee_sized"] pub trait PointeeSized {}',
  '#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}',
  '#[lang = "sized"] pub trait Sized: MetaSized {}',
].join("\n");

test("binary_ptr_op_: comparisons (scalars and lexicographic pairs) and pointer arithmetic keep the LHS provenance", () => {
  const file = join(DATA, "tmp", "miri-eval", `agent-${Bun.hash(process.env.RUST_TS_AGENT ?? "default").toString(16)}`, "operator.rs");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SRC);
  let ran = false;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    create_and_enter_global_ctxt(compiler, parse(compiler.sess), (tcx) => {
      void tcx.resolver_for_lowering();
      const typing_env = TypingEnv.fully_monomorphized();
      const ctfe = InterpCx.new(tcx, DUMMY_SP, typing_env, CompileTimeMachine.new(CanAccessMutGlobal.No, CheckAlignment.No));
      const usize_l = ctfe.layout_of(tcx.types.usize);
      if (usize_l.$ !== "Ok") throw new Error("ERROR: usize layout");
      const ptr_l = ctfe.layout_of(Ty.new_imm_ptr(tcx, tcx.types.u8));
      if (ptr_l.$ !== "Ok") throw new Error("ERROR: ptr layout");
      const wide_l = ctfe.layout_of(Ty.new_imm_ptr(tcx, Ty.new_slice(tcx, tcx.types.u8)));
      if (wide_l.$ !== "Ok") throw new Error("ERROR: wide ptr layout");
      // The Miri machine members the pointer ops read.
      (ctfe.machine as unknown as { layouts: { usize: unknown } }).layouts = { usize: usize_l._0 };
      const ecx = ctfe as unknown as MiriInterpCx;

      const ptr_size = tcx.data_layout().pointer_size();
      const int = (n: bigint, l = usize_l._0): ImmTy => MiriImmTy.from_scalar(interp_Scalar.from_uint(n, ptr_size), l);
      const pair = (a: bigint, b: bigint): ImmTy =>
        (MiriImmTy as unknown as { from_scalar_pair(a: Scalar, b: Scalar, l: unknown): ImmTy }).from_scalar_pair(
          interp_Scalar.from_uint(a, ptr_size),
          interp_Scalar.from_uint(b, ptr_size),
          wide_l._0,
        );
      const cmp = (op: "Eq" | "Ne" | "Lt" | "Le" | "Gt" | "Ge", l: ImmTy, r: ImmTy): boolean => {
        const res = ecx.binary_ptr_op_(op, l, r);
        if (res.$ !== "Ok") throw new Error("ERROR: binary_ptr_op_");
        const b = interp_Scalar.to_bool(imm_to_scalar(res._0));
        if (b.$ !== "Ok") throw new Error("ERROR: to_bool");
        return b._0;
      };

      // Scalars (filled up with 0 into pairs).
      expect(cmp("Eq", int(5n), int(5n))).toBe(true);
      expect(cmp("Ne", int(5n), int(5n))).toBe(false);
      expect(cmp("Lt", int(4n), int(5n))).toBe(true);
      expect(cmp("Le", int(5n), int(5n))).toBe(true);
      expect(cmp("Gt", int(4n), int(5n))).toBe(false);
      expect(cmp("Ge", int(0xffff_ffff_ffff_ffffn), int(1n))).toBe(true);
      // ScalarPairs compare lexicographically: the address first, then the metadata.
      expect(cmp("Lt", pair(1n, 9n), pair(2n, 0n))).toBe(true);
      expect(cmp("Lt", pair(2n, 0n), pair(2n, 1n))).toBe(true);
      expect(cmp("Eq", pair(2n, 1n), pair(2n, 1n))).toBe(true);
      expect(cmp("Gt", pair(2n, 1n), pair(2n, 0n))).toBe(true);
      // Mismatched ABIs are an `assert_eq!` failure.
      expect(() => ecx.binary_ptr_op_("Eq", int(1n), pair(1n, 0n))).toThrow(Panic);

      // Pointer arithmetic: the usize op on the address; the result keeps the LHS provenance.
      const prov: Provenance = { $: "Concrete", alloc_id: 7 as AllocId, tag: 3 as BorTag };
      const p = MiriImmTy.from_scalar(interp_Scalar.from_pointer(Pointer.new(prov, Size.from_bytes(0x1000n)), ecx), ptr_l._0);
      for (const [op, rhs, want] of [
        ["Add", 0x18n, 0x1018n],
        ["Sub", 0x10n, 0xff0n],
        ["BitAnd", 0xff00n, 0x1000n],
        ["BitOr", 0x7n, 0x1007n],
        ["BitXor", 0x1001n, 0x1n],
      ] as const) {
        const res = ecx.binary_ptr_op_(op, p, int(rhs));
        if (res.$ !== "Ok") throw new Error(`ERROR: binary_ptr_op_ ${op}`);
        const s = imm_to_scalar(res._0);
        expect(s.$).toBe("Ptr");
        const ptr = interp_Scalar.to_pointer(s, ecx);
        expect(ptr.provenance).toBe(prov);
        expect(ptr.offset.bytes_u64()).toBe(want);
        expect(res._0.layout).toBe(usize_l._0);
      }
      // Other operators are a `span_bug!`.
      expect(() => ecx.binary_ptr_op_("Mul", p, int(1n))).toThrow();
      ran = true;
    });
  });
  expect(ran).toBe(true);
});
