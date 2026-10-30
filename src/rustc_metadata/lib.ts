// Port of compiler/rustc_metadata/src/lib.rs.
//
// PORT: `pub mod x;` -> `export * as x from "./x.ts"`; private `mod x;` with no re-export -> a side-effect
// import where the module extends another's prototype. Extension modules are imported here only, after the
// defining module (PORTING section 5): rmeta/decoder/cstore_impl.ts attaches `impl CStore` /
// `impl CrateStore for CStore` to creader.ts's `CStore`. Consumers import this module.
//
// host_dylib is a stub; rmeta/decoder.ts is a contract (stubs for lanes rmeta-decoder-a/-b).

// pub use rmeta::provide;
export { provide } from "./rmeta/mod.ts";

// mod dependency_format;
// mod eii;
// mod foreign_modules;
export * as host_dylib from "./host_dylib.ts";
// mod native_libs;
// mod rmeta;
// PORT: rmeta/mod.ts first (decoder.ts extends its classes at load time), then table.ts / def_path_hash_map.ts
// / decoder.ts / encoder.ts (parameterized.rs is type-level only).
import "./rmeta/mod.ts";
import "./rmeta/table.ts";
import "./rmeta/def_path_hash_map.ts";
import "./rmeta/decoder.ts";
import "./rmeta/encoder.ts";

export * as creader from "./creader.ts";
import "./rmeta/decoder/cstore_impl.ts";
export * as diagnostics from "./diagnostics.ts";
export * as fs from "./fs.ts";
export * as locator from "./locator.ts";

// pub use fs::{METADATA_FILENAME, emit_wrapper_file};
export { METADATA_FILENAME, emit_wrapper_file } from "./fs.ts";
// pub use host_dylib::{DylibError, load_symbol_from_dylib};
export type { DylibError } from "./host_dylib.ts";
// pub use rmeta::{EncodedMetadata, METADATA_HEADER, ProcMacroKind, encode_metadata, rendered_const};
export { METADATA_HEADER, type ProcMacroKind } from "./rmeta/mod.ts";
export { EncodedMetadata, encode_metadata, rendered_const } from "./rmeta/encoder.ts";
