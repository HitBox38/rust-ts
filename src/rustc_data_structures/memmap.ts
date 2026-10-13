// Port of compiler/rustc_data_structures/src/memmap.rs (`Mmap`, the read-only map).
//
// PORT: `memmap2::MmapOptions::new().map_copy_read_only(&file)` is `Bun.mmap(path, { shared: false })`
// (a private read-only mapping of the whole file), or `readFileSync` when not running on Bun.
// memmap2 is 0.2.3 (Cargo.lock): on unix an empty file is `io::Error::new(InvalidInput, "memory
// map must have a non-zero length")` (src/unix.rs:46) without calling mmap(2); that is kept (the
// Windows behavior, a `CreateFileMappingW` OS error, is unported). Mapping a non-regular file
// (mmap(2) fails with a platform errno) calls `unported(...)`.
// PORT: `std::fs::File` is the small `File` below (an open fd plus its path, since `Bun.mmap`
// takes a path); `MmapMut` (incremental/codegen) is not ported.

import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { type IoResult, io_error_from_node } from "../std/io.ts";
import { unported } from "../std/panic.ts";
import { Err, Ok } from "../std/result.ts";

/** `std::fs::File` (an open read-only descriptor). */
export class File {
  constructor(
    readonly fd: number,
    readonly path: string,
  ) {}

  /** `File::open(path)` */
  static open(path: string): IoResult<File> {
    try {
      return Ok(new File(openSync(path, "r"), path));
    } catch (e) {
      return Err(io_error_from_node(e));
    }
  }

  /** `drop(file)` */
  close(): void {
    try {
      closeSync(this.fd);
    } catch {
      // `File::drop` ignores close errors.
    }
  }
}

/// A trivial wrapper for [`memmap2::Mmap`] (or `Vec<u8>` on WASM).
export class Mmap {
  constructor(readonly _0: Uint8Array) {}

  /// # Safety
  ///
  /// The given file must not be mutated (i.e., not written, not truncated, ...) until the mapping is closed.
  ///
  /// However in practice most callers do not ensure this, so uses of this function are likely unsound.
  // rustc: compiler/rustc_data_structures/src/memmap.rs:20 map
  static map(file: File): IoResult<Mmap> {
    // By default, memmap2 creates shared mappings, implying that we could see updates to the
    // file through the mapping. That would violate our precondition; so by requesting a
    // map_copy_read_only we do not lose anything.
    // This mapping mode also improves our support for filesystems such as cacheless virtiofs.
    // For more details see https://github.com/rust-lang/rust/issues/122262
    //
    // SAFETY: The caller must ensure that this is safe.
    try {
      const st = fstatSync(file.fd);
      if (!st.isFile()) return unported("rustc_data_structures::memmap::Mmap::map of a non-regular file");
      if (st.size === 0) {
        if (process.platform === "win32") return unported("memmap2 0.2.3 map of an empty file on Windows");
        // memmap2 src/unix.rs:46: "Normally the OS would catch this, but it segfaults under QEMU."
        return Err({ $: "Custom", kind: "InvalidInput", error: "memory map must have a non-zero length" });
      }
      const bytes = typeof Bun !== "undefined" ? Bun.mmap(file.path, { shared: false }) : new Uint8Array(readFileSync(file.fd));
      return Ok(new Mmap(bytes));
    } catch (e) {
      return Err(io_error_from_node(e));
    } finally {
      file.close();
    }
  }

  // rustc: compiler/rustc_data_structures/src/memmap.rs:48 deref
  deref(): Uint8Array {
    return this._0;
  }

  // rustc: compiler/rustc_data_structures/src/memmap.rs:54 as_ref
  as_ref(): Uint8Array {
    return this._0;
  }
}
