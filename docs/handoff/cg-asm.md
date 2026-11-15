# Handoff: cg-asm (M7c, wave 40s): inline and global asm

Branch `t3/port-inline-global-asm` (from `2bf7435a`; no merges). Commits at the end.

## Summary
- **`asm.rs` is ported whole: 18/18 fns** (`src/rustc_codegen_llvm/asm.ts`, upstream order, markers):
  - `codegen_inline_asm`, `codegen_global_asm`, `mangled_name`;
  - `xmm_reg_index`, `a64_reg_index`, `a64_vreg_index`, `hexagon_reg_pair_index`, `hexagon_vreg_pair_index`, `reg_to_llvm`,
    `modifier_to_llvm`, `dummy_output_type`, `llvm_asm_scalar_type`, `any_target_feature_enabled`;
  - `llvm_fixup_input`, `llvm_fixup_output`, `llvm_fixup_output_type`;
  - `inline_asm_call` and `allow_raw_span_inline_asm_srcloc` were cg-register's and are unchanged.
- **`InlineAsm::verify` is modelled** in a new file, `src/rust_ts/llvm/inline_asm.ts`:
  - `ConstraintInfo::Parse`, `selectAlternative`, `ParseConstraints`, `makeStringError` and `verify`, with `// llvm:` markers
    (InlineAsm.cpp, already pinned).
  - `core.ts`'s `LLVMRustInlineAsmVerify` now returns `verify(..) === undefined`. That function and one import line are the only
    edits to `core.ts`.
  - The permissive stand-in (D10) is gone. On all 66 fixture strings the model gives the pinned LLVM's answer and message.
- **Module-level asm is modelled in the same new file but not wired.** This is what `global_asm!` and naked functions need:
  - `GlobalAsmProperties`, `GlobalAsmFragment` and `appendModuleInlineAsm`, from Module.h/Module.cpp (pinned);
  - `LLVMRustAppendModuleInlineAsm` (RustWrapper.cpp:661), the LLVM ≥ 23 branch;
  - the `module asm(...)` lines of `AssemblyWriter::printModule` (AsmWriter.cpp:3129).
  - Wiring needs three edits in ir-fix-b's files; see **For root / ir-fix-b**.
- **The 8 gate cases** (`run-pass-native`, stopped at `codegen_inline_asm`/`codegen_global_asm` in
  `gate-20261114-162816-root-vc2v`):

| Case | This branch | With the module-asm wiring |
|---|---|---|
| `tests/ui/allocator/regression-abort-on-free-issue-150898.rs` | MATCH | MATCH |
| `tests/ui/asm/aarch64/llvm-58384.rs` | MATCH | MATCH |
| `tests/ui/asm/aarch64/may_unwind.rs` | MATCH | MATCH |
| `tests/ui/asm/aarch64/type-f16.rs` | MATCH | MATCH |
| `tests/ui/asm/may_unwind.rs` | MATCH | MATCH |
| `tests/ui/asm/aarch64/const.rs` | UNPORTED `llir: LLVMRustAppendModuleInlineAsm` | **MATCH** |
| `tests/ui/asm/empty_global_asm.rs` | UNPORTED `llir: LLVMRustAppendModuleInlineAsm` | **MATCH** |
| `tests/ui/asm/label-operand.rs#aarch64` | UNPORTED `llir: LLVMBuildCallBr` | UNPORTED `llir: LLVMBuildCallBr` |

  Runs: `cg-asm-rpn-asm1` (this branch), `cg-asm-rpn-asm2` (with the wiring patch below), `cg-asm-rpn-raof`.
  `tests/ui/asm/simple_global_asm.rs` was already MATCH on `run-pass-native`: on aarch64 its `global_asm!` is `cfg`'d out.

## Evidence
- **Oracle IR fixtures, committed:** `src/rustc_codegen_llvm/asm.test.ts` with `asm_oracle/{a64.rs,x64.rs}` and the pinned rustc's
  `--emit=llvm-ir` for aarch64-apple-darwin and x86_64-unknown-linux-gnu (va_arg.test.ts's pattern).
  - What the crates cover: register classes (`reg`, `vreg`, `vreg_low16`, `reg_abcd`, `reg_byte`, `xmm_reg`, `ymm_reg`), explicit
    registers (incl. `x30`, `v3` as `{d3}`, `st(0)`, `mm0`, `k1`, `xmm0`/`ymm1` as clobbers), `in`/`out`/`inout`/`lateout`,
    `inout(..) => _`, discarded outputs, `const`, `sym` (`${n:c}`), `pure`, `nomem`, `readonly`, `nostack`, `preserves_flags`,
    `noreturn`, `att_syntax`, `clobber_abi("C")`, and `may_unwind` both as a `call` and, with a cleanup, as an `invoke`.
    Also modifiers, `$` escaping, multi-line templates and `!srcloc`.
  - The port's IR equals the oracle's: 22 asm calls on aarch64, 24 on x86_64. The fixtures are re-made and checked when the
    toolchain is present.
  - The same crates with `global_asm!` (`const`, `options(raw)`, `att_syntax`) were compared ad hoc with the wiring applied:
    diff 0 apart from `;` comment lines, including the `module asm(target_cpu: "...")` block. Not committed, as the wiring is not
    on this branch.
- **`InlineAsm::verify` unit tests:** `src/rust_ts/llvm/inline_asm.test.ts`.
  - The fixture is 66 rows (constraint string, return and parameter types) with what the pinned `llvm-as`
    (nightly-2026-10-11's llvm-tools) says about `call <ret> asm sideeffect "", "<constraints>"(<params>)`.
  - LLParser runs `InlineAsm::verify` and prints its message. Rows that LLParser accepted but the IR verifier then rejected
    (`!i` outside `callbr`, a missing `elementtype`) count as "verify passed".
  - The rows cover rustc-shaped strings for both targets and every failure path of `ParseConstraints`, `Parse` and `verify`.
  - Also tested: the module-asm model (fragment merge, an empty fragment dropped, line splitting, escaping).
- **Unit-test wall time added:** about 6.4 s (asm.test.ts 6.3 s: two port compiles and two oracle compiles; inline_asm.test.ts
  0.02 s).
- **Oracle stderr:** asm.rs emits no user diagnostics, only `span_bug!`/`bug!`/`unreachable!` (ICEs). So there is nothing of
  this file's to compare on stderr.
- **Other asm cases, filtered runs on this branch:**
  - `ir-run-pass` (x86_64-linux), run `cg-asm-ir-run-pass-asm`: MATCH `asm/may_unwind`, `asm/x86_64/may_unwind`,
    `asm/x86_64/multiple-clobber-abi`, `asm/x86_64/sym`.
  - Still UNPORTED there:
    - `LLVMRustAppendModuleInlineAsm`: `empty_global_asm`, `simple_global_asm`, `x86_64/const`;
    - `LLVMRustGetMangledName`: `cfg#reva`, `cfg#revb`, `x86_64/global_asm_escape`;
    - `LLVMBuildCallBr`: `label-operand#x86_64`, `x86_64/goto`.
  - `ir-host`, run `cg-asm-ir-host-asm`: 5/8 MATCH. The other 3 are the same model stops as on `run-pass-native`.
- **Coverage:**
  - `bun scripts/coverage.ts --missing compiler/rustc_codegen_llvm/src/asm.rs`: 18/18.
  - rustc_codegen_llvm: 728/820 (88.78%).
  - llvm-wrapper: 76/197 (`LLVMRustAppendModuleInlineAsm` counts once it is bound).
- **Checks:**
  - `bunx tsc`: clean.
  - `bun scripts/coverage.ts --check`: markers ok.
  - `bun test ./src/rustc_codegen_llvm/ ./src/rust_ts/llvm/ ./scripts/lib/unit-steps.test.ts`: 339 pass after the
    skeleton.test.ts update below.
- **Sample runs (`--sample 200 --jobs 6`, `RUST_TS_AGENT=cg-asm`):** 
  - `run-pass-native`: MATCH 191/200, UNPORTED 9.
    - 7 are the aarch64 intrinsic table (`llvm.aarch64.isb`), 1 is thin LTO, 1 is cg-intrinsic-b's `generic_simd_intrinsic`.
    - Run `cg-asm-s200-run-pass-native`.
  - `ir-run-pass`: MATCH 196/200, UNPORTED 4.
    - `asm/x86_64/goto.rs` is `LLVMBuildCallBr`; the others are thin LTO, kcfi and `generic_simd_intrinsic`.
    - Run `cg-asm-s200-ir-run-pass`.
  - `ir-host`: MATCH 191/200, UNPORTED 9, the same 9 as `run-pass-native`. Run `cg-asm-s200-ir-host`.
  - **No protected case left MATCH.** The samples held 191, 195 and 191 cases of `harness/baseline/<suite>.txt`; all are MATCH.
  - DIFF, CRASH and TIMEOUT are 0 in all three.

## For root / ir-fix-b
1. **Wire module asm**: `docs/handoff/cg-asm/module-asm-wiring.patch` (`git apply`; it includes the regenerated `ffi.ts` hunk, or rerun `bun tools/llir/ffi_gen.ts`). It is 3 edits in ir-fix-b's files. This takes `aarch64/const.rs` and
   `empty_global_asm.rs` to MATCH on `run-pass-native`/`ir-host`, and the `global_asm!` cases on `ir-run-pass`. The
   `LLVMRustGetMangledName` ones are excepted (item 2).
   - `src/rust_ts/llvm/impl_modules.ts`: append `"./inline_asm.ts"` to `IMPL_MODULES`. Regenerating `ffi.ts` then binds
     `LLVMRustAppendModuleInlineAsm` to `impl5` (287 of 381 implemented).
   - `src/rust_ts/llvm/printer.ts`, `module_`: after the `target triple` line, add `o += printModuleInlineAsm(m);` and import it
     from `./inline_asm.ts`. The cycle with `printEscapedString` is function-level only; it was run as described.
   - Then `Module.inlineAsm` (the string) and its `unported("llir: printing module inline asm")` are dead. They can go, or the
     side table in inline_asm.ts can move onto `Module` as a field. That is ir-fix-b's choice.
   - `LLVMCloneModule` does not copy the side table. No caller needs it today.
   - I did not regenerate ffi.ts on this branch: it is unchanged.
2. **`LLVMRustGetMangledName`** (RustWrapper.cpp:1662) is the next stop:
   - `global_asm!` with `sym` or a pointer `const`: `cfg.rs`, `global_asm_escape.rs`;
   - `mangled_name`, for naked functions: the 5 gate cases that stopped at `cg-asm: ... mangled_name` now stop here.
   - It needs `Mangler::getNameWithPrefix`. **LLVM file to pin: `llvm/lib/IR/Mangler.cpp`** (`bun scripts/llvm-src.ts add
     llvm/lib/IR/Mangler.cpp`; this lane may not edit `harness/`).
3. **`LLVMBuildCallBr`** (asm goto, `label` operands): `label-operand.rs#aarch64` (a gate case), `#x86_64` and
   `x86_64/goto.rs`. It needs a `callbr` instruction in the model: `IRBuilder::CreateCallBr`, its successors, and AsmWriter's
   `callbr` printing (inst.ts, build.ts, printer.ts; ir-fix-b).
4. **`skeleton.test.ts`** (rustc_codegen_llvm). Its own comment says "a fill lane that ports a stub lowers its count here", so I
   updated it:
   - `"cg-asm": 3` is dropped;
   - `"rustc_target": 2` is added: asm.ts's two stops in stub arch modules;
   - the `mangled_name` stop check is replaced by a comment.
   - `docs/handoff/cg-contract.md`'s table, which the test names, is not mine to edit.

## `unported(...)` left
- `asm.ts` `reg_to_llvm`, `rustc_target::asm::sparc::SparcInlineAsmReg::dreg_number`. `SparcInlineAsmReg` is a stub module (lane
  target-asm), so the `dreg_number`/`qreg_number` arms stop.
- `asm.ts` `reg_to_llvm`, `rustc_target::asm::amdgpu::AmdgpuInlineAsmRegClass (reg_to_llvm)`. `Sgpr(_)`/`Vgpr(_)` carry a size
  the stub's opaque values do not have.
- No built-in target reaches either.

## `// PORT:` decisions
- **asm.ts header:**
  - Arch-class `match`es are a switch on the tag, then on the class name. Stub arch modules compare against upstream variant
    names.
  - `reg as u32` is `X86InlineAsmReg.discriminant`.
  - Inherent before trait: `bitcast_inherent`/`trunc_inherent`.
  - `self.tcx` is `this.cx_.tcx`.
  - `op_idx[&idx]` panics when absent (`index_op_idx`).
  - Modifiers are code points.
  - Lane counts are `number`.
- **asm.ts, three `// PORT:` arms:** a class name not in an exhaustive upstream `match` is `unreachable()`.
- **inline_asm.ts header:**
  - Strings are byte strings; iterators are indices.
  - `hasMatchingInput()` is written out.
  - `Error` is the message or `undefined`.
  - **Reading `*I` at the end iterator:** the model reads `undefined`. It differs from LLVM only if the byte past the whole
    constraint string is `*`, which is undefined behaviour in LLVM.
  - **`^`/`@N` stepping past `E`:** the loop stops at `I >= E` (LLVM: undefined behaviour). rustc only emits `^Yk`, `^wa`,
    `@3Upa`.
  - Module asm lives in a side table, because this lane owns no file of `Module`.
- **inline_asm.ts `verify`:** the `switch` with its fallthrough is an if-chain, because `noFallthroughCasesInSwitch` rejects the
  fallthrough.

## Files touched
- `src/rustc_codegen_llvm/asm.ts` (ported);
- `src/rustc_codegen_llvm/asm.test.ts`, `src/rustc_codegen_llvm/asm_oracle/*` (new);
- `src/rust_ts/llvm/inline_asm.ts`, `src/rust_ts/llvm/inline_asm.test.ts` (new);
- `src/rust_ts/llvm/core.ts`: `LLVMRustInlineAsmVerify` and its import only;
- `src/rustc_codegen_llvm/skeleton.test.ts`: the stub-count table (item 4 above);
- `docs/handoff/cg-asm.md`.

## Commits
- `3616fbaa` cg-asm: port asm.rs whole and model InlineAsm::verify and module asm
- (this handoff) cg-asm: handoff
