// Port of compiler/rustc_metadata/src/lib.rs.
//
// PORT: `pub mod x;` -> `export * as x from "./x.ts"`; private `mod x;` with no re-export -> a side-effect
// import where the module extends another's prototype. Extension modules are imported here only, after the
// defining module (PORTING section 5): rmeta/decoder/cstore_impl.ts attaches `impl CStore` /
// `impl CrateStore for CStore` to creader.ts's `CStore`. Consumers import this module.
//
// Not ported yet: the rmeta encoder (M5);
// host_dylib is a stub; rmeta/decoder.ts is a contract (stubs for lanes rmeta-decoder-a/-b).

// pub use rmeta::provide;
export { provide } from "./rmeta/decoder/cstore_impl.ts";

// mod dependency_format;
// mod eii;
// mod foreign_modules;
export * as host_dylib from "./host_dylib.ts";
// mod native_libs;
// mod rmeta;
// PORT: rmeta/mod.ts first (decoder.ts extends its classes at load time), then table.ts / def_path_hash_map.ts
// / decoder.ts (parameterized.rs is type-level only).
import "./rmeta/mod.ts";
import "./rmeta/table.ts";
import "./rmeta/def_path_hash_map.ts";
import "./rmeta/decoder.ts";

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
// PORT: only `METADATA_HEADER` exists so far (lane locator); the rest is wave 11 rmeta-types / M5.
export { METADATA_HEADER } from "./rmeta/mod.ts";
