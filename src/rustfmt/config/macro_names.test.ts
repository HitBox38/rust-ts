// Port of the `#[cfg(test)] mod test` of src/tools/rustfmt/src/config/macro_names.rs:101 (lane rustfmt-contract-1).
import { expect, test } from "bun:test";
import { Unported } from "../../std/panic.ts";
import { install_serde_stubs } from "./serde_stubs.test_support.ts";

install_serde_stubs();
await import("./mod.ts");
const { MacroSelectors, MacroSelector, MacroName, display_MacroSelectors, MacroSelectors_eq } = await import("./macro_names.ts");

// PORT: both upstream tests start with `MacroSelectors::from_str(r#"["foo", "*", "bar"]"#)`, which parses JSON with serde_json
// (not ported, plan-m8 D6): each checks that it stops there, then runs the rest on the value the parse yields.
const parsed = () => ({ _0: ["foo", "*", "bar"].map((raw) => (MacroSelector.from_str(raw) as { _0: typeof MacroSelector.All })._0) });

// rustc: src/tools/rustfmt/src/config/macro_names.rs:107 macro_names_from_str
test("macro_names_from_str", () => {
  expect(() => MacroSelectors.from_str(`["foo", "*", "bar"]`)).toThrow(Unported);
  const macro_names = parsed();
  expect(
    MacroSelectors_eq(macro_names, {
      _0: [{ $: "Name", _0: MacroName.new("foo") }, MacroSelector.All, { $: "Name", _0: MacroName.new("bar") }],
    }),
  ).toBe(true);
});

// rustc: src/tools/rustfmt/src/config/macro_names.rs:124 macro_names_display
test("macro_names_display", () => {
  expect(() => MacroSelectors.from_str(`["foo", "*", "bar"]`)).toThrow(Unported);
  const macro_names = parsed();
  expect(display_MacroSelectors(macro_names)).toBe("foo, *, bar");
});
