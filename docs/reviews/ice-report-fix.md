verdict: REQUEST CHANGES

Re-check of root's commit `8f588a3b` on `fix/ice-report`, answering `docs/reviews/ice-report-impl.md` F1 and F2. I am read-only: this file is the only change. It sits on branch `review/ice-report-fix`.

**What holds:**

- F1's reproducer now refuses, and no call the resolver can reach maps into a nested item.
- F2 is byte-exact on every error I could produce.
- The 92 are confirmed against this code.
- `in_nested_item` is exact for `fn`, `impl`, `trait` and `mod` at the pin.

**Three small changes are needed (R1, R2, R3):**

- **R1:** the review's step 2 is not done, though the commit says it is.
- **R2:** an ordinary edit brings F1's exact wrong line back, through an exemption nothing uses.
- **R3:** a new find, seen only because I stopped masking the ICE file name: the port stamps it in local time and the oracle in UTC.

None needs the 92 or a gate-sized re-run. R1 and R2 are provably no-ops for the resolver's output today.

## Findings

### R1 (MEDIUM, blocks): the checker does not cover every tracked name, and what it reports is a path the resolver never takes

**Where:** `src/rust_ts/track_caller_check.ts:155-166`.

The comment and the commit subject say the checker now covers every tracked name. The loop runs `[...FAMILIES, ...PANIC_ENTRIES]`, which is 22 distinct names.

1. **Coverage.** 129 of the 145 tracked owner names are not examined. So 29 of the 55 calls that map into a nested item through the outer owner never appear. Examples are `rustc_lint/internal.ts:391` (`emit_span_lint`) and `rustc_hir_analysis/collect.ts:374` (`span_err`). This is the gap F1 named under "why nothing caught it".
2. **Population.** It calls `map_call` with the outer owner, but `locate` always uses `ts.owner_at(line)`, the innermost one (`track_caller.ts:268`). All 26 lines are inside a marked inner fn, so the resolver never reaches them that way. The same scan on the innermost owner gives **0**.
3. **Duplicates.** `bug` and `span_bug` are in both lists, so the 26 are 22 distinct sites.

**Failing scenario:** a port wraps a call of `emit_span_lint` or `span_err` the way R2's reproducer does, and the location comes out wrong. The checker prints the same 26 and says nothing. For `assert` it would print 27 among 26 lines of noise.

**Fix:**

- Build the names as `self_named_tail_calls` already does at `:196-200`, plus `into_diag`, and add a macro-mode pass.
- Skip any call where `ts.owner_at(line) !== owner`.
- Dedupe.
- The expected output is then 0, so any line is a real finding.
- My version took about 14 s against the checker's 4.5 s. It is report-only, so that is fine.

**`PANIC_ENTRIES`:** it has every entry that can map.

- The machinery also exports `unwrap_result` and `expect_result`, and those names occur nowhere in upstream `compiler/`, so they always refuse on count. My all-names scan included them and found 0.
- `expect` is listed but is no export of those files. That is harmless.
- `track_caller_check.ts`'s other family, the macro names, is not run at all. By hand: 8 macros, 210 mapped calls, 0 nested.

### R2 (MEDIUM, blocks): the `in_nested_fn` exemption lets F1's wrong line back, and nothing needs it

**Where:** `src/rust_ts/track_caller.ts:337`.

`!ts.in_nested_fn(owner, line, col)` accepts any TS closure as "the nested item was kept". This was the prior review's own wording of the fix, not root's error.

**Reproduced end to end:** I flipped the condition at `ref_prop.ts:313` and wrapped it in an IIFE, a form `src/rustc_*` uses about 230 times for Rust block expressions:

```
(() => { assert(place.local === local, "assertion `left != right` failed"); })();

thread 'rustc' (85610) panicked at compiler/rustc_mir_transform/src/ref_prop.rs:339:25:
```

That is F1's exact wrong output, with no refusal. The right location is `:275:17`, the `assert_ne!`.

**No resolver site uses the exemption:**

| Population, innermost owner | Mapped | Into a nested item |
|---|---|---|
| All tracked names, machinery names, D4 families | 10,173 | 0 |
| Macro mode | 210 | 0 |
| Anchored | 18 | 0 |

Each of the 55 kept-nested cases has its own marker, so it goes through its inner owner and never reaches this check.

**Removing the exemption, tried on a private worktree:** `track_caller.test.ts` still has 20 pass and 0 fail. The 118 give 92 MATCH, with 0 status differences from the unmodified code.

**`in_nested_fn` is also too generous in another way.** A multi-line signature returning a function type, `): (x: number) => void {`, makes the whole body count as a closure. Five owners have that shape (`rustc_ast/visit.ts:293` and others). A type argument `h<(x: number) => void>(CALL())` does the same. Both are `expr_end` reading a type as an arrow body.

**Fix:** drop `&& !ts.in_nested_fn(owner, line, col)`, and keep the comment's reasoning. A port that later keeps an unmarked nested fn gets a refusal or an anchor, which is the safe direction. The refusal text should then lose "and this one is not".

### R3 (MEDIUM, blocks): the ICE file name is stamped in local time, and the oracle stamps UTC

**Where:** `src/rustc_driver_impl/lib.ts:1128-1132`, `strftime_ice`, whose comment says "(local time)". It dates from `11e8dbe8` (2026-10-13), not this commit, but this path only became visible with the lane.

**Reproduced with a real ICE, `RUSTC_ICE=/nonexistent/z`, on this machine (Asia/Jerusalem):**

| `TZ` | Oracle | Port |
|---|---|---|
| unset | `rustc-ice-2026-11-06T01_21_48` | `rustc-ice-2026-11-06T03_21_49` |
| `Asia/Tokyo` | `rustc-ice-2026-11-06T01_21_50` | `rustc-ice-2026-11-06T10_21_51` |
| `UTC` | `rustc-ice-2026-11-06T01_21_51` | `rustc-ice-2026-11-06T01_21_52` |

**Cause:** upstream calls `jiff::Zoned::now()`, but `rustc_driver_impl/Cargo.toml:9` builds jiff with `default-features = false, features = ["std"]`. So there is no system time zone, and the oracle uses UTC whatever `TZ` says.

**Effect:** wrong bytes outside UTC in the file name on disk, in `note: please attach the file at ...`, and in F2's own warning. Suites use `RUSTC_ICE=0`, and every comparison so far masks the file name, including F2's, the prior review's and my first pass.

**Fix:** use `getUTCFullYear`, `getUTCMonth`, and so on, and correct the comment. Pin it with `TZ=Asia/Tokyo` against the time with `date -u`, or a pure test of `strftime_ice`.

### R4 (LOW): nothing tests F2

**Where:** `src/rustc_driver_impl/lib.ts:1248-1279`.

**Scenario:** I reverted only that file to the lane's version. All 193 `src/rustc_driver_impl/` tests pass, and no `*.test.ts` names `IcePathError` or "couldn't be written". The other fixes do have tests that fail when reverted (below).

**Fix:** one subprocess test with `RUSTC_ICE=/nonexistent/x/y` on a case with a real ICE. Do not put it in `track_caller.test.ts`, which has no budget left. Can go with the harness batch if root prefers.

### Nits

| # | Where | What | Effect |
|---|---|---|---|
| N1 | `track_caller.ts:716-720` | Item shapes the regex misses, on synthetic source: `fn n(x: [u8; { 1 }]) { CALL }` and `impl Foo<{ 1 }> { const X: u8 = CALL(); }` (first `{` is the wrong one), nested `const` and `static`, `safe fn`, `gen fn`, `m!(fn n() { CALL })`, a non-ASCII name. It also over-matches `trait T { fn f(); } if x { CALL }`, which only refuses | **No case at the pin**, see below. The pin cannot change, so this only matters for `static`: 8 `new` calls such as `rustc_driver_impl/src/lib.rs:1573` are in nested statics, and a hoisted static with one `X.new` in the owner would map. None does today. Adding `static` and `const` is cheap |
| N2 | `track_caller.ts:706-707` | `in_closure`'s doc comment now sits above `in_nested_item`'s, and `in_closure` has none | Reading only |
| N3 | `track_caller.ts:338` | "the only upstream call" is also printed when there are several keyed calls. `classify_refusal` has no class for it, so it lands in `refused: other` | Reading only |
| N4 | `track_caller_check.ts:166` | "each in a nested function of its TS owner" is what `map_call` now guarantees, so the line says nothing | Goes with R1 |

## F1, against each question

**The reproducer.** The condition at `ref_prop.ts:313` flipped, `rp.rs`, `-Zmir-opt-level=2 -Zmir-enable-passes=+ReferencePropagation`:

| Code | Result |
|---|---|
| `8f588a3b`, tail calls on | Exit 101: ``location refused: `assert` at compiler/rustc_mir_transform/src/ref_prop.rs:149: the only upstream call is in a nested item, and this one is not`` |
| `8f588a3b`, tail calls off | The same refusal |
| Control: `8f588a3b` with the lane's `track_caller.ts` (`26bedc00`) | Prints `ref_prop.rs:339:25`, so the test still detects the bug |

**The check runs on masked text.** Yes: `this.masked`. A string `"fn n() {"`, a comment `// fn n() {` and a char `'{'` all behave correctly.

**False negatives you named.** All correct on synthetic source:

- `impl` after an attribute with a trailing comment
- `pub(in path) fn`, `pub(crate) fn`
- `const unsafe extern "C" fn` (the mask blanks the quotes, and the regex still accepts it)
- `extern fn`
- `#[cfg(..)] mod m`
- `macro_rules!` bodies (`in_macro_rules` also refuses them)
- items in a block, a closure or a match arm
- `unsafe impl`, `unsafe trait`, `pub trait`, `auto trait`
- a raw identifier

**The owner's own signature.** `-> impl T`, `x: impl T`, `[u8; 3], y: impl T`, `#[a] x: impl T` and `<const N: usize>(x: [u8; { N }]) -> impl T` are not nested items. That is correct, including the case that first dropped 8 of the 92.

**`open = s.indexOf("{", at)`.** It finds the wrong span for const braces, as you suspected (N1). Real effect at the pin, measured by an independent brace-tracking detector over every upstream call of a tracked name in a marked body with a nested item:

- 1,462 calls: 350 nested by mine, 342 by the regex.
- All 8 differences are the nested `static` calls in N1. The regex agrees on every `fn`, `impl`, `trait` and `mod` call.
- Only one nested item at the pin has a brace in its header, `rustc_codegen_ssa/src/back/metadata.rs:421 pack_version`, a destructured parameter. It holds no tracked call.
- Control: the detector does see `ref_prop.rs:339` as nested.

Of 8,987 mapped sites on the resolver's path, my detector puts 0 in a nested item, including `const` and `static`.

**`anchor === undefined`.** Right. An anchor names the upstream call directly, and `map_call` still requires a call of that name at that position. It has no live effect: 18 anchored mappings, 0 nested.

**The 26, read one by one.** They are 22 distinct sites. Every location is correct. Each is inside a marked inner fn, and that inner owner's own mapping gives the same location, so no TS closure is standing in for the wrong call.

| TS site | Callee | Inner fn | Location |
|---|---|---|---|
| `rustc_resolve/ident.ts:1964` | `assert` | `record_segment_res` | `ident.rs:1889:17` |
| `rustc_hir_typeck/fn_ctxt/checks.ts:582` | `emit_err` | `variadic_error` | `checks.rs:506:32` |
| `rustc_hir_typeck/pat.ts:2328` | `unreachable` | `joined_uncovered_patterns` | `pat.rs:2590:21` |
| `rustc_lint_defs/lib.ts:391` | `panic` | `parse_part` | `lib.rs:547:26` |
| `rustc_passes/stability.ts:1281` | `emit_err` | `check_features` | `stability.rs:1248:27` |
| `rustc_target/callconv/x86_64.ts:70` | `panic` | `classify` | `x86_64.rs:62:55` |
| `rustc_abi/lib.ts:1198` | `panic` | `overflow` | `lib.rs:915:13` |
| `rustc_const_eval/interpret/intrinsics.ts:1617` | `span_bug` (twice) | `float_to_int_inner` | `intrinsics.rs:1381:22` |
| `rustc_middle/lint.ts:640` | `unreachable` | `emit_lint_base_impl` | `lint.rs:565:61` |
| `rustc_middle/ty/layout.ts:1367` | `bug` (twice) | `field_ty_or_layout` | `layout.rs:1031:35` |
| `rustc_middle/ty/layout.ts:1349` | `panic` | `field_ty_or_layout` | `layout.rs:1016:44` |
| `rustc_middle/ty/layout.ts:1212` | `assert` | `field_ty_or_layout` | `layout.rs:894:21` |
| `rustc_middle/ty/consts/int.ts:394` | `panic` | `invalid` | `int.rs:271:17` |
| `rustc_middle/mir/interpret/value.ts:408` | `panic` | `invalid` | `value.rs:250:25` |
| `rustc_session/diagnostics.ts:315` | `unwrap` | `fix_base_capitalisation` | `diagnostics.rs:604:38` |
| `rustc_hir_analysis/collect/clauses_of.ts:470` | `unwrap` | `is_const_param_default` | `clauses_of.rs:431:14` |
| `rustc_hir_analysis/collect/resolve_bound_vars.ts:2510` | `unreachable` | `resolve_param` | `resolve_bound_vars.rs:2146:25` |
| `rustc_hir_analysis/check/mod.ts:655` | `bug` (twice) | `extract_span_for_error_reporting` | `mod.rs:670:57` |
| `rustc_hir_analysis/check/entry.ts:61` | `span_bug` (twice) | `main_fn_diagnostics_def_id` | `entry.rs:34:17` |
| `rustc_hir_analysis/check/wfcheck.ts:2567` | `emit_err` | `validate` | `wfcheck.rs:2413:45` |
| `rustc_lint/internal.ts:395` | `unwrap` | `check_use` | `internal.rs:452:35` |
| `rustc_ty_utils/abi.ts:452` | `assert` | `fn_arg_attrs_sanity_check` | `abi.rs:432:13` |

I also read the 29 the checker omits (`new`, `push`, `type_at`, `note`, `span_err`, `emit_span_lint`, `typeck_results`, ...) by text overlap: all right, with the same inner-owner result.

**Sites the new refusal changes:** exactly 2 on the resolver's path.

- `ref_prop.ts:313`, the intended one.
- `rustc_errors/json.ts:308`, `dyn_write` matching `write` by the `Type_name` rule, against the nested `impl Write for BufWriter`. A refusal there is right.

**Tests fail when the fix is removed:**

| Mutation | Result |
|---|---|
| Drop the refusal | The `ref_prop` test fails |
| Drop the item-position regex | The signature test fails |

## F2, against each question

**A real ICE, oracle against port, stderr and exit code compared with the thread id and the ICE file's date and pid masked** (R3 is what the mask hid). The case is `mir tests/ui/borrowck/borrowck-describe-field-generic-param-owned-box.rs`, which reaches an ICE at `elaborate_box_derefs.rs:97:13`.

| Scenario | Text | Result |
|---|---|---|
| `RUSTC_ICE=/nonexistent/x/y` | `No such file or directory (os error 2)` | Same |
| `/etc/hosts` | `Not a directory (os error 20)` | Same |
| Directory with mode 555 | `Permission denied (os error 13)` | Same |
| `/` | `Read-only file system (os error 30)` | Same |
| `/System` | `Operation not permitted (os error 1)` | Same |
| 300-char component | `File name too long (os error 63)` | Same |
| Symlink loop | `Too many levels of symbolic links (os error 62)` | Same |
| Relative missing path | `No such file or directory (os error 2)` | Same |
| Unset, read-only cwd (no env note) | `Permission denied (os error 13)` | Same |
| `-Zmetrics-dir` missing, unset (no env note) | `No such file or directory (os error 2)` | Same |
| Both set, both missing (`RUSTC_ICE` wins) | `No such file or directory (os error 2)` | Same |
| Good directory | No warning | Same stderr. File identical apart from frames and the port's `note: rust-ts prints the JS stack` lines |

**A directory as the path.** The file name holds a timestamp and pid, so I could not hit this end to end. I compared `display_IoError(io_error_from_node(..))` after `appendFileSync(p, "")` with a Rust `File::options().create(true).append(true).open(p)` built with the oracle, on 13 paths. All are identical, including `Is a directory (os error 21)`, `/dev/null` opening fine, the empty path, and `/usr/bin/true` as `Operation not permitted (os error 1)`.

**Only the open is wrapped, write failures are ignored.** Yes, by reading and by test. I ran with `ulimit -f 0` and `SIGXFSZ` ignored, so the open succeeds and the first write gets `EFBIG`:

| Code | Result |
|---|---|
| Oracle | No warning, empty file |
| `8f588a3b` | Same as the oracle |
| Control: the lane's `lib.ts` | Prints the false "couldn't be written", with Node's message |

**Order, against `lib.rs:1538` onward:** `Ice`, the bug report note, the nightly note, `version` and `tuple`, `ice_path`, open. On `Ok`: `IcePath`, then the `FIRST_PANIC` swap, then the version write. On `Err`: `IcePathError`, with the env note only when `RUSTC_ICE` is set. Then `IceVersion`, the flags, the query stack and `extra_info`. All match. `FIRST_PANIC` reads then clears, which is the same as `swap` on one thread.

## The 92

**Root's run did test `fix/ice-report`:**

- `cmp-fix.ts` differs from `cmp-impl.ts` only in the three import paths.
- `.data/fix-ice` is clean at `8f588a3b`.
- The `.err` files were written 03:12:23 to 03:13:07, after the last source edit (03:12:09).
- 21 of them show `.data/fix-ice` paths, and none shows the lane's.

**My run:** the same runner, imports pointed at this worktree, with a fresh oracle in a private directory rather than the cached one.

- The subject's path is this worktree's, shown both by `s.subject()` and in the 21 `.err` files.
- **92 MATCH, 21 DIFF, 5 STOP.**
- 0 status differences from root's run or from the lane's, on all 118.

**`track_caller.test.ts`, user + sys, 3 runs each, load about 2.5:**

| Commit | Tests | Median user + sys | Wall |
|---|---|---|---|
| Base `1adcee8e` | 3 | 4.4 s | 1.9 s |
| Lane `26bedc00` | 18 | 10.7 s | 4.7 s |
| This commit | 20 | 9.2 s | 4.4 s |

It fits: **+4.8 s** against the 5 s budget, and not above the lane. The two new tests take about 2 ms. There is still no room.

**`bun src/rust_ts/track_caller_check.ts`:** 4,481 sites, 0 swaps, 20 anchors and const markers with 0 bad, 30 self-named tail calls, 2,468 of 2,616 locations witnessed, 148 absent, ICE corpus 49 of 49, 26 into-nested. All as root reports, but see R1 on the 26.

**`--sample 100`, `RUST_TS_AGENT=review-ice-fix`:**

| Suite | Result | Not MATCH (none is protected) |
|---|---|---|
| `mir` | 99 MATCH, 1 UNSTABLE | `tests/ui/simd/shuffle.rs` (thread id) |
| `tydump-ui` | 100 MATCH | |
| `pm-ui` | 98 MATCH, 1 UNPORTED, 1 UNSTABLE | `proc-macro/expand-expr.rs` (cross-thread execution); `resolve/proc_macro_generated_packed.rs` (thread id) |

**Other checks:** `tsc` clean (with `node_modules` linked for that run and removed), `coverage.ts --check --offline` `markers ok`. Upstream checkout clean apart from its usual ignored `build/`, and no `rustc-ice-*` in it or in this worktree.

## What I did not check

- The gate and full suites.
- A directory as the ICE path end to end (helper level only, see above).
- Write failures other than `EFBIG`.
- A non-UTF-8 `RUSTC_ICE`.
- A second panic in one process. `FIRST_PANIC` is by reading, as `-Zthreads=2` is unported.
- Upstream's real location for the `ref_prop` site. As in the prior review, it is read from the source, because the oracle cannot be made to fire that assert.
- Linux and Windows. The UTC finding comes from the Cargo features, so it should hold there, but I ran it only here.
- Nested-item false negatives in `fn`s that have no marker yet. My comparison covers marked bodies only, so a later port should rely on the corrected checker from R1.

My scripts and outputs are in `/private/tmp/claude-501/-Users-tomernorman--t3-worktrees-rust-ts-t3-8bf4b8ca/ecd0a2e9-648a-4c99-84ef-7eadff6898b0/scratchpad/r/`.
