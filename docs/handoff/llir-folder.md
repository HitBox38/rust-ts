# Handoff: llir-folder (M7, wave 40o): the IR model's folder and the fill lanes' stops

Branch `t3/llir-folder-model`, base `ba273e7f`. This lane touched `src/rust_ts/llvm/` and two test files of other lanes (below, with
the reason). Nothing in `tools/`, `scripts/`, `harness/`, baselines or `$RUST_TS_DATA/llvm-src/` changed. All runs were on AC
power with `RUSTC_ICE=0`, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`; the oracle toolchain was not touched.

## Result

All six brief items are done, and item 6 stopped at a clean boundary after about 1.5k lines of model code plus 0.7k of tests
(2.2k added in all, including the proof scripts).

| # | Item | State |
|---|---|---|
| 1 | `LLVMRustGetElementTypeArgIndex` | done (build.ts, wrapper marker RustWrapper.cpp:1668) |
| 2 | `LLVMRustCreateRangeAttribute`, `LLVMRustCreateAttrNoValue(DeadOnReturn)` | done (core.ts) |
| 3 | calling conventions by name; LLVM's attribute order | done (printer.ts `printCallingConv`; ir.ts `addAttributesAtIndex`) |
| 4 | default alignment of `atomicrmw` / `cmpxchg` | done (inst.ts); cg-builder's three expectations changed |
| 5 | `llvm.type.test`, `llvm.instrprof.increment` signatures | done (intrinsics.ts) |
| 6 | folder items from evidence | done for everything the two samples hit (below); the rest is listed under "Left" |

**Evidence from item 6** (record → replay → N1, x86_64-unknown-linux-gnu, `-Ccodegen-units=1 --edition 2021`, bins):

- **-O0, 40 cases** (every 87th of `mir-o2`'s baseline): at the start all 40 stopped in replay. Now **39 of 40 reach the oracle's N1**;
  `issue-24313` is the one left (see "Left").
- **-O2, 40 other cases**: **36 of 40 reach N1**. The other 4 are cases my scratch driver could not compile (revisions that need
  compiletest's flags, a `simd` aux path) or, for `task-comm-7`, a recording I stopped after 24 CPU-minutes (the recorder's linear
  handle lookup is quadratic in script size; see "For root").
- Comparing N1 needs one extra step on the model's side: `opt -passes=name-anon-globals`. The oracle's `.ll` is printed after
  `LLVMRustOptimize`, whose pipeline names anonymous globals `anon.<md5>.N` (as it adds `!guid`). That is the pipeline's, not the
  model's: running the pass on the model's text gives the same names (checked). See "For root".

## 1. `LLVMRustGetElementTypeArgIndex`

`build.ts` next to `LLVMRustAddCallSiteAttributes`. `CB->getIntrinsicID()` is the callee's (`dyn_cast_or_null<Function>`), an indirect
call is `not_intrinsic`. The model has no ARM intrinsic table, and this switch needs none: `intrinsics.ts` `armExclusiveIntrinsic`
answers exactly `arm_ldrex` for `llvm.arm.ldrex` / `llvm.arm.ldrex.<suffix>`, `arm_strex` likewise, nothing else. The derivation
(in its doc) walks `lookupLLVMIntrinsicByName` on the ARM names; `llvm.arm.ldrexd` is not matched. folder.oracle.test.ts reads every
ARM name out of libLLVM.dylib (only `ldrex`, `ldrexd`, `strex`, `strexd` have those prefixes) and compares the function with
`LLVMLookupIntrinsicID` on all ARM names and variants (`.p0`, `.p0.x`, `x`, truncations, other targets), plus the wrapper's answers on
real calls (0, 1, -1 for `ldrexd`, a plain function and an indirect call).

## 2. Attributes

- `LLVMRustCreateRangeAttribute` → `LLVMCreateConstantRangeAttribute` (Core.cpp:198): the words little-endian, cleared above
  `NumBits`; printed `range(i<bits> <lo>, <hi>)` with signed bounds (`APInt` `operator<<`), uniqued by value.
- `LLVMRustCreateAttrNoValue(DeadOnReturn)` → `Attribute::getWithDeadOnReturnInfo(C, DeadOnReturnInfo())` (Attributes.cpp:291), the
  int attribute `UINT64_MAX`, printed bare `dead_on_return`.
- **Attribute order**: attribute sets are kept in `AttributeComparator` order (Attributes.cpp:2150): enum kinds by `AttrKind` value,
  then strings by key. `ir.ts` `addAttributesAtIndex` is `AttributeList::addAttributesAtIndex` with `AttrBuilder::addAttribute`'s
  `lower_bound` insert / replace; `LLVMRustAddFunctionAttributes`, `LLVMRustAddCallSiteAttributes` and `setParamAlign` use it. The
  `AttrKind` values (`ATTR_KIND_ENUM`) are data read from libLLVM (`LLVMGetEnumAttributeKindForName`); the test re-reads them.

## 3. Printing

- `printCallingConv` (AsmWriter.cpp:349) on definitions, declarations and calls: names, and `cc<N>` (no space) otherwise.
  `avr_intrcc ` and `avr_signalcc ` keep AsmWriter's trailing space.
- Attribute order as above, on functions, call sites and `attributes #N` groups.

## 4. Atomic alignment

`CreateAtomicRMW` / `CreateAtomicCmpXchg` (IRBuilder.h:1981, :1968) set `llvm::Align(DL.getTypeStoreSize(Ty))` when given none, as
the C API's builders do. `getTypeStoreSize` covers integers, pointers (the layout's `p[n]:size` spec, default 64) and the IEEE float
types; other types and non-power-of-two sizes stop. The inst.ts header now says only alloca/load/store leave the default to the
parser. **`src/rustc_codegen_llvm/builder.test.ts`** (cg-builder's): the three expectations of review N1 (now lines 461, 463, 467)
carry the oracle's `, align 4`, as the brief asked; the comment there says this lane changed them.

## 5. Intrinsic signatures

`llvm.type.test` (Intrinsics.td:2795, `i1 (ptr, metadata)`) and `llvm.instrprof.increment` (:1084, `void (ptr, i64, i32, i32)`).
intrinsics.oracle.test.ts checks them against libLLVM with every other modelled signature.

## 6. The folder, from the samples

Each was the first stop of one or more sampled cases, and each is now differential-tested against libLLVM:

- **Replay of bins** (replay.ts): inferred attributes are made in the context of the function, call or block that first uses them.
  A bin's building thread makes the allocator shim's module and the CGU's in two contexts, so `res.modules[0]`'s context was wrong
  (over-uniquing). Also: `allocsize` and `allockind` decoded from their int values (`ElemSizeArg << 32 | 0xFFFFFFFF`; rustc's flags);
  `captures(none | address | address, read_provenance)` decoded (0, 0x33, 0x77); an out-parameter handle seen for the first time is
  bound like a returned one; a builder call that answers an existing value (a fold to an operand) is not place-checked.
- **Inline asm values** (`InlineAsm`, `LLVMGetInlineAsm`, Core.cpp:529): rustc's `black_box`-style `call void asm sideeffect "",
  "~{memory}"()` is in nearly every bin.
- **`and (ptrtoint @g), C`** (ConstantFold.cpp:782): `Value::getPointerAlignment` of globals (Value.cpp:993): a function's from the
  layout's `F` spec, a variable's alignment, or for a declaration the ABI alignment of its integer or integer-array type (the
  layout's `i` specs over `DefaultIntSpecs`); the 4-byte default for functions.
- **`extractelement` / `insertelement` / `shufflevector` of constants** (ConstantFold.cpp:373, :437, :479; ConstantFolder.h), and
  `ConstantVector::get` of mixed elements (`<i32 5, i32 undef>`).
- **`evaluateICmpRelation` of pointer constants** (ConstantFold.cpp:1026) in full for the model's constants, with
  `areGlobalsPotentiallyEqual` (isInterposable, `unnamed_addr`, `isSized`, `isEmptyTy`), `NullPointerIsDefined`, GEP-of-global
  relations, and the predicate table for every relation (ConstantFold.cpp:1252). This was the main -O2 stop (7 of 40).
- **Vector `icmp` / `fcmp` / GEP instructions** (`makeCmpResultType`, `getGEPReturnType`).

Name suffix uniquing (`%_4.i`, `.1`) and intrinsic name mangling were already right in every sampled case (N1 keeps local names);
nothing there needed changing.

## Evidence

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./src/std/result.test.ts`, 3 runs | **216 pass, 0 fail** each, 12.4-12.6 s (final tree) |
| `bun test ./scripts/lib/unit-steps.test.ts` | 10 pass |
| `bun scripts/coverage.ts --check --offline` | `markers ok (26583, 46 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 744; llvm 429)` |
| `bun scripts/coverage.ts --crate llvm-wrapper` | 46/197 (was 43); new: `LLVMRustGetElementTypeArgIndex`, `LLVMRustCreateRangeAttribute` and the DeadOnReturn arm |
| `bun tools/llir/ffi_gen.ts --check` | `contract up to date: 381 fns, 33 enums, 4 bitflags`; 3 stubs fewer (`LLVMRustGetElementTypeArgIndex`, `LLVMRustCreateRangeAttribute`, `LLVMGetInlineAsm`) |

**Differential tests against libLLVM.dylib** (`folder.oracle.test.ts`, new, 10 tests; review llir-folder N8 corrected the count): `ATTR_KIND_ENUM`; sorted attribute sets on 24
shuffled declarations and call sites (enum, int, type, range, string attributes, replacement); range (18 widths and bound pairs),
`dead_on_return`, captures, `allocsize`, `allockind` printing; `printCallingConv` for every convention 0..1023 on declarations and
0..130 on calls; atomic default alignment over five data layouts and ten operand types; inline asm in calls (dialect, alignstack,
unwind, escapes, uniquing); constant extract/insert/shufflevector and `and (ptrtoint @g), C` over five layouts; pointer `icmp` over
50 globals (10 linkages, `unnamed_addr`, empty and opaque types), GEPs, null and `addrspace(1)` with all ten predicates; vector
`icmp`/`fcmp`/GEP instructions; `armExclusiveIntrinsic`. Mutation checks I ran (each restored): unsorted attribute insert, numeric
calling conventions, no atomic alignment, no function 4-byte default, `unnamed_addr` ignored, address space ignored: each fails a
test.

**Record/replay cases** (`proof.oracle.test.ts`, 2 new, 13 in all, each against the oracle's N1):

- `attrs` (`-Copt-level=1`): `range(..)` on definitions and call sites, `dead_on_return`, `captures(..)`, `noalias`/`nofree`/...; its
  replay goes through `LLVMRustCreateRangeAttribute`. The recorder now interposes on `LLVMCreateConstantRangeAttribute` (which
  librustc_driver imports from libLLVM) only to learn each range's value, logged as `?attr %A range <bits> [lo] [hi]`.
- `callconv`: `win64cc` and `preserve_mostcc` definitions and calls.
- The existing `atomic` case covers the atomics.
- New **raw-text checks** for what N1 cannot see (the parser restores it): every oracle `atomicrmw`/`cmpxchg` line (`atomic`) and
  every `define`/`call` line (`attrs`, `callconv`) must be a line of the model's text, attribute group numbers and `!guid` aside. So
  these three cases check `, align N`, the attribute order and the calling-convention names byte for byte.

## Files

| File | What |
|---|---|
| `build.ts` | `LLVMRustGetElementTypeArgIndex`; call-site attributes through `addAttributesAtIndex` |
| `core.ts` | range and DeadOnReturn creators, `LLVMGetInlineAsm`, function attributes sorted; comments on the old `cc N`/hex gaps |
| `ir.ts` | `ATTR_KIND_ENUM`, `attributeLess`, `addAttributesAtIndex`; `InlineAsm`; `Module.pointerSpecBitWidth`, `functionPtrAlign`, `integerABIAlignment`; mixed `ConstantVector` |
| `inst.ts` | atomic default alignment, `getTypeStoreSize`; vector cmp/GEP result types; uses the new folds and `printCallingConv` |
| `fold.ts` | `getPointerAlignment`, the And fold, extract/insert/shuffle folds, `evaluateICmpRelation` and its helpers |
| `printer.ts` | `printCallingConv`, inline asm operands |
| `intrinsics.ts` | `armExclusiveIntrinsic`, two signatures |
| `record.ts`, `replay.ts` | range capture; replay fixes above |
| `trace.ts` | comment only (review llir-core-a N10's two false differences are gone) |
| `folder.oracle.test.ts` | new |
| `proof.oracle.test.ts`, `proof/attrs.*`, `proof/callconv.*` | two cases, raw-text checks |
| `ffi.ts` | regenerated |
| `src/rustc_codegen_llvm/builder.test.ts` | cg-builder's three atomic expectations (brief item 4) |
| `src/rustc_codegen_llvm/abi_consts.test.ts` | cg-abi-consts' tripwires on this lane's stops: `STOPS_O1` emptied (-O1 count 23 → 26, so `r_char`, `r_slice`, `r_big` are now compared with the oracle and match), and the call test expects no `LLVMRustGetElementTypeArgIndex` stop. **Outside the brief's list**: the tripwires fail by design once the stops go; I changed only those lines, and the comparisons they gate pass. Root may want the cg-abi-consts owner to look. |

## `unported(...)` left by this lane (all `llir: ...`)

- `LLVMCreateConstantRangeAttribute` of a kind other than Range, or with too few words;
- `DataLayout::getTypeStoreSize` of a non-integer/pointer/IEEE type; `llvm::Align(N)` of a non-power-of-two atomic size; an atomic
  with no insertion block;
- data layout specs the model does not parse: a pointer spec with flags or a name, an `F` or `i` spec of another shape;
- `Value::getPointerAlignment` of a *defined* global variable without an alignment (`DataLayout::getPreferredAlign`), and
  `getABITypeAlign` of a non-integer type;
- `Module::getSemanticInterposition` when a `SemanticInterposition` flag exists;
- extractelement / insertelement / shufflevector constant expressions (when the fold fails), and extractelement of a vector GEP
  expression;
- an `Attribute::AttrKind` value for a kind outside `ATTR_KIND_ENUM` (every kind the model creates is in it).

## Left (for the next llir lane)

- **`issue-24313` at -O0** (`threads-sendsync`, the one -O0 sample case not reaching N1). It took four of this lane's folds in turn
  (insertelement, shufflevector, vector compare, vector GEP) and now stops at `llir: the signature of llvm.vector.reduce.and
  (Intrinsics.td) is not in the IR model`: the vector intrinsics' signatures, the vector half's (cg-intrinsic-b, or an llir lane
  adding `int_vector_reduce_*` to intrinsics.ts `SIGNATURES`).
- The rest of the folder list, which no sampled case hit: `ptrtoaddr` (not in the model), `BlockAddress` relations, preferred
  alignments of definitions, struct ABI alignment, vector GEP constant expressions.
- `LLVMRustInlineAsmVerify` is still a stub: rustc's inline-asm path calls it before `LLVMGetInlineAsm`, so a real compile (not a
  replay) of `black_box` stops there. It is D10's ("cannot be imitated exactly"); the empty-asm `~{memory}` case could be answered
  from `InlineAsm::verify` (InlineAsm.cpp) if root wants it in the model.
- `LLVMRustCreateMemoryEffectsAttr` (`memory(..)`) is still a stub; no sampled case reached it through replay (it is set at higher
  optimization levels on some functions).

## For root

- **Manifest**: no marked file is missing (`--check` is clean). Read and cited without a marker, fetched into my scratchpad only:
  `llvm/include/llvm/IR/Attributes.h` (`DeadOnReturnInfo`, :65-89), `llvm/include/llvm/IR/IntrinsicsARM.td` (:283-293),
  `llvm/include/llvm/IR/CallingConv.h` (the values), `llvm/include/llvm/ADT/APInt.h` (:2214, signed printing),
  `llvm/lib/IR/ConstantRange.cpp` (:57). Please add them so reviewers have the same files.
- **Normal form**: the oracle's IR is printed after `LLVMRustOptimize`, whose pipeline runs `name-anon-globals` (unnamed globals
  become `@anon.<md5>.N`) as well as `assign-guid`. N1 absorbs the second, not the first. Any IR suite comparing the model's
  pre-pipeline text will see `@0` vs `@anon.…` on every case with an unnamed global (most bins). Either the port's pipeline
  (`llir-tools`, D8) runs it, or N1 adds `name-anon-globals` on both sides (harness owner). I did not change `scripts/`.
- **Recorder speed**: `record.ts`'s handle lookup is a linear scan, so a large compile is quadratic (`task-comm-7` at -O2 ran 24
  CPU-minutes before I stopped it; `issue-24313` takes about 4 minutes). A hash map in the generated C would fix it; I left it for
  whoever owns the recorder's next change, since every committed script stays the same either way.
- **PORT decisions** (to record):
  1. `ATTR_KIND_ENUM` and the ARM-name facts are data read from the oracle's libLLVM, checked by tests (like the intrinsic table).
  2. `armExclusiveIntrinsic` answers `getIntrinsicID() == arm_ldrex/strex` without an ARM table (derivation in its doc).
  3. The model parses only the data layout specs it needs (`p`, `F`, `i`), each in its plain form; anything else stops.
  4. Replay infers an attribute's context from its first use.
  5. The recorder interposes on `LLVMCreateConstantRangeAttribute`, which is not an ffi.rs function, only to learn values; no call line
     is logged for it.

## Final runs (final tree)

- `bunx tsc --noEmit -p .`: clean.
- The brief's test command, three times: 216 pass, 0 fail each (12.63, 12.45, 12.37 s). `bun test ./scripts/lib/unit-steps.test.ts`:
  10 pass.
- Marker check: `markers ok (26583, 46 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 744; llvm 429)`.
- Samples (scratch driver, not committed): -O0 39/40 at N1, -O2 36/40 at N1 (the 4 others did not compile under my driver, above).

## Commits

`2ad24159` (items 1-5, proof cases), `31a99361` (differential tests), `f6e1966f` (inline asm, bin replay), `61ac3f6c` (And fold,
extract/insertelement, ConstantVector), `9e26af67` (shufflevector, pointer icmp relations), `7e500262` (vector cmp/GEP), and the commit
of this file.
