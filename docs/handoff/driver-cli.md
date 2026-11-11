# driver-cli (wave 40j) — handoff

Porter lane. Pin `6f5da406b56c`. Base: `0ce28aa2`. Branch `t3/72cd2caa`. AC power throughout; no gate, no full suite.
Scope: scout-unported §5 Lane 1 and the §7 single cases.

## Result

Every request kind the brief names now runs and matches the oracle byte for byte (stdout, stderr, exit), checked
with the scratch script below (`clicmp.ts`, both sides with the same env):

| request | cases | MATCH | other |
|---|---:|---:|---|
| `--explain <code>` for all 518 codes in `rustc_error_codes/src/error_codes/` | 518 | 518 | |
| the same with `--color=always` (highlighter + term.rs) | 518 | 518 | |
| `--explain` edge forms (`e0004`, `0004`, `+0004`, `E0001`, `E9999`, `E10000`, `Ex`, `--color=never`) | 8 | 8 | |
| `-W help` / `-Whelp` / `-A help` / `-D help` / `-F help`, with and without a crate file, `--sysroot`, editions 2018/2024, x86_64-linux target | 10 | 10 | |
| `--print calling-conventions` (host, x86_64-linux, `=file`) | 3 | 3 | |
| `--print crate-root-lint-levels -Zunstable-options` on 100 tests/ui files with their `compile-flags` (every 21st of the 2,195 that have compile-flags and no revisions; `--target x86_64-unknown-linux-gnu --sysroot <oracle> --edition=<directive>`) | 100 | 99 | 1 UNPORTED: `tests/ui/track-diagnostics/track5.rs` stops at `std::panic::Location::caller (DiagLocation Display)` (`-Ztrack-diagnostics`, outside this lane) |
| crate-root-lint-levels extras (no `-Zunstable-options`, no input, `--cap-lints`, `-A/-W/-F` flags) | 4 | 4 | |
| `-Zls=root` and `-Zls=all` on 50 rmetas (47 oracle.rmeta of rmeta-ui, every 15th, + rmeta-core/alloc/std's) | 100 | 100 | |
| `-Zls` error paths (`.rs` input, stdin, unknown kind, two kinds, missing file) | 5 | 5 | |
| `-Zls=target_modifiers`/`all` on no_core rmetas built with `-Zsanitizer=address -Zretpoline -Ctarget-cpu=znver3 -Zregparm=3` (i686) and `-Zfixed-x18 -Zbranch-protection=bti` (aarch64) | 4 | 4 | |
| `-Zls=root` on the oracle sysroot's libcore rlib | 1 | 1 | both ICE (`MemDecoder exhausted`, exit 101), same text but the thread id |
| `--explain E0382` × `--color={always,auto,never}` × env `NO_COLOR=1`, `TERM=dumb`, `CLICOLOR_FORCE=1`, `CLICOLOR=0`, `RUSTC_COLOR=never` | 15 | 15 | |
| tty/pager branch through a pty (`script -q`), `PAGER=cat` and a missing pager × 3 colors | 6 | 6 | not reachable by the harness; checked by hand |
| `-Zmetrics-dir` | 1 | — | stdout/stderr/exit and the JSON file name match; the JSON holds wall-clock timestamps (differs by design) |

Regression samples (`RUST_TS_AGENT=driver-cli`, `--jobs 6`):
- `check-ui --sample 200`: MATCH 200/200 (`runs/20261111-024925-driver-cli-s5x6`)
- `rmeta-ui --sample 200`: MATCH 200/200 (`runs/20261111-025042-driver-cli-myjs`)

Unit tests: `bun test src/rustc_driver_impl src/rustc_errors` 348 pass (the 21 markdown tests among them, including
`test_output` against the blessed `output.stdout`); `bun test src/rustc_metadata src/rustc_session` 247 pass. `bunx tsc`
clean; `coverage.ts --check --offline`: markers ok.

## Files touched

- new `src/rustc_errors/markdown/{mod,parse,term}.ts`; new `src/rustc_errors/markdown/tests/{parse,term}.test.ts` and
  the fixtures `tests/input.md`, `tests/output.stdout` (verbatim copies of upstream's, see decision 4)
- new `src/rustc_driver_impl/highlighter.ts`
- `src/rustc_driver_impl/lib.ts`: `dump_feature_usage_metrics`, `handle_explain`, `show_md_content_with_pager`,
  `show_colored_md_content`, `list_metadata`, `describe_lints` (+ nested `sort_lints`, `sort_lint_groups`), the
  `CrateRootLintLevels` and `CallingConventions` branches of `print_crate_info`, and their call sites in `run_compiler`;
  file header updated
- `src/rustc_session/session.ts`: `DynLintStore::lint_groups_iter` marker (session.rs:84; a required trait method)
- `src/rustc_metadata/rmeta/decoder.ts`: `list_crate_metadata`'s `lang_items` and `target_modifiers` arms;
  `decode_TargetModifier` (+ `decode_OptionsTargetModifiers`, `decode_tmod_enum`)

## Coverage (`bun scripts/coverage.ts --missing <file>`)

| upstream file | before | after |
|---|---:|---:|
| rustc_errors/src/markdown/mod.rs | 0/4 | 4/4 |
| rustc_errors/src/markdown/parse.rs | 0/20 | 20/20 |
| rustc_errors/src/markdown/term.rs | 0/7 | 7/7 |
| rustc_errors/src/markdown/tests/parse.rs | 0/19 | 19/19 |
| rustc_errors/src/markdown/tests/term.rs | 0/2 | 2/2 |
| rustc_driver_impl/src/highlighter.rs | 0/3 | 3/3 |
| rustc_driver_impl/src/lib.rs | 30/43 | 38/43 (left: `install`, `config`, `process_rlink`, `init_logger_with_additional_layer`, `install_ctrlc_handler`: outside this lane, scout class (a)/(d)) |
| rustc_session/src/session.rs | 85/104 | 86/104 |
| rustc_abi/src/extern_abi.rs | 16/16 | 16/16 |
| rustc_metadata/src/rmeta/decoder.rs | 156/156 | 156/156 |

+64 fns in all.

## Findings

- **`rustc_abi::all_names`** was ported (extern_abi.ts:386, marker correct). The stop was a stale stub in
  `print_crate_info` written before it existed (`return unported("rustc_abi::all_names …")`); the branch now calls it.
- **`-Zls` LangItem**: `decode_LangItem` was already generated (lang_items.gen.ts) and used by `get_lang_items`; the
  `lang_items` arm only needed porting. **TargetModifier** had no decoder (below).
- `-Zls=root` on the oracle sysroot's libcore rlib ICEs on the oracle too (`MemDecoder exhausted`, cause not
  investigated); the port ICEs identically, so it is still a valid case; the rmeta suites' `oracle.rmeta` files are the better inputs.
- For harness-cli: pass `--color=always` as one argv item (or `--color`, `always` as two); my first try passed
  `"--color always"` as one item and both sides rejected it.

## `unported(...)` left

- added: `rustc_driver_impl::list_metadata (String::from_utf8(..).unwrap() on invalid UTF-8)` — unreachable (the
  buffer holds UTF-8 encodings of JS strings only); it stands in for the `unwrap` panic text, which I did not guess.
- kept: `rustc_driver_impl::process_rlink (-Z link-only)` and the pre-existing stops in `lib.ts` outside this lane
  (`CantEmitMIR`, `target-spec-json-schema`, the codegen backend's `--print` requests, `print_time_passes_entry`).
- removed: `handle_explain`, `describe_lints`, `list_metadata`, `dump_feature_usage_metrics`, `print_crate_info
  (--print crate-root-lint-levels)`, `rustc_abi::all_names`, and decoder.ts's three (`-Zls=lang_items`,
  `-Zls=target_modifiers`, `Decodable for TargetModifier`).

## `// PORT:` decisions (for root to record or overrule)

1. **markdown representation**: the parser's `&[u8]` buffers are `Uint8Array` views (`subarray`), so
   `wip_buf.len() - loop_buf.len()` still measures what was consumed; `MdTree`'s `&str` leaves are JS strings
   (`str::from_utf8(..).unwrap()` with upstream's panic). The `str` methods used on them (`trim`, `trim_end`,
   `ends_with(char::is_whitespace)`, …) use `char::is_whitespace` via local helpers, not JS `trim`; `u8::is_ascii_whitespace`
   excludes `\x0B` as Rust's does. `str::split` with a non-empty pattern is JS `split` (same pieces).
2. **term.rs `write_wrapping`** works on a `Str` (UTF-8 bytes) of its text, since upstream indexes it by byte
   (`char_indices`, `get(..break_idx + 1)`, `get(ws_idx + 1..)`, the last returning `None` after a multi-byte
   whitespace char). `CURSOR`/`WIDTH` thread-locals are module `let`s; `WIDTH_set` is for the unit test (which restores 140).
3. **Private items exported for tests**: parse.ts exports the fns/consts `tests/parse.rs` uses; term.ts exports
   `write_wrapping` and `WIDTH_set`.
4. **Test fixtures copied**: `tests/term.rs` reads `include_str!("input.md")` and the blessed `output.stdout`; copies
   sit next to the test so it never skips without `RUST_TS_DATA` (the gate rejects skips). `RUSTC_BLESS` rewrites the copy.
5. **Pager** (`show_md_content_with_pager`): `Command::spawn` + `write_all` to stdin + `wait` is one `Bun.spawnSync`
   (stdin = the bytes, stdout/stderr inherited). A failed spawn throws (→ `None`, as upstream); a failed write to the
   pager's stdin (pager exited early) is not observed, so that case does not fall back to stdout. `PAGER`'s `OsString` is
   compared and spawned as its lossy UTF-8. `cfg!(windows)` is `false` (as vendor/anstream). The branch matched the
   oracle through a pty (table above).
6. **std helpers kept local** (src/std is not this lane's): `str::parse::<u16>/<u32>` (leading `+` only, overflow →
   `Err`), `Path::extension`, `str::trim_prefix('E')`, `to_ascii_uppercase`. A later std batch could hoist them.
7. **`sort_by_cached_key`** → a stable sort on the precomputed `(Level discriminant, name)` key (`str_cmp` byte order).
8. **`MdStream`/`MdTree` `#[derive(Debug)]`** not ported (never printed outside a failing upstream unit test);
   `PartialEq` is `MdStream_eq`/`MdTree_eq`; the bun tests compare structurally.
9. **`decode_TargetModifier` is hand-written** in decoder.ts in the exact form the derive expands to (rustc_macros
   serialize.rs: fields in order; a 2..254-variant enum reads a `u8` tag; the one-variant `CodegenOptionsTargetModifiers`
   reads none), because tools/codegen does not emit the derives of the `options!`/`top_level_options!`-generated types
   (`TargetModifier`, `OptionsTargetModifiers`, the `$tmod_enum`s). PORTING §3 says metadata `Decodable`s are generated,
   so root should either record this exception or have a tools/codegen batch generate them (and the matching
   `Encodable`, still `unported` in encoder.ts:2888) and delete these three functions. Checked against oracle-built
   rmetas with 6 target modifiers across both option groups.

## Scratch comparison script (for harness-cli)

`clicmp.ts` (scratchpad; reproduced below). Usage: `WORKTREE=<repo> bun clicmp.ts <cases.json> <out-dir> --jobs 3`
(each job runs 2 processes). `cases.json` is `[{ "name", "args", "cwd"? }]`; the argv lists were generated as:

- `--explain`: every `E\d+.md` under `compiler/rustc_error_codes/src/error_codes/` (518), as
  `["--explain", code]` and `["--explain", code, "--color=always"]`.
- crate-root-lint-levels: tests/ui `.rs` files (sorted, `auxiliary/` excluded) with a `//@ compile-flags:` line and no
  `//@ revisions`, every `floor(2195/100)`-th; argv `--target x86_64-unknown-linux-gnu --sysroot <oracle sysroot>
  --edition=<//@ edition or 2015> <all compile-flags words> --print crate-root-lint-levels -Zunstable-options <abs path>`.
- `-Zls`: `find $RUST_TS_DATA/rmeta/rmeta-ui -name oracle.rmeta | sort | awk 'NR%15==1' | head -47` plus the
  rmeta-core/alloc/std `oracle.rmeta`; `["-Zls=root", f]`, `["-Zls=all", f]`.
- misc (`-W help` family, calling-conventions, `-Zls` errors): the table rows above; `main1.rs` is
  `#![allow(unused)] fn main(){}`, `libm.rlib` an oracle-built lib.

```ts
// clicmp.ts — run the oracle (rustc +<pin toolchain>) and the port (bun src/rust_ts/main.ts) on the same argv and
// compare stdout, stderr and exit status byte for byte.
//
// usage: bun clicmp.ts <cases.json> <out-dir> [--jobs N]
//   cases.json: [{ "name": string, "args": string[], "cwd"?: string }]
//   out-dir:    results.jsonl (one line per case) and diffs/<name>.{o,p}.{out,err} for DIFF cases
// env: WORKTREE (default: cwd's git root), PIN_TOOLCHAIN (default from UPSTREAM.json rust.toolchain).
// Both sides get the same environment: the caller's, plus RUSTC_ICE=0 RUSTUP_AUTO_INSTALL=0 RUST_BACKTRACE=0.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [casesPath, outDir, ...rest] = process.argv.slice(2);
if (!casesPath || !outDir) throw new Error("usage: bun clicmp.ts <cases.json> <out-dir> [--jobs N]");
const jobs = rest[0] === "--jobs" ? Number(rest[1]) : 4;
const WT = process.env.WORKTREE ?? process.cwd();
const pin = JSON.parse(readFileSync(join(WT, "UPSTREAM.json"), "utf8")).rust.toolchain as string;
const toolchain = process.env.PIN_TOOLCHAIN ?? pin;
const env = { ...process.env, RUSTC_ICE: "0", RUSTUP_AUTO_INSTALL: "0", RUST_BACKTRACE: "0" } as Record<string, string>;

interface Case { name: string; args: string[]; cwd?: string }
const cases = JSON.parse(readFileSync(casesPath, "utf8")) as Case[];
mkdirSync(join(outDir, "diffs"), { recursive: true });

async function run(cmd: string[], cwd: string): Promise<{ out: Uint8Array; err: Uint8Array; code: number }> {
  const p = Bun.spawn(cmd, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).bytes(), new Response(p.stderr).bytes()]);
  const code = await p.exited;
  return { out, err, code };
}

function firstDiff(a: Uint8Array, b: Uint8Array): string {
  const sa = new TextDecoder().decode(a).split("\n");
  const sb = new TextDecoder().decode(b).split("\n");
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    if (sa[i] !== sb[i]) return `line ${i + 1}: oracle ${JSON.stringify((sa[i] ?? "<eof>").slice(0, 120))} port ${JSON.stringify((sb[i] ?? "<eof>").slice(0, 120))}`;
  }
  return "identical lines (bytes differ)";
}

const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const results: { name: string; verdict: string; detail?: string }[] = [];
let next = 0;
async function worker(): Promise<void> {
  for (;;) {
    const i = next++;
    if (i >= cases.length) return;
    const c = cases[i]!;
    const cwd = c.cwd ?? process.cwd();
    const [o, p] = await Promise.all([run(["rustc", `+${toolchain}`, ...c.args], cwd), run(["bun", join(WT, "src/rust_ts/main.ts"), ...c.args], cwd)]);
    let verdict = "MATCH";
    let detail: string | undefined;
    if (p.code === 70 && o.code !== 70) {
      verdict = "UNPORTED";
      detail = new TextDecoder().decode(p.err).split("\n").find((l) => l.includes("unported")) ?? "";
    } else if (o.code !== p.code) {
      verdict = "DIFF";
      detail = `exit oracle ${o.code} port ${p.code}; stderr ${firstDiff(o.err, p.err)}`;
    } else if (!eq(o.out, p.out)) {
      verdict = "DIFF";
      detail = `stdout ${firstDiff(o.out, p.out)}`;
    } else if (!eq(o.err, p.err)) {
      verdict = "DIFF";
      detail = `stderr ${firstDiff(o.err, p.err)}`;
    }
    if (verdict !== "MATCH") {
      const base = join(outDir, "diffs", c.name.replace(/[^\w.-]/g, "_"));
      writeFileSync(`${base}.o.out`, o.out);
      writeFileSync(`${base}.o.err`, o.err);
      writeFileSync(`${base}.p.out`, p.out);
      writeFileSync(`${base}.p.err`, p.err);
    }
    results.push({ name: c.name, verdict, detail });
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
results.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(join(outDir, "results.jsonl"), results.map((r) => JSON.stringify(r)).join("\n") + "\n");
const counts: Record<string, number> = {};
for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
console.log(`cases ${results.length}: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
const classes = new Map<string, { n: number; first: string }>();
for (const r of results) {
  if (r.verdict === "MATCH") continue;
  const key = `${r.verdict} ${(r.detail ?? "").replace(/line \d+/, "line N").replace(/\d+/g, "#").slice(0, 160)}`;
  const c = classes.get(key);
  if (c) c.n++;
  else classes.set(key, { n: 1, first: `${r.name}: ${r.detail}` });
}
for (const [, c] of [...classes].sort((a, b) => b[1].n - a[1].n).slice(0, 15)) console.log(`  ${c.n}x ${c.first.slice(0, 300)}`);
```
