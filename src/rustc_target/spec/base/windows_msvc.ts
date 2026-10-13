// compiler/rustc_target/src/spec/base/windows_msvc.rs
import { Env, Os, TargetOptions } from "../mod.ts";
import * as base_mod from "./mod.ts";

// rustc: compiler/rustc_target/src/spec/base/windows_msvc.rs:3 opts
export function opts(): TargetOptions {
  const base = base_mod.msvc.opts();

  return TargetOptions.update(base, {
    os: Os.Windows,
    env: Env.Msvc,
    vendor: "pc",
    dynamic_linking: true,
    dll_prefix: "",
    dll_suffix: ".dll",
    exe_suffix: ".exe",
    staticlib_prefix: "",
    staticlib_suffix: ".lib",
    families: ["windows"],
    crt_static_allows_dylibs: true,
    crt_static_respected: true,
    requires_uwtable: true,
    // We don't pass the /NODEFAULTLIB flag to the linker on MSVC
    // as that prevents linker directives embedded in object files from
    // including other necessary libraries.
    //
    // For example, msvcrt.lib embeds a linker directive like:
    //    /DEFAULTLIB:vcruntime.lib /DEFAULTLIB:ucrt.lib
    // So that vcruntime.lib and ucrt.lib are included when the entry point
    // in msvcrt.lib is used. Using /NODEFAULTLIB would mean having to
    // manually add those two libraries and potentially further dependencies
    // they bring in.
    //
    // See also https://learn.microsoft.com/en-us/cpp/preprocessor/comment-c-cpp?view=msvc-170#lib
    // for documentation on including library dependencies in C/C++ code.
    no_default_libraries: false,
    has_thread_local: true,
  });
}
