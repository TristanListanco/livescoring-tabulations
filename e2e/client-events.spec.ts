import { expect, test } from "@playwright/test";

// Screens report what went wrong on them, for the server's log: only the kinds it knows, and not without limit.

test("a screen's report is taken, anything else is refused, and a flood is cut off", async ({ request }) => {
  // An address of this test's own, so other tests' reports don't count against it.
  const headers = { "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 250) + 1}`, "content-type": "text/plain;charset=UTF-8" };
  const send = (body: unknown) => request.post("/client-events", { headers, data: JSON.stringify(body) });

  expect((await send({ kind: "realtime_down", where: "/judge/score" })).status()).toBe(204);
  expect((await send({ kind: "delete everything", where: "/" })).status()).toBe(400);
  expect((await request.post("/client-events", { headers, data: "not json" })).status()).toBe(400);

  const statuses: number[] = [];
  for (let i = 0; i < 30; i++) statuses.push((await send({ kind: "action_unreachable", where: "/admin" })).status());
  expect(statuses.at(-1)).toBe(429);
});
