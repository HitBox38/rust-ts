# Handoff: lane followups-33 (the small follow-ups from the wave-32/33 reviews)

Branch `lane/followups-33`, made from main `e4ba72ab`. All 8 items are done, one commit each.

## Items

1. **`cstore_impl.ts`'s local `ExportedSymbol`** (`c7249120`):
   - The local stand-in type is deleted.
   - The file now imports `ExportedSymbol` and `SymbolExportInfo` from `src/rustc_middle/middle/exported_symbols.ts`.
   - The three casts of the query values are now `[ExportedSymbol, SymbolExportInfo][]`. The casts themselves remain
     because `exported_*_symbols` are still `readonly [unknown, unknown][]` in queries.gen.ts.
2. **`allocator_kind_for_codegen` and `crate_type_allows_lto`** (`2f391f0e`):
   - base.ts gets the upstream `///` doc comment back.
   - lto.ts ports `crate_type_allows_lto` (lto.rs:77).
   - PORT: `crate_type_allows_lto` is exported even though it is private upstream. Its only caller,
     `check_lto_allowed`, is M7 and not ported yet.
3. **`SpanEncoder.encode_def_key`** (`be0d9c7c`):
   - These now take `encode_T: Encodable<T, SpanEncoder>`, which is upstream's `impl Encodable<Self>`:
     - the interface method;
     - `SpanEncoder_provided.encode_def_key`;
     - the `FileEncoder` / `MemEncoder` prototype impls;
     - `ProbeEncoder` in span_codec_oracle/cases.ts.
   - `EncodeContext`'s override keeps `Encodable<T, EncodeContext>`, which method bivariance accepts.
   - `encode_DefKey` (rustc_hir_id definitions.ts) no longer needs its cast. The cast's PORT note and the unused
     `Encodable` import are gone.
4. **`iterates_in_fx_order`** (`59a8a93e`):
   - rust_ts/hash_map.ts gains `register_fx_ordered(cls)`. `iterates_in_fx_order` is now `v instanceof FxHashMap` or
     `v instanceof` a registered class. It no longer looks for a property named `fx`.
   - rustc_span def_id.ts registers `FxDefIdMap` right after the class.
     - hash_map.ts can't import def_id.ts, because def_id.ts imports it.
     - The registration runs when def_id.ts is evaluated, so it always happens before any instance exists.
   - def_id_fx.test.ts gains a check that a plain `DefIdMap` carrying an `fx` FxKeyedMap is not treated as ordered.
5. **rmeta oracle test** (`b9fa0d59`), new file `src/rustc_metadata/rmeta/rmeta_fxmap.oracle.test.ts`:
   - Each crate is built `--crate-type lib --emit=metadata --target x86_64-unknown-linux-gnu` by the pinned rustc and by
     `src/rust_ts/main.ts`, in the same work dir. The test checks that exit, stderr and `.rmeta` are byte-identical.
   - The crates:
     - `fx9`, `fx40`, `rpitit` and `assoc` are rmeta-fxmap's `/tmp/fxlane/nc` crates `a`, `b`, `c` and `assoc2`. I
       checked that the generated sources equal those files byte for byte. `assoc` is built from the
       `rustc_ty_utils/assoc_test/assoc.rs` fixture plus the appended lang items.
     - `raw_dylib`: a `kind = "raw-dylib"` foreign module (`#![feature(raw_dylib_elf)]`). The oracle accepts it on
       x86_64-linux. It has 3 imports: a fn, a fn renamed with `link_name`, and a static.
   - I confirmed that `encode_DllImport` runs 3 times on the `raw_dylib` crate (temporary instrumentation, reverted).
   - All 5 pass (about 3.5 s). The test skips visibly without the pinned rustc and fails under
     `RUST_TS_REQUIRE_PROBES=1`.
6. **`tools/codegen/mir.typemap.json`** (`f5946b03`):
   - Removed the mir-local `rustc_abi::Size` entry. The global typemap.hir.json entry now covers it.
   - Fixed the header note, which still described `Size` as an `unknown` placeholder. The note now names only
     `rustc_middle::ty::Instance`, which is still an `unknown` placeholder in typemap.passes.json, so its mir-local entry
     stays.
   - Regenerated the 6 sets that use the file:
     - rustc_middle_diagnostics, rustc_middle_mir, rustc_mir_build_builder, rustc_mir_transform,
       rustc_const_eval_interpret and rustc_borrowck;
     - no generated file changed (no drift);
     - the reports show `unknown types: 0` for each set.
7. **`decode_DocLinkResMap`** (`2a27e3d5`):
   - The unported message now says what is actually missing: "IndexMap decode; rustdoc-only path". The element codecs
     `decode_Res` / `decode_Namespace` exist.
   - The doc comment now says upstream's real type, `FxIndexMap`. It used to say `UnordMap`.
   - Because the type is `FxIndexMap` (resolve.rs:327), `encode_DocLinkResMap`'s insertion-order encoding is correct.
8. **std `io::stdout()` EBADF** (`38341b36`):
   - Reproduced on macOS. With fd 1 opened read-only (`1</dev/null`):
     - `rustc --emit=metadata -o -` exits 0 silently. The port printed "failed to copy … to stdout: Bad file
       descriptor (os error 9)" and exited 1.
     - `rustc --print crate-name` exits 0. The port ICEd (exit 101).
   - With fd 1 closed (`>&-`), both already succeeded: std and Bun reopen fd 1.
   - src/std/io.ts gains:
     - `is_ebadf`, from std sys/stdio/unix.rs:92;
     - `handle_ebadf`, from io/stdio.rs:224;
     - `stdout_write_all`, which is `<StdoutRaw as Write>::write_all`: `Write::write_all` over `write(2)` on fd 1,
       wrapped in `handle_ebadf(.., || Ok(()))`.
   - PORT notes:
     - `LineWriter` buffering is not modelled. The bytes written and the errors swallowed are the same.
     - `EAGAIN` is retried, as config.ts `write_fd` did, because Bun may leave a pipe non-blocking.
   - `copy_to_stdout` (rustc_metadata fs.ts) writes each chunk with `stdout_write_all` and returns its error. Upstream
     `io::copy` into `Stdout` takes the generic path even on Linux (`Stdout` is not `CopyWrite`), so it is `write_all`
     per chunk.
   - `std_print` (rustc_session config.ts, the port's `print!`) uses `stdout_write_all`. Any other error panics with
     "failed printing to stdout: {e}", as std's `print_to` does. Callers:
     - the driver's `print()` (print.rs) catches it and raises `FatalError`, as before;
     - the dumps still ICE on a real write error, as before.
   - After the change, the port matches the oracle (exit and stderr) for `-o -` and `--print crate-name` under
     `1</dev/null` and `>&-`, and on a normal pipe.
   - io.test.ts gains a `handle_ebadf` unit test and a subprocess test: `stdout_write_all` with fd 1 read-only returns
     `Ok`. I checked that this setup really gives EBADF to a bare `writeSync`.

## Files touched

- src/rustc_metadata/rmeta/decoder/cstore_impl.ts, src/rustc_metadata/rmeta/decoder.ts, src/rustc_metadata/fs.ts
- src/rustc_metadata/rmeta/rmeta_fxmap.oracle.test.ts (new)
- src/rustc_codegen_ssa/base.ts, src/rustc_codegen_ssa/back/lto.ts
- src/rustc_span/lib.ts, src/rustc_span/span_codec_oracle/cases.ts, src/rustc_span/def_id.ts,
  src/rustc_span/def_id_fx.test.ts
- src/rustc_hir_id/definitions.ts
- src/rust_ts/hash_map.ts
- src/std/io.ts, src/std/io.test.ts (PORTING §1 normally reserves src/std; item 8 asked for this)
- src/rustc_session/config.ts (`std_print` only)
- tools/codegen/mir.typemap.json

No edits to harness/, scripts/, baselines or suites. No contract or stub-count test pins moved.

## Coverage

| Upstream file | Ported |
|---|---|
| back/lto.rs | 2/8 (was 1/8: + `crate_type_allows_lto`) |
| codegen_ssa base.rs | 8/28 (unchanged) |
| rustc_span lib.rs | 242/242 |
| definitions.rs | 26/26 |
| rmeta decoder.rs | 156/156 |
| cstore_impl.rs | 37/37 |
| rustc_metadata fs.rs | 5/5 |
| def_id.rs | 52/52 |
| rustc_session config.rs | 131/136 (unchanged) |

`coverage --check`: markers ok (23169; vendor 4680).

## Verification

- `bunx tsc --noEmit -p .`: clean.
- `bun test`, every touched directory, 0 fail:

  | Directory | Pass | Skip |
  |---|---|---|
  | src/rustc_metadata | 133 | 0 |
  | src/rustc_codegen_ssa | 14 | 0 |
  | src/rustc_span | 64 | 1 |
  | src/rustc_hir_id | 11 | 0 |
  | src/rust_ts | 20 | 0 |
  | src/rustc_serialize | 38 | 0 |
  | src/std | 36 | 0 |
  | src/rustc_session | 83 | 0 |
  | tools/codegen | 53 | 0 |

- Samples (`RUST_TS_AGENT=root-f5de`), unchanged:
  - `--suite mir --sample 300`: 297 MATCH / 1 UNPORTED / 2 UNSTABLE (run `20261031-081149-root-f5de-kn80`). Base
    `1j8m` / `eeau`: 297 / 1 / 2.
  - `--suite check-ui --sample 100`: 100/100 MATCH (run `20261031-081232-root-f5de-2udf`). Base `r0xa`: 100/100.

## unported(...) left

- Reworded only: `decode_DocLinkResMap` ("Decodable for rustc_middle::middle::resolve::DocLinkResMap (IndexMap decode;
  rustdoc-only path)"). None added.

## PORT decisions

- lto.ts: `crate_type_allows_lto` is exported for its future M7 caller.
- hash_map.ts: `FxOrdered` classes register with `register_fx_ordered`, and the check is by class.
- io.ts `stdout_write_all`: `LineWriter` is not modelled, and `EAGAIN` is retried. `is_ebadf` is the unix variant; on
  Windows, `raw_os_error` is still unported.
- decoder.ts `decode_DocLinkResMap`: the stop stays (rustdoc-only path), with a corrected reason.

## For root

1. **stderr is not handled.** Upstream's `StderrRaw` also wraps its writes in `handle_ebadf`. The port's `eprintln`
   (config.ts `write_fd(2, ..)`) does not, and neither do the stderr writes in rust_ts/main.ts. I did not audit the
   emitter's stderr path. Only stdout was in scope. Moving
   `write_fd` into src/std/io.ts (its "Root: move to src/std/io.ts" note) would be the place to do it.
2. **Decision to record (optional):** `iterates_in_fx_order` recognises `FxOrdered` maps by registered class
   (`register_fx_ordered`), not by an `fx` property.
