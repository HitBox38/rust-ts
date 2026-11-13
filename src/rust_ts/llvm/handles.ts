// rust-ts: the handle types of the contract (ffi.rs's opaque `extern type`s and `struct X<'a>(InvariantOpaque<'a>)`s), lane
// llir-core-a. Ported code treats every handle as opaque: it passes them back to ffi.ts functions and compares them with `===`
// (LLVM's pointer equality, which the model keeps by uniquing types and constants), and never reads their fields.
//
// A handle the model implements is its class in ir.ts. The others are opaque brands until their lane gives them a class:
// llir-di (`DbgRecord`, `DIBuilder`; `BasicBlock`, `Builder` and `OperandBundle` are llir-core-b's inst.ts classes), the driver lanes
// (`Buffer`, `ThinLTOData`, `Linker`, diagnostics). (`TargetMachine`, `MCSubtargetInfo` and `DiagnosticHandler` are target.ts's classes, lane llir-init.) Such a lane replaces the brand here
// with its class; the name stays, so ffi.ts and its callers do not change.
import type { BasicBlock as InstBasicBlock, IRBuilder, OperandBundleDef } from "./inst.ts";
import type { Attribute as IrAttribute, Comdat as IrComdat, ConstantInt as IrConstantInt, Context as IrContext, Metadata as IrMetadata, Module as IrModule, Type as IrType, Value as IrValue } from "./ir.ts";

export type { RustString } from "./support.ts";

export type Context = IrContext;
export type Module = IrModule;
export type Type = IrType;
export type Value = IrValue;
export type ConstantInt = IrConstantInt;
export type Attribute = IrAttribute;
export type Metadata = IrMetadata;
export type Comdat = IrComdat;
export type BasicBlock = InstBasicBlock;
export type Builder = IRBuilder;
export type OperandBundle = OperandBundleDef;

declare const opaque: unique symbol;
type Opaque<N extends string> = { readonly [opaque]: N };

export type DbgRecord = Opaque<"DbgRecord">;
export type DIBuilder = Opaque<"DIBuilder">;
export type { MCSubtargetInfo, TargetMachine } from "./target.ts";
export type Twine = Opaque<"Twine">;
export type DiagnosticInfo = Opaque<"DiagnosticInfo">;
export type SMDiagnostic = Opaque<"SMDiagnostic">;
export type { DiagnosticHandler } from "./target.ts";
export type Buffer = Opaque<"Buffer">;
export type ThinLTOData = Opaque<"ThinLTOData">;
export type Linker = Opaque<"Linker">;

// ffi.rs `pub(crate) mod debuginfo`: the debuginfo handles are all `Metadata`.
export type DIDescriptor = Metadata;
export type DILocation = Metadata;
export type DIScope = DIDescriptor;
export type DIFile = DIScope;
export type DILexicalBlock = DIScope;
export type DISubprogram = DIScope;
export type DIType = DIDescriptor;
export type DIBasicType = DIType;
export type DIDerivedType = DIType;
export type DICompositeType = DIDerivedType;
export type DIVariable = DIDescriptor;
export type DIArray = DIDescriptor;
export type DITemplateTypeParameter = DIDescriptor;
