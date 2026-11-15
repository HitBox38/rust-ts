// rust-ts: tests of lane llir-callbr-mangler: the model's `callbr` (`LLVMBuildCallBr`, `CallBrInst`, AsmWriter's callbr arm) and
// its IR mangler (mangler.ts, `LLVMRustGetMangledName`).
//
// Three kinds of evidence, each from the oracle:
// - **Whole crates** (callbr_oracle/a64.rs for aarch64-apple-darwin, x64.rs for x86_64-unknown-linux-gnu): asm goto with one to
//   three labels, with an output, an inout and `noreturn`; naked functions (mangled, `no_mangle`, a `\x01` name, a `?` name, a
//   hidden one, a vectorcall one), and `global_asm!` with `sym` and pointer `const` operands. The port's `--emit=llvm-ir` must equal
//   the pinned rustc's committed output, compared as asm.test.ts compares (no comment lines, `; preds` tails or attribute-group
//   numbers). With the pinned toolchain present, the fixtures are re-made and must be unchanged.
// - **The mangler on every mangling mode** against the pinned `llc`: llc's assembly names each global through the same
//   `Mangler::getNameWithPrefix(GV, CannotUsePrivateLabel)`, so its labels are the answers. The table below holds them as
//   llc printed them; with llc present, the test re-reads them from llc.
// - **A built callbr** printed by the model, parsed, verified and printed again by the pinned `opt`.
import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";
import { llvmBinDir } from "../../../scripts/lib/llvm-tools.ts";
import { Unported } from "../../std/panic.ts";
import * as L from "./ffi.ts";
import { manglingMode, Mangler } from "./mangler.ts";
import type { GlobalValue } from "./ir.ts";
import { printModule } from "./printer.ts";
import { RustString } from "./support.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ORACLE = join(import.meta.dir, "callbr_oracle");
const MAIN = join(import.meta.dir, "..", "main.ts");
const SYSROOT = (() => {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } });
    return r.exitCode === 0 ? r.stdout.toString().trim() : "";
  } catch {
    return "";
  }
})();
const HAVE = SYSROOT !== "";
const BIN = HAVE && process.platform === "darwin" && process.arch === "arm64" ? llvmBinDir(SYSROOT, "aarch64-apple-darwin") : "";
const HAVE_TOOLS = BIN !== "" && existsSync(join(BIN, "llc")) && existsSync(join(BIN, "opt"));
if (!HAVE && !REQUIRE) console.log("SKIP: the pinned toolchain's sysroot is unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure");
const WORK = join(DATA, "tmp", "llir-callbr-mangler-test", `${process.env.RUST_TS_AGENT ?? "default"}-${process.pid}`);
afterAll(() => rmSync(WORK, { recursive: true, force: true }));

// ---- whole crates -------------------------------------------------------------------------------------------------------

const CASES: readonly { crate: string; target: string; expect: readonly string[] }[] = [
  {
    crate: "a64.rs",
    target: "aarch64-apple-darwin",
    expect: [
      "to label %bb1 [label %bb2, label %bb3, label %bb4]",
      "%0 = callbr i64 asm",
      "to label %unreachable [label %bb1, label %bb2]",
      '".globl _naked_no_mangle"',
      '".globl raw_name"',
      '"_?question:"',
      '"b __RNv',
      "_STATIC_NM __RNv",
    ],
  },
  {
    crate: "x64.rs",
    target: "x86_64-unknown-linux-gnu",
    expect: ["to label %bb1 [label %bb2, label %bb3]", "callbr i64 asm", '"naked_vectorcall@@0:"', '"raw_name:"', '"?question:"', '"naked_no_mangle:"', "\\22naked_vectorcall@@0\\22"],
  },
];

function args(target: string): string[] {
  return ["--sysroot", SYSROOT, "--crate-type", "lib", "--edition", "2024", "--target", target, "--emit=llvm-ir"];
}

/** Runs `cmd` on `crate` in WORK; its stderr, exit code and written IR (if any). */
function compile(cmd: string[], crate: string, target: string, out: string): { stderr: string; code: number | null; ir: string | undefined } {
  mkdirSync(WORK, { recursive: true });
  copyFileSync(join(ORACLE, crate), join(WORK, crate));
  rmSync(join(WORK, out), { force: true });
  const r = Bun.spawnSync([...cmd, ...args(target), crate, "-o", out], { cwd: WORK, env: { ...process.env, RUSTC_ICE: "0" } });
  let ir: string | undefined;
  try {
    ir = readFileSync(join(WORK, out), "utf8");
  } catch {
    ir = undefined;
  }
  return { stderr: r.stderr.toString(), code: r.exitCode, ir };
}

/** The IR without comment lines, `; preds` tails and attribute-group numbers and lines (asm.test.ts). */
function comparable(ir: string): string[] {
  return ir
    .split("\n")
    .filter((l) => !l.trimStart().startsWith(";") && !l.startsWith("attributes #"))
    .map((l) => l.replace(/\s+; preds = .*$/, "").replace(/ #\d+( \{)?$/, "$1"));
}

describe.skipIf(!HAVE && !REQUIRE)("callbr and the mangler against the oracle's IR", () => {
  for (const c of CASES) {
    test(`${c.crate} (${c.target}): the port's IR is the oracle's`, () => {
      const r = compile([process.execPath, MAIN], c.crate, c.target, `${c.target}.port.ll`);
      expect(r.stderr).toBe("");
      expect(r.code).toBe(0);
      const want = readFileSync(join(ORACLE, `${c.target}.ll`), "utf8");
      for (const s of c.expect) expect(want).toContain(s);
      expect(comparable(r.ir ?? "")).toEqual(comparable(want));
    });

    test(`${c.crate} (${c.target}): the oracle fixture is current`, () => {
      const r = compile([join(SYSROOT, "bin", "rustc")], c.crate, c.target, `${c.target}.oracle.ll`);
      expect(r.code).toBe(0);
      expect(r.ir).toBe(readFileSync(join(ORACLE, `${c.target}.ll`), "utf8"));
    });
  }
});

// ---- the mangler on every mangling mode, against llc -------------------------------------------------------------------

/** A global of the llc module: its IR name (`undefined` is unnamed), linkage, calling convention (functions only). */
interface G {
  ir: string | undefined;
  kind: "fn" | "var";
  linkage?: "PrivateLinkage" | "InternalLinkage";
  cc?: number;
  vararg?: boolean;
}
// In this order: llc numbers the unnamed globals as it meets them, with one Mangler for the module.
const GLOBALS: readonly G[] = [
  { ir: "s", kind: "fn", cc: 64 },
  { ir: "fc", kind: "fn", cc: 65 },
  { ir: "vc", kind: "fn", cc: 80 },
  { ir: "sv", kind: "fn", cc: 64, vararg: true },
  { ir: "\x01sraw", kind: "fn", cc: 64 },
  { ir: "?sq", kind: "fn", cc: 64 },
  { ir: "?plain", kind: "fn" },
  { ir: "p", kind: "var", linkage: "PrivateLinkage" },
  { ir: undefined, kind: "var", linkage: "PrivateLinkage" },
  { ir: undefined, kind: "var", linkage: "InternalLinkage" },
];
/** The labels llc prints for GLOBALS on each triple (llc's quoting of a label, `"?sq":`, is MC's and not the mangler's). On
 *  Mach-O, llc mangles these private data globals with `CannotUsePrivateLabel` (TargetLoweringObjectFileMachO: `__data` is
 *  atomized by symbols), elsewhere without. The x86 conventions do not exist on aarch64, so Mach-O has no function rows. */
const LLC: readonly { triple: string; layout: string; cannotUsePrivateLabel: boolean; names: readonly (string | undefined)[] }[] = [
  {
    triple: "i686-pc-windows-msvc",
    layout: "e-m:x-p:32:32-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:32-n8:16:32-a:0:32-S32",
    cannotUsePrivateLabel: false,
    names: ["_s@0", "@fc@0", "vc@@0", "_sv@0", "sraw", "?sq", "?plain", "L_p", "L___unnamed_1", "___unnamed_2"],
  },
  {
    triple: "x86_64-unknown-linux-gnu",
    layout: "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128",
    cannotUsePrivateLabel: false,
    names: ["s", "fc", "vc@@0", "sv", "sraw", "?sq", "?plain", ".Lp", ".L__unnamed_1", "__unnamed_2"],
  },
  {
    triple: "x86_64-pc-windows-msvc",
    layout: "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128",
    cannotUsePrivateLabel: false,
    names: ["s", "fc", "vc@@0", "sv", "sraw", "?sq", "?plain", ".Lp", ".L__unnamed_1", "__unnamed_2"],
  },
  {
    triple: "aarch64-apple-darwin",
    layout: "e-m:o-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-n32:64-S128-Fn32",
    cannotUsePrivateLabel: true,
    names: [undefined, undefined, undefined, undefined, undefined, undefined, undefined, "l_p", "l___unnamed_1", "___unnamed_2"],
  },
];

/** The model's globals for a triple, in GLOBALS order (`undefined` where the triple has no row). */
function modelGlobals(layout: string, fns: boolean): (GlobalValue | undefined)[] {
  const C = L.LLVMContextCreate();
  const M = L.LLVMModuleCreateWithNameInContext("m", C);
  L.LLVMSetDataLayout(M, layout);
  const i32 = L.LLVMInt32TypeInContext(C);
  const vd = L.LLVMVoidTypeInContext(C);
  return GLOBALS.map((g) => {
    if (g.kind === "fn") {
      if (!fns) return undefined;
      const f = L.LLVMAddFunction(M, g.ir!, L.LLVMFunctionType(vd, [], 0, g.vararg ? L.TRUE : L.FALSE));
      if (g.cc !== undefined) L.LLVMSetFunctionCallConv(f, g.cc);
      return f as GlobalValue;
    }
    const v = L.LLVMAddGlobal(M, i32, g.ir ?? "");
    if (g.linkage !== undefined) L.LLVMSetLinkage(v, g.linkage);
    return v as GlobalValue;
  });
}

/** GLOBALS as IR text for llc: each global used, so llc emits it. */
function llcModule(fns: boolean): string {
  const name = (s: string): string => (/^[A-Za-z_][\w.]*$/.test(s) ? s : `"${[...s].map((c) => (c < " " ? `\\${c.charCodeAt(0).toString(16).padStart(2, "0")}` : c)).join("")}"`);
  let unnamed = 0;
  const lines: string[] = [];
  for (const g of GLOBALS) {
    if (g.kind === "fn") {
      if (!fns) continue;
      const cc = g.cc === 64 ? "x86_stdcallcc " : g.cc === 65 ? "x86_fastcallcc " : g.cc === 80 ? "x86_vectorcallcc " : "";
      lines.push(`define ${cc}void @${name(g.ir!)}(${g.vararg ? "..." : ""}) { ret void }`);
    } else {
      const id = g.ir === undefined ? String(unnamed++) : name(g.ir);
      lines.push(`@${id} = ${g.linkage === "PrivateLinkage" ? "private" : "internal"} global i32 1`, `define ptr @use_${lines.length}() { ret ptr @${id} }`);
    }
  }
  return `${lines.join("\n")}\n`;
}

describe("Mangler::getNameWithPrefix on every mangling mode", () => {
  for (const t of LLC) {
    test(`${t.triple}: llc's names`, () => {
      const fns = t.names[0] !== undefined;
      const gvs = modelGlobals(t.layout, fns);
      const mangler = new Mangler();
      const got = gvs.map((gv, i) => (gv === undefined ? undefined : mangler.getNameWithPrefix(gv, GLOBALS[i]!.kind === "var" && t.cannotUsePrivateLabel)));
      expect(got).toEqual([...t.names]);
    });

    test.skipIf(!HAVE_TOOLS && !REQUIRE)(`${t.triple}: the table is what the pinned llc prints`, () => {
      const fns = t.names[0] !== undefined;
      const r = Bun.spawnSync([join(BIN, "llc"), `-mtriple=${t.triple}`, "-o", "-"], { stdin: Buffer.from(llcModule(fns), "latin1") });
      expect(r.exitCode).toBe(0);
      // Labels at the start of a line; llc quotes a name MC cannot write bare.
      const labels = new Set(
        r.stdout
          .toString()
          .split("\n")
          .map((l) => /^("[^"]*"|[^\s#;"]+):/.exec(l)?.[1]?.replace(/^"(.*)"$/, "$1"))
          .filter((l): l is string => l !== undefined),
      );
      for (const n of t.names) if (n !== undefined) expect(labels.has(n)).toBe(true);
    });
  }

  test("LLVMRustGetMangledName uses a new Mangler on each call, so an unnamed global is always __unnamed_1", () => {
    const gvs = modelGlobals(LLC[1]!.layout, false);
    const out = (gv: GlobalValue): string => String.fromCharCode(...RustString.build_byte_buffer((s) => L.LLVMRustGetMangledName(gv, s)));
    // `CannotUsePrivateLabel` is true: ELF's linker-private prefix is empty, so a private global has no `.L`.
    expect(out(gvs[7]!)).toBe("p");
    expect(out(gvs[8]!)).toBe("__unnamed_1");
    expect(out(gvs[9]!)).toBe("__unnamed_1");
    // `CannotUsePrivateLabel` is true: on Mach-O a private global takes the linker-private `l` prefix.
    const macho = modelGlobals(LLC[3]!.layout, false);
    expect(out(macho[7]!)).toBe("l_p");
  });

  test("the data layout's mangling mode is its last m: spec, MM_None without one", () => {
    expect(manglingMode("")).toBe("MM_None");
    expect(manglingMode("e-p:64:64")).toBe("MM_None");
    expect(manglingMode("e-m:o-i64:64")).toBe("MM_MachO");
    expect(manglingMode("E-m:a-p:32:32")).toBe("MM_XCOFF");
    expect(manglingMode("e-m:l")).toBe("MM_GOFF");
    expect(manglingMode("e-m:m")).toBe("MM_Mips");
    expect(() => manglingMode("e-m:q")).toThrow(Unported);
    expect(() => manglingMode("e-m:")).toThrow(Unported);
  });

  test("a stdcall function with parameters stops (the byte count needs DataLayout::getTypeAllocSize)", () => {
    const C = L.LLVMContextCreate();
    const M = L.LLVMModuleCreateWithNameInContext("m", C);
    L.LLVMSetDataLayout(M, LLC[0]!.layout);
    const i32 = L.LLVMInt32TypeInContext(C);
    const f = L.LLVMAddFunction(M, "s", L.LLVMFunctionType(L.LLVMVoidTypeInContext(C), [i32], 1, L.FALSE));
    L.LLVMSetFunctionCallConv(f, 64);
    expect(() => new Mangler().getNameWithPrefix(f as GlobalValue, true)).toThrow(Unported);
  });
});

// ---- a built callbr through the pinned opt -----------------------------------------------------------------------------

function callbrModule(): { M: L.Module; text: string } {
  const C = L.LLVMContextCreate();
  const M = L.LLVMModuleCreateWithNameInContext("m", C);
  const i64 = L.LLVMInt64TypeInContext(C);
  const vd = L.LLVMVoidTypeInContext(C);
  const f = L.LLVMAddFunction(M, "f", L.LLVMFunctionType(i64, [i64], 1, L.FALSE));
  const entry = L.LLVMAppendBasicBlockInContext(C, f, "start");
  const named = L.LLVMAppendBasicBlockInContext(C, f, "fall");
  const a = L.LLVMAppendBasicBlockInContext(C, f, "");
  const b = L.LLVMAppendBasicBlockInContext(C, f, "");
  const B = L.LLVMCreateBuilderInContext(C);
  L.LLVMPositionBuilderAtEnd(B, entry);
  const x = L.LLVMGetParam(f, 0);
  // A value-returning callbr with two indirect destinations, then a void one with none.
  const ty = L.LLVMFunctionType(i64, [i64], 1, L.FALSE);
  const asm = L.LLVMGetInlineAsm(ty, "mov $0, $1", 10, "=r,r,!i,!i", 10, L.TRUE, L.FALSE, "Att", L.FALSE);
  const r = L.LLVMBuildCallBr(B, ty, asm, named, [a, b], 2, [x], 1, [], 0, "r");
  L.LLVMPositionBuilderAtEnd(B, named);
  const vty = L.LLVMFunctionType(vd, [], 0, L.FALSE);
  const vasm = L.LLVMGetInlineAsm(vty, "", 0, "", 0, L.TRUE, L.TRUE, "Intel", L.FALSE);
  const end = L.LLVMAppendBasicBlockInContext(C, f, "end");
  L.LLVMBuildCallBr(B, vty, vasm, end, [], 0, [], 0, [], 0, "");
  L.LLVMPositionBuilderAtEnd(B, end);
  L.LLVMBuildRet(B, r);
  for (const bb of [a, b]) {
    L.LLVMPositionBuilderAtEnd(B, bb);
    L.LLVMBuildRet(B, x);
  }
  return { M, text: printModule(M) };
}

describe("callbr", () => {
  test("operands and printing follow CallBrInst and AsmWriter", () => {
    const { text } = callbrModule();
    expect(text).toContain('  %r = callbr i64 asm sideeffect "mov $0, $1", "=r,r,!i,!i"(i64 %0)\n          to label %fall [label %1, label %2]\n');
    expect(text).toContain('  callbr void asm sideeffect alignstack inteldialect "", ""()\n          to label %end []\n');
  });

  test.skipIf(!HAVE_TOOLS && !REQUIRE)("the pinned opt parses, verifies and prints the same function", () => {
    const { text } = callbrModule();
    const r = Bun.spawnSync([join(BIN, "opt"), "-passes=verify", "-S", "-o", "-"], { stdin: Buffer.from(text, "latin1"), stderr: "pipe" });
    expect(r.stderr.toString()).toBe("");
    expect(r.exitCode).toBe(0);
    const body = (s: string): string[] => comparable(s).filter((l) => l !== "" && !l.startsWith("source_filename"));
    expect(body(r.stdout.toString())).toEqual(body(text));
  });
});
