# Review: lane `ir-fix-b` (wave 40s)

Reviewer, read-only on code. Branch `t3/add-aarch64-llvm-intrinsics`, commits `ff67992b`, `bc1e92d8`, `28f33fd8`, `c9d8ca76`,
`98400513`, `24295013`, against main `2bf7435a` (`git diff 2bf7435a 24295013`). Review branch `t3/review-ir-fix-b-24295013`, at
`24295013`. Upstream was read at the pin:
- `RustWrapper.cpp`, `Linker.cpp` and `PassWrapper.cpp` (llvm-wrapper);
- `back/lto.rs`, `back/write.rs` and `back/llvm_backend.rs` (rustc_codegen_llvm), and `rustc_codegen_ssa` `back/write.rs`;
- LLVM at `aab11ee0ea5e`. These files are not yet pinned, so they were fetched raw into the scratchpad. The manifest was not touched.
  - `IRMover.cpp`, `LinkModules.cpp`, `llvm-link.cpp`, `Internalize.cpp`, `GlobPattern.cpp`, `AutoUpgrade.cpp`;
  - `AArch64TargetMachine.cpp`, `IntrinsicsAArch64.td`;
  - and the pinned `Intrinsics.td`, `ConstantFold.cpp` and `DataLayout.cpp`.

## Verdict: **FAIL** (one must-fix, F1; everything else is approval quality)

F1 is narrow. The lane knowingly emits wrong type names in fat-LTO `--emit=llvm-ir` output, and no decision covers it. Either of
two things closes it:
- the lane stops by name where those names become visible, keeping the native MATCHes; or
- root records a decision that accepts it as a known DIFF class, as was done for D8's ThinLocal no-op.

The rest holds up against the sources:
- the aarch64 table follows the x86 pattern and passes `--check`;
- `LLVMRustModuleCost` is the function count at the pin;
- the internalize pass keeps exactly rustc's list;
- `FoldBitCast` and `getABITypeAlign` follow LLVM arm for arm;
- the global-features rule is the narrower trigger that review llir-tools F2 itself suggested, and it is sound.

The fat-LTO DIFFs are type names only. I confirmed this on two full modules, not just the first line. Every sample is clean:
- no protected case lost in any of the five suites;
- all five spot checks MATCH;
- all four mutations fail a test.

A re-check needs only F1, plus whichever nits the lane takes.

## Commands (AC power, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, `.env.local` from integ-w39, `RUST_TS_AGENT=review-irfixb-c7`)
| command | result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun scripts/coverage.ts --check` | `markers ok (27227, 82 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5392; library 745; llvm 528)` |
| `bun test ./src/rust_ts/ ./src/rustc_codegen_llvm/ ./scripts/lib/unit-steps.test.ts` | **440 pass, 0 fail**, 44 files (the handoff's count) |
| `bun src/rust_ts/llvm/gen_intrinsics_aarch64.ts --check` / `gen_intrinsics_x86.ts --check` | both exit 0 |
| `difftest --suite run-pass-native --sample 200 --jobs 6` (`rv-irfixb-run-pass-native`) | MATCH 194, UNPORTED 5 (DIBuilder 4, `simd_bswap` 1), UNSTABLE 1; 0 protected lost |
| `difftest --suite ir-host …` (`rv-irfixb-ir-host`) | MATCH 192, DIFF 3 (the fat-LTO type names), UNPORTED 5; 0 protected lost |
| `difftest --suite ir-run-pass …` | MATCH 190, DIFF 3 (fat LTO), UNPORTED 7 (DIBuilder, cg-asm, kcfi, `simd_bswap`); 0 protected lost |
| `difftest --suite ir-run-pass-o0 …` | MATCH 190, DIFF 3 (fat LTO), UNPORTED 7; 0 protected lost |
| `difftest --suite mir-o2 …` | MATCH 200/200 |
| spot checks, `run-pass-native --filter` (`rv-irfixb-spot1..5`) | MATCH: `async-drop-box.rs`, `async-gen-blocks.rs`, `spawn-types.rs` (each was `llvm.aarch64.isb` UNPORTED in gate `…-vc2v`), `lto-many-codegen-units.rs`, `lto-still-runs-thread-dtors.rs` (each `LLVMRustModuleCost` UNPORTED in the gate) |
| `ir-diff --suite ir-host` on `panic-runtime/lto-unwind.rs` and `abi/stack-probes-lto.rs#aarch64` (`rv-irfixb-irdiff-lu`, `-sp`) | after type names were normalized to their resolved bodies, the full N1 modules (8291 and 16328 lines) are **identical** |

"Protected lost" was checked against `harness/baseline/<suite>.txt` for every non-MATCH id of each sample, and none is in a baseline.
My seed's samples have the same kinds of non-MATCH as the lane's: DIBuilder, cg-asm, `simd_bswap`, kcfi and fat-LTO DIFFs.

## 1. Fidelity

**`LLVMRustModuleCost`** (`tools.ts:751`, `RustWrapper.cpp:1487`).
- At the pin it is `std::distance(functions())`, a count of functions. The brief was wrong to say instructions; the lane is right.
- Its caller is `lto.rs:247-254`. That runs in `fat_lto`, after each in-memory module's pre-LTO optimization, so reading
  `module_text` is required, and the tools.ts header N5 asks for it.
- AsmWriter prints every function of the list (AsmWriter.cpp:3191), intrinsics included. So one `^(define|declare) ` line per
  function is exact. Instructions are indented, string constants hold no raw newline, and a `declare !dbg …` line still starts
  with `declare `.
- `lto.ts` already had the `(cost, i).max()` tie rule. Spot check `lto-many-codegen-units.rs` (several CGUs) MATCHes.

**Fat-LTO serialization** (`tools.ts:767`, `:782`; PassWrapper.cpp:661, 1523).
- `forceFullLTOSummary` adds `Module::Error` (1) / `"ThinLTO"` / 0, last in `!llvm.module.flags`, and exits early when one exists.
- `AssignGUIDPass` runs first (`LLVM_VERSION_GE(23, 0)`; the pin is LLVM 23.1).
- The module's own text keeps the flag and the `!guid`s, as rustc's `MPM.run(*M)` does. That matters for `--emit=llvm-bc,llvm-ir
  -Clto=fat`, where write.rs:984 serializes before printing. The flag and `!guid` lines do show in the oracle's fat-LTO output.

**`LLVMRustLinker*` through `llvm-link`** (`tools.ts:1029-1120`).
- It is not a guess: it runs the same `Linker::linkInModule(Flags::None)` over the inputs, in order (llvm-link.cpp:450).
- It differs from rustc only because llvm-link first links the destination into an empty `Composite` (llvm-link.cpp:480).
- "Adjusted so the result matches libLLVM's own link" means four corrections, each derived from IRMover and LinkModules:
  1. the keep-all global, so `linkIfNeeded` (LinkModules.cpp:330-385) keeps dead local, linkonce and `available_externally`
     definitions and unused declarations;
  2. restoring the destination's order;
  3. restoring the named-metadata order (`!llvm.module.flags` last after the first link, `linkModuleFlagsMetadata`);
  4. restoring `source_filename`.
- `link.oracle.test.ts` checks the result against libLLVM's own `LLVMLinkModules2` on a destination built to break a plain
  llvm-link, and mutation 4 below shows the test bites.
- The PORT's argument about order is right as far as it goes: a link moves only replaced values (`RAUWWorklist`, IRMover.cpp:892,
  1015) and the global variables a source maps (IRMover.cpp:1584). But the greedy split that applies it can be wrong (N1).
- I also checked what the PORT does not mention:
  - `copyModuleAttrToFunctions`, which rustc runs on the destination in `IRMover::IRMover` (IRMover.cpp:1689). llvm-link's first
    link runs it on the destination as its source (IRMover.cpp:1527): equivalent.
  - Visibility and `unnamed_addr` merging in `linkIfNeeded`: equivalent, since both sides keep the same set of names.
  - llvm-link loads the oracle's `libLLVM.dylib` (`otool -L`), so it accepts the six `cl_args` rustc passes (checked).
- **Remaining divergence the PORT does not list:** the composite's `ValueSymbolTable::LastUnique` starts at 0. rustc's destination
  keeps its codegen and pre-link optimization history. A source local renamed on a name clash (`alloc_….N`, `shared_name.N`) can
  get another suffix after an `-O` pre-link pipeline that raised the counter. This is the same class as llir-tools' known
  `LastUnique` suffix. It is not seen in the 11 cases, and it shows as a DIFF (N4).

**`LLVMRustRunRestrictionPass`** (`tools.ts:1130`, PassWrapper.cpp:1180).
- The symbols are rustc's own `symbols_below_threshold`, through the ported `lto.ts`; the model only applies them.
- opt's `internalize` runs the same `InternalizePass::internalizeModule` (Internalize.cpp:225-280). It has the same
  `shouldPreserveGV` and `AlwaysPreserved` (`__stack_chk_fail`, `__stack_chk_guard`, llvm.used members), and `PreserveAPIList` as
  the predicate.
- I checked the escaping against `GlobPattern.cpp` at the pin. `PreserveAPIList` calls `GlobPattern::create(Pattern)` with no
  `MaxSubPatterns`, so braces are not expanded, and every `\x` in a `SubGlobPattern` is the literal `x`. So escaping `\*?[]{},`
  makes each pattern match only itself, which is rustc's `GV.getName() == Symbols[I]`.
- `line_iterator(…, SkipBlanks=true)` drops an empty name, so an empty symbol would preserve unnamed globals in rustc and not here.
  rustc never lists one, so this has no effect.

**`LLVMRustOptimize` global features** (`tools.ts:247`, `:531`).
- Sound. `AArch64TargetMachine::getSubtargetImpl(const Function &)` (and X86's alike) takes the function's own `target-features`
  whenever the attribute is present, and the machine's `TargetFS` only when it is absent.
- So when every definition carries the attribute, opt without `-mattr` builds the same subtargets, the same TTI and the same
  `areInlineCompatible`.
- This is the "narrower trigger" that review llir-tools F2 proposed. It is stricter than needed: it requires the global list as a
  prefix where presence alone would do.
- Anything else stops, and so does `__rust_try`, the F2 case. The definition-line parse is conservative too: a line without
  exactly one ` #<n>` stops. Declarations do not matter to function passes.
- llc keeps its stop (F1 of that review).

**`FoldBitCast` scalar-to-vector** (`ir.ts:1048`, ConstantFold.cpp:63-129). It has both arms in upstream's order:
- the `ConstantInt` arm canonicalizes first;
- the `ConstantFP` arm canonicalizes after the half↔bfloat case and before the PPC_FP128 bail-out.
- A zero never reaches it, as `ConstantFoldCastInstruction` returns null values first. The oracle tests cover zero, all ones,
  -0.0 and several shapes.

**`DataLayout::getAlignment(Ty, abi=true)`** (`ir.ts:1850`, DataLayout.cpp:871).
- Structs: packed gives 1, otherwise `max(StructABIAlignment, StructLayout::getAlignment())`, where the latter is the elements'
  max ABI alignment (DataLayout.cpp:48-88).
- `a` specs follow `parseAggregateSpec`: zero means 1 and the size must be empty or 0.
- Floats use `DefaultFloatSpecs`, overridden by `f` specs as `setPrimitiveSpec` does, then `PowerOf2Ceil(BitWidth/8)`.
- Vectors stop.

**Intrinsics** (`intrinsics.ts`, `intrinsics_aarch64.ts`).
- Every cited `.td` line is the `def` at the pin:
  - IntrinsicsAArch64.td:100 `int_aarch64_isb`;
  - Intrinsics.td:2723/2729/2735/2741 for the masked intrinsics (three parameters: LLVM 23 has no alignment argument);
  - :2911/2914 for the float reductions;
  - :563/588/610 for the descriptor classes.
- `LLVMVectorOfAnyPointersToElt` taking its own overload slot is correct, which is why a gather mangles `.v4f32.v4p0`.
- `entry(id)` cannot misattribute an ID: one between the aarch64 table's end and the x86 offset finds no entry and stops.
- The table is committed data, `--check` passes, and no libLLVM is used at run time; it follows the x86 pattern (ir-fix-a).

## 2. The 9 fat-LTO DIFFs

- **Inherent to the text round trip, and confirmed type names only.** On `lto-unwind.rs` and `stack-probes-lto.rs#aarch64`, I
  replaced every named struct reference with its resolved body. After that, the oracle's and the port's whole N1 modules are
  identical (8291 and 16328 lines).
- The cause is IRMover's `TypeMapTy`. In the first link, each destination type is mapped as a source type against the composite's
  `IdentifiedStructTypeSet` (IRMover.cpp:229-249, `findNonOpaque`), so isomorphic named types collapse. In rustc,
  `IRMover::IRMover(Dst)` seeds the set from the destination (IRMover.cpp:1670-1678) and never remaps the destination's own types.
- **No `llvm-link` flag avoids it.** The flags are `-only-needed`, `-internalize`, `-override`, `-import`, `-summary-index` and
  `-disable-debug-info-type-map`, and none of them touches type uniquing. Every input, the destination included, goes through
  `linkInModule` into `Composite`.
- **Distinct names cannot help either.** The match is structural, and making the types non-isomorphic means changing their
  bodies, so every constant of those types would need rewriting.
- **A text-level undo is not a port.** It would need the untouched chunks put back with the destination's original type names,
  with their metadata renumbered. It would also need the representative a source type maps to. That is the first type in the
  destination's `TypeFinder` order in rustc, and the first one mapped in llvm-link, so it is IRMover's type mapping again.
- So the lane is right that the real fix is porting IRMover's type mapping, or a link of the text in TS.
- **DIFF or stop:** see F1. PORTING §3 says "never return a guessed value": a known gap stops as UNPORTED, and a DIFF should
  mean a mismatch nobody understands yet. Here the model knows exactly when the output is wrong (F1 gives the test), and no
  decision covers it.
  - D8's "Not byte parity" belongs to the `-O` sentence. Its fat-LTO sentence names `llvm-link` but does not accept wrong IR text,
    and ir-host compares exactly that text (`-Copt-level=0 -Clto=fat -Cno-prepopulate-passes --emit=llvm-ir`).
  - The only precedent for knowingly emitted DIFFs, the ThinLocal no-op, rests on a plan decision (D8) and a recorded root
    decision (history 2026-11-12).
- These cases were UNPORTED, so no protected case is lost either way, and their programs MATCH in run-pass-native (10/10, two
  re-run here).
- The same cases are DIFF in **ir-run-pass-o0** as well; the handoff lists only ir-host and ir-run-pass (N3).

## 3. Mutations (each reverted with `git checkout -- <file>`; tree clean afterwards)
| # | mutation | result |
|---|---|---|
| 1 | table entry: `["llvm.aarch64.isb", 0]` → `1` (intrinsics_aarch64.ts:33) | intrinsics.oracle.test.ts **3 fail** (table vs libLLVM, lookup, aarch64 declaration); `gen_intrinsics_aarch64.ts --check` throws `ERROR:` |
| 2 | internalize list: `*` no longer escaped in `GLOB_SPECIAL` (tools.ts:1120) | tools.test.ts **1 fail** (`axb` stays external) |
| 3 | fold rule: the `ConstantInt` arm bitcasts the scalar without `ConstantVector::get` (ir.ts:1056) | folder.oracle.test.ts **1 fail** |
| 4 | linker: the destination's order not restored (`out.slice(0, 0)`, tools.ts:1025) | link.oracle.test.ts **2 fail** |

## Findings

### F1 (must fix). Fat LTO knowingly emits wrong type names in IR text, with no stop and no decision.
`src/rust_ts/llvm/tools.ts:1052-1055` (PORT 2's bullet) and `:1063` `LLVMRustLinkerFree`, against IRMover.cpp:1670-1678 (rustc
seeds the type set from the destination) and :229-249 (llvm-link's first link remaps the destination's types).

When the destination has two isomorphic named struct types, the linked module's types differ from rustc's. That is
`%"alloc::alloc::Global" = type {}` against `%"core::marker::PhantomData<…>" = type {}`, so nearly every program using `Box` or
`Vec` is affected. The model knows this is wrong, yet `--emit=llvm-ir` and `--emit=llvm-bc` emit the wrong names (§2). That is
9 cases each in ir-host, ir-run-pass and ir-run-pass-o0.

**Fix, either:**
- **(a) A named stop where the names become visible.** The link itself stays, so run-pass-native's 10 MATCHes stay.
  - In `LLVMRustLinkerFree`, flag the module when a named struct type that the destination's text defines is absent from
    llvm-link's output. Every printed destination type is used by something the keep global retains, so it is printed again
    unless it was merged.
  - Stop on that flag in `LLVMRustPrintModule` (core.ts:1210), `LLVMWriteBitcodeToFile` (tools.ts:839) and
    `LLVMRustModuleSerialize` (tools.ts:782), with something like `unported("llir: fat LTO's link merged isomorphic named struct
    types (llvm-link; IRMover's type mapping is not in the model)")`.
  - A unit test covers it: the existing link.oracle destination plus two `{}` types.
- **(b) A root decision** accepting this as a known DIFF class, as D8 / 2026-11-12 did for ThinLocal, listing the suites.

My recommendation is (a): it keeps every gain, and the DIFF bucket keeps meaning "not understood yet".

### N1. `restoreDestinationOrder`'s greedy split misplaces a replaced function, which the PORT presents as exact.
`src/rust_ts/llvm/tools.ts:1020-1027`, against IRMover.cpp:955-965 and 1015: a replaced declaration's new definition is created
at the end.

The split counts a `c0` value as untouched whenever it is next in `out`. A value that was replaced, and that `c0` lists after
every untouched one, is then taken as untouched and put back at its place in the destination. `c0` is llvm-link's
first-link order, which differs from the destination's when an earlier global's initializer refers to functions:
`@llvm.compiler.used`, an exported static holding function pointers, or `@llvm.global_ctors`.

Repro: a scratch copy of link.oracle.test.ts. The destination has `@llvm.compiler.used = [@f, @g]`, then `declare void @h()`,
`define @f` (which calls `@h`) and `define @g`; one source defines `@h`. libLLVM gives `f,g,h`; the model gives `h,f,g`.

The result is a DIFF, never a false MATCH, and it is rare in rustc output. But the header (`:1045-1047` "where the destination's
own order can be derived exactly, it is put back") and the handoff (PORT 1, "where a step cannot be applied exactly … the order
stays llvm-link's") overclaim.

Fix: decide "touched" from the sources rather than by position. For example:
- a destination declaration that is a definition in `out` was replaced;
- a destination global variable whose name a source declares or defines was moved;
- if the greedy prefix takes in such a name, fall back to llvm-link's order.

Add the case to link.oracle.test.ts.

### N2. The doc comment for `restoreDestinationOrder` is attached to `KEEP_NAME`.
`src/rust_ts/llvm/tools.ts:955-965`. The block ("`out` … with its leading run from the destination put in the destination's own
order … Why this is rustc's order") sits directly above `const KEEP_NAME`. Its function is at `:1020`, after `keepAllLine` and
`restoreNamedMetadataOrder`, so an editor shows it on the wrong symbol. Move it above `:1020`.

### N3. The handoff omits ir-run-pass-o0, and PORT 5's "only reader" is not quite true.
- `docs/handoff/ir-fix-b.md`: the same fat-LTO cases are DIFF in ir-run-pass-o0. My sample has `issue-64655…#fat1`,
  `lto-abort.rs` and `lto-unwind.rs`. Root's list of known DIFFs, or F1's stop, should name all three IR suites.
- `src/rust_ts/llvm/tools.ts:792-793` and handoff PORT 5 say "the only reader of this buffer is fat LTO's linker". But write.rs:984
  (`ModuleBuffer::new(llmod, cgcx.lto != Lto::Fat)`) writes the same `is_thin = false` buffer to the user's `.bc` under
  `--emit=llvm-bc -Clto=fat`, and rustc_codegen_ssa write.rs:862 writes it as pre-LTO bitcode under `-C incremental`, which is out
  of scope.
- Bitcode bytes are not a gate (D2), and a per-module summary may carry no module path at all. Reword it as "not compared (D2)"
  rather than "never read".

### N4. One divergence missing from PORT 1-2's list: `ValueSymbolTable::LastUnique`.
`src/rust_ts/llvm/tools.ts:1036-1062`. The composite's counter starts at 0, where rustc's destination keeps its history (§1). So a
source local renamed on a name clash can get a different `.N` suffix after an `-O` pre-link pipeline. It shows as a DIFF only and
is not seen in the 11 cases. One line in the PORT would keep the next auditor from rediscovering it.

## For root
- Pin the files listed in the handoff with `bun scripts/llvm-src.ts add …`. Also pin `llvm/lib/Support/GlobPattern.cpp`: PORT 3's
  escaping argument depends on it, as it does on `Internalize.cpp`.
- Add `llvm-link`'s hash in `scripts/lib/llvm-tools.ts`. `pinned_tool` (tools.ts:90) checks only that it exists, and every
  `-Clto=fat` case now runs it.
- Regenerate `ffi.ts` at integration (llir-di and cg-asm regenerate it too).
- F1 (a) or (b) before merge.
