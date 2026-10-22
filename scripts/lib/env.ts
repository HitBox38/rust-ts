// The environment of the processes difftest compares (lane harness-w20c). Both sides of a case run with the
// caller's environment, minus the variables below (the "scrubbed" ones), plus the case's own `Case.env`. The
// scrubbed variables change what rustc, a rustc-dev probe or the subject prints, but they are not part of the
// oracle cache key, so a caller who happens to export one (a `RUSTC_LOG=debug` shell, a terminal that sets
// `CLICOLOR_FORCE`, a shell under `cargo run`) would otherwise put its output into the shared cache. Unsetting
// them gives every run the output of a clean environment; a case that needs one sets it in `Case.env`, which
// wins (compiletest's `rustc-env`, `RUSTC_ICE=0`, `RUST_BACKTRACE=0`/`short`, ...).
//
// Audit (the pinned sources' run-time `env::var`/`var_os` reads in compiler/ and library/std, outside build
// scripts, codegen backends and tests; rustup; anstream/anstyle-query; Bun):
// - logging: `RUSTC_LOG` and its `_COLOR`/`_ENTRY_EXIT`/`_THREAD_IDS`/`_BACKTRACE`/`_WRAPTREE`/`_LINES`/
//   `_FORMAT_JSON`/`_OUTPUT_TARGET` companions (rustc_log `LoggerConfig::from_env`; rustc_driver_impl::main and
//   the probes call `init_rustc_env_logger`): the `RUSTC_LOG` prefix;
// - panics and ICEs: `RUST_BACKTRACE`, `RUST_LIB_BACKTRACE` (std panic hook, `Backtrace::capture`,
//   rustc_driver_impl's ICE hook, rustc_errors' delayed bugs), `RUSTC_ICE` (where the ICE report file goes),
//   `RUSTC_BREAK_ON_ICE`, `RUSTC_CTFE_BACKTRACE` (const-eval error backtraces);
// - behaviour: `RUSTC_BOOTSTRAP` (nightly features on/off), `RUSTC_FORCE_RUSTC_VERSION` (crate hashes, so
//   `StableCrateId`s and def path hashes), `RUSTC_OVERRIDE_VERSION_STRING`, `RUST_MIN_STACK` (rustc's thread
//   stack: where a deep recursion overflows), `RUST_TARGET_PATH` (target spec search path),
//   `RAYON_NUM_THREADS`/`RAYON_RS_NUM_CPUS`, the `RUST_DEP_GRAPH*` debug dumps, `RUSTC_GRAPHVIZ_FONT`;
// - diagnostics rendering: `CLICOLOR_FORCE` (anstream colours a pipe when it is set; rustc_errors'
//   `ColorConfig::Auto` goes through `AutoStream::choice`), `CLICOLOR`, `NO_COLOR`, `COLORTERM` + `TERM`
//   (rustc_session `default_emitter`: `-Zterminal-urls=auto` turns error-code hyperlinks on for
//   `truecolor`/`xterm-256color`), `FORCE_COLOR` (Bun's own error output);
// - `env!`/`option_env!` of variables a cargo build sets: `CARGO` and the `CARGO_` prefix (`CARGO_PKG_*`,
//   `CARGO_MANIFEST_DIR`, `CARGO_CRATE_NAME`, ...; tests/ui reads several, e.g. env-macro typo tests), except
//   `CARGO_HOME`, which rustup needs to find the oracle toolchain;
// - macOS libmalloc debugging (`MallocStackLogging`, `MallocScribble`, `MallocGuardEdges`, ...: some print a
//   `malloc: ...` line to stderr of every process): the `Malloc` prefix.
// Not scrubbed: what the processes need to start and find the toolchain (`PATH`, `HOME`, `USERPROFILE`,
// `SYSTEMROOT`, `TMPDIR`/`TEMP`/`TMP`, `RUSTUP_*`, `CARGO_HOME`, `RUST_TS_*`, loader paths). Session variables a
// case's sources may read through `env!` (`PATH`, `HOME`, `PWD`, ...) are pinned per case instead
// (harness/suites.ts `pinSessionEnv`).
//
// Windows (`platform === "win32"`): variable names are case-insensitive there and Bun/Node keep the spelling the
// variable was created with (typically `Path`), so overlaying `PATH` onto a copy of `process.env` would pass both
// `Path` and `PATH` to the child. `mergeEnv` therefore replaces or removes every spelling of a name on Windows.
// On other platforms names are case-sensitive and `mergeEnv` is a plain overlay.

/** Scrubbed variables, by exact name (see the header). */
export const SCRUBBED_ENV_VARS: readonly string[] = [
  "RUST_BACKTRACE",
  "RUST_LIB_BACKTRACE",
  "RUSTC_ICE",
  "RUSTC_BREAK_ON_ICE",
  "RUSTC_CTFE_BACKTRACE",
  "RUSTC_BOOTSTRAP",
  "RUSTC_FORCE_RUSTC_VERSION",
  "RUSTC_OVERRIDE_VERSION_STRING",
  "RUST_MIN_STACK",
  "RUST_TARGET_PATH",
  "RAYON_NUM_THREADS",
  "RAYON_RS_NUM_CPUS",
  "RUST_DEP_GRAPH",
  "RUST_DEP_GRAPH_FILTER",
  "RUST_FORBID_DEP_GRAPH_EDGE",
  "RUSTC_GRAPHVIZ_FONT",
  "CLICOLOR_FORCE",
  "CLICOLOR",
  "NO_COLOR",
  "FORCE_COLOR",
  "COLORTERM",
  "TERM",
  "CARGO",
];

/** Scrubbed variables, by name prefix (see the header). */
export const SCRUBBED_ENV_PREFIXES: readonly string[] = ["RUSTC_LOG", "CARGO_", "Malloc"];

/** Never scrubbed, even if a prefix matches. */
export const KEPT_ENV_VARS: readonly string[] = ["CARGO_HOME"];

const sameName = (a: string, b: string, platform: string): boolean => (platform === "win32" ? a.toUpperCase() === b.toUpperCase() : a === b);
const hasPrefix = (k: string, p: string, platform: string): boolean => (platform === "win32" ? k.toUpperCase().startsWith(p.toUpperCase()) : k.startsWith(p));

/** Whether `k` is a scrubbed variable (see the header). */
export function isScrubbedEnvVar(k: string, platform: string = process.platform): boolean {
  if (KEPT_ENV_VARS.some((v) => sameName(k, v, platform))) return false;
  return SCRUBBED_ENV_VARS.some((v) => sameName(k, v, platform)) || SCRUBBED_ENV_PREFIXES.some((p) => hasPrefix(k, p, platform));
}

/**
 * `{ <name>: null }` for every scrubbed variable set in `base` (spelled as in `base`): an overlay for `run()` /
 * `mergeEnv` that removes them. A case's `Case.env` goes after it, so the case's own values win.
 */
export function scrubbedEnv(base: Record<string, string | undefined> = process.env, platform: string = process.platform): Record<string, null> {
  const out: Record<string, null> = {};
  for (const k of Object.keys(base)) if (base[k] !== undefined && isScrubbedEnvVar(k, platform)) out[k] = null;
  return out;
}

/** `scrubbedEnv()` followed by `env` (which wins): the overlay both sides of a difftest case run with. */
export function caseEnv(env: Record<string, string | null> | undefined, base: Record<string, string | undefined> = process.env, platform: string = process.platform): Record<string, string | null> {
  return { ...scrubbedEnv(base, platform), ...env };
}

/**
 * `base` with `overlay` applied in order: a string sets the variable, `null` removes it. On Windows every spelling
 * of the name is replaced or removed (see the header); elsewhere this is a plain overlay.
 */
export function mergeEnv(base: Record<string, string | undefined>, overlay: Record<string, string | null> = {}, platform: string = process.platform): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) env[k] = v;
  for (const [k, v] of Object.entries(overlay)) {
    // Windows: drop the other spellings of the name (an existing entry spelled exactly `k` is updated in place, as
    // everywhere).
    if (platform === "win32") for (const e of Object.keys(env)) if (e !== k && sameName(e, k, platform)) delete env[e];
    if (v === null) delete env[k];
    else env[k] = v;
  }
  return env;
}

/** The value of `name` in `base`; on Windows the name matches case-insensitively. */
export function getEnv(base: Record<string, string | undefined>, name: string, platform: string = process.platform): string | undefined {
  if (platform !== "win32") return base[name];
  for (const [k, v] of Object.entries(base)) if (v !== undefined && sameName(k, name, platform)) return v;
  return undefined;
}

/**
 * The variables pinned with `PATH` for an oracle process whose PATH must not depend on the caller
 * (scripts/lib/oracle.ts `oraclePathEnv`): `PATH` itself and, on Windows only, `RUSTUP_WINDOWS_PATH_ADD_BIN=0`.
 * rustup's `Toolchain::set_ldpath` (rust-lang/rustup src/toolchain.rs) prepends `$CARGO_HOME/bin` to the PATH of
 * the rustc it runs when that directory is missing, which `dir` makes a no-op, and on Windows it also appends the
 * toolchain's own `bin` directory when `RUSTUP_WINDOWS_PATH_ADD_BIN` is `1` (the default in older rustup
 * releases), which the subject would never see; `0` turns that off in every release. Other platforms get `PATH`
 * alone (unchanged from lane harness-w20b, so their cases and cache keys are unchanged).
 */
export function pinnedPathEnv(dir: string, platform: string = process.platform): Record<string, string> {
  return platform === "win32" ? { PATH: dir, RUSTUP_WINDOWS_PATH_ADD_BIN: "0" } : { PATH: dir };
}
