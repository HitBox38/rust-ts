pm_probe::probe!(
    /// outer doc with "quotes" and 'single' and \ backslash
    //! inner doc é ☃ é
    /** block doc
       with newline and tab	 */
    /*! inner block */
    #[attr] fn f() { let x = [1, (2, 3)]; {} [] () }
);
pm_probe::probe!([] {} (()) [[[x]]]);
