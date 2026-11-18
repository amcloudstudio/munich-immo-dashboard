const test = require("node:test");
const assert = require("node:assert/strict");
const profile = require("../hunter/profile.js");
const H = require("../hunter/evaluate.js");
const { complete, route } = require("./fixtures.js");

const sc = (x, p = profile) => H.score(H.normalize(x), p);

test("weights sum to 100 and are validated", () => {
  assert.equal(H.validateWeights(profile), true);
  assert.throws(() => H.validateWeights(Object.assign({}, profile, { weights: { a: 50, b: 40 } })));
});

test("category maxima follow the configured weights", () => {
  const s = sc(complete());
  const max = Object.fromEntries(Object.entries(s.categories).map(([k, c]) => [k, c.max]));
  assert.deepEqual(max, { neighborhood: 25, transport: 20, condition: 20, rental: 15, price: 10, balconyInfra: 10 });
});

test("fully documented strong listing scores high and is not provisional", () => {
  const s = sc(complete());
  assert.equal(s.provisional, false);
  assert.deepEqual(s.missing, []);
  assert.ok(s.total >= 90, `got ${s.total}`);
  assert.ok(s.total <= 100);
});

test("missing information never earns points and marks the score provisional", () => {
  const bare = { price: 260000, area: 55, rooms: 2, zone: "Stadt" };
  const s = sc(bare);
  assert.equal(s.provisional, true);
  assert.equal(s.categories.neighborhood.points, 0);
  assert.equal(s.categories.transport.points, 0);
  assert.equal(s.categories.balconyInfra.points, 0);
  assert.ok(s.missing.includes("Verbindung Hauptbahnhof"));
  assert.ok(s.total < 20, `got ${s.total}`);
});

test("removing one input lowers the score and flags it", () => {
  const full = sc(complete());
  const x = complete();
  delete x.neighborhood.quietGreen;
  const s = sc(x);
  assert.ok(s.total < full.total);
  assert.equal(s.provisional, true);
  assert.deepEqual(s.missing, ["Ruhe, Grün, Straßenlärm"]);
});

test("unverified routes score zero", () => {
  const x = complete({ routes: { Hauptbahnhof: Object.assign(route(10, 0), { verified: false }) } });
  assert.equal(sc(x).categories.transport.points, 0);
});

test("direct connection beats transfers; bus–S–U combination is penalised and flagged", () => {
  const S = profile.scoring;
  const direct = H.routeScore(route(25, 0), S).value;
  const one = H.routeScore(route(25, 1), S).value;
  const combo = H.routeScore(route(25, 2, { modes: ["Bus", "S", "U"] }), S);
  const two = H.routeScore(route(25, 2, { modes: ["U", "U", "U"] }), S).value;
  assert.ok(direct > one && one > two && two > combo.value);
  assert.equal(combo.complicated, true);
  const x = complete({ routes: { Hauptbahnhof: route(25, 2, { modes: ["Bus", "S", "U"] }) } });
  const ev = H.evaluate(x, profile);
  assert.ok(ev.warnings.some((w) => /Umständliche Verbindung/.test(w[1])));
});

test("preferences rank but do not exclude", () => {
  const cheap = H.evaluate(complete({ price: 270000 }), profile);
  const dear = H.evaluate(complete({ price: 299000 }), profile);
  assert.equal(dear.status, "CONFIRMED");
  assert.ok(cheap.score.total > dear.score.total);
  const corner = H.evaluate(complete({ corner: true }), profile);
  assert.equal(corner.status, "CONFIRMED");
  assert.ok(corner.score.total < cheap.score.total + 100);
  assert.ok(corner.score.categories.condition.points < sc(complete()).categories.condition.points);
  const big = sc(complete({ units: 250 }));
  assert.ok(big.categories.condition.points < sc(complete()).categories.condition.points);
});

test("special assessments and renovation backlog reduce the condition score", () => {
  const base = sc(complete()).categories.condition.points;
  assert.ok(sc(complete({ weg: { sonderumlage: true } })).categories.condition.points < base);
  assert.ok(sc(complete({ weg: { sanierungsstau: true } })).categories.condition.points < base);
});

test("supermarket count and services drive the infrastructure score", () => {
  const x3 = sc(complete()).categories.balconyInfra.points;
  const x1 = sc(complete({ infra: Object.assign({}, complete().infra, { supermarkets: [{ name: "A", walkMin: 5 }] }) })).categories.balconyInfra.points;
  const far = sc(complete({ infra: Object.assign({}, complete().infra, { supermarkets: [{ name: "A", walkMin: 25 }] }) })).categories.balconyInfra.points;
  assert.ok(x3 > x1 && x1 > far);
  // a store named without a sourced walking time earns nothing
  const noTime = sc(complete({ infra: Object.assign({}, complete().infra, { pharmacy: { name: "Apotheke" } }) }));
  assert.ok(noTime.missing.includes("Apotheke"));
});

test("weights are configurable", () => {
  const p = Object.assign({}, profile, { weights: { neighborhood: 0, transport: 100, condition: 0, rental: 0, price: 0, balconyInfra: 0 } });
  const s = sc(complete(), p);
  assert.equal(s.categories.transport.max, 100);
  assert.equal(s.total, Math.round(s.categories.transport.points));
});
