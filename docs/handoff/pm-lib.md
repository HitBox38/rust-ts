# Handoff: pm-lib (wave 35, M6: library/proc_macro client API + quote!)

Branch `t3/port-proc-macro-library` (worktree t3-54541436), based on `b0008692`. No merges.

## Files touched
All in `src/proc_macro/` (mirrors `library/proc_macro/src/`; `// std:` / `// std-type:` markers per the 2026-10-13
decision `expand-pm-types: proc_macro bridge subset lives in src/proc_macro (mirrors library/proc_macro, // std:
markers)`). No bridge file, harness, script or other crate was edited.

| TS file | upstream | fns |
|---|---|---|
| `lib.ts` (rewritten; kept `Delimiter`/`debug_Delimiter`, which proc_macro_server.test.ts and bridge/mod.ts use) | lib.rs (1,925 lines) | 111/111 |
| `diagnostic.ts` (kept `Level`/`debug_Level`, which bridge/mod.ts uses) | diagnostic.rs | 16/16 |
| `escape.ts` (new) | escape.rs | 3/3 |
| `to_tokens.ts` (new) | to_tokens.rs | 37/37 |
| `quote.ts` (new) | quote.rs | 22/22 |
| `escape.test.ts`, `quote.test.ts`, `quote_oracle/expected.json` (new) | unit tests | |

**Coverage.** `bun scripts/coverage.ts --missing library/proc_macro/src/<f>.rs` reports `0/N` for every library
file, because coverage.ts only counts `// rustc:` markers (its regex is `// rustc(-skip)?:`). Running the same
check against `// std:` markers (`upstreamFns` from scripts/coverage.ts, every `// std: <path>:<line> <name>` in
src/proc_macro): lib.rs 111/111, diagnostic.rs 16/16, escape.rs 3/3, to_tokens.rs 37/37, quote.rs 22/22 (189/189),
and every marker names an upstream fn at that line. **Harness follow-up (root):** coverage.ts should count `// std:`
markers for `library/` paths, so that `--missing`/`--check` cover library ports.
`bun scripts/coverage.ts --check --offline`: `markers ok (23169; vendor 4680)`.

## Bridge contract (pm-bridge, parallel)
lib.ts starts with a `PORT(contract): pending pm-bridge` block holding the bridge/client.rs + bridge/symbol.rs items the
client API calls. It uses upstream names and the shapes agreed with pm-bridge (two messages; pm-bridge confirmed it
at its commit `f7af3b24`):
`client_TokenStream` (class with `handle` and `clone()`), `client_Span` (branded number with `def_site`/`call_site`/
`mixed_site`), `client_Symbol` (branded number with `new`/`new_ident`/`with`), `debug_client_Span`, `debug_client_Symbol`,
`display_client_Symbol`, `BridgeMethods` (the `with_api!` list, as interface `ClientMethods`) and `client_is_available`.
Every body is `unported("... (pending pm-bridge)")`.

**At merge (root):**
1. Delete the contract block and import the same items from `./bridge/client.ts` under the aliases the block gives:
   `TokenStream as client_TokenStream, Span as client_Span, Symbol as client_Symbol, Methods as BridgeMethods,
   is_available as client_is_available, debug_Span as debug_client_Span, debug_Symbol as debug_client_Symbol,
   display_Symbol as display_client_Symbol`. `ClientMethods` is only used by quote.test.ts's mock; replace it with
   `typeof Methods`.
2. Register pm-bridge's hook in lib.ts: `crate_TokenStream.new_ = (x) => new TokenStream(x)` (client.rs:48-60
   `Encode`/`Decode` for `crate::TokenStream`).
3. rustc_builtin_macros/lib.ts: replace the `quote_client` stub with
   `new BangProcMacro(Client.expand1(quote))` (`quote` is exported from src/proc_macro/lib.ts), plus whatever pm-bridge's
   handoff needs (`Rustc` `static default_TokenStream()`).
4. quote.test.ts swaps the contract objects with `Object.assign` on `BridgeMethods`, `client_Span` and `client_Symbol`.
   If pm-bridge's exports are frozen or are not plain objects, change the mock to install itself through pm-bridge's
   own test hook (or a fake `Bridge`).

The client never sends `ts_drop`: Rust's implicit `Drop` of client handles is not modelled (see lib.ts header). Moves
are kept: an owned `TokenStream` passed to the bridge (`ts_into_trees`, `ts_concat_*`, a `Group`'s stream) is never
used again. The unit-test mock *takes* moved handles out of its store, so a use-after-move would fail the tests.

## The 30 `quote!` cases
The cases are the 30 ids UNPORTED with `rustc_expand::proc_macro::BangProcMacro::expand (quote!; proc-macro
bridge, M6)` in gate `gate-20261031-111945-root-7u0n`. They appear in expanded, hir-tree, mir, resdump,
unpretty-expanded and unpretty-hir (30 each), and in expanded-nocore, hir-tree-nocore, resdump-nocore,
tydump-nocore and unpretty-expanded-nocore (29 each): 325 case-instances. List:
`$RUST_TS_DATA/tmp/pm-lib/cases.txt`.

- **Before** (gate above, and unchanged on this branch as committed, since `quote_client` is still the stub in
  rustc_builtin_macros, which is not my file): 325/325 UNPORTED.
- **Experiment** (not committed): `$RUST_TS_DATA/tmp/pm-lib/direct.ts` binds the contract block straight to the real
  `Rustc` server, with no RPC buffers (client handles map to server objects, plus a client symbol table). I patched
  rustc_builtin_macros/lib.ts temporarily so `quote_client` runs `new BangProcMacro(<client whose run1 runs
  quote>)`, ran every case on its suites (`$RUST_TS_DATA/tmp/pm-lib/all.sh`, results in `exp.txt`), then reverted
  the patch. Results are under "Results" below. This measures the ported lib/quote/to_tokens/escape code with the real
  server. It does not cover pm-bridge's RPC encoding.

## Verification
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/proc_macro src/rustc_expand/proc_macro_server.test.ts`: all pass.
  - `escape.test.ts`: 24 vectors (6 byte strings × the 4 option sets the `Literal` constructors use). The expected
    values come from upstream escape.rs itself, compiled verbatim by the oracle rustc (`$RUST_TS_DATA/tmp/pm-lib/escprobe.rs`).
  - `quote.test.ts`: 7 `quote!` inputs compared with the oracle's `-Zunpretty=expanded` of `proc_macro::quote! { .. }`
    (whitespace-insensitive; inputs cover idents, raw idents, every literal kind, `'a`, `+=`, `=>`, `!=`, `::`,
    `$x`, `$$`, groups, `$(..)*`, `$(..),*`, nested repetition contents). Also: span save order, the four
    upstream panics, ToTokens impls (incl. the `TokenStream` impl going through `ts_into_trees` + `ts_concat_trees`),
    Literal/Ident/Punct constructors and value accessors.
- `RUST_TS_AGENT=pm-lib bun scripts/difftest.ts --suite expanded --sample 100` (committed tree): 100/100 MATCH, no
  regressions (run `pm-lib-expanded-s100`).

## Results
| | quote! case-instances (30 cases × 11 suites = 330) |
|---|---|
| before (gate `gate-20261031-111945-root-7u0n`) | 325 UNPORTED (`BangProcMacro::expand (quote!; …)`), 5 MATCH (count_compound_ops.rs in the 5 nocore suites) |
| committed branch | unchanged: still the rustc_builtin_macros stub. `unpretty-expanded --filter proc-macro/quote/` gives 1 MATCH and 8 UNPORTED (run `pm-lib-committed`) |
| experiment (port + direct server binding) | **330/330 MATCH**: every case on expanded, expanded-nocore, hir-tree, hir-tree-nocore, mir, resdump, resdump-nocore, tydump-nocore, unpretty-expanded, unpretty-expanded-nocore, unpretty-hir (`$RUST_TS_DATA/tmp/pm-lib/exp.txt`) |

So once pm-bridge's RPC path is wired (merge steps 1–3), these cases depend only on the bridge round-trip being
byte-faithful. Root should rerun the 30 cases after the merge, before accepting.

## `unported(...)` left
- Contract block (lib.ts): `proc_macro::bridge::client::Span::{def_site, call_site, mixed_site}`,
  `proc_macro::bridge::symbol::Symbol::{new, new_ident, with}`, `proc_macro::bridge::client::Methods::<each>`,
  `proc_macro::bridge::client::is_available`, all `(pending pm-bridge)`. Removed at merge.
- `proc_macro::Literal::f16_value`: no `f16` in src/std.
- `proc_macro::Literal::f32_value`: correctly rounded `f32::from_str` is not in src/std. Rounding through f64 would
  double-round.
- `<f32 as Display>::fmt`, reached by `Literal::f32_unsuffixed` / `f32_suffixed` / `ToTokens for f32`: src/std/fmt.ts
  has `F32_SPEC` and `to_shortest_str` but exports only `debug_f32`. **std follow-up:** export a `display_f32`.

## `// PORT:` decisions
- `Display` impls are `to_string()` methods (`EscapeError.to_string`, `TokenTree.to_string` on companions); `Debug`
  impls are `debug_<Type>`. Impls of the same trait for several source types get one method each, suffixed with the
  type: `TokenStream.from_TokenTree`, `from_iter_TokenTree`, `from_iter_TokenStream`, `extend_TokenTree`,
  `extend_TokenStream`, `TokenTree.from_{Group,Ident,Punct,Literal}` (plus a class-dispatching `TokenTree.from`),
  `Punct.eq_char` / `char_eq_Punct`. The `extend_items!` expansion is a single `extend_items` method.
- `Extend::extend_one` (std default) is `extend_one_TokenTree`, i.e. `extend_TokenTree([item])`.
- `impl ToTokens for TokenStream`: `tokens.extend(self.clone())` resolves to `Extend<TokenTree>`, so it goes through
  `into_iter()` (`ts_into_trees`) and `ts_concat_trees`, as upstream does. It is not a stream concat.
- ToTokens is a function table (`ToTokens<Self>`) with `ToTokens_provided`. The generic impls (`&T`, `&mut T`, `Box`,
  `Rc`, `Cow`, `Option`, `RepInterp`) take the inner table. Primitive receivers use number/bigint/string/Uint8Array
  (header of to_tokens.ts).
- `minimal_quote!` (and `_ts!`, `_tt!`) is a tagged template holding the macro input verbatim, expanded arm by arm.
  `(@ expr)` is `(@ ${() => expr})`, a thunk evaluated in token order, so `span_save_span` / `literal_from_str`
  RPCs keep upstream's order. The `ToTokens` dispatch for `(@ ..)` values is by representation (`TokenStream` /
  `Ident` / `TokenTree`). The template reader rejects any glued Rust operator other than the four
  `minimal_quote_ts!` arms (`::`, `=>`, `+=`, `!=`).
- `Peekable`, `vec::IntoIter` (with `size_hint`, `count`, `clone`) and `slice::Iter` (`Children`) are small cursor
  classes. `Utf8Chunks` and `u8::escape_ascii` are local helpers in escape.ts (src/std has neither). `char::escape_debug`
  is `escape_char(c, true, true)`.
- `MultiSpan` is `Span | Span[]`. `into_spans` dispatches arrays to the `Vec<Span>` impl. All three impls are
  ported as separate tables.
- `Literal::subspan<R: RangeBounds>` takes `[start_bound, end_bound]`. `local_file` returns the path string
  (`PathBuf::from`). `tracked::env_var` reads `process.env` (`NotUnicode` cannot be detected). `tracked::path` takes a string.
- `integer_values!` uses a local `from_str_radix` (all `ParseIntError`s map to `None`), and `float_values!` for
  f64 uses a dec2flt-grammar check and then `Number` (correctly rounded). u64/i64/u128/i128 values are `bigint`.
- The quote.rs `ext` traits, `HasIterator` / `ThereIsNoIteratorInRepetition` / `BitOr` and `RepInterp` are what the
  *generated* code uses at a proc macro's run time. They are ported as tables; rustc never calls them. `BTreeSet<T>`
  is its ascending element array.
