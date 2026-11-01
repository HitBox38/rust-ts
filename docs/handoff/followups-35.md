# followups-35: port-side small queue from the wave 35 reviews

Lane `followups-35`, branch `t3/followups-35` (worktree `t3-935a0486`), based on main `06fa2c65`.

## 1. `BoundsCheckFailed { len, index }` exact (u64 → bigint)

- **`tools/codegen/mir.typemap.json`**: two more `fields` entries, the per-field override from followups-34:
  `UndefinedBehaviorInfo::BoundsCheckFailed::{len, index}` → `::rust_ts::u64_exact`. The `fields."//"` note says
  why: `index` can be `from.saturating_add(to)`, a raw `u64` operand (projection.rs:358).
- **Regeneration.** `bun tools/codegen/types.ts rustc_middle_mir` changes exactly one line of `error.gen.ts`:
  `len: number; index: number` becomes `bigint`. Debug stays `debug_int`. The other 6 sets that use
  `mir.typemap.json` regenerate byte-identical: `rustc_middle_diagnostics`, `rustc_mir_build_builder`,
  `rustc_mir_transform`, `rustc_const_eval_interpret`, `rustc_borrowck` and `miri`.
- **Producers.**
  - `const_eval/machine.ts`: all 5 `throw_ub!(BoundsCheckFailed ..)` sites pass the exact `u64` index read by
    `read_target_usize` (no more `Number(..)`) and `BigInt(len)`.
  - `interpret/projection.ts` `bounds_check_failed`: passes its bigints through. The PORT note is updated.
- **Consumer.** `display_UndefinedBehaviorInfo` (error.ts) interpolates the fields, so it is unchanged and prints
  bigints exactly.
- **Tests.** `interpret_b.oracle.test.ts` now uses bigint literals. It has a new case for `index = u64::MAX`, which
  prints `18446744073709551615`.
- **Evidence.** `reflection/variant_index_out_of_bounds`, the only tests/ui case whose expected output contains the
  message (the machine.rs producer), MATCHes in `mir` (`--filter`).

## 2. Stale comment in `interpret/eval_context.ts` (header, now lines 30-34)

The old line said "`Size` / `usize` are numbers". The replacement says:
- target `usize` / `isize` values (`read_target_usize`, `Scalar.to_target_usize`) are bigints;
- host `usize` (indices, counts, `VariantIdx` / `FieldIdx`) are numbers;
- generated `u64` / `i64` fields follow the type map (`number`, except the exact fields in mir.typemap.json
  `fields`);
- `Size` has two forms (decision "Size representation"): `bytes()` is a number and stops beyond 2^53, while
  `bytes_u64()` is always exact.

This is a comment-only change.

## 3. proc_macro load order (the `Client` TDZ)

- **Cycle.** client.ts value-imports `bridge/mod.ts`, and `mod.ts` had `export * as server from "./server.ts"`.
  server.ts is an *extension module* of client.ts, since server.rs's `impl client::Client { run1, run2 }` becomes
  `Client.prototype.run1 = ..` at load. So whenever client.ts was the first module loaded, server.ts was evaluated
  before client.ts had defined `Client`.
  - Before this lane, loading any of client.ts, symbol.ts or diagnostic.ts first crashed. diagnostic.ts crashed
    because its F1 fix imports client.ts directly.
- **Fix** (PORTING §5 "Methods defined in another file": the defining module must not reach its extension modules
  through value imports, and the crate root loads them):
  - `bridge/mod.ts`: `export type * as server from "./server.ts";` with a `// PORT:` note. Nothing used
    `bridge.server.*` as a value; tsc is clean.
  - `lib.ts` already had `import "./bridge/server.ts"` after `import "./bridge/mod.ts"`. It now has a comment
    saying why.
  - Value users of server.ts (`rustc_expand/proc_macro.ts`, `MaybeCrossThread`) import it directly.
  - No logic change.
- **Result.** In a fresh process, every `src/proc_macro/**/*.ts` module loads cleanly as the first import. So do
  `rustc_builtin_macros/lib.ts`, `rustc_expand/{lib,proc_macro,proc_macro_server}.ts`, `rustc_interface/lib.ts`
  and `rustc_driver_impl/lib.ts`.
- **New test `src/proc_macro/bridge/load_order.test.ts`.** It runs 6 cases, each in a fresh `bun -e` process:
  - bridge/client.ts first, then lib.ts, then check that `Client`, `run1`, `run2` and `Methods` exist;
  - symbol.ts, diagnostic.ts, server.ts and mod.ts each loaded first;
  - client.ts first, then `rustc_builtin_macros/lib.ts`.

  With the fix reverted, 4 of the 6 fail; with it, all 6 pass.
- **Caveat.** If a process loads only client.ts (no lib.ts, no server.ts), `run1` / `run2` are not installed. This
  is the usual consequence of the extension-module rule, and every real entry point loads lib.ts.

## 4. pm-bridge review nits (docs/reviews/pm-bridge.md)

- **N4, client.ts function order.** All `// std: …bridge/client.rs:<line>` markers are now in ascending upstream
  order (13 … 290). I used the `declare` + assignment pattern, with `declare static` as in rustc_resolve/decls.ts:
  - `TokenStream.clone` (client.rs:85) moved after `decode_Span` (`declare clone` in the class,
    `TokenStream.prototype.clone = ..`);
  - `Bridge.with` (198) moved after `mod state` (`declare static with`, `Bridge.with = ..`);
  - `Client.expand1` / `expand2` (282/290) moved after `run_client` (`declare static expand1/expand2`, assigned at
    the end of the file).

  The `Client` constructor, `maybe_install_panic_hook` and `run_client` bodies are untouched (pm-host region).
  Expect at most an adjacent-hunk conflict with pm-host inside the `Client` class body.
- **N5, unknown-enum encode.** In `mod.ts` `encode_tag`, an `indexOf` of -1 is now `unreachable()`, matching
  `decode_tag`, instead of encoding the byte 255 (`// PORT:` note).
- **N6, panic-hook test.** New `src/proc_macro/bridge/panic_hook.test.ts` runs 3 fresh-process cases, because
  `HIDE_PANICS_DURING_EXPANSION` is a process-wide `Once`:
  - first expansion with `force_show_panics` and a client panic → the `unported` printing branch;
  - `force_show_panics` with no panic → `Ok`;
  - the first expansion hides panics, and a later `force_show_panics` still hides them (the `Once` keeps the first
    value) → `Err`, `Err`.
- **Left for pm-host (N6 second half).** The `!is_available()` arm of the hook condition (a panic before
  `state.set`, while the client decodes its input) is still hidden, while upstream prints it. Mentioning that arm in
  the `unported` message, or implementing it, belongs in `run_client`, which is in the client run-path region I was
  told to leave alone. Practically unreachable for TS clients.
- **N7** is pm-host's first test. Not touched.

## 5. vendor-rand review nits (docs/reviews/vendor-rand.md)

- **Nit 3.** `distr/integer.ts`: the `__m128i` / `__m256i` crate-skip reasons now read "x86 SIMD register type
  (compiled on x86/x86_64 hosts); Miri never samples it". The old text said "not on the oracle host".
- **Nit 4.** `distr/bernoulli.ts`: `ALWAYS_TRUE` / `SCALE` and their upstream comment block now precede the
  `Bernoulli` class, with a `// PORT:` note: upstream declares them at lines 72/76, between the struct and the impl,
  and the class holds both.

## Files touched

- `tools/codegen/mir.typemap.json`
- `src/rustc_middle/mir/interpret/error.gen.ts` (regenerated) and `interpret_b.oracle.test.ts`
- `src/rustc_const_eval/const_eval/machine.ts`, `src/rustc_const_eval/interpret/projection.ts`,
  `src/rustc_const_eval/interpret/eval_context.ts` (comment only)
- `src/proc_macro/lib.ts` (comment only), `src/proc_macro/bridge/mod.ts`, `src/proc_macro/bridge/client.ts`
- new tests: `src/proc_macro/bridge/load_order.test.ts`, `src/proc_macro/bridge/panic_hook.test.ts`
- `src/vendor/rand/distr/integer.ts` (comments), `src/vendor/rand/distr/bernoulli.ts` (move)

## Verification

| check | result |
|---|---|
| `bunx tsc --noEmit -p .` | 0 errors |
| `bun scripts/coverage.ts --check --offline` | markers ok (23193; vendor 5050) |
| coverage `--missing`: machine.rs / projection.rs / eval_context.rs / mir/interpret/error.rs | 38/38, 19/19, 37/37, 53/53 |
| codegen: 7 sets using mir.typemap.json | only the intended `error.gen.ts` line changes |
| `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_const_eval src/rustc_middle src/proc_macro src/rustc_expand src/vendor/rand src/vendor/rand_core src/vendor/chacha20` | 755 pass, 0 fail |
| `difftest --suite mir --sample 300` | 300/300 MATCH |
| `difftest --suite mir-core --sample 200` | 200/200 MATCH (8,710 MB max RSS) |
| `difftest --suite expanded --sample 200` | 200/200 MATCH |
| `difftest --suite mir --filter variant_index_out_of_bounds` (hits BoundsCheckFailed) | 1/1 MATCH |
| `difftest --suite expanded --filter quote` (real bridge) | 20/20 MATCH |

`RUST_TS_AGENT=followups-35`. I found no unstable cases.

## `unported(...)` left

None added and none removed.

## `// PORT:` decisions

- `bridge/mod.ts`: `pub mod server;` is a type-only re-export, because server.ts is an extension module of
  client.ts.
- `bridge/mod.ts`: `encode_tag` treats an unknown value as `unreachable()`.
- `bridge/client.ts`: the three `declare` placeholders that keep upstream order.
- `distr/bernoulli.ts`: the constants precede the class.
- `interpret/projection.ts`: the `bounds_check_failed` note now says the fields are exact bigints.
