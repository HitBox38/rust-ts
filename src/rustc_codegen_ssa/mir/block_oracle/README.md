# block_oracle: fixtures of mir/block.test.ts (lane ssa-block)

- `block.rs`: a `no_core` crate with one `#[no_mangle]` fn per terminator shape under test (SwitchInt on bool and int,
  Return per `PassMode`, Call with direct and indirect arguments, Drop with and without unwind, an overflow Assert).
- `host.ll`, `msvc.ll`: the pinned nightly's IR for it, unmodified. Made with:

```
rustc +nightly-2026-10-11 --edition=2021 -Copt-level=0 -Cno-prepopulate-passes -Coverflow-checks=on -Cpanic=unwind \
  --emit=llvm-ir -o host.ll block.rs
rustc +nightly-2026-10-11 --target x86_64-pc-windows-msvc --edition=2021 -Copt-level=0 -Cno-prepopulate-passes \
  -Coverflow-checks=on -Cpanic=unwind --emit=llvm-ir -o msvc.ll block.rs
```

The test reads, per fn, each block's label and terminator in print order (the order LLVM keeps blocks in, which is the
order `append_block`/`append_sibling_block` created them) and compares them with the mock backend's recording. The test
itself runs no rustc and reads no environment variable. Regenerate both files with the commands above if the fixture
changes.
