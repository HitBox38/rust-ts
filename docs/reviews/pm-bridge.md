# Review: pm-bridge (wave 35, M6 D7/D8)

Reviewer: independent, read-only. Batch: `b0008692..f7af3b24` (branch `t3/b7f5e303`, worktree branch name
`t3/proc-macro-bridge-port`). Upstream: `library/proc_macro/src/bridge/*` at the pin.

## Verdict: **APPROVE WITH NITS**

I found no blocking findings. The wire format matches upstream byte for byte in every codec I traced. I also ran
the marker cross-check myself, and it agrees with the handoff's 175/175. The nits below are non-blocking. Two of
them (N1, N2) are root actions, not lane fixes.

## Results (run by the reviewer, `RUST_TS_AGENT=pm-bridge-review`)

- `bunx tsc --noEmit -p .`: clean (exit 0).
- `bun scripts/coverage.ts --check --offline`: `markers ok (23169; vendor 4680)`.
- `bun test src/proc_macro src/rustc_expand`: 267 pass, 0 fail.
- `bun scripts/difftest.ts --suite expanded --sample 100`: MATCH=100 DIFF=0 UNPORTED=0 CRASH=0, skipped=3. Run
  `20261031-225105-pm-bridge-review-u50b`.
- Independent marker check: I matched every `// std:` / `// std-skip:` marker against the upstream line, which
  must contain `fn <name>`. I also listed every upstream `fn` in the 12 bridge files and checked that each one has a
  marker. Result: 175 distinct markers, 0 mismatches, 0 unmarked fns. This includes the 31 `with_api!` lines.

## 1. Wire format fidelity (checked against upstream)

- **`with_api!`**: 31 methods, in the same order as mod.rs:36–79. `ApiTags_variants` (mod.ts:101) and the `ApiTags`
  union match upstream index for index: track_env_var=0 … emit_diagnostic=3, ts_drop=4 … ts_into_trees=13,
  span_debug=14 … span_recover_proc_macro_span=29, symbol_normalize_and_validate_ident=30.
  - Each `Methods` fn (client.ts:195–396) encodes its arguments in signature order with the right by-value / by-ref
    codec.
  - Each `Dispatcher.dispatch` arm (server.ts:245–484) decodes in the same order:
    - `&$TokenStream` uses `decode_ref_MarkedTokenStream` (index); owned uses `take`;
    - `ts_drop` / `ts_into_trees` take ownership;
    - return types match.
- **Enum tags** (`rpc_encode_decode!` enum arm: a `#[repr(u8)]` variant index), all matching upstream:
  - Delimiter: Parenthesis, Brace, Bracket, None.
  - Level: Error, Warning, Note, Help.
  - LitKind: 0–10, with a `u8` payload for StrRaw / ByteStrRaw / CStrRaw.
  - Bound: Included, Excluded, Unbounded.
  - Option: **Some=0, None=1**.
  - Result: Ok=0, Err=1.
  - IdentKind: Normal, Raw, ForcedKeyword.
  - TokenTree: Group, Punct, Ident, Literal.
- **Struct field order** matches the `compound_traits!` / `rpc_encode_decode!` field lists:
  - DelimSpan(open, close, entire);
  - Group(delimiter, Option stream, span);
  - Punct(ch u8, joint bool, span);
  - Ident(sym, kind, span);
  - Literal(kind, symbol, Option suffix, span);
  - Diagnostic(level, message, Vec spans, Vec children);
  - ExpnGlobals(def_site, call_site, mixed_site);
  - Range(start, end).
- **Integer widths**:
  - u8 is 1 byte.
  - u32 is 4 bytes LE.
  - usize is 8 bytes LE, as upstream's `cfg(target_pointer_width = "64")` `le usize` arm. Decoding a value ≥ 2^53
    panics instead of silently losing precision.
  - bool is a u8 0/1, with `unreachable!` otherwise.
  - `NonZero<u32>` is u32 + `unwrap`.
  - `&str` / `String` are a usize byte length + UTF-8, with `from_utf8().unwrap()`.
  - `Vec` is a usize length + elements.
  - `(A, B)` is left to right.
- **Handles**:
  - Client `TokenStream` / `Span` encode as `NonZero<u32>`.
  - The server's `OwnedStore` / `InternedStore` and their counters behave as upstream:
    - process-wide `TOKEN_STREAM` / `SPAN` start at 1;
    - `fetch_add` wraps at 2^32, and the following `alloc` panics `` `proc_macro` handle counter overflowed ``;
    - the insert assertion and the use-after-free texts match.
- **Symbols** cross as strings on both sides: client `Symbol.with` → `&str`, server `intern_symbol` /
  `with_symbol_string`, as symbol.rs:97–119.
- **PanicMessage** crosses as `Option<&str>` and decodes as `String` / `Unknown`.
- **`run_server` / `run_client` asymmetry is correct**:
  - Input: the server sends a bare `MarkedTokenStream` handle (no Option tag), and the client's
    `Decode for crate::TokenStream` wraps it in `Some`.
  - Output: the client encodes `crate::TokenStream`'s `Option`, and the server decodes `Option<MarkedTokenStream>`.
  - `run2`'s input is a tuple of two handles.
- **Buffer**: the layout fields are `data` / `len` / `capacity` / `reserve` / `drop`. The growth paths
  (`extend_from_array`, `extend_from_slice`, `push`) go through the owner's `reserve`, as upstream. `take` leaves a
  default buffer. The default `reserve` follows RawVec `grow_amortized` at the pin (raw_vec/mod.rs:540–545):
  `max(cap*2, len+additional, 8)`.

## 2. Order, names, markers

- Markers are complete and correct (see Results above). Function order follows upstream file by file, with two
  minor exceptions (N4).
- The `// std:` convention comes from the 2026-10-13 decision (history.jsonl line 97, expand-pm-types).

## 3. `unported(...)` left

All five are accurate:

- **Genuine non-goals**:
  1. cross-thread / nested execution;
  2. `MessagePipe` (unreachable while (1) stands);
  5. printing a proc-macro panic under `-Zproc-macro-backtrace`.
- **Integration hooks, accurately described**:
  3. `default_TokenStream` missing on the server class;
  4. `crate_TokenStream.new_` not installed.

I found no guessed behaviour. `catch_unwind` propagates JS `Error`s other than `Panic`, so an `Unported` thrown
inside a server method surfaces instead of becoming a `PanicMessage`. `FatalErrorMarker` (not an `Error`) becomes
`PanicMessage::Unknown`, as in rustc.

## 4. Tests

The expected bytes in `bridge.test.ts` are hand-derived from the rules above: tags as indices, LE widths, the
8-byte usize, the length-prefixed UTF-8 `"aé"` = `[3,0..0,0x61,0xc3,0xa9]`, and the RawVec growth 0→8→16→49. They
are not captured from TS output. I re-derived the ApiTags indices, the TokenTree byte layout and the Option/Result
tags independently, and they agree.

## Findings

- **N1 (non-blocking, root decision)**: `// std-skip:` is a new marker form, used at rpc.ts:97–98 and
  fxhash.ts:88 for the `cfg(not(target_pointer_width = "64"))` / `cfg(target_pointer_width = "32")` arms.
  - PORTING.md:44 says "Do not skip anything else without a recorded root decision", so root should record one.
  - Recommended: accept `// std-skip:` as the `library/` analogue of `// rustc-skip:` for cfg arms that no host
    compiles (all hosts are 64-bit LE).
  - The skips themselves are justified: the 64-bit `le usize` arm is ported, and the 32-bit arm would only change
    usize decoding on a 32-bit host.
- **N2 (non-blocking, harness batch)**: `scripts/coverage.ts --missing` only reads `// rustc:`, so library/
  coverage reports 0/N. The lane's request (count `// std:` / `// std-skip:` for `library/` paths) belongs in its
  own reviewed harness batch (AGENTS.md §2). I verified the 175/175 independently in the meantime.
- **N3 (non-blocking, integration)**:
  - server.ts:658, unported (3), will fire on an ordinary path once `quote!` (or a dylib) is wired: any proc macro
    that returns an empty `TokenStream(None)`, e.g. `quote!()`. Integration step 2 in the handoff (add
    `static default_TokenStream()` to `Rustc`, rustc_ast tokenstream.ts:858) must land **in the same merge** as
    step 3 (`quote_client`).
  - Likewise, client.ts:107, unported (4), needs pm-lib's `crate_TokenStream.new_` hook.
- **N4 (non-blocking, order nit)**: in client.ts, three items sit out of upstream order because they are grouped
  into classes:
  - `TokenStream.clone` (client.rs:85) sits before the codecs;
  - `Bridge.with` (client.rs:198) sits before `mod state` (client.rs:156);
  - `Client.expand1` / `expand2` (client.rs:282/290) sit before `maybe_install_panic_hook` / `run_client`
    (client.rs:225/245).

  This is acceptable as class grouping; no change needed.
- **N5 (non-blocking, nit)**: mod.ts:796, `encode_tag`, would encode an unknown variant as `255`, because
  `indexOf` returns -1. Upstream cannot reach this (exhaustive match). A `variants.indexOf(self)` result of -1
  should be `unreachable()`, for parity with `decode_tag`. It is unreachable with well-typed callers.
- **N6 (non-blocking, nit)**: client.ts:575 covers only the `force_show_panics` branch of the upstream hook
  condition `force_show_panics || !is_available() || !info.can_unwind()`. A TS-client panic outside the bridge (for
  example, malformed input bytes while decoding before `state.set`) is silently hidden. Upstream would print it.
  This is practically unreachable for TS clients. If it is ever kept, mention the `!is_available()` arm in the
  unported (5) message.
- **N7 (note for pm-host)**: the wire format is verified only TS↔TS. As the handoff says, the first pm-host test
  must be an oracle-built echo proc macro, with the native-backed `Buffer` / `Closure` adapters the handoff
  describes (handoff "What `pm-host` needs").
