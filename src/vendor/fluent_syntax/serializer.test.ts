// Port of the `#[cfg(test)] mod test` in fluent-syntax-0.12.0/src/serializer.rs.
// PORT: the test-only `as_*` accessors return the node to mutate (`&mut T` → the object itself);
// `as_text` returns the `TextElement` whose `value` the test assigns. `text_message!` → a function.
import { expect, test } from "bun:test";
import { panic, unwrap } from "../../std/panic.ts";
import { unwrap_result } from "../../std/result.ts";
import { Str } from "../../std/str.ts";
import type { Entry, Expression, Identifier, Message, Pattern, PatternElement, Variant } from "./ast/mod.ts";
import { parse } from "./parser/mod.ts";
import { serialize, TextWriter_default } from "./serializer.ts";

const s = (x: string) => Str.from(x);
const parse_ok = (x: string) => unwrap_result(parse(s(x)));

// crate: fluent-syntax-0.12.0/src/serializer.rs:457 write_something_then_indent
test("write_something_then_indent", () => {
  const writer = TextWriter_default();

  writer.write_literal("foo =");
  writer.newline();
  writer.indent();
  writer.write_literal("first line");
  writer.newline();
  writer.write_literal("second line");
  writer.newline();
  writer.dedent();
  writer.write_literal("not indented");
  writer.newline();

  const got = writer.buffer;
  expect(got).toBe("foo =\n    first line\n    second line\nnot indented\n");
});

/** `text_message!($name, $value)` */
function text_message(name: string, value: string): Entry {
  return {
    $: "Message",
    _0: {
      id: { name: s(name) },
      value: {
        elements: [{ $: "TextElement", value: s(value) }],
      },
      attributes: [],
      comment: undefined,
    },
  };
}

// crate: fluent-syntax-0.12.0/src/serializer.rs:492 as_message
function as_message(self: Entry): Message {
  if (self.$ === "Message") return self._0;
  return panic("Expected Message");
}

// crate: fluent-syntax-0.12.0/src/serializer.rs:501 as_pattern
function as_pattern(self: Message): Pattern {
  return unwrap(self.value, "Expected Pattern");
}

// crate: fluent-syntax-0.12.0/src/serializer.rs:507 as_text
function as_text(self: PatternElement): { value: Str } {
  if (self.$ === "TextElement") return self;
  return panic("Expected TextElement");
}

// crate: fluent-syntax-0.12.0/src/serializer.rs:514 as_expression
function as_expression(self: PatternElement): Expression {
  if (self.$ === "Placeable") return self.expression;
  return panic("Expected Placeable");
}

// crate: fluent-syntax-0.12.0/src/serializer.rs:523 as_variants
function as_variants(self: Expression): Variant[] {
  if (self.$ === "Select") return self.variants;
  return panic("Expected Select");
}

// crate: fluent-syntax-0.12.0/src/serializer.rs:529 as_inline_variable_id
function as_inline_variable_id(self: Expression): Identifier {
  if (self.$ === "Inline" && self._0.$ === "VariableReference") return self._0.id;
  return panic("Expected Inline");
}

// crate: fluent-syntax-0.12.0/src/serializer.rs:538 change_id
test("change_id", () => {
  const ast = parse_ok("foo = bar\n");
  as_message(ast.body[0]!).id.name = s("baz");
  expect(serialize(ast)).toBe("baz = bar\n");
});

// crate: fluent-syntax-0.12.0/src/serializer.rs:545 change_value
test("change_value", () => {
  const ast = parse_ok("foo = bar\n");
  as_text(as_pattern(as_message(ast.body[0]!)).elements[0]!).value = s("baz");
  expect(serialize(ast)).toBe("foo = baz\n");
});

// crate: fluent-syntax-0.12.0/src/serializer.rs:552 add_expression_variant
test("add_expression_variant", () => {
  const message = ["foo =\n", "    { $num ->\n", "       *[other] { $num } bars\n", "    }\n"].join("");
  const ast = parse_ok(message);

  const one_variant: Variant = {
    key: { $: "Identifier", name: s("one") },
    value: {
      elements: [
        {
          $: "Placeable",
          expression: {
            $: "Inline",
            _0: {
              $: "VariableReference",
              id: { name: s("num") },
            },
          },
        },
        { $: "TextElement", value: s(" bar") },
      ],
    },
    default: false,
  };
  as_variants(as_expression(as_pattern(as_message(ast.body[0]!)).elements[0]!)).splice(0, 0, one_variant);

  const expected = ["foo =\n", "    { $num ->\n", "        [one] { $num } bar\n", "       *[other] { $num } bars\n", "    }\n"].join("");
  expect(serialize(ast)).toBe(expected);
});

// crate: fluent-syntax-0.12.0/src/serializer.rs:591 change_variable_reference
test("change_variable_reference", () => {
  const ast = parse_ok("foo = { $bar }\n");
  as_inline_variable_id(as_expression(as_pattern(as_message(ast.body[0]!)).elements[0]!)).name = s("qux");
  expect(serialize(ast)).toBe("foo = { $qux }\n");
});

// crate: fluent-syntax-0.12.0/src/serializer.rs:601 remove_message
test("remove_message", () => {
  const ast = parse_ok("foo = bar\nbaz = qux\n");
  ast.body.pop();
  expect(serialize(ast)).toBe("foo = bar\n");
});

// crate: fluent-syntax-0.12.0/src/serializer.rs:608 add_message_at_top
test("add_message_at_top", () => {
  const ast = parse_ok("foo = bar\n");
  ast.body.splice(0, 0, text_message("baz", "qux"));
  expect(serialize(ast)).toBe("baz = qux\nfoo = bar\n");
});

// crate: fluent-syntax-0.12.0/src/serializer.rs:615 add_message_at_end
test("add_message_at_end", () => {
  const ast = parse_ok("foo = bar\n");
  ast.body.push(text_message("baz", "qux"));
  expect(serialize(ast)).toBe("foo = bar\nbaz = qux\n");
});

// crate: fluent-syntax-0.12.0/src/serializer.rs:622 add_message_in_between
test("add_message_in_between", () => {
  const ast = parse_ok("foo = bar\nbaz = qux\n");
  ast.body.splice(1, 0, text_message("hello", "there"));
  expect(serialize(ast)).toBe("foo = bar\nhello = there\nbaz = qux\n");
});

// crate: fluent-syntax-0.12.0/src/serializer.rs:629 add_message_comment
test("add_message_comment", () => {
  const ast = parse_ok("foo = bar\n");
  as_message(ast.body[0]!).comment = {
    content: [s("great message!")],
  };
  expect(serialize(ast)).toBe("# great message!\nfoo = bar\n");
});

// crate: fluent-syntax-0.12.0/src/serializer.rs:638 remove_message_comment
test("remove_message_comment", () => {
  const ast = parse_ok("# great message!\nfoo = bar\n");
  as_message(ast.body[0]!).comment = undefined;
  expect(serialize(ast)).toBe("foo = bar\n");
});

// crate: fluent-syntax-0.12.0/src/serializer.rs:645 edit_message_comment
test("edit_message_comment", () => {
  const ast = parse_ok("# great message!\nfoo = bar\n");
  unwrap(as_message(ast.body[0]!).comment, "comment is missing").content[0] = s("very original");
  expect(serialize(ast)).toBe("# very original\nfoo = bar\n");
});
