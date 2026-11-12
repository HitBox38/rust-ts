// Tests of lane cg-context (context.rs, common.rs) against oracle facts.
//
// 1. `create_module` + `CodegenCx::new` for an empty `#![no_core]` lib (context_oracle/empty.rs) on x86_64-unknown-linux-gnu and
//    on the host (aarch64-apple-darwin), run on a real `TyCtxt` from the port's front end:
//    - **the C API call order**: every call the port makes through ffi.ts, in recorder form, against what the pinned rustc
//      makes for the same compile, recorded with src/rust_ts/llvm/record.ts (context_oracle/<target>.script: the building
//      thread from `LLVMContextCreate` on; for an empty crate that is `ModuleLlvm::new`'s context, `create_module` and
//      `CodegenCx::new`, nothing else). The wrappers rustc calls are invisible to the recorder, which writes their effects as
//      `?datalayout` / `?triple` / `?flag` lines; the port's wrapper calls are written the same way here, from the model's state
//      after the call.
//    - **the module**: the model's printed module against the oracle's `--emit=llvm-ir -Cno-prepopulate-passes` text for the
//      same crate (context_oracle/<target>.ll), byte for byte: data layout, triple, module flags and `llvm.ident`.
//    With the pinned toolchain present, both fixtures are re-made from the oracle and must be unchanged.
//
//    `create_module` calls functions of other fill lanes and crates that are typed stubs today. They are replaced here, for
//    the duration of the test, by **test doubles that are line-by-line copies of the upstream bodies** (cited below), so what is
//    tested is this lane's code; each double is listed in docs/handoff/cg-context.md:
//    `llvm_util::get_version` (cg-write), `back::write::{create_informational_target_machine, to_llvm_code_model}` (cg-write),
//    `ModuleLlvm::new`'s `back::write::create_target_machine` (cg-write), `attributes::frame_pointer` (cg-types-attrs),
//    `Session::{needs_plt, must_emit_unwind_tables, branch_protection}` (rustc_session), and the IR model's two stubs
//    `LLVMRustSetDataLayoutFromTargetMachine` (its effect: the target machine's data layout, the `?datalayout` the oracle shows)
//    and `LLVMDisposeTargetMachine` (a no-op on the double's target machine).
// 2. The pure helpers of context.rs and common.rs on the IR model, printed: metadata, constants, symbol names.
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, UPSTREAM } from "../../scripts/lib/common.ts";
import "../rustc_session/lib.ts";
import type { Crate } from "../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import "../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../rustc_interface/passes.ts";
import "../rustc_middle/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Session } from "../rustc_session/session.ts";
import { FramePointer } from "../rustc_target/spec/mod.ts";
import * as ffi from "../rust_ts/llvm/ffi.ts";
import { ConstantInt, MDNode, MDString, type Module as IrModule, ValueAsMetadata } from "../rust_ts/llvm/ir.ts";
import { printModule, printValueToString } from "../rust_ts/llvm/printer.ts";
import { Size } from "../rustc_abi/lib.ts";
import "./lib.ts";
import * as attributes from "./attributes.ts";
import { ModuleLlvm } from "./back/llvm_backend.ts";
import { OwnedTargetMachine } from "./back/owned_target_machine.ts";
import * as back_write from "./back/write.ts";
import * as common from "./common.ts";
import { CodegenCx, FullCx, SCx, SimpleCx } from "./context.ts";
import type * as llvm from "./llvm/mod.ts";
import * as llvm_util from "./llvm_util.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ORACLE = join(import.meta.dir, "context_oracle");
const TARGETS = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"] as const;
const SYSROOT = (() => {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } });
    return r.exitCode === 0 ? r.stdout.toString().trim() : "";
  } catch {
    return "";
  }
})();
const HAVE = SYSROOT !== "" && process.platform === "darwin" && process.arch === "arm64" && existsSync(UPSTREAM);
const WORK = join(DATA, "tmp", "cg-context-test", `${process.env.RUST_TS_AGENT ?? "default"}-${process.pid}`);
afterAll(() => rmSync(WORK, { recursive: true, force: true }));

// ---- the port's front end, for a real TyCtxt ----
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

/** Runs `f` with the `TyCtxt` of `context_oracle/empty.rs` compiled as the oracle fixtures were. */
function with_tcx<R>(target: string, f: (tcx: TyCtxt) => R): R {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, "empty.rs");
  writeFileSync(file, readFileSync(join(ORACLE, "empty.rs")));
  let out: R | undefined;
  run_compiler(config_from_args(["--crate-type", "lib", "--target", target, "--emit=llvm-ir", "-Cno-prepopulate-passes", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      out = f(tcx);
    });
  });
  return out as R;
}

// ---- test doubles: copies of the upstream bodies (header) ----
/** The target machine the doubles hand out: opaque to the port, which only passes it back. */
function fake_tm(data_layout: string): OwnedTargetMachine {
  const tm = { data_layout } as unknown as llvm.TargetMachine;
  return new OwnedTargetMachine(tm);
}

function install_doubles(oracle_data_layout: string): () => void {
  const spies: { mockRestore(): void }[] = [];
  // llvm_util.rs:469 get_version
  spies.push(
    spyOn(llvm_util, "get_version").mockImplementation(() => {
      const llvm_major = { value: 0 };
      const llvm_minor = { value: 0 };
      const llvm_patch = { value: 0 };
      ffi.LLVMGetVersion(llvm_major, llvm_minor, llvm_patch);
      return [llvm_major.value, llvm_minor.value, llvm_patch.value];
    }),
  );
  // back/write.rs:100 create_informational_target_machine, back/write.rs create_target_machine: LLVMRustCreateTargetMachine is
  // a hidden wrapper (the recorder sees no call); the double's machine carries the oracle's data layout for it.
  spies.push(spyOn(back_write, "create_informational_target_machine").mockImplementation(() => fake_tm(oracle_data_layout)));
  spies.push(spyOn(back_write, "create_target_machine").mockImplementation(() => fake_tm(oracle_data_layout)));
  // back/write.rs:160 to_llvm_code_model
  spies.push(
    spyOn(back_write, "to_llvm_code_model").mockImplementation((code_model) => {
      switch (code_model) {
        case "Tiny":
          return "Tiny";
        case "Small":
          return "Small";
        case "Kernel":
          return "Kernel";
        case "Medium":
          return "Medium";
        case "Large":
          return "Large";
        case undefined:
          return "None";
      }
    }),
  );
  // owned_target_machine.rs `impl Drop for OwnedTargetMachine`: `llvm::LLVMDisposeTargetMachine(self.tm_unique.as_mut())`.
  spies.push(
    spyOn(OwnedTargetMachine.prototype, "drop").mockImplementation(function (this: OwnedTargetMachine) {
      ffi.LLVMDisposeTargetMachine(this.tm_unique);
    }),
  );
  // attributes.rs:217 frame_pointer
  spies.push(
    spyOn(attributes, "frame_pointer").mockImplementation((sess: Session) => {
      const fp = { value: sess.target.frame_pointer };
      const opts = sess.opts;
      // "mcount" function relies on stack pointer.
      // See <https://sourceware.org/binutils/docs/gprof/Implementation.html>.
      if (opts.unstable_opts.instrument_mcount.$ === "Mcount") {
        FramePointer.ratchet(fp, "Always");
      }
      FramePointer.ratchet(fp, opts.cg.force_frame_pointers);
      return fp.value;
    }),
  );
  // rustc_session's `needs_plt`, `must_emit_unwind_tables` and `branch_protection` are the real methods (ssa-mir-rest; root
  // dropped their spies at integ-w54, review cg-context N6).
  return () => {
    for (const s of spies.reverse()) s.mockRestore();
  };
}

// ---- the recorder's view of the port's calls ----
/** A byte string as record.ts prints it. */
function bytes(b: Uint8Array): string {
  let s = '"';
  for (const c of b) s += c >= 0x20 && c < 0x7f && c !== 0x22 && c !== 0x5c ? String.fromCharCode(c) : `\\${c.toString(16).toUpperCase().padStart(2, "0")}`;
  return `${s}"`;
}
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Wraps every function of ffi.ts so that the port's calls come out as record.ts's script lines; returns the lines and a restore. */
function record_port(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const ids = new Map<object, number>();
  const h = (o: object): string => {
    let n = ids.get(o);
    if (n === undefined) ids.set(o, (n = ids.size + 1));
    return `%${n}`;
  };
  const arg = (a: unknown): string => {
    if (a === undefined || a === null) return "null";
    if (typeof a === "string") return bytes(utf8(a));
    if (a instanceof Uint8Array) return bytes(a);
    if (typeof a === "number" || typeof a === "bigint") return String(a);
    if (typeof a === "boolean") return a ? "1" : "0";
    if (Array.isArray(a)) return `[${a.map(arg).join(", ")}]`;
    if (a === ffi.TRUE || a === ffi.FALSE || (typeof a === "object" && a.constructor.name === "Bool")) return String((a as { value: number }).value);
    if (typeof a === "object" && "value" in a && Object.keys(a).length === 1) return `&${String((a as { value: unknown }).value)}`;
    return h(a as object);
  };
  const flagsOf = (m: IrModule): MDNode[] => (m.namedMetadata.get("llvm.module.flags") ?? []) as MDNode[];
  const flagLine = (m: IrModule, node: MDNode): string => {
    const [b, k, v] = node.ops;
    const num = (md: unknown): bigint => ((md as ValueAsMetadata).value as ConstantInt).value;
    const value = v instanceof MDString ? `s ${bytes(utf8(v.str))}` : `i ${num(v)}`;
    return `?flag ${h(m)} ${num(b)} ${bytes(utf8((k as MDString).str))} ${value}`;
  };
  const restores: (() => void)[] = [];
  const ns = ffi as unknown as Record<string, unknown>;
  for (const name of Object.keys(ns)) {
    const orig = ns[name];
    if (typeof orig !== "function" || !/^LLVM/.test(name)) continue;
    const f = orig as (...a: unknown[]) => unknown;
    const spy = spyOn(ns, name as never).mockImplementation(((...a: unknown[]) => {
      // The IR model's stubs that create_module reaches (header).
      if (name === "LLVMRustSetDataLayoutFromTargetMachine") {
        const m = a[0] as IrModule;
        m.dataLayout = (a[1] as unknown as { data_layout: string }).data_layout;
        lines.push(`?datalayout ${h(m)} ${bytes(utf8(m.dataLayout))}`);
        return undefined;
      }
      if (name === "LLVMDisposeTargetMachine") {
        lines.push(`LLVMDisposeTargetMachine(${arg(a[0])})`);
        return undefined;
      }
      const m = a[0] instanceof Object && (a[0] as object).constructor.name === "Module" ? (a[0] as IrModule) : undefined;
      const before = m === undefined ? 0 : flagsOf(m).length;
      const r = f(...a);
      if (/^LLVMRust/.test(name)) {
        // A wrapper: the recorder writes its effect, not the call.
        if (name === "LLVMRustSetNormalizedTarget") lines.push(`?triple ${h(m!)} ${bytes(utf8(m!.targetTriple))}`);
        else if (m !== undefined) for (const node of flagsOf(m).slice(before)) lines.push(flagLine(m, node));
        return r;
      }
      const call = `${name}(${a.map(arg).join(", ")})`;
      if (typeof r === "string") lines.push(`${call} -> ${bytes(utf8(r))}`);
      else if (r === undefined) lines.push(call);
      else lines.push(`${arg(r)} = ${call}`);
      return r;
    }) as never);
    restores.push(() => spy.mockRestore());
  }
  return { lines, restore: () => restores.forEach((r) => r()) };
}

/** The oracle's building-thread lines (context_oracle/<target>.script), without the thread column. */
function oracle_lines(target: string): string[] {
  return readFileSync(join(ORACLE, `${target}.script`), "latin1")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => l.slice(l.indexOf("\t") + 1));
}

/** The module name the oracle used (`; ModuleID = '...'`). */
function oracle_module_name(target: string): string {
  const m = /^; ModuleID = '([^']*)'/.exec(readFileSync(join(ORACLE, `${target}.ll`), "utf8"));
  if (m === null) throw new Error("ERROR: no ModuleID in the fixture");
  return m[1]!;
}

describe("create_module + CodegenCx::new against the oracle (empty no_core lib)", () => {
  for (const target of TARGETS) {
    test(`${target}: the C API calls, in the oracle's order, and the printed module`, () => {
      const want = oracle_lines(target);
      const dl = /^\?datalayout %\d+ "(.*)"$/.exec(want.find((l) => l.startsWith("?datalayout"))!)![1]!;
      const restore_doubles = install_doubles(dl);
      const rec = record_port();
      let printed = "";
      try {
        with_tcx(target, (tcx) => {
          const mod_name = oracle_module_name(target);
          const llvm_module = ModuleLlvm.new(tcx, mod_name);
          // The CGU is only read under `-Cdebuginfo` (`build_compile_unit_di_node`), which this compile does not use.
          const cx = CodegenCx.new(tcx, undefined as never, llvm_module, false);
          expect(cx.llmod()).toBe(llvm_module.llmod());
          expect(cx.use_dll_storage_attrs).toBe(false);
          expect(cx.tls_model).toBe("GeneralDynamic");
          expect(cx.dbg_cx).toBeUndefined();
          printed = printModule(llvm_module.llmod() as unknown as IrModule);
        });
      } finally {
        rec.restore();
        restore_doubles();
      }
      expect(rec.lines).toEqual(want);
      expect(printed).toBe(readFileSync(join(ORACLE, `${target}.ll`), "utf8"));
    });
  }
});

describe.skipIf(!HAVE && !REQUIRE)("the oracle fixtures are current", () => {
  for (const target of TARGETS) {
    test(target, async () => {
      mkdirSync(WORK, { recursive: true });
      writeFileSync(join(WORK, "empty.rs"), readFileSync(join(ORACLE, "empty.rs")));
      const argv = ["--crate-type", "lib", "--target", target, "--emit=llvm-ir", "-Cno-prepopulate-passes", "empty.rs", "-o", `${target}.ll`];
      const plain = Bun.spawnSync([join(SYSROOT, "bin", "rustc"), ...argv], { cwd: WORK, env: { ...process.env, RUSTC_ICE: "0" } });
      expect(plain.exitCode).toBe(0);
      expect(readFileSync(join(WORK, `${target}.ll`), "utf8")).toBe(readFileSync(join(ORACLE, `${target}.ll`), "utf8"));
      const { record, recorderDylib } = await import("../rust_ts/llvm/record.ts");
      const script = join(WORK, `${target}.script`);
      expect(record(SYSROOT, recorderDylib(SYSROOT, DATA, UPSTREAM), script, argv.slice(0, -1).concat(`${target}.rec.ll`), WORK)).toBe(0);
      const building = readFileSync(script, "latin1")
        .split("\n")
        .filter((l) => l.startsWith("1\t"));
      const from = building.findIndex((l) => l.includes("LLVMContextCreate"));
      expect(building.slice(from).map((l) => `${l}\n`).join("")).toBe(readFileSync(join(ORACLE, `${target}.script`), "latin1"));
    });
  }
});

// ---- 2. pure helpers ----
/** A `CodegenCx` over a real model context and module; its other `FullCx` fields are markers no helper below reads. */
function model_cx(): CodegenCx {
  const llcx = ffi.LLVMContextCreate();
  const llmod = ffi.LLVMModuleCreateWithNameInContext("m", llcx);
  const scx = SimpleCx.new(llmod, llcx, Size.from_bytes(8));
  const args: unknown[] = Array.from({ length: 31 }, () => undefined);
  args[2] = scx;
  const full = new (FullCx as unknown as new (...a: unknown[]) => FullCx)(...args);
  full.local_gen_sym_counter = 0;
  full.global_gen_sym_counter = 0;
  return new CodegenCx(full);
}

describe("context.rs helpers", () => {
  test("SimpleCx::new: isize is the pointer-sized integer type; the SCx is reached through Borrow", () => {
    const cx = model_cx();
    expect(printValueToString(cx.get_const_int(cx.isize_ty(), 5n) as never)).toBe("i64 5");
    expect(cx._0.scx._0).toBeInstanceOf(SCx);
  });

  test("named metadata, MD strings and metadata kinds", () => {
    const cx = model_cx();
    const md = cx.create_metadata(utf8("hello"));
    cx.module_add_named_metadata_node(cx.llmod(), "llvm.ident", [md]);
    expect(printModule(cx.llmod() as unknown as IrModule)).toContain('!llvm.ident = !{!0}\n\n!0 = !{!"hello"}\n');
    // FixedMetadataKinds.def: `MD_dbg` is 0, `MD_range` 4, `MD_nonnull` 11.
    expect([cx.get_md_kind_id("dbg"), cx.get_md_kind_id("range"), cx.get_md_kind_id("nonnull")] as number[]).toEqual([0, 4, 11]);
  });

  test("generate_local_symbol_name: `<prefix>.<counter in base 62>`", () => {
    const cx = model_cx();
    const names: string[] = [];
    for (let i = 0; i < 64; i++) names.push(cx.generate_local_symbol_name("str"));
    expect(names.slice(0, 3)).toEqual(["str.0", "str.1", "str.2"]);
    // base_n.rs: digits `0-9a-zA-Z` for ALPHANUMERIC_ONLY (62).
    expect([names[10], names[35], names[36], names[61], names[62], names[63]]).toEqual(["str.a", "str.z", "str.A", "str.Z", "str.10", "str.11"]);
  });

  test("get_functions stops at the enzyme_ffi.rs function the contract lacks", () => {
    expect(() => model_cx().get_functions()).toThrow(/llir: LLVMGetFirstFunction/);
  });

  test("intrinsic_call_expects_place_always: black_box only", () => {
    const cx = model_cx();
    const { sym } = require("../rustc_span/symbol.ts") as typeof import("../rustc_span/symbol.ts");
    expect(cx.intrinsic_call_expects_place_always(sym.black_box)).toBe(true);
    expect(cx.intrinsic_call_expects_place_always(sym.transmute)).toBe(false);
  });
});

describe("common.rs helpers", () => {
  test("constants print as LLVM prints them", () => {
    const cx = model_cx();
    const i64 = cx.isize_ty();
    const p = (v: unknown): string => printValueToString(v as never);
    expect(p(cx.const_int(i64, -1n))).toBe("i64 -1");
    expect(p(cx.const_uint(i64, 18446744073709551615n))).toBe("i64 -1");
    expect(p(cx.const_bytes(utf8("ab")))).toBe('[2 x i8] c"ab"');
    expect(p(cx.null_terminate_const_bytes(utf8("ab")))).toBe('[3 x i8] c"ab\\00"');
    expect(p(cx.const_struct([cx.const_int(i64, 1n)], false))).toBe("{ i64 } { i64 1 }");
    expect(p(cx.const_struct_inherent([cx.const_int(i64, 1n)], true))).toBe("<{ i64 }> <{ i64 1 }>");
    expect(p(cx.const_array(i64, [cx.const_int(i64, 1n), cx.const_int(i64, 2n)]))).toBe("[2 x i64] [i64 1, i64 2]");
    expect(p(cx.const_get_elt(cx.const_array(i64, [cx.const_int(i64, 1n), cx.const_int(i64, 2n)]), 1))).toBe("i64 2");
    expect(p(cx.const_null(i64))).toBe("i64 0");
    expect(p(cx.const_undef(i64))).toBe("i64 undef");
    expect(p(cx.const_poison(i64))).toBe("i64 poison");
    expect(common.val_ty(cx.const_int(i64, 1n))).toBe(i64);
  });

  test("const_to_opt_uint / const_to_opt_u128 read integer constants back; other values give None", () => {
    const cx = model_cx();
    const i64 = cx.isize_ty();
    expect(cx.const_to_opt_uint(cx.const_int(i64, 7n))).toBe(7n);
    expect(cx.const_to_opt_u128(cx.const_int(i64, -1n), true)).toBe((1n << 128n) - 1n);
    expect(cx.const_to_opt_u128(cx.const_int(i64, -1n), false)).toBe((1n << 64n) - 1n);
    expect(cx.const_to_opt_uint(cx.const_undef(i64))).toBeUndefined();
  });

  test("const_uint_big splits a u128 into two words", () => {
    const cx = model_cx();
    const i128 = ffi.LLVMIntTypeInContext(cx.llcx(), 128);
    const v = (1n << 100n) + 3n;
    expect(printValueToString(cx.const_uint_big(i128, v) as never)).toBe(`i128 ${v}`);
  });
});
