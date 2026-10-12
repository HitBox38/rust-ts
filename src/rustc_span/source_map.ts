//! Types for tracking pieces of source code within a crate.
//!
//! The [`SourceMap`] tracks all the source code used within a single crate, mapping
//! from integer byte positions to the original source code location. Each bit
//! of source parsed during crate parsing (typically files, in-memory strings,
//! or various bits of macro expansion) cover a continuous range of bytes in the
//! `SourceMap` and are represented by [`SourceFile`]s. Byte positions are stored in
//! [`Span`] and used pervasively in the compiler. They are absolute positions
//! within the `SourceMap`, which upon request can be converted to line and column
//! information, source code snippets, etc.
//
// PORT: module-level code here must not touch lib.ts bindings at evaluation time (lib.ts imports
// this module, so either may be evaluated first).
import { closeSync, existsSync, fstatSync, openSync, readFileSync } from "node:fs";
import { FreezeLock } from "../rustc_data_structures/sync/freeze.ts";
import type { CrateNum } from "./def_id.ts";
import { FatalError } from "./fatal_error.ts";
import { SyntaxContext } from "./hygiene.ts";
import {
  BytePos,
  CharPos,
  debug_RealFileName,
  debug_RemapPathScopeComponents,
  type DistinctSources,
  FileName,
  type FileLines,
  type FileLinesResult,
  type FileNameDisplay,
  type LineInfo,
  type Loc,
  type MultiByteChar,
  type NormalizedPos,
  OffsetOverflowError,
  type PathBuf,
  RealFileName,
  RelativeBytePos,
  RemapPathScopeComponents,
  SourceFile,
  type SourceFileAndBytePos,
  type SourceFileAndLine,
  type SourceFileHash,
  type SourceFileHashAlgorithm,
  type SourceFileLines,
  type SpanData,
  type SpanLinesError,
  type SpanSnippetError,
  StableSourceFileId,
  ExternalSource,
  with_session_globals,
} from "./lib.ts";
import { Span } from "./span_encoding.ts";
import { is_whitespace, len_utf8, to_string as char_to_string } from "../std/char.ts";
import { debug_list, debug_str, debug_struct, debug_tuple, debug_vec, PLAIN, type Debug } from "../std/fmt.ts";
import { debug_IoError, INVALID_UTF8, io_error_from_node, io_error_other, type IoResult } from "../std/io.ts";
import { assert, panic, unported, unwrap } from "../std/panic.ts";
import { type Hasher, path_components, path_eq, path_hash, path_is_absolute, path_join, path_strip_prefix } from "../std/path.ts";
import { Err, Ok, ok, type Result } from "../std/result.ts";
import { partition_point } from "../std/slice.ts";
import {
  is_valid_utf8,
  Str,
  str_ceil_char_boundary,
  str_chars_count,
  str_chars_nth,
  str_contains_char,
  str_find_char,
  str_find_pred,
  str_floor_char_boundary,
  str_get,
  str_rfind_pred,
  str_rfind_char,
  str_rsplit_first,
  str_split_first,
  str_trim_end,
  str_trim_start,
  utf8_len,
} from "../std/str.ts";

// mod tests; (source_map/tests.test.ts)

/// Returns the span itself if it doesn't come from a macro expansion,
/// otherwise return the call site span up to the `enclosing_sp` by
/// following the `expn_data` chain.
// rustc: compiler/rustc_span/src/source_map.rs:28 original_sp
export function original_sp(sp: Span, enclosing_sp: Span): Span {
  const ctxt = Span.ctxt(sp);
  if (SyntaxContext.is_root(ctxt)) {
    return sp;
  }

  const enclosing_ctxt = Span.ctxt(enclosing_sp);
  const expn_data1 = SyntaxContext.outer_expn_data(ctxt);
  if (!SyntaxContext.is_root(enclosing_ctxt) && expn_data1.call_site === SyntaxContext.outer_expn_data(enclosing_ctxt).call_site) {
    return sp;
  } else {
    return original_sp(expn_data1.call_site, enclosing_sp);
  }
}

// mod monotonic

/// A `MonotonicVec` is a `Vec` which can only be grown.
/// Once inserted, an element can never be removed or swapped,
/// guaranteeing that any indices into a `MonotonicVec` are stable
// This is declared in its own module to ensure that the private
// field is inaccessible
export class MonotonicVec<T> {
  constructor(private readonly _0: T[]) {}

  // rustc: compiler/rustc_span/src/source_map.rs:55 push
  push(val: T): void {
    this._0.push(val);
  }

  // rustc: compiler/rustc_span/src/source_map.rs:61 default
  static default<T>(): MonotonicVec<T> {
    return new MonotonicVec<T>([]);
  }

  /** `impl Deref for MonotonicVec<T> { type Target = Vec<T>; }` (and `impl !DerefMut`). */
  // rustc: compiler/rustc_span/src/source_map.rs:68 deref
  deref(): readonly T[] {
    return this._0;
  }
}

// _____________________________________________________________________________
// SourceFile, MultiByteChar, FileName, FileLines
//

/// An abstraction over the fs operations used by the Parser.
export interface FileLoader {
  /// Query the existence of a file.
  // rustc: compiler/rustc_span/src/source_map.rs:83 file_exists
  file_exists(path: PathBuf): boolean;

  /// Read the contents of a UTF-8 file into memory.
  /// This function must return a String because we normalize
  /// source files, which may require resizing.
  // rustc: compiler/rustc_span/src/source_map.rs:88 read_file
  read_file(path: PathBuf): IoResult<Str>;

  /// Read the contents of a potentially non-UTF-8 file into memory.
  /// We don't normalize binary files, so we can start in an Arc.
  // rustc: compiler/rustc_span/src/source_map.rs:92 read_binary_file
  read_binary_file(path: PathBuf): IoResult<Uint8Array>;

  /// Current working directory
  // rustc: compiler/rustc_span/src/source_map.rs:95 current_directory
  current_directory(): IoResult<PathBuf>;
}

/// A FileLoader that uses std::fs to load real files.
export class RealFileLoader implements FileLoader {
  // rustc: compiler/rustc_span/src/source_map.rs:102 file_exists
  file_exists(path: PathBuf): boolean {
    return existsSync(path);
  }

  // rustc: compiler/rustc_span/src/source_map.rs:106 read_file
  read_file(path: PathBuf): IoResult<Str> {
    let file: number;
    try {
      file = openSync(path, "r");
    } catch (e) {
      return Err(io_error_from_node(e));
    }
    try {
      let size: number;
      try {
        size = fstatSync(file).size;
      } catch {
        size = 0;
      }

      if (size > SourceFile.MAX_FILE_SIZE) {
        return Err(io_error_other(`text files larger than ${SourceFile.MAX_FILE_SIZE} bytes are unsupported`));
      }
      // `file.read_to_string(&mut contents)?`
      let contents: Uint8Array;
      try {
        contents = readFileSync(file);
      } catch (e) {
        return Err(io_error_from_node(e));
      }
      if (!is_valid_utf8(contents)) {
        return Err(INVALID_UTF8);
      }
      return Ok(Str.of_bytes(contents));
    } finally {
      closeSync(file);
    }
  }

  // PORT: upstream reads `metadata.len()` bytes into an `Arc<[u8]>` and falls back to reading to
  // EOF when the reported size lies; `readFileSync` always reads to EOF, which is the same result.
  // rustc: compiler/rustc_span/src/source_map.rs:121 read_binary_file
  read_binary_file(path: PathBuf): IoResult<Uint8Array> {
    try {
      return Ok(new Uint8Array(readFileSync(path)));
    } catch (e) {
      return Err(io_error_from_node(e));
    }
  }

  // rustc: compiler/rustc_span/src/source_map.rs:162 current_directory
  current_directory(): IoResult<PathBuf> {
    try {
      return Ok(process.cwd());
    } catch (e) {
      return Err(io_error_from_node(e));
    }
  }
}

// _____________________________________________________________________________
// SourceMap
//

// PORT: `UnhashMap<StableSourceFileId, Arc<SourceFile>>` is keyed by the id's hash. The hash
// (StableHasher) is unported and `StableSourceFileId` keeps the hash inputs, so the map is keyed
// by `stable_source_file_id_key`, a string built from exactly the inputs upstream hashes.
class SourceMapFiles {
  constructor(
    readonly source_files: MonotonicVec<SourceFile>,
    readonly stable_id_to_source_file: Map<string, SourceFile>,
  ) {}

  /** `#[derive(Default)]` */
  static default(): SourceMapFiles {
    return new SourceMapFiles(MonotonicVec.default(), new Map());
  }
}

// rustc: compiler/rustc_span/src/source_map.rs:178 fmt
const debug_SourceMapFiles: Debug<SourceMapFiles> = (self, f) => {
  const { source_files } = self;

  return debug_list(
    f,
    source_files.deref().map((f) => debug_str(FileName.prefer_remapped_unconditionally(f.name).to_string())),
  );
};

/// Used to construct a `SourceMap` with `SourceMap::with_inputs`.
export interface SourceMapInputs {
  file_loader: FileLoader;
  path_mapping: FilePathMapping;
  hash_kind: SourceFileHashAlgorithm;
  checksum_hash_kind: SourceFileHashAlgorithm | undefined;
}

// rustc: compiler/rustc_span/src/source_map.rs:219 fmt
/** `impl fmt::Debug for SourceMap` */
export const debug_SourceMap: Debug<SourceMap> = (self, f) => {
  const { files_: files, path_mapping_: path_mapping, working_dir_: working_dir, hash_kind, checksum_hash_kind } = self;

  return debug_struct(f, "SourceMap", [
    // PORT: `files: RwLock<SourceMapFiles>`: rustc_data_structures' `#[derive(Debug)] struct
    // RwLock<T>(parking_lot::RwLock<T>)` around lock_api 0.4.14's `RwLock` Debug (rwlock.rs:1235;
    // never `<locked>`: nothing holds the lock while formatting).
    ["files", debug_tuple(f, "RwLock", [debug_struct(f, "RwLock", [["data", debug_SourceMapFiles(files, f)]])])],
    // PORT: `<file_loader@{file_loader:p}>` prints a heap address.
    ["file_loader", unported("rustc_span::source_map::SourceMap Debug (pointer formatting `{:p}`)")],
    ["path_mapping", debug_FilePathMapping(path_mapping, f)],
    ["working_dir", debug_RealFileName(working_dir, f)],
    ["hash_kind", hash_kind],
    ["checksum_hash_kind", checksum_hash_kind === undefined ? "None" : debug_tuple(f, "Some", [checksum_hash_kind])],
  ]);
};

// PORT: the fields `files`, `path_mapping` and `working_dir` are renamed `files_`,
// `path_mapping_` and `working_dir_`: JS classes cannot have a field and a method with the same name.
export class SourceMap {
  constructor(
    readonly files_: SourceMapFiles,
    readonly file_loader: FileLoader,

    // This is used to apply the file path remapping as specified via
    // `--remap-path-prefix` to all `SourceFile`s allocated within this `SourceMap`.
    readonly path_mapping_: FilePathMapping,

    /// Current working directory
    readonly working_dir_: RealFileName,

    /// The algorithm used for hashing the contents of each source file.
    readonly hash_kind: SourceFileHashAlgorithm,

    /// Similar to `hash_kind`, however this algorithm is used for checksums to determine if a crate is fresh.
    /// `cargo` is the primary user of these.
    ///
    /// If this is equal to `hash_kind` then the checksum won't be computed twice.
    readonly checksum_hash_kind: SourceFileHashAlgorithm | undefined,
  ) {}

  // rustc: compiler/rustc_span/src/source_map.rs:241 new
  static new(path_mapping: FilePathMapping): SourceMap {
    return SourceMap.with_inputs({
      file_loader: new RealFileLoader(),
      path_mapping,
      hash_kind: "Md5",
      checksum_hash_kind: undefined,
    });
  }

  // rustc: compiler/rustc_span/src/source_map.rs:250 with_inputs
  static with_inputs({ file_loader, path_mapping, hash_kind, checksum_hash_kind }: SourceMapInputs): SourceMap {
    const cwd_r = file_loader.current_directory();
    if (cwd_r.$ === "Err") {
      return panic(`expecting a current working directory to exist: ${debug_IoError(cwd_r._0, PLAIN)}`);
    }
    const cwd = cwd_r._0;
    const working_dir = path_mapping.to_real_filename(RealFileName.empty(), cwd);
    // debug!(?working_dir);
    return new SourceMap(SourceMapFiles.default(), file_loader, path_mapping, working_dir, hash_kind, checksum_hash_kind);
  }

  // rustc: compiler/rustc_span/src/source_map.rs:268 path_mapping
  path_mapping(): FilePathMapping {
    return this.path_mapping_;
  }

  // rustc: compiler/rustc_span/src/source_map.rs:272 working_dir
  working_dir(): RealFileName {
    return this.working_dir_;
  }

  // rustc: compiler/rustc_span/src/source_map.rs:276 file_exists
  file_exists(path: PathBuf): boolean {
    return this.file_loader.file_exists(path);
  }

  // rustc: compiler/rustc_span/src/source_map.rs:280 load_file
  load_file(path: PathBuf): IoResult<SourceFile> {
    const src = this.file_loader.read_file(path);
    if (src.$ === "Err") return src;
    const filename: FileName = { $: "Real", _0: this.path_mapping_.to_real_filename(this.working_dir_, path) };
    return Ok(this.new_source_file(filename, src._0));
  }

  /// Loads source file as a binary blob.
  ///
  /// Unlike `load_file`, guarantees that no normalization like BOM-removal
  /// takes place.
  // rustc: compiler/rustc_span/src/source_map.rs:290 load_binary_file
  load_binary_file(path: PathBuf): IoResult<[Uint8Array, Span]> {
    const bytes_r = this.file_loader.read_binary_file(path);
    if (bytes_r.$ === "Err") return bytes_r;
    const bytes = bytes_r._0;

    // We need to add file to the `SourceMap`, so that it is present
    // in dep-info. There's also an edge case that file might be both
    // loaded as a binary via `include_bytes!` and as proper `SourceFile`
    // via `mod`, so we try to use real file contents and not just an
    // empty string.
    const text = is_valid_utf8(bytes) ? Str.of_bytes(bytes.slice()) : Str.from("");
    const filename: FileName = { $: "Real", _0: this.path_mapping_.to_real_filename(this.working_dir_, path) };
    const file = this.new_source_file(filename, text);
    return Ok([
      bytes,
      Span.new(file.start_pos, BytePos(file.start_pos + file.normalized_source_len), SyntaxContext.root(), undefined),
    ]);
  }

  // By returning a `MonotonicVec`, we ensure that consumers cannot invalidate
  // any existing indices pointing into `files`.
  // rustc: compiler/rustc_span/src/source_map.rs:314 files
  files(): MonotonicVec<SourceFile> {
    return this.files_.source_files;
  }

  // rustc: compiler/rustc_span/src/source_map.rs:318 source_file_by_stable_id
  source_file_by_stable_id(stable_id: StableSourceFileId): SourceFile | undefined {
    return this.files_.stable_id_to_source_file.get(stable_source_file_id_key(stable_id));
  }

  // rustc: compiler/rustc_span/src/source_map.rs:325 register_source_file
  register_source_file(file_id: StableSourceFileId, file: SourceFile): Result<SourceFile, OffsetOverflowError> {
    const files = this.files_;

    const last_file = files.source_files.deref().at(-1);
    if (last_file !== undefined) {
      // Add one so there is some space between files. This lets us distinguish
      // positions in the `SourceMap`, even in the presence of zero-length files.
      const next = last_file.end_position() + 1;
      if (next > 0xffff_ffff) return Err(new OffsetOverflowError());
      file.start_pos = BytePos(next);
    } else {
      file.start_pos = BytePos(0);
    }

    files.source_files.push(file);
    files.stable_id_to_source_file.set(stable_source_file_id_key(file_id), file);

    return Ok(file);
  }

  /// Creates a new `SourceFile`.
  /// If a file already exists in the `SourceMap` with the same ID, that file is returned
  /// unmodified.
  // rustc: compiler/rustc_span/src/source_map.rs:350 new_source_file
  new_source_file(filename: FileName, src: Str): SourceFile {
    const r = this.try_new_source_file(filename, src);
    if (r.$ === "Ok") return r._0;
    process.stderr.write(`fatal error: rustc does not support text files larger than ${SourceFile.MAX_FILE_SIZE} bytes\n`);
    return new FatalError().raise();
  }

  // rustc: compiler/rustc_span/src/source_map.rs:360 try_new_source_file
  try_new_source_file(filename: FileName, src: Str): Result<SourceFile, OffsetOverflowError> {
    // Note that filename may not be a valid path, eg it may be `<anon>` etc,
    // but this is okay because the directory determined by `path.pop()` will
    // be empty, so the working directory will be used.

    const stable_id = StableSourceFileId.from_filename_in_current_crate(filename);
    const lrc_sf = this.source_file_by_stable_id(stable_id);
    if (lrc_sf !== undefined) {
      return Ok(lrc_sf);
    } else {
      const r = SourceFile.new(filename, src, this.hash_kind, this.checksum_hash_kind);
      if (r.$ === "Err") return r;
      const source_file = r._0;

      // Let's make sure the file_id we generated above actually matches
      // the ID we generate for the SourceFile we just created.
      // debug_assert_eq!(source_file.stable_id, stable_id);

      return this.register_source_file(stable_id, source_file);
    }
  }

  /// Allocates a new `SourceFile` representing a source file from an external
  /// crate. The source code of such an "imported `SourceFile`" is not available,
  /// but we still know enough to generate accurate debuginfo location
  /// information for things inlined from other crates.
  // rustc: compiler/rustc_span/src/source_map.rs:389 new_imported_source_file
  new_imported_source_file(
    filename: FileName,
    src_hash: SourceFileHash,
    checksum_hash: SourceFileHash | undefined,
    stable_id: StableSourceFileId,
    normalized_source_len_: number,
    unnormalized_source_len: number,
    cnum: CrateNum,
    file_local_lines: FreezeLock<SourceFileLines>,
    multibyte_chars: MultiByteChar[],
    normalized_pos: NormalizedPos[],
    metadata_index: number,
  ): SourceFile {
    const normalized_source_len = RelativeBytePos.from_u32(normalized_source_len_);

    const source_file = new SourceFile(
      filename,
      undefined,
      src_hash,
      checksum_hash,
      FreezeLock.new<ExternalSource>({
        $: "Foreign",
        kind: { $: "AbsentOk" },
        metadata_index,
      }),
      BytePos(0),
      normalized_source_len,
      unnormalized_source_len,
      file_local_lines,
      multibyte_chars,
      normalized_pos,
      stable_id,
      cnum,
    );

    const r = this.register_source_file(stable_id, source_file);
    if (r.$ === "Err") return panic("not enough address space for imported source file: OffsetOverflowError");
    return r._0;
  }

  /// If there is a doctest offset, applies it to the line.
  // rustc: compiler/rustc_span/src/source_map.rs:429 doctest_offset_line
  doctest_offset_line(file: FileName, orig: number): number {
    switch (file.$) {
      case "DocTest": {
        const offset = file._1;
        if (offset < 0) {
          // PORT: `orig - (-offset) as usize` wraps in release rustc when the offset exceeds
          // `orig`; per the recorded decision on usize values that wrap negative, the wrapped
          // value is kept as the exact signed number (callers print it via a usize helper).
          return orig - -offset;
        } else {
          return orig + offset;
        }
      }
      default:
        return orig;
    }
  }

  /// Return the SourceFile that contains the given `BytePos`
  // rustc: compiler/rustc_span/src/source_map.rs:443 lookup_source_file
  lookup_source_file(pos: BytePos): SourceFile {
    const idx = this.lookup_source_file_idx(pos);
    return index(this.files_.source_files.deref(), idx);
  }

  /// Looks up source information about a `BytePos`.
  // rustc: compiler/rustc_span/src/source_map.rs:449 lookup_char_pos
  lookup_char_pos(pos: BytePos): Loc {
    const sf = this.lookup_source_file(pos);
    const [line, col, col_display] = sf.lookup_file_pos_with_col_display(pos);
    return { file: sf, line, col, col_display };
  }

  /// If the corresponding `SourceFile` is empty, does not return a line number.
  // rustc: compiler/rustc_span/src/source_map.rs:456 lookup_line
  lookup_line(pos_: BytePos): Result<SourceFileAndLine, SourceFile> {
    const f = this.lookup_source_file(pos_);

    const pos = f.relative_position(pos_);
    const line = f.lookup_line(pos);
    if (line !== undefined) {
      return Ok({ sf: f, line });
    } else {
      return Err(f);
    }
  }

  // rustc: compiler/rustc_span/src/source_map.rs:466 span_to_string
  span_to_string(sp: Span, display_scope: RemapPathScopeComponents): string {
    return this.span_to_string_ext(sp, display_scope, false);
  }

  // rustc: compiler/rustc_span/src/source_map.rs:470 span_to_short_string
  span_to_short_string(sp: Span, display_scope: RemapPathScopeComponents): string {
    return this.span_to_string_ext(sp, display_scope, true);
  }

  // rustc: compiler/rustc_span/src/source_map.rs:478 span_to_string_ext
  span_to_string_ext(sp: Span, display_scope: RemapPathScopeComponents, short: boolean): string {
    const [source_file, lo_line, lo_col, hi_line, hi_col] = this.span_to_location_info(sp);

    let file_name: string;
    if (source_file !== undefined) {
      const sf = source_file;
      file_name = (short ? FileName.short(sf.name) : FileName.display(sf.name, display_scope)).to_string();
    } else {
      return "no-location";
    }

    return `${file_name}:${lo_line}:${lo_col}${short ? "" : `: ${hi_line}:${hi_col}`}`;
  }

  // rustc: compiler/rustc_span/src/source_map.rs:499 span_to_location_info
  span_to_location_info(sp: Span): [SourceFile | undefined, number, number, number, number] {
    if (this.files_.source_files.deref().length === 0 || Span.is_dummy(sp)) {
      return [undefined, 0, 0, 0, 0];
    }

    const lo = this.lookup_char_pos(Span.lo(sp));
    const hi = this.lookup_char_pos(Span.hi(sp));
    return [lo.file, lo.line, CharPos.to_usize(lo.col) + 1, hi.line, CharPos.to_usize(hi.col) + 1];
  }

  /// Format the span location to be printed in diagnostics. Must not be emitted
  /// to build artifacts as this may leak local file paths. Use span_to_embeddable_string
  /// for string suitable for embedding.
  // rustc: compiler/rustc_span/src/source_map.rs:515 span_to_diagnostic_string
  span_to_diagnostic_string(sp: Span): string {
    return this.span_to_string(sp, RemapPathScopeComponents.DIAGNOSTICS);
  }

  // rustc: compiler/rustc_span/src/source_map.rs:519 span_to_filename
  span_to_filename(sp: Span): FileName {
    return this.lookup_char_pos(Span.lo(sp)).file.name;
  }

  // rustc: compiler/rustc_span/src/source_map.rs:523 filename_for_diagnostics
  filename_for_diagnostics(filename: FileName): FileNameDisplay {
    return FileName.display(filename, RemapPathScopeComponents.DIAGNOSTICS);
  }

  // rustc: compiler/rustc_span/src/source_map.rs:527 is_multiline
  is_multiline(sp: Span): boolean {
    const lo_idx = this.lookup_source_file_idx(Span.lo(sp));
    const hi_idx = this.lookup_source_file_idx(Span.hi(sp));
    if (lo_idx !== hi_idx) {
      return true;
    }
    const f = index(this.files_.source_files.deref(), lo_idx);
    const lo = f.relative_position(Span.lo(sp));
    const hi = f.relative_position(Span.hi(sp));
    return f.lookup_line(lo) !== f.lookup_line(hi);
  }

  // #[instrument(skip(self), level = "trace")]
  // rustc: compiler/rustc_span/src/source_map.rs:540 is_valid_span
  is_valid_span(sp: Span): Result<[Loc, Loc], SpanLinesError> {
    const lo = this.lookup_char_pos(Span.lo(sp));
    // trace!(?lo);
    const hi = this.lookup_char_pos(Span.hi(sp));
    // trace!(?hi);
    if (lo.file.start_pos !== hi.file.start_pos) {
      return Err({
        $: "DistinctSources",
        _0: {
          begin: [lo.file.name, lo.file.start_pos],
          end: [hi.file.name, hi.file.start_pos],
        } satisfies DistinctSources,
      });
    }
    return Ok([lo, hi]);
  }

  // rustc: compiler/rustc_span/src/source_map.rs:554 is_line_before_span_empty
  is_line_before_span_empty(sp: Span): boolean {
    const r = this.span_to_prev_source(sp);
    switch (r.$) {
      case "Ok": {
        const s = r._0;
        const nl = str_rfind_char(s, 0x0a);
        const last = nl !== undefined ? s.slice(nl + 1) : s;
        return str_trim_start(last).is_empty();
      }
      case "Err":
        return false;
    }
  }

  // rustc: compiler/rustc_span/src/source_map.rs:561 span_to_lines
  span_to_lines(sp: Span): FileLinesResult {
    // debug!("span_to_lines(sp={:?})", sp);
    const r = this.is_valid_span(sp);
    if (r.$ === "Err") return r;
    const [lo, hi] = r._0;
    assert(hi.line >= lo.line, "assertion failed: hi.line >= lo.line");

    if (Span.is_dummy(sp)) {
      return Ok({ file: lo.file, lines: [] });
    }

    const lines: LineInfo[] = [];

    // The span starts partway through the first line,
    // but after that it starts from offset 0.
    let start_col = lo.col;

    // For every line but the last, it extends from `start_col`
    // and to the end of the line. Be careful because the line
    // numbers in Loc are 1-based, so we subtract 1 to get 0-based
    // lines.
    //
    // FIXME: now that we handle DUMMY_SP up above, we should consider
    // asserting that the line numbers here are all indeed 1-based.
    const hi_line = saturating_sub(hi.line, 1);
    for (let line_index = saturating_sub(lo.line, 1); line_index < hi_line; line_index++) {
      const s = lo.file.get_line(line_index);
      const line_len = s === undefined ? 0 : str_chars_count(s);
      lines.push({ line_index, start_col, end_col: CharPos.from_usize(line_len) });
      start_col = CharPos.from_usize(0);
    }

    // For the last line, it extends from `start_col` to `hi.col`:
    lines.push({ line_index: hi_line, start_col, end_col: hi.col });

    return Ok({ file: lo.file, lines } satisfies FileLines);
  }

  /// Extracts the source surrounding the given `Span` using the `extract_source` function. The
  /// extract function takes three arguments: a string slice containing the source, an index in
  /// the slice for the beginning of the span and an index in the slice for the end of the span.
  // rustc: compiler/rustc_span/src/source_map.rs:599 span_to_source
  span_to_source<T>(
    sp: Span,
    extract_source: (src: Str, start_index: number, end_index: number) => Result<T, SpanSnippetError>,
  ): Result<T, SpanSnippetError> {
    const local_begin = this.lookup_byte_offset(Span.lo(sp));
    const local_end = this.lookup_byte_offset(Span.hi(sp));

    if (local_begin.sf.start_pos !== local_end.sf.start_pos) {
      return Err({
        $: "DistinctSources",
        _0: {
          begin: [local_begin.sf.name, local_begin.sf.start_pos],
          end: [local_end.sf.name, local_end.sf.start_pos],
        } satisfies DistinctSources,
      });
    } else {
      this.ensure_source_file_source_present(local_begin.sf);

      const start_index = BytePos.to_usize(local_begin.pos);
      const end_index = BytePos.to_usize(local_end.pos);
      const source_len = RelativeBytePos.to_usize(local_begin.sf.normalized_source_len);

      if (start_index > end_index || end_index > source_len) {
        return Err({
          $: "MalformedForSourcemap",
          _0: {
            name: local_begin.sf.name,
            source_len,
            begin_pos: local_begin.pos,
            end_pos: local_end.pos,
          },
        });
      }

      const src = local_begin.sf.src;
      if (src !== undefined) {
        return extract_source(src, start_index, end_index);
      } else {
        const ext = ExternalSource.get_source(local_begin.sf.external_src.read());
        if (ext !== undefined) {
          return extract_source(ext, start_index, end_index);
        } else {
          return Err({ $: "SourceNotAvailable", filename: local_begin.sf.name });
        }
      }
    }
  }

  // rustc: compiler/rustc_span/src/source_map.rs:641 is_span_accessible
  is_span_accessible(sp: Span): boolean {
    const r = this.span_to_source(sp, (src, start_index, end_index) => {
      return Ok(str_get(src, start_index, end_index) !== undefined);
    });
    return r.$ === "Ok" && r._0;
  }

  /// Returns the source snippet as `String` corresponding to the given `Span`.
  // rustc: compiler/rustc_span/src/source_map.rs:649 span_to_snippet
  span_to_snippet(sp: Span): Result<Str, SpanSnippetError> {
    return this.span_to_source(sp, (src, start_index, end_index) => {
      const s = str_get(src, start_index, end_index);
      return s !== undefined ? Ok(s) : Err({ $: "IllFormedSpan", _0: sp });
    });
  }

  // rustc: compiler/rustc_span/src/source_map.rs:657 span_to_margin
  span_to_margin(sp: Span): number | undefined {
    const indent = this.indentation_before(sp);
    if (indent === undefined) return undefined;
    return indent.len();
  }

  // rustc: compiler/rustc_span/src/source_map.rs:661 indentation_before
  indentation_before(sp: Span): Str | undefined {
    return ok(
      this.span_to_source(sp, (src, start_index, _) => {
        const before = src.slice(0, start_index);
        const nl = str_rfind_char(before, 0x0a);
        const last_line = nl === undefined ? before : before.slice(nl + 1);
        const i = str_find_pred(last_line, (c) => !is_whitespace(c));
        return Ok(i === undefined ? last_line : last_line.slice(0, i));
      }),
    );
  }

  /// Returns the source snippet as `String` before the given `Span`.
  // rustc: compiler/rustc_span/src/source_map.rs:674 span_to_prev_source
  span_to_prev_source(sp: Span): Result<Str, SpanSnippetError> {
    return this.span_to_source(sp, (src, start_index, _) => {
      const s = str_get(src, 0, start_index);
      return s !== undefined ? Ok(s) : Err({ $: "IllFormedSpan", _0: sp });
    });
  }

  /// Extends the given `Span` to just after the previous occurrence of `c`. Return the same span
  /// if no character could be found or if an error occurred while retrieving the code snippet.
  // rustc: compiler/rustc_span/src/source_map.rs:682 span_extend_to_prev_char
  span_extend_to_prev_char(sp: Span, c: number, accept_newlines: boolean): Span {
    const r = this.span_to_prev_source(sp);
    if (r.$ === "Ok") {
      const prev_source = str_rsplit_first(r._0, c);
      if (!prev_source.is_empty() && (accept_newlines || !str_contains_char(prev_source, 0x0a))) {
        return Span.with_lo(sp, BytePos(Span.lo(sp) - prev_source.len()));
      }
    }

    return sp;
  }

  /// Extends the given `Span` to just before the previous occurrence of `c`. Return the same span
  /// if an error occurred while retrieving the code snippet.
  // rustc: compiler/rustc_span/src/source_map.rs:695 span_extend_to_prev_char_before
  span_extend_to_prev_char_before(sp: Span, c: number, accept_newlines: boolean): Span {
    const r = this.span_to_prev_source(sp);
    if (r.$ === "Ok") {
      const prev_source = str_rsplit_first(r._0, c);
      if (accept_newlines || !str_contains_char(prev_source, 0x0a)) {
        // PORT: `sp.lo().0 - prev_source.len() as u32 - 1_u32` is u32 arithmetic that wraps in
        // release rustc (no overflow checks); `>>> 0` mirrors the wrap.
        return Span.with_lo(sp, BytePos((Span.lo(sp) - prev_source.len() - 1) >>> 0));
      }
    }

    return sp;
  }

  /// Extends the given `Span` to just after the previous occurrence of `pat` when surrounded by
  /// whitespace. Returns None if the pattern could not be found or if an error occurred while
  /// retrieving the code snippet.
  // rustc: compiler/rustc_span/src/source_map.rs:714 span_extend_to_prev_str
  span_extend_to_prev_str(sp: Span, pat_: string, accept_newlines: boolean, include_whitespace: boolean): Span | undefined {
    // assure that the pattern is delimited, to avoid the following
    //     fn my_fn()
    //           ^^^^ returned span without the check
    //     ---------- correct span
    const prev_source_r = this.span_to_prev_source(sp);
    if (prev_source_r.$ === "Err") return undefined;
    const prev_source = prev_source_r._0;
    for (const ws of [" ", "\t", "\n"]) {
      const pat = pat_ + ws;
      const pat_pos = prev_source.rfind(pat);
      if (pat_pos !== undefined) {
        const just_after_pat_pos = pat_pos + utf8_len(pat) - 1;
        const just_after_pat_plus_ws = include_whitespace
          ? just_after_pat_pos + (str_find_pred(prev_source.slice(just_after_pat_pos), (c) => !is_whitespace(c)) ?? 0)
          : just_after_pat_pos;
        const len = prev_source.len() - just_after_pat_plus_ws;
        const prev_source_ = prev_source.slice(just_after_pat_plus_ws);
        if (accept_newlines || !str_contains_char(str_trim_start(prev_source_), 0x0a)) {
          return Span.with_lo(sp, BytePos(Span.lo(sp) - len));
        }
      }
    }

    return undefined;
  }

  /// Returns the source snippet as `String` after the given `Span`.
  // rustc: compiler/rustc_span/src/source_map.rs:750 span_to_next_source
  span_to_next_source(sp: Span): Result<Str, SpanSnippetError> {
    return this.span_to_source(sp, (src, _, end_index) => {
      const s = str_get(src, end_index, src.len());
      return s !== undefined ? Ok(s) : Err({ $: "IllFormedSpan", _0: sp });
    });
  }

  /// Extends the given `Span` while the next character matches the predicate
  // rustc: compiler/rustc_span/src/source_map.rs:757 span_extend_while
  span_extend_while(span: Span, f: (c: number) => boolean): Result<Span, SpanSnippetError> {
    return this.span_to_source(span, (s, _start, end) => {
      const i = str_find_pred(s.slice(end), (c) => !f(c));
      const n = i === undefined ? s.len() - end : i;
      return Ok(Span.with_hi(span, BytePos.add(Span.hi(span), BytePos(n))));
    });
  }

  /// Extends the span to include any trailing whitespace, or returns the original
  /// span if a `SpanSnippetError` was encountered.
  // rustc: compiler/rustc_span/src/source_map.rs:770 span_extend_while_whitespace
  span_extend_while_whitespace(span: Span): Span {
    const r = this.span_extend_while(span, is_whitespace);
    return r.$ === "Ok" ? r._0 : span;
  }

  /// Extends the given `Span` to previous character while the previous character matches the predicate
  // rustc: compiler/rustc_span/src/source_map.rs:775 span_extend_prev_while
  span_extend_prev_while(span: Span, f: (c: number) => boolean): Result<Span, SpanSnippetError> {
    return this.span_to_source(span, (s, start, _end) => {
      const found = str_rfind_pred(s.slice(0, start), (c) => !f(c));
      const n = found === undefined ? start : start - found[0] - len_utf8(found[1]);
      return Ok(Span.with_lo(span, BytePos.sub(Span.lo(span), BytePos(n))));
    });
  }

  /// Extends the given `Span` to just before the next occurrence of `c`.
  // rustc: compiler/rustc_span/src/source_map.rs:790 span_extend_to_next_char
  span_extend_to_next_char(sp: Span, c: number, accept_newlines: boolean): Span {
    const r = this.span_to_next_source(sp);
    if (r.$ === "Ok") {
      const next_source = str_split_first(r._0, c);
      if (!next_source.is_empty() && (accept_newlines || !str_contains_char(next_source, 0x0a))) {
        return Span.with_hi(sp, BytePos(Span.hi(sp) + next_source.len()));
      }
    }

    return sp;
  }

  /// Extends the given `Span` to contain the entire line it is on.
  // rustc: compiler/rustc_span/src/source_map.rs:802 span_extend_to_line
  span_extend_to_line(sp: Span): Span {
    return this.span_extend_to_prev_char(this.span_extend_to_next_char(sp, 0x0a, true), 0x0a, true);
  }

  /// Given a `Span`, tries to get a shorter span ending before the first occurrence of `char`
  /// `c`.
  // rustc: compiler/rustc_span/src/source_map.rs:808 span_until_char
  span_until_char(sp: Span, c: number): Span {
    const r = this.span_to_snippet(sp);
    switch (r.$) {
      case "Ok": {
        const snippet = str_trim_end(str_split_first(r._0, c));
        if (!snippet.is_empty() && !str_contains_char(snippet, 0x0a)) {
          return Span.with_hi(sp, BytePos(Span.lo(sp) + snippet.len()));
        } else {
          return sp;
        }
      }
      default:
        return sp;
    }
  }

  /// Given a 'Span', tries to tell if it's wrapped by "<>" or "()"
  /// the algorithm searches if the next character is '>' or ')' after skipping white space
  /// then searches the previous character to match '<' or '(' after skipping white space
  /// return true if wrapped by '<>' or '()'
  // rustc: compiler/rustc_span/src/source_map.rs:826 span_wrapped_by_angle_or_parentheses
  span_wrapped_by_angle_or_parentheses(span: Span): boolean {
    const r = this.span_to_source(span, (src, start_index, end_index) => {
      if (str_get(src, start_index, end_index) === undefined) {
        return Ok(false);
      }
      // test the right side to match '>' after skipping white space
      const end_src = src.slice(end_index);
      let i = 0;
      let found_right_parentheses = false;
      let found_right_angle = false;
      for (let cc = str_chars_nth(end_src, i); cc !== undefined; cc = str_chars_nth(end_src, i)) {
        if (cc === 0x20 /* ' ' */) {
          i = i + 1;
        } else if (cc === 0x3e /* '>' */) {
          // found > in the right;
          found_right_angle = true;
          break;
        } else if (cc === 0x29 /* ')' */) {
          found_right_parentheses = true;
          break;
        } else {
          // failed to find '>' return false immediately
          return Ok(false);
        }
      }
      // test the left side to match '<' after skipping white space
      i = start_index;
      const start_src = src.slice(0, start_index);
      for (let cc = str_chars_nth(start_src, i); cc !== undefined; cc = str_chars_nth(start_src, i)) {
        if (cc === 0x20 /* ' ' */) {
          if (i === 0) {
            return Ok(false);
          }
          i = i - 1;
        } else if (cc === 0x3c /* '<' */) {
          // found < in the left
          if (!found_right_angle) {
            // skip something like "(< )>"
            return Ok(false);
          }
          break;
        } else if (cc === 0x28 /* '(' */) {
          if (!found_right_parentheses) {
            // skip something like "<(>)"
            return Ok(false);
          }
          break;
        } else {
          // failed to find '<' return false immediately
          return Ok(false);
        }
      }
      return Ok(true);
    });
    return r.$ === "Ok" && r._0;
  }

  /// Given a `Span`, tries to get a shorter span ending just after the first occurrence of `char`
  /// `c`.
  // rustc: compiler/rustc_span/src/source_map.rs:885 span_through_char
  span_through_char(sp: Span, c: number): Span {
    const r = this.span_to_snippet(sp);
    if (r.$ === "Ok") {
      const offset = r._0.find(char_to_string(c));
      if (offset !== undefined) {
        return Span.with_hi(sp, BytePos(Span.lo(sp) + (offset + len_utf8(c))));
      }
    }
    return sp;
  }

  /// Given a `Span`, gets a new `Span` covering the first token and all its trailing whitespace
  /// or the original `Span`.
  ///
  /// If `sp` points to `"let mut x"`, then a span pointing at `"let "` will be returned.
  // rustc: compiler/rustc_span/src/source_map.rs:898 span_until_non_whitespace
  span_until_non_whitespace(sp: Span): Span {
    let whitespace_found = false;

    return this.span_take_while(sp, (c) => {
      if (!whitespace_found && is_whitespace(c)) {
        whitespace_found = true;
      }

      return !whitespace_found || is_whitespace(c);
    });
  }

  /// Given a `Span`, gets a new `Span` covering the first token without its trailing whitespace
  /// or the original `Span` in case of error.
  ///
  /// If `sp` points to `"let mut x"`, then a span pointing at `"let"` will be returned.
  // rustc: compiler/rustc_span/src/source_map.rs:914 span_until_whitespace
  span_until_whitespace(sp: Span): Span {
    return this.span_take_while(sp, (c) => !is_whitespace(c));
  }

  /// Given a `Span`, gets a shorter one until `predicate` yields `false`.
  // rustc: compiler/rustc_span/src/source_map.rs:919 span_take_while
  span_take_while(sp: Span, predicate: (c: number) => boolean): Span {
    const r = this.span_to_snippet(sp);
    if (r.$ === "Ok") {
      let offset = 0;
      const chars = r._0.chars();
      for (let c = chars.next(); c !== undefined && predicate(c); c = chars.next()) offset += len_utf8(c);

      return Span.with_hi(sp, BytePos(Span.lo(sp) + offset));
    } else {
      return sp;
    }
  }

  /// Given a `Span`, return a span ending in the closest `{`. This is useful when you have a
  /// `Span` enclosing a whole item but we need to point at only the head (usually the first
  /// line) of that item.
  ///
  /// *Only suitable for diagnostics.*
  // rustc: compiler/rustc_span/src/source_map.rs:937 guess_head_span
  guess_head_span(sp: Span): Span {
    // FIXME: extend the AST items to have a head span, or replace callers with pointing at
    // the item's ident when appropriate.
    return this.span_until_char(sp, 0x7b /* '{' */);
  }

  /// Returns a new span representing just the first character of the given span.
  // rustc: compiler/rustc_span/src/source_map.rs:944 start_point
  start_point(sp: Span): Span {
    let width: number;
    {
      const sp_ = Span.data(sp);
      const local_begin = this.lookup_byte_offset(sp_.lo);
      const start_index = BytePos.to_usize(local_begin.pos);
      const src = local_begin.sf.external_src.read();

      let snippet: Str | undefined;
      if (local_begin.sf.src !== undefined) {
        snippet = local_begin.sf.src.slice(start_index);
      } else {
        const s = ExternalSource.get_source(src);
        snippet = s === undefined ? undefined : s.slice(start_index);
      }

      if (snippet === undefined) {
        width = 1;
      } else {
        const c = snippet.chars().next();
        width = c === undefined ? 1 : len_utf8(c);
      }
    }

    return Span.with_hi(sp, BytePos(Span.lo(sp) + width));
  }

  /// Returns a new span representing just the last character of this span.
  // rustc: compiler/rustc_span/src/source_map.rs:970 end_point
  end_point(sp_: Span): Span {
    const sp = Span.data(sp_);
    const pos = sp.hi;

    const width = this.find_width_of_character_at_span(sp, false);
    const corrected_end_position = pos - width >= 0 ? pos - width : pos;

    const end_point = BytePos(Math.max(corrected_end_position, sp.lo));
    return sp.with_lo(end_point);
  }

  /// Returns a new span representing the next character after the end-point of this span.
  /// Special cases:
  /// - if span is a dummy one, returns the same span
  /// - if next_point reached the end of source, return a span exceeding the end of source,
  ///   which means sm.span_to_snippet(next_point) will get `Err`
  /// - respect multi-byte characters
  // rustc: compiler/rustc_span/src/source_map.rs:987 next_point
  next_point(sp_: Span): Span {
    if (Span.is_dummy(sp_)) {
      return sp_;
    }

    const sp = Span.data(sp_);
    const start_of_next_point = sp.hi;
    const width = this.find_width_of_character_at_span(sp, true);
    // If the width is 1, then the next span should only contain the next char besides current ending.
    // However, in the case of a multibyte character, where the width != 1, the next span should
    // span multiple bytes to include the whole character.
    const end_of_next_point_ =
      start_of_next_point + width <= 0xffff_ffff ? start_of_next_point + width : start_of_next_point;

    const end_of_next_point = BytePos(Math.max(start_of_next_point + 1, end_of_next_point_));
    return Span.new(BytePos(start_of_next_point), end_of_next_point, sp.ctxt, undefined);
  }

  /// Check whether span is followed by some specified target string, ignoring whitespace.
  /// *Only suitable for diagnostics.*
  // rustc: compiler/rustc_span/src/source_map.rs:1007 span_followed_by
  span_followed_by(span_: Span, target: string): Span | undefined {
    const span = this.span_extend_while_whitespace(span_);
    const next = this.span_to_next_source(span);
    if (next.$ === "Err") return undefined;
    if (!next._0.starts_with(target)) return undefined;
    return Span.new(Span.hi(span), BytePos.add(Span.hi(span), BytePos(utf8_len(target))), Span.ctxt(span), undefined);
  }

  /// Finds the width of the character, either before or after the end of provided span,
  /// depending on the `forwards` parameter.
  // #[instrument(skip(self, sp))]
  // rustc: compiler/rustc_span/src/source_map.rs:1017 find_width_of_character_at_span
  find_width_of_character_at_span(sp: SpanData, forwards: boolean): number {
    if (sp.lo === sp.hi && !forwards) {
      // debug!("early return empty span");
      return 1;
    }

    const local_begin = this.lookup_byte_offset(sp.lo);
    const local_end = this.lookup_byte_offset(sp.hi);
    // debug!("local_begin=`{:?}`, local_end=`{:?}`", local_begin, local_end);

    if (local_begin.sf.start_pos !== local_end.sf.start_pos) {
      // debug!("begin and end are in different files");
      return 1;
    }

    const start_index = BytePos.to_usize(local_begin.pos);
    const end_index = BytePos.to_usize(local_end.pos);
    // debug!("start_index=`{:?}`, end_index=`{:?}`", start_index, end_index);

    // Disregard indexes that are at the start or end of their spans, they can't fit bigger
    // characters.
    if ((!forwards && end_index === 0) || (forwards && start_index === USIZE_MAX)) {
      // debug!("start or end of span, cannot be multibyte");
      return 1;
    }

    const source_len = RelativeBytePos.to_usize(local_begin.sf.normalized_source_len);
    // debug!("source_len=`{:?}`", source_len);
    // Ensure indexes are also not malformed.
    // PORT: `source_len - 1` wraps to usize::MAX for an empty file (rustc ships without
    // overflow checks).
    if (start_index > end_index || end_index > (source_len === 0 ? USIZE_MAX : source_len - 1)) {
      // debug!("source indexes are malformed");
      return 1;
    }

    const src = local_begin.sf.external_src.read();

    let snippet: Str;
    if (local_begin.sf.src !== undefined) {
      snippet = local_begin.sf.src;
    } else {
      const s = ExternalSource.get_source(src);
      if (s !== undefined) {
        snippet = s;
      } else {
        return 1;
      }
    }

    if (forwards) {
      return str_ceil_char_boundary(snippet, end_index + 1) - end_index;
    } else {
      return end_index - str_floor_char_boundary(snippet, end_index - 1);
    }
  }

  // rustc: compiler/rustc_span/src/source_map.rs:1068 get_source_file
  get_source_file(filename: FileName): SourceFile | undefined {
    for (const sf of this.files_.source_files.deref()) {
      if (FileName_eq(filename, sf.name)) {
        return sf;
      }
    }
    return undefined;
  }

  /// For a global `BytePos`, computes the local offset within the containing `SourceFile`.
  // rustc: compiler/rustc_span/src/source_map.rs:1078 lookup_byte_offset
  lookup_byte_offset(bpos: BytePos): SourceFileAndBytePos {
    const idx = this.lookup_source_file_idx(bpos);
    const sf = index(this.files_.source_files.deref(), idx);
    const offset = BytePos.sub(bpos, sf.start_pos);
    return { sf, pos: offset };
  }

  /// Returns the index of the [`SourceFile`] (in `self.files`) that contains `pos`.
  /// This index is guaranteed to be valid for the lifetime of this `SourceMap`,
  /// since `source_files` is a `MonotonicVec`
  // rustc: compiler/rustc_span/src/source_map.rs:1088 lookup_source_file_idx
  lookup_source_file_idx(pos: BytePos): number {
    return partition_point(this.files_.source_files.deref(), (x) => x.start_pos <= pos) - 1;
  }

  // rustc: compiler/rustc_span/src/source_map.rs:1092 count_lines
  count_lines(): number {
    return this.files()
      .deref()
      .reduce((a, f) => a + f.count_lines(), 0);
  }

  // rustc: compiler/rustc_span/src/source_map.rs:1096 ensure_source_file_source_present
  ensure_source_file_source_present(source_file: SourceFile): boolean {
    return source_file.add_external_src(() => {
      if (source_file.name.$ !== "Real") {
        return undefined;
      }
      const name = source_file.name._0;

      let local_path: PathBuf;
      const local = name.local_path();
      if (local !== undefined) {
        local_path = local;
      } else {
        // The compiler produces better error messages if the sources of dependencies
        // are available. Attempt to undo any path mapping so we can find remapped
        // dependencies.
        //
        // We can only use the heuristic because `add_external_src` checks the file
        // content hash.
        const maybe_remapped_path = name.path(RemapPathScopeComponents.DIAGNOSTICS);
        local_path = this.path_mapping_.reverse_map_prefix_heuristically(maybe_remapped_path) ?? maybe_remapped_path;
      }

      return ok(this.file_loader.read_file(local_path));
    });
  }

  // rustc: compiler/rustc_span/src/source_map.rs:1123 is_imported
  is_imported(sp: Span): boolean {
    const source_file_index = this.lookup_source_file_idx(Span.lo(sp));
    const source_file = index(this.files().deref(), source_file_index);
    return source_file.is_imported();
  }

  /// Gets the span of a statement. If the statement is a macro expansion, the
  /// span in the context of the block span is found. The trailing semicolon is included
  /// on a best-effort basis.
  // rustc: compiler/rustc_span/src/source_map.rs:1132 stmt_span
  stmt_span(stmt_span: Span, block_span: Span): Span {
    if (!Span.from_expansion(stmt_span)) {
      return stmt_span;
    }
    const mac_call = original_sp(stmt_span, block_span);
    const s = this.mac_call_stmt_semi_span(mac_call);
    return s === undefined ? mac_call : Span.with_hi(mac_call, Span.hi(s));
  }

  /// Tries to find the span of the semicolon of a macro call statement.
  /// The input must be the *call site* span of a statement from macro expansion.
  /// ```ignore (illustrative)
  /// //       v output
  ///    mac!();
  /// // ^^^^^^ input
  /// ```
  // rustc: compiler/rustc_span/src/source_map.rs:1147 mac_call_stmt_semi_span
  mac_call_stmt_semi_span(mac_call: Span): Span | undefined {
    const span_ = this.span_extend_while_whitespace(mac_call);
    const span = this.next_point(span_);
    const r = this.span_to_snippet(span);
    if (r.$ === "Ok" && r._0.len() === 1 && r._0.byte(0) === 0x3b /* ';' */) {
      return span;
    } else {
      return undefined;
    }
  }
}

// rustc: compiler/rustc_span/src/source_map.rs:1154 get_source_map
export function get_source_map(): SourceMap | undefined {
  return with_session_globals((session_globals) => session_globals.source_map);
}

/** `#[derive(Clone, Debug)]` */
export class FilePathMapping {
  constructor(
    readonly mapping: [PathBuf, PathBuf][],
    readonly filename_remapping_scopes: RemapPathScopeComponents,
  ) {}

  // rustc: compiler/rustc_span/src/source_map.rs:1165 empty
  static empty(): FilePathMapping {
    return FilePathMapping.new([], RemapPathScopeComponents.empty());
  }

  // rustc: compiler/rustc_span/src/source_map.rs:1169 new
  static new(mapping: [PathBuf, PathBuf][], filename_remapping_scopes: RemapPathScopeComponents): FilePathMapping {
    return new FilePathMapping(mapping, filename_remapping_scopes);
  }

  /// Applies any path prefix substitution as defined by the mapping.
  /// The return value is the remapped path and a boolean indicating whether
  /// the path was affected by the mapping.
  // rustc: compiler/rustc_span/src/source_map.rs:1179 map_prefix
  map_prefix(path: PathBuf): [PathBuf, boolean] {
    if (path === "") {
      // Exit early if the path is empty and therefore there's nothing to remap.
      // This is mostly to reduce spam for `RUSTC_LOG=[remap_path_prefix]`.
      return [path, false];
    }

    return remap_path_prefix(this.mapping, path);

    // PORT: nested fn after the `return`, as upstream (a function declaration is hoisted like the item).
    // #[instrument(level = "debug", skip(mapping), ret)]
    // rustc: compiler/rustc_span/src/source_map.rs:1190 remap_path_prefix
    function remap_path_prefix(mapping: readonly [PathBuf, PathBuf][], path: PathBuf): [PathBuf, boolean] {
      // NOTE: We are iterating over the mapping entries from last to first
      //       because entries specified later on the command line should
      //       take precedence.
      for (let i = mapping.length - 1; i >= 0; i--) {
        const [from, to] = mapping[i]!;
        // debug!("Trying to apply {from:?} => {to:?}");

        const rest = path_strip_prefix(path, from);
        if (rest !== undefined) {
          // This is subtle, joining an empty path onto e.g. `foo/bar` will
          // result in `foo/bar/`, that is, there'll be an additional directory
          // separator at the end. This can lead to duplicated directory separators
          // in remapped paths down the line.
          // So, if we have an exact match, we just return that without a call
          // to `Path::join()`.
          const remapped = rest === "" ? to : path_join(to, rest);
          // debug!("Match - remapped");

          return [remapped, true];
        } else {
          // debug!("No match - prefix {from:?} does not match");
        }
      }

      // debug!("not remapped");
      return [path, false];
    }
  }

  /// Applies any path prefix substitution as defined by the mapping.
  ///
  /// The returned filename contains the a remapped path representing the remapped
  /// part if any remapping was performed.
  // rustc: compiler/rustc_span/src/source_map.rs:1229 to_real_filename
  to_real_filename(working_directory: RealFileName, local_path: PathBuf): RealFileName {
    let [remapped_path, was_remapped] = this.map_prefix(local_path);
    // debug!(?local_path, ?remapped_path, ?was_remapped, ?self.filename_remapping_scopes);

    // Always populate the local part, even if we just remapped it and the scopes are
    // total, so that places that load the file from disk still have access to it.
    const local = {
      name: local_path,
      working_directory: unwrap(working_directory.local_path(), "working directory should be local"),
      embeddable_name: path_is_absolute(local_path)
        ? local_path
        : path_join(unwrap(working_directory.local_path(), "working directory should be local"), local_path),
    };

    let embeddable_name: PathBuf;
    if (path_is_absolute(remapped_path) || was_remapped) {
      // The current directory may have been remapped so we take that
      // into account, otherwise we'll forget to include the scopes
      was_remapped = was_remapped || working_directory.was_remapped();

      embeddable_name = remapped_path;
    } else {
      // Create an absolute path and remap it as well.
      const [abs_path, abs_was_remapped] = this.map_prefix(path_join(working_directory.maybe_remapped.name, remapped_path));

      // If either the embeddable name or the working directory was
      // remapped, then the filename was remapped
      was_remapped = abs_was_remapped || working_directory.was_remapped();

      embeddable_name = abs_path;
    }

    return new RealFileName(
      local,
      {
        working_directory: working_directory.maybe_remapped.name,
        embeddable_name,
        name: remapped_path,
      },
      was_remapped ? this.filename_remapping_scopes : RemapPathScopeComponents.empty(),
    );
  }

  /// Attempts to (heuristically) reverse a prefix mapping.
  ///
  /// Returns [`Some`] if there is exactly one mapping where the "to" part is
  /// a prefix of `path` and has at least one non-empty
  /// [`Normal`](path::Component::Normal) component. The component
  /// restriction exists to avoid reverse mapping overly generic paths like
  /// `/` or `.`).
  ///
  /// This is a heuristic and not guaranteed to return the actual original
  /// path! Do not rely on the result unless you have other means to verify
  /// that the mapping is correct (e.g. by checking the file content hash).
  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_span/src/source_map.rs:1302 reverse_map_prefix_heuristically
  reverse_map_prefix_heuristically(path: PathBuf): PathBuf | undefined {
    let found: PathBuf | undefined = undefined;

    for (const [from, to] of this.mapping) {
      let has_normal_component = false;
      const comps = path_components(to);
      for (let c = comps.next(); c !== undefined; c = comps.next()) {
        if (c.$ === "Normal" ? c._0 !== "" : false) {
          has_normal_component = true;
          break;
        }
      }

      if (!has_normal_component) {
        continue;
      }

      const rest = path_strip_prefix(path, to);
      if (rest === undefined) {
        continue;
      }

      if (found !== undefined) {
        return undefined;
      }

      found = path_join(from, rest);
    }

    return found;
  }
}

/** `#[derive(Debug)]` */
export const debug_FilePathMapping: Debug<FilePathMapping> = (v, f) =>
  debug_struct(f, "FilePathMapping", [
    ["mapping", debug_vec(v.mapping, f, ([a, b], f) => debug_tuple(f, "", [debug_str(a), debug_str(b)]))],
    ["filename_remapping_scopes", debug_RemapPathScopeComponents(v.filename_remapping_scopes, f)],
  ]);

// _____________________________________________________________________________
// PORT: shims for derives / std functionality that live outside this file upstream.
// Root: `FileName_eq` and `stable_source_file_id_key` belong next to `FileName` in lib.ts.
// The std::path, str and io shims moved to src/std/{path,str,io}.ts (review w23a).
//

const USIZE_MAX = Number.MAX_SAFE_INTEGER;

/** `slice[i]` (panics like Rust on out-of-bounds; a wrapped `0 - 1` index is usize::MAX). */
function index<T>(v: readonly T[], i: number): T {
  if (i < 0 || i >= v.length) {
    return panic(`index out of bounds: the len is ${v.length} but the index is ${i < 0 ? "18446744073709551615" : i}`);
  }
  return v[i]!;
}

function saturating_sub(a: number, b: number): number {
  return a > b ? a - b : 0;
}

/** `#[derive(PartialEq)]` for `FileName` (paths compare by components, like `Path`'s `PartialEq`). */
export function FileName_eq(a: FileName, b: FileName): boolean {
  switch (a.$) {
    case "Real":
      return b.$ === "Real" && RealFileName_eq(a._0, b._0);
    case "Custom":
      return b.$ === "Custom" && a._0 === b._0;
    case "DocTest":
      return b.$ === "DocTest" && RealFileName_eq(a._0, b._0) && a._1 === b._1;
    default:
      return b.$ === a.$ && (b as { _0: unknown })._0 === a._0;
  }
}

type InnerRealFileName = RealFileName["maybe_remapped"];

function InnerRealFileName_eq(a: InnerRealFileName, b: InnerRealFileName): boolean {
  return path_eq(a.name, b.name) && path_eq(a.working_directory, b.working_directory) && path_eq(a.embeddable_name, b.embeddable_name);
}

/** `#[derive(PartialEq)]` for `RealFileName`. */
export function RealFileName_eq(a: RealFileName, b: RealFileName): boolean {
  return (
    (a.local === undefined ? b.local === undefined : b.local !== undefined && InnerRealFileName_eq(a.local, b.local)) &&
    InnerRealFileName_eq(a.maybe_remapped, b.maybe_remapped) &&
    a.scopes === b.scopes
  );
}

// PORT: records the byte stream a `StableHasher` (rustc-stable-hash 0.1.2, stable_hasher.rs) is fed,
// as a latin1 string: two inputs get the same key exactly when upstream hashes the same bytes.
class StableHasherBytes implements Hasher {
  s = "";

  write(bytes: Uint8Array): void {
    for (const b of bytes) this.s += String.fromCharCode(b);
  }

  write_u8(i: number): void {
    this.s += String.fromCharCode(i & 0xff);
  }

  /** `write_u64(i.to_le())` */
  private write_u64(i: bigint): void {
    for (let k = 0n; k < 64n; k += 8n) this.write_u8(Number((i >> k) & 0xffn));
  }

  write_usize(i: bigint): void {
    this.write_u64(i);
  }

  /** Small values hash as one byte; others as `0xFF` + the 8 bytes. */
  write_isize(i: number): void {
    const value = BigInt.asUintN(64, BigInt(i));
    if (value < 0xffn) {
      this.write_u8(Number(value));
    } else {
      this.write_u8(0xff);
      this.write_u64(value);
    }
  }

  write_length_prefix(len: number): void {
    this.write_usize(BigInt(len));
  }
}

/** Key standing in for `StableSourceFileId`'s hash: built from the same inputs, in the same way as
 *  `impl Hash for RealFileName` (the local part is skipped when fully remapped). Paths contribute
 *  the exact bytes `impl Hash for Path` feeds the hasher (no root, `.` after a separator skipped,
 *  `chunk_bits` tail), so e.g. `/x.rs` and `x.rs` share a key, as they share a hash upstream. */
export function stable_source_file_id_key(id: StableSourceFileId): string {
  const path_key = (p: PathBuf): string => {
    const h = new StableHasherBytes();
    path_hash(p, h);
    return JSON.stringify(h.s);
  };
  const inner_key = (i: InnerRealFileName): string => `${path_key(i.name)},${path_key(i.working_directory)},${path_key(i.embeddable_name)}`;
  const real_key = (r: RealFileName): string =>
    `${r.was_fully_remapped() ? "" : r.local === undefined ? "None" : `Some(${inner_key(r.local)})`};${inner_key(r.maybe_remapped)};${r.scopes}`;
  const name = id.filename;
  let key: string;
  switch (name.$) {
    case "Real":
      key = `Real(${real_key(name._0)})`;
      break;
    case "Custom":
      key = `Custom(${JSON.stringify(name._0)})`;
      break;
    case "DocTest":
      key = `DocTest(${real_key(name._0)},${name._1})`;
      break;
    default:
      key = `${name.$}(${String(name._0)})`;
  }
  return `${key}|${id.stable_crate_id === undefined ? "None" : String(id.stable_crate_id)}`;
}

