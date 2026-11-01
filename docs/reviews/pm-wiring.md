# Review: pm-wiring (root commit `02ab6c6e` on `integ-w35`)

Reviewer: independent, read-only. Scratch worktree at `02ab6c6e` (plus one at its parent for comparison); both removed.

## Verdict: APPROVE WITH NITS

The commit does the merge steps from pm-lib's handoff (steps 1–3) and pm-bridge's handoff (Integration 1–4), and
nothing else. It matches upstream. The cast is sound. No blocking findings. One latent init-order hazard is new
(F1). No current entry point hits it, but it should be queued.

## Results (one line each)

- `bunx tsc --noEmit -p .`: exit 0, no errors.
- `bun scripts/coverage.ts --check --offline`: `markers ok (23169; vendor 5050)`, exit 0.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/proc_macro src/rustc_expand src/rustc_builtin_macros`: 876 pass, 0 fail
  (15 files).
- Spot check, 5 of the 30 quote! cases (quote/debug.rs, auxiliary/mixed-site-span.rs, macros/auxiliary/serde.rs,
  quote/not-repeatable.rs, hygiene/auxiliary/opaque-hygiene.rs): unpretty-expanded 5/5 MATCH, mir 5/5 MATCH.
- `bun scripts/difftest.ts --suite expanded --sample 100`: 100/100 MATCH (DIFF/UNPORTED/CRASH 0, skipped 3), run
  `20261031-233047-root-bgke`.

## Fidelity

- rustc_builtin_macros/lib.ts: `Client.expand1(quote)` then `register(sym.quote, Bang(BangProcMacro { client }))`
  matches upstream compiler/rustc_builtin_macros/src/lib.rs:150-151 line for line. The order (after the
  `register_derive` block, before `contracts_requires`) matches. The `quote_client` stub, `unported` and `Result`
  imports are removed cleanly.
- proc_macro_server.ts:803 `Rustc.default_TokenStream()` = `tokenstream.TokenStream.default()`. That is the ported
  `impl Default for TokenStream` (rustc_ast tokenstream.ts:859-860, upstream tokenstream.rs:857-858,
  `EMPTY_TOKEN_STREAM.clone()`). `unwrap_or_default_TokenStream` in bridge/server.ts:652 is the only consumer. It
  lands in the same merge as quote!, as pm-bridge review N3 required.
- lib.ts: the contract block is gone. The import uses exactly the aliases pm-lib's handoff step 1 lists, plus
  `crate_TokenStream`. The re-exports cover diagnostic.ts and quote.test.ts (pm-lib review N2). `ClientMethods` is
  `typeof BridgeMethods`. The hook `crate_TokenStream.new_ = (x) => new TokenStream(x)` (lib.ts:462) sits right
  after `class TokenStream` / `debug_TokenStream`, as pm-bridge Integration 1 asks.
- Headers: rustc_expand/proc_macro.ts lines 3-6 are refreshed (pm-bridge Integration 4). The lib.ts header no longer
  says "pending". Its "bridge/server.ts attaches `Client::run1` / `run2`" statement is still true (server.ts:665
  `Client.prototype.run1 = ...`), so pm-lib review N3 does not apply.
- No behaviour beyond the wiring. The only runtime additions are the hook, `default_TokenStream`, and the real
  `BangProcMacro`.

## Cast soundness (rustc_builtin_macros/lib.ts:162)

`quote as unknown as Parameters<typeof Client.expand1>[0]` is sound. `Client.expand1`'s run path builds its argument
only through `decode_crate_TokenStream` → `crate_TokenStream.new_` (client.ts:118-119), and lib.ts installs that as
`new TokenStream(x)`. So `quote` always receives lib.ts's `TokenStream` class. Its return value (a lib.ts
`TokenStream`) satisfies `CrateTokenStream { _0 }` structurally, and `encode_crate_TokenStream` reads only `_0`.
`as unknown` is needed because neither function type is assignable to the other under strictFunctionTypes. The hook
is in place before `register_builtin_macros` runs: rustc_builtin_macros value-imports lib.ts, and the cast call is
inside the function, not at module top level.

## Findings

- **F1 (non-blocking, init order / TDZ; new in this commit).** lib.ts:462 now touches a client.ts binding
  (`crate_TokenStream`) at module top level. There is an existing value-import cycle:
  client.ts → bridge/mod.ts → diagnostic.ts (`import { BridgeMethods, debug_Span } from "./lib.ts"`) → lib.ts.
  If anything loads `bridge/server.ts` before lib.ts, lib.ts's body runs before client.ts's body:
  `bun -e "await import('./src/proc_macro/bridge/server.ts')"` → `ReferenceError: Cannot access
  'crate_TokenStream' before initialization` at lib.ts:462. At the parent commit this load order was fine.
  - Loading client.ts or symbol.ts first already crashed at the parent (server.ts:666 `Client` TDZ). That comes from
    pm-bridge, not this commit.
  - Every real entry point loads cleanly: rustc_builtin_macros/lib.ts, rustc_expand/{lib,proc_macro,
    proc_macro_server}.ts, rustc_interface/lib.ts, rustc_driver_impl/lib.ts, proc_macro/{lib,diagnostic}.ts,
    bridge/mod.ts.
  - It is still fragile. rustc_builtin_macros/lib.ts:26-27 imports `Client` from client.ts *before* lib.ts, and works
    only because line 15 (`rustc_expand/lib.ts`) loads proc_macro/lib.ts first. rustc_expand/proc_macro.ts:25-27
    value-imports panic_message.ts and server.ts before lib.ts, and works only because panic_message.ts → mod.ts →
    diagnostic.ts reaches lib.ts first.
  - Suggested follow-up (separate item, owner of those files): have diagnostic.ts import `Methods` / `debug_Span`
    from `./bridge/client.ts` directly, which breaks the mod → diagnostic → lib edge. Or at least put
    `import "../proc_macro/lib.ts"` before the client.ts import in rustc_builtin_macros/lib.ts.
- **N1 (nit).** quote.test.ts:12 still says the mock stands in for "the `PORT(contract)` block in lib.ts", which this
  commit deleted. The mock now `Object.assign`s over client.ts's real `Methods` / `Span` / `Symbol` and restores them
  in `afterAll` (pm-lib handoff step 4). That works (tests pass), but the comment is stale.
- **N2 (nit).** lib.ts:71 keeps the side-effect `import "./bridge/client.ts";` next to the new named import from the
  same module. It is redundant but harmless (PORTING §5 style). Optional cleanup.

## Handoff items checked

pm-lib "At merge" 1–4: done (step 4: the mock's `Object.assign` works on pm-bridge's plain, non-frozen objects).
pm-bridge Integration 1–4: done. pm-lib review N1 (cast) and N2 (re-exports): done. pm-bridge review N3 (same merge
for `default_TokenStream`): done. pm-lib's "rerun the 30 cases before accepting": root reports 330/330; I
spot-checked 10 case-instances, all MATCH. Still open from the handoffs and not part of this commit: the coverage.ts
`// std:` harness request (separate harness batch), and the `-Zproc-macro-backtrace` / dylib (pm-host, D7) unported
paths.
