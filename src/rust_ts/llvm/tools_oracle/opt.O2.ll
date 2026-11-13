; ModuleID = 'opt.2c18e1863cf3b211-cgu.0'
source_filename = "opt.2c18e1863cf3b211-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

@_RNvCs3MJ9DESUAaP_3opt6twin_b = unnamed_addr alias i64 (i64, i64), ptr @_RNvCs3MJ9DESUAaP_3opt6twin_a

; opt::sum
; Function Attrs: nofree noinline norecurse nosync nounwind nonlazybind memory(argmem: read) uwtable
define noundef i32 @_RNvCs3MJ9DESUAaP_3opt3sum(ptr noalias nofree noundef nonnull readonly align 4 captures(address) %xs.0, i64 noundef range(i64 0, 2305843009213693952) %xs.1) unnamed_addr #0 !guid !4 {
start:
  %_12.idx = shl nuw nsw i64 %xs.1, 2
  %_12 = getelementptr inbounds nuw i8, ptr %xs.0, i64 %_12.idx
  %_192 = icmp eq i64 %xs.1, 0
  br i1 %_192, label %bb2, label %bb3.preheader

bb3.preheader:                                    ; preds = %start
  %0 = add nsw i64 %_12.idx, -4
  %1 = lshr exact i64 %0, 2
  %2 = add nuw nsw i64 %1, 1
  %min.iters.check = icmp ult i64 %0, 28
  br i1 %min.iters.check, label %bb3.preheader7, label %vector.ph

vector.ph:                                        ; preds = %bb3.preheader
  %n.vec = and i64 %2, 9223372036854775800
  %3 = shl i64 %n.vec, 2
  %4 = getelementptr i8, ptr %xs.0, i64 %3
  br label %vector.body

vector.body:                                      ; preds = %vector.body, %vector.ph
  %index = phi i64 [ 0, %vector.ph ], [ %index.next, %vector.body ]
  %vec.phi = phi <4 x i32> [ zeroinitializer, %vector.ph ], [ %9, %vector.body ]
  %vec.phi5 = phi <4 x i32> [ zeroinitializer, %vector.ph ], [ %10, %vector.body ]
  %5 = shl i64 %index, 2
  %next.gep = getelementptr i8, ptr %xs.0, i64 %5
  %6 = getelementptr i8, ptr %next.gep, i64 16
  %wide.load = load <4 x i32>, ptr %next.gep, align 4
  %wide.load6 = load <4 x i32>, ptr %6, align 4
  %7 = mul <4 x i32> %wide.load, splat (i32 3)
  %8 = mul <4 x i32> %wide.load6, splat (i32 3)
  %9 = add <4 x i32> %7, %vec.phi
  %10 = add <4 x i32> %8, %vec.phi5
  %index.next = add nuw i64 %index, 8
  %11 = icmp eq i64 %index.next, %n.vec
  br i1 %11, label %middle.block, label %vector.body, !llvm.loop !5

middle.block:                                     ; preds = %vector.body
  %bin.rdx = add <4 x i32> %10, %9
  %12 = tail call i32 @llvm.vector.reduce.add.v4i32(<4 x i32> %bin.rdx)
  %cmp.n = icmp eq i64 %2, %n.vec
  br i1 %cmp.n, label %bb2, label %bb3.preheader7

bb3.preheader7:                                   ; preds = %bb3.preheader, %middle.block
  %s.sroa.0.04.ph = phi i32 [ 0, %bb3.preheader ], [ %12, %middle.block ]
  %iter.sroa.0.03.ph = phi ptr [ %xs.0, %bb3.preheader ], [ %4, %middle.block ]
  br label %bb3

bb3:                                              ; preds = %bb3.preheader7, %bb3
  %s.sroa.0.04 = phi i32 [ %_5, %bb3 ], [ %s.sroa.0.04.ph, %bb3.preheader7 ]
  %iter.sroa.0.03 = phi ptr [ %_25, %bb3 ], [ %iter.sroa.0.03.ph, %bb3.preheader7 ]
  %_25 = getelementptr inbounds nuw i8, ptr %iter.sroa.0.03, i64 4
  %_7 = load i32, ptr %iter.sroa.0.03, align 4, !noundef !8
  %_6 = mul i32 %_7, 3
  %_5 = add i32 %_6, %s.sroa.0.04
  %_19 = icmp eq ptr %_25, %_12
  br i1 %_19, label %bb2, label %bb3, !llvm.loop !9

bb2:                                              ; preds = %bb3, %middle.block, %start
  %s.sroa.0.0.lcssa = phi i32 [ 0, %start ], [ %12, %middle.block ], [ %_5, %bb3 ]
  ret i32 %s.sroa.0.0.lcssa
}

; opt::caller
; Function Attrs: mustprogress nofree noinline norecurse nosync nounwind nonlazybind willreturn memory(none) uwtable
define noundef range(i32 4, 1) i32 @_RNvCs3MJ9DESUAaP_3opt6caller(i32 noundef %x) unnamed_addr #1 !guid !10 {
start:
  %factor = shl i32 %x, 2
  %_0 = add i32 %factor, 4
  ret i32 %_0
}

; opt::twin_a
; Function Attrs: mustprogress nofree noinline norecurse nosync nounwind nonlazybind willreturn memory(none) uwtable
define noundef i64 @_RNvCs3MJ9DESUAaP_3opt6twin_a(i64 noundef %a, i64 noundef %b) unnamed_addr #1 personality ptr @rust_eh_personality !guid !11 {
start:
  %_4 = mul i64 %b, %a
  %_0.i = tail call noundef i64 @llvm.fshl.i64(i64 %_4, i64 %_4, i64 7)
  %_0 = xor i64 %_0.i, %b
  ret i64 %_0
}

; Function Attrs: nonlazybind
declare i32 @rust_eh_personality(...) unnamed_addr #2

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.fshl.i64(i64, i64, i64) #3

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i32 @llvm.vector.reduce.add.v4i32(<4 x i32>) #4

attributes #0 = { nofree noinline norecurse nosync nounwind nonlazybind memory(argmem: read) uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { mustprogress nofree noinline norecurse nosync nounwind nonlazybind willreturn memory(none) uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #2 = { nonlazybind "target-cpu"="x86-64" }
attributes #3 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #4 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }

!llvm.module.flags = !{!0, !1, !2}
!llvm.ident = !{!3}

!0 = !{i32 8, !"PIC Level", i32 2}
!1 = !{i32 2, !"RtLibUseGOT", i32 1}
!2 = !{i32 7, !"uwtable", i32 2}
!3 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!4 = !{i64 2214553141500644640}
!5 = distinct !{!5, !6, !7}
!6 = !{!"llvm.loop.isvectorized", i32 1}
!7 = !{!"llvm.loop.unroll.runtime.disable"}
!8 = !{}
!9 = distinct !{!9, !7, !6}
!10 = !{i64 -7132310722193279290}
!11 = !{i64 -6519570378415343707}
