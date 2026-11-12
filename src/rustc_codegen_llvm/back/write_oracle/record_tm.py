# Records the arguments of the pinned rustc's `LLVMRustCreateTargetMachine` calls (lane cg-write). record.ts runs it
# by hand to write the fixtures ../write.test.ts reads (README.md); no test runs it.
#
# `LLVMRustCreateTargetMachine` is a wrapper inside librustc_driver, so src/rust_ts/llvm/record.ts (which interposes on the
# exported LLVM C API) never sees it. Its symbol is in the dylib's local symbol table, so lldb can stop at its entry:
#   lldb --batch -o "command script import record_tm.py" -o "process handle -p true -s false -n false SIGUSR1" -o run \
#        -k "process kill" -- <sysroot>/bin/rustc <args>
# prints one `RECORD\t<call>` line per call, in record.ts's argument form: strings as byte strings, enums as their ffi.rs
# discriminants, bools as 0/1. aarch64 Apple ABI: the first 8 arguments in x0-x7; the rest on the stack at their natural
# size and alignment (9 bools at sp+0..8, the two `*const c_char` at sp+16 and sp+24, `CompressionKind` (u32) at sp+32,
# two bools at sp+36 and sp+37, `LargeDataThreshold: u64` at sp+40).
import lldb
def q(b):
    if b is None: return "null"
    s = '"'
    for c in b:
        s += chr(c) if 0x20 <= c < 0x7f and c not in (0x22, 0x5c) else "\\%02X" % c
    return s + '"'
def cstr(p, a):
    if a == 0: return None
    err = lldb.SBError(); out = bytearray()
    while True:
        b = p.ReadMemory(a + len(out), 1, err)
        if not err.Success() or b[0] == 0: break
        out += b
    return bytes(out)
def cb(frame, bp_loc, d):
    p = frame.GetThread().GetProcess(); err = lldb.SBError()
    r = lambda n: frame.FindRegister(n).GetValueAsUnsigned()
    sp = r("sp"); m = p.ReadMemory(sp, 48, err)
    u = lambda o, n: int.from_bytes(m[o:o + n], "little")
    args = [q(cstr(p, r("x%d" % i))) for i in range(4)] + [str(r("x%d" % i) & 0xffffffff) for i in range(4, 8)]
    args += [str(m[i] & 1) for i in range(9)]
    args += [q(cstr(p, u(16, 8))), q(cstr(p, u(24, 8))), str(u(32, 4)), str(m[36] & 1), str(m[37] & 1), str(u(40, 8))]
    print("RECORD\tLLVMRustCreateTargetMachine(" + ", ".join(args) + ")", flush=True)
    return False
def __lldb_init_module(debugger, d):
    t = debugger.GetSelectedTarget()
    bp = t.BreakpointCreateByName("LLVMRustCreateTargetMachine")
    bp.SetScriptCallbackFunction(__name__ + ".cb")
