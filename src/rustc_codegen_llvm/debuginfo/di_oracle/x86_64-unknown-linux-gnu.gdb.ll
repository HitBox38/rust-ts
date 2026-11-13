; ModuleID = 'gdb.59a7e0cc6e7fded4-cgu.0'
source_filename = "gdb.59a7e0cc6e7fded4-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

; gdb::start::<()>
; Function Attrs: nonlazybind uwtable
define hidden i64 @_RINvCs7HeBztP8FDI_3gdb5startuEB2_(ptr %_main, i64 %_argc, ptr %_argv, i8 %_sigpipe) unnamed_addr #0 !guid !5 {
start:
  ret i64 0
}

; gdb::main
; Function Attrs: nonlazybind uwtable
define hidden void @_RNvCs7HeBztP8FDI_3gdb4main() unnamed_addr #0 !guid !6 {
start:
  ret void
}

; Function Attrs: nonlazybind
define i32 @main(i32 %0, ptr %1) unnamed_addr #1 !guid !7 {
top:
  %2 = sext i32 %0 to i64
; call gdb::start::<()>
  %3 = call i64 @_RINvCs7HeBztP8FDI_3gdb5startuEB2_(ptr @_RNvCs7HeBztP8FDI_3gdb4main, i64 %2, ptr %1, i8 0)
  %4 = trunc i64 %3 to i32
  ret i32 %4
}

attributes #0 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { nonlazybind "target-cpu"="x86-64" }

!llvm.module.flags = !{!0, !1, !2, !3}
!llvm.ident = !{!4}

!0 = !{i32 8, !"PIC Level", i32 2}
!1 = !{i32 7, !"PIE Level", i32 2}
!2 = !{i32 2, !"RtLibUseGOT", i32 1}
!3 = !{i32 7, !"uwtable", i32 2}
!4 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!5 = !{i64 -5550952039340957732}
!6 = !{i64 -7318750184558024473}
!7 = !{i64 -2624081020897602054}
