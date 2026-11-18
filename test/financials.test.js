const test = require("node:test");
const assert = require("node:assert/strict");
const profile = require("../hunter/profile.js");
const H = require("../hunter/evaluate.js");
const { complete } = require("./fixtures.js");

test("Bavarian closing costs: 3.5 % transfer tax confirmed, 2 % notary estimated", () => {
  const f = H.financials({ price: 280000, area: 56, brokerRate: 0.0357 }, profile);
  assert.equal(f.landTransferTax.amount, 9800);
  assert.equal(f.landTransferTax.kind, "statutory");
  assert.equal(f.notary.amount, 5600);
  assert.equal(f.notary.kind, "estimate");
  assert.equal(f.broker.amount, 9996);
  assert.equal(f.broker.kind, "confirmed");
  assert.equal(f.sqmPrice, 5000);
  assert.equal(f.confirmedTotal, 280000 + 9800 + 9996);
  assert.equal(f.estimatedTotal, 5600);
  assert.equal(f.total, 305396);
  assert.equal(f.totalComplete, true);
});

test("unknown broker commission keeps the total as a flagged lower bound", () => {
  const f = H.financials({ price: 250000, area: 50 }, profile);
  assert.equal(f.broker.kind, "unknown");
  assert.equal(f.broker.amount, null);
  assert.equal(f.totalComplete, false);
  assert.equal(f.total, 250000 + 8750 + 5000);
  const ev = H.evaluate({ price: 250000, area: 50 }, profile);
  assert.ok(ev.warnings.some((w) => /Käuferprovision nicht angegeben/.test(w[1])));
});

test("renovation budget only with evidence", () => {
  assert.equal(H.financials({ price: 250000, area: 50, renovation: { amount: 20000 } }, profile).renovation, null);
  const f = H.financials({ price: 250000, area: 50, brokerRate: 0, renovation: { amount: 20000, basis: "Exposé: Bad und Küche erneuerungsbedürftig" } }, profile);
  assert.equal(f.renovation.amount, 20000);
  assert.equal(f.renovation.kind, "estimate");
  assert.equal(f.estimatedTotal, 5000 + 20000);
});

test("Hausgeld is only reported when disclosed", () => {
  assert.equal(H.financials({ price: 250000, area: 50 }, profile).hausgeld, null);
  const f = H.financials({ price: 250000, area: 50, hausgeld: 300, hausgeldNonRecoverable: 110 }, profile);
  assert.deepEqual(f.hausgeld, { monthly: 300, kind: "confirmed" });
  assert.deepEqual(f.nonRecoverable, { monthly: 110, kind: "confirmed" });
});

test("no price, no financials", () => {
  assert.equal(H.financials({ price: null, area: 50 }, profile), null);
});

test("rent estimate uses comparables and is never marked verified", () => {
  const r = H.rentEstimate(complete());
  assert.equal(r.eurPerSqm, 22);
  assert.equal(r.monthly, 1210);
  assert.equal(r.verified, false);
  assert.equal(r.basisKind, "comparables");
  assert.equal(r.grossYield, Math.round(((1210 * 12) / 260000) * 1e4) / 1e4);
});

test("asking rents are labelled as asking, achieved comparables take precedence", () => {
  const asking = H.rentEstimate({ area: 50, price: 250000, rentComps: [{ eurPerSqm: 25, kind: "asking", source: "portal" }] });
  assert.equal(asking.basisKind, "asking");
  const mixed = H.rentEstimate({
    area: 50,
    price: 250000,
    rentComps: [
      { eurPerSqm: 30, kind: "asking", source: "portal" },
      { eurPerSqm: 20, kind: "mietspiegel", source: "Mietspiegel" },
    ],
  });
  assert.equal(mixed.eurPerSqm, 20);
  const ev = H.evaluate(Object.assign(complete(), { rentComps: [{ eurPerSqm: 25, kind: "asking", source: "portal" }] }), profile);
  assert.ok(ev.warnings.some((w) => /Angebotsmieten/.test(w[1])));
});

test("no rent evidence, no rent estimate", () => {
  assert.equal(H.rentEstimate({ area: 50, price: 250000 }), null);
  assert.equal(H.rentEstimate({ area: 50, price: 250000, rentComps: [{ eurPerSqm: 22 }] }), null); // no source
});
