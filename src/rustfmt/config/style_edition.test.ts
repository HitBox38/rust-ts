// Port of the `#[cfg(test)] mod test` of src/tools/rustfmt/src/config/style_edition.rs:43 (lane rustfmt-contract-1).
import { expect, test } from "bun:test";
import type { StyleEdition } from "./options.gen.ts";
import type { StyleEditionDefault } from "./style_edition.ts";

// rustc: src/tools/rustfmt/src/config/style_edition.rs:48 test_impl_default_style_edition_struct_for_all_editions
test("test_impl_default_style_edition_struct_for_all_editions", () => {
  // struct Unit;
  // style_edition_default!(Unit, usize, _ => 100);
  // PORT: the macro's first arm (style_edition.rs:13), expanded as tools/codegen/create_config.ts expands it.
  const Unit: StyleEditionDefault<number> = {
    style_edition_default(_: StyleEdition): number {
      return 100;
    },
  };

  // regardless of the style edition used the value will always return 100
  expect(Unit.style_edition_default("Edition2015")).toBe(100);
  expect(Unit.style_edition_default("Edition2018")).toBe(100);
  expect(Unit.style_edition_default("Edition2021")).toBe(100);
  expect(Unit.style_edition_default("Edition2024")).toBe(100);
  expect(Unit.style_edition_default("Edition2027")).toBe(100);
});

// rustc: src/tools/rustfmt/src/config/style_edition.rs:61 test_impl_default_style_edition_for_old_and_new_editions
test("test_impl_default_style_edition_for_old_and_new_editions", () => {
  // struct Unit;
  // style_edition_default!(Unit, usize, Edition2024 => 50, _ => 100);
  // PORT: the macro's second arm (style_edition.rs:22), expanded as tools/codegen/create_config.ts expands it.
  const Unit: StyleEditionDefault<number> = {
    style_edition_default(style_edition: StyleEdition): number {
      switch (style_edition) {
        case "Edition2015":
        case "Edition2018":
        case "Edition2021":
          return 100;
        // TODO: should update macro when default_2027 becomes available
        case "Edition2024":
        case "Edition2027":
          return 50;
      }
    },
  };

  // style edition 2015-2021 are all the same
  expect(Unit.style_edition_default("Edition2015")).toBe(100);
  expect(Unit.style_edition_default("Edition2018")).toBe(100);
  expect(Unit.style_edition_default("Edition2021")).toBe(100);

  // style edition 2024
  expect(Unit.style_edition_default("Edition2024")).toBe(50);
  expect(Unit.style_edition_default("Edition2027")).toBe(50);
});
