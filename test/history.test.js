const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../hunter/evaluate.js");

test("dedupe merges same listing across portals", () => {
  const out = H.dedupe([
    { id: "1", plz: "85540", price: 299900, area: 65, rooms: 2, urls: ["https://www.immobilienscout24.de/expose/1"] },
    { id: "rim:9", plz: "85540", price: 299900, area: 65.2, rooms: 2, urls: ["https://regionalimmobilien24.de/expose/?id=9"] },
    { id: "2", plz: "80000", price: 250000, area: 50, rooms: 2, urls: ["https://www.immobilienscout24.de/expose/2/"] },
    { id: "2b", plz: "81000", price: 1, area: 1, rooms: 1, urls: ["https://immobilienscout24.de/expose/2?ref=x"] },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].dupIds, ["rim:9"]);
  assert.equal(out[0].urls.length, 2);
  assert.deepEqual(out[1].dupIds, ["2b"]);
});

test("dedupe does not merge ambiguous look-alikes", () => {
  const out = H.dedupe([
    { id: "a", plz: "80000", price: 250000, area: 50, rooms: 2, urls: ["https://x.de/a"] },
    { id: "b", plz: "80000", price: 255000, area: 50, rooms: 2, urls: ["https://x.de/b"] },
  ]);
  assert.equal(out.length, 2);
});

test("compareSnapshots detects new, price changes, unchanged and removed", () => {
  const prev = [
    { id: "1", price: 300000, urls: ["https://x.de/1"] },
    { id: "2", price: 250000 },
    { id: "3", price: 200000 },
    { id: "4", price: 280000 },
  ];
  const curr = [
    { id: "1", price: 289000 },
    { id: "2", price: 250000 },
    { id: "4", price: 285000 },
    { id: "5", price: 270000 },
    { id: "1-alt", price: 289000, urls: ["https://www.x.de/1/"] },
  ];
  const r = H.compareSnapshots(prev, curr);
  const st = Object.fromEntries(r.items.map((i) => [i.id, i.status]));
  assert.deepEqual(st, { 1: "PRICE_DROP", 2: "UNCHANGED", 4: "PRICE_INCREASE", 5: "NEW", "1-alt": "PRICE_DROP" });
  assert.equal(r.items[0].prevPrice, 300000);
  assert.deepEqual(r.removed, ["3"]);
});

test("trackHistory records first seen and price history", () => {
  const h = H.trackHistory([
    { date: "2026-10-31", listings: [{ id: "1", price: 300000 }] },
    { date: "2026-11-07", listings: [{ id: "1", price: 300000 }, { id: "2", price: 250000 }] },
    { date: "2026-11-09", listings: [{ id: "1", price: 289000 }] },
  ]);
  assert.equal(h["1"].firstSeen, "2026-10-31");
  assert.equal(h["1"].lastSeen, "2026-11-09");
  assert.deepEqual(h["1"].prices.map((p) => p.price), [300000, 289000]);
  assert.equal(h["2"].firstSeen, "2026-11-07");
});

test("freshnessDays", () => {
  assert.equal(H.freshnessDays("2026-10-31", "2026-11-09T08:14+01:00"), 9);
  assert.equal(H.freshnessDays(null, "2026-11-09"), null);
});
