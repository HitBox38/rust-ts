// Port of compiler/rustc_session/src/config/native_libs/tests.rs.
import { expect, test } from "bun:test";
import { type NativeLibParts, split_native_lib_value } from "../native_libs.ts";

const P = (kind: string | undefined, modifiers: string | undefined, name: string, new_name: string | undefined): NativeLibParts => ({ kind, modifiers, name, new_name });

// rustc: compiler/rustc_session/src/config/native_libs/tests.rs:4 split
test("split", () => {
  // This is a unit test for some implementation details, so consider deleting
  // it if it gets in the way.
  const examples: [string, NativeLibParts][] = [
    ["", P(undefined, undefined, "", undefined)],
    ["foo", P(undefined, undefined, "foo", undefined)],
    ["foo:", P(undefined, undefined, "foo", "")],
    ["foo:bar", P(undefined, undefined, "foo", "bar")],
    [":bar", P(undefined, undefined, "", "bar")],
    ["kind=foo", P("kind", undefined, "foo", undefined)],
    [":mods=foo", P("", "mods", "foo", undefined)],
    [":mods=:bar", P("", "mods", "", "bar")],
    ["kind=foo:bar", P("kind", undefined, "foo", "bar")],
    ["kind:mods=foo", P("kind", "mods", "foo", undefined)],
    ["kind:mods=foo:bar", P("kind", "mods", "foo", "bar")],
    ["::==::", P("", ":", "=", ":")],
    ["==::==", P("", undefined, "=", ":==")],
  ];

  for (const [value, expected] of examples) {
    expect(split_native_lib_value(value)).toEqual(expected);
  }
});
