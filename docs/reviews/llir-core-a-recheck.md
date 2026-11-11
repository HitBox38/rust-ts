APPROVE WITH NITS

# Re-check: llir-core-a review fixes (M7)

Branch `t3/implement-llir-core-contract`, fix commits `e5f3e5a5` (code) and `5c351241` (handoff). I reviewed
`git diff 2f2aa3f0..5c351241` against the first review, `docs/reviews/llir-core-a.md` (`398aef59`, REQUEST CHANGES). Sources:

- LLVM from `$RUST_TS_DATA/llvm-src/aab11ee0…/`;
- rustc and the wrappers from `$RUST_TS_DATA/rust` at `6f5da406b56`.

All runs were on AC power, with `RUSTC_ICE=0`, `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`. I did not touch the oracle
toolchain or `llvm-src/`.

**Summary.**

- **F1 is fixed.** The four flag wrappers are faithful to `PassWrapper.cpp` and `Module.cpp`. The call-site tables are complete
  and correct at the pin. The one remaining stub that `create_module` reaches, `LLVMRustSetDataLayoutFromTargetMachine`, is
  reported, and the oracle proof asserts it.
- **F2 is fixed.** Every raw pointer is `| undefined` and references stay non-null. Each implemented function handles null the
  way its C++ does, with one harmless exception (R3).
- **The nits are fixed** as the handoff describes.
- **Nothing blocks.** There are six small nits below. The weakest point: for integer module flags, replay does not itself fail on
  a wrong attribution. Only the proof's `inferredBy` assertion catches it (R1).

## What I ran

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` on the lane (`5c351241`) | clean (10 s) |
| `bun test src/rust_ts/llvm/`, 5 runs | **39 pass, 0 fail** each time, no skips; 1.07, 0.81, 0.83, 0.80, 0.81 s wall |
| `bun test ./src/std/result.test.ts` | 3 pass |
| Replaying the 4 committed scripts myself (scratch driver, not the test) | statics 483 calls replayed / 31 inferred, decls 287/21, host 306/20, pic 146/12. Skipped = {`LLVMIsMultithreaded`, `LLVMDisposeTargetMachine`} ×1; stubbed = {`LLVMRustSetDataLayoutFromTargetMachine`} ×1; `inferredBy` as in the handoff's table |
| `pic` reproduced: pinned rustc, `--target x86_64-unknown-linux-gnu -Crelocation-model=pie -Ccode-model=large -Zlarge-data-threshold=65536 --emit=llvm-ir -Cno-prepopulate-passes` | Oracle flags `!{i32 8,"PIC Level",i32 2}`, `!{i32 7,"PIE Level",i32 2}`, `!{i32 1,"Code Model",i32 4}`, `!{i32 1,"Large Data Threshold",i64 65536}`, `RtLibUseGOT`, `uwtable`, and `dso_local` on `REF` only. These are exactly `pic.script`'s `?flag` and `?dsolocal` lines. The proof test's record, recorder-transparency and N1 comparison pass for all 4 cases |
| 16 mutations of `pic.script` (below) | the expected ones fail; integer-flag misattributions do not (R1) |
| 5 mutations of a scratch `ffi.rs` (separate `RUST_TS_DATA`) | each fails `ffi.test.ts` and `bun tools/llir/ffi_gen.ts --check`; the unmutated copy passes both |
| Trial merge of `integ-w51` (`287bc0af`) into the lane (scratch branch, `--no-commit`, aborted and deleted) | merges cleanly; `coverage --check --offline` gives **exactly the 2 expected ERRORs**; tsc clean; 39/39 and 3/3 |

## 1. F1

**The wrappers match the C++.**

| Wrapper | Upstream | Model |
|---|---|---|
| `LLVMRustSetModulePICLevel` | `PassWrapper.cpp:1202`; `setPICLevel(BigPIC)` is `addModuleFlag(Min, "PIC Level", 2)` (`Module.cpp:637`, `CodeGen.h:36`) | `core.ts` calls `setPICLevel(2)`, which uses `MOD_FLAG_BEHAVIOR.Min` = 8 with an i32 |
| `LLVMRustSetModulePIELevel` | `:1206`; Max, `PIELevel::Large` = 2 (`Module.cpp:653`) | Max = 7, i32 2 |
| `LLVMRustSetModuleCodeModel` | `:1210`; `fromRust`: None → return, else the `CodeModel::Model` value (`PassWrapper.cpp:138`, `CodeGen.h:31`); Error (`Module.cpp:667`) | `None` returns; otherwise `indexOf` in the Tiny…Large order; Error, i32 |
| `LLVMRustSetModuleLargeDataThreshold` | `:1218`; Error, **i64** (`Module.cpp:685`) | Error, `getIntType(64)`, `BigInt.asUintN(64, …)` |

- **The markers are right.** All four `// rustc:` lines name the wrapper. The four `// llvm:` lines (`Module.cpp:637/653/667/685`)
  name the `Module::set*` definitions.
- **Only one stub remains in `create_module`.** I listed every `LLVM*` name in `create_module` (`context.rs:184-597`) and looked
  each up in `IMPLEMENTED`. All are implemented except `LLVMRustSetDataLayoutFromTargetMachine`. The handoff says this in its
  stub list and in PORT decision 13.
- **The flag-site tables are complete.** `rustc_codegen_llvm` has 43 `add_module_flag_u32/_str` call sites:
  - 39 in `context.rs`;
  - 3 in `debuginfo/mod.rs`;
  - 1 in `builder/gpu_offload.rs`.

  The only other module-flag producers are the four dedicated wrappers (`context.rs:240/248/259/264`). Two sites take their key
  from elsewhere: `:514`, the target's small-data flag (Error), and `:593`, `-Z llvm-module-flag` (any behaviour). That leaves
  41 literal sites.
- **The table entries are correct.** A script pulled out the key, behaviour and kind of all 43 sites, and **all 41 `FLAG_SITES`
  entries match** (`cfguard` correctly twice). I also read 10 by hand:
  - `context.rs:271`, `:314` (`uwtable` Max), `:393`, `:488`, `:514`, `:541` (`target-abi` str Error), `:593`, `:830`;
  - `debuginfo/mod.rs:75` (`Dwarf Version` Max);
  - `gpu_offload.rs:46` (`openmp` Max).

  The `FLAG_WRAPPERS` conditions match `context.rs:236-266`: PIC for Pic|Pie; PIE for Pie or all-executable crates; code model
  always, which is a no-op for None; threshold only when `-Zlarge-data-threshold` is given.
- **Other attributions check out.** `?global` replays as `declare.rs:97` (`LLVMRustGetOrInsertGlobal`) or `declare.rs:113`
  (`…InAddrspace`). The `?attr` creators' lines `llvm/mod.rs:110/114/118/122/126/130/134/232` and `AddFunctionAttributes` at
  `:43` all point at the right functions.
- **`?dsolocal` is right.** rustc's only producer is `assume_dso_local` (`mono_item.rs:233`). It is called from `callee.rs:149`,
  `consts.rs:231/419/535` and `mono_item.rs:51/100`, always on a global variable or function, never on an alias, and always
  with `true`. `dsoscan` looks at exactly those.

**Does replay fail on a wrong attribution?** These mutations of `pic.script` fail:

- a `Code Model` value of 9 ("is no CodeModel::Model");
- an unknown string flag;
- a string flag with the wrong behaviour (`target-abi` Warning);
- a `?function`;
- an `?attr str`;
- a wrong out-parameter (`&25` where the oracle had `&26`).

These do not fail replay:

- `PIE Level` Max→Min;
- `PIC Level` value 1;
- `Code Model` with Warning;
- `uwtable` Max→Min;
- a key typo (`RtLibUseGot`).

Each of these is accepted and counted as `LLVMRustAddModuleFlagU32 (key from the target or -Z llvm-module-flag)`. The proof
catches them only because it asserts the exact `inferredBy` key set (`proof.oracle.test.ts:85`, `:100`). See R1. Two more
mutations are not caught by replay but would fail the N1 comparison: `?global … 1` (address space 1, which goes to
`…InAddrspace`) and a dropped `?dsolocal`.

**`LLVMRustSetDataLayoutFromTargetMachine`** goes to `ReplayResult.stubbedEffects` and is not counted in `inferredBy`. The
oracle proof asserts `stubbedEffects ⊆ {LLVMRustSetDataLayoutFromTargetMachine}`. The committed-script test does not (R4).

## 2. F2

**The generator's types.** I mapped every pointer-typed parameter and return type in `ffi.rs` through `tsType`. Every raw pointer
to a handle, `c_char`, `c_uchar` or `u8` is `| undefined`. The only raw pointers that are not:

- arrays (`*const &T`, `*const *const c_char`, `*const u64`, `*const size_t`, `*const c_uint`, coverage structs) map to
  `readonly T[]`, under PORT decision 3, which ports null with length 0 as `[]`;
- `*mut &T` out-arrays map to `T[]`;
- `*mut size_t` and `*mut c_uint` out-parameters map to `MutRef`;
- `c_void` and `*mut c_char` map to `unknown`.

References and `NonNull` stay non-null. All of the first review's call sites now accept `undefined`:
`LLVMSetCurrentDebugLocation2`'s `Loc`, `LLVMRustConstPtrAuth`, `LLVMRustDIBuilderCreateFile`'s `Source`,
`LLVMRustWriteOutputFile`'s `DwoOutput`, `LLVMRustOptimize`'s paths, and `LLVMCreateStringAttribute`'s value. Since `bind<F>`
returns `F` and the export is annotated, tsc forces each implementation to accept `undefined` too.

**The implemented functions match the C++ on null.** I checked each one in `Core.cpp` and `Comdat.cpp`:

- **Treated as `StringRef(const char*)`, so null becomes `""`** (`StringRef.h:94` is `Str ? string_view(Str) : string_view()`):
  - `LLVMModuleCreateWithNameInContext` (`new Module(StringRef)`), `LLVMSetDataLayout`, `LLVMAddNamedMetadataOperand`;
  - `LLVMStructCreateNamed`, `LLVMSetSection`, `LLVMGetNamedGlobal`, `LLVMGetOrInsertComdat`.
- **Treated as a `Twine` from a null pointer, which crashes in the oracle and is an error here** (`Twine.h:257` reads `Str[0]`):
  `LLVMAddGlobal`, `LLVMAddAlias2`, `LLVMAddFunction`.
- **`StringRef(ptr, len)`:** null with length 0 is `""`; null with a non-zero length is undefined behaviour in C and an error here.
  This applies to `bytesArg`'s users: `LLVMCreateStringAttribute` (`Core.cpp:231`), `LLVMSetValueName2`, the module flags,
  `LLVMMDStringInContext2`, `LLVMGetMDKindIDInContext`, `LLVMConstStringInContext2`, `LLVMRustGetOrInsertGlobal*`,
  `LLVMRustGetNamedValue` and `LLVMGetOrInsertFunction`.
- **`LLVMRustSetNormalizedTarget(null)`** stops with `unported` (`Triple::normalize("")`), a stop rather than a guess.
- **`LLVMRustPrintModule(null)`:** see R3.

## 3. Nits from the first review

- **N1, over-uniquing (fixed).** `bind` (`replay.ts`) keeps `ids: Map<object, number>`. It throws "over-uniquing" when one object
  is returned for a second handle and "under-uniquing" when a handle comes back as a different object. Unit tests cover both.
  - The recorder's `forget` (`record.ts:128`) retires a handle after `LLVMDeleteGlobal` or `LLVMDeleteFunction`, once the call has
    been logged. Replay leaves the dead object in `ids`, which is harmless because the model never reuses objects.
  - **Limitation (not new):** LLVM can also free a constant (`handleOperandChange` → `destroyConstant`) and reuse its address. That
    would show as a false "under-uniquing" error, a failure rather than a hidden pass. Fill lanes doing RAUW of constant
    expressions may hit it.
- **N2, out-parameters (fixed).** The recorder logs `&<value>` after the call: integer out-parameters, `&mut Option<&T>`, and the
  two filled arrays, counted with `LLVMCountParamTypes` and `LLVMCountStructElementTypes`. `checkOut` compares each. My mutation
  `&26`→`&25` fails as it should. The committed scripts carry 87–103 such answers each.
- **N3, late effects (fixed).** The `LLVMContextDispose` wrapper runs `scan(1,a0)` and then `dsoscan(a0)` before the call
  (`record.ts:205`). These read every module of that context, from any thread, and tag the lines with the builder's thread number.
  The silent `scan(0,0)` after each recorded call stops a call's own effects from being taken for a wrapper's. I checked that no
  wrapper in `RustWrapper.cpp` or `PassWrapper.cpp` calls an interposed `ffi.rs` C function: the three C API calls they make are
  not in `ffi.rs`. So the silent sync cannot swallow part of a wrapper's effects. Order within one gap remains the scan's order,
  as documented.
- **N7, 64-bit integers (fixed).** `u64`, `c_ulonglong` and `i64` are always `bigint`, `&mut u64` is `MutRef<bigint>`, and the
  name-based rule is gone. `ArrayType.numElements` is `bigint`, and `elementCount` stops above 2^53.
- **N9, type attributes (fixed, with R2).** The type finder now visits `Attribute.type` for every function attribute set, and the
  `TypeFinder.cpp:34` marker is right. The order it visits them in is not LLVM's (R2).
- **N10, the spelling note (fixed).** It is at `trace.ts` `builtAnswer` and at `LLVMRustWriteValueToString`. Telling the harness
  owner about masking float `const` answers is still root's job.
- **The other nits:**
  - N4: attribute sets are compared by `memcmp` of the attribute pointers.
  - N5: the comments are corrected.
  - N6: skipped and stubbed effects are asserted (see R4).
  - N8: `Attribute.slot` is `kind:` or `str:`.
  - N11: `GEPNoWrapFlags.h:28-29,50-51` gives `InBoundsFlag|NUSWFlag` = 3, which matches `core.ts:561`.
  - N12: the generator moved.
  - N13: there is a PORT note.
- **The new `?dsolocal` line** is read from observation only: `LLVMPrintValueToString` of the oracle's own value, parsed in
  `printedDsoLocal` (`record.ts:147`). No model or rustc logic is involved.
  - **Why it is robust:**
    - LLVM prints `dso_local` exactly when `isDSOLocal() && !isImplicitDSOLocal()`, right after the linkage. So within the first 3
      tokens after `@name = `, `declare ` or `define ` is enough.
    - Leading `;` comment lines (`; Function Attrs:`) are skipped.
    - Quoted names are skipped. LLVM escapes `"` in a name as `\22`, so skipping one character after `\` is safe.
    - Deleted values are never printed, because their handles are retired.
    - It records the final state, which is what the printed IR shows. In `pic`, `PIE` loses `dso_local` when rustc replaces the
      global, and the oracle IR agrees.
  - **Limits:** aliases are not scanned, but rustc never sets `dso_local` on one. The line also depends on rustc calling
    `LLVMContextDispose`, which it does in every proof case.

## 4. The generator move

- `tools/llir/ffi_gen.ts` reads `src/rust_ts/llvm/impl_modules.ts` (`implMap` imports it). It writes into `MODEL_DIR`, and its
  headers say `tools/llir/ffi_gen.ts`.
- **The staleness test still works.** I used a scratch `RUST_TS_DATA` holding only a copy of `ffi.rs`:
  - The unmutated copy passes: 4/4, and `--check` reports "contract up to date: 381 fns, 33 enums, 4 bitflags".
  - Each mutation fails `ffi.test.ts`, and `--check` prints `ERROR: stale contract`:
    - `LLVMConstInt`'s `N: c_ulonglong` changed to `c_uint`;
    - `LLVMSetSection`'s `*const c_char` changed to `*const c_uchar`;
    - a parameter renamed;
    - a `CodeModel` variant added;
    - `LLVMRustSetModulePIELevel` removed.
  - The last two also fail the independent arity scan. The scratch copy has been deleted.

## 5. Findings

No must-fix findings.

## 6. Nits (new)

- **R1. Replay accepts any unmatched integer module flag** (`replay.ts:444-455`).
  - An integer `?flag` that matches neither table goes to the fallback "`key from the target or -Z llvm-module-flag`" bucket. So
    replay alone does not fail on a wrong behaviour, value or key (five mutations above). The proof and the committed-script test
    catch it only through the exact `inferredBy` key-set assertion, and only for keys, not counts: a second misattributed flag in
    a case that legitimately uses the fallback would pass.
  - The fallback stands for real producers (`context.rs:514`, `:593`), so this is not wrong. But a fill lane replaying a new
    recording gets no error unless it copies that assertion.
  - Suggestion: `replay` takes the case's `-Z llvm-module-flag` keys (and the target's small-data key), and throws on any other
    unmatched integer flag.
- **R2. The type finder visits attribute sets in insertion order, not `AttributeList` order** (`printer.ts:529` iterates
  `f.attributes.values()`, a `Map` filled in the order rustc first touched each index).
  - `TypeFinder::incorporateAttributes` walks the list as function, return, param 0, param 1, and so on.
  - Probe: I added `byval(%A)` to param 1 first, then `byval(%B)` to param 0. The model prints `%A = type` before `%B`. LLVM
    (`opt -S`, and `llvm-as | llvm-dis` of the model's own file) prints `%B` first.
  - The N1 normal form re-prints through `opt`, so the comparison is unaffected. Only the raw text is not faithful.
  - Fix: iterate `FUNCTION_INDEX`, then 0, then 1… (the printer already reads them that way, `printer.ts:429-444`).
- **R3. `LLVMRustPrintModule(null)` throws a JS `Error`** (`core.ts:1018`). The C++ (`PassWrapper.cpp:1154`) opens
  `raw_fd_ostream("")`, which fails, sets the last error and returns `Failure`. rustc never passes null here, but the model should
  either return `Failure` like the oracle or stop with `unported`, not invent a third behaviour.
- **R4. The handoff overstates the committed-script test.** Handoff line 144 says "The committed-script test asserts the same",
  but `proof.oracle.test.ts:94-101` does not assert `stubbedEffects`. Add the line, or correct the handoff.
- **R5. A comment gives the wrong reason** (`replay.ts:339-340`). It says element type is "not decodable from the C API's view".
  It is decodable: it is a type attribute, and the old code recreated it. The real reason a function-level `elementtype` has no
  rustc producer is that rustc only puts it on call sites (`abi.rs:754`, `apply_to_callsite`). Throwing is correct; only the
  comment is wrong.
- **R6. The handoff's limitation list could add one entry:** freed-and-reused constant addresses give a false under-uniquing
  error (§3, N1).

## 7. Manifest additions root must make (`bun scripts/llvm-src.ts add …`)

All of these are already fetched under `$RUST_TS_DATA/llvm-src/aab11ee0…/`, and none is in `harness/llvm-manifest.json` today. I
grepped every LLVM path and basename the lane's files cite. All the rest (`Core.cpp`, `Module.cpp`, `AsmWriter.cpp`,
`Constants.cpp`, `ConstantFold.cpp`, `Comdat.cpp`, `Function.cpp`, `Globals.cpp`, `GlobalValue.h`, `Metadata.cpp`, `Type.cpp`,
`Value.cpp`, `ValueSymbolTable.cpp`) are already in the manifest.

**Required, so that `coverage --check --offline` passes after the merge.** These are the exact 2 ERRORs I got on the trial merge:

- `llvm/lib/IR/LLVMContext.cpp`: `ir.ts` marker `:280 LLVMContext::getMDKindID`. Verified: line 280 is the definition.
- `llvm/lib/IR/TypeFinder.cpp`: `printer.ts` marker `:34 TypeFinder::run`. Verified: line 34 is the definition.

**Cited in comments or the source of a value**, so reviewers have the same files:

- `llvm/include/llvm/IR/FixedMetadataKinds.def`
- `llvm/lib/Support/StringExtras.cpp`
- `llvm/lib/Support/ModRef.cpp`
- `llvm/include/llvm/IR/Metadata.h`
- `llvm/include/llvm/IR/Module.h`
- `llvm/include/llvm/IR/Constant.h`
- `llvm/lib/AsmParser/LLLexer.cpp`
- `llvm/include/llvm/IR/GEPNoWrapFlags.h`
- `llvm/include/llvm/Support/CodeGen.h`
- `llvm/include/llvm/ADT/StringRef.h`
- `llvm/include/llvm/ADT/Twine.h`

That is 13 files in all, the same list as the handoff's.
