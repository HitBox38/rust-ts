ACCEPT

Review of `lane/harness-w2` @ 0fd719d (merge base b12ea7b), reviewer `review-hw2`.

## Checks performed

1. **No weakening.**
   - `scripts/difftest.ts`: the MATCH rule (`text` and `code` both equal, line 161) is unchanged. `cwdOf(s)` defaults
     to UPSTREAM, so lex/parse/escape run exactly as before. `file === ""` only skips hashing an input file. The
     only suite that uses it (`symbols`, single mode) has no input, and its output depends only on the probe
     binary and args, both of which are in the key.
   - `harness/suites.ts`: the diff only adds code (an optional `cwd`, a doc comment and two `SUITES.push` entries).
     I hashed `JSON.stringify(cases())` per suite in the lane and in root's `rust-ts/main`:
     lex 25780 `a8a356bd10b8a7b6`, parse 21526 `b244fb01ad2573be`, escape 25780 `a8a356bd10b8a7b6` are
     identical in both trees.
   - `scripts/probes.ts`: `PROBE_ENV` applies only to `symdump`. Other probes keep their old build env.
2. **Cache-key fix is correct.** The key is `[PIN.commit, probe-binary hash, suite, id, args, input hash]`. The
   probe hash is now memoized per suite name instead of process-wide. The old global value was a real bug: in
   `gate.ts run`, `escape` was keyed on lexdump's hash, so a rebuilt escapes probe could serve stale results.
   escape-synthetic hashes its corpus files under `cwd = REPO`, so regenerating the corpus invalidates the cache.
   I found no path where this change serves stale results.
3. **symdump is independent of the TS side.** Every index and value comes from the compiled `rustc_span`. build.rs
   only parses constant names, and a misparsed name fails to compile. The subject enumerates its own `kw`/`sym`
   objects and does not use the probe's name list, so a missing name on either side shows up as a DIFF. Parse
   completeness: the kw+sym indices cover 0..2370 with no gaps (every declared entry), plus the aliases
   C/f/d/macro_rules. Indices 2371..2433 are the prefilled digits and letters plus `env_CFG_RELEASE`.
4. **Corpus.** I copied `gen-escape.ts` to a temp dir on D: and ran it there. The 11 output files are byte-identical
   to the worktree, and their `git hash-object` equals the HEAD blobs. The `-text` attribute applies
   (`git check-attr`, `ls-files --eol`) even with `core.autocrlf=true`. I counted coverage from the probe output
   and it matches the handoff exactly: all 8 Modes, and 22 of 23 `EscapeError` variants. The missing one is
   `LoneSlash`, which only comes from content ending in an unpaired `\` (escaper lib.rs:330). rustc_lexer always
   consumes the character after `\` inside quotes, so lexed source cannot reach it.
5. **Re-runs** (`RUST_TS_AGENT=review-hw2`):
   - symbols: 1/1 MATCH
   - escape-synthetic: 11/11 MATCH
   - lex --sample 300: 300/300 MATCH
   - Test merge with current `rust-ts/main` (the span-wire rename): clean, `tsc --noEmit` clean, symbols 1/1 MATCH.
     All 10 sections (including the gated five) are byte-identical, 7523 lines.

## Findings

- **low**, `scripts/probes.ts:22`: `CFG_RELEASE` comes from `UPSTREAM.json` `release`. The TS side
  (`src/rustc_span/symbol.gen.ts:4827`) hardcodes the same string, so this one value is a shared input, not an
  oracle-derived one.
  Failure scenario: someone bumps the pin and edits `release` wrongly. The probe and the subject then agree on the
  wrong `sym::env_CFG_RELEASE` text.
  Today it is correct: it equals `rustc +nightly -vV` `release: 1.101.0-nightly`. It also only shows in the gated
  `predefined` section. Suggestion: have `probes.ts build` (or the gate) check `PIN.release` against
  `rustc +<toolchain> -vV`.
- **low**, `harness/suites.ts:130`: `symbols` is one coarse case. Once it is protected, adding the five gated
  sections changes what is protected under the same id. A regression in any section loses the whole case, and the
  sections can only be added in a run where all of them pass. This does not weaken anything. Consider one case per
  section when they are appended.
- **low**, `tools/probes/symdump/main.rs:97`: `Symbol::is_predefined(i)` is evaluated only for `i < COUNT`, so that
  column is always `1` and never exercises the false branch. Not a weakening, just coverage that adds nothing.
- **info**, `scripts/difftest.ts:66`: after merge, the first gate run will miss the whole `escape` oracle cache
  (25780 cases) because the key switches from lexdump's hash to the escapes probe's hash. This is correct and
  expected. If that run shows escape losses, they come from the old stale-cache bug, not from this batch.
  Investigate them; do not blame this change.
- **info, not introduced by this batch**, `scripts/lib/oracle.ts:22`: `parse` runs `rustc +nightly`. `cmd0` is
  `"rustc"`, which is not a path, so the parse cache is keyed only on `PIN.commit`. A `rustup update nightly`
  would not invalidate it. Worth a separate harness batch.
