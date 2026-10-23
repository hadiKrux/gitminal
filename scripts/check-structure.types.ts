import type { Diagnostic } from "./check-support.types";

/** One entry from the section 4 tree. */
export interface TreeEntry {
  /** Repository-relative path. */
  path: string;
}

/** One row from the section 15 doc map. */
export interface DocEntry {
  /** Doc file name. */
  doc: string;
  /** Paths declared in the row's ownership column. */
  paths: string[];
}

/** The parsed architecture contract. */
export interface StructureDocument {
  /** Every entry from the section 4 tree. */
  tree: TreeEntry[];
  /** Every row from the section 15 doc map. */
  docMap: DocEntry[];
  /** Setup failures found while parsing the document. */
  errors: Diagnostic[];
}
