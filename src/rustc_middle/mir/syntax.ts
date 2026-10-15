// Port of compiler/rustc_middle/src/mir/syntax.rs: PARTIAL (lane thir-pattern). Only the enums that THIR stores
// (`BorrowKind`, `MutBorrowKind`, `FakeBorrowKind`, `FakeReadCause`, `UnOp`, `BinOp`, `AssignOp`) are generated, with
// their derived Debug / Clone, into syntax.gen.ts (tools/codegen/types.ts, set rustc_middle_mir_syntax); every other
// type of the file is skipped in that set until the MIR lane (M4) ports mir/syntax.rs (and its fns) here.
//! This defines the syntax of MIR, i.e., the set of available MIR operations, and other definitions
//! closely related to MIR semantics.
//! This is in a dedicated file so that changes to this file can be reviewed more carefully.
//! The intention is that this file only contains datatype declarations, no code.
export * from "./syntax.gen.ts";
