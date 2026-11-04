#!/bin/zsh
# Regenerates the oracle fixtures of the probes of lane miri-x86-a with the isolated Miri (plan-m6 D1). Run from anywhere:
#   RUST_TS_DATA=<data dir> src/miri/intrinsics/x86/probes/regen.sh
# The case table is x86.test.ts's: <name>.oracle.out is stdout, <name>.oracle.stderr stderr and <name>.oracle.exit the exit
# status. A probe called `<probe>.det` runs `<probe>.rs` with `-Zmiri-deterministic-floats`.
set -e
setopt nonomatch
cd "${0:A:h}"
D=$RUST_TS_DATA
run() { # <fixture> <probe> [flags...]
  local fx=$1 p=$2; shift 2
  local e=0
  env -i HOME=$HOME PATH=/usr/bin:/bin RUSTUP_HOME=$D/rustup-miri CARGO_HOME=$D/cargo-miri \
    $D/rustup-miri/toolchains/nightly-2026-10-11-aarch64-apple-darwin/bin/miri --sysroot $D/miri-sysroot \
    --target x86_64-unknown-linux-gnu --edition=2021 "$@" $p.rs > $fx.oracle.out 2> $fx.oracle.stderr || e=$?
  print -r -- $e > $fx.oracle.exit
  rm -f rustc-ice-*
  print -r -- "$fx: exit $e"
}
run sse sse
run sse.det sse -Zmiri-deterministic-floats
run sse2 sse2
run sse2.det sse2 -Zmiri-deterministic-floats
run ssse3 ssse3 -C target-feature=+ssse3
run sse41 sse41 -C target-feature=+sse4.1
run sse41.det sse41 -C target-feature=+sse4.1 -Zmiri-deterministic-floats
run sse42 sse42 -C target-feature=+sse4.2
run adx_pclmul adx_pclmul -C target-feature=+pclmulqdq,+vpclmulqdq,+avx512f
run wide wide -C target-feature=+avx2,+avx512f,+avx512bw,+avx512vbmi
for p in err_feature_sse3 err_feature_ssse3 err_feature_sse41 err_feature_sse42 err_feature_pclmul err_cmp_avx err_unknown_x86 err_unknown_sse err_unknown_sse2 err_argcount err_uninit; do run $p $p; done
run err_ldu_null err_ldu_null -C target-feature=+sse3
# A panic's stderr has the host's paths, a thread id and a native backtrace: only its location and text are kept.
panic_text() { # <fixture>
  grep -A1 ' panicked at ' $1.oracle.stderr | sed -E "s/^thread 'rustc' \\([0-9]+\\)/thread 'rustc'/" > $1.oracle.stderr.tmp
  mv $1.oracle.stderr.tmp $1.oracle.stderr
}
run err_cmp_imm_panic err_cmp_imm_panic; panic_text err_cmp_imm_panic
run err_round_panic err_round_panic -C target-feature=+sse4.1; panic_text err_round_panic
