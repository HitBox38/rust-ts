// Port of the `#[cfg(test)] mod test` of colorchoice =1.0.4 `src/lib.rs`, plus a rust-ts check of
// the global.
import { expect, test } from "bun:test";
import { AtomicChoice, ColorChoice } from "./lib.ts";

// crate: colorchoice-1.0.4/src/lib.rs:97 choice_serialization
test("choice_serialization", () => {
  const expected: ColorChoice[] = ["Auto", "AlwaysAnsi", "Always", "Never"];
  const values = expected.map(AtomicChoice.from_choice);
  const actual = values.map(AtomicChoice.to_choice).filter((c) => c !== undefined);
  expect(actual).toEqual(expected);
});

test("rust-ts: global defaults to Auto and can be overridden", () => {
  expect(ColorChoice.global()).toBe("Auto");
  ColorChoice.write_global("Never");
  expect(ColorChoice.global()).toBe("Never");
  ColorChoice.write_global(ColorChoice.default_());
  expect(ColorChoice.global()).toBe("Auto");
});
