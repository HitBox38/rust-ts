// compiler/rustc_target/src/spec/targets/x86_64_unknown_linux_gnu.rs
import { Arch, LinkerFlavor, SanitizerSet, StackProbeType, Target } from "../mod.ts";
import * as base from "../base/mod.ts";

// rustc: compiler/rustc_target/src/spec/targets/x86_64_unknown_linux_gnu.rs:5 target
export function target(): Target {
  const base_ = base.linux_gnu.opts();
  base_.cpu = "x86-64";
  base_.plt_by_default = false;
  base_.max_atomic_width = 64;
  base_.add_pre_link_args(LinkerFlavor.Gnu("Yes", "No"), ["-m64"]);
  base_.stack_probes = StackProbeType.Inline;
  base_.supported_sanitizers =
    SanitizerSet.ADDRESS |
    SanitizerSet.CFI |
    SanitizerSet.KCFI |
    SanitizerSet.DATAFLOW |
    SanitizerSet.LEAK |
    SanitizerSet.MEMORY |
    SanitizerSet.SAFESTACK |
    SanitizerSet.THREAD |
    SanitizerSet.REALTIME;
  base_.supports_fentry = true;
  base_.supports_xray = true;

  return new Target(
    /* llvm_target */ "x86_64-unknown-linux-gnu",
    /* metadata */ {
      description: "64-bit Linux (kernel 3.2+, glibc 2.17+)",
      tier: 1,
      host_tools: true,
      std: true,
    },
    /* pointer_width */ 64,
    /* arch */ Arch.X86_64,
    /* data_layout */ "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128",
    /* options */ base_,
  );
}
