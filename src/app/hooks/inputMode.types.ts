/**
 * Key-routing mode declared by the owner of a focused text input.
 *
 * `field` keeps every key in the editor, `search` opts navigation keys back into app dispatch while
 * printable keys keep editing, and `form` is reserved for modal and shell forms.
 */
export type InputMode = "field" | "search" | "form";
