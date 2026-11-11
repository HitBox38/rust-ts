# Handoff: llir-core-a (plan-m7 wave 40, contract lane, first half of the IR model)

Branch `t3/implement-llir-core-contract`, base `b3b29e88`. Only `src/rust_ts/llvm/` and this file are touched.

## Result

- **The contract**: `src/rust_ts/llvm/ffi.ts` exports all **381** functions of `rustc_codegen_llvm/src/llvm/ffi.rs` at the pin. The
  names, order and arity are ffi.rs's, and the parameters are typed from ffi.rs's signatures. **134 are implemented** by this
  lane and **247 are stubs** that stop with `unported("llir: <name>")`. The file is generated (`ffi_gen.ts`), along with
  `ffi_types.ts` (33 enums, 4 bitflags). `ffi.test.ts` checks the contract against ffi.rs with an independent scan and checks
  that both generated files are what the generator writes today.
- **The first half, implemented**: contexts, modules (data layout, triple, module flags, named metadata), every type,
  constants (int, float, null, undef/poison, zero, arrays, data arrays and strings, structs, GEP and cast constant expressions
  with their folds), globals (variables, aliases, linkage, visibility, DLL storage, TLS, alignment, section, comdat,
  unnamed_addr, dso_local, metadata attachments), functions (declarations, parameters, attributes), value names with LLVM's
  symbol-table rules, RAUW (constants are updated in place, as LLVM does), and the printer for all of that.
- **The tracer probe**: `record.ts`. It is a typed interposer generated from ffi.rs and records real rustc's C API calls *with
  their arguments*; `replay.ts` plays them through ffi.ts. A wrapper's effects are recorded as inferred lines (below).
- **Proof**: three cases recorded from the pinned rustc. Each is replayed with every answer checked, and **each reaches the
  oracle IR's N1 normal form byte for byte**. Seven differential tests against the oracle's `libLLVM.dylib` pass.
- Gates: `bunx tsc --noEmit -p .` clean. The lane's 28 unit tests pass in **0.7 s** wall (`RUST_TS_REQUIRE_PROBES=1 bun test
  src/rust_ts/llvm/`). All 197 `// llvm:` and wrapper markers resolve. A trial merge with `t3/llvm-harness-scope` (aborted, not
  committed) gives one `coverage --check` ERROR (next section). The 381 `// rustc: …/ffi.rs` markers pass.

Commits: `11271a62`, `b2942a4d`, `dbb4fc94`, `b8c622f7`, plus the commit of this file.

## For root: LLVM files to add to the manifest

The marker that points outside `harness/llvm-manifest.json` (the 43 files on `t3/llvm-harness-scope`), and the one `--check`
ERROR of the trial merge:

- `llvm/lib/IR/LLVMContext.cpp`: `ir.ts` `LLVMContext::getMDKindID` at line 280.

These files were read and are cited in comments, but carry no marker. Add them if reviewers should have them:

- `llvm/include/llvm/IR/FixedMetadataKinds.def`: the source of `ir.ts` `FIXED_MD_KINDS`.
- `llvm/lib/Support/StringExtras.cpp`: `printEscapedString`, at line 49.
- `llvm/lib/Support/ModRef.cpp`: `CaptureInfo` printing.
- `llvm/include/llvm/IR/Metadata.h`: `DEBUG_METADATA_VERSION`, at line 54.
- `llvm/include/llvm/IR/Module.h`: `getNamedGlobal`, at line 521.
- `llvm/include/llvm/IR/Constant.h`: `isNullValue`.
- `llvm/lib/AsmParser/LLLexer.cpp`: the parser accepts `f0x…`.

The wrapper markers point into `compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp` and `PassWrapper.cpp`
(`LLVMRustPrintModule`).

## Files

| File | Lines | What |
|---|---|---|
| `ffi_gen.ts` | 406 | Parses ffi.rs and writes `ffi.ts` and `ffi_types.ts`; `--check`. `IMPL_MODULES` lists the implementation modules. |
| `ffi.ts` | 1,292 | GENERATED. One `export const <name>: (<ffi.rs params>) => <ret> = bind(…) \| stub(…)` per fn, with `// rustc: …/ffi.rs:<line> <name>`. It also exports `IMPLEMENTED`. |
| `ffi_types.ts` | 200 | GENERATED. Enums use the PORTING §5 shape plus `<Enum>_discriminant`; bitflags use `flags_companion`. |
| `support.ts` | 117 | ffi.rs's `Bool`, `RawEnum`, `to_llvm_bool`, `debug_Bool`; `MutRef`, `PtrLenStr`, `MetadataKindId`; rustc_llvm's `RustString`. |
| `handles.ts` | 54 | The handle types. A model class where one exists, an opaque brand otherwise. |
| `ir.ts` | 1,401 | The model: types, values, constants and folds, globals, functions, metadata, attributes, symbol tables, `Module`, `Context`. |
| `core.ts` | 972 | The C API and `LLVMRust*` implementations of this half. |
| `printer.ts` | 563 | The AsmWriter subset, with a body-printer hook for llir-core-b. |
| `trace.ts` | 72 | `bind`/`stub`; with `RUST_TS_LLVM_TRACE` set, writes the port's side of `scripts/lib/llvm-trace.ts`'s trace. |
| `record.ts`, `replay.ts` | 236, 306 | The recorder probe and the replayer (tests only). |
| `proof/` | | Three `.rs` cases and their committed recorded scripts. |
| tests | 526 | `ffi.test.ts`, `model.test.ts`, `capi.oracle.test.ts`, `proof.oracle.test.ts`. |

Size: about 3.2k hand-written lines of model and printer (`ir`, `core`, `printer`, `support`, `handles`, `trace`), plus about
950 lines of tooling (`ffi_gen`, `record`, `replay`). That is over the brief's 2.5–3k. This lane stopped at its scope; nothing
of llir-core-b's was started.

## The contract's shape (for llir-core-b and the fill lanes)

- **Ported code imports only `src/rust_ts/llvm/ffi.ts`**, as `llvm::ffi`. It re-exports the enums (`Linkage`, …,
  `Linkage_discriminant`), `Bool`/`TRUE`/`FALSE`/`to_llvm_bool`, `RawEnum`, `MutRef`, `RustString`, and the handle types.
- **Signatures** keep ffi.rs's parameters one for one, so a call reads like the Rust one:
  - a pointer and length stay two arguments: `LLVMFunctionType(ret, params, params.length, FALSE)`;
  - a PTR_LEN_STR is `PtrLenStr`: a JS string stands for its UTF-8 bytes, a `Uint8Array` is raw bytes;
  - `*const c_char` is `string`;
  - `u64` is `bigint` (a value: `LLVMConstInt`'s `N`), except parameters named for a count, size, length, byte count,
    alignment, offset or bit width, which are `number`;
  - out-parameters are `MutRef<T>`, `Option<&T>` is `T | undefined`, and C callbacks are `unknown`.
- **Handles are opaque to ported code.** Compare them with `===`: the model uniques types, constants and attributes per
  context, as LLVM does. A returned name is decoded from UTF-8; inside the model, names are byte strings (`bstr`).
- **Adding an implementation**: export a function of the ffi name from a module listed in `ffi_gen.ts`'s `IMPL_MODULES`
  (`./core.ts` today; llir-core-b adds e.g. `./build.ts`). Then run `bun src/rust_ts/llvm/ffi_gen.ts`. tsc checks the
  function against the contract's signature, and `ffi.test.ts` fails until the file is regenerated.
- **Extension points for llir-core-b**, in `ir.ts` and `printer.ts`:
  - `Instruction` (abstract, extends `User`: operands, `setOperand`, users for RAUW) and `BasicBlockBase`.
  - `Function.blocks`, `.personality`, `.symTab`. Locals share the function's one collision counter (`ValueSymbolTable`).
  - `setBodyPrinter`, `Printer.localOperand`, and `Printer.operand`/`constant`/`type`.
  - `handles.ts`: replace the `BasicBlock`/`Builder`/`OperandBundle`/`DbgRecord` brands with your classes.
  - Stops left for you: `stripPointerCasts` through instructions, `LLVMSet/GetAlignment` on instructions,
    `LLVMDeleteFunction` of a definition, printing bodies and unnamed locals.
- **Port-side trace**: `bind` writes `scripts/lib/llvm-trace.ts`'s format, including the `LLVMBuild*` answers
  (`inst`/`operand`/`const …`). It assumes instructions extend `Instruction`.

## The recorder: what it records and what it cannot

`bun src/rust_ts/llvm/record.ts <out.script> -- <rustc argv>` loads a dylib through `DYLD_INSERT_LIBRARIES` into the
toolchain's own `bin/rustc`. The dylib is built with `cc` and cached in `$RUST_TS_DATA/llvm-record/<hash>/`. It has one wrapper
per ffi.rs C function that librustc_driver imports, typed from ffi.rs. Each wrapper logs handles (numbered on first sight),
integers, doubles, byte strings, arrays, and returned strings. **The oracle's IR is byte-identical under the recorder** (the
proof test checks every case).

The 131 `LLVMRust*` wrappers live inside the driver and are never seen. Their effects are **observed instead**: before each call
the recorder looks at the modules it knows, on their own thread, and emits inferred lines.

| Inferred line | Observed effect | Wrapper that caused it |
|---|---|---|
| `?global` | a new global variable, in module order | `LLVMRustGetOrInsertGlobal` |
| `?datalayout` | data layout changed | `LLVMRustSetDataLayoutFromTargetMachine` |
| `?triple` | target triple changed | `LLVMRustSetNormalizedTarget` |
| `?flag` | module flag added | `LLVMRustAddModuleFlag*` |
| `?attr` / `?attrs` | an index's attributes grew, read back through the C API | `LLVMRustAddFunctionAttributes` and the attribute creators |

Replay maps each inferred line back to the model function of that wrapper.

**Not observed, so no script has them**:

- call-site attributes;
- `dso_local` (`LLVMRustSetDSOLocal`; the C API has no getter);
- the builder wrappers (`LLVMRustBuildMemCpy`, …) and `LLVMRustPositionBuilder*`;
- debuginfo wrappers and inline asm;
- any other change a wrapper makes to an existing value.

Two C API traps found on the way, which the recorder avoids:

- `LLVMCopyModuleFlagsMetadata` hits `llvm_unreachable` (a trap in the release build) on the Max and Min behaviours. rustc's
  `PIC Level` uses Max. The recorder reads the flags through the named metadata's node operands instead.
- `LLVMGetStructName` returns a borrowed string; freeing it aborts.

## Proof results

`proof.oracle.test.ts`, with `RUST_TS_REQUIRE_PROBES=1`: **6/6 pass**, stable over 5 runs. For each case: record, check the
recorder left the IR unchanged, check the script equals the committed one (handles renumbered), replay with every answer
checked, then compare the N1 normal forms.

| Case | Target | Calls replayed | Inferred lines | What it covers |
|---|---|---|---|---|
| `statics` | x86_64-unknown-linux-gnu | 483 | 31 | v0-mangled statics: ints, arrays, f64 bytes, `static mut`, zero arrays, u128, `no_mangle`, `link_section`, `&str`/`&[u8]` allocations (private unnamed_addr), padded structs with `undef`, pointer to static |
| `decls` | x86_64-unknown-linux-gnu | 287 | 21 | external functions and an external static, function pointers, constant GEP into an allocation, arrays of pointers, **function attributes** (nounwind, nonlazybind, uwtable, string attributes) |
| `host` | aarch64-apple-darwin | 306 | 20 | host data layout, triple and flags; `#[used]` (`@llvm.used` appending, section `llvm.metadata`), `export_name`, atomics, nested data |

Skipped in replay, as other lanes': `LLVMIsMultithreaded` and `LLVMDisposeTargetMachine`, once per case.

"Every answer checked" means:

- a handle the oracle returned twice must be the same model object (uniquing);
- every returned integer, enum, `Bool` and string must equal the oracle's (e.g. `LLVMGetLinkage`, `LLVMGetDataLayoutStr`,
  `LLVMGlobalGetValueType`).

Two model bugs were found this way and fixed:

- attributes were not uniqued;
- the module already has a data layout before rustc's `LLVMSetDataLayout`, which a script without `?datalayout` cannot
  reproduce.

**C API differential tests** (`capi.oracle.test.ts`, 7 pass; libLLVM is loaded through bun:ffi, in tests only):

- `LLVMGetVersion` is 23.1.3.
- Global name collisions follow one `.N` counter per module; renaming frees the old name.
- Argument collisions follow one counter per function, with no dot: names `self self x self x self1 e.0 e.0` become
  `self self1 x self2 x3 self14 e.0 e.05` in both.
- Named struct collisions: `T T U T T.0` become `T T.0 U T.1 T.0.2` in both.
- Custom metadata kind IDs follow the 55 fixed kinds.
- Both D3 triples are their own `Triple::normalize`.
- 16 constant folds and collapses match LLVM, with `LLVMPrintValueToString` equal byte for byte: i128 sign extension, i8
  truncation, zero, undef and data arrays, all 256 bytes escaped, a string with NUL, an all-undef struct, a packed struct,
  GEP by 0 (folds) and by 8, `inttoptr 0` → null, `inttoptr 16`, `ptrtoint` of a global, a same-type pointer cast.
- A global's whole printed line matches after hidden visibility and after private linkage, with a quoted and escaped name.

**Not shown**: functions with bodies (llir-core-b). Also cases at `-O` or with debuginfo, but this half's calls do not depend
on either.

There is no `coverage --missing` or sample difftest for this lane. The model is not a port of a rustc file, and no suite
reaches it until codegen is wired.

## Every `unported(...)` left (all `llir: ...`)

- **llir-core-b's**: printing a function body or an unnamed local; `stripPointerCasts` through an instruction;
  `LLVMSetAlignment`/`LLVMGetAlignment` of an instruction; `LLVMDeleteFunction` of a definition; and the 247 stubs.
- **Folds not ported** (they stop rather than guess):
  - cast of a cast (`foldConstantCastPair` / `isEliminableCastPair`);
  - FP casts and conversions (APFloat);
  - `FoldBitCast` of all-ones, and scalar to vector;
  - casts, GEPs, `getNullValue` and ConstantInt/ConstantPointerNull printing for vectors (splats);
  - `ConstantFP::get` of anything but double and float, and of a float NaN;
  - `handleOperandChange` on other constant kinds;
  - `ConstantTokenNone`.
- **Not sourced or not needed yet**:
  - `Triple::normalize` of a triple other than the two D3 ones;
  - a data layout with a `P` or `G` component;
  - module inline asm;
  - `LLVMRustCreateAttrNoValue(DeadOnReturn)` and of an int-attribute kind;
  - `LLVMGetConstOpcode` of an opcode outside ffi.rs's enum;
  - `LLVMAddNamedMetadataOperand` of a non-node;
  - `ValueAsMetadata::handleRAUW` onto a value that already has metadata;
  - printing an unnamed identified struct outside a module;
  - other metadata kinds.
- **Implemented as stubs although they are in this half's area, because not needed for the proof**: `LLVMConstVector`,
  `LLVMRustCreateMemoryEffectsAttr`, `LLVMRustCreateRangeAttribute`, `LLVMCloneModule`, the intrinsic functions
  (`LLVMLookupIntrinsicID`, `LLVMGetIntrinsicDeclaration`, …), `LLVMGetInlineAsm`, `LLVMRustSetNoSanitize*`,
  `LLVMRustConstPtrAuth`, and `LLVMRustSetModulePICLevel`/`PIELevel`/`CodeModel`/`LargeDataThreshold`. Note that rustc sets
  PIC through `LLVMRustAddModuleFlagU32`, which is implemented.

## `// PORT:` decisions (for root to record)

1. **Generated files outside `tools/`**: the contract generator is `src/rust_ts/llvm/ffi_gen.ts`, because D20 gives llir lanes
   only `src/rust_ts/llvm/`. Its outputs start `// GENERATED by src/rust_ts/llvm/ffi_gen.ts`. Root may move it to `tools/`.
2. **Markers on the contract**: each export carries `// rustc: compiler/rustc_codegen_llvm/src/llvm/ffi.rs:<line> <name>`, as
   root asked. Enums and bitflags carry a plain `// From …ffi.rs:<line> (enum X).` comment, since the checker matches only
   functions.
3. **The contract's types**: see "The contract's shape". The `u64` rule is by parameter name (`count|size|len|align|offset|bits|elements|bytes`).
   `AllocKindFlags: u64` is a 32-bit `flags_companion` (its bits are below 2^6).
4. **The printer prints what the parser normalises, not AsmWriter's spelling**:
   - floats always in hex (`f0x…`, the full bit pattern);
   - a non-C calling convention as `cc N`;
   - no annotation comments in `LLVMRustPrintModule`;
   - the parser and `opt` renumber attribute groups, metadata and type definitions and reorder comdats.
   - Consequence: **the port-side trace's `const <printed>` answers and `LLVMRustWriteValueToString` differ from LLVM's for
     floating-point constants** (LLVM prints a decimal when it round-trips) and for a function with a non-C convention.
     Integer, pointer, aggregate and expression constants match exactly (C API test).
5. **No `Intrinsic::getAttributes`** on intrinsic declarations: the parser replaces them (plan-m7 §1b).
6. **Arguments are built eagerly**: LLVM builds them lazily, and they are unnamed either way.
7. **RAUW of constants is in place** when the replacement is not already uniqued (`replaceOperandsInPlace`). This keeps the
   identity of a constant that ported code holds.
8. **`LLVMGetVersion` / `LLVMRustVersionMajor`** return 23.1.3, from `rustc -vV`; the C API test checks it.
   `LLVMRustDebugMetadataVersion` returns 3, from `Metadata.h:54`.
9. **`LLVMRustSetNormalizedTarget`** accepts only the triples the C API test confirms are already normal (`NORMAL_TRIPLES`).
10. **Data layout address spaces** (`P`, `G`) default to 0, and stop if the layout names them.
11. **`LLVMContextDispose`** does nothing (garbage collection).

## Notes for root

- **Unit-time budget**: 0.7 s wall for the lane's four test files. `proof.oracle.test.ts` runs three rustc compiles under the
  recorder, three plain ones and six `opt` runs. The first run on a machine also runs `cc` once for the recorder (cached).
  Both oracle tests skip with a printed reason off aarch64 macOS, or without the toolchain, unless
  `RUST_TS_REQUIRE_PROBES=1`. On the gate host they run.
- The proof cases use `--target x86_64-unknown-linux-gnu` (IR only, no link) and the host.
- `REGEN=1 bun test src/rust_ts/llvm/proof.oracle.test.ts` rewrites the committed scripts. They change only if the toolchain
  or a case changes.
- The recorder leaves nothing in the toolchain. Its dylib cache is `$RUST_TS_DATA/llvm-record/<hash>/` (a few hundred KB).
  The LLVM sources this lane read are in `$RUST_TS_DATA/llvm-src/aab11ee0ea5ea9a1d462ad0bc1fae9d9bb643019/`, the same layout
  `scripts/llvm-src.ts` uses.
- `scripts/lib/llvm-trace.ts`'s header says the port side "does not exist yet (lane llir-core owns it)". It now exists
  (`trace.ts`); the harness owner may want to update that comment.
