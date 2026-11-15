// Tests of lane cg-di-a's port of debuginfo/{mod,utils,namespace,di_builder,dwarf_const,gdb}.rs and lane cg-di-b's port of the
// rest of debuginfo/ (metadata.rs, metadata/type_map.rs, metadata/enums/{mod,native,cpp_like}.rs) against the pinned rustc's
// IR, through the IR model.
//
// Fixtures: di_oracle/ (README.md): names.rs (lib), gdb.rs (bin) and types.rs (lib, cg-di-b), and the oracle's
// `--emit=llvm-ir -Cno-prepopulate-passes -Ccodegen-units=1` text at `-Copt-level=0`, for x86_64-unknown-linux-gnu (and, for
// types.rs, x86_64-pc-windows-msvc). With the pinned toolchain present they are re-made
// (from inside di_oracle/, into a scratch directory) and must be unchanged; with RUST_TS_REQUIRE_PROBES=1 the toolchain must be
// present.
//
// Each test runs the port's front end on the fixture with the oracle's flags, so the `TyCtxt` is real, then the real backend:
// 1. names.rs, `-Cdebuginfo=0`: `compile_codegen_unit` (rustc_codegen_llvm base.rs) for the crate's one CGU, the whole of
//    rustc_codegen_ssa's `codegen_mir` for each fn included. Every value name the printed module has comes from `set_var_name`
//    (with ssa's `debug_introduce_local`): the module must equal the oracle's, less what the IR normal form renumbers (comment
//    lines, `; preds` tails, metadata numbers and the `!guid` attachments of LLVM's assign-guid pass, plan-m7 §1b), and the
//    module flags must be the oracle's (no debuginfo flags without `-g`). The static (`build_global_var_di_node`) and the
//    vtable (`apply_vcall_visibility_metadata`, `create_vtable_debuginfo`) return early, so they add nothing.
// 2. gdb.rs, `-Cdebuginfo=0`: the same for an executable: the entry wrapper (`insert_reference_to_gdb_debug_scripts_section_global`,
//    which loads nothing without `-g`) and `debuginfo_finalize` (not called without `-g`).
// 3. gdb.rs, `-Cdebuginfo=2` (cg-di-b): `compile_codegen_unit` with the debug context, `build_compile_unit_di_node` and the
//    subprograms, variables and locations of mod.rs: the whole module equals the oracle's, metadata included (`canonical`
//    below: metadata renumbered in order of first use, which is what the parser of the N1 normal form does too).
// 4. gdb.rs, `-Cdebuginfo=2`, the `.debug_gdb_scripts` helpers on a `CodegenCx` whose debug context is a placeholder (below):
//    `needs_gdb_debug_scripts_section`, the global `get_or_insert_gdb_debug_scripts_section_global` defines (and finds again),
//    the entry wrapper's volatile load (ssa base.rs `maybe_create_entry_wrapper`, the real one), against the oracle's text, and
//    `debuginfo_finalize`'s calls.
// 5. Pure helpers against oracle facts: `lookup_debug_loc` against the `-g` IR's `DILocation`s and `DISubprogram` lines,
//    `is_node_local_to_unit` against its `DISPFlagLocalToUnit`, `mangled_name_of_instance` against its `linkageName`.
// 6. types.rs (cg-di-b), the type debuginfo of metadata.rs and metadata/*: structs (field visibility flags, tuple structs,
//    template parameters, a recursive struct), enums (C-like as an enumeration, tagged, niche with an untagged range,
//    single-variant, empty, generic, a 128-bit tag, an expanding recursive type), a union, an extern type, slices, `str`,
//    `&dyn`, raw and fn pointers, arrays, `!`, `()`, the basic types (f16/f128 included), a closure, a static and a vtable.
//    The whole module must equal the oracle's (as 3) at `-Cdebuginfo=2` and `=1` on x86_64-unknown-linux-gnu (the native
//    enum layout, enums/native.rs), and at `-Cdebuginfo=2` on x86_64-pc-windows-msvc (CPP-like: enums/cpp_like.rs, the
//    MSVC basic-type names and typedefs, the f16/f128 structs).
//
// Test doubles (each restored after its test):
// - The MSVC case of 6 only: the IR model's `LLVMRustSetNormalizedTarget` stops on a triple it has not checked to be its own
//   `Triple::normalize` (a model gap, docs/handoff/cg-di-b.md); the double sets the module's triple as given, the oracle's IR
//   shows `x86_64-pc-windows-msvc` is its own normal form.
// - Not copies: `back::write::{create_informational_target_machine, create_target_machine}` return an opaque target machine
//   carrying the oracle's data layout, which the model's stub `LLVMRustSetDataLayoutFromTargetMachine` sets (its effect);
//   `OwnedTargetMachine::drop` is a no-op (intrinsic.test.ts's doubles; `LLVMRustCreateTargetMachine` is llir-tools').
// - Test 4 only: `CodegenUnitDebugContext::new` and `metadata::build_compile_unit_di_node` (written when both reached the
//   model's `LLVMDI*` stubs) are replaced by a placeholder context whose `finalize` records its call. The gdb code reads only
//   `cx.dbg_cx`'s presence (`debuginfo_finalize`) and the session.
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";
import "../../rustc_session/lib.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import "../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import "../../rustc_middle/lib.ts";
import { maybe_create_entry_wrapper } from "../../rustc_codegen_ssa/base.ts";
import type { Body } from "../../rustc_middle/mir/mod.ts";
import type { CodegenUnit, MonoItemPartitions } from "../../rustc_middle/mono.ts";
import type { ModuleItems } from "../../rustc_middle/hir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import { type DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { Span } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import * as ffi from "../../rust_ts/llvm/ffi.ts";
import type { Module as IrModule } from "../../rust_ts/llvm/ir.ts";
import { printModule } from "../../rust_ts/llvm/printer.ts";
import { Unported } from "../../std/panic.ts";
import "../lib.ts";
import { ModuleLlvm } from "../back/llvm_backend.ts";
import { OwnedTargetMachine } from "../back/owned_target_machine.ts";
import * as back_write from "../back/write.ts";
import { compile_codegen_unit } from "../base.ts";
import { Builder, Builder_static } from "../builder.ts";
import type { LlvmTypes } from "../common.ts";
import { CodegenCx } from "../context.ts";
import type * as llvm from "../llvm/mod.ts";
import { get_value_name } from "../llvm/mod.ts";
import * as gdb from "./gdb.ts";
import * as metadata from "./metadata.ts";
import { CodegenUnitDebugContext } from "./mod.ts";
import { mangled_name_of_instance } from "./namespace.ts";
import { is_node_local_to_unit } from "./utils.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ORACLE = join(import.meta.dir, "di_oracle");
const TARGET = "x86_64-unknown-linux-gnu";
const MSVC = "x86_64-pc-windows-msvc";
const COMMON = ["--edition=2021", "-Copt-level=0", "-Cno-prepopulate-passes", "-Ccodegen-units=1", "--emit=llvm-ir"];
const FIXTURES = {
  names: { rs: "names.rs", ll: `${TARGET}.ll`, target: TARGET, args: ["--crate-type", "lib", "-Cdebuginfo=0"] },
  gdb: { rs: "gdb.rs", ll: `${TARGET}.gdb.ll`, target: TARGET, args: ["--crate-type", "bin", "-Cdebuginfo=0"] },
  gdb_g: { rs: "gdb.rs", ll: `${TARGET}.gdb-g.ll`, target: TARGET, args: ["--crate-type", "bin", "-Cdebuginfo=2"] },
  types_g2: { rs: "types.rs", ll: `${TARGET}.types-g2.ll`, target: TARGET, args: ["--crate-type", "lib", "-Cdebuginfo=2"] },
  types_g1: { rs: "types.rs", ll: `${TARGET}.types-g1.ll`, target: TARGET, args: ["--crate-type", "lib", "-Cdebuginfo=1"] },
  types_msvc: { rs: "types.rs", ll: `${MSVC}.types-g2.ll`, target: MSVC, args: ["--crate-type", "lib", "-Cdebuginfo=2"] },
} as const;
type Fixture = (typeof FIXTURES)[keyof typeof FIXTURES];
const oracle = (f: Fixture): string => readFileSync(join(ORACLE, f.ll), "utf8");

const SYSROOT = (() => {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } });
    return r.exitCode === 0 ? r.stdout.toString().trim() : "";
  } catch {
    return "";
  }
})();
const HAVE = SYSROOT !== "";
const WORK = join(DATA, "tmp", "cg-di-a-test", `${process.env.RUST_TS_AGENT ?? "default"}-${process.pid}`);
afterAll(() => rmSync(WORK, { recursive: true, force: true }));

// ---- the port's front end, for a real TyCtxt (as intrinsic.test.ts) ----
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

/** `as_oracle`: compile as the fixture's oracle text was made (README.md): from inside di_oracle/, the file by its bare name,
 *  with `--remap-path-prefix=<di_oracle>=.`, so the debug info's paths are the oracle's (cg-di-b). The process's working
 *  directory is restored after. */
function with_tcx<R>(f: Fixture, body: (tcx: TyCtxt) => R, as_oracle = false): R {
  let out: R | undefined;
  const args = as_oracle
    ? ["--target", f.target, ...COMMON, `--remap-path-prefix=${ORACLE}=.`, ...f.args, f.rs]
    : ["--target", f.target, ...COMMON, ...f.args, join(ORACLE, f.rs)];
  const cwd = process.cwd();
  if (as_oracle) process.chdir(ORACLE);
  try {
    run_compiler(config_from_args(args), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      out = body(tcx);
    });
  });
  } finally {
    if (as_oracle) process.chdir(cwd);
  }
  return out as R;
}

// ---- test doubles (header) ----
function install_doubles(ir: string): () => void {
  const dl = /^target datalayout = "(.*)"$/m.exec(ir)![1]!;
  const spies: { mockRestore(): void }[] = [];
  const fake_tm = (): OwnedTargetMachine => new OwnedTargetMachine({ data_layout: dl } as unknown as llvm.TargetMachine);
  spies.push(spyOn(back_write, "create_informational_target_machine").mockImplementation(fake_tm));
  spies.push(spyOn(back_write, "create_target_machine").mockImplementation(fake_tm));
  spies.push(spyOn(OwnedTargetMachine.prototype, "drop").mockImplementation(() => {}));
  spies.push(
    spyOn(ffi, "LLVMRustSetDataLayoutFromTargetMachine").mockImplementation((m, tm) => {
      (m as unknown as IrModule).dataLayout = (tm as unknown as { data_layout: string }).data_layout;
    }),
  );
  return () => {
    for (const s of spies.reverse()) s.mockRestore();
  };
}

function with_doubles<R>(f: Fixture, body: (tcx: TyCtxt) => R, as_oracle = false): R {
  const restore = install_doubles(oracle(f));
  try {
    return with_tcx(f, body, as_oracle);
  } finally {
    restore();
  }
}

// ---- the IR normal form this test compares (header) ----
/** The module flag nodes, in `!llvm.module.flags` order. */
function module_flags(ir: string): string[] {
  const defs = new Map<string, string>();
  for (const m of ir.matchAll(/^(![0-9]+) = (.*)$/gm)) defs.set(m[1]!, m[2]!);
  const list = /^!llvm\.module\.flags = !\{(.*)\}$/m.exec(ir);
  if (list === null) return [];
  return list[1]!.split(", ").map((r) => defs.get(r) ?? `?${r}`);
}
/** The module text above the named metadata: no comment lines, no `; preds` tails, no `!guid` attachments, metadata numbers
 *  as `!N`. */
function normal(ir: string): string {
  const out: string[] = [];
  for (const l of ir.split("\n")) {
    if (l.startsWith("!")) break;
    if (l.trimStart().startsWith(";")) continue;
    out.push(
      l
        .replace(/\s+; preds = .*$/, "")
        .replace(/,? !guid ![0-9]+/g, "")
        .replace(/![0-9]+/g, "!N"),
    );
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}
/** The body of `@name` (from its first label to the closing brace), without comment lines and `; preds` tails. */
function body(ir: string, name: string): string {
  const lines = ir.split("\n");
  const start = lines.findIndex((l) => l.startsWith("define ") && l.includes(`@${name}(`));
  if (start < 0) throw new Error(`ERROR: no define of @${name}`);
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && lines[i] !== "}"; i++) {
    const l = lines[i]!;
    if (l.trimStart().startsWith(";")) continue;
    out.push(l.replace(/\s+; preds = .*$/, ""));
  }
  return out.join("\n");
}

/** The whole module, metadata included, with numbers that do not depend on the printer (cg-di-b), as the N1 normal form's
 *  parser reads it (scripts/lib/ir-normal.ts):
 *  - no comment lines, no `; preds` tails, no `!guid` attachments (the oracle's assign-guid pass, plan-m7 §1b);
 *  - attribute groups written in place (`#{..}`), so their numbering and the unused ones do not count;
 *  - no intrinsic declarations (`declare .. @llvm.*`): the parser replaces their attributes, and each call names its intrinsic;
 *  - no `@"\01__imp_*"` globals: back/write.rs's `create_msvc_imps` (after codegen, not run by these tests) adds them;
 *  - every `!N` renumbered in order of first use (the text top to bottom, each node's operands depth first, as `opt -S`
 *    numbers a parsed module), nodes nothing uses dropped (the parser drops them), the nodes last, in their new order.
 *  Two modules with equal `canonical` texts are one module, up to those. */
function canonical(ir: string): string {
  const defs = new Map<string, string>();
  const groups = new Map<string, string>();
  for (const l of ir.split("\n")) {
    const g = /^attributes #([0-9]+) = (\{.*\})$/.exec(l);
    if (g !== null) groups.set(g[1]!, g[2]!);
  }
  const rest: string[] = [];
  for (const l of ir.split("\n")) {
    const d = /^!([0-9]+) = (.*)$/.exec(l);
    if (d !== null) {
      defs.set(d[1]!, d[2]!.replace(/,? !guid ![0-9]+/g, ""));
      continue;
    }
    if (l.trimStart().startsWith(";") || l.startsWith("attributes #") || /^declare .*@llvm\./.test(l) || l.startsWith('@"\\01__imp_')) continue;
    rest.push(
      l
        .replace(/\s+; preds = .*$/, "")
        .replace(/,? !guid ![0-9]+/g, "")
        .replace(/ #([0-9]+)\b/g, (_, n: string) => ` #${groups.get(n) ?? `?${n}`}`),
    );
  }
  const num = new Map<string, number>();
  const order: string[] = [];
  const visit = (text: string): void => {
    for (const m of text.matchAll(/!([0-9]+)\b/g)) {
      const n = m[1]!;
      if (num.has(n)) continue;
      num.set(n, order.length);
      order.push(n);
      visit(defs.get(n) ?? "");
    }
  };
  for (const l of rest) visit(l);
  const renum = (text: string): string => text.replace(/!([0-9]+)\b/g, (_, n: string) => `!${num.get(n) ?? `?${n}`}`);
  while (rest.length > 0 && rest[rest.length - 1] === "") rest.pop();
  return [...rest.map(renum), ...order.map((n, i) => `!${i} = ${renum(defs.get(n) ?? `<undefined !${n}>`)}`)].join("\n");
}

/** The port's module for the fixture's one CGU, printed (with the doubles of the header). */
function port_module(f: Fixture): string {
  return with_doubles(
    f,
    (tcx) => {
      const [m] = compile_codegen_unit(tcx, the_cgu(tcx).name(), false);
      return printModule(m.module_llvm.llmod() as unknown as IrModule);
    },
    true,
  );
}

function the_cgu(tcx: TyCtxt): CodegenUnit {
  const parts = tcx.collect_and_partition_mono_items(null) as MonoItemPartitions;
  expect(parts.codegen_units.length).toBe(1);
  return parts.codegen_units[0]!;
}

function items(tcx: TyCtxt): Map<string, DefId> {
  const names = new Map<string, DefId>();
  for (const id of (tcx.hir_crate_items(null) as ModuleItems).owners()) {
    const d = LocalDefId.to_def_id(id.def_id);
    const n = tcx.opt_item_name(d);
    if (n !== undefined) names.set(Symbol.as_str(n), d);
  }
  return names;
}

// ---- the fixtures ----
describe("fixtures", () => {
  test.if(HAVE || REQUIRE)("the oracle re-makes every fixture unchanged", () => {
    expect(HAVE).toBe(true);
    mkdirSync(WORK, { recursive: true });
    for (const f of Object.values(FIXTURES)) {
      const out = join(WORK, f.ll);
      const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--target", f.target, ...COMMON, `--remap-path-prefix=${ORACLE}=.`, ...f.args, "-o", out, f.rs], {
        cwd: ORACLE,
        env: { ...process.env, RUSTUP_AUTO_INSTALL: "0", RUSTC_ICE: "0" },
      });
      expect(r.exitCode, r.stderr.toString()).toBe(0);
      expect(existsSync(out)).toBe(true);
      expect(readFileSync(out, "utf8")).toBe(oracle(f));
    }
  });
  test("no fixture holds an absolute path", () => {
    for (const f of Object.values(FIXTURES)) expect(oracle(f)).not.toContain(ORACLE);
  });
});

// ---- 1, 2: whole modules without -g ----
describe("without -g: the module equals the oracle's", () => {
  for (const f of [FIXTURES.names, FIXTURES.gdb]) {
    test(`${f.rs} (${f.args[1]})`, () => {
      const ir = oracle(f);
      const port = with_doubles(f, (tcx) => {
        const [m] = compile_codegen_unit(tcx, the_cgu(tcx).name(), false);
        return printModule(m.module_llvm.llmod() as unknown as IrModule);
      });
      expect(normal(port)).toBe(normal(ir));
      expect(module_flags(port)).toEqual(module_flags(ir));
      expect(module_flags(port).some((x) => x.includes("Dwarf Version") || x.includes("Debug Info Version"))).toBe(false);
      if (f === FIXTURES.names) {
        // The names `set_var_name` gives (the comparison above covers them; listed so a failure names them).
        for (const s of [
          "i32 %x, i32 %_unused",
          "i32 %p.0, i32 %p.1",
          "ptr align 8 %b",
          "ptr %t.0, ptr align 8 %t.1",
          "i32 %0)",
          "%x = alloca [4 x i8]",
          "%arr = alloca [12 x i8]",
          "%acc = alloca [4 x i8]",
          "%first = load i32",
          "%last = load i32",
          "%_0 = load i32, ptr %self",
        ]) {
          expect(port).toContain(s);
        }
      } else {
        expect(port).not.toContain("__rustc_debug_gdb_scripts_section__");
      }
    });
  }
});

// ---- 3: -Cdebuginfo=2, the whole module (cg-di-b) ----
test("-Cdebuginfo=2: gdb.rs's module, debug info included, equals the oracle's", () => {
  const f = FIXTURES.gdb_g;
  const ir = oracle(f);
  const port = port_module(f);
  expect(canonical(port)).toBe(canonical(ir));
  const flags = module_flags(port);
  expect(flags).toEqual(module_flags(ir));
  expect(flags).toContain('!{i32 7, !"Dwarf Version", i32 4}');
  expect(flags).toContain('!{i32 2, !"Debug Info Version", i32 3}');
  // Not vacuous: the unit, the two subprograms and their argument records are there.
  expect(canonical(ir)).toContain("!DICompileUnit(");
  expect(port.match(/#dbg_declare\(/g)?.length).toBe(4);
});

// ---- 4: -Cdebuginfo=2, the .debug_gdb_scripts helpers ----
test("-Cdebuginfo=2: the .debug_gdb_scripts global, the entry wrapper's load, debuginfo_finalize", () => {
  const f = FIXTURES.gdb_g;
  const ir = oracle(f);
  const mod_name = /^; ModuleID = '([^']*)'/.exec(ir)![1]!;
  const finalized: string[] = [];
  const placeholder = Object.assign(Object.create(CodegenUnitDebugContext.prototype) as CodegenUnitDebugContext, {
    finalize: () => void finalized.push("finalize"),
  });
  const spies = [
    spyOn(CodegenUnitDebugContext, "new").mockImplementation(() => placeholder),
    spyOn(metadata, "build_compile_unit_di_node").mockImplementation(() => undefined as never),
  ];
  try {
    const out = with_doubles(f, (tcx) => {
      const cgu = the_cgu(tcx);
      const llvm_module = ModuleLlvm.new(tcx, mod_name);
      const cx = CodegenCx.new(tcx, cgu, llvm_module, false);
      expect(cx.dbg_cx).toBe(placeholder);
      const needs = gdb.needs_gdb_debug_scripts_section(cx);
      const g1 = gdb.get_or_insert_gdb_debug_scripts_section_global(cx);
      const g2 = gdb.get_or_insert_gdb_debug_scripts_section_global(cx);
      const main = maybe_create_entry_wrapper<LlvmTypes, CodegenCx, Builder>(Builder_static, cx, cgu);
      cx.debuginfo_finalize();
      return { needs, same: g1 === g2, main: main !== undefined, text: printModule(llvm_module.llmod() as unknown as IrModule) };
    });
    expect(out.needs).toBe(true);
    expect(out.same).toBe(true);
    expect(out.main).toBe(true);
    const global = (t: string): string => t.split("\n").find((l) => l.startsWith("@__rustc_debug_gdb_scripts_section__ = "))!.replace(/, !guid ![0-9]+$/, "");
    expect(global(out.text)).toBe(global(ir));
    expect(global(ir)).toBe(
      '@__rustc_debug_gdb_scripts_section__ = linkonce_odr unnamed_addr constant [34 x i8] c"\\01gdb_load_rust_pretty_printers.py\\00", section ".debug_gdb_scripts", align 1',
    );
    expect(body(out.text, "main")).toBe(body(ir, "main"));
    expect(body(ir, "main")).toContain("load volatile i8, ptr @__rustc_debug_gdb_scripts_section__, align 1");
    // `debuginfo_finalize`: the global already exists, so `get_or_insert` finds it; then `dbg_cx.finalize()`.
    expect(out.text.split("\n").filter((l) => l.startsWith("@__rustc_debug_gdb_scripts_section__")).length).toBe(1);
    expect(finalized).toEqual(["finalize"]);
  } finally {
    for (const s of spies.reverse()) s.mockRestore();
  }
});

test("needs_gdb_debug_scripts_section is false without -g and for a lib", () => {
  for (const f of [FIXTURES.gdb, FIXTURES.names]) {
    const needs = with_doubles(f, (tcx) => {
      const cx = CodegenCx.new(tcx, the_cgu(tcx), ModuleLlvm.new(tcx, "m"), false);
      return gdb.needs_gdb_debug_scripts_section(cx);
    });
    expect(needs).toBe(false);
  }
});

// ---- 5: pure helpers ----
test("lookup_debug_loc, is_node_local_to_unit, mangled_name_of_instance against the -g IR", () => {
  const f = FIXTURES.gdb_g;
  const ir = oracle(f);
  const placeholder = Object.create(CodegenUnitDebugContext.prototype) as CodegenUnitDebugContext;
  const spies = [
    spyOn(CodegenUnitDebugContext, "new").mockImplementation(() => placeholder),
    spyOn(metadata, "build_compile_unit_di_node").mockImplementation(() => undefined as never),
  ];
  try {
    const out = with_doubles(f, (tcx) => {
      const cx = CodegenCx.new(tcx, the_cgu(tcx), ModuleLlvm.new(tcx, "m"), false);
      const defs = items(tcx);
      const start = defs.get("start")!;
      const main = defs.get("main")!;
      const line = (d: DefId): number => cx.lookup_debug_loc(Span.lo(tcx.def_span(d))).line;
      // The `#dbg_declare` locations of `start`'s arguments: their `var_debug_info` spans.
      const mir = tcx.optimized_mir(start) as Body;
      const args = mir.var_debug_info.map((v) => {
        const loc = cx.lookup_debug_loc(Span.lo(v.source_info.span));
        return `${loc.line}:${loc.col}:${loc.file.name !== undefined}`;
      });
      const start_instance = Instance.expect_resolve(tcx, cx.typing_env_(), start, tcx.mk_args([tcx.types.unit]), tcx.def_span(start));
      return {
        lines: [line(start), line(main)],
        args,
        local: [is_node_local_to_unit(cx, start), is_node_local_to_unit(cx, main)],
        linkage: [mangled_name_of_instance(cx, start_instance).name, mangled_name_of_instance(cx, Instance.mono(tcx, main)).name],
      };
    });
    // !10 = distinct !DISubprogram(name: "start<()>", linkageName: "...", line: 17, ... spFlags: DISPFlagLocalToUnit | ...)
    // !36 = distinct !DISubprogram(name: "main", linkageName: "...", line: 21, ... spFlags: DISPFlagLocalToUnit | ...)
    const sp = (name: string): RegExpExecArray => new RegExp(`DISubprogram\\(name: "${name.replace(/[<>()]/g, "\\$&")}", linkageName: "([^"]+)", .*line: ([0-9]+), .*spFlags: ([A-Za-z| ]+),`).exec(ir)!;
    const s_start = sp("start<()>");
    const s_main = sp("main");
    expect(out.lines).toEqual([Number(s_start[2]), Number(s_main[2])]);
    expect(out.local).toEqual([s_start[3]!.includes("DISPFlagLocalToUnit"), s_main[3]!.includes("DISPFlagLocalToUnit")]);
    expect(out.linkage).toEqual([s_start[1], s_main[1]]);
    // !31..!34 = !DILocation(line: 17, column: 13|31|45|70, scope: !10): the four `#dbg_declare`s of `start`'s arguments.
    const locs = [...ir.matchAll(/^!3[1-4] = !DILocation\(line: ([0-9]+), column: ([0-9]+), scope: !10\)$/gm)].map((m) => `${m[1]}:${m[2]}:true`);
    expect(locs.length).toBe(4);
    expect(out.args).toEqual(locs);
  } finally {
    for (const s of spies.reverse()) s.mockRestore();
  }
});

// cg-di-a N1: `set_var_name`'s argument-or-instruction guard (mod.rs:601-606). No fixture reaches it with a non-local value whose
// name is empty, so it runs here on IR-model values, with a `Builder` whose session keeps value names (`fewer_names()` false):
// the only part of the builder `set_var_name` reads.
test("set_var_name names an unnamed argument or instruction, never an unnamed global", () => {
  const bx = { sess: () => ({ fewer_names: () => false }) } as unknown as Builder;
  const C = ffi.LLVMContextCreate();
  const M = ffi.LLVMModuleCreateWithNameInContext("set_var_name", C);
  const i32 = ffi.LLVMInt32TypeInContext(C);
  const global = ffi.LLVMAddGlobal(M, i32, "");
  const f = ffi.LLVMAddFunction(M, "f", ffi.LLVMFunctionType(i32, [i32], 1, ffi.FALSE));
  const arg = ffi.LLVMGetParam(f, 0);
  const b = ffi.LLVMCreateBuilderInContext(C);
  ffi.LLVMPositionBuilderAtEnd(b, ffi.LLVMAppendBasicBlockInContext(C, f, "start"));
  const inst = ffi.LLVMBuildAdd(b, arg, arg, "");
  const name = (v: llvm.Value): string => new TextDecoder().decode(get_value_name(v));
  for (const v of [global, arg, inst]) expect(name(v)).toBe("");
  Builder.prototype.set_var_name.call(bx, global, "g");
  Builder.prototype.set_var_name.call(bx, arg, "x");
  Builder.prototype.set_var_name.call(bx, inst, "sum");
  expect([name(global), name(arg), name(inst)]).toEqual(["", "x", "sum"]);
  // An existing name is kept.
  Builder.prototype.set_var_name.call(bx, arg, "y");
  expect(name(arg)).toBe("x");
  ffi.LLVMDisposeBuilder(b);
});

// ---- 6: types.rs, the type debuginfo (cg-di-b) ----
describe("types.rs: the module, type debug info included, equals the oracle's", () => {
  for (const f of [FIXTURES.types_g2, FIXTURES.types_g1, FIXTURES.types_msvc]) {
    test(`${f.target}, ${f.args[2]}`, () => {
      const ir = oracle(f);
      // The MSVC double (header).
      const spy =
        f.target === MSVC
          ? spyOn(ffi, "LLVMRustSetNormalizedTarget").mockImplementation((m, triple) => {
              (m as unknown as IrModule).targetTriple = triple!;
            })
          : undefined;
      let port: string;
      try {
        port = port_module(f);
      } finally {
        spy?.mockRestore();
      }
      expect(canonical(port)).toBe(canonical(ir));
      // Not vacuous: what each case is for is in the oracle's text.
      if (f === FIXTURES.types_g2) {
        for (const s of ["DW_TAG_variant_part", "DIFlagPrivate", "DIFlagProtected", "DW_TAG_enumeration_type", "DW_TAG_union_type", "templateParams:", "vtableHolder:", '"<recur_type>"']) {
          expect(ir).toContain(s);
        }
      } else if (f === FIXTURES.types_msvc) {
        for (const s of ['name: "VariantNames"', 'name: "DISCR_EXACT"', 'name: "DISCR128_EXACT_LO"', 'name: "DISCR_BEGIN"', 'name: "unsigned __int8"', 'name: "low_bits"']) {
          expect(ir).toContain(s);
        }
      }
    });
  }
});
