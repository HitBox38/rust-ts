# Handoff: cg-register (M7a, wave 40q): register the LLVM backend by forwarding, then `ir-hello`

Branch `t3/register-llvm-backend` (from `bcbd0c28`; no merges). Commits at the end.

## Summary
- **The backend is registered by forwarding**, per the decision recorded 2026-11-14:
  - `src/rust_ts/codegen_backend.ts` stays the registered backend for `init`, `target_config`, the print requests, `target_cpu`
    and `supported_crate_types`.
  - It forwards `codegen_crate`, `join_codegen`, `print_pass_timings`, `print_statistics`, `print_statistics_json` and `link` to
    `rustc_codegen_llvm`'s ported `LlvmCodegenBackend`.
- **`scripts/mono-run.ts`** calls a new exported helper, `mono_collection_head(tcx)`, instead of catching the after-collection
  stop. It is its own commit (`24030842`) and touches `scripts/` only.
- **`ir-hello` on this branch:** both cases stop at the IR model's `llir: LLVMRustInlineAsmVerify` stub. That is a model change
  this lane may not make, because it needs `ffi.ts` regenerated (fixers-57's file). The change is given below.
  - **With it applied, `ir-hello` is MATCH 2/2** (difftest run `cgreg-irhello-withmodel`): `-O` and `-Copt-level=0` are the same
    at N1, N2 and N3.
- **Two fixes from the first differences, in unowned ported files:**
  - asm.rs `inline_asm_call` (:536) and `allow_raw_span_inline_asm_srcloc` (:641). `black_box` reaches them in every std program,
    through `lang_start`'s `__rust_begin_short_backtrace`.
  - typetree.rs `add_tt`'s guard (:78-88). `memcpy` (builder.rs:1196) calls it with a type tree, and upstream returns at once
    unless `-Zautodiff=Enable` is set. The stub stopped unconditionally.

## The forwarding design (`src/rust_ts/codegen_backend.ts`)
- **`ported_backend(sess)`** loads the port on first use: `require("../rustc_codegen_llvm/lib.ts")`, then
  `new LlvmCodegenBackend()`.
  - It loads through the crate root, not `back/llvm_backend.ts`. lib.ts attaches the extension methods (`cx.llcx()` and others)
    and installs the auto-deref forwarders. Loading `back/llvm_backend.ts` directly gave `TypeError: this.llcx is not a
    function`.
  - The type import of the port is `import type`, so it is erased.
- **The model's LLVM init** (`llvm_util.ts` `init`) runs once, at the first forward that has a session: `codegen_crate`,
  `join_codegen` or `link`.
  - The port's own `CodegenBackend::init` is not called. Its `global_llvm_features` would emit `-Ctarget-feature` warnings a
    second time, and its other values are the stand-in's, already in the session.
  - The statistics methods (no session; only reached after `join_codegen`) only load the backend. Upstream's `llvm_util::init`
    is idempotent anyway (`INIT`).
- **`link` forwards only once `codegen_crate` has forwarded.**
  - `Linker::link` (queries.rs:49) calls `codegen_backend.link` on every compile, check-only ones too, with the empty
    `CompiledModules` that `start_codegen` makes.
  - Forwarding unconditionally loaded the port and inited the model on `--emit=metadata` (74 extra modules; measured, then
    fixed).
  - Otherwise `link` is the old body: `link_binary` with the stand-in's `LlvmArchiveBuilderBuilder`, which a check-only link
    never calls.
- **The port's `codegen_crate` runs the CPU checks and the collector itself.**
  - `back/llvm_backend.ts:336` does the offload check, then calls `rustc_codegen_ssa/base.ts` `codegen_crate`, which ports
    base.rs:723-739: `CpuRequired`, `CpuUnsupported`, then `collect_and_partition_mono_items`. Checked line by line against
    upstream.
  - The stand-in's copy of that head therefore went away. It is kept only as `mono_collection_head` (offload check, CPU checks,
    collector), for `scripts/mono-run.ts`.
- **Miri's backend is untouched.** `make_miri_codegen_backend` uses the stand-in only for `init` and `target_config`, and
  codegens with `DummyCodegenBackend` (src/miri/bin/miri.ts:113, :248). Neither method changed.

### Startup (D14)
Hello at `--emit=metadata` (x86_64-unknown-linux-gnu, the oracle's sysroot). Modules counted from `require.cache` at exit, through a
`--preload`, as wire.test.ts does:

| run | modules |
|---|---|
| before (`bcbd0c28`) | 2,099 |
| after (`b1b88a01`) | 2,099, **the same set** (sorted lists equal) |
| a codegen run (`--emit=llvm-ir -Copt-level=0`), after | 2,195: plus 43 `rustc_codegen_llvm`, 24 `rustc_codegen_ssa`, 16 `rust_ts/llvm`, 11 `rustc_monomorphize`, 1 `rustc_middle` (`ty/typetree.ts`), and `scripts/lib/llvm-tools.ts` (imported by the model's tools.ts) |

- **Evaluation order.** `require.cache`'s key order is not evaluation order (two runs of the same tree differ), so I compared sets.
  The metadata path adds no runtime import: the one new import is `import type`, and the `require`s run only inside forwards.
- **`src/rust_ts/first_import.test.ts`** is unchanged and passes.
- I did not measure instruction counts. The metadata path runs the same code, apart from one branch in `link`.

### CI (`LLVMRustDisableSystemDialogsOnCrash`)
- **With `CI` set** (the gate's unit step sets `CI=true`), the model's `configure_llvm` calls `LLVMRustDisableSystemDialogsOnCrash`.
  That is still a model stop until fixers-57 merges: every forward stops there (`CI=1`: hello exits 70 with
  `rust-ts: unported: llir: LLVMRustDisableSystemDialogsOnCrash`).
- **Without `CI`**, hello reaches `LLVMRustInlineAsmVerify`.
- **Tests run in both states.** Every test this lane touched expects the stop of the state it runs in: `CI` set or not, and the
  model function present or not (`ffi.IMPLEMENTED`). The test set passed with `CI` unset and with `CI=true` (Evidence).
- **After fixers-57 merges**, the `CI` branch of those expectations becomes dead. Root may delete it.

## For root: the IR-model change `ir-hello` needs (not committed here)
- `LLVMRustInlineAsmVerify` (RustWrapper.cpp:654) in an implementation module, then `bun tools/llir/ffi_gen.ts`.
- The regeneration rewrites `src/rust_ts/llvm/ffi.ts`, which is fixers-57's file, so I left the change out. I tested it applied
  temporarily. Put it in `src/rust_ts/llvm/core.ts`, after `LLVMGetInlineAsm`:

```ts
// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:654 LLVMRustInlineAsmVerify
export function LLVMRustInlineAsmVerify(Ty: Type, Constraints: PtrLenStr | undefined, ConstraintsLen: number): boolean {
  // PORT (plan-m7 D10): `InlineAsm::verify` (LLVM's constraint parser) is not imitated; the permissive answer, so a bad constraint
  // string reaches `opt`/`llc`, whose error is the error. `unwrap<FunctionType>` is kept.
  void Constraints;
  void ConstraintsLen;
  if (!(Ty instanceof FunctionType)) throw new Error("llvm: unwrap<FunctionType> of a type that is not a function type");
  return true;
}
```

With it applied and `ffi.ts` regenerated:
- `ir-hello` is MATCH 2/2.
- `bun test ./src/rustc_codegen_llvm/intrinsic.test.ts ./src/rust_ts/llvm/ffi.test.ts` passes; `intrinsic.test.ts` takes its "implemented"
  branch.
- The skeleton stub counts do not change: the `llir` count counts only `unported("llir: ...")` in rustc_codegen_llvm, not
  ffi.ts's stubs.

## Protected suites cannot change (step 3)
**Argument.**
- **Only `main.ts` and `mono-run.ts` construct this backend.** Of the protected suites, only those whose subject is
  `src/rust_ts/main.ts` construct it through `get_codegen_backend`. `mono-ui` uses `scripts/mono-run.ts`, and Miri uses its own
  backend (above).
- **Before this branch, `codegen_crate` always ended in `unported`** (exit 70). An `unported` stop is UNPORTED, never MATCH, and
  every protected case is MATCH. So no protected case reached `codegen_crate` or `join_codegen`, and the forward cannot change
  one.
- **The other changed methods leave protected runs as they were:**
  - `link` runs the same code as before on any compile that did not reach `codegen_crate`.
  - `print_pass_timings` and the two statistics methods are reached only with `-Z time-llvm-passes` or `-Z print-codegen-stats`.
    The stand-in's `init` stops on both (`non_default_llvm_input`), before `codegen_crate`.
  - `init`, `target_config`, the print requests and `target_cpu` did not change.
- **`mono-ui`'s subject runs the same lines as before.** `mono_collection_head` is the head the stand-in ran before its stop, and
  `MonoOnly` returns the `CompiledModules` it used to return from the catch.

**Samples.** Fixed seed `cg-register`, `--jobs 6`, on `bcbd0c28` (a scratch worktree) and on this branch (`b52d34f6`), compared per
case (id and status):

| suite | before | after | changed |
|---|---|---|---|
| mono-ui (`--sample 400`) | 400/400 MATCH | 400/400 MATCH | 0 |
| check-ui (200) | 200/200 | 200/200 | 0 |
| mir-o2 (200) | 200/200 | 200/200 | 0 |
| emit (200) | 200/200 | 200/200 | 0 |
| symbols (200 asked; the suite has 10) | 10/10 | 10/10 | 0 |
| pm-ui (200) | 200/200 | 200/200 | 0 |

- **No case changed status.** Runs: `$RUST_TS_DATA/runs/cgreg-{before,after}-<suite>`.
- **The `mono-ui` sample** covers both step 2's 400-case check and step 3's 200-case one.
- **The later commit `b1b88a01`** (`add_tt`) is reached only from codegen (`memcpy`), which no protected run reaches (above).

## `ir-hello` (step 4)
| level | this branch | with the model change above |
|---|---|---|
| `-O` | UNPORTED: `llir: LLVMRustInlineAsmVerify` | **MATCH** (N1, N2, N3 the same) |
| `-Copt-level=0` | UNPORTED: `llir: LLVMRustInlineAsmVerify` | **MATCH** (N1, N2, N3 the same) |

What happened on the way, in order:
1. **The forward from `back/llvm_backend.ts`** ended in an ICE, `this.llcx is not a function` (extension methods not attached).
   Fixed: the forward loads through lib.ts.
2. **`black_box`** reached cg-contract's stub `cg-asm: ... inline_asm_call`. Fixed: ported asm.rs:536 and :641.
3. **The model's `LLVMRustInlineAsmVerify`** stops. That needs the model change above.
4. **`CI` set:** `LLVMRustDisableSystemDialogsOnCrash` stops first (fixers-57).

**`ir-run-pass` does not exist** (`harness/suites.ts` defines only `ir-hello` among the IR suites), so I ran no sample of it.
**Informal survey instead** (not a suite, not a status):
- `scripts/ir-diff.ts` in file form at `-O` on 40 run-pass files, every 86th of `mir-o2`'s 3,479 cases.
- Run on `b52d34f6` with the model change applied.
- The file form uses `irFileArgs`, not each test's compile flags.

| first difference | count |
|---|---|
| same at N1 (N2, N3 too) | 23 |
| `excluded (plan-m7 D18): typetree.rs add_tt` | 15, fixed by `b1b88a01` (re-run: 13 of the 15 now same at N1) |
| both sides fail the same way (the file form lacks the test's own flags: `fmt_debug/none.rs`, `sanitizer/cfi/fn-trait-objects.rs`) | 2 |

After `b1b88a01`:
- **36 of 40 are the same at N1.**
- **2 stop at `llir: the x86 intrinsic table ("llvm.x86.sse2.pause"; target intrinsics are not in the IR model)`**:
  `closure-bounds-can-capture-chan.rs` and `task-spawn-move-and-copy.rs` (std's `spin_loop`). That is a model item for an llir
  lane.
- **2 are as above** (both sides fail the same way).

## Files touched
| file | what |
|---|---|
| `src/rust_ts/codegen_backend.ts` | the forward, `ported_backend`, `mono_collection_head`, header and the llvm-args note |
| `scripts/mono-run.ts` | `MonoOnly.codegen_crate` = `mono_collection_head` + `new CompiledModules([], undefined)`; `AFTER_COLLECTION` removed (no other user) |
| `src/rustc_codegen_llvm/asm.ts` | `inline_asm_call`, `allow_raw_span_inline_asm_srcloc` |
| `src/rustc_codegen_llvm/typetree.ts`, `typetree.test.ts` (new) | `add_tt`'s guard, and its test |
| `src/rustc_codegen_llvm/skeleton.test.ts` | `cg-asm` 4 → 3 (one line, plus a comment; the backend-init test untouched) |
| `src/rustc_codegen_llvm/back/llvm_backend.ts`, `lib.ts` | header comments only: "not registered" → how it is registered |
| **outside the brief's list:** `src/rustc_codegen_llvm/intrinsic.test.ts` (cg-intrinsic-a's) | the `black_box` case expected cg-contract's `inline_asm_call` stub; now two states keyed on `ffi.IMPLEMENTED`: the model stop, or the oracle's `asm` call line (`!srcloc` id masked, as the case passes `DUMMY_SP`) |
| **outside the brief's list:** `src/rustc_monomorphize/wire.test.ts` (mono-wire's) | expected the after-collection stop; now the codegen stop: `LLVMRustOptimize`'s ThinLTO buffer (the rlib embeds bitcode), or under `CI` `LLVMRustDisableSystemDialogsOnCrash`; test renamed "...then stops in codegen..." |
| **outside the brief's list:** `src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts` | `PENDING.refine_rpitit` re-pinned the same way |

The three test files outside the list pinned stops that this lane removes, so they failed. Root: review or reassign them.

## `unported(...)` left or newly reached
- None added. `add_tt` keeps its `excluded (plan-m7 D18)` stop after the guard: same message, same count.
- **Reached now, owned elsewhere:**
  - the model's `LLVMRustInlineAsmVerify`;
  - `LLVMRustDisableSystemDialogsOnCrash` (fixers-57);
  - `LLVMRustOptimize`'s ThinLTO buffer for rlibs with embedded bitcode (queued in wave 40p);
  - the x86 target-intrinsic table (`llvm.x86.sse2.pause`).

## `// PORT:` decisions
1. `codegen_backend.ts` `codegen_crate` …: codegen, the statistics and `link` forward to the ported backend (decision 2026-11-14).
2. `ported_backend`: loaded lazily through lib.ts (D14), and the model's `llvm_util::init` runs at the first forward with a
   session. The port's `init` is not called (duplicate warnings; its values are already in the session).
3. `link`: forwards only after `codegen_crate` has. A check-only `link` keeps the stand-in's body and builder.
4. `asm.ts`: `inline_asm_call` ported ahead of cg-asm, because `black_box` reaches it.
5. `typetree.ts`: `add_tt`'s guard ported, with no marker since the file is excluded from coverage.
6. `intrinsic.test.ts`, `wire.test.ts`, `compare_impl_item.oracle.test.ts`: two-state expectations, until the model change and
   fixers-57 land.

## Evidence (AC power; `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0`)
- **`bunx tsc --noEmit -p .`**: clean at every commit. I checked the two intermediate commits in a scratch worktree.
- **`bun scripts/coverage.ts --check`**: `markers ok (26859, 72 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 745;
  llvm 523)`.
- **Coverage, `--missing`:**
  - `asm.rs` 2/18 (was 0/18);
  - `typetree.rs` out of scope, unchanged.
- **Unit tests:**
  - `bun test ./src/rustc_codegen_llvm/ ./src/rustc_codegen_ssa/ ./src/rust_ts/ ./src/rustc_interface/ ./src/std/
    ./scripts/lib/unit-steps.test.ts ./src/rustc_monomorphize/wire.test.ts ./src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts
    ./harness/m7-suites.test.ts`: **699 pass, 0 fail** with `CI` unset, and **699 pass, 0 fail** with `CI=true`. Run at
    `b52d34f6`.
  - Then `./src/rustc_codegen_llvm/` again after `b1b88a01`: 139 pass, 0 fail.
- **No `scripts/` test covers `mono-run.ts`** (`harness/m7-suites.test.ts` checks only its path, and passes). By hand, `mono-run.ts`
  on hello with `-Zprint-mono-items=yes` prints the mono items and exits 0.
- **Tests read only listed variables:** `CI` (listed in `unit-steps.test.ts` as set by the unit step) and `RUST_TS_REQUIRE_PROBES`.

## Commits
- `42faaf21` cg-register: export mono_collection_head from the backend stand-in (src; no behaviour change)
- **`24030842` mono-run: run the backend's mono-collection head instead of catching its stop (scripts/ only: the harness batch)**
- `b52d34f6` cg-register: forward codegen from the backend stand-in to the ported LLVM backend
- `b1b88a01` cg-register: port add_tt's -Zautodiff guard (typetree.rs:78-88)
- this handoff
