// compiler/rustc_target/src/spec/base/linux.rs
import { Os, TargetOptions } from "../mod.ts";

// rustc: compiler/rustc_target/src/spec/base/linux.rs:5 opts
export function opts(): TargetOptions {
  return TargetOptions.update(TargetOptions.default(), {
    os: Os.Linux,
    dynamic_linking: true,
    families: ["unix"],
    has_rpath: true,
    position_independent_executables: true,
    relro_level: "Full",
    has_thread_local: true,
    crt_static_respected: true,
    // We want backtraces to work by default and they rely on unwind tables
    // (regardless of `-C panic` strategy).
    default_uwtable: true,
    supported_split_debuginfo: ["Packed", "Unpacked", "Off"],
  });
}
