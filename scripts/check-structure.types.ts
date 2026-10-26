import type { Diagnostic } from "./check-support.types";

/** One entry from the section 4 tree. */
export interface TreeEntry {
  /** Repository-relative path. */
  path: string;
}

/** One row from the section 15 feature ownership map. */
export interface OwnershipEntry {
  /** Feature area named in the leading table cell. */
  area: string;
  /** Paths declared in the row's ownership cells. */
  paths: string[];
}

/** The parsed architecture contract. */
export interface StructureDocument {
  /** Every entry from the section 4 tree. */
  tree: TreeEntry[];
  /** Every row from the section 15 feature ownership map. */
  ownershipMap: OwnershipEntry[];
  /** Setup failures found while parsing the document. */
  errors: Diagnostic[];
}
