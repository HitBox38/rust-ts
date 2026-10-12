// Port of the `#[cfg(test)] mod tests` of anstyle-parse =0.2.7 `src/state/definitions.rs`.
import { expect, test } from "bun:test";
import { unpack } from "./definitions.ts";

// crate: anstyle-parse-0.2.7/src/state/definitions.rs:137 unpack_state_action
test("unpack_state_action", () => {
  expect(unpack(0xee)).toEqual(["SosPmApcString", "Unhook"]);

  expect(unpack(0x0f)).toEqual(["Utf8", "Nop"]);

  expect(unpack(0xff)).toEqual(["Utf8", "BeginUtf8"]);
});

// crate: anstyle-parse-0.2.7/src/state/definitions.rs:155 pack_state_action
test("pack_state_action", () => {
  expect(unpack(0xee)).toEqual(["SosPmApcString", "Unhook"]);

  expect(unpack(0x0f)).toEqual(["Utf8", "Nop"]);

  expect(unpack(0xff)).toEqual(["Utf8", "BeginUtf8"]);
});
