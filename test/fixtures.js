// Synthetic test inputs only. These are not real listings and never reach the dashboard.
const route = (totalMin, transfers, extra = {}) =>
  Object.assign({ verified: true, walkMin: 4, lines: ["U3"], modes: ["U"], transfers, totalMin, source: "test" }, extra);

function complete(overrides = {}) {
  return Object.assign(
    {
      id: "test-1",
      propertyType: "Eigentumswohnung",
      offerType: "Kauf",
      zone: "Stadt",
      district: "Test-Viertel",
      plz: "80000",
      title: "Test listing",
      price: 260000,
      area: 55,
      rooms: 2,
      outdoor: "Loggia",
      outdoorSqm: 9,
      floor: "2 von 4",
      tenure: "Eigentum",
      occ: "frei",
      yearBuilt: 2012,
      condition: "neuwertig",
      energyClass: "A",
      hausgeld: 180,
      brokerRate: 0,
      units: 10,
      corner: false,
      lightLayout: 5,
      weg: { sonderumlage: false, sanierungsstau: false },
      neighborhood: { buildingEnvironment: 5, quietGreen: 5, shopping: 5, maintenance: 5, rentalDemand: 5, gastronomy: 5 },
      routes: {
        Hauptbahnhof: route(15, 0),
        Marienplatz: route(12, 0),
        "Münchner Freiheit": route(10, 0),
      },
      infra: {
        supermarkets: [{ name: "A", walkMin: 3 }, { name: "B", walkMin: 6 }, { name: "C", walkMin: 9 }],
        alnatura: { walkMin: 8 },
        drugstore: { walkMin: 5 },
        pharmacy: { walkMin: 2 },
        bakery: { walkMin: 1 },
      },
      rentComps: [
        { eurPerSqm: 22, kind: "achieved", source: "test" },
        { eurPerSqm: 21, kind: "achieved", source: "test" },
        { eurPerSqm: 23, kind: "achieved", source: "test" },
      ],
    },
    overrides
  );
}

module.exports = { complete, route };
