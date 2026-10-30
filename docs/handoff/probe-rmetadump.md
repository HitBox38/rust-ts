# Handoff: probe-rmetadump (plan-m5 §4, D4: the rmeta oracle probe and the rmeta suites)

Branch `lane/probe-rmetadump`, base main `adaa9d4a`. This is a probe + harness batch, so root needs an independent review.
It ports no compiler code, so there are no `unported(...)` calls, no `// PORT:` decisions and no coverage change.

## Files touched

| file | what |
|---|---|
| `tools/probes/rmetadump/{Cargo.toml.in,main.rs}` (new) | rustc-dev probe: prints one `.rmeta` as stable text, one `== <key>` section per crate-root part, crate-level list and DefIndex |
| `scripts/rmeta-run.ts` (new) | the command both sides run: compiler + `-o <file>`, then the byte line (`--bytes`) and/or the probe (`--dump`) |
| `scripts/lib/split.ts` | `splitRmetaDump`, registered as splitter `rmetadump` |
| `harness/suites.ts` | `Suite.oracleKey` (new optional field); suites `rmeta-core`, `check-core`, `rmeta-ui`, `check-ui` |
| `scripts/difftest.ts` | one line: `cachePath` adds `{ oracleKey }` only for suites that set it, so no other key changes |
| `scripts/rmeta-run.test.ts`, `scripts/rmeta-split.test.ts` (new), `scripts/lib/split.test.ts` | tests (below) |

The setup rules say "never edit harness/ or scripts/", but the lane section says this lane changes them. I followed
the lane section. No baseline, oracle output or existing suite definition changed.

## The probe (`tools/probes/rmetadump`)

`rmetadump [--content] <file.rmeta> <rustc args>` (the header of main.rs has the details):

1. **Raw part.** It parses the file the way tools/probes/rmetaroot does, decoding each leaf with the oracle's own impls:
   - `root`: version, `CrateHeader`, scalars, array lengths, table lengths, `CrateRootUnhashed`;
   - `root.layout`: every position, plus the table widths;
   - `root.hash`: the SVH;
   - `crate_deps`.
2. **Session part.** It runs a `rustc_driver` session over `#![no_core] extern crate r#<name>;` with `--extern` set to the file. In
   `after_expansion` it prints:
   - 19 crate-level lists, through the oracle's queries;
   - a `def <def path>` section for every DefIndex. Each section has one row per table that has an entry for that def,
     in `define_tables!` order. Whether an entry exists is read from the raw table (an entry with no nonzero byte is
     the default). A fixed-size entry is printed as raw hex. A lazy entry is printed as the extern query's value, MIR
     through `MirWriter`;
   - `source_files`.
3. **Stable text.**
   - `with_no_trimmed_paths`.
   - Every span `(#n)` becomes its context's marks. Context numbers follow decoding order, which shifts after any
     difference, so they would otherwise cascade.
   - `allocN` is renumbered within each section.
   - Own printers for spans and idents.
   - A query that panics becomes a `!panic <msg>` row, and the dump goes on. The panic hook is silenced around the
     dump. A panic outside a row is an ICE of the whole run.
4. **Measured on the oracle's core rmeta** (54,314,115 B, same size as plan-m5 §1c):
   - output: 82,337 sections (82,313 DefIndexes), a 276 MB dump;
   - cost: 1.9 s user, 0.66 GB RSS;
   - quality: no `!panic`, empty stderr, and two runs are byte-identical.
5. **Measured on the 722 oracle-built ui rmetas:** all exit 0, empty stderr, no `!panic`. On average 34 sections and 21.5 KB per crate.
6. **Tables printed as `present` or `len=` only**, because no query reads them alone:
   - `variant_data` and `mut_restriction`: these are inside `adt_def`, which the `repr_options` row prints;
   - `doc_link_resolutions`, `live_args_for_alias_from_outlives_bounds`;
   - `module_children_*` and `ambig_module_children` as `len=`, plus one combined `module_children` row;
   - root-only items (their lengths or positions are still in `root` / `root.layout`): `target_modifiers`,
     `denied_partial_mitigations`, `interpret_alloc_index`, the hygiene tables, `def_path_hash_map`, the `source_map`
     table.

   `incoherent_impls` is printed for the simplified self type of every inherent impl of the crate.
7. A unit test checks `TABLES`, `ARRAY_TABLES`, `ROOT_ARRAYS` and the CrateRoot field order against the pinned
   `rmeta/mod.rs`, so drift is caught.

## Suites (all `milestone: "M5"`, unprotected)

| suite | mode | cases | wrapper | role |
|---|---|---|---|---|
| `rmeta-core` | split, heavy | `core` + 82,337 sections (`core\|def <path>[ @k]`, `core\|root`, ...) | `--dump` | encoder progress on core |
| `check-core` | single, heavy | 1 | `--bytes` | **D4 gate case**: stderr + exit + `rmeta: <size> bytes, sha256 <hex>` |
| `rmeta-ui` | single | 730 | `--dump` with `--content` | progress on small crates; MATCH = decoded content identical |
| `check-ui` | single | 730 | `--bytes` | byte identity of the same crates |

- **Byte compare (§4.4).** The rmeta is never printed. With `--bytes`, the subject side compares its file with the
  oracle's kept file. If they differ, it adds `rmeta: differs from oracle.rmeta (<size>, sha256 <h>) first at byte <n>`,
  so the first differing offset lands in the run directory's diff file. The files are kept in
  `$RUST_TS_DATA/rmeta/<suite>/<hash(id)>/{oracle,subject}.rmeta`, and rmeta-core keeps 2 × 54 MB there.
- **Checked:** rmeta bytes do not depend on the `-o` file name. Writing to `liboracle-1.rmeta`, `libsubject-99999.rmeta` and
  `--out-dir` gave identical files.
- **Cache key.** Both commands start with Bun, so `oracleVersion` alone would hash only Bun. `Suite.oracleKey` adds
  the wrapper's source, `rustcDriverHash()` and the probe binary. Checked: rebuilding the probe re-ran the oracle.
- **Corpus for rmeta-ui and check-ui:** every `tests/ui/**/auxiliary/*.rs` that builds alone as a plain lib. Aux crates
  are written to be loaded through their metadata, which is what an rmeta is for. The filter is static:
  - no directive other than `edition` or `no-prefer-dynamic`;
  - no `extern crate` other than std, core or alloc;
  - no `proc_macro` anywhere;
  - no `crate_type` attribute other than lib or rlib.

  That leaves 730 of 1,063 files. The argv is the expanded suite's (target, oracle sysroot, edition) plus
  `--crate-type lib --emit=metadata`, with session variables pinned. The oracle builds 722 of them; the 8 it rejects
  are `include!` fragments and stay as stderr/exit cases.
- **Why the two ui suites are single mode:** in split mode `--sample` does not reduce the number of runs, so a sample
  would compile all 730 crates. Single mode keeps the dev loop's `--sample` cheap.
- **Why ids are keyed by def path, not DefIndex:** a missing or extra def then shifts no other id. 18 core paths repeat
  (a trait and its derive macro, e.g. `def ::clone::Clone`), and `uniqueIds` gives the second one `@2`.

## Verification (RUST_TS_AGENT=root-f5de)

- `bun test scripts harness`: 75 pass, 0 fail. New tests:
  - wrapper arg parsing, byte compare and fake-compiler/probe runs;
  - `runSplit` end to end through the wrapper and the `rmetadump` splitter: MATCH, one def DIFF, UNPORTED spread to
    every section, probe ICE → CRASH, the `oracleKey` key part;
  - `splitRmetaDump`;
  - the table-list check.
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (23064; vendor 4680).
- **Existing suite unchanged:** `mir --sample 100` gave 99 MATCH + 1 UNSTABLE. All 100 statuses are identical to the
  same ids in gate-20261030-102229-root-fsro (0 changed).
- **New suites; the oracle side works, the subject is UNPORTED as expected:**

  | suite | result | subject cost | oracle cost |
  |---|---|---|---|
  | `rmeta-core` | 82,338 cases, all UNPORTED | 119 s wall / 151 s user / 7.2 GB | 6.4 s |
  | `check-core` | 1 UNPORTED | 91 s / 140 s user / 8.7 GB | 4.6 s; its cached text is `rmeta: 54314115 bytes, sha256 c65818a4…` |
  | `rmeta-ui --sample 100` | 99 UNPORTED + 1 MATCH | | |
  | `check-ui --sample 100` | 99 UNPORTED + 1 MATCH | | |

  The UNPORTED stop is `rustc_metadata::rmeta::encoder::encode_metadata (lanes encoder-a..d)` everywhere. The one MATCH
  is `inner_attr_file_mod_diagnostics_child.rs`, which both sides reject with the same error.
- Runs: `$RUST_TS_DATA/runs/probe-rmetadump-{mir-after,rmeta-core,check-core,rmeta-ui,rmeta-ui2,check-ui}`.

## For root to decide or record

1. The suite design above: four suites, `check-ui` added beyond the lane list as the small-crate D4 counterpart, the
   ui suites in single mode, the aux-crate corpus, def-path ids.
2. `Suite.oracleKey` is a new harness field, and `cachePath` uses it.
3. **mir-core:** adding a splitter changes `scripts/lib/split.ts`'s source hash, which is in every split suite's cache
   key. mir-core's oracle entry will be rebuilt once (about 6 s). Its statuses do not change.
4. **Assumption in the probe:** `SyntaxContext::from_u32` is `pub(crate)`, so the probe transmutes the `u32` (size
   asserted at compile time) to print a context's marks.
5. **Windows:** the wrapper forwards SIGTERM/SIGINT to its child. Bun's `kill()` on Windows does not deliver a signal
   the wrapper can catch, so a timed-out compiler could outlive the wrapper there. This matters only for heavy runs on
   the Windows host.
6. **When to protect:** rmeta-core gives about 82k cases once the encoder lanes land. That is a large baseline (similar
   to mir-core's 47k). Protect it when its first sections match.
