# Review: cg-di-b (wave 40s), the rest of debuginfo codegen

**Verdict: APPROVE WITH NITS**

- Reviewer: independent, read-only (AGENTS.md §1).
- Subject: branch `t3/port-debuginfo-codegen`, commits `f591840c` and `0eb82ea1`. Only this lane's diff was reviewed
  (`git diff 98a6b3eb 0eb82ea1`; llir-di is reviewed in `docs/reviews/llir-di.md`).
- Upstream: the pin `6f5da406b56c` (`$RUST_TS_DATA/rust`).
- Review branch: `t3/review-debuginfo-codegen`, at `0eb82ea1` plus this file.
- Host: AC power the whole time, `--jobs 6` at most, no gate running (`.data/tmp/GATE_RUNNING` was absent).

No finding changes output on any path that compiles. Every function is present, in upstream order, with correct markers.
The values, flags, names and arithmetic match upstream. The hand-written StableHash is exact, and the decision behind it is
sound. The nits below are panic (ICE) message text, one dead import, and two test-coverage gaps; I checked both gaps by hand
and they are equal to the oracle.

## Findings

No F (must-fix) findings.

**N1. The coroutine layout's `unwrap()` prints a made-up error.**
- Port:
  - `src/rustc_codegen_llvm/debuginfo/metadata/enums/native.ts:162`
  - `src/rustc_codegen_llvm/debuginfo/metadata/enums/cpp_like.ts:665`
- Both call `unwrap_result(cx.tcx.coroutine_layout(..), () => "LayoutError")`.
- Upstream: `metadata/enums/native.rs:178` and `metadata/enums/cpp_like.rs:722`, `cx.tcx.coroutine_layout(..).unwrap()`.
- Upstream's panic prints the `LayoutError`'s Debug. The port always prints the literal word `LayoutError`, which is a guessed
  text.
- Fix: pass `debug_LayoutError` (rustc_middle/ty/layout.ts), as `src/rustc_ty_utils/layout.ts:1223` does for the same call.
- It can fire only after `layout_of` of the coroutine has already succeeded, so it is effectively unreachable.

**N2. Three `assert_eq!` messages on `(Size, Align)` are not core's text.**
- Port:
  - `src/rustc_codegen_llvm/debuginfo/metadata.ts:1673` (`assert_size_and_align_eq`, used at :172 and :1444), for upstream
    `metadata.rs:152` and `:1561`;
  - `src/rustc_codegen_llvm/debuginfo/metadata/enums/cpp_like.ts:798-802`, for upstream `metadata/enums/cpp_like.rs:858`.
- These print `left: (8, 8)`. core prints the tuple's Debug, `(Size(8 bytes), Align(8 bytes))`.
- `metadata.ts:211-214`, for upstream `metadata.rs:182`, prints the custom message but drops the `left:`/`right:` lines that
  `assert_eq!` with arguments still prints.
- Fix: use `src/std/panic.ts`'s `assert_eq` (core's text) with the `Size`/`Align` Debug.
- The comparisons themselves are right (`Size_eq`, `pow2`). Only the ICE text differs.

**N3. The `assert_matches!` message is not core's text.**
- Port: `src/rustc_codegen_llvm/debuginfo/metadata.ts:1122-1124` prints ``assertion `matches!(..)` failed``.
- Upstream: `metadata.rs:1173`, `assert_matches!(cx.tcx.sess.target.arch, Arch::AArch64)`. That prints
  ``assertion `left matches right` failed`` with the left side's Debug.
- Fix: use `src/std/panic.ts:94` `assert_matches`.
- It can fire only for a `#[rustc_scalable_vector]` type compiled with `-g` on a non-AArch64 target.

**N4. A dead import.**
- Port: `src/rustc_codegen_llvm/debuginfo/metadata.ts:33`,
  `import { tag_base_type as _tag_base_type } from "../../rustc_codegen_ssa/debuginfo/mod.ts";`.
- Nothing uses it, and metadata.rs has no such import. This lane added it; it is not in `98a6b3eb`.
- Remove it, or say in a comment why it is needed (for example, module load order).

**N5. No unit fixture covers `VTableTy(_, None)` or `-Zdebug-info-type-line-numbers`.**
- Port: `src/rustc_codegen_llvm/debuginfo/di_oracle/types.rs`; the variant is defined at `metadata/type_map.ts:82`.
- Upstream: `metadata/type_map.rs:48` (`VTableTy(Ty, Option<ExistentialTraitRef>, ..)`), and the 6
  `debug_info_type_line_numbers` sites in metadata.rs.
- I mutated the hash of `VTableTy`'s `None` case and every test still passed: no fixture has a vtable for a `dyn` with no
  principal trait.
- I compared both by hand instead (Evidence, below), and both are equal to the oracle.
- Suggest adding to types.rs a `&(dyn Send + Sync)` argument, which gives `<T as _>::{vtable_type}`, and one
  `-Zdebug-info-type-line-numbers` fixture. Then the `None` identifier and the type line numbers are pinned in the unit tests,
  not just checked once.

**N6. Small things.**
- `src/rustc_codegen_llvm/debuginfo/metadata/type_map.ts:84`: the constant is named `UniqueTypeId__discriminant`. PORTING §5's
  form is `<Enum>_discriminant`, with one underscore.
- Locals renamed to avoid the TDZ or a clash with an import have no `// PORT:` note. They are needed, but not explained:
  - `coroutine_def_id0` (native.ts:137) and `file_metadata_` (native.ts:240);
  - `discr0` and `align0` (cpp_like.ts:491, :553);
  - `members_` and `generics_` (type_map.ts:427-428);
  - `tag_base_type_`, in several places.
- `metadata.ts:1014` and `:1562` cast `tcx.visibility(..)` to `Visibility<ModId>`. The query's generated type already is that,
  so the cast is redundant.
- `mod.test.ts`:
  - `with_tcx`'s `try` body is not indented.
  - Tests 4 and 5 keep placeholders they no longer need. The handoff already says so.

## 1. Fidelity

Every function was compared side by side with upstream at the pin: metadata.rs (the 43 functions this lane ported),
metadata/type_map.rs, and metadata/enums/{mod,native,cpp_like}.rs.

What I found:
- Every function is present, in upstream order.
- Every marker names the right `fn` line: 43 in metadata.rs and 41 in type_map and enums.
- `bun scripts/coverage.ts --missing` gives 47/47, 14/14, 8/8, 5/5 and 13/13.
- The doc comments are kept in full.
- Exactly two stops remain, both by name: `Hash` and `Debug` for `llvm::Metadata` (`metadata.ts`, upstream `metadata.rs:54`,
  `:60`), both for a pointer address.
  - `Debug` is reached only when `build_type_with_children`'s `assert_eq!(.., None)` (upstream `type_map.rs:260`) or
    `spanned_type_di_node`'s pointer `assert_eq!` (upstream `metadata.rs:525`) fails. Both are ICEs upstream.
  - Stopping as UNPORTED (exit 70) instead of printing a made-up pointer is the right call, and it is documented.

The points the brief singled out:

**The type map** (`type_map.ts`).
- The five `UniqueTypeId` variants and their fields match. Each constructor makes the same `assert_fully_normalized` calls; the
  vtable one also normalizes the `Option<ExistentialTraitRef>`.
- `HiddenZst` is a module-private frozen value, so only the `for_*` constructors can make a `UniqueTypeId`.
- `key_UniqueTypeId` is injective. It is the variant tag, `Ty.id`, the `VariantIdx`, and for a vtable either `None` or
  `krate:index:args.id`. Given interning, that equals the derived `Eq`. The map is never iterated, so its order cannot show.
- `insert` replaces the old value, then calls `bug!`, as upstream does.
- `stub()`:
  - Struct, Union and VTableTy each make their own LLVM call.
  - The `vtable_holder` is passed only for VTableTy.
  - The runtime version is 0.
  - The file and line come from the definition location, or the unknown file.
- `build_type_with_children`:
  - The expanding-recursion check walks the ADT stack in reverse, skipping the top entry. It zips the type arguments and
    applies the strict-containment test, as upstream does.
  - The pop guard exists only after the push, and pops in `finally`. That is the Rust drop order.
  - The early "expanding recursive" return happens before the guard exists, so nothing is popped there.

**`build_*_type_di_node` for each kind.**
- The `spanned_type_di_node` dispatch arms match, including the `Box` guard (`is_none_or` on a 1-ZST allocator) and `Pat`.
- Thin and wide pointers:
  - field names `pointer`/`vtable` and `data_ptr`/`length`;
  - the `WIDE_PTR_*` asserts.
- Arrays (the upper bound through `asIntN(64)`) and slices (subrange `(0, -1)`).
- Fn pointers, including `<recur_type>` and the marker's insert/remove.
- Basic types:
  - the MSVC names and their typedefs (line 0, no scope);
  - the f16/f128 bit structs (`bits`, `low_bits`/`high_bits`);
  - the Endian assert.
- The rest: foreign types, `!`, `()`, closure environments, unions (offset zero), tuples (`__0`..`__15` with a `__{i}`
  fallback), and scalable vectors.
- Sizes always go through `Size::bits()`, which stops rather than rounds past 2^53.

**Enum layouts.**
- Native (`native.ts`):
  - the empty-named `DW_TAG_variant_part`;
  - the tag member with `FlagArtificial`;
  - variant members whose `extraData` is `const_uint_big(type_ix(tag bits), value)` only when `opt_single_val` is `Some`.
    Niche and untagged variants get no discriminant.
  - `compute_discriminant_value` (mod.ts:399):
    - the niche value is `(variant_index - niche_variants.start).wrapping_add(niche_start)` in u128, then truncated to the tag
      size;
    - the untagged range's min/max come from `valid_range`, then are truncated.
- CPP-like (`cpp_like.ts`):
  - `enum2$<..>`, `variant{i}`/`Variant{i}` (from the pre-allocated tables, with a formatted fallback), `NAME`,
    `DISCR_EXACT`, `DISCR_BEGIN`/`DISCR_END`, the `DISCR128_*` names (`Exact128` pushes LO then HI; `Range128` pushes BEGIN_HI,
    BEGIN_LO, END_HI, END_LO), and `tag128_lo`/`tag128_hi` with `FlagZero` on the second;
  - the endian offsets, `Align::EIGHT` for the DISCR constants, the `u32` alignment for `NAME`;
  - `SINGLE_VARIANT_VIRTUAL_DISR = 0`, the single-variant `tag` static, `VariantNames`;
  - `DiscrKind` for Single, Direct and Niche, with their asserts.
  - `as u64` is `BigInt.asUintN(64, ..)`, and u128 wrapping arithmetic is `asUintN(128, ..)`. Both are Rust's semantics.

**Field visibility** (`visibility_di_flags`, metadata.ts:1012; upstream metadata.rs:1041).
- `tcx.visibility` is `Visibility<ModId>` at the pin (`rustc_middle/src/queries.rs:2212`).
- The port takes `tcx.parent(type_did)` first, as upstream does, then compares `ModId::to_def_id()` with it by `krate`/`index`,
  which is `DefId` equality.
- Public, Private and Protected match upstream's arms. The draft's `ModId`-as-`DefId` error is fixed.
- types.rs pins all three flags, and the mutations below confirm it.

**Files and lines.**
- `file_metadata`:
  - its cache, with the nested `alloc_new_file_metadata` kept;
  - the component-wise `strip_prefix` and the remapped working directory;
  - the checksum kinds (Blake3 gives none) and lowercase hex;
  - `embed_source` falling back to the external source.
- `unknown_file_metadata`'s `None` key.
- `file_metadata_from_def_id` (`walk_chain_collapsed`, `is_dummy`).
- All 6 `-Zdebug-info-type-line-numbers` sites are ported, and the hand comparison below is equal.

**Template parameters, vtables, `DIFlags`.**
- `build_generic_type_param_di_nodes`: `get_parameter_names` recurses into the parent generics, and the zip stops at the shorter
  list.
- The vtable type:
  - `__method{i}`, `__super_trait_ptr{i}`, `vtableHolder`;
  - size `pointer_size * len`, `FlagArtificial`.
- `DIFlags` on every node match upstream.
- The order of side-effecting queries and calls matches upstream in each builder: namespace, layout, def_location, type name,
  `type_di_node`, visibility. So do the four written-out `return_if_di_node_created_in_meantime!` sites.

The `// PORT:` decisions in the handoff (items 2-12) are all sound:
- the lazy generators keep upstream's iterator timing;
- `or_insert_with` as get-then-insert is safe, because the closure cannot re-enter for the same key;
- paths as strings are fine;
- the `MsvcBasicName` tables carry correct markers (668, 672, 685).

## 2. The hand-written StableHash (`type_map.ts:120`)

At the pin, `rustc_macros/src/stable_hash.rs:97-100` expands `#[derive(StableHash)]` on an enum as:
- `::std::mem::discriminant(self).stable_hash(..)`. `Discriminant`'s `StableHash` is its `Hash`
  (`rustc_data_structures/src/stable_hash.rs:522`), which for an enum without a `repr` writes an `isize`;
- then each field in declaration order.

The derive on `HiddenZst`, a unit struct, hashes nothing.

The port does exactly that:
- `stable_hash_Discriminant(0..4)`, which defaults to `write_isize`. The variants are numbered in declaration order: Ty 0,
  VariantPart 1, VariantStructType 2, VariantStructTypeCppLikeWrapper 3, VTableTy 4.
- Then `stable_hash_Ty`, the generated impl.
- Then `VariantIdx` as `u32`. That is newtype_index's `#[stable_hash]`, `self.as_u32().stable_hash(..)`
  (`rustc_index_macros/src/newtype.rs:180`; `VariantIdx` has `#[stable_hash]` at `rustc_abi/src/layout.rs:75`).
- Then `Option<ExistentialTraitRef>` through `stable_hash_Option`: a 0/1 `u8`, then the value (`stable_hash.rs:475`), with the
  generated `stable_hash_ExistentialTraitRef`.
- Then nothing for `HiddenZst`.
- All of it inside `with_stable_hashing_context` + `while_hashing_spans(false, ..)`, then `Fingerprint::to_hex`, as in
  `generate_unique_id_string` (upstream type_map.rs:94).

**It is exact for every variant.**
- I mutated each variant's hashed discriminant, one at a time. Each mutation fails at least one whole-module comparison, so each
  variant kind's `identifier:` appears in a fixture and equals the oracle's:

  | variant | fixtures that fail when its hash changes |
  |---|---|
  | Ty | linux `-g2`, msvc `-g2` |
  | VariantPart | linux `-g2` |
  | VariantStructType | linux `-g2`, msvc `-g2` |
  | VariantStructTypeCppLikeWrapper | msvc `-g2` |
  | VTableTy, `Some` | linux `-g2`, msvc `-g2` |
  | VTableTy, `None` | none (N5) |

- I checked `None` by hand: a std program with `&(dyn Send + Sync)` and `Box<dyn Send>` gives `<u32 as _>::{vtable_type}` and
  `<u64 as _>::{vtable_type}`. Its whole module at `-Cdebuginfo=2` on the host is identical to the oracle's at N1.

**The decision is sound.**
- It matches the reason PORTING §3 already accepts for porting a `ToStableHashKey` impl (`MonoItem`, `CodegenUnit`): the result
  is visible. Here every composite type's `identifier:` is visible.
- It is five arms long, and every arm is checked against the oracle.
- Stopping until `tools/codegen` makes it would put all 24 `-g` gate cases back to UNPORTED, and block M7d's `debug = 1`, for no
  gain in fidelity.
- The move to `tools/codegen` is queued on main (`docs/next.md`, "Queued (wave 40r)"), and the decision is recorded. Keep it.
  When the generator takes over, its output should be diffed against this impl, or the fixtures re-run.

## 3. Evidence

**The fixtures are the oracle's output.**
- I copied types.rs and gdb.rs to a scratch directory and ran the README's commands with `rustc +nightly-2026-10-11`.
- All four of these are byte-identical to the fixtures (`cmp`): `x86_64-unknown-linux-gnu.types-g2.ll`, `.types-g1.ll`,
  `x86_64-pc-windows-msvc.types-g2.ll` and `x86_64-unknown-linux-gnu.gdb-g.ll`.

**`mod.test.ts`:** 12 pass.
- `canonical()` follows what N1's parser normalises, and nothing more. It drops comments, `; preds`, `!guid`, intrinsic
  declarations, attribute group numbering, `__imp_` globals (added after codegen), and metadata numbering and unused nodes.
- `distinct`, every operand, and every node that is used are compared.
- The MSVC double, `LLVMRustSetNormalizedTarget` setting the triple as given, sits only on the model's triple normalisation.

**Gate cases by filter.** All MATCH:

| suite | case | result | run |
|---|---|---|---|
| `run-pass-native` | `backtrace/std-backtrace.rs` | MATCH | `rev-cg-di-b-g-rpn-1` |
| `run-pass-native` | `closures/debug-info-for-closure-capture.rs` | MATCH | `rev-cg-di-b-g-rpn-2` |
| `run-pass-native` | `coroutine/issue-58888.rs` | MATCH | `rev-cg-di-b-g-rpn-3` |
| `run-pass-native` | `unboxed-closures/unboxed-closures-unique-type-id.rs` | MATCH | `rev-cg-di-b-g-rpn-4` |
| `ir-host` | `async-await/issue-60709.rs` | MATCH | `rev-cg-di-b-g-irh-1` |
| `ir-host` | `dst/trait-impl-on-tuple-with-unsized-tail.rs` | MATCH | `rev-cg-di-b-g-irh-2` |

The IR suites' N1 form keeps all debug metadata (`scripts/lib/ir-normal.ts`), so the `ir-host` MATCHes compare the debug info
itself.

**Hand comparisons, both sides through `scripts/ir-run.ts --tier N1`.** Both are identical:
- the vtable `None` program above (host, `-g2`): 2633 lines;
- a std program at `-g2 -Zdebug-info-type-line-numbers`, with a struct (pub and private fields), a tagged enum, a union and a
  closure, on the host and on x86_64-unknown-linux-gnu: 754 and 757 lines. It has 30 `DICompositeType`s with a non-zero
  `line:`.

**Is the `chdir` in `with_tcx` safe?**
- How Bun runs test files:
  - Without flags, one process runs the test files one after another.
  - `--parallel=N`, which the gate's src/tools step uses (`scripts/lib/unit-steps.ts`), runs N worker *processes*, each with its
    own cwd.
  - `--concurrent` interleaves tests only at `await` points.
- The `chdir` window is fully synchronous: `chdir`, then `run_compiler` and codegen with no `await`, then `chdir` back in
  `finally`. No other JavaScript can run on the thread while it is open, and Bun cannot preempt synchronous code even on a
  timeout.
- No test in the repo starts a `Worker`, so there is no second thread in the process to see the change.
- `env::current_dir()` (`src/std/env.ts:362`) calls `getcwd` every time. Every reader of the cwd I found (source_map, session
  config, passes, rustc_metadata/fs) reads it per session, and none keeps it at module level. So no later test inherits
  `di_oracle/`.
- If `chdir(ORACLE)` throws, it does so before the `try`, so there is nothing to restore.
- Other test files already do the same (`rustc_resolve/late_b.test.ts`, `back/write.test.ts`, `mir/debug.oracle.test.ts`).
- And `chdir` is the faithful way to do it: upstream reads the process's cwd for the session's working directory.
- So it is safe. No finding.

## 4. Mutations

Each mutation was applied to one line, `mod.test.ts` was run, and the file was restored with `git checkout -- <file>`.
`git status` was clean afterwards.

| # | mutation | result |
|---|---|---|
| M1 | `metadata.ts:1022` `FlagPrivate` → `FlagProtected` (visibility) | linux `-g2` and msvc `-g2` fail |
| M1b | `metadata.ts:1017` `FlagPublic` → `FlagPrivate` | linux `-g2` and msvc `-g2` fail |
| M2 | `cpp_like.ts:56` `"DISCR_BEGIN"` → `"DISCR_BEGIX"` (CPP-like name) | msvc `-g2` fails |
| M3 | `mod.ts:424` niche value `+ niche_start` → `+ niche_start + 1n` | linux `-g2` and msvc `-g2` fail |
| M3b | `mod.ts:416` the untagged range's min taken from `end` only (niche bound) | msvc `-g2` fails |
| M4 | `type_map.ts:84` each variant's discriminant → 9, one at a time | see the table in section 2 |

## 5. Regressions

**Static checks.**
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (27315, 87 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5392; library 745; llvm 627)`.

**Unit tests:** `RUSTC_ICE=0 RUST_TS_REQUIRE_PROBES=1 bun test ./src/rustc_codegen_llvm/ ./src/rust_ts/llvm/ ./scripts/lib/unit-steps.test.ts`
gives 347 pass, 0 fail (31 files).

**Sample difftests:** `RUST_TS_AGENT=rev-cg-di-b-7q`, `--sample 200 --jobs 6`, a different sample from the lane's.

| suite | MATCH | DIFF | UNPORTED | UNSTABLE | run |
|---|---|---|---|---|---|
| `run-pass-native` | 192 | 0 | 7 | 1 | `rev-cg-di-b-sample-run-pass-native` |
| `ir-run-pass` | 192 | 1 | 7 | 0 | `rev-cg-di-b-sample-ir-run-pass` |
| `ir-host` | 192 | 1 | 7 | 0 | `rev-cg-di-b-sample-ir-host` |

- **No protected case left MATCH.** No non-MATCH case is in its suite's `harness/baseline/<suite>.txt`.
- Every non-MATCH case has the same status in the accepted gate `gate-20261114-162816-root-vc2v`:
  - `functions-closures/parallel-codegen-closures.rs` is DIFF in both IR suites, there and here;
  - `abi/stack-probes.rs#aarch64` is UNSTABLE;
  - the rest are UNPORTED there too: fat/thin LTO, simd casts, the aarch64 intrinsic table, `async-gen-blocks`, label
    operands, naked variadics, kcfi.
- 3 sampled cases are newly MATCH in all three suites, and each is one of the 24 `-g` cases: `debuginfo/issue-105386-debuginfo-ub.rs`,
  `mir/mir-inlining/var-debuginfo-issue-67586.rs` and `parser/issues/issue-48508.rs`.
