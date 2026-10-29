# M5 plan — check core → alloc → std

Source: the plan-m5 planner (design lane; it ports no code). Status: **proposed**. Root accepts or amends decisions
D1–D13 and records them with `bun scripts/state.ts record decision`.
Pin `6f5da406b56c` (1.101.0-nightly). Paths are relative to `compiler/` unless they say otherwise; `library/…` and
`src/bootstrap/…` are relative to the upstream checkout. `src/bootstrap` is not in the sparse checkout; it was read with
`git show HEAD:<path>` (the checkout is a `blob:none` partial clone). Line counts are `wc -l` at the pin. Fn counts are
`bun scripts/coverage.ts` on `lane/plan-m5` (base `bbbe6dd3`, 22,219 / 25,518 fns).

**How measurements were taken.** macOS arm64, 12 cores, 24 GB, oracle `rustc +nightly-2026-10-11`
(`1.101.0-nightly (6f5da406b 2026-10-10)`), port = `bun src/rust_ts/main.ts` at `bbbe6dd3`, both run from the upstream
checkout with the suites' env (`RUSTC_ICE=0 RUST_BACKTRACE=0`) under `/usr/bin/time -l` ("user" = user CPU of the
process and its waited children, "rss" = max resident set). The machine was shared with other lanes (load average
36–92 during the runs), so **wall times are inflated and noisy; user CPU is the comparable number** (bun's user CPU
exceeds its wall time because the GC runs on other threads). Scripts and outputs: `$RUST_TS_DATA/tmp/plan-m5/`
(`oracle.sh`, `cmp.sh` = same argv to both sides with stdout gzip'd and hashed, `port.sh`, `main-stack.ts` = main.ts
that prints the JS stack of an `Unported`, `std-cmd.sh`, `bs-std*.log`).

## 1. What the oracle does

### 1a. How bootstrap invokes rustc on library/ at the pin

`x check library` / `x build library` run `cargo` over `library/sysroot/Cargo.toml` (`std_cargo`,
src/bootstrap/src/core/build_steps/compile.rs:521; manifest and features at :655–:666) in `Mode::Std`, through the
rustc shim (src/bootstrap/src/bin/rustc.rs). What reaches rustc for core/alloc/std:

| flag / env | source | effect on a check build |
|---|---|---|
| `--crate-name <c> --edition=2024 --crate-type lib` | cargo; `edition = "2024"` in library/{core,alloc,std}/Cargo.toml (core :12, alloc :11, std :9) | semantic |
| `--target x86_64-unknown-linux-gnu` | cargo `--target` | semantic (cfgs, layout, `target_config`) |
| `-Zforce-unstable-if-unmarked` | `RUSTC_FORCE_UNSTABLE=1` for `Mode::Std` (builder/cargo.rs:1137–1138) → shim (bin/rustc.rs:180–181) | semantic (stability of unmarked items, staged_api checks) |
| `--emit=metadata` (check) / `dep-info,metadata,link` (build) | cargo | decides `should_codegen()` (rustc_session config.rs:931), hence MIR encoding (D5) |
| profile `dist` (inherits release: opt-level 3, no debug-assertions/overflow-checks, `codegen-units = 1`, `debug = 1`) | builder/cargo.rs:1503 `(Mode::Std, _) => Some("dist")`; library/Cargo.toml:60–64 | `-Copt-level=3` turns `cfg(debug_assertions)` off (config.rs:2961, cfg.rs:192; 24 uses in library/core/src) and changes `mir_opt_level`; tracked → SVH |
| `-Zinline-mir -Zinline-mir-preserve-debug -Zmir_strip_debuginfo=locals-in-tiny-functions` | builder/cargo.rs:1464–1484 (`Mode::Std` only) | MIR passes only; no effect without codegen except the dep-tracking hash (→ SVH) |
| `-Zmacro-backtrace`, `-Cprefer-dynamic`, `-Csplit-debuginfo`, `-Cembed-bitcode=no`, `-Clto=off`, `-Zcrate-attr=doc(html_root_url=…)`, `-Zunstable-options`, `--check-cfg=cfg(feature,values(any()))` + the `[lints.rust.unexpected_cfgs]` lists | builder/cargo.rs:1019, 1443, 1121, 848, 856; compile.rs:684, 699–700 | diagnostics / codegen / docs only (the crate-attr adds an attribute, so it does reach the AST and the rmeta attributes table) |
| std only: `--cfg backtrace_in_libstd` (library/std/build.rs:80), env `STD_ENV_ARCH=<arch>` (:82), `feature="…"` cfgs (`std_features`, src/bootstrap/src/core/session.rs:651: `backtrace`, `panic-unwind` by default), 13 `--extern` deps | std's build script and Cargo.toml | semantic |
| `--cfg=bootstrap` | only when the *building* compiler is stage 0 (builder/cargo.rs:90–97, :881) | **not** passed: the pinned nightly is the in-tree compiler for its own library. `git grep 'cfg(bootstrap)' library/{core,alloc,std}` finds 0 uses at the pin |
| `RUSTC_BOOTSTRAP=1` | builder/cargo.rs:1202 | none for a nightly (features are always allowed) |
| `--sysroot` | shim, bin/rustc.rs:144–146 | a stage sysroot that holds no target std while std is being built (see 1b) |

`cargo +nightly-2026-10-11 check -Zbuild-std=std -v` against a copy of the pinned `library/` (via
`__CARGO_TESTS_ONLY_SRC_ROOT`, with the `library/backtrace` submodule fetched at its pinned commit `d902726a`) shows the
same shape (logs `bs-std.log`, `bs-std2.log`); build-std adds `--cap-lints allow` and builds the 22 library crates with
`--emit=dep-info,metadata,link` even under `check`, so it is a source of argv, not the M5 command.

### 1b. The smallest oracle command that checks each crate

"Check" = `--emit=metadata`: `analysis` (passes.rs:1209), then `start_codegen` (passes.rs:1295), which calls
`rustc_metadata::fs::encode_and_write_metadata` (fs.rs:38) and skips codegen because `should_codegen()` is false
(passes.rs:1336–1348); `Linker::link` (rustc_interface/src/queries.rs:49) then calls the backend's `link` →
`link_binary` (rustc_codegen_ssa/src/back/link.rs:303), whose loop links nothing because `should_link()` is false
(config.rs:945). `-Zno-codegen` adds nothing on top. Proposed M5 argv (D1), run from the upstream checkout:

```
core : --crate-name core  --edition=2024 library/core/src/lib.rs  --crate-type lib --target x86_64-unknown-linux-gnu -Zforce-unstable-if-unmarked --emit=metadata
alloc: --crate-name alloc --edition=2024 library/alloc/src/lib.rs --crate-type lib --target … -Zforce-unstable-if-unmarked --emit=metadata
       --sysroot <empty dir> --extern core=<core.rmeta> --extern compiler_builtins=<compiler_builtins.rmeta>
std  : build-std's std argv (std-cmd.sh: features, --cfg backtrace_in_libstd, STD_ENV_ARCH=x86_64, 13 --extern) with --emit=metadata
```

Findings while building these:
- alloc with the oracle's sysroot fails: `error[E0152]: duplicate lang item in crate core: sized` (the injected
  `extern crate compiler_builtins` loads the sysroot's `libcore-7832d2fe4fa07f06.rmeta` next to `--extern core`). With an
  empty `--sysroot` it needs `compiler_builtins` (`E0463`), built by the oracle from
  library/compiler-builtins/compiler-builtins/src/lib.rs (8,756 lines) with build-std's cfgs (`feature="arch"`,
  `"compiler-builtins"`, `"default"`, `"unmangled-names"`, `intrinsics_enabled`, `f16_enabled`, `f128_enabled`,
  `mem_unaligned`; 0.55 s user). So every M5 case after core has **aux crates built by the oracle** (M2 D5 pattern).
- std needs `library/backtrace` (a git submodule; `std/src/lib.rs` `#[path]`s into it), which is not in the sparse
  checkout: `error: couldn't find file …/library/backtrace/src/lib.rs`. Adding it is an `UPSTREAM.json` / scripts
  change (D2).
- std's deps include crates.io crates (libc 0.2.189, hashbrown 0.17.1, cfg-if, rustc-demangle, addr2line, object, gimli,
  miniz_oxide, adler2, memchr) at the versions in library/Cargo.lock; they are aux crates built by the oracle.
- `--emit=metadata -o -` streams the rmeta to stdout (`OutFileName::Stdout`, fs.rs:92): verified, the first bytes are
  `rust\0\0\0\x0b` (`METADATA_HEADER`, rmeta/mod.rs:77, version 11 at :69).

### 1c. Oracle measurements

| command (oracle) | exit | stdout / output | user CPU | max RSS |
|---|---|---|---|---|
| core `--emit=metadata` (×2) | 0, no stderr | libcore.rmeta 54,314,115 B; **the two runs are byte-identical** (`cmp`) | 7.6–8.0 s | 0.95–1.1 GB |
| core, dist-like flags (1a table) | 0 | 54,226,896 B, differs from the plain one from byte 9 (the SVH) | 8.0 s | 0.8 GB |
| core `--crate-type bin -Zcrate-attr=no_main --emit=metadata` | 0, no stderr | no rmeta (`needs_metadata()` false, ty/context.rs:1132) | 5.1 s | 1.05 GB |
| core `-Zunpretty=expanded` | 0 | 22,521,493 B | 1.35 s | 0.6 GB |
| core (bin, no_main) `-Zunpretty=hir-tree` | 0 | 1,560,663,349 B | 23.5 s | 2.1 GB |
| core `-Zunpretty=thir-tree` | 0 | 1,564,056,577 B | 10.9 s | 1.1 GB |
| core `-Zunpretty=mir` | 0 | 46,837,206 B; 50,239 bodies (`^}$`) | 6.2 s | 1.1 GB |
| compiler_builtins `--emit=metadata` (aux of alloc) | 0 | 1,582,118 B | 0.55 s | 0.2 GB |
| alloc `--emit=metadata` | 0, no stderr | 4,648,828 B | 1.26 s | 0.29 GB |
| alloc `-Zunpretty=mir` | 0 | 5,028,959 B; 4,092 bodies | 1.45 s | 0.28 GB |
| std `--emit=metadata` (build-std argv) | 0; 1 warning (`extern crate panic_abort is unused`, from build-std's `--force-warn=unused_crate_dependencies`) | 6,084,691 B | 1.58 s | 0.34 GB |

`-Ztime-passes` on core (`--emit=metadata`; shares of the 51.5 s wall under load): type_check_crate 36%,
MIR_borrow_checking 21%, expand_crate 13%, coherence_checking 10%, resolve_crate 7%, generate_crate_metadata 6%,
misc_checking_1 4%, misc_checking_3 2%. Sources: library/core/src 177,276 lines, alloc 69,001, std 153,280 (`cat | wc -l`;
most of core's time is library/stdarch's `core_arch`, which core includes by `#[path]`).

### 1d. What `encode_metadata` needs on the check path

- `encode_metadata` (encoder.rs:2557) → `with_encode_metadata_header` (:2664): header, `rustc_version` string, then
  `encode_crate_root` (:651), which walks every table (`encode_def_ids` :1482, `encode_mir` :1892, impls :2291,
  incoherent impls :2352, lang items :2260, hygiene :2036 (must be last before the source map), source map :581,
  def-path hash map :577, crate deps :2175, `dependency_formats` :2403, native libs :2024, target modifiers :2210,
  stability :1976, exported symbols :2394, …).
- `should_encode_mir` (:1181): without codegen only `mir_for_ctfe` of consts, ctors and const fns is encoded;
  `optimized_mir` only with `-Zalways-encode-mir`. But `encode_mir` still calls `tcx.reachable_set(())` (:1898,
  rustc_passes/src/reachable.rs:461).
- Exported symbols are empty without codegen (rustc_codegen_ssa back/symbol_export.rs:56, :188, :303), so no symbol
  mangling or monomorphization is reached.
- **The SVH is a hash of the bytes.** `-Zmetadata-crate-hash` defaults to true (rustc_session options.rs:2672): the
  crate hash is XXH3-128 (vendor `twox-hash` 2.1.2, encoder.rs:46) over every flushed metadata byte, seeded with a
  fingerprint of `sess.opts.dep_tracking_hash(true)` and `compute_hir_hash` (encoder.rs:2670–2700,
  rustc_middle/src/hir/map.rs:1288). It is written into the header at the end (:2769). So two rmetas with one differing
  byte differ in the SVH too, and the SVH is part of every downstream crate's `CrateDep` (encoder.rs:2185).
- HIR hashing stays on for lib crates: `needs_hir_hash()` includes `needs_metadata()` (ty/context.rs:1142); the combined
  `opt_hash` is skipped by default (`needs_owner_info_hash`, :1175) but the per-owner node/attr hashes are not.
- After encoding: `CrateInfo::new` (rustc_codegen_ssa/src/base.rs:1020: `dependency_formats`, `native_libraries`,
  `used_crate_source`, …), `Linker::link` → backend `link` → `link_binary` (no-op loop for metadata-only).
- No `potential_query_instability` sites in encoder.rs, dependency_format.rs, native_libs.rs or reachable.rs (1 in
  rustc_codegen_ssa base.rs). The only parallelism (`par_for_each_in`/`par_join`, encoder.rs:2429, :2613) is a prefetch
  under `-Zthreads`, which changes nothing.

### 1e. What "matching metadata-level behaviour" should mean

| candidate | catches | progress signal | cost |
|---|---|---|---|
| zero diagnostics + exit code | false errors/lints in analysis | one bit per crate | free (stderr suites exist) |
| `-Zunpretty=hir-tree/thir-tree/mir` on core | divergences in lowering / THIR / optimized MIR of every body | per body if split (D6): 50,239 MIR bodies in core | outputs are 47 MB (mir) to 1.56 GB (hir/thir); MIR is the only practical one |
| encoded-metadata dump through a probe | every table entry the oracle's decoder sees, by DefIndex | per table × DefIndex | one new probe (`rmetadump`, the rmetadefs/rmetatydump/rmetaroot pattern) |
| byte-identical `.rmeta` | everything incl. layout, shorthands, lazy positions, AllocId and span encodings, SVH | none by itself (the SVH makes it all-or-nothing) | free once the dump matches |

**Recommendation: the M5 gate is byte-identical `.rmeta` plus identical stderr and exit code, per crate (core,
alloc, std), with the probe dump and the split MIR suites as the ratcheting progress signal.** Reasons:
- The oracle is byte-deterministic (two runs identical, 1c) and the port is line-by-line, encoder included; nothing in
  the encoder iterates hash maps (1d). A port that matches the dump but not the bytes has a real bug (shorthand
  positions, lazy-distance encoding, LEB128, table widths), and downstream crates would see a different SVH.
- A dump through the **oracle's** decoder also proves that the port's rmeta is loadable by rustc, which is the
  functional meaning of "metadata-level". A dump alone misses layout-only bugs; bytes alone give no localisation.
- Zero diagnostics alone accepts silent divergences (a wrong `type_of` encoded without any error). The `-Zunpretty`
  dumps skip the encoder entirely.

## 2. Where rust-ts stands today (main `bbbe6dd3`)

| command (port, same argv as the oracle) | result | user CPU | max RSS | vs oracle |
|---|---|---|---|---|
| hello.rs (2 lines) `-Zunpretty=mir` | MATCH-shaped output (69 lines) | 1.5–1.8 s (startup ≈ 0.9 s: an empty-input run takes 0.93 s user) | 0.32 GB | oracle 0.02 s |
| hello.rs `--crate-type lib --emit=metadata` | exit 70 `rustc_interface::queue::Linker::codegen_and_build_linker (analysis, codegen; M3+)` (rustc_driver_impl/lib.ts:322) | 1.5 s | 0.33 GB | |
| core `-Zunpretty=expanded` | **byte-identical** (22,521,493 B, sha c9a1cadb503a) | 46.2 s (29.8 s wall) | 5.3 GB | 34× user, 9× RSS |
| core (bin, no_main) `-Zunpretty=hir-tree` | **byte-identical** (1,560,663,349 B, sha d35801f7aa9e) | 56.6 s (59 s wall) | 6.7 GB | 2.4× user (oracle time is mostly printing) |
| core `--crate-type lib --emit=metadata` (×2) | exit 70 `StableHash without a TS impl` at `stable_hash_InlineAsmRegOrRegClass` (src/rustc_hir/stable_hash.gen.ts:1494, from `stable_hash_InlineAsm` ← `ExprKind` ← HIR hashing of a lib crate, 1d) | 54–58 s (39–116 s wall) | 4.6–5.6 GB | |
| core (bin, no_main) `--emit=metadata` | exit 70 inside `analysis`, in CTFE: `rustc_middle::query::keys: QueryKey for (ValidityRequirement, PseudoCanonicalInput<Ty>) (cache)` from `call_intrinsic` (src/rustc_const_eval/const_eval/machine.ts:408; the `check_validity_requirement` query of the `assert_inhabited`/`assert_zero_valid`/`assert_mem_uninitialized_valid` intrinsics; keys.rs is 56/63) | 294 s (838 s wall under load) | 8.1 GB | 58× user, 7.7× RSS — and not finished |

So parsing, expansion, name resolution and AST→HIR lowering of all of core already match byte for byte. The first stop
of the lib check is a codegen gap (StableHash of `rustc_target::asm` register types; there are 13 such
`unported_stable_hash` sites: rustc_hir 3, rustc_attr_ir 6, rustc_middle ty 4). alloc and std were not run on the port:
they need a port-loadable core rmeta from the oracle (they decode it like the sysroot's) and the same gaps first.

**Performance is the main blocker.** Expansion alone is 34× the oracle's CPU and 5.3 GB; on the oracle, expansion is 13%
of a core check and typeck + borrowck 57%. If the port keeps its 3–40× ratio over the rest of `analysis` (thirdump of
mini_core.rs was ~3.2 s vs well under 1 s, plan-m4 §6), a core check will cost minutes of CPU and well over 8 GB (measured: the bin check had spent 294 s user and reached 8.1 GB when it stopped in CTFE), against
the suites' 60 s per-case timeout and 12 parallel workers (12 × 6+ GB does not fit in 24 GB).

## 3. Inventory (what is unported on the check path)

| area | lines | ported | needed for M5 |
|---|---|---|---|
| rustc_metadata rmeta/encoder.rs | 2,909 | 0 / 95 | all (EncodeContext, `encode_crate_root`, every `encode_*`, `with_encode_metadata_header`, `encode_metadata`) |
| rustc_metadata fs.rs, dependency_format.rs, native_libs.rs, foreign_modules.rs | 143 + 502 + 339 + 28 | 0/5, 0/6, 0/6, 0/1 | all (`encode_and_write_metadata`, `dependency_formats`, `native_libraries`, `foreign_modules`) |
| `Encodable` impls | 742 `derive(*Encodable*)` sites + 105 hand impls (`impl … Encodable<…>`, `SpanEncoder`, `TyEncoder`) across rustc_span/middle/type_ir/hir/ast/…; 49 `rustc-skip:` markers today | 0 | the encode half of every type that appears in metadata (D3) |
| rmeta/table.rs, def_path_hash_map.rs, rmeta/mod.rs, decoder.rs | — | 39/39, 3/3, 18/18, 156/156 | done (the `FixedSizeEncoding` write side is in table.ts) |
| vendor twox-hash 2.1.2 | 4,749 total; xxhash3 + xxhash3_128 + streaming + large/scalar + secret ≈ 2,280 | ★ | XXH3-128 streaming (D8) |
| rustc_session config.rs `DepTrackingHash` impls | config.rs:3400–3592 (9 fns) | 122/136 | the SVH supplement (`dep_tracking_hash(true)`) |
| rustc_passes reachable.rs | 530 | 0 / 16 | `reachable_set` (encoder.rs:1898) |
| rustc_passes hir_id_validator.rs, input_stats.rs | 16 + 72 fns | 0 | no (debug builds / `-Zinput-stats`) |
| rustc_interface queries.rs `Linker`, passes.rs `start_codegen`, util.rs `DummyCodegenBackend` | — | 0/2, 27/29, 9/21 | `Linker::{codegen_and_build_linker, link}`, `start_codegen`; backend stand-in (D7) |
| rustc_codegen_ssa | 1091 fns | 48 (4.4%) | base.rs `CrateInfo::new` (:1020) + `eii_linkage_needed`/`collect_eii_linkage`, back/link.rs `link_binary` (:303) metadata-only path and its small helpers (`invalid_output_for_target`, `check_file_is_writeable`, `out_filename`), back/symbol_export.rs providers' early exits (`reachable_non_generics_provider`, `exported_*_symbols_provider_local`) + `provide`; ≈ 1.2k lines. Not M5: mir/*, traits/*, back/{write, linker, archive, lto, metadata}, mono_item, debuginfo (M7) |
| rustc_target | 930 fns | 284 (30.5%) | nothing on the x86_64-linux path: the 646 missing fns are other targets' spec/asm/callconv files; `spec/mod.rs` 87/97 and `json.rs` 1/9 only matter for JSON targets |
| rustc_data_structures | 960 | 536 (55.8%) | svh.rs (5 fns) and the `StableHash` gaps; unord.rs (0/81) is realised as `Map`/`Set` (PORTING §5); profiling, jobserver, flock, sync/* are erased |
| rustc_middle dep_graph/* | graph.rs 12/62, serialized 0/39, dep_node 0/16 | — | `with_task`/`assert_ignored`/`metadata_dep_node` on a disabled graph only (non-incremental) |
| rustc_query_impl | 90 fns | 47 | nothing new (execution/job leftovers are incremental/parallel) |
| HIR/attr/ty `StableHash` codegen gaps | 13 `unported_stable_hash` sites | — | yes, first (D9) |
| rustc_middle query/keys.rs | — | 56 / 63 | the `QueryKey` for `check_validity_requirement`'s key (second stop, §2) and any other missing key core reaches |

About 12–14k upstream lines in all (encoder 2.9k, fs/deps/native/reachable 1.5k, codegen_ssa subset ~1.2k, twox-hash
~2.3k, ~4–5k of hand `Encodable` impls and encoder-side codec in rustc_middle/rustc_span), plus the Encodable codegen and
the harness work. The size of M5 is not porting: it is **finding and fixing divergences across 177k lines of core, and
making the port fast and small enough to run it**.

## 4. Suites and gates

Today's harness runs one process per case (`single`) or many files per process (`batch`, harness/suites.ts:28–31),
with a 60 s subject timeout and 12 workers. M5 needs:

1. **A `split` suite mode**: one process per *run*, whose stdout (or a probe's dump of an output file) is split into many
   cases by a suite-provided splitter; each piece is MATCH/DIFF on its own and enters the protected set on its own. Case
   ids must not shift when a block is missing or extra: id = block header + occurrence index among equal headers (core's
   MIR has duplicate headers, e.g. two `fn build_check_ensures(_1: C) -> C {`). A run-level failure (TIMEOUT, UNPORTED,
   ICE) marks every case of the run with that status.
2. **A heavy resource class**: core-sized runs execute serially (one at a time, not alongside the 12 workers), with a
   subject timeout of ~1,800 s and the oracle's 300 s; the gate prints their wall/user/RSS. The 60 s limit stays for
   every other suite.
3. **Oracle-built aux chains** (M2 D5): compiler_builtins against the oracle's core rmeta; std's 13 deps against the
   oracle's core/alloc rmetas, with their build-std argv, `STD_ENV_ARCH`, features and cfgs; cached by
   `rustcDriverHash()` + sources + argv like `oracleAuxRmeta` (harness/suites.ts:589). Sparse checkout gains
   `library/backtrace` at its submodule commit; crates.io deps come from `library/Cargo.lock` via `scripts/crate-src.ts`.
4. **Binary outputs**: the rmeta is compared by bytes (size + sha + first differing offset in the run directory), never
   printed into a diff.

Proposed suites (all `milestone: "M5"`; the case counts are measured above):

| suite | mode | cases | oracle / subject | role |
|---|---|---|---|---|
| `mir-core` | split | 50,239 MIR bodies of `-Zunpretty=mir` on core (lib argv of 1b) | rustc / main.ts | M5a progress (analysis + optimized MIR of every body) |
| `mir-alloc`, `mir-std` | split | 4,092 / (not measured) bodies | rustc / main.ts | M5b/M5c progress |
| `rmeta-core`, `rmeta-alloc`, `rmeta-std` | split | one case per (table, DefIndex) row and per crate-root field, from a new `rmetadump` probe run over each side's rmeta | probe over oracle rmeta / same probe over port rmeta | M5 progress on the encoder |
| `check-core`, `check-alloc`, `check-std` | single (heavy) | 1 each: stderr + exit + rmeta bytes | rustc / main.ts | **the gate** |
| `check-core-bin` | single (heavy) | 1: core as `--crate-type bin -Zcrate-attr=no_main --emit=metadata` (stderr + exit) | rustc / main.ts | M5a: full `analysis` of core without the encoder (oracle 5.1 s, no stderr) |
| `check-core-dist` | single (heavy) | core with the dist-profile flags of 1a | rustc / main.ts | report only |
| `check-chain` | single (heavy) | alloc checked by the **oracle** against the **port's** core rmeta | rustc with port aux | report: proves the port's rmeta loads |

`rmetadump` (tools/probes, rustc-dev, the rmetadefs/rmetatydump pattern): loads one rmeta as `--extern` into an empty
crate and prints, in DefIndex order, every per-def table the oracle's cstore answers (`def_kind`, `def_span`,
`def_ident_span`, `visibility`, `type_of`, `fn_sig`, `generics_of`, `predicates_of`, `explicit_*`, `variances_of`,
`attributes`, `mir_for_ctfe`/`promoted_mir` via `-Zunpretty`-style printing, `const_param_default`, `lookup_stability`,
…) plus the crate-level lists (lang items, diagnostic items, impls, incoherent impls, traits, native libs, crate deps,
target modifiers, stripped cfgs) and `rmetaroot`'s header/positions. Because both sides' rmetas are read by the oracle's
decoder, a port rmeta that the oracle cannot decode shows as a run-level ICE, which is itself a finding.

Plausible shares and gates:
- **M5a**: core's lib check reaches `encode_metadata`; `check-core-bin` MATCH; `mir-core` ≥ 95% of bodies. MIR build,
  borrowck and the level-1 passes are already at 97.4% on tests/ui (`mir` suite), so most bodies should match once
  analysis completes; the risky parts are const eval of core's consts, SIMD intrinsics in core_arch, and AllocId
  numbering across 50k bodies (plan-m4 D13).
- **M5b**: `rmeta-core` ≥ 99% and `check-core` MATCH (bytes); `mir-alloc` ≥ 95%.
- **M5c (= M5)**: `check-core`, `check-alloc`, `check-std` MATCH (stderr, exit, rmeta bytes); no protected loss.
- Report only: `check-core-dist`, `check-chain`.

## 5. Decisions and waves

**D1. The M5 command is the minimal bootstrap-faithful argv of 1b, not cargo's.** Semantic flags only (crate name,
edition 2024, `--crate-type lib`, target, `-Zforce-unstable-if-unmarked`, std's features/cfgs/env), `--emit=metadata`,
default opt level. Every extra tracked flag feeds `dep_tracking_hash` and so the SVH (1d), which the port must then model
too; the dist-profile argv is a report suite (`check-core-dist`). Rejected: build-std argv (`--cap-lints allow`,
`--force-warn=unused_crate_dependencies`, `-Cmetadata` hashes chosen by cargo).

**D2. alloc and std get oracle-built aux crates and an empty sysroot.** Measured: the oracle's sysroot makes alloc fail
with E0152 (1b). compiler_builtins and std's 13 deps are built by the oracle against the oracle's core/alloc rmetas, so
each M5 case is independent of the port's other cases. `library/backtrace` (submodule `d902726a1dcd…`) is added to the
sparse checkout; crates.io deps at `library/Cargo.lock` versions. Harness + `UPSTREAM.json` batch (reviewed).

**D3. `Encodable` comes from tools/codegen, mirroring `Decodable` (decision 2026-10-13).** The 742 derive sites
(`Encodable`, `Encodable_NoContext`, `TyEncodable`, `MetadataEncodable`, `BlobEncodable`, `LazyEncodable`) are
generated; the ~105 hand impls (`SpanEncoder for EncodeContext`, `TyEncoder`, `Span`, `Symbol`, `DefId`, `AllocId`,
`SyntaxContext`, `ExpnId`, `Fingerprint`, `Svh`, …) are ported by lanes. PORTING §3's "Encodable … skipped" clause ends
for types reached from metadata; the 49 existing `rustc-skip:` Encodable markers are converted. Contract-first
(✱encode-contract).

**D4. Gate criterion = byte-identical rmeta + identical stderr/exit (1e).** Progress through `rmeta-*` (probe dump) and
`mir-*` (split MIR); `check-core-bin` gates analysis before the encoder exists.

**D5. M5 keeps `should_codegen() == false`.** Only `mir_for_ctfe`/promoteds are encoded; `optimized_mir` encoding,
exported symbols, mangling and monomorphization stay M7 (they are reached only with `link` output).

**D6. Split-mode harness for core-scale outputs (§4.1–4.2).** Without it, core is one case and gives no ratchet; with
it, `mir-core` alone is 50k protected cases. Harness batch, reviewed as such.

**D7. The codegen backend is a rust_ts stand-in for LLVM's metadata-level answers.** The oracle uses the LLVM backend
(`CFG_DEFAULT_CODEGEN_BACKEND`, rustc_interface/src/util.rs:369–392); upstream's `DummyCodegenBackend` (:400) differs
from it (`supported_crate_types` returns only Rlib/Executable, :431; its `target_config` has no LLVM features). The port
already generates LLVM's `target_config` for the target (src/rust_ts/target_config.gen.ts). Recommended:
`src/rust_ts/codegen_backend.ts` implements `CodegenBackend` with LLVM's `supported_crate_types`/`target_config`/
`target_cpu` for x86_64-linux, `codegen_crate` = `unported(…)` (unreachable for `--emit=metadata`), and `link` =
rustc_codegen_ssa `link_binary` (as `LlvmCodegenBackend::link` does). `DummyCodegenBackend` itself is ported verbatim
for `-Zcodegen-backend=dummy`.

**D8. XXH3-128 via vendored `twox-hash` 2.1.2, scalar path only.** Port xxhash3.rs, xxhash3_128.rs, xxhash3/streaming.rs,
large.rs + large/scalar.rs, secret.rs (≈ 2.3k lines) with its tests; the SIMD paths (neon/sse2/avx2) are `crate-skip`
(they compute the same digest). u64 lanes as pairs of u32 or `bigint` with a `// PORT:`; the choice is measured on core's
54 MB (the oracle's whole `generate_crate_metadata` is 6% of its check). Validate with the crate's own vectors and an
oracle probe hashing fixed byte strings.

**D9. Close the 13 `unported_stable_hash` codegen gaps first.** They stop every lib crate with inline asm (core's first
stop, §2). tools/codegen batch + `StableHash` for rustc_target `InlineAsmReg`/`InlineAsmRegClass`.

**D10. Performance is a first-class workstream with its own lanes and numbers.** Targets for a core check (lib,
`--emit=metadata`) on an idle machine: ≤ 15 min user CPU and ≤ 12 GB RSS for M5a, then ratcheted down. Measured hot
spots to profile first: expansion (46 s user vs 1.35 s), the 5.3 GB already live after expansion (AST + token streams +
interners), then typeck/borrowck per body. Tools: `bun --cpu-prof` (already used by perf lanes), `-Ztime-passes` on
both sides (the port's `sess.time` labels are upstream's). Bundling the port (queued since wave 13) cuts the 0.9 s
startup of the 50k-case suites' single runs. No algorithmic redesign: perf fixes keep upstream's logic (PORTING §7);
representation changes (D6 of plan-m4 style) need a recorded decision.

**D11. Memory: run core under an explicit heap budget and fail loudly.** Bun (JSC) has no V8-style `--max-old-space-size`;
the heavy class runs one process at a time and records max RSS per run (gate output). An RSS over budget is a
reported regression, not a timeout.

**D12. Chained checks are a report, not a gate.** `check-chain` (oracle checks alloc against the port's core rmeta)
proves loadability; port-built chains (port core → port alloc → port std) wait until `check-core` matches, because a
single byte difference changes every downstream SVH (1d).

**D13. tests/ui suites stay as they are.** M5 adds no ui suites; the protected tydump/thirdump/mir/borrowck suites must
not regress while encoder-side code lands (Encodable codegen touches every type file).

### Waves (lanes ≤ ~3k upstream lines; ✱ = contract-first, merges before its dependants)

**Wave 31: unblock and measure (parallel)**
- `stablehash-gaps`: D9 (codegen + rustc_target asm reg StableHash). Target: core lib check passes HIR hashing.
- `query-keys`: the 7 unported fns of rustc_middle query/keys.rs and the missing `QueryKey` impls behind them (incl. `(ValidityRequirement, PseudoCanonicalInput<Ty>)`, the bin check's stop).
- `perf-core-a`: profile `-Zunpretty=expanded` of core (46 s → ?), fix hot spots without logic changes; report.
- `perf-core-b`: memory census of a core run (what holds the 5.3 GB), proposals needing decisions.
- `harness-m5a`: split mode + heavy class (D6), suites `check-core-bin`, `mir-core` (unprotected); aux chain for
  compiler_builtins.
- `driver-m5`: rustc_interface queries.rs `Linker`, passes.rs `start_codegen`, util.rs `DummyCodegenBackend` +
  `get_codegen_backend`, the D7 stand-in backend, rustc_codegen_ssa base.rs `CrateInfo::new` + eii helpers,
  back/link.rs `link_binary` metadata path, symbol_export.rs providers (~1.5k).
- Fixer lanes from `check-core-bin` and `mir-core` first stops (one per failing upstream file, as in wave 20).

**Wave 32: encoder foundations**
- ✱`encode-contract`: D3 codegen for `Encodable` (+ `encode_<T>` naming and the `Encoder` interface over
  `FileEncoder`/`opaque`), the `EncodeContext` class skeleton (encoder.rs:52 fields), `SpanEncoder`/`TyEncoder`
  declarations, `LazyValue`/`LazyArray`/`LazyTable` writers.
- `encode-span-hygiene`: rustc_span hand impls (Span, SyntaxContext, ExpnId, Symbol, DefId/DefIndex/CrateNum,
  SourceFile), `encode_hygiene`, `encode_source_map` (~1.5k).
- `encode-middle`: rustc_middle ty/codec.rs encode side (`encode_with_shorthand`), interpret AllocId encoding, the rest
  of the middle hand impls (~2k).
- `vendor-twox-hash`: D8 (~2.3k).
- `metadata-deps`: dependency_format.rs, native_libs.rs, foreign_modules.rs, fs.rs (~1.0k); `passes-reachable`:
  reachable.rs + svh.rs + config.rs `DepTrackingHash` impls (~0.8k).
- `probe-rmetadump` + `harness-m5b`: the probe and `rmeta-*` suites, `check-core` with binary compare (§4.4).

**Wave 33: the encoder**
- `encoder-a`: encoder.rs :1–:650 (EncodeContext impls, SpanEncoder/TyEncoder, lazy machinery, def-path tables).
- `encoder-b`: :651–:1480 (`encode_crate_root`, crate-level lists, should_encode_* predicates).
- `encoder-c`: :1482–:2040 (`encode_def_ids`, ADTs, MIR, stability, native libs, hygiene).
- `encoder-d`: :2040–:2909 (impls, incoherent impls, lang/diagnostic items, exported symbols, `encode_metadata`,
  `with_encode_metadata_header`, SVH). Target: gate M5b on core.
- Fixer lanes per `rmeta-core` / `mir-core` first difference.

**Wave 34: alloc, std (→ gate M5)**
- `harness-m5c`: std aux chain (13 deps, backtrace submodule, crates.io sources), `check-alloc`, `check-std`,
  `mir-alloc`, `mir-std`, `check-chain`.
- Fixer lanes from alloc/std first stops; perf lanes as the heavy runs demand.

About 4 waves and ~20 lanes of porting plus fixer and perf lanes; the open-ended part is the fixer/perf loop on core.

## 6. Risks

- **Performance (highest).** Port/oracle CPU ratios measured on core: 34× (expansion), 2.4× (HIR tree, oracle
  print-bound); a full core analysis has not completed on the port yet (§2). The 60 s case timeout and 12 workers are
  incompatible with core (D6/D10/D11). The 50k-case split suites cost one heavy run each, not 50k processes.
- **Memory.** 5.3 GB after expansion and 6.7 GB at the HIR tree, against the oracle's 0.6 and 2.1 GB; typeck results,
  MIR bodies of 50k items and interners come on top. 24 GB machines leave no room for parallel heavy runs. JS object
  overhead per AST/HIR node and per interned type is the lever; any representation change is a recorded decision.
- **Determinism.** The oracle is byte-deterministic (measured). Risks on the port side: AllocId numbering across 50k
  bodies (plan-m4 D13), `DefPathHash`/`StableCrateId` (SipHasher128, already ported) and the XXH3 SVH; hashbrown-order
  emulation where encoder callers iterate `FxHashMap`s indirectly (the encoder itself has no
  `potential_query_instability` sites); absolute paths (working dir and source file names are encoded: both sides must
  run in the same cwd with the same relative input path, as the harness does).
- **All-or-nothing bytes.** One differing byte changes the SVH and every downstream `CrateDep`; mitigated by the
  `rmeta-*` dump suites and a first-differing-offset report.
- **Scale of hidden divergences.** core exercises features tests/ui barely touches: `core_arch` SIMD intrinsics and
  `#[target_feature]`, `asm!`, const traits, `rustc_*` attributes, staged_api stability, lang items. Expect long
  fixer tails per first-difference.
- **Machine resources.** During this lane the shared disk filled to 100% (674 MB free; a core `-Zunpretty=hir-tree` run
  of the oracle died with `No space left on device`). Core-scale outputs (1.56 GB HIR/THIR trees, 54 MB rmetas) must be
  hashed or gzip'd, never cached raw; the oracle cache must not store them.
- **Harness changes are large.** Split mode, heavy class, binary compare and aux chains all touch difftest/gate code that
  guards the ratchet; they need their own reviewed batches before any M5 suite is protected.

Critical files: rustc_metadata/src/rmeta/encoder.rs, rustc_metadata/src/fs.rs, rustc_interface/src/{passes,queries,util}.rs,
rustc_codegen_ssa/src/{base.rs,back/link.rs,back/symbol_export.rs}, rustc_passes/src/reachable.rs, rustc_session/src/config.rs
(DepTrackingHash), tools/codegen (Encodable, StableHash gaps), harness/suites.ts, scripts/difftest.ts, scripts/gate.ts.
