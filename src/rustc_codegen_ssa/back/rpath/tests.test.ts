// Port of compiler/rustc_codegen_ssa/src/back/rpath/tests.rs (`#[cfg(all(unix, test))]`).
import { describe, expect, test } from "bun:test";
import { get_rpath_relative_to_output, minimize_rpaths, type RPathConfig } from "../rpath.ts";

describe.skipIf(process.platform === "win32")("rpath", () => {
  // rustc: compiler/rustc_codegen_ssa/src/back/rpath/tests.rs:4 test_minimize1
  test("test_minimize1", () => {
    const res = minimize_rpaths(["rpath1", "rpath2", "rpath1"]);
    expect(res).toEqual(["rpath1", "rpath2"]);
  });

  // rustc: compiler/rustc_codegen_ssa/src/back/rpath/tests.rs:10 test_minimize2
  test("test_minimize2", () => {
    const res = minimize_rpaths(["1a", "2", "2", "1a", "4a", "1a", "2", "3", "4a", "3"]);
    expect(res).toEqual(["1a", "2", "4a", "3"]);
  });

  // rustc: compiler/rustc_codegen_ssa/src/back/rpath/tests.rs:27 test_rpath_relative
  test("test_rpath_relative", () => {
    if (process.platform === "darwin") {
      const config: RPathConfig = {
        libs: [],
        is_like_darwin: true,
        linker_is_gnu: false,
        out_filename: "bin/rustc",
      };
      const res = get_rpath_relative_to_output(config, "lib/libstd.so");
      expect(res).toBe("@loader_path/../lib");
    } else {
      const config: RPathConfig = {
        libs: [],
        out_filename: "bin/rustc",
        is_like_darwin: false,
        linker_is_gnu: true,
      };
      const res = get_rpath_relative_to_output(config, "lib/libstd.so");
      expect(res).toBe("$ORIGIN/../lib");
    }
  });

  // rustc: compiler/rustc_codegen_ssa/src/back/rpath/tests.rs:50 test_rpath_relative_issue_119571
  test("test_rpath_relative_issue_119571", () => {
    const config: RPathConfig = {
      libs: [],
      out_filename: "rustc",
      is_like_darwin: false,
      linker_is_gnu: true,
    };
    // Should not panic when out_filename only contains filename.
    // Issue 119571
    get_rpath_relative_to_output(config, "lib/libstd.so");
    // Should not panic when lib only contains filename.
    get_rpath_relative_to_output(config, "libstd.so");
  });
});
