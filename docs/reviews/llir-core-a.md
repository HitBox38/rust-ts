REQUEST CHANGES

# Review: llir-core-a (M7 contract lane, first half of the IR model)

Branch `t3/implement-llir-core-contract`, commits `11271a62`, `b2942a4d`, `dbb4fc94`, `b8c622f7`, `2f2aa3f0`. I reviewed
`git diff b3b29e88...2f2aa3f0` (22 files, +7,584 lines, all under `src/rust_ts/llvm/` plus the handoff), read against
`docs/plan-m7.md` §1b, §2a–2c, D5, D12 and D17, `docs/reviews/plan-m7.md` F6, and `docs/reviews/scope-m7.md`. LLVM sources come from
`$RUST_TS_DATA/llvm-src/aab11ee0…/`, and rustc and wrapper sources from `$RUST_TS_DATA/rust` at the pin.

**Summary.** The work is careful. Every rule I checked against LLVM matches its source. Where the model cannot source a rule, it
stops with `unported` instead of guessing. The contract is complete and in order, and the recorder is faithful. Two things must
change before other lanes build on this:

- **F1.** The proof hides that `create_module` always calls wrappers that are stubs here. Replay sends those effects through a
  different, implemented wrapper.
- **F2.** The contract types nullable C pointers as non-optional, and rustc passes null to them.

Both are small to fix.

## What I ran (all on AC power, no gate running, `RUSTC_ICE=0`, `RUST_TS_REQUIRE_PROBES=1`)

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` on the lane, and on the trial merge with `integ-w51` | clean, clean |
| `bun test src/rust_ts/llvm/`, 5 runs | 28 pass, 0 fail each time; 1.31, 0.64, 0.66, 0.64, 0.65 s wall. No flakes |
| `bun test ./src/std/result.test.ts` | 3 pass |
| `bun scripts/coverage.ts --check --offline` on the lane | `markers ok (25413; vendor 5311; library 728)` |
| The same on a trial merge of `integ-w51` (`287bc0af`) into the lane (merged cleanly, not kept) | 1 ERROR: `ir.ts: marker llvm/lib/IR/LLVMContext.cpp:280 LLVMContext::getMDKindID names no file of harness/llvm-manifest.json`. Lane tests still 28/28 |
| Every `// llvm:` and `// rustc: compiler/rustc_llvm/…` marker, checked by script: does the cited line name the function? | all resolve |
| Staleness: a scratch `RUST_TS_DATA` holding a mutated `ffi.rs`, then `ffi.test.ts` | unmutated: 4 pass. Each mutation fails the expected test: a param type changed (`N: c_ulonglong` → `c_uint`), a param renamed, an enum variant added, a fn removed |
| `FIXED_MD_KINDS` compared with `FixedMetadataKinds.def` | identical, 55 kinds in order |
| Re-record of `decls` with `record.ts`, handles renumbered as `canonicalScript` does | identical to `proof/decls.script` |
| Oracle IR with and without the recorder (raw `.ll` bytes, `cmp`) | identical for `decls` and for the new 4th case. The test also compares raw bytes (`proof.oracle.test.ts:65`) |
| The 3 proof cases (`proof.oracle.test.ts`) | 6 pass |
| **A 4th case of my own**, x86_64-linux, globals and declarations only (details below) | 638 calls replayed, 41 inferred; N1 normal forms equal (4,470 bytes). A one-byte change to the model's output makes them differ, so the check can fail |

The 4th case covers:

- a `#[no_mangle]` struct holding an extern fn pointer, a padded `u16` and a `&str` containing NUL and `é`;
- a `&[&str]` that includes `""`, which gives `inttoptr (i64 1 to ptr)`;
- a `#[link_section]` `i16` array;
- a `u8` array holding every byte that needs escaping;
- a pointer into another static at offset 16;
- a reference to an extern static;
- a `static mut`, an `Option<&u32>` set to `None`, and an array of fn pointers;
- `#[linkage = "weak"]`, `#[used]`, and `export_name = "renamed.sym"`.

## Findings (must fix)

### F1. Replay sends wrapper effects through a wrapper rustc does not call, which hides stubs that every compile reaches

- `replay.ts:263-272` replays every `?flag` through `LLVMRustAddModuleFlagU32` or `…String`. But rustc sets these flags through
  other wrappers:
  - `"PIC Level"` comes from `LLVMRustSetModulePICLevel` (`rustc_codegen_llvm/src/context.rs:240`), which is
    `setPICLevel(BigPIC)` at `PassWrapper.cpp:1202`, which is `addModuleFlag(Min, "PIC Level", 2)` at `Module.cpp:640`.
  - For executables, `"PIE Level"` comes from `LLVMRustSetModulePIELevel` (`context.rs:248`, `PassWrapper.cpp:1206`), which is
    `addModuleFlag(Max, …)` at `Module.cpp:654`.
- Both are stubs in the contract (`ffi.ts:1190`, `ffi.ts:1193`). So does `LLVMRustSetModuleCodeModel` (`context.rs:259`), which
  rustc calls unconditionally and which is a no-op for the default code model (`PassWrapper.cpp:1210-1215`).
- Every committed script has `?flag %2 8 "PIC Level" i 2` (`proof/decls.script:97`, `host.script:109`, `statics.script:97`). The
  proof passes, but the first real `create_module` stops at `unported("llir: LLVMRustSetModulePICLevel")`.
- The handoff is wrong in two places:
  - line 200-201 says "rustc sets PIC through `LLVMRustAddModuleFlagU32`";
  - line 126 says `PIC Level` "uses Max", but behaviour 8 is Min.

The same untested mapping applies to `?global`, which always replays as `LLVMRustGetOrInsertGlobal` (`replay.ts:232`), to
`?datalayout`, which replays as `LLVMSetDataLayout` although rustc's effect comes from
`LLVMRustSetDataLayoutFromTargetMachine` (`context.rs:209`), and to `?attr`, whose creator is guessed from the printed text.
Inferred lines are read only from observable state (C API getters on the module; `record.ts:118-150`), which is correct. **Which
wrapper caused** an effect, however, is an assumption that is not in the log.

Fix:

1. Implement `LLVMRustSetModulePICLevel` and `LLVMRustSetModulePIELevel` from the C++ cited above.
2. Implement `LLVMRustSetModuleCodeModel` for `CodeModel::None` (return), and stop on any other code model.
3. Correct the handoff.
4. Beside each inferred-line handler in `replay.ts`, list the rustc call sites that can produce that effect, and which of their
   wrappers the model still stubs. `LLVMRustSetDataLayoutFromTargetMachine` stays a driver lane's job; say so there and in the
   handoff's stub list.

### F2. Nullable raw-pointer parameters are typed non-optional, but rustc passes null to them

`ffi_gen.ts` `tsType` maps a `*const T` or `*mut T` parameter to plain `T`; only return types get `| undefined`. The C contract
allows null, and rustc passes null at these call sites:

| Call site | Parameter |
|---|---|
| `llvm/mod.rs:104` (`CreateAttrString`) | `LLVMCreateStringAttribute`'s `Value`, `ptr::null()` with length 0. This fn is implemented here (`core.ts`), and `bytesArg(undefined, 0)` would throw |
| `debuginfo/mod.rs:585` | `LLVMSetCurrentDebugLocation2(.., ptr::null())`, which clears the location. Typed `Loc: Metadata` (`ffi.ts:524`) |
| `back/write.rs:71` | `LLVMRustWriteOutputFile`'s `DwoOutput` |
| `back/write.rs:378` | the remark file |
| `back/write.rs:779-788` | the PGO and enzyme paths of `LLVMRustOptimize` (`*const c_char`, typed `string`) |
| `debuginfo/metadata.rs:661` | `LLVMRustDIBuilderCreateFile`'s `Source` (`PtrLenStr`) |
| `llvm/mod.rs:514-515` | `LLVMRustConstPtrAuth`'s `addr_diversity` and `deactivation_symbol` (`ffi.ts:1292`, typed `Value`) |

A line-by-line port of these helpers cannot pass `undefined` without a cast, and `llvm/mod.rs` is among the first files a fill lane
ports. Changing the contract's shape later means regenerating it and touching every call site.

Fix: type every raw-pointer parameter (`*const`/`*mut` of a handle, `c_char`, `c_uchar` or `u8`) as `T | undefined`, keeping
`&T` non-optional. Make the implemented model functions accept `undefined` where C accepts null:
`LLVMCreateStringAttribute` with an empty value is the one reached today. Arrays (`*const &T`) can stay `readonly T[]`, with
`ptr::null()` and length 0 ported as `[]`; record that as a PORT decision.

## Nits

- **N1. Replay cannot catch over-uniquing** (`replay.ts:290-293`). A new oracle handle is bound to whatever the model returns,
  even when that object is already bound to a different handle. If the oracle returns `%5` and then a fresh `%7`, and the model
  returns the same object both times, replay passes. A reverse map from object to handle closes this. The handoff's "every
  answer checked" should not claim this until then.
- **N2. Out-parameters and byte-and-length answers are not compared.** The recorder writes `?` for `&mut` and `*mut` non-handle
  parameters (`record.ts:63-65`). Replay passes a fresh `MutRef` (`replay.ts:166`, `:185`). So `LLVMGetValueName2`'s length and
  the arrays filled by `LLVMGetParamTypes` and `LLVMGetStructElementTypes` are never compared. Only C-string returns are
  (`replay.ts:300`).
- **N3. Wrapper effects after the last C call of the building thread are lost.** The scan runs only inside a wrapper, before its
  call (`record.ts:150`); `fini` (`record.ts:100`) does not scan. Within one gap between calls, effects appear in the scan's fixed
  order (globals, layout, triple, flags, attributes), not the order they happened.
- **N4. `?attrs` sees count changes only, and only for functions already seen** (`record.ts:138-139`):
  - an attribute replaced by one of the same kind is invisible;
  - the list is LLVM's sorted set replayed whole, so rustc's grouping and order are never tested;
  - a function made by a hidden wrapper (`LLVMRustUpgradeIntrinsicFunction`'s `NewFn`) is skipped silently.
- **N5. Misleading comments.**
  - `record.ts:10` cites `record.test.ts`, which does not exist.
  - `record.ts:23-25` says comparisons "project away" unobserved effects, but nothing projects; N1 equality is exact. For
    example, `-Crelocation-model=static` gives `dso_local`, which no script can reproduce, so the comparison fails.
- **N6. The proof does not assert the skipped set.** `replay.ts:277-283` silently skips void calls to unimplemented functions.
  `proof.oracle.test.ts` should assert that `r.skipped` is within an allowlist (today `LLVMIsMultithreaded` and
  `LLVMDisposeTargetMachine`). The committed-script test (`proof.oracle.test.ts:81-88`) only looks for `target triple`.
- **N7. The `u64` → `number` rule by parameter name is not "provably < 2^53"** (PORTING §5).
  - `LLVMArrayType2`'s `ElementCount` (`ffi.ts:323`) can be huge for zero-sized element arrays (`[(); usize::MAX]`).
  - `LLVMDIBuilderGetOrCreateSubrange` types `LowerBound` as `bigint` but `Count: i64` as `number` (`ffi.ts:884`), and rustc
    passes the array length cast to `i64` there.
  - Either type these as `bigint`, or have `bind` stop when a `number`-typed `u64` is not `Number.isSafeInteger`.
  - `ArrayType.numElements` (`ir.ts`) has the same width.
- **N8. Enum kinds and string-attribute keys share one key space.** `LLVMRustAddFunctionAttributes` replaces by `Attribute.key`
  (`core.ts`, `set.set(a.key, a)`). A string attribute whose key equals an enum kind name (`"NoUnwind"`) would replace the enum
  attribute, where LLVM's `AttrBuilder` keeps the two apart. Prefix the keys, e.g. `enum:`/`str:`.
- **N9. The printer's `TypeFinder` skips attribute types** (`printer.ts`, `usedIdentifiedStructs`, PORT comment). LLVM's
  `TypeFinder::run` incorporates attribute types. A named struct used only in `byval`, `sret` or `elementtype` on a
  *declaration*, which is this half's area, is printed without its `= type` line, and `opt` rejects the file. Walk the attribute
  types, or stop when printing a type attribute of an identified struct that is not in the list.
- **N10. Float and `cc N` spelling (item 5).**
  - **Acceptable under §1b.**
    - The parser at the pin accepts `f0x<full bit pattern>` (`LLLexer.cpp:1072-1090`).
    - The normal form re-prints both sides through `opt`.
    - `cc N` is always accepted.
  - **Documented** in `printer.ts:1-6` and handoff PORT 4, but **not where fill lanes and ir-diff read it**:
    - Note it at `trace.ts` `builtAnswer`. A folded float `const` answer will differ from the oracle's trace and look like "the
      model answered differently".
    - Note it at `LLVMRustWriteValueToString` (`core.ts`, which reaches rustc's `Debug` for `Value`).
    - Root should tell the harness owner, so that `scripts/lib/llvm-trace.ts`'s comparison masks float `const` answers.
- **N11. One constant has no fetched source.** `GEP_INBOUNDS = 3` (`core.ts:514`) cites `GEPNoWrapFlags.h`, which is not in
  `$RUST_TS_DATA/llvm-src` and not in the handoff's list. The value is right (InBounds 1 | NUSW 2), but it was not checked against
  a fetched file. Fetch the file and add it to the manifest (list below).
- **N12. Tooling placement.**
  - `record.ts` is a second `DYLD_INSERT_LIBRARIES` interposer beside `scripts/lib/llvm-trace.ts` (scope-m7's names-only trace).
    It is test-only probe code living in `src/`, while AGENTS.md puts probes in `tools/probes`.
  - Plan to consolidate into one interposer with typed arguments, owned by the harness, that both ir-diff and the replay read.
  - `scripts/lib/llvm-trace.ts:9-10` still says the port side "does not exist yet"; the harness owner should update it.
- **N13. `LLVMGetValueName2` returns a UTF-8-decoded `string` with a byte length** (`core.ts`). rustc's `get_value_name` works on
  `&[u8]`. This is lossless only because every name rustc gives is UTF-8. Record that as a PORT decision in the contract notes.

## Answers to the brief's questions

1. **The contract is complete and typed.**
   - All 381 fns are present, in `ffi.rs` order, with their lines and arities. `ffi.test.ts` checks this with a scan independent
     of the generator.
   - The parser handles every item form in `ffi.rs` at the pin: 33 enums (with discriminant expressions), 4 bitflags (including
     the spaced `struct X : u64`), 22 opaque types plus 13 aliases, `safe fn`, generics, and comments with quotes. An unknown type
     throws.
   - Types are only checked for consistency with the generator's own output. I reviewed every distinct Rust → TS mapping (208 of
     them). Pointer pairs, `Option<&T>`, `&mut` out-parameters, `RawEnum`, bitflags and `size_t`/`c_uint` are right, except for
     F2 and N7.
2. **The model follows LLVM.** Checked line by line against the LLVM source:
   - naming: `setNameImpl`, `getSymTab`, `createValueName`, `makeUniqueName` (module `.N` versus function `N`,
     `MaxNameSize` 1024), `reinsertValue`, `StructType::setName` (`T.0`, `T.0.2`);
   - GEP and cast folds: `ConstantFoldCastInstruction`, `FoldBitCast`, `ConstantFoldGetElementPtr`, `getFoldedCast`,
     `getPointerCast`;
   - the aggregate collapses `ConstantArray::getImpl` (with `getSequenceIfElementsMatch`), `ConstantStruct::get` and
     `getAggregateElement`;
   - global flags: `setLinkage`, `setVisibility`, `isImplicitDSOLocal`, `setSection`, `setAlignment`, the obsolete linkages in
     `LLVMSetLinkage`;
   - attributes: string attribute and `uwtable`, `align`, `dereferenceable`, `allockind`, `allocsize` and `captures` printing,
     and per-context uniquing;
   - module flags (`fromRust`'s values equal `ModFlagBehavior`'s), the data layout (kept as given), and the two normal triples.

   Nothing is guessed except N11. Where LLVM's source does not settle a case, the model stops:
   - every cast of a cast. This is broader than LLVM, which folds only when `foldConstantCastPair` allows, but it is a stop,
     not a guess;
   - FP conversions, all-ones bitcasts and vectors;
   - `P`/`G` address spaces and other triples.
3. **The tracer.**
   - The log is faithful: the re-record is identical.
   - Inferred lines come only from observable effects, but the mapping to a wrapper is not (F1).
   - What a replay cannot catch, for the fill lanes:
     1. any `LLVMRust*` call the port makes, including call-site attributes, `dso_local`, the builder wrappers, `PositionBuilder*`,
        debuginfo, inline asm, and changes to existing values;
     2. which wrapper made an inferred effect (F1);
     3. over-uniquing (N1);
     4. out-parameters and byte answers (N2);
     5. effects after the last C call, and their order within one gap (N3);
     6. an attribute replaced at the same count, rustc's attribute order, and functions from hidden wrappers (N4);
     7. modules on other threads: multi-CGU builds and the allocator shim (the proof asserts one module);
     8. float and non-C-convention trace answers (N10).
   - The oracle's IR is byte-identical with the recorder loaded.
4. **The proof.** All 3 cases reproduce, and the 4th case passes (table above).
5. **The printer.** See N10.
6. **Integration with scope-m7.** The merge is clean, with one `--check` ERROR (`LLVMContext.cpp`); the full manifest list is
   below. **`ffi_gen.ts`: move it to `tools/`** (for example `tools/llir/ffi_gen.ts`): PORTING §6 says `// GENERATED` files come
   from `tools/`. Move `IMPL_MODULES` out to a file under `src/rust_ts/llvm/` (for example `impl_modules.ts`), so llir lanes add
   their modules without editing `tools/`. Do this as its own small root batch **before llir-core-b adds its module**.
7. **Required checks.** All are in the table at the top.

## Manifest additions root must make (`bun scripts/llvm-src.ts add …`)

Required, so that `coverage --check` passes after the merge:
- `llvm/lib/IR/LLVMContext.cpp` (`ir.ts` marker `:280 LLVMContext::getMDKindID`)

Cited in comments, or the source of a value or printer rule (all except the last are already in `$RUST_TS_DATA/llvm-src`):
- `llvm/include/llvm/IR/FixedMetadataKinds.def` (`FIXED_MD_KINDS`)
- `llvm/lib/Support/StringExtras.cpp` (`printEscapedString`, `:49`)
- `llvm/lib/Support/ModRef.cpp` (`captures(...)` printing)
- `llvm/include/llvm/IR/Metadata.h` (`DEBUG_METADATA_VERSION`, `:54`)
- `llvm/include/llvm/IR/Module.h` (`getNamedGlobal`, `:521`)
- `llvm/include/llvm/IR/Constant.h` (`isNullValue`)
- `llvm/lib/AsmParser/LLLexer.cpp` (the printer's `f0x` relies on `:1072`)
- `llvm/include/llvm/IR/GEPNoWrapFlags.h` (N11; **not fetched yet**)
