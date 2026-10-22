# Handoff: mir-pretty (M4 wave 21, MIR fill lane 4 of 6): rustc_middle mir/pretty.rs :1..873 + :1438..2097

Branch `lane/mir-pretty` (from `aae2f3fc`, no merges). Commits: the port + the mirdump seams → the oracle tests → `then_some`
eagerness → this handoff.

## Files touched
- `src/rustc_middle/mir/pretty.ts`: every stub of lines :1..873 and :1438..2097 is ported, in upstream order
  (`PrettyPrintMirOptions::from_cli`, `MirDumper` (`new` / setters / `dump_mir` / `dump_mir_to_writer` / `dump_path` /
  `create_dump_file`), `write_mir_pretty`, `MirWriter` (`new` / `write_mir_fn` / `write_basic_block`),
  `write_scope_tree`, `Debug for VarDebugInfo`, `write_coroutine_layout`, `write_mir_intro`, `write_coverage_*`,
  `write_mir_sig`, `write_user_type_annotations`, `write_extra`, `ExtraComments` (`push`, `visit_const_operand`,
  `visit_rvalue`), `use_verbose`, `comment`, `write_allocations` (with its nested `alloc_ids_from_alloc`,
  `alloc_id_from_const_val`, `CollectAllocIds`), `display_allocation`, `Display for RenderAllocation`,
  `write_allocation_endline` / `_newline` / `_bytes`, `pretty_print_byte_str`, `comma_sep`,
  `pretty_print_const_value_tcx`, `pretty_print_const_value`, `hex_number_length`). Lane mir-body-b's stubs
  (:875..:1387) are untouched, in place.
- `src/rust_ts/mirdump.ts` (root-approved seam wiring, `load_seams()` + imports only): `write_mir_fn` =
  `MirWriter::new(tcx).write_mir_fn(body, &mut Vec<u8>)` decoded as UTF-8; `clone_body` / `clone_promoted` = `clone_Body`;
  `display_const_val` = `display_Const({ $: "Val", .. })` (consts.rs `Display for Const`, which calls
  `pretty_print_const_value`; it stops in lane mir-body-b's `display_Const` stub until that lands). The mir modules are
  `require`d inside `load_seams()` (called by `main` after its driver imports), not at the script's load.
  **For the harness owner:** the header line "Until they are wired, each calls `unported(...)`" is now stale (outside
  `load_seams()`, so not edited).
- `src/rustc_middle/mir/contract.test.ts` (re-pinned, no assertion weakened): the two `stops(..)` lines of
  `MirWriter::write_mir_fn` / `write_mir_pretty` are removed (ported now; they would hit `null` args) and the
  `"mir-pretty": 43` entry of the per-lane stub count is gone (0 left); the import of `./pretty.ts` stays (side effect).
- New: `src/rustc_middle/mir/pretty.test.ts`, `src/rustc_middle/mir/pretty_oracle/` (`basic.rs`, `allocs.rs` and the
  oracle's `basic.mir`, `basic.spans.mir`, `basic.noalloc.mir`, `allocs.mir`, `built/*.mir`; `REGEN=1` rewrites them).

## Coverage
`bun scripts/coverage.ts --missing compiler/rustc_middle/src/mir/pretty.rs`: 43/59; the 16 left are lane mir-body-b's
(:875..:1387). rustc_middle 2354/3369 (base 2311); TOTAL 17525/25518 (the other wave-21 lanes are not merged here).
`bun scripts/coverage.ts --check`: markers ok.

## Tests (`pretty.test.ts`; 12 pass, 3 skip now)
Hand-built bodies / allocations over a `TyCtxt` with fresh interners (real types and their Display; fake def paths, def
kinds, global allocations, spans), compared byte for byte with the pinned nightly's output on the two fixture crates:
- allocations through `write_allocations`: one line, two lines with addresses, `-Zdump-mir-exclude-alloc-bytes`, uninit
  bytes (`__ │ ░░░░`), a zero-sized static (`{}`), a static in a const context (`alloc1 (static: S)`), and provenance:
  one pointer, three pointers over two lines, a pointer across the line end in both layouts (`╾alloc1<imm> (8 ptr
  bytes)` / `╾──── .. ──alloc1<imm>───╼`), relocations followed in upstream order;
- `pretty_print_const_value`: `"hello"`, `<uninit>`, `7_i32`;
- `write_mir_intro` (sig, `let` lines, promoted header) with and without `-Zmir-include-spans=on` (the 40-column
  comments); `ExtraComments` (`mir::ConstOperand` / `+ span` / `+ const_: Const { .., val: Value("hello") }` and
  `Unevaluated(P, [], Some(promoted[0]))`; no comment for `i32`);
- `MirDumper`: the `-Zdump-mir` filter grammar; dump file names (`basic.f.1-1-000.built.after.mir` as the oracle's,
  `-Zdump-mir-exclude-pass-number`, `.-------`).
- **Skipped until mir-body-a/b land** (`blocked.body`, probed at load: `Debug` of `TerminatorKind` / `Statement` /
  `Place`, `VarDebugInfoContents`, `Display` of `mir::Const`): `write_mir_pretty` == basic.mir / basic.spans.mir /
  basic.noalloc.mir (whole crate: `fn f` with debug lines and a scope, statics, a promoted, trivial consts,
  allocations), `write_mir_fn` of `fn f`, `MirDumper::dump_mir` == the oracle's built/ files. They run automatically
  once the stubs are real; if one then fails on the fake `tcx` (a query it lacks), extend `mk_tcx` in the test.
- PORT(test) bridges for the parallel lanes' stubs (all "real first, stand-in only on UNPORTED", restored in
  `afterAll`): subclasses of the test's own objects (`TestBody`, `TestAllocation`, `TestInitMask`,
  `TestProvenanceMap`, ...); companion / prototype fallbacks (`BasicBlock::start_location`, `MirPhase::index`,
  `Const::ty`, `ConstValue::{all_bytes_uninit, try_get_slice_bytes_for_diagnostics}`, `CtfeProvenance::alloc_id`,
  `Pointer::new`, `GlobalAlloc::unwrap_memory`, `Visitor::visit_body`); `mock.module` fallbacks for module-level fns
  (`alloc_range`, `read_target_uint`, `debug_CtfeProvenance`, `debug_Pointer`; the original exports are put back with
  `mock.module` in `afterAll`, checked to not leak into later files).

## Samples (lane vs base `aae2f3fc` = `lanes/mir-visit-base`; both `RUST_TS_AGENT=mir-pretty`)
| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-200645-mir-pretty-k73x` | 45 / 0 / 1 / 0 | `20261021-200924-mir-pretty-pmmk` | 45 / 0 / 1 / 0 |
| mirdump-minicore (46) | `20261021-200706-mir-pretty-t8fe` | 10 / 0 / 36 / 0 | `20261021-200955-mir-pretty-3qgl` | 10 / 0 / 36 / 0 |
| hir-tree `--sample 200` | `20261021-200736-mir-pretty-qszj` | 200 / 0 / 0 / 0 | `20261021-201028-mir-pretty-0yi6` | 200 / 0 / 0 / 0 |

No new DIFF; every case has the same status and the same stop as on base (compared per case). mirdump-minicore stops
before MIR printing (`mir_keys` / `check_unsafety` providers, `const_eval_poly`): MIR building is wave 22.

## `unported(...)` left
- `rustc_middle::mir::graphviz::write_mir_fn_graphviz` (inline in `MirDumper::dump_mir`, `-Zdump-mir-graphviz` only;
  graphviz.rs is not in scope).
- Reached through other lanes' stubs (not mine): mir-body-a (`Body::{args_iter, return_ty, yield_ty,
  coroutine_layout_raw, index}`, `MirSource::def_id`, `BasicBlock::start_location`, `BasicBlockData::terminator`,
  `MirPhase::index`, `UserTypeProjections::projections`, `Debug for VarDebugInfoContents`), mir-body-b (the Debug impls
  of pretty.rs :875..:1387, `StmtDebugInfos::deref`, `Const::ty`, `ConstValue::{all_bytes_uninit,
  try_get_slice_bytes_for_diagnostics}`, `display_Const`), mir-visit (`Visitor::{visit_body, visit_statement,
  visit_terminator, super_rvalue}`), mir-interp-a (`Allocation::{size, init_mask, provenance,
  inspect_with_uninit_and_ptr_outside_interpreter, get_bytes_strip_provenance}`, `ProvenanceMap::{ptrs, get_ptr,
  get_byte}`, `InitMask::is_range_initialized`, `alloc_range`), mir-interp-b (`CtfeProvenance::alloc_id`,
  `Pointer::new`, `debug_Pointer`, `debug_CtfeProvenance`, `read_target_uint`, `GlobalAlloc::unwrap_memory`,
  `tcx.try_get_global_alloc` / `global_alloc`).

## `// PORT:` decisions
1. `write!` / `writeln!` on an `io::Write` → `w.write_fmt([text])` (one piece: the same bytes); `fmt::Write` →
   `write_str`; `&mut Formatter` written-only params → the fn returns the text (contract convention).
2. Width / fill / alignment: local `pad` (`{:N$}`, counts `char`s), `center` (`{:─^N$}`, extra fill on the right),
   `hex_pad` (`{:0N$x}`), `char_count`; `str::trim` is `str_trim` (Rust `White_Space` via std/char `is_whitespace`).
3. `Debug` of a generic `Prov: Provenance` value → `debug_prov` (by representation, as pointer.ts `provenance_of`).
4. `body.phase <= MirPhase::Runtime(PostCleanup)` → local `MirPhase_le` (derived `PartialOrd`: variant order, then the
   phase discriminants). **Follow-up for mir-body-a/syntax.ts owner**: a shared `MirPhase` ordering helper.
5. `io::BufWriter<fs::File>` → local `DumpFile` (buffers; `drop()` = flush + close, called where the `BufWriter` goes
   out of scope, also on a JS exception); `PathBuf::push` / `Path::parent` → local `path_push` / `path_parent`
   (`/`-separated); `fs::create_dir_all("")` is `Ok`; `io::Error::new(e.kind(), ..)` uses `Other` for OS errors (the
   errors are ignored by `dump_mir` anyway).
6. `MirDumper.disambiguator: &dyn Display` is its rendered text (contract); `MirDumper::new` builds the dumper eagerly
   (`bool::then_some`).
7. `bug!` → rustc_span/macros.ts `bug()` (pretty.rs `use rustc_span::bug`).
8. Init order: rustc_session/config.ts is `require`d lazily through rustc_session/lib.ts (config.ts as the crate's
   first module stops in options.gen.ts's TDZ; precedent ty/instance.ts); pretty.ts still loads as a fresh entry
   (contract.test.ts).
9. `write_allocations`: the nested fns and `CollectAllocIds` live inside it (contract rule); `BTreeSet<AllocId>` is a
   `Set` sorted where it is iterated (`seen.iter()`); `CollectAllocIds._0` is now `Set<AllocId>` (was `AllocId[]` in
   the stub) and `alloc_ids_from_alloc` returns `AllocId[]`.
10. `pretty_print_byte_str(fmt, byte_str: ArrayLike<number>)` (stub had `readonly number[]`): it gets a `Uint8Array`
    from `get_bytes_strip_provenance` and `readonly number[]` from `try_get_slice_bytes_for_diagnostics`.
11. `escape_ascii` / `String_from_utf8_lossy`: local copies of ty/print/pretty.ts's private helpers (candidates for
    src/std).
12. A `PrintError` inside `pretty_print_const_value_tcx` (`?` into `fmt::Error`) panics like std's `format!`
    (as ty/print/pretty.ts `pretty_print_const`); `tcx.lift(ty)` is the identity.
13. `FmtPrinter::pretty_print_const_scalar` still takes ty/decls.ts's `Pending` `Scalar`: cast (ty/print owner's
    follow-up, listed in mir-contract's "Stand-ins outside mir/").
14. Upstream's `fmt.write_str(" {{ ")` / `(" }}")` (not a format string) writes the doubled braces: kept.
15. Hook / query values typed `unknown` (`mir_pretty_extra_data`, `try_destructure_mir_constant_for_user_output`,
    `constness`, `coroutine_kind`) are cast at the use.
16. `write_basic_block`: `current_location` is a `Location` class; the copies handed to `PassWhere` / the visitor
    closures are `clone_Location` (Rust copies it).

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok.
- `bun test src/rustc_middle src/rust_ts`: 297 pass, 3 skip, 0 fail.
- `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (once, at the end, at `a964240e`): 5568 pass, 4 skip, 2 fail.
  Both failures are base fallout, not this lane's (root confirmed they also fail on `aae2f3fc`):
  `src/rustc_lint/types.oracle.test.ts` "late types lints: PENDING TypeLimits: fn pointer `==` suggestion stops at
  utils::std_or_core" and "... ambiguous_wide_pointer_comparisons stops at utils::std_or_core".
