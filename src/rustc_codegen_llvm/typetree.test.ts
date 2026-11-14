// typetree.ts's `add_tt` head (lane cg-register): upstream returns before any Enzyme call unless `-Zautodiff=Enable` is set without
// `NoTT` (typetree.rs:78-88); `memcpy` (builder.rs:1196) calls it with a type tree in ordinary programs, so it must not stop there.
import { expect, test } from "bun:test";
import { AutoDiff } from "../rustc_session/config.ts";
import { Unported } from "../std/panic.ts";
import { add_tt } from "./typetree.ts";

const cx = (autodiff: readonly AutoDiff[]) => ({ tcx: { sess: { opts: { unstable_opts: { autodiff } } } } }) as never;
const stop = (f: () => void): string | undefined => {
  try {
    f();
    return undefined;
  } catch (e) {
    if (e instanceof Unported) return e.what;
    throw e;
  }
};

test("add_tt returns without -Zautodiff=Enable, or with NoTT", () => {
  expect(stop(() => add_tt(cx([]), undefined as never, undefined as never))).toBeUndefined();
  expect(stop(() => add_tt(cx([AutoDiff.Enable, AutoDiff.NoTT]), undefined as never, undefined as never))).toBeUndefined();
});

test("add_tt stops (out of M7) with -Zautodiff=Enable", () => {
  expect(stop(() => add_tt(cx([AutoDiff.Enable]), undefined as never, undefined as never))).toBe("excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/typetree.rs add_tt");
});
