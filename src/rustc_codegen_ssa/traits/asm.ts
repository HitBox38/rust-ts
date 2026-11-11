// Port of compiler/rustc_codegen_ssa/src/traits/asm.rs (lane ssa-contract). Conventions: backend.ts's header.
//
// PORT (ssa-contract): `InlineAsmOperandRef<'tcx, B: BackendTypes>` is `InlineAsmOperandRef<B extends BackendTypes>`
// (`B::Value` is `B["Value"]`). The derived `Debug` impls of both enums are not here: they need `OperandRef`'s and
// `PlaceRef`'s (lane ssa-operand-place); whoever first prints one adds them.
import type { InlineAsmOptions, InlineAsmTemplatePiece } from "../../rustc_ast/lib.ts";
import type { Scalar } from "../../rustc_middle/mir/interpret/value.ts";
import type { Instance } from "../../rustc_middle/ty/instance.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { InlineAsmRegOrRegClass } from "../../rustc_target/asm/mod.ts";
import type { OperandRef } from "../mir/operand.ts";
import type { PlaceRef } from "../mir/place.ts";
import type { BackendTypes, BackendTypesOf } from "./backend.ts";

// #[derive(Debug)]
export type InlineAsmOperandRef<B extends BackendTypes> =
  | {
      readonly $: "In";
      reg: InlineAsmRegOrRegClass;
      value: OperandRef<B["Value"]>;
    }
  | {
      readonly $: "Out";
      reg: InlineAsmRegOrRegClass;
      late: boolean;
      place: PlaceRef<B["Value"]> | undefined;
    }
  | {
      readonly $: "InOut";
      reg: InlineAsmRegOrRegClass;
      late: boolean;
      in_value: OperandRef<B["Value"]>;
      out_place: PlaceRef<B["Value"]> | undefined;
    }
  | {
      readonly $: "Const";
      value: Scalar;
      /// Type of the constant. This is needed to extract width and signedness.
      ty: Ty;
    }
  | {
      readonly $: "SymThreadLocalStatic";
      def_id: DefId;
    }
  | {
      readonly $: "Label";
      label: B["BasicBlock"];
    };

// #[derive(Debug)]
export type GlobalAsmOperandRef =
  | {
      readonly $: "Const";
      value: Scalar;
      /// Type of the constant. This is needed to extract width and signedness.
      ty: Ty;
    }
  | {
      readonly $: "SymThreadLocalStatic";
      def_id: DefId;
    };

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/asm.rs:54 AsmBuilderMethods
export interface AsmBuilderMethods<B extends BackendTypes> extends BackendTypesOf<B> {
  /// Take an inline assembly expression and splat it out via LLVM
  /** `catch_funclet: Option<(Self::BasicBlock, Option<&Self::Funclet>)>` */
  // rustc: compiler/rustc_codegen_ssa/src/traits/asm.rs:56 codegen_inline_asm
  codegen_inline_asm(
    template: readonly InlineAsmTemplatePiece[],
    operands: readonly InlineAsmOperandRef<B>[],
    options: InlineAsmOptions,
    line_spans: readonly Span[],
    instance: Instance,
    dest: B["BasicBlock"] | undefined,
    catch_funclet: readonly [B["BasicBlock"], B["Funclet"] | undefined] | undefined,
  ): void;
}

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/asm.rs:68 AsmCodegenMethods
export interface AsmCodegenMethods {
  /// Codegen a module-level assembly block.
  ///
  /// NOTE: the target features must be the rust target feature names, not backend target
  /// feature names. This argument is used to forward target features on naked functions.
  // rustc: compiler/rustc_codegen_ssa/src/traits/asm.rs:73 codegen_global_asm
  codegen_global_asm(
    template: readonly InlineAsmTemplatePiece[],
    operands: readonly GlobalAsmOperandRef[],
    options: InlineAsmOptions,
    line_spans: readonly Span[],
    extra_rust_target_features: readonly string[],
  ): void;

  /// The mangled name of this instance
  ///
  /// Additional mangling is used on
  /// some targets to add a leading underscore (Mach-O)
  /// or byte count suffixes (x86 Windows).
  // rustc: compiler/rustc_codegen_ssa/src/traits/asm.rs:87 mangled_name
  mangled_name(instance: Instance): string;
}
