/** Form key carrying the commit message through the command form values. */
export type CommitFormKey = "message";

/** Flags that distinguish one commit command variant from another. */
export interface CommitCommandVariant {
  /** True for the amend variants. */
  readonly amend: boolean;
  /** True to pass `--no-verify` for this invocation. */
  readonly noVerify: boolean;
}
