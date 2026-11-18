const test = require("node:test");
const assert = require("node:assert/strict");
const profile = require("../hunter/profile.js");
const H = require("../hunter/evaluate.js");
const { complete, route } = require("./fixtures.js");

const res = (x, id) => H.mandatoryChecks(H.normalize(x), profile).find((c) => c.id === id).result;
const status = (x) => H.evaluate(x, profile).status;

test("complete listing is CONFIRMED", () => {
  const ev = H.evaluate(complete(), profile);
  assert.deepEqual(ev.failed, []);
  assert.deepEqual(ev.unknown, []);
  assert.equal(ev.status, H.STATUS.CONFIRMED);
});

test("property type: only Eigentumswohnung, Kauf", () => {
  assert.equal(res(complete({ offerType: "Miete" }), "type"), "fail");
  assert.equal(res(complete({ propertyType: "Haus" }), "type"), "fail");
  assert.equal(res(complete({ offerType: undefined }), "type"), "unknown");
});

test("geography: Stadt and Landkreis only", () => {
  assert.equal(res(complete({ zone: "Landkreis" }), "zone"), "pass");
  assert.equal(res(complete({ zone: "Dachau" }), "zone"), "fail");
  assert.equal(res(complete({ zone: undefined }), "zone"), "unknown");
});

test("price cap 300,000 is strict", () => {
  assert.equal(res(complete({ price: 300000 }), "price"), "pass");
  assert.equal(res(complete({ price: 300001 }), "price"), "fail");
  assert.equal(status(complete({ price: 300001 })), "EXCLUDED");
  assert.equal(res(complete({ price: null }), "price"), "unknown");
});

test("minimum area 45 m² is strict", () => {
  assert.equal(res(complete({ area: 45 }), "area"), "pass");
  assert.equal(res(complete({ area: 44.99 }), "area"), "fail");
  assert.equal(res(complete({ area: 42.72 }), "area"), "fail");
  assert.equal(res(complete({ area: null }), "area"), "unknown");
});

test("rooms 2 or 2.5 only", () => {
  assert.equal(res(complete({ rooms: 2.5 }), "rooms"), "pass");
  assert.equal(res(complete({ rooms: 3 }), "rooms"), "fail");
  assert.equal(res(complete({ rooms: 1.5 }), "rooms"), "fail");
});

test("outdoor space: private Balkon, Loggia or Terrasse; communal garden does not count", () => {
  assert.equal(res(complete({ outdoor: "Balkon (West, ca. 4 m²)" }), "outdoor"), "pass");
  assert.equal(res(complete({ outdoor: "Loggia" }), "outdoor"), "pass");
  assert.equal(res(complete({ outdoor: "Dachterrasse, Terrasse" }), "outdoor"), "pass");
  assert.equal(res(complete({ outdoor: "Gemeinschaftsgarten" }), "outdoor"), "fail");
  assert.equal(res(complete({ outdoor: "Gartennutzung" }), "outdoor"), "unknown");
  assert.equal(res(complete({ outdoor: "kein Balkon" }), "outdoor"), "fail");
  assert.equal(res(complete({ outdoor: false }), "outdoor"), "fail");
  assert.equal(res(complete({ outdoor: null }), "outdoor"), "unknown");
  assert.equal(res(complete({ outdoor: "Balkon, Gemeinschaftsgarten" }), "outdoor"), "pass");
});

test("Dachgeschoss is excluded, unclear top floor needs verification", () => {
  assert.equal(res(complete({ title: "Gemütliche DG-Wohnung mit Galerie" }), "attic"), "fail");
  assert.equal(res(complete({ floor: "DG" }), "attic"), "fail");
  assert.equal(res(complete({ title: "Helle Dachgeschosswohnung" }), "attic"), "fail");
  assert.equal(res(complete({ title: "Charmante Mansardenwohnung" }), "attic"), "fail");
  assert.equal(res(complete({ title: "EDGAR-Haus, 2. OG" }), "attic"), "pass");
  assert.equal(res(complete({ title: "Wohnung im Dachgeschoss" }), "attic"), "fail");
  assert.equal(res(complete({ floor: "4 von 4" }), "attic"), "unknown");
  assert.equal(res(complete({ floor: "2" }), "attic"), "unknown");
  assert.equal(res(complete({ outdoor: "Dachterrasse" }), "attic"), "unknown");
  assert.equal(res(complete({ floor: "4 von 4", attic: false }), "attic"), "pass");
});

test("Erbpacht / Erbbaurecht is excluded, unknown tenure needs verification", () => {
  assert.equal(res(complete({ tenure: null, notes: "Erbbaurecht bis 2065" }), "tenure"), "fail");
  assert.equal(res(complete({ tenure: "Erbpacht" }), "tenure"), "fail");
  assert.equal(res(complete({ tenure: null, notes: "ohne Erbpacht" }), "tenure"), "pass");
  assert.equal(res(complete({ tenure: null }), "tenure"), "unknown");
  assert.equal(status(complete({ tenure: null })), "NEEDS_VERIFICATION");
});

test("Wohnrecht / Nießbrauch is excluded (project rule)", () => {
  assert.equal(res(complete({ title: "Wohnung mit lebenslangem Wohnrecht" }), "encumbrance"), "fail");
  assert.equal(res(complete({ notes: "Nießbrauch eingetragen" }), "encumbrance"), "fail");
  assert.equal(res(complete({ notes: "kein Wohnrecht" }), "encumbrance"), "pass");
});

test("transport: unknown routes are flagged, never assumed", () => {
  assert.equal(res(complete({ routes: undefined }), "transit"), "unknown");
  assert.equal(res(complete({ routes: undefined, rail: true }), "transit"), "unknown");
  const unverified = { Hauptbahnhof: Object.assign(route(10, 0), { verified: false }) };
  assert.equal(res(complete({ routes: unverified }), "transit"), "unknown");
});

test("transport: excluded only when every destination is verified and unacceptable", () => {
  const bad = { Hauptbahnhof: route(70, 3), Marienplatz: route(65, 3), "Münchner Freiheit": route(80, 3) };
  assert.equal(res(complete({ routes: bad }), "transit"), "fail");
  const partial = { Hauptbahnhof: route(70, 3) };
  assert.equal(res(complete({ routes: partial }), "transit"), "unknown");
  const oneOk = { Hauptbahnhof: route(70, 3), Marienplatz: route(35, 1) };
  assert.equal(res(complete({ routes: oneOk }), "transit"), "pass");
});

test("legacy filters stay active: vermietet, Erdgeschoss, Baujahr 1960–1985", () => {
  assert.equal(res(complete({ occ: "vermietet" }), "occupancy"), "fail");
  assert.equal(res(complete({ occ: null }), "occupancy"), "unknown");
  assert.equal(res(complete({ floor: "EG von 3" }), "groundFloor"), "fail");
  assert.equal(res(complete({ title: "bezugsfreie 2 Zimmer Hochparterre" }), "groundFloor"), "fail");
  assert.equal(res(complete({ yearBuilt: 1974 }), "buildYear"), "fail");
  assert.equal(res(complete({ yearBuilt: 1986 }), "buildYear"), "pass");
  assert.equal(res(complete({ yearBuilt: null }), "buildYear"), "unknown");
});

test("legacy filters can be switched off explicitly", () => {
  const p = Object.assign({}, profile, { legacy: { unrentedOnly: false, excludeGroundFloor: false, excludeBuildYears: null } });
  const ev = H.evaluate(complete({ occ: "vermietet", yearBuilt: 1974 }), p);
  assert.equal(ev.status, "CONFIRMED");
  assert.ok(ev.warnings.some((w) => /Vermietet/.test(w[1])));
});

test("a failed filter wins over missing data", () => {
  assert.equal(status(complete({ price: 310000, tenure: null, routes: undefined })), "EXCLUDED");
});

test("facts list from the daily search is parsed", () => {
  const x = H.normalize({ facts: [["Etage", "1 von 1"], ["Baujahr", "1988"], ["Hausgeld", "486 €"], ["Provision", "3,57 %"], ["Energieklasse", "D"]] });
  assert.equal(x.yearBuilt, 1988);
  assert.equal(x.hausgeld, 486);
  assert.equal(x.brokerRate, 0.0357);
  assert.equal(x.energyClass, "D");
  assert.deepEqual([x.floorInfo.floor, x.floorInfo.total], [1, 1]);
  assert.equal(H.normalize({ facts: [["Provision", "provisionsfrei"]] }).brokerRate, 0);
});
