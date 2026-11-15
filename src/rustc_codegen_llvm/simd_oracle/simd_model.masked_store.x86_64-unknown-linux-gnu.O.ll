; ModuleID = 'simd_model.9afd1a81ad4d6422-cgu.0'
source_filename = "simd_model.9afd1a81ad4d6422-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

; Function Attrs: nonlazybind uwtable
define void @h_masked_store_unaligned(<4 x i32> %m, ptr noundef %p, <4 x float> %v) unnamed_addr #0 !guid !4 {
start:
  %0 = lshr <4 x i32> %m, splat (i32 31)
  %1 = trunc <4 x i32> %0 to <4 x i1>
  call void @llvm.masked.store.v4f32.p0(<4 x float> %v, ptr align 1 %p, <4 x i1> %1)
  ret void
}

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: write)
declare void @llvm.masked.store.v4f32.p0(<4 x float>, ptr captures(none), <4 x i1>) #1

attributes #0 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { nocallback nofree nosync nounwind willreturn memory(argmem: write) }

!llvm.module.flags = !{!0, !1, !2}
!llvm.ident = !{!3}

!0 = !{i32 8, !"PIC Level", i32 2}
!1 = !{i32 2, !"RtLibUseGOT", i32 1}
!2 = !{i32 7, !"uwtable", i32 2}
!3 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!4 = !{i64 -7961606330674262668}
