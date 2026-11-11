// Unit tests of the C++ definition finder behind `// llvm:` and `llvm-wrapper` markers (scripts/lib/cpp-fns.ts; lane scope-m7):
// what is a definition and what is not, on snippets in the style of LLVM's sources and rustc's wrappers; then the wrappers at the
// pin, whose 218 definitions are pinned here (a change in the finder or the checkout shows).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cppFns, cppNameMatches } from "./cpp-fns.ts";
import { wrapperFiles, wrapperFns } from "./llvm-src.ts";
import { upstreamRoot } from "./upstream-root.ts";

const UPSTREAM = upstreamRoot(); // not common.ts: see scripts/lib/upstream-root.ts

const fns = (text: string) => cppFns(text, "x.cpp").map((f) => `${f.line} ${f.name}`);

describe("definitions", () => {
  test("extern \"C\" and static functions, with parameters over several lines", () => {
    expect(fns(`extern "C" void LLVMRustAddFunctionAttributes(LLVMValueRef Fn, unsigned Index,\n                                              size_t AttrsLen) {\n  AddAttributes(F, Index, Attrs, AttrsLen);\n}\nstatic Attribute::AttrKind fromRust(LLVMRustAttributeKind Kind) {\n  switch (Kind) {\n  case X: { return Y; }\n  }\n}\n`)).toEqual(["1 LLVMRustAddFunctionAttributes", "5 fromRust"]);
  });
  test("the return type on the line before: the name's line counts", () => expect(fns("extern \"C\" LLVMBool\nLLVMRustVerifyFunction(LLVMValueRef Fn) {\n  return 0;\n}\n")).toEqual(["2 LLVMRustVerifyFunction"]));
  test("qualified names, destructors, constructors with initializer lists, templates", () => {
    expect(fns("Constant *ConstantInt::get(Type *Ty, uint64_t V, bool isSigned) {\n  return nullptr;\n}\nIRBuilderBase::~IRBuilderBase() {}\nRustLinker::RustLinker(Module &M) : L(M), Ctx(M.getContext()) {}\ntemplate <typename T> T *Foo<T>::get() const { return nullptr; }\n")).toEqual(["1 ConstantInt::get", "4 IRBuilderBase::~IRBuilderBase", "5 RustLinker::RustLinker", "6 Foo<T>::get"]);
  });
  test("a template constructor with a defaulted template argument (DerivedTypes.h `FunctionCallee`)", () => {
    expect(fns("class FunctionCallee {\npublic:\n  template <typename T, typename U = decltype(&T::getFunctionType)>\n  FunctionCallee(T *Fn)\n      : FnTy(Fn ? Fn->getFunctionType() : nullptr), Callee(Fn) {}\n};\n")).toEqual(["4 FunctionCallee"]);
  });
  test("operators", () => {
    expect(fns("static Flags operator&(Flags A,\n                      Flags B) {\n  return A;\n}\nbool operator==(const X &a, const X &b) { return true; }\nstatic Flags &operator|=(Flags &A, Flags B) { return A; }\nstruct S { int operator()(int x) const { return x; } operator bool() const { return true; } };\n")).toEqual(["1 operator&", "5 operator==", "6 operator|=", "7 operator()", "7 operator bool"]);
  });
  test("methods defined in a class body, in namespaces and extern \"C\" blocks", () => {
    expect(fns("namespace llvm {\nnamespace {\nclass IRBuilderBase : public X {\npublic:\n  Value *CreateAdd(Value *LHS, Value *RHS, const Twine &Name = \"\") {\n    return nullptr;\n  }\n  InserterTy &getInserter() { return Inserter; }\n};\n}\n}\nextern \"C\" {\nvoid f() {}\n}\n")).toEqual(["5 CreateAdd", "8 getInserter", "13 f"]);
  });
  test("a brace in a default argument or a member initializer is no block (IRBuilder.h's `OpBundles = {}`)", () => {
    expect(fns("class B {\n  B(LLVMContext &C, ArrayRef<OperandBundleDef> OpBundles = {})\n      : Base(C, OpBundles) {}\n  B(int x) : V{x} { init(); }\n  int get() { return 1; }\n};\n")).toEqual(["2 B", "4 B", "5 get"]);
  });
  test("noexcept, override, final, const &, trailing return types, function-try-blocks", () => {
    expect(fns("struct S {\n  void a() const noexcept {}\n  void b() override final {}\n  int &c() & { return x; }\n  auto d() -> int { return 1; }\n  void e() noexcept(true) {}\n  void f() try { g(); } catch (...) {}\n};\n")).toEqual(["2 a", "3 b", "4 c", "5 d", "6 e", "7 f"]);
  });
  test("a macro call before a definition, with no semicolon", () => expect(fns("DEFINE_SIMPLE_CONVERSION_FUNCTIONS(Foo, LLVMFooRef)\nextern \"C\" void g(int x) {}\n")).toEqual(["2 g"]));
});

describe("not definitions", () => {
  test("declarations, deleted and defaulted members, variables, initializers, enums", () => {
    expect(fns("extern \"C\" void f(int);\nstruct S { S(const S &) = delete; S() = default; void m(); };\nstatic const char *Names[] = {\"a\", \"b\"};\nenum class K : int { A, B };\nstatic cl::opt<bool> X(\"x\", cl::desc(\"y\"));\nstd::vector<int> V = {1, 2};\n")).toEqual([]);
  });
  test("a lambda at namespace scope", () => expect(fns("static auto F = [](int x) -> int {\n  return x;\n};\n")).toEqual([]));
  test("blocks and lambdas inside a function body", () => {
    expect(fns("void outer() {\n  if (a) {\n    for (;;) { x(); }\n  }\n  auto l = [&](int y) { return y; };\n  struct Local { void m() {} };\n}\n")).toEqual(["1 outer"]);
  });
  test("braces and parens in comments, strings, characters and raw strings", () => {
    expect(fns("// void c1() {\n/* void c2() {\n} */\nconst char *s = \"void s() {\";\nchar c = '{';\nconst char *r = R\"x(void r() { )\" )x\";\nint n = 1'000'000;\nvoid real() {}\n")).toEqual(["8 real"]);
  });
  test("preprocessor lines, with continuations", () => expect(fns("#define DEF(N) \\\n  void N() {   \\\n  }\n#include <x.h>\nvoid after() {}\n")).toEqual(["5 after"]));
});

describe("#if chains", () => {
  test("alternative headers of one lambda do not unbalance the braces (PassWrapper.cpp)", () => {
    expect(fns("void reg() {\n  PIC.registerBeforePassCallback(\n#if LLVM_VERSION_GE(24, 0)\n      [](StringRef P, IRUnitRef Ir) {\n#else\n      [](StringRef P, Any Ir) {\n#endif\n        use(P);\n      });\n}\nvoid next() {}\n")).toEqual(["1 reg", "11 next"]);
  });
  test("alternative definitions: both are found", () => {
    expect(fns("#if LLVM_VERSION_GE(24, 0)\nstd::string name(const IRUnitRef &W) {\n  return a;\n}\n#else\nstd::string name(const Any &W) {\n  return b;\n}\n#endif\nvoid last() {}\n")).toEqual(["2 name", "6 name", "10 last"]);
  });
  test("an #if with no #else, and nested chains", () => {
    expect(fns("#ifdef X\nvoid a() {}\n#if Y\nvoid b() {\n#elif Z\nvoid b2() {\n#endif\n}\n#endif\nvoid c() {}\n")).toEqual(["2 a", "4 b", "6 b2", "10 c"]);
  });
});

test("cppNameMatches: the name as written or its last segment, nothing else", () => {
  const f = { path: "x.cpp", line: 1, name: "ConstantInt::get" };
  expect([cppNameMatches(f, "ConstantInt::get"), cppNameMatches(f, "get"), cppNameMatches(f, "ConstantInt"), cppNameMatches(f, "Int::get"), cppNameMatches(f, "ge")]).toEqual([true, true, false, false, false]);
  expect(cppNameMatches({ path: "x", line: 1, name: "LLVMBuildAdd" }, "LLVMBuildAdd")).toBe(true);
});

describe("rustc_llvm's wrappers at the pin", () => {
  const files = wrapperFiles(UPSTREAM);
  test("the files", () => {
    expect(files.map((f) => f.slice("compiler/rustc_llvm/llvm-wrapper/".length))).toEqual(["CoverageMappingWrapper.cpp", "LLVMWrapper.h", "Linker.cpp", "PassWrapper.cpp", "RustWrapper.cpp", "SuppressLLVMWarnings.h", "SymbolWrapper.cpp", "offload/OffloadWrapper.cpp"]);
  });
  test("218 definitions, every `extern \"C\" ... LLVMRust*(...) {` among them", async () => {
    let n = 0;
    for (const f of files) {
      const found = wrapperFns(UPSTREAM, f);
      n += found.length;
      const text = await Bun.file(join(UPSTREAM, f)).text();
      const names = new Set(found.map((x) => x.name));
      for (const m of text.matchAll(/^extern "C"[^;]*?\b(LLVMRust\w+)\s*\([^;]*?\{/gm)) expect(names.has(m[1]!)).toBe(true);
    }
    expect(n).toBe(218);
  });
  test("LLVMRustAddFunctionAttributes and the version-split LLVMRustwrappedIrGetName", () => {
    const rw = wrapperFns(UPSTREAM, "compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp");
    expect(rw.filter((f) => f.name === "LLVMRustAddFunctionAttributes").length).toBe(1);
    const pw = wrapperFns(UPSTREAM, "compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp");
    expect(pw.filter((f) => f.name === "LLVMRustwrappedIrGetName").map((f) => f.line)).toEqual([543, 553]);
  });
});
