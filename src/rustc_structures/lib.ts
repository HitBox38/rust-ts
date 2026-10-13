// Port of compiler/rustc_structures/src/lib.rs
//! Basic structs that end up being used in attributes for one reason or another,
//! but are not used exclusively in or around attributes.
//
// Types are generated into the `.gen.ts` files (tools/codegen/types.ts, set `rustc_structures`).

// pub use collapse_macro_debug_info::CollapseMacroDebuginfo;
export * from "./collapse_macro_debug_info.ts";
// pub use crate_type::CrateType;
export * from "./crate_type.ts";
// pub use limit::Limit;
export * from "./limit.ts";
// pub use native_lib_kind::NativeLibKind;
export * from "./native_lib_kind.ts";
// pub use sanitizer_set::SanitizerSet;
export * from "./sanitizer_set.ts";
