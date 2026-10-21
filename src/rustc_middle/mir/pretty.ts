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
import { VariantIdx, type Size } from "../../rustc_abi/lib.ts";
import { InlineAsmTemplatePiece, debug_InlineAsmOptions } from "../../rustc_ast/lib.ts";
import { Mutability } from "../../rustc_ast_ir/lib.ts";
import type { PathBuf } from "../../rustc_error_messages/lib.ts";
import { Namespace } from "../../rustc_hir/def.ts";
import { debug_DefId } from "../../rustc_span/def_id.ts";
import { debug_Span } from "../../rustc_span/lib.ts";
import { display_Symbol, Symbol } from "../../rustc_span/symbol.ts";
import { InlineAsmRegOrRegClass } from "../../rustc_target/asm/mod.ts";
import { display_Region } from "../../rustc_type_ir/ir_print.ts";
import { debug_Variance } from "../../rustc_type_ir/lib.ts";
import { type Debug, debug_int, debug_struct, debug_tuple, debug_vec, type Fmt, format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import type { IoResult } from "../../std/io.ts";
import { assert_eq, panic, unported, unreachable, unwrap } from "../../std/panic.ts";
import { Ok, type Result } from "../../std/result.ts";
import type { FmtError, FmtResult, FmtWrite, Write } from "../../vendor/anstream/stream.ts";
import type { AdtDef } from "../ty/adt.ts";
import { with_ } from "../ty/context/tls.ts";
import type { TyCtxt } from "../ty/context.ts";
import type { Ty } from "../ty/decls.ts";
import { debug_Ty } from "../ty/mod.ts";
import { display_Ty, FmtPrinter, pretty_print_const, with_no_trimmed_paths } from "../ty/print/pretty.ts";
import { type ConstValue, display_Const } from "./consts.ts";
import { type CoverageEarlyInfo, type CoverageMirInfo, debug_CoverageKind } from "./coverage.ts";
import type { AllocId, Allocation, ConstAllocation } from "./interpret/mod.ts";
import { type BasicBlock, type Body, debug_BasicBlock, debug_Local, debug_UserTypeProjection, type Location, type SourceInfo, type SourceScope, type VarDebugInfo } from "./mod.ts";
import { PrettyPrintMirOptions, type PassWhere, type RenderAllocation } from "./pretty.gen.ts";
import type { CoroutineLayout } from "./query.ts";
import type { PlaceRef, Statement, StmtDebugInfo } from "./statement.ts";
import {
  AssertKind,
  type ConstOperand,
  debug_BinOp,
  debug_CastKind,
  debug_FakeReadCause,
  debug_RuntimeChecks,
  debug_UnOp,
  InlineAsmMacro,
  type NonDivergingIntrinsic,
  type Operand,
  type Place,
  type PlaceElem,
  RawPtrKind,
  type Rvalue,
  type StatementKind,
  TerminatorKind,
  UnwindTerminateReason,
  WithRetag,
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


// impl Debug for StatementKind<'_>
// PORT: `write!(fmt, "..{x:?}..")` formats `x` with a fresh `Formatter` (no flags): the nested Debug calls get `PLAIN`.
// rustc: compiler/rustc_middle/src/mir/pretty.rs:875 fmt
export const debug_StatementKind: Debug<StatementKind> = (self, fmt) => {
  void fmt;
  switch (self.$) {
    case "Assign": {
      const [place, rv] = self._0;
      return `${debug_Place(place, PLAIN)} = ${debug_Rvalue(rv, PLAIN)}`;
    }
    case "FakeRead": {
      const [cause, place] = self._0;
      return `FakeRead(${debug_FakeReadCause(cause, PLAIN)}, ${debug_Place(place, PLAIN)})`;
    }
    case "StorageLive":
      return `StorageLive(${debug_Local(self._0, PLAIN)})`;
    case "StorageDead":
      return `StorageDead(${debug_Local(self._0, PLAIN)})`;
    case "SetDiscriminant": {
      const { place, variant_index } = self;
      return `discriminant(${debug_Place(place, PLAIN)}) = ${VariantIdx.debug(variant_index, PLAIN)}`;
    }
    case "PlaceMention":
      return `PlaceMention(${debug_Place(self._0, PLAIN)})`;
    case "AscribeUserType": {
      const [[place, c_ty], variance] = [self._0, self._1];
      return `AscribeUserType(${debug_Place(place, PLAIN)}, ${debug_Variance(variance, PLAIN)}, ${debug_UserTypeProjection(c_ty, PLAIN)})`;
    }
    case "Coverage":
      return `Coverage::${debug_CoverageKind(self._0, PLAIN)}`;
    case "Intrinsic":
      return `${display_NonDivergingIntrinsic(self._0)}`;
    case "ConstEvalCounter":
      return `ConstEvalCounter`;
    case "Nop":
      return `nop`;
    case "BackwardIncompatibleDropHint": {
      const place = self.place;
      // For now, we don't record the reason because there is only one use case,
      // which is to report breaking change in drop order by Edition 2024
      return `BackwardIncompatibleDropHint(${debug_Place(place, PLAIN)})`;
    }
  }
};

// impl Debug for Statement<'_>
// rustc: compiler/rustc_middle/src/mir/pretty.rs:906 fmt
export const debug_Statement: Debug<Statement> = (self, fmt) => {
  return debug_StatementKind(self.kind, fmt);
};

// impl Debug for StmtDebugInfo<'_>
// rustc: compiler/rustc_middle/src/mir/pretty.rs:912 fmt
export const debug_StmtDebugInfo: Debug<StmtDebugInfo> = (self, fmt) => {
  void fmt;
  switch (self.$) {
    case "AssignRef": {
      const [local, place] = [self._0, self._1];
      return `${debug_Local(local, PLAIN)} = &${debug_Place(place, PLAIN)}`;
    }
    case "InvalidAssign": {
      const local = self._0;
      return `${debug_Local(local, PLAIN)} = &?`;
    }
  }
};

// impl Display for NonDivergingIntrinsic<'_>
// rustc: compiler/rustc_middle/src/mir/pretty.rs:925 fmt
export function display_NonDivergingIntrinsic(self: NonDivergingIntrinsic): string {
  switch (self.$) {
    case "Assume":
      return `assume(${debug_Operand(self._0, PLAIN)})`;
    case "CopyNonOverlapping": {
      const { src, dst, count } = self._0;
      return `copy_nonoverlapping(dst = ${debug_Operand(dst, PLAIN)}, src = ${debug_Operand(src, PLAIN)}, count = ${debug_Operand(count, PLAIN)})`;
    }
  }
}

// impl<'tcx> Debug for TerminatorKind<'tcx>
// rustc: compiler/rustc_middle/src/mir/pretty.rs:936 fmt
export const debug_TerminatorKind: Debug<TerminatorKind> = (self, fmt) => {
  void fmt;
  const out = new StringFmtWrite();
  fmt_ok(TerminatorKind.fmt_head(self, out));
  const successor_count = TerminatorKind.successors(self).len();
  const labels = TerminatorKind.fmt_successor_labels(self);
  assert_eq(successor_count, labels.length, (n) => debug_int(n, PLAIN));

  // `Cleanup` is already included in successors
  const unwind = TerminatorKind.unwind(self);
  const show_unwind = !(unwind === undefined || unwind.$ === "Cleanup");
  const fmt_unwind = (): string => {
    let s = `unwind `;
    const u = TerminatorKind.unwind(self);
    // Not needed or included in successors
    if (u === undefined || u.$ === "Cleanup") return unreachable();
    switch (u.$) {
      case "Continue":
        s += `continue`;
        break;
      case "Unreachable":
        s += `unreachable`;
        break;
      case "Terminate": {
        const reason = u._0;
        s += `terminate(${UnwindTerminateReason.as_short_str(reason)})`;
        break;
      }
    }
    return s;
  };

  let s = out.buf;
  if (successor_count === 0 && !show_unwind) {
  } else if (successor_count === 0 && show_unwind) {
    s += ` -> `;
    s += fmt_unwind();
  } else if (successor_count === 1 && !show_unwind) {
    s += ` -> ${debug_BasicBlock(unwrap(TerminatorKind.successors(self).next().value), PLAIN)}`;
  } else {
    s += ` -> [`;
    let i = 0;
    for (const target of TerminatorKind.successors(self)) {
      if (i > 0) {
        s += `, `;
      }
      s += `${labels[i]}: ${debug_BasicBlock(target, PLAIN)}`;
      i++;
    }
    if (show_unwind) {
      s += `, `;
      s += fmt_unwind();
    }
    s += `]`;
  }
  return s;
};

// impl Debug for Terminator<'_>
// rustc: compiler/rustc_middle/src/mir/pretty.rs:982 fmt
export const debug_Terminator: Debug<Terminator> = (self, fmt) => {
  return debug_TerminatorKind(self.kind, fmt);
};

/// Writes the "head" part of the terminator; that is, its name and the data it uses to pick the
/// successor basic block, if any. The only information not included is the list of possible
/// successors, which may be rendered differently between the text and the graphviz format.
// PORT: each `write!(fmt, ..)` is one `write_str` of the formatted text (the `?` is the early `Err` return).
// rustc: compiler/rustc_middle/src/mir/pretty.rs:991 fmt_head
TerminatorKind.fmt_head = function (self: TerminatorKind, fmt: FmtWrite): FmtResult {
  let r: FmtResult;
  switch (self.$) {
    case "Goto":
      return fmt.write_str(`goto`);
    case "SwitchInt":
      return fmt.write_str(`switchInt(${debug_Operand(self.discr, PLAIN)})`);
    case "Return":
      return fmt.write_str(`return`);
    case "CoroutineDrop":
      return fmt.write_str(`coroutine_drop`);
    case "UnwindResume":
      return fmt.write_str(`resume`);
    case "UnwindTerminate": {
      const reason = self._0;
      return fmt.write_str(`terminate(${UnwindTerminateReason.as_short_str(reason)})`);
    }
    case "Yield": {
      const { value, resume_arg } = self;
      return fmt.write_str(`${debug_Place(resume_arg, PLAIN)} = yield(${debug_Operand(value, PLAIN)})`);
    }
    case "Unreachable":
      return fmt.write_str(`unreachable`);
    case "Drop":
      return fmt.write_str(`drop(${debug_Place(self.place, PLAIN)})`);
    case "Call": {
      const { func, args, destination } = self;
      if ((r = fmt.write_str(`${debug_Place(destination, PLAIN)} = `)).$ === "Err") return r;
      if ((r = fmt.write_str(`${debug_Operand(func, PLAIN)}(`)).$ === "Err") return r;
      for (let index = 0; index < args.length; index++) {
        const arg = args[index]!;
        if (index > 0) {
          if ((r = fmt.write_str(`, `)).$ === "Err") return r;
        }
        if ((r = fmt.write_str(`${debug_Operand(arg.node, PLAIN)}`)).$ === "Err") return r;
      }
      return fmt.write_str(`)`);
    }
    case "TailCall": {
      const { func, args } = self;
      if ((r = fmt.write_str(`tailcall ${debug_Operand(func, PLAIN)}(`)).$ === "Err") return r;
      for (let index = 0; index < args.length; index++) {
        const arg = args[index]!;
        if (index > 0) {
          if ((r = fmt.write_str(`, `)).$ === "Err") return r;
        }
        if ((r = fmt.write_str(`${debug_Operand(arg.node, PLAIN)}`)).$ === "Err") return r;
      }
      return fmt.write_str(`)`);
    }
    case "Assert": {
      const { cond, expected, msg } = self;
      if ((r = fmt.write_str(`assert(`)).$ === "Err") return r;
      if (!expected) {
        if ((r = fmt.write_str(`!`)).$ === "Err") return r;
      }
      if ((r = fmt.write_str(`${debug_Operand(cond, PLAIN)}, `)).$ === "Err") return r;
      if ((r = AssertKind.fmt_assert_args(msg, fmt, debug_Operand)).$ === "Err") return r;
      return fmt.write_str(`)`);
    }
    case "FalseEdge":
      return fmt.write_str(`falseEdge`);
    case "FalseUnwind":
      return fmt.write_str(`falseUnwind`);
    case "InlineAsm": {
      const { template, operands, options } = self;
      if ((r = fmt.write_str(`asm!("${InlineAsmTemplatePiece.to_string(template)}"`)).$ === "Err") return r;
      for (const op of operands) {
        if ((r = fmt.write_str(`, `)).$ === "Err") return r;
        const print_late = (late: boolean): string => (late ? "late" : "");
        switch (op.$) {
          case "In": {
            const { reg, value } = op;
            if ((r = fmt.write_str(`in(${InlineAsmRegOrRegClass.display(reg)}) ${debug_Operand(value, PLAIN)}`)).$ === "Err") return r;
            break;
          }
          case "Out": {
            const { reg, late, place } = op;
            if (place !== undefined) {
              if ((r = fmt.write_str(`${print_late(late)}out(${InlineAsmRegOrRegClass.display(reg)}) ${debug_Place(place, PLAIN)}`)).$ === "Err") return r;
            } else {
              if ((r = fmt.write_str(`${print_late(late)}out(${InlineAsmRegOrRegClass.display(reg)}) _`)).$ === "Err") return r;
            }
            break;
          }
          case "InOut": {
            const { reg, late, in_value, out_place } = op;
            if (out_place !== undefined) {
              if (
                (r = fmt.write_str(
                  `in${print_late(late)}out(${InlineAsmRegOrRegClass.display(reg)}) ${debug_Operand(in_value, PLAIN)} => ${debug_Place(out_place, PLAIN)}`,
                )).$ === "Err"
              )
                return r;
            } else {
              if ((r = fmt.write_str(`in${print_late(late)}out(${InlineAsmRegOrRegClass.display(reg)}) ${debug_Operand(in_value, PLAIN)} => _`)).$ === "Err")
                return r;
            }
            break;
          }
          case "Const":
            if ((r = fmt.write_str(`const ${debug_ConstOperand(op.value, PLAIN)}`)).$ === "Err") return r;
            break;
          case "SymFn":
            if ((r = fmt.write_str(`sym_fn ${debug_ConstOperand(op.value, PLAIN)}`)).$ === "Err") return r;
            break;
          case "SymStatic":
            if ((r = fmt.write_str(`sym_static ${debug_DefId(op.def_id, PLAIN)}`)).$ === "Err") return r;
            break;
          case "Label":
            if ((r = fmt.write_str(`label ${op.target_index}`)).$ === "Err") return r;
            break;
        }
      }
      return fmt.write_str(`, options(${debug_InlineAsmOptions(options, PLAIN)}))`);
    }
  }
};

/// Returns the list of labels for the edges to the successor basic blocks.
// PORT: `Cow<'static, str>` is a `string`.
// rustc: compiler/rustc_middle/src/mir/pretty.rs:1090 fmt_successor_labels
TerminatorKind.fmt_successor_labels = function (self: TerminatorKind): string[] {
  switch (self.$) {
    case "Return":
    case "TailCall":
    case "UnwindResume":
    case "UnwindTerminate":
    case "Unreachable":
    case "CoroutineDrop":
      return [];
    case "Goto":
      return [""];
    case "SwitchInt": {
      const targets = self.targets;
      // `u.to_string()`: `Pu128`'s Display prints the `u128`.
      return [...targets.values.map((u) => u.toString()), "otherwise"];
    }
    case "Call":
      if (self.target !== undefined && self.unwind.$ === "Cleanup") {
        return ["return", "unwind"];
      }
      if (self.target !== undefined) return ["return"];
      if (self.unwind.$ === "Cleanup") return ["unwind"];
      return [];
    case "Yield":
      if (self.drop !== undefined) return ["resume", "drop"];
      return ["resume"];
    case "Drop":
      if (self.unwind.$ === "Cleanup" && self.drop !== undefined) {
        return ["return", "unwind", "drop"];
      }
      if (self.unwind.$ === "Cleanup" && self.drop === undefined) {
        return ["return", "unwind"];
      }
      if (self.drop !== undefined) return ["return", "drop"];
      return ["return"];
    case "Assert":
      if (self.unwind.$ === "Cleanup") {
        return ["success", "unwind"];
      }
      return ["success"];
    case "FalseEdge":
      return ["real", "imaginary"];
    case "FalseUnwind":
      if (self.unwind.$ === "Cleanup") {
        return ["real", "unwind"];
      }
      return ["real"];
    case "InlineAsm": {
      const { asm_macro, options, targets, unwind } = self;
      const vec: string[] = [];
      if (!InlineAsmMacro.diverges(asm_macro, options)) {
        vec.push("return");
      }
      // `vec.resize(targets.len(), "label".into())`: truncates or pads.
      if (vec.length > targets.length) vec.length = targets.length;
      while (vec.length < targets.length) vec.push("label");

      if (unwind.$ === "Cleanup") {
        vec.push("unwind");
      }

      return vec;
    }
  }
};

// impl<'tcx> Debug for Rvalue<'tcx>
// rustc: compiler/rustc_middle/src/mir/pretty.rs:1149 fmt
export const debug_Rvalue: Debug<Rvalue> = (self, fmt) => {
  switch (self.$) {
    case "Use": {
      const [operand, with_retag] = [self._0, self._1];
      // With retag is more common so we only print when it's without.
      return `${WithRetag.no(with_retag) ? "no_retag " : ""}${debug_Operand(operand, PLAIN)}`;
    }
    case "Repeat": {
      const [a, b] = [self._0, self._1];
      let s = `[${debug_Operand(a, PLAIN)}; `;
      s += pretty_print_const(b, fmt, false);
      return s + `]`;
    }
    case "Cast": {
      const [kind, place, ty] = [self._0, self._1, self._2];
      return with_no_trimmed_paths(() => `${debug_Operand(place, PLAIN)} as ${display_Ty(ty)} (${debug_CastKind(kind, PLAIN)})`);
    }
    case "BinaryOp": {
      const [op, [a, b]] = [self._0, self._1];
      return `${debug_BinOp(op, PLAIN)}(${debug_Operand(a, PLAIN)}, ${debug_Operand(b, PLAIN)})`;
    }
    case "UnaryOp": {
      const [op, a] = [self._0, self._1];
      return `${debug_UnOp(op, PLAIN)}(${debug_Operand(a, PLAIN)})`;
    }
    case "Discriminant":
      return `discriminant(${debug_Place(self._0, PLAIN)})`;
    case "ThreadLocalRef": {
      const did = self._0;
      return with_((tcx) => {
        const muta = Mutability.prefix_str(unwrap(tcx.static_mutability(did)));
        return `&/*tls*/ ${muta}${tcx.def_path_str(did)}`;
      });
    }
    case "Ref": {
      const [region, borrow_kind, place] = [self._0, self._1, self._2];
      let kind_str: string;
      switch (borrow_kind.$) {
        case "Shared":
          kind_str = "";
          break;
        case "Fake":
          kind_str = borrow_kind._0 === "Deep" ? "fake " : "fake shallow ";
          break;
        case "Mut":
          kind_str = "mut ";
          break;
      }

      // When printing regions, add trailing space if necessary.
      const print_region = with_((tcx) => tcx.sess.verbose_internals() || tcx.sess.opts.unstable_opts.identify_regions);
      let region_: string;
      if (print_region) {
        region_ = display_Region(region);
        if (region_.length !== 0) {
          region_ += " ";
        }
      } else {
        // Do not even print 'static
        region_ = "";
      }
      return `&${region_}${kind_str}${debug_Place(place, PLAIN)}`;
    }

    case "Reborrow": {
      const [target, mutability, place] = [self._0, self._1, self._2];
      return `${debug_Ty(target, PLAIN)}(${Mutability.is_mut(mutability) ? "reborrow" : "coerce shared"} ${debug_Place(place, PLAIN)})`;
    }

    case "CopyForDeref":
      return `deref_copy ${format_debug(self._0, debug_Place, PRETTY)}`;

    case "RawPtr": {
      const [mutability, place] = [self._0, self._1];
      return `&raw ${RawPtrKind.ptr_str(mutability)} ${debug_Place(place, PLAIN)}`;
    }

    case "Aggregate": {
      const [kind, places] = [self._0, self._1];
      const fmt_tuple = (name: string): string =>
        debug_tuple(
          fmt,
          name,
          places.map((place) => debug_Operand(place, fmt)),
        );

      switch (kind.$) {
        case "Array":
          return debug_vec(places, PLAIN, debug_Operand);

        case "Tuple":
          if (places.length === 0) {
            return `()`;
          } else {
            return fmt_tuple("");
          }

        case "Adt": {
          const [adt_did, variant, args_] = [kind._0, kind._1, kind._2];
          return with_((tcx) => {
            const variant_def = (tcx.adt_def(adt_did) as AdtDef).variant(variant);
            const args = tcx.lift(args_);
            const name_r = FmtPrinter.print_string(tcx, Namespace.ValueNS, (p) => p.print_def_path(variant_def.def_id, args));
            if (name_r.$ === "Err") return panic("a Display implementation returned an error unexpectedly: Error");
            const name = name_r._0;

            switch (variant_def.ctor_kind()) {
              case "Const":
                return name;
              case "Fn":
                return fmt_tuple(name);
              case undefined: {
                const fields: [string, string][] = [];
                const n = Math.min(variant_def.fields.length, places.length);
                for (let i = 0; i < n; i++) {
                  const [field, place] = [variant_def.fields[i]!, places[i]!];
                  fields.push([Symbol.as_str(field.name), debug_Operand(place, fmt)]);
                }
                return debug_struct(fmt, name, fields);
              }
            }
          });
        }

        case "Closure":
        case "CoroutineClosure": {
          const [def_id, args_] = [kind._0, kind._1];
          return with_((tcx) => {
            let name: string;
            if (tcx.sess.opts.unstable_opts.span_free_formats) {
              const args = tcx.lift(args_);
              name = `{closure@${tcx.def_path_str_with_args(def_id, args)}}`;
            } else {
              const span = tcx.def_span(def_id);
              name = `{closure@${tcx.sess.source_map().span_to_diagnostic_string(span)}}`;
            }
            const fields: [string, string][] = [];

            const local = def_id.as_local();
            if (local !== undefined) {
              const captures = tcx.closure_captures(local);
              assert_eq(captures.length, places.length, (n) => debug_int(n, PLAIN));
              for (let i = 0; i < captures.length; i++) {
                const [capture, place] = [captures[i]!, places[i]!];
                fields.push([Symbol.as_str(capture.to_symbol()), debug_Operand(place, fmt)]);
              }
            } else {
              for (let index = 0; index < places.length; index++) {
                fields.push([`${index}`, debug_Operand(places[index]!, fmt)]);
              }
            }

            return debug_struct(fmt, name, fields);
          });
        }

        case "Coroutine": {
          const def_id = kind._0;
          return with_((tcx) => {
            const name = `{coroutine@${debug_Span(tcx.def_span(def_id), PLAIN)}}`;
            const fields: [string, string][] = [];

            const local = def_id.as_local();
            if (local !== undefined) {
              const captures = tcx.closure_captures(local);
              assert_eq(captures.length, places.length, (n) => debug_int(n, PLAIN));
              for (let i = 0; i < captures.length; i++) {
                const [capture, place] = [captures[i]!, places[i]!];
                fields.push([Symbol.as_str(capture.to_symbol()), debug_Operand(place, fmt)]);
              }
            } else {
              for (let index = 0; index < places.length; index++) {
                fields.push([`${index}`, debug_Operand(places[index]!, fmt)]);
              }
            }

            return debug_struct(fmt, name, fields);
          });
        }

        case "RawPtr": {
          const [pointee_ty, mutability] = [kind._0, kind._1];
          let kind_str: string;
          switch (mutability) {
            case "Mut":
              kind_str = "mut";
              break;
            case "Not":
              kind_str = "const";
              break;
          }
          const s = with_no_trimmed_paths(() => `*${kind_str} ${display_Ty(pointee_ty)} from `);
          return s + fmt_tuple("");
        }
      }
      break;
    }

    case "WrapUnsafeBinder": {
      const [op, ty] = [self._0, self._1];
      return with_no_trimmed_paths(() => `wrap_binder!(${debug_Operand(op, PLAIN)}; ${display_Ty(ty)})`);
    }
  }
};

// impl<'tcx> Debug for Operand<'tcx>
// rustc: compiler/rustc_middle/src/mir/pretty.rs:1320 fmt
export const debug_Operand: Debug<Operand> = (self, fmt) => {
  void fmt;
  switch (self.$) {
    case "Constant":
      return `${debug_ConstOperand(self._0, PLAIN)}`;
    case "Copy":
      return `copy ${debug_Place(self._0, PLAIN)}`;
    case "Move":
      return `move ${debug_Place(self._0, PLAIN)}`;
    case "RuntimeChecks":
      return `${debug_RuntimeChecks(self._0, PLAIN)}`;
  }
};

// impl<'tcx> Debug for ConstOperand<'tcx>
// rustc: compiler/rustc_middle/src/mir/pretty.rs:1332 fmt
export const debug_ConstOperand: Debug<ConstOperand> = (self, fmt) => {
  void fmt;
  return `${display_ConstOperand(self)}`;
};

// impl<'tcx> Display for ConstOperand<'tcx>
// rustc: compiler/rustc_middle/src/mir/pretty.rs:1338 fmt
export function display_ConstOperand(self: ConstOperand): string {
  let s = "";
  switch (self.ty().kind().$) {
    case "FnDef":
      break;
    default:
      s += `const `;
  }
  return s + display_Const(self.const_);
}

// impl Debug for Place<'_>
// rustc: compiler/rustc_middle/src/mir/pretty.rs:1348 fmt
export const debug_Place: Debug<Place> = (self, fmt) => {
  return debug_PlaceRef(self.as_ref(), fmt);
};

// impl Debug for PlaceRef<'_>
// rustc: compiler/rustc_middle/src/mir/pretty.rs:1354 fmt
export const debug_PlaceRef: Debug<PlaceRef> = (self, fmt) => {
  let s = pre_fmt_projection(self.projection, fmt);
  s += `${debug_Local(self.local, PLAIN)}`;
  return s + post_fmt_projection(self.projection, fmt);
};

// rustc: compiler/rustc_middle/src/mir/pretty.rs:1361 pre_fmt_projection
export function pre_fmt_projection(projection: readonly PlaceElem[], fmt: Fmt): string {
  void fmt;
  let s = "";
  for (let i = projection.length - 1; i >= 0; i--) {
    const elem = projection[i]!;
    switch (elem.$) {
      case "OpaqueCast":
      case "Downcast":
      case "Field":
        s += `(`;
        break;
      case "Deref":
        s += `(*`;
        break;
      case "Index":
      case "ConstantIndex":
      case "Subslice":
        break;
      case "UnwrapUnsafeBinder":
        s += `unwrap_binder!(`;
        break;
      case "PhantomDeref":
        s += `reborrow!(`;
        break;
    }
  }

  return s;
}

// rustc: compiler/rustc_middle/src/mir/pretty.rs:1387 post_fmt_projection
export function post_fmt_projection(projection: readonly PlaceElem[], fmt: Fmt): string {
  void fmt;
  let s = "";
  for (const elem of projection) {
    switch (elem.$) {
      case "OpaqueCast":
        s += ` as ${display_Ty(elem._0)})`;
        break;
      case "Downcast":
        if (elem._0 !== undefined) {
          s += ` as ${display_Symbol(elem._0)})`;
        } else {
          s += ` as variant#${VariantIdx.debug(elem._1, PLAIN)})`;
        }
        break;
      case "Deref":
      case "PhantomDeref":
        s += `)`;
        break;
      case "Field": {
        const [field, ty] = [elem._0, elem._1];
        s += with_no_trimmed_paths(() => `.${debug_int(field, PLAIN)}: ${display_Ty(ty)})`);
        break;
      }
      case "Index":
        s += `[${debug_Local(elem._0, PLAIN)}]`;
        break;
      case "ConstantIndex": {
        const { offset, min_length, from_end } = elem;
        if (!from_end) {
          s += `[${debug_int(offset, PLAIN)} of ${debug_int(min_length, PLAIN)}]`;
        } else {
          s += `[-${debug_int(offset, PLAIN)} of ${debug_int(min_length, PLAIN)}]`;
        }
        break;
      }
      case "Subslice": {
        const { from, to, from_end } = elem;
        if (to === 0 && from_end) {
          s += `[${debug_int(from, PLAIN)}:]`;
        } else if (from === 0 && from_end) {
          s += `[:-${debug_int(to, PLAIN)}]`;
        } else if (from_end) {
          s += `[${debug_int(from, PLAIN)}:-${debug_int(to, PLAIN)}]`;
        } else {
          s += `[${debug_int(from, PLAIN)}..${debug_int(to, PLAIN)}]`;
        }
        break;
      }
      case "UnwrapUnsafeBinder":
        s += `; ${display_Ty(elem._0)})`;
        break;
    }
  }

  return s;
}

/**
 * A `String` as a `fmt::Write` sink (helper, not an upstream fn): what `write!(fmt, ..)` into a `Formatter` over a
 * `String` collects (`fmt_head` writes into it for the Debug impl).
 */
export class StringFmtWrite implements FmtWrite {
  buf = "";
  write_str(s: string): FmtResult {
    this.buf += s;
    return Ok(undefined);
  }
}

/** `?` on a `fmt::Result` inside a Debug impl formatting to a `String`: an `Err` is std's `to_string` panic. */
function fmt_ok(r: FmtResult): void {
  if (r.$ === "Err") panic("a Display implementation returned an error unexpectedly: Error");
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
