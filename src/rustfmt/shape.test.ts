// Port of the `#[cfg(test)] mod test` of src/tools/rustfmt/src/shape.rs:333 (lane rustfmt-contract-1).
import { expect, test } from "bun:test";
import { Panic, Unported } from "../std/panic.ts";
import { install_serde_stubs } from "./config/serde_stubs.test_support.ts";
import { Indent, Shape } from "./shape.ts";

install_serde_stubs();
const { default_Config } = await import("./config/mod.ts");

// rustc: src/tools/rustfmt/src/shape.rs:338 indent_add_sub
test("indent_add_sub", () => {
  let indent = Indent.new(4, 8).add(Indent.new(8, 12));
  expect(indent.block_indent).toBe(12);
  expect(indent.alignment).toBe(20);

  indent = indent.sub(Indent.new(4, 4));
  expect(indent.block_indent).toBe(8);
  expect(indent.alignment).toBe(16);
});

// rustc: src/tools/rustfmt/src/shape.rs:349 indent_add_sub_alignment
test("indent_add_sub_alignment", () => {
  let indent = Indent.new(4, 8).add_usize(4);
  expect(indent.block_indent).toBe(4);
  expect(indent.alignment).toBe(12);

  indent = indent.sub_usize(4);
  expect(indent.block_indent).toBe(4);
  expect(indent.alignment).toBe(8);
});

// rustc: src/tools/rustfmt/src/shape.rs:360 indent_to_string_spaces
test("indent_to_string_spaces", () => {
  const config = default_Config();
  const indent = Indent.new(4, 8);

  // 12 spaces
  expect(indent.to_string(config)).toBe("            ");
});

// rustc: src/tools/rustfmt/src/shape.rs:369 indent_to_string_hard_tabs
test("indent_to_string_hard_tabs", () => {
  const config = default_Config();
  config.set().hard_tabs(true);
  const indent = Indent.new(8, 4);

  // 2 tabs + 4 spaces
  expect(indent.to_string(config)).toBe("\t\t    ");
});

// rustc: src/tools/rustfmt/src/shape.rs:379 shape_visual_indent
test("shape_visual_indent", () => {
  const config = default_Config();
  const indent = Indent.new(4, 8);
  let shape = Shape.legacy(config.max_width(), indent);
  shape = shape.visual_indent(20);

  expect(shape.width).toBe(config.max_width());
  expect(shape.indent.block_indent).toBe(4);
  expect(shape.indent.alignment).toBe(28);
  expect(shape.offset).toBe(28);
});

// rustc: src/tools/rustfmt/src/shape.rs:392 shape_block_indent_without_alignment
test("shape_block_indent_without_alignment", () => {
  const config = default_Config();
  const indent = Indent.new(4, 0);
  let shape = Shape.legacy(config.max_width(), indent);
  shape = shape.block_indent(20);

  expect(shape.width).toBe(config.max_width());
  expect(shape.indent.block_indent).toBe(24);
  expect(shape.indent.alignment).toBe(0);
  expect(shape.offset).toBe(0);
});

// rustc: src/tools/rustfmt/src/shape.rs:405 shape_block_indent_with_alignment
test("shape_block_indent_with_alignment", () => {
  const config = default_Config();
  const indent = Indent.new(4, 8);
  let shape = Shape.legacy(config.max_width(), indent);
  shape = shape.block_indent(20);

  expect(shape.width).toBe(config.max_width());
  expect(shape.indent.block_indent).toBe(4);
  expect(shape.indent.alignment).toBe(28);
  expect(shape.offset).toBe(28);
});

test("not upstream: to_string_inner past INDENT_BUFFER, checked/saturating/wrapping subtraction (shape.rs:79, :257, :118)", () => {
  const config = default_Config();
  expect(Indent.new(80, 0).to_string(config)).toBe(" ".repeat(80));
  expect(Indent.new(80, 0).to_string_with_newline(config)).toBe("\n" + " ".repeat(80));
  expect(Indent.new(81, 0).to_string(config)).toBe(" ".repeat(81));
  const s = Shape.legacy(10, Indent.empty());
  expect(s.sub_width_opt(11)).toBeUndefined();
  expect(s.sub_width(10, 0 as never)).toEqual({ $: "Ok", _0: new Shape(0, Indent.empty(), 0) });
  expect(s.offset_left(11, 7 as never)).toEqual({ $: "Err", _0: { configured_width: 10, span: 7 as never } });
  expect(s.saturating_sub_width(11).width).toBe(0);
  expect(Shape.indented(Indent.new(104, 0), config).width).toBe(0);
  expect(() => Indent.new(0, 0).sub_usize(1)).toThrow(Unported);
});

test("not upstream: hard_tabs with tab_spaces = 0 divides by zero, a Panic as in Rust (shape.rs:32, :79)", () => {
  const config = default_Config();
  config.set().hard_tabs(true);
  config.set().tab_spaces(0);
  expect(() => Indent.from_width(config, 8)).toThrow(new Panic("attempt to divide by zero"));
  expect(() => Indent.new(8, 0).to_string(config)).toThrow(Panic);
  // a Panic, so lib.rs's `catch_unwind` (format_snippet) discards it as upstream discards the panic
  let caught: unknown;
  try {
    Indent.new(8, 0).to_string(config);
  } catch (e) {
    caught = e;
  }
  expect(caught instanceof Panic && caught.message).toBe("attempt to divide by zero");
});
