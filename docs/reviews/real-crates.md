verdict: APPROVE WITH NITS

Lane: real-crates (M7 preflight O4, O5, O6). Branch `t3/real-crates-metadata-bugs`, head `b95e1f2b`; lane commits `9f357e1e`, `b95e1f2b`. Handoff:
`docs/handoff/real-crates.md`. Plan: `docs/plan-m7.md` §5, `docs/reviews/plan-m7.md` F7.

I am read-only: this file is all I wrote to the tree. I did not run the gate or a full suite, and no oracle component changed. I used my own `RUSTC` wrapper and
comparer, not the lane's, then tested the lane's comparers separately. Scripts and logs: `$RUST_TS_DATA/tmp/review-real-crates/`. Load average was 28-64, so
compare CPU, not wall time.

**O6's conclusion stands. I tried to refute it and could not.** The 34 of 34 reproduces in both modes, the comparison reports planted differences, and O5 is right. The
jobserver port matches the oracle on 179 of the 185 values that reach it, and the other 6 are explained below. The `FD_CLOEXEC` rule is sound for descriptors above 2 and wrong for closed
stdio (F1). Nothing here should hold the merge. F1 and F2 are small, and F2 has to be done when the lane is merged.

## 1. O6: is every byte explained by the path?

Oracle against itself, in the plan's two directory names (`runcheck2.sh` confirms it used `t-check-or` and `t-check2`): **29 of 34 identical**, and the same 5 crates as the plan.
I replaced the path in the first build's bytes with the second's, then accounted for every byte left:

| Crate | Size | Bytes still different after replacing the path | What they are |
|---|---|---|---|
| `serde_core` | 2,731,568 vs 2,731,564 | 38, in 8 runs | Header offsets at 8 and 16, each exactly 4 apart. SVH at 24. The two length prefixes (`da01` vs `d801`). One 16-byte hash just after the second path occurrence. Two later offsets, each exactly 4 apart |
| `serde` | 526,933 vs 526,929 | 55, in 10 runs | The same kinds, plus `serde_core`'s SVH at 648 |
| `serde_json` | same size | 32, in 2 runs | Own SVH; `serde_core`'s SVH |
| `grep_printer` | same size | 64, in 4 runs | Own SVH; the SVHs of `serde_json`, `serde_core`, `serde` |
| `grep` | same size | 80, in 5 runs | Own SVH; the SVHs of `grep_printer`, `serde_json`, `serde_core`, `serde` |

I matched each dependency hash by finding the same 16 bytes in that dependency's own file. I identified the one remaining 16-byte hash and the offsets by position and size, not with a decoder: the hash
fits `SourceFile`'s `stable_id`, which is hashed from the name. The port being byte-identical at one path makes that identification unnecessary for the verdict.

I then looked for a path-sensitive port bug, which a comparison at a single path could hide:

| Check | Result |
|---|---|
| `cargo check -p serde_core`, oracle and port, at `.../t-check-or`, `.../t-check2`, `.../tgt-é-ü` | Identical at all three: `.rmeta`, `.d`, fingerprints, stderr |
| The 9-line program, `OUT_DIR` relative and absolute: both sides of the 127/128-byte length prefix, non-ASCII with a space, `..`, `./`, `--remap-path-prefix` | 26 of 26 identical |

`serde_core`'s size in my tree is 2,731,554, not the handoff's 2,731,444. My target path is 55 bytes longer, twice: the same mechanism. The plan's original port trees no longer exist, so its exact bytes cannot be
re-examined. That does not matter, as every symptom it recorded is reproduced with no port involved.

## 2. The 34 of 34

Full ripgrep tree, real `cargo check --target x86_64-unknown-linux-gnu`, `-j3`, `CARGO_INCREMENTAL=0`, one absolute target path moved aside after each side, wrapper written from scratch.
`rg` needs the whole tree, so this was all 34 crates, not a subset.

| | plain | `-Copt-level=3 -Zalways-encode-mir` |
|---|---|---|
| Files in the tree, oracle / port | 388 / 388, none missing or extra | 388 / 388, none missing or extra |
| `.rmeta` identical | 34 of 34 | 34 of 34 |
| Every other file (`.d`, fingerprints, `.json`, build-script outputs) | identical | identical |
| stdout, stderr, exit per compile | 49 of 49 named units identical, all exit 0 | 51 of 51 identical, all exit 0 |
| cargo's own output | identical once sorted and with timings removed | identical once sorted and with timings removed |
| Second `cargo check` on the port's tree | **0** compiler invocations, 0 `Checking` lines | not rerun |

My log keys cargo's probes by process, so their names differ between sides and they are not paired in that row. Their results are compared through `.rustc_info.json`, which is identical.

**Can it report a difference? Yes.**

| Plant | Result |
|---|---|
| Inliner thresholds set to 5 in a throwaway copy, `-p memchr` | **Plain: nothing differs. Opt: the `.rmeta` differs.** So the opt mode really tests optimized MIR, and the plain mode does not (F7 of the plan review) |
| Same copy, `rg`, `-Zunpretty=mir` | 6,927,058 vs 2,756,428 bytes: reported |
| Threshold 50 changed to 49 | Not reported, which is correct: the oracle's own `-Zinline-mir-threshold=49` gives the same hash on `rg` |
| The lane's `cmp.ts`, `cmpall.ts`, on copies of trees (its own; mine for the fingerprint): one bit in `memchr`'s `.rmeta`, a stderr line, a `.d` line, a fingerprint byte, a deleted `.rmeta` | All reported. Unplanted, on its own trees: 34 of 34 `.rmeta`, 35 of 35 stderr |

**`rg`:** the `.rmeta` is 0 bytes in both modes, so that row of the handoff says nothing about it, as the lane states. MIR against the port's own `.rmeta`s: **6,927,058 bytes, identical, stderr identical, 12,259 `inlined` lines.** The
handoff has 6,927,138. My environment was built by hand and its `CARGO_PKG_*` values differ. I did not trace the 80 bytes; both sides of each run are identical.

**What goes to the oracle.** The lane's rule, `case "$emit" in *link*`, routes exactly 10 compiles in this tree, all `build_script_build`, `--emit=dep-info,link`. All 44 others went to the port: the 34 crates, cargo's
`-vV` and `--print` probes, and the probes build scripts make through `$RUSTC` (`anyhow`'s, for one). So nothing that should reach the port goes elsewhere.

**Left untested by that rule:** the 10 build-script binaries and their `.o`, `.d` and fingerprints, so about 51 of the "388 identical" are the oracle against itself, and `build.rs` never meets the port's front end. I closed part of that:
all 10 `build.rs` with their own argv and `--emit=dep-info,metadata`, on the host target, gave identical output on both sides. `crossbeam-utils` exits 1 on both, because I did not supply an env var its build script reads. Codegen and link remain
for M7. See F3.

**Live jobserver:** 50 of 54 invocations saw `CARGO_MAKEFLAGS=-j --jobserver-fds=3,5 ...`; the other 4 are cargo's first probes, before it sets the variable.

## 3. O4: the jobserver port

**Against upstream.** Line by line with `rustc_data_structures/src/jobserver.rs` at the pin and `jobserver-0.1.34` (the version in upstream's `Cargo.lock`). Order, the matching of error kinds, `find_jobserver_auth`, `open`,
`from_fifo`, `from_pipe` with its priority of `NotAPipe`, and all 9 `Display` texts are faithful. All 5 `rustc:` and 10 `crate-pending:` markers name the right `fn` at the right line, by script. The deviations each carry a `PORT:` and are justified:
no token handling, no pipe from `Client::new`, the fifo opened once. The lane's claim that `Client::new`'s `expect` cannot fail in practice holds for a reason it does not give: `--jobs-backend` and `-Zthreads` reject anything above 255, so
the limit always fits the pipe. I checked that against the oracle.

**The `FD_CLOEXEC` rule.**

| Scenario | Result |
|---|---|
| Parent passes a real pipe without cloexec, at 24 numbers from 3 to 1000, each with its pair | Oracle and port silent. Includes 3 and 4, where Bun would otherwise sit |
| The same pipe with cloexec set in the parent | Closed by `exec`; both warn "cannot open" |
| Closed numbers: every one from 0 to 47, then 64 to 2147483647 | All match |
| One real descriptor and one closed that names Bun's (`3,4` with `exec 3<>ff`, and the reverse) | Match |
| Does Bun set cloexec on what it inherits? | No: inherited 3, 7 and 8 stay clear. Bun's own descriptor is the pipe it opens, at 3 or the next free number, and it has cloexec |
| Does Bun have a descriptor **without** cloexec, the case that would break the rule the other way? | None on macOS at any number from 0 to 255 in a small script, and none visible in the driver sweep up to 47 |
| **stdio closed by the parent** (`<&-`, `>&-`) | **Differs: F1** |

So the premise is right, since nothing that survives `exec` has the flag. But the conclusion, "so it is closed", fails where a runtime reopens stdio after `exec`. Linux semantics of cloexec are the same, but I could not test
Bun's descriptors there: the Docker daemon is down.

**Against the oracle, whole driver, stderr and exit code: 179 of 185 values that reach `initialize` match** (59 closed numbers plus 126 others; a further 41 stop at option parsing first, and match too, so I do not count them). Fifo: good, absent, directory, plain file, socket, `/dev/tty`, `/dev/null`, unreadable, symlink loop, over-long path, a path that crosses a file. Descriptors: pipes, files, stdin as a pipe.
Parsing: limits, signs, `-0`, leading zeros, non-ASCII digits, `1,2,3`. Value escapes: tab, newline, `\x7f`, U+0301, U+200B, U+202E, emoji, ANSI. Which variable wins: including an empty `CARGO_MAKEFLAGS`. Flags: JSON, ANSI JSON, short, `--color=always`, `-Awarnings`, `-Dwarnings`,
`--cap-lints`, a bogus target, `--edition=2099`. The 6 that differ:

- 3 are F1.
- 3 are `-Zthreads` above 1 or `--jobs-frontend=2`: the warning is identical, then `rustc_thread_pool` stops with exit 70, as it did before this lane.

**Non-UTF-8:** all 8 invalid forms I tried, including a surrogate, an overlong form and CESU, reach the `unported` stop (exit 70) rather than a wrong answer. A real U+FFFD stops too, as the handoff says. Oracle exit 0, port exit 70: honest, and rare.

**Tokens.** The port acquires nothing, and nothing observable differs:

| Check | Result |
|---|---|
| Pipe with 3 tokens, tokens left after a compile | Oracle 3, port 3 |
| Pipe with 0 tokens: does the compile block? | Neither blocks; 0 left on both |
| Real GNU make 3.81, `make -j4`, recipes with and without `+` | Exit 0 on both, no warning and no "INTERNAL ... jobserver tokens" message |
| Real cargo | Above: finishes, identical, fresh on the second run |
| Upstream | `Proxy::new` is reached only by the parallel path (`util.rs:252`), so a single-threaded oracle has no helper thread either |

Only one fifo jobserver form was tried: `fifo:` with a pre-made fifo, no fifo-mode make.

## 4. O5

Confirmed. `rustc_interface/src/util.rs:654`: `sess.opts.incremental.as_ref().map(..)`. Port `src/rustc_interface/util.ts:392`, same condition. `-Cincremental=...` stops with exit 70 at this site (oracle exit 0), and nothing in the tree hits it with `CARGO_INCREMENTAL=0`, `rg` included.

## 5. Tests and `crate-pending:`

`jobserver.oracle.test.ts` and `out_dir_path.oracle.test.ts` run the live oracle, so they cannot go stale; there are no hard-coded answers. 30 pass, 0 fail, with `RUST_TS_REQUIRE_PROBES=1`: 2.76 s user + 1.56 s sys = 4.3 s, under F5's 5 s.
Together with `interface.test.ts` and `driver.oracle.test.ts`: 79 pass. `bunx tsc`, `coverage --check --offline` clean; `--missing` jobserver 5/5.

`crate-pending:` is compliant with §1 (the lane may not edit `harness/`, and said so in its handoff) and not yet with §5b. **Coverage does not check those markers** (F2). I simulated the handoff's step in a throwaway worktree: with the crate in `scope.json` and the `sed`, `--check`
passes, vendor markers go from 5,076 to 5,086, and a wrong line is then rejected. Without the `scope.json` line, a `crate:` marker is rejected, as the handoff says. §5b also asks for the crate's unit tests. Those exercise tokens, which are out of scope under D11 and D15, so the 10 of 101
functions is what the plan intends.

## 6. Samples and reach

`--sample 200`, `RUST_TS_AGENT=review-real-crates`, on the lane's head:

| Suite | MATCH | Other |
|---|---|---|
| `check-ui` | 200 | |
| `rmeta-ui` | 200 | |
| `mir` | 200 | |
| `pm-ui` | 198 | 1 UNPORTED (`expand-expr.rs`, cross-thread proc macro), 1 UNSTABLE (`proc_macro_generated_packed.rs`, thread id in an ICE). Neither is protected nor about jobservers |
| `run-pass-miri` | 199 | 1 UNPORTED (`sync-send-in-std.rs`, `getaddrinfo`, plan-m6 D2) |

**Is the path reached by an existing suite?** `initialize` runs on nearly every compile, but only with the variables unset. Nothing in `tests/ui` or Miri's tests mentions `MAKEFLAGS` or a jobserver, and the oracle test files strip the variables. So `NoEnvVar` is all a suite reaches; everything else is reached only by the
new tests and, later, `check-rg`.

**Startup:** no measurable change. CPU over 12 alternating runs, median then minimum: base 1.183 / 1.112 s, lane 1.237 / 1.106 s; with a live pipe, so with `dlopen`, 1.202 / 1.098 s; with a bad value 1.273 / 1.125 s. The medians are within this load's noise. `bun:ffi` is already imported on the driver's path (`std/io.ts`, `std/env.ts`, `rust_ts/stack.ts`).

## Findings

### F1. LOW: a descriptor the runtime reopened on closed stdio reads as closed. `src/vendor/jobserver/unix.ts:146`, reasoning at `:125`-`:129`

Both runtimes reopen closed stdio on `/dev/null` after `exec`: Rust's std (`sanitize_standard_fds`, `library/std/src/sys/pal/unix/mod.rs:51`), and Bun, which sets `FD_CLOEXEC` on what it opens (measured: fd 0 `cloexec=1`, character device). So the oracle sees an open non-pipe and the port's rule calls it closed.

**Failing scenario:** `CARGO_MAKEFLAGS=--jobserver-auth=0,0 rustc --crate-type lib --emit=metadata x.rs <&-`

```
oracle: ... file descriptor 0 from the jobserver environment variable value is not a pipe
port:   ... cannot open file descriptor 0 from the jobserver environment variable value: Bad file descriptor (os error 9)
```

Likewise `1,1` with `>&-` and `1,0` with both. It is rare: it needs a jobserver variable naming stdio that the parent closed. Exit codes match.

**Fix, tried in a throwaway worktree:** `if (fd > 2 && runtime_owned_fd(fd))`. All 3 then match, and `3,4` and `0,1` still do. Update the comment, and add the 3 cases to `CASES`.

### F2. LOW, to do at merge: `crate-pending:` markers are not checked by anything. `src/vendor/jobserver/{error,lib,unix}.ts`

**Failing scenario:** I changed `unix.rs:90 open` to `unix.rs:9999 nonsense`: `bun scripts/coverage.ts --check --offline` still prints `markers ok`. They are right today; I checked all 10.

**Root:** add `"jobserver": "=0.1.34"` to `harness/scope.json` and run the `sed` in the same merge, before the next accept, so this does not outlive the lane. That file's own comment says changing it needs the owner's approval, where the handoff says only root. The `sed` is not enough alone: it also rewrites the
comments at `lib.ts:2` and `unix.ts:2` into "See error.ts on the `crate:` markers", which then point at a note the handoff says to drop. Remove those clauses too.

### F3. NIT: the handoff overstates what "identical" covers. `docs/handoff/real-crates.md`

"Every other file in the target tree is identical too" counts the 10 build scripts, which are the oracle on both sides. It says so only later, under "What the wrapper does". And "build scripts and their dependencies": this tree has no build-script dependencies. **`check-rg` will inherit the same blind spot until M7d** unless the suite says so; it should
count port-built files separately.

### F4. NIT: a wrong comment. `src/vendor/jobserver/unix.ts:59`

"so `99999999999x` is an invalid digit". The oracle says `number too large to fit in target type`, as the code does: overflow comes at the tenth digit, before `x`. An example that shows the point is `2147483647x`, which the oracle calls an invalid digit. The code and the test case at `jobserver.oracle.test.ts:66` are right.

### F5. NIT: the case the rule exists for is not in the test. `src/rustc_data_structures/jobserver.oracle.test.ts:43`

`CASES` covers closed `3,4` and live pipes at 5 and 6, but not a real descriptor at Bun's usual number. If Bun ever set the flag on inherited descriptors, or the rule were inverted, a live jobserver at 3 would warn wrongly, and cargo's own `3,5` is exactly that. I ran it and it matches. Add
`["--jobserver-auth=3,4", "exec 3<>ff; exec 4>&3"]` and `["--jobserver-auth=3,4", "exec 3<>ff"]`.

### F6. NIT, for `harness-m7a`: the comparer's gaps. `$RUST_TS_DATA/tmp/real-crates/cmp.ts`

Not committed, so not a finding on this branch, but `check-rg` is its natural successor. It lists stderr units only from the oracle's side, so an extra unit on the port's side goes unreported, and it records no per-unit exit code. Compare both ways, and compare exit codes.

### F7. NIT: small departures from upstream's shape

- `fcntl_check` is folded into `fd_check` and has no marker (`unix.ts:151`), though `FCNTL` is right there. The arm with `NotAPipe(fd, Some(err))` therefore cannot be reached and stops `unported` instead, which is allowed.
- `FromEnv_new_ok` and `FromEnv_new_err` call upstream's `var_value` `var_` (`lib.ts:27`, `:32`, PORTING §4).

## For root

1. Do F2 at merge. Fix F1 and F4 in a small follow-up, or at merge.
2. The handoff's recommendation stands: **`check-rg` builds both sides at one absolute path.** I confirmed the mechanism and that the port is not path-sensitive.
3. **Upstream checkout:** the 2 `rustc-ice-*` files are still there, and `difftest` prints `ERROR: the upstream checkout is not clean` on every run. They are dated 05:03 and are an ICE at `rustc_ty_utils/src/abi.rs:556`. I did not create them and left them, and I did not establish which lane did. Clear them before the gate.
4. Stale text, as the handoff says: plan-m7 §5 row O6, and "29 of 34 identical" in `docs/reviews/plan-m7.md` F7.

## What I did not check

- **Linux:** anything. The Docker daemon is down, so `libc.so.6`, `/dev/fd`, and Bun's own descriptors there are untried. Cloexec's semantics are POSIX; Bun's descriptors are the unknown.
- **Host target:** `aarch64-apple-darwin` through cargo; the lane was told x86_64 only. Only the `build.rs` files ran on the host, metadata only.
- **Windows.** `cargo check --release`, or `check` in the dev profile with incremental on, which stops at O5 by design.
- **Fifo jobservers from a real make ≥ 4.4:** the only make here is 3.81, so fifo cases are synthetic.
- **Closed stderr (`2>&-`):** the warning goes nowhere on the oracle, so there is nothing to compare, and I did not look at where the port's goes. F1's reasoning applies to fd 2 as well.
- **The lane's own runs:** I reran my own and tested its comparers on its trees, but did not rerun `wrap.sh` itself; I read it. Its `rgmir.py` environment and my hand-built one differ by the 80 bytes above.
- **The 33 hand-run values** in the handoff are not traced one by one; my 185 and its 27 test cases cover those classes.
- A decoder over the `.rmeta` differences in §1: position and size only, for the one hash and the offsets.
- Commits other than the lane's two; the rest of the branch comes from `integ-w39`, reviewed separately.
