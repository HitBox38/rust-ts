// Port of compiler/rustc_codegen_ssa/src/back/apple/tests.rs (lanes object-write-macho, vendor-object-write).
//
// PORT: `#[cfg_attr(not(target_os = "macos"), ignore = ...)]` is `test.skipIf(process.platform !== "darwin")`. These run the
// host's `xcrun` and `xcode-select`, as upstream's do (host tools, not debuggers).
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { OSVersion } from "../../../rustc_target/spec/base/apple/mod.ts";
import { add_version_to_llvm_target, xcode_select_developer_dir, xcrun_show_sdk_path } from "../apple.ts";

const not_macos = process.platform !== "darwin";

// rustc: compiler/rustc_codegen_ssa/src/back/apple/tests.rs:4 test_add_version_to_llvm_target
test("test_add_version_to_llvm_target", () => {
  expect(add_version_to_llvm_target("aarch64-apple-macosx", OSVersion.new(10, 14, 1))).toBe("aarch64-apple-macosx10.14.1");
  expect(add_version_to_llvm_target("aarch64-apple-ios-simulator", OSVersion.new(16, 1, 0))).toBe("aarch64-apple-ios16.1.0-simulator");
});

// rustc: compiler/rustc_codegen_ssa/src/back/apple/tests.rs:17 lookup_developer_dir
test.skipIf(not_macos)("lookup_developer_dir", () => {
  const developer_dir = xcode_select_developer_dir();
  expect(developer_dir).toBeDefined();
});

// rustc: compiler/rustc_codegen_ssa/src/back/apple/tests.rs:23 lookup_sdk
test.skipIf(not_macos)("lookup_sdk", () => {
  const r = xcrun_show_sdk_path("MacOSX", false);
  if (r.$ !== "Ok") throw new Error(`called \`Result::unwrap()\` on an \`Err\` value: ${r._0.$}`);
  const [sdk_path, stderr] = r._0;
  // Check that the found SDK is valid.
  expect(existsSync(join(sdk_path, "SDKSettings.plist"))).toBe(true);
  expect(stderr).toBe("");

  // Test that the SDK root is a subdir of the developer directory.
  // PORT: upstream asserts this only when `SDKROOT` is set; unit tests may not read that variable
  // (scripts/lib/unit-steps.test.ts), so the branch is left out. Only that one assertion is lost.
});

// rustc: compiler/rustc_codegen_ssa/src/back/apple/tests.rs:40 lookup_sdk_verbose
test.skipIf(not_macos)("lookup_sdk_verbose", () => {
  const r = xcrun_show_sdk_path("MacOSX", true);
  if (r.$ !== "Ok") throw new Error(`called \`Result::unwrap()\` on an \`Err\` value: ${r._0.$}`);
  const [, stderr] = r._0;
  // Newer xcrun versions should emit something like this:
  //
  //     xcrun: note: looking up SDK with 'xcodebuild -sdk macosx -version Path'
  //     xcrun: note: xcrun_db = '/var/.../xcrun_db'
  //     xcrun: note: lookup resolved to: '...'
  //     xcrun: note: database key is: ...
  //
  // Or if the value is already cached, something like this:
  //
  //     xcrun: note: database key is: ...
  //     xcrun: note: lookup resolved in '/var/.../xcrun_db' : '...'
  expect(stderr.includes("xcrun: note: lookup resolved")).toBe(true);
});

// rustc: compiler/rustc_codegen_ssa/src/back/apple/tests.rs:61 try_lookup_invalid_sdk
test.skipIf(not_macos)("try_lookup_invalid_sdk", () => {
  // As a proxy for testing all the different ways that `xcrun` can fail,
  // test the case where an SDK was not found.
  const r = xcrun_show_sdk_path("invalid", false);
  if (r.$ !== "Err") throw new Error("called `Result::unwrap_err()` on an `Ok` value");
  const err = r._0;
  if (err.$ !== "Unsuccessful") throw new Error(`unexpected error kind: ${err.$}`);
  const stderr = err.stderr;
  // Either one of (depending on if using Command Line Tools or full Xcode):
  // xcrun: error: SDK "invalid" cannot be located
  // xcodebuild: error: SDK "invalid" cannot be located.
  expect(stderr.includes('error: SDK "invalid" cannot be located')).toBe(true);
  expect(stderr.includes("xcrun: error: unable to lookup item 'Path' in SDK 'invalid'")).toBe(true);
});
