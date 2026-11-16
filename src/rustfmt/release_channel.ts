// Port of src/tools/rustfmt/src/release_channel.rs (lane rustfmt-contract-1).

/** PORT: `option_env!("CFG_RELEASE_CHANNEL")` as bootstrap set it for the oracle's rustfmt component (the pinned nightly;
 *  as `CFG_RELEASE_CHANNEL` in rustc_driver_impl/lib.ts). Checked against the oracle in config/print_docs.oracle.test.ts: the
 *  oracle accepts `--unstable-features`, which bin/main.rs refuses unless `is_nightly_channel!()`. */
export const CFG_RELEASE_CHANNEL: string | undefined = "nightly";

/// Checks if we're in a nightly build.
///
/// The environment variable `CFG_RELEASE_CHANNEL` is set during the rustc bootstrap
/// to "stable", "beta", or "nightly" depending on what toolchain is being built.
/// If we are being built as part of the stable or beta toolchains, we want
/// to disable unstable configuration options.
///
/// If we're being built by cargo (e.g., `cargo +nightly install rustfmt-nightly`),
/// `CFG_RELEASE_CHANNEL` is not set. As we only support being built against the
/// nightly compiler when installed from crates.io, default to nightly mode.
// PORT: the `macro_rules! is_nightly_channel` (release_channel.rs:12) is a function: its one arm is an expression with no
// macro inputs, so every expansion is this call (`crate::is_nightly_channel!()` → `is_nightly_channel()`).
export function is_nightly_channel(): boolean {
  return CFG_RELEASE_CHANNEL === undefined ? true : CFG_RELEASE_CHANNEL === "nightly" || CFG_RELEASE_CHANNEL === "dev";
}
