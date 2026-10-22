# Handoff: symbol-mangling

Branch `lane/symbol-mangling` (base `362401a6`, integ-w19). Ports all of `compiler/rustc_symbol_mangling` plus the
pieces its path needs, and wires it into the query providers and the `RuntimeSymbols` late lint.

## Files touched
- New `src/rustc_symbol_mangling/`: `lib.ts`, `legacy.ts`, `v0.ts`, `hashed.ts`, `export.ts`, `test.ts` (all six upstream
  files). Also new: `oracle/run.ts` (the test driver, not a port) and `symbol_names.oracle.test.ts`.
- New `src/rustc_data_structures/base_n.ts` and `base_n/tests.test.ts` (upstream base_n.rs and its tests).
- New `src/rustc_middle/mono.ts`: only the part `compute_symbol_name` reaches, which is `MonoItem::instantiation_mode`
  and the small `MonoItem` helpers before it (8/41 of mono.rs). CGUs, `CodegenUnitNameBuilder`, `explicit_linkage`, etc.
  are left for monomorphization.
- `src/rustc_middle/query/keys.ts`: `QueryKey` impls for `ShimKind`, `InstanceKind` and `Instance`.
  `tools/codegen/queries.config.json` maps the `Instance` / `InstanceKind` key types. `queries.gen.ts` was regenerated.
- `src/rustc_session/session.ts`: `generate_proc_macro_decls_symbol` (session.rs:1535).
- `src/rustc_interface/passes.ts`: `rustc_symbol_mangling.provide(providers.queries)` in `default_query_providers`.
- `src/rustc_lint/runtime_symbols.ts`: both `unported("rustc_symbol_mangling::symbol_name_from_attrs")` stand-ins now
  call `symbol_name_from_attrs(cx.tcx, InstanceKind::Item(..))`.
- `src/rustc_lint/late_e2.oracle.test.ts`: the two `runtime_symbols` cases lose their `stop` pins and are now compared
  exactly with the oracle; both match.
- New vendor crates (ported by a subagent): `src/vendor/punycode/` (punycode 0.4.1) and `src/vendor/rustc_demangle/`
  (rustc-demangle 0.1.28; `lib`, `legacy`, `v0`), with their upstream tests (61 pass).
- `harness/scope.json`: `"punycode": "=0.4.1"` and `"rustc-demangle": "=0.1.28"` added to `vendor`, so
  `coverage.ts --check` covers them. **Root approved these two scope-list entries** for this commit. It is the only
  `harness/` change.

## Coverage
- `bun scripts/coverage.ts --missing`: rustc_symbol_mangling lib.rs 9/9, legacy.rs 20/20, v0.rs 28/28, hashed.rs 2/2,
  export.rs 11/11, test.rs 1/1. rustc_middle mono.rs 8/41.
- `bun scripts/coverage.ts --check`: markers ok (18193; vendor 4263).

## `// PORT:` decisions (the main ones; the rest are in the file headers)
- `trait AbiStableHash` (export.rs) is one function per implementing type, `abi_stable_hash_<T>(self, tcx, hasher)`.
  The generic `[T]` impl takes the element's function. Integer `Hash::hash` is the hasher's `write_u8` / `write_u64` /
  `write_usize`.
- `BaseNString` is a class holding `start` and `buf`.
- `compute_instantiating_crate` is a closure that `bool::then` calls only when needed.
- `[GenericArg]: TypeVisitable` flag checks are `any` over the elements (legacy.ts, v0.ts).
- In legacy.ts, `stable_hash_unported` is `unported(..)` typed `void`, so the hashing steps after a stop keep upstream's
  control flow.
- `ShimKind` / `InstanceKind` / `Instance` query keys: the cache key is the `intern_key` of the value's interned
  children and `DefId`s (keys.ts:143).
- Query values that are `unknown` in queries.gen.ts (`type_of`, `fn_sig`, `generics_of`, `symbol_name`,
  `codegen_fn_attrs`, `symbol_mangling_version`, `hir_crate_items`, `associated_item`) are cast at the use site, each
  with its own `PORT:` comment.

## Where things stop (`unported`)
- **Legacy mangling: `get_symbol_hash`** (legacy.ts:204-217) stops at `Ty: StableHash`, then `PolyFnSig: StableHash`
  and `GenericArgsRef: StableHash` (impls_ty.rs). Porting those needs generated `StableHash` derives for the
  type_ir/middle types plus about 6 hand-written impls: a codegen job of roughly 400-600 generated and 200 hand-written
  lines. This is the next step for legacy symbols (every legacy symbol of a non-`#[no_mangle]` item hashes its type).
- **v0**: works for `main`, statics, impls and `#[no_mangle]` / `export_name` items. Any other function goes through
  `MonoItem::instantiation_mode`, which calls `cross_crate_inlinable` (rustc_mir_transform, not ported; the stop is
  `cross_crate_inlinable provider (not ported)`).
- Cases with const generics or array lengths stop earlier, in typeck's `const_eval_resolve_for_typeck` (M4 const eval).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_symbol_mangling src/rustc_data_structures/base_n src/vendor/punycode src/vendor/rustc_demangle`:
  pass.
- `symbol_names.oracle.test.ts` covers every `tests/ui/symbol-names` case with compiletest's arguments
  (`uiFileCases`, human format), minus `-Zparse-crate-root-only` and plus `-Zno-codegen` on both sides. That flag stops
  the oracle from linking for x86_64-linux on macOS, but `should_codegen()` stays true, so the dump still runs. The
  output dir is moved under `$RUST_TS_DATA/tmp`. Results: 27 cases, 3 skipped by the harness (aux-build,
  needs-asm-support, only-windows).
  - **10 match the oracle exactly**: `basic.rs#v0`, `foreign-types.rs`, `const-generics-str-demangling.rs`,
    `issue-53912.rs`, `issue-76365.rs` (both), `normalize-in-param-env.rs` (both), `struct-constructor-mangling.rs`,
    `verbose.rs`.
  - 17 are pinned to their stop: 10 at `cross_crate_inlinable`, 6 at `const_eval_resolve_for_typeck` and
    `basic.rs#legacy` at `StableHash for Ty`.
- `late_e2.oracle.test.ts`: 16 pass, including the two unpinned `runtime_symbols` cases.
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src`: 5736 pass, 1 skip, 1 fail of 5738 (2212 s, under load average ~43 from other
  sessions). The failure is `src/vendor/odht/odht.oracle.test.ts` "build: insert results, len and raw bytes match the
  oracle's odht" (`probe failed:` with empty stderr). It fails the same way at base `362401a6` (checked in the base
  worktree), and the lane does not touch odht.

## Samples
Lane vs base (base = a temporary detached worktree at `362401a6`, removed afterwards). Both sides ran with
`RUST_TS_AGENT=symbol-mangling`, so they used the same samples. Run dirs: `$RUST_TS_DATA/runs/symmangle-<suite>-{lane,base}`.

| suite | lane M / D / U / C / UNSTABLE | base M / D / U / C / UNSTABLE |
|---|---|---|
| tydump-minicore (46) | 45 / 0 / 1 / 0 / 0 | 45 / 0 / 1 / 0 / 0 |
| hir-tree `--sample 300` | 299 / 0 / 1 / 0 / 0 | 299 / 0 / 1 / 0 / 0 |
| tydump-ui `--sample 300` | 260 / 0 / 39 / 0 / 1 | 260 / 0 / 39 / 0 / 1 |

Per-case statuses and UNPORTED stop paths are identical on both sides, with no new DIFF. The tydump-minicore stop is
`const_eval_poly (M4)` on both sides. None of these suites reaches symbol mangling (it runs in `start_codegen`).

## For root
1. The two vendor scope entries in `harness/scope.json` (approved) are in this commit.
2. Next steps: (a) a codegen lane for `StableHash` of `Ty` / `PolyFnSig` / `GenericArgsRef` (legacy mangling);
   (b) `cross_crate_inlinable` (rustc_mir_transform/src/cross_crate_inline.rs) for v0 symbols of ordinary fns. Once
   either lands, unpin the matching `STOPS` entries in `symbol_names.oracle.test.ts`.
3. `rustc_middle/mono.ts` is partial (8/41); monomorphization lanes should extend it rather than start a new file.
