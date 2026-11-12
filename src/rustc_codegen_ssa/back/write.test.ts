// Tests of lane ssa-write: back/write.rs (`ModuleConfig::new`, `compute_per_cgu_lto_type`, the coordinator's schedule over
// a mock backend, `produce_final_output_artifacts`) and rustc_session's `OutputFilenames::temp_path_*_for_cgu` /
// `split_dwarf_path`.
//
// Where the expected values come from:
// - `ModuleConfig::new`, `compute_per_cgu_lto_type`: read off back/write.rs:117-282 and :792-817 at the pin (each case
//   names the rule). The sessions are real ones, built from the flags by the port's driver (as
//   rustc_session/session_codegen.test.ts does).
// - The coordinator: derived by hand from `start_executing_work`'s loop (back/write.rs:1203) and base.rs:716's calls, for
//   the port's case: no token beyond the implicit one (the jobserver helper never delivers one). The derivation is next
//   to the test.
// - `temp_path_*_for_cgu`: the oracle's `-Csave-temps` file names (write_oracle/oracle.json; `REGEN=1 bun test <this file>`
//   rewrites it), from a compile with relative paths (`cgus.rs`, `--out-dir out`) in a scratch directory. The CGU names
//   come from the same run's `-Zprint-mono-items`, not from the file names.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";
import { oracleSysroot } from "../../../scripts/lib/oracle.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { build_output_filenames } from "../../rustc_interface/util.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { OutputFilenames } from "../../rustc_session/config.ts";
import type { Session } from "../../rustc_session/session.ts";
import type { CrateType } from "../../rustc_structures/crate_type.ts";
import { Panic } from "../../std/panic.ts";
import { CURRENT_THREAD } from "../../std/panicking.ts";
import { type CompiledModule, type CrateInfo, ModuleCodegen } from "../lib.ts";
import type { WriteBackendMethods, WriteBackendTypes } from "../traits/write.ts";
import {
  type CodegenContext,
  compute_per_cgu_lto_type,
  type EmitObj,
  type ModuleConfig,
  ModuleConfig as ModuleConfigC,
  start_async_codegen,
  submit_codegened_module_to_llvm,
  TargetMachineFactoryConfig,
  __test,
} from "./write.ts";

const REGEN = process.env.REGEN === "1";
const WORK = join(DATA, "tmp", "ssa-write", process.env.RUST_TS_AGENT ?? "default");
const ORACLE_DIR = join(import.meta.dir, "write_oracle");

// ---- sessions ----------------------------------------------------------------------------------------------------------

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

/** Builds the session for `args` (the input file is `cgus.rs`, relative) and returns `f(sess)`. */
function with_sess<R>(args: string[], f: (sess: Session) => R): R {
  let out: { r: R } | undefined;
  run_compiler(config_from_args(["--sysroot", oracleSysroot(), ...args, "cgus.rs"]), (compiler) => {
    out = { r: f(compiler.sess) };
  });
  if (out === undefined) throw new Error("ERROR: run_compiler did not run the callback");
  return out.r;
}

/** The parts of `TyCtxt` back/write.rs reads (`tcx.sess`, `crate_types`, `backend_optimization_level`, ...). */
function mock_tcx(sess: Session, crate_types: CrateType[], outputs: OutputFilenames | undefined = undefined): TyCtxt {
  return {
    sess,
    crate_types: () => crate_types,
    // The provider (base.rs `provide`) is `sess.opts.optimize` when no crate asks for less; these crates have none.
    backend_optimization_level: () => sess.opts.optimize,
    output_filenames: () => outputs,
    gcx: { incr_comp_session: undefined },
    data_layout: () => ({ pointer_size: () => "ptr-size" }),
    dcx: () => sess.dcx(),
  } as unknown as TyCtxt;
}

const X86 = ["--target", "x86_64-unknown-linux-gnu"];

// ---- ModuleConfig::new ---------------------------------------------------------------------------------------------------

function show_obj(o: EmitObj): string {
  return o.$ === "ObjectCode" ? `ObjectCode(${o._0})` : o.$;
}
function summary(c: ModuleConfig): Record<string, unknown> {
  return {
    opt_level: c.opt_level ?? null,
    emit_obj: show_obj(c.emit_obj),
    emit_bc: c.emit_bc,
    emit_pre_lto_bc: c.emit_pre_lto_bc,
    emit_ir: c.emit_ir,
    emit_asm: c.emit_asm,
    vectorize_loop: c.vectorize_loop,
    vectorize_slp: c.vectorize_slp,
    merge_functions: c.merge_functions,
    passes: c.passes,
    no_builtins: c.no_builtins,
    bitcode_needed: c.bitcode_needed(),
    embed_bitcode: c.embed_bitcode(),
  };
}
function module_configs(args: string[], crate_types: CrateType[], no_builtins = false): { regular: Record<string, unknown>; allocator: Record<string, unknown> } {
  return with_sess([...X86, ...args], (sess) => {
    const tcx = mock_tcx(sess, crate_types);
    return {
      regular: summary(ModuleConfigC.new("Regular", tcx, no_builtins)),
      allocator: summary(ModuleConfigC.new("Allocator", tcx, no_builtins)),
    };
  });
}

/** What every case starts from: `-Copt-level=0`, `--emit=link`, a `bin`. */
const BASE = {
  opt_level: "No",
  emit_obj: "ObjectCode(None)",
  emit_bc: false,
  emit_pre_lto_bc: false,
  emit_ir: false,
  emit_asm: false,
  vectorize_loop: false,
  vectorize_slp: false,
  merge_functions: false,
  passes: [],
  no_builtins: false,
  bitcode_needed: false,
  embed_bitcode: false,
};
/** The allocator module never optimizes (`opt_level: if_regular!(Some(..), None)`) and gets no `-C passes`. */
const ALLOC = { ...BASE, opt_level: null };

describe("ModuleConfig::new (back/write.rs:117)", () => {
  test("default: --emit=link emits an object for both kinds (`should_emit_obj` is true for Exe), no bitcode section in a bin", () => {
    expect(module_configs([], ["Executable"])).toEqual({ regular: BASE, allocator: ALLOC });
  });

  test("opt levels: loop vectorization at O2/O3, SLP at O3, MergeFunctions at O2/O3/s/z (the target's default is Aliases)", () => {
    const cases: [string, Record<string, unknown>][] = [
      ["1", { opt_level: "Less" }],
      ["2", { opt_level: "More", vectorize_loop: true, merge_functions: true }],
      ["3", { opt_level: "Aggressive", vectorize_loop: true, vectorize_slp: true, merge_functions: true }],
      ["s", { opt_level: "Size", merge_functions: true }],
      ["z", { opt_level: "SizeMin", merge_functions: true }],
    ];
    for (const [lvl, d] of cases) {
      const r = module_configs([`-Copt-level=${lvl}`], ["Executable"]);
      expect(r.regular).toEqual({ ...BASE, ...d });
      // `vectorize_*` and `merge_functions` are not `if_regular!`: the allocator module gets them too.
      const { opt_level: _, ...rest } = d;
      expect(r.allocator).toEqual({ ...ALLOC, ...rest });
    }
  });

  test("-Cno-vectorize-loops / -Cno-vectorize-slp / -Zmerge-functions=disabled turn the O3 flags off", () => {
    const r = module_configs(["-Copt-level=3", "-Cno-vectorize-loops", "-Cno-vectorize-slp", "-Zmerge-functions=disabled"], ["Executable"]);
    expect(r.regular).toEqual({ ...BASE, opt_level: "Aggressive" });
  });

  test("--emit=obj: only the regular module emits an object (Allocator: `should_emit_obj` false without Exe)", () => {
    const r = module_configs(["--emit=obj"], ["Executable"]);
    expect(r.regular).toEqual(BASE);
    expect(r.allocator).toEqual({ ...ALLOC, emit_obj: "None" });
  });

  test("--emit=llvm-ir,asm,llvm-bc: emit_ir / emit_asm / emit_bc for the regular module only, no object", () => {
    const r = module_configs(["--emit=llvm-ir,asm,llvm-bc"], ["Executable"]);
    expect(r.regular).toEqual({ ...BASE, emit_obj: "None", emit_ir: true, emit_asm: true, emit_bc: true, bitcode_needed: true });
    expect(r.allocator).toEqual({ ...ALLOC, emit_obj: "None" });
  });

  test("-Csave-temps: emit_bc for both kinds, emit_pre_lto_bc for the regular one", () => {
    const r = module_configs(["-Csave-temps"], ["Executable"]);
    expect(r.regular).toEqual({ ...BASE, emit_bc: true, emit_pre_lto_bc: true, bitcode_needed: true });
    expect(r.allocator).toEqual({ ...ALLOC, emit_bc: true, bitcode_needed: true });
  });

  test("an rlib linked (--emit=link) embeds bitcode (`need_bitcode_in_object`, -Cembed-bitcode defaults to yes); =no does not", () => {
    const full = { emit_obj: "ObjectCode(Full)", bitcode_needed: true, embed_bitcode: true };
    const r = module_configs(["--crate-type=rlib"], ["Rlib"]);
    expect(r.regular).toEqual({ ...BASE, ...full });
    expect(r.allocator).toEqual({ ...ALLOC, ...full });
    expect(module_configs(["--crate-type=rlib", "-Cembed-bitcode=no"], ["Rlib"]).regular).toEqual(BASE);
    // --emit=obj: no Exe, so no bitcode section.
    expect(module_configs(["--crate-type=rlib", "--emit=obj"], ["Rlib"]).regular).toEqual(BASE);
  });

  test("-Clinker-plugin-lto: the object is bitcode, unless the crate is #![no_builtins] (no CFI)", () => {
    const r = module_configs(["-Clinker-plugin-lto"], ["Executable"]);
    expect(r.regular).toEqual({ ...BASE, emit_obj: "Bitcode", bitcode_needed: true });
    const nb = module_configs(["-Clinker-plugin-lto"], ["Executable"], true);
    expect(nb.regular).toEqual({ ...BASE, no_builtins: true });
  });

  test("-Cpasses reaches the regular module only", () => {
    const r = module_configs(["-Cpasses=foo bar"], ["Executable"]);
    expect(r.regular).toEqual({ ...BASE, passes: ["foo", "bar"] });
    expect(r.allocator).toEqual(ALLOC);
  });
});

// ---- compute_per_cgu_lto_type ------------------------------------------------------------------------------------------

test("compute_per_cgu_lto_type (back/write.rs:792): every Lto x linker-does-LTO x rlib-only", () => {
  const got: string[] = [];
  for (const lto of ["No", "Thin", "ThinLocal", "Fat"] as const) {
    for (const linker of [false, true]) {
      for (const types of [["Rlib"], ["Executable"], ["Rlib", "Executable"]] as CrateType[][]) {
        got.push(`${lto} ${linker} ${types.join("+")} -> ${compute_per_cgu_lto_type(lto, linker, types)}`);
      }
    }
  }
  // The match arms: `ThinLocal if !linker_does_lto => Thin`, `Thin if !linker_does_lto && !is_rlib => Thin`,
  // `Fat if !is_rlib => Fat`, `_ => No`, where `is_rlib` is `matches!(crate_types, [CrateType::Rlib])`.
  expect(got).toEqual([
    "No false Rlib -> No",
    "No false Executable -> No",
    "No false Rlib+Executable -> No",
    "No true Rlib -> No",
    "No true Executable -> No",
    "No true Rlib+Executable -> No",
    "Thin false Rlib -> No",
    "Thin false Executable -> Thin",
    "Thin false Rlib+Executable -> Thin",
    "Thin true Rlib -> No",
    "Thin true Executable -> No",
    "Thin true Rlib+Executable -> No",
    "ThinLocal false Rlib -> Thin",
    "ThinLocal false Executable -> Thin",
    "ThinLocal false Rlib+Executable -> Thin",
    "ThinLocal true Rlib -> No",
    "ThinLocal true Executable -> No",
    "ThinLocal true Rlib+Executable -> No",
    "Fat false Rlib -> No",
    "Fat false Executable -> Fat",
    "Fat false Rlib+Executable -> Fat",
    "Fat true Rlib -> No",
    "Fat true Executable -> Fat",
    "Fat true Rlib+Executable -> Fat",
  ]);
});

test("binary_search_by_key insertion index (core slice/mod.rs:2982): sorted insert, equal costs land at core's index", () => {
  const v: [string, number][] = [];
  const ins = (s: string, c: number) => v.splice(__test.binary_search_by_cost(v, c), 0, [s, c]);
  for (const [s, c] of [["a", 5], ["b", 1], ["c", 9], ["d", 5], ["e", 5], ["f", 0]] as const) ins(s, c);
  expect(v.map((x) => x[1])).toEqual([0, 1, 5, 5, 5, 9]);
  // Equal costs: core returns the `base` its halving loop ends on, which for [1,5,9] and 5 is 1 (insert before "a"), for
  // [0,1,5,5,9] and 5 it is 2 or 3: the loop goes size 5 -> mid 2 (5, not Greater: base 2) -> size 3 -> mid 3 (5: base 3) ->
  // size 2 -> mid 4 (9, Greater: base 3) -> size 1; v[3] == 5 -> Ok(3).
  expect(v.map((x) => x[0])).toEqual(["f", "b", "d", "e", "a", "c"]);
});

test("desc: thread names (back/write.rs:704 / :735)", () => {
  expect(__test.desc_not_windows("opt", "optimize module", "regex.f10ba03eb5ec7975-cgu.0")).toBe("opt cgu.0");
  expect(__test.desc_not_windows("lto", "thin-LTO module", "2i52vvl2hco29us0")).toBe("lto 2i52vvl2hco29us0");
  expect(__test.desc_windows("opt", "optimize module", "regex.f10ba03eb5ec7975-cgu.0")).toBe("optimize module regex.f10ba03eb5ec7975-cgu.0");
});

// ---- the coordinator over a mock backend ---------------------------------------------------------------------------------

interface MockW extends WriteBackendTypes {
  Module: string;
  TargetMachine: string;
  ModuleBuffer: { data(): Uint8Array };
  ThinData: undefined;
}

class MockBackend implements WriteBackendMethods<MockW> {
  constructor(
    readonly log: string[],
    readonly panic_in_optimize: string | undefined = undefined,
    readonly write_files = false,
  ) {}
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
  optimize(_cgcx: CodegenContext, _prof: unknown, _se: unknown, module: ModuleCodegen<string>, config: ModuleConfig): void {
    this.log.push(`backend: optimize(${module.name}, opt_level=${config.opt_level ?? "None"}) on '${CURRENT_THREAD.name}'`);
    if (module.name === this.panic_in_optimize) throw new Panic("mock optimize panicked", false);
  }
  codegen(cgcx: CodegenContext, _prof: unknown, _se: unknown, module: ModuleCodegen<string>, config: ModuleConfig): CompiledModule {
    this.log.push(`backend: codegen(${module.name}) on '${CURRENT_THREAD.name}'`);
    const object = config.emit_obj.$ !== "None" ? cgcx.output_filenames.temp_path_for_cgu("Object", module.name) : undefined;
    if (this.write_files && object !== undefined) writeFileSync(object, `object of ${module.name}`);
    return { name: module.name, kind: module.kind, object, global_asm_object: undefined, dwarf_object: undefined, bytecode: undefined, assembly: undefined, llvm_ir: undefined };
  }
  optimize_and_codegen_fat_lto(): CompiledModule {
    throw new Error("ERROR: unexpected optimize_and_codegen_fat_lto");
  }
  run_thin_lto(): never {
    throw new Error("ERROR: unexpected run_thin_lto");
  }
  optimize_and_codegen_thin(): CompiledModule {
    throw new Error("ERROR: unexpected optimize_and_codegen_thin");
  }
  serialize_module(): never {
    throw new Error("ERROR: unexpected serialize_module");
  }
}

/**
 * base.rs:716 `codegen_crate`'s calls into back/write.rs for `cgus` (all `CguReuse::No`), then rustc_codegen_llvm's
 * `join_codegen` (`OngoingCodegen::join`). Returns the compiled modules' names and objects.
 */
function drive(
  sess: Session,
  tcx: TyCtxt,
  backend: MockBackend,
  cgus: [string, number][],
  with_allocator: boolean,
): { modules: [string, string | undefined][]; allocator: [string, string | undefined] | undefined } {
  const log = backend.log;
  const regular = ModuleConfigC.new("Regular", tcx, false);
  const allocator = ModuleConfigC.new("Allocator", tcx, false);
  const allocator_module = with_allocator ? ModuleCodegen.new_allocator("alloc", "alloc") : undefined;
  log.push("main: start_async_codegen");
  const ongoing = start_async_codegen(backend, tcx, regular, allocator, allocator_module);
  for (const [name, cost] of cgus) {
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
  const [compiled] = ongoing.join(sess, undefined, {} as CrateInfo);
  log.push("main: joined");
  return {
    modules: compiled.modules.map((m) => [m.name, m.object]),
    allocator: compiled.allocator_module === undefined ? undefined : [compiled.allocator_module.name, compiled.allocator_module.object],
  };
}

const CGU0 = "cgus.a762f592f3f797ae-cgu.0";
const CGU1 = "cgus.a762f592f3f797ae-cgu.1";

describe("the coordinator (start_executing_work, back/write.rs:1203) over a mock backend, two CGUs", () => {
  // Derivation (no token beyond the implicit one: `tokens` stays empty, so `extra_tokens` and `additional_running` are 0,
  // `anticipated_running` is 1, and `queue_full_enough(n, 1)` is `n >= 1`, as `quarter_of_workers` is 1 - 0):
  // - the coordinator first optimizes the allocator module (:1600), then, Ongoing + Idle with an empty queue, sends a
  //   `CguMessage` (Codegenning) and blocks in `recv`: the main thread's first wait returns;
  // - main submits CGU A (`CodegenDone`) and waits again. The coordinator queues A and goes Idle; the queue (1) is full
  //   enough, so it lends the implicit token: `spawn_work(A)` = `optimize(A)` then, with `Lto::No` (-O0),
  //   `codegen(A)` (execute_optimize_work_item, :819). Its `WorkItem` message ends Lending; the queue is empty again,
  //   so it sends the next `CguMessage`;
  // - the same for B, answering `codegen_finished`'s wait. Then `CodegenComplete` (Completed, Idle), nothing running and
  //   nothing queued: the loop ends, and with no LTO input the allocator module is codegened (`NoLto`, :1755);
  // - main's `join` waits on the shared emitter, which the coordinator holds: that is where the coordinator runs its last
  //   turn. The modules come back sorted by name (:2160).
  test("the order of optimize / codegen calls, their threads, and the final artifact list", () => {
    const log: string[] = [];
    const r = with_sess([...X86, "-Ccodegen-units=2", "--emit=obj", "--out-dir", "out"], (sess) => {
      const outputs = build_output_filenames([], sess);
      const tcx = mock_tcx(sess, ["Executable"], outputs);
      return drive(sess, tcx, new MockBackend(log), [[CGU1, 7], [CGU0, 3]], true);
    });
    expect(log).toEqual([
      "main: start_async_codegen",
      "backend: target_machine_factory",
      "main: wait_for_signal_to_codegen_item",
      "backend: optimize(alloc, opt_level=None) on 'coordinator'",
      `main: submit ${CGU1}`,
      "main: wait_for_signal_to_codegen_item",
      `backend: optimize(${CGU1}, opt_level=No) on 'opt cgu.1'`,
      `backend: codegen(${CGU1}) on 'opt cgu.1'`,
      `main: submit ${CGU0}`,
      "main: codegen_finished",
      `backend: optimize(${CGU0}, opt_level=No) on 'opt cgu.0'`,
      `backend: codegen(${CGU0}) on 'opt cgu.0'`,
      "main: join",
      "backend: codegen(alloc) on 'coordinator'",
      "main: joined",
    ]);
    // `--emit=obj` and no Exe: the allocator module emits no object (ModuleConfig, Allocator); both CGUs do, at
    // `temp_path_for_cgu(Object, ..)`. Two CGUs: the numbered objects stay (`keep_numbered_objects`).
    expect(r).toEqual({
      modules: [
        [CGU0, `out/cgus.${CGU0}.rcgu.o`],
        [CGU1, `out/cgus.${CGU1}.rcgu.o`],
      ],
      allocator: ["alloc", undefined],
    });
    expect(CURRENT_THREAD.name).toBe("main");
  });

  test("a worker's panic: the coordinator's `bug!(\"worker thread panicked\")`, main's waits fall through, join ICEs", () => {
    const log: string[] = [];
    let thrown: unknown;
    with_sess([...X86, "-Ccodegen-units=2", "--emit=obj", "--out-dir", "out"], (sess) => {
      const tcx = mock_tcx(sess, ["Executable"], build_output_filenames([], sess));
      try {
        drive(sess, tcx, new MockBackend(log, CGU1), [[CGU1, 7], [CGU0, 3]], false);
      } catch (e) {
        thrown = e;
      }
    });
    expect(thrown).toBeInstanceOf(Panic);
    // The coordinator panicked while main waited before B; its senders are gone, so main's later waits return at once
    // (`Err(_)`: "fall through so error handling can be reached") and nothing more runs on the backend.
    expect(log).toEqual([
      "main: start_async_codegen",
      "backend: target_machine_factory",
      "main: wait_for_signal_to_codegen_item",
      `main: submit ${CGU1}`,
      "main: wait_for_signal_to_codegen_item",
      `backend: optimize(${CGU1}, opt_level=No) on 'opt cgu.1'`,
      `main: submit ${CGU0}`,
      "main: codegen_finished",
      "main: join",
    ]);
    expect(CURRENT_THREAD.name).toBe("main");
  });
});

describe("produce_final_output_artifacts (back/write.rs:507), one CGU, --emit=obj", () => {
  test("copies the numbered object to `<crate>.o` and removes the numbered one (no -Csave-temps, one CGU)", () => {
    const dir = join(WORK, `final-${process.pid}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const log: string[] = [];
    const r = with_sess([...X86, "-Ccodegen-units=1", "--emit=obj", "--out-dir", dir], (sess) => {
      const tcx = mock_tcx(sess, ["Executable"], build_output_filenames([], sess));
      return drive(sess, tcx, new MockBackend(log, undefined, true), [[CGU0, 1]], false);
    });
    expect(r.modules).toEqual([[CGU0, join(dir, `cgus.${CGU0}.rcgu.o`)]]);
    // copy_if_one_unit(Object, keep_numbered = true) copies; the cleanup removes it, since `keep_numbered_objects` is
    // `needs_crate_object || (user_wants_objects && codegen_units > 1)`, false here.
    expect(readdirSync(dir).sort()).toEqual(["cgus.o"]);
    expect(readFileSync(join(dir, "cgus.o"), "utf8")).toBe(`object of ${CGU0}`);
    rmSync(dir, { recursive: true, force: true });
  });
});

// ---- OutputFilenames::temp_path_*_for_cgu against the oracle's -Csave-temps names -----------------------------------------

const LONG = "a".repeat(140);
const FILE_CONFIGS = {
  // Two CGUs, every per-CGU output, split DWARF in `.dwo` files next to the objects.
  split: ["--crate-type=lib", "--crate-name=cgus", ...X86, "-Ccodegen-units=2", "-Copt-level=0", "-Csave-temps", "-g", "-Csplit-debuginfo=unpacked", "--emit=obj,llvm-ir,asm,llvm-bc", "--out-dir", "out"],
  // File names over 143 bytes (`maybe_strip_file_name`), `-Cextra-filename`, and `-Zsplit-dwarf-out-dir`
  // (`explicit_dwo_out_directory`; the directory must exist, rustc does not create it).
  long: [
    "--crate-type=lib",
    `--crate-name=${LONG}`,
    ...X86,
    "-Ccodegen-units=2",
    "-Copt-level=0",
    "-Csave-temps",
    "-g",
    "-Csplit-debuginfo=unpacked",
    "-Cextra-filename=-xyz",
    "-Zsplit-dwarf-out-dir=dwo",
    "--emit=obj,llvm-ir,asm,llvm-bc",
    "--out-dir",
    "out",
  ],
} as const;
type FileConfig = keyof typeof FILE_CONFIGS;
interface FileFacts {
  cgus: string[];
  files: string[];
}

function file_facts(name: FileConfig): FileFacts {
  const dir = join(WORK, `oracle-files-${name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "dwo"), { recursive: true });
  writeFileSync(join(dir, "cgus.rs"), readFileSync(join(ORACLE_DIR, "cgus.rs")));
  const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "cgus.rs", ...FILE_CONFIGS[name], "-Zprint-mono-items"], {
    cwd: dir,
    env: { ...process.env, RUSTC_ICE: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) throw new Error(`ERROR: oracle ${name} exit ${r.exitCode}: ${r.stderr.toString()}`);
  const cgus = new Set<string>();
  for (const l of r.stdout.toString().split("\n")) {
    const m = /^MONO_ITEM .* @@ (.*)$/.exec(l);
    if (m !== null) for (const c of m[1]!.split(" ")) cgus.add(c.split("[")[0]!);
  }
  // `rmeta*` are the metadata temp directories rustc leaves under the out dir.
  const files = ["out", "dwo"].flatMap((d) => readdirSync(join(dir, d)).filter((f) => !f.startsWith("rmeta")).map((f) => `${d}/${f}`));
  rmSync(dir, { recursive: true, force: true });
  return { cgus: [...cgus].sort(), files: files.sort() };
}

if (REGEN) {
  mkdirSync(WORK, { recursive: true });
  const facts = { split: file_facts("split"), long: file_facts("long") };
  writeFileSync(join(ORACLE_DIR, "oracle.json"), `${JSON.stringify(facts, null, 1)}\n`);
}
const FILES = existsSync(join(ORACLE_DIR, "oracle.json")) ? (JSON.parse(readFileSync(join(ORACLE_DIR, "oracle.json"), "utf8")) as Record<FileConfig, FileFacts>) : undefined;

describe("OutputFilenames::temp_path_*_for_cgu (rustc_session config.rs:1315-1395) vs the oracle's -Csave-temps files", () => {
  for (const name of Object.keys(FILE_CONFIGS) as FileConfig[]) {
    test(`${name}: every per-CGU file the oracle wrote, and nothing else`, () => {
      const o = FILES![name];
      expect(o.cgus.length).toBe(2);
      const got = with_sess([...FILE_CONFIGS[name]], (sess) => {
        const outputs = build_output_filenames([], sess);
        const paths: string[] = [];
        for (const cgu of o.cgus) {
          // Written by cg_llvm's write.rs: the object, bitcode, IR and assembly (`temp_path_for_cgu`), the pre-optimization
          // bitcode (`temp_path_ext_for_cgu("no-opt.bc", ..)`), and the split DWARF file (`split_dwarf_path`).
          for (const t of ["Object", "Bitcode", "LlvmAssembly", "Assembly"] as const) paths.push(outputs.temp_path_for_cgu(t, cgu));
          paths.push(outputs.temp_path_ext_for_cgu("no-opt.bc", cgu));
          const dwo = outputs.split_dwarf_path(sess.split_debuginfo(), sess.opts.unstable_opts.split_dwarf_kind, cgu);
          expect(dwo).toBe(outputs.temp_path_dwo_for_cgu(cgu));
          paths.push(dwo!);
          // What `TargetMachineFactoryConfig::new` hands the backend for this CGU.
          const cgcx = { target_can_use_split_dwarf: sess.target_can_use_split_dwarf(), output_filenames: outputs, split_debuginfo: sess.split_debuginfo(), split_dwarf_kind: sess.opts.unstable_opts.split_dwarf_kind } as CodegenContext;
          expect(TargetMachineFactoryConfig.new(cgcx, cgu)).toEqual({ split_dwarf_file: dwo, output_obj_file: outputs.temp_path_for_cgu("Object", cgu) });
        }
        return paths.sort();
      });
      expect(got).toEqual(o.files);
    });
  }

  test("the long names are stripped (the hash prefix of maybe_strip_file_name), and stay at most 143 bytes", () => {
    const names = FILES!.long.files.map((f) => f.split("/")[1]!);
    expect(names.every((n) => /^[0-9a-f]{16}-/.test(n) && n.length <= 143)).toBe(true);
  });
});

