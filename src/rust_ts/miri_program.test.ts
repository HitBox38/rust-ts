// The environment `run_miri_program` gives both sides (review followups-37 M1).
import { expect, test } from "bun:test";
import { miri_program_env } from "./miri_program.ts";

test("a caller's exported variables do not reach the two Miris, and an ICE writes no file", () => {
  const env = miri_program_env({ PATH: "/bin", RUSTC_LOG: "info", RUSTC_CTFE_BACKTRACE: "1", MallocStackLogging: "1", CLICOLOR_FORCE: "1", RUST_BACKTRACE: "full" });
  for (const k of ["RUSTC_LOG", "RUSTC_CTFE_BACKTRACE", "MallocStackLogging", "CLICOLOR_FORCE"]) expect(env[k]).toBeUndefined();
  expect(env.RUST_BACKTRACE).toBe("0");
  expect(env.RUSTC_ICE).toBe("0");
  expect(env.PATH).toBe("/bin");
});
