// Tests of lane cg-write (back/write.rs, llvm_util.rs, back/owned_*, back/profiling.rs, back/archive.rs) against oracle facts.
//
// 1. **The target machine settings.** For an empty `#![no_core]` lib (context_oracle/empty.rs) on x86_64-unknown-linux-gnu and on
//    the host (aarch64-apple-darwin), the arguments the port passes to `LLVMRustCreateTargetMachine` from
//    `create_informational_target_machine` (through `create_module`) and `create_target_machine` (through `ModuleLlvm::new`),
//    against the pinned rustc's for the same compile (write_oracle/<target>.tm). `LLVMRustCreateTargetMachine` is a wrapper
//    inside librustc_driver, which src/rust_ts/llvm/record.ts cannot see, so the oracle's calls are recorded at the wrapper's
//    entry with lldb (write_oracle/record_tm.py, in record.ts's argument form). The recording is a tool run by hand
//    (`bun src/rustc_codegen_llvm/back/write_oracle/record.ts`, write_oracle/README.md), never by this test: the oracle cannot
//    change, and lldb is no pinned tool (review cg-write N1).
// 2. **`get_version`** and **`print_version`** against the oracle's `rustc -vV` (`LLVM version: ...`, write_oracle/version.txt).
//    With the pinned toolchain present, `rustc -vV` is re-run and must still print the fixture's line.
// 3. **The `--emit=llvm-ir` path of `codegen`**: a module the port built (`ModuleLlvm::new` + `CodegenCx::new`, as context.test.ts
//    builds it) is written through `codegen` with `emit_ir` set and must be the oracle's `--emit=llvm-ir -Cno-prepopulate-passes`
//    text byte for byte (context_oracle/<target>.ll, cg-context's fixture).
// 4. Pure helpers: `to_llvm_features`, `global_llvm_features`, `update_target_reliable_float_cfg`, `create_section_with_flags_asm`
//    (through `embed_bitcode`), `TargetFeatureFoldStrength`, and what reaches an IR-model stop stops there by name.
//
// **Test doubles** (each restored after its test): the callees in other lanes that are typed stubs today are replaced by
// line-by-line copies of their upstream bodies, cited where they are defined below: `OutputFilenames::{temp_path_for_cgu,
// temp_path_ext_for_cgu, temp_path_dwo_for_cgu, split_dwarf_path}` and `maybe_strip_file_name` (rustc_session config.rs,
// ssa-write's), `ModuleConfig::bitcode_needed` (rustc_codegen_ssa back/write.rs, ssa-write's). The IR model's stops the compile
// reaches are replaced too: `LLVMRustCreateTargetMachine` records its call and returns an opaque target machine carrying the
// oracle's data layout, `LLVMRustSetDataLayoutFromTargetMachine` applies it, `LLVMDisposeTargetMachine` does nothing, and the
// three diagnostic-handler wrappers keep no handler. `SharedEmitter` (ssa-write's placeholder) becomes an emitter that records
// what it is given, and `CodegenContext` / `ModuleConfig` are objects with the upstream fields `codegen` reads.
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";
import "../../rustc_session/lib.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { type CompiledModule, ModuleCodegen } from "../../rustc_codegen_ssa/lib.ts";
import type { CodegenContext, ModuleConfig, SharedEmitter } from "../../rustc_codegen_ssa/back/write.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import { Emitter } from "../../rustc_errors/emitter.ts";
import type { DiagInner } from "../../rustc_errors/lib.ts";
import "../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import type { TargetConfig } from "../../rustc_interface/stand_ins.ts";
import "../../rustc_middle/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import * as session_config from "../../rustc_session/config.ts";
import { OutputType, type OutputFilenames, type SplitDwarfKind } from "../../rustc_session/config.ts";
import type { SplitDebuginfo } from "../../rustc_target/spec/mod.ts";
import { Unported } from "../../std/panic.ts";
import * as ffi from "../../rust_ts/llvm/ffi.ts";
import { Context as IrContext, Module as IrModuleClass } from "../../rust_ts/llvm/ir.ts";
import { is_tool_text, pinned_tool, with_cl_args } from "../../rust_ts/llvm/tools.ts";
import { CL_ARGS, tmFromRecorded } from "../../rust_ts/llvm/tools_oracle/fixtures.ts";
import type { Module as IrModule } from "../../rust_ts/llvm/ir.ts";
import { printModule } from "../../rust_ts/llvm/printer.ts";
import "../lib.ts";
import { CodegenCx } from "../context.ts";
import type * as llvm from "../llvm/mod.ts";
import * as llvm_util from "../llvm_util.ts";
import { LLVMFeature, TargetFeatureFoldStrength } from "../llvm_util.ts";
import { LlvmArchiveBuilderBuilder } from "./archive.ts";
import { ModuleLlvm } from "./llvm_backend.ts";
import { OwnedMCSubtargetInfo } from "./owned_mc_subtarget_info.ts";
import { OwnedTargetMachine } from "./owned_target_machine.ts";
import * as write from "./write.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ORACLE = join(import.meta.dir, "write_oracle");
const CONTEXT_ORACLE = join(import.meta.dir, "..", "context_oracle");
const TARGETS = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"] as const;
const SYSROOT = (() => {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } });
    return r.exitCode === 0 ? r.stdout.toString().trim() : "";
  } catch {
    return "";
  }
})();
const HAVE = SYSROOT !== "" && process.platform === "darwin" && process.arch === "arm64";
const WORK = join(DATA, "tmp", "cg-write-test", `${process.env.RUST_TS_AGENT ?? "default"}-${process.pid}`);
afterAll(() => rmSync(WORK, { recursive: true, force: true }));

// ---- the port's front end, for a real TyCtxt (as context.test.ts) ----
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

/** Runs `f` with the `TyCtxt` of `context_oracle/empty.rs`, compiled with the oracle fixtures' flags plus `extra`, as the oracle
 *  was run: from the work directory, with the relative path `empty.rs` (review cg-write N3). The cwd is restored afterwards. */
function with_tcx<R>(target: string, extra: string[], f: (tcx: TyCtxt) => R): R {
  mkdirSync(WORK, { recursive: true });
  writeFileSync(join(WORK, "empty.rs"), readFileSync(join(CONTEXT_ORACLE, "empty.rs")));
  let out: R | undefined;
  const cwd = process.cwd();
  process.chdir(WORK);
  try {
    run_compiler(config_from_args(["--crate-type", "lib", "--target", target, "--emit=llvm-ir", "-Cno-prepopulate-passes", ...extra, "empty.rs"]), (compiler) => {
      const krate: Crate = parse(compiler.sess);
      create_and_enter_global_ctxt(compiler, krate, (tcx) => {
        out = f(tcx);
      });
    });
  } finally {
    process.chdir(cwd);
  }
  return out as R;
}

/** The module name the oracle used (`; ModuleID = '...'` of cg-context's fixture). */
function oracle_module_name(target: string): string {
  const m = /^; ModuleID = '([^']*)'/.exec(readFileSync(join(CONTEXT_ORACLE, `${target}.ll`), "utf8"));
  if (m === null) throw new Error("ERROR: no ModuleID in the fixture");
  return m[1]!;
}
/** The data layout the oracle's target machine gave the module (`target datalayout = "..."` of cg-context's fixture). */
function oracle_data_layout(target: string): string {
  const m = /^target datalayout = "([^"]*)"$/m.exec(readFileSync(join(CONTEXT_ORACLE, `${target}.ll`), "utf8"));
  if (m === null) throw new Error("ERROR: no datalayout in the fixture");
  return m[1]!;
}

// ---- test doubles: copies of the upstream bodies (header) ----
const MAX_FILENAME_LENGTH = 143; // config.rs:1234
const RUST_CGU_EXT = "rcgu"; // config.rs:1232
const DWARF_OBJECT_EXT = "dwo"; // config.rs:1233

/** rustc_session config.rs:1239 maybe_strip_file_name: a name of at most 143 bytes is kept (the hashing arm is not reached here). */
function maybe_strip_file_name(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (new TextEncoder().encode(name).length > MAX_FILENAME_LENGTH) throw new Error("ERROR: maybe_strip_file_name's hashing arm (not copied)");
  return path;
}
/** rustc_session config.rs:1334 temp_path_ext_for_cgu */
function temp_path_ext_for_cgu(self: OutputFilenames, ext: string, codegen_unit_name: string): string {
  let extension = codegen_unit_name;

  // Append `.{invocation_temp}` to ensure temporary files are unique.
  if (self.invocation_temp !== undefined) {
    extension += ".";
    extension += self.invocation_temp;
  }

  // FIXME: This is sketchy that we're not appending `.rcgu` when the ext is empty.
  // Append `.rcgu.{ext}`.
  if (ext !== "") {
    extension += ".";
    extension += RUST_CGU_EXT;
    extension += ".";
    extension += ext;
  }

  const temps_directory = self.temps_directory ?? self.out_directory;
  return maybe_strip_file_name(self.with_directory_and_extension(temps_directory, extension));
}
/** rustc_session config.rs:1315 temp_path_for_cgu */
function temp_path_for_cgu(self: OutputFilenames, flavor: OutputType, codegen_unit_name: string): string {
  const extension = OutputType.extension(flavor);
  return temp_path_ext_for_cgu(self, extension, codegen_unit_name);
}
/** rustc_session config.rs:1321 temp_path_dwo_for_cgu */
function temp_path_dwo_for_cgu(self: OutputFilenames, codegen_unit_name: string): string {
  const p = temp_path_ext_for_cgu(self, DWARF_OBJECT_EXT, codegen_unit_name);
  if (self.explicit_dwo_out_directory !== undefined) {
    return join(self.explicit_dwo_out_directory, p.slice(p.lastIndexOf("/") + 1));
  } else {
    return p;
  }
}
/** rustc_session config.rs:1374 split_dwarf_path */
function split_dwarf_path(self: OutputFilenames, split_debuginfo_kind: SplitDebuginfo, split_dwarf_kind: SplitDwarfKind, cgu_name: string): string | undefined {
  const obj_out = temp_path_for_cgu(self, "Object", cgu_name);
  const dwo_out = temp_path_dwo_for_cgu(self, cgu_name);
  if (split_debuginfo_kind === "Off") return undefined;
  // Single mode doesn't change how DWARF is emitted, but does add Split DWARF attributes
  // (pointing at the path which is being determined here). Use the path to the current
  // object file.
  if (split_dwarf_kind === "Single") return obj_out;
  // Split mode emits the DWARF into a different file, use that path.
  return dwo_out;
}

/** A byte string as record.ts prints it. */
function bytes(s: string | undefined): string {
  if (s === undefined) return "null";
  let r = '"';
  for (const c of new TextEncoder().encode(s)) r += c >= 0x20 && c < 0x7f && c !== 0x22 && c !== 0x5c ? String.fromCharCode(c) : `\\${c.toString(16).toUpperCase().padStart(2, "0")}`;
  return `${r}"`;
}

/** The ffi.rs discriminants record_tm.py prints for the enums `LLVMRustCreateTargetMachine` takes. */
const DISCR: Record<string, Readonly<Record<string, number>>> = {
  model: ffi.CodeModel_discriminant,
  reloc: ffi.RelocModel_discriminant,
  level: ffi.CodeGenOptLevel_discriminant,
  float_abi: ffi.FloatAbi_discriminant,
  compression: ffi.CompressionKind_discriminant,
};

/** Installs the doubles (header); `tm_calls` gets each `LLVMRustCreateTargetMachine` call in record_tm.py's form. */
function install_doubles(data_layout: string): { tm_calls: string[]; diag_calls: string[]; restore: () => void } {
  const tm_calls: string[] = [];
  const diag_calls: string[] = [];
  const spies: { mockRestore(): void }[] = [];
  spies.push(spyOn(write, "OutputFilenames_temp_path_for_cgu").mockImplementation(temp_path_for_cgu));
  spies.push(spyOn(write, "OutputFilenames_temp_path_ext_for_cgu").mockImplementation(temp_path_ext_for_cgu));
  spies.push(spyOn(write, "OutputFilenames_temp_path_dwo_for_cgu").mockImplementation(temp_path_dwo_for_cgu));
  spies.push(spyOn(write, "OutputFilenames_split_dwarf_path").mockImplementation(split_dwarf_path));
  // rustc_codegen_ssa back/write.rs:269 bitcode_needed
  spies.push(
    spyOn(write, "ModuleConfig_bitcode_needed").mockImplementation((config_) => {
      const self = config_ as unknown as ModuleConfigFields;
      return self.emit_bc || self.emit_thin_lto_summary || self.emit_obj.$ === "Bitcode" || (self.emit_obj.$ === "ObjectCode" && self.emit_obj._0 === "Full");
    }),
  );
  spies.push(spyOn(write, "SharedEmitter_clone_box").mockImplementation(() => new RecordingEmitter()));
  const ns = ffi as unknown as Record<string, unknown>;
  spies.push(
    spyOn(ns, "LLVMRustCreateTargetMachine" as never).mockImplementation(((...a: unknown[]) => {
      const kinds = ["s", "s", "s", "s", "model", "reloc", "level", "float_abi", "b", "b", "b", "b", "b", "b", "b", "b", "b", "s", "s", "compression", "b", "b", "u64"];
      const args = a.map((v, i) => {
        const k = kinds[i]!;
        if (k === "s") return bytes(v as string | undefined);
        if (k === "b") return (v as boolean) ? "1" : "0";
        if (k === "u64") return String(v as bigint);
        return String(DISCR[k]![v as string]);
      });
      tm_calls.push(`LLVMRustCreateTargetMachine(${args.join(", ")})`);
      return { data_layout } as unknown as llvm.TargetMachine;
    }) as never),
  );
  spies.push(
    spyOn(ns, "LLVMRustSetDataLayoutFromTargetMachine" as never).mockImplementation(((m: IrModule, tm: { data_layout: string }) => {
      m.dataLayout = tm.data_layout;
    }) as never),
  );
  spies.push(spyOn(ns, "LLVMDisposeTargetMachine" as never).mockImplementation((() => undefined) as never));
  spies.push(
    spyOn(ns, "LLVMRustContextGetDiagnosticHandler" as never).mockImplementation((() => {
      diag_calls.push("get");
      return undefined;
    }) as never),
  );
  spies.push(
    spyOn(ns, "LLVMRustContextConfigureDiagnosticHandler" as never).mockImplementation(((_c: unknown, _cb: unknown, _d: unknown, all: boolean, passes: string[], n: number, file: string | undefined, pgo: boolean) => {
      diag_calls.push(`configure ${all} [${passes.join(",")}] ${n} ${file} ${pgo}`);
    }) as never),
  );
  spies.push(
    spyOn(ns, "LLVMRustContextSetDiagnosticHandler" as never).mockImplementation(((_c: unknown, h: unknown) => {
      diag_calls.push(`set ${String(h)}`);
    }) as never),
  );
  return {
    tm_calls,
    diag_calls,
    restore: () => {
      for (const s of spies.reverse()) s.mockRestore();
    },
  };
}

/** The emitter `SharedEmitter_clone_box` hands out in the tests: records what it is given. */
const EMITTED: DiagInner[] = [];
class RecordingEmitter extends Emitter {
  emit_diagnostic(diag: DiagInner): void {
    EMITTED.push(diag);
  }
  source_map(): undefined {
    return undefined;
  }
}

/** The upstream fields of `ModuleConfig` (rustc_codegen_ssa back/write.rs:72) `codegen` and `optimize` read. */
interface ModuleConfigFields {
  emit_bc: boolean;
  emit_thin_lto_summary: boolean;
  emit_obj: { $: "None" } | { $: "Bitcode" } | { $: "ObjectCode"; _0: "None" | "Full" };
  [k: string]: unknown;
}

describe("create_target_machine: the settings passed to LLVMRustCreateTargetMachine, against the oracle (empty no_core lib)", () => {
  for (const target of TARGETS) {
    test(target, () => {
      const want = readFileSync(join(ORACLE, `${target}.tm`), "utf8").split("\n").filter((l) => l !== "");
      const d = install_doubles(oracle_data_layout(target));
      try {
        with_tcx(target, [], (tcx) => {
          // `ModuleLlvm::new`: `create_module` (its `create_informational_target_machine`), then `create_target_machine`.
          const m = ModuleLlvm.new(tcx, oracle_module_name(target));
          m.drop();
        });
      } finally {
        d.restore();
      }
      expect(d.tm_calls).toEqual(want);
    });
  }
});

describe.skipIf(!HAVE && !REQUIRE)("the version fixture is current", () => {
  test("LLVM version (rustc -vV)", () => {
    const r = Bun.spawnSync([join(SYSROOT, "bin", "rustc"), "-vV"]);
    expect(r.exitCode).toBe(0);
    const line = r.stdout
      .toString()
      .split("\n")
      .find((l) => l.startsWith("LLVM version: "));
    expect(`${line}\n`).toBe(readFileSync(join(ORACLE, "version.txt"), "utf8"));
  });
});

describe("llvm_util: get_version, print_version", () => {
  test("get_version is the oracle's LLVM (rustc -vV)", () => {
    const [major, minor, patch] = llvm_util.get_version();
    expect(`LLVM version: ${major}.${minor}.${patch}\n`).toBe(readFileSync(join(ORACLE, "version.txt"), "utf8"));
  });
  test("print_version prints rustc -vV's line", () => {
    const printed: string[] = [];
    const s = spyOn(session_config, "std_print").mockImplementation((t: string) => void printed.push(t));
    try {
      llvm_util.print_version();
    } finally {
      s.mockRestore();
    }
    expect(printed.join("")).toBe(readFileSync(join(ORACLE, "version.txt"), "utf8"));
  });
});

describe("codegen: the --emit=llvm-ir output of a module the port built, against the oracle", () => {
  for (const target of TARGETS) {
    test(target, () => {
      const d = install_doubles(oracle_data_layout(target));
      // Relative to the work directory, where `with_tcx` compiles.
      const outdir = `emit-${target}`;
      mkdirSync(join(WORK, outdir), { recursive: true });
      let out_path = "";
      let stop: unknown;
      let compiled: CompiledModule | undefined;
      try {
        with_tcx(target, ["--out-dir", outdir], (tcx) => {
          const mod_name = oracle_module_name(target);
          const llvm_module = ModuleLlvm.new(tcx, mod_name);
          // `CodegenCx::new` adds nothing to an empty module's text but runs as `module_codegen` runs it (context.test.ts).
          CodegenCx.new(tcx, undefined as never, llvm_module, false);
          const module = ModuleCodegen.new_regular(mod_name, llvm_module);
          const output_filenames = tcx.output_filenames(null) as OutputFilenames;
          const config = {
            passes: [],
            opt_level: undefined,
            emit_bc: false,
            emit_ir: true,
            emit_asm: false,
            emit_obj: { $: "None" },
            emit_thin_lto_summary: false,
            no_builtins: false,
            verify_llvm_ir: false,
            pgo_use: undefined,
          } as unknown as ModuleConfig;
          const cgcx = {
            lto: "No",
            use_linker_plugin_lto: false,
            save_temps: false,
            output_filenames,
            module_config: config,
            msvc_imps_needed: false,
            is_pe_coff: false,
            target_can_use_split_dwarf: tcx.sess.target_can_use_split_dwarf(),
            target_arch: "",
            target_is_like_darwin: target.includes("apple"),
            target_is_like_aix: false,
            target_is_like_gpu: false,
            split_debuginfo: tcx.sess.split_debuginfo(),
            split_dwarf_kind: tcx.sess.opts.unstable_opts.split_dwarf_kind,
            remark: { $: "Some", _0: [] },
            remark_dir: undefined,
          } as unknown as CodegenContext;
          out_path = temp_path_for_cgu(output_filenames, "LlvmAssembly", mod_name);
          try {
            compiled = write.codegen(cgcx, tcx.sess.prof, {} as SharedEmitter, module, config);
          } catch (e) {
            stop = e;
          }
        });
      } finally {
        d.restore();
      }
      // `into_compiled_module` (rustc_codegen_ssa lib.rs) names the written file through rustc_session's `temp_path_for_cgu`
      // (ssa-write's port; root at integ-w55): `codegen` returns, and the compiled module's `llvm_ir` is the file written.
      expect(stop).toBeUndefined();
      expect(compiled?.llvm_ir).toBe(out_path);
      expect([compiled?.object, compiled?.bytecode, compiled?.assembly]).toEqual([undefined, undefined, undefined]);
      expect(EMITTED).toEqual([]);
      // `DiagnosticHandlers::new` and its drop: the old handler is read, the new one configured (no remark passes, no file, no PGO),
      // and the old one put back.
      expect(d.diag_calls).toEqual(["get", "configure false [] 0 undefined false", "set undefined"]);
      // `out_path` is relative to the work directory (the cwd `with_tcx` restored).
      expect(existsSync(join(WORK, out_path))).toBe(true);
      expect(readFileSync(join(WORK, out_path), "utf8")).toBe(readFileSync(join(CONTEXT_ORACLE, `${target}.ll`), "utf8"));
    });
  }
});

describe("llvm_util helpers", () => {
  const tgt = (arch: string) => ({ arch: { $: arch } }) as never;
  test("to_llvm_features (llvm_util.rs:239): renames, ties and filters", () => {
    expect(llvm_util.to_llvm_features(tgt("AArch64"), "neon")?.into_iter()).toEqual(["neon", "fp-armv8"]);
    expect(llvm_util.to_llvm_features(tgt("AArch64"), "fpmr")).toBeUndefined();
    expect(llvm_util.to_llvm_features(tgt("AArch64"), "paca")?.llvm_feature_name).toBe("pauth");
    expect(llvm_util.to_llvm_features(tgt("X86_64"), "sse4.2")?.into_iter()).toEqual(["sse4.2", "crc32"]);
    expect(llvm_util.to_llvm_features(tgt("X86_64"), "apxf")?.into_iter()).toEqual(["egpr", "push2pop2", "ppx", "ndd", "ccmp", "cf", "nf", "zu"]);
    expect(llvm_util.to_llvm_features(tgt("RiscV64"), "zkne_or_zknd")).toBeUndefined();
    // LLVM 23 (< 24): the Nvptx64 renames are off.
    expect(llvm_util.to_llvm_features(tgt("Nvptx64"), "sm_101")?.llvm_feature_name).toBe("sm_101");
    expect(TargetFeatureFoldStrength.as_str({ $: "EnableOnly", _0: "x" })).toBe("x");
    expect(LLVMFeature.new("a").into_iter()).toEqual(["a"]);
  });

  test("global_llvm_features (llvm_util.rs:688) matches the stand-in backend's session value", () => {
    for (const target of TARGETS) {
      with_tcx(target, [], (tcx) => {
        // `Session::global_backend_features` is what the stand-in backend computed with its copy of this function.
        expect(llvm_util.global_llvm_features(tcx.sess.early_sess, false)).toEqual(tcx.sess.global_backend_features);
        expect(llvm_util.target_cpu(tcx.sess.early_sess)).toBe(target.includes("apple") ? "apple-m1" : "x86-64");
        expect(llvm_util.tune_cpu(tcx.sess)).toBeUndefined();
      });
    }
  });

  test("update_target_reliable_float_cfg (llvm_util.rs:371) on the two targets", () => {
    const got: Record<string, unknown> = {};
    for (const target of TARGETS) {
      with_tcx(target, [], (tcx) => {
        const cfg: TargetConfig = {
          internal_target_features: new Set(),
          has_reliable_f16: true,
          has_reliable_f16_math: true,
          has_reliable_f16b: true,
          has_reliable_f128: true,
          has_reliable_f128_math: true,
        };
        llvm_util.update_target_reliable_float_cfg(tcx.sess.target, cfg);
        const { internal_target_features: _, ...flags } = cfg;
        got[target] = flags;
      });
    }
    expect(got).toEqual({
      "x86_64-unknown-linux-gnu": { has_reliable_f16: true, has_reliable_f16_math: true, has_reliable_f16b: false, has_reliable_f128: true, has_reliable_f128_math: false },
      "aarch64-apple-darwin": { has_reliable_f16: true, has_reliable_f16_math: true, has_reliable_f16b: true, has_reliable_f128: true, has_reliable_f128_math: false },
    });
  });
});

describe("what reaches the IR model's stops stops there, by name", () => {
  const stops = (f: () => unknown, what: RegExp): void => {
    let e: unknown;
    try {
      f();
    } catch (x) {
      e = x;
    }
    expect(e).toBeInstanceOf(Unported);
    expect((e as Unported).what).toMatch(what);
  };
  test("owned_* and archive", () => {
    stops(() => OwnedMCSubtargetInfo.new("t", "c", ""), /^llir: LLVMRustCreateMCSubtargetInfo$/);
    stops(() => new OwnedTargetMachine({} as never).drop(), /^llir: LLVMDisposeTargetMachine$/);
    stops(() => llvm_util.print_passes(), /^llir: LLVMRustPrintPasses$/);
    const ab = LlvmArchiveBuilderBuilder.new_archive_builder(undefined as never);
    expect(ab).toBeDefined();
  });
  // Lane llir-tools: LLVMRustOptimize runs the pinned opt (src/rust_ts/llvm/tools.ts), so llvm_optimize now rewrites the module.
  // A target machine with the recorded x86_64 arguments (a view of the fields tools.ts reads) and configure_llvm's options.
  const haveTools = (() => {
    try {
      pinned_tool("opt");
      return true;
    } catch {
      return false;
    }
  })();
  test.skipIf(!haveTools && !REQUIRE)("llvm_optimize runs LLVMRustOptimize", () => {
    const tm = new OwnedTargetMachine(tmFromRecorded(readFileSync(join(ORACLE, "x86_64-unknown-linux-gnu.tm"), "utf8").split("\n")[0]!) as never);
    const llmod = new IrModuleClass(new IrContext(), "m");
    llmod.targetTriple = "x86_64-unknown-linux-gnu";
    const module = ModuleCodegen.new_regular("m", { llmod: () => llmod, llcx: llmod.context, tm } as never);
    const config = {
      autodiff: [],
      autodiff_post_passes: undefined,
      merge_functions: false,
      vectorize_slp: false,
      vectorize_loop: false,
      no_prepopulate_passes: false,
      verify_llvm_ir: false,
      lint_llvm_ir: false,
      no_builtins: false,
      emit_lifetime_markers: true,
      debug_info_for_profiling: false,
      pgo_gen: { $: "Disabled" },
      pgo_use: undefined,
      pgo_sample_use: undefined,
      instrument_coverage: false,
      sanitizer: 0,
      sanitizer_recover: 0,
      sanitizer_dataflow_abilist: [],
      sanitizer_memory_track_origins: 0,
      offload: [],
      passes: [],
      llvm_plugins: [],
    } as unknown as ModuleConfig;
    const cgcx = { target_is_like_gpu: false, use_linker_plugin_lto: false } as unknown as CodegenContext;
    const prof = { profiler: undefined } as never;
    with_cl_args(CL_ARGS, () => write.llvm_optimize(cgcx, prof, undefined as never, module, undefined, undefined, config, "No", "PreLinkNoLTO", "PostAD"));
    expect(is_tool_text(llmod)).toBe(true);
    // A ThinLTO buffer (embedded bitcode) is not written by one opt run: a stop, by name.
    stops(() => with_cl_args(CL_ARGS, () => write.llvm_optimize(cgcx, prof, undefined as never, module, { value: undefined }, undefined, config, "No", "PreLinkNoLTO", "PostAD")), /^llir: LLVMRustOptimize's ThinLTO buffer/);
  });
});
