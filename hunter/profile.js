/*
 * Buyer profile for the Munich Property Hunter.
 *
 * All thresholds and weights live here so they can be changed without
 * touching the evaluation logic. Mandatory filters are never relaxed by the
 * code: a listing that fails one is EXCLUDED, a listing with missing evidence
 * is NEEDS_VERIFICATION.
 *
 * Works as a browser global (window.HunterProfile) and as a CommonJS module.
 */
(function (root, factory) {
  const profile = factory();
  if (typeof module === "object" && module.exports) module.exports = profile;
  else root.HunterProfile = profile;
})(typeof self !== "undefined" ? self : this, function () {
  return {
    mandatory: {
      propertyType: "Eigentumswohnung",
      offerType: "Kauf",
      zones: ["Stadt", "Landkreis"], // München Stadt, Landkreis München
      priceMax: 300000,
      areaMin: 45,
      rooms: [2, 2.5],
      // Private outdoor space only; communal garden access does not count.
      outdoorTypes: ["Balkon", "Loggia", "Terrasse"],
      excludeAttic: true,
      excludeLeasehold: true, // Erbpacht / Erbbaurecht
      excludeEncumbrances: true, // Wohnrecht / Nießbrauch (standing project rule)
      transit: {
        // A route is "acceptable" when it reaches the destination within
        // maxTotalMin with at most maxTransfers. At least one of the
        // destinations must be acceptable; if all known routes fail, the
        // listing is excluded. Unknown routes only trigger verification.
        maxTotalMin: 50,
        maxTransfers: 2,
      },
    },

    // Filters that were added to the daily search before this profile
    // existed. They stay active until the user explicitly drops them.
    legacy: {
      unrentedOnly: true,
      excludeGroundFloor: true,
      excludeBuildYears: [1960, 1985],
    },

    preferences: {
      priceTarget: 275000,
      areaPreferred: [50, 65],
      liquidAreaBand: [45, 65],
    },

    // Scoring weights, must sum to 100.
    weights: {
      neighborhood: 25,
      transport: 20,
      condition: 20,
      rental: 15,
      price: 10,
      balconyInfra: 10,
    },

    transportDestinations: ["Hauptbahnhof", "Marienplatz", "Münchner Freiheit"],

    costs: {
      // Bavaria: Grunderwerbsteuer is fixed at 3.5 % by law.
      landTransferTaxRate: 0.035,
      // Notary + Grundbuch: typical range 1.5–2.0 %; the upper end is used.
      notaryLandRegistryRate: 0.02,
    },

    // Reference values for scoring thresholds.
    scoring: {
      sqmPriceGood: 4500, // €/m² at or below → full points for this factor
      sqmPriceBad: 7000,
      hausgeldPerSqmGood: 3.5, // €/m² per month
      hausgeldPerSqmBad: 6.0,
      yieldGood: 0.045,
      yieldBad: 0.025,
      balconyGoodSqm: 8,
      walkGoodMin: 5,
      walkBadMin: 15,
      routeGoodMin: 20,
      routeBadMin: 50,
      supermarketWalkMax: 15,
    },
  };
});
