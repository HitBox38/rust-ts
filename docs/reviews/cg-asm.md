# Independent review: cg-asm (wave 40s)

Branch `t3/port-inline-global-asm`, commits `3616fbaa` (port, model, tests) and `8c4e0762` (handoff), on top of main `2bf7435a`
(`git diff 2bf7435a 8c4e0762`). Tested at `8c4e0762` on the review branch. Code read-only. The wiring patch and the mutations ran in a
throwaway worktree, which was left clean. No gate or full suite run. AC power throughout; `--jobs 6` at most.

## Verdict: APPROVE WITH NITS

**The port is faithful, and every claim I tested held except a count and one case list in the handoff.**
- I read all 18 functions of `asm.rs` against `asm.ts` arm by arm: right order, right markers, no guessed values, and every stop is named.
- `inline_asm.ts` follows `InlineAsm.cpp`, Module.h/Module.cpp and `AssemblyWriter::printModule` at the pin.
- All three mutations made a test fail.
- The wiring patch is minimal and correct. With it, `asm/aarch64/const.rs` and `asm/empty_global_asm.rs` MATCH.
- No protected case left MATCH in the three samples.
- The claims that did not hold: the `llvm-as` fixture has **65** rows, not 66 (N1); and the handoff files `asm/cfg.rs` under
  `global_asm!`, though it reaches the mangler through naked functions (N6).
- The fixture's answers are hard-coded, with no committed way to remake them (N2). I re-derived all 65 with the pinned `llvm-as`: 0
  mismatches.

## 1. Fidelity

### `asm.ts` against `asm.rs`

All 18 markers point at the `fn` line upstream (28, 412, 527, 536, 641, 649, 666, 674, 684, 705, 728, 915, 1030, 1144, 1161, 1171, 1374,
1558). `coverage --missing`: 18/18.

- **`codegen_inline_asm`** (asm.ts:79 / asm.rs:28):
  - **Output loop:** the order of the four `Out` branches holds: place, then the x87/mmx whole-set clobber, then the clobber when the
    target lacks the feature or the class is clobber-only, then `dummy_output_type`. So do the `=`/`=&` prefix and the `InOut` layout
    choice.
  - **Input loop:** the duplicated constraint for a late `InOut` with an explicit register; the `s` constraint for pointer `const` and
    thread-local `sym` operands.
  - **Template:** `$` becomes `$$` only in string pieces; `${n:m}`, `${n:c}`, and `{offset:+}` via a signed `bigint`; `!i` labels get
    `${len:l}`.
  - **Clobbers:** the `clobbers` append; the per-arch flags table (all 24 arms checked, including LoongArch `$fcc0..7` and Sparc
    `icc`/`fcc0..3`); `~{memory}` unless `nomem`.
  - **Attributes:**
    - `volatile` is `!pure` (`sideeffect`), `alignstack` is `!nostack`, Intel dialect is x86 without `att_syntax`, `unwind` is
      `may_unwind`.
    - Memory effects: `pure`+`nomem` gives `None`, `pure`+`readonly` gives `ReadOnly`, `pure` adds `WillReturn`, else `nomem` gives
      `InaccessibleMemOnly` and `readonly` gives `ReadOnlyNotPure`.
    - The output stores: `noreturn` skips `dest`, then the label blocks. `nounwind` and `noreturn` are not set here upstream either.
- **`codegen_global_asm`** (asm.ts:481 / asm.rs:412):
  - The `.intel_syntax`/`.att_syntax` prefix and the closing `\n.att_syntax\n`.
  - String pieces are not `$`-escaped (correct for module asm).
  - `const` Int goes through `asm_const_to_str`. `const` Ptr: `alloc_to_backend(.., true, ..)`, `add_compiler_used_global` before the
    mangled name, `escape_symbol_name`, then the signed offset.
  - Thread-local `sym`: `renamed_statics` (a `DefIdMap`) first, else `get_static`.
  - Features: the global backend features, then `+`-prefixed `to_llvm_features` names (`LLVMFeature.into_iter()` returns an array,
    so `flatMap` flattens it), joined with `,`.
- **`reg_to_llvm`** (asm.ts:833 / asm.rs:728):
  - The xmm/ymm/zmm class comes from the size (64 → z, 32 → y, else x; discarded → x).
  - a64 `x`/`w` comes from the size, with the `x30` → `{lr}` LLVM < 23 workaround. The pinned LLVM is 23.1.3, so that branch is not
    taken, but it is ported. The comparison works because `InlineAsmReg` values are interned (`intern_reg`).
  - a64 vregs: `z` for scalable, then q/d/s/h/d(i8) by size.
  - Hexagon pairs, including the gap at `r19_18`.
  - Arm `r14` → `{lr}`.
  - Sparc stops at `dreg_number`. That is exactly right: upstream calls `dreg_number()` first for every Sparc register.
  - The class table: all ~90 arms checked letter by letter, including `@3Upa`, `^wa`, `^Yk`, `Q`/`q`, `v` for zmm, AVR `d`/`w`/`e`,
    S390x `a`, M68k `a`/`d`. Amdgpu stops (named), since `Sgpr(_)`/`Vgpr(_)` carry data the stub does not have.
- **`modifier_to_llvm`** (asm.ts:1177 / asm.rs:915): every arm matches, including x86 reg (`None` → `q` on x86_64, else `k`; `l` → `b`,
  `x` → `w`, `e` → `k`, `r` → `q`), the xmm/ymm/zmm pairs (`t`/`g`), Arm `P`/`q`, LoongArch `w`/`u`, PowerPC vsreg `x`, AVR `B`/`A`.
- **`dummy_output_type`** (asm.ts:1356 / asm.rs:1030): every arm matches, including a64 preg `<vscale x 16 x i1>`, Hexagon HVX widths from
  `hvx_length128b`, x86 vector classes as `f32`, kreg `i16`, Sparc qreg `f128`.
- **`llvm_fixup_input`/`llvm_fixup_output`/`llvm_fixup_output_type`** (asm.ts:1669, 1793, 1900 / asm.rs:1171, 1374, 1558): the if-chains
  keep upstream's arm order and guards.
  - **aarch64:** vreg i8 → `<8 x i8>` at lane 0. vreg_low16 scalar (not f128) → `16 / size` lanes, with `ptrtoint`/`inttoptr` for
    pointers. 8-byte vreg_low16 vectors are shuffled to twice the lanes: `const_u32` indices on input, `const_i32` on output, as upstream.
  - **x86:** reg_abcd f64 ↔ i64. 64-byte vectors → `<8 x double>` and back through `layout.llvm_type`. On x86 only, f128 →
    `<4 x i32>`. f16 → `<8 x half>` at lane 0, bitcast to `<8 x i16>`. f16 vectors of 8/16 lanes ↔ i16 vectors.
  - **Arm:** sreg i32 ↔ f32, dreg i64 ↔ f64, f16 vectors of 4/8 lanes.
  - **Other arches:** LoongArch and RISC-V NaN-boxing (`0xffff_0000`; RISC-V only without `zfhmin`/`zfh`). MIPS widening to i32/i64.
    PowerPC lane offset 3 for f16 and the endianness index.
  - "Inherent before trait" (`bitcast_inherent`/`trunc_inherent`) is the crate's recorded convention.

### `inline_asm.ts` against LLVM at the pin

- **`ConstraintInfo::Parse`** (:79):
  - Prefixes: `~` must be followed by `{`, then `=` and `!`. Then `*`; a bare prefix is rejected.
  - Modifiers: `&` only on outputs and once, `%` not on clobbers and once, `#`/`*` rejected.
  - `{...}` needs its `}`.
  - Matching numbers by maximal munch: N must be an earlier output, and this constraint an input. The multi-alternative and
    single-alternative matching-input checks, including the `!= ConstraintsSoFar.size()` exception.
  - `|`, `^xy`, `@N...`, single letters.
  - The two places LLVM reads past `E` (undefined behaviour) are documented and cannot arise from rustc's strings.
- **`ParseConstraints`** (:236): empty constraints and a trailing `,` give an empty result. Later `Parse` calls write `MatchingInput` into
  the stored copy in `Result`, as in C++.
- **`verify`** (:274): the variadic check first, then "failed to parse". The ordering rules, with the indirect-output fallthrough into
  the input case (an if-chain, `// PORT:`d). The 0 / 1 / many output cases, then the parameter count. All nine messages are LLVM's
  strings.
- **Module asm:**
  - `GlobalAsmFragment`'s constructor adds a trailing newline. `appendModuleInlineAsm` drops an empty fragment and merges into the last
    fragment when the properties are equal.
  - `getAsStrings` gives `target_features` then `target_cpu`, each only if non-empty.
  - The printer matches AsmWriter.cpp:3129-3160: blank line, `module asm`, `(k: "v", ...)` with `printEscapedString`, then one quoted
    line per `split('\n')`, `do`/`while`.
  - `LLVMRustAppendModuleInlineAsm` is the LLVM ≥ 23 branch of RustWrapper.cpp:661.
- **`core.ts`:** only `LLVMRustInlineAsmVerify` and one import change. It returns `!errorToBool(verify(..))` as RustWrapper.cpp:654 does.

## 2. Evidence

- `bun test src/rust_ts/llvm/inline_asm.test.ts src/rustc_codegen_llvm/asm.test.ts`: **8 pass, 0 fail** (2.1 s; with
  `RUST_TS_REQUIRE_PROBES=1`, so nothing was skipped).
- **`asm.test.ts`** compares the port's `--emit=llvm-ir` of `asm_oracle/{a64,x64}.rs` with committed oracle `.ll` files. It also re-makes
  those fixtures with the pinned rustc on each run and requires them unchanged. It is self-checking.
- **The `llvm-as` answers in `inline_asm.test.ts` are hard-coded.** The test does not run `llvm-as`, and the script that produced them is
  not committed ("Generated once by a script", inline_asm.test.ts:6).
  - `llvm-tools-preview` is a pinned component (`UPSTREAM.json`), so the tool is the oracle's own: LLVM 23.1.3-rust-1.101.0-nightly.
  - I rebuilt each row as `define void @f(<params>) { [%r =] call <ret> asm sideeffect "", "<constraints>"(<params>) ret void }` and ran
    the pinned `llvm-as`. All **65** rows give the fixture's answer: 0 mismatches. The whole run takes 1.0 s. See N1 and N2.
- **Wiring patch, applied in the scratch worktree only:**
  - It applies cleanly. It is 3 files, +7/−3: `impl_modules.ts` (one entry), `printer.ts` (the import and one line after `target triple`,
    which is where `printModule` puts module asm: before type identities and comdats), and `ffi.ts`.
  - The `ffi.ts` hunk is **byte-identical** to a fresh `bun tools/llir/ffi_gen.ts`. `bunx tsc` is clean with it.
  - The printer ↔ inline_asm import cycle is function-level only, as claimed.
  - `LLVMCloneModule` (tools.ts:753) copies the printed text, so module asm survives the clone in `back/write.ts`. The handoff's caveat
    about the side table is harmless today.
  - The now-dead `m.inlineAsm` check (printer.ts:590) is left for ir-fix-b, as the handoff says.
- **Runs with the patch:**
  - `run-pass-native`: `asm/aarch64/const.rs` **MATCH**, `asm/empty_global_asm.rs` **MATCH**.
  - `ir-run-pass`, `--filter global_asm`: 2 MATCH (`empty_`, `simple_global_asm`); `x86_64/global_asm_escape` stops at
    `LLVMRustGetMangledName`.
  - `ir-run-pass`, `asm/x86_64/const`: MATCH. These IR-text suites check the printed `module asm(...)` lines byte for byte.
  - `ir-host`, `--filter asm/`: 7/8 MATCH; `label-operand#aarch64` stops at `LLVMBuildCallBr`.

## 3. The remaining blockers

- **`LLVMBuildCallBr`** is a `stub(..)` in `ffi.ts:983`. The model has no `callbr` builder or printer; inst.ts:209/216 only name the opcode
  in predicates. `label-operand.rs#aarch64` stops there (above). The stop is real and correctly named.
- **`LLVMRustGetMangledName`** is a `stub(..)` (`ffi.ts:1418`). RustWrapper.cpp:1662 calls `Mangler().getNameWithPrefix`, which is in
  `llvm/lib/IR/Mangler.cpp`, and that file is not in `harness/llvm-manifest.json`. The stop is real and the file named is the right one.
- **The 5 cases that stopped at `cg-asm: ... mangled_name` in `gate-20261114-162816-root-vc2v`** (all `ir-run-pass`): `abi/custom.rs`,
  `asm/cfg.rs#reva`, `asm/cfg.rs#revb`, `c-variadic/naked.rs`, `c-variadic/same-program-multiple-abis-x86_64.rs`.
  - On this branch all 5 now stop at **`llir: LLVMRustGetMangledName`**, and so do the 3 of them in `ir-run-pass-o0`. So everything
    before the mangler call works.
  - All five are naked-function cases: `asm/cfg.rs` has `#[unsafe(naked)]`/`naked_asm!` and no `global_asm!`. So they reach the
    mangler through `mangled_name`. The handoff's item 2 lists `cfg.rs` under `global_asm!` (N6).

## 4. `skeleton.test.ts`

- **Correct.** The base had exactly 3 `unported("cg-asm: ...")` (`codegen_global_asm`, `mangled_name`, `codegen_inline_asm`); the
  branch has none. It adds 2 `unported("rustc_target::...")`, which the test counts under the crate key `rustc_target`, as it already does
  for `rustc_session` and `rustc_sanitizers`.
- The `mangled_name` stop probe is replaced by a comment, as for the other fully ported lanes.
- The test passes in the full run below. `docs/handoff/cg-contract.md`'s table is root's to update.

## 5. Mutations (each reverted; the scratch tree was clean afterwards)

| # | Mutation | Result |
|---|---|---|
| M1 | asm.ts:1053 `reg_abcd` → `"R"` (was `"Q"`) | **fail**: `x64.rs ... the port's IR is the oracle's` |
| M2 | asm.ts:1685 `llvm_fixup_input` vreg_low16 lane count `8 / size` (was `16 / size`) | **fail**: `a64.rs ... the port's IR is the oracle's` |
| M3 | inline_asm.ts:329 `NumInputs !== 0` (was `NumInputs - NumIndirect !== 0`) | **fail**: `InlineAsm::verify > matches the pinned LLVM on every fixture` |

## 6. Regressions

- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (27237, 76 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5392; library 745; llvm 533)`.
- `bun test ./src/rustc_codegen_llvm/ ./src/rust_ts/llvm/ ./scripts/lib/unit-steps.test.ts`: **339 pass, 0 fail** (31 files, 30.6 s).
- Samples, `--sample 200 --jobs 6`, `RUST_TS_AGENT=rev-cg-asm` (runs `rev-cg-asm-s200-<suite>`):

| Suite | Result | Protected in sample | Lost |
|---|---|---|---|
| `run-pass-native` | MATCH 192, UNPORTED 8 | 192 | **0** |
| `ir-run-pass` | MATCH 195, UNPORTED 5 | 195 | **0** |
| `ir-host` | MATCH 192, UNPORTED 8 | 192 | **0** |

  - DIFF, CRASH and TIMEOUT are 0 in all three.
  - Every UNPORTED is another lane's stop: `LLVMCreateDIBuilder` ×3, the aarch64 intrinsic table, cg-intrinsic-b's
    `simd_funnel_shl`, and `rustc_sanitizers` (kcfi).

## Findings

No F findings.

- **N1.** docs/handoff/cg-asm.md:17 and :54 say the `InlineAsm::verify` fixture has 66 rows. `FIXTURES` in
  src/rust_ts/llvm/inline_asm.test.ts:15-80 has **65** (counted, and loaded by my regeneration script). There is no upstream line;
  correct the count.
- **N2.** src/rust_ts/llvm/inline_asm.test.ts:4-7: the 65 `llvm-as` answers are hard-coded, and the script that made them is not committed.
  So nothing re-checks them, unlike asm.test.ts, whose oracle fixtures are re-made on every run.
  - Running the pinned `llvm-as` (`llvmBinDir(sysroot, host)`, scripts/lib/llvm-tools.ts:16) over all 65 rows takes about 1 s.
  - Either commit the generator, or have the test run it when the toolchain is present, as asm.test.ts does. Upstream: llvm/lib/AsmParser
    (LLParser's call to `InlineAsm::verify`).
- **N3.** src/rust_ts/llvm/inline_asm.ts:382, 402, 412, 417, 424 model inline members of the pinned `llvm/include/llvm/IR/Module.h`.
  Those are `GlobalAsmProperties::operator==` (Module.h:183), the `GlobalAsmFragment` constructor (:198), `getModuleInlineAsm` (:330),
  `hasModuleInlineAsm` (:340) and `appendModuleInlineAsm` (:393).
  - They cite Module.h in doc comments instead of `// llvm:` markers. PORTING §5c's marker would let `coverage --check` verify them.
  - Add the markers if the finder accepts header inline definitions; otherwise leave this as is.
- **N4.** src/rust_ts/llvm/inline_asm.ts:439 `bytesArg` is a copy of core.ts:89's (bodies identical apart from the following doc comment),
  because core.ts does not export it. When ir-fix-b applies the wiring, export core.ts's and drop the copy. There is no upstream line;
  this is model glue.
- **N5.** src/rustc_codegen_llvm/asm.ts:1663 `lanes()` reads `repr.count as number`. Upstream calls `count.as_u32()` (asm.rs:1207) and
  `count.as_u64()` (asm.rs:1255, 1295, 1404, 1448, 1488, 1585, 1623, 1663). `BackendLaneCount.as_u32` exists (rustc_abi/lib.ts:377).
  The value is the same; calling it keeps the port greppable.
- **N6.** docs/handoff/cg-asm.md:105 lists `cfg.rs` among the "`global_asm!` with `sym` or a pointer `const`" cases. tests/ui/asm/cfg.rs
  has no `global_asm!`. Its revisions reach `LLVMRustGetMangledName` through naked functions (`naked_asm!`, cfg.rs:10-36), that is,
  through `mangled_name` (asm.rs:527).
  - Only `x86_64/global_asm_escape.rs` belongs on that line. It matters only for the record of what `Mangler.cpp` unblocks: both routes
    need it.
