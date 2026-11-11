/**
 * Entry details (migration 033): up to three things an event keeps about each entry besides its name, such as a school,
 * a division or a region. The organizer names the fields; each entry's values are kept by field id, so renaming or
 * removing a field never moves another's values. The organizer sees them on the Entries tab and in the results (PDF
 * and CSV), and the LED wall shows them under the entry's name: never the judges' screens or the live results page.
 * Pure, for the forms and the server alike.
 */

export type EntryField = { id: string; name: string };
/** An entry's values, by field id. */
export type EntryDetails = Record<string, string>;

export const MAX_ENTRY_FIELDS = 3;
/**
 * The one general field new events keep, a line of details about each entry ("Grade 10, St. Mary's"). Older events
 * may have named up to three fields of their own, which they keep.
 */
export const GENERAL_DETAILS = "Details";
export const MAX_FIELD_NAME = 40;
export const MAX_DETAIL = 120;

const clean = (value: unknown, max: number) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** An activity's fields as stored: anything that isn't a named field is dropped. */
export function toEntryFields(value: unknown): EntryField[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((f): f is { id: unknown; name: unknown } => typeof f === "object" && f !== null)
    .map((f) => ({ id: String(f.id ?? ""), name: clean(f.name, MAX_FIELD_NAME) }))
    .filter((f) => f.id && f.name)
    .slice(0, MAX_ENTRY_FIELDS);
}

/** An entry's values as stored: text values only. */
export function toEntryDetails(value: unknown): EntryDetails {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""));
}

/** Values typed for an activity's fields, in their order, as stored: empty ones left out. */
export function detailsFor(fields: EntryField[], values: unknown[]): EntryDetails {
  return Object.fromEntries(fields.flatMap((field, i) => (clean(values[i], MAX_DETAIL) ? [[field.id, clean(values[i], MAX_DETAIL)]] : [])));
}

/**
 * One line of an entries list: the name, then the values of the activity's fields, separated by "|" or by tabs (rows
 * pasted from a spreadsheet). Without fields the whole line is the name.
 */
export function parseEntryLine(line: string, fieldCount: number): { name: string; values: string[] } {
  if (fieldCount === 0) return { name: line, values: [] };
  const [name, ...values] = line.split(/\t|\|/);
  return { name, values: values.slice(0, fieldCount) };
}

/** An entry's details as one line, in the fields' order: "Xavier University · Division 2". */
export function detailsLine(fields: EntryField[], details: EntryDetails | undefined): string {
  return fields.flatMap((f) => (details?.[f.id] ? [details[f.id]] : [])).join(" · ");
}
