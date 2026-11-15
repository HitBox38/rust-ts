// rust-ts: `mono_collection_head` (codegen_backend.ts) is a copy of the head of the ported `codegen_crate`
// (rustc_codegen_llvm back/llvm_backend.ts, llvm_backend.rs:336, then rustc_codegen_ssa base.ts, base.rs:723-739), which
// scripts/mono-run.ts runs for `mono-ui` instead of the code `main.ts` runs. This test runs both on the same stub `tcx` and
// checks that they stop at the same point with the same output, so a fix to one that misses the other fails here (review
// mono-run-head N3). The stub's `collect_and_partition_mono_items` records its argument and stops, so neither goes past the head.
import { describe, expect, test } from "bun:test";
import { AnnotateSnippetEmitter } from "../rustc_errors/annotate_snippet_emitter_writer.ts";
import { DiagCtxt, DiagCtxtFlags_default, FatalErrorMarker } from "../rustc_errors/lib.ts";
import { create_default_session_globals_then } from "../rustc_span/lib.ts";
import { FilePathMapping, SourceMap } from "../rustc_span/source_map.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { Unported } from "../std/panic.ts";
import { AutoStream, ColorChoice } from "../vendor/anstream/lib.ts";
import { dyn_write, VecU8 } from "../vendor/anstream/stream.ts";
import { LlvmCodegenBackend } from "../rustc_codegen_llvm/lib.ts";
import { mono_collection_head } from "./codegen_backend.ts";

interface Case {
  offload: { $: "Device" | "Host" }[];
  need_explicit_cpu: boolean;
  target_cpu: string | undefined;
  unsupported_cpus: string[];
}

class CollectorReached extends Error {}

/** Runs `head` on a stub `tcx` for `c`; returns how it stopped and what the emitter wrote. */
function run(head: (tcx: TyCtxt) => unknown, c: Case): { stop: string; stderr: string } {
  return create_default_session_globals_then(() => {
    const buf = new VecU8();
    let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
    em = AnnotateSnippetEmitter.sm(em, SourceMap.new(FilePathMapping.empty()));
    const dcx = DiagCtxt.new(em).with_flags(DiagCtxtFlags_default());
    const collector_args: unknown[] = [];
    const tcx = {
      sess: {
        opts: { unstable_opts: { offload: c.offload }, cg: { target_cpu: c.target_cpu } },
        target: { need_explicit_cpu: c.need_explicit_cpu, unsupported_cpus: c.unsupported_cpus },
      },
      dcx: () => dcx.handle(),
      collect_and_partition_mono_items(key: unknown): never {
        collector_args.push(key);
        throw new CollectorReached();
      },
    } as unknown as TyCtxt;
    let stop: string;
    try {
      head(tcx);
      stop = "returned";
    } catch (e) {
      if (e instanceof CollectorReached) stop = `collect_and_partition_mono_items(${String(collector_args[0])})`;
      else if (e instanceof FatalErrorMarker) stop = "fatal";
      // The two -Zoffload stops name different places (the stand-in's predates the ported one); both are out of M7 (plan-m7 D18).
      else if (e instanceof Unported && /-Zoffload; plan-m7 D18/.test(e.what)) stop = "unported -Zoffload";
      else throw e;
    }
    return { stop, stderr: new TextDecoder().decode(buf.bytes()) };
  });
}

const CASES: [string, Case, string][] = [
  ["the collector", { offload: [], need_explicit_cpu: false, target_cpu: undefined, unsupported_cpus: [] }, "collect_and_partition_mono_items(null)"],
  ["CpuRequired", { offload: [], need_explicit_cpu: true, target_cpu: undefined, unsupported_cpus: [] }, "fatal"],
  ["CpuUnsupported", { offload: [], need_explicit_cpu: true, target_cpu: "pentium", unsupported_cpus: ["i386", "pentium"] }, "fatal"],
  ["-Zoffload", { offload: [{ $: "Host" }], need_explicit_cpu: true, target_cpu: undefined, unsupported_cpus: [] }, "unported -Zoffload"],
  // The offload check's `Device` arm (review fixers-58 N1): with only the `Host` case, a copy dropping it still passed.
  ["-Zoffload Device", { offload: [{ $: "Device" }], need_explicit_cpu: true, target_cpu: undefined, unsupported_cpus: [] }, "unported -Zoffload"],
];

describe("mono_collection_head is the ported codegen_crate's head (llvm_backend.rs:336, base.rs:723-739)", () => {
  test.each(CASES)("%s", (_name, c, expected_stop) => {
    const copy = run(mono_collection_head, c);
    const ported = run((tcx) => new LlvmCodegenBackend().codegen_crate(tcx), c);
    expect(copy).toEqual(ported);
    expect(copy.stop).toBe(expected_stop);
    expect(copy.stderr === "").toBe(expected_stop !== "fatal");
  });
});
