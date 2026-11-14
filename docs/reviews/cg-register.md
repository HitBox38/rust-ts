# Review: cg-register (wave 40q), the src commits

Reviewer: independent, read-only on code. Subject: `t3/register-llvm-backend` at `b2c47ad0`, on main `bcbd0c28`: `42faaf21`,
`b52d34f6`, `b1b88a01`, `b2c47ad0` (handoff). `24030842` (`scripts/mono-run.ts`) is reviewed separately; only its interaction with
the src is covered here. Review branch `t3/review-cg-register`, at `b2c47ad0` plus this file. AC power the whole time.
`RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0`. `--jobs 6` at most.

## Verdict: **APPROVE WITH NITS**

The forward matches upstream. The `link` condition keeps today's check-only path exactly. The two ports are faithful. The
re-pinned tests still compare everything they compared against the oracle. No protected case can reach the new code, and every
sample is 200/200 MATCH. `ir-hello` with the handoff's model change is MATCH 2/2 at N1 and N3. No must-fix findings. N1 should
land at integration, before fixers-57 merges.

## Findings

**N1. Nothing pins the lazy-load condition once `CI` is unset or fixers-57 has merged.**
- Code: `src/rust_ts/codegen_backend.ts:284` (`if (PORTED_BACKEND !== undefined)`). Plan-m7 D14; no upstream line, since upstream
  has no lazy load.
- Mutation: I changed it to `if (true)`, so a check-only `link` always forwards. Without `CI`, `bun test ./src/rustc_monomorphize/wire.test.ts
  ./src/rust_ts/` gave **268 pass, 0 fail**.
- Under that mutation, hello at `--emit=metadata` exits 0 but loads **2,183 modules instead of 2,099**: 58 of the extras are in
  `rustc_codegen_llvm/` or `rust_ts/llvm/`, and none are in `rustc_monomorphize/`. So `wire.test.ts:71`, which checks only
  `rustc_monomorphize`, does not see it.
- With `CI=1` the mutation is caught (`does not evaluate the crate on a run with no codegen` fails). But that is only because the
  model init then stops at `LLVMRustDisableSystemDialogsOnCrash`. The catch goes away when fixers-57 merges.
- Fix: one assertion after `wire.test.ts:71`, for example
  `expect(modules.filter((m) => m.includes("/src/rustc_codegen_llvm/") || m.includes("/src/rust_ts/llvm/"))).toEqual([]);`.
  `wire.test.ts` is mono-wire's file, so root or a fixer adds it.

**N2. The model's LLVM init now runs after the offload and CPU checks' caller is entered, not before.** It is harmless today.
- Code: `codegen_backend.ts:258` → `ported_backend` (:313, init at :321) runs before the port's `codegen_crate`. That
  `codegen_crate` holds the offload check (back/llvm_backend.rs:336) and then base.rs:723-733's `CpuRequired` / `CpuUnsupported`.
  Upstream runs `llvm_util::init` in `CodegenBackend::init` (llvm_backend.rs:180), before everything.
- `configure_llvm` emits no diagnostic on any reachable path: `LlvmVersionMismatch` cannot fire against the oracle, and the
  stand-in's `init` allowlists `-Cllvm-args`. So for output, init before and init at first forward are the same.
- The only effect is the order of stops. With `CI` set, or `-Zllvm-time-trace` (the `LLVMRustTimeTraceProfilerInitialize` stub),
  a compile that upstream fails with `CpuRequired` stops UNPORTED instead. That never produces a wrong output, and no protected
  case reaches it (step 5 below).
- Suggestion: one sentence in `ported_backend`'s PORT comment saying so, so a later lane does not read a CPU-check UNPORTED as a
  regression.

**N3. The handoff's model change for `LLVMRustInlineAsmVerify` is allowed by D10, but its comment misstates the consequence, and
an exact port is cheap.**
- The change: `docs/handoff/cg-register.md`, "For root".
- Upstream: `RustWrapper.cpp:654` is `!errorToBool(InlineAsm::verify(unwrap<FunctionType>(Ty), StringRef(...)))`.
  `InlineAsm::verify` is `llvm/lib/IR/InlineAsm.cpp:274`. It calls `ParseConstraints` (:236) and `ConstraintInfo::Parse` (:79),
  then counts outputs, inputs, clobbers and labels against the function type.
- **It is a stand-in, not a port.** It always answers `true`. Plan-m7 D10 (docs/plan-m7.md:517) authorizes exactly this
  ("return the permissive answer with `PORT:`"), so it is not a rule break.
- **Where it can diverge:** both upstream callers turn `false` into an ICE. That is `bug!("failed to generate inline asm call for
  `black_box`")` at intrinsic.rs:173 and `span_bug!(.., "LLVM asm constraint validation failed")` at asm.rs:363. So `true` differs
  from upstream only where upstream would ICE on a constraint string that rustc built wrongly. Valid programs are unaffected.
- **The comment is wrong.** It says "a bad constraint string reaches `opt`/`llc`, whose error is the error". Upstream never hands
  such a string to LLVM: it ICEs first. Reword when applying, e.g. "upstream ICEs on `false` (asm.rs:363, intrinsic.rs:173); `true`
  differs only there".
- **An exact port is cheap.** `verify` is pure IR logic: no target or MC involvement, unlike `LLVMRustTargetHasMnemonic`. Its
  file, `llvm/lib/IR/InlineAsm.cpp`, is **already pinned** (`harness/llvm-manifest.json:69`), and `src/rust_ts/llvm/ir.ts:392`/`:409`
  already cite it. So no new `// llvm:` file needs pinning, either for the stand-in (its marker is the `rustc:` wrapper marker
  `RustWrapper.cpp:654`, accepted by `coverage --check`: `73 of them in llvm-wrapper` with it applied) or for a full port (`//
  llvm: llvm/lib/IR/InlineAsm.cpp:274 InlineAsm::verify`, `:236 ParseConstraints`, `:79 ConstraintInfo::Parse`).
- Recommend porting it with cg-asm, and recording that D10's "cannot be imitated exactly" does not hold for `InlineAsmVerify`.

## Checks

### 1. The forward
- **`codegen_crate`** (`codegen_backend.ts:258`) → the port's `back/llvm_backend.ts:360`. That function is llvm_backend.rs:336
  whole: the offload check (stops, D18), then `rustc_codegen_ssa::base::codegen_crate`. Its head, `base.ts:804-824`, matches
  base.rs:723-739 line for line: `CpuRequired`, `CpuUnsupported`, `CodegenUnitNameBuilder::new`, then
  `collect_and_partition_mono_items`.
- **`join_codegen`, `print_pass_timings`, `print_statistics`, `print_statistics_json`** are plain forwards to the ported
  :360/:383/:388/:393.
- **The `link` condition is sound.** Upstream `Linker::link` (queries.rs) downcasts `ongoing_codegen` to `CompiledModules` on a
  check-only build. It then still calls `codegen_backend.link`, which is llvm_backend.rs:397's `link_binary(..,
  &LlvmArchiveBuilderBuilder, ..)`.
  - The stand-in's non-forwarded path is the pre-branch body unchanged (`git diff` shows only the inserted `if`). So a check-only
    compile runs exactly today's code.
  - Forwarding whenever the port is loaded is faithful too, since the port's `link` is :397.
  - The module-level `PORTED_BACKEND` / `PORTED_LLVM_INITED` behave like upstream's process-wide `INIT` `Once` across sessions in
    one process.
- **The init choice.** Calling the model's `llvm_util::init`, not the port's `CodegenBackend::init`, is equivalent for output (N2).
  The port's `init` would re-run `global_llvm_features(sess, false)`, whose warnings the stand-in's `init` already emitted.
  - Test: hello with `-Ctarget-feature=+foo --emit=llvm-ir -Copt-level=0 --target x86_64-unknown-linux-gnu` against the oracle.
    The `unknown and unstable feature specified for -Ctarget-feature` warning prints **once on both sides**, byte-identical, so
    nothing is duplicated or reordered.
  - After the warning, the branch tip stops at `llir: LLVMRustInlineAsmVerify`. With the model change, it stops later, at `llir:
    LLVMRustOptimize with global target features "+foo"`.
  - The oracle then prints LLVM's `'+foo' is not a recognized feature for this target` four times and `warning: 1 warning
    emitted`. Those come after codegen and belong to the llir lanes, not this one.
- **Lazy load.** I counted hello at `--emit=metadata` (x86_64-unknown-linux-gnu, oracle sysroot) through a `--preload` dumping
  `require.cache`:
  - `bcbd0c28` (a scratch worktree): 2,099 modules.
  - `b2c47ad0`: 2,099 modules.
  - The sorted lists are **identical** (only the preload file's own name differed).
  - `src/rust_ts/first_import.test.ts` is untouched by the branch and passes.
  - The handoff measured 74 extra modules for an always-forwarding `link`. I measured 83 on this tree (N1). The conclusion is the
    same.
- **`mono_collection_head`** (`codegen_backend.ts:333`) is the old stand-in head **character for character**: `git show 42faaf21`
  moves the lines unchanged, the offload `unported` string included. `MonoOnly` (24030842) calls it and returns
  `new CompiledModules([], undefined)`, which is what the old catch returned. It never forwards, so `mono-ui` never loads the port
  or the model.

### 2. Ports
- **`inline_asm_call`** (`asm.ts:53`, asm.rs:536): order, logic and comments match.
  - Covered: `type_func`, verify → `undefined`, `LLVMGetInlineAsm` argument order, `callbr`/`invoke`/`call` branch order with
    `assert!(catch_funclet.is_none())`, the `srcloc` kind, the Intel dummy entry when there is more than one line span, and
    `lo | hi << 32` as `u64` (bigint).
  - Every port signature it calls (`callbr`, `invoke`, `call`, `Span.lo/hi`, `Session.lto()`, `CodegenCx.bitcode_needed`) takes
    the arguments in upstream's order.
- **`allow_raw_span_inline_asm_srcloc`** (`asm.ts:143`, asm.rs:641): faithful, doc comment kept.
- The markers point at the `fn` lines. `coverage --check` is OK, and asm.rs is now 2/18.
- **The `add_tt` guard** (`typetree.ts:17-22`, typetree.rs:78-88): both `contains` checks, in order, with the upstream comment.
  There is no marker because typetree.rs is excluded from coverage, and the PORT comment says so. The stop after it is unchanged.
- Nothing is guessed.

### 3. Test changes outside the brief
- **`intrinsic.test.ts:391`.**
  - Without the model function, the stop is `llir: LLVMRustInlineAsmVerify`, after the store. The 3 compared lines are still the
    oracle's.
  - With it, the 4th oracle line (the `asm` call) is compared, with only the `!srcloc !N` number masked. The case passes
    `DUMMY_SP`, and the node number is the module's.
  - Both branches derive from the oracle's IR. I ran the "implemented" branch with the model change applied: `intrinsic.test.ts`,
    `ffi.test.ts` and `skeleton.test.ts` gave 48 pass, 0 fail.
- **`wire.test.ts:44`.** The compile now gets past collection into the port's codegen.
  - Without `CI`, it stops at `llir: LLVMRustOptimize's ThinLTO buffer (...)`, a real `unported` in `src/rust_ts/llvm/tools.ts`
    reached when `ThinLTOBuffer` is requested. That fits: the case is an rlib with link output, so it embeds bitcode.
  - With `CI`, it stops at the model's `LLVMRustDisableSystemDialogsOnCrash` stub, which is `stub(...)` in `ffi.ts:1064`.
  - The oracle-derived parts are unchanged: stdout contains the mono items, the `-Zdump-mono-stats` file equals the oracle's, and
    stderr equals the oracle's stderr followed by the stop line.
  - The stop names are the port's own, as for any pending-stop pin, and both names are real.
- **`compare_impl_item.oracle.test.ts:53`.** `refine_rpitit` gets the same two-state pin with the same real names. The
  end-to-end check of exit 70, the single stop line and no leftover `rmeta*` dir is unchanged. The tree was clean after both test
  runs, so the deeper codegen writes nothing into the cases dir.
- The `CI !== undefined` test matches upstream's `var_os("CI").is_some()`.

### 4. `ir-hello`
- **Branch tip:** both levels stop at `llir: LLVMRustInlineAsmVerify`. I saw this directly on hello at `-Copt-level=0 --emit=llvm-ir`.
- **With the handoff's change applied in scratch** (core.ts after `LLVMGetInlineAsm`, then `bun tools/llir/ffi_gen.ts`), I ran
  `bun scripts/difftest.ts --suite ir-hello`, which drives `scripts/ir-run.ts`:
  - **MATCH 2/2 at N1** (`hello -O`, `hello -Copt-level=0`; run `revcgreg-irhello-model`);
  - **MATCH 2/2 at N3** (run `revcgreg-irhello-model-n3`).
- A direct compile confirmed the port writes `hello.ll` and exits 0. Raw differences are only the demangled `; call ...` comment
  lines, which the normal form drops.
- The change was reverted afterwards: `core.ts` and `ffi.ts` are clean, and nothing was committed. Fidelity: N3.

### 5. Protected suites
I used `RUST_TS_AGENT=rev-cgreg-q40`, `--sample 200 --jobs 6`, at `b2c47ad0`, which includes `24030842`:

| suite | result | run |
|---|---|---|
| check-ui | 200/200 MATCH | `revcgreg-check-ui` |
| mir-o2 | 200/200 MATCH | `revcgreg-mir-o2` |
| emit | 200/200 MATCH | `revcgreg-emit` |
| pm-ui | 200/200 MATCH | `revcgreg-pm-ui` |
| mono-ui | 200/200 MATCH | `revcgreg-mono-ui` |

**Which protected suites can reach the forward:**
- **Only suites whose subject is `src/rust_ts/main.ts` construct the stand-in through `get_codegen_backend`.**
- **Every such protected suite stops before `codegen_crate`:**
  - `--emit=metadata`: check-ui, check-ui-encode-mir, check-std/core/alloc, rmeta-*, pm-ui;
  - `-Zunpretty=…`: mir, mir-o2, mir-std/core, mir-opt-o4, thir-tree, expanded*, hir-tree*, unpretty-*;
  - the probes;
  - check-rg*, whose link compiles go to the oracle (`scripts/rg-rustc.ts`).
- **`mono-ui`** goes through `MonoOnly`, which never forwards.
- **Miri.** `make_miri_codegen_backend` (`src/miri/bin/miri.ts:384-387`) uses the stand-in for `init` and `target_config` only,
  and `MiriCodegenBackend.codegen_crate`/`join_codegen` call `this.dummy` (`DummyCodegenBackend`, :289-301). The branch does not
  touch `src/miri/`, so Miri still uses the dummy backend.

**Looking for an exception** (a protected MATCH that ended non-zero inside the head, not at the old exit-70 stop):
- The only fatal paths in the head are `CpuRequired`/`CpuUnsupported` and fatal collection errors. Upstream's mono-time errors
  are mostly non-fatal and run on into codegen, which used to stop with exit 70.
- The `CpuRequired`/`CpuUnsupported` tests (`tests/ui/target-cpu/{explicit,unsupported}-target-cpu.rs`) appear only in
  unpretty/parse/tydump/lex baselines, none of which reach codegen.
- In `mono-ui`, such a case runs the identical head through `mono_collection_head`.
- **No exception found.** The only behavioural difference in the head, the init-before-CPU-check order (N2), cannot touch a
  protected case.

### 6. Commands
- `bunx tsc`: clean (exit 0).
- `bun scripts/coverage.ts --check`: `markers ok (26859, 72 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 745; llvm 523)`.
- `bun test ./src/rustc_codegen_llvm/ ./src/rustc_codegen_ssa/ ./src/rust_ts/ ./src/rustc_interface/ ./src/rustc_monomorphize/
  ./src/rustc_hir_analysis/check/ ./scripts/lib/unit-steps.test.ts`:
  - `CI` unset: **790 pass, 0 fail** (303 s);
  - `CI=1`: **790 pass, 0 fail** (207 s).
  - The `CI` state of the model init (`LLVMRustDisableSystemDialogsOnCrash`) is handled by every touched test through `CI` plus
    `ffi.IMPLEMENTED`.
- **Mutations**, each reverted:
  - `add_tt`, with the `Enable` guard negated: `typetree.test.ts` **2 fail**, so it is caught.
  - The `link` lazy-load condition set to `if (true)`: **not caught without `CI`**, and caught with `CI=1` only through the
    model's stop. See N1.
- The tree was clean after every run.
