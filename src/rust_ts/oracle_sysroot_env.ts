// Not upstream: the environment both spawns of the oracle's `rustc +<pin> --print sysroot` use (rustc_session/filesearch.ts
// `default_sysroot`, rust_ts/llvm/tools.ts `oracle_sysroot`), shared so they stay in lockstep (review root-w58-check N2).

/**
 * Only what rustup needs to find the pinned toolchain and what a process needs to start (`PATH`, `HOME`, `RUSTUP_HOME`,
 * `CARGO_HOME`; `USERPROFILE`, `SYSTEMROOT` on Windows, as scripts/lib/env.ts keeps them), and never installing anything.
 * PORT (root at integ-w58): the compile's own environment must not reach the oracle here, or a variable rustc reads at session
 * start (`MACOSX_DEPLOYMENT_TARGET=abc` in codegen_backend.oracle.test.ts) fails this spawn instead of the compile. Upstream's
 * `default_sysroot` reads no environment variable.
 */
export function oracle_sysroot_env(): Record<string, string> {
  const env: Record<string, string> = { RUSTUP_AUTO_INSTALL: "0" };
  for (const k of ["PATH", "HOME", "RUSTUP_HOME", "CARGO_HOME", "USERPROFILE", "SYSTEMROOT"]) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  return env;
}
