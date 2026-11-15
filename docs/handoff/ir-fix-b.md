# Handoff: ir-fix-b (M7c, wave 40s): the IR model's stops in `run-pass-native` and `ir-host`

Branch `t3/add-aarch64-llvm-intrinsics` (from `2bf7435a`; no merges). Commits at the end. Only `src/rust_ts/llvm/**` and this file.

## Review round 1 (`docs/reviews/ir-fix-b.md` at `26fd05f8`: FAIL on F1; root took option (a))
- **F1 fixed: merged type names now stop by name.** `LLVMRustLinkerFree` flags the module when a named struct type the
  destination's text defines is missing from the linked text. Every destination type is used by a value the keep global retains,
  so only a merge removes one. `assert_types_unmerged` then stops in `LLVMRustPrintModule`, `LLVMWriteBitcodeToFile` and
  `LLVMRustModuleSerialize` with `llir: fat LTO merged named struct types (llvm-link's IRMover; rustc's in-process link keeps them)`.
  `LLVMCloneModule` carries the flag. Objects carry no type names, so linking and running are unchanged.
  - The fat-LTO cases, rerun by id: **run-pass-native 10/10 MATCH** (+1 UNSTABLE). In each of **ir-host, ir-run-pass and
    ir-run-pass-o0: 9 UNPORTED on that stop, 2 MATCH**, so 0 DIFF.
  - Test: link.oracle.test.ts, a destination with `%A = type {}` and `%B = type {}`. libLLVM keeps both; the model's text has one.
    All three outputs stop, a clone stops too, and a destination with distinct types is not flagged.
- **N1 fixed: touched values are decided by name, not by position.**
  - `touchedBySources` reads the sources' texts (`llvm-dis`) and follows `getLinkedToGlobal`, where locals never link by name.
    These are touched: a non-local destination declaration that a source defines (replaced); a non-local, non-appending destination
    global that a source declares or defines (moved).
  - Appending globals are not touched: `linkAppendingVarProto` puts the merged one in place, `InsertBefore = DstGV`,
    IRMover.cpp:879. The test caught the first draft treating them as moved.
  - A destination `linkonce`/`weak`/`available_externally`/`common`/`extern_weak` definition that a source also defines is
    undecidable by name, so the order falls back to llvm-link's.
  - `restoreDestinationOrder` checks that llvm-link's output starts with exactly the untouched values, and falls back otherwise.
    The second llvm-link run (`c0`) is gone.
  - The reviewer's repro (`@llvm.compiler.used = [f, g]`, `declare h` defined by a source) is in link.oracle.test.ts and gives
    libLLVM's `f,g,h`. tools.test.ts covers locals, appending globals and the weak fallback.
  - The header and PORT 1 no longer call the restore exact.
- **N2:** the doc comment now sits on `restoreDestinationOrder`.
- **N3:** ir-run-pass-o0 is listed with the fat-LTO cases (now a stop, not a DIFF). PORT 5 and the code comment now say that
  `--emit=llvm-bc -Clto=fat` writes the serialized buffer to the user's `.bc` (write.rs:984), and that bitcode bytes are not
  compared (D2).
- **N4:** the `.N` suffix of a renamed source local is listed in PORT 1-2. `llvm-link`'s new module starts `LastUnique` at 0, while
  rustc's destination keeps its count. The result is a DIFF only.
- **Re-run:**
  - `bunx tsc` clean; `coverage.ts --check` ok (27227); unit run **443 pass, 0 fail**.
  - Samples unchanged from round 0: run-pass-native 196, ir-host 196, ir-run-pass 194, 0 lost (runs `irfixb-r2-*`). This seed's
    samples hold no fat-LTO case, and the by-id runs above cover all 11.

## Summary
- **All three named stops are gone**, and so is every other IR-model stop of the gate's `run-pass-native`:
  1. the aarch64 intrinsic table (`llvm.aarch64.isb`, std's `spin_loop`): 53 run-pass-native and 56 ir-host cases, **all MATCH**;
  2. `LLVMRustModuleCost`, and behind it the whole fat-LTO path (serialize, `LLVMRustLinker*`, `LLVMRustRunRestrictionPass`):
     run-pass-native **10 of 10 MATCH**; the 11 cases in each IR suite (ir-host, ir-run-pass, ir-run-pass-o0) go to **2 MATCH and
     9 UNPORTED on a named stop** (merged type names, PORT 2);
  3. `FoldBitCast` scalar-to-vector: **2 of 2 MATCH** in both suites.
- **Root's extra items for cg-intrinsic-b, all four done** (the masked/reduction signatures, `aarch64-unknown-linux-gnu`, global
  features in `LLVMRustOptimize`, FoldBitCast). In a scratch merge with `t3/port-simd-vaarg-abis`, `simd_model.rs` and the
  aapcs `va_targets.rs` case take the IR-comparison branch and match the oracle, and `tests/ui/simd/` run-pass-native is **39/39 MATCH**.
- **One more, found by scanning the gate:** `DataLayout::getABITypeAlign` of a struct (ir-run-pass-o0): 3 of 3 MATCH.
- **What is left in run-pass-native is outside the model:** `LLVMCreateDIBuilder` (llir-di), `cg-asm`, `-Clto=thin` (D8),
  cg-intrinsic-b's SIMD arms (merged with its branch they MATCH), unstable cases.
- **`ffi.ts` regenerated** (`bun tools/llir/ffi_gen.ts`) twice: `LLVMRustModuleCost`, then `LLVMRustLinkerNew/Add/Free` and
  `LLVMRustRunRestrictionPass` bound to tools.ts. `handles.ts`'s `Linker` is now tools.ts's `RustLinker`.

## Before and after
"Before" is the accepted gate `gate-20261114-162816-root-vc2v` on the same case ids (it tested `241df65f`; `241df65f..2bf7435a`
changes only `harness/baseline/`). "After" is this branch at `98400513` (and the marker-only follow-up), `RUST_TS_AGENT=ir-fix-b`, `--sample 200 --jobs 6`.

| suite (sample 200) | before MATCH | after MATCH | lost | left |
|---|---|---|---|---|
| `run-pass-native` | 188 (94.0%) | **196 (98.0%)** | 0 | DIBuilder 1, `-Clto=thin` 1, cg-intrinsic-b `simd_bswap` 1, UNSTABLE 1 |
| `ir-host` | 188 (94.0%) | **196 (98.0%)** | 0 | the same three stops; DIFF `lto/thin-lto-inlines.rs` (D8 ThinLocal, `.llvm.<hash>`) |
| `ir-run-pass` | 192 | **194** | 0 | DIBuilder, cg-asm, `-Clto=thin`, kcfi, `simd_bswap`; DIFF `thin-lto-inlines.rs` |
| `mir-o2` | 200 | 200 | 0 | |
| `ir-hello` | 2 | 2 | 0 | |

Whole-gate stop lists rerun by id (all of a stop's cases, not a sample):

| stop (gate) | suite | cases | after |
|---|---|---|---|
| aarch64 intrinsic table | run-pass-native | 53 (+2 UNSTABLE) | 53 MATCH |
| aarch64 intrinsic table | ir-host | 56 | 56 MATCH |
| `LLVMRustModuleCost` | run-pass-native | 10 (+1 UNSTABLE) | 10 MATCH |
| `LLVMRustModuleCost` | ir-host | 11 | 2 MATCH, 9 UNPORTED (merged types, by name) |
| `LLVMRustModuleCost` + `FoldBitCast` | ir-run-pass | 13 | 4 MATCH, 9 UNPORTED (merged types) |
| `LLVMRustModuleCost` | ir-run-pass-o0 | 11 | 2 MATCH, 9 UNPORTED (merged types) |
| `FoldBitCast scalar-to-vector` | run-pass-native, ir-host | 2 + 2 | all MATCH |
| `getABITypeAlign of Struct` | ir-run-pass-o0 | 3 | 3 MATCH |

So the gate's `run-pass-native` should rise by 65 (53 + 10 + 2): **3277 → 3342 of 3396 (98.4%)**, above M7c's 98%.

**The 9 fat-LTO cases per IR suite (ir-host, ir-run-pass, ir-run-pass-o0) stop by name** (review F1): llvm-link merged named
struct types of the destination (`%"alloc::alloc::Global" = type {}` and `%"core::marker::PhantomData<..>" = type {}`), see PORT 2.
They were UNPORTED before as well. Their programs MATCH in run-pass-native.

## What changed (all `src/rust_ts/llvm/`)
1. **aarch64 intrinsic table** (`ff67992b`). `gen_intrinsics_aarch64.ts` (hand-run, `--check`) writes `intrinsics_aarch64.ts` from
   the oracle's libLLVM.dylib, as `gen_intrinsics_x86.ts` does; the two share `readTargetTable` / `renderTargetTable` (the x86 file
   regenerates byte for byte, `--check` passes for both). Offset 534 (the first target table). `findTargetSubtable` and `entry`
   know it; `llvm.aarch64.isb`'s signature is `IntrinsicsAArch64.td:100` (`Intrinsic<[], [llvm_i32_ty]>`).
   intrinsics.oracle.test.ts re-reads the table and offset from libLLVM and looks up every aarch64 name and variants of it.
2. **`LLVMRustModuleCost`** (`bc1e92d8`): upstream is `std::distance(functions())`, the number of functions, **not** an
   instruction count (the brief's wording). It picks fat LTO's base module (`lto.rs:247-254`) after the pre-LTO opt run, so it counts
   the `define` / `declare` lines of `module_text`. The ported `Iterator::max` tie rule (later index wins) was already in lto.ts.
3. **`FoldBitCast` scalar-to-vector** (`bc1e92d8`): `ConstantExpr::getBitCast(ConstantVector::get(V), DestTy)`, both arms. Test:
   folder.oracle.test.ts, ints and floats (zero, all ones, -0.0) to vectors of several shapes.
4. **Fat LTO** (`28f33fd8`):
   - `LLVMRustModuleSerialize(is_thin = false)`: `forceFullLTOSummary` (a `ThinLTO` flag of 0 appended to `!llvm.module.flags`,
     PassWrapper.cpp:661), `assign-guid`, then bitcode by `opt --module-summary -preserve-bc-uselistorder=false`.
   - `LLVMRustLinkerNew/Add/Free`: see PORT 1-2. link.oracle.test.ts compares the model with libLLVM's own `LLVMLinkModules2`
     (the same `linkInModule`) on a destination built to break a plain llvm-link, and it found two bugs on its first run.
   - `LLVMRustRunRestrictionPass`: opt's `internalize` pass with `-internalize-public-api-file`; see PORT 3.
5. **Root's items** (`c9d8ca76`):
   - `llvm.masked.{load,store,gather,scatter}` (Intrinsics.td:2723-2741), `llvm.vector.reduce.f{add,mul}` (:2911-2914); new
     descriptor kinds `llvm_anyvector_ty` (:610), `llvm_any_vector_float_ty` (:588) and `LLVMVectorOfAnyPointersToElt` (:563),
     which is a *partially dependent* type: it takes an overload slot of its own (Intrinsics.td:476-487) and decodes as that slot
     (Intrinsics.cpp:590), so a gather mangles as `llvm.masked.gather.v4f32.v4p0`. intrinsics.oracle.test.ts checks all six
     declarations (two overload sets each) against libLLVM.
   - `aarch64-unknown-linux-gnu` in `NORMAL_TRIPLES` (capi.oracle.test.ts checks it normalizes to itself).
   - Global target features in `LLVMRustOptimize`: see PORT 4. llc (`LLVMRustWriteOutputFile`) keeps its stop.
6. **`DataLayout::getAlignment(Ty, abi)`** (`98400513`): `Module.abiTypeAlign` for pointers, arrays, structs (`StructLayout`'s
   alignment and the layout's `a` spec), integers and floats (`f` specs, else the power-of-two rule); `getPointerAlignment` of a
   declaration uses it. folder.oracle.test.ts adds struct, packed, empty, nested and float declarations and two layouts.

## PORT decisions
1. **Fat LTO links with one `llvm-link` run at `LLVMRustLinkerFree`** (`LLVMRustLinkerAdd` keeps a copy of the bytes; rustc parses
   at Add and returns false on a parse error, here a parse error is the port's bug and ICEs at the link, D16). lto.rs calls Free
   right after its last Add. llvm-link runs every input through `linkInModule(Flags::None)` in order, but links the destination
   too, into an empty module. The model undoes what that first link changes where IRMover's code allows it; otherwise the
   difference shows:
   - **dead definitions:** the destination's input gets one extra external global referring to all its functions and globals
     (`keepAllLine`: not intrinsics or `llvm.*` globals, not other address spaces); its line is removed from the result;
   - **order:** a link moves nothing of its destination except replaced values and non-appending globals a source names. The model
     tells those by name from the sources' texts (`touchedBySources`, review N1), puts the untouched values back in the
     destination's order, and checks that llvm-link's result starts with exactly those (`restoreDestinationOrder`). Where names
     cannot decide (a weak or linkonce destination definition a source also defines), or the check fails, or the text has an alias,
     an ifunc or an unnamed global, the order stays llvm-link's: a DIFF, never a MATCH;
   - named metadata likewise (`!llvm.module.flags` comes last otherwise; `restoreNamedMetadataOrder`), then one `opt -S` (no passes)
     reprints it so metadata numbers are AsmWriter's;
   - `source_filename` put back; `-disable-debug-info-type-map` (rustc's codegen context has no ODR type map); an llvm-link warning
     stops by name (rustc would print it through its diagnostic handler);
   - **not undone: a renamed source local's `.N` suffix** (review N4). The suffix comes from the module's `ValueSymbolTable`
     counter (`LastUnique`), which starts at 0 in llvm-link's new module, while rustc's destination keeps the count from its codegen
     and pre-link passes. A suffix can differ; that is a DIFF only, and none of the 11 cases shows one.
2. **llvm-link's first link merges the destination's own isomorphic named struct types** (`IdentifiedStructTypeSet::findNonOpaque`),
   which rustc's in-place link never touches. It changes type names only, and it cannot be undone from the text: that would need
   IRMover's type mapping, which no pinned tool runs on the destination itself (there is no `llvm-lto`). **It stops by name** where
   types reach output (review F1, root's option (a)). The module is flagged when a destination type name is missing after the link,
   and `LLVMRustPrintModule`, `LLVMWriteBitcodeToFile` and `LLVMRustModuleSerialize` stop on the flag. Codegen to objects and
   linking go on.
3. **`LLVMRustRunRestrictionPass` = `opt -passes=internalize -internalize-public-api-file=<f>`**: the same `internalizeModule`,
   with `PreserveAPIList` matching glob patterns; each symbol is escaped (`\` before `\*?[]{},`) so it matches only itself
   (checked on opt with `a*b`, `x{y,z}`, `p[q]\r`). A name with a line break stops.
4. **Global target features in `LLVMRustOptimize`:** opt runs without `-mattr` when every definition's own `target-features` starts
   with the machine's features (`definitions_carry_global_features`). rustc writes the global features first on every function it
   defines (`target_features_attr`, attributes.rs:440), and a target machine reads a function's subtarget from that attribute,
   taking its own string only when it is absent (`AArch64TargetMachine::getSubtargetImpl(const Function &)`). A definition without
   it (`__rust_try`) keeps the stop; llc keeps its stop (llc's `-mattr` appends to every function).
5. **`LLVMRustModuleSerialize` for fat LTO:** the summary's module path is opt's `<stdin>`. Fat LTO's linker reads the module, not the
   summary. `--emit=llvm-bc -Clto=fat` writes the same buffer to the user's `.bc` (write.rs:984), and bitcode bytes are not compared
   (plan-m7 D2), so this cannot show in a suite (review N3).
6. **`LLVMRustModuleCost` reads `module_text`** (tools.ts header N5): a function per `define` / `declare` line (AsmWriter.cpp:4166-4173).

## `unported(...)` left or added
- `llir: the <target> intrinsic table` for targets other than x86 and aarch64 (unchanged); `llir: the signature of <name>` for
  any other intrinsic (`llvm.aarch64.dmb` etc.).
- `llir: forceFullLTOSummary of a module without !llvm.module.flags` (rustc gives every module flags).
- `llir: fat LTO merged named struct types (llvm-link's IRMover; rustc's in-process link keeps them)` (review F1; `LLVMRustPrintModule`,
  `LLVMWriteBitcodeToFile`, `LLVMRustModuleSerialize`).
- `llir: LLVMRustLinkerAdd with a linker diagnostic ...`; `llir: LLVMRustRunRestrictionPass with a symbol name holding a line break`.
- `llir: LLVMRustOptimize with global target features ...` when a definition lacks them; `llir: LLVMRustWriteOutputFile with global target features ...` (unchanged).
- `llir: DataLayout::getABITypeAlign of <FixedVector|ScalableVector|...>`; `llir: data layout float spec ...`, `llir: data layout aggregate spec ...` for spec shapes not parsed.
- `llir: Value::getPointerAlignment of a defined global variable without an alignment` (unchanged; needs `getPreferredAlign`).

## Coverage
- `bun scripts/coverage.ts --check`: markers ok (27227; 82 in llvm-wrapper; llvm 528).
- WRAPPER figure: **82/197** (was 75): `RustWrapper.cpp:1487 LLVMRustModuleCost`, `Linker.cpp` 4/4 (`RustLinker`,
  `LLVMRustLinkerNew`, `LLVMRustLinkerFree`, `LLVMRustLinkerAdd`), `PassWrapper.cpp:661 forceFullLTOSummary`,
  `PassWrapper.cpp:1180 LLVMRustRunRestrictionPass`. One new `// llvm:` marker: `DataLayout.cpp:871 DataLayout::getAlignment`.

## For root
- **Pin** (`bun scripts/llvm-src.ts add ...`); cited in comments, read at the pin from raw.githubusercontent.com:
  - `llvm/include/llvm/IR/IntrinsicsAArch64.td` (the `isb` signature);
  - `llvm/lib/Linker/IRMover.cpp`, `llvm/lib/Linker/LinkModules.cpp`, `llvm/include/llvm/Linker/Linker.h`,
    `llvm/tools/llvm-link/llvm-link.cpp` (PORT 1-2);
  - `llvm/lib/Transforms/IPO/Internalize.cpp` and `llvm/lib/Support/GlobPattern.cpp` (PORT 3; the review's addition);
  - `llvm/lib/Target/AArch64/AArch64TargetMachine.cpp` (PORT 4's `getSubtargetImpl`), and `llvm/lib/CodeGen/CommandFlags.cpp`
    (already cited by llir-tools for `-mattr`).
- **`llvm-link`'s hash in `scripts/lib/llvm-tools.ts`** (cg-lto-diag's request): fat LTO now runs it on every `-Clto=fat` case.
- `ffi.ts` is regenerated here; llir-di and cg-asm regenerate it too, so regenerate at integration.
- cg-intrinsic-b: once both branches are in, its two model-stop tests compare IR on their own (verified in a scratch merge, not
  committed). Its handoff's skeleton note about `simd_stop.rs` is its own.
- **The fat-LTO IR cases stop on the merged-types stop**, 9 each in ir-host, ir-run-pass and ir-run-pass-o0. Lifting it needs
  IRMover's type mapping in TS, or a link of the text in TS.
- Not mine, seen in the samples: `LLVMCreateDIBuilder` (llir-di), `cg-asm` (`codegen_inline_asm`, `mangled_name`,
  `codegen_global_asm`), `-Clto=thin` (D8), kcfi/cfi (out of scope), and the D8 ThinLocal DIFFs in ir-host / ir-run-pass
  (`sepcomp-*`, `parallel-codegen-closures`, `thin-lto-*`, `weak-works`, `no-segfault-with-multiple-codegen-units`: `.llvm.<hash>`
  promotions the no-op ThinLocal does not make).

## Evidence
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: ok.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rust_ts/ ./src/rustc_codegen_llvm/ ./scripts/lib/unit-steps.test.ts`: **440 pass, 0 fail** (44 files, 83 s, at `98400513` plus the marker).
- Added unit tests take about 2 s in all (link.oracle ~0.4 s, the new tools.test cases ~0.5 s, the rest well under).
- Runs (under `$RUST_TS_DATA/runs/`): `irfixb-s-rpn`, `irfixb-s-irh`, `irfixb-s-ir-run-pass`, `irfixb-s-mir-o2`,
  `irfixb-s-ir-hello` (samples); `irfixb-a64-*`, `irfixb-fat-*`, `irfixb-fbc-*`, `irfixb-abi-o0b` (gate stop lists by id);
  `irfixb-merge-simd` (scratch merge with cg-intrinsic-b).

## Commits
- `ff67992b` the aarch64 intrinsic table and `llvm.aarch64.isb`
- `bc1e92d8` `LLVMRustModuleCost` and FoldBitCast scalar-to-vector
- `28f33fd8` fat LTO (serialize, linker, restriction pass)
- `c9d8ca76` masked / float-reduction signatures, aarch64 Linux triple, global features in opt
- `98400513` `DataLayout::getABITypeAlign` of structs and floats
- `24295013` the `RustLinker` marker and this handoff
- review round 1 (F1, N1-N4): see the final commit list in the lane's last message
