// Port of compiler/rustc_metadata/src/lib.rs.
//
// PORT: `pub mod x;` -> `export * as x from "./x.ts"`; private `mod x;` with no re-export -> a side-effect
// import where the module extends another's prototype. Extension modules are imported here only, after the
// defining module (PORTING section 5): rmeta/decoder/cstore_impl.ts attaches `impl CStore` /
// `impl CrateStore for CStore` to creader.ts's `CStore`. Consumers import this module.
//
// Not ported yet (wave 11 lanes): dependency_format, eii, foreign_modules, native_libs, fs, the rmeta
// encoder/table/parameterized/def_path_hash_map; locator, host_dylib and rmeta/{mod,decoder} are stubs.

// pub use rmeta::provide;
export { provide } from "./rmeta/decoder/cstore_impl.ts";

// mod dependency_format;
// mod eii;
// mod foreign_modules;
export * as host_dylib from "./host_dylib.ts";
// mod native_libs;
// mod rmeta;
import "./rmeta/mod.ts";
import "./rmeta/decoder.ts";

export * as creader from "./creader.ts";
import "./rmeta/decoder/cstore_impl.ts";
export * as diagnostics from "./diagnostics.ts";
// pub mod fs;
export * as locator from "./locator.ts";

// pub use fs::{METADATA_FILENAME, emit_wrapper_file};
// pub use host_dylib::{DylibError, load_symbol_from_dylib};
export type { DylibError } from "./host_dylib.ts";
// pub use rmeta::{EncodedMetadata, METADATA_HEADER, ProcMacroKind, encode_metadata, rendered_const};
