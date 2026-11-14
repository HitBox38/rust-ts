// Tests of lane cg-lto-diag: the hand-written `Diagnostic` impls of diagnostics.rs (`WithLlvmError`, `ParseTargetMachineConfig`),
// rendered by the real emitter (`AnnotateSnippetEmitter` into a byte buffer, as rustc_errors/emitter.test.ts does) at the level
// `llvm_err` / `target_machine_factory` emit them (`emit_fatal`).
//
// Where the expected text comes from:
// - **Oracle** (`WithLlvmError`, `CreateMCSubtargetInfo`): the stderr of the pinned rustc for a target spec whose
//   `llvm-target` LLVM does not know. Recorded by hand in a scratch directory (RUSTC_ICE=0):
//     rustc +nightly-2026-10-11 -Z unstable-options --print target-spec-json --target aarch64-apple-darwin > base.json
//     (set "llvm-target": "nonexistent-unknown-none" in a copy, bogus.json)
//     rustc +nightly-2026-10-11 -Z unstable-options --target ./bogus.json --crate-type lib --emit=obj lib.rs
//   where lib.rs is `#![no_std] #![no_core] #![feature(no_core)]`. It printed the line below and a blank line, exit 1. The
//   triple carries the `11.0.0` that `versioned_llvm_target` appends for macOS; the text after the second `: ` is LLVM's
//   (`TargetRegistry::lookupTarget`, through `LLVMRustGetLastError`). This is `llvm_util::target_config`'s
//   `OwnedMCSubtargetInfo::new(..).unwrap_or_else(|err| llvm_err(dcx, err))`, which rust-ts cannot reach yet (the IR model's
//   `LLVMRustCreateMCSubtargetInfo` is lane llir-init's), so the diagnostic is built here as `llvm_err` builds it.
// - **Upstream's format strings** (diagnostics.rs:144-165 and :34) for the other variants and for `ParseTargetMachineConfig`.
//   `ParseTargetMachineConfig` is not reachable from the command line: `LLVMRustCreateTargetMachine` fails only where
//   `TargetRegistry::lookupTarget` does (PassWrapper.cpp), and `LLVMRustCreateMCSubtargetInfo` has already failed on the same
//   triple in `target_config` during LLVM init.
import { expect, test } from "bun:test";
import { Emitter } from "../rustc_errors/emitter.ts";
import { AnnotateSnippetEmitter } from "../rustc_errors/annotate_snippet_emitter_writer.ts";
import { DiagCtxt, DiagCtxtFlags_default, type DiagInner, type Diagnostic, FatalErrorMarker } from "../rustc_errors/lib.ts";
import { create_default_session_globals_then } from "../rustc_span/lib.ts";
import { FilePathMapping, SourceMap } from "../rustc_span/source_map.ts";
import { io_error_from_raw_os_error } from "../std/io.ts";
import { utf8 } from "../std/str.ts";
import { AutoStream, ColorChoice } from "../vendor/anstream/lib.ts";
import { dyn_write, VecU8 } from "../vendor/anstream/stream.ts";
import { type LlvmError, ParseTargetMachineConfig_diagnostic, WithLlvmError_diagnostic } from "./diagnostics.ts";

/** Emits `d` as `dcx.emit_fatal(d)` does and returns what the emitter wrote. */
function render(d: Diagnostic): string {
  return create_default_session_globals_then(() => {
    const buf = new VecU8();
    let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
    em = AnnotateSnippetEmitter.sm(em, SourceMap.new(FilePathMapping.empty()));
    const dcx = DiagCtxt.new(em).with_flags(DiagCtxtFlags_default());
    let thrown: unknown;
    try {
      dcx.handle().emit_fatal(d);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(FatalErrorMarker);
    return new TextDecoder().decode(buf.bytes());
  });
}

const TRIPLE = "nonexistent-unknown-none11.0.0";
const LOOKUP_ERR = `No available targets are compatible with triple "${TRIPLE}"`;

test("WithLlvmError(CreateMCSubtargetInfo) matches the pinned rustc's stderr for an unknown llvm-target", () => {
  // The oracle's stderr, byte for byte (see the header).
  const ORACLE = `error: could not create LLVM MCSubtargetInfo for triple: ${TRIPLE}: ${LOOKUP_ERR}\n\n`;
  expect(render(WithLlvmError_diagnostic({ _0: { $: "CreateMCSubtargetInfo", triple: utf8(TRIPLE) }, _1: LOOKUP_ERR }))).toBe(ORACLE);
});

// The C-string arguments (`triple: SmallCStr`, `name: CString`) need rustc_error_messages's `IntoDiagArg for CString` /
// `for SmallCStr` (their `into_diag_arg` at diagnostic_impls.rs:143, :149), which cg-lto-diag ported under root's exception
// (docs/handoff/cg-lto-diag.md; review cg-lto-diag N3).
test("WithLlvmError: every variant's message is its derive's message plus `: {$llvm_err}` (diagnostics.rs:144-165)", () => {
  const cases: [LlvmError, string][] = [
    [{ $: "WriteOutput", path: "out/a.o" }, "could not write output to out/a.o: E"],
    [{ $: "CreateTargetMachine", triple: utf8(TRIPLE) }, `could not create LLVM TargetMachine for triple: ${TRIPLE}: E`],
    [{ $: "CreateMCSubtargetInfo", triple: utf8(TRIPLE) }, `could not create LLVM MCSubtargetInfo for triple: ${TRIPLE}: E`],
    [{ $: "RunLlvmPasses" }, "failed to run LLVM passes: E"],
    [{ $: "WriteIr", path: "out/a.ll" }, "failed to write LLVM IR to out/a.ll: E"],
    [{ $: "PrepareThinLtoContext" }, "failed to prepare thin LTO context: E"],
    [{ $: "LoadBitcode", name: utf8("cgus.cgu.0") }, 'failed to load bitcode of module "cgus.cgu.0": E'],
    [{ $: "WriteThinLtoKey", err: io_error_from_raw_os_error(2) }, "error while writing ThinLTO key data: No such file or directory (os error 2): E"],
    [{ $: "PrepareThinLtoModule" }, "failed to prepare thin LTO module: E"],
    [{ $: "ParseBitcode" }, "failed to parse bitcode for LTO module: E"],
  ];
  for (const [err, msg] of cases) {
    expect(render(WithLlvmError_diagnostic({ _0: err, _1: "E" }))).toBe(`error: ${msg}\n\n`);
  }
});

test("ParseTargetMachineConfig formats LlvmError's message into its own (diagnostics.rs:24)", () => {
  // `target_machine_factory`'s only error is `CreateTargetMachine`.
  expect(render(ParseTargetMachineConfig_diagnostic({ _0: { $: "CreateTargetMachine", triple: utf8(TRIPLE) } }))).toBe(
    `error: failed to parse target machine config to target machine: could not create LLVM TargetMachine for triple: ${TRIPLE}\n\n`,
  );
  // The formatting itself, over a variant whose argument is a path: `{$path}` is filled from the inner diagnostic's args.
  expect(render(ParseTargetMachineConfig_diagnostic({ _0: { $: "WriteOutput", path: "out/a.o" } }))).toBe(
    "error: failed to parse target machine config to target machine: could not write output to out/a.o\n\n",
  );
});

test("ParseTargetMachineConfig cancels the inner LlvmError diagnostic: one diagnostic reaches the emitter", () => {
  create_default_session_globals_then(() => {
    const seen: string[] = [];
    class Rec extends Emitter {
      emit_diagnostic(diag: DiagInner): void {
        seen.push(diag.messages.map(([m]) => m._0).join(""));
      }
      source_map(): undefined {
        return undefined;
      }
    }
    const dcx = DiagCtxt.new(new Rec());
    try {
      dcx.handle().emit_fatal(ParseTargetMachineConfig_diagnostic({ _0: { $: "RunLlvmPasses" } }));
    } catch (e) {
      if (!(e instanceof FatalErrorMarker)) throw e;
    }
    expect(seen).toEqual(["failed to parse target machine config to target machine: {$error}"]);
  });
});
