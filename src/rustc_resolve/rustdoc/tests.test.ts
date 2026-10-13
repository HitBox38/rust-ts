// Port of compiler/rustc_resolve/src/rustdoc/tests.rs.
import { expect, test } from "bun:test";
import { BytePos, DUMMY_SP, type FileName, Span, create_default_session_globals_then } from "../../rustc_span/lib.ts";
import { FilePathMapping, SourceMap } from "../../rustc_span/source_map.ts";
import { sym } from "../../rustc_span/symbol.ts";
import { Str } from "../../std/str.ts";
import { source_span_for_markdown_range_inner } from "../rustdoc.ts";

// rustc: compiler/rustc_resolve/src/rustdoc/tests.rs:10 filename
function filename(sm: SourceMap, path: string): FileName {
  return { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), path) };
}

// rustc: compiler/rustc_resolve/src/rustdoc/tests.rs:15 single_backtick
test("single_backtick", () => {
  create_default_session_globals_then(() => {
    const sm = SourceMap.new(FilePathMapping.empty());
    sm.new_source_file(filename(sm, "foo.rs"), Str.from('#[doc = "`"] fn foo() {}'));
    const r = source_span_for_markdown_range_inner(sm, "`", { start: 0, end: 1 }, [
      {
        span: Span.with_root_ctxt(BytePos(8), BytePos(11)),
        item_id: undefined,
        kind: { $: "Raw", _0: DUMMY_SP },
        doc: sym.empty, // unused placeholder
        indent: 0,
        from_expansion: false,
        style: "Outer",
      },
    ]);
    expect(r).toBeDefined();
    const [span] = r!;
    expect(Span.lo(span)).toBe(BytePos(9));
    expect(Span.hi(span)).toBe(BytePos(10));
  });
});

// rustc: compiler/rustc_resolve/src/rustdoc/tests.rs:38 utf8
test("utf8", () => {
  // regression test for https://github.com/rust-lang/rust/issues/141665
  create_default_session_globals_then(() => {
    const sm = SourceMap.new(FilePathMapping.empty());
    sm.new_source_file(filename(sm, "foo.rs"), Str.from('#[doc = "⚠"] fn foo() {}'));
    const r = source_span_for_markdown_range_inner(sm, "⚠", { start: 0, end: 3 }, [
      {
        span: Span.with_root_ctxt(BytePos(8), BytePos(14)),
        item_id: undefined,
        kind: { $: "Raw", _0: DUMMY_SP },
        doc: sym.empty, // unused placeholder
        indent: 0,
        from_expansion: false,
        style: "Outer",
      },
    ]);
    expect(r).toBeDefined();
    const [span] = r!;
    expect(Span.lo(span)).toBe(BytePos(9));
    expect(Span.hi(span)).toBe(BytePos(12));
  });
});
