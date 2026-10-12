// Port of compiler/rustc_ast/src/tokenstream/tests.rs
import { expect, test } from "bun:test";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { TokenKind } from "../token.ts";
import { TokenStream } from "../tokenstream.ts";

// rustc: compiler/rustc_ast/src/tokenstream/tests.rs:7 test_token_stream_iter
test("test_token_stream_iter", () => {
  const ts = TokenStream.token_alone(TokenKind.Eq, DUMMY_SP);
  expect(ts.len()).toBe(1);

  const iter = ts.iter();
  expect(iter.size_hint()).toEqual([1, 1]);
});
