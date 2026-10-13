# Handoff: hir-def (wave 8, M2 foundations)

Branch `lane/hir-def`. Commits: parse_format, rustc_hir_id + codegen sets, def.rs/structures/crate_store,
def.rs oracle replay, this handoff.

## Files touched
- **rustc_parse_format**: `src/rustc_parse_format/{lib.ts, lib.gen.ts, lib.test.ts, tests.test.ts}`,
  `pf_oracle/{gen.rs, cases.jsonl}`.
- **rustc_hir**: `src/rustc_hir/{def.ts, def.gen.ts, def.test.ts, lib.ts}`, `def_oracle/{gen.rs, cases.txt}`.
  `lib.ts` is new and holds my one export line (`export * as def from "./def.ts";`).
- **rustc_hir_id**: `src/rustc_hir_id/{lib.ts, lib.gen.ts, definitions.ts, definitions.gen.ts,
  def_path_hash_map.ts, def_path_hash_map.gen.ts, tests.test.ts}`.
- **rustc_structures**: `src/rustc_structures/{lib, collapse_macro_debug_info, crate_type, limit,
  native_lib_kind, sanitizer_set}.ts` + their `.gen.ts` + `tests.test.ts`.
- **rustc_crate_store**: `src/rustc_crate_store/{lib.ts, cstore.ts, cstore.gen.ts}`.
- **Codegen**:
  - `tools/codegen/types.sets.json`: added the sets `rustc_parse_format`, `rustc_structures`, `rustc_hir`
    (rustc_hir_id lib/def_path_hash_map/definitions plus rustc_hir def.rs) and `rustc_crate_store`.
  - New `tools/codegen/typemap.hir.json`.
  - **`tools/codegen/types.ts` (one generator change; root, please review):** this is the bitflags `impl`
    form, `#[derive(Debug)] struct X(uN)` + `bitflags! { impl X: uN {..} }`. The generator now emits the
    derived tuple Debug `X(<bits>)` for it. Before, that case was an `ERROR` (`derive(Debug) on a bitflags
    struct is not supported`).
    - I needed it for `MacroKinds`. Neither `hand` nor `skip` work for macro types: skipped types are
      still referenced unimported.
    - The oracle confirms `Macro(MacroKinds(7))`.
    - Regenerating every set (lexer, ast, errors, lint_defs, parse, session + mine) gives byte-identical
      output for all existing committed `.gen.ts`.
    - Side note: the `rustc_lexer` set writes an uncommitted `src/rustc_lexer/lib.gen.ts`. I deleted it.

## Coverage (`bun scripts/coverage.ts --missing`)
| file | ported |
|---|---|
| rustc_hir/src/def.rs | 42/42 |
| rustc_hir_id/src/lib.rs, definitions.rs, def_path_hash_map.rs, tests.rs | 16/16, 26/26, 4/4, 2/2 |
| rustc_structures/src/limit.rs, crate_type.rs, native_lib_kind.rs, sanitizer_set.rs, tests.rs | 8/8, 6/6, 3/3, 8/8, 4/4 (lib.rs, collapse_macro_debug_info.rs: 0 fns) |
| rustc_crate_store/src/cstore.rs | 16/16 (lib.rs: 0 fns) |
| rustc_parse_format/src/lib.rs, tests.rs | 28/28, 31/31 |

`coverage --check`: markers ok (3836).

Skips with reasons:
- `rustc-skip` for Encodable (`DefKey::encode`), StableHash/ToStableHashKey (OwnerId).
- schemars/serde impls of `SanitizerSet` (target-spec JSON).

## Tests and evidence
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 2045 pass, 2 skip, 0 fail. One of the skips is mine (below).
- **Oracle: rustc_parse_format.** `pf_oracle/gen.rs` drives the pinned rustc-dev `rustc_parse_format`.
  - It parses ~440 format strings in up to 13 configurations each: snippet none / `"..."` / raw /
    mismatching, appended newline, and all 3 ParseModes. That makes 4862 cases.
  - Each case records: pieces `{:?}`, every ParseError (all fields), curarg, arg_places, line_spans,
    is_source_literal.
  - `lib.test.ts` replays all 4862 cases and they all match. A one-character mutation in the u16 overflow
    check is caught (12 cases).
- **Oracle: def.rs.** `def_oracle/gen.rs` writes 792 `key<TAB>value` lines, and `def.test.ts` matches all of them. They cover:
  - every DefKind (Debug plain/pretty; `descr` for a local item, the local root and an extern root; `article`,
    `ns`, `def_path_data`, the 6 predicates);
  - all 8 MacroKinds bit patterns;
  - 30 Res shapes (Debug, descr, article, ns, macro_kinds, matches_ns, *_def_id, pattern predicates, map_id);
  - NonMacroAttrKind, Namespace, PerNS, in_namespace;
  - all 18 DefPathData (Debug, Display, get_opt_name, as_sym);
  - DefKey, HirId, OwnerId;
  - Limit, CrateType, CollapseMacroDebuginfo, NativeLibKind, SanitizerSet (Debug, Display incl. the panic
    path, as_str, mutually_exclusive).
- Ported `tests.rs` files: rustc_parse_format (31), rustc_structures (4) and rustc_hir_id.
  - The rustc_hir_id test `def_path_hash_depends_on_crate_id` is **`test.skip`, pending stable-hash**.
  - It needs `StableCrateId::new` and `DefKey::compute_stable_hash`.
  - Extra focused tests cover Definitions::new/allocate/def_path/collision panic/commit_end_of_determinism,
    DefPath strings, create_def's disambiguator counting, Config byte encoding and SortedMap.
- `RUST_TS_AGENT=hir-def bun scripts/difftest.ts --suite parse --sample 200`: 200/200 MATCH (run
  20261013-023028-hir-def-5pto). Nothing in this lane is wired into the driver yet.

## `unported(...)` left
1. **StableHasher shim**, in `src/rustc_hir_id/definitions.ts`: a local `StableHasher.new()` calling
   `unported("rustc_data_structures::stable_hash::StableHasher (pending lane stable-hash)")`, marked
   `// PORT: pending stable-hash`.
   - `DefKey::compute_stable_hash` is fully written against it: `write_u64(local_hash)`,
     `write_isize(discriminant)`, `write_str(name)`, `write_u32(disambiguator)`, then `finish()`.
     These are the `Hash` impls' calls.
   - Because of this, `Definitions::create_def` is unported until stable-hash lands. `Definitions::new`
     works: the root hash needs no hashing.
   - Root: replace the shim with the real import (names may need adapting: the vendor's `write_str`
     takes bytes), then un-skip the tests.rs test.
2. `debug_HashTableOwned`: odht's Debug format. odht is not vendored (see decisions).
3. `cstore.gen.ts` `unported_debug` for the pending types (Debug of NativeLib / DllImport / ForeignModule only):
   - `rustc_attr_ir::{CfgEntry, PeImportNameType}` (attr-ir-gen);
   - `rustc_abi::{Size, ExternAbi}` (no lane yet);
   - `rustc_data_structures::svh::Svh`.
   - They are `unknown` in `typemap.hir.json` with `PORT: pending` notes. Replace the entries when those
     crates exist.
   - `DllImport::ordinal` / `is_missing_decorations` read `import_name_type` through a local
     `PeImportNameType` alias of the codegen shape (`{ $: "Ordinal", _0 }`, ...). Drop the cast then.

## PORT decisions (please record)
- **`PartialRes`, `LifetimeRes`, `DocLinkResMap` are not in rustc_hir/def.rs at the pin.** They are in
  `rustc_middle/src/middle/resolve.rs:39/83/327`, which belongs to lane tyctxt-min, so I did not port them.
- **`hir::PrimTy` and `hir::Safety` stand-ins** live in `src/rustc_hir/def.ts`. They come from hir.rs (M3)
  and are needed by `Res::PrimTy` / `DefKind::Static`. They are hand copies of the upstream definitions
  (hir.rs:3320/4391) plus derived Debug, and the oracle confirms them. Move them to `hir.ts` once hir.rs is
  ported, and repoint `typemap.hir.json`.
- **rustc_parse_format: Str input.** `Parser.new(input: Str, style, snippet: Str | undefined, ...)` holds
  byte-indexed `Str`. The `&'input str` outputs (Lit, ArgumentNamed, CountIsName, FormatSpec.ty) are
  converted to `string` where they are produced. `Range<usize>` is `{start,end}` (codegen) and is shared,
  not cloned: upstream never mutates one. `Iterator` is `next()` plus `collect()`. `FormatSpec_default`
  and the `*_eq` helpers are hand-written derives.
- **`odht::HashTableOwned<Config>` stand-in** (def_path_hash_map.ts): a Map-backed `get`/`insert` with odht's
  return semantics. The raw on-disk layout (`DefPathHashMapRef` in rmeta) needs odht vendored. `Config`'s
  4 fns are ported exactly (LE bytes).
- **`SortedMap` stand-in** (definitions.ts): a sorted `[K, V][]` with binary-search `get`/`insert` and the
  derived Debug. It is only used after `commit_end_of_determinism`. Move it when
  rustc_data_structures::sorted_map is ported.
- **`PerParentDisambiguatorState.next` is a `DefPathDataMap`.** It extends `Map` with canonical-key lookups:
  `DefPathData` is a data enum and JS Maps key by identity. Iteration, size and `debug_HashMap` see the
  original keys.
- **`mem::discriminant(DefPathData)`** comes from a declaration-order table (no repr, no explicit
  discriminants).
- **`DefKey` is `Copy`, but `Definitions::def_key` returns the stored instance.** Keys are never mutated
  in place.
- **usize::MAX** follows the repo convention, `Number.MAX_SAFE_INTEGER`:
  - `Limit::unlimited` uses it, and `display_Limit` / `Limit_into_diag_arg` print the real
    `18446744073709551615`. The oracle checks this.
  - `ExternCrate::rank` computes `!path_len` as `MAX_SAFE_INTEGER - path_len`, which keeps the same order.
- **Generated-class statics** are attached as `X.new = function` on a re-exported const (as in ast.ts).
  Examples: `Definitions.new`, `DefPath.make`, `Limit.new` / `Limit.unlimited`.
- **Free-function forms:**
  - `impl Idx for OwnerId` is `OwnerId_new(idx)` plus a method `index()`.
  - `HirId::INVALID` is `HirId_INVALID`, and `HirId::make_owner` is `HirId_make_owner`.
  - `From` impls are `<Target>_from_<Source>`.
  - `IntoDiagArg` impls are `<T>_into_diag_arg` (the rustc_error_messages convention).
- **Display impls:** `display_SanitizerSet` iterates like bitflags `Iter` (IterNames plus remaining bits),
  written locally because vendor bitflags has no `Iter` yet.
- **`Res::def_id`** takes the `Id` Debug as a parameter (the generic Debug convention).
- **`HirIdMap` / `ItemLocalMap` id collections are not defined.** `HirId` is a class, which needs the same
  root key-strategy decision as `DefIdMap`.
- **`CrateStore` trait** is an interface with a `debug` member. `Untracked::freeze_cstore` is a no-op
  because `FreezeLock` is its inner value.

## For root
1. Merge `src/rustc_hir/lib.ts`. My only line is `export * as def from "./def.ts";`, and attr-ir-gen may add
   its own.
2. Review the `tools/codegen/types.ts` change above (tools ownership).
3. When stable-hash lands, wire `StableHasher` into definitions.ts and un-skip `def_path_hash_depends_on_crate_id`.
4. Fold `typemap.hir.json` into `typemap.json` if you prefer. Replace the `PORT: pending` entries when
   attr-ir-gen and the rustc_abi / svh ports land.
5. Delete `docs/claims/wave8-hir-def.md`.
