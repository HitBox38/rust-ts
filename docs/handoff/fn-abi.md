# Handoff: fn-abi (M4 wave 23b/24, function ABI)

Branch `lane/fn-abi` (base `f0e9a0cf`, no merges). Commits: the port (`c7eee9c7`), then this handoff.

## Result
- **Ported, coverage complete**: rustc_target `callconv/mod.rs` 45/45 (`src/rustc_target/callconv/mod.ts`),
  `callconv/x86_64.rs` 5/5 (`callconv/x86_64.ts`), rustc_ty_utils `abi.rs` 16/16 (`src/rustc_ty_utils/abi.ts`, wired in
  `rustc_ty_utils/lib.ts` `provide`), rustc_passes `abi_test.rs` 5/5 (the `unported` Debug / `test_abi_eq` filled in;
  `test_abi` was already called from rustc_interface passes.ts `run_required_analyses`), and rustc_middle
  `middle/deduced_param_attrs.rs` 3/3 (new `src/rustc_middle/middle/deduced_param_attrs.ts`, needed by
  `apply_deduced_attributes`). `coverage.ts --check` ok.
- `FnAbi` / `ArgAbi` are real classes now: `ty/decls.ts` re-exports `FnAbi` (type-only) from callconv/mod.ts (the
  `Pending1` placeholder and its import are gone). interpret/call.ts: the 5 `(lane fn-abi)` accessors are dropped (call
  sites read the fields / call `eq_abi` / `is_ignore` / `callconv.clone_FnAbi`; the conv check uses `CanonAbi_eq`);
  `ArgAbi` is re-exported from call.ts for stack.ts; step.ts reads `fn_abi.can_unwind` directly.
- Query plumbing: `KEY_PolyFnSig_List_Ty` / `KEY_Instance_List_Ty` and their `PseudoCanonicalInput` keys
  (rustc_middle `query/keys.ts`, keys.rs:385/391). `queries.gen.ts` regenerated from
  `tools/codegen/queries.config.json` (2 key entries) + new `tools/codegen/typemap.callconv.json` (`FnAbi<$0>`, and
  `rustc_middle::ty::List` globally, the same entry as tyir.typemap.json). Side effect of the global `List` entry: the
  values of `opaque_types_defined_by`, `nested_bodies_within`, `adt_{,async_,significant_}drop_tys`,
  `list_significant_drop_tys` are typed `List<..>` (were `unknown`) and get a `debug_value`; typecheck is clean.
- rustc_abi canon_abi.ts: added `debug_CanonAbi` (derive Debug, `FnAbi.conv`) and `CanonAbi_eq` (derive PartialEq).

## Verification
- New `src/rustc_ty_utils/abi.oracle.test.ts` (9/9 pass), oracle vs `src/rustc_passes/oracle/dead_run.ts`, both
  `--target x86_64-unknown-linux-gnu` (host-independent), minicore metadata built by the oracle. **Byte-identical
  stderr + exit code** for: `tests/ui/abi/debug.rs` (without `-O`: all 5 `fn_abi_of(..)` dumps, the `assert_eq`
  "ABIs are not compatible" errors, the attribute errors), `abi/c-zst.rs` (x86_64-linux revision),
  `abi/pass-indirectly-attr.rs`, `abi/sysv64-zst.rs`, `abi/numbers-arithmetic/x86-64-sysv64-arg-ext.rs` (`other`),
  `abi/compatibility.rs` (x86-64 revision, all `assert_eq` pairs compatible), and a synthetic file covering SysV
  classification (SSE/INT pairs, `Cast` targets, byval `OnStack`, sret, register exhaustion, i128, C variadics,
  `C-unwind`), the Rust ABI (small-aggregate casts, return-area pointer, `&str`/`&mut [u8]` pairs, `Rc`, `&dyn`, `u128`,
  `#[track_caller]` caller location), pointee attrs (`NoAlias`/`ReadOnly`/`CapturesReadOnly`/`NoFree`/`NonNull`) and
  `AbiNe`. Pending (pinned): `debug.rs -O` stops at `rustc_mir_transform::deduce_param_attrs::deduced_param_attrs`
  (lane mt-opt2 stub); `c-variadic/pass-by-value-abi.rs` stops at `x86_win64::compute_abi_info`.
- `src/rustc_passes/dead.oracle.test.ts`: the `abi_fn_ptr_alias` / `abi_fn_item` cases now pass
  `--target x86_64-unknown-linux-gnu` and match (their `pending` key-cache pins are removed; on the darwin host they
  would otherwise stop at `aarch64::compute_rust_abi_info`). 11/11 pass.
- Crate tests (`bun test src/rustc_const_eval src/rustc_target src/rustc_ty_utils src/rustc_abi src/rustc_passes`):
  162 pass, 3 fail = the known base failures (place_operand.test.ts, contract.test.ts runtime-stop test,
  operator_cast.oracle.test.ts), unchanged. `tools/codegen/queries.test.ts` 4/4. Full unit suite not run (root runs it).
- Sample difftests (`RUST_TS_AGENT=root-f5de`, run ids `fnabi-{tydump-minicore,mirdump-minicore,tydump-ui,mirdump-ui,borrowck-ui}`)
  vs the base runs: tydump-minicore 45 MATCH / 1 UNPORTED, mirdump-minicore 45/1, tydump-ui 261 MATCH / 37 UNPORTED /
  2 UNSTABLE, mirdump-ui 271 MATCH / 29 UNPORTED (2 UNPORTED→MATCH: `mir/issue-76248.rs`,
  `mir/mir-inlining/ice-issue-77564.rs`), borrowck-ui 300 UNPORTED. **No MATCH lost, no DIFF/CRASH/TIMEOUT.** The
  changed UNPORTED stop messages are all other lanes' (borrowck `UniverseInfo::relate` / `OutlivesConstraintSet::push`,
  `CleanupPostBorrowck`, rmeta `Decodable for mir::Body`, polonius); none is a callconv/abi stop.

## `unported(...)` left (all in callconv/mod.ts; the other targets' modules are not ported)
`rustc_target::callconv::<m>::compute_abi_info (lane fn-abi: x86_64 only)` for m = x86 (/ x86_win32), aarch64,
amdgpu, arm, avr, loongarch, m68k, csky, mips, mips64, powerpc, powerpc64, s390x, msp430, sparc, sparc64, nvptx64 (+
`compute_ptx_kernel_abi_info`), hexagon, xtensa, riscv, wasm, bpf; `x86_win64::compute_abi_info (lane fn-abi: x86_64
SysV only)` (explicit `win64`/`vectorcall` ABIs, Windows targets); `<m>::compute_rust_abi_info (lane fn-abi: x86_64
only)` for x86, riscv, loongarch, aarch64, bpf. Note: on an aarch64 host without `--target`, every Rust-ABI
`FnAbi` (incl. CTFE calls in unit tests) stops at `aarch64::compute_rust_abi_info`.

## Runtime stops moved
- `#[rustc_abi]` / CTFE calls no longer stop at `rustc_middle::query::keys: QueryKey for ty::PseudoCanonicalInput<..>
  (cache)`. With `-O` (or any `OptLevel != No` without incremental) `fn_abi_of_instance` goes through
  `fn_abi_of_instance_raw` → `deduced_param_attrs` (Rust ABI only) → `rustc_mir_transform::deduce_param_attrs::deduced_param_attrs`
  (stub, lane mt-opt2). That is what `debug.rs` (which has `-O`) needs next.

## `// PORT:` decisions
- Data types hand-written (as rustc_abi / rustc_target spec): classes for structs with inherent impls, `$` unions /
  string unions for enums; `ArgAttribute` and `UsageSummary` (bitflags) are branded numbers with `flags_companion`;
  Debug of `ArgAttribute` = `external_bitflags_debug!` (`to_writer`). No types.sets.json set was needed.
- `T: Into<CastTarget>` parameters take `IntoCastTarget = Reg | Uniform | CastTarget` (`into_CastTarget`); `From`
  impls are `ArgAttributes_from_ArgAttribute`, `Uniform_from_Reg`, `CastTarget_from_Reg`, `CastTarget_from_Uniform`.
- `Copy` objects are cloned with `clone_ArgAttributes` / `clone_CastTarget`; `clone_ArgAbi` / `clone_FnAbi` are deep
  (`fn_abi_adjust_for_deduced_attrs` and call.ts's `Virtual` patch-up edit the clone).
- `debug_ArgAbi` / `debug_FnAbi` take `Ty`'s Display fn (as `debug_TyAndLayout`); abi_test uses `display_Ty` + `PRETTY`.
- x86_64.rs: `Result<[Option<Class>; 8], Memory>` is `(Class | undefined)[] | MEMORY` (a symbol); `&mut usize` is `MutRef`.
- abi.rs: `FnAbiDesc` is an interface with `FnAbiDesc_for_fn_ptr` / `FnAbiDesc_for_instance`; tracing and
  `cfg(debug_assertions)` blocks are comments; the `deduced_param_attrs` / `coroutine_kind` / `fn_sig` query values are
  cast (`unknown` in queries.gen.ts).
- Outside rustc_target, callconv is imported through `rustc_target/lib.ts` (`export * as callconv`, after `spec`);
  rustc_middle only type-imports callconv/mod.ts.

## For root / other lanes
- Files outside the strict assignment touched (all small): rustc_abi `canon_abi.ts` (debug/eq), rustc_middle
  `query/keys.ts`, `ty/decls.ts`, `queries.gen.ts` (regenerated), `middle/deduced_param_attrs.ts` (new),
  rustc_const_eval `interpret/step.ts` (1 line), rustc_passes `dead.oracle.test.ts` (2 abi cases),
  `tools/codegen/queries.config.json`, `tools/codegen/typemap.callconv.json` (new). Please review the tools/ changes.
- Stale but harmless: `as Result<FnAbi<Ty>, FnAbiError>` casts + "FnAbi is pending" PORT comments in rustc_middle
  `ty/layout.ts` (`FnAbiOf_provided`) and `ty/mod.ts` (`TyCtxt_fn_abi_of_instance`); left for their owners.
- `display_CanonAbi` (rustc_abi) is still unported (only the CTFE calling-convention-mismatch UB message).
- Next for `tests/ui/abi/debug.rs`-style tests with `-O`: lane mt-opt2's `deduce_param_attrs.rs` (it early-returns `&[]`
  for signatures whose types are all passed directly, but the stub stops before that). No difftest suite contains
  tests/ui/abi today (checked with `--filter tests/ui/abi/`), so abi.oracle.test.ts is the coverage.
