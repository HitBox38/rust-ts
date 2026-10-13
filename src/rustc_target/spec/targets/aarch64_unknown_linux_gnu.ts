// compiler/rustc_target/src/spec/targets/aarch64_unknown_linux_gnu.rs
import { Arch, LinkerFlavor, SanitizerSet, StackProbeType, Target, TargetOptions } from "../mod.ts";
import * as base from "../base/mod.ts";

// rustc: compiler/rustc_target/src/spec/targets/aarch64_unknown_linux_gnu.rs:6 target
export function target(): Target {
  return new Target(
    /* llvm_target */ "aarch64-unknown-linux-gnu",
    /* metadata */ {
      description: "ARM64 Linux (kernel 4.1, glibc 2.17+)",
      tier: 1,
      host_tools: true,
      std: true,
    },
    /* pointer_width */ 64,
    /* arch */ Arch.AArch64,
    /* data_layout */ "e-m:e-p270:32:32-p271:32:32-p272:64:64-i8:8:32-i16:16:32-i64:64-i128:128-n32:64-S128-Fn32",
    /* options */ TargetOptions.update(base.linux_gnu.opts(), {
      pre_link_args: TargetOptions.link_args(LinkerFlavor.Gnu("Yes", "No"), ["-Wl,--fix-cortex-a53-843419"]),
      features: "+v8a,+outline-atomics",
      frame_pointer: "NonLeaf",
      mcount: "\u{1}_mcount",
      max_atomic_width: 128,
      stack_probes: StackProbeType.Inline,
      supported_sanitizers:
        SanitizerSet.ADDRESS |
        SanitizerSet.CFI |
        SanitizerSet.KCFI |
        SanitizerSet.LEAK |
        SanitizerSet.MEMORY |
        SanitizerSet.MEMTAG |
        SanitizerSet.THREAD |
        SanitizerSet.HWADDRESS |
        SanitizerSet.REALTIME,
      supports_xray: true,
    }),
  );
}
