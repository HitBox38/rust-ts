// Port of compiler/rustc_span/src/source_map/tests.rs.
import { expect, test } from "bun:test";
import { CrateNum } from "../def_id.ts";
import {
  BytePos,
  CharPos,
  type FileName,
  type LineInfo,
  type PathBuf,
  RealFileName,
  create_default_session_globals_then,
  RemapPathScopeComponents,
  Span,
  DUMMY_SP,
  ExternalSource,
} from "../lib.ts";
import { readFileSync, statSync } from "node:fs";
import { FilePathMapping, FileName_eq, RealFileLoader, RealFileName_eq, SourceMap } from "../source_map.ts";
import { path_eq } from "../../std/path.ts";
import { FreezeLock } from "../../rustc_data_structures/sync/freeze.ts";
import { Str } from "../../std/str.ts";
import { unwrap_result } from "../../std/result.ts";

const S = (s: string): Str => Str.from(s);

// PORT: rust-ts interns every non-dummy span (no inline span format), so span-creating tests run
// inside session globals; upstream tests rely on the inline encoding instead.
const test_ = (name: string, f: () => void): void => {
  test(name, () => create_default_session_globals_then(f));
};

// rustc: compiler/rustc_span/src/source_map/tests.rs:3 filename
function filename(sm: SourceMap, path: string): FileName {
  return { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), path) };
}

// rustc: compiler/rustc_span/src/source_map/tests.rs:7 init_source_map
function init_source_map(): SourceMap {
  const sm = SourceMap.new(FilePathMapping.empty());
  sm.new_source_file(filename(sm, "blork.rs"), S("first line.\nsecond line"));
  sm.new_source_file(filename(sm, "empty.rs"), S(""));
  sm.new_source_file(filename(sm, "blork2.rs"), S("first line.\nsecond line"));
  return sm;
}

// impl SourceMap (test-only helpers)

/// Returns `Some(span)`, a union of the LHS and RHS span. The LHS must precede the RHS. If
/// there are gaps between LHS and RHS, the resulting union will cross these gaps.
/// For this to work,
///
///    * the syntax contexts of both spans much match,
///    * the LHS span needs to end on the same line the RHS span begins,
///    * the LHS span must start at or before the RHS span.
// rustc: compiler/rustc_span/src/source_map/tests.rs:23 merge_spans
function merge_spans(self: SourceMap, sp_lhs: Span, sp_rhs: Span): Span | undefined {
  // Ensure we're at the same expansion ID.
  if (!Span.eq_ctxt(sp_lhs, sp_rhs)) {
    return undefined;
  }

  const lhs_end_r = self.lookup_line(Span.hi(sp_lhs));
  if (lhs_end_r.$ === "Err") return undefined;
  const lhs_end = lhs_end_r._0;
  const rhs_begin_r = self.lookup_line(Span.lo(sp_rhs));
  if (rhs_begin_r.$ === "Err") return undefined;
  const rhs_begin = rhs_begin_r._0;

  // If we must cross lines to merge, don't merge.
  if (lhs_end.line !== rhs_begin.line) {
    return undefined;
  }

  // Ensure these follow the expected order and that we don't overlap.
  if (Span.lo(sp_lhs) <= Span.lo(sp_rhs) && Span.hi(sp_lhs) <= Span.lo(sp_rhs)) {
    return Span.to(sp_lhs, sp_rhs);
  } else {
    return undefined;
  }
}

/// Converts an absolute `BytePos` to a `CharPos` relative to the `SourceFile`.
// rustc: compiler/rustc_span/src/source_map/tests.rs:52 bytepos_to_file_charpos
function bytepos_to_file_charpos(self: SourceMap, bpos_: BytePos): CharPos {
  const idx = self.lookup_source_file_idx(bpos_);
  const sf = self.files_.source_files.deref()[idx]!;
  const bpos = sf.relative_position(bpos_);
  return sf.bytepos_to_file_charpos(bpos);
}

/// Tests `lookup_byte_offset`.
// rustc: compiler/rustc_span/src/source_map/tests.rs:62 t3
test_("t3", () => {
  const sm = init_source_map();

  const srcfbp1 = sm.lookup_byte_offset(BytePos(23));
  expect(FileName_eq(srcfbp1.sf.name, filename(sm, "blork.rs"))).toBe(true);
  expect(srcfbp1.pos).toBe(BytePos(23));

  const srcfbp1b = sm.lookup_byte_offset(BytePos(24));
  expect(FileName_eq(srcfbp1b.sf.name, filename(sm, "empty.rs"))).toBe(true);
  expect(srcfbp1b.pos).toBe(BytePos(0));

  const srcfbp2 = sm.lookup_byte_offset(BytePos(25));
  expect(FileName_eq(srcfbp2.sf.name, filename(sm, "blork2.rs"))).toBe(true);
  expect(srcfbp2.pos).toBe(BytePos(0));
});

/// Tests `bytepos_to_file_charpos`.
// rustc: compiler/rustc_span/src/source_map/tests.rs:80 t4
test_("t4", () => {
  const sm = init_source_map();

  const cp1 = bytepos_to_file_charpos(sm, BytePos(22));
  expect(cp1).toBe(CharPos(22));

  const cp2 = bytepos_to_file_charpos(sm, BytePos(25));
  expect(cp2).toBe(CharPos(0));
});

/// Tests zero-length `SourceFile`s.
// rustc: compiler/rustc_span/src/source_map/tests.rs:92 t5
test_("t5", () => {
  const sm = init_source_map();

  const loc1 = sm.lookup_char_pos(BytePos(22));
  expect(FileName_eq(loc1.file.name, filename(sm, "blork.rs"))).toBe(true);
  expect(loc1.line).toBe(2);
  expect(loc1.col).toBe(CharPos(10));

  const loc2 = sm.lookup_char_pos(BytePos(25));
  expect(FileName_eq(loc2.file.name, filename(sm, "blork2.rs"))).toBe(true);
  expect(loc2.line).toBe(1);
  expect(loc2.col).toBe(CharPos(0));
});

// rustc: compiler/rustc_span/src/source_map/tests.rs:106 init_source_map_mbc
function init_source_map_mbc(): SourceMap {
  const sm = SourceMap.new(FilePathMapping.empty());
  // "€" is a three-byte UTF8 char.
  sm.new_source_file(filename(sm, "blork.rs"), S("fir€st €€€€ line.\nsecond line"));
  sm.new_source_file(filename(sm, "blork2.rs"), S("first line€€.\n€ second line"));
  return sm;
}

/// Tests `bytepos_to_file_charpos` in the presence of multi-byte chars.
// rustc: compiler/rustc_span/src/source_map/tests.rs:116 t6
test_("t6", () => {
  const sm = init_source_map_mbc();

  const cp1 = bytepos_to_file_charpos(sm, BytePos(3));
  expect(cp1).toBe(CharPos(3));

  const cp2 = bytepos_to_file_charpos(sm, BytePos(6));
  expect(cp2).toBe(CharPos(4));

  const cp3 = bytepos_to_file_charpos(sm, BytePos(56));
  expect(cp3).toBe(CharPos(12));

  const cp4 = bytepos_to_file_charpos(sm, BytePos(61));
  expect(cp4).toBe(CharPos(15));
});

/// Test `span_to_lines` for a span ending at the end of a `SourceFile`.
// rustc: compiler/rustc_span/src/source_map/tests.rs:134 t7
test_("t7", () => {
  const sm = init_source_map();
  const span = Span.with_root_ctxt(BytePos(12), BytePos(23));
  const file_lines = unwrap_result(sm.span_to_lines(span));

  expect(FileName_eq(file_lines.file.name, filename(sm, "blork.rs"))).toBe(true);
  expect(file_lines.lines.length).toBe(1);
  expect(file_lines.lines[0]!.line_index).toBe(1);
});

/// Given a string like " ~~~~~~~~~~~~ ", produces a span
/// converting that range. The idea is that the string has the same
/// length as the input, and we uncover the byte positions. Note
/// that this can span lines and so on.
// rustc: compiler/rustc_span/src/source_map/tests.rs:148 span_from_selection
function span_from_selection(input: string, selection: string): Span {
  expect(S(input).len()).toBe(S(selection).len());
  const left_index = S(selection).find("~")!;
  const right_index = S(selection).rfind("~") ?? left_index;
  return Span.with_root_ctxt(BytePos(left_index), BytePos(right_index + 1));
}

/// Tests `span_to_snippet` and `span_to_lines` for a span converting 3
/// lines in the middle of a file.
// rustc: compiler/rustc_span/src/source_map/tests.rs:158 span_to_snippet_and_lines_spanning_multiple_lines
test_("span_to_snippet_and_lines_spanning_multiple_lines", () => {
  const sm = SourceMap.new(FilePathMapping.empty());
  const inputtext = "aaaaa\nbbbbBB\nCCC\nDDDDDddddd\neee\n";
  const selection = "     \n    ~~\n~~~\n~~~~~     \n   \n";
  sm.new_source_file(filename(sm, "blork.rs"), S(inputtext));
  const span = span_from_selection(inputtext, selection);

  // Check that we are extracting the text we thought we were extracting.
  expect(unwrap_result(sm.span_to_snippet(span)).toString()).toBe("BB\nCCC\nDDDDD");

  // Check that span_to_lines gives us the complete result with the lines/cols we expected.
  const lines = unwrap_result(sm.span_to_lines(span));
  const expected: LineInfo[] = [
    { line_index: 1, start_col: CharPos(4), end_col: CharPos(6) },
    { line_index: 2, start_col: CharPos(0), end_col: CharPos(3) },
    { line_index: 3, start_col: CharPos(0), end_col: CharPos(5) },
  ];
  expect(lines.lines).toEqual(expected);
});

/// Test span_to_snippet for a span ending at the end of a `SourceFile`.
// rustc: compiler/rustc_span/src/source_map/tests.rs:180 t8
test_("t8", () => {
  const sm = init_source_map();
  const span = Span.with_root_ctxt(BytePos(12), BytePos(23));
  const snippet = sm.span_to_snippet(span);

  expect(snippet.$).toBe("Ok");
  expect(unwrap_result(snippet).toString()).toBe("second line");
});

/// Test `span_to_str` for a span ending at the end of a `SourceFile`.
// rustc: compiler/rustc_span/src/source_map/tests.rs:190 t9
test_("t9", () => {
  const sm = init_source_map();
  const span = Span.with_root_ctxt(BytePos(12), BytePos(23));
  const sstr = sm.span_to_diagnostic_string(span);

  expect(sstr).toBe("blork.rs:2:1: 2:12");
});

/// Tests failing to merge two spans on different lines.
// rustc: compiler/rustc_span/src/source_map/tests.rs:200 span_merging_fail
test_("span_merging_fail", () => {
  const sm = SourceMap.new(FilePathMapping.empty());
  const inputtext = "bbbb BB\ncc CCC\n";
  const selection1 = "     ~~\n      \n";
  const selection2 = "       \n   ~~~\n";
  sm.new_source_file(filename(sm, "blork.rs"), S(inputtext));
  const span1 = span_from_selection(inputtext, selection1);
  const span2 = span_from_selection(inputtext, selection2);

  expect(merge_spans(sm, span1, span2)).toBeUndefined();
});

/// Tests loading an external source file that requires normalization.
// rustc: compiler/rustc_span/src/source_map/tests.rs:214 t10
test_("t10", () => {
  const sm = SourceMap.new(FilePathMapping.empty());
  const unnormalized = "first line.\r\nsecond line";
  const normalized = "first line.\nsecond line";

  const src_file = sm.new_source_file(filename(sm, "blork.rs"), S(unnormalized));

  expect(src_file.src!.toString()).toBe(normalized);
  expect(src_file.src_hash.matches(S(unnormalized)), "src_hash should use the source before normalization").toBe(true);

  const {
    name,
    src_hash,
    checksum_hash,
    normalized_source_len,
    unnormalized_source_len,
    lines_: lines,
    multibyte_chars,
    normalized_pos,
    stable_id,
  } = src_file.clone();

  const imported_src_file = sm.new_imported_source_file(
    name,
    src_hash,
    checksum_hash,
    stable_id,
    RelativeBytePos_to_u32(normalized_source_len),
    unnormalized_source_len,
    CrateNum.ZERO,
    FreezeLock.new(lines.read()),
    multibyte_chars,
    normalized_pos,
    0,
  );

  expect(
    ExternalSource.get_source(imported_src_file.external_src.borrow()),
    "imported source file should not have source yet",
  ).toBeUndefined();
  imported_src_file.add_external_src(() => S(unnormalized));
  expect(ExternalSource.get_source(imported_src_file.external_src.borrow())!.toString(), "imported source file should be normalized").toBe(normalized);
});

function RelativeBytePos_to_u32(p: number): number {
  return p;
}

// Takes a unix-style path and returns a platform specific path.
// rustc: compiler/rustc_span/src/source_map/tests.rs:267 path
function path(p: string): PathBuf {
  return path_str(p);
}

// Takes a unix-style path and returns a platform specific path.
// rustc: compiler/rustc_span/src/source_map/tests.rs:272 path_str
function path_str(p: string): string {
  if (process.platform !== "win32") {
    return p;
  }

  let path = p.replaceAll("/", "\\");
  if (path.startsWith("\\")) {
    path = "X:\\" + path.slice(1);
  }

  return path;
}

// rustc: compiler/rustc_span/src/source_map/tests.rs:289 map_path_prefix
function map_path_prefix(mapping: FilePathMapping, p: string): string {
  // It's important that we convert to a string here because that's what
  // later stages do too (e.g. in the backend), and comparing `Path` values
  // won't catch some differences at the string level, e.g. "abc" and "abc/"
  // compare as equal.
  return mapping.map_prefix(path(p))[0];
}

// rustc: compiler/rustc_span/src/source_map/tests.rs:297 reverse_map_prefix
function reverse_map_prefix(mapping: FilePathMapping, p: string): string | undefined {
  return mapping.reverse_map_prefix_heuristically(path(p));
}

// rustc: compiler/rustc_span/src/source_map/tests.rs:302 path_prefix_remapping
test_("path_prefix_remapping", () => {
  // Relative to relative
  {
    const mapping = FilePathMapping.new([[path("abc/def"), path("foo")]], RemapPathScopeComponents.all());

    expect(map_path_prefix(mapping, "abc/def/src/main.rs")).toBe(path_str("foo/src/main.rs"));
    expect(map_path_prefix(mapping, "abc/def")).toBe(path_str("foo"));
  }

  // Relative to absolute
  {
    const mapping = FilePathMapping.new([[path("abc/def"), path("/foo")]], RemapPathScopeComponents.all());

    expect(map_path_prefix(mapping, "abc/def/src/main.rs")).toBe(path_str("/foo/src/main.rs"));
    expect(map_path_prefix(mapping, "abc/def")).toBe(path_str("/foo"));
  }

  // Absolute to relative
  {
    const mapping = FilePathMapping.new([[path("/abc/def"), path("foo")]], RemapPathScopeComponents.all());

    expect(map_path_prefix(mapping, "/abc/def/src/main.rs")).toBe(path_str("foo/src/main.rs"));
    expect(map_path_prefix(mapping, "/abc/def")).toBe(path_str("foo"));
  }

  // Absolute to absolute
  {
    const mapping = FilePathMapping.new([[path("/abc/def"), path("/foo")]], RemapPathScopeComponents.all());

    expect(map_path_prefix(mapping, "/abc/def/src/main.rs")).toBe(path_str("/foo/src/main.rs"));
    expect(map_path_prefix(mapping, "/abc/def")).toBe(path_str("/foo"));
  }
});

/** `RealFileName { local: Some(InnerRealFileName { .. }), maybe_remapped: InnerRealFileName { .. }, scopes }` */
function rfn(local: [string, string, string], maybe_remapped: [string, string, string], scopes: RemapPathScopeComponents): RealFileName {
  const inner = ([name, working_directory, embeddable_name]: [string, string, string]) => ({
    name: path(name),
    working_directory: path(working_directory),
    embeddable_name: path(embeddable_name),
  });
  return new RealFileName(inner(local), inner(maybe_remapped), scopes);
}

function assert_rfn(actual: RealFileName, expected: RealFileName): void {
  if (!RealFileName_eq(actual, expected)) {
    expect(actual).toEqual(expected); // shows the difference
  }
  expect(RealFileName_eq(actual, expected)).toBe(true);
}

function assert_path(actual: PathBuf, expected: PathBuf): void {
  if (!path_eq(actual, expected)) expect(actual).toBe(expected);
}

// rustc: compiler/rustc_span/src/source_map/tests.rs:349 to_real_filename_with_full_scopes
test_("to_real_filename_with_full_scopes", () => {
  // "virtual" working directory is relative path
  const mapping = FilePathMapping.new(
    [
      [path("/foo"), path("FOO")],
      [path("/bar"), path("BAR")],
    ],
    RemapPathScopeComponents.all(),
  );
  const working_directory = mapping.to_real_filename(RealFileName.empty(), path("/foo"));

  assert_path(working_directory.path(RemapPathScopeComponents.DIAGNOSTICS), path("FOO"));
  assert_path(working_directory.path(RemapPathScopeComponents.MACRO), path("FOO"));
  assert_path(working_directory.path(RemapPathScopeComponents.DEBUGINFO), path("FOO"));

  const all = RemapPathScopeComponents.all();
  // Absolute path
  assert_rfn(
    mapping.to_real_filename(working_directory, path("/foo/src/main.rs")),
    rfn(["/foo/src/main.rs", "/foo", "/foo/src/main.rs"], ["FOO/src/main.rs", "FOO", "FOO/src/main.rs"], all),
  );

  // Absolute path with unrelated working directory
  assert_rfn(
    mapping.to_real_filename(working_directory, path("/bar/src/main.rs")),
    rfn(["/bar/src/main.rs", "/foo", "/bar/src/main.rs"], ["BAR/src/main.rs", "FOO", "BAR/src/main.rs"], all),
  );

  // Absolute path that does not match any prefix
  assert_rfn(
    mapping.to_real_filename(working_directory, path("/quux/src/main.rs")),
    rfn(["/quux/src/main.rs", "/foo", "/quux/src/main.rs"], ["/quux/src/main.rs", "FOO", "/quux/src/main.rs"], all),
  );

  // Relative path
  assert_rfn(
    mapping.to_real_filename(working_directory, path("src/main.rs")),
    rfn(["src/main.rs", "/foo", "/foo/src/main.rs"], ["src/main.rs", "FOO", "FOO/src/main.rs"], all),
  );

  // Relative path with `./`
  assert_rfn(
    mapping.to_real_filename(working_directory, path("./src/main.rs")),
    rfn(["./src/main.rs", "/foo", "/foo/src/main.rs"], ["./src/main.rs", "FOO", "FOO/src/main.rs"], all),
  );

  // Relative path that does not match any prefix
  assert_rfn(
    mapping.to_real_filename(mapping.to_real_filename(RealFileName.empty(), path("/abc")), path("quux/src/main.rs")),
    rfn(
      ["quux/src/main.rs", "/abc", "/abc/quux/src/main.rs"],
      ["quux/src/main.rs", "/abc", "/abc/quux/src/main.rs"],
      RemapPathScopeComponents.empty(),
    ),
  );
});

// rustc: compiler/rustc_span/src/source_map/tests.rs:475 to_real_filename_with_mixed_scopes
test_("to_real_filename_with_mixed_scopes", () => {
  // "virtual" working directory is relative path
  const mapping = FilePathMapping.new(
    [
      [path("/foo"), path("FOO")],
      [path("/bar"), path("BAR")],
    ],
    RemapPathScopeComponents.OBJECT,
  );
  const working_directory = mapping.to_real_filename(RealFileName.empty(), path("/foo"));

  assert_path(working_directory.path(RemapPathScopeComponents.DIAGNOSTICS), path("/foo"));
  assert_path(working_directory.path(RemapPathScopeComponents.MACRO), path("FOO"));
  assert_path(working_directory.path(RemapPathScopeComponents.DEBUGINFO), path("FOO"));

  const object = RemapPathScopeComponents.OBJECT;
  // Absolute path
  assert_rfn(
    mapping.to_real_filename(working_directory, path("/foo/src/main.rs")),
    rfn(["/foo/src/main.rs", "/foo", "/foo/src/main.rs"], ["FOO/src/main.rs", "FOO", "FOO/src/main.rs"], object),
  );

  // Absolute path with unrelated working directory
  assert_rfn(
    mapping.to_real_filename(working_directory, path("/bar/src/main.rs")),
    rfn(["/bar/src/main.rs", "/foo", "/bar/src/main.rs"], ["BAR/src/main.rs", "FOO", "BAR/src/main.rs"], object),
  );

  // Absolute path without remapping
  assert_rfn(
    mapping.to_real_filename(working_directory, path("/quux/src/main.rs")),
    rfn(["/quux/src/main.rs", "/foo", "/quux/src/main.rs"], ["/quux/src/main.rs", "FOO", "/quux/src/main.rs"], object),
  );

  // Relative path
  assert_rfn(
    mapping.to_real_filename(working_directory, path("src/main.rs")),
    rfn(["src/main.rs", "/foo", "/foo/src/main.rs"], ["src/main.rs", "FOO", "FOO/src/main.rs"], object),
  );

  // Relative path that does not match any prefix
  assert_rfn(
    mapping.to_real_filename(mapping.to_real_filename(RealFileName.empty(), path("/abc")), path("quux/src/main.rs")),
    rfn(
      ["quux/src/main.rs", "/abc", "/abc/quux/src/main.rs"],
      ["quux/src/main.rs", "/abc", "/abc/quux/src/main.rs"],
      RemapPathScopeComponents.empty(),
    ),
  );
});

// rustc: compiler/rustc_span/src/source_map/tests.rs:582 to_real_filename_without_remapped_cwd
test_("to_real_filename_without_remapped_cwd", () => {
  // "virtual" working directory is relative path
  const mapping = FilePathMapping.new(
    [
      [path("/foo"), path("FOO")],
      [path("/cwd/bar"), path("CWDBAR")],
    ],
    RemapPathScopeComponents.OBJECT,
  );
  const working_directory = mapping.to_real_filename(RealFileName.empty(), path("/cwd"));

  assert_path(working_directory.path(RemapPathScopeComponents.DIAGNOSTICS), path("/cwd"));
  assert_path(working_directory.path(RemapPathScopeComponents.MACRO), path("/cwd"));
  assert_path(working_directory.path(RemapPathScopeComponents.DEBUGINFO), path("/cwd"));

  const object = RemapPathScopeComponents.OBJECT;
  const empty = RemapPathScopeComponents.empty();
  // Absolute path
  assert_rfn(
    mapping.to_real_filename(working_directory, path("/foo/src/main.rs")),
    rfn(["/foo/src/main.rs", "/cwd", "/foo/src/main.rs"], ["FOO/src/main.rs", "/cwd", "FOO/src/main.rs"], object),
  );

  // Absolute path with unrelated root
  assert_rfn(
    mapping.to_real_filename(working_directory, path("/bar/src/main.rs")),
    rfn(["/bar/src/main.rs", "/cwd", "/bar/src/main.rs"], ["/bar/src/main.rs", "/cwd", "/bar/src/main.rs"], empty),
  );

  // Absolute path with cwd
  assert_rfn(
    mapping.to_real_filename(working_directory, path("/cwd/bar/src/main.rs")),
    rfn(["/cwd/bar/src/main.rs", "/cwd", "/cwd/bar/src/main.rs"], ["CWDBAR/src/main.rs", "/cwd", "CWDBAR/src/main.rs"], object),
  );

  // Relative path
  assert_rfn(
    mapping.to_real_filename(working_directory, path("src/main.rs")),
    rfn(["src/main.rs", "/cwd", "/cwd/src/main.rs"], ["src/main.rs", "/cwd", "/cwd/src/main.rs"], empty),
  );
});

// rustc: compiler/rustc_span/src/source_map/tests.rs:669 path_prefix_remapping_reverse
test_("path_prefix_remapping_reverse", () => {
  // Ignores options without alphanumeric chars.
  {
    const mapping = FilePathMapping.new(
      [
        [path("abc"), path("/")],
        [path("def"), path(".")],
      ],
      RemapPathScopeComponents.all(),
    );

    expect(reverse_map_prefix(mapping, "/hello.rs")).toBeUndefined();
    expect(reverse_map_prefix(mapping, "./hello.rs")).toBeUndefined();
  }

  // Returns `None` if multiple options match.
  {
    const mapping = FilePathMapping.new(
      [
        [path("abc"), path("/redacted")],
        [path("def"), path("/redacted")],
      ],
      RemapPathScopeComponents.all(),
    );

    expect(reverse_map_prefix(mapping, "/redacted/hello.rs")).toBeUndefined();
  }

  // Distinct reverse mappings.
  {
    const mapping = FilePathMapping.new(
      [
        [path("abc"), path("/redacted")],
        [path("def/ghi"), path("/fake/dir")],
      ],
      RemapPathScopeComponents.all(),
    );

    expect(reverse_map_prefix(mapping, "/redacted/path/hello.rs")).toBe(path_str("abc/path/hello.rs"));
    expect(reverse_map_prefix(mapping, "/fake/dir/hello.rs")).toBe(path_str("def/ghi/hello.rs"));
  }
});

// rustc: compiler/rustc_span/src/source_map/tests.rs:710 test_next_point
test_("test_next_point", () => {
  const sm = SourceMap.new(FilePathMapping.empty());
  sm.new_source_file(filename(sm, "example.rs"), S("a…b"));

  // Dummy spans don't advance.
  let span = DUMMY_SP;
  span = sm.next_point(span);
  expect(Span.lo(span)).toBe(BytePos(0));
  expect(Span.hi(span)).toBe(BytePos(0));

  // Span advance respect multi-byte character
  span = Span.with_root_ctxt(BytePos(0), BytePos(1));
  expect(unwrap_result(sm.span_to_snippet(span)).toString()).toBe("a");
  span = sm.next_point(span);
  expect(unwrap_result(sm.span_to_snippet(span)).toString()).toBe("…");
  expect(Span.lo(span)).toBe(BytePos(1));
  expect(Span.hi(span)).toBe(BytePos(4));

  // An empty span pointing just before a multi-byte character should
  // advance to contain the multi-byte character.
  span = Span.with_root_ctxt(BytePos(1), BytePos(1));
  span = sm.next_point(span);
  expect(Span.lo(span)).toBe(BytePos(1));
  expect(Span.hi(span)).toBe(BytePos(4));

  span = Span.with_root_ctxt(BytePos(1), BytePos(4));
  span = sm.next_point(span);
  expect(Span.lo(span)).toBe(BytePos(4));
  expect(Span.hi(span)).toBe(BytePos(5));

  // Reaching to the end of file, return a span that will get error with `span_to_snippet`
  span = Span.with_root_ctxt(BytePos(4), BytePos(5));
  span = sm.next_point(span);
  expect(Span.lo(span)).toBe(BytePos(5));
  expect(Span.hi(span)).toBe(BytePos(6));
  expect(sm.span_to_snippet(span).$).toBe("Err");

  // Reaching to the end of file, return a span that will get error with `span_to_snippet`
  span = Span.with_root_ctxt(BytePos(5), BytePos(5));
  span = sm.next_point(span);
  expect(Span.lo(span)).toBe(BytePos(5));
  expect(Span.hi(span)).toBe(BytePos(6));
  expect(sm.span_to_snippet(span).$).toBe("Err");
});

// rustc: compiler/rustc_span/src/source_map/tests.rs:756 test_span_followed_by_stops_at_end_of_file
test_("test_span_followed_by_stops_at_end_of_file", () => {
  const sm = SourceMap.new(FilePathMapping.empty());
  sm.new_source_file(filename(sm, "example.rs"), S("x"));

  const span = Span.with_root_ctxt(BytePos(0), BytePos(1));
  expect(sm.span_followed_by(span, "y")).toBeUndefined();
});

// rustc: compiler/rustc_span/src/source_map/tests.rs:765 test_span_followed_by_skips_whitespace
test_("test_span_followed_by_skips_whitespace", () => {
  const sm = SourceMap.new(FilePathMapping.empty());
  sm.new_source_file(filename(sm, "example.rs"), S("x \n yz"));

  const span0 = Span.with_root_ctxt(BytePos(0), BytePos(1));
  const span = sm.span_followed_by(span0, "yz")!;
  expect(unwrap_result(sm.span_to_snippet(span)).toString()).toBe("yz");
});

// PORT: `#[cfg(target_os = "linux")]` -> skipped (visibly) on other hosts.
// rustc: compiler/rustc_span/src/source_map/tests.rs:776 read_binary_file_handles_lying_stat
test.skipIf(process.platform !== "linux")("read_binary_file_handles_lying_stat", () => {
  // read_binary_file tries to read the contents of a file into an Arc<[u8]> while
  // never having two copies of the data in memory at once. This is an optimization
  // to support include_bytes! with large files. But since Rust allocators are
  // sensitive to alignment, our implementation can't be bootstrapped off calling
  // std::fs::read. So we test that we have the same behavior even on files where
  // fs::metadata lies.

  // stat always says that /proc/self/cmdline is length 0, but it isn't.
  const cmdline = "/proc/self/cmdline";
  let len = statSync(cmdline).size;
  let real = new Uint8Array(readFileSync(cmdline));
  expect(len < real.length).toBe(true);
  let bin = unwrap_result(new RealFileLoader().read_binary_file(cmdline));
  expect(bin).toEqual(real);

  // stat always says that /sys/devices/system/cpu/kernel_max is the size of a block.
  const kernel_max = "/sys/devices/system/cpu/kernel_max";
  len = statSync(kernel_max).size;
  real = new Uint8Array(readFileSync(kernel_max));
  expect(len > real.length).toBe(true);
  bin = unwrap_result(new RealFileLoader().read_binary_file(kernel_max));
  expect(bin).toEqual(real);
});
