; ModuleID = 'simd_model.9afd1a81ad4d6422-cgu.0'
source_filename = "simd_model.9afd1a81ad4d6422-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

; Function Attrs: nonlazybind uwtable
define void @h_scatter(<4 x float> %v, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %p, <4 x i8> %m) unnamed_addr #0 !guid !4 {
start:
  %0 = load <4 x ptr>, ptr %p, align 32
  %1 = lshr <4 x i8> %m, splat (i8 7)
  %2 = trunc <4 x i8> %1 to <4 x i1>
  call void @llvm.masked.scatter.v4f32.v4p0(<4 x float> %v, <4 x ptr> align 4 %0, <4 x i1> %2)
  ret void
}

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(write)
declare void @llvm.masked.scatter.v4f32.v4p0(<4 x float>, <4 x ptr>, <4 x i1>) #1

attributes #0 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { nocallback nofree nosync nounwind willreturn memory(write) }

!llvm.module.flags = !{!0, !1, !2}
!llvm.ident = !{!3}

!0 = !{i32 8, !"PIC Level", i32 2}
!1 = !{i32 2, !"RtLibUseGOT", i32 1}
!2 = !{i32 7, !"uwtable", i32 2}
!3 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!4 = !{i64 1985760788327436281}
