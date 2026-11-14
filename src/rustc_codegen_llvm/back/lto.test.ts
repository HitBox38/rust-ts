// Tests of lane cg-lto-diag: back/lto.rs's ThinLocal no-op (plan-m7 D8) driven through rustc_codegen_ssa's coordinator
// (back/write.rs `start_executing_work`) over a mock backend, and the `-Clto=thin` stop.
//
// The mock backend is ssa-write's (src/rustc_codegen_ssa/back/write.test.ts), with two changes: `serialize_module` returns a
// buffer holding the module's name, and `run_thin_lto` is the real `lto::run_thin` (back/llvm_backend.rs:120 calls nothing
// else). So `prepare_lto` and `thin_lto` run as ported, on the coordinator's real `ThinLtoInput`s; the IR model is not
// reached (no `LLVMRustCreateThinLTOData` under the no-op). `optimize_and_codegen_thin` records the `ThinModule` it gets: the
// real one parses the module back into the IR model (`LLVMRustParseBitcodeForLTO`, an IR-model call: docs/handoff/cg-lto-diag.md).
//
// One test runs the real `optimize_and_codegen_thin_module` on a module of the IR model, with `codegen` replaced (review
// cg-lto-diag N4).
//
// Where the expected order comes from: back/write.rs at the pin, evaluated by hand for two CGUs at -O (the derivation is
// next to the test).
import { describe, expect, spyOn, test } from "bun:test";
import { oracleSysroot } from "../../../scripts/lib/oracle.ts";
import { ThinModule } from "../../rustc_codegen_ssa/back/lto.ts";
import { type CodegenContext, type ModuleConfig, ModuleConfig as ModuleConfigC, SharedEmitter, start_async_codegen, submit_codegened_module_to_llvm, type ThinLtoInput } from "../../rustc_codegen_ssa/back/write.ts";
import { type CompiledModule, type CrateInfo, ModuleCodegen } from "../../rustc_codegen_ssa/lib.ts";
import type { WriteBackendMethods, WriteBackendTypes } from "../../rustc_codegen_ssa/traits/write.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import type { DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { build_output_filenames } from "../../rustc_interface/util.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { OutputFilenames } from "../../rustc_session/config.ts";
import type { Session } from "../../rustc_session/session.ts";
import type { SelfProfilerRef } from "../../rustc_session/stand_ins.ts";
import type { CrateType } from "../../rustc_structures/crate_type.ts";
import * as ffi from "../../rust_ts/llvm/ffi.ts";
import { initialize_available_targets } from "../../rust_ts/llvm/target.ts";
import { module_text, pinned_tool, set_module_text } from "../../rust_ts/llvm/tools.ts";
import { Unported } from "../../std/panic.ts";
import { CURRENT_THREAD } from "../../std/panicking.ts";
import type { LlvmWriteTypes } from "./llvm_backend.ts";
import * as llvm from "../llvm/mod.ts";
import * as lto from "./lto.ts";
import { ModuleBuffer, optimize_and_codegen_thin_module, run_thin, ThinData } from "./lto.ts";
import * as write from "./write.ts";

// ---- sessions (as ssa-write's test) ----------------------------------------------------------------------------------------

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

function with_sess<R>(args: string[], f: (sess: Session) => R): R {
  let out: { r: R } | undefined;
  run_compiler(config_from_args(["--sysroot", oracleSysroot(), ...args, "cgus.rs"]), (compiler) => {
    out = { r: f(compiler.sess) };
  });
  if (out === undefined) throw new Error("ERROR: run_compiler did not run the callback");
  return out.r;
}

/** The parts of `TyCtxt` back/write.rs and rustc_codegen_ssa's back/lto.rs read. A bin with no exported symbols and no
 *  allocator shim (`dependency_formats` empty: `allocator_kind_for_codegen` is `None`). */
function mock_tcx(sess: Session, crate_types: CrateType[], outputs: OutputFilenames): TyCtxt {
  return {
    sess,
    crate_types: () => crate_types,
    backend_optimization_level: () => sess.opts.optimize,
    output_filenames: () => outputs,
    gcx: { incr_comp_session: undefined },
    data_layout: () => ({ pointer_size: () => "ptr-size" }),
    dcx: () => sess.dcx(),
    exported_non_generic_symbols: () => [],
    exported_generic_symbols: () => [],
    dependency_formats: () => new Map(),
  } as unknown as TyCtxt;
}

/** The pinned opt on aarch64 macOS, for the test that runs the thin pass manager (as tools.test.ts). */
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const HAVE_OPT = (() => {
  if (process.platform !== "darwin" || process.arch !== "arm64") return false;
  try {
    pinned_tool("opt");
    return true;
  } catch {
    return false;
  }
})();
if (!HAVE_OPT && !REQUIRE) console.log("SKIP: the pinned opt on aarch64 macOS is unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const X86 = ["--target", "x86_64-unknown-linux-gnu"];
const CGU0 = "cgus.a762f592f3f797ae-cgu.0";
const CGU1 = "cgus.a762f592f3f797ae-cgu.1";

// ---- the mock backend --------------------------------------------------------------------------------------------------------

/** The serialized module: its name's bytes, so `ThinModule::data` / `cost` are checkable. */
class MockBuffer {
  constructor(readonly name: string) {}
  data(): Uint8Array {
    return new TextEncoder().encode(`bitcode of ${this.name}`);
  }
}

interface MockW extends WriteBackendTypes {
  Module: string;
  TargetMachine: string;
  ModuleBuffer: MockBuffer;
  ThinData: ThinData;
}

class ThinLocalBackend implements WriteBackendMethods<MockW> {
  readonly thin_modules: ThinModule<MockW>[] = [];
  cgcx: CodegenContext | undefined;
  constructor(readonly log: string[]) {}
  supports_parallel(): boolean {
    return true;
  }
  thread_profiler(): unknown {
    return undefined;
  }
  target_machine_factory(): (dcx: unknown, config: unknown) => string {
    this.log.push("backend: target_machine_factory");
    return () => "tm";
  }
  optimize(cgcx: CodegenContext, _prof: unknown, _se: unknown, module: ModuleCodegen<string>, config: ModuleConfig): void {
    this.cgcx = cgcx;
    this.log.push(`backend: optimize(${module.name}, opt_level=${config.opt_level ?? "None"}) on '${CURRENT_THREAD.name}'`);
  }
  codegen(_cgcx: CodegenContext, _prof: unknown, _se: unknown, module: ModuleCodegen<string>): CompiledModule {
    this.log.push(`backend: codegen(${module.name}) on '${CURRENT_THREAD.name}'`);
    return { name: module.name, kind: module.kind, object: undefined, global_asm_object: undefined, dwarf_object: undefined, bytecode: undefined, assembly: undefined, llvm_ir: undefined };
  }
  optimize_and_codegen_fat_lto(): CompiledModule {
    throw new Error("ERROR: unexpected optimize_and_codegen_fat_lto");
  }
  /** back/llvm_backend.rs:120: `back::lto::run_thin(cgcx, prof, dcx, exported_symbols_for_lto, each_linked_rlib_for_lto, modules)`. */
  run_thin_lto(cgcx: CodegenContext, prof: SelfProfilerRef, dcx: DiagCtxtHandle, exported: readonly string[], rlibs: readonly string[], modules: ThinLtoInput<MockW>[]): [ThinModule<MockW>[], never[]] {
    this.log.push(`backend: run_thin_lto(${modules.map((m) => (m.$ === "Red" ? m.name : m.$)).join(", ")}; lto=${cgcx.lto}) on '${CURRENT_THREAD.name}'`);
    // PORT (test): lto.ts is typed over `LlvmWriteTypes`; its `ModuleBuffer` is reached only through `ModuleBufferMethods::data`.
    const r = run_thin(cgcx, prof, dcx, exported, rlibs, modules as unknown as ThinLtoInput<LlvmWriteTypes>[]);
    return r as unknown as [ThinModule<MockW>[], never[]];
  }
  optimize_and_codegen_thin(_cgcx: CodegenContext, _prof: unknown, _se: unknown, _tm: unknown, thin: ThinModule<MockW>): CompiledModule {
    this.thin_modules.push(thin);
    this.log.push(`backend: optimize_and_codegen_thin(${thin.name()}, cost=${thin.cost()}) on '${CURRENT_THREAD.name}'`);
    return { name: thin.name(), kind: "Regular", object: undefined, global_asm_object: undefined, dwarf_object: undefined, bytecode: undefined, assembly: undefined, llvm_ir: undefined };
  }
  serialize_module(module: string, is_thin: boolean): MockBuffer {
    this.log.push(`backend: serialize_module(${module}, is_thin=${is_thin}) on '${CURRENT_THREAD.name}'`);
    return new MockBuffer(module);
  }
}

/** base.rs:716 `codegen_crate`'s calls into back/write.rs for `cgus`, then `OngoingCodegen::join` (as ssa-write's test). */
function drive(sess: Session, tcx: TyCtxt, backend: ThinLocalBackend, cgcs: [string, number][]): string[] {
  const log = backend.log;
  const regular = ModuleConfigC.new("Regular", tcx, false);
  const allocator = ModuleConfigC.new("Allocator", tcx, false);
  log.push("main: start_async_codegen");
  const ongoing = start_async_codegen(backend, tcx, regular, allocator, undefined);
  for (const [name, cost] of cgcs) {
    log.push("main: wait_for_signal_to_codegen_item");
    ongoing.wait_for_signal_to_codegen_item();
    ongoing.check_for_errors(sess);
    log.push(`main: submit ${name}`);
    submit_codegened_module_to_llvm(ongoing.coordinator, ModuleCodegen.new_regular(name, name), cost);
  }
  log.push("main: codegen_finished");
  ongoing.codegen_finished(tcx);
  ongoing.check_for_errors(sess);
  log.push("main: join");
  const [compiled] = ongoing.join(sess, undefined, { exported_symbols_for_lto: [], each_linked_rlib_file_for_lto: [] } as unknown as CrateInfo);
  log.push("main: joined");
  return compiled.modules.map((m) => m.name);
}

describe("ThinLocal (plan-m7 D8): -O with two CGUs, through the coordinator over a mock backend", () => {
  // Derivation (back/write.rs at the pin): `sess.lto()` is `ThinLocal` (-O, two CGUs, no -Clto), so
  // `compute_per_cgu_lto_type` (:792) is `Thin` for a bin. Each CGU is optimized on its worker (`opt cgu.N`), then
  // serialized with `is_thin = true` (:852) and sent back as `NeedsThinLto`. When both are in and codegen is complete,
  // the coordinator calls `do_thin_lto` (:1906): `generate_thin_lto_work` → `B::run_thin_lto` on the coordinator thread,
  // then one `optimize_and_codegen_thin` per returned `ThinModule`, on a worker named `lto cgu.N` (`desc`, :704). The
  // ThinModules come back in `module_names` order (the inputs' order, `thin_lto` at lto.rs:396), and `generate_thin_lto_work`
  // turns them into work items with their cost (the serialized size); the coordinator's queue runs the costliest first.
  test("run_thin builds no index, keeps every CGU, and each is optimized and codegened once", () => {
    const log: string[] = [];
    const backend = new ThinLocalBackend(log);
    const names = with_sess([...X86, "-Copt-level=2", "-Ccodegen-units=2", "--emit=obj", "--out-dir", "out"], (sess) => {
      expect(sess.lto()).toBe("ThinLocal");
      const tcx = mock_tcx(sess, ["Executable"], build_output_filenames([], sess));
      return drive(sess, tcx, backend, [
        [CGU1, 7],
        [CGU0, 3],
      ]);
    });
    // The interleaving: as ssa-write's derivation up to the end of the CGUs, with `serialize_module` in place of `codegen`.
    expect(log.filter((l) => l.startsWith("backend: "))).toEqual([
      "backend: target_machine_factory",
      `backend: optimize(${CGU1}, opt_level=More) on 'opt cgu.1'`,
      `backend: serialize_module(${CGU1}, is_thin=true) on 'opt cgu.1'`,
      `backend: optimize(${CGU0}, opt_level=More) on 'opt cgu.0'`,
      `backend: serialize_module(${CGU0}, is_thin=true) on 'opt cgu.0'`,
      `backend: run_thin_lto(${CGU1}, ${CGU0}; lto=ThinLocal) on 'coordinator'`,
      // Equal costs (equal-length buffers): their order is the insertion index of core's `binary_search_by_key`, which
      // ssa-write's test checks; then the costliest-last queue pops from the end.
      `backend: optimize_and_codegen_thin(${CGU1}, cost=${`bitcode of ${CGU1}`.length}) on 'lto cgu.1'`,
      `backend: optimize_and_codegen_thin(${CGU0}, cost=${`bitcode of ${CGU0}`.length}) on 'lto cgu.0'`,
    ]);
    // Both CGUs come back (sorted by name), each once.
    expect(names).toEqual([CGU0, CGU1]);
    // `ThinShared`: no index under the no-op, the serialized modules in input order, each ThinModule its own index.
    const thins = backend.thin_modules;
    expect(thins.map((t) => t.idx)).toEqual([0, 1]);
    const shared = thins[0]!.shared;
    expect(thins[1]!.shared).toBe(shared);
    expect(shared.data).toBeInstanceOf(ThinData);
    expect(shared.data._0).toBeUndefined();
    expect(shared.module_names).toEqual([CGU1, CGU0]);
    expect(thins.map((t) => new TextDecoder().decode(t.data()))).toEqual([`bitcode of ${CGU1}`, `bitcode of ${CGU0}`]);
    expect(CURRENT_THREAD.name).toBe("main");
  });

  // Review cg-lto-diag N4: the real `optimize_and_codegen_thin_module` (lto.rs:700) under ThinLocal parses the thin buffer back
  // into the IR model, skips the four `LLVMRustPrepareThinLTO*` steps (each a model stub, so a call would stop), and reaches
  // `run_pass_manager(.., thin = true)`, which runs opt's thin post-link pipeline. `codegen` (llc and the output files) is
  // replaced by a recorder. The control gives the same module an index: then the first step is reached, and stops.
  test.skipIf(!HAVE_OPT && !REQUIRE)("optimize_and_codegen_thin_module under ThinLocal skips the LLVMRustPrepareThinLTO* steps and runs the thin pass manager", () => {
    const backend = new ThinLocalBackend([]);
    with_sess([...X86, "-Copt-level=2", "-Ccodegen-units=2", "--emit=obj", "--out-dir", "out"], (sess) => {
      const tcx = mock_tcx(sess, ["Executable"], build_output_filenames([], sess));
      drive(sess, tcx, backend, [
        [CGU1, 7],
        [CGU0, 3],
      ]);
      const cgcx = backend.cgcx!;
      expect(cgcx.lto).toBe("ThinLocal");
      // llvm_util.rs init's `initialize_available_targets`, which the target machine factory needs.
      initialize_available_targets();
      const M = ffi.LLVMModuleCreateWithNameInContext(CGU0, ffi.LLVMContextCreate());
      set_module_text(M, `target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"\ntarget triple = "x86_64-unknown-linux-gnu"\n\ndefine i32 @f(i32 %x) {\n  %a = add i32 %x, 1\n  %b = add i32 %a, 1\n  ret i32 %b\n}\n`);
      const shared = (data: ThinData): ThinModule<LlvmWriteTypes> => new ThinModule<LlvmWriteTypes>({ data, modules: [{ $: "Local", _0: ModuleBuffer.new(M, true) }], module_names: [CGU0] }, 0);
      const prepare = ["LLVMRustPrepareThinLTORename", "LLVMRustPrepareThinLTOResolveWeak", "LLVMRustPrepareThinLTOInternalize", "LLVMRustPrepareThinLTOImport"] as const;
      const passes: [boolean, string][] = [];
      const rpm = spyOn(lto, "run_pass_manager").mockImplementation((cgcx_, prof, dcx, module, thin) => {
        rpm.mockRestore();
        try {
          lto.run_pass_manager(cgcx_, prof, dcx, module, thin);
        } finally {
          passes.push([thin, module_text(module.module_llvm.llmod())]);
        }
      });
      const codegened: string[] = [];
      const cg = spyOn(write, "codegen").mockImplementation((_c, _p, _e, module) => {
        codegened.push(module.name);
        return { name: module.name } as CompiledModule;
      });
      const [emitter] = SharedEmitter.new();
      try {
        for (const f of prepare) expect(ffi.IMPLEMENTED.has(f)).toBe(false);
        const out = optimize_and_codegen_thin_module(cgcx, sess.prof, emitter, write.target_machine_factory(sess, sess.opts.optimize), shared(new ThinData(undefined)));
        expect(out.name).toBe(CGU0);
        expect(codegened).toEqual([CGU0]);
        // The thin post-link pipeline ran: at -O2 instcombine folds the two adds.
        expect(passes.map(([thin]) => thin)).toEqual([true]);
        expect(passes[0]![1]).toContain("add i32 %x, 2");
        // Control: with an index (as `-Clto=thin` would build), the first step is reached.
        let stop: unknown;
        try {
          optimize_and_codegen_thin_module({ ...cgcx, lto: "Thin" }, sess.prof, emitter, write.target_machine_factory(sess, sess.opts.optimize), shared(new ThinData({} as llvm.ThinLTOData)));
        } catch (e) {
          stop = e;
        }
        expect(stop).toBeInstanceOf(Unported);
        expect((stop as Unported).what).toBe("llir: LLVMRustPrepareThinLTORename");
      } finally {
        rpm.mockRestore();
        cg.mockRestore();
      }
    });
  });

  test("-Clto=thin stops at unported where the combined index would be built (D8)", () => {
    const log: string[] = [];
    const backend = new ThinLocalBackend(log);
    with_sess([...X86, "-Copt-level=2", "-Ccodegen-units=2", "--emit=obj", "--out-dir", "out"], (sess) => {
      const tcx = mock_tcx(sess, ["Executable"], build_output_filenames([], sess));
      drive(sess, tcx, backend, [
        [CGU1, 7],
        [CGU0, 3],
      ]);
      // The same `CodegenContext` with `lto: Thin`, and the CGU's thin buffer as the coordinator hands it.
      const cgcx: CodegenContext = { ...backend.cgcx!, lto: "Thin" };
      const modules: ThinLtoInput<MockW>[] = [{ $: "Red", name: CGU0, buffer: { $: "Local", _0: new MockBuffer(CGU0) } }];
      let thrown: unknown;
      try {
        backend.run_thin_lto(cgcx, sess.prof, sess.dcx(), [], [], modules);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(Unported);
      expect((thrown as Unported).message).toContain("-Clto=thin: LLVMRustCreateThinLTOData");
    });
  });
});
