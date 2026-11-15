# Handoff: ir-fix-b (M7c, wave 40s): the IR model's stops in `run-pass-native` and `ir-host`

Branch `t3/add-aarch64-llvm-intrinsics` (from `2bf7435a`; no merges). Commits at the end. Only `src/rust_ts/llvm/**` and this file.

## Summary
- **All three named stops are gone**, and so is every other IR-model stop of the gate's `run-pass-native`:
  1. the aarch64 intrinsic table (`llvm.aarch64.isb`, std's `spin_loop`): 53 run-pass-native and 56 ir-host cases, **all MATCH**;
  2. `LLVMRustModuleCost`, and behind it the whole fat-LTO path (serialize, `LLVMRustLinker*`, `LLVMRustRunRestrictionPass`):
     run-pass-native **10 of 10 MATCH**; ir-host 11 cases go from UNPORTED to **2 MATCH, 9 DIFF** (below);
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
| `LLVMRustModuleCost` | ir-host | 11 | 2 MATCH, 9 DIFF |
| `LLVMRustModuleCost` + `FoldBitCast` | ir-run-pass | 13 | 4 MATCH, 9 DIFF |
| `FoldBitCast scalar-to-vector` | run-pass-native, ir-host | 2 + 2 | all MATCH |
| `getABITypeAlign of Struct` | ir-run-pass-o0 | 3 | 3 MATCH |

So the gate's `run-pass-native` should rise by 65 (53 + 10 + 2): **3277 → 3342 of 3396 (98.4%)**, above M7c's 98%.

**The 9 fat-LTO DIFFs (per IR suite) are new DIFFs, not lost MATCHes:** they were UNPORTED. Their first difference is a named struct
type (`%"alloc::alloc::Global" = type {}` against `%"core::marker::PhantomData<..>" = type {}`): see PORT 2. Their programs MATCH in
run-pass-native.

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
   too, into an empty module. The model undoes what that first link changes, where IRMover's code shows how exactly:
   - **dead definitions:** the destination's input gets one extra external global referring to all its functions and globals
     (`keepAllLine`: not intrinsics or `llvm.*` globals, not other address spaces); its line is removed from the result;
   - **order:** a link moves nothing of its destination except replaced values and globals a source refers to (moved to the end in
     source order, IRMover.cpp:1584), so the untouched prefix is put back in the destination's order, found against a second run of
     the destination alone (`restoreDestinationOrder`); named metadata likewise (`!llvm.module.flags` comes last otherwise;
     `restoreNamedMetadataOrder`); then one `opt -S` (no passes) reprints it so metadata numbers are AsmWriter's;
   - `source_filename` put back; `-disable-debug-info-type-map` (rustc's codegen context has no ODR type map); an llvm-link warning
     stops by name (rustc would print it through its diagnostic handler).
   Where a step cannot be applied exactly (an alias, an ifunc, an unnamed global, a value the keep global cannot hold), the order
   stays llvm-link's, which shows as a DIFF, never as a MATCH.
2. **Known, not fixable this way: llvm-link's first link merges the destination's own isomorphic named struct types**
   (`IdentifiedStructTypeSet::findNonOpaque`), which rustc's in-place link never touches. Type names only; code is the same. This is
   the 9 fat-LTO DIFFs per IR suite. A fix needs `linkInModule` into the destination itself, which no pinned tool does (no
   `llvm-lto`); porting IRMover is the alternative.
3. **`LLVMRustRunRestrictionPass` = `opt -passes=internalize -internalize-public-api-file=<f>`**: the same `internalizeModule`,
   with `PreserveAPIList` matching glob patterns; each symbol is escaped (`\` before `\*?[]{},`) so it matches only itself
   (checked on opt with `a*b`, `x{y,z}`, `p[q]\r`). A name with a line break stops.
4. **Global target features in `LLVMRustOptimize`:** opt runs without `-mattr` when every definition's own `target-features` starts
   with the machine's features (`definitions_carry_global_features`). rustc writes the global features first on every function it
   defines (`target_features_attr`, attributes.rs:440), and a target machine reads a function's subtarget from that attribute,
   taking its own string only when it is absent (`AArch64TargetMachine::getSubtargetImpl(const Function &)`). A definition without
   it (`__rust_try`) keeps the stop; llc keeps its stop (llc's `-mattr` appends to every function).
5. **`LLVMRustModuleSerialize` for fat LTO:** the summary's module path is opt's `<stdin>`; the only reader is the linker, which
   reads the module, not the summary.
6. **`LLVMRustModuleCost` reads `module_text`** (tools.ts header N5): a function per `define` / `declare` line (AsmWriter.cpp:4166-4173).

## `unported(...)` left or added
- `llir: the <target> intrinsic table` for targets other than x86 and aarch64 (unchanged); `llir: the signature of <name>` for
  any other intrinsic (`llvm.aarch64.dmb` etc.).
- `llir: forceFullLTOSummary of a module without !llvm.module.flags` (rustc gives every module flags).
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
  - `llvm/lib/Transforms/IPO/Internalize.cpp` (PORT 3);
  - `llvm/lib/Target/AArch64/AArch64TargetMachine.cpp` (PORT 4's `getSubtargetImpl`), and `llvm/lib/CodeGen/CommandFlags.cpp`
    (already cited by llir-tools for `-mattr`).
- **`llvm-link`'s hash in `scripts/lib/llvm-tools.ts`** (cg-lto-diag's request): fat LTO now runs it on every `-Clto=fat` case.
- `ffi.ts` is regenerated here; llir-di and cg-asm regenerate it too, so regenerate at integration.
- cg-intrinsic-b: once both branches are in, its two model-stop tests compare IR on their own (verified in a scratch merge, not
  committed). Its handoff's skeleton note about `simd_stop.rs` is its own.
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
- the last commit: the `RustLinker` marker and this handoff
