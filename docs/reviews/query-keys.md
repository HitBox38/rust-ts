verdict: APPROVE-WITH-NOTES

Lane: query-keys (branch `lane/query-keys`, commits fc6fe756, 761effec; base main fb048c64).
Reviewer checks run in a scratch worktree, now removed: `bunx tsc --noEmit -p .` clean; `coverage.ts --missing
compiler/rustc_middle/src/query/keys.rs` 63/63; `coverage.ts --check` markers ok (22992; vendor 4680);
`bun tools/codegen/queries.ts --check` up to date, unported key impls 0, unknown types 120;
`bun test tools/codegen/queries.test.ts` 6 pass / 0 fail; `difftest --suite mir-minicore` 46/46 MATCH;
`difftest --suite mir --filter derive` 255 MATCH / 2 UNPORTED. Both UNPORTED cases are proc-macro auxiliaries
(`BangProcMacro::expand`, M6) and neither is in `harness/baseline/mir.txt`, so no protected case is lost.
`git diff main...lane/query-keys -- harness scripts` is empty.

Checked against upstream keys.rs at the pin:
- Order: `canonical_query_input_usize_key` (:349/:350) comes after the `(.., bool)` factory. `KEY_CanonicalInput` (:356)
  and `KEY_CanonicalInput_bool` (:362) come before the existing `KEY_CanonicalInput_usize` (:368).
  `KEY_LocalExpnId_TokenStream` (:404) sits between `KEY_Value` (:397) and `KEY_ValidityRequirement_..` (:409).
  `KEY_Instance_CollectionMode` (:418) is last, before the `/// Gets a DefId associated with a type` block. All of
  these match upstream.
- default_span: DUMMY_SP for the three canonical impls. `self.0.expn_data().call_site` is
  `LocalExpnId.expn_data(self[0]).call_site`, which uses the ported hygiene.rs:227 fn. `self.0.default_span(tcx)` is
  `KEY_Instance.default_span(self[0], tcx)`. Each `// rustc:` marker points at the upstream `fn default_span` line.
- key_as_def_id: none of these impls overrides it upstream. The port uses `QueryKey_provided.key_as_def_id`, which is
  correct.
- Cache: none of these impls overrides `type Cache` upstream, so `DefaultCache` (keys.rs:38) applies. The port uses
  `default_cache(intern_key)` with `hash_key: intern_key`, the same choice as the sibling tuple keys. This is correct.
- Debug: the tuple shapes `debug_tuple(f, "", [..])`, `${usize}` and `"true"/"false"` match the existing sibling impls
  (:344, :368). `debug_LocalExpnId` is `expn{}`, which matches `#[debug_format = "expn{}"]`. `debug_TokenStream` is the
  generated derive(Debug) `TokenStream([..])`. `debug_CollectionMode` is the variant name.

Findings:

1. src/rustc_middle/mono.ts:282-301: out-of-lane `CollectionMode`. (non-blocking, accept)
   It matches mono.rs:710-726 exactly: same doc comments, the derive list recorded, variants `UsedItems` and
   `MentionedItems` in order, and a `// rustc-type: compiler/rustc_middle/src/mono.rs:712 CollectionMode` marker on the
   right line. It is appended at the end of the file, which is correct because it is the last item of mono.rs.
   - The fieldless-enum representation (string union, companion const, `debug_` = variant name) follows PORTING §5.
   - Hash/Eq via intern_key of a string agrees with the derived `Hash, PartialEq, Eq`.
   - The `queries.config.json` `types` entry is consistent with the two existing entries (paths / ts / import / types /
     values / debug / note). The generated import is type-only (`import { type CollectionMode } from "./mono.ts"`), so it
     adds no runtime cycle.
   Root should record that this file was touched outside the lane, or move the type, as the handoff asks. Nit: the new
   `import type { Debug }` is placed after the other imports instead of with the `std/fmt` import group. This is
   cosmetic only.

2. src/rustc_middle/query/keys.ts:888-902: `KEY_LocalExpnId_TokenStream` PORT note. (non-blocking)
   Upstream `TokenStream(Arc<Vec<TokenTree>>)` derives `PartialEq, Eq, Hash` (tokenstream.rs:638), and `TokenTree`
   derives them too (:29). Value equality of the `TokenStream` object through intern_key is therefore the right key.
   - The phrase "the trees hold no interned values" is stronger than needed. Even if a token held an INTERNED object,
     intern_key's pointer identity would still agree with Rust.
   - Spans compare as their packed numbers in both systems.
   No change is required.

3. src/rustc_middle/query/keys.ts:696-709 and :774-798: `canonical_query_input_usize_key`, `KEY_CanonicalInput` and
   `KEY_CanonicalInput_bool` have no users at the pin. (non-blocking)
   They mirror upstream impls that exist but are unused, so having them satisfies "same functions". They are not
   invented behaviour. With no config entries, any future query keyed on them would still need a `keys` entry. The
   handoff says this.

4. The `StableHash` derive of `CollectionMode` and the keys' dep-node fingerprinting are not ported here.
   (non-blocking)
   This is the known D9 StableHash gap (mir-core stops there). It is not a regression and is out of this lane's scope.
   It is noted only so it is not mistaken for coverage.

5. tools/codegen/queries.test.ts:127-137: the new test pins `report.unported_keys` to `{}`. (non-blocking)
   This is correct at a fixed pin and is a useful ratchet.
   - The generator itself (tools/codegen/queries.ts) is unchanged, so there is no general-correctness risk from codegen.
   - The fallback assertion (an unknown key falls back to `key_unported(..)`) keeps the general path tested.

Sample claims: the handoff's mir/tydump-ui/mir-minicore "before = after" numbers are plausible. My runs agree:
mir-minicore 46/46, and the derive-filtered mir run lost no protected cases. I did not rerun check-core-bin (excluded
by instructions).
