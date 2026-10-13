# Handoff: target-asm (wave 10 follow-up: rustc_target::asm)

Branch `lane/target-asm` (from main 449202c). No merges.

`rustc_target::asm` is ported for the architectures of rust-ts's 6 built-in targets: x86 / x86_64,
aarch64 and wasm32. `Session::asm_arch` is now computed by `build_session`, as upstream does. All
`asm!` / `global_asm!` / `naked_asm!` cases now read the real value. Before, they stopped at the deferred field.

## Files
- **New: `src/rustc_target/asm/`**
  - `mod.ts`: all of mod.rs, plus the `def_reg_class!` / `def_regs!` / `types!` helpers.
  - `x86.ts`, `aarch64.ts`, `wasm.ts`: full ports.
  - 17 stubs: `amdgpu arm avr bpf csky hexagon loongarch m68k mips msp430 nvptx powerpc riscv s390x sparc spirv xtensa`.
    Each stub has opaque branded types and companion consts. Every fn in a stub calls `unported("rustc_target::asm::<mod>::<Type>::<fn>")`, including `riscv::is_e` and `powerpc::is_spe`.
- **Tests (new):**
  - `src/rustc_target/asm/asm.oracle.test.ts`
  - `asm_oracle/probe.rs`: a rustc-dev probe. Its header has the regeneration commands.
  - `asm_oracle/run.ts`
  - `asm_oracle/out.stdout`
- **Changed:**
  - `src/rustc_target/lib.ts`: `export * as asm` (`pub mod asm`).
  - `src/rustc_session/session.ts`, call site only:
    - `const asm_arch = target.allow_asm ? InlineAsmArch.from_arch(target.arch) : undefined`, passed to the constructor.
    - The field type is `InlineAsmArch | undefined`.
    - The `defer_field(sess, "asm_arch", ..)` call and its comments are removed.
  - `src/rustc_builtin_macros/rest_oracle/run.ts`: the `PORT(test)` workaround that overwrote `sess.asm_arch` is removed. It now asserts `{:?}` of the real `sess.asm_arch` against `@asm_arch`, as the probe does.

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_target/src/asm/<f>.rs`)
| file | fns |
|---|---|
| mod.rs | 33/33 |
| x86.rs | 11/11 |
| aarch64.rs | 11/11 |
| wasm.rs | 5/5 |

The other arch modules are stubs (0 ported; rust-ts has no target that selects them).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok (6319; vendor 2603).
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3280 pass, 1 skip (the existing linux-only test), 0 fail.
- `RUST_TS_AGENT=target-asm bun scripts/difftest.ts --suite parse --sample 200`: 200/200 MATCH (run `20261013-110336-target-asm-0vr6`).
- `rest.test.ts` (bm-rest): 208/208. Its ~60 asm cases now run with the `asm_arch` from `build_session`, on the host aarch64 and on `--target x86_64-unknown-linux-gnu`.

## Oracle test: `asm.oracle.test.ts`
`out.stdout` has 10,257 lines and is byte-identical to the port's output.

The probe runs on the 6 targets. It also forces other arches onto those targets: X86 on linux-gnu and windows-msvc, Arm64EC on aarch64-linux, and Wasm64 on wasip2. For each, it dumps:
- `InlineAsmArch::from_arch` / `allow_asm`.
- `InlineAsmRegClass::parse` on 22 names. For each parsed class:
  - name, Display, valid_modifiers, is_clobber_only
  - supported_types, with experimental regs off and on
  - default_modifier
  - suggest_class and suggest_modifier for 51 `InlineAsmType`s
- `InlineAsmReg::parse` on about 150 names: x86 and aarch64 registers, aliases, the `#error` registers, and unknown names. For each parsed register:
  - name, reg_class, Display
  - `validate` with is_clobber false and true, with features `[]` and `[reserve_x18]`
  - `emit` with no modifier and with every valid modifier
  - `overlapping_regs`
- `allocatable_registers`. The FxHashMap iteration order goes through the vendored hashbrown.
- `InlineAsmClobberAbi::parse` on 10 names, and `clobbered_regs`.
- `InlineAsmType` Debug / Display / size.

The last section, `== session`, runs `run_compiler` with `--target T` and prints the real `Session::asm_arch` for each target.

**Negative control:** changing the `InlineAsmRegClass` hash or the map's value layout fails 8 sections (the allocatable_registers order).

**Driver-level `asm!`:** a CLI run with `-Zunpretty=expanded` still stops before expansion at `rustc_lint::late::unerased_lint_store (pending lint-early-a)`. So no CLI asm case is reachable yet. The real session value is exercised through `run_compiler` instead: the `== session` section and bm-rest's rest_oracle.

## `unported(...)` left
- Every fn of the 17 stub arch modules (above).
- `InlineAsmClobberAbi::clobbered_regs` for Arm, Avr, RiscV/RiscVE, LoongArch, PowerPC/PowerPCSPE, S390x, Bpf, Msp430 and Xtensa. These lists need the stub modules' register enums.
- The `InlineAsmRegClass` `Hash` (FxHashMap key) for classes from stub modules.

None of these is reachable with the 6 ported targets.

## `// PORT:` decisions
1. **Enum representation.**
   - Per-arch fieldless enums are string unions, with a companion const holding the macro-generated and hand-written impls.
   - `self as u32` is the declaration index: the `ALL` array, via `discriminant`.
   - `InlineAsmArch` and `InlineAsmClobberAbi` are string unions. `asm.ts` (bm-rest) already compares with `"X86"` / `"X86_64"` and works unchanged.
2. **Macros as helpers.** `def_reg_class!`, `def_regs!` and `types!` are helper functions in mod.ts. They are function declarations, so the arch modules can call them during the import cycle. The macro fns carry markers at mod.rs:35/41/51/84/90/96/108/132.
3. **Interning.** `InlineAsmReg` and `InlineAsmRegClass` values are interned frozen singletons (`InlineAsmReg.X86(r)`), so `===` and Map/Set keys follow the derived `PartialEq`/`Hash`. `InlineAsmRegOrRegClass`, `InlineAsmType` and `InlineAsmSize` are plain objects with `eq` helpers.
4. **`allocatable_registers` returns an `FxHashMap`.** The key's `Hash` is `write_isize` of the outer discriminant, then of the inner one. The pair layout is `InlineAsmRegClass` (2, align 1) with `FxIndexSet<InlineAsmReg>` (56, align 8). Both are confirmed by the oracle's iteration order. `FxIndexSet` becomes `Set`.
5. **Uninhabited register enums.** `WasmInlineAsmReg` is `never`. In `InlineAsmReg::{name, reg_class, validate, emit, overlapping_regs}`, the Nvptx/SpirV/Wasm arms that upstream omits are `unreachable()`.
6. **`fmt::Write` / `fmt::Result`** are `FmtWrite` / `FmtResult` in mod.ts: one `write_str` per `write!`.
7. **`InlineAsmReg::parse` / `InlineAsmRegClass::parse`.** The `?` on the arch parser's `Result` is a local `wrap` helper.
8. **The brief's `InlineAsmArch::from_str` is upstream's `InlineAsmArch::from_arch(&Arch)`** at the pin.

## For root
- `src/rustc_builtin_macros/asm.ts:358` still has bm-rest's PORT comment saying `asm_arch` is deferred, and the `as string | undefined` cast. Both are stale but harmless. Remove them when that file is next touched.
- Delete `docs/claims/target-asm.md` on integration.
- `asm.oracle.test.ts` takes about 0.2 s.
