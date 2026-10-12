// The rustdoc examples of fluent-bundle 0.16.0 (lib.rs, args.rs, bundle.rs, concurrent.rs,
// errors.rs, message.rs, resource.rs, types/mod.rs), ported as tests.
import { expect, test } from "bun:test";
import { StringWriter } from "../fluent_syntax/unicode.ts";
import { langid } from "../unic_langid/lib.ts";
import { concurrent, FluentArgs, FluentBundle, type FluentError, FluentResource, FluentValue } from "./lib.ts";
import { Scope } from "./resolver/scope.ts";
import { FluentNumber, FluentNumberOptions, FluentValue_from_num } from "./types/mod.ts";

function try_new_ok(src: string): FluentResource {
  const r = FluentResource.try_new(src);
  if (r.$ === "Err") throw new Error("Failed to parse an FTL string.");
  return r._0;
}

function bundle_with(src: string, b = FluentBundle.new([langid("en-US")])): FluentBundle {
  const r = b.add_resource(try_new_ok(src));
  if (r.$ === "Err") throw new Error("Failed to add FTL resources to the bundle.");
  return b;
}

test("lib.rs crate example", () => {
  const ftl_string = "\n\nhello-world = Hello, world!\nintro = Welcome, { $name }.\n\n";
  const bundle = bundle_with(ftl_string);
  const msg = bundle.get_message("hello-world")!;
  const errors: FluentError[] = [];
  const pattern = msg.value()!;
  expect(bundle.format_pattern(pattern, undefined, errors)).toBe("Hello, world!");

  const args = FluentArgs.new();
  args.set("name", FluentValue.from_str("John"));
  const pattern2 = bundle.get_message("intro")!.value()!;
  // The FSI/PDI isolation marks ensure that the direction of
  // the text from the variable is not affected by the translation.
  expect(bundle.format_pattern(pattern2, args, errors)).toBe("Welcome, ⁨John⁩.");
  expect(errors.length).toBe(0);
});

test("args.rs FluentArgs example", () => {
  const args = FluentArgs.new();
  args.set("user", FluentValue.from_str("John"));
  args.set("emailCount", FluentValue_from_num(5));
  const bundle = FluentBundle.default();
  // For this example, we'll turn on BiDi support.
  // Please, be careful when doing it, it's a risky move.
  bundle.set_use_isolating(false);
  bundle_with("\n\nmsg-key = Hello, { $user }. You have { $emailCount } messages.\n\n", bundle);
  const err: FluentError[] = [];
  const value = bundle.get_message("msg-key")!.value()!;
  expect(bundle.format_pattern(value, args, err)).toBe("Hello, John. You have 5 messages.");
});

test("bundle.rs FluentBundle example", () => {
  const bundle = bundle_with("intro = Welcome, { $name }.");
  const args = FluentArgs.new();
  args.set("name", FluentValue.from_str("Rustacean"));
  const errors: FluentError[] = [];
  const pattern = bundle.get_message("intro")!.value()!;
  expect(bundle.format_pattern(pattern, args, errors)).toBe("Welcome, ⁨Rustacean⁩.");
});

test("bundle.rs add_resource / has_message", () => {
  const bundle = bundle_with("\nhello = Hi!\ngoodbye = Bye!\n");
  expect(bundle.has_message("hello")).toBe(true);
});

test("bundle.rs add_resource_overriding", () => {
  const bundle = bundle_with("\nhello = Hi!\ngoodbye = Bye!\n");
  bundle.add_resource_overriding(try_new_ok("\nhello = Another Hi!\n"));
  const errors: FluentError[] = [];
  const value = bundle.get_message("hello")!.value()!;
  expect(bundle.format_pattern(value, undefined, errors)).toBe("Another Hi!");
});

test("bundle.rs get_message / write_pattern / format_pattern", () => {
  const bundle = bundle_with("hello-world = Hello World!");
  expect(bundle.get_message("hello-world") !== undefined).toBe(true);
  const pattern = bundle.get_message("hello-world")!.value()!;
  const errors: FluentError[] = [];
  const s = new StringWriter();
  expect(bundle.write_pattern(s, pattern, undefined, errors).$).toBe("Ok");
  expect(s.buf).toBe("Hello World!");
  expect(bundle.format_pattern(pattern, undefined, errors)).toBe("Hello World!");
});

test("bundle.rs add_function", () => {
  const bundle = bundle_with('length = { STRLEN("12345") }');
  // Register a fn that maps from string to string length
  const r = bundle.add_function("STRLEN", (positional, _named) =>
    positional.length === 1 && positional[0]!.$ === "String"
      ? FluentValue_from_num(new TextEncoder().encode(positional[0]!._0).length)
      : FluentValue.Error,
  );
  expect(r.$).toBe("Ok");
  const errors: FluentError[] = [];
  const pattern = bundle.get_message("length")!.value()!;
  expect(bundle.format_pattern(pattern, undefined, errors)).toBe("5");
});

test("bundle.rs add_builtins", () => {
  const ftl_string = `rank = { NUMBER($n, type: "ordinal") ->
    [1] first
    [2] second
    [3] third
    [one] {$n}st
    [two] {$n}nd
    [few] {$n}rd
    *[other] {$n}th
}`;
  const bundle = bundle_with(ftl_string);
  // Register the builtin functions (including NUMBER())
  expect(bundle.add_builtins().$).toBe("Ok");
  const errors: FluentError[] = [];
  const pattern = bundle.get_message("rank")!.value()!;
  const args = FluentArgs.new();

  args.set("n", FluentValue_from_num(5));
  expect(bundle.format_pattern(pattern, args, errors)).toBe("⁨5⁩th");

  args.set("n", FluentValue_from_num(12));
  expect(bundle.format_pattern(pattern, args, errors)).toBe("⁨12⁩th");

  args.set("n", FluentValue_from_num(22));
  expect(bundle.format_pattern(pattern, args, errors)).toBe("⁨22⁩nd");
});

test("concurrent.rs new_concurrent", () => {
  const bundle: concurrent.FluentBundle = FluentBundle.new_concurrent([langid("en-US")]);
  bundle_with('x = { $n ->\n [one] one\n*[other] other\n}', bundle as unknown as FluentBundle);
  const args = FluentArgs.new();
  args.set("n", FluentValue_from_num(1));
  const errors: FluentError[] = [];
  expect(bundle.format_pattern(bundle.get_message("x")!.value()!, args, errors)).toBe("one");
});

test("errors.rs FluentError::Overriding", () => {
  const res1 = try_new_ok("intro = Welcome, { $name }.");
  const res2 = try_new_ok("intro = Hi, { $name }.");
  const bundle = FluentBundle.new([langid("en-US")]);
  expect(bundle.add_resource(res1).$).toBe("Ok");
  expect(bundle.add_resource(res2).$).toBe("Err");
});

test("message.rs examples", () => {
  const source = "\n\nconfirm-modal = Are you sure?\n    .confirm = Yes\n    .cancel = No\n    .tooltip = Closing the window will lose all unsaved data.\n\n";
  const bundle = bundle_with(source, FluentBundle.default());
  const msg = bundle.get_message("confirm-modal")!;
  const err: FluentError[] = [];
  const attributes = msg.attributes().map((attr) => bundle.format_pattern(attr.value(), undefined, err));
  expect(attributes).toEqual(["Yes", "No", "Closing the window will lose all unsaved data."]);
  const attr1 = msg.attributes()[0]!;
  expect(attr1.id()).toBe("confirm");
  expect(bundle.format_pattern(attr1.value(), undefined, err)).toBe("Yes");

  const b2 = bundle_with("\nhello-world = Hello World!\n", FluentBundle.default());
  const m2 = b2.get_message("hello-world")!;
  expect(m2.value() !== undefined).toBe(true);
  expect(b2.format_pattern(m2.value()!, undefined, err)).toBe("Hello World!");

  const b3 = bundle_with("\nhello-world =\n    .label = This is a label\n    .accesskey = C\n", FluentBundle.default());
  const m3 = b3.get_message("hello-world")!;
  for (const attr of m3.attributes()) b3.format_pattern(attr.value(), undefined, err);
  expect(b3.format_pattern(m3.get_attribute("label")!.value(), undefined, err)).toBe("This is a label");
  expect(err.length).toBe(0);
});

test("resource.rs examples", () => {
  expect(try_new_ok("\n\nhello-world = Hello World!\n\n").entries().length).toBe(1);
  expect(FluentResource.try_new("\n\nhello-world = Hello, { $user }!\n\n").$).toBe("Ok");
  const resource = try_new_ok("hello-world = Hello, { $user }!");
  expect(resource.source()).toBe("hello-world = Hello, { $user }!");
  const r2 = try_new_ok("\n\nhello-world = Hello, { $user }!\n\n");
  expect(r2.entries().length).toBe(1);
  expect(r2.entries()[0]!.$).toBe("Message");
  expect(r2.get_entry(0)!.$).toBe("Message");
});

test("types/mod.rs try_number", () => {
  // "2" parses into a `FluentNumber`
  expect(FluentValue.eq(FluentValue.try_number("2"), { $: "Number", _0: FluentNumber.new(2.0, FluentNumberOptions.default()) })).toBe(true);
  // Floats can be parsed as well.
  const opts = FluentNumberOptions.default();
  opts.minimum_fraction_digits = 6;
  expect(FluentValue.eq(FluentValue.try_number("3.141569"), { $: "Number", _0: FluentNumber.new(3.141569, opts) })).toBe(true);
  // When a value is not a valid number, it falls back to a `FluentValue::String`
  expect(FluentValue.eq(FluentValue.try_number("A string"), { $: "String", _0: "A string" })).toBe(true);
});

test("types/mod.rs matches", () => {
  const bundle = FluentBundle.new([langid("en")]);
  const scope = Scope.new(bundle, undefined, undefined);
  // Matching examples:
  expect(FluentValue.matches(FluentValue.try_number("2"), FluentValue.try_number("2"), scope)).toBe(true);
  expect(FluentValue.matches(FluentValue.from_str("fluent"), FluentValue.from_str("fluent"), scope)).toBe(true);
  expect(FluentValue.matches(FluentValue.from_str("one"), FluentValue.try_number("1"), scope)).toBe(true);
  // Non-matching examples:
  expect(FluentValue.matches(FluentValue.try_number("2"), FluentValue.try_number("3"), scope)).toBe(false);
  expect(FluentValue.matches(FluentValue.from_str("fluent"), FluentValue.from_str("not fluent"), scope)).toBe(false);
  expect(FluentValue.matches(FluentValue.from_str("two"), FluentValue.try_number("100"), scope)).toBe(false);
});
