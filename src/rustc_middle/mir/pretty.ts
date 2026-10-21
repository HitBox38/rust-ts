// Port of compiler/rustc_middle/src/mir/pretty.rs (lane mir-contract, plan-m4 D3 / D11). `PassWhere`,
// `PrettyPrintMirOptions` and `RenderAllocation` are generated (pretty.gen.ts, set rustc_middle_mir); `MirDumper`,
// `MirWriter` and `ExtraComments` (a `Visitor`) are hand classes below. Every fn is a stub: lines :874..:1437 (the
// manual `Debug` / `Display` impls of the statement / terminator / operand / place types, `fmt_head`,
// `fmt_successor_labels`, `pre_fmt_projection`, `post_fmt_projection`) for lane mir-body-b, the rest for lane mir-pretty.
// docs/handoff/mir-contract.md has the conventions ("How to fill a stub").
//
// PORT: `&mut dyn io::Write` is vendor/anstream's `Write` (the `std::io::Write` port) and `io::Result<T>` src/std's
// `IoResult<T>`; `&mut dyn fmt::Write` / `W: fmt::Write` is its `FmtWrite` and `fmt::Result` `FmtResult`; a
// `&mut Formatter` parameter that is only written to is the Debug convention: the fn returns the written text.
// PORT (init order): this module extends visit.ts's `Visitor` at load and is not re-exported by mir/mod.ts (mod.rs's
// `pub use self::pretty::{MirDumper, PassWhere, display_allocation, write_mir_pretty}`): import it as
// `rustc_middle/mir/pretty.ts`. The `debug_X` of the statement / terminator / operand / place types that mod.ts,
// syntax.ts, statement.ts and terminator.ts export forward here lazily.
import "./mod.ts";
import type { Size } from "../../rustc_abi/lib.ts";
import type { PathBuf } from "../../rustc_error_messages/lib.ts";
import type { Debug, Fmt } from "../../std/fmt.ts";
import type { IoResult } from "../../std/io.ts";
import { unported } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import type { FmtError, FmtResult, FmtWrite, Write } from "../../vendor/anstream/stream.ts";
import type { TyCtxt } from "../ty/context.ts";
import type { Ty } from "../ty/decls.ts";
import type { ConstValue } from "./consts.ts";
import type { CoverageEarlyInfo, CoverageMirInfo } from "./coverage.ts";
import type { AllocId, Allocation, ConstAllocation } from "./interpret/mod.ts";
import type { BasicBlock, Body, Location, SourceInfo, SourceScope, VarDebugInfo } from "./mod.ts";
import { PrettyPrintMirOptions, type PassWhere, type RenderAllocation } from "./pretty.gen.ts";
import type { CoroutineLayout } from "./query.ts";
import type { PlaceRef, Statement, StmtDebugInfo } from "./statement.ts";
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
import type { Terminator } from "./terminator.ts";
import { Visitor } from "./visit.ts";
export * from "./pretty.gen.ts";

const INDENT = "    ";
/// Alignment for lining up comments following MIR statements
export const ALIGN = 40;
/// Number of bytes to print per allocation hex dump line.
const BYTES_PER_LINE = 16;

declare module "./pretty.gen.ts" {
  namespace PrettyPrintMirOptions {
    // pretty.rs:60 (lane mir-pretty)
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

// stub: compiler/rustc_middle/src/mir/pretty.rs:60 from_cli (lane mir-pretty)
(PrettyPrintMirOptions as unknown as { from_cli: typeof PrettyPrintMirOptions.from_cli }).from_cli = function (tcx: TyCtxt): PrettyPrintMirOptions {
  return unported("rustc_middle::mir::pretty::PrettyPrintMirOptions::from_cli");
};


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

  // stub: compiler/rustc_middle/src/mir/pretty.rs:82 new (lane mir-pretty)
  static new(tcx: TyCtxt, pass_name: string, body: Body): MirDumper | undefined {
    return unported("rustc_middle::mir::pretty::MirDumper::new");
  }


  // stub: compiler/rustc_middle/src/mir/pretty.rs:108 tcx (lane mir-pretty)
  tcx(): TyCtxt {
    return unported("rustc_middle::mir::pretty::MirDumper::tcx");
  }


  // stub: compiler/rustc_middle/src/mir/pretty.rs:113 set_show_pass_num (lane mir-pretty)
  set_show_pass_num(): MirDumper {
    return unported("rustc_middle::mir::pretty::MirDumper::set_show_pass_num");
  }


  // stub: compiler/rustc_middle/src/mir/pretty.rs:119 set_disambiguator (lane mir-pretty)
  set_disambiguator(disambiguator: string): MirDumper {
    return unported("rustc_middle::mir::pretty::MirDumper::set_disambiguator");
  }


  // stub: compiler/rustc_middle/src/mir/pretty.rs:125 set_extra_data (lane mir-pretty)
  set_extra_data(extra_data: (pass_where: PassWhere, w: Write) => IoResult<void>): MirDumper {
    return unported("rustc_middle::mir::pretty::MirDumper::set_extra_data");
  }


  // stub: compiler/rustc_middle/src/mir/pretty.rs:134 set_options (lane mir-pretty)
  set_options(options: PrettyPrintMirOptions): MirDumper {
    return unported("rustc_middle::mir::pretty::MirDumper::set_options");
  }


  // stub: compiler/rustc_middle/src/mir/pretty.rs:163 dump_mir (lane mir-pretty)
  dump_mir(body: Body): void {
    return unported("rustc_middle::mir::pretty::MirDumper::dump_mir");
  }


  // stub: compiler/rustc_middle/src/mir/pretty.rs:179 dump_mir_to_writer (lane mir-pretty)
  dump_mir_to_writer(body: Body, w: Write): IoResult<void> {
    return unported("rustc_middle::mir::pretty::MirDumper::dump_mir_to_writer");
  }


  // stub: compiler/rustc_middle/src/mir/pretty.rs:202 dump_path (lane mir-pretty)
  dump_path(extension: string, body: Body): PathBuf {
    return unported("rustc_middle::mir::pretty::MirDumper::dump_path");
  }


  // stub: compiler/rustc_middle/src/mir/pretty.rs:293 create_dump_file (lane mir-pretty)
  create_dump_file(extension: string, body: Body): IoResult<Write> {
    return unported("rustc_middle::mir::pretty::MirDumper::create_dump_file");
  }
}

// stub: compiler/rustc_middle/src/mir/pretty.rs:318 write_mir_pretty (lane mir-pretty)
export function write_mir_pretty(tcx: TyCtxt, w: Write): IoResult<void> {
  return unported("rustc_middle::mir::pretty::write_mir_pretty");
}


/// Does the writing of MIR to output, e.g. a file.
// rustc-type: compiler/rustc_middle/src/mir/pretty.rs:381 MirWriter
export class MirWriter {
  constructor(
    public tcx: TyCtxt,
    public extra_data: (pass_where: PassWhere, w: Write) => IoResult<void>,
    public options: PrettyPrintMirOptions,
  ) {}

  // stub: compiler/rustc_middle/src/mir/pretty.rs:388 new (lane mir-pretty)
  static new(tcx: TyCtxt): MirWriter {
    return unported("rustc_middle::mir::pretty::MirWriter::new");
  }


  // stub: compiler/rustc_middle/src/mir/pretty.rs:393 write_mir_fn (lane mir-pretty)
  write_mir_fn(body: Body, w: Write): IoResult<void> {
    return unported("rustc_middle::mir::pretty::MirWriter::write_mir_fn");
  }


  // (a later `impl MirWriter` block, PORTING §8)
  // stub: compiler/rustc_middle/src/mir/pretty.rs:783 write_basic_block (lane mir-pretty)
  write_basic_block(block: BasicBlock, body: Body, w: Write): IoResult<void> {
    return unported("rustc_middle::mir::pretty::MirWriter::write_basic_block");
  }
}

// stub: compiler/rustc_middle/src/mir/pretty.rs:412 write_scope_tree (lane mir-pretty)
export function write_scope_tree(tcx: TyCtxt, body: Body, scope_tree: Map<SourceScope, SourceScope[]>, w: Write, parent: SourceScope, depth: number, options: PrettyPrintMirOptions): IoResult<void> {
  return unported("rustc_middle::mir::pretty::write_scope_tree");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:558 fmt (lane mir-pretty)
export const debug_VarDebugInfo: Debug<VarDebugInfo> = (self, fmt) => {
  return unported("rustc_middle::mir::pretty::<VarDebugInfo as Debug>::fmt");
};


// stub: compiler/rustc_middle/src/mir/pretty.rs:571 write_coroutine_layout (lane mir-pretty)
export function write_coroutine_layout(tcx: TyCtxt, layout: CoroutineLayout, w: Write, options: PrettyPrintMirOptions): IoResult<void> {
  return unported("rustc_middle::mir::pretty::write_coroutine_layout");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:612 write_mir_intro (lane mir-pretty)
export function write_mir_intro(tcx: TyCtxt, body: Body, w: Write, options: PrettyPrintMirOptions): IoResult<void> {
  return unported("rustc_middle::mir::pretty::write_mir_intro");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:651 write_coverage_early_info (lane mir-pretty)
export function write_coverage_early_info(early_info: CoverageEarlyInfo, w: Write): IoResult<void> {
  return unported("rustc_middle::mir::pretty::write_coverage_early_info");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:675 write_coverage_mir_info (lane mir-pretty)
export function write_coverage_mir_info(mir_info: CoverageMirInfo, w: Write): IoResult<void> {
  return unported("rustc_middle::mir::pretty::write_coverage_mir_info");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:689 write_mir_sig (lane mir-pretty)
export function write_mir_sig(tcx: TyCtxt, body: Body, w: Write): IoResult<void> {
  return unported("rustc_middle::mir::pretty::write_mir_sig");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:754 write_user_type_annotations (lane mir-pretty)
export function write_user_type_annotations(tcx: TyCtxt, body: Body, w: Write): IoResult<void> {
  return unported("rustc_middle::mir::pretty::write_user_type_annotations");
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


// stub: compiler/rustc_middle/src/mir/pretty.rs:1438 write_extra (lane mir-pretty)
export function write_extra(tcx: TyCtxt, write: Write, visit_op: (extra_comments: ExtraComments) => void, options: PrettyPrintMirOptions): IoResult<void> {
  return unported("rustc_middle::mir::pretty::write_extra");
}


// rustc-type: compiler/rustc_middle/src/mir/pretty.rs:1454 ExtraComments
export class ExtraComments extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public comments: string[],
  ) {
    super();
  }

  // stub: compiler/rustc_middle/src/mir/pretty.rs:1460 push (lane mir-pretty)
  push(lines: string): void {
    return unported("rustc_middle::mir::pretty::ExtraComments::push");
  }


  // impl<'tcx> Visitor<'tcx> for ExtraComments<'tcx> (a later impl block, PORTING §8)
  // stub: compiler/rustc_middle/src/mir/pretty.rs:1480 visit_const_operand (lane mir-pretty)
  override visit_const_operand(constant: ConstOperand, _location: Location): void {
    return unported("rustc_middle::mir::pretty::<ExtraComments as Visitor>::visit_const_operand");
  }


  // stub: compiler/rustc_middle/src/mir/pretty.rs:1547 visit_rvalue (lane mir-pretty)
  override visit_rvalue(rvalue: Rvalue, location: Location): void {
    return unported("rustc_middle::mir::pretty::<ExtraComments as Visitor>::visit_rvalue");
  }
}

// stub: compiler/rustc_middle/src/mir/pretty.rs:1467 use_verbose (lane mir-pretty)
export function use_verbose(ty: Ty, fn_def: boolean): boolean {
  return unported("rustc_middle::mir::pretty::use_verbose");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:1575 comment (lane mir-pretty)
export function comment(tcx: TyCtxt, source_info: SourceInfo): string {
  return unported("rustc_middle::mir::pretty::comment");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:1585 write_allocations (lane mir-pretty)
export function write_allocations(tcx: TyCtxt, body: Body, w: Write): IoResult<void> {
  return unported("rustc_middle::mir::pretty::write_allocations");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:1590 alloc_ids_from_alloc (lane mir-pretty)
// PORT: nested fn of fn write_allocations; a module-level stub until its lane ports it inside the parent.
function alloc_ids_from_alloc(alloc: ConstAllocation): readonly AllocId[] {
  return unported("rustc_middle::mir::pretty::alloc_ids_from_alloc");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:1596 alloc_id_from_const_val (lane mir-pretty)
// PORT: nested fn of fn write_allocations; a module-level stub until its lane ports it inside the parent.
function alloc_id_from_const_val(val: ConstValue): AllocId | undefined {
  return unported("rustc_middle::mir::pretty::alloc_id_from_const_val");
}


/** `struct CollectAllocIds(BTreeSet<AllocId>)` (nested in `write_allocations`; PORT: the `BTreeSet` is a sorted array). */
class CollectAllocIds extends Visitor {
  constructor(public _0: AllocId[]) {
    super();
  }
}
// stub: compiler/rustc_middle/src/mir/pretty.rs:1611 visit_const_operand (lane mir-pretty)
// PORT: nested fn of fn write_allocations > impl<'tcx> Visitor<'tcx> for CollectAllocIds; a module-level stub until its lane ports it inside the parent.
function CollectAllocIds_visit_const_operand(self: CollectAllocIds, c: ConstOperand, _1: Location): void {
  return unported("rustc_middle::mir::pretty::visit_const_operand");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:1704 display_allocation (lane mir-pretty)
export function display_allocation<Prov, Extra, Bytes>(tcx: TyCtxt, alloc: Allocation<Prov, Extra, Bytes>): RenderAllocation<Prov, Extra, Bytes> {
  return unported("rustc_middle::mir::pretty::display_allocation");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:1720 fmt (lane mir-pretty)
export function display_RenderAllocation<Prov, Extra, Bytes>(self: RenderAllocation<Prov, Extra, Bytes>): string {
  return unported("rustc_middle::mir::pretty::<RenderAllocation as Display>::fmt");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:1738 write_allocation_endline (lane mir-pretty)
export function write_allocation_endline(w: FmtWrite, ascii: string): FmtResult {
  return unported("rustc_middle::mir::pretty::write_allocation_endline");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:1749 write_allocation_newline (lane mir-pretty)
export function write_allocation_newline(w: FmtWrite, line_start: Size, ascii: string, pos_width: number, prefix: string): Result<Size, FmtError> {
  return unported("rustc_middle::mir::pretty::write_allocation_newline");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:1765 write_allocation_bytes (lane mir-pretty)
export function write_allocation_bytes<Prov, Extra, Bytes>(tcx: TyCtxt, alloc: Allocation<Prov, Extra, Bytes>, w: FmtWrite, prefix: string): FmtResult {
  return unported("rustc_middle::mir::pretty::write_allocation_bytes");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:1909 pretty_print_byte_str (lane mir-pretty)
export function pretty_print_byte_str(fmt: Fmt, byte_str: readonly number[]): string {
  return unported("rustc_middle::mir::pretty::pretty_print_byte_str");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:1913 comma_sep (lane mir-pretty)
export function comma_sep(tcx: TyCtxt, fmt: Fmt, elems: readonly [ConstValue, Ty][]): string {
  return unported("rustc_middle::mir::pretty::comma_sep");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:1929 pretty_print_const_value_tcx (lane mir-pretty)
export function pretty_print_const_value_tcx(tcx: TyCtxt, ct: ConstValue, ty: Ty, fmt: Fmt): string {
  return unported("rustc_middle::mir::pretty::pretty_print_const_value_tcx");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:2065 pretty_print_const_value (lane mir-pretty)
export function pretty_print_const_value(ct: ConstValue, ty: Ty, fmt: Fmt): string {
  return unported("rustc_middle::mir::pretty::pretty_print_const_value");
}


// stub: compiler/rustc_middle/src/mir/pretty.rs:2086 hex_number_length (lane mir-pretty)
export function hex_number_length(x: number): number {
  return unported("rustc_middle::mir::pretty::hex_number_length");
}
