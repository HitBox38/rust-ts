// compiler/rustc_target/src/spec/targets/x86_64_pc_windows_msvc.rs
import { Arch, SanitizerSet, Target } from "../mod.ts";
import * as base from "../base/mod.ts";

// rustc: compiler/rustc_target/src/spec/targets/x86_64_pc_windows_msvc.rs:3 target
export function target(): Target {
  const base_ = base.windows_msvc.opts();
  base_.cpu = "x86-64";
  base_.features = "+cmpxchg16b,+sse3,+lahfsahf";
  base_.plt_by_default = false;
  base_.max_atomic_width = 128;
  base_.supported_sanitizers = SanitizerSet.ADDRESS;

  return new Target(
    /* llvm_target */ "x86_64-pc-windows-msvc",
    /* metadata */ {
      description: "64-bit MSVC (Windows 10+)",
      tier: 1,
      host_tools: true,
      std: true,
    },
    /* pointer_width */ 64,
    /* arch */ Arch.X86_64,
    /* data_layout */ "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128",
    /* options */ base_,
  );
}
