verdict: APPROVE-WITH-NOTES

Lane followups-33, branch `lane/followups-33` @ db47ca33 (8 item commits + handoff), reviewed against the pin
(`.data/rust`, incl. `library/` for std).

## What I checked

- Diff `main...lane/followups-33`: 17 files, all under src/ and tools/codegen/mir.typemap.json plus the handoff.
  Nothing under harness/, scripts/ or harness/baseline changed. No suites or oracle outputs touched.
- Every changed fn compared with upstream:
  - lto.rs:77 `crate_type_allows_lto`: same arms, same result. Upstream order kept (before `exported_symbols_for_lto` at :89).
  - base.rs:662-664: the doc comment matches upstream word for word.
  - rustc_span lib.rs:1364 `encode_def_key` (`impl Encodable<Self>`): order is parent first, then data.
  - stdio.rs:179/224 `write_all` / `handle_ebadf`.
  - sys/stdio/unix.rs:92 `is_ebadf`.
  - core io/write.rs:214 `write_all`: `Ok(0)` gives WRITE_ALL_EOF ("failed to write whole buffer", WriteZero, which
    matches core io/error.rs:125); retries on interrupted.
  - stdio.rs:1199 `print_to`: the panic text "failed printing to stdout: {e}" matches.
  - rustc_metadata fs.rs:138 `copy_to_stdout`: `io::copy` into `Stdout`. `Stdout` is not `CopyWrite`
    (kernel_copy/linux.rs only implements it for `StdoutLock`), so the copy takes the generic `write_all` path, as the
    handoff says.
  - `DocLinkResMap` is `FxIndexMap` (resolve.rs:327). In the compiler, the only use of the `doc_link_resolutions`
    query outside the encoder is the extern provider (cstore_impl.rs:427), so "rustdoc-only path" holds.
- `bunx tsc --noEmit -p .`: clean. `coverage --check`: markers ok (23169; vendor 4680).
- `bun test` on rustc_span, rust_ts, std, rustc_hir_id, rustc_serialize, rustc_codegen_ssa and rustc_session:
  266 pass, 1 skip, 0 fail. This matches the handoff's per-directory numbers.
- The new `rmeta_fxmap.oracle.test.ts`, `io.test.ts` and `def_id_fx.test.ts` ran against the pinned rustc: 10 pass,
  0 fail. The test did not skip.
- Generator (item 6): I regenerated all 6 sets in a scratch worktree with the lane's mir.typemap.json. Every set
  reports `unknown types: 0`, and the tree had no changes afterwards. No drift confirmed. The global
  typemap.hir.json `rustc_abi::Size` entry is field-for-field identical to the removed mir-local entry (ts, import,
  types, values, debug, clone).
- I checked the EBADF behaviour by hand. A no_core crate was built with `--emit=metadata -o -` by the oracle and by the
  port in three cases:
  - fd 1 read-only (`1</dev/null`): both exit 0 with empty stderr;
  - fd 1 closed (`>&-`): both exit 0 with identical stderr;
  - normal pipe: identical stdout bytes (sha1 caf97113…) and identical stderr.

  `--print crate-name` with `1</dev/null` also gives exit 0 and empty stderr on both.
- Sample: `difftest --suite check-ui --sample 40` (agent rev-f33) gave 40/40 MATCH. This is consistent with the
  handoff's 100/100 check-ui and unchanged mir 297/1/2. No lost MATCH seen.
- `register_fx_ordered`:
  - `FxDefIdMap` is the only `FxOrdered` implementer in src/, so recognising it by class gives the same answer as the
    old `fx` property test for every real map.
  - Registration runs when def_id.ts is evaluated, so it always happens before any instance exists.
  - `instanceof` also covers subclasses.
  - The only consumer is serialize.ts:804. The new lookalike test shows the property-based false positive is gone.
- SpanEncoder retyping: the interface, `SpanEncoder_provided`, the FileEncoder/MemEncoder prototype impls and
  ProbeEncoder are all `Encodable<T, SpanEncoder>`. EncodeContext's override has a `Encodable<T, EncodeContext>`
  parameter. A `(v, s: SpanEncoder) => void` is assignable to that, so the override is sound by contravariance; it
  does not depend on method bivariance. `encode_DefKey` now type-checks without its cast.

## Findings

1. src/std/io.ts:292 (non-blocking). The `WRITE_ALL_EOF` doc comment cites `library/std/src/io/mod.rs`. At this pin
   the constant is in `library/core/src/io/error.rs:125`, and `Write::write_all` is in `library/core/src/io/write.rs:214`.
   The `stdout_write_all` doc comment (io.ts ~309) cites the same wrong path. Only the citation is wrong; the values
   match.

2. src/std/io.ts:303-312 (non-blocking). The PORT note says that, because `LineWriter` is not modelled, "the bytes
   written and the errors swallowed are the same". That is true for EBADF and for successful writes. It is not
   exactly true for other errors:
   - upstream buffers small writes in `BufWriter`/`LineWriter`;
   - an error such as ENOSPC or EIO on the last partial line surfaces only at the exit flush, where it is ignored;
   - the port reports it immediately.

   This was already the case with the old `write_fd`, which threw, so it is not a regression. The note should be
   narrowed to "EBADF and successful output are the same".

3. src/std/io.ts:296-333 vs src/vendor/anstream/stream.ts:164-208 (non-blocking). The vendor anstream module already
   models `StdoutRaw`/`StderrRaw`: `FdRaw` (write(2) with an EAGAIN retry), `Write_default.write_all`, and a private
   `handle_ebadf` that cites stdio.rs:224. The lane adds a second, parallel `handle_ebadf` and `write_all` loop in
   std/io.ts.
   - The two EBADF tests differ: the vendor one tests `code === "EBADF"`, std uses `raw_os_error() == EBADF`. They
     give the same result today.
   - Root should unify them: the vendor stream should use std/io.ts `handle_ebadf`/`is_ebadf`. This fits the
     handoff's own follow-up, which moves `write_fd`/stderr into std/io.ts.

4. tools/codegen/typemap.hir.json:33 (non-blocking; this file was not touched by the lane). The global
   `rustc_abi::Size` note still says "as mir.typemap.json". After item 6 that entry no longer exists. Root should
   drop the cross-reference the next time the file is edited.

5. src/rustc_session/config.ts:129 and the emitter / rust_ts/main.ts (non-blocking, already flagged in the handoff
   "For root" #1). stderr writes do not go through `handle_ebadf`; upstream's `StderrRaw` does
   (stdio.rs:192-221). This is out of scope for this lane, and I agree it should be recorded as a follow-up.

## Per-item conclusion

- #1 cstore_impl ExportedSymbol: correct.
- #2 lto/base: correct.
- #3 SpanEncoder retyping: correct and sound.
- #4 register_fx_ordered: correct.
- #5 rmeta oracle test: correct, and it ran green against the oracle.
- #6 typemap: correct, no drift (I re-verified it).
- #7 decode_DocLinkResMap message: correct.
- #8 std EBADF: matches upstream on all three fd-1 setups (findings 1–3 are wording and duplication only).
