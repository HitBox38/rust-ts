// Not upstream: the companion const of `IntrinsicResult` (docs/reviews/ssa-contract.md N2), as `OperandValue.ZeroSized`.
import { expect, test } from "bun:test";
import { IntrinsicResult } from "./mod.ts";

test("IntrinsicResult.WroteIntoPlace is a shared frozen unit variant", () => {
  const r: IntrinsicResult<number> = IntrinsicResult.WroteIntoPlace;
  expect(r).toEqual({ $: "WroteIntoPlace" });
  expect(Object.isFrozen(IntrinsicResult.WroteIntoPlace)).toBe(true);
});
