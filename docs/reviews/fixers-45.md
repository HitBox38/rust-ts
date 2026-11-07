APPROVE WITH NITS: the `RUSTC_LOG` change cannot reach a protected case, every converted site I checked matches upstream, and both new MATCHes are byte-stable. The nits are one remaining gap behind F2's fix (it is on `main` too, but the new comment overstates what the fix covers), a Linux-only case of the same kind, two checker blind spots to close before the checker joins the gate, and a sensitivity note for protecting `rust-log.rs`.

# Independent review: fixers-45

Branch `t3/33c56b8b`, head `eff41b07`, against `main` `26e61959`. Commits `bd538a1d`, `572f4f39`, `e043c959`, `111c910e` and the handoff.
Host: root host, AC power, load 2 to 26 (other lanes and my samples). `RUST_TS_REQUIRE_PROBES=1`, `RUST_TS_AGENT=review-fixers-45`, `RUSTUP_AUTO_INSTALL=0`.
No gate, no full suite. Scratch checkouts of `main` and the head sat side by side under my scratchpad, at paths of equal length, and an `integ-w42` checkout held the trial merge (§5). None was committed.

| # | Severity | Where | Failing scenario | Status |
|---|---|---|---|---|
| F1 | low, for root's queue (on `main` too) | `src/std/path.ts:770-793` `host_canonicalize` | In a cwd of 1,012 bytes, with `link` → a short directory, `fs::canonicalize("link/liblib-a.rmeta")` succeeds in Rust (`<S>/dup/liblib-a.rmeta`). The port joins the cwd first (1,032 bytes) and fails with `ENAMETOOLONG`, so `try_canonicalize` falls back to `absolute`. `realpath(3)` needs only the *relative* input to fit `PATH_MAX`. The comment's "in such a cwd both sides then fail" holds only for a cwd of 1,024 bytes or more | reproduced (a host program built with the oracle toolchain, against head's `host_canonicalize`) |
| F2 | low, Linux only | `src/std/path.ts:784` | `host_canonicalize` joins the relative path to the lossy `current_dir_str()`. In a non-UTF-8 cwd `a\xffb` with a `a\u{FFFD}b` twin, it canonicalizes into the twin. That is the fixers-43 F6 hazard by another route | read only (APFS refuses such names) |
| F3 | nit, for the protect decision | `rustc-env/rust-log.rs` (run-pass-aux-miri) | Its 19,872 lines include `Pre-codegen`/`Post-codegen` interner counts for the whole run (1,580 types, 505 GenericArgs, 653 regions, 93 const allocations, 153 layouts) and 15,285 Miri `step` lines. Any later change in what the port interns, or how many statements Miri steps, makes it a loss, even where no other output changes | reproduced as deterministic (below) |
| F4 | nit, before the checker joins the gate | `src/rust_ts/info_sites_check.ts:63`, `:70`, `:166` | A site whose enclosing fn the scanner cannot find (a module-level `macro_rules!` body) gets key `<file>:0`. A marker the scanner places on a different line from the port's misses the same way. Both are counted under "not ported" and never fail. Today no site has line 0, and the 18 "not ported" fns are genuinely absent (I grepped 9 of them), but a future site would be silent | read; the current state checked |
| F5 | observation, not this lane | `rustc_metadata/locator.ts` (E0464 candidate choice) | `-L link -L <the same dir by its real path>` with `liblib-a.rmeta` and `liblib-b.rmeta`: the oracle lists `<dir>/liblib-a.rmeta` and `link/liblib-b.rmeta`; the port lists both from one directory, in a short cwd, on `main` and head alike | reproduced |

**F1 and F2 have one fix:** call libc `realpath(3)` on the path's bytes through `env.ts`'s existing `bun:ffi` handle, instead of joining and calling `realpathSync.native`. It resolves against the process cwd, as upstream does, and needs no join and no lossy cwd. Until then, the comment should say what it covers.

## 1. `RUSTC_LOG`: no protected case can see it

**Protected cases that set a log variable.** I loaded every suite of `harness/baseline/*.txt`, plus `run-pass-aux-miri`, and listed each case whose `env`, `run.env` (exec-env) or args name `*LOG*`, `*TRACING*` or `*BACKTRACE*` other than `RUST_BACKTRACE`.
- Only `run-pass-miri`'s `threads-sendsync/spawning-with-debug.rs` (`-Zmiri-env-set=RUST_LOG=debug`) is protected. That is the interpreted program's variable, not rustc's.
- The other hits are all unprotected: `log-backtrace.rs` and `def-path-hash-ice-157238.rs` in `run-pass-miri`, `mir-o2` and `mono-ui`, and `rust-log.rs` in `run-pass-aux-miri`.
- `crate-loading/invalid-rlib.rs` (`rustc-env:RUSTC_LOG=error`) is protected only in suites that carry no compiletest env.
- `SCRUBBED_ENV_PREFIXES` removes an inherited `RUSTC_LOG*`, and `MIRI_CASE_ENV` sets `MIRI_LOG` to null.

On head, `spawning-with-debug.rs` and `issue-73431.rs` (`unset-rustc-env:RUSTC_LOG_COLOR`) both MATCH in `run-pass-miri`, `mir-o2` and `mono-ui`, which is 6 of 6.

**Can a protected case now print an extra or missing line?** Not through logging. With `RUSTC_LOG` unset, `MAX_LEVEL` is WARN:
- `event` and `info_unconverted` return before touching a closure;
- `instrument` runs `body()` directly (`tracing.ts:324`).

What remains is the refactors that wrap 28 fn bodies in `() => {..}`, and I read them with whitespace ignored (`git diff -w`). Each body is unchanged, wrapped as a whole, and returns the closure's value; arrow functions keep `this`. The samples below agree.

**The checker's count is sound today.** Independent greps of upstream `compiler/` and Miri's `src/` (tests excluded):
- 107 `info!`/`info_span!` lines, 27 `#[instrument]`s with no level, and 2 with `level = "info"`. That makes 136, the checker's figure.
- No `Level::INFO`, `event!(target: ..)` or `span!(target: ..)` forms; the one `tracing::span!(` is DEBUG.
- No `cfg_attr(.., instrument)`, no `ret(level = ..)`, and no `err` option (every `err` in an attribute is `skip(.., err)`).
- All 9 multi-line `#[instrument(` attributes are DEBUG or TRACE.
- No `log`→`tracing` bridge: `rustc_log` builds `tracing-subscriber` with no default features, so there is no `tracing-log`. Outside the scanned roots, only `thorin-dwp` uses `tracing`, and only for codegen.
- In the port, `tracing.(info|info_span|instrument|info_unconverted)(` occurs exactly 83 times outside `rust_ts/`. The checker counts 83 sites in ported fns, so there is no slack for one call to cover another fn's site.
- Closures are attributed to their outer fn by indentation, and nested fns to themselves (`link.rs` `for_each`, `has_lnk_code`). F4 covers what the method cannot see.

**Spot checks against upstream.** All 28 ported `#[instrument]`s:
- field names and order are the non-skipped params;
- `should_rerun_after_erased_canonicalization`'s destructured param gives `rerun`, as tracing-attributes collects pattern idents;
- the `bool`/`usize` params (`forwards`, `is_local`, `include_placeholder_static`, `depth`) print as values, the same as their Debug;
- `ret` sits on `coerce`, `clause_obligations`, `consider_opaque_type_use`, `constraint_path_to` and `should_rerun_…`, as upstream.

Message text and arguments match for all of creader's 15 sites, locator (`lib candidate`, `{flavor} reading metadata from`, `Rejecting via …`, `no metadata found`), `dependency_format` (`adding {:?}: {}`), `ProjectionCache::complete` (`ignoring` prints the `Option<&Entry>`), `couldn't find line`, `peek_at` (message, then `place`), `effective_visibilities` (`{:#?}`), `unimplemented_traits.len()`, `Using method span`, lto, and `Pre-codegen`/`Post-codegen` (in `start_codegen`, around `encode_and_write_metadata` and `codegen_crate`, as upstream `passes.rs:1321` and `:1354`).

## 2. `TyCtxt::debug_stats`

**Line by line against `context.rs:1772-1880`: faithful.**
- It skips Bool, Char, Int, Uint, Float, Str, Never and Error.
- It uses the same three `intersects` tests, and the counters update in upstream's order.
- The header line is the same.
- `{:18}` is `padEnd(18)`, `{uses:6}` is `padStart(6)`, and `{:4.1}`/`{:5.1}` are `padStart` of `f64_fixed1`.
- The variant list is upstream's 21, in order, and the four trailing interner lines match.
- An unlisted kind is `unreachable` (upstream would not compile).
- `ShardedHashMap.keys()` walks `table`, `hashed` and `collided`, the same three that `len()` counts.
- `f64_fixed1` rounds the exact binary value half to even, as `{:.1}` does.

**No cost when logging is off.** The stats are built only inside the `info!` closure, and `keys()` has no other caller.

Instructions retired, alternating `main` and head from equal-length scratch paths, std hello `--emit=metadata` (11 runs each):

| Side | Median | Range |
|---|---|---|
| `main` | 10.636 G | 10.586-10.782 |
| head | 10.627 G | 10.523-10.679 |

`traits/monad.rs` `-Zunpretty=mir`, where the wrapped `coerce`, `project` and `normalize_with_depth_to` are hot (7 runs each): `main` 20.046 G (19.856-20.563), head 19.957 G (19.874-20.371). Both differences are inside the noise.

## 3. `rust-log.rs` and `def-path-hash-ice-157238.rs`

- `difftest --filter` gave MATCH three times out of three for each.
- I then ran each oracle and each subject three times myself, outside the cache:
  - `rust-log.rs`: the oracle's 3 stderrs are identical (`cebeeab41458`, 19,873 lines), the subject's 3 are identical, and oracle and subject are equal.
  - `def-path-hash` (`mir-o2`): stdout `e0468968c51d` and stderr `2be1cc8130c3` (541 lines), the same on all 6 runs.
- Nothing in either output is iterated from a hash map. The interner stats only count, and locator candidates come from sorted search-path listings.
- No thread ids (`RUSTC_LOG_THREAD_IDS` is unset), no times, no addresses.
- Both outputs carry host paths: the oracle sysroot, `$RUST_TS_DATA/miri-sysroot`, and the aux dir `aux/ui/95a34ae153370edb`. These are the same on both sides, as in other cases.

**Fragility (F3).** `def-path-hash` is mostly creader and locator lines plus a few instrument spans, so it is robust. `rust-log.rs` is a whole-pipeline canary (F3). I would still protect it: the output is real and deterministic. But root's decision should say that a loss there is triaged by its first diff line. Lines 19,815 to 19,870 are the interner counts; the rest is the Miri trace.

## 4. Part 1 findings

| Item | Upstream | Check |
|---|---|---|
| F2 | `realpath(3)` on the relative path | **Reproduced.** In a 1,336-byte cwd, `--extern lib=bun` gives `does not exist: bun` from both the oracle and head; `main` says `is of an unknown type: bun`. In a short cwd, `bun`, `rel/liblib.rmeta` and `./rel/../rel/liblib.rmeta` agree with the oracle. The remaining gap is F1 |
| F3 | `env::var_os` + `env::split_paths` + `dir.join(&path).is_file()` (`spec/mod.rs:2971-2978`) | **Reproduced.** With `a\u{FFFD}b/mytgt.json` and `good/mytgt.json` present and no `-Zunstable-options`: `RUST_TARGET_PATH=a\xffb` gives `could not find specification for target "mytgt"` from the oracle and head, while `main` says `custom targets are unstable` (it found the twin). `a\xffb:good`, `good` and the empty value agree on all three. `split_paths` keeps empty parts, as `split(b':')` does |
| F4 | `std::path::absolute`: `env::current_dir()?` | Read. `sys_path_absolute` returns the error. `passes.ts`'s `std_path_absolute` serves an `.ok()` caller, so `undefined` is right |
| F6 | (a Bun artifact, not upstream) | Read. The refresh now runs only for a UTF-8 cwd; `env.test.ts` passes. F2 is the same hazard in `host_canonicalize` |

## 5. `tempdir_in`: the merged function

The trial merge of `eff41b07` into `integ-w42` (`c2c9feb9`) conflicts only in `rustc_metadata/fs.ts`. Both lanes port tempfile 3.23.0's `create_helper` + `dir::create` in the same shape; I checked them against `~/.cargo/registry/src/*/tempfile-3.23.0`. Only fixers-45 has `with_err_path`, which tempfile applies to the `create` error and to the final error (`util.rs:79`, `dir/imp/unix.rs:21`). **The merged function is fixers-45's `tempdir_in`, `tmpname`, `with_err_path`, `NUM_RETRIES` and `NUM_RAND_CHARS`, exactly as at `eff41b07`:**
- the absolute base, with `current_dir()`'s error returned;
- one `mkdirSync(path, { mode: 0o777 })` per try;
- the retry decided on `IoError_kind` after the wrap (which keeps the kind);
- `with_err_path(e, path)` on the `mkdir` error, and `with_err_path(.., base)` on "too many temporary files exist".

Keep fixers-46's header sentences about N5 and N6, drop its "` at path` is not added (queued in docs/next.md)", and drop the then-unused `randomBytes` import. Either random source is fine.

**fixers-46's test must change.** Its path-limit test then fails: `Expected: 63, Received: undefined`, reproduced. That is right: `raw_os_error()` of a `Custom` error is `None` upstream. The change I ran:

```ts
// import { display_IoError, IoError_kind, type IoError, io_error_from_node } from "../std/io.ts";
let plain: IoError | undefined;
try { mkdirSync(..); rmdirSync(..); } catch (e) { plain = io_error_from_node(e); }
...
if (r.$ === "Err") {
  expect(IoError_kind(r._0)).toBe(IoError_kind(plain));
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  expect(display_IoError(r._0)).toMatch(new RegExp(`^${esc(display_IoError(plain))} at path "${esc(dir)}/rmeta[A-Za-z0-9]{6}${esc(suffix)}"$`));
}
```

With this, `fs.test.ts` and `rustc_interface/` pass (10 tests), `tsc` is clean, `coverage.ts --check --offline` is ok, and the checker gives the same counts on the merged tree. Close the `docs/next.md` line-503 item's temp-dir clause when merging.

## 6. `POLONIUS_ALGORITHM` and `marker-check.ts`

**The relaxation is correct.** The runtime resolver already maps `unwrap_result` → `unwrap` and `expect_result` → `expect` (`track_caller.ts:191` `RESULT_METHODS`, used by `map_call`), so the static check rejects an anchor the resolver honours.

The patch I ran:
- export `RESULT_METHODS`;
- in `marker-check.ts:62-70`, try the upstream name and every TS name that `RESULT_METHODS` maps to it, calling `ts.calls_in` and `ts.call_key` with the TS name.

The `unwrap(x, "msg")` rule (`track_caller.ts:326`) is keyed on `unwrap` alone, so it is untouched.

Results with `e043c959` reverted:

| Check | Without the patch | With it |
|---|---|---|
| `coverage.ts --check --offline` | `ERROR: … nll.ts:174: rustc-call 177:60 is \`unwrap\` upstream, but the next line calls no \`unwrap\`` | `markers ok` |
| `marker-check.test.ts`, `track_caller.test.ts` | | 47 pass |
| `POLONIUS_ALGORITHM=bad -Zpolonius=legacy` | | panics at `…/compiler/rustc_borrowck/src/nll.rs:177:60:` with the same message as the oracle; `main` stops with `location refused: no key for unwrap_result` |

Column 60 is the `u` of `.unwrap()`. It touches `scripts/` and `src/rust_ts/`, so it goes in a reviewed scripts batch.

## 7. `mono-run.ts` and the logger

**Confirmed:** `scripts/mono-run.ts:47` calls `compiler_entrypoint` without `init_rustc_env_logger`. Its subject has no subscriber at all, not even the default WARN filter.

**Starting it would not change a protected case.** The port has 9 live WARN/ERROR sites. A protected case matches, so the oracle printed none, and the subject prints one only where it diverges.

I ran the same 120 `mono-ui` cases with the logger started (scratch patch): 120 MATCH, as without it. `def-path-hash` then agrees up to line 646, where the oracle prints `INFO rustc_codegen_ssa::base codegen_instance(std::rt::lang_start::<()>)`, past the mono stop, as the handoff says. In the oracle cache, the only cached `WARN` lines (`generalize`'s "may incompletely handle alias type") belong to cases outside `mono-ui`.

## 8. Samples and protected files

The lane changes only `src/` and its handoff: no oracle output, baseline, suite, script, tool or `UPSTREAM.json`.

On head:
- `tsc` is clean, `coverage.ts --check --offline` passes (24,872 markers), and `ty/context.rs` is 202/202 and `rustc_metadata/fs.rs` 5/5.
- The lane's unit files pass (35). Their time is unchanged: `rustc_log/lib.test.ts` takes 12.40 s on head and 12.48 s on `main`.

| Suite (seed `review-fixers-45`) | Result |
|---|---|
| check-ui 120 | 120 MATCH |
| mir-o2 120 | 119 MATCH, 1 DIFF: `simd/shuffle.rs#opt` (ICE backtrace), unprotected, and the same DIFF on `main` |
| mono-ui 120 | 120 MATCH |
| run-pass-aux-miri 80 | 80 MATCH |
| mir 120 | 120 MATCH |
| expanded 120 | 120 MATCH |
| miri-hello | 1 MATCH |

## Not checked

- The 118-case ICE report figure.
- Windows (`split_paths` now stops there).
- Linux behaviour of F6 and F2.
- `log-backtrace.rs` beyond the handoff's reading.
- Every converted `info!` against the oracle: those the handoff lists as never seen printing (`ProjectionCache::complete`, `dependency_format`, `expand_macro_attr`, `check_trait`, `rustc_peek`, lto) I checked by reading only.
- The 9 other "not ported" fns, beyond the 9 I grepped.
- Full suites and the gate.

Written outside the repo:
- `$RUST_TS_DATA/runs/rv45-*`;
- `$RUST_TS_DATA/tmp/info-sites-check/report.txt`, rewritten by the checker;
- the `fs.test.ts` scratch dir;
- my scratchpad.
