// rust-ts: long local names through the model's text hand-off (lane llir-callbr-mangler, rg-fix-a G3; tools.ts `verbatimNameArgs`).
//
// In-process LLVM (the oracle toolchain's own libLLVM.dylib, through bun:ffi as capi.oracle.test.ts does) can hold a local name
// longer than `NonGlobalValueMaxNameSize` (1024): a value named before it is inserted keeps its whole name (`reinsertValue`; here a
// basic block), while one named in a function is truncated (`createValueName`). Its printed module is then text the pinned `opt` rejects with LLVM's
// default limit ("name is too long ..." / "multiple definition of local value named ..."), which is what stopped regex_automata under `release-lto`.
// `run_pinned_tool` passes `-non-global-value-max-name-size=-1` for such text only, and opt then reads and prints the module
// unchanged.
import { describe, expect, test } from "bun:test";
import { CString, dlopen, type Pointer } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";
import { llvmBinDir } from "../../../scripts/lib/llvm-tools.ts";
import { hasLongLocalName, run_pinned_tool, verbatimNameArgs } from "./tools.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const SYSROOT = (() => {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } });
    return r.exitCode === 0 ? r.stdout.toString().trim() : "";
  } catch {
    return "";
  }
})();
const DYLIB = join(SYSROOT, "lib", "libLLVM.dylib");
const HAVE = SYSROOT !== "" && existsSync(DYLIB) && process.platform === "darwin" && process.arch === "arm64";
if (!HAVE && !REQUIRE) console.log("SKIP: the oracle's libLLVM.dylib is unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const P = "ptr" as const;
const C_API = {
  LLVMContextCreate: { args: [], returns: P },
  LLVMContextDispose: { args: [P], returns: "void" },
  LLVMModuleCreateWithNameInContext: { args: [P, P], returns: P },
  LLVMInt32TypeInContext: { args: [P], returns: P },
  LLVMFunctionType: { args: [P, P, "u32", "i32"], returns: P },
  LLVMAddFunction: { args: [P, P, P], returns: P },
  LLVMGetParam: { args: [P, "u32"], returns: P },
  LLVMAppendBasicBlockInContext: { args: [P, P, P], returns: P },
  LLVMCreateBuilderInContext: { args: [P], returns: P },
  LLVMPositionBuilderAtEnd: { args: [P, P], returns: "void" },
  LLVMCreateBasicBlockInContext: { args: [P, P], returns: P },
  LLVMAppendExistingBasicBlock: { args: [P, P], returns: "void" },
  LLVMBuildBr: { args: [P, P], returns: P },
  LLVMBuildAdd: { args: [P, P, P, P], returns: P },
  LLVMBuildRet: { args: [P, P], returns: P },
  LLVMDisposeBuilder: { args: [P], returns: "void" },
  LLVMPrintModuleToString: { args: [P], returns: P },
  LLVMDisposeMessage: { args: [P], returns: "void" },
} as const;

const cstr = (s: string): Buffer => Buffer.concat([Buffer.from(s, "latin1"), Buffer.from([0])]);
const bytes = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "latin1"));

/** libLLVM's text of `define i32 @f(i32 %0)`: an add named in its block (`short`), and a block named before it joined the function
 *  (`long`: `LLVMCreateBasicBlockInContext`, then `LLVMAppendExistingBasicBlock`). */
function inProcessModule(short: string, long: string): string {
  const { symbols: lib } = dlopen(DYLIB, C_API);
  const ctx = lib.LLVMContextCreate()!;
  const mod = lib.LLVMModuleCreateWithNameInContext(cstr("m"), ctx)!;
  const i32 = lib.LLVMInt32TypeInContext(ctx)!;
  const fty = lib.LLVMFunctionType(i32, new BigUint64Array([BigInt(i32)]), 1, 0)!;
  const f = lib.LLVMAddFunction(mod, cstr("f"), fty)!;
  const bb = lib.LLVMAppendBasicBlockInContext(ctx, f, cstr("start"))!;
  const b = lib.LLVMCreateBuilderInContext(ctx)!;
  const x = lib.LLVMGetParam(f, 0)!;
  lib.LLVMPositionBuilderAtEnd(b, bb);
  // Named in a function: `createValueName` truncates it to 1024 bytes.
  const a = lib.LLVMBuildAdd(b, x, x, cstr(short))!;
  // Named with no function (no symbol table), then inserted: `reinsertValue` keeps the whole name.
  const next = lib.LLVMCreateBasicBlockInContext(ctx, cstr(long))!;
  lib.LLVMAppendExistingBasicBlock(f, next);
  lib.LLVMBuildBr(b, next);
  lib.LLVMPositionBuilderAtEnd(b, next);
  lib.LLVMBuildRet(b, a);
  lib.LLVMDisposeBuilder(b);
  const p = lib.LLVMPrintModuleToString(mod) as Pointer;
  const text = new CString(p).toString();
  lib.LLVMDisposeMessage(p);
  lib.LLVMContextDispose(ctx);
  return text;
}

describe.skipIf(!HAVE && !REQUIRE)("long local names (rg-fix-a G3)", () => {
  test("in-process LLVM holds a name the default parser rejects; with the flag opt reads and prints it unchanged", () => {
    const long = `${"n".repeat(1100)}`;
    const text = inProcessModule("s".repeat(1100), long);
    // The add named in its block was truncated to 1024 bytes; the block named before insertion kept all 1100.
    expect(text).toContain(`%${"s".repeat(1024)} = add i32 %0, %0`);
    expect(text).toContain(`\n${long}:`);
    expect(hasLongLocalName(bytes(text))).toBe(true);
    expect(verbatimNameArgs(bytes(text))).toEqual(["-non-global-value-max-name-size=-1"]);

    // LLVM's default: the parse stops.
    const opt = join(llvmBinDir(SYSROOT, "aarch64-apple-darwin"), "opt");
    const plain = Bun.spawnSync([opt, "-S", "-o", "-", "-"], { stdin: bytes(text), stdout: "pipe", stderr: "pipe" });
    expect(plain.exitCode).not.toBe(0);
    // LLParser's two refusals: a forward reference ("name is too long ...") or a definition ("multiple definition of local value").
    expect(plain.stderr.toString()).toMatch(/name is too long which can result in name collisions|multiple definition of local value named/);

    // The model's run: the module comes back as libLLVM printed it.
    const r = run_pinned_tool("opt", ["-S", "-o", "-", "-"], bytes(text));
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const body = (s: string): string => s.slice(s.indexOf("define"));
    expect(body(Buffer.from(r.stdout).toString("latin1"))).toBe(body(text));
  });

  test("a module whose names fit gets no flag", () => {
    const text = inProcessModule("s".repeat(1100), "n".repeat(1024));
    expect(hasLongLocalName(bytes(text))).toBe(false);
    expect(verbatimNameArgs(bytes(text))).toEqual([]);
  });
});

describe("hasLongLocalName", () => {
  const n = (k: number, c = "a"): string => c.repeat(k);
  test("locals, quoted locals with escapes, labels; not globals, strings or metadata", () => {
    expect(hasLongLocalName(bytes(`  %${n(1025)} = add i32 1, 2\n`))).toBe(true);
    expect(hasLongLocalName(bytes(`  %${n(1024)} = add i32 1, 2\n`))).toBe(false);
    // `\XX` is one byte: 1023 + 1 = 1024 bytes fits, 1024 + 1 does not.
    expect(hasLongLocalName(bytes(`  %"${n(1023, " ")}\\22" = add i32 1, 2\n`))).toBe(false);
    expect(hasLongLocalName(bytes(`  %"${n(1024, " ")}\\22" = add i32 1, 2\n`))).toBe(true);
    expect(hasLongLocalName(bytes(`${n(1025)}:\n  ret void\n`))).toBe(true);
    expect(hasLongLocalName(bytes(`@${n(2000)} = global i32 0\n`))).toBe(false);
    expect(hasLongLocalName(bytes(`@s = constant [2000 x i8] c"${n(2000)}"\n`))).toBe(false);
    expect(hasLongLocalName(bytes(`!0 = !{!"${n(2000)}"}\n`))).toBe(false);
  });
});
