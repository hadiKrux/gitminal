/** Column budgets shared by the top-bar status strip and the action buttons. */
export interface TopBarBudgets {
  /** Columns available to the status strip. */
  readonly statusWidth: number;
  /** Maximum columns a disabled action's reason may use; zero when every action is enabled. */
  readonly reasonWidth: number;
}
