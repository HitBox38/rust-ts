// Port of compiler/rustc_data_structures/src/memmap.rs (`Mmap`, the read-only map).
//
// PORT: `memmap2::MmapOptions::new().map_copy_read_only(&file)` is `Bun.mmap(path, { shared: false })`
// (a private read-only mapping of the whole file), or `readFileSync` when not running on Bun.
// memmap2 is 0.2.3 (Cargo.lock): on unix an empty file is `io::Error::new(InvalidInput, "memory
// map must have a non-zero length")` (src/unix.rs:46) without calling mmap(2); that is kept (the
// Windows behavior, a `CreateFileMappingW` OS error, is unported). A non-regular file of non-zero
// `st_size` (a directory, say) goes to mmap(2) itself through `bun:ffi`, as memmap2 does, so its errno is the
// host's (darwin: EINVAL for a directory); on Windows it calls `unported(...)` (review link-rlib-native N1).
// PORT: `std::fs::File` is the small `File` below (an open fd plus its path, since `Bun.mmap`
// takes a path); `MmapMut` (incremental/codegen) is not ported.

import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { dlopen, FFIType, type Pointer, toArrayBuffer } from "bun:ffi";
import { errno_reader } from "../std/env.ts";
import { type IoResult, io_error_from_node, io_error_from_raw_os_error } from "../std/io.ts";
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
    // PORT: only the Node calls' errors are `io::Error`s here; an `unported` or a panic is not caught.
    try {
      // memmap2 lib.rs:138 `get_len`: `file.metadata()?.len()`.
      let st;
      try {
        st = fstatSync(file.fd);
      } catch (e) {
        return Err(io_error_from_node(e));
      }
      if (st.size === 0) {
        if (process.platform === "win32") return unported("memmap2 0.2.3 map of an empty file on Windows");
        // memmap2 src/unix.rs:46: "Normally the OS would catch this, but it segfaults under QEMU."
        return Err({ $: "Custom", kind: "InvalidInput", error: "memory map must have a non-zero length" });
      }
      if (!st.isFile()) return map_copy_read_only_ffi(file.fd, st.size);
      try {
        const bytes = typeof Bun !== "undefined" ? Bun.mmap(file.path, { shared: false }) : new Uint8Array(readFileSync(file.fd));
        return Ok(new Mmap(bytes));
      } catch (e) {
        return Err(io_error_from_node(e));
      }
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

const open_mmap_libc = () =>
  dlopen(process.platform === "linux" ? "libc.so.6" : "libSystem.B.dylib", {
    mmap: { args: [FFIType.ptr, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i64], returns: FFIType.i64 },
    munmap: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
  });
let MMAP_LIBC: ReturnType<typeof open_mmap_libc> | undefined;

/**
 * memmap2 0.2.3 src/unix.rs:119 `MmapInner::map_copy_read_only` (through `MmapInner::new`, src/unix.rs:36) at offset 0, for a
 * file that is not a regular one and whose `st_size` is `len` > 0: `mmap(NULL, len, PROT_READ, MAP_PRIVATE, fd, 0)`, and
 * `io::Error::last_os_error()` when it gives `MAP_FAILED`.
 * PORT: `libc::PROT_READ` is 1 and `libc::MAP_PRIVATE` is 2 on both darwin and linux. When the call succeeds (a device that
 * maps), the bytes are copied and the mapping is unmapped at once, where upstream keeps it until the `Mmap` drops: nothing
 * here writes through it or outlives it. Windows (`CreateFileMappingW`) is unported.
 */
// PORT: one function for both memmap2 fns: `map_copy_read_only` at offset 0 and the `MmapInner::new` it calls.
// crate: memmap2-0.2.3/src/unix.rs:119 map_copy_read_only
// crate: memmap2-0.2.3/src/unix.rs:36 new
function map_copy_read_only_ffi(fd: number, len: number): IoResult<Mmap> {
  if (process.platform !== "darwin" && process.platform !== "linux") return unported("memmap2 0.2.3 map of a non-regular file on this host");
  // Taken before the call: its first use runs `dlopen`, which overwrites `errno`.
  const last_errno = errno_reader();
  const libc = (MMAP_LIBC ??= open_mmap_libc()).symbols;
  const p = libc.mmap(null, len, 1 /* PROT_READ */, 2 /* MAP_PRIVATE */, fd, 0);
  if (p === -1n /* MAP_FAILED */) return Err(io_error_from_raw_os_error(last_errno()));
  const addr = Number(p) as Pointer;
  const bytes = new Uint8Array(toArrayBuffer(addr, 0, len)).slice();
  libc.munmap(addr, len);
  return Ok(new Mmap(bytes));
}
