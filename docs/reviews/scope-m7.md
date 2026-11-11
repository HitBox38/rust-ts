APPROVE WITH NITS

# Review: harness batch `scope-m7` (`t3/llvm-harness-scope` at `f5d0a43d`)

Reviewer: independent, read-only on the lane. Diff: `git diff b3b29e88...f5d0a43d` (15 files, +1,536 / −90). Inputs: plan-m7
D4, D5 and D18, review plan-m7 F6, the owner's decisions of 2026-11-11 in `docs/state/history.jsonl`. I ran everything on a
detached scratch worktree of `f5d0a43d`. A second scratch worktree at the merge-base gave the "before" figures. Both full coverage
runs used a scratch `RUST_TS_DATA` whose entries are symlinks to the shared ones, except `coverage.json`, so the shared
`coverage.json` and `llvm-src/` were never written. AC power throughout.

No must-fix findings. The scope change matches D4 exactly, and the coverage arithmetic is right. The manifest hashes, the commit
and the gitlink check out. `fetch` is safe. On real markers the marker checks give no false passes or false fails: after a trial merge,
168 of `llir-core-a`'s 169 `// llvm:` markers pass, and the 169th points at a file not yet in the manifest (R1). The nits are a C++ finder gap (N1), two unchecked typo forms of the wrapper
path (N2), `add` writing before it validates (N3), and a test guard that does not generalise (N4). Root has one merge-order action
(R1).

## Results

| Check | Result |
|---|---|
| Runner unit step, as the gate runs it (`unitStaticSteps` "runner unit tests", the step env overlaid on the shell env, cwd = the branch) | **512 pass, 0 fail, 0 skip**, 49 files, 93.0 s (load 37–66), same as the handoff |
| `bun scripts/coverage.ts --check --offline` | `markers ok (24997, 0 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 728; llvm 0)` |
| `bunx tsc --noEmit -p .` | exit 0, no output |
| `bun scripts/llvm-src.ts check` | `llvm-src ok: 43 files at aab11ee0ea5e (the checkout's gitlink)` |
| Full coverage, before → after | TOTAL 24,394/27,053 → 24,394/27,873, 66 → 67 crates; WRAPPER 0/218 in 8 files |
| `coverage.json`, compared crate by crate | Only change: the new row `rustc_codegen_llvm` 820/0. `vendor` and `library` are byte-identical. New key `wrapper`. The text table differs only where `rustc_fs_util` moves, from the new name tie-break in the sort |
| Miri: `--crate miri`, `--missing` on an excluded file (`bin/log/tracing_chrome.rs`) and on a partial file (`shims/unix/socket.rs`) | output byte-identical before and after (md5) |
| `--check` after a trial merge with `llir-core-a` (`11271a62`) | **1 ERROR**: `src/rust_ts/llvm/ir.ts: marker llvm/lib/IR/LLVMContext.cpp:280 LLVMContext::getMDKindID names no file of harness/llvm-manifest.json` (see R1). The other 168 `// llvm:` markers and the 28 wrapper markers pass |

## 1. Exclusions

I checked each path in the crate at the pin (`6f5da406`, 57 `.rs` files), with fn counts from `rustFns`. A comment-stripped
`fn <ident>` grep gave the same counts, apart from 1 extra in `autodiff.rs` (`fn` in a string or doc comment):

| Path | Fns | D4 term |
|---|---|---|
| `src/llvm/ffi.rs` | 387 | ffi.rs |
| `src/llvm/enzyme_ffi.rs` | 60 | enzyme |
| `src/builder/autodiff.rs` | 3 | autodiff |
| `src/typetree.rs` | 3 | typetree |
| `src/builder/gpu_offload.rs` | 21 | offload |
| `src/llvm/offload_ffi.rs` | 8 | offload |
| `src/coverageinfo/` (7 files: 0+9+5+9+3+4+6) | 36 | coverageinfo |

1,338 − 387 − 131 = **820**, confirmed. Nothing is excluded beyond D4's list, and no file is wholly autodiff, offload, enzyme or
coverage code without being excluded. Some fns in in-scope files serve only these features: `intrinsic.rs:1824 codegen_autodiff`,
`:1913 codegen_offload`, `back/lto.rs:533 enable_autodiff_settings`, `back/write.rs:632 handle_offload`,
`context.rs:741 coverage_cx`. They stay in the 820. That is right: they port faithfully and reach `unported` in the excluded
callees, which is D18's "named stops". Taking them out would mean listing every other fn of `intrinsic.rs` in a `partial` entry,
which is brittle. No change needed.

**`ffi.rs`'s 6 fns with Rust bodies** (`Bool::from_bool` :50, `is_true` :55, `fmt` :63, `to_llvm_bool` :78/:83, `RawEnum::to_rust`
:103). My advice: keep `ffi.rs` wholly excluded. The owner named the file. The fns are trivial, and the IR model (`llir-core-a`,
`src/rust_ts/llvm/support.ts`) already provides them. What matters more is that their markers are checked. `llir-core-a` marks
them, and the whole FFI surface, with its own `// ffi: compiler/rustc_codegen_llvm/src/llvm/ffi.rs:50 from_bool` kind
(`support.ts:17,21`, `ffi.ts:13…`), which nothing checks. Under this batch a `// rustc:` marker on an excluded path is still
checked against upstream. I confirmed this end to end: `ffi.rs:50 from_bool` passes, `ffi.rs:51 from_bool` gives one ERROR. So
these markers should be `// rustc:`, or `--check` should learn `// ffi:` (R2). A `partial` entry would add 6 to the denominator
for no real gain.

## 2. Coverage

As in the table above: +820 is exactly `rustc_codegen_llvm`'s in-scope fns. Nothing else moved. Under the generalised code
(`scopeFiles`/`scopeFns`/`pathExcluded`), Miri's figures and `--missing` notes are byte-identical. The old exports
(`MiriScope`, `miriFiles`, `miriFns`, `miriExcluded`) have no remaining users (`git grep`). The scope-entry refusals
(`scopeErrors`, `cratesEntryErrors`) work as described, and the 21 tests in `scope.test.ts` cover them.

## 3. Manifest and fetch

- **Commit.** `git ls-tree 6f5da406 src/llvm-project` in the checkout gives `160000 commit aab11ee0ea5ea9a1d462ad0bc1fae9d9bb643019`.
  The GitHub API confirms the commit exists in `rust-lang/llvm-project` ("Merge pull request #200 from madsmtm/update-llvm").
- **Hashes.** I fetched 6 files myself from raw.githubusercontent.com at that commit: `lib/IR/Core.cpp`, `include/llvm/IR/Constants.h`,
  `include/llvm/IR/Attributes.td`, `include/llvm-c/BitWriter.h`, `lib/IR/ConstantFold.cpp`, `lib/Target/TargetMachineC.cpp`. All
  6 SHA-256 match the manifest.
- **`fetch` safety.** I ran it into a scratch `RUST_TS_DATA` with a 2-file manifest, one hash zeroed. The good file was placed.
  The bad one was refused with `ERROR: … fetched SHA-256 d51d…, the manifest pins 0000…`, exit 1, and left no file and no `.tmp-*`.
  The hash is checked before the write, and the write is temp-then-rename. Good. **`add` is weaker** (N3).

## 4. Marker checks

End to end through `coverage.ts --check --offline`, with temporary markers in a src file (removed afterwards):

| Marker | Expected | Got |
|---|---|---|
| `Core.cpp:3775 LLVMBuildAdd` | pass | pass |
| `Constants.cpp:994 ConstantInt::get`, and `… get` (one of 6 overloads) | pass | pass |
| `Function.cpp:481 Function::Function` (constructor) | pass | pass |
| `Attributes.cpp:797 Attribute::operator<` | pass | pass |
| wrapper `RustWrapper.cpp:404 LLVMRustAddFunctionAttributes` | pass | pass |
| `Core.cpp:3776` / `:3774 LLVMBuildAdd` (off by one) | fail | fail |
| `Core.cpp:3775 LLVMBuildSub` (wrong name) | fail | fail |
| `Constants.cpp:994 ConstantFP::get`, `Int::get` (wrong qualifier, suffix trick) | fail | fail |
| `llvm/lib/Support/ModRef.cpp:1 x`, `../../etc/passwd:1 x` (not in manifest) | fail | fail |
| `Core.cpp:1179 LLVMIsAFunction` (macro-generated) | fail (documented gap) | fail |
| wrapper `RustWrapper.cpp:405` (off by one) | fail | fail |
| `//llvm: …` (spacing), `// llvm: Core.cpp:3775` (no name) | fail | fail, as malformed |
| wrapper `compiler/rustc_llvm/llvm_wrapper/RustWrapper.cpp:404 …` (dir typo) | fail | **pass, unchecked** (N2) |
| wrapper `…/llvm-wrapper/RustWrapper.cc:404 …` (extension typo) | fail | **pass, unchecked** (N2) |

**Finder robustness.** I wrote an independent line-based scanner (comment- and string-stripped; a column-0 or 2-space-indented
line with `name(` and a `{` before a `;` at paren depth 0) and compared the two:
- **Wrappers (218):** the only scanner-only hits were 42 `FIXED_MD_KIND(...)` lines and one `DEFINE_STDCXX_CONVERSION_FUNCTIONS(...)`
  line, macro invocations the finder rightly rejects. The only finder-only hit was `RustWrapper.cpp:1850 SanitizerSection`, a
  real constructor of a nested struct. So the finder has no misses and no false entries there. Duplicate names among the 218 are
  overloads (`fromRust`, `isSet`, `operator&`), plus one dead `#if` branch (N6).
- **LLVM files:** the finder finds 3,938 definitions in the 43 files (the handoff says 3,942). The 12 finder-only hits are all
  real nested-class members. Among the scanner-only hits, 16 are scanner false positives. **10 are real misses: every
  constructor and `getInserter` of `class IRBuilder` (IRBuilder.h:2899–2959)** (N1).
- **Synthetic cases** I fed to `cppFns`: correct for function-try-blocks, trailing return types, `noexcept(expr)`, `[[attr]]`,
  `decltype(auto)`, `operator()`, `operator new`, `operator unsigned long long`, out-of-class template members
  (`DenseMap<K,V>::grow`), nested namespaces, a lambda initializer at namespace scope, `struct X x = {…};`, a `{` in a char,
  string or raw string, a macro invocation with no `;` before a definition, `enum class` with calls in it, and `#if`/`#else` inside
  a body. Wrong for:
  - `template <typename T = int> class Box { void get() {} };`: no definitions found (N1).
  - `Foo::Foo(int a) : Base{a}, Member(a) {`: a false extra definition `Member` (N7).
  - A trailing macro after the parameters (`… const LLVM_READONLY {`) or a `requires` clause: missed. I grepped all 43 files and the
    wrappers for the macro form and found none.
  - A `//` comment ending in `\`: its next line is still read.
  - A `TEST(A, B) {`-style macro: counted as a definition.

  None of the last three occurs in the files today.

So the finder is robust enough for the wrappers and for the markers that exist, but the handoff's statement that every miss
was a non-definition is not right for IRBuilder.h.

## 5. The runner-step trap and its guard test

The diagnosis is right. `common.ts` fixes `RUST_TS_DATA` the first time it loads. In the gate's one-process runner step, a file
that sorts before `scripts/lib/deps.test.ts` and loads `common.ts` breaks deps' "uses a temp oracle cache". The fix (moving
`rustFns`, `scopeOfPath` and the checkout path into common-free modules) is sound, and the step is green (512/0/0). The guard
test (`scripts/coverage.test.ts:51-68`) is **sound for the four files it names**. Re-running its walk with a stricter regex,
which adds side-effect `import "./x"` and `require("./x")`, finds the same thing: none reach `common.ts`. It also kills the
mutation the lane reports. **It does not generalise** (N4).

## 6. The `llir-core-a` coordination issue

A `// llvm:` marker into a file not in the manifest fails `--check` ("names no file of harness/llvm-manifest.json"), so yes,
merging both would break the gate's markers step. I did the trial merge (`f5d0a43d` + `11271a62`, no conflicts). The marker that
breaks is in **`llvm/lib/IR/LLVMContext.cpp`** (`ir.ts:1375`), not `ModRef.cpp`. `ModRef.cpp` and `Support/StringExtras.cpp` are in
the shared `llvm-src/` but no marker on that branch references them yet. See R1.

## Nits

**N1. `scripts/lib/cpp-fns.ts:145`: a template class with a default template argument loses its whole body.**
`classify` rejects a class head containing `=`, so that `struct X x = {…}` is not taken as a scope. `template <typename FolderTy =
ConstantFolder, typename InserterTy = IRBuilderDefaultInserter> class IRBuilder : public IRBuilderBase {` contains `=`, so its
body becomes `other`, and all 10 definitions in it are missed (IRBuilder.h:2899, 2905, 2910, 2914, 2923, 2930, 2937, 2946, 2958,
2959). Reproduced in isolation: `template <typename T = int> class Box { void get() {} };` → `[]`. The failure is safe (a false
fail with a clear ERROR), but IRBuilder.h is a manifest file. LLVM's ADT headers (`DenseMap`, `SmallVector`, `StringMap`) all use
this form, so a later `add` would widen the gap. The fix is small: ignore `=` inside the `template <…>` angle brackets, or look
for `=` only after the class name. Add a test with the IRBuilder head, and correct the handoff's "the only scan hits it did not
find were not definitions". This is cheap to fold into this batch, since otherwise it needs its own reviewed harness batch later.

**N2. `scripts/lib/llvm-src.ts:126` with `scripts/coverage.ts:355`: two typo forms of a wrapper marker are not checked.**
`isWrapperPath` requires `compiler/rustc_llvm/llvm-wrapper/…\.(cpp|h)`. Anything else under `compiler/rustc_llvm/` falls through
to the excluded-crate rule, and those markers are never checked. Demonstrated above with `llvm_wrapper/` and `.cc`. Such markers
also don't count in WRAPPER, so the figure stays honest, but the marker is silently unverified. Suggest: any `// rustc:` marker
under `compiler/rustc_llvm/` that is not a wrapper path is an ERROR, unless it hits a real fn of the crate's Rust (`rustFns`).
`llir-core-a` has two such markers, `support.ts:105 lib.rs:18 build_byte_buffer` and `:113 lib.rs:62 LLVMRustStringWriteImpl`.
Both are correct, and both are unchecked today. Markers into every other excluded crate also pass unchecked; that predates this
batch.

**N3. `scripts/llvm-src.ts:70-73`: `add` downloads and writes a file before it validates the path, and leaves it on refusal.**
Demonstrated with a scratch `RUST_TS_DATA`. `add "../../llvm-project/<commit>/llvm/include/llvm-c/Comdat.h"` (the URL normalises
to a real file) wrote `$RUST_TS_DATA/llvm-project/<commit>/llvm/include/llvm-c/Comdat.h`, which is outside `llvm-src/`. It then
refused, because the manifest check rejects the path, and left the file behind. The manifest was unchanged. A failed multi-path
`add` (say a 404 on the 2nd path) also leaves the earlier files placed but unrecorded. That is harmless, since unlisted files are
ignored, but untidy. Fix: run `safeRel`/`manifestErrors` on the new paths first, download and hash all of them, then place them
and write the manifest. The input is the operator's own, so this is low risk.

**N4. `scripts/coverage.test.ts:51-68`: the import-graph guard covers only this lane's four files.**
The file names are hard-coded. Its regex misses side-effect `import "./x"`. It also counts `import type` and lazy in-function
`await import(...)` as loads. I ran the same walk over all 49 `scripts/` and `harness/` test files. It flags 3: `harness/cli.test.ts`
(only an `import type` of `suites.ts`, a false positive), `scripts/criteria.test.ts` (`criteria.ts:154` loads `common.ts` lazily
inside a function, a false positive) and `scripts/lib/deps.test.ts` (intended: it sets the env first). A general guard needs to
skip `import type`, consider only top-level imports, and allowlist `deps.test.ts`. A more robust option is a child process that
loads each runner test file's static import closure and asserts that `common.ts` was never evaluated. As written it protects
these four files only, which is all it claims. The lesson in the handoff ("loading `common.ts` early is order-dependent breakage
that only shows in the one-process gate step") should go into `scripts/lib/unit-steps.ts`'s header, or PORTING/AGENTS, where the
next harness lane will see it.

**N5. PORTING §5c: macro-generated definitions have no marker target.**
`Core.cpp:1179 LLVM_DEFINE_VALUE_CAST` generates the `LLVMIsA*` functions, 4 of which `ffi.rs` declares. The same goes for
`DEFINE_TRANSPARENT_OPERAND_ACCESSORS` and the `DEFINE_*_CONVERSION_FUNCTIONS` macros. A marker on the macro line fails, because
`#define` lines are skipped. §5c should say what a lane writes for these, for example a `// PORT:` naming the macro and line. It
should also say that a qualified name with template arguments is written without spaces (`DenseMap<K,V>::grow`): the name is
`\S+`, and the finder joins template tokens without spaces.

**N6. The WRAPPER denominator includes wrappers that D18 puts out of M7.**
It counts `offload/OffloadWrapper.cpp` (10) and `CoverageMappingWrapper.cpp` (11), while their Rust counterparts are excluded
from `rustc_codegen_llvm`. It also counts the inactive `#if` branch `PassWrapper.cpp:543 LLVMRustwrappedIrGetName`, beside the
live one at :553. WRAPPER cannot reach 218 without `rustc-skip:` markers on those. Either exclude them from the figure, as the
crate does, or record in decision 2 that the figure is the whole directory on purpose.

**N7. `scripts/lib/cpp-fns.ts:168`: a constructor whose initializer list has a brace-init followed by a paren-init yields a false
definition.** `Foo::Foo(int a) : Base{a}, Member(a) {` → `["1:Foo::Foo","1:Member"]`, because `buf` is reset when `Base{a}`
closes, so `Member(a) {` reads as a new definition. None of the 43 files or the wrappers has this today (the comparison above found
no false entries). If one appears, it adds a fake function to the denominator and a fake marker target.

**N8. Handoff accuracy.** The handoff gives the branch as `t3/9ef75ab2`, which is the worktree directory; the branch is
`t3/llvm-harness-scope`. It says 3,942 definitions where I count 3,938. Its coordination note names `ModRef.cpp`, but the file
that actually breaks `--check` after the merge is `LLVMContext.cpp` (R1).

## Root actions

- **R1. Merge order.** Merge `scope-m7` first. `llir-core-a` then needs `bun scripts/llvm-src.ts add llvm/lib/IR/LLVMContext.cpp`,
  for its marker `ir.ts:1375`, before its `--check` passes. Add `ModRef.cpp` and `StringExtras.cpp` too if markers come to
  reference them. That edits `harness/llvm-manifest.json`, so it goes in a root commit or that lane's reviewed batch. Without it
  the gate's markers step fails with the 1 ERROR quoted above.
- **R2.** Decide what `llir-core-a`'s `// ffi:` markers are. They are not checked. Either switch them to `// rustc:` on `ffi.rs`,
  which is checked even though the file is excluded (§1), or extend `--check` to cover them.
- Record the handoff's 5 decisions. I agree with all of them, given N6 for decision 2.
