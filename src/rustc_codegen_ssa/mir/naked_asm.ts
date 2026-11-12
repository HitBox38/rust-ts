// Port of compiler/rustc_codegen_ssa/src/mir/naked_asm.rs (lane ssa-rvalue-intrinsic, plan-m7 wave 41).
//
// PORT (ssa-rvalue-intrinsic):
// - `Cx: LayoutOf + FnAbiOf + AsmCodegenMethods` is `CodegenMethods<B> & AsmCodegenMethods` (the LLVM `CodegenCx`
//   implements all three; `CodegenMethods` carries `LayoutOf`/`FnAbiOf` and `tcx_()`/`typing_env_()`).
// - `writeln!(w, ..)` into a `String` is `w.value += ... + "\n"` on a `MutRef<string>`; `.unwrap()` of the
//   `fmt::Result` of writing to a `String` cannot fail and is dropped.
// - `emit_fatal` (`span_fatal`, `-> !`) throws, so the `write_linkage` arms that call it do not fall through.
import { type Integer, type Primitive, Scalar as abi_Scalar, debug_BackendRepr, debug_Size, Size_eq } from "../../rustc_abi/lib.ts";
import type { InlineAsmTemplatePiece } from "../../rustc_ast/ast.ts";
import type { Linkage } from "../../rustc_attr_ir/data_structures.ts";
import { LOCAL_CRATE } from "../../rustc_span/def_id.ts";
import { TyCtxt_codegen_instance_attrs } from "../../rustc_middle/middle/codegen_fn_attrs.ts";
import { debug_ErrorHandled } from "../../rustc_middle/mir/interpret/error.gen.ts";
import { CTFE_ALLOC_SALT } from "../../rustc_middle/mir/interpret/mod.ts";
import { Pointer_from_AllocId } from "../../rustc_middle/mir/interpret/pointer.ts";
import { Scalar } from "../../rustc_middle/mir/interpret/value.ts";
import { Const as mir_Const, debug_ConstValue, fold_Const as fold_mir_Const, type InlineAsmOperand, START_BLOCK } from "../../rustc_middle/mir/mod.ts";
import type { MonoItemData, Visibility } from "../../rustc_middle/mono.ts";
import { fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { Symbol, sym } from "../../rustc_span/symbol.ts";
import type { ArgAbi, FnAbi } from "../../rustc_target/callconv/mod.ts";
import type { TargetSpecOther } from "../../rustc_target/lib.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { debug_str, format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { assert, panic, unreachable, unwrap } from "../../std/panic.ts";
import { expect_result } from "../../std/result.ts";
import { asm_const_ptr_clean } from "../common.ts";
import type { AsmCodegenMethods, GlobalAsmOperandRef } from "../traits/asm.ts";
import type { BackendTypes } from "../traits/backend.ts";
import type { CodegenMethods } from "../traits/mod.ts";

// rustc: compiler/rustc_codegen_ssa/src/mir/naked_asm.rs:18 codegen_naked_asm
export function codegen_naked_asm<B extends BackendTypes>(cx: CodegenMethods<B> & AsmCodegenMethods, instance: Instance, item_data: MonoItemData): void {
  assert(!TypeVisitableExt.has_infer(instance.args, fold_GenericArgs), "assertion failed: !instance.args.has_infer()");
  const mir = cx.tcx_().instance_mir(instance.def);

  const kind = mir.basic_blocks.deref()[START_BLOCK]!.terminator_().kind;
  if (kind.$ !== "InlineAsm") {
    return bug("#[naked] functions should always terminate with an asm! block");
  }
  const { template, operands: operands0, options, line_spans } = kind;

  const operands = operands0.map((op) => inline_to_global_operand(cx, instance, op));

  const name = cx.mangled_name(instance);
  const fn_abi = cx.fn_abi_of_instance(instance, RawList.empty());
  const [begin, end] = prefix_and_suffix(cx.tcx_(), instance, name, item_data, fn_abi);

  const template_vec: InlineAsmTemplatePiece[] = [];
  template_vec.push({ $: "String", _0: begin });
  // PORT: `template_vec.extend(template.iter().cloned())` pushes the same piece objects: plain data that is never written.
  template_vec.push(...template);
  template_vec.push({ $: "String", _0: end });

  const target_features = [...cx.tcx_().asm_target_features(Instance.def_id(instance))].map((s) => Symbol.as_str(s));
  cx.codegen_global_asm(template_vec, operands, options, line_spans, target_features);
}

// rustc: compiler/rustc_codegen_ssa/src/mir/naked_asm.rs:62 inline_to_global_operand
function inline_to_global_operand<B extends BackendTypes>(cx: CodegenMethods<B>, instance: Instance, op: InlineAsmOperand): GlobalAsmOperandRef {
  switch (op.$) {
    case "Const": {
      const value = op.value;
      const const_value = expect_result(
        mir_Const.eval(
          Instance.instantiate_mir_and_normalize_erasing_regions(
            instance,
            cx.tcx_(),
            cx.typing_env_(),
            EarlyBinder.bind(cx.tcx_(), value.const_, fold_mir_Const),
            fold_mir_Const,
          ),
          cx.tcx_(),
          cx.typing_env_(),
          value.span,
        ),
        "erroneous constant missed by mono item collection",
        (e) => format_debug(e, debug_ErrorHandled, PLAIN),
      );

      const mono_type = Instance.instantiate_mir_and_normalize_erasing_regions(
        instance,
        cx.tcx_(),
        cx.typing_env_(),
        EarlyBinder.bind(cx.tcx_(), value.ty(), fold_Ty),
        fold_Ty,
      );
      if (const_value.$ !== "Scalar") {
        return span_bug(value.span, `expected Scalar for promoted asm const, but got ${format_debug(const_value, debug_ConstValue, PRETTY)}`);
      }
      const scalar = const_value._0;

      return {
        $: "Const",
        value: asm_const_ptr_clean(cx.tcx_(), scalar),
        ty: mono_type,
      };
    }
    case "SymFn": {
      const value = op.value;
      const mono_type = Instance.instantiate_mir_and_normalize_erasing_regions(
        instance,
        cx.tcx_(),
        cx.typing_env_(),
        EarlyBinder.bind(cx.tcx_(), value.ty(), fold_Ty),
        fold_Ty,
      );

      const k = mono_type.kind();
      let instance_: Instance;
      if (k.$ === "FnDef") {
        const def_id = k._0;
        const args = k._1;
        instance_ = Instance.expect_resolve(cx.tcx_(), cx.typing_env_(), def_id, unwrap(Binder.no_bound_vars(args, fold_GenericArgs)), value.span);
      } else {
        return bug("asm sym is not a function");
      }

      return {
        $: "Const",
        value: Scalar.from_pointer(Pointer_from_AllocId(cx.tcx_().reserve_and_set_fn_alloc(instance_, CTFE_ALLOC_SALT)), cx),
        ty: Ty.new_fn_ptr(cx.tcx_(), mono_type.fn_sig(cx.tcx_())),
      };
    }
    case "SymStatic": {
      const def_id = op.def_id;
      if (cx.tcx_().is_thread_local_static(def_id)) {
        return { $: "SymThreadLocalStatic", def_id };
      } else {
        return {
          $: "Const",
          value: Scalar.from_pointer(Pointer_from_AllocId(cx.tcx_().reserve_and_set_static_alloc(def_id)), cx),
          ty: cx.tcx_().static_ptr_ty(def_id, cx.typing_env_()),
        };
      }
    }
    case "In":
    case "Out":
    case "InOut":
    case "Label":
      return bug("invalid operand type for naked_asm!");
  }
}

// rustc: compiler/rustc_codegen_ssa/src/mir/naked_asm.rs:144 prefix_and_suffix
function prefix_and_suffix(tcx: TyCtxt, instance: Instance, asm_name: string, item_data: MonoItemData, fn_abi: FnAbi<Ty>): [string, string] {
  // use std::fmt::Write;

  const asm_binary_format = tcx.sess.target.binary_format;

  const is_arm = tcx.sess.target.arch.$ === "Arm";
  const is_thumb = tcx.sess.internal_target_features.has(sym.thumb_mode);
  const function_sections = tcx.sess.opts.unstable_opts.function_sections ?? tcx.sess.target.function_sections;

  // If we're compiling the compiler-builtins crate, e.g., the equivalent of
  // compiler-rt, then we want to implicitly compile everything with hidden
  // visibility as we're going to link this object all over the place but
  // don't want the symbols to get exported. For naked asm we set the visibility here.
  let visibility: Visibility = item_data.visibility;
  if (item_data.linkage !== "Internal" && tcx.is_compiler_builtins(LOCAL_CRATE)) {
    visibility = "Hidden";
  }

  const attrs = TyCtxt_codegen_instance_attrs(tcx, instance.def);
  const link_section = attrs.link_section === undefined ? undefined : Symbol.as_str(attrs.link_section);

  // Pick a default alignment when the alignment is not explicitly specified.
  let align_bytes: number;
  if (attrs.alignment !== undefined) {
    align_bytes = attrs.alignment.bytes();
  } else {
    switch (asm_binary_format) {
      case "Coff":
        align_bytes = 16;
        break;
      default:
        align_bytes = 4;
    }
  }

  // In particular, `.arm` can also be written `.code 32` and `.thumb` as `.code 16`.
  let arch_prefix: string;
  let arch_suffix: string;
  if (is_arm) {
    switch (attrs.instruction_set) {
      case undefined:
        arch_prefix = is_thumb ? ".thumb\n.thumb_func" : ".arm";
        break;
      case "ArmT32":
        arch_prefix = ".thumb\n.thumb_func";
        break;
      case "ArmA32":
        arch_prefix = ".arm";
        break;
    }
    arch_suffix = is_thumb ? ".thumb" : ".arm";
  } else {
    [arch_prefix, arch_suffix] = ["", ""];
  }

  const emit_fatal = (msg: string): never => tcx.dcx().span_fatal(tcx.def_span(Instance.def_id(instance)), msg);

  // see https://godbolt.org/z/cPK4sxKor.
  const write_linkage = (w: MutRef<string>): void => {
    const linkage: Linkage = item_data.linkage;
    switch (linkage) {
      case "External": {
        writeln(w, `.globl ${asm_name}`);
        break;
      }
      case "LinkOnceAny":
      case "LinkOnceODR":
      case "WeakAny":
      case "WeakODR": {
        switch (asm_binary_format) {
          case "Elf":
          case "Coff":
          case "Wasm": {
            writeln(w, `.weak ${asm_name}`);
            break;
          }
          case "Xcoff": {
            // FIXME: there is currently no way of defining a weak symbol in inline assembly
            // for AIX. See https://github.com/llvm/llvm-project/issues/130269
            emit_fatal("cannot create weak symbols from inline assembly for this target");
            break;
          }
          case "MachO": {
            writeln(w, `.globl ${asm_name}`);
            writeln(w, `.weak_definition ${asm_name}`);
            break;
          }
        }
        break;
      }
      case "Internal": {
        // LTO can fail when internal linkage is used.
        emit_fatal("naked functions may not have internal linkage");
        break;
      }
      case "AvailableExternally": {
        // this would make the function equal an extern definition
        emit_fatal("Functions may not have available_externally linkage");
        break;
      }
      case "ExternalWeak": {
        // FIXME: actually this causes a SIGILL in LLVM
        emit_fatal("Functions may not have external weak linkage");
        break;
      }
    }
  };

  const begin: MutRef<string> = { value: "" };
  const end: MutRef<string> = { value: "" };
  switch (asm_binary_format) {
    case "Elf": {
      const progbits = is_arm ? "%progbits" : "@progbits";

      const function_ = is_arm ? "%function" : "@function";

      if (link_section !== undefined) {
        const section = link_section;
        writeln(begin, `.pushsection ${section},"ax", ${progbits}`);
      } else if (function_sections) {
        writeln(begin, `.pushsection .text.${asm_name},"ax", ${progbits}`);
      } else {
        writeln(begin, ".text");
      }
      writeln(begin, `.balign ${align_bytes}`);
      write_linkage(begin);
      switch (visibility) {
        case "Default":
          break;
        case "Protected":
          writeln(begin, `.protected ${asm_name}`);
          break;
        case "Hidden":
          writeln(begin, `.hidden ${asm_name}`);
          break;
      }
      writeln(begin, `.type ${asm_name}, ${function_}`);
      if (arch_prefix !== "") {
        writeln(begin, `${arch_prefix}`);
      }
      writeln(begin, `${asm_name}:`);

      writeln(end, "");
      // emit a label starting with `func_end` for `cargo asm` and other tooling that might
      // pattern match on assembly generated by LLVM.
      writeln(end, `.Lfunc_end_${asm_name}:`);
      writeln(end, `.size ${asm_name}, . - ${asm_name}`);
      if (link_section !== undefined || function_sections) {
        writeln(end, ".popsection");
      }
      if (arch_suffix !== "") {
        writeln(end, `${arch_suffix}`);
      }
      break;
    }
    case "MachO": {
      // NOTE: LLVM ignores `-Zfunction-sections` on macos. Instead the Mach-O symbol
      // subsection splitting feature is used, which can be enabled with the
      // `.subsections_via_symbols` global directive. LLVM already enables this directive.
      if (link_section !== undefined) {
        const section = link_section;
        writeln(begin, `.pushsection ${section},regular,pure_instructions`);
      } else {
        writeln(begin, ".section __TEXT,__text,regular,pure_instructions");
      }
      writeln(begin, `.balign ${align_bytes}`);
      write_linkage(begin);
      switch (visibility) {
        case "Default":
        case "Protected":
          break;
        case "Hidden":
          writeln(begin, `.private_extern ${asm_name}`);
          break;
      }
      writeln(begin, `${asm_name}:`);

      writeln(end, "");
      writeln(end, `.Lfunc_end_${asm_name}:`);
      if (link_section !== undefined) {
        writeln(end, ".popsection");
      }
      if (arch_suffix !== "") {
        writeln(end, `${arch_suffix}`);
      }
      break;
    }
    case "Coff": {
      writeln(begin, `.def ${asm_name}`);
      writeln(begin, ".scl 2");
      writeln(begin, ".type 32");
      writeln(begin, ".endef");

      if (link_section !== undefined) {
        const section = link_section;
        writeln(begin, `.section ${section},"xr"`);
      } else if (!function_sections) {
        // Function sections are enabled by default on MSVC and windows-gnullvm,
        // but disabled by default on GNU.
        writeln(begin, ".text");
      } else {
        // LLVM uses an extension to the section directive to support defining multiple
        // sections with the same name and comdat. It adds `unique,<id>` at the end of the
        // `.section` directive. We have no way of generating that unique ID here, so don't
        // emit it.
        //
        // See https://llvm.org/docs/Extensions.html#id2.
        const env = tcx.sess.target.options.env;
        switch (env.$) {
          case "Gnu": {
            writeln(begin, `.section .text$${asm_name},"xr",one_only,${asm_name}`);
            break;
          }
          case "Msvc": {
            writeln(begin, `.section .text,"xr",one_only,${asm_name}`);
            break;
          }
          case "Unspecified": {
            const os = tcx.sess.target.options.os;
            switch (os.$) {
              case "Uefi": {
                writeln(begin, `.section .text,"xr",one_only,${asm_name}`);
                break;
              }
              default:
                bug(`unexpected coff target ${tcx.sess.target.llvm_target}`);
            }
            break;
          }
          default:
            bug(`unexpected coff env ${debug_TargetSpecOther(env)}`);
        }
      }
      write_linkage(begin);
      writeln(begin, `.balign ${align_bytes}`);
      writeln(begin, `${asm_name}:`);

      writeln(end, "");
      if (arch_suffix !== "") {
        writeln(end, `${arch_suffix}`);
      }
      break;
    }
    case "Wasm": {
      const section = link_section ?? `.text.${asm_name}`;

      writeln(begin, `.section ${section},"",@`);
      // wasm functions cannot be aligned, so skip
      write_linkage(begin);
      if (visibility === "Hidden") {
        writeln(begin, `.hidden ${asm_name}`);
      }
      writeln(begin, `.type ${asm_name}, @function`);
      if (arch_prefix !== "") {
        writeln(begin, `${arch_prefix}`);
      }
      writeln(begin, `${asm_name}:`);
      writeln(begin, `.functype ${asm_name} ${wasm_functype(tcx, fn_abi)}`);

      writeln(end, "");
      // .size is ignored for function symbols, so we can skip it
      writeln(end, "end_function");
      writeln(end, `.Lfunc_end_${asm_name}:`);
      break;
    }
    case "Xcoff": {
      // the LLVM XCOFFAsmParser is extremely incomplete and does not implement many of the
      // documented directives.
      //
      // - https://github.com/llvm/llvm-project/blob/1b25c0c4da968fe78921ce77736e5baef4db75e3/llvm/lib/MC/MCParser/XCOFFAsmParser.cpp
      // - https://www.ibm.com/docs/en/ssw_aix_71/assembler/assembler_pdf.pdf
      //
      // Consequently, we try our best here but cannot do as good a job as for other binary
      // formats.

      // FIXME: start a section. `.csect` is not currently implemented in LLVM

      // fun fact: according to the assembler documentation, .align takes an exponent,
      // but LLVM only accepts powers of 2 (but does emit the exponent)
      // so when we hand `.align 32` to LLVM, the assembly output will contain `.align 5`
      writeln(begin, `.align ${align_bytes}`);

      write_linkage(begin);
      if (visibility === "Hidden") {
        // FIXME apparently `.globl {asm_name}, hidden` is valid
        // but due to limitations with `.weak` (see above) we can't really use that in general yet
      }
      writeln(begin, `${asm_name}:`);

      writeln(end, "");
      // FIXME: end the section?
      break;
    }
  }

  return [begin.value, end.value];
}

/// The webassembly type signature for the given function.
///
/// Used by the `.functype` directive on wasm targets.
// rustc: compiler/rustc_codegen_ssa/src/mir/naked_asm.rs:417 wasm_functype
function wasm_functype(tcx: TyCtxt, fn_abi: FnAbi<Ty>): string {
  const signature: MutRef<string> = { value: "" };

  let ptr_type: string;
  const bits = tcx.data_layout().pointer_size().bits();
  switch (bits) {
    case 32:
      ptr_type = "i32";
      break;
    case 64:
      ptr_type = "i64";
      break;
    default: {
      const other = bits;
      return bug(`wasm pointer size cannot be ${other} bits`);
    }
  }

  const hidden_return = fn_abi.ret.mode.$ === "Indirect";

  signature.value += "(";

  if (hidden_return) {
    signature.value += ptr_type;
    if (fn_abi.args.length !== 0) {
      signature.value += ", ";
    }
  }

  for (let i = 0; i < fn_abi.args.length; i++) {
    const arg_abi = fn_abi.args[i]!;
    wasm_type(signature, arg_abi, ptr_type);
    if (i + 1 < fn_abi.args.length) {
      signature.value += ", ";
    }
  }

  signature.value += ") -> (";

  if (!hidden_return) {
    wasm_type(signature, fn_abi.ret, ptr_type);
  }

  signature.value += ")";

  return signature.value;
}

// rustc: compiler/rustc_codegen_ssa/src/mir/naked_asm.rs:456 wasm_type
function wasm_type(signature: MutRef<string>, arg_abi: ArgAbi<Ty>, ptr_type: string): void {
  const mode = arg_abi.mode;
  switch (mode.$) {
    case "Ignore": {
      /* do nothing */
      break;
    }
    case "Direct": {
      let direct_type: string;
      const repr = arg_abi.layout.backend_repr;
      switch (repr.$) {
        case "Scalar":
          direct_type = wasm_primitive(abi_Scalar.primitive(repr._0), ptr_type);
          break;
        case "SimdVector":
          direct_type = "v128";
          break;
        default: {
          const other = repr;
          return unreachable(`internal error: entered unreachable code: unexpected BackendRepr: ${debug_BackendRepr(other, PLAIN)}`);
        }
      }

      signature.value += direct_type;
      break;
    }
    case "Pair": {
      const repr = arg_abi.layout.backend_repr;
      if (repr.$ === "ScalarPair") {
        const { a, b } = repr;
        signature.value += wasm_primitive(abi_Scalar.primitive(a), ptr_type);
        signature.value += ", ";
        signature.value += wasm_primitive(abi_Scalar.primitive(b), ptr_type);
      } else {
        const other = repr;
        return unreachable(`internal error: entered unreachable code: ${debug_BackendRepr(other, PLAIN)}`);
      }
      break;
    }
    case "Cast": {
      const { pad_i32_count, cast } = mode;
      // For wasm, Cast is used for single-field primitive wrappers like `struct Wrapper(i64);`
      if (pad_i32_count !== 0) {
        throw_assert_eq_msg(String(pad_i32_count), "0", "not currently used by wasm calling convention");
      }
      assert(cast.prefix.length === 0, "no prefix");
      if (!Size_eq(cast.rest.total, arg_abi.layout.size)) {
        throw_assert_eq_msg(debug_Size(cast.rest.total, PLAIN), debug_Size(arg_abi.layout.size, PLAIN), "single item");
      }

      let wrapped_wasm_type: string;
      const unit = cast.rest.unit;
      switch (unit.kind.$) {
        case "Integer": {
          const n = unit.size.bytes();
          wrapped_wasm_type = n <= 4 ? "i32" : n <= 8 ? "i64" : ptr_type;
          break;
        }
        case "Float": {
          const n = unit.size.bytes();
          wrapped_wasm_type = n <= 4 ? "f32" : n <= 8 ? "f64" : ptr_type;
          break;
        }
        case "PpcF128":
          return bug("not a valid wasm type");
        case "Vector":
          wrapped_wasm_type = "v128";
          break;
      }

      signature.value += wrapped_wasm_type;
      break;
    }
    case "Indirect":
      signature.value += ptr_type;
      break;
    case "IndirectUnsized":
      return bug("unsized argument to naked asm");
  }
}

// rustc: compiler/rustc_codegen_ssa/src/mir/naked_asm.rs:504 wasm_primitive
function wasm_primitive(primitive: Primitive, ptr_type: string): string {
  switch (primitive.$) {
    case "Int": {
      const integer: Integer = primitive._0;
      switch (integer) {
        case "I8":
        case "I16":
        case "I32":
          return "i32";
        case "I64":
          return "i64";
        case "I128":
          return "i64, i64";
      }
      break;
    }
    case "Float": {
      const float = primitive._0;
      switch (float) {
        // This could probably use an f32 for WASM however has not been
        // verified so leaving as a `bug!(...)` for now.
        case "F16B":
          return bug("`f16b` unsupported on wasm");
        case "F16":
        case "F32":
          return "f32";
        case "F64":
          return "f64";
        case "F128":
          return "i64, i64";
        case "PpcF128":
          return bug("`ppcf128` unsupported on wasm");
      }
      break;
    }
    case "Pointer":
      return ptr_type;
  }
}

// ---- Local helpers (not upstream) ------------------------------------------------------------------------------------

/** `writeln!(w, "{s}")` into a `String`. */
function writeln(w: MutRef<string>, s: string): void {
  w.value += s + "\n";
}

// PORT: `assert_eq!` with a message (`wasm_type`) is written out with core's text by this local helper.
/** `assert_eq!(left, right, "{msg}")`: core's text with a message (`assert_failed_inner`, `AssertKind::Eq`). */
function throw_assert_eq_msg(left: string, right: string, msg: string): never {
  return panic(`assertion \`left == right\` failed: ${msg}\n  left: ${left}\n right: ${right}`);
}

// PORT: the TS `TargetSpecOther` has no `Debug`; `{other:?}` of `Env` (`bug!("unexpected coff env ..")`) uses this local
// helper, the derived `Debug` of `target_spec_enum!`: `Name` or `Other("..")`.
/** The derived `Debug` of a `target_spec_enum!` enum with an `other_variant` (rustc_target/src/lib.rs:135
 *  `#[derive(.., Debug, ..)]`): a known variant prints its name, the other variant `Other("..")` (`StaticCow<str>`). */
function debug_TargetSpecOther<T extends string, O extends string>(v: TargetSpecOther<T, O>): string {
  return "_0" in v ? `${v.$}(${debug_str(v._0)})` : v.$;
}
