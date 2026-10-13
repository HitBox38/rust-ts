// compiler/rustc_target/src/spec/targets/x86_64_apple_darwin.rs
import { Os, SanitizerSet, Target, TargetOptions } from "../mod.ts";
import { base } from "../base/apple/mod.ts";

// rustc: compiler/rustc_target/src/spec/targets/x86_64_apple_darwin.rs:4 target
export function target(): Target {
  const [opts, llvm_target, arch] = base(Os.MacOs, "X86_64", "Normal");
  return new Target(
    llvm_target,
    /* metadata */ {
      description: "x86_64 Apple macOS (10.12+, Sierra+)",
      tier: 2,
      host_tools: true,
      std: true,
    },
    /* pointer_width */ 64,
    arch,
    /* data_layout */ "e-m:o-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128",
    /* options */ TargetOptions.update(opts, {
      mcount: "\u{1}mcount",
      max_atomic_width: 128, // penryn+ supports cmpxchg16b
      supported_sanitizers:
        SanitizerSet.ADDRESS | SanitizerSet.CFI | SanitizerSet.LEAK | SanitizerSet.THREAD | SanitizerSet.REALTIME,
      supports_xray: true,
    }),
  );
}
