import { PostgrestError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { PAGE_ROWS, readAll } from "./read-all";

/** A table of `total` rows behind a server that returns at most `cap` at once, as Supabase does. */
function table(total: number, cap: number) {
  const rows = Array.from({ length: total }, (_, i) => i);
  const requests: [number, number][] = [];
  const page = async (from: number, to: number) => {
    requests.push([from, to]);
    return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null, count: total };
  };
  return { rows, requests, page };
}

describe("readAll", () => {
  it("reads a short list in one request", async () => {
    const { rows, requests, page } = table(420, 1000);
    expect((await readAll(page)).data).toEqual(rows);
    expect(requests).toEqual([[0, PAGE_ROWS - 1]]);
  });

  it("reads past Supabase's 1,000 rows a page at a time", async () => {
    const { rows, requests, page } = table(2500, 1000);
    expect((await readAll(page)).data).toEqual(rows);
    expect(requests).toHaveLength(3);
  });

  it("gets every row however low the limit was set", async () => {
    const { rows, page } = table(1200, 250);
    expect((await readAll(page)).data).toEqual(rows);
  });

  it("stops at what's left when rows go while reading", async () => {
    let call = 0;
    const page = async (from: number) => ({ data: call++ === 0 ? [1, 2] : [], error: null, count: from === 0 ? 5 : 2 });
    expect((await readAll(page)).data).toEqual([1, 2]);
  });

  it("passes an error on rather than half the rows", async () => {
    const error = new PostgrestError({ message: "timeout", details: "", hint: "", code: "57014" });
    let call = 0;
    const page = async () => (call++ === 0 ? { data: [1], error: null, count: 3 } : { data: null, error });
    expect(await readAll(page)).toEqual({ data: null, error });
  });
});
