// Unit tests of the LLVM manifest and the C++ markers (scripts/lib/llvm-src.ts; lane scope-m7, review plan-m7 F6 item 1): the
// manifest's shape and hashes, `// llvm:` markers against a fixture manifest, wrapper markers against the pinned checkout, and
// harness/llvm-manifest.json's commit against the checkout's `src/llvm-project` gitlink.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LLVM_MANIFEST, type LlvmManifest, fileStates, isWrapperPath, llvmMarkerErrors, llvmMarkersOf, manifestErrors, rawUrl, readManifest, sha256, wrapperFns, wrapperMarkerErrors } from "./llvm-src.ts";
import { REPO_ROOT as REPO, pinCommit, upstreamRoot } from "./upstream-root.ts";

// Not common.ts: see scripts/lib/upstream-root.ts.
const UPSTREAM = upstreamRoot();
const PIN = { commit: pinCommit() };

const TMP = mkdtempSync(join(tmpdir(), "rust-ts-llvm-src-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const COMMIT = "aab11ee0ea5ea9a1d462ad0bc1fae9d9bb643019";
const CORE = "LLVMValueRef LLVMBuildAdd(LLVMBuilderRef B, LLVMValueRef LHS, LLVMValueRef RHS,\n                          const char *Name) {\n  return wrap(unwrap(B)->CreateAdd(unwrap(LHS), unwrap(RHS), Name));\n}\n\nConstant *ConstantInt::get(Type *Ty, uint64_t V, bool isSigned) {\n  return nullptr;\n}\n";
const FOLD = "Constant *llvm::ConstantFoldBinaryInstruction(unsigned Opcode, Constant *C1,\n                                              Constant *C2) {\n  return nullptr;\n}\n";
const enc = (s: string) => new TextEncoder().encode(s);
const fixture = (files: Record<string, string>, pinned: Record<string, string> = files): { m: LlvmManifest; dir: string } => {
  const dir = mkdtempSync(join(TMP, "src-"));
  for (const [p, t] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), t);
  }
  return { m: { repo: "https://github.com/rust-lang/llvm-project", commit: COMMIT, files: Object.fromEntries(Object.entries(pinned).map(([p, t]) => [p, sha256(enc(t))])) }, dir };
};
const marker = (path: string, line: number, name: string) => ({ file: "src/rust_ts/llvm/x.ts", path, line, name });

describe("the manifest", () => {
  const good = { repo: "https://github.com/rust-lang/llvm-project", commit: COMMIT, files: { "llvm/lib/IR/Core.cpp": "a".repeat(64) } };
  test("a good one", () => expect(manifestErrors(good)).toEqual([]));
  test("a short or uppercase commit, a bad repo", () => {
    expect(manifestErrors({ ...good, commit: "aab11ee0ea5e" })[0]).toContain("not a full 40-hex commit");
    expect(manifestErrors({ ...good, commit: COMMIT.toUpperCase() })[0]).toContain("not a full 40-hex commit");
    expect(manifestErrors({ ...good, repo: "https://example.com/llvm" })[0]).toContain("is not https://github.com/");
  });
  test("a hash that is no SHA-256, a path that leaves the tree", () => {
    expect(manifestErrors({ ...good, files: { "llvm/lib/IR/Core.cpp": "abc" } })[0]).toContain("is not a SHA-256");
    for (const p of ["../x.cpp", "/llvm/x.cpp", "llvm//x.cpp", "llvm/./x.cpp", "llvm\\x.cpp"]) expect(manifestErrors({ ...good, files: { [p]: "a".repeat(64) } })[0]).toContain("not a relative path");
  });
  test("the URL: raw.githubusercontent.com at the commit", () => expect(rawUrl(good, "llvm/lib/IR/Core.cpp")).toBe(`https://raw.githubusercontent.com/rust-lang/llvm-project/${COMMIT}/llvm/lib/IR/Core.cpp`));
  test("file states: ok, missing, different", () => {
    const { m, dir } = fixture({ "a.cpp": "x", "b.cpp": "y" }, { "a.cpp": "x", "b.cpp": "Y", "c.cpp": "z" });
    expect(fileStates(m, dir)).toEqual([
      { path: "a.cpp", state: "ok" },
      { path: "b.cpp", state: "mismatch" },
      { path: "c.cpp", state: "missing" },
    ]);
  });
});

describe("harness/llvm-manifest.json", () => {
  const m = readManifest(join(REPO, LLVM_MANIFEST));
  test("its commit is the pinned rust tree's src/llvm-project gitlink", () => {
    const r = Bun.spawnSync(["git", "ls-tree", PIN.commit, "src/llvm-project"], { cwd: UPSTREAM, stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toBe(`160000 commit ${m.commit}\tsrc/llvm-project\n`);
  });
  test("the files the review names, sorted", () => {
    for (const f of ["llvm/include/llvm-c/Core.h", "llvm/include/llvm-c/DebugInfo.h", "llvm/lib/IR/Core.cpp", "llvm/lib/IR/IRBuilder.cpp", "llvm/include/llvm/IR/IRBuilder.h", "llvm/lib/IR/Constants.cpp", "llvm/lib/IR/ConstantFold.cpp", "llvm/lib/IR/Type.cpp", "llvm/lib/IR/Value.cpp", "llvm/lib/IR/Instructions.cpp", "llvm/lib/IR/Function.cpp", "llvm/lib/IR/Module.cpp", "llvm/lib/IR/Globals.cpp"]) expect(f in m.files).toBe(true);
    const keys = Object.keys(m.files);
    expect(keys).toEqual([...keys].sort());
  });
});

describe("// llvm: markers", () => {
  test("parsed from TS, and malformed ones reported (any spacing reaches the strict pattern)", () => {
    const text = "// llvm: llvm/lib/IR/Core.cpp:1 LLVMBuildAdd\nfunction LLVMBuildAdd() {}\n//llvm: llvm/lib/IR/Core.cpp:1 LLVMBuildAdd\n  //  llvm: x:1 y\n// llvm: llvm/lib/IR/Core.cpp LLVMBuildAdd\n// The marker is `// llvm:` in prose.\n";
    const r = llvmMarkersOf(text, "a.ts");
    expect(r.markers).toEqual([{ file: "a.ts", path: "llvm/lib/IR/Core.cpp", line: 1, name: "LLVMBuildAdd" }]);
    expect(r.errors.map((e) => e.split(": malformed")[0])).toEqual(["a.ts:3", "a.ts:4", "a.ts:5"]);
    expect(llvmMarkersOf("const x = 1;\n", "b.ts")).toEqual({ markers: [], errors: [] });
  });
  const { m, dir } = fixture({ "llvm/lib/IR/Core.cpp": CORE, "llvm/lib/IR/ConstantFold.cpp": FOLD });
  const errs = (...ks: ReturnType<typeof marker>[]) => llvmMarkerErrors(ks, m, dir);
  test("good markers: a C function, a qualified name as written or by its last segment", () => {
    expect(errs(marker("llvm/lib/IR/Core.cpp", 1, "LLVMBuildAdd"), marker("llvm/lib/IR/Core.cpp", 6, "ConstantInt::get"), marker("llvm/lib/IR/Core.cpp", 6, "get"), marker("llvm/lib/IR/ConstantFold.cpp", 1, "ConstantFoldBinaryInstruction"), marker("llvm/lib/IR/ConstantFold.cpp", 1, "llvm::ConstantFoldBinaryInstruction"))).toEqual([]);
  });
  test("the wrong line: the body, the parameters' second line, past the end", () => {
    for (const l of [2, 3, 999]) expect(errs(marker("llvm/lib/IR/Core.cpp", l, "LLVMBuildAdd"))).toEqual([`src/rust_ts/llvm/x.ts: marker llvm/lib/IR/Core.cpp:${l} LLVMBuildAdd matches no C++ function definition`]);
  });
  test("the wrong name, or a call's name on the line of a definition", () => {
    expect(errs(marker("llvm/lib/IR/Core.cpp", 1, "LLVMBuildSub"))[0]).toContain("matches no C++ function definition");
    expect(errs(marker("llvm/lib/IR/Core.cpp", 6, "ConstantInt"))[0]).toContain("matches no C++ function definition");
  });
  test("a path the manifest does not list, even if the file is there", () => {
    writeFileSync(join(dir, "extra.cpp"), "void f() {}\n");
    expect(errs(marker("extra.cpp", 1, "f"))).toEqual([`src/rust_ts/llvm/x.ts: marker extra.cpp:1 f names no file of ${LLVM_MANIFEST}`]);
  });
  test("a manifest file missing or edited: fetch it", () => {
    const f = fixture({ "llvm/lib/IR/Core.cpp": `${CORE}// edited\n` }, { "llvm/lib/IR/Core.cpp": CORE, "llvm/lib/IR/Type.cpp": "x" });
    expect(llvmMarkerErrors([marker("llvm/lib/IR/Core.cpp", 1, "LLVMBuildAdd")], f.m, f.dir)[0]).toContain("is not the pinned file (SHA-256 differs); run: bun scripts/llvm-src.ts fetch");
    expect(llvmMarkerErrors([marker("llvm/lib/IR/Type.cpp", 1, "f")], f.m, f.dir)[0]).toContain("is missing; run: bun scripts/llvm-src.ts fetch");
  });
  test("no markers: no file is read", () => expect(llvmMarkerErrors([], { ...m, files: { "nope.cpp": "a".repeat(64) } }, join(TMP, "none"))).toEqual([]));
});

describe("// rustc: markers into rustc_llvm's wrappers", () => {
  const RW = "compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp";
  const line = wrapperFns(UPSTREAM, RW).find((f) => f.name === "LLVMRustAddFunctionAttributes")!.line;
  test("which paths are wrapper paths", () => {
    expect([RW, "compiler/rustc_llvm/llvm-wrapper/LLVMWrapper.h", "compiler/rustc_llvm/llvm-wrapper/offload/OffloadWrapper.cpp"].every(isWrapperPath)).toBe(true);
    expect(["compiler/rustc_llvm/src/lib.rs", "compiler/rustc_llvm/llvm-wrapper/README", "compiler/rustc_llvm/llvm-wrapper/../build.rs.cpp", "compiler/rustc_codegen_llvm/src/llvm/ffi.rs"].some(isWrapperPath)).toBe(false);
  });
  test("a good marker", () => {
    expect(readFileSync(join(UPSTREAM, RW), "utf8").split("\n")[line - 1]).toContain("LLVMRustAddFunctionAttributes(");
    expect(wrapperMarkerErrors([marker(RW, line, "LLVMRustAddFunctionAttributes")], UPSTREAM)).toEqual([]);
  });
  test("the wrong line, the wrong name, no such file", () => {
    expect(wrapperMarkerErrors([marker(RW, line + 1, "LLVMRustAddFunctionAttributes")], UPSTREAM)[0]).toContain("matches no C++ function definition");
    expect(wrapperMarkerErrors([marker(RW, line, "LLVMRustAddCallSiteAttributes")], UPSTREAM)[0]).toContain("matches no C++ function definition");
    expect(wrapperMarkerErrors([marker("compiler/rustc_llvm/llvm-wrapper/Nope.cpp", 1, "f")], UPSTREAM)[0]).toContain("names no file of the upstream checkout");
  });
  test("markers elsewhere are not this check's", () => expect(wrapperMarkerErrors([marker("compiler/rustc_span/src/lib.rs", 1, "nothing")], UPSTREAM)).toEqual([]));
});
