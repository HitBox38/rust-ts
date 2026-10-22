// Unit tests of `intern_const_alloc_recursive` (interpret/intern.ts, lane interp-validity-intern) on hand-built local
// allocations: the end-to-end path (`allocate` / `copy_op` of interp-place-operand) is not reachable before those lanes
// land. `MPlaceTy::ptr` (place.rs:140, `self.mplace.ptr`) is still interp-place-operand's stub: the test installs that
// one-line body for its duration.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { Align, Size } from "../../rustc_abi/lib.ts";
import "../../rustc_hir_analysis/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import "../../rustc_middle/lib.ts";
import { type AllocId, alloc_range, Allocation, CtfeProvenance, Pointer, Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { CanAccessMutGlobal, CheckAlignment, CompileTimeMachine } from "../const_eval/mod.ts";
import { InterpCx } from "./eval_context.ts";
import { intern_const_alloc_recursive, InternKind } from "./intern.ts";
import { MemoryKind } from "./memory.ts";
import { MemPlace, MPlaceTy } from "./place.ts";

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

test("intern_const_alloc_recursive: moves the base and the reachable allocations to tcx, immutably", () => {
  const file = join(DATA, "tmp", "interp-validity-intern", `agent-${Bun.hash(process.env.RUST_TS_AGENT ?? "default").toString(16)}`, "intern.rs");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SRC);
  const orig_ptr = MPlaceTy.prototype.ptr;
  MPlaceTy.prototype.ptr = function (this: MPlaceTy) {
    return this.mplace.ptr;
  };
  let ran = false;
  try {
    run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
      create_and_enter_global_ctxt(compiler, parse(compiler.sess), (tcx) => {
        void tcx.resolver_for_lowering();
        const typing_env = TypingEnv.fully_monomorphized();
        const new_ecx = () => InterpCx.new(tcx, DUMMY_SP, typing_env, CompileTimeMachine.new(CanAccessMutGlobal.No, CheckAlignment.No));
        const ptr_size = tcx.data_layout().pointer_size().bytes();
        const usize_l = new_ecx().layout_of(tcx.types.usize);
        if (usize_l.$ !== "Ok") throw new Error("ERROR: usize layout");
        const local = (ecx: InterpCx, bytes: number[]): AllocId => {
          const id = tcx.reserve_alloc_id();
          ecx.memory.alloc_map.insert(id, [MemoryKind.Stack, Allocation.from_bytes(new Uint8Array(bytes), Align.ONE, "Mut", null)]);
          return id;
        };
        const place = (id: AllocId) =>
          new MPlaceTy(new MemPlace(Pointer.new<CtfeProvenance | undefined>(CtfeProvenance.from_parts([id, false, false]), Size.ZERO), { $: "None" }, undefined), usize_l._0);
        const write_ptr = (ecx: InterpCx, into: AllocId, to: CtfeProvenance) => {
          const [, alloc] = ecx.memory.alloc_map.get(into)!;
          const r = alloc.write_scalar(tcx, alloc_range(Size.ZERO, Size.from_bytes(ptr_size)), Scalar.from_pointer(Pointer.new(to, Size.ZERO), tcx));
          if (r.$ !== "Ok") throw new Error("ERROR: write_scalar");
        };

        // a const whose value points (through a shared reference) to a second local allocation
        {
          const ecx = new_ecx();
          const inner = local(ecx, [1, 2, 3, 4, 5, 6, 7, 8].slice(0, ptr_size));
          const base = local(ecx, new Array(ptr_size).fill(0));
          write_ptr(ecx, base, CtfeProvenance.from_parts([inner, true, true]));
          expect(intern_const_alloc_recursive(ecx, InternKind.Constant, place(base))).toEqual({ $: "Ok", _0: undefined });
          expect(ecx.memory.alloc_map.contains_key(base)).toBe(false);
          expect(ecx.memory.alloc_map.contains_key(inner)).toBe(false);
          for (const id of [base, inner]) {
            const g = tcx.try_get_global_alloc(id);
            if (g === undefined || g.$ !== "Memory") throw new Error("ERROR: not interned");
            expect(g._0.inner().mutability).toBe("Not");
          }
        }

        // a pointer to an allocation that is not there: `DanglingPointer` (left to validation to report)
        {
          const ecx = new_ecx();
          const gone = tcx.reserve_alloc_id();
          const base = local(ecx, new Array(ptr_size).fill(0));
          write_ptr(ecx, base, CtfeProvenance.from_parts([gone, false, false]));
          expect(intern_const_alloc_recursive(ecx, InternKind.Constant, place(base))).toEqual({ $: "Err", _0: "DanglingPointer" });
        }

        // a non-shared-ref pointer to new local memory in a const: the "static const safety checks" ICE
        {
          const ecx = new_ecx();
          const inner = local(ecx, new Array(ptr_size).fill(0));
          const base = local(ecx, new Array(ptr_size).fill(0));
          write_ptr(ecx, base, CtfeProvenance.from_parts([inner, false, false]));
          expect(() => intern_const_alloc_recursive(ecx, InternKind.Constant, place(base))).toThrow(
            "the static const safety checks accepted a mutable pointer they should not have accepted",
          );
        }
        ran = true;
      });
    });
  } finally {
    MPlaceTy.prototype.ptr = orig_ptr;
  }
  expect(ran).toBe(true);
}, 120_000);
