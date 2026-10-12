// Oracle snapshots for the FTL inputs of fluent-syntax-0.12.0's doc examples (rustdoc tests).
// Each upstream doc test asserts `parser::parse(ftl)` equals an AST literal; the expected strings below
// are `{:?}` of `parser::parse(ftl)` printed by the real crate (=0.12.0, built with the pinned nightly),
// so they equal the Debug of the upstream literals. Not hand-written.
import { expect, test } from "bun:test";
import { PLAIN, PRETTY } from "../../std/fmt.ts";
import { Str } from "../../std/str.ts";
import { debug_ParserError, debug_Result, display_ParserError, parse, parse_runtime } from "./parser/mod.ts";
import { serialize } from "./serializer.ts";
import { StringWriter, unescape_unicode, unescape_unicode_to_string } from "./unicode.ts";

const CASES: [string, string, string][] = [
  ["lib.rs:20", "\n\nhello-world = Hello World!\n\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"hello-world\" }, value: Some(Pattern { elements: [TextElement { value: \"Hello World!\" }] }), attributes: [], comment: None })] })"],
  ["ast/mod.rs:18", "\n\n## This is a message comment\nhello-world = Hello World!\n    .tooltip = Tooltip for you, { $userName }.\n\n", "Ok(Resource { body: [GroupComment(Comment { content: [\"This is a message comment\"] }), Message(Message { id: Identifier { name: \"hello-world\" }, value: Some(Pattern { elements: [TextElement { value: \"Hello World!\" }] }), attributes: [Attribute { id: Identifier { name: \"tooltip\" }, value: Pattern { elements: [TextElement { value: \"Tooltip for you, \" }, Placeable { expression: Inline(VariableReference { id: Identifier { name: \"userName\" } }) }, TextElement { value: \".\" }] } }], comment: None })] })"],
  ["ast/mod.rs:102", "", "Ok(Resource { body: [] })"],
  ["ast/mod.rs:131", "\n\nkey = Value\n\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"key\" }, value: Some(Pattern { elements: [TextElement { value: \"Value\" }] }), attributes: [], comment: None })] })"],
  ["ast/mod.rs:176", "\n\ng@rb@ge En!ry\n\n", "Err((Resource { body: [Junk { content: \"g@rb@ge En!ry\\n\\n\" }] }, [ParserError { pos: 3..4, slice: Some(2..17), kind: ExpectedToken('=') }]))"],
  ["ast/mod.rs:225", "\n\nhello-world = Hello, World!\n\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"hello-world\" }, value: Some(Pattern { elements: [TextElement { value: \"Hello, World!\" }] }), attributes: [], comment: None })] })"],
  ["ast/mod.rs:279", "\n\n-brand-name = Nightly\n\n", "Ok(Resource { body: [Term(Term { id: Identifier { name: \"brand-name\" }, value: Pattern { elements: [TextElement { value: \"Nightly\" }] }, attributes: [], comment: None })] })"],
  ["ast/mod.rs:331", "\n\nhello-world = Hello, World!\n\nwelcome = Welcome, { $userName }.\n\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"hello-world\" }, value: Some(Pattern { elements: [TextElement { value: \"Hello, World!\" }] }), attributes: [], comment: None }), Message(Message { id: Identifier { name: \"welcome\" }, value: Some(Pattern { elements: [TextElement { value: \"Welcome, \" }, Placeable { expression: Inline(VariableReference { id: Identifier { name: \"userName\" } }) }, TextElement { value: \".\" }] }), attributes: [], comment: None })] })"],
  ["ast/mod.rs:408", "\n\nhello-world = Hello, World!\n\nwelcome = Welcome, { $userName }.\n\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"hello-world\" }, value: Some(Pattern { elements: [TextElement { value: \"Hello, World!\" }] }), attributes: [], comment: None }), Message(Message { id: Identifier { name: \"welcome\" }, value: Some(Pattern { elements: [TextElement { value: \"Welcome, \" }, Placeable { expression: Inline(VariableReference { id: Identifier { name: \"userName\" } }) }, TextElement { value: \".\" }] }), attributes: [], comment: None })] })"],
  ["ast/mod.rs:486", "\n\nhello-world =\n    .title = This is a title\n    .accesskey = T\n\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"hello-world\" }, value: None, attributes: [Attribute { id: Identifier { name: \"title\" }, value: Pattern { elements: [TextElement { value: \"This is a title\" }] } }, Attribute { id: Identifier { name: \"accesskey\" }, value: Pattern { elements: [TextElement { value: \"T\" }] } }], comment: None })] })"],
  ["ast/mod.rs:556", "\n\nhello-world = Value\n\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"hello-world\" }, value: Some(Pattern { elements: [TextElement { value: \"Value\" }] }), attributes: [], comment: None })] })"],
  ["ast/mod.rs:604", "\n\nhello-world = { $var ->\n    [key1] Value 1\n   *[other] Value 2\n}\n\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"hello-world\" }, value: Some(Pattern { elements: [Placeable { expression: Select { selector: VariableReference { id: Identifier { name: \"var\" } }, variants: [Variant { key: Identifier { name: \"key1\" }, value: Pattern { elements: [TextElement { value: \"Value 1\" }] }, default: false }, Variant { key: Identifier { name: \"other\" }, value: Pattern { elements: [TextElement { value: \"Value 2\" }] }, default: true }] } }] }), attributes: [], comment: None })] })"],
  ["ast/mod.rs:689", "\n\nhello-world = { $var ->\n    [0] Value 1\n   *[other] Value 2\n}\n\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"hello-world\" }, value: Some(Pattern { elements: [Placeable { expression: Select { selector: VariableReference { id: Identifier { name: \"var\" } }, variants: [Variant { key: NumberLiteral { value: \"0\" }, value: Pattern { elements: [TextElement { value: \"Value 1\" }] }, default: false }, Variant { key: Identifier { name: \"other\" }, value: Pattern { elements: [TextElement { value: \"Value 2\" }] }, default: true }] } }] }), attributes: [], comment: None })] })"],
  ["ast/mod.rs:781", "\n## A standalone level comment\n", "Ok(Resource { body: [GroupComment(Comment { content: [\"A standalone level comment\"] })] })"],
  ["ast/mod.rs:820", "\n\nkey = { FUNC($var1, \"literal\", style: \"long\") }\n\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"key\" }, value: Some(Pattern { elements: [Placeable { expression: Inline(FunctionReference { id: Identifier { name: \"FUNC\" }, arguments: CallArguments { positional: [VariableReference { id: Identifier { name: \"var1\" } }, StringLiteral { value: \"literal\" }], named: [NamedArgument { name: Identifier { name: \"style\" }, value: StringLiteral { value: \"long\" } }] } }) }] }), attributes: [], comment: None })] })"],
  ["ast/mod.rs:898", "\n\nkey = { FUNC(style: \"long\") }\n\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"key\" }, value: Some(Pattern { elements: [Placeable { expression: Inline(FunctionReference { id: Identifier { name: \"FUNC\" }, arguments: CallArguments { positional: [], named: [NamedArgument { name: Identifier { name: \"style\" }, value: StringLiteral { value: \"long\" } }] } }) }] }), attributes: [], comment: None })] })"],
  ["ast/mod.rs:968", "\n\nkey = { $emailCount }\n\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"key\" }, value: Some(Pattern { elements: [Placeable { expression: Inline(VariableReference { id: Identifier { name: \"emailCount\" } }) }] }), attributes: [], comment: None })] })"],
  ["ast/mod.rs:1019", "\n\nkey = { \"this is a literal\" }\n\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"key\" }, value: Some(Pattern { elements: [Placeable { expression: Inline(StringLiteral { value: \"this is a literal\" }) }] }), attributes: [], comment: None })] })"],
  ["ast/mod.rs:1065", "\n\nkey = { -0.5 }\n\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"key\" }, value: Some(Pattern { elements: [Placeable { expression: Inline(NumberLiteral { value: \"-0.5\" }) }] }), attributes: [], comment: None })] })"],
  ["ast/mod.rs:1111", "\n\nkey = { FUNC() }\n\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"key\" }, value: Some(Pattern { elements: [Placeable { expression: Inline(FunctionReference { id: Identifier { name: \"FUNC\" }, arguments: CallArguments { positional: [], named: [] } }) }] }), attributes: [], comment: None })] })"],
  ["ast/mod.rs:1163", "\n\nkey = { key2 }\n\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"key\" }, value: Some(Pattern { elements: [Placeable { expression: Inline(MessageReference { id: Identifier { name: \"key2\" }, attribute: None }) }] }), attributes: [], comment: None })] })"],
  ["ast/mod.rs:1215", "\n\nkey = { -brand-name }\n\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"key\" }, value: Some(Pattern { elements: [Placeable { expression: Inline(TermReference { id: Identifier { name: \"brand-name\" }, attribute: None, arguments: None }) }] }), attributes: [], comment: None })] })"],
  ["ast/mod.rs:1269", "\n\nkey = { $var1 }\n\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"key\" }, value: Some(Pattern { elements: [Placeable { expression: Inline(VariableReference { id: Identifier { name: \"var1\" } }) }] }), attributes: [], comment: None })] })"],
  ["ast/mod.rs:1317", "\n\nkey = { { \"placeable\" } }\n\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"key\" }, value: Some(Pattern { elements: [Placeable { expression: Inline(Placeable { expression: Inline(StringLiteral { value: \"placeable\" }) }) }] }), attributes: [], comment: None })] })"],
  ["ast/mod.rs:1371", "\n\nkey = { $var ->\n    [key1] Value 1\n   *[other] Value 2\n}\n\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"key\" }, value: Some(Pattern { elements: [Placeable { expression: Select { selector: VariableReference { id: Identifier { name: \"var\" } }, variants: [Variant { key: Identifier { name: \"key1\" }, value: Pattern { elements: [TextElement { value: \"Value 1\" }] }, default: false }, Variant { key: Identifier { name: \"other\" }, value: Pattern { elements: [TextElement { value: \"Value 2\" }] }, default: true }] } }] }), attributes: [], comment: None })] })"],
  ["parser/mod.rs:14", "\n#### Resource Level Comment\n\n## This is a message comment\nhello-world = Hello World!\n\n", "Err((Resource { body: [Junk { content: \"#### Resource Level Comment\\n\\n\" }, GroupComment(Comment { content: [\"This is a message comment\"] }), Message(Message { id: Identifier { name: \"hello-world\" }, value: Some(Pattern { elements: [TextElement { value: \"Hello World!\" }] }), attributes: [], comment: None })] }, [ParserError { pos: 4..5, slice: Some(1..30), kind: ExpectedToken(' ') }]))"],
  ["parser/mod.rs:95", "\nkey1 = Value 1\n\ng@Rb@ge = #2y ds\n\nkey2 = Value 2\n\n", "Err((Resource { body: [Message(Message { id: Identifier { name: \"key1\" }, value: Some(Pattern { elements: [TextElement { value: \"Value 1\" }] }), attributes: [], comment: None }), Junk { content: \"g@Rb@ge = #2y ds\\n\\n\" }, Message(Message { id: Identifier { name: \"key2\" }, value: Some(Pattern { elements: [TextElement { value: \"Value 2\" }] }), attributes: [], comment: None })] }, [ParserError { pos: 18..19, slice: Some(17..35), kind: ExpectedToken('=') }]))"],
  ["parser/mod.rs:180", "\n#### Resource Level Comment\n\n## This is a message comment\nhello-world = Hello World!\n\n", "Err((Resource { body: [Junk { content: \"#### Resource Level Comment\\n\\n\" }, GroupComment(Comment { content: [\"This is a message comment\"] }), Message(Message { id: Identifier { name: \"hello-world\" }, value: Some(Pattern { elements: [TextElement { value: \"Hello World!\" }] }), attributes: [], comment: None })] }, [ParserError { pos: 4..5, slice: Some(1..30), kind: ExpectedToken(' ') }]))"],
  ["parser/mod.rs:243", "\n#### Resource Level Comment\n\n## This is a message comment\nhello-world = Hello World!\n\n", "Err((Resource { body: [Junk { content: \"#### Resource Level Comment\\n\\n\" }, GroupComment(Comment { content: [\"This is a message comment\"] }), Message(Message { id: Identifier { name: \"hello-world\" }, value: Some(Pattern { elements: [TextElement { value: \"Hello World!\" }] }), attributes: [], comment: None })] }, [ParserError { pos: 4..5, slice: Some(1..30), kind: ExpectedToken(' ') }]))"],
  ["parser/errors.rs:21", "\nkey1 = Value 1\n\ng@Rb@ge = #2y ds\n\nkey2 = Value 2\n\n", "Err((Resource { body: [Message(Message { id: Identifier { name: \"key1\" }, value: Some(Pattern { elements: [TextElement { value: \"Value 1\" }] }), attributes: [], comment: None }), Junk { content: \"g@Rb@ge = #2y ds\\n\\n\" }, Message(Message { id: Identifier { name: \"key2\" }, value: Some(Pattern { elements: [TextElement { value: \"Value 2\" }] }), attributes: [], comment: None })] }, [ParserError { pos: 18..19, slice: Some(17..35), kind: ExpectedToken('=') }]))"],
  ["serializer.rs:13", "# This is a message comment\nhello-world = Hello World!\n", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"hello-world\" }, value: Some(Pattern { elements: [TextElement { value: \"Hello World!\" }] }), attributes: [], comment: Some(Comment { content: [\"This is a message comment\"] }) })] })"],
  ["serializer.rs:36", "\nunnormalized-message=This message has\n  abnormal spacing and indentation", "Ok(Resource { body: [Message(Message { id: Identifier { name: \"unnormalized-message\" }, value: Some(Pattern { elements: [TextElement { value: \"This message has\\n\" }, TextElement { value: \"abnormal spacing and indentation\" }] }), attributes: [], comment: None })] })"],
];

for (const [loc, input, expected] of CASES) {
  test(`doc example ${loc}`, () => {
    expect(debug_Result(parse(Str.from(input)), PLAIN)).toBe(expected);
  });
}

// `{:#?}` of `parser::parse("brace = {\"{\"}\n")` printed by the real crate.
const BRACE_PRETTY = "Ok(\n    Resource {\n        body: [\n            Message(\n                Message {\n                    id: Identifier {\n                        name: \"brace\",\n                    },\n                    value: Some(\n                        Pattern {\n                            elements: [\n                                Placeable {\n                                    expression: Inline(\n                                        StringLiteral {\n                                            value: \"{\",\n                                        },\n                                    ),\n                                },\n                            ],\n                        },\n                    ),\n                    attributes: [],\n                    comment: None,\n                },\n            ),\n        ],\n    },\n)";

test("pretty Debug of a string-literal placeable", () => {
  expect(debug_Result(parse(Str.from("brace = {\"{\"}\n")), PRETTY)).toBe(BRACE_PRETTY);
});

// fluent-syntax-0.12.0/src/parser/mod.rs:91 (doc example of `parser::Result`) and errors.rs:17.
test("doc example parse_runtime errors", () => {
  const ftl = "\nkey1 = Value 1\n\ng@Rb@ge = #2y ds\n\nkey2 = Value 2\n\n";
  const r = parse_runtime(Str.from(ftl));
  if (r.$ !== "Err") throw new Error("Resource should contain errors.");
  const [resource, errors] = r._0;
  expect(errors.map((e) => debug_ParserError(e, PLAIN))).toEqual(["ParserError { pos: 18..19, slice: Some(17..35), kind: ExpectedToken('=') }"]);
  expect(errors.map(display_ParserError)).toEqual(['Expected a token starting with "="']);
  expect(resource.body.length).toBe(3);
  const junk = resource.body[1]!;
  expect(junk.$ === "Junk" && junk.content.toString()).toBe("g@Rb@ge = #2y ds\n\n");
});

// fluent-syntax-0.12.0/src/serializer.rs:9 and :32 (doc examples).
test("doc example serialize", () => {
  const ftl = "# This is a message comment\nhello-world = Hello World!\n";
  const resource = parse(Str.from(ftl));
  if (resource.$ !== "Ok") throw new Error("Failed to parse an FTL resource.");
  expect(serialize(resource._0)).toBe(ftl);

  const ftl2 = "\nunnormalized-message=This message has\n  abnormal spacing and indentation";
  const resource2 = parse(Str.from(ftl2));
  if (resource2.$ !== "Ok") throw new Error("Failed to parse an FTL resource.");
  expect(serialize(resource2._0)).toBe("unnormalized-message =\n    This message has\n    abnormal spacing and indentation\n");
});

// fluent-syntax-0.12.0/src/unicode.rs:13, :34, :61, :128 (doc examples).
test("doc example unicode", () => {
  expect(unescape_unicode_to_string(Str.from("Foo \\u5bd2 Bar"))).toBe("Foo 寒 Bar");
  expect(unescape_unicode_to_string(Str.from("Foo \\U01F68A Bar"))).toBe("Foo 🚊 Bar");
  expect(unescape_unicode_to_string(Str.from("Foo \\\" Bar"))).toBe("Foo \" Bar");
  expect(unescape_unicode_to_string(Str.from("Foo \\\\ Bar"))).toBe("Foo \\ Bar");
  const w = new StringWriter();
  unescape_unicode(w, Str.from("Foo \\U01F60A Bar"));
  expect(w.buf).toBe("Foo 😊 Bar");
  expect(unescape_unicode_to_string(Str.from("Foo \\U01F60A Bar"))).toBe("Foo 😊 Bar");
});
