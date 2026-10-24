// Unit tests of interpret/place.ts and interpret/operand.ts (lane interp-place-operand): the immediate and local-place
// paths end to end, and the memory-backed paths (allocation, reads/writes through `AllocRef`, lane interp-memory).
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { Size } from "../../rustc_abi/lib.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import "../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import "../../rustc_middle/lib.ts";
import { Pointer, Scalar, debug_CtfeProvenance, debug_Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { Local } from "../../rustc_middle/mir/mod.ts";
import { ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import { Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Panic } from "../../std/panic.ts";
import { CanAccessMutGlobal, CheckAlignment, CompileTimeMachine } from "../const_eval/mod.ts";
import { InterpCx } from "./eval_context.ts";
import { MemoryKind } from "./memory.gen.ts";
import { ImmTy, Immediate, OpTy, OpTy_from_ImmTy, debug_ImmTy, display_ImmTy } from "./operand.ts";
import { MPlaceTy, MemPlace, MemPlaceMeta, PlaceTy, PlaceTy_from_MPlaceTy } from "./place.ts";

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
  "#[lang = \"pointee_sized\"] pub trait PointeeSized {}",
  "#[lang = \"meta_sized\"] pub trait MetaSized: PointeeSized {}",
  "#[lang = \"sized\"] pub trait Sized: MetaSized {}",
].join("\n");

test("immediates, operands and local places", () => {
  const file = join(DATA, "tmp", "interp-place-operand", `agent-${Bun.hash(process.env.RUST_TS_AGENT ?? "default").toString(16)}`, "place_operand.rs");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SRC);
  let ran = false;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      const typing_env = TypingEnv.fully_monomorphized();
      const ecx = InterpCx.new(tcx, DUMMY_SP, typing_env, CompileTimeMachine.new(CanAccessMutGlobal.No, CheckAlignment.No));
      const layout = (ty: Ty) => {
        const r = ecx.layout_of(ty);
        if (r.$ !== "Ok") throw new Error("ERROR: layout_of failed");
        return r._0;
      };
      const u8 = layout(tcx.types.u8);
      const u32 = layout(tcx.types.u32);
      const usize = layout(tcx.types.usize);
      const unit = layout(tcx.types.unit);

      // Immediate constructors and accessors
      const ptr = Pointer.without_provenance<never>(16n);
      const slice = Immediate.new_slice(ptr, 3n, ecx);
      if (slice.$ !== "ScalarPair") throw new Error("ERROR: new_slice is not a pair");
      expect(Scalar.size(slice._0).bytes()).toBe(8);
      expect(Scalar.size(slice._1).bytes()).toBe(8);
      expect(Immediate.to_scalar_pair(slice).length).toBe(2);
      expect(Immediate.has_provenance(slice)).toBe(false);
      expect(() => Immediate.to_scalar(slice)).toThrow("Got a scalar pair where a scalar was expected");
      const [s0, m0] = Immediate.to_scalar_and_meta(Immediate.new_pointer_with_meta(ptr, MemPlaceMeta.None, ecx));
      expect(Scalar.size(s0).bytes()).toBe(8);
      expect(m0).toBe(MemPlaceMeta.None);

      // ImmTy constructors, Display and Debug
      const seven = ImmTy.from_uint(7n, u8);
      expect(seven.to_scalar_int()).toEqual({ $: "Ok", _0: ScalarInt.from_u8(7) });
      expect(seven.to_const_int().int).toEqual(ScalarInt.from_u8(7));
      expect(display_ImmTy(seven, PLAIN)).toBe("7_u8");
      expect(debug_ImmTy(seven, PLAIN)).toBe(`ImmTy { imm: Scalar(${debug_Scalar(Immediate.to_scalar(seven.imm), PLAIN, debug_CtfeProvenance)}), ty: u8 }`);
      expect(display_ImmTy(ImmTy.uninit(u8), PLAIN)).toBe("uninit: u8");
      expect(ImmTy.from_bool(true, tcx).layout.ty).toBe(tcx.types.bool);
      expect(() => Immediate.assert_matches_abi(Immediate.Uninit, u8.backend_repr, "m", ecx)).not.toThrow();
      expect(() => Immediate.assert_matches_abi(seven.imm, u32.backend_repr, "m", ecx)).toThrow(Panic);

      // reading an immediate operand never touches memory
      const op = OpTy_from_ImmTy(seven);
      expect(op.as_mplace_or_imm().$).toBe("Right");
      expect(op.meta()).toBe(MemPlaceMeta.None);
      const read = ecx.read_scalar(op);
      expect(read.$).toBe("Ok");
      const n = ecx.read_target_usize(OpTy_from_ImmTy(ImmTy.from_uint(42n, usize)));
      expect(n).toEqual({ $: "Ok", _0: 42n });
      const uninit = ecx.read_immediate(new OpTy({ $: "Immediate", _0: Immediate.Uninit }, u8));
      if (uninit.$ !== "Err") throw new Error("ERROR: reading uninit succeeded");
      expect(uninit._0.kind().$).toBe("UndefinedBehavior");

      // sub-immediates of a scalar pair: `(u8, u32)` has `ScalarPair` ABI with `b_offset` 4
      const pair = layout(Ty.new_tup(tcx, [tcx.types.u8, tcx.types.u32]));
      expect(pair.backend_repr.$).toBe("ScalarPair");
      const imm_pair = ImmTy.from_scalar_pair(Scalar.from_uint(1n, Size.from_bytes(1)), Scalar.from_uint(2n, Size.from_bytes(4)), pair);
      const b = imm_pair.offset_(Size.from_bytes(4), u32, ecx);
      expect(b.imm).toEqual({ $: "Scalar", _0: Scalar.from_uint(2n, Size.from_bytes(4)) });
      expect(imm_pair.offset_(Size.ZERO, unit, ecx).imm).toBe(Immediate.Uninit);
      const [p0, p1] = imm_pair.to_pair(ecx);
      expect(p0.layout.ty).toBe(tcx.types.u8);
      expect(p1.layout.ty).toBe(tcx.types.u32);

      // local places project by offset; memory places convert to operands without reading
      const local = new PlaceTy({ $: "Local", local: Local.from_u32(1), offset: undefined, locals_addr: 0 }, pair);
      const field = local.offset_with_meta(Size.from_bytes(4), "Inbounds", MemPlaceMeta.None, u32, ecx);
      if (field.$ !== "Ok") throw new Error("ERROR: local projection failed");
      const fp = field._0.place_();
      expect(fp.$ === "Local" && fp.offset?.bytes()).toBe(4);
      expect(() => local.offset_with_meta(Size.from_bytes(4), "Inbounds", MemPlaceMeta.None, pair, ecx)).toThrow(Panic);
      const zst = MPlaceTy.fake_alloc_zst(unit);
      expect(zst.ptr().offset.bytes()).toBe(1);
      expect(zst.to_place().as_mplace_or_local().$).toBe("Left");
      expect(PlaceTy_from_MPlaceTy(zst).assert_mem_place().mplace).toBe(zst.mplace);
      const mp = new MPlaceTy(new MemPlace(ptr, MemPlaceMeta.None, undefined), u8);
      const shifted = mp.offset_with_meta(Size.from_bytes(2), "Wrapping", MemPlaceMeta.None, u8, ecx);
      if (shifted.$ !== "Ok") throw new Error("ERROR: wrapping offset failed");
      expect(shifted._0.ptr().offset.bytes()).toBe(18);

      // the memory-backed paths (lane interp-memory): a stack allocation of `u8` takes the operand and reads it
      // back; writing through an integer address (no provenance) is a dangling-pointer access (UB)
      const a = ecx.allocate(u8, MemoryKind.Stack);
      if (a.$ !== "Ok") throw new Error("ERROR: allocate failed");
      expect(a._0.layout).toBe(u8);
      expect(ecx.copy_op(op, a._0).$).toBe("Ok");
      expect(ecx.read_scalar(a._0)).toEqual({ $: "Ok", _0: { $: "Int", _0: ScalarInt.from_u8(7) } });
      const dangling = ecx.copy_op(op, mp);
      if (dangling.$ !== "Err") throw new Error("ERROR: write through an integer address succeeded");
      expect(dangling._0.kind()).toEqual({
        $: "UndefinedBehavior",
        _0: { $: "DanglingIntPointer", addr: 16, inbounds_size: 1, msg: { $: "MemoryAccess" } },
      });
      ran = true;
    });
  });
  expect(ran).toBe(true);
}, 120_000);
