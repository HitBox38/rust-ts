// Not an upstream mirror. PORT: stand-ins for crates the driver path reaches but that are not ported:
//   rustc_codegen_ssa::traits::CodegenBackend, rustc_codegen_llvm::LlvmCodegenBackend
//   rustc_data_structures::jobserver::initialize
//   rustc_middle::ty::CurrentGcx
//   rustc_parse entry points (pending lane parser-core; see `pending_parser` below)
// Each keeps only what can be copied verbatim or is observable-free on the `-Zunpretty` path; everything
// else calls `unported(...)`. Replace by the real modules when those crates are ported.
import type { CodegenBackendInit, EarlySession, Session } from "../rustc_session/session.ts";
import { defer_field } from "../rustc_session/stand_ins.ts";
import { std_print } from "../rustc_session/config.ts";
import { unported } from "../std/panic.ts";

/** `rustc_codegen_ssa::traits::CodegenBackend` (the methods the driver path calls). */
export interface CodegenBackend {
  name(): string;
  init(sess: EarlySession): CodegenBackendInit;
  target_config(sess: Session): never;
  print_version(): void;
  print_passes(): void;
  metadata_loader(): never;
}

/**
 * `rustc_codegen_llvm::LlvmCodegenBackend` (stand-in). The pinned nightly is built with
 * `CFG_DEFAULT_CODEGEN_BACKEND=llvm`.
 * - `init` (LLVM initialisation; reports nothing for default `-C llvm-args`/`-C target-feature`): returns a
 *   `CodegenBackendInit` whose fields are deferred (reading one calls `unported`).
 * - `print_version`: `llvm_util::print_version` prints `LLVM version: {major}.{minor}.{patch}` of the LLVM
 *   the oracle was built with (`LLVM_VERSION`, checked against `rustc -vV` in driver.oracle.test.ts).
 */
export class LlvmCodegenBackend implements CodegenBackend {
  /** `LlvmCodegenBackend::new` */
  static new(): CodegenBackend {
    return new LlvmCodegenBackend();
  }
  name(): string {
    return "llvm";
  }
  init(_sess: EarlySession): CodegenBackendInit {
    const init = {} as CodegenBackendInit;
    for (const key of ["global_backend_features", "replaced_intrinsics", "fallback_intrinsics", "thin_lto_supported"] as const) {
      defer_field(init, key, `rustc_codegen_llvm::LlvmCodegenBackend::init (${key})`);
    }
    return init;
  }
  target_config(_sess: Session): never {
    return unported("rustc_codegen_llvm::LlvmCodegenBackend::target_config");
  }
  print_version(): void {
    std_print(`LLVM version: ${LLVM_VERSION}\n`);
  }
  print_passes(): void {
    unported("rustc_codegen_llvm::LlvmCodegenBackend::print_passes (-C passes=list)");
  }
  metadata_loader(): never {
    return unported("rustc_codegen_llvm::LlvmCodegenBackend::metadata_loader");
  }
}

/** PORT: build constant of the oracle (its bundled LLVM), like `CFG_VERSION`; see `LlvmCodegenBackend`. */
export const LLVM_VERSION = "23.1.3";

/**
 * `rustc_data_structures::jobserver::initialize` (stand-in). Upstream inherits a jobserver from
 * `CARGO_MAKEFLAGS`/`MAKEFLAGS`/`MFLAGS` (`Client::from_env_ext`) and reports a malformed one; with none
 * of them set (`FromEnvErrorKind::NoEnvVar`) it silently creates its own client. Only that case is kept.
 */
export function jobserver_initialize(_limit: number, _report: (err: string) => void): void {
  for (const v of ["CARGO_MAKEFLAGS", "MAKEFLAGS", "MFLAGS"]) {
    if (process.env[v] !== undefined) {
      unported(`rustc_data_structures::jobserver::initialize (inherited jobserver: ${v} is set)`);
    }
  }
}

/** `rustc_middle::ty::CurrentGcx` (opaque: no `GlobalCtxt` is ever created). */
export class CurrentGcx {
  static new(): CurrentGcx {
    return new CurrentGcx();
  }
}
