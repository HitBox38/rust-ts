// Unit tests of the per-path scope (scripts/lib/scope.ts; lane scope-m7): exclusions of files and directories, partial files,
// the refusal of entries that name nothing, on a fixture tree; then harness/scope.json against the pinned checkout
// (`rustc_codegen_llvm`'s denominator, plan-m7 D4).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { rustFns } from "./rust-fns.ts";
import { type PathScope, type ScopeJson, cratePathScope, cratesEntryErrors, miriPathScope, pathExcluded, scopeErrors, scopeFiles, scopeFns, scopeOfPath, upstreamPathExcluded } from "./scope.ts";
import { REPO_ROOT, upstreamRoot } from "./upstream-root.ts";

// Not common.ts: see scripts/lib/upstream-root.ts.
const UPSTREAM = upstreamRoot();
const upstreamFns = (p: string, root: string = UPSTREAM) => rustFns(p, root);
const readScopeJson = (): ScopeJson => JSON.parse(readFileSync(join(REPO_ROOT, "harness", "scope.json"), "utf8")) as ScopeJson;

const ROOT = mkdtempSync(join(tmpdir(), "rust-ts-scope-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(ROOT, rel)), { recursive: true });
  writeFileSync(join(ROOT, rel), text);
};
put("compiler/c/src/lib.rs", "fn a() {}\nfn b() {}\n");
put("compiler/c/src/ffi.rs", "extern \"C\" { fn f1(); fn f2(); }\n");
put("compiler/c/src/ffi_helpers.rs", "fn h() {}\n");
put("compiler/c/src/cov/mod.rs", "fn m() {}\n");
put("compiler/c/src/cov/deep/x.rs", "fn x() {}\n");
put("compiler/c/src/covered.rs", "fn y() {}\n");
put("compiler/c/src/part.rs", "fn keep() {}\nfn drop1() {}\nfn drop2() {}\n");
put("compiler/c/src/notes.txt", "not rust\n");
const fnsOf = (p: string) => upstreamFns(p, ROOT);
const S: PathScope = {
  root: "compiler/c",
  excluded: { "src/ffi.rs": "the seam", "src/cov": "coverage" },
  partial: { "src/part.rs": { fns: ["keep"], reason: "only keep" } },
};

describe("exclusions", () => {
  test("a file, and only that file: a name it prefixes stays in", () => {
    expect(pathExcluded(S, "src/ffi.rs")).toBe("src/ffi.rs");
    expect(pathExcluded(S, "src/ffi_helpers.rs")).toBeUndefined();
  });
  test("a directory and everything under it, but not a sibling it prefixes", () => {
    expect(pathExcluded(S, "src/cov/mod.rs")).toBe("src/cov");
    expect(pathExcluded(S, "src/cov/deep/x.rs")).toBe("src/cov");
    expect(pathExcluded(S, "src/covered.rs")).toBeUndefined();
  });
  test("upstream-relative paths, and paths outside the root", () => {
    expect(upstreamPathExcluded(S, "compiler/c/src/cov/mod.rs")).toBe("src/cov");
    expect(upstreamPathExcluded(S, "compiler/c/src/lib.rs")).toBeUndefined();
    expect(upstreamPathExcluded(S, "compiler/d/src/ffi.rs")).toBeUndefined();
  });
  test("scopeFiles: every .rs, and the in-scope ones", () => {
    const { all, files } = scopeFiles(S, ROOT);
    expect(all).toEqual(["compiler/c/src/cov/deep/x.rs", "compiler/c/src/cov/mod.rs", "compiler/c/src/covered.rs", "compiler/c/src/ffi.rs", "compiler/c/src/ffi_helpers.rs", "compiler/c/src/lib.rs", "compiler/c/src/part.rs"]);
    expect(files).toEqual(["compiler/c/src/covered.rs", "compiler/c/src/ffi_helpers.rs", "compiler/c/src/lib.rs", "compiler/c/src/part.rs"]);
  });
  test("scopeFns: a partial file keeps only its listed fns; others keep all", () => {
    expect(scopeFns(S, "compiler/c/src/part.rs", fnsOf).map((f) => f.name)).toEqual(["keep"]);
    expect(scopeFns(S, "compiler/c/src/lib.rs", fnsOf).map((f) => f.name)).toEqual(["a", "b"]);
  });
  test("the denominator: in-scope files' fns, partial files counted by their list", () => {
    const { files } = scopeFiles(S, ROOT);
    expect(files.reduce((n, f) => n + scopeFns(S, f, fnsOf).length, 0)).toBe(1 + 1 + 2 + 1);
  });
  test("a root the checkout does not have: nothing, and no errors", () => {
    const none: PathScope = { root: "compiler/nope", excluded: { x: "y" }, partial: {} };
    expect(scopeFiles(none, ROOT)).toEqual({ all: [], files: [] });
    expect(scopeErrors(none, ROOT, "crates.nope", fnsOf)).toEqual([]);
  });
});

describe("entries that name nothing are refused", () => {
  test("the fixture scope is clean", () => expect(scopeErrors(S, ROOT, "crates.c", fnsOf)).toEqual([]));
  const errs = (s: Partial<PathScope>) => scopeErrors({ ...S, ...s }, ROOT, "crates.c", fnsOf);
  test("an excluded path that does not exist (a typo excludes nothing)", () => expect(errs({ excluded: { "src/fii.rs": "typo" } })).toEqual(["ERROR: harness/scope.json crates.c.excluded src/fii.rs: no such file or directory under compiler/c"]));
  test("an excluded path that is not relative, or has a trailing slash", () => {
    for (const x of ["/src/ffi.rs", "src/cov/", "../c/src/ffi.rs", ""]) expect(errs({ excluded: { [x]: "r" } })[0]).toContain("not a relative path");
  });
  test("an excluded file that is not .rs", () => expect(errs({ excluded: { "src/notes.txt": "r" } })[0]).toContain("not a .rs file or a directory"));
  test("an excluded entry with no reason", () => expect(errs({ excluded: { "src/ffi.rs": " " } })[0]).toContain("no reason"));
  test("a partial file that does not exist", () => expect(errs({ partial: { "src/nope.rs": { fns: ["a"], reason: "r" } } })[0]).toContain("no such .rs file"));
  test("a partial fn the file does not have", () => expect(errs({ partial: { "src/part.rs": { fns: ["keep", "kept"], reason: "r" } } })).toEqual(["ERROR: harness/scope.json crates.c.partial src/part.rs: no fn kept in the file"]));
  test("a partial file under an excluded directory", () => expect(errs({ partial: { "src/cov/mod.rs": { fns: ["m"], reason: "r" } } })[0]).toContain("under excluded src/cov"));
  test("a partial file with no fns or no reason", () => {
    expect(errs({ partial: { "src/part.rs": { fns: [], reason: "r" } } })[0]).toContain("lists no fns");
    expect(errs({ partial: { "src/part.rs": { fns: ["keep"], reason: "" } } })[0]).toContain("no reason");
  });
  test("a crates entry for an excluded or unknown crate", () => {
    const scope: ScopeJson = { excluded: { gone: "x" }, crates: { comment: "c", c: {}, gone: {}, typo: {} } };
    expect(cratesEntryErrors(scope, ["c", "gone"])).toEqual(["ERROR: harness/scope.json crates.gone: the crate is in excluded", "ERROR: harness/scope.json crates.typo: no compiler crate of that name in the checkout"]);
  });
});

describe("harness/scope.json at the pin", () => {
  const scope = readScopeJson();
  const llvm = cratePathScope(scope, "rustc_codegen_llvm");
  test("rustc_codegen_llvm is in scope, rustc_llvm is not", () => {
    expect("rustc_codegen_llvm" in scope.excluded).toBe(false);
    expect("rustc_llvm" in scope.excluded).toBe(true);
    expect(cratesEntryErrors(scope, readdirSync(join(UPSTREAM, "compiler")))).toEqual([]);
  });
  test("every entry names something in the checkout (rustc_codegen_llvm and Miri)", () => {
    expect(scopeErrors(llvm, UPSTREAM, "crates.rustc_codegen_llvm", (p) => upstreamFns(p))).toEqual([]);
    expect(scopeErrors(miriPathScope(scope)!, UPSTREAM, "miri", (p) => upstreamFns(p))).toEqual([]);
  });
  test("rustc_codegen_llvm's denominator: 1,338 fns less ffi.rs (387) and the out-of-M7 files (131) is 820 (plan-m7 section 2b)", () => {
    const { all, files } = scopeFiles(llvm, UPSTREAM);
    const count = (fs: string[]) => fs.reduce((n, f) => n + scopeFns(llvm, f, (p) => upstreamFns(p)).length, 0);
    expect(count(all)).toBe(1338);
    expect(count(all.filter((f) => f.endsWith("/src/llvm/ffi.rs")))).toBe(387);
    expect(count(files)).toBe(820);
  });
  test("scopeOfPath: Miri, a compiler crate with an entry, one without, and neither", () => {
    expect(scopeOfPath(scope, "src/tools/miri/src/lib.rs")?.label).toBe("miri");
    expect(scopeOfPath(scope, "compiler/rustc_codegen_llvm/src/llvm/ffi.rs")?.label).toBe("crates.rustc_codegen_llvm");
    expect(upstreamPathExcluded(scopeOfPath(scope, "compiler/rustc_codegen_llvm/src/llvm/ffi.rs")!.s, "compiler/rustc_codegen_llvm/src/llvm/ffi.rs")).toBe("src/llvm/ffi.rs");
    const plain = scopeOfPath(scope, "compiler/rustc_span/src/lib.rs")!;
    expect(plain.label).toBe("crates.rustc_span");
    expect(plain.s.excluded).toEqual({});
    expect(scopeOfPath(scope, "library/core/src/lib.rs")).toBeUndefined();
  });
});
