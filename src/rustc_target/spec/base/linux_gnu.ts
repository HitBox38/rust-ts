// compiler/rustc_target/src/spec/base/linux_gnu.rs
import { Env, TargetOptions } from "../mod.ts";
import * as base from "./mod.ts";

// rustc: compiler/rustc_target/src/spec/base/linux_gnu.rs:3 opts
export function opts(): TargetOptions {
  const base_ = TargetOptions.update(base.linux.opts(), {
    env: Env.Gnu,
    static_position_independent_executables: true,
  });

  // When we're asked to use the `rust-lld` linker by default, set the appropriate lld-using
  // linker flavor, and self-contained linker component.
  // PORT: `option_env!("CFG_DEFAULT_LINKER_SELF_CONTAINED_LLD_CC")` is unset in the oracle builds
  // rust-ts runs against (its `--print target-spec-json` for linux-gnu says `"linker-flavor": "gnu-cc"`,
  // checked by src/rustc_target/spec/spec.oracle.test.ts). A Linux-hosted x86_64 dist rustc sets it.
  // if option_env!(..).is_some() {
  //     base.linker_flavor = LinkerFlavor::Gnu(Cc::Yes, Lld::Yes);
  //     base.link_self_contained = crate::spec::LinkSelfContainedDefault::with_linker();
  // }

  return base_;
}
