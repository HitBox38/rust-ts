// Port of compiler/rustc_fs_util/src/lib.rs.
//
// PORT (lane locator): only `try_canonicalize` is ported (the crate locator and `CanonicalizedPath::new`
// need it). Not ported (no markers): `fix_windows_verbatim_for_gcc` (:24/:51, Windows linker paths),
// `link_or_copy` (:62), `path_to_c_string` (:88/:99) and `TempDirBuilder` (:113..; output files, M5+).
// `PathBuf` is a UTF-8 string (PORTING section 5).
import { realpathSync } from "node:fs";
import { win32 } from "node:path";
import { io_error_from_node, io_error_other, type IoResult } from "../std/io.ts";
import { unreachable } from "../std/panic.ts";
import { path_components, path_is_absolute, path_join } from "../std/path.ts";
import { Err, Ok } from "../std/result.ts";

// rustc: compiler/rustc_fs_util/src/lib.rs:104 try_canonicalize
export function try_canonicalize(path: string): IoResult<string> {
  // `fs::canonicalize(&path).or_else(|_| absolute(&path))`
  try {
    return Ok(realpathSync.native(path));
  } catch {
    return absolute(path);
  }
}

/**
 * `std::path::absolute` (library/std/src/sys/path/unix.rs `absolute`): an empty path is an error; otherwise the
 * components of `path` (a leading `.` stripped) are appended to `current_dir()` (relative path) or to `/` (`//` if
 * the path starts with exactly two slashes); `.` components and repeated separators disappear, `..` is kept, and
 * a trailing `/` is kept. Windows: `GetFullPathNameW` (node's `path.win32.resolve` normalises the same way).
 * PORT: std helper kept local to its only users' crate (src/std has no `absolute` yet).
 */
function absolute(path: string): IoResult<string> {
  if (path.length === 0) return Err(io_error_other("cannot make an empty path absolute"));
  if (process.platform === "win32") return Ok(win32.resolve(path));
  const comps = path_components(path);
  const parts: string[] = [];
  for (let c = comps.next(); c !== undefined; c = comps.next()) {
    switch (c.$) {
      case "RootDir":
      case "CurDir":
        break;
      case "ParentDir":
        parts.push("..");
        break;
      case "Normal":
        parts.push(c._0);
        break;
      case "Prefix":
        return unreachable("path prefixes are Windows-only");
    }
  }
  let normalized: string;
  if (path_is_absolute(path)) {
    normalized = (path.startsWith("//") && !path.startsWith("///") ? "//" : "/") + parts.join("/");
  } else {
    let cwd: string;
    try {
      cwd = process.cwd();
    } catch (e) {
      return Err(io_error_from_node(e));
    }
    normalized = parts.length === 0 ? cwd : path_join(cwd, parts.join("/"));
  }
  if (path.endsWith("/") && parts.length !== 0) normalized += "/";
  return Ok(normalized);
}
