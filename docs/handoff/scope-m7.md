# Handoff: lane `scope-m7` (wave 40k), the harness batch that opens M7's porting

Branch: `t3/9ef75ab2`. Owner approval for the `harness/scope.json` change: D4, 2026-11-11 (`docs/state/history.jsonl`).
No `src/` change, so there is no difftest sample, no `unported(...)` and no `// PORT:` in this batch.

## Files

| File | What |
|---|---|
| `harness/scope.json` | D4: `rustc_codegen_llvm` out of `excluded`; new `crates` key with its `excluded` paths |
| `harness/llvm-manifest.json` | new: 43 LLVM files at `aab11ee0ea5e…`, by path and SHA-256 |
| `scripts/lib/scope.ts` (+ `scope.test.ts`) | new: the per-path scope, generalised from Miri's code |
| `scripts/lib/cpp-fns.ts` (+ `cpp-fns.test.ts`) | new: the C++ definition finder behind the C++ markers |
| `scripts/lib/llvm-src.ts` (+ `llvm-src.test.ts`) | new: the manifest, the `// llvm:` and wrapper marker checks |
| `scripts/llvm-src.ts` | new: `fetch` / `check` / `add` for the manifest's files |
| `scripts/coverage.ts` (+ new `scripts/coverage.test.ts`) | per-path scope for every compiler crate, the scope-entry check, the WRAPPER figure, C++ markers in `--check` |
| `scripts/lib/rust-fns.ts` | new: `upstreamFns`'s body moved here as `rustFns(path, root)`; `coverage.ts` keeps `upstreamFns` (default root) and re-exports `UpstreamFn`, so the src contract tests' imports still work |
| `scripts/lib/upstream-root.ts` | new: the checkout path for runner tests that must not load `common.ts` (see Evidence) |
| `PORTING.md` | new §5c: the `// llvm:` marker and the wrapper form of `// rustc:` |

## Item 1: `scope.json`, D4

`rustc_codegen_llvm` is in scope. The new top-level `crates` key holds per-path scope for compiler crates, in Miri's shape
(`excluded`: files, or directories with everything under them; `partial`: files with listed fns), with paths relative to
`compiler/<crate>`. Each path was checked in the crate at the pin:

| Path | Fns | Reason |
|---|---|---|
| `src/llvm/ffi.rs` | 387 | the seam: its functions become the IR model's (D4, D5) |
| `src/llvm/enzyme_ffi.rs` | 60 | Enzyme FFI, `-Zautodiff` (D18) |
| `src/builder/autodiff.rs` | 3 | `-Zautodiff` |
| `src/typetree.rs` | 3 | Enzyme type trees, `-Zautodiff` |
| `src/builder/gpu_offload.rs` | 21 | `-Zoffload` |
| `src/llvm/offload_ffi.rs` | 8 | `-Zoffload` FFI |
| `src/coverageinfo` (7 files) | 36 | `-Cinstrument-coverage` |

1,338 fns in the crate − 387 − 131 = **820 in scope**, plan-m7 §2b's figure. 44 of the crate's 57 `.rs` files are in scope.
`rustc_llvm` stays in `excluded`. `partial` is empty for now.

Note for the model lanes: excluding `ffi.rs` whole also takes out its 6 fns with Rust bodies (`Bool::from_bool` :50,
`Bool::is_true` :55, `Debug for Bool::fmt` :63, `ToLlvmBool::to_llvm_bool` :78/:83, `RawEnum::to_rust` :103). The owner's
decision excludes the file, so they are the model's to provide, like the extern fns.

## Item 2: `coverage.ts`

Miri's `MiriScope`/`miriExcluded`/`miriFiles`/`miriFns` became `PathScope`/`pathExcluded`/`scopeFiles`/`scopeFns` in
`scripts/lib/scope.ts`. Every compiler crate's row now goes through `scopeFiles`/`scopeFns` with its `PathScope` (from
`crates`, or nothing excluded), and Miri's row through the same functions, so there is no special case left. Markers on excluded
paths are still checked against upstream (as Miri's were). `--missing` notes an excluded path or a partial file of any crate.
The full run and `--check` refuse a scope entry that names nothing (`scopeErrors`, `cratesEntryErrors`): a path that does not
exist, a non-`.rs` file, a partial fn the file lacks, a partial file under an excluded path, an empty reason, a `crates` entry for
an excluded or unknown crate. A typo would otherwise change a denominator in silence. Miri's existing entries pass.
Crates with a `crates` entry show in the table even at 0 ported.

**Coverage before and after** (`bun scripts/coverage.ts`):

| | Before | After |
|---|---|---|
| TOTAL | 24,394 / 27,053 (90.17%), 66 crates | 24,394 / 27,873 (87.52%), 67 crates |
| `rustc_codegen_llvm` | excluded | 0 / 820 |
| miri | 1,506 / 1,535 | 1,506 / 1,535 |
| VENDOR | 5,307 / 17,360 | same |
| LIBRARY | 696 / 2,399 | same |
| WRAPPER (new) | n/a | 0 / 218 C++ fns, 8 files |

The TOTAL denominator grows by exactly 820, `rustc_codegen_llvm`'s in-scope fns. Comparing the two `coverage.json` files
crate by crate: no other row changed, and vendor and library are identical. I put the shared `$RUST_TS_DATA/coverage.json`
back to its earlier content after my run, so `state.ts summary` still shows main's 24,394/27,053 until root runs coverage on
the merged tree.

## Item 3: LLVM source manifest

`harness/llvm-manifest.json` pins `rust-lang/llvm-project` at `aab11ee0ea5ea9a1d462ad0bc1fae9d9bb643019` (branch
`rustc/23.1-2026-07-22`). `bun scripts/llvm-src.ts check` confirms this is the pinned rust tree's `src/llvm-project` gitlink
(`git ls-tree <pin> src/llvm-project`; `UPSTREAM.json` has no LLVM field and is not mine to edit). The 43 files (2.3 MB) are in
`$RUST_TS_DATA/llvm-src/<commit>/`:
- C API headers (`llvm/include/llvm-c/`): `Core.h`, `Types.h`, `DebugInfo.h`, `Comdat.h`, `Target.h`, `TargetMachine.h`,
  `BitWriter.h`. Every non-`LLVMRust` function `ffi.rs` declares (250) is in Core.h (215, plus the 4 `LLVMIsA*` that its
  `LLVM_DECLARE_VALUE_CAST` macro generates), DebugInfo.h (26), Comdat.h (2), TargetMachine.h (2) or BitWriter.h (1).
- Their implementations: `lib/IR/Core.cpp`, `lib/IR/DebugInfo.cpp`, `lib/IR/DIBuilder.cpp`, `lib/IR/Comdat.cpp`,
  `lib/Target/TargetMachineC.cpp`, `lib/Target/Target.cpp`, `lib/Bitcode/Writer/BitWriter.cpp`.
- The IR sources the review names, and what plan-m7 §2c needs: `IRBuilder.cpp`, `Constants.cpp`, `ConstantFold.cpp`,
  `Type.cpp`, `Value.cpp`, `ValueSymbolTable.cpp`, `Instructions.cpp`, `Function.cpp`, `Module.cpp`, `Globals.cpp`,
  `BasicBlock.cpp`, `Attributes.cpp`, `InlineAsm.cpp`, `AutoUpgrade.cpp` (`LLVMRustUpgradeIntrinsicFunction`), `Intrinsics.cpp`
  (intrinsic name mangling), and the headers `IR/IRBuilder.h`, `IR/IRBuilderFolder.h`, `IR/ConstantFolder.h`, `IR/ConstantFold.h`.
- 10 files another lane (probably `llir-core-a`) had already put in the same directory at 12:59, pinned so its markers can be
  checked: `lib/IR/AsmWriter.cpp`, `LLVMContextImpl.cpp`, `Metadata.cpp`, `DataLayout.cpp`, `include/llvm/IR/ValueSymbolTable.h`,
  `Attributes.td`, `Constants.h`, `GlobalValue.h`, `DerivedTypes.h`, `Type.h`. My downloads were byte-identical to them
  (SHA-256 checked before and after).

**Root action:** that lane also added `llvm/lib/Support/ModRef.cpp` later, which is **not** in the manifest. A `// llvm:` marker
into it fails `--check` until someone runs `bun scripts/llvm-src.ts add llvm/lib/Support/ModRef.cpp` (which edits the manifest:
a harness change, so it belongs in that lane's handoff or a root commit).

`scripts/llvm-src.ts`: `fetch` downloads missing or different files, checks each SHA-256 before an atomic rename, and refuses
a mismatch. `check` checks the gitlink and every file. `add <path>…` fetches new files at the commit (after the gitlink check)
and records their hashes, sorted, validating the manifest before replacing it. The only network use was these 43 files from
raw.githubusercontent.com, plus 14 C API headers fetched once into scratch to pick the header list.

**The `// llvm: <path>:<line> <name>` marker** (`scripts/lib/llvm-src.ts`): `--check` collects them from `src/**/*.ts`
(not `.test.ts`). It fails on a malformed one (any spacing variant), a path not in the manifest, a missing or edited file (with
the fetch command), or a line that holds no definition of `<name>`. `<name>` is the name as written (`ConstantInt::get`) or its
last segment. These markers count toward no figure: the model ports only what a reached call needs (D5), so a denominator would
mean nothing. Documented in PORTING §5c.

**Root action, gate:** the `markers` step (`coverage.ts --check --offline`) never fetches. Once `// llvm:` markers land, the
root host needs the files. They are already in the shared `.data/llvm-src/`; on a fresh host, run `bun scripts/llvm-src.ts fetch`.
With no `// llvm:` markers (today), no file is read.

The C++ finder (`scripts/lib/cpp-fns.ts`) is a small scanner, not a parser. It skips comments, strings, char literals, raw strings,
digit separators and preprocessor lines (with continuations). It treats a `{` as a definition when it opens at namespace /
`extern "C"` / class scope after `<name>(<params>) <qualifiers>`, where braces inside the parens are default arguments. Each
branch of an `#if`/`#elif`/`#else` chain is read from the state at the `#if` (ctags' rule), so alternative headers do not
unbalance braces. **Both branches' definitions are valid marker targets**, including the one LLVM 23 does not compile (e.g.
`LLVMRustwrappedIrGetName` at PassWrapper.cpp:543 and :553; :553 is the live one at LLVM 23). It finds 3,942 definitions in
the 43 files and 218 in the wrappers. I compared it with an independent line-based scan on every file. The only scan hits it did
not find were not definitions (a local variable, two lambdas inside function bodies, a comment). The extra ones it found that I
sampled were all real definitions, with the return type on the line before or a long parameter list.
Known gaps (none hit in these files): macros that expand to definitions, `template<…>` arguments that contain a `(`, K&R
definitions.

## Item 4: wrapper markers

`// rustc: compiler/rustc_llvm/llvm-wrapper/<file>:<line> <name>` (`.cpp` or `.h`, subdirectories included, so
`offload/OffloadWrapper.cpp` counts) are checked by `--check` with the same C++ finder against the checkout. Other
`compiler/rustc_llvm/` markers (its Rust files) stay unchecked, as for every excluded crate today.

**Decision: they count toward a separate WRAPPER figure, not the TOTAL.** It covers every function of `llvm-wrapper/` (218 in
8 files), not just the marked files: the wrappers are the specification of the replaced calls (plan-m7 §2b), finite and
small, so the denominator means something. `rustc_llvm` stays excluded, so the TOTAL does not move. Reported as a `WRAPPER` line
after TOTAL, as `wrapper: {ported, total, files}` in `coverage.json` (`state.ts` reads only `ported`/`total`, so it is
unaffected), with `--crate llvm-wrapper` for the per-file table and `--missing compiler/rustc_llvm/llvm-wrapper/<file>`.

Not done, possible snag: `src/rust_ts/track_caller.ts` resolves a panic frame's owner through its `// rustc:` marker and lexes
the upstream file as Rust. A `#[track_caller]` frame inside a TS function marked with a `.cpp` path would hit that. Model code is
not on a `track_caller` path today, but whoever wires `track_caller` through the model should check it.

## Evidence

- `bun scripts/coverage.ts`: before and after above.
- `bun scripts/coverage.ts --check --offline` (the gate's markers step) on the whole tree: `markers ok (24997, 0 of them in
  compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 728; llvm 0)`.
- `bun scripts/llvm-src.ts check`: `llvm-src ok: 43 files at aab11ee0ea5e (the checkout's gitlink)`.
- End to end, with temporary markers in a src file (reverted): a correct wrapper marker
  (`RustWrapper.cpp:404 LLVMRustAddFunctionAttributes`) and a correct `// llvm:` marker (`Core.cpp:3775 LLVMBuildAdd`) give
  `markers ok (24998, 1 of them in compiler/rustc_llvm/llvm-wrapper; …; llvm 1)`. Line 405 and `LLVMBuildSub` give one
  `ERROR:` each and exit 1.
- New tests: `scripts/lib/scope.test.ts` (21), `scripts/lib/cpp-fns.test.ts` (21), `scripts/lib/llvm-src.test.ts` (18),
  `scripts/coverage.test.ts` (6). All pass.
- Mutation check. 17 mutations of the new code, each run against its test file, all killed: directory exclusion matching a bare
  prefix, partial ignored, a missing excluded path accepted, a partial fn unchecked, braces in parens read as blocks, `#else` not
  restoring, the qualifier suffix unchecked, name match by any suffix, llvm hash unchecked, llvm line unchecked, a path outside the
  manifest accepted, a malformed llvm marker ignored, wrapper name unchecked, a manifest hash unchecked, a crate row ignoring
  exclusions, wrapper `--missing` through the Rust finder, the crate `--missing` note dropped. Also killed: one of these test
  files importing `common.ts` (the guard test below).
  One more mutation survived at first: dropping the finder's `=` initializer guard. The guard was redundant (a lambda's `(`
  follows `]`, never a name), and it hid a real definition: DerivedTypes.h's template constructor `FunctionCallee(T *Fn)` after
  `template <…, typename U = decltype(…)>`. I removed the guard and the operator special case it needed, and added that
  constructor as a test. Re-adding the guard now fails two tests.
- Runner unit step as the gate runs it (`unitStaticSteps` "runner unit tests": one process, the gate's env, `./scripts
  ./harness`): **512 pass, 0 fail, 0 skipped, 74.6 s** (main's last accepted gate: 446). The first run had **1 failure**,
  `scripts/lib/deps.test.ts` "cache key > uses a temp oracle cache". My test files loaded `scripts/lib/common.ts` (directly and
  through `coverage.ts`) before `deps.test.ts` set its temp `RUST_TS_DATA`, and common.ts fixes that variable when it first loads.
  The fix: `upstreamFns`'s body moved to `scripts/lib/rust-fns.ts`, `scopeOfPath` to `scope.ts`, and the checkout path comes
  from `scripts/lib/upstream-root.ts`. None of the four test files reaches `common.ts` now, and `coverage.test.ts` has a test that
  walks their import graph to keep it so. **For future runner tests:** loading `common.ts` early is order-dependent breakage
  that only shows in the one-process gate step, not when the file runs alone.
- `bunx tsc --noEmit -p .`: clean.

## Decisions for root to record

1. `harness/scope.json` `crates` (per-path scope for compiler crates, Miri's shape, paths relative to `compiler/<crate>`).
2. Wrapper markers count in a separate WRAPPER figure over all of `llvm-wrapper/` (218), not in the TOTAL.
3. `// llvm:` markers are checked, not counted.
4. The full coverage run and `--check` refuse scope entries that name nothing.
5. C++ markers may target either branch of an `#if` chain.
