# Handoff: ssa-base (M7, plan-m7 wave 41, wave 40n): rustc_codegen_ssa crate driver

Branch `t3/284633cb` (from `51dfe33c`; no merges).

## Summary
- Ported the rest of `base.rs`, `lib.rs`, `assert_module_sources.rs` and `back/lto.rs` of `compiler/rustc_codegen_ssa/src/`,
  in upstream order and with markers. All four files are now complete.
- Ported:
  - `codegen_crate`, with the CGU ordering, the allocator module and the CGU reuse;
  - `codegen_instance`, `codegen_global_asm`, and `maybe_create_entry_wrapper` with its nested `create_entry_fn` and
    `get_argc_argv`;
  - `wants_msvc_seh` and `wants_new_eh_instructions`;
  - the unsizing fns, `compare_simd_types`, `build_shift_expr_rhs` and `validate_trivial_unsize`;
  - `collect_debugger_visualizers_transitive`, which now replaces the `unported` stop in `CrateInfo_new`;
  - `is_call_from_compiler_builtins_to_upstream_monomorphization` and `determine_cgu_reuse`;
  - `ModuleCodegen::{new_regular, new_allocator, into_compiled_module}`, `CompiledModule::for_each_output`,
    `CachedModuleCodegen`, `CodegenError` and the rlink (de)serialization;
  - all of `assert_module_sources.rs`;
  - `ThinModule::{name, cost, data}`, `SerializedModule::{from_file, data}` and `check_lto_allowed`.
- **Nothing protected changes.** The new run-time dependencies of base.ts are loaded lazily: `mir/`,
  `rustc_trait_selection` and `rustc_infer` go through `lazy_*` requires (plan-m7 D14). The samples are below.

## Files touched
| file | what |
|---|---|
| `src/rustc_codegen_ssa/base.ts` | the port; the `ssa_write` stub table; meth.rs / time-passes stubs |
| `src/rustc_codegen_ssa/lib.ts` | the port; foreign stubs for `OutputFilenames` temp paths and its `Encodable`/`Decodable` |
| `src/rustc_codegen_ssa/assert_module_sources.ts` | new: the port |
| `src/rustc_codegen_ssa/back/lto.ts` | the port |
| `src/rustc_codegen_ssa/base.test.ts` | new: the oracle test |
| `src/rustc_codegen_ssa/base_oracle/{cgus.rs, driver.ts, oracle.json}` | new: the fixture, the driver with its mock backend, and the oracle facts (`REGEN=1` rewrites them) |

## Coverage (`bun scripts/coverage.ts --missing <file>`)
| upstream file | ported |
|---|---|
| compiler/rustc_codegen_ssa/src/base.rs | 28/28 (was 10/28) |
| compiler/rustc_codegen_ssa/src/lib.rs | 11/11 (was 5/11) |
| compiler/rustc_codegen_ssa/src/assert_module_sources.rs | 10/10 (was 0/10) |
| compiler/rustc_codegen_ssa/src/back/lto.rs | 8/8 (was 2/8) |

`bun scripts/coverage.ts --check` reports `markers ok (26399, ...)`.

## Evidence
- `bunx tsc --noEmit -p .` is clean.
- `bun test ./src/rustc_codegen_ssa/ ./src/rustc_codegen_llvm/ ./src/std/result.test.ts ./src/rustc_interface/interface.test.ts`:
  **192 pass, 0 fail**. That includes `base.test.ts` (12 tests) and `bun test ./src/std/result.test.ts` (3 pass).
- **`base.test.ts`** runs the real front end to `analysis`, then the port's `codegen_crate` over a mock backend. The fixture
  is `base_oracle/cgus.rs` on `x86_64-unknown-linux-gnu` with `-Ccodegen-units=4 -Copt-level=0`, built two ways: as a bin
  and as an rlib. It compares the result with facts read off the pinned nightly:
  - **CGU order:** the oracle's `RUSTC_LOG=rustc_codegen_ssa::base=info` `codegen_instance(..)` lines, run with
    `-Ztrim-diagnostic-paths=no`. That is 146 lines for the bin and 119 for the rlib. They equal the mock's sequence of
    CGUs, each listed in `items_in_deterministic_order`. With the next check, this fixes the CGU order. The port's order
    is `cgu.0, cgu.3, cgu.1, cgu.2` for the bin.
  - **Partitioning:** every item is in the CGU that `-Zprint-mono-items` names, and the 4 CGUs are each compiled once.
  - **Allocator module:** `codegen_allocator` gets `370gba7z70vw642p0l8uv3rqs`, the oracle's `-Csave-temps` allocator
    `.rcgu.bc` name, with `alloc, dealloc, realloc, alloc_zeroed`, and it reaches `start_async_codegen`. The rlib gets
    none, as the oracle.
  - **The back/write.rs call sequence**, derived by hand from base.rs:716:
    `ModuleConfig::new` ×2, `bitcode_needed`, `start_async_codegen`, then per CGU wait / check / submit, then
    `codegen_finished` and `check_for_errors`.
  - **`maybe_create_entry_wrapper`:** the mock builder's IR for the wrapper equals the oracle's `define i32 @main(i32 %0,
    ptr %1)` body exactly: `sext`, the call to the v0-mangled `lang_start::<()>` with `main`, `trunc` and `ret`. The
    wrapper sits in the CGU holding `fn main`. The calls that emit no instruction come in upstream order. The rlib has no
    wrapper.
  - **The test bites:** dropping the `.reverse()` of the second half in the CGU interleave fails 2 tests. I reverted that
    change.
- Note: with `--emit=llvm-ir`, `-o <file>` forces one CGU on the oracle side, so the test uses `--out-dir`.
- Sample difftests (`RUST_TS_AGENT=ssa-base`, `--sample 200 --jobs 6`, AC power):
  - `mono-ui`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261112-140128-ssa-base-0obu`.
  - `mir-o2`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261112-140425-ssa-base-0ggm`.
  - `mir`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261112-140649-ssa-base-64j6`.
- The tests read no new environment variables. They use the existing `RUST_TS_REQUIRE_PROBES`, `REGEN` and
  `RUST_TS_AGENT` (the latter only for the scratch directory), as analyze.test.ts does.

## Stub sites root must repoint
1. `src/rustc_codegen_llvm/context.ts:1501` `wants_msvc_seh` (cg-context's stub): import `wants_msvc_seh` from
   `rustc_codegen_ssa/base.ts`. Then delete the stub and its header line (:47).
2. `src/rustc_codegen_llvm/base.ts:229` `maybe_create_entry_wrapper` (local stub; call at :134): call
   `maybe_create_entry_wrapper(Builder, cx, cx.codegen_unit)` from `rustc_codegen_ssa/base.ts`. The port takes the
   builder's static side `Bx_` first, as `codegen_mir` does (ssa-contract PORT 4).
3. `src/rustc_codegen_llvm/base.ts:234` `ModuleCodegen_new_regular` (local stub; call at :212): use
   `ModuleCodegen.new_regular(name, llvm_module)` from `rustc_codegen_ssa/lib.ts`. Update the header line :22-25.
4. `src/rustc_codegen_llvm/back/llvm_backend.ts:65` `ssa_codegen_crate`: use `codegen_crate(backend, tcx)` from
   `rustc_codegen_ssa/base.ts`. It now stops in the `ssa_write` table, at `ModuleConfig::new`.
5. `src/rustc_codegen_ssa/mir/mod.ts:882` `xlane.wants_new_eh_instructions`: import it from `../base.ts`. A static
   import is safe, because base.ts requires `mir/mod.ts` lazily, so there is no load cycle. Drop the entry, or point it at
   the import.
6. `src/rustc_codegen_llvm/skeleton.test.ts:141`: set `"ssa-base": 4` to 0 once 1–4 are repointed. That is cg-contract's
   stop-count table.
7. Optional: `src/rustc_interface/queries.ts:146` stops on `serialize_rlink` (`-Zno-link`). It can now call
   `CompiledModules.serialize_rlink(...)`, which stops later, at `OutputFilenames`'s `Encodable`.

## Every `unported(...)` left
- base.ts, the `ssa_write` table (lane ssa-write, a later wave). Each entry is `"ssa-write: compiler/rustc_codegen_ssa/src/back/write.rs <fn>"`:
  - `ModuleConfig::new`, `ModuleConfig::bitcode_needed`;
  - `start_async_codegen`;
  - `OngoingCodegen::{wait_for_signal_to_codegen_item, check_for_errors, codegen_finished}`;
  - `submit_codegened_module_to_llvm`, `submit_pre_lto_module_to_llvm`, `submit_post_lto_module_to_llvm`.

  `OngoingCodegen` and `Coordinator` are opaque placeholder interfaces in base.ts. When ssa-write lands, root repoints the
  entries and changes `codegen_crate`'s return type to ssa-write's `OngoingCodegen`.
- base.ts, meth.rs, which no lane owns yet (plan-m7 §2d "MIR core"):
  - `"compiler/rustc_codegen_ssa/src/meth.rs load_vtable (plan-m7 MIR core group, no lane yet)"`;
  - `"... meth.rs get_vtable ..."`.

  `unsized_info` reaches them, so every unsizing to `dyn` and every trait upcast stops here. `[T; N] -> [T]` does not.
  **Root: assign meth.rs.**
- base.ts: `-Z time-passes` stops on `rustc_data_structures::profiling::{get_resident_set_size, print_time_passes_entry}`,
  as rustc_driver_impl does.
- base.ts `cmp_DebuggerVisualizerFile`: `"std::path::PathBuf: Ord (compare_components) ..."`. It is reached only on MSVC
  targets with two natvis files whose bytes and kind are equal and whose paths are both `Some`.
- base.ts `determine_cgu_reuse` past its first check: `CodegenUnit::work_product_id` (rustc_middle, existing stop). This
  is never reached under D3.
- lib.ts:
  - `rustc_session::config::OutputFilenames::temp_path_for_cgu` and `temp_path_dwo_for_cgu` (rustc_session, no M7 lane
    yet). `into_compiled_module` reaches them for any output it emits. **ssa-write needs them, so root must assign them
    to a rustc_session lane.**
  - `OutputFilenames: Encodable` / `Decodable`, the rlink path.
- assert_module_sources.ts: `rustc_codegen_ssa::diagnostics::IncorrectCguReuseType` (not generated; `-C incremental` only).

## `// PORT:` decisions (for root to record)
1. **The `ssa_write` table** (base.ts) holds typed stubs for every back/write.rs fn `codegen_crate` calls. It follows
   ssa-mir-core's `xlane` pattern: these are not prototype members, so nothing collides when ssa-write lands, and tests
   replace entries.
2. **`Bx_` first** in `codegen_instance` and `maybe_create_entry_wrapper`, as in `codegen_mir`. `create_entry_fn` is a
   nested function after the `return`, as upstream; it is hoisted, and its marker is inside the body, like mono.ts's
   `local_item_id`.
3. **Lazy requires** in base.ts (`lazy_mir`, `lazy_mir_operand`, `lazy_trait_selection_engine`, `lazy_infer_at`,
   `lazy_infer_traits_engine`). lib.ts loads base.ts at startup, so static imports of these would change every suite's
   load order (D14). The other new static imports are modules the front end already loads. The mono-ui and mir-o2
   samples confirm the order is unchanged.
4. **`backend.clone()`** is the same value, because the backends are stateless unit structs. `Arc::new(config)` is the
   value itself.
5. **The CGU order:** `sort_by_key(Reverse(size_estimate))` is a stable descending sort.
   `first_half.interleave(second_half.rev())` uses a local `interleave` (itertools semantics: alternate, then the rest).
   `pre_compiled_cgus` (`FxHashMap`) is a `Map<number, ..>`. `par_map` is the port's sequential one.
6. **`determine_cgu_reuse`:** after the first check, the body is upstream's text as a comment. The disabled graph (D3)
   always returns early, and `work_product_id()` stops (`never`). `DepGraph` has no `previous_work_product`,
   `assert_dep_node_not_yet_allocated_in_current_session` or `try_mark_green` to call.
7. **`BTreeSet<DebuggerVisualizerFile>`** is a sorted, deduplicated array, using the derived `Ord`: `src` bytes, then
   kind, then `Option<PathBuf>`. Path-vs-path comparison stops `unported` (PathBuf's component order is not in
   src/std/path.ts).
8. **`check_lto_allowed`** reads `lto`, `crate_types`, `dylib_lto` and `prefer_dynamic` through a local interface of the
   upstream field types. back/write.ts's `CodegenContext` is still an opaque placeholder (ssa-write). Drop the cast when
   ssa-write lands.
9. **`CompiledModule` stays a data interface**, because the generated `Decodable` builds it as a literal.
   `for_each_output` lives on its companion const. `SerializedModule`'s methods also live on a companion const. The
   `CguReuse` and `ComparisonKind` companions carry `fmt` and `into_diag_arg`. `CguReuse_discriminant` gives the derived
   `PartialOrd`.
10. **`assert_module_sources`'s `print_mono_items` loop** prints `UnordMap::items().all(..)` in the port `Map`'s insertion
    order, which is `codegen_crate`'s order. Upstream's order there is the hash map's; it is reached only with
    `-C incremental`, which is out of scope (D11).
11. **Small translations:**
    - `Instant::elapsed()` is `Instant::now().duration_since(start)`;
    - `Duration +=` is `checked_add(..).expect("overflow when adding durations")`;
    - `2 * ptr_size` is `ptr_size.mul(2n)`;
    - `u64::try_from(entry_idx).unwrap() * ptr_size.bytes()` is a `bigint`;
    - `hir::BodyId` is cast to rustc_middle's `BodyId` for `typeck_body`, as rustc_passes does;
    - `bug!()` with no message is `bug("impossible case reached")`, upstream's text for an empty `bug!()`;
    - `ReturnSlot::Direct` is the literal `{ $: "Direct" }`, because traits/builder.ts is imported type-only.

## Notes
- `codegen_global_asm` is ported. Its only caller is `MonoItemExt::define` (mono_item.rs, unowned).
- `validate_trivial_unsize` is called only from a compiled-out `debug_assert!`. It is ported but no test reaches it.
