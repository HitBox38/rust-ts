// Port of compiler/rustc_ast/src/util/comments/tests.rs
import { expect, test } from "bun:test";
import { create_default_session_globals_then } from "../../../rustc_span/lib.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { CommentKind } from "../../token.ts";
import { beautify_doc_string } from "../comments.ts";

// rustc: compiler/rustc_ast/src/util/comments/tests.rs:8 test_block_doc_comment_1
test("test_block_doc_comment_1", () => {
  create_default_session_globals_then(() => {
    const comment = "\n * Test \n **  Test\n *   Test\n";
    const stripped = beautify_doc_string(Symbol.intern(comment), CommentKind.Block);
    expect(Symbol.as_str(stripped)).toBe(" Test \n*  Test\n   Test");
  });
});

// rustc: compiler/rustc_ast/src/util/comments/tests.rs:17 test_block_doc_comment_2
test("test_block_doc_comment_2", () => {
  create_default_session_globals_then(() => {
    const comment = "\n * Test\n *  Test\n";
    const stripped = beautify_doc_string(Symbol.intern(comment), CommentKind.Block);
    expect(Symbol.as_str(stripped)).toBe(" Test\n  Test");
  });
});

// rustc: compiler/rustc_ast/src/util/comments/tests.rs:26 test_block_doc_comment_3
test("test_block_doc_comment_3", () => {
  create_default_session_globals_then(() => {
    const comment = "\n let a: *i32;\n *a = 5;\n";
    const stripped = beautify_doc_string(Symbol.intern(comment), CommentKind.Block);
    expect(Symbol.as_str(stripped)).toBe("let a: *i32;\n*a = 5;");
  });
});

// rustc: compiler/rustc_ast/src/util/comments/tests.rs:35 test_line_doc_comment
test("test_line_doc_comment", () => {
  create_default_session_globals_then(() => {
    let stripped = beautify_doc_string(Symbol.intern(" test"), CommentKind.Line);
    expect(Symbol.as_str(stripped)).toBe(" test");
    stripped = beautify_doc_string(Symbol.intern("! test"), CommentKind.Line);
    expect(Symbol.as_str(stripped)).toBe("! test");
    stripped = beautify_doc_string(Symbol.intern("test"), CommentKind.Line);
    expect(Symbol.as_str(stripped)).toBe("test");
    stripped = beautify_doc_string(Symbol.intern("!test"), CommentKind.Line);
    expect(Symbol.as_str(stripped)).toBe("!test");
  });
});

// rustc: compiler/rustc_ast/src/util/comments/tests.rs:49 test_doc_blocks
test("test_doc_blocks", () => {
  create_default_session_globals_then(() => {
    let stripped = beautify_doc_string(Symbol.intern(" # Returns\n     *\n     "), CommentKind.Block);
    expect(Symbol.as_str(stripped)).toBe(" # Returns\n\n");

    stripped = beautify_doc_string(Symbol.intern("\n     * # Returns\n     *\n     "), CommentKind.Block);
    expect(Symbol.as_str(stripped)).toBe(" # Returns\n\n");

    stripped = beautify_doc_string(Symbol.intern("\n *     a\n "), CommentKind.Block);
    expect(Symbol.as_str(stripped)).toBe("     a\n");
  });
});
