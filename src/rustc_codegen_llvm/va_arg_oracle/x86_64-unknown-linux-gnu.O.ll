; ModuleID = 'va.a8917b4e3b99fe6f-cgu.0'
source_filename = "va.a8917b4e3b99fe6f-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

; core::ptr::drop_glue::<core::ffi::va_list::VaList>
; Function Attrs: nonlazybind uwtable
define internal void @_RINvNtCsajD8mEyjPew_4core3ptr9drop_glueNtNtNtB4_3ffi7va_list6VaListECsethFH3QUqUl_2va(ptr noalias nofree noundef align 8 dereferenceable(24) %_1) unnamed_addr #0 !guid !4 {
start:
; call <core::ffi::va_list::VaList as core::ops::drop::Drop>::drop
  call void @_RNvXs1_NtNtCsajD8mEyjPew_4core3ffi7va_listNtB5_6VaListNtNtNtB9_3ops4drop4Drop4drop(ptr noalias nofree noundef align 8 dereferenceable(24) %_1)
  ret void
}

; core::intrinsics::va_end
; Function Attrs: nounwind nonlazybind uwtable
define internal void @_RNvNtCsajD8mEyjPew_4core10intrinsics6va_end(ptr noalias nofree noundef align 8 dereferenceable(24) %ap) unnamed_addr #1 !guid !5 {
start:
  ret void
}

; core::intrinsics::cold_path
; Function Attrs: cold nounwind nonlazybind uwtable
define internal void @_RNvNtCsajD8mEyjPew_4core10intrinsics9cold_path() unnamed_addr #2 !guid !6 {
start:
  ret void
}

; <core::ffi::va_list::VaList as core::ops::drop::Drop>::drop
; Function Attrs: inlinehint nonlazybind uwtable
define internal void @_RNvXs1_NtNtCsajD8mEyjPew_4core3ffi7va_listNtB5_6VaListNtNtNtB9_3ops4drop4Drop4drop(ptr noalias nofree noundef align 8 dereferenceable(24) %self) unnamed_addr #3 !guid !7 {
start:
; call core::intrinsics::va_end
  call void @_RNvNtCsajD8mEyjPew_4core10intrinsics6va_end(ptr noalias nofree noundef align 8 dereferenceable(24) %self) #9
  ret void
}

; Function Attrs: nounwind nonlazybind uwtable
define noundef i32 @va_int(i32 noundef %n, ...) unnamed_addr #1 personality ptr @rust_eh_personality !guid !8 {
start:
  %0 = alloca [16 x i8], align 8
  %iter = alloca [4 x i8], align 4
  %s = alloca [4 x i8], align 4
  %ap = alloca [24 x i8], align 8
  call void @llvm.lifetime.start.p0(ptr %ap)
  call void @llvm.va_start.p0(ptr %ap)
  store i32 0, ptr %s, align 4
  store i32 0, ptr %iter, align 4
  br label %bb1

bb1:                                              ; preds = %va_arg.end, %start
  %_6 = load i32, ptr %iter, align 4, !noundef !9
  %_5 = icmp slt i32 %_6, %n
  br i1 %_5, label %bb4, label %bb5

bb5:                                              ; preds = %bb1
; invoke core::ptr::drop_glue::<core::ffi::va_list::VaList>
  invoke void @_RINvNtCsajD8mEyjPew_4core3ptr9drop_glueNtNtNtB4_3ffi7va_list6VaListECsethFH3QUqUl_2va(ptr noalias nofree noundef align 8 dereferenceable(24) %ap)
          to label %bb2 unwind label %cleanup

bb4:                                              ; preds = %bb1
  %1 = load i32, ptr %iter, align 4, !noundef !9
  %2 = call { i32, i1 } @llvm.sadd.with.overflow.i32(i32 %1, i32 1)
  %_9.0 = extractvalue { i32, i1 } %2, 0
  %_9.1 = extractvalue { i32, i1 } %2, 1
  store i32 %_9.0, ptr %iter, align 4
  %3 = call i1 @llvm.expect.i1(i1 %_9.1, i1 false)
  br i1 %3, label %bb6, label %bb8

bb3:                                              ; preds = %cleanup
; call core::panicking::panic_cannot_unwind
  call void @_RNvNtCsajD8mEyjPew_4core9panicking19panic_cannot_unwind() #10
  unreachable

cleanup:                                          ; preds = %bb5
  %4 = landingpad { ptr, i32 }
          cleanup
  %5 = extractvalue { ptr, i32 } %4, 0
  %6 = extractvalue { ptr, i32 } %4, 1
  call void @llvm.lifetime.start.p0(ptr %0)
  store ptr %5, ptr %0, align 8
  %7 = getelementptr inbounds i8, ptr %0, i64 8
  store i32 %6, ptr %7, align 8
  br label %bb3

bb2:                                              ; preds = %bb5
  call void @llvm.lifetime.end.p0(ptr %ap)
  %8 = load i32, ptr %s, align 4, !noundef !9
  ret i32 %8

bb8:                                              ; preds = %bb4
  %9 = getelementptr inbounds i8, ptr %ap, i64 4
  %10 = load i32, ptr %ap, align 8
  %11 = load i32, ptr %9, align 4
  %12 = icmp ule i32 %10, 40
  br i1 %12, label %va_arg.in_reg, label %va_arg.in_mem

bb6:                                              ; preds = %bb4
  unreachable

va_arg.in_reg:                                    ; preds = %bb8
  %13 = getelementptr inbounds i8, ptr %ap, i64 16
  %14 = load ptr, ptr %13, align 8
  %15 = getelementptr inbounds i8, ptr %14, i32 %10
  %16 = add i32 %10, 8
  store i32 %16, ptr %ap, align 8
  br label %va_arg.end

va_arg.in_mem:                                    ; preds = %bb8
  %17 = getelementptr inbounds i8, ptr %ap, i64 8
  %18 = load ptr, ptr %17, align 8
  %19 = getelementptr inbounds i8, ptr %18, i32 8
  store ptr %19, ptr %17, align 8
  br label %va_arg.end

va_arg.end:                                       ; preds = %va_arg.in_mem, %va_arg.in_reg
  %20 = phi ptr [ %15, %va_arg.in_reg ], [ %18, %va_arg.in_mem ]
  %_3 = load i32, ptr %20, align 4
  %21 = load i32, ptr %s, align 4, !noundef !9
  %22 = add i32 %21, %_3
  store i32 %22, ptr %s, align 4
  br label %bb1
}

; Function Attrs: nounwind nonlazybind uwtable
define noundef double @va_mixed(...) unnamed_addr #1 personality ptr @rust_eh_personality !guid !10 {
start:
  %0 = alloca [16 x i8], align 8
  %ap = alloca [24 x i8], align 8
  call void @llvm.lifetime.start.p0(ptr %ap)
  call void @llvm.va_start.p0(ptr %ap)
  %1 = getelementptr inbounds i8, ptr %ap, i64 4
  %2 = load i32, ptr %ap, align 8
  %3 = load i32, ptr %1, align 4
  %4 = icmp ule i32 %2, 40
  br i1 %4, label %va_arg.in_reg, label %va_arg.in_mem

va_arg.in_reg:                                    ; preds = %start
  %5 = getelementptr inbounds i8, ptr %ap, i64 16
  %6 = load ptr, ptr %5, align 8
  %7 = getelementptr inbounds i8, ptr %6, i32 %2
  %8 = add i32 %2, 8
  store i32 %8, ptr %ap, align 8
  br label %va_arg.end

va_arg.in_mem:                                    ; preds = %start
  %9 = getelementptr inbounds i8, ptr %ap, i64 8
  %10 = load ptr, ptr %9, align 8
  %11 = getelementptr inbounds i8, ptr %10, i32 8
  store ptr %11, ptr %9, align 8
  br label %va_arg.end

va_arg.end:                                       ; preds = %va_arg.in_mem, %va_arg.in_reg
  %12 = phi ptr [ %7, %va_arg.in_reg ], [ %10, %va_arg.in_mem ]
  %a = load i32, ptr %12, align 4
  %13 = getelementptr inbounds i8, ptr %ap, i64 4
  %14 = load i32, ptr %ap, align 8
  %15 = load i32, ptr %13, align 4
  %16 = icmp ule i32 %15, 160
  br i1 %16, label %va_arg.in_reg1, label %va_arg.in_mem2

va_arg.in_reg1:                                   ; preds = %va_arg.end
  %17 = getelementptr inbounds i8, ptr %ap, i64 16
  %18 = load ptr, ptr %17, align 8
  %19 = getelementptr inbounds i8, ptr %18, i32 %15
  %20 = add i32 %15, 16
  store i32 %20, ptr %13, align 4
  br label %va_arg.end3

va_arg.in_mem2:                                   ; preds = %va_arg.end
  %21 = getelementptr inbounds i8, ptr %ap, i64 8
  %22 = load ptr, ptr %21, align 8
  %23 = getelementptr inbounds i8, ptr %22, i32 8
  store ptr %23, ptr %21, align 8
  br label %va_arg.end3

va_arg.end3:                                      ; preds = %va_arg.in_mem2, %va_arg.in_reg1
  %24 = phi ptr [ %19, %va_arg.in_reg1 ], [ %22, %va_arg.in_mem2 ]
  %b = load double, ptr %24, align 8
  %25 = getelementptr inbounds i8, ptr %ap, i64 4
  %26 = load i32, ptr %ap, align 8
  %27 = load i32, ptr %25, align 4
  %28 = icmp ule i32 %26, 40
  br i1 %28, label %va_arg.in_reg4, label %va_arg.in_mem5

va_arg.in_reg4:                                   ; preds = %va_arg.end3
  %29 = getelementptr inbounds i8, ptr %ap, i64 16
  %30 = load ptr, ptr %29, align 8
  %31 = getelementptr inbounds i8, ptr %30, i32 %26
  %32 = add i32 %26, 8
  store i32 %32, ptr %ap, align 8
  br label %va_arg.end6

va_arg.in_mem5:                                   ; preds = %va_arg.end3
  %33 = getelementptr inbounds i8, ptr %ap, i64 8
  %34 = load ptr, ptr %33, align 8
  %35 = getelementptr inbounds i8, ptr %34, i32 8
  store ptr %35, ptr %33, align 8
  br label %va_arg.end6

va_arg.end6:                                      ; preds = %va_arg.in_mem5, %va_arg.in_reg4
  %36 = phi ptr [ %31, %va_arg.in_reg4 ], [ %34, %va_arg.in_mem5 ]
  %c = load i64, ptr %36, align 8
  %37 = getelementptr inbounds i8, ptr %ap, i64 4
  %38 = load i32, ptr %ap, align 8
  %39 = load i32, ptr %37, align 4
  %40 = icmp ule i32 %38, 40
  br i1 %40, label %va_arg.in_reg7, label %va_arg.in_mem8

va_arg.in_reg7:                                   ; preds = %va_arg.end6
  %41 = getelementptr inbounds i8, ptr %ap, i64 16
  %42 = load ptr, ptr %41, align 8
  %43 = getelementptr inbounds i8, ptr %42, i32 %38
  %44 = add i32 %38, 8
  store i32 %44, ptr %ap, align 8
  br label %va_arg.end9

va_arg.in_mem8:                                   ; preds = %va_arg.end6
  %45 = getelementptr inbounds i8, ptr %ap, i64 8
  %46 = load ptr, ptr %45, align 8
  %47 = getelementptr inbounds i8, ptr %46, i32 8
  store ptr %47, ptr %45, align 8
  br label %va_arg.end9

va_arg.end9:                                      ; preds = %va_arg.in_mem8, %va_arg.in_reg7
  %48 = phi ptr [ %43, %va_arg.in_reg7 ], [ %46, %va_arg.in_mem8 ]
  %d = load i64, ptr %48, align 8
  %49 = getelementptr inbounds i8, ptr %ap, i64 4
  %50 = load i32, ptr %ap, align 8
  %51 = load i32, ptr %49, align 4
  %52 = icmp ule i32 %50, 40
  br i1 %52, label %va_arg.in_reg10, label %va_arg.in_mem11

va_arg.in_reg10:                                  ; preds = %va_arg.end9
  %53 = getelementptr inbounds i8, ptr %ap, i64 16
  %54 = load ptr, ptr %53, align 8
  %55 = getelementptr inbounds i8, ptr %54, i32 %50
  %56 = add i32 %50, 8
  store i32 %56, ptr %ap, align 8
  br label %va_arg.end12

va_arg.in_mem11:                                  ; preds = %va_arg.end9
  %57 = getelementptr inbounds i8, ptr %ap, i64 8
  %58 = load ptr, ptr %57, align 8
  %59 = getelementptr inbounds i8, ptr %58, i32 8
  store ptr %59, ptr %57, align 8
  br label %va_arg.end12

va_arg.end12:                                     ; preds = %va_arg.in_mem11, %va_arg.in_reg10
  %60 = phi ptr [ %55, %va_arg.in_reg10 ], [ %58, %va_arg.in_mem11 ]
  %p = load ptr, ptr %60, align 8
  %61 = getelementptr inbounds i8, ptr %ap, i64 4
  %62 = load i32, ptr %ap, align 8
  %63 = load i32, ptr %61, align 4
  %64 = icmp ule i32 %62, 40
  br i1 %64, label %va_arg.in_reg13, label %va_arg.in_mem14

va_arg.in_reg13:                                  ; preds = %va_arg.end12
  %65 = getelementptr inbounds i8, ptr %ap, i64 16
  %66 = load ptr, ptr %65, align 8
  %67 = getelementptr inbounds i8, ptr %66, i32 %62
  %68 = add i32 %62, 8
  store i32 %68, ptr %ap, align 8
  br label %va_arg.end15

va_arg.in_mem14:                                  ; preds = %va_arg.end12
  %69 = getelementptr inbounds i8, ptr %ap, i64 8
  %70 = load ptr, ptr %69, align 8
  %71 = getelementptr inbounds i8, ptr %70, i32 8
  store ptr %71, ptr %69, align 8
  br label %va_arg.end15

va_arg.end15:                                     ; preds = %va_arg.in_mem14, %va_arg.in_reg13
  %72 = phi ptr [ %67, %va_arg.in_reg13 ], [ %70, %va_arg.in_mem14 ]
  %u = load i64, ptr %72, align 8
  %_18 = uitofp i32 %a to double
  %_17 = fadd double %_18, %b
  %_19 = sitofp i64 %c to double
  %_16 = fadd double %_17, %_19
  %_20 = uitofp i64 %d to double
  %_15 = fadd double %_16, %_20
  %_22 = load i8, ptr %p, align 1, !noundef !9
  %_21 = sitofp i8 %_22 to double
  %_14 = fadd double %_15, %_21
  %_23 = uitofp i64 %u to double
  %_0 = fadd double %_14, %_23
; invoke core::ptr::drop_glue::<core::ffi::va_list::VaList>
  invoke void @_RINvNtCsajD8mEyjPew_4core3ptr9drop_glueNtNtNtB4_3ffi7va_list6VaListECsethFH3QUqUl_2va(ptr noalias nofree noundef align 8 dereferenceable(24) %ap)
          to label %bb1 unwind label %cleanup

bb2:                                              ; preds = %cleanup
; call core::panicking::panic_cannot_unwind
  call void @_RNvNtCsajD8mEyjPew_4core9panicking19panic_cannot_unwind() #10
  unreachable

cleanup:                                          ; preds = %va_arg.end15
  %73 = landingpad { ptr, i32 }
          cleanup
  %74 = extractvalue { ptr, i32 } %73, 0
  %75 = extractvalue { ptr, i32 } %73, 1
  call void @llvm.lifetime.start.p0(ptr %0)
  store ptr %74, ptr %0, align 8
  %76 = getelementptr inbounds i8, ptr %0, i64 8
  store i32 %75, ptr %76, align 8
  br label %bb2

bb1:                                              ; preds = %va_arg.end15
  call void @llvm.lifetime.end.p0(ptr %ap)
  ret double %_0
}

; Function Attrs: nounwind nonlazybind uwtable
declare noundef range(i32 0, 10) i32 @rust_eh_personality(i32 noundef, i32 noundef, i64 noundef, ptr noundef, ptr noundef) unnamed_addr #1

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: readwrite)
declare void @llvm.lifetime.start.p0(ptr captures(none)) #4

; Function Attrs: nocallback nofree nosync nounwind willreturn
declare void @llvm.va_start.p0(ptr) #5

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: readwrite)
declare void @llvm.lifetime.end.p0(ptr captures(none)) #4

; core::panicking::panic_cannot_unwind
; Function Attrs: cold minsize noinline noreturn nounwind nonlazybind optsize uwtable
declare void @_RNvNtCsajD8mEyjPew_4core9panicking19panic_cannot_unwind() unnamed_addr #6

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare { i32, i1 } @llvm.sadd.with.overflow.i32(i32, i32) #7

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(none)
declare i1 @llvm.expect.i1(i1, i1) #8

attributes #0 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { nounwind nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #2 = { cold nounwind nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #3 = { inlinehint nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #4 = { nocallback nofree nosync nounwind willreturn memory(argmem: readwrite) }
attributes #5 = { nocallback nofree nosync nounwind willreturn }
attributes #6 = { cold minsize noinline noreturn nounwind nonlazybind optsize uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #7 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #8 = { nocallback nofree nosync nounwind willreturn memory(none) }
attributes #9 = { nounwind }
attributes #10 = { cold noreturn nounwind }

!llvm.module.flags = !{!0, !1, !2}
!llvm.ident = !{!3}

!0 = !{i32 8, !"PIC Level", i32 2}
!1 = !{i32 2, !"RtLibUseGOT", i32 1}
!2 = !{i32 7, !"uwtable", i32 2}
!3 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!4 = !{i64 1938643948326462259}
!5 = !{i64 -1791176356134181224}
!6 = !{i64 4366546579527043967}
!7 = !{i64 -2124647521652766873}
!8 = !{i64 -5792406000586663505}
!9 = !{}
!10 = !{i64 844313029110074370}
