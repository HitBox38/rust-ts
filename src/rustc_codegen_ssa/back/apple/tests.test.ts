// Port of compiler/rustc_codegen_ssa/src/back/apple/tests.rs (lane object-write-macho).
//
// PORT: `lookup_developer_dir`, `lookup_sdk`, `lookup_sdk_verbose` and `try_lookup_invalid_sdk` run `xcrun` and
// `xcode-select` through `xcrun_show_sdk_path` and `xcode_select_developer_dir`, which are not ported (../apple.ts).
import { expect, test } from "bun:test";
import { OSVersion } from "../../../rustc_target/spec/base/apple/mod.ts";
import { add_version_to_llvm_target } from "../apple.ts";

// rustc: compiler/rustc_codegen_ssa/src/back/apple/tests.rs:4 test_add_version_to_llvm_target
test("test_add_version_to_llvm_target", () => {
  expect(add_version_to_llvm_target("aarch64-apple-macosx", OSVersion.new(10, 14, 1))).toBe("aarch64-apple-macosx10.14.1");
  expect(add_version_to_llvm_target("aarch64-apple-ios-simulator", OSVersion.new(16, 1, 0))).toBe("aarch64-apple-ios16.1.0-simulator");
});
