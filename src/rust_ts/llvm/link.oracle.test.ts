// rust-ts: fat LTO's linker in the IR model (tools.ts `LLVMRustLinkerNew/Add/Free`, lane ir-fix-b) against the oracle toolchain's own
// libLLVM.dylib through bun:ffi, as capi.oracle.test.ts does. **Tests only**: the model never calls libLLVM.
// libLLVM's `LLVMLinkModules2(Dest, Src)` is `Linker::linkModules(*D, unique_ptr(S))`, the same `Linker::linkInModule` with
// `Flags::None` that `LLVMRustLinkerAdd` runs. The destination has what llvm-link's first link would change: a global referring to
// functions defined after it, dead internal and linkonce definitions, an unused declaration, an appending global, a declaration a
// source defines, a local whose name a source's local also has, and named metadata. The model's text must equal libLLVM's.
import { describe, expect, test } from "bun:test";
import { CString, dlopen, type Pointer, ptr } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";
import * as L from "./ffi.ts";
import { Context, type Module } from "./ir.ts";
import { Unported } from "../../std/panic.ts";
import { module_text, run_pinned_tool, set_module_text } from "./tools.ts";

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
const HAVE = SYSROOT !== "" && existsSync(DYLIB) && process.platform === "darwin";
if (!HAVE && !REQUIRE) console.log(`SKIP: the oracle's libLLVM.dylib is unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const P = "ptr" as const;
const C_API = {
  LLVMContextCreate: { args: [], returns: P },
  LLVMContextDispose: { args: [P], returns: "void" },
  LLVMCreateMemoryBufferWithMemoryRangeCopy: { args: [P, "usize", P], returns: P },
  LLVMParseIRInContext: { args: [P, P, P, P], returns: "i32" },
  LLVMLinkModules2: { args: [P, P], returns: "i32" },
  LLVMPrintModuleToString: { args: [P], returns: P },
  LLVMDisposeMessage: { args: [P], returns: "void" },
} as const;

const HEAD = 'target datalayout = "e-m:o-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-n32:64-S128-Fn32"\ntarget triple = "arm64-apple-macosx11.0.0"\n';

const DST = `source_filename = "dst.0"
${HEAD}
@vt = private unnamed_addr constant <{ ptr, ptr }> <{ ptr @late1, ptr @late2 }>
@g = internal global i32 0
@used_by_src = global i32 1
@tls = internal thread_local global i32 3
@llvm.compiler.used = appending global [1 x ptr] [ptr @g], section "llvm.metadata"

define void @main_fn() {
  call void @decl_defined_by_src()
  %x = load ptr, ptr @vt, align 8
  ret void
}

define internal void @dead_internal() {
  ret void
}

define linkonce_odr void @dead_linkonce() {
  ret void
}

declare void @unused_decl()

declare void @decl_defined_by_src()

define internal void @late1() {
  ret void
}

define void @late2() {
  call void @shared_name()
  ret void
}

define internal void @shared_name() {
  ret void
}

!llvm.module.flags = !{!0}
!llvm.ident = !{!1}

!0 = !{i32 7, !"PIC Level", i32 2}
!1 = !{!"dst ident"}
`;

const SRC1 = `source_filename = "src1"
${HEAD}
@src_g = global i32 2
@used_by_src = external global i32

define void @decl_defined_by_src() {
  %v = load i32, ptr @used_by_src, align 4
  call void @shared_name()
  ret void
}

define internal void @shared_name() {
  ret void
}

!llvm.module.flags = !{!0}
!llvm.ident = !{!1}
!0 = !{i32 7, !"PIC Level", i32 2}
!1 = !{!"src ident"}
`;

const SRC2 = `source_filename = "src2"
${HEAD}
@k = internal global i32 4
@llvm.compiler.used = appending global [1 x ptr] [ptr @k], section "llvm.metadata"

define void @alloc_shim() {
  call void @main_fn()
  ret void
}

declare void @main_fn()

!llvm.module.flags = !{!0}
!foo = !{!1}
!0 = !{i32 7, !"PIC Level", i32 2}
!1 = !{!"foo"}
`;

const asBitcode = (text: string): Uint8Array => {
  const r = run_pinned_tool("llvm-as", ["-o", "-", "-"], new TextEncoder().encode(text));
  if (r.status !== 0) throw new Error(`ERROR: llvm-as: ${r.stderr}`);
  return r.stdout;
};
/** A module's text without its `; ModuleID` line (the model's is its own identifier, libLLVM's the buffer's name). */
const body = (t: string): string => t.slice(t.indexOf("\n") + 1);

describe.skipIf(!HAVE && !REQUIRE)("fat LTO's linker vs libLLVM's Linker::linkInModule", () => {
  // PORT: an FFI edge (PORTING §7), as capi.oracle.test.ts.
  // biome-ignore lint/suspicious/noExplicitAny: FFI edge
  const lib = (HAVE ? dlopen(DYLIB, C_API).symbols : undefined) as unknown as Record<keyof typeof C_API, (...a: any[]) => any>;
  const cstr = (s: string): Buffer => Buffer.from(`${s}\0`, "latin1");
  const parse = (ctx: Pointer, text: string, name: string): Pointer => {
    const ir = Buffer.from(text, "latin1");
    const mb = lib.LLVMCreateMemoryBufferWithMemoryRangeCopy(ptr(ir), ir.length, cstr(name));
    const out = new BigUint64Array(1);
    const err = new BigUint64Array(1);
    if (lib.LLVMParseIRInContext(ctx, mb, ptr(out), ptr(err)) !== 0) throw new Error(`ERROR: libLLVM could not parse ${name}`);
    return Number(out[0]) as Pointer;
  };
  const oracle = (dst: string, srcs: readonly string[]): string => {
    const ctx = lib.LLVMContextCreate();
    const D = parse(ctx, dst, "dst");
    srcs.forEach((s, i) => {
      if (lib.LLVMLinkModules2(D, parse(ctx, s, `src${i}`)) !== 0) throw new Error("ERROR: LLVMLinkModules2 failed");
    });
    const p = lib.LLVMPrintModuleToString(D);
    const text = new CString(p).toString();
    lib.LLVMDisposeMessage(p);
    lib.LLVMContextDispose(ctx);
    return text;
  };
  const model = (dst: string, srcs: readonly string[]): string => {
    const M: Module = L.LLVMModuleCreateWithNameInContext("dst", new Context());
    set_module_text(M, `; ModuleID = 'dst'\n${dst}`);
    const linker = L.LLVMRustLinkerNew(M);
    for (const s of srcs) {
      const bc = asBitcode(s);
      expect(L.LLVMRustLinkerAdd(linker, bc, bc.length)).toBe(true);
    }
    L.LLVMRustLinkerFree(linker);
    return module_text(M);
  };

  test("the destination keeps its order, dead definitions and named metadata order; sources append as libLLVM's", () => {
    const want = oracle(DST, [SRC1, SRC2]);
    expect(body(model(DST, [SRC1, SRC2]))).toBe(body(want));
    // The case is one llvm-link alone gets wrong: its first link reorders the destination and drops its dead definitions.
    const r = run_pinned_tool("llvm-link", ["-S", "-o", "-", "-"], new TextEncoder().encode(DST));
    expect(body(new TextDecoder().decode(r.stdout))).not.toBe(body(oracle(DST, [])));
    expect(want).toContain("@dead_internal");
    expect(want).toMatch(/@shared_name\.\d+\(/);
  });

  test("a replaced declaration that an earlier global refers to lands where libLLVM puts it (review N1)", () => {
    // `@llvm.compiler.used` refers to f and g, so llvm-link's first link creates f, g, then h; the source's definition replaces h.
    const dst = `source_filename = "n1"\n${HEAD}\n@llvm.compiler.used = appending global [2 x ptr] [ptr @f, ptr @g], section "llvm.metadata"\n\ndeclare void @h()\n\ndefine void @f() {\n  call void @h()\n  ret void\n}\n\ndefine void @g() {\n  ret void\n}\n`;
    const src = `${HEAD}\ndefine void @h() {\n  ret void\n}\n`;
    const want = oracle(dst, [src]);
    expect([...want.matchAll(/^define void @(\w+)/gm)].map((m) => m[1])).toEqual(["f", "g", "h"]);
    expect(body(model(dst, [src]))).toBe(body(want));
  });

  test("merged isomorphic named types: the module is flagged and its types stop where they reach output (review F1)", () => {
    const dst = `source_filename = "f1"\n${HEAD}\n%A = type {}\n%B = type {}\n\n@a = global %A zeroinitializer\n@b = global %B zeroinitializer\n\ndefine void @main_fn() {\n  ret void\n}\n`;
    const src = `${HEAD}\ndefine void @other() {\n  ret void\n}\n`;
    // libLLVM's in-process link keeps both types; llvm-link's composite has one.
    expect(oracle(dst, [src])).toContain("%B = type {}");
    const M: Module = L.LLVMModuleCreateWithNameInContext("dst", new Context());
    set_module_text(M, `; ModuleID = 'dst'\n${dst}`);
    const linker = L.LLVMRustLinkerNew(M);
    const bc = asBitcode(src);
    L.LLVMRustLinkerAdd(linker, bc, bc.length);
    L.LLVMRustLinkerFree(linker);
    expect(module_text(M)).not.toContain("%B = type {}");
    const stop = /llir: fat LTO merged named struct types \(llvm-link's IRMover; rustc's in-process link keeps them\)/;
    expect(() => L.LLVMRustPrintModule(M, "/nonexistent-dir/never-written.ll", undefined)).toThrow(stop);
    expect(() => L.LLVMWriteBitcodeToFile(M, "/nonexistent-dir/never-written.bc")).toThrow(stop);
    expect(() => L.LLVMRustModuleSerialize(M, false)).toThrow(Unported);
    expect(() => L.LLVMRustPrintModule(L.LLVMCloneModule(M), "/nonexistent-dir/never-written.ll", undefined)).toThrow(stop);
    // Without a merge (the other tests' destinations have distinct types or none), nothing is flagged.
    const N: Module = L.LLVMModuleCreateWithNameInContext("dst", new Context());
    set_module_text(N, `; ModuleID = 'dst'\n${dst.replace("%B = type {}", "%B = type { i8 }")}`);
    const l2 = L.LLVMRustLinkerNew(N);
    L.LLVMRustLinkerAdd(l2, bc, bc.length);
    L.LLVMRustLinkerFree(l2);
    expect(L.LLVMWriteBitcodeToFile(N, "/nonexistent-dir/never-written.bc")).toBe(-1);
  });

  test("one source, and none (the destination unchanged)", () => {
    expect(body(model(DST, [SRC1]))).toBe(body(oracle(DST, [SRC1])));
    expect(model(DST, [])).toBe(`; ModuleID = 'dst'\n${DST}`);
  });
});
