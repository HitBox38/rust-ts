# Handoff: fmt-perf (wave 7, std performance)

Branch `lane/fmt-perf`. Goal: make `{:#?}` formatting linear in the output size with byte-identical output.

## Diagnosis (measured first)

- CPU profile of `-Zunpretty=ast-tree` on a 200-deep `f(f(...))` call chain: `pad` (in `src/std/fmt.ts`) took 6.1 s of 7.8 s.
  Nothing else came close. `splitn` (rustc_ast/attr/version.ts, 0.84 s) and `is_reserved` (0.47 s) appear in the
  profile too; they are not part of this lane but are worth a look.
- Time per doubling of depth was about 7x: 100 → 1.4 s, 200 → 6 s, 400 → 42 s. That is cubic, against quadratic
  output (100 → 2 MB, 400 → 29 MB). The cost was O(depth × output), because every nesting level re-scanned and copied its whole subtree.

## Design (in the `src/std/fmt.ts` header, `// PORT:`)

- `export function format_debug<T>(v, inner: Debug<T>, f: Fmt): string` is the `format!("{:?}")` / `format!("{:#?}")`
  entry point. With `f.alternate` it formats under a private `PRETTY_DEFERRED` Fmt (`deferred_pad: true`). It then
  resolves the indentation in one pass (`resolve_pad`), which is linear.
- Under `deferred_pad`, `pad(child)` becomes `PAD_OPEN + child + PAD_CLOSE` (an O(1) rope concat) instead of
  `replaceAll("\n", "\n    ")`. `resolve_pad` writes `4 * open scopes` spaces after every `\n`. This is identical to nested
  eager pads: the spaces each level adds commute.
- The markers are lone low surrogates (U+DFFE/U+DFFF), which no Rust `&str` can contain. They are matched by a `u`-flag regex, so
  paired surrogates (non-BMP chars) are never mistaken for markers.
- Eager padding mixes correctly into a deferred tree. This covers a subtree formatted with plain `PRETTY`, and a
  hand-written Debug that pads itself, such as `debug_struct_finish_non_exhaustive` in `rustc_parse/parser/mod.ts`.
- Plain `PRETTY` / `PLAIN` behaviour is unchanged. Every existing `debug_*(v, PRETTY)` call site and test still gets eager,
  marker-free strings. No generated file changed, and no call site other than the sink below changed.

## Files touched

- `src/std/fmt.ts`: header doc, `Fmt.deferred_pad`, `PRETTY_DEFERRED`, `PAD_OPEN/CLOSE`, `pad(s, f)`, `indent`,
  `resolve_pad`, `format_debug`. The builders call `pad(v, f)`.
- `src/rustc_driver_impl/pretty.ts` (**outside lane ownership, a one-line sink change, needs root review**). `AstTree` now calls
  `format_debug(krate, debug_Crate, PRETTY)`, mirroring upstream `format!("{krate:#?}")` (pretty.rs:265). Without it
  the fix has no effect.
- `src/std/fmt.test.ts`:
  - Equivalence test: 300 random trees over every builder, plus eager subtrees, hand-padded children, empty and
    multi-line keys and non-BMP text. `format_debug(.., PRETTY)` must equal `inner(.., PRETTY)` and the same for PLAIN.
  - Scaling test: an `S(T { x: .. })` chain at depth 250 vs 2000, one timed run each after a warm-up. The per-output-byte
    time ratio must be < 3. Measured 0.36–0.77. Against the old eager pad the same test fails (about 8x, 54 s).

No `unported(...)` added. No rustc markers added (coverage `--check`: markers ok).

## Verification

- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 2001 pass, 1 skip, 0 fail.
- `RUST_TS_AGENT=fmt-perf` difftest samples:
  - parse `--sample 2000`: 2000/2000 MATCH
  - emit `--sample 500`: 500/500 MATCH
  - tokens `--sample 500`: 500/500 MATCH
- Oracle byte-identity on deep cases, run by hand with no timeout: all MATCH.

  | Case | Output size |
  |---|---|
  | `S<S<..>>` ×50 | 1.7 MB |
  | `S<S<..>>` ×100 | 6.6 MB |
  | `f(f(..))` ×100 | 2 MB |
  | `else if` ×250 | 31 MB |

  `f(f(..))` ×200 and ×400 are byte-identical to the pre-change output.

## Timings (`-Zunpretty=ast-tree`, machine under heavy load from other lanes)

| case | before | after | output |
|---|---|---|---|
| `f(f(..))` ×400 | 44.4 s | 0.96 s | 29 MB |
| `f(f(..))` ×800 | (cubic, minutes) | 1.93 s | 113 MB |
| `else if` ×1000 | – | 7.5 s | 486 MB |
| tests/ui/associated-consts/issue-93775.rs | > 25 min (killed) | 2.7 s | 640 MB |
| tests/ui/parser/survive-peano-lesson-queue.rs | > 180 s (killed) | 8.7 s | 1.41 GB |
| tests/ui/expr/if/expr-stack-overflow.rs | > 5 min (killed) | ICE at 10.6 s (`RangeError: Out of memory`) | ~13 GB (est.) |
| typical (closure-expected-type/expect-region-supply-region.rs, best of 3) | 0.70 s | 0.77 s (noise) | – |
| typical (parser/issues/issue-14303-fncall.rs) | 0.65 s | 0.60 s | – |

## The 3 former timeouts cannot MATCH: the oracle itself times out

`--filter` difftests after the change:

| File | Status | Oracle | Subject |
|---|---|---|---|
| issue-93775.rs | DIFF | killed at 60 s (exit 143) | exit 0 |
| survive-peano-lesson-queue.rs | DIFF | killed at 60 s (exit 143) | exit 0 |
| expr-stack-overflow.rs | CRASH | killed at 60 s (exit 143) | exit 101, OOM |

The gate run gate-20261013-012502 already showed exit 143 for **both** oracle and subject on these files. rustc's own
`PadAdapter` is also O(depth) per write: the oracle took 147 s for `S<S<..>>` ×200 (26 MB), and issue-93775 has 964 levels
(640 MB). The oracle result is not cached on timeout, so these cases stay non-MATCH whatever the subject does. Unless
root decides otherwise, they should stay out of the protected set (or be excluded as oracle timeouts).

expr-stack-overflow (5204 nested `else if`) changed from TIMEOUT to CRASH. Its output (~13 GB) is above JSC's maximum string
length. A fix would need streaming output: a `format_debug` writer variant plus a chunked `write_or_print`, and
upstream's `format!` builds one String. It could not match in 60 s anyway.

## PORT decisions

1. `{:#?}` indentation is deferred via scope markers under `format_debug` (fmt.ts header). Eager `pad` is kept for
   direct `PRETTY` calls.
2. `format_debug(v, inner, f)` stands for `format!("{:?}"/"{:#?}", v)`. New sinks that format whole trees should use it.
