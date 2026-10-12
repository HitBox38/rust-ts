# Handoff: harness-w2 (symbols + escape-synthetic suites)

## Files touched
- `tools/probes/symdump/{Cargo.toml.in,build.rs,main.rs}`: new probe linking upstream `compiler/rustc_span`
  (path dep, nightly). `build.rs` parses the `Keywords {}` / `Symbols {}` blocks of upstream `symbol.rs`
  for constant **names** only and emits `(name, kw::Name)` / `(name, sym::Name)` tables; every value comes
  from the compiled crate (a misparsed name would not compile). Section list/format: header of `main.rs`.
- `src/rust_ts/symdump.ts`: subject side (same sections/format; exit 70 on `Unported`, 101 on panic,
  like `main.ts`).
- `scripts/probes.ts` (**outside my listed files, needs review**): per-probe build env `PROBE_ENV`, only
  for `symdump`: `RUSTC_BOOTSTRAP=1` (rustc_macros' build script refuses to build without it) and
  `CFG_RELEASE=<UPSTREAM.json release>` (needed by `symbols!` for `sym::env_CFG_RELEASE`). Other probes
  build with exactly the env they had before.
- `scripts/difftest.ts`: optional `Suite.cwd` (default UPSTREAM, so existing suites unchanged);
  `Case.file === ""` = synthetic case without input (file hash `""` in the cache key);
  `oracleVersion` cache is now per suite. **Bug fixed:** it was one global value, so in `gate.ts run`
  (several suites in one process) every suite after the first keyed its oracle cache on the *first*
  suite's probe binary (e.g. `escape` on lexdump's hash), and rebuilding the escapes probe did not
  invalidate the `escape` cache. Results are unchanged; the `escape` cache misses once.
- `harness/suites.ts`: `Suite.cwd?`, doc for `Case.file`; **appended** suites `symbols` and
  `escape-synthetic` (existing entries untouched).
- `harness/corpus/gen-escape.ts` + `harness/corpus/escape-synthetic/*.rs` (11 generated files, committed),
  `harness/corpus/.gitattributes` (`-text`: the files contain bare CR, CRLF, NUL on purpose).

## symbols suite (1 case, id `symbols`, args = section list)
Sections in the suite now: `count kw sym letters predicates` (no session globals needed).
Gated (in `SYMBOL_SECTIONS` comment in suites.ts): `predefined integer character editions ident`. On
main they hit `unported` (`Interner::with_extra_symbols` via `SessionGlobals::new`; `Edition: PartialOrd`).
Pre-check against the span-wire lane tree (9482342, read-only, by rewriting the imports of a temp copy):
**all 10 sections MATCH** (7523 lines), so root can append the 5 sections after span-wire merges
(case id unchanged; the cache key includes args).

## escape-synthetic suite (11 cases, cwd = repo)
Probe output over the corpus: every `Mode` (Char 107, Byte 100, Str 140, ByteStr 138, CStr 137,
RawStr 22, RawByteStr 21, RawCStr 21 literals) and 22/23 `EscapeError` variants (count of `E` lines):
BareCarriageReturn 20, BareCarriageReturnInRawString 22, EmptyUnicodeEscape 8, EscapeOnlyChar 12,
InvalidCharInHexEscape 15, InvalidCharInUnicodeEscape 30, InvalidEscape 52, LeadingUnderscoreUnicodeEscape 11,
LoneSurrogateUnicodeEscape 16, MoreThanOneChar 9, MultipleSkippedLinesWarning 16, NoBraceInUnicodeEscape 10,
NonAsciiCharInByte 39, NulInCStr 16, OutOfRangeHexEscape 10, OutOfRangeUnicodeEscape 7,
OverlongUnicodeEscape 20, TooShortHexEscape 15, UnclosedUnicodeEscape 10, UnicodeEscapeInByte 53,
UnskippedWhitespaceWarning 24, ZeroChars 3.
**LoneSlash: 0, unreachable from lexed source**: rustc_lexer always consumes the character after a `\`
inside quotes, so a terminated literal's content never ends in a lone `\`. Proposal (needs
`src/rust_ts/escapedump.ts`, not mine, and touched by span-wire's renames): a direct-input mode in both
probe and subject (e.g. `*.lits` files, one `<Mode> <content>` per line) to feed raw contents.

## Results
- `symbols` full: 1/1 MATCH (run hw2-symbols). `escape-synthetic` full: 11/11 MATCH (run hw2-escsyn).
  No port bugs found.
- `lex --sample 300` and `escape --sample 300`: 300/300 MATCH each (runs hw2-lex300, hw2-esc300).
  Case lists of lex/escape/parse (full and seed-harness-w2 sample of 300) hash-identical to HEAD's.
- `bunx tsc --noEmit -p .`: clean.

## Notes for root
- Build: `bun scripts/probes.ts build symdump` (~20 s with a warm target dir). No Cargo.lock is shipped;
  registry deps of rustc_span resolve to whatever cargo picks (they don't affect the symbol table).
- Regenerate the corpus with `bun harness/corpus/gen-escape.ts` (deterministic; `git diff` should be empty).
- New suites have no baseline yet; the gate only protects them after an `accept`.
