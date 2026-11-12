FAIL

# Review: lane `ssa-base` (M7 wave 41, wave 40n)

- **Reviewed:** `git diff 51dfe33c..3b63f5ec` on `t3/port-ssa-base-crate-driver`: commits `bf8e48a6` (port), `7f94d253` (tests),
  `9e91903d` and `3b63f5ec` (handoff). Upstream is `compiler/rustc_codegen_ssa/src/{base.rs, lib.rs, assert_module_sources.rs,
  back/lto.rs}` at pin `6f5da406b56`, read from `$RUST_TS_DATA/rust`.
- **Reviewer:** independent, read-only on code.
- **Result:** the port is faithful in every function I read, and I found no guessed values in it. One blocking finding is in the
  test fixture: `base_oracle/oracle.json` contains the porter's absolute worktree path, so 4 of the 12 `base.test.ts` tests
  fail in any other checkout, including root's integration checkout, where the gate's unit step would fail. The fix touches
  the test only. There are also 7 nits.

## Evidence
Run on `3b63f5ec` merged into this worktree (`t3-95cb35c8`), on AC power, with `RUSTC_ICE=0`, `RUST_TS_REQUIRE_PROBES=1` and
`RUSTUP_AUTO_INSTALL=0`.
- `bunx tsc --noEmit -p .`: clean (exit 0).
- `bun scripts/coverage.ts --missing`: base.rs **28/28**, lib.rs **11/11**, assert_module_sources.rs **10/10**, back/lto.rs
  **8/8**.
- `bun scripts/coverage.ts --check --offline`: `markers ok (26399, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311;
  library 744; llvm 390)`.
- `bun test ./scripts/lib/unit-steps.test.ts`: **10 pass, 0 fail**.
- `bun test ./src/rustc_codegen_ssa/ ./src/rustc_codegen_llvm/ ./src/std/result.test.ts`: **186 pass, 4 fail** (190 tests, 24
  files). The 4 failures are F1.
- `bun src/rust_ts/info_sites_check.ts` (gate static step): passes. `codegen_instance`'s `info!` is live (`tracing.info`).
- I regenerated the oracle in scratch with `rustc +nightly` (commit-hash `6f5da406b56c…`, which equals `UPSTREAM.json`) on
  `x86_64-unknown-linux-gnu` with `-Ccodegen-units=4 -Copt-level=0`:
  - `RUSTC_LOG=rustc_codegen_ssa::base=info -Ztrim-diagnostic-paths=no`: 146 `codegen_instance(..)` lines. They equal
    `oracle.json`'s `bin.instances` once the worktree path is normalised, and differ in 7 entries without that (F1).
    So the log is genuine.
  - `--emit=llvm-ir`: `define i32 @main(i32 %0, ptr %1)`, then `sext i32 %0 to i64`, the call to
    `_RINvNtCs7uvcShySr4P_3std2rt10lang_startuECsaUdHsY5rg0a_4cgus(ptr @_RNvCsaUdHsY5rg0a_4cgus4main, i64 %2, ptr %1, i8 0)`,
    `trunc i64 %3 to i32` and `ret i32 %4`. This equals `oracle.json`'s `bin.main`, apart from the attributes and `; call`
    comment, which the test drops by design.
  - `-Csave-temps`: the allocator module is `cgus.370gba7z70vw642p0l8uv3rqs.rcgu.bc`, which equals `bin.allocator`.
- I took no difftest samples, as the brief asked, because disk space is tight.

## 1. Order and coverage
- base.rs: all 28 markers follow upstream file order (58 … 1256), and the new ones sit in place around the earlier ones
  (`compare_simd_types` :86 to `build_shift_expr_rhs` :334 before `wants_wasm_eh` :376; `wants_msvc_seh` and
  `wants_new_eh_instructions` after it; `codegen_instance` through `get_argc_argv` before
  `collect_debugger_visualizers_transitive` :642; `codegen_crate` :716 and `is_call_from_compiler_builtins…` :932/940 before
  `collect_eii_linkage` :954; `determine_cgu_reuse` :1256 last). The nested `create_entry_fn` (:525) marker is inside the
  body, after the `return`, as upstream.
- lib.rs: one marker is out of order. `serialize_rlink` (:350) and `deserialize_rlink` (:371) sit in the `CompiledModules` class
  body, before `provide` (:339). PORTING §8 allows that. See N2 for the comment that claims otherwise.
- assert_module_sources.rs and back/lto.rs: in order.
- Marker spot-checks against upstream `fn` lines, all correct: base.rs 122, 163, 225, 272, 334, 385, 392, 396, 408, 501, 525,
  611, 642, 716, 1256; lib.rs 73, 82, 91, 135, 350, 371; assert_module_sources.rs 42, 89, 175; lto.rs 27, 31, 37, 55, 68, 139.

## 2. Logic fidelity
- **`codegen_crate`** (base.ts:798, base.rs:716):
  - The CPU checks and `CodegenUnitNameBuilder` come first, as upstream. The `is_fully_enabled()` loop is kept verbatim.
  - The allocator module is built with `allocator_kind_for_codegen`, `build_cgu_name(LOCAL_CRATE, ["crate"], "allocator")`, then
    `codegen_allocator` and `new_allocator` inside `sess.time("write_allocator_module")`.
  - `find_attr!(tcx, crate, NoBuiltins)` is ported as codegen_attrs.ts:398 does.
  - `ModuleConfig::new` ×2, `bitcode_needed` and `start_async_codegen` come in upstream order.
  - CGU order: a stable descending sort on `size_estimate` (JS `Array.prototype.sort` is stable, like `sort_by_key`).
    `split_at(len/2)`, then `interleave(first_half, second_half.reverse())`. The local `interleave` has itertools semantics
    (alternate, then the rest).
  - `find_cgu_reuse`, `assert_module_sources`, the `jobs.frontend` pre-compiled batch (`filter(No).take(threads)`, `par_map`
    into a `Map`) and the per-CGU wait/check/match all match. Each arm's `abort_if_errors` placement matches.
  - `codegen_finished`, the time-passes block and the final `check_for_errors` match.
- **`determine_cgu_reuse`** (base.ts:1313): the early return is verbatim, with short-circuit order kept. Past it,
  `cgu.work_product_id()` stops (rustc_middle mono.ts:661, an existing `never` stub). This is how the port handles a disabled
  dep graph elsewhere too: `is_fully_enabled()` at hir/mod.ts:492, hir/map.ts:309, rmeta encoder.ts:3151, cstore_impl.ts:371
  and passes.ts:1178. The unreachable tail is kept as upstream text in a comment. Faithful, not invented.
- **`codegen_instance`** (base.ts:489): `info!("codegen_instance({})", instance)` becomes
  `tracing.info("rustc_codegen_ssa::base", …display_Instance…)`, then `codegen_mir(Bx_, cx, instance)`. That is correct.
- **`maybe_create_entry_wrapper` / `create_entry_fn` / `get_argc_argv`** (base.ts:584-720, base.rs:501-640):
  - `entry_fn(())?`, then the local check (`contains_item(MonoItem::Fn)`) or else `is_primary`, then `get_fn_addr` with
    `pointer_authentication_functions`.
  - `llfty` is UEFI `(ptr, ptr) -> isize`, or `main_needs_argc_argv` `(int, ptr) -> int`, or `() -> int`.
  - `main_ret_ty` is `fn_sig.no_bound_vars().unwrap().output()`, then `normalize_erasing_regions(Unnormalized::new_wip(..))`.
  - The `declare_c_main` `None` case emits a fatal `MultipleMainFunctions`.
  - Then `set_frame_pointer_type`, `apply_target_cpu_attr`, `append_block("top")`, `build`, and
    `insert_reference_to_gdb_debug_scripts_section_global`.
  - `start` is `require_lang_item(LangItem::Start)` + `expect_resolve(mk_args([main_ret_ty]))`. `#[unix_sigpipe]` becomes
    `const_u8(sigpipe)` (`i8 0` by default, confirmed above). `start_ty` is `(val_ty(main), isize, ptr, i8) -> isize`.
  - The call has 8 arguments with `ReturnSlot::Direct`. UEFI returns `ret(result)`; otherwise
    `intcast(result, type_int(), true)`, which is the `isize`→`i32` `trunc`.
  - UEFI argv: `alloca(2*ptr_size)`, then a store, `inbounds_ptradd(const_usize(ptr_size.bytes()))` and a store. All correct.
- **`wants_wasm_eh` / `wants_msvc_seh` / `wants_new_eh_instructions`**: verbatim.
- **Unsizing and helpers**:
  - `unsized_info`'s `Option<DefId>` equality is written out correctly. `debug_assert!(validate_trivial_unsize …)` stays a comment.
  - The upcast offset is `u64 * ptr_size.bytes()` as a `bigint`. The `meth::{load_vtable, get_vtable}` stubs are legitimate:
    meth.rs is 0/8 ported.
  - `unsize_ptr` and `coerce_unsized_into` keep the arm order, and the `Pat` guard falls through to `bug!` as upstream.
    `bug!()` becomes "impossible case reached".
  - `validate_trivial_unsize`'s `(_, None) => true` is correct. `compare_simd_types` and `build_shift_expr_rhs` are verbatim.
- **`codegen_global_asm`**: the operand arms, `{:#?}` as `PRETTY`, `Reported` vs `TooGeneric`, and the `SymStatic` TLS split
  all match.
- **`allocator_kind_for_codegen` / `needs_allocator_shim_for_linking` / `allocator_shim_contents`** (earlier, unchanged):
  still match.
- **`collect_debugger_visualizers_transitive`**: the chain and filter match. The `BTreeSet` is a stable sort plus dedup on the
  derived `Ord`: `src` bytes, then `visualizer_type` (`Natvis` < `GdbPrettyPrinter`, which I checked in rustc_attr_ir
  data_structures.rs:364), then `Option<PathBuf>`. Path-vs-path comparison stops `unported`.
- **lib.rs**:
  - `new_regular` and `new_allocator` are verbatim. `into_compiled_module` emits paths in upstream order, with
    `global_asm_object: None`, and the `OutputFilenames::temp_path_*_for_cgu` stubs are legitimate (rustc_session
    config.ts:1397/1425 leaves them unported).
  - `for_each_output` keeps the order object, bitcode, llvm_ir, assembly.
  - `serialize_rlink` and `deserialize_rlink` match step for step: magic, BE version, `cfg_version`, the four encodes, and
    `finish().map_err`. `from_utf8_lossy` becomes a non-fatal `TextDecoder`; both use maximal-subpart U+FFFD replacement.
- **assert_module_sources.rs**:
  - The `with_ignore` wrapper and the early `incremental.is_none()` return are kept.
  - `check_attrs` keeps upstream's `return` (not `continue`) on a cfg mismatch. It also keeps the `rfind('.')` suffix split
    and the crate-name check, and the sorted `cgu_names` use `into_sorted_stable_ord`, which is byte order (`str_cmp`).
  - `CguReuse` gets a `PartialOrd` table, and `IncorrectCguReuseType` stops `unported` (it is not generated).
  - Under D3/D11 the function returns at its first check, so nothing past it is reachable today. See N1.
- **back/lto.rs**:
  - `ThinModule::{name, cost, data}` and `SerializedModule::{from_file, data}` match, including the panic texts.
  - `check_lto_allowed` matches, with its four `CodegenContext` fields read through a typed view. I checked the names and
    types against write.rs:322-336.

## 3. No guessed values
- The `ssa_write` table (base.ts:1473-1516): every entry stops with `unported("ssa-write: compiler/rustc_codegen_ssa/src/back/
  write.rs <fn>")`, and each name is a real write.rs fn: `ModuleConfig::new` :117, `bitcode_needed` :269,
  `start_async_codegen` :423, `OngoingCodegen::{codegen_finished :2176, check_for_errors :2182,
  wait_for_signal_to_codegen_item :2186}`, `submit_codegened_module_to_llvm` :2199, `submit_post_lto_module_to_llvm` :2208 and
  `submit_pre_lto_module_to_llvm` :2216.
- The dep graph: see `determine_cgu_reuse` above. It follows the port's existing disabled-graph pattern.
- The lazy loads (base.ts:1410-1431) are a pure load-order device. They are marked `// PORT (init order)` there and in the
  header (base.ts:19-20), and they only defer `require` of modules whose functions are called unchanged.
- I found no guessed outputs in reachable code. N1 and N4 list unreachable or invariant-broken output paths.

## 4. Tests
- The `codegen_instance` log is genuine (see Evidence), and the `main` shim IR matches the pinned rustc's `--emit=llvm-ir`.
- The environment-variable scan passes (`unit-steps.test.ts` 10/10). `base.test.ts` reads `RUST_TS_REQUIRE_PROBES`, `REGEN` and
  `RUST_TS_AGENT`, which are all listed. See N7 for the driver.

## 5. Scope
Only the lane's files changed: base.ts, lib.ts, assert_module_sources.ts, back/lto.ts, base.test.ts, base_oracle/*, and the
handoff.

## Findings

**F1. The oracle fixture contains the porter's absolute worktree path, so 4 tests fail in every other checkout.**
`src/rustc_codegen_ssa/base.test.ts:27`, `:62` and `:117` pass `FIXTURE = join(DIR, "cgus.rs")` (an absolute path) to both the
pinned rustc and the driver. rustc prints closures as `{closure@<path as given>:19:25: 19:30}`, so `oracle.json` (from line 43;
28 occurrences) records `/Users/…/worktrees/rust-ts/t3-284633cb/src/rustc_codegen_ssa/base_oracle/cgus.rs`. In this worktree the
port prints `…/t3-95cb35c8/…`. The failing tests are "codegen_instance order …" and "every CGU the mock compiled …", once each for
`bin` and `rlib`, with 7 entries differing each time. That also happens on root's integration checkout, so the gate's `unit tests`
step would fail. This is a fixture defect, not a port defect: with the path normalised, the instance list equals my
regenerated oracle (upstream base.rs:716 order, base.rs:396 `info!`).
Fix: make the fixture path independent and regenerate (`REGEN=1`). For example, run both the oracle and the driver with
`cwd: DIR` and the relative path `cgus.rs`. Another way is to replace `DIR` with a fixed token in both the stored oracle facts
and the driver result before comparing.

**N1.** `src/rustc_codegen_ssa/assert_module_sources.ts:83` (upstream assert_module_sources.rs:69-76). The `CGU_REUSE` print
loop uses the `Map`'s insertion order. Upstream's order is `UnordMap` (FxHashMap) iteration order, which is deterministic and
visible on stdout. The `// PORT:` comment discloses this, and the path needs `-C incremental` (out of scope, D11), which stops
earlier. Still, this is a known divergent output. An `unported(...)` when `actual_reuse` is non-empty would keep the "never
guess" rule.

**N2.** `src/rustc_codegen_ssa/lib.ts:312-313`. The comment says the `impl` (`serialize_rlink`, `deserialize_rlink`) "follows
`provide`, as upstream". In fact the methods sit in the class body at :320/:345, before `provide` at :404 (upstream lib.rs:339
`provide`, :349 `impl CompiledModules`). PORTING §8 allows that placement; correct the comment.

**N3.** `docs/handoff/ssa-base.md:130`. The handoff says "The other new static imports are modules the front end already
loads". That is not quite true. Comparing the set of modules loaded by importing `rustc_interface/passes.ts` on `51dfe33c` with
the set on `3b63f5ec`, three modules are new at startup:
- `rustc_codegen_ssa/decodable.gen.ts`, via lib.ts:41;
- `std/time.ts`, via base.ts:76;
- `rustc_codegen_ssa/assert_module_sources.ts`, via base.ts:77.

None has a top-level side effect I could find (consts and functions only; no interning), and each loads cleanly as the first
import of a process. The lane's 3×200 samples match, so I see no harm. Root should still know about them for D14's bundle batch.

**N4.** `src/rustc_codegen_ssa/base.ts:340` (upstream base.rs:261 `assert_eq!(result, None)`) prints `left: Some(..)` instead of
the Debug of the value pair. `assert_module_sources.ts:166` (upstream :139 `assert_eq!(iter.next().unwrap(), crate_name)`)
formats with `JSON.stringify`, not `{:?}` for `&str`. Both texts appear only in an ICE after an upstream invariant breaks.
Low priority.

**N5.** `src/rustc_codegen_ssa/base.ts:14`, `:1320` and the handoff ("D3"). plan-m7's D3 is the IR-suite target triple. The
dep-graph-off decision is plan-m2 D3 / plan-m3 D12. The existing code uses the same shorthand (hir/map.ts:309), but on a line
that also cites "plan-m7 D11", "(D3)" reads as plan-m7's. Write "plan-m2 D3".

**N6.** `src/rustc_codegen_ssa/base.ts:1465`. The placeholder doc says `pub(crate) struct Coordinator<B>`, but upstream
write.rs:2054 is `pub struct Coordinator<B: WriteBackendMethods>`.

**N7.** `src/rustc_codegen_ssa/base_oracle/driver.ts:28` reads `RUST_TS_SSA_OUT`. The test always sets it for its child
(base.test.ts:119), so the gate's environment cannot change it. Still, the handoff's "The tests read no new environment
variables" (handoff :72) should mention it. Also, the "codegen_instance order" test does not call the port's
`codegen_instance`: the mock `compile_codegen_unit` lists `items_in_deterministic_order` itself (driver.ts:9-12 says so). The
test pins `codegen_crate`'s CGU order, which is its purpose. The `info!` site's liveness is covered by `info_sites_check`, not by
this test.

## Verdict
**FAIL**: fix F1, regenerate `oracle.json`, and re-run `base.test.ts` in a checkout other than the porter's. The port itself
(base.ts, lib.ts, assert_module_sources.ts, back/lto.ts) is ready. Once F1 is fixed, I expect a re-check to pass with notes
N1-N7.
