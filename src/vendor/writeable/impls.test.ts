// Port of writeable 0.6.4 `src/impls.rs` `test_string_impls` (the str/String/char parts).
import { expect, test } from "bun:test";
import { cmp_str } from "./cmp.ts";
import { CharWriteable, writeable_str } from "./impls.ts";
import { StringSink, type Writeable } from "./lib.ts";

function to_string(w: Writeable): string {
  const s = new StringSink();
  w.write_to(s);
  return s.s;
}

// crate: writeable-0.6.4/src/impls.rs:183 test_string_impls
test("test_string_impls", () => {
  // crate: writeable-0.6.4/src/impls.rs:184 check_writeable_slice
  function check_writeable_slice(writeables: Writeable[]) {
    expect(to_string(writeables[0]!)).toBe("");
    expect(to_string(writeables[1]!)).toBe("abc");
    // `matches!(.., Cow::Borrowed(_))`: the borrow is the string itself
    expect(writeables[0]!.writeable_borrow()).toBe("");
    expect(writeables[1]!.writeable_borrow()).toBe("abc");
  }

  // test str impl (String, Cow, Box, Rc and Arc erase to the same value in TS)
  check_writeable_slice(["", "abc"].map(writeable_str));

  // test char impl
  const chars = ["a", "β", "你", "😀"].map((c) => c.codePointAt(0)!);
  for (let i = 0; i < chars.length; i++) {
    const s = String.fromCodePoint(chars[i]!);
    expect(to_string(new CharWriteable(chars[i]!))).toBe(s);
    expect(new CharWriteable(chars[i]!).write_to_string()).toBe(s);
    for (let j = 0; j < chars.length; j++) {
      const expected = chars[j]! < chars[i]! ? -1 : chars[j]! > chars[i]! ? 1 : 0;
      expect(cmp_str(new CharWriteable(chars[j]!), s)).toBe(expected);
    }
  }
});
