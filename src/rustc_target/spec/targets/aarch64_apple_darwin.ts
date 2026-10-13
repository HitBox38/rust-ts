// compiler/rustc_target/src/spec/targets/aarch64_apple_darwin.rs
import { Os, SanitizerSet, Target, TargetOptions } from "../mod.ts";
import { base } from "../base/apple/mod.ts";

// rustc: compiler/rustc_target/src/spec/targets/aarch64_apple_darwin.rs:4 target
export function target(): Target {
  const [opts, llvm_target, arch] = base(Os.MacOs, "Arm64", "Normal");
  return new Target(
    llvm_target,
    /* metadata */ {
      description: "ARM64 Apple macOS (11.0+, Big Sur+)",
      tier: 1,
      host_tools: true,
      std: true,
    },
    /* pointer_width */ 64,
    arch,
    /* data_layout */ "e-m:o-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-n32:64-S128-Fn32",
    /* options */ TargetOptions.update(opts, {
      mcount: "\u{1}mcount",
      cpu: "apple-m1",
      max_atomic_width: 128,
      // FIXME: The leak sanitizer currently fails the tests, see #88132.
      supported_sanitizers: SanitizerSet.ADDRESS | SanitizerSet.CFI | SanitizerSet.THREAD | SanitizerSet.REALTIME,
      supports_xray: true,
    }),
  );
}
