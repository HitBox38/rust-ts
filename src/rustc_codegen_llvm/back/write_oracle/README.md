# write_oracle: oracle fixtures of lane cg-write

Read by `../write.test.ts`. Made from the pinned rustc (`UPSTREAM.json`); never edited by hand.

| file | what |
|---|---|
| `<target>.tm` | the arguments of each `LLVMRustCreateTargetMachine` call the pinned rustc makes for `../../context_oracle/empty.rs` (`--crate-type lib --target <target> --emit=llvm-ir -Cno-prepopulate-passes`, run as `empty.rs` from its directory), one call per line in record.ts's argument form |
| `version.txt` | the `LLVM version:` line of `rustc -vV` |
| `record_tm.py` | the lldb script that reads the arguments at the wrapper's entry (its header gives the stack layout) |
| `record.ts` | the driver that writes `<target>.tm` and `version.txt` |

`LLVMRustCreateTargetMachine` is a wrapper inside librustc_driver, so `src/rust_ts/llvm/record.ts` (which interposes on the exported
LLVM C API) cannot see it; lldb stops at its local symbol instead.

## Re-recording

```
bun src/rustc_codegen_llvm/back/write_oracle/record.ts
```

Needs the pinned toolchain and lldb (Xcode command-line tools) on aarch64-apple-darwin. It prints one line per file written, or one
`ERROR:` line.

**When:** only when the pin changes, when `record_tm.py` changes, or when `../write.test.ts` compiles differently (its flags,
targets, or working directory). The oracle cannot change otherwise, so the unit tests compare against these files and never run
lldb (review cg-write N1); `../write.test.ts` re-runs only `rustc -vV` against `version.txt`. Commit the re-recorded files with the
change that needed them, and check `git diff` shows only what that change explains.
