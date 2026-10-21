// Port of compiler/rustc_middle/src/mir/pretty.rs (lane mir-contract declared it, plan-m4 D3 / D11). `PassWhere`,
// `PrettyPrintMirOptions` and `RenderAllocation` are generated (pretty.gen.ts, set rustc_middle_mir); `MirDumper`,
// `MirWriter` and `ExtraComments` (a `Visitor`) are hand classes below. Lines :874..:1437 (the manual `Debug` /
// `Display` impls of the statement / terminator / operand / place types, `fmt_head`, `fmt_successor_labels`,
// `pre_fmt_projection`, `post_fmt_projection`) are lane mir-body-b's; the rest is lane mir-pretty's (wave 21).
// docs/handoff/mir-contract.md has the conventions ("How to fill a stub").
//
// PORT: `&mut dyn io::Write` is vendor/anstream's `Write` (the `std::io::Write` port) and `io::Result<T>` src/std's
// `IoResult<T>`; `&mut dyn fmt::Write` / `W: fmt::Write` is its `FmtWrite` and `fmt::Result` `FmtResult`; a
// `&mut Formatter` parameter that is only written to is the Debug convention: the fn returns the written text.
// PORT: `write!(w, ..)` / `writeln!(w, ..)` on an `io::Write` is `w.write_fmt([text])` with the text rendered by a
// template literal (one `write_str` instead of one per piece: the same bytes); `?` is
// `if ((r = ..).$ === "Err") return r;`.
// PORT: `{:N$}` / `{:A$}` padding of a string counts `char`s (`pad`, below); `{:─^N$}` centres with a fill (`center`).
// PORT (init order): this module extends visit.ts's `Visitor` at load and is not re-exported by mir/mod.ts (mod.rs's
// `pub use self::pretty::{MirDumper, PassWhere, display_allocation, write_mir_pretty}`): import it as
// `rustc_middle/mir/pretty.ts`. The `debug_X` of the statement / terminator / operand / place types that mod.ts,
// syntax.ts, statement.ts and terminator.ts export forward here lazily.
import "./mod.ts";
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { Size } from "../../rustc_abi/lib.ts";
import { Mutability } from "../../rustc_ast_ir/lib.ts";
import { type BitMatrix, debug_BitMatrix } from "../../rustc_index/bit_set.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { VariantIdx } from "../../rustc_abi/layout.ts";
import type { PathBuf } from "../../rustc_error_messages/lib.ts";
import type { Constness, CoroutineKind } from "../../rustc_hir/hir.ts";
import { debug_CoroutineKind } from "../../rustc_hir/hir.gen.ts";
import { debug_DefKind } from "../../rustc_hir/def.gen.ts";
import { debug_DefId } from "../../rustc_span/def_id.ts";
import { debug_Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { display_Symbol } from "../../rustc_span/symbol.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { display_Canonical } from "../../rustc_type_ir/canonical.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { is_whitespace } from "../../std/char.ts";
import { type Debug, debug_option, debug_str, debug_vec, type Fmt, format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import { debug_IoError, type IoError, type IoResult, io_error_from_node } from "../../std/io.ts";
import { assert, assert_eq, panic, unported, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../../std/result.ts";
import { utf8_len } from "../../std/str.ts";
import { type FmtArguments, type FmtError, type FmtResult, type FmtWrite, type Write, Write_default } from "../../vendor/anstream/stream.ts";
import type { TyCtxt } from "../ty/context.ts";
import { with_ } from "../ty/context/tls.ts";
import type { Scalar as ty_Scalar, Ty, Value } from "../ty/decls.ts";
import { debug_GenericArgs, fold_GenericArgs, GenericArg } from "../ty/generic_args.ts";
import { display_Instance, InstanceKind } from "../ty/instance.ts";
import { Namespace } from "../../rustc_hir/def.ts";
import { display_List_PolyExistentialPredicate, display_ParamConst, display_Ty, FmtPrinter, with_forced_impl_filename_line, with_no_trimmed_paths } from "../ty/print/pretty.ts";
import { fold_Ty } from "../ty/structural_impls.ts";
import { CoroutineArgsExt } from "../ty/sty.ts";
import { debug_UserTypeAnnotationIndex, display_UserType } from "../ty/typeck_results.ts";
import { Const, ConstValue, debug_Const, debug_ConstValue, display_Const } from "./consts.ts";
import type { CoverageEarlyInfo, CoverageMirInfo } from "./coverage.ts";
import { debug_BlockMarkerId, debug_MappingKind } from "./coverage.gen.ts";
import { AllocRange, alloc_range, type Allocation } from "./interpret/allocation.ts";
import { debug_AllocError } from "./interpret/allocation.gen.ts";
import type { PointerFrag } from "./interpret/allocation/provenance_map.gen.ts";
import { type AllocId, type ConstAllocation, debug_AllocId, GlobalAlloc, read_target_uint } from "./interpret/mod.ts";
import { CtfeProvenance, debug_CtfeProvenance, debug_Pointer, Pointer } from "./interpret/pointer.ts";
import {
  BasicBlock,
  type Body,
  clone_Location,
  debug_BasicBlock,
  debug_Local,
  debug_Location,
  debug_Promoted,
  debug_UserTypeProjection,
  debug_VarDebugInfoContents,
  Local,
  type Location,
  MirPhase,
  OUTERMOST_SOURCE_SCOPE,
  RETURN_PLACE,
  type SourceInfo,
  SourceScope,
  type VarDebugInfo,
} from "./mod.ts";
import { PassWhere, PrettyPrintMirOptions, type RenderAllocation } from "./pretty.gen.ts";
import { type CoroutineLayout, CoroutineSavedLocal, debug_CoroutineSavedLocal, type DestructuredConstant } from "./query.ts";
import { Place_from_Local, type PlaceRef, type Statement, type StmtDebugInfo } from "./statement.ts";
import {
  type ConstOperand,
  type NonDivergingIntrinsic,
  type Operand,
  type Place,
  type PlaceElem,
  type Rvalue,
  type StatementKind,
  TerminatorKind,
} from "./syntax.ts";
import { AnalysisPhase_discriminant, RuntimePhase_discriminant } from "./syntax.gen.ts";
import type { Terminator } from "./terminator.ts";
import { Visitor } from "./visit.ts";
export * from "./pretty.gen.ts";

const INDENT = "    ";
/// Alignment for lining up comments following MIR statements
export const ALIGN = 40;

// ---- formatting helpers (PORT: `core::fmt` width / fill / alignment, not ported code) ----

/** The number of `char`s of `s` (`s.chars().count()`): code points, not UTF-16 units. */
function char_count(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

/** `{:width$}` of a string: left-aligned, padded with spaces to `width` chars (never truncated). */
function pad(s: string, width: number): string {
  const n = char_count(s);
  return n >= width ? s : s + " ".repeat(width - n);
}

/** `{:fill^width$}` of a string: centred (the extra fill char goes to the right), never truncated. */
function center(s: string, fill: string, width: number): string {
  const n = char_count(s);
  if (n >= width) return s;
  const padding = width - n;
  const pre = Math.floor(padding / 2);
  return fill.repeat(pre) + s + fill.repeat(padding - pre);
}

/** `{:0width$x}` of an integer. */
function hex_pad(x: number | bigint, width: number): string {
  return x.toString(16).padStart(width, "0");
}

/** `str::trim` (Unicode `White_Space`). */
function str_trim(s: string): string {
  const cps = [...s];
  let a = 0;
  let b = cps.length;
  while (a < b && is_whitespace(cps[a]!.codePointAt(0)!)) a++;
  while (b > a && is_whitespace(cps[b - 1]!.codePointAt(0)!)) b--;
  return cps.slice(a, b).join("");
}

/** `format!` of a `Display` / `Debug` impl that returned `fmt::Error` (std's `format` panics). */
function fmt_error_in_format(): never {
  return panic("a Display implementation returned an error unexpectedly: Error");
}

/** PORT: `Debug` of a `Prov: Provenance` value, by its representation (as pointer.ts `provenance_of`: a bigint is a
 *  `CtfeProvenance`, a number an `AllocId`). */
function debug_prov<Prov>(prov: Prov, f: Fmt): string {
  return typeof prov === "bigint" ? debug_CtfeProvenance(prov as unknown as CtfeProvenance, f) : debug_AllocId(prov as unknown as AllocId, f);
}

/** PORT: `#[derive(PartialOrd)]` of `MirPhase` (variant order, then the phase): `a <= b`. */
function MirPhase_le(a: MirPhase, b: MirPhase): boolean {
  const variant = (p: MirPhase): number => (p.$ === "Built" ? 0 : p.$ === "Analysis" ? 1 : 2);
  const inner = (p: MirPhase): number =>
    p.$ === "Analysis" ? AnalysisPhase_discriminant[p._0] : p.$ === "Runtime" ? RuntimePhase_discriminant[p._0] : 0;
  if (variant(a) !== variant(b)) return variant(a) < variant(b);
  return inner(a) <= inner(b);
}

/** A `String` used as a `fmt::Write` (`write!(string, ..)`). */
class StringWrite implements FmtWrite {
  buf = "";
  write_str(s: string): FmtResult {
    this.buf += s;
    return Ok(undefined);
  }
}

declare module "./pretty.gen.ts" {
  namespace PrettyPrintMirOptions {
    // pretty.rs:60
    export function from_cli(tcx: TyCtxt): PrettyPrintMirOptions;
  }
}

declare module "./syntax.ts" {
  interface TerminatorKind_methods {
    // pretty.rs:991 (lane mir-body-b)
    fmt_head(self: TerminatorKind, fmt: FmtWrite): FmtResult;
    // pretty.rs:1090 (lane mir-body-b)
    fmt_successor_labels(self: TerminatorKind): string[];
  }
}

/**
 * rustc_session/config.ts, read lazily (precedent ty/instance.ts): it is not in this module's load closure, and it is
 * entered through rustc_session/lib.ts (config.ts and options.gen.ts import each other; as the first module of the
 * crate to load, config.ts stops in options.gen.ts's TDZ).
 */
function session_config(): typeof import("../../rustc_session/config.ts") {
  require("../../rustc_session/lib.ts");
  return require("../../rustc_session/config.ts") as typeof import("../../rustc_session/config.ts");
}

/// Create the default set of MIR pretty-printing options from the CLI flags.
// rustc: compiler/rustc_middle/src/mir/pretty.rs:60 from_cli
(PrettyPrintMirOptions as unknown as { from_cli: typeof PrettyPrintMirOptions.from_cli }).from_cli = function (tcx: TyCtxt): PrettyPrintMirOptions {
  return new PrettyPrintMirOptions(session_config().MirIncludeSpans.is_enabled(tcx.sess.opts.unstable_opts.mir_include_spans));
};

/**
 * PORT: `fs::File::create_buffered(path)` (`io::BufWriter<fs::File>`): the bytes are buffered and written to the
 * file by `flush()`, which the callers run where the `BufWriter` is dropped (its `Drop` flushes, ignoring errors).
 */
class DumpFile implements Write {
  private chunks: Uint8Array[] = [];

  constructor(private fd: number) {}

  write(buf: Uint8Array): IoResult<number> {
    this.chunks.push(buf.slice());
    return Ok(buf.length);
  }

  write_all(buf: Uint8Array): IoResult<void> {
    return Write_default.write_all(this, buf);
  }

  write_fmt(args: FmtArguments): IoResult<void> {
    return Write_default.write_fmt(this, args);
  }

  flush(): IoResult<void> {
    try {
      for (const c of this.chunks) {
        let off = 0;
        while (off < c.length) off += writeSync(this.fd, c, off, c.length - off);
      }
      this.chunks = [];
      return Ok(undefined);
    } catch (e) {
      return Err(io_error_from_node(e));
    }
  }

  /** The end of the `BufWriter`'s scope: flush (errors ignored, as `BufWriter`'s `Drop`) and close the file. */
  drop(): void {
    this.flush();
    closeSync(this.fd);
  }
}

/// Manages MIR dumping, which is MIR writing done to a file with a specific name. In particular,
/// it makes it impossible to dump MIR to one of these files when it hasn't been requested from the
/// command line. Layered on top of `MirWriter`, which does the actual writing.
// rustc-type: compiler/rustc_middle/src/mir/pretty.rs:68 MirDumper
export class MirDumper {
  constructor(
    public show_pass_num: boolean,
    public pass_name: string,
    /** PORT: `&'a dyn Display`: the rendered text (`&0` is `"0"`). */
    public disambiguator: string,
    public writer: MirWriter,
  ) {}

  // If dumping should be performed (e.g. because it was requested on the
  // CLI), returns a `MirDumper` with default values for the following fields:
  // - `show_pass_num`: `false`
  // - `disambiguator`: `&0`
  // - `writer.extra_data`: a no-op
  // - `writer.options`: default options derived from CLI flags
  // rustc: compiler/rustc_middle/src/mir/pretty.rs:82 new
  static new(tcx: TyCtxt, pass_name: string, body: Body): MirDumper | undefined {
    let dump_enabled: boolean;
    const filters = tcx.sess.opts.unstable_opts.dump_mir;
    if (filters !== undefined) {
      // see notes on #41697 below
      const node_path = with_no_trimmed_paths(() => with_forced_impl_filename_line(() => tcx.def_path_str(body.source.def_id())));
      dump_enabled = filters.split("|").some((or_filter) =>
        or_filter.split("&").every((and_filter) => {
          const and_filter_trimmed = str_trim(and_filter);
          return and_filter_trimmed === "all" || pass_name.includes(and_filter_trimmed) || node_path.includes(and_filter_trimmed);
        }),
      );
    } else {
      dump_enabled = false;
    }

    return dump_enabled ? new MirDumper(false, pass_name, "0", MirWriter.new(tcx)) : undefined;
  }

  // rustc: compiler/rustc_middle/src/mir/pretty.rs:108 tcx
  tcx(): TyCtxt {
    return this.writer.tcx;
  }

  // #[must_use]
  // rustc: compiler/rustc_middle/src/mir/pretty.rs:113 set_show_pass_num
  set_show_pass_num(): MirDumper {
    this.show_pass_num = true;
    return this;
  }

  // #[must_use]
  // rustc: compiler/rustc_middle/src/mir/pretty.rs:119 set_disambiguator
  set_disambiguator(disambiguator: string): MirDumper {
    this.disambiguator = disambiguator;
    return this;
  }

  // #[must_use]
  // rustc: compiler/rustc_middle/src/mir/pretty.rs:125 set_extra_data
  set_extra_data(extra_data: (pass_where: PassWhere, w: Write) => IoResult<void>): MirDumper {
    this.writer.extra_data = extra_data;
    return this;
  }

  // #[must_use]
  // rustc: compiler/rustc_middle/src/mir/pretty.rs:134 set_options
  set_options(options: PrettyPrintMirOptions): MirDumper {
    this.writer.options = options;
    return this;
  }

  /// If the session is properly configured, dumps a human-readable representation of the MIR
  /// (with default pretty-printing options) into:
  ///
  /// ```text
  /// rustc.node<node_id>.<pass_num>.<pass_name>.<disambiguator>
  /// ```
  ///
  /// Output from this function is controlled by passing `-Z dump-mir=<filter>`,
  /// where `<filter>` takes the following forms:
  ///
  /// - `all` -- dump MIR for all fns, all passes, all everything
  /// - a filter defined by a set of substrings combined with `&` and `|`
  ///   (`&` has higher precedence). At least one of the `|`-separated groups
  ///   must match; an `|`-separated group matches if all of its `&`-separated
  ///   substrings are matched.
  ///
  /// Example:
  ///
  /// - `nll` == match if `nll` appears in the name
  /// - `foo & nll` == match if `foo` and `nll` both appear in the name
  /// - `foo & nll | typeck` == match if `foo` and `nll` both appear in the name
  ///   or `typeck` appears in the name.
  /// - `foo & nll | bar & typeck` == match if `foo` and `nll` both appear in the name
  ///   or `typeck` and `bar` both appear in the name.
  // rustc: compiler/rustc_middle/src/mir/pretty.rs:163 dump_mir
  dump_mir(body: Body): void {
    // let _ = try { .. };
    {
      const file = this.create_dump_file("mir", body);
      if (file.$ === "Ok") {
        try {
          this.dump_mir_to_writer(body, file._0);
        } finally {
          (file._0 as DumpFile).drop();
        }
      }
    }

    if (this.tcx().sess.opts.unstable_opts.dump_mir_graphviz) {
      // let _ = try { .. };
      const file = this.create_dump_file("dot", body);
      if (file.$ === "Ok") {
        try {
          // write_mir_fn_graphviz(self.tcx(), body, false, &mut file)?;
          unported("rustc_middle::mir::graphviz::write_mir_fn_graphviz");
        } finally {
          (file._0 as DumpFile).drop();
        }
      }
    }
  }

  // #41697 -- we use `with_forced_impl_filename_line()` because `def_path_str()` would otherwise
  // trigger `type_of`, and this can run while we are already attempting to evaluate `type_of`.
  // rustc: compiler/rustc_middle/src/mir/pretty.rs:179 dump_mir_to_writer
  dump_mir_to_writer(body: Body, w: Write): IoResult<void> {
    let r: IoResult<void>;
    // see notes on #41697 above
    const def_path = with_no_trimmed_paths(() => with_forced_impl_filename_line(() => this.tcx().def_path_str(body.source.def_id())));
    // ignore-tidy-odd-backticks the literal below is fine
    if ((r = w.write_fmt([`// MIR for \`${def_path}`])).$ === "Err") return r;
    const promoted = body.source.promoted;
    if (promoted === undefined) {
      if ((r = w.write_fmt(["`"])).$ === "Err") return r;
    } else {
      if ((r = w.write_fmt([`::${debug_Promoted(promoted, PLAIN)}\``])).$ === "Err") return r;
    }
    if ((r = w.write_fmt([` ${this.disambiguator} ${this.pass_name}\n`])).$ === "Err") return r;
    if ((r = w.write_fmt(["\n"])).$ === "Err") return r;
    if ((r = this.writer.extra_data(PassWhere.BeforeCFG, w)).$ === "Err") return r;
    if ((r = write_user_type_annotations(this.tcx(), body, w)).$ === "Err") return r;
    if ((r = this.writer.write_mir_fn(body, w)).$ === "Err") return r;
    return this.writer.extra_data(PassWhere.AfterCFG, w);
  }

  /// Returns the path to the filename where we should dump a given MIR.
  /// Also used by other bits of code (e.g., NLL inference) that dump
  /// graphviz data or other things.
  // rustc: compiler/rustc_middle/src/mir/pretty.rs:202 dump_path
  dump_path(extension: string, body: Body): PathBuf {
    const tcx = this.tcx();
    const source = body.source;
    const promotion_id = source.promoted !== undefined ? `-${debug_Promoted(source.promoted, PLAIN)}` : "";

    let pass_num: string;
    if (tcx.sess.opts.unstable_opts.dump_mir_exclude_pass_number) {
      pass_num = "";
    } else if (this.show_pass_num) {
      const [dialect_index, phase_index] = MirPhase.index(body.phase);
      pass_num = `.${dialect_index}-${phase_index}-${String(body.pass_count).padStart(3, "0")}`;
    } else {
      pass_num = ".-------";
    }

    const crate_name = display_Symbol(tcx.crate_name(source.def_id().krate));
    const item_name = tcx.def_path(source.def_id()).to_filename_friendly_no_crate();
    // All drop shims have the same DefId, so we have to add the type
    // to get unique file names.
    // PORT: `s.extend(ty.to_string().chars().filter_map(..))` is `filename_friendly(..)`.
    const filename_friendly = (text: string): string => {
      let s = "";
      for (const c of text) {
        switch (c) {
          case " ":
            break;
          case ":":
          case "<":
          case ">":
            s += "_";
            break;
          default:
            s += c;
        }
      }
      return s;
    };
    let shim_disambiguator: string;
    const instance = source.instance;
    if (instance.$ === "Shim" && instance._0.$ === "DropGlue" && instance._0._1 !== undefined) {
      const ty = instance._0._1;
      // Unfortunately, pretty-printed types are not very filename-friendly.
      // We do some filtering.
      let s = ".";
      s += filename_friendly(display_Ty(ty));
      shim_disambiguator = s;
    } else if (instance.$ === "Shim" && instance._0.$ === "AsyncDropGlueCtor") {
      const ty = instance._0._1;
      let s = ".";
      s += filename_friendly(display_Ty(ty));
      shim_disambiguator = s;
    } else if (instance.$ === "Shim" && instance._0.$ === "AsyncDropGlue") {
      const ty_ = instance._0._1;
      const kind = ty_.kind();
      if (kind.$ !== "Coroutine") {
        return bug();
      }
      const args = kind._1;
      const ty = GenericArg.expect_ty(unwrap(args[0]));
      let s = ".";
      s += filename_friendly(display_Ty(ty));
      shim_disambiguator = s;
    } else if (instance.$ === "Shim" && instance._0.$ === "FutureDropPoll") {
      const proxy_cor = instance._0._1;
      const impl_cor = instance._0._2;
      let s = ".";
      s += filename_friendly(display_Ty(proxy_cor));
      s += ".";
      s += filename_friendly(display_Ty(impl_cor));
      shim_disambiguator = s;
    } else {
      shim_disambiguator = "";
    }

    let file_path: PathBuf = "";
    file_path = path_push(file_path, tcx.sess.opts.unstable_opts.dump_mir_dir);

    const pass_name = this.pass_name;
    const disambiguator = this.disambiguator;
    const file_name = `${crate_name}.${item_name}${shim_disambiguator}${promotion_id}${pass_num}.${pass_name}.${disambiguator}.${extension}`;

    file_path = path_push(file_path, file_name);

    return file_path;
  }

  /// Attempts to open a file where we should dump a given MIR or other
  /// bit of MIR-related data. Used by `mir-dump`, but also by other
  /// bits of code (e.g., NLL inference) that dump graphviz data or
  /// other things, and hence takes the extension as an argument.
  // rustc: compiler/rustc_middle/src/mir/pretty.rs:293 create_dump_file
  create_dump_file(extension: string, body: Body): IoResult<Write> {
    const file_path = this.dump_path(extension, body);
    const parent = path_parent(file_path);
    if (parent !== undefined) {
      try {
        // PORT: `fs::create_dir_all("")` is `Ok` (nothing to create); Node's `mkdirSync("")` fails.
        if (parent !== "") mkdirSync(parent, { recursive: true });
      } catch (e_) {
        const e = io_error_from_node(e_);
        return Err(io_error_new(e, `IO error creating MIR dump directory: ${debug_str(parent)}; ${display_io_error(e)}`));
      }
    }
    try {
      return Ok(new DumpFile(openSync(file_path, "w")));
    } catch (e_) {
      const e = io_error_from_node(e_);
      return Err(io_error_new(e, `IO error creating MIR dump file: ${debug_str(file_path)}; ${display_io_error(e)}`));
    }
  }
}

/** `PathBuf::push` (PORT: a `PathBuf` is a string; `/`-separated as on the unix hosts the MIR dumps are compared on). */
function path_push(base: PathBuf, p: string): PathBuf {
  if (p.startsWith("/") || base === "") return p;
  return base.endsWith("/") ? base + p : `${base}/${p}`;
}

/** `Path::parent` (`None` only for the root and the empty path). */
function path_parent(p: PathBuf): PathBuf | undefined {
  if (p === "" || p === "/") return undefined;
  const trimmed = p.endsWith("/") ? p.slice(0, -1) : p;
  const i = trimmed.lastIndexOf("/");
  if (i < 0) return "";
  return i === 0 ? "/" : trimmed.slice(0, i);
}

/** `io::Error::new(e.kind(), msg)` */
function io_error_new(e: IoError, msg: string): IoError {
  // PORT: `e.kind()` of an OS error is decoded lazily by std; the dump errors are ignored by `dump_mir`.
  const kind = e.$ === "Os" ? "Other" : e.kind;
  return { $: "Custom", kind, error: msg };
}

/** `Display` of an `io::Error` (the `{e}` of the dump errors). */
function display_io_error(e: IoError): string {
  return e.$ === "Os" ? e.code : e.$ === "Custom" ? e.error : e.message;
}

///////////////////////////////////////////////////////////////////////////
// Whole MIR bodies

/// Write out a human-readable textual representation of this crate's MIR,
/// with the default [`PrettyPrintMirOptions`].
// rustc: compiler/rustc_middle/src/mir/pretty.rs:318 write_mir_pretty
export function write_mir_pretty(tcx: TyCtxt, w: Write): IoResult<void> {
  let r: IoResult<void>;
  const writer = MirWriter.new(tcx);

  if ((r = w.write_fmt(["// WARNING: This output format is intended for human consumers only\n"])).$ === "Err") return r;
  if ((r = w.write_fmt(["// and is subject to change without notice. Knock yourself out.\n"])).$ === "Err") return r;
  if ((r = w.write_fmt(["// HINT: See also -Z dump-mir for MIR at specific points during compilation.\n"])).$ === "Err") return r;

  let first = true;
  for (const def_id of tcx.mir_keys(null)) {
    if (first) {
      first = false;
    } else {
      // Put empty lines between all items
      if ((r = w.write_fmt(["\n"])).$ === "Err") return r;
    }

    const render_body = (w: Write, body: Body): IoResult<void> => {
      let r: IoResult<void>;
      const extra_data = tcx.mir_pretty_extra_data(body) as ((pass_where: PassWhere, w: Write) => IoResult<void>) | undefined;
      if (extra_data !== undefined) {
        const writer = MirWriter.new(tcx);
        writer.extra_data = extra_data;
        if ((r = writer.write_mir_fn(body, w)).$ === "Err") return r;
      } else {
        if ((r = writer.write_mir_fn(body, w)).$ === "Err") return r;
      }

      for (const body of tcx.promoted_mir(def_id)) {
        if ((r = w.write_fmt(["\n"])).$ === "Err") return r;
        if ((r = writer.write_mir_fn(body, w)).$ === "Err") return r;
      }
      return Ok(undefined);
    };

    // For `const fn` we want to render both the optimized MIR and the MIR for ctfe.
    if (tcx.is_const_fn(def_id)) {
      // In case where comptime const fn, should only render the MIR for ctfe,
      // since comptime functions cannot have their MIR optimized
      const constness = tcx.constness(def_id) as Constness;
      if (constness.$ === "Const" && constness.always === true) {
        if ((r = render_body(w, tcx.mir_for_ctfe(def_id))).$ === "Err") return r;
      } else {
        if ((r = render_body(w, tcx.optimized_mir(def_id))).$ === "Err") return r;
        if ((r = w.write_fmt(["\n"])).$ === "Err") return r;
        if ((r = w.write_fmt(["// MIR FOR CTFE\n"])).$ === "Err") return r;
        // Do not use `render_body`, as that would render the promoteds again, but these
        // are shared between mir_for_ctfe and optimized_mir
        if ((r = writer.write_mir_fn(tcx.mir_for_ctfe(def_id), w)).$ === "Err") return r;
      }
    } else {
      const trivial = tcx.trivial_const(def_id);
      if (trivial !== undefined) {
        const [val, ty] = trivial;
        {
          // see notes on #41697 elsewhere
          const text = with_forced_impl_filename_line(() => `const ${tcx.def_path_str(def_id)}`);
          if ((r = w.write_fmt([text])).$ === "Err") return r;
        }
        if ((r = w.write_fmt([`: ${display_Ty(ty)} = const ${display_Const({ $: "Val", _0: val, _1: ty })};\n`])).$ === "Err") return r;
      } else {
        const instance_mir = tcx.instance_mir({ $: "Item", _0: LocalDefId.to_def_id(def_id) });
        if ((r = render_body(w, instance_mir)).$ === "Err") return r;
      }
    }
  }
  return Ok(undefined);
}

/// Does the writing of MIR to output, e.g. a file.
// rustc-type: compiler/rustc_middle/src/mir/pretty.rs:381 MirWriter
export class MirWriter {
  constructor(
    public tcx: TyCtxt,
    public extra_data: (pass_where: PassWhere, w: Write) => IoResult<void>,
    public options: PrettyPrintMirOptions,
  ) {}

  // rustc: compiler/rustc_middle/src/mir/pretty.rs:388 new
  static new(tcx: TyCtxt): MirWriter {
    return new MirWriter(tcx, (_0, _1) => Ok(undefined), PrettyPrintMirOptions.from_cli(tcx));
  }

  /// Write out a human-readable textual representation for the given function.
  // rustc: compiler/rustc_middle/src/mir/pretty.rs:393 write_mir_fn
  write_mir_fn(body: Body, w: Write): IoResult<void> {
    let r: IoResult<void>;
    if ((r = write_mir_intro(this.tcx, body, w, this.options)).$ === "Err") return r;
    const len = body.basic_blocks.deref().length;
    for (let i = 0; i < len; i++) {
      const block = BasicBlock.from_usize(i);
      if ((r = this.extra_data({ $: "BeforeBlock", _0: block }, w)).$ === "Err") return r;
      if ((r = this.write_basic_block(block, body, w)).$ === "Err") return r;
      if (BasicBlock.index(block) + 1 !== body.basic_blocks.deref().length) {
        if ((r = w.write_fmt(["\n"])).$ === "Err") return r;
      }
    }

    if ((r = w.write_fmt(["}\n"])).$ === "Err") return r;

    if ((r = write_allocations(this.tcx, body, w)).$ === "Err") return r;

    return Ok(undefined);
  }

  ///////////////////////////////////////////////////////////////////////////
  // Basic blocks and their parts (statements, terminators, ...)

  // (a later `impl MirWriter` block, PORTING §8)
  /// Write out a human-readable textual representation for the given basic block.
  // rustc: compiler/rustc_middle/src/mir/pretty.rs:783 write_basic_block
  write_basic_block(block: BasicBlock, body: Body, w: Write): IoResult<void> {
    let r: IoResult<void>;
    const data = body.index(block);

    // Basic block label at the top.
    const cleanup_text = data.is_cleanup ? " (cleanup)" : "";
    if ((r = w.write_fmt([`${INDENT}${debug_BasicBlock(block, PLAIN)}${cleanup_text}: {\n`])).$ === "Err") return r;

    // List of statements in the middle.
    const current_location = BasicBlock.start_location(block);
    for (const statement of data.statements) {
      if ((r = this.extra_data({ $: "BeforeLocation", _0: clone_Location(current_location) }, w)).$ === "Err") return r;

      for (const debuginfo of statement.debuginfos.deref()) {
        if ((r = w.write_fmt([`${INDENT}${INDENT}// DBG: ${debug_StmtDebugInfo(debuginfo, PLAIN)};\n`])).$ === "Err") return r;
      }

      const indented_body = `${INDENT}${INDENT}${debug_Statement(statement, PLAIN)};`;
      if (this.options.include_extra_comments) {
        if (
          (r = w.write_fmt([
            `${pad(indented_body, ALIGN)} // ${this.tcx.sess.verbose_internals() ? `${debug_Location(current_location, PLAIN)}: ` : ""}${comment(this.tcx, statement.source_info)}\n`,
          ])).$ === "Err"
        )
          return r;
      } else {
        if ((r = w.write_fmt([`${indented_body}\n`])).$ === "Err") return r;
      }

      {
        const location = clone_Location(current_location);
        if ((r = write_extra(this.tcx, w, (visitor) => visitor.visit_statement(statement, location), this.options)).$ === "Err") return r;
      }

      if ((r = this.extra_data({ $: "AfterLocation", _0: clone_Location(current_location) }, w)).$ === "Err") return r;

      current_location.statement_index += 1;
    }

    for (const debuginfo of data.after_last_stmt_debuginfos.deref()) {
      if ((r = w.write_fmt([`${INDENT}${INDENT}// DBG: ${debug_StmtDebugInfo(debuginfo, PLAIN)};\n`])).$ === "Err") return r;
    }

    // Terminator at the bottom.
    if ((r = this.extra_data({ $: "BeforeLocation", _0: clone_Location(current_location) }, w)).$ === "Err") return r;
    if (data.terminator !== undefined) {
      const indented_terminator = `${INDENT}${INDENT}${debug_TerminatorKind(data.terminator_().kind, PLAIN)};`;
      if (this.options.include_extra_comments) {
        if (
          (r = w.write_fmt([
            `${pad(indented_terminator, ALIGN)} // ${this.tcx.sess.verbose_internals() ? `${debug_Location(current_location, PLAIN)}: ` : ""}${comment(this.tcx, data.terminator_().source_info)}\n`,
          ])).$ === "Err"
        )
          return r;
      } else {
        if ((r = w.write_fmt([`${indented_terminator}\n`])).$ === "Err") return r;
      }

      {
        const location = clone_Location(current_location);
        if ((r = write_extra(this.tcx, w, (visitor) => visitor.visit_terminator(data.terminator_(), location), this.options)).$ === "Err") return r;
      }
    }

    if ((r = this.extra_data({ $: "AfterLocation", _0: clone_Location(current_location) }, w)).$ === "Err") return r;
    if ((r = this.extra_data({ $: "AfterTerminator", _0: block }, w)).$ === "Err") return r;

    return w.write_fmt([`${INDENT}}\n`]);
  }
}

/// Prints local variables in a scope tree.
// rustc: compiler/rustc_middle/src/mir/pretty.rs:412 write_scope_tree
export function write_scope_tree(tcx: TyCtxt, body: Body, scope_tree: Map<SourceScope, SourceScope[]>, w: Write, parent: SourceScope, depth: number, options: PrettyPrintMirOptions): IoResult<void> {
  let r: IoResult<void>;
  const indent = depth * utf8_len(INDENT);

  // Local variable debuginfo.
  for (const var_debug_info of body.var_debug_info) {
    if (var_debug_info.source_info.scope !== parent) {
      // Not declared in this scope.
      continue;
    }

    const indented_debug_info = `${pad(INDENT, indent)}debug ${debug_VarDebugInfo(var_debug_info, PLAIN)};`;

    if (options.include_extra_comments) {
      if ((r = w.write_fmt([`${pad(indented_debug_info, ALIGN)} // in ${comment(tcx, var_debug_info.source_info)}\n`])).$ === "Err") return r;
    } else {
      if ((r = w.write_fmt([`${indented_debug_info}\n`])).$ === "Err") return r;
    }
  }

  // Coroutine debuginfo.
  const layout = body.coroutine_layout_raw();
  if (layout !== undefined) {
    for (let i = 0; i < layout.field_tys.length; i++) {
      const field = CoroutineSavedLocal.from_usize(i);
      const field_decl = layout.field_tys[i]!;
      const source_info = field_decl.source_info;
      const name = field_decl.debuginfo_name;
      if (name !== undefined && source_info.scope === parent) {
        const indented_debug_info = `${pad(INDENT, indent)}coroutine debug ${display_Symbol(name)} => ${debug_CoroutineSavedLocal(field, PLAIN)};`;

        if (options.include_extra_comments) {
          if ((r = w.write_fmt([`${pad(indented_debug_info, ALIGN)} // in ${comment(tcx, source_info)}\n`])).$ === "Err") return r;
        } else {
          if ((r = w.write_fmt([`${indented_debug_info}\n`])).$ === "Err") return r;
        }
      }
    }
  }

  // Local variable types.
  for (let i = 0; i < body.local_decls.length; i++) {
    const local = Local.from_usize(i);
    const local_decl = body.local_decls[i]!;
    if (1 <= Local.index(local) && Local.index(local) < body.arg_count + 1) {
      // Skip over argument locals, they're printed in the signature.
      continue;
    }

    if (local_decl.source_info.scope !== parent) {
      // Not declared in this scope.
      continue;
    }

    const mut_str = Mutability.prefix_str(local_decl.mutability);

    let indented_decl = with_no_trimmed_paths(() => `${pad(INDENT, indent)}let ${mut_str}${debug_Local(local, PLAIN)}: ${display_Ty(local_decl.ty)}`);
    if (local_decl.user_ty !== undefined) {
      for (const user_ty of local_decl.user_ty.projections()) {
        indented_decl += ` as ${debug_UserTypeProjection(user_ty, PLAIN)}`;
      }
    }
    indented_decl += ";";

    const local_name = local === RETURN_PLACE ? " return place" : "";

    if (options.include_extra_comments) {
      if ((r = w.write_fmt([`${pad(indented_decl, ALIGN)} //${local_name} in ${comment(tcx, local_decl.source_info)}\n`])).$ === "Err") return r;
    } else {
      if ((r = w.write_fmt([`${indented_decl}\n`])).$ === "Err") return r;
    }
  }

  const children = scope_tree.get(parent);
  if (children === undefined) {
    return Ok(undefined);
  }

  for (const child of children) {
    const child_data = body.source_scopes[SourceScope.index(child)]!;
    assert_eq(child_data.parent_scope, parent as SourceScope | undefined, (v) => debug_option(v, PLAIN, SourceScope.debug));

    let special: string;
    let span: SourceInfo["span"] | undefined;
    if (child_data.inlined !== undefined) {
      const [callee, callsite_span] = child_data.inlined;
      special = ` (inlined ${InstanceKind.requires_caller_location(callee.def, tcx) ? "#[track_caller] " : ""}${display_Instance(callee)})`;
      span = callsite_span;
    } else {
      special = "";
      span = undefined;
    }

    const indented_header = `${pad("", indent)}scope ${SourceScope.index(child)}${special} {`;

    if (options.include_extra_comments) {
      if (span !== undefined) {
        if ((r = w.write_fmt([`${pad(indented_header, ALIGN)} // at ${tcx.sess.source_map().span_to_diagnostic_string(span)}\n`])).$ === "Err") return r;
      } else {
        if ((r = w.write_fmt([`${indented_header}\n`])).$ === "Err") return r;
      }
    } else {
      if ((r = w.write_fmt([`${indented_header}\n`])).$ === "Err") return r;
    }

    if ((r = write_scope_tree(tcx, body, scope_tree, w, child, depth + 1, options)).$ === "Err") return r;
    if ((r = w.write_fmt([`${pad("", depth * utf8_len(INDENT))}}\n`])).$ === "Err") return r;
  }

  return Ok(undefined);
}

// impl Debug for VarDebugInfo<'_>
// rustc: compiler/rustc_middle/src/mir/pretty.rs:558 fmt
export const debug_VarDebugInfo: Debug<VarDebugInfo> = (self, fmt) => {
  let out = "";
  if (self.composite !== undefined) {
    const { ty, projection } = self.composite;
    out += pre_fmt_projection(projection, fmt);
    out += `(${display_Symbol(self.name)}: ${display_Ty(ty)})`;
    out += post_fmt_projection(projection, fmt);
  } else {
    out += display_Symbol(self.name);
  }

  out += ` => ${debug_VarDebugInfoContents(self.value, fmt)}`;
  return out;
};

// rustc: compiler/rustc_middle/src/mir/pretty.rs:571 write_coroutine_layout
export function write_coroutine_layout(tcx: TyCtxt, layout: CoroutineLayout, w: Write, options: PrettyPrintMirOptions): IoResult<void> {
  let r: IoResult<void>;
  const { field_tys, variant_fields, variant_source_info, storage_conflicts } = layout;

  if ((r = w.write_fmt([`${INDENT}coroutine layout {\n`])).$ === "Err") return r;

  for (let i = 0; i < field_tys.length; i++) {
    const field = CoroutineSavedLocal.from_usize(i);
    const { ty, source_info, ignore_for_traits: ignore_for_traits_ } = field_tys[i]!;
    const ignore_for_traits = ignore_for_traits_ ? " (ignored for traits)" : "";
    const indented_body = `${INDENT}${INDENT}field ${debug_CoroutineSavedLocal(field, PLAIN)}: ${display_Ty(ty)}${ignore_for_traits};`;
    if (options.include_extra_comments) {
      if ((r = w.write_fmt([`${pad(indented_body, ALIGN)} // in ${comment(tcx, source_info)}\n`])).$ === "Err") return r;
    } else {
      if ((r = w.write_fmt([`${indented_body}\n`])).$ === "Err") return r;
    }
  }

  if ((r = w.write_fmt([`${INDENT}${INDENT}variant_fields = {\n`])).$ === "Err") return r;
  for (let i = 0; i < variant_fields.length; i++) {
    const variant = VariantIdx.from_usize(i);
    const fields = variant_fields[i]!;
    const variant_name = CoroutineArgsExt.variant_name(variant);
    const header = `${INDENT}${INDENT}${INDENT}${pad(variant_name, 9)}(${VariantIdx.debug(variant, PLAIN)}): ${debug_vec(fields, PLAIN, debug_CoroutineSavedLocal)},`;
    if (options.include_extra_comments) {
      const source_info = variant_source_info[i]!;
      if ((r = w.write_fmt([`${pad(header, ALIGN)} // in ${comment(tcx, source_info)}\n`])).$ === "Err") return r;
    } else {
      if ((r = w.write_fmt([`${header}\n`])).$ === "Err") return r;
    }
  }
  if ((r = w.write_fmt([`${INDENT}${INDENT}}\n`])).$ === "Err") return r;
  if ((r = w.write_fmt([`${INDENT}${INDENT}storage_conflicts = ${debug_BitMatrix(storage_conflicts as BitMatrix<number, number>, PLAIN)}\n`])).$ === "Err") return r;
  return w.write_fmt([`${INDENT}}\n`]);
}

/// Write out a human-readable textual representation of the MIR's `fn` type and the types of its
/// local variables (both user-defined bindings and compiler temporaries).
// rustc: compiler/rustc_middle/src/mir/pretty.rs:612 write_mir_intro
export function write_mir_intro(tcx: TyCtxt, body: Body, w: Write, options: PrettyPrintMirOptions): IoResult<void> {
  let r: IoResult<void>;
  if ((r = write_mir_sig(tcx, body, w)).$ === "Err") return r;
  if ((r = w.write_fmt(["{\n"])).$ === "Err") return r;

  const layout = body.coroutine_layout_raw();
  if (layout !== undefined) {
    if ((r = write_coroutine_layout(tcx, layout, w, options)).$ === "Err") return r;
  }

  // construct a scope tree and write it out
  const scope_tree: Map<SourceScope, SourceScope[]> = new Map();
  for (let i = 0; i < body.source_scopes.length; i++) {
    const index = SourceScope.from_usize(i);
    const scope_data = body.source_scopes[i]!;
    const parent = scope_data.parent_scope;
    if (parent !== undefined) {
      let v = scope_tree.get(parent);
      if (v === undefined) scope_tree.set(parent, (v = []));
      v.push(index);
    } else {
      // Only the argument scope has no parent, because it's the root.
      assert_eq(index, OUTERMOST_SOURCE_SCOPE, (v) => SourceScope.debug(v, PLAIN));
    }
  }

  if ((r = write_scope_tree(tcx, body, scope_tree, w, OUTERMOST_SOURCE_SCOPE, 1, options)).$ === "Err") return r;

  // Add an empty line before the first block is printed.
  if ((r = w.write_fmt(["\n"])).$ === "Err") return r;

  if (body.coverage_early_info !== undefined) {
    if ((r = write_coverage_early_info(body.coverage_early_info, w)).$ === "Err") return r;
  }
  if (body.coverage_mir_info !== undefined) {
    if ((r = write_coverage_mir_info(body.coverage_mir_info, w)).$ === "Err") return r;
  }

  return Ok(undefined);
}

// rustc: compiler/rustc_middle/src/mir/pretty.rs:651 write_coverage_early_info
export function write_coverage_early_info(early_info: CoverageEarlyInfo, w: Write): IoResult<void> {
  let r: IoResult<void>;
  const { branch_spans } = early_info;

  // Only add an extra trailing newline if we printed at least one thing.
  let did_print = false;

  for (const { span, true_marker, false_marker } of branch_spans) {
    if (
      (r = w.write_fmt([
        `${INDENT}coverage branch { true: ${debug_BlockMarkerId(true_marker, PLAIN)}, false: ${debug_BlockMarkerId(false_marker, PLAIN)} } => ${debug_Span(span, PLAIN)}\n`,
      ])).$ === "Err"
    )
      return r;
    did_print = true;
  }

  if (did_print) {
    if ((r = w.write_fmt(["\n"])).$ === "Err") return r;
  }

  return Ok(undefined);
}

// rustc: compiler/rustc_middle/src/mir/pretty.rs:675 write_coverage_mir_info
export function write_coverage_mir_info(mir_info: CoverageMirInfo, w: Write): IoResult<void> {
  let r: IoResult<void>;
  const { mappings } = mir_info;

  for (const { kind, span } of mappings) {
    if ((r = w.write_fmt([`${INDENT}coverage ${debug_MappingKind(kind, PLAIN)} => ${debug_Span(span, PLAIN)};\n`])).$ === "Err") return r;
  }
  if ((r = w.write_fmt(["\n"])).$ === "Err") return r;

  return Ok(undefined);
}

// rustc: compiler/rustc_middle/src/mir/pretty.rs:689 write_mir_sig
export function write_mir_sig(tcx: TyCtxt, body: Body, w: Write): IoResult<void> {
  let r: IoResult<void>;
  // use rustc_hir::def::DefKind;

  // trace!("write_mir_sig: {:?}", body.source.instance);
  const def_id = body.source.def_id();
  const kind = tcx.def_kind(def_id);
  let is_function: boolean;
  switch (kind.$) {
    case "Fn":
    case "AssocFn":
    case "Ctor":
    case "SyntheticCoroutineBody":
      is_function = true;
      break;
    default:
      is_function = tcx.is_closure_like(def_id);
  }
  if (body.source.promoted !== undefined) {
    // promoteds are the closest to consts
    if ((r = w.write_fmt(["const "])).$ === "Err") return r;
  } else if (kind.$ === "Const" || kind.$ === "AssocConst") {
    if ((r = w.write_fmt(["const "])).$ === "Err") return r;
  } else if (kind.$ === "Static" && kind.mutability === "Not" && kind.nested === false) {
    if ((r = w.write_fmt(["static "])).$ === "Err") return r;
  } else if (kind.$ === "Static" && kind.mutability === "Mut" && kind.nested === false) {
    if ((r = w.write_fmt(["static mut "])).$ === "Err") return r;
  } else if (is_function) {
    if ((r = w.write_fmt(["fn "])).$ === "Err") return r;
  } else if (kind.$ === "AnonConst") {
    // anon consts are not an item and have no sig
  } else if (kind.$ === "GlobalAsm") {
    // `global_asm!` have fake bodies, which we may dump after mir-build
  } else {
    return bug(`Unexpected def kind ${debug_DefKind(kind, PLAIN)}`);
  }

  {
    // see notes on #41697 elsewhere
    const text = with_forced_impl_filename_line(() => tcx.def_path_str(def_id));
    if ((r = w.write_fmt([text])).$ === "Err") return r;
  }
  const p = body.source.promoted;
  if (p !== undefined) {
    if ((r = w.write_fmt([`::${debug_Promoted(p, PLAIN)}`])).$ === "Err") return r;
  }

  if (body.source.promoted === undefined && is_function) {
    if ((r = w.write_fmt(["("])).$ === "Err") return r;

    // fn argument types.
    let i = 0;
    for (const arg of body.args_iter()) {
      if (i !== 0) {
        if ((r = w.write_fmt([", "])).$ === "Err") return r;
      }
      if ((r = w.write_fmt([`${debug_Place(Place_from_Local(arg), PLAIN)}: ${display_Ty(body.local_decls[Local.index(arg)]!.ty)}`])).$ === "Err") return r;
      i++;
    }

    if ((r = w.write_fmt([`) -> ${display_Ty(body.return_ty())}`])).$ === "Err") return r;
  } else {
    assert_eq(body.arg_count, 0, (v) => String(v));
    if ((r = w.write_fmt([`: ${display_Ty(body.return_ty())} =`])).$ === "Err") return r;
  }

  const yield_ty = body.yield_ty();
  if (yield_ty !== undefined) {
    if ((r = w.write_fmt(["\n"])).$ === "Err") return r;
    if ((r = w.write_fmt([`yields ${display_Ty(yield_ty)}\n`])).$ === "Err") return r;
  }

  if ((r = w.write_fmt([" "])).$ === "Err") return r;
  // Next thing that gets printed is the opening {

  return Ok(undefined);
}

// rustc: compiler/rustc_middle/src/mir/pretty.rs:754 write_user_type_annotations
export function write_user_type_annotations(tcx: TyCtxt, body: Body, w: Write): IoResult<void> {
  let r: IoResult<void>;
  if (body.user_type_annotations.length !== 0) {
    if ((r = w.write_fmt(["| User Type Annotations\n"])).$ === "Err") return r;
  }
  for (let index = 0; index < body.user_type_annotations.length; index++) {
    const annotation = body.user_type_annotations[index]!;
    if (
      (r = w.write_fmt([
        `| ${index}: user_ty: ${display_Canonical(annotation.user_ty, display_UserType)}, span: ${tcx.sess.source_map().span_to_diagnostic_string(annotation.span)}, inferred_ty: ${with_no_trimmed_paths(() => display_Ty(annotation.inferred_ty))}\n`,
      ])).$ === "Err"
    )
      return r;
  }
  if (body.user_type_annotations.length !== 0) {
    if ((r = w.write_fmt(["|\n"])).$ === "Err") return r;
  }
  return Ok(undefined);
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:875 fmt (lane mir-body-b)
export const debug_StatementKind: Debug<StatementKind> = (self, fmt) => {
  return unported("rustc_middle::mir::pretty::<StatementKind as Debug>::fmt");
};


// stub: compiler/rustc_middle/src/mir/pretty.rs:906 fmt (lane mir-body-b)
export const debug_Statement: Debug<Statement> = (self, fmt) => {
  return unported("rustc_middle::mir::pretty::<Statement as Debug>::fmt");
};


// stub: compiler/rustc_middle/src/mir/pretty.rs:912 fmt (lane mir-body-b)
export const debug_StmtDebugInfo: Debug<StmtDebugInfo> = (self, fmt) => {
  return unported("rustc_middle::mir::pretty::<StmtDebugInfo as Debug>::fmt");
};


// stub: compiler/rustc_middle/src/mir/pretty.rs:925 fmt (lane mir-body-b)
export function display_NonDivergingIntrinsic(self: NonDivergingIntrinsic): string {
  return unported("rustc_middle::mir::pretty::<NonDivergingIntrinsic as Display>::fmt");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:936 fmt (lane mir-body-b)
export const debug_TerminatorKind: Debug<TerminatorKind> = (self, fmt) => {
  return unported("rustc_middle::mir::pretty::<TerminatorKind as Debug>::fmt");
};


// stub: compiler/rustc_middle/src/mir/pretty.rs:982 fmt (lane mir-body-b)
export const debug_Terminator: Debug<Terminator> = (self, fmt) => {
  return unported("rustc_middle::mir::pretty::<Terminator as Debug>::fmt");
};


// stub: compiler/rustc_middle/src/mir/pretty.rs:991 fmt_head (lane mir-body-b)
TerminatorKind.fmt_head = function (self: TerminatorKind, fmt: FmtWrite): FmtResult {
  return unported("rustc_middle::mir::pretty::TerminatorKind::fmt_head");
};


// stub: compiler/rustc_middle/src/mir/pretty.rs:1090 fmt_successor_labels (lane mir-body-b)
TerminatorKind.fmt_successor_labels = function (self: TerminatorKind): string[] {
  return unported("rustc_middle::mir::pretty::TerminatorKind::fmt_successor_labels");
};


// stub: compiler/rustc_middle/src/mir/pretty.rs:1149 fmt (lane mir-body-b)
export const debug_Rvalue: Debug<Rvalue> = (self, fmt) => {
  return unported("rustc_middle::mir::pretty::<Rvalue as Debug>::fmt");
};


// stub: compiler/rustc_middle/src/mir/pretty.rs:1320 fmt (lane mir-body-b)
export const debug_Operand: Debug<Operand> = (self, fmt) => {
  return unported("rustc_middle::mir::pretty::<Operand as Debug>::fmt");
};


// stub: compiler/rustc_middle/src/mir/pretty.rs:1332 fmt (lane mir-body-b)
export const debug_ConstOperand: Debug<ConstOperand> = (self, fmt) => {
  return unported("rustc_middle::mir::pretty::<ConstOperand as Debug>::fmt");
};


// stub: compiler/rustc_middle/src/mir/pretty.rs:1338 fmt (lane mir-body-b)
export function display_ConstOperand(self: ConstOperand): string {
  return unported("rustc_middle::mir::pretty::<ConstOperand as Display>::fmt");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:1348 fmt (lane mir-body-b)
export const debug_Place: Debug<Place> = (self, fmt) => {
  return unported("rustc_middle::mir::pretty::<Place as Debug>::fmt");
};


// stub: compiler/rustc_middle/src/mir/pretty.rs:1354 fmt (lane mir-body-b)
export const debug_PlaceRef: Debug<PlaceRef> = (self, fmt) => {
  return unported("rustc_middle::mir::pretty::<PlaceRef as Debug>::fmt");
};


// stub: compiler/rustc_middle/src/mir/pretty.rs:1361 pre_fmt_projection (lane mir-body-b)
export function pre_fmt_projection(projection: readonly PlaceElem[], fmt: Fmt): string {
  return unported("rustc_middle::mir::pretty::pre_fmt_projection");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:1387 post_fmt_projection (lane mir-body-b)
export function post_fmt_projection(projection: readonly PlaceElem[], fmt: Fmt): string {
  return unported("rustc_middle::mir::pretty::post_fmt_projection");
}



/// After we print the main statement, we sometimes dump extra
/// information. There's often a lot of little things "nuzzled up" in
/// a statement.
// rustc: compiler/rustc_middle/src/mir/pretty.rs:1438 write_extra
export function write_extra(tcx: TyCtxt, write: Write, visit_op: (extra_comments: ExtraComments) => void, options: PrettyPrintMirOptions): IoResult<void> {
  let r: IoResult<void>;
  if (options.include_extra_comments) {
    const extra_comments = new ExtraComments(tcx, []);
    visit_op(extra_comments);
    for (const comment of extra_comments.comments) {
      if ((r = write.write_fmt([`${pad("", ALIGN)} // ${comment}\n`])).$ === "Err") return r;
    }
  }
  return Ok(undefined);
}

// rustc-type: compiler/rustc_middle/src/mir/pretty.rs:1454 ExtraComments
export class ExtraComments extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public comments: string[],
  ) {
    super();
  }

  // rustc: compiler/rustc_middle/src/mir/pretty.rs:1460 push
  push(lines: string): void {
    for (const line of lines.split("\n")) {
      this.comments.push(line);
    }
  }

  // impl<'tcx> Visitor<'tcx> for ExtraComments<'tcx> (a later impl block, PORTING §8)
  // rustc: compiler/rustc_middle/src/mir/pretty.rs:1480 visit_const_operand
  override visit_const_operand(constant: ConstOperand, _location: Location): void {
    const { span, user_ty, const_ } = constant;
    if (use_verbose(Const.ty(const_), true)) {
      this.push("mir::ConstOperand");
      this.push(`+ span: ${this.tcx.sess.source_map().span_to_diagnostic_string(span)}`);
      if (user_ty !== undefined) {
        this.push(`+ user_ty: ${debug_UserTypeAnnotationIndex(user_ty, PLAIN)}`);
      }

      // PORT: `rustc_data_structures::make_display(..)` formatted once by `format!`: the text.
      const fmt_val = (val: ConstValue, ty: Ty): string => {
        const tcx = this.tcx;
        return pretty_print_const_value_tcx(tcx, val, ty, PLAIN);
      };

      const fmt_valtree = (cv: Value): string => {
        const p = FmtPrinter.new(this.tcx, Namespace.ValueNS);
        unwrap_result(p.pretty_print_const_valtree(cv, /*print_ty*/ true), () => "Error");
        return p.into_buffer();
      };

      let val: string;
      switch (const_.$) {
        case "Ty": {
          const ct = const_._1;
          const kind = ct.kind();
          switch (kind.$) {
            case "Param":
              val = `ty::Param(${display_ParamConst(kind._0)})`;
              break;
            case "Alias": {
              const alias_const = kind._1;
              let kind_: string;
              switch (alias_const.kind.$) {
                case "Projection":
                case "InherentSelf":
                case "InherentImpl":
                case "Free":
                case "Anon":
                  kind_ = this.tcx.def_path_str(alias_const.kind.def_id);
                  break;
              }
              val = `ty::AliasConst(${kind_}, ${debug_GenericArgs(alias_const.args, PLAIN)})`;
              break;
            }
            case "Value": {
              const cv = kind._0;
              val = `ty::Valtree(${fmt_valtree(cv)})`;
              break;
            }
            // No `ty::` prefix since we also use this to represent errors from `mir::Unevaluated`.
            case "Error":
              val = "Error";
              break;
            // These variants shouldn't exist in the MIR.
            case "Placeholder":
            case "Infer":
            case "Expr":
            case "Bound":
              return bug(`unexpected MIR constant: ${debug_Const(const_, PLAIN)}`);
          }
          break;
        }
        case "Unevaluated": {
          const uv = const_._0;
          val = `Unevaluated(${this.tcx.def_path_str(uv.def)}, ${debug_GenericArgs(uv.args, PLAIN)}, ${debug_option(uv.promoted, PLAIN, debug_Promoted)})`;
          break;
        }
        case "Val":
          val = `Value(${fmt_val(const_._0, const_._1)})`;
          break;
      }

      // This reflects what `Const` looked liked before `val` was renamed
      // as `kind`. We print it like this to avoid having to update
      // expected output in a lot of tests.
      this.push(`+ const_: Const { ty: ${display_Ty(Const.ty(const_))}, val: ${val} }`);
    }
  }

  // rustc: compiler/rustc_middle/src/mir/pretty.rs:1547 visit_rvalue
  override visit_rvalue(rvalue: Rvalue, location: Location): void {
    this.super_rvalue(rvalue, location);
    if (rvalue.$ === "Aggregate") {
      const kind = rvalue._0;
      if (kind.$ === "Closure") {
        const def_id = kind._0;
        const args = kind._1;
        this.push("closure");
        this.push(`+ def_id: ${debug_DefId(def_id, PLAIN)}`);
        this.push(`+ args: ${format_debug(args, debug_GenericArgs, PRETTY)}`);
      } else if (kind.$ === "Coroutine") {
        const def_id = kind._0;
        const args = kind._1;
        this.push("coroutine");
        this.push(`+ def_id: ${debug_DefId(def_id, PLAIN)}`);
        this.push(`+ args: ${format_debug(args, debug_GenericArgs, PRETTY)}`);
        this.push(`+ kind: ${debug_option(this.tcx.coroutine_kind(def_id) as CoroutineKind | undefined, PLAIN, debug_CoroutineKind)}`);
      } else if (kind.$ === "Adt" && kind._3 !== undefined) {
        const user_ty = kind._3;
        this.push("adt");
        this.push(`+ user_ty: ${debug_UserTypeAnnotationIndex(user_ty, PLAIN)}`);
      } else {
        // _ => {}
      }
    }
  }
}

// rustc: compiler/rustc_middle/src/mir/pretty.rs:1467 use_verbose
export function use_verbose(ty: Ty, fn_def: boolean): boolean {
  const kind = ty.kind();
  switch (kind.$) {
    case "Int":
    case "Uint":
    case "Bool":
    case "Char":
    case "Float":
      return false;
    // Unit type
    case "Tuple":
      if (kind._0.length === 0) return false;
      return kind._0.some((g_arg) => use_verbose(g_arg, fn_def));
    case "Array":
      return use_verbose(kind._0, fn_def);
    case "FnDef":
      return fn_def;
    default:
      return true;
  }
}

// rustc: compiler/rustc_middle/src/mir/pretty.rs:1575 comment
export function comment(tcx: TyCtxt, { span, scope }: SourceInfo): string {
  const location = tcx.sess.source_map().span_to_diagnostic_string(span);
  return `scope ${SourceScope.index(scope)} at ${location}`;
}

///////////////////////////////////////////////////////////////////////////
// Allocations

/// Find all `AllocId`s mentioned (recursively) in the MIR body and print their corresponding
/// allocations.
// rustc: compiler/rustc_middle/src/mir/pretty.rs:1585 write_allocations
export function write_allocations(tcx: TyCtxt, body: Body, w: Write): IoResult<void> {
  let r: IoResult<void>;
  // rustc: compiler/rustc_middle/src/mir/pretty.rs:1590 alloc_ids_from_alloc
  function alloc_ids_from_alloc(alloc: ConstAllocation): AllocId[] {
    return alloc
      .inner()
      .provenance_()
      .ptrs_()
      .values()
      .map((p) => CtfeProvenance.alloc_id(p));
  }

  // rustc: compiler/rustc_middle/src/mir/pretty.rs:1596 alloc_id_from_const_val
  function alloc_id_from_const_val(val: ConstValue): AllocId | undefined {
    switch (val.$) {
      case "Scalar":
        if (val._0.$ === "Ptr") return CtfeProvenance.alloc_id(val._0._0.provenance);
        return undefined;
      case "ZeroSized":
        return undefined;
      case "Slice":
      case "Indirect":
        // FIXME: we don't actually want to print all of these, since some are printed nicely directly as values inline in MIR.
        // Really we'd want `pretty_print_const_value` to decide which allocations to print, instead of having a separate visitor.
        return val.alloc_id;
    }
  }
  /** `struct CollectAllocIds(BTreeSet<AllocId>)` (PORT: the `BTreeSet` is a `Set`, sorted where it is iterated). */
  class CollectAllocIds extends Visitor {
    constructor(public _0: Set<AllocId>) {
      super();
    }

    // impl<'tcx> Visitor<'tcx> for CollectAllocIds
    // rustc: compiler/rustc_middle/src/mir/pretty.rs:1611 visit_const_operand
    override visit_const_operand(c: ConstOperand, _1: Location): void {
      switch (c.const_.$) {
        case "Ty":
        case "Unevaluated":
          break;
        case "Val": {
          const val = c.const_._0;
          const id = alloc_id_from_const_val(val);
          if (id !== undefined) {
            this._0.add(id);
          }
          break;
        }
      }
    }
  }

  const visitor = new CollectAllocIds(new Set());
  visitor.visit_body(body);

  // `seen` contains all seen allocations, including the ones we have *not* printed yet.
  // The protocol is to first `insert` into `seen`, and only if that returns `true`
  // then push to `todo`.
  const seen = visitor._0;
  const todo: AllocId[] = [...seen].sort((a, b) => a - b);
  for (let id = todo.pop(); id !== undefined; id = todo.pop()) {
    const write_allocation_track_relocs = (w: Write, alloc: ConstAllocation): IoResult<void> => {
      // `.rev()` because we are popping them from the back of the `todo` vector.
      for (const id of alloc_ids_from_alloc(alloc).reverse()) {
        if (!seen.has(id)) {
          seen.add(id);
          todo.push(id);
        }
      }
      return w.write_fmt([display_RenderAllocation(display_allocation(tcx, alloc.inner()))]);
    };
    if ((r = w.write_fmt([`\n${debug_AllocId(id, PLAIN)}`])).$ === "Err") return r;
    const global_alloc = tcx.try_get_global_alloc(id);
    if (global_alloc === undefined) {
      // This can't really happen unless there are bugs, but it doesn't cost us anything to
      // gracefully handle it and allow buggy rustc to be debugged via allocation printing.
      if ((r = w.write_fmt([" (deallocated)"])).$ === "Err") return r;
    } else if (global_alloc.$ === "Function") {
      if ((r = w.write_fmt([` (fn: ${display_Instance(global_alloc.instance)})`])).$ === "Err") return r;
    } else if (global_alloc.$ === "VTable") {
      const ty = global_alloc._0;
      const dyn_ty = global_alloc._1;
      if ((r = w.write_fmt([` (vtable: impl ${display_List_PolyExistentialPredicate(dyn_ty)} for ${display_Ty(ty)})`])).$ === "Err") return r;
    } else if (global_alloc.$ === "TypeId") {
      if ((r = w.write_fmt([` (typeid for ${display_Ty(global_alloc.ty)})`])).$ === "Err") return r;
    } else if (global_alloc.$ === "Static" && !tcx.is_foreign_item(global_alloc._0)) {
      const did = global_alloc._0;
      if ((r = w.write_fmt([` (static: ${tcx.def_path_str(did)}`])).$ === "Err") return r;
      if (
        MirPhase_le(body.phase, { $: "Runtime", _0: "PostCleanup" }) &&
        ((def_id) => def_id !== undefined && tcx.hir_body_const_context(def_id) !== undefined)(body.source.def_id().as_local())
      ) {
        // Statics may be cyclic and evaluating them too early
        // in the MIR pipeline may cause cycle errors even though
        // normal compilation is fine.
        if ((r = w.write_fmt([")"])).$ === "Err") return r;
      } else {
        const init = tcx.eval_static_initializer(did);
        if (init.$ === "Ok") {
          const alloc = init._0;
          if ((r = w.write_fmt([", "])).$ === "Err") return r;
          if ((r = write_allocation_track_relocs(w, alloc)).$ === "Err") return r;
        } else {
          if ((r = w.write_fmt([", error during initializer evaluation)"])).$ === "Err") return r;
        }
      }
    } else if (global_alloc.$ === "Static") {
      const did = global_alloc._0;
      if ((r = w.write_fmt([` (extern static: ${tcx.def_path_str(did)})`])).$ === "Err") return r;
    } else if (global_alloc.$ === "Memory") {
      const alloc = global_alloc._0;
      if ((r = w.write_fmt([" ("])).$ === "Err") return r;
      if ((r = write_allocation_track_relocs(w, alloc)).$ === "Err") return r;
    }
    if ((r = w.write_fmt(["\n"])).$ === "Err") return r;
  }
  return Ok(undefined);
}

/// Dumps the size and metadata and content of an allocation to the given writer.
/// The expectation is that the caller first prints other relevant metadata, so the exact
/// format of this function is (*without* leading or trailing newline):
///
/// ```text
/// size: {}, align: {}) {
///     <bytes>
/// }
/// ```
///
/// The byte format is similar to how hex editors print bytes. Each line starts with the address of
/// the start of the line, followed by all bytes in hex format (space separated).
/// If the allocation is small enough to fit into a single line, no start address is given.
/// After the hex dump, an ascii dump follows, replacing all unprintable characters (control
/// characters or characters whose value is larger than 127) with a `.`
/// This also prints provenance adequately.
// rustc: compiler/rustc_middle/src/mir/pretty.rs:1704 display_allocation
export function display_allocation<Prov, Extra, Bytes>(tcx: TyCtxt, alloc: Allocation<Prov, Extra, Bytes>): RenderAllocation<Prov, Extra, Bytes> {
  return { tcx, alloc };
}

// impl<'a, 'tcx, Prov: Provenance, Extra, Bytes: AllocBytes> std::fmt::Display for RenderAllocation<'a, 'tcx, Prov, Extra, Bytes>
// rustc: compiler/rustc_middle/src/mir/pretty.rs:1720 fmt
export function display_RenderAllocation<Prov, Extra, Bytes>(self: RenderAllocation<Prov, Extra, Bytes>): string {
  const w = new StringWrite();
  const { tcx, alloc } = self;
  w.write_str(`size: ${alloc.size().bytes()}, align: ${alloc.align.bytes()})`);
  if (alloc.size().raw === Size.ZERO.raw) {
    // We are done.
    w.write_str(" {}");
    return w.buf;
  }
  if (tcx.sess.opts.unstable_opts.dump_mir_exclude_alloc_bytes) {
    w.write_str(" { .. }");
    return w.buf;
  }
  // Write allocation bytes.
  w.write_str(" {\n");
  if (write_allocation_bytes(tcx, alloc, w, "    ").$ === "Err") return fmt_error_in_format();
  w.write_str("}");
  return w.buf;
}

// rustc: compiler/rustc_middle/src/mir/pretty.rs:1738 write_allocation_endline
export function write_allocation_endline(w: FmtWrite, ascii: string): FmtResult {
  let r: FmtResult;
  for (let _ = 0; _ < BYTES_PER_LINE - char_count(ascii); _++) {
    if ((r = w.write_str("   ")).$ === "Err") return r;
  }
  return w.write_str(` │ ${ascii}\n`);
}

/// Number of bytes to print per allocation hex dump line.
const BYTES_PER_LINE = 16;

/// Prints the line start address and returns the new line start address.
// rustc: compiler/rustc_middle/src/mir/pretty.rs:1749 write_allocation_newline
export function write_allocation_newline(w: FmtWrite, line_start: Size, ascii: string, pos_width: number, prefix: string): Result<Size, FmtError> {
  let r: FmtResult;
  if ((r = write_allocation_endline(w, ascii)).$ === "Err") return r;
  line_start = line_start.add(Size.from_bytes(BYTES_PER_LINE));
  if ((r = w.write_str(`${prefix}0x${hex_pad(line_start.bytes(), pos_width)} │ `)).$ === "Err") return r;
  return Ok(line_start);
}

/// The `prefix` argument allows callers to add an arbitrary prefix before each line (even if there
/// is only one line). Note that your prefix should contain a trailing space as the lines are
/// printed directly after it.
// rustc: compiler/rustc_middle/src/mir/pretty.rs:1765 write_allocation_bytes
export function write_allocation_bytes<Prov, Extra, Bytes>(tcx: TyCtxt, alloc: Allocation<Prov, Extra, Bytes>, w: FmtWrite, prefix: string): FmtResult {
  let r: FmtResult;
  const num_lines = Math.max(alloc.size().bytes_usize() - BYTES_PER_LINE, 0);
  // Number of chars needed to represent all line numbers.
  const pos_width = hex_number_length(alloc.size().bytes());

  if (num_lines > 0) {
    if ((r = w.write_str(`${prefix}0x${hex_pad(0, pos_width)} │ `)).$ === "Err") return r;
  } else {
    if ((r = w.write_str(prefix)).$ === "Err") return r;
  }

  let i = Size.ZERO;
  let line_start = Size.ZERO;

  const ptr_size = tcx.data_layout().pointer_size();

  let ascii = "";

  const oversized_ptr = (target: string, width: number): string => {
    if (utf8_len(target) > width) {
      target += ` (${ptr_size.bytes()} ptr bytes)`;
    }
    return target;
  };

  while (i.raw < alloc.size().raw) {
    // The line start already has a space. While we could remove that space from the line start
    // printing and unconditionally print a space here, that would cause the single-line case
    // to have a single space before it, which looks weird.
    if (i.raw !== line_start.raw) {
      if ((r = w.write_str(" ")).$ === "Err") return r;
    }
    const prov = alloc.provenance_().get_ptr(i);
    let frag: PointerFrag<Prov> | undefined;
    if (prov !== undefined) {
      // Memory with provenance must be defined
      assert(alloc.init_mask_().is_range_initialized(alloc_range(i, ptr_size)).$ === "Ok", "assertion failed: alloc.init_mask().is_range_initialized(alloc_range(i, ptr_size)).is_ok()");
      const j = i.bytes_usize();
      const offset_bytes = alloc.inspect_with_uninit_and_ptr_outside_interpreter({ start: j, end: j + ptr_size.bytes_usize() });
      const offset_ = unwrap_result(read_target_uint(tcx.data_layout().endian, offset_bytes), debug_IoError);
      const offset = Size.from_bytes(offset_);
      const provenance_width = (bytes: number): number => bytes * 3;
      const ptr = Pointer.new(prov, offset);
      let target = debug_Pointer(ptr, PLAIN, debug_prov);
      if (utf8_len(target) > provenance_width(ptr_size.bytes_usize() - 1)) {
        // This is too long, try to save some space.
        target = format_debug(ptr, (v, f) => debug_Pointer(v, f, debug_prov), PRETTY);
      }
      if (i.sub(line_start).add(ptr_size).bytes_usize() > BYTES_PER_LINE) {
        // This branch handles the situation where a provenance starts in the current line
        // but ends in the next one.
        const remainder = Size.from_bytes(BYTES_PER_LINE).sub(i.sub(line_start));
        const overflow = ptr_size.sub(remainder);
        const remainder_width = provenance_width(remainder.bytes_usize()) - 2;
        const overflow_width = provenance_width(overflow.bytes_usize() - 1) + 1;
        ascii += "╾"; // HEAVY LEFT AND LIGHT RIGHT
        for (let _ = 1; _ < remainder.bytes(); _++) {
          ascii += "─"; // LIGHT HORIZONTAL
        }
        if (overflow_width > remainder_width && overflow_width >= utf8_len(target)) {
          // The case where the provenance fits into the part in the next line
          if ((r = w.write_str(`╾${center("", "─", remainder_width)}`)).$ === "Err") return r;
          const nl = write_allocation_newline(w, line_start, ascii, pos_width, prefix);
          if (nl.$ === "Err") return nl;
          line_start = nl._0;
          ascii = "";
          if ((r = w.write_str(`${center(target, "─", overflow_width)}╼`)).$ === "Err") return r;
        } else {
          target = oversized_ptr(target, remainder_width);
          if ((r = w.write_str(`╾${center(target, "─", remainder_width)}`)).$ === "Err") return r;
          const nl = write_allocation_newline(w, line_start, ascii, pos_width, prefix);
          if (nl.$ === "Err") return nl;
          line_start = nl._0;
          if ((r = w.write_str(`${center("", "─", overflow_width)}╼`)).$ === "Err") return r;
          ascii = "";
        }
        for (let _ = 0; _ < overflow.bytes() - 1; _++) {
          ascii += "─";
        }
        ascii += "╼"; // LIGHT LEFT AND HEAVY RIGHT
        i = i.add(ptr_size);
        continue;
      } else {
        // This branch handles a provenance that starts and ends in the current line.
        const provenance_width_ = provenance_width(ptr_size.bytes_usize() - 1);
        target = oversized_ptr(target, provenance_width_);
        ascii += "╾";
        if ((r = w.write_str(`╾${center(target, "─", provenance_width_)}╼`)).$ === "Err") return r;
        for (let _ = 0; _ < ptr_size.bytes() - 2; _++) {
          ascii += "─";
        }
        ascii += "╼";
        i = i.add(ptr_size);
      }
    } else if ((frag = alloc.provenance_().get_byte(i, tcx)) !== undefined) {
      // Memory with provenance must be defined
      assert(
        alloc.init_mask_().is_range_initialized(alloc_range(i, Size.from_bytes(1))).$ === "Ok",
        "assertion failed: alloc.init_mask().is_range_initialized(alloc_range(i, Size::from_bytes(1))).is_ok()",
      );
      ascii += "━"; // HEAVY HORIZONTAL
      // We have two characters to display this, which is obviously not enough.
      // Format is similar to "oversized" above.
      const j = i.bytes_usize();
      const c = alloc.inspect_with_uninit_and_ptr_outside_interpreter({ start: j, end: j + 1 })[0]!;
      // FIXME: Find a way to print `frag.offset` that does not look terrible...
      if ((r = w.write_str(`╾${hex_pad(c, 2)}${format_debug(frag.prov, debug_prov, PRETTY)} (ptr fragment ${frag.idx})╼`)).$ === "Err") return r;
      i = i.add(Size.from_bytes(1));
    } else if (alloc.init_mask_().is_range_initialized(alloc_range(i, Size.from_bytes(1))).$ === "Ok") {
      const j = i.bytes_usize();

      // Checked definedness (and thus range) and provenance. This access also doesn't
      // influence interpreter execution but is only for debugging.
      const c = alloc.inspect_with_uninit_and_ptr_outside_interpreter({ start: j, end: j + 1 })[0]!;
      if ((r = w.write_str(hex_pad(c, 2))).$ === "Err") return r;
      if (is_ascii_control(c) || c >= 0x80) {
        ascii += ".";
      } else {
        ascii += String.fromCharCode(c);
      }
      i = i.add(Size.from_bytes(1));
    } else {
      if ((r = w.write_str("__")).$ === "Err") return r;
      ascii += "░";
      i = i.add(Size.from_bytes(1));
    }
    // Print a new line header if the next line still has some bytes to print.
    if (i.raw === line_start.add(Size.from_bytes(BYTES_PER_LINE)).raw && i.raw !== alloc.size().raw) {
      const nl = write_allocation_newline(w, line_start, ascii, pos_width, prefix);
      if (nl.$ === "Err") return nl;
      line_start = nl._0;
      ascii = "";
    }
  }
  if ((r = write_allocation_endline(w, ascii)).$ === "Err") return r;

  return Ok(undefined);
}

/** `u8::is_ascii_control` */
function is_ascii_control(c: number): boolean {
  return c < 0x20 || c === 0x7f;
}

///////////////////////////////////////////////////////////////////////////
// Constants

// rustc: compiler/rustc_middle/src/mir/pretty.rs:1909 pretty_print_byte_str
export function pretty_print_byte_str(fmt: Fmt, byte_str: ArrayLike<number>): string {
  void fmt;
  return `b"${escape_ascii(byte_str)}"`;
}

/** PORT: `<[u8]>::escape_ascii`'s Display (core `ascii::escape_default` per byte), not in src/std yet (as ty/print/pretty.ts). */
function escape_ascii(bytes: ArrayLike<number>): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    switch (b) {
      case 0x09:
        s += "\\t";
        break;
      case 0x0d:
        s += "\\r";
        break;
      case 0x0a:
        s += "\\n";
        break;
      case 0x5c:
        s += "\\\\";
        break;
      case 0x27:
        s += "\\'";
        break;
      case 0x22:
        s += '\\"';
        break;
      default:
        if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b);
        else s += "\\x" + b.toString(16).padStart(2, "0");
    }
  }
  return s;
}

/** PORT: `String::from_utf8_lossy` (WHATWG decoding replaces maximal invalid subparts with U+FFFD, as std does). */
function String_from_utf8_lossy(bytes: ArrayLike<number>): string {
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(Uint8Array.from(bytes));
}

// rustc: compiler/rustc_middle/src/mir/pretty.rs:1913 comma_sep
export function comma_sep(tcx: TyCtxt, fmt: Fmt, elems: readonly [ConstValue, Ty][]): string {
  let out = "";
  let first = true;
  for (const [ct, ty] of elems) {
    if (!first) {
      out += ", ";
    }
    out += pretty_print_const_value_tcx(tcx, ct, ty, fmt);
    first = false;
  }
  return out;
}

// PORT: a `PrintError` of the printer (`?` into `fmt::Error`) ends the enclosing `format!` (std panics), as
// ty/print/pretty.ts's `pretty_print_const`.
// rustc: compiler/rustc_middle/src/mir/pretty.rs:1929 pretty_print_const_value_tcx
export function pretty_print_const_value_tcx(tcx: TyCtxt, ct: ConstValue, ty: Ty, fmt: Fmt): string {
  // use crate::ty::print::PrettyPrinter;

  if (tcx.sess.verbose_internals()) {
    return `ConstValue(${debug_ConstValue(ct, PLAIN)}: ${display_Ty(ty)})`;
  }

  // Printing [MaybeUninit<u8>::uninit(); N] or any other aggregate where all fields are uninit
  // becomes very verbose. This special case makes the dump terse and clear.
  if (ConstValue.all_bytes_uninit(ct, tcx)) {
    return "<uninit>";
  }

  const u8_type = tcx.types.u8;
  const kind = ty.kind();
  // Byte/string slices, printed as (byte) string literals.
  if (kind.$ === "Ref" && kind._1.kind().$ === "Str") {
    const data = ConstValue.try_get_slice_bytes_for_diagnostics(ct, tcx);
    if (data !== undefined) {
      return debug_str(String_from_utf8_lossy(data));
    }
  } else if (kind.$ === "Ref" && slice_of(kind._1) === u8_type) {
    const data = ConstValue.try_get_slice_bytes_for_diagnostics(ct, tcx);
    if (data !== undefined) {
      return pretty_print_byte_str(fmt, data);
    }
  } else if (ct.$ === "Indirect" && kind.$ === "Array" && kind._0 === u8_type) {
    const { alloc_id, offset } = ct;
    const n = unwrap(kind._1.try_to_target_usize(tcx));
    const alloc = GlobalAlloc.unwrap_memory(tcx.global_alloc(alloc_id));
    // cast is ok because we already checked for pointer size (32 or 64 bit) above
    const range = new AllocRange(offset, Size.from_bytes(n));
    const byte_str = unwrap_result(alloc.inner().get_bytes_strip_provenance(tcx, range), debug_AllocError);
    let out = "*";
    out += pretty_print_byte_str(fmt, byte_str);
    return out;
  }
  // Aggregates, printed as array/tuple/struct/variant construction syntax.
  //
  // NB: the `has_non_region_param` check ensures that we can use
  // the `try_destructure_mir_constant_for_user_output ` query with
  // an empty `TypingEnv::fully_monomorphized` without
  // introducing ICEs (e.g. via `layout_of`) from missing bounds.
  // E.g. `transmute([0usize; 2]): (u8, *mut T)` needs to know `T: Sized`
  // to be able to destructure the tuple into `(0u8, *mut T)`
  else if ((kind.$ === "Array" || kind.$ === "Tuple" || kind.$ === "Adt") && !TypeVisitableExt.has_non_region_param(ty, fold_Ty)) {
    const contents = tcx.try_destructure_mir_constant_for_user_output(ct, ty) as DestructuredConstant | undefined;
    if (contents !== undefined) {
      const fields: [ConstValue, Ty][] = contents.fields.slice() as [ConstValue, Ty][];
      let out = "";
      const k = ty.kind();
      if (k.$ === "Array") {
        out += "[";
        out += comma_sep(tcx, fmt, fields);
        out += "]";
      } else if (k.$ === "Tuple") {
        out += "(";
        out += comma_sep(tcx, fmt, fields);
        if (contents.fields.length === 1) {
          out += ",";
        }
        out += ")";
      } else if (k.$ === "Adt" && k._0.variants().length === 0) {
        out += `{unreachable(): ${display_Ty(ty)}}`;
      } else if (k.$ === "Adt") {
        const def = k._0;
        const args = k._1;
        const variant_idx = expect(contents.variant, "destructed mir constant of adt without variant idx");
        const variant_def = def.variant(variant_idx);
        const p = FmtPrinter.new(tcx, Namespace.ValueNS);
        p._0.print_alloc_ids = true;
        if (p.pretty_print_value_path(variant_def.def_id, args).$ === "Err") return fmt_error_in_format();
        out += p.into_buffer();

        switch (variant_def.ctor_kind()) {
          case "Const":
            break;
          case "Fn":
            out += "(";
            out += comma_sep(tcx, fmt, fields);
            out += ")";
            break;
          case undefined: {
            // PORT: `write_str` does not format: upstream writes the braces doubled.
            out += " {{ ";
            let first = true;
            const n = Math.min(variant_def.fields.length, fields.length);
            for (let i = 0; i < n; i++) {
              const field_def = variant_def.fields[i]!;
              const [ct, ty] = fields[i]!;
              if (!first) {
                out += ", ";
              }
              out += `${display_Symbol(field_def.name)}: `;
              out += pretty_print_const_value_tcx(tcx, ct, ty, fmt);
              first = false;
            }
            out += " }}";
            break;
          }
        }
      } else {
        return unreachable();
      }
      return out;
    }
  } else if (ct.$ === "Scalar") {
    const scalar = ct._0;
    const p = FmtPrinter.new(tcx, Namespace.ValueNS);
    p._0.print_alloc_ids = true;
    // PORT: ty/print/pretty.ts still declares `Scalar` as ty/decls.ts's `Pending` stand-in (its owner's follow-up).
    if (p.pretty_print_const_scalar(scalar as unknown as ty_Scalar, ty).$ === "Err") return fmt_error_in_format();
    return p.into_buffer();
  } else if (ct.$ === "ZeroSized" && kind.$ === "FnDef") {
    const d = kind._0;
    const s = kind._1;
    const p = FmtPrinter.new(tcx, Namespace.ValueNS);
    p._0.print_alloc_ids = true;
    if (p.pretty_print_value_path(d, unwrap(Binder.no_bound_vars(s, fold_GenericArgs))).$ === "Err") return fmt_error_in_format();
    return p.into_buffer();
  }
  // FIXME(oli-obk): also pretty print arrays and other aggregate constants by reading
  // their fields instead of just dumping the memory.
  // _ => {}
  // Fall back to debug pretty printing for invalid constants.
  return `${debug_ConstValue(ct, PLAIN)}: ${display_Ty(ty)}`;
}

/** `if let ty::Slice(t) = inner_ty.kind()`: `t`, else `undefined`. */
function slice_of(inner_ty: Ty): Ty | undefined {
  const k = inner_ty.kind();
  return k.$ === "Slice" ? k._0 : undefined;
}

/** `Option::expect` */
function expect<T>(v: T | undefined, msg: string): T {
  if (v === undefined) return panic(msg);
  return v;
}

// rustc: compiler/rustc_middle/src/mir/pretty.rs:2065 pretty_print_const_value
export function pretty_print_const_value(ct: ConstValue, ty: Ty, fmt: Fmt): string {
  return with_((tcx) => {
    // let ty = tcx.lift(ty); (PORT: `Lift` is the identity, one interner)
    return pretty_print_const_value_tcx(tcx, ct, ty, fmt);
  });
}

///////////////////////////////////////////////////////////////////////////
// Miscellaneous

/// Calc converted u64 decimal into hex and return its length in chars.
///
/// ```ignore (cannot-test-private-function)
/// assert_eq!(1, hex_number_length(0));
/// assert_eq!(1, hex_number_length(1));
/// assert_eq!(2, hex_number_length(16));
/// ```
// rustc: compiler/rustc_middle/src/mir/pretty.rs:2086 hex_number_length
export function hex_number_length(x: number): number {
  if (x === 0) {
    return 1;
  }
  let length = 0;
  let x_left = x;
  while (x_left > 0) {
    x_left = Math.floor(x_left / 16);
    length += 1;
  }
  return length;
}
