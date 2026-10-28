# Handoff: mt-inline (M4 wave 25: the MIR inliner)

Branch `lane/mt-inline` (base `7f2d6592` on main, no merges). Commits:
- `ce2d8c70`: inline/cycle.rs. This was done first, because it was the live stop.
- `e6604088`: inline.rs, cost_checker.rs and cross_crate_inline.rs, plus the symbol_names re-pin.
- then this handoff.

## Files touched
- `src/rustc_mir_transform/inline/cycle.ts`: the whole of cycle.rs, 4/4 fns: `should_recurse`, `process`,
  `mir_callgraph_cyclic`, `mir_inliner_callees`.
- `src/rustc_mir_transform/inline.ts`: the whole of inline.rs, 65/65 fns, including the 13 `Inliner` trait-method markers.
  - It has `Inline` / `ForceInline` (the policies are unchanged from merge-w22), the `Inliner` interface,
    `ForceInliner`, `NormalInliner`, `inline`, `process_blocks`, `resolve_callsite`, `try_inlining`,
    `check_mir_is_available`, `check_codegen_attributes`, `inline_call`, `make_call_args`,
    `create_temp_if_necessary`, `new_call_temp`, `Integrator` (a `MutVisitor`), `try_instance_mir` and
    `body_is_forwarder`.
- **New** `src/rustc_mir_transform/cost_checker.ts`: cost_checker.rs, 8/8.
- `src/rustc_mir_transform/cross_crate_inline.ts`: cross_crate_inline.rs, 4/4.
  - `provide` now installs `cross_crate_inlinable`.
  - The local `CostChecker` is a `Visitor`.
- `src/rustc_mir_transform/pass_manager.test.ts`: the stub-module count goes from 31 to **28** (delta −3: cycle.ts,
  inline.ts, cross_crate_inline.ts).
- `src/rustc_symbol_mangling/symbol_names.oracle.test.ts`: re-pinned (see "Stops moved"). The now-unused `STOP_CCI` was
  removed.
- lib.ts is untouched. Its line 141 comment `// mod cost_checker; (not referenced here: lane mt-inline adds
  cost_checker.ts)` is still accurate.

## Coverage
- inline.rs 65/65, inline/cycle.rs 4/4, cost_checker.rs 8/8, cross_crate_inline.rs 4/4.
- rustc_mir_transform 661/1101; TOTAL 21598/25518.
- `bun scripts/coverage.ts --check`: markers ok (22177; vendor 4330).

## Stops moved
**The priority stop.** `rustc_mir_transform::inline::cycle::mir_inliner_callees` was the stop of 20 of the 41
non-matching cases in the borrowck-ui sample (root's run `aln7`). It is gone. Those 20 cases now end as follows:
- **14 MATCH**:
  - borrowck-borrow-from-expr-block, borrowck-closures-two-imm, borrowck-field-sensitivity-rpass, borrowck-lend-args,
    borrowck-multiple-borrows-interior-boxes, borrowck-pat-enum, borrowck-rvalues-mutable,
    borrowck-scope-of-deref-issue-4666, borrowck-unused-mut-locals;
  - issue-52967-edition-2018-needs-two-phase-borrows#edition2015, struct-with-reference-to-trait-5708,
    two-phase-control-flow-split-before-activation;
  - nll/issue-45696-no-variant-box-recur, nll/issue-50461-used-mut-from-moves.
- **4** stop at `rustc_metadata::rmeta::decoder::cstore_impl: Decodable for mir::Body<'static>`. This is std's MIR
  decoded from metadata (lane meta-mir). The cases are borrowck-mut-uniq, incorrect-loan-error-on-local-update-5550,
  issue-23338-params-outlive-temps-of-body and nll/issue-24535-allow-mutable-borrow-in-match-guard.
- **2** stop at `std::backtrace::Backtrace Display (captured frames)`: borrowck-pat-reassign-no-binding and nll/rc-loop.
  - This is an ICE path. With `RUST_BACKTRACE=0` the real error is "`trimmed_def_paths` called, diagnostics were
    expected but none were emitted".
  - **Cause, for root / the rustc_const_eval owner:** `src/rustc_const_eval/interpret/validity.ts:1522` builds the
    message of `assert(val.layout.ty.is_opsem_inhabited(..), \`a value of type \`${display_Ty(..)}\` ..\`)`
    eagerly.
  - Upstream's `assert!` formats only on failure. `display_Ty` prints a trimmed path, which arms `must_produce_diag`,
    and the session then ICEs at exit.
  - Fix: `if (!cond) panic(\`...\`)`. This file is not mine, so I did not change it.
  - It is reached from KnownPanicsLint → `eval_mir_constant` → `const_validate_mplace`.

**Other stops that moved:**
- borrowck-ui `tests/ui/nll/issue-55850.rs` and `tests/ui/nll/nested-bodies-in-dead-code.rs` are now MATCH.
- borrowck-ui `tests/ui/borrowck/async-reference-generality.rs` now stops at
  `rustc_mir_transform::lower_slice_len::LowerSliceLenCalls (pass not ported)` (lane mt-opt1), inside
  `optimized_mir`.
- New runtime stops for root: any path through `optimized_mir` now goes through the real `ForceInline` / `Inline`. It
  stops at the first mt-opt1 stub: `LowerSliceLenCalls` and `InstSimplify` before the inliner, `RemoveStorageMarkers` and
  others after it. Every stub's `policy` is itself `unported`.
- `cross_crate_inlinable` (the provider stop `cross_crate_inlinable provider (not ported)`) is ported. It asks for
  `optimized_mir` of non-generic, non-`#[inline]` fns at `-O`, so it also reaches the mt-opt1 stubs.

**Pin changed:** `src/rustc_symbol_mangling/symbol_names.oracle.test.ts`. 9 cases were pinned to `cross_crate_inlinable
provider`:
- `const-generics-demangling.rs#v0`, `impl1.rs#v0`, `issue-60925.rs#v0`, `issue-75326.rs#v0` and
  `trait-objects.rs#v0` now **equal the oracle**. Their pins became oracle comparisons.
- `const-generics-demangling.rs#legacy`, `impl1.rs#legacy`, `issue-60925.rs#legacy` and `issue-75326.rs#legacy` are
  re-pinned to the existing `STOP_TY_HASH` (`StableHash for Ty`).
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout 120000 src/rustc_symbol_mangling/symbol_names.oracle.test.ts`: 28
  pass, 0 fail.
- With bun's default 5 s timeout, cases time out under load. That is the known flakiness, not this change.

No other test pins any of the removed stops.

## Oracle verification of the inliner (`-Zdump-mir=Inline`, scratch, not committed)
Script: `$RUST_TS_DATA/scratch/mt-inline/{cwrap.ts,cmp.sh,ncmp.sh,i1.rs,i2.rs,i3.rs}`.
- **cwrap.ts** runs the real `src/rust_ts/mirdump.ts`. After its MIR_borrow_checking loop it calls `optimized_mir`
  for every fn-like body owner.
  - Borrowck is real; nothing is faked.
  - The only change: every stub pass module (lane mt-opt1) gets policy `Optional(false)`.
- **cmp.sh** runs the oracle (nightly `rustc --emit=mir`) with those passes disabled through `-Zmir-enable-passes=-…`.
  - Both sides get `-Copt-level=2` (the Inline policy) and `-Zdump-mir=Inline`, which matches both `ForceInline` and
    `Inline`. `-Zdump-mir=all` would also hit the NLL graphviz dump, which is unported.
  - It byte-compares every runtime-phase dump that both sides wrote. **ncmp.sh** compares after normalising `allocN`.

| input | dumps compared | equal |
|---|---|---|
| i1.rs: `#[inline]` / `#[inline(never)]`, methods, generics, recursion, closures, array places, non-stable-offset destination (`a[*i] = f(i)`), diverging callee | 79 | 79 raw |
| i2.rs: drops (local `Drop` impl), `Fn` / `FnMut` / `FnOnce` closures (rust-call), `#[rustc_force_inline]`, `match`, trait methods (static, generic, `dyn`), nested inlining, mutual recursion (`mir_callgraph_cyclic`), unit / tuple returns, cross-crate-inlinable inference on non-`#[inline]` fns | 145 | 145 raw |
| i2.rs `-Cdebuginfo=2` (`var_debug_info` kept) | 145 | 145 raw |
| i3.rs: ForceInline failures (self-recursion with a justification, incompatible target features, x86_64 target) | 12 | 12 raw, **and stderr identical to the oracle's** (the `ForceInlineFailure` diagnostics) |
| cg_clif mini_core.rs (x86_64, `-Cpanic=abort`) | 260 | 260 normalised (alloc ids differ only by query order) |

- Real inlining happens in these runs, as the `(inlined …)` scopes show: call_small, call_forced, call_nested,
  call_with_drop, call_trait, call_gen_t, call_matches, call_tuple, call_unit, call_apply_once and others.
- The bodies that do not reach a dump stop elsewhere:
  - `Decodable for mir::Body` when the callee is a std fn such as `wrapping_add` / `rotate_left` (lane meta-mir);
  - `QueryKey for ty::Value` in KnownPanicsLint array bounds checks (already pinned elsewhere);
  - plus their callers through the poisoned query (`FatalErrorMarker`).
- No mismatch with the oracle was found.

## Samples (`RUST_TS_AGENT=root-f5de`, at `e6604088`)
Each run was compared case by case with w26-common's base runs, and with root's newer runs on the same samples:
`fqa9` / `lb9x` / `yu2c` / `t287` / `aln7`.

| suite | run | M / D / U (other) | newer base | changes vs newer base |
|---|---|---|---|---|
| tydump-minicore | `runs/mti-tymc` | 46 / 0 / 0 | 46 / 0 / 0 | none |
| mirdump-minicore | `runs/mti-mirmc` | 45 / 0 / 1 | 45 / 0 / 1 | none |
| tydump-ui `--sample 300` | `runs/mti-tyui` | 294 / 0 / 4 (+2 UNSTABLE) | 294 / 0 / 4 (+2) | none |
| mirdump-ui `--sample 300` | `runs/mti-mirui` | 296 / 0 / 4 | 296 / 0 / 4 | none |
| borrowck-ui `--sample 300` | `runs/mti-bck` | **275** / 0 / 25 | 259 / 0 / 41 | 16 UNPORTED → MATCH; stop messages only otherwise |

- **No MATCH lost. 0 DIFF, 0 CRASH, 0 TIMEOUT.**
- The old base runs (`wos5`, `p8q4`, `zjq3`, `mzgb`, `86qn`) have no MATCH that is anything else here.
- borrowck-ui stops now:
  - 12 `polonius_engine::AllFacts::default`;
  - 9 `Decodable for mir::Body`;
  - 2 `Backtrace Display` (the validity.ts assert above);
  - 1 `LowerSliceLenCalls (pass not ported)`;
  - 1 `NonGenericOpaqueTypeParam` diagnostic.

## Unit tests
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout 120000 src/rustc_mir_transform`: 70 pass, 0 fail (12 files).
- Full unit suite (`bun test --timeout 120000 src`, once, at `e6604088`): **6199 pass, 0 fail** (6200 tests, 458 files).

## `unported(...)` left
None in the four lane files.

## PORT decisions (phrased for `bun scripts/state.ts record decision`)
1. (mt-inline) `trait Inliner<'tcx>` is an interface implemented by the classes `ForceInliner` / `NormalInliner`.
   - The generic `inline::<T>` takes `T::new` as a parameter.
   - Fields that collide with the trait accessors get the `_` (`tcx_`, `typing_env_`, `history_`, `changed_`), as in
     `ElaborateDropsCtxt`.
   - `Result<_, &'static str>` is `Result<_, string>`.
   - `Range<BasicBlock>` is `{ start, end }`, and `Integrator`'s `RangeFrom` fields are their start index.
2. (mt-inline) `EarlyBinder::bind(tcx, callee_body.clone())` is `clone_Body` plus shim.ts's exported `Body_foldable`.
   - shim.ts imports inline.ts, so inline.ts reaches it through a lazy `require`.
   - The same applies to cycle.ts / cross_crate_inline.ts → inline.ts (`inline_()`).
3. (mt-inline) In cycle.rs, `FxHashMap<Instance, bool>` is a `KeyedMap(intern_key)`, and `FxIndexSet<(DefId,
   Binder<GenericArgs>)>` is a `KeyedSet(intern_key)`.
   - The `mir_inliner_callees` query value is typed `readonly [DefId, unknown][]` by queries.gen.ts, so it is cast to
     `GenericArgsRef`.
4. (mt-inline) `MentionedItem` equality in `inline_call` (`item.node == callee_item`, derived `PartialEq`) is
   `intern_key_eq`.
   - `try_instance_mir`'s `field_ty.has_param()` on `Unnormalized<Ty>` uses the derived visitor
     `visit_with_Unnormalized`.
5. (mt-inline) `symbol_names.oracle.test.ts`: the 5 v0 cases formerly pinned to `cross_crate_inlinable provider` are
   oracle comparisons now, and the 4 legacy ones are pinned to `StableHash for Ty`.

## For root / other lanes
- **rustc_const_eval** (validity.ts:1522): make the `is_opsem_inhabited` assert message lazy (see "Stops moved"). This
  turns 2 borrowck-ui sample cases (borrowck-pat-reassign-no-binding, nll/rc-loop) from an ICE into whatever comes
  next.
- **mt-opt1**: with the inliner real, `optimized_mir` now runs `ForceInline` / `Inline` and then the opt1 passes.
  - The scratch harness above (`cmp.sh` with `STOPS`) can verify the opt1 passes together with the inliner: drop a
    pass from the `-Zmir-enable-passes` list and use `DUMP=<PassName>`.
- **meta-mir**: `Decodable for mir::Body` is now the stop of 9 borrowck-ui sample cases, and of any inlining of std
  callees.
- The `desc` of `mir_inliner_callees` is still `unported` in queries.gen.ts (generator: `.def_id()` on a non-tcx
  receiver). Only cycle errors and query stacks read it.
