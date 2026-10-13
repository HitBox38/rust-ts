// Port of compiler/rustc_attr_ir/src/diagnostic_items.rs
// `DiagnosticItems` (and its derived Default) is generated into diagnostic_items.gen.ts
// (tools/codegen/types.ts). Its Debug is `unported` there: `id_to_name` is a `DefIdMap` (UnordMap keyed
// by `DefId`), which has no TS Debug yet (see tools/codegen/typemap.attr_ir.json).
export * from "./diagnostic_items.gen.ts";
