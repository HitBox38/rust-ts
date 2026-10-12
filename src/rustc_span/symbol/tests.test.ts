// Port of compiler/rustc_span/src/symbol/tests.rs
import { expect, test } from "bun:test";
import { create_default_session_globals_then } from "../lib.ts";
import { ByteSymbol, Ident, Interner, kw, Symbol } from "../symbol.ts";

const b = (s: string) => new TextEncoder().encode(s);

// rustc: compiler/rustc_span/src/symbol/tests.rs:5 interner_tests
test("interner_tests", () => {
  const i = Interner.prefill([], []);
  // first one is zero:
  expect(i.intern_str("dog")).toBe(Symbol.new(0));
  // re-use gets the same entry, even with a `ByteSymbol`
  expect(i.intern_byte_str(b("dog"))).toBe(ByteSymbol.new(0));
  // different string gets a different #:
  expect(i.intern_byte_str(b("cat"))).toBe(ByteSymbol.new(1));
  expect(i.intern_str("cat")).toBe(Symbol.new(1));
  // dog is still at zero
  expect(i.intern_str("dog")).toBe(Symbol.new(0));
});

// rustc: compiler/rustc_span/src/symbol/tests.rs:19 interner_get
test("interner_get", () => {
  const i = Interner.prefill(["chicken"], ["cow"]);
  const dog_idx = i.intern_str("dog"); // 2
  const cat_idx = i.intern_str("cat"); // 3
  expect(i.get_str(Symbol.new(0))).toBe("chicken");
  expect(i.get_str(Symbol.new(1))).toBe("cow");
  expect(i.get_str(cat_idx)).toBe("cat");
  expect(i.get_str(dog_idx)).toBe("dog");
});

// rustc: compiler/rustc_span/src/symbol/tests.rs:30 without_first_quote_test
test("without_first_quote_test", () => {
  create_default_session_globals_then(() => {
    const i = Ident.from_str("'break");
    expect(i.without_first_quote().name).toBe(kw.Break);
  });
});
