// Port of compiler/rustc_metadata/src/fs.rs.
//
// PORT (lane locator): only the read-path part is here, `METADATA_FILENAME` (the rlib member that holds the
// metadata; the object reader looks it up). Not ported (no markers, write path / metadata encoding, M5):
// `emit_wrapper_file` (:27), `encode_and_write_metadata` (:38), `non_durable_rename` (:121/:133),
// `copy_to_stdout` (:138).

// FIXME(eddyb) maybe include the crate name in this?
export const METADATA_FILENAME = "lib.rmeta";
