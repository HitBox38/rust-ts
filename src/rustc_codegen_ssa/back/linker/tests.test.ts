// Port of compiler/rustc_codegen_ssa/src/back/linker/tests.rs (lane ssa-linker).
import { expect, test } from "bun:test";
import { Command } from "../command.ts";
import { convert_link_args_to_cc_args } from "../linker.ts";

// rustc: compiler/rustc_codegen_ssa/src/back/linker/tests.rs:4 test_rpaths_to_args
test("test_rpaths_to_args", () => {
  const cmd = Command.new("foo");
  convert_link_args_to_cc_args(cmd, ["-rpath", "path1", "-rpath", "path2"]);
  expect(cmd.get_args()).toEqual(["-Wl,-rpath,path1,-rpath,path2"]);
});

// rustc: compiler/rustc_codegen_ssa/src/back/linker/tests.rs:11 test_xlinker
test("test_xlinker", () => {
  const cmd = Command.new("foo");
  convert_link_args_to_cc_args(cmd, ["arg1", "arg2", "arg3,with,comma", "arg4,with,comma", "arg5", "arg6,with,comma"]);

  expect(cmd.get_args()).toEqual([
    "-Wl,arg1,arg2",
    "-Xlinker",
    "arg3,with,comma",
    "-Xlinker",
    "arg4,with,comma",
    "-Wl,arg5",
    "-Xlinker",
    "arg6,with,comma",
  ]);
});
