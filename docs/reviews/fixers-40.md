verdict: APPROVE WITH NITS

Independent review of `fixers-40`, head `546df263`, on `1adcee8e`. No DIFF or CRASH on a protected case. Every fix the lane made does what it says, every named mutation is killed, and every fixture regenerates from the oracle unchanged.

**Merging is safe, but F1 should not wait long.** `ensure_stack`'s re-exec gives wrong answers on reachable paths, not stops: `option_env!`, Miri's `environ` and proc macros all see what the shell and the markers changed. No protected case reads any of it. The problem is older than this lane, the lane fixed the one case that showed, and it flagged part of the rest. It also missed proc macros and added one variable of its own to what they see. A 35-line prototype passes the environment through exactly (section 1), so I recommend replacing `restore_shell_env` with that in the next fixers lane.

**One lane claim is wrong (F4).** The `is_scalable_vector` guard at `aarch64.ts:127` is not equivalent: a type with both attributes kills the mutation. The other two named mutations are equivalent, as the lane says.

I edited no code. Mutations and prototypes ran in two scratch worktrees, since removed. This file is all I wrote to the tree. I did not run the gate or a full suite.

| # | Severity | Where | Finding |
|---|---|---|---|
| F1 | MEDIUM | `src/rust_ts/stack.ts:39,93-102,154` | The re-exec changes what a compiled program and a proc macro see; only `process.env`'s `PWD`, `OLDPWD`, `SHLVL` are put back |
| F2 | MEDIUM, older than this lane | Bun's dotenv; `src/rustc_builtin_macros/env.ts:242`, `src/miri/bin/miri.ts:533` | A `.env` or `.env.local` in the cwd becomes the compiled program's environment |
| F3 | LOW, older than this lane | `src/rustc_builtin_macros/env.ts:20-21` | A non-Unicode variable is a lossy `Some(..)`; the oracle reports an error. The `PORT:` note says it cannot arise |
| F4 | LOW | `docs/handoff/fixers-40.md`, `src/rustc_target/callconv/aarch64.ts:127` | The arg guard is not equivalent; a test can kill it |
| F5 | LOW | `src/rustc_metadata/rmeta/decoder/cstore_impl.ts:579` | No unit test or protected suite exercises the EII decoder |
| F6 | LOW | the lane's new tests | About 6.8-7.5 s CPU added under load, against `plan-m7` F5's 5 s budget |
| N1 | nit, for a harness batch | `scripts/lib/unstable.ts:18` | The long-type pattern hides the whole case, where normalizing the digits would keep it compared |
| N2 | nit | `src/rust_ts/stack.ts:97` | A preset marker with a malformed `RUST_TS_SHELL_ENV` is an ICE |
| N3 | nit | `src/rust_ts/stack.test.ts:22` | The test's title overclaims: "the shell leaves the environment alone" |
| N4 | nit | `src/rustc_mir_transform/alias_check_oracle/alias_check.ts:100,107` | The header says "own data properties of any kind", but a `Map` or `Set` returns before its own props |

## 1. `775991c0`, `PWD`, and F1

**The re-exec is needed.** A 5,000-deep parenthesised expression: oracle exit 0, port exit 0, port without the re-exec (marker preset) exit 138, SIGBUS. So the shell stays. What has to go is what it does to the environment.

**What differs.** All run with `env -i` and an explicit environment, oracle against `src/rust_ts/main.ts` or `src/miri/bin/miri.ts` at this head:

| Program | Environment | Oracle | Port |
|---|---|---|---|
| `option_env!("RUST_TS_JS_STACK")`, `option_env!("BUN_JSC_maxPerThreadStackUsage")` | unset | `None` | `Some("17825792")` |
| `env!("RUST_TS_JS_STACK")` | unset | error | compiles, one error fewer |
| `option_env!("PWD")`, `SHLVL`, `OLDPWD`, set or unset | | as set | as set: **the lane's fix holds** |
| `option_env!("_")` | `_=under` | `Some("under")` | `None` |
| `option_env!("IFS")` | `IFS=:` | `Some(":")` | `Some(" \t\n")` |
| `option_env!("OPTIND")` | `OPTIND=9` | `Some("9")` | `Some("1")` |
| `option_env!("SHELLOPTS")` | `SHELLOPTS=noglob` | `Some("noglob")` | bash's own list, plus `/bin/sh: SHELLOPTS: readonly variable` on stderr |
| any compile | `SHELLOPTS=xtrace` | clean stderr | `+ ulimit -S -s 18432` and `+ exec ...` on stderr |
| `std::env::vars()`, Miri, `-Zmiri-disable-isolation` | 4 variables | those | also `BUN_JSC_maxPerThreadStackUsage` and `RUST_TS_JS_STACK` |
| `std::env::var("RUST_TS_JS_STACK")`, Miri, `-Zmiri-env-forward=RUST_TS_JS_STACK` | unset | `Err(NotPresent)` | `Ok("17825792")` |
| `std::env::vars()` order, Miri, isolation off | 60 variables | one order | another, with the markers filtered out |
| Proc macro, `std::env::var("PWD")`, `SHLVL` | unset | `Err(NotPresent)` | `Ok(<cwd>)`, `Ok("0")` |
| Proc macro, `std::env::var("PWD")` | `PWD=/wrong` | `Ok("/wrong")` | `Ok(<cwd>)` |
| Proc macro, the markers and `RUST_TS_SHELL_ENV` | unset | `Err(NotPresent)` | `Ok("17825792")`, `Ok("[null,null,null]")` |

**Causes, each isolated:**

- **Order.** The shell sorts `environ`. Running the oracle's own Miri through `/bin/sh -c 'exec "$@"'` changes its order on the 60-variable program, while adding the two markers to its environment does not. `FxHashMap` iteration depends on insertion order, so a sorted `environ` is visible. This is the order `docs/reviews/miri-shims-c` pins.
- **Proc macros.** They run through `bun:ffi` and read C's `environ`. `process.env` writes and deletes do not reach it, so `restore_shell_env` restores nothing there. **The lane's `RUST_TS_SHELL_ENV` is a new variable a proc macro can see.** It is removed from `process.env` only. The handoff does not mention proc macros.
- **More shell rewrites.** `_`, `IFS`, `OPTIND`, `SHELLOPTS`, `POSIXLY_CORRECT` are bash too. `SHELL_VARS` cannot be made complete by adding names, as the shell also acts on `SHELLOPTS`.

**Every entry is affected the same way.** `main.ts`, `miri.ts` and `scripts/mono-run.ts` all call `ensure_stack`: each gets the lane's fix, shown by `PWD`, and each keeps the marker, shown by `RUST_TS_JS_STACK` under `mono-run`.

**Protected cases: none reached.** `tests/ui` reads `PWD` by macro only in `compiletest-self-test/rustc-env.rs`, which this commit moves to MATCH. `tests/ui/proc-macro/auxiliary/env.rs` reads `THE_CONST` and `ANOTHER`. Miri's `tests/pass/shims/env/var.rs` prints `vars()` with isolation on, and the isolation-off cases there do not print the list. The lane's change alters no protected result in any sample below.

**Why MEDIUM, not blocking.** They are silent wrong answers, which PORTING section 3 exists to prevent, but they need a program that names these variables, a proc macro reading them, or Miri with isolation off. Nothing got worse except the one variable above.

**Failing scenario for a user.** A proc macro that records `std::env::var("PWD")` into its expansion under `env -u PWD`, or a build started with a `PWD` that differs from the cwd. The port expands to a different value, with exit 0.

**Fix, prototyped.** In `ensure_stack`:

1. Read the raw entries of C's `environ` (`_NSGetEnviron` on macOS, `environ` on Linux).
2. `execve("/bin/sh", ["sh", "-c", script, "sh", <entries...>, <marker>, <execPath>, <argv...>], [])`, with an **empty** `envp`, so the shell reads nothing.
3. `script` is `if ulimit -S -s N 2>/dev/null; then J=BUN_JSC_maxPerThreadStackUsage=M; else J=RUST_TS_REEXEC=1; fi; exec /usr/bin/env -i "$J" "$@"`.
4. On arrival, `unsetenv` the markers through FFI and delete them from `process.env`. Guard a second `ensure_stack` call in the same process with a module-level flag.

Result of that prototype, against the oracle:

- The `_`, `IFS`, `OPTIND`, `SHELLOPTS`, `foo.bar`, `a-b`, `BASH_FUNC_x()`, `PWD`, `OLDPWD`, `SHLVL` program: identical.
- The markers: `None`.
- The 60-variable `vars()` under Miri, isolation off: **byte-identical, order included**.
- The proc macro: identical.
- Nesting of 5,000: still exit 0.

Not done with the prototype: Linux, any suite, the cost of a nested re-exec now that the marker is gone. To handle in the real change: an entry with no `=` must be dropped, since `env` would take it as the program, and an `execPath` containing `=` needs a fallback.

**Noticed, no action.** On macOS the oracle sets `__CF_USER_TEXT_ENCODING` to `0x1F5:0x0:0x0` even over another value, as CoreFoundation does at startup, and Bun does not. It differs only when the caller's value is absent or different, and a login session has that value.

### F2. `.env` files

Bun loads `.env` and `.env.local` from the cwd before any port code runs.

| `DOTENVVAR=fromdotenv` in `./.env` | Oracle | Port |
|---|---|---|
| `option_env!("DOTENVVAR")` | `None` | `Some("fromdotenv")` |

**Failing scenario.** A crate with a `.env` file, a common layout, that has `option_env!("DATABASE_URL")`. The port compiles in the value and exits 0.

Not the shell: `bun --no-env-file` removes it, and `getenv` through FFI returns null under dotenv, so C's `environ` never has it. So either the subject runs with `--no-env-file` (`--no-compile-autoload-dotenv` for a bundle), or the port deletes from `process.env` what C's `environ` lacks. Neither is in this lane's files. No protected case: `$RUST_TS_DATA/rust` has no `.env*`. The repo has `.env.local`, and `miri-hello` runs in the repo, but its program reads nothing from it.

### F3. Non-Unicode values

`BADU=$'a\xffb'`, `option_env!("BADU")`. Oracle: ``error: environment variable `BADU` is not a valid Unicode string``. Port: `Some("a\u{fffd}b")`, exit 0. The note at `env.ts:20-21` calls `NotUnicode` impossible; it is impossible only because `process.env` has already decoded the value lossily. PORTING would have this stop, not guess. Not new.

## 2. `df702572`, long-type file

**"Never guess": not broken, in my reading.** The oracle's digits hash an address and differ on every run (three runs of one program gave three hashes). No value can be right, so nothing is being guessed at. The `// PORT:` note says what it does, and `unported` would keep stopping programs whose every other byte is reachable. I would leave it, and it is root's call as the handoff says.

**All 33 programs and all revisions match: 39 of 39.** Run from the upstream checkout with `-Zui-testing -Zdeduplicate-diagnostics=no --emit=metadata`, and `--cfg` for each revision. Stderr, exit and file contents are identical, hash digits aside. That includes the 4 the lane did not run. My script first reported one DIFF on `issue-38591-...`; its regex had replaced digits in the file's stem. Rerun by hand on that program, the contents are the same (`c9bdcb2ff975` on 3 oracle runs and the port).

**How the oracle is compared.** compiletest normalizes to `$LONG_TYPE_HASH`. Difftest does not: `unstable.ts:18` makes any case whose oracle stderr has the note UNSTABLE, never cached or compared. That can hide a real difference, as the whole case goes unread, and it only keys on the oracle's stderr, so a note the port invents still shows as a DIFF. **N1:** now that the port reaches the end of these programs, normalize the digits as compiletest does, and they rejoin the comparison. Until then `long_type.oracle.test.ts` is the only committed check.

**What a text hash can change.** Two different types with the same text share a file here and not upstream. A rerun reuses the file, where the oracle starts a new one: dedup then returns `short` without writing, so stderr is the same. Only file names and line counts can show either.

**Where it writes.** `temp_path_for_diagnostic` is the same code as upstream (`config.ts:1499`, `config.rs:1356`): `temps_directory`, else `out_directory`. Open, read-dedup, append and the fallbacks to `regular` follow `error.rs:307-325`, and the path is set before the open, as upstream, so the note still prints when the directory does not exist.

**Leftovers.** The option's default is `true`, so a case without `=no` and without `--out-dir` writes to its cwd, as the oracle does. In the suites I enumerated, the only cases with `=yes` are 4 each in `tydump-ui`, `thirdump-ui` and `thir-tree`, whose out dir is under the ignored `build/`. After all of this review's runs, no `*long-type-*` is in the checkout, its `git status` is clean, and so is this tree's.

**`rustc_lint/builtin.ts:541`: right.** `pub struct H([u8; 1 << 60])` with `#![deny(missing_copy_implementations)]`, next to 1, 256 and 257 byte structs: stderr and exit byte-identical to the oracle.

## 3. `605edabb`, metadata temp dir

Each exit from `integ-w39-b1.md` F1, from a scratch directory, oracle and port:

| Command, library crate | Oracle leaves | Port leaves |
|---|---|---|
| `--emit=metadata -o -` at a terminal | nothing, exit 1 | nothing, exit 1 |
| `-Zunstable-options -Zoffload=HostMetadata=hm.json --out-dir d` | `hm.json`, `d/` | `d/`, exit 70 |
| `-Zprint-type-sizes --emit=metadata --out-dir d` | `d/lib.rmeta` | `d/lib.rmeta`, exit 70 |
| `-Zprint-type-sizes -Zno-codegen --out-dir d` | `d/lib.rlib` | `d/`, exit 70 |
| `-Zmetrics-dir=d/m --emit=metadata --out-dir d` | `d/lib.rmeta`, exit 1 | `d/lib.rmeta`, exit 70 |

**No `rmeta*` in any row.** `-C save-temps` keeps `rmetaX/` on the plain, metrics and type-sizes rows, as the oracle. `scripts/mono-run.ts` with `-Zprint-type-sizes` leaves none. A `#![deny(unused_features)]` error from `report_unused_features`, after the `Linker` exists: stderr, exit and files identical.

- **Double drops:** `link`'s own drop and `run_compiler`'s catch can both run. `MaybeTempDir.drop` (`fs.ts:307`) returns on the second.
- **A drop before the last use:** every new `drop` is in a `catch` that rethrows, so nothing after it runs. `mono-run`'s `MonoOnly` catches its stop inside `codegen_crate`, so `start_codegen`'s catch does not fire on that path.
- **A drop masking the original error:** `TempDir.drop` wraps `rmSync` in `try`, and `keep` does not throw.
- Reverting either `catch` fails the new test.

**Not reachable today:** the `crate_hash` catch in `queries.ts`. `-Cincremental` stops earlier, at `build_output_filenames`, so no test covers it.

**Noticed, older than this lane:**

- `-o - | true`: the oracle dies of SIGPIPE, exit 141, leaving `rmetaX/`. The port prints `error: failed to copy ...`, exit 1. The port's leftover used to match by accident; the exit never did.
- `--out-dir <unwritable>`: the oracle ends ``... (os error 13) at path "<dir>/rmetaXXXXXX"``, tempfile's `PathError`. The port stops at `(os error 13)`. `src/rustc_metadata/fs.ts:72`. The name is random, so no suite could compare it.

## 4. `775991c0`, EII decoding

**Right, against `eii.rs:9` and `encoder.rs:1733`.** A tuple of `(DefId, (EiiDecl, Vec<(DefId, EiiImpl)>))`, over the generated decoders, whose field order matches `data_structures.rs:31-58`. `cstore_impl.rs:347` builds the same maps.

**Cross-crate, by hand.** 15 `tests/ui/eii` programs with aux crates, each aux built by both sides:

- Every aux `.rmeta` is **byte-identical** between oracle and port.
- Port against oracle on the oracle's aux, and each side reading the port's aux: **stderr and exit identical on all 15**.
- That includes the ones that report decoded spans across crates: `duplicate/duplicate1-3.rs`, `privacy2.rs`, `type_checking/cross_crate_wrong_ty.rs`.

**Suites, `--filter tests/ui/eii`:** `run-pass-aux-miri` 16/16, `check-ui` 11/11, `mir` 92/92, `mono-ui` 10/10, `rmeta-ui` 11/11, `run-pass-miri` 10/10. So EII works through to `mir` and `check-ui`. I did not rerun all of `run-pass-aux-miri`; the sample below has 199 of 200, and the one left is `rust-log.rs`, as the handoff says.

### F5. Nothing gated exercises the decoder

Mutation: `new KeyedMap<DefId, EiiImpl>(DefId_hash_key, [])`, which throws away every decoded impl. `bun test` on `src/rustc_metadata` and `src/rustc_passes`: 192 pass. `check-ui`, `rmeta-ui`, `mir`, `mono-ui`, `run-pass-miri` on `tests/ui/eii`: all still 100%. Only `run-pass-aux-miri` sees it: 12 of 16 DIFF. That suite is report-only (decision of 2026-11-05), so **a wrong decoder would pass the gate**. Promote those cases when that suite is reconsidered, or add a small oracle test with an aux crate.

## 5. `db43206f`, vtable contents

**Killed.** `tcx.vtable_allocation([ty, undefined])` at `ty/vtable.ts:165` fails `vtable_static`, which passes unmutated. The fixture's nested block (`VT 40: memory +0`, then `Second`'s block) is what shows it. `regen.ts` leaves it unchanged.

## 6. `ecc69f9b`, `6619a443`, test gaps

**Fixtures from the oracle.** `aarch64_oracle/regen.ts`, `partitioning_oracle/regen.ts` and `collector_oracle/regen.ts` on a clean checkout of this head: **zero changes**. `long_type.stderr` and `long_type.txt` by hand per the test's header: identical.

**Mutations, each run:**

| Mutation | Result |
|---|---|
| `-Zcodegen-source-order` branch reversed | killed, `overlap-source-order` |
| Overlap counts items, not size | killed |
| Vector limit: the 64 side, the 128 side, and removed | each killed |
| `pass_indirectly_in_non_rustic_abis` removed | killed |
| Long-type dedup off; a written type returned as `regular` | each killed |
| F4: mono always `CHECKED`; `BOTH_ICE` ignoring the message | each killed |
| Old `alias_check.ts` | 6 of 7 "a Place held twice" tests fail, as claimed |
| `consumed_cgu_names` truncated; overlap counting non-inlined | survive, see below |
| `is_scalable_vector` guards at `aarch64.ts:96`, `:127` | survive the committed tests; see F4 |

**`mir-alias` F2's widened checker.** My own plants, each reported: Map key (also in two maps only), Map value, Set member (also in two sets only), child of a frozen object and array, grandchild through two frozen, two frozen wrappers, `.cache` on anything but `BasicBlocks`, symbol prop on an object and an array, non-enumerable, an array's string prop, a null-prototype object.

Not reported: accessors and `#private` (the header says so), plus own props of a `Map` or `Set`, prototype fields, `WeakMap` values, closures. **N4:** the header's "own data properties of any kind" is false for a `Map` or `Set`, which return at `alias_check.ts:100,107`. `KeyedMap`'s one own prop is a function, so nothing real is hidden today.

**False positives: none.** A shared `Ty` (fields, Map key and value, Set), a shared `RawList`, one inside two frozen wrappers, frozen leaves, unit variants, and a frozen cycle, which terminates, report nothing. Real bodies, my own sample of 30 `tests/mir-opt` programs, modes `o0,o2,mono`: 90 runs, 39,190 walks, **0 distinct hits**; 60 MATCH, 28 CHECKED, 2 FAILED.

### The three "equivalent" mutations

- **`consumed_cgu_names` truncated: equivalent, I agree.** Sizes only grow on merge, `sort_by_key` is stable, and the destination is in the top N, so the top N stays the same set and a source has never consumed anything. The second merge loop does not touch `cgu_contents`.
- **Overlap counting non-inlined: equivalent, I agree.** At the pin `place_mono_items` has `LocalCopy => continue` at `partitioning.rs:226`, with no exception left despite the comment above it, and `inlined` follows from the mode, which is one value per item.
- **Evidence beyond reading for both:** throws on either condition, and on a destination holding as a root what the source holds inlined, fired on none of the 66 cases, nor on 150 sampled `mono-ui` cases with my own seed (149 MATCH; the DIFF is `callee_is_track_caller.rs`, not protected, the known codegen warning).
- **`aarch64.ts:96`, `classify_ret`: equivalent for what could run,** as the next branch is a no-op on this repr. On a scratch program with `-> Both`, `-> Svint`, and a two-vector tuple, the mutated port's first lines equal the unmutated port's.
- **Softfloat half: still by reading.** The port stops on both `aarch64-unknown-none-softfloat` and a JSON target, `rustc_target::spec::TargetTuple::from_path`. By reading, `softfloat_float_abi` acts on `Scalar` and `ScalarPair` only, so I agree.

### F4. `aarch64.ts:127` can be killed

The lane looked at the branch after `classify_ret`'s guard. In `classify_arg`, the very next check is `pass_indirectly_in_non_rustic_abis`, and the guard is what skips it.

```rust
#[rustc_scalable_vector(4)]
#[rustc_pass_indirectly_in_non_rustic_abis]
pub struct Both(i32);
#[rustc_abi(debug)]
pub type CBoth = extern "C" fn(Both);
```

- **Oracle and the port as it stands:** an ICE, exit 101, at `rustc_ty_utils/src/abi.rs:456`, with the same message: `the "C" ABI does not implement ...`, because the guard left the arg `Direct`.
- **Guard removed:** exit 1 with the `fn_abi_of` dump. The mutation is visible.

The fix is small: a separate small `no_core` fixture, since the ICE stops the compile, comparing the message. Worth about one spawn; root may prefer only to correct the handoff's claim. The port has no bug here.

## 7. Item 5, long descriptions

**The lane is right that it needs a generator.** A read of `$RUST_TS_DATA/rust` at run time needs a dev checkout, so a `--compile` bundle has nothing to read. It would also be the only place the compiler reads upstream's tree when running. One static import per file costs every startup.

**The spec's numbers hold.** `error_codes!` has 518 entries and there are 518 files, 418,411 bytes. The "~1.3 MB" in `tools/codegen/error_codes.ts:5` and `codes.ts:30` is wrong. No file has a `\r`, 12 have non-ASCII. Lazy `require` in a bundle was verified by the `mono-wire` review, D14. I did not build a bundle.

**The effect, reproduced with my own copy of the lane's prototype, reading the checkout (reverted, then removed):**

- `json.oracle.test.ts`: exactly the three `EXPECTED_UNPORTED` rows fail, 82 pass.
- `miri-fail --filter tests/fail/rustc-error.rs` and `tests/fail/erroneous_const`: 3 of 3 MATCH.
- `$RUST_TS_DATA/runs/fixers-40-proto-miri-fail`: 608 of 610, the 2 left being `tests/fail/shims/input_arg_mismatch.rs`, `return_type_mismatch.rs`, at `open_file_or_dir`. That is the lane's own run; I read it and did not rerun the full suite, as asked.

**Add to the spec:** a committed test that hashes the generated text against the `.md` files, or the generator's `--check`, because a string module is easy to corrupt with non-ASCII. Run `harness/m7-suites` and `wire.test.ts` after it, as a new generated module meets D14's front-end import boundary. Otherwise it is ready.

## 8. Unit-time budget

Added CPU, user + sys through `/usr/bin/time -p`, best of 3 to 5, on a machine with other lanes running (load 19-27), which inflates it:

| Added | First run | Second run |
|---|---|---|
| `metadata_temp_dir.test.ts`, new | 2.60 s | 2.93 s |
| `long_type.oracle.test.ts`, new | 1.60 s | 1.82 s |
| `overlap-source-order`'s own process | 1.96 s | 2.04 s |
| `stack.test.ts`, head minus base | 0.10 s | |
| `aarch64.oracle.test.ts`, head minus base | 0.49 s | 0.64 s |
| `vtable_static`, `alias_check.test.ts`, head minus base | about 0, within noise | |
| **Total** | **6.75 s** | **about 7.5 s** |

### F6

**Over 5 s in what I could measure,** where the handoff says "about 5 s". On a quiet host it is probably close to 5, from the lane's own 1.1 s per spawn: 4 spawns, plus 0.6 s, is 5.0 s. **I could not get a quiet machine, so that figure is an estimate and mine is an upper bound.** Measure at the wave's check. If it needs cutting, the two `metadata_temp_dir` cases are the most expensive. An empty `bun test` measured 0.0 s, so nothing needs subtracting for startup.

**Coverage lost by the savings: none that I can find.**

- `no_core` on `overlap`: the oracle output did not change in `6619a443`, it regenerates unchanged, and both of its mutations are still killed at this head.
- The dropped `metadata_temp_dir` case: the `-Zprint-type-sizes` and `-Zoffload` rows pass by hand above. They pass through the same `catch` today. If one moved outside it, no test would notice.

## 9. Samples and tests

`--sample 200`, agent `review-fixers-40`, `RUST_TS_REQUIRE_PROBES=1`, this head, `--jobs 5`:

| Suite | MATCH | Other |
|---|---|---|
| `mir` | 200 | |
| `mir-o2` | 199 | 1 UNSTABLE, not protected: `simd/intrinsic/inlining-issue67557-ice.rs` |
| `mono-ui` | 200 | |
| `check-ui` | 200 | |
| `tydump-ui` | 199 | 1 UNSTABLE, not protected: `conditionally-implemented-trait-long-type.rs` |
| `run-pass-miri` | 200 | |
| `miri-fail` | 199 | 1 UNPORTED, not protected: `tests/fail/rustc-error.rs`, E0423's text, item 5's stop |
| `run-pass-aux-miri` | 199 | 1 UNPORTED, not protected: `rust-log.rs` |

**DIFF 0, CRASH 0, TIMEOUT 0.** No protected case is off in any sample.

`bun test --timeout=60000` with `RUST_TS_REQUIRE_PROBES=1 CI=true` on `stack.test.ts`, `rustc_interface`, `rustc_driver_impl`, `rustc_lint`, `rustc_middle/ty`, `rustc_metadata`, `rustc_monomorphize`, `callconv`, `alias_check.test.ts`, `rustc_const_eval`, `compare_impl_item.oracle.test.ts`, `miri/borrow_tracker`: **1,085 pass, 0 fail**, across 94 files. `git status` empty afterwards here and in the upstream checkout. `tsc --noEmit -p .` clean, in the scratch worktree with the main checkout's `node_modules`, as this worktree has none. `coverage.ts --check --offline`: markers ok.

**`fc41b62b`, the nits:** read against each source. All comment moves, the dead assertion and the unused import check out. `resolve_memo_tcx` as a `WeakRef` keeps the memo's semantics: a collected target compares unequal and clears. I did not measure the cost of `deref` on that path, nor confirm the `TyCtxt` is actually freed, as other holders could exist.

## What I did not check

- The gate, or any full suite.
- Linux. `dash` as `/bin/sh` may behave differently from the macOS bash of section 1; the fix's design does not depend on it, as the shell gets an empty environment, but it was not run.
- A `--compile` bundle.
- Any budget figure on a quiet machine.
- The softfloat half of the `is_scalable_vector` guards, beyond reading.
- Whether the prototype of section 1 changes any suite.
- `integ-w39-recheck` N2-N6 and `miri-perf` N5: the handoff says they are outside this lane's files, and they are.
