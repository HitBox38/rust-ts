# Handoff: cg-di-b (M7c/M7d, wave 40s): the rest of debuginfo codegen

Branch `t3/port-debuginfo-codegen`, from `d574ce10`, with llir-di merged first (`git merge --no-ff t3/port-llvm-debuginfo-builder`,
merge commit `98a6b3eb`, llir-di at `7e49f1cf`). The merge had no conflicts. Root integrates both.

## Summary
- **Everything left of `compiler/rustc_codegen_llvm/src/debuginfo/` is ported**, whole, in upstream order, with markers:
  - metadata.rs: the 43 fns cg-di-a left (47/47 now);
  - metadata/type_map.rs (14/14), metadata/enums/mod.rs (8/8), enums/native.rs (5/5), enums/cpp_like.rs (13/13).
  - No `cg-di-a:` stub is left. Two stops remain, both by name, both for printing or hashing a pointer address (below).
- **With `-g` the port now gives the oracle's IR**, debug info included:
  - all 24 `-g` gate cases of `run-pass-native` MATCH; they MATCH in `ir-run-pass` (23, the suite skips 1) and `ir-host` (24)
    too;
  - whole-module comparisons in the unit tests at `-Cdebuginfo=2` and `=1`, on x86_64-unknown-linux-gnu, the host
    (aarch64-apple-darwin) and x86_64-pc-windows-msvc (the CPP-like path);
  - larger std programs (structs, every enum layout, closures, async, coroutines, slices, `dyn`, unions, `!`, generics), at both
    levels and on both targets, compared at the N1 normal form.
- No sampled case changed status: every non-MATCH in the three `--sample 200` runs has the same status in the accepted gate,
  and none is protected.

## Files touched
New:
- `src/rustc_codegen_llvm/debuginfo/metadata/type_map.ts`
- `src/rustc_codegen_llvm/debuginfo/metadata/enums/mod.ts`
- `src/rustc_codegen_llvm/debuginfo/metadata/enums/native.ts`
- `src/rustc_codegen_llvm/debuginfo/metadata/enums/cpp_like.ts`
- Fixtures in `src/rustc_codegen_llvm/debuginfo/di_oracle/`: `types.rs`, and the oracle's `x86_64-unknown-linux-gnu.types-g2.ll`,
  `x86_64-unknown-linux-gnu.types-g1.ll`, `x86_64-pc-windows-msvc.types-g2.ll` (README.md has the commands).

Changed:
- `src/rustc_codegen_llvm/debuginfo/metadata.ts`: cg-di-a's 4 fns kept; the stubs replaced by the ports; the `TypeMap` stub
  replaced by a re-export of type_map.ts's (`pub(crate) use self::type_map::TypeMap`). Also cg-di-a's
  `apply_vcall_visibility_metadata` casts `tcx.visibility(..)` to `Visibility<ModId>` (the query's value type) instead of
  `Visibility<DefId>`; it reads only the tag, so nothing changes at run time.
- `src/rustc_codegen_llvm/debuginfo/mod.ts`: one header comment line about `type_map`. `TypeMap_default()` is still its call.
- `src/rustc_codegen_llvm/debuginfo/mod.test.ts`:
  - test 3 (the one that pinned `llir: LLVMCreateDIBuilder`, line 285, as llir-di's handoff asked) now compiles gdb.rs at
    `-Cdebuginfo=2` with `compile_codegen_unit` and requires the whole module to equal the oracle's, metadata included;
  - new test 6 does the same for types.rs at `-Cdebuginfo=2` and `=1` on x86_64-unknown-linux-gnu, and at `-Cdebuginfo=2` on
    x86_64-pc-windows-msvc;
  - fixtures carry their own `--target`. The re-make test covers the three new `.ll` files;
  - `canonical()`: the comparison for whole `-g` modules (see "Test notes").
- `src/rustc_codegen_llvm/skeleton.test.ts`: `"cg-di-a": 9` dropped, `"cg-di-b": 1` → `2`. The "one stub per owning file" check
  now checks `debug_Metadata`'s stop, because `type_di_node` is ported.
- `src/rustc_codegen_llvm/debuginfo/di_oracle/README.md`: the new fixtures.
- Nothing under `src/rust_ts/llvm/`, `harness/`, `scripts/` or `tools/`, and not `intrinsic.ts`, `va_arg.ts` or `asm.ts`.

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_codegen_llvm/src/debuginfo/<file>`)
| upstream file | ported |
|---|---|
| metadata.rs | 47/47 (was 4/47) |
| metadata/type_map.rs | 14/14 |
| metadata/enums/mod.rs | 8/8 |
| metadata/enums/native.rs | 5/5 |
| metadata/enums/cpp_like.rs | 13/13 |
| mod.rs, utils.rs, namespace.rs, di_builder.rs, gdb.rs | 24/24, 6/6, 2/2, 7/7, 3/3 (cg-di-a's, unchanged) |
| dwarf_const.rs | 0/0 |

- rustc_codegen_llvm: 795/820 (97.0%).
- TOTAL: 26236/27873, from 26153: +83, this lane's fns.
- `bun scripts/coverage.ts --check`: `markers ok (27315, 87 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5392; library 745; llvm 627)`.

## Evidence
### Commands
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: ok (above).
- `RUSTC_ICE=0 RUST_TS_REQUIRE_PROBES=1 bun test ./src/rustc_codegen_llvm/ ./src/rust_ts/llvm/ ./scripts/lib/unit-steps.test.ts`:
  **347 pass, 0 fail** (31 files, about 30 s).
- `bun test ./src/rustc_codegen_llvm/debuginfo/mod.test.ts`: 12 pass, about 1.5 s. It took about 1.1 s before this lane, so
  this lane adds about 0.5 s.

### Unit tests: whole `-g` modules (mod.test.ts 3 and 6)
Each case compiles the fixture in process with the port's front end and real backend (`compile_codegen_unit`). It compiles
from inside di_oracle/ with the oracle's `--remap-path-prefix`, so the `DIFile` paths are the oracle's. It requires
`canonical(port) === canonical(oracle)`.
- gdb.rs, x86_64-unknown-linux-gnu, `-Cdebuginfo=2`: equal. That covers the compile unit, files, subprograms, template
  parameters, variables, `#dbg_declare` records, locations and module flags.
- types.rs, x86_64-unknown-linux-gnu, `-Cdebuginfo=2`: equal. It checks:
  - field visibility flags (`DIFlagPublic`/`Private`/`Protected`, the last from a nested module);
  - tuple and unit structs, and template parameters;
  - the native enum layout: `DW_TAG_variant_part`, discriminant member, variant members with and without `extraData`, an
    untagged niche variant, a 128-bit discriminant;
  - C-like enums as `DW_TAG_enumeration_type`, an empty enum, an expanding recursive `Rec<T>` (cut off by
    `build_type_with_children`), a union, an extern type, slices, `str`, `&dyn` (`pointer`/`vtable`), raw and fn pointers, an
    array, `!`, `()`, f16/f128;
  - a closure environment, a static, a vtable type (`vtableHolder`, `__method`), and `<recur_type>`.
- types.rs, x86_64-unknown-linux-gnu, `-Cdebuginfo=1`: equal (no type info, line tables only).
- types.rs, x86_64-pc-windows-msvc, `-Cdebuginfo=2`: equal. This is enums/cpp_like.rs:
  - `enum2$<..>` unions, `VariantN` wrappers, `NAME`, `DISCR_EXACT`, `DISCR_BEGIN`/`DISCR_END`, `DISCR128_*`, `tag128_lo`/`hi`;
  - the static `tag` of a single-variant enum, `VariantNames`;
  - the MSVC basic-type names with their typedefs, and the f16/f128 bit structs.

  It needs one test double: see the model gaps.

### Ad-hoc programs (both sides through `scripts/ir-run.ts` at N1, `-Copt-level=0 -Ccodegen-units=1 -Cno-prepopulate-passes`)
`scripts/ir-diff.ts` has no way to pass `-Cdebuginfo`. So a scratch script runs both sides through `scripts/ir-run.ts --tier N1`,
the same way, in the file's directory. All of these were MATCH:

| program | x86_64-unknown-linux-gnu `-g2` / `-g1` | host `-g2` / `-g1` |
|---|---|---|
| di_oracle gdb.rs (bin, `no_core`) | MATCH / – | – |
| di_oracle names.rs (lib, `no_core`) | MATCH / – | – |
| types.rs (the fixture, `no_core`) | MATCH / MATCH | MATCH / MATCH |
| a std program: named and tuple structs, C-like/tagged/niche/generic enums, a union, a recursive `Box` list, `&dyn`, slices, `str`, fn and raw pointers, `!`, a closure capturing by `&mut`, an `async fn` polled with a no-op waker, statics, generics | MATCH (5377 lines) / MATCH | MATCH / MATCH |
| a std program: a `#[coroutine]` closure resumed to completion, an extern type, `Option<NonZeroU8>`, `Option<bool>`, a 4-variant niche, a `u128` payload, a `#[repr(u128)]` enum, a single-variant enum, an empty enum, an expanding `Rec<T>`, a doubly boxed recursive struct, `fn() -> impl Copy` returning itself | MATCH / MATCH | MATCH / MATCH |
| the first std program with `-Zdebug-info-type-line-numbers` | MATCH (`-g2`) | – |

### The 24 `-g` gate cases (`run-pass-native`, each with `--filter <id> --jobs 1`)
**24/24 MATCH** (runs `cg-di-b-g24-1` … `-24`). They were UNPORTED at `cg-di-b: … TypeMap::default`. The 24:
- `alloc-error/alloc-error-backtrace.rs`, `async-await/issue-60709.rs`;
- `backtrace/apple-no-dsymutil.rs`, `backtrace/backtrace.rs`, `backtrace/sigbus-on-apple-missing-dwarf-backtrace.rs`,
  `backtrace/std-backtrace.rs`;
- `binding/match-arm-statics.rs`, `closures/debug-info-for-closure-capture.rs`;
- `codegen/bool-negation-with-debug-info.rs`, `codegen/issue-82833-slice-miscompile.rs`, `codegen/issue-82859-slice-miscompile.rs`;
- `compile-flags/run-pass/repeated-debug-opt-flags.rs`, `coroutine/issue-58888.rs`;
- `debuginfo/impl-copy-function-debuginfo-58463.rs`, `debuginfo/issue-105386-debuginfo-ub.rs`;
- `dst/trait-impl-on-tuple-with-unsized-tail.rs`, `match/closure-in-match-guard.rs`;
- `mir/debug-ref-undef.rs`, `mir/mir-inlining/var-debuginfo-issue-67586.rs`, `parser/issues/issue-48508.rs`;
- `runtime/backtrace-debuginfo.rs`, `traits/issue-33096.rs`, `unboxed-closures/unboxed-closures-unique-type-id.rs`;
- `uninhabited/uninhabited-type-layout-computation-88150.rs`.

The same 24 ids in the IR suites, which compare the IR itself:
- `ir-run-pass`: 23 MATCH, 1 skipped by the suite (`backtrace/apple-no-dsymutil.rs`);
- `ir-host`: 24 MATCH.

### Sample difftests (`RUST_TS_AGENT=cg-di-b`, `--sample 200 --jobs 6`, AC power)
| suite | MATCH | DIFF | UNPORTED | UNSTABLE | run |
|---|---|---|---|---|---|
| `run-pass-native` | 193 | 0 | 5 | 2 | `cg-di-b-sample-run-pass-native` |
| `ir-run-pass` | 198 | 0 | 2 | 0 | `cg-di-b-sample-ir-run-pass` |
| `ir-host` | 194 | 0 | 6 | 0 | `cg-di-b-sample-ir-host` |

- **No protected case left MATCH.** Every non-MATCH case has the same status in the accepted gate
  `gate-20261114-162816-root-vc2v`, and none is in `harness/baseline/<suite>.txt`:
  - `extern/issue-64655-allow-unwind-when-calling-panic-directly.rs#fat`: `llir: LLVMRustModuleCost` (fat LTO), in all three;
  - four or five `threads-sendsync`/`share-trait` cases: `llir: the aarch64 intrinsic table` (`run-pass-native`, `ir-host`);
  - `sanitizer/cfi/self-ref.rs#cfi`: `rustc_sanitizers` (`ir-run-pass`);
  - `abi/stack-probes.rs#aarch64` and `threads-sendsync/task-comm-14.rs`: UNSTABLE (`run-pass-native`).
- **3 sampled cases are newly MATCH in all three suites.** Each was UNPORTED in the gate, and each is one of the 24 `-g` cases:
  `alloc-error/alloc-error-backtrace.rs`, `debuginfo/impl-copy-function-debuginfo-58463.rs`,
  `uninhabited/uninhabited-type-layout-computation-88150.rs`.

## `unported(...)` this lane left
Both are in metadata.rs. Each is a trait impl on the foreign type `llvm::Metadata` that works on a pointer address, which a
model object does not have:
- `cg-di-b: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs Hash for llvm::Metadata (a pointer address)` (`hash`, :54).
  Nothing calls it: no hash map in this code is keyed on a `Metadata`.
- `cg-di-b: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs Debug for llvm::Metadata (a pointer address)` (`fmt`, :60).
  It is reached only when an `assert_eq!` on two `&DIType`s fails and would print them: `spanned_type_di_node`'s check of the
  stored node, and `build_type_with_children`'s first assert. Both are ICEs upstream; here they stop by name instead of printing
  a made-up pointer.

cg-di-a's 9 `cg-di-a:` stops and the `cg-di-b: … TypeMap::default` stop are gone.

## `// PORT:` and judgment calls (decisions for root)
1. **`UniqueTypeId`'s `#[derive(StableHash)]` is hand-written (`stable_hash_UniqueTypeId`).** PORTING §3 leaves `HashStable` impls
   outside metadata/hygiene to `tools/codegen` or skips them. But this derive's result is visible: `generate_unique_id_string` is
   the `identifier:` of every composite type in the IR. That is the same reason as the `ToStableHashKey` exception for
   `MonoItem`/`CodegenUnit`. It is written as `rustc_macros::StableHash` expands:
   - the discriminant (`isize`), then each field;
   - `Ty` through the generated `stable_hash_Ty`, `VariantIdx` as `u32`;
   - `Option<ExistentialTraitRef>` through `stable_hash_Option` and the generated `stable_hash_ExistentialTraitRef`;
   - `HiddenZst` hashes nothing;
   - all of it inside `with_stable_hashing_context` + `while_hashing_spans(false, ..)`, then `Fingerprint::to_hex`.

   Every `identifier:` in the comparisons above equals the oracle's. **Root should record this as a decision**, or move it to
   `tools/codegen`.
2. **`TypeMap`'s map is a `KeyedMap` keyed by `key_UniqueTypeId`.** This is the derived `PartialEq`/`Hash`: the variant, the
   interned `Ty`'s `id`, the `VariantIdx`, and an `ExistentialTraitRef`'s `DefId` and interned args `id`. `HiddenZst` is a ZST and
   always equal. The map is never iterated, so its order cannot show.
3. **`mod private { struct HiddenZst; }`** is a module-private frozen value of a branded type, so only the `for_*` constructors
   can make a `UniqueTypeId`, as upstream intends.
4. **`AdtStackPopGuard`'s `Drop`** is a `drop()` method, called in a `finally` at the end of `build_type_with_children`.
5. **`impl Iterator` arguments** (`build_enumeration_type_di_node`'s enumerators, cpp_like's variant names) are lazy generators
   where upstream passes a lazy `map`. So `discriminants(..)`'s queries run where upstream runs them: inside the callee, after
   its `is_unsigned` and `size_and_align_of`.
6. **`return_if_di_node_created_in_meantime!`** is written out at each use. `NO_GENERICS` is a function returning `[]`.
   `SmallVec` is an array, and `Cow<str>` is a `string`.
7. **`trait MsvcBasicName`** is an interface with one impl table per type. The required member's marker sits on the interface,
   as cg-di-a did with traits.
8. **`file_metadata`'s nested `alloc_new_file_metadata`** stays nested after the `return` (ssa-debuginfo's convention), and
   `entry().or_insert_with()` is a get, then an insert on a miss. `build_generic_type_param_di_nodes`' nested
   `get_parameter_names` is the same.
9. **Paths are strings:** `PathBuf::push` is `path_join`, `strip_prefix` is `path_strip_prefix`, and `to_string_lossy()` is the
   string itself. `embed_source`'s `src`/`external_src` text is passed as its UTF-8 bytes.
10. **`visibility_di_flags`:** `tcx.visibility` is `Visibility<ModId>`, so `Visibility::Restricted(did)`'s `did.to_def_id()` is
    `ModId.to_def_id()`. A first draft compared a `ModId` as a `DefId` and gave `DIFlagProtected` for private fields; the
    types.rs comparison caught it.
11. **cpp_like's local `enum DiscrKind`** is a `$`-tagged union, and its `build_assoc_const` closure an arrow function. The
    `u64`/`u128` values are `bigint`, and `x as u64` is `BigInt.asUintN(64, x)`.
12. **`build_scalable_vector_di_node`'s `assert_matches!(arch, Arch::AArch64)`** checks the tag of `Arch`, a `TargetSpecOther`.
    `ReprOptions::scalable()` is the port's `is_scalable()`, because the field takes the name.

## IR-model gaps (for ir-fix-b and root)
1. **`LLVMRustSetNormalizedTarget` stops on any triple but the two D3 triples** (`llir: Triple::normalize("x86_64-pc-windows-msvc")`,
   rust_ts/llvm/core.ts:188). So an MSVC target cannot be compiled end to end, and the CPP-like enum debuginfo
   (enums/cpp_like.rs) can only be checked in process. mod.test.ts's MSVC case replaces the function with a double that sets
   the triple as given; the oracle's IR shows `x86_64-pc-windows-msvc` is its own normal form. This is low priority: no D3
   target is MSVC.
2. Not a gap, a note: the model prints intrinsic declarations without parameter attributes or an attribute group, as in
   `declare void @llvm.memcpy.p0.p0.i64(ptr, ptr, i64, i1)`. The oracle prints `noalias writeonly captures(none) ..` and `#N`.
   The N1 normal form absorbs this, because the parser replaces intrinsic attributes. mod.test.ts's `canonical` leaves
   intrinsic declarations out for the same reason.

No model gap showed on any `-g` path for x86_64-unknown-linux-gnu or the host: every comparison above is equal.

## Test notes
- **mod.test.ts `canonical(ir)`** is the whole-module comparison for `-g`. N1 runs `opt`, which unit tests do not do here, so
  this follows what N1's parser normalises:
  - no comment lines, `; preds` tails or `!guid` attachments;
  - attribute groups written in place;
  - no intrinsic declarations;
  - no `@"\01__imp_*"` globals. back/write.rs's `create_msvc_imps` adds those after codegen, and these tests stop at
    `compile_codegen_unit`;
  - metadata renumbered in order of first use (depth first through operands), unused nodes dropped, nodes last.
- **`with_tcx(.., as_oracle)`** runs the port from inside di_oracle/ (`process.chdir`, restored in `finally`), with the file by its
  bare name and the oracle's `--remap-path-prefix`, so the debug info's `directory:`/`filename:` match the fixture. cg-di-a's
  tests 1, 2, 4 and 5 run as before.
- **Tests 4 and 5** still replace `CodegenUnitDebugContext::new` and `build_compile_unit_di_node` with placeholders. They no longer
  need to, since neither stops now. They pass as they are, and only their comment was updated.
- **types.rs has no coroutine.** A `no_core` coroutine needs the `ManuallyDrop`/`MaybeUninit` lang items, and this fixture could not
  get its `MaybeUninit` union past the field check. Coroutines are covered by the gate's `coroutine/issue-58888.rs` and
  `async-await/issue-60709.rs` (MATCH in all three suites) and by the std programs above.
- The port does not support `--target <file>.json` (`rustc_target::spec::TargetTuple::from_path`). A custom MSVC-like target was
  not an option, which is why the double above is used.

## Notes for root
- With this lane, `-g` is no longer a stop for programs on the D3 targets. M7d's stock ripgrep profile (`debug = 1` in release)
  should get past codegen's debuginfo. It was not tried here.
- `docs/handoff/cg-contract.md`'s stub table still lists cg-di-a/cg-di-b's old counts; skeleton.test.ts has the new ones
  (cg-di-a 0, so its entry is dropped; cg-di-b 2).
- cg-di-a's handoff "Notes" about `abi_consts.test.ts`'s double of `build_global_var_di_node` still applies: it is redundant but
  harmless.
- Which code each run used:
  - The 24-case runs, in all three suites, used code equal to the first commit's.
  - The three sample runs used the working tree. It differed from that commit in two ways:
    - `build_type_with_children`'s failing-assert path stops through `debug_Metadata`. This changed before the samples started,
      and only on an ICE path.
    - During the IR samples, comment-only edits (cpp_like.rs's doc comments restored in full, the macro's doc comment) and the
      type-only `Visibility<ModId>` cast.

    None of these changes run-time behaviour on a passing path. All of them are in the second commit.
