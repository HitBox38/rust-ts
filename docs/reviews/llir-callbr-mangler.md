# Review: llir-callbr-mangler (wave 40t)

**Verdict: APPROVE WITH NITS**

- Subject: branch `t3/llir-callbr-mangler`, commits `0fbd9e10`, `32fbfd2c`, `a45dc9b4` and `5426ee91`, on main `9c662b55`
  (`git diff 9c662b55 5426ee91`), with the pin commit `6a74a1de` in between. The handoff is `docs/handoff/llir-callbr-mangler.md`.
- Reviewer: independent, read-only on the code. The review branch is `t3/review-llir-callbr-mangler-5426`, at `5426ee91` plus this file.
- Upstream read at the pin:
  - LLVM `aab11ee0ea5e` (`$RUST_TS_DATA/llvm-src/`). The 18 files from `docs/handoff/llir-callbr-mangler/llvm-pins.patch` were
    applied in scratch, and all 18 SHA-256 values match the files on disk. The patch was reverted before commit.
  - rustc's `RustWrapper.cpp` and `SymbolWrapper.cpp`.

There are no must-fix findings. The four nits are about G3's flag rule and two stop messages. They don't change any output compared
today.

## 1. Fidelity

### `object_file.ts` (Object library: Mach-O, ELF, magic)
- **`identify_magic`** matches Magic.cpp:33 arm by arm. That includes:
  - the bigobj/ClGl UUID offset (12);
  - the ELF `Data2MSB` high/low bytes;
  - the Mach-O `read32be`/`read32le` into a `uint16_t`, written `& 0xffff`;
  - the `0xF0…0x68` `[[fallthrough]]` chain, written out;
  - the `MZ` arm's `substr(off)` clamp, written `off <= length`;
  - `sizeof(OBMagic)`, counting the NUL.
- **Mach-O**, checked against MachOObjectFile.cpp:
  - `getSymbolFlags` (:1868) is line for line, all of it:
    - `N_INDR` gives Indirect;
    - `N_STAB` gives FormatSpecific;
    - `N_EXT` gives Global, then on `N_UNDF` Common if `n_value` is non-zero, else Undefined;
    - `N_PEXT` gives Hidden, else Exported. The `else if (N_PEXT)` arm gives Hidden;
    - `N_WEAK_REF|N_WEAK_DEF` give Weak, `N_ARM_THUMB_DEF` gives Thumb and `N_ABS` gives Absolute.
  - The `nlist` layout is right: `n_strx`@0, `n_type`@4, `n_desc`@6 as u16, `n_value`@8 as u32 or u64. `getNValue` (:1796) matches.
  - `getSymbolName` (:1775): `n_strx == 0` gives the empty name. The bound is the file's end, not `strsize`, as upstream has it.
  - `symbol_begin`/`end` (:2642/:2651) list every nlist entry in order.
  - `checkSymtabCommand` (:410) has its checks in upstream order. The overlap and other load-command checks are left out under a
    named PORT note.
  - There are no section-based symbol flags at this pin; `getSymbolFlags` reads only `n_type`/`n_desc`.
- **ELF:**
  - `getSymbolFlags` (ELFObjectFile.h:755) is line for line:
    - Global if `STB` is not LOCAL, Weak for WEAK, Absolute for `SHN_ABS`;
    - FormatSpecific for FILE/SECTION and for the null symbol of `.symtab` and of `.dynsym` (pointer equality, written as the
      entry's offset);
    - the AArch64, ARM, CSKY and RISC-V mapping-symbol rules;
    - Undefined for `SHN_UNDEF`, Common for `STT_COMMON`/`SHN_COMMON`;
    - `isExportedToOtherDSO` (:392, `STB_GNU_UNIQUE` included), Indirect for `STT_GNU_IFUNC`, Hidden for `STV_HIDDEN`.
  - Iteration matches `symbol_begin`/`end` (:1229/:1237): from 1 if `sh_size >= sizeof(Elf_Sym)`, up to `sh_size / sizeof`.
  - These match the pinned header: `initContent` (:525, the first of each section type), `getSymbolName` (:555, with the
    STT_SECTION fallback to the section name), `getStringTable` (ELF.h:1332), `getSectionContentsAsArray`, `getEntry`,
    `Elf_Sym::getName` (ELFTypes.h:293), `getSectionName` and `getSectionStringTable`. Their error paths stop by name.
- **`isArchiveSymbol`, `getSymbolicFile` and `LLVMRustGetSymbols`** (SymbolWrapper.cpp:24/:43/:66):
  - same order and same filters (not FormatSpecific, Global, not Undefined);
  - bitcode gets a context, everything else `createSymbolicFile(Buf)` with no context, as upstream.
  - The `elf_relocatable`/`macho_object` arm stops when a context is passed (`object_file.ts:961`), where upstream tries
    `findBitcodeInObject` and falls back to the object. rustc never passes a context there, so it is unreachable from SymbolWrapper.

### `mangler.ts`
- **Mangler.cpp, line for line:** both `getNameWithPrefixImpl`s (:35/:64), `hasByteCountSuffix` (:83) and
  `Mangler::getNameWithPrefix(OS, GV, bool)` (:121):
  - private gives `getInternalSymbolPrefix`; private with `CannotUsePrivateLabel` gives `getLinkerPrivateGlobalPrefix` (`l` on
    `m:o` only);
  - the `\1` escape drops the prefix and the byte;
  - Windows modes take a leading `?` without a prefix;
  - `__unnamed_N` uses `AnonGlobalIDs.size()` after `operator[]` inserts the entry. The model inserts first too, so a fresh `Mangler`
    gives `__unnamed_1`;
  - the `\01`/`?` rule turns off the MS suffixes;
  - only `MM_WinCOFFX86` or vectorcall keep `MSFunc`;
  - fastcall gets `@`, vectorcall no prefix and a double `@`;
  - the "pure variadic" condition is upstream's.
- **The DataLayout.h accessors** (:274-:325) match. The `m:` parse follows DataLayout.cpp:650-676; any spec upstream rejects stops.
- **`addByteCountSuffix`** gives `@0` for no parameters and stops otherwise. That is not a guessed value.
- **`LLVMRustGetMangledName`** (RustWrapper.cpp:1662) makes a fresh `Mangler()` and passes `true`, as upstream.

### `callbr`
- **`callBrInit`** (Instructions.cpp:939) lays the operands out as args, bundle inputs, default destination, indirect destinations,
  callee. That agrees with `getDefaultDest` = `Op<-1> - N - 1` and `getIndirectDest(i)` = `Op<-1> - N + i` (Instructions.h:4176-4181).
- **Printing** matches AsmWriter.cpp:4735-4775: no `maybePrintCallAddrSpace`, then `\n          to <default> [<d1>, <d2>]` with `", "`
  between destinations. The rest goes through the shared CallBase printer (calling convention, return attributes, arguments,
  `#N`, bundles), as the upstream arm does.
- **`LLVMBuildCallBr`** (Core.cpp:3575) and `CreateCallBr` (IRBuilder.h:1300) are right.

### G3: the conditional `-non-global-value-max-name-size=-1`
- **The reasoning is right.** In-process LLVM keeps a long local name given before insertion (`reinsertValue`,
  ValueSymbolTable.cpp:82) and truncates one set inside a function (`createValueName`, :112). LLParser rejects the model's text when
  a name comes back different.
- **Passing the flag only when needed is the more faithful choice.** If it were always passed, every module would lose LLVM's
  truncation of names that passes create. With the rule, modules without a long local run exactly at LLVM's default.
- **The leftover difference is real** (N2):
  - Inside an affected run, names that passes create through an `IRBuilder` at an insertion point (truncated in-process) stay long.
    So does the uniquing in `makeUniqueName`.
  - These are local value names only, so codegen and native object code are unaffected. That fits the handoff's evidence.
  - They do reach more than `--emit=llvm-ir`, though: bitcode carries local value symbol tables (`--emit=llvm-bc`, embedded or
    linker-plugin-LTO bitcode), and verbose asm prints block names in comments.
  - Before this change those modules stopped, so nothing protected can change. A difference would show as a DIFF, not silently.

## 2. Evidence (re-run)
- **Symbol tables, independently.**
  - I wrote my own `ar` parser (BSD `__.SYMDEF` and GNU `/`) and called `LLVMRustGetSymbols` directly. The rlibs were std,
    compiler_builtins, panic_unwind, unwind, libc, hashbrown, gimli and object, on both targets.
  - **aarch64-apple-darwin:** 414 members, 1792 symbols, 0 mismatches.
  - **x86_64-unknown-linux-gnu:** 340 members, 1840 symbols, 0 mismatches.
  - As a second check, I ran the pinned `llvm-nm --extern-only --defined-only --no-sort` on every 5th object member (144 members).
    One member differs: `llvm-nm` leaves out two private-extern `__cstring` symbols (`_anon.….llvm.N`). The rlib's table, which rustc
    wrote through `LLVMRustGetSymbols`, lists them, and so does the port. This is `llvm-nm`'s own filtering, not a port defect.
- **ripgrep, `cargo build --release` with every compile through the port.**
  - Setup: rg-fix-a's appendix A/B driver at `5426ee91`, with `RGALL_PM_ORACLE` unset.
  - **Exit 0** in 180 s. All 50 compiles ran on the port side and all exited 0. `rg --version` prints `ripgrep 15.2.0`.
  - Logs: `$RUST_TS_DATA/tmp/revcbm-rel/` (target deleted afterwards).
  - Five queries over `compiler/rustc_llvm`, against the oracle-built `rg` (`ripgrep/bin/oracle/8766cf8de2bda6a0`). The outputs are
    equal, line-sorted:

    | Query | Lines |
    |---|---|
    | `-n 'LLVMRust\w+Symbol'` | 8 |
    | `-i -c context` | 5 |
    | `--json -e 'fn \w+\(' -t rust` | 24 |
    | `-w -F unwrap --sort path` | 164 |
    | `-U 'extern "C"\s*\{' -l` | 1 |

    The `--json` outputs are equal once the `elapsed` timing fields are removed.
- **Spot checks by filter: all MATCH.**
  - run-pass-native `asm/label-operand.rs` (`-095757-…-mewd`);
  - ir-run-pass-o0 `asm/x86_64/goto.rs` (`-095809-…-0jdu`);
  - ir-run-pass `abi/custom.rs` (`-095813-…-cvzl`);
  - ir-run-pass `asm/x86_64/global_asm_escape.rs` (`-095817-…-gqpq`);
  - ir-host `asm/label-operand.rs` (`-095822-…-hau2`);
  - ir-run-pass `c-variadic/naked.rs` (`-095826-…-kz4m`).

## 3. The nits
- **llir-di N1:**
  - The libLLVM sequence now has `_ZN2di3sub`.
  - Re-applying mutant M4b (numbering function attachments in the module pass, `printer.ts:257`) fails `di_builder.oracle.test.ts`
    (1 fail).
- **llir-di N3:**
  - `printer.ts:253` sorts a global's attachments by kind, as `processGlobalObjectMetadata` (AsmWriter.cpp:1223) does through
    `getAllMetadata`.
  - Removing the sort fails the test (1 fail).
  - The attachments' printing (`attachments()`, :481) was already sorted.
- **llir-di N4:** `createMemberType` cites `DIBuilder.cpp:463`.
- **cg-asm N2:** the llvm-as fixture test runs, and passed in the unit run.
- **cg-asm N3:** the five Module.h markers are accepted by `coverage --check`.
- **cg-asm N4:** `bytesArg` moved to ir.ts with an identical body. core.ts re-exports it, and inline_asm.ts's copy is gone.
- **Module asm:** `Module.GlobalScopeAsm` replaces the `WeakMap`.
  - `getModuleInlineAsm`, `hasModuleInlineAsm` and `appendModuleInlineAsm` keep their logic.
  - No user of `.inlineAsm` remains (grep), so removing the dead `printer.ts:599` check changes nothing.
- **root-w59-check N1:** pinned by the RC-E case in `link.oracle.test.ts`. I did not re-run the lane's `f76a3035` mutation.

## 4. Mutations (each reverted with `git checkout -- <file>`)

| # | Mutation | Test file | Result |
|---|---|---|---|
| 1 | `object_file.ts`, Mach-O `if (MachOType & N_EXT)` → `N_PEXT` | `symbol_wrapper.test.ts` | **3 fail** |
| 2 | `mangler.ts`, `getLinkerPrivateGlobalPrefix` `"l"` → `"L"` | `callbr_mangler.test.ts` | **2 fail** |
| 3 | `inst.ts` `callBrInit`, default destination pushed after the indirect destinations | `callbr_mangler.test.ts` | **3 fail** (both oracle IRs and the operand test) |
| 4 | `tools.ts`, G3 threshold `> 1024` → `> 1124` | `long_names.oracle.test.ts` | **2 fail** |
| 5 | M4b and the N3 sort removal (section 3) | `di_builder.oracle.test.ts` | **1 fail** each |

## 5. Regressions
- **`bunx tsc --noEmit -p .`:** clean.
- **`bun scripts/coverage.ts --check`,** with the pins patch in scratch:
  `markers ok (27357, 103 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5392; library 745; llvm 676)`.
  - `--missing …/SymbolWrapper.cpp`: 7/7.
  - `--crate llvm-wrapper`: 103/197.
  - `bun tools/llir/ffi_gen.ts --check`: up to date.
- **`RUST_TS_REQUIRE_PROBES=1 bun test ./src/rust_ts/ ./src/rustc_codegen_llvm/ ./scripts/lib/unit-steps.test.ts`:** 506 pass,
  0 fail (51 files, 81.8 s).
- **`--sample 200 --jobs 6`,** with `RUST_TS_AGENT=rev-cbm-k7`:

  | Suite | Result | Protected in sample | Lost | Run |
  |---|---|---|---|---|
  | run-pass-native | MATCH 199, UNPORTED 1 (`issue-64655…#thin3`, not protected) | 199 | **0** | `20261115-095154-rev-cbm-k7-hcwm` |
  | ir-run-pass | MATCH 197, DIFF 1, UNPORTED 2 (`#fat3`, `#thin3`; neither protected here) | 196 | **0** | `-095404-…-gztp` |
  | ir-host | MATCH 197, DIFF 1, UNPORTED 2 (the same cases) | 197 | **0** | `-095538-…-dksb` |
  | ir-hello | MATCH 2 | 2 | **0** | `-095720-…-hpvb` |

  - The DIFF in both IR suites is `tests/ui/functions-closures/parallel-codegen-closures.rs` (a `.llvm.N` promotion of a vtable). It
    is not in either suite's baseline, and nothing this lane touches is involved.
  - CRASH and TIMEOUT are 0.

## Findings

**N1. G3's detector counts named struct types as locals** (`src/rust_ts/llvm/tools.ts:155`).
- `hasLongLocalName`'s pattern `(?:%|^)"…"` matches `%"<type name>" = type {…}` and every use of that type.
- Checked directly: a module whose only long name is an 1118-byte struct type gives `true`.
- LLParser puts no limit on type names. The limit is only for function-local values (Function.cpp:64 `NonGlobalValueMaxNameSize`,
  ValueSymbolTable.cpp:112).
- rustc names LLVM struct types after the full Rust type whenever it keeps names (for example `--emit=llvm-ir`), and those can pass
  1024 bytes. Such modules then get the flag, and with it N2's difference, when no local needs it.
- **Fix:** match only local definitions: `%name =` and `%"name" =` inside a function body, parameter names in a `define` line, and
  labels. Every local LLParser checks is defined in one of those places. Add a struct-type case to the detector test.

**N2. G3's leftover difference reaches bitcode and verbose asm, and llvm-link's bitcode sources** (`tools.ts:136-144`, `:1221`).
- The doc comment and the handoff say the difference "changes only local value names (never symbols, so never objects or behaviour)",
  and that "the bitcode readers (…llvm-link's sources) … get no flag".
- **Bitcode and verbose asm:**
  - Bitcode keeps function-local value symbol tables, so `--emit=llvm-bc` and embedded or linker-plugin-LTO bitcode objects would
    carry the untruncated names.
  - Verbose asm prints IR block names in comments.
- **llvm-link:** when the destination text has a long local, the flag is process-wide. The `.bc` sources read in that same `llvm-link`
  run are then not truncated either, unlike rustc's in-process bitcode parse.
- None of this changes code. Every such module used to stop, so no protected case is affected, and a difference shows as a DIFF.
- **Fix, either:**
  - (a) correct the comment and have root record a decision (`state.ts record decision`) accepting the named difference; or
  - (b) after an affected tool run, stop by name when the output holds a local name over 1024 bytes that the input text did not
    have. That is exactly where in-process LLVM would have truncated.

  (b) keeps PORTING's "never a guessed value" without a decision.

**N3. A malformed-ELF edge stops where LLVM falls back** (`src/rust_ts/llvm/object_file.ts:743`, via `symName` :706).
- Upstream `getSymbolName` (ELFObjectFile.h:571) treats a failed `getName` like an empty name: an `STT_SECTION` symbol with an
  out-of-range `st_name` still gets its section's name.
- The port stops inside `symName` first.
- It is a stop, not a wrong value, and only a malformed object reaches it. A one-line `// PORT:` note would make the ordering
  deliberate.

**N4. The `findBaseObject` stop names the wrong cause** (`src/rust_ts/llvm/mangler.ts:191`).
- Any aliasee that is neither a `GlobalObject` nor a `GlobalAlias` reaches the stop "through a constant expression". That includes a
  null pointer or an integer constant, where upstream returns `nullptr` (Globals.cpp:518), and LLVM then mangles as a plain global.
- rustc's aliases always name a global, so this is unreachable. Say "a non-global aliasee" in the message, or return `undefined` for
  non-`ConstantExpr` constants as upstream does.

## For root
- Apply `docs/handoff/llir-callbr-mangler/llvm-pins.patch` before merging; the 18 SHA-256 values check out against the fetched files.
  Update `scripts/coverage.test.ts` as the handoff says.
- The handoff's G2 (bitcode members) route and the pm-self F1 use-list note are reasonable lane plans. Neither is a finding here.
