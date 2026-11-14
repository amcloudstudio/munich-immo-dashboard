/*
 * Listing evaluation for the Munich Property Hunter.
 *
 * Pure functions, no I/O. Used by index.html (browser global HunterEval) and
 * by the Node test suite (CommonJS).
 *
 * Principles:
 *  - Mandatory filters return "pass", "fail" or "unknown". Any fail makes the
 *    listing EXCLUDED, any unknown makes it NEEDS_VERIFICATION. Nothing is
 *    relaxed silently.
 *  - Missing data never earns points. A score with missing inputs is marked
 *    provisional.
 *  - Confirmed costs and estimates are kept apart.
 *  - Asking rents are never treated as achieved rents.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HunterEval = api;
})(typeof self !== "undefined" ? self : this, function () {
  const STATUS = {
    CONFIRMED: "CONFIRMED",
    NEEDS_VERIFICATION: "NEEDS_VERIFICATION",
    EXCLUDED: "EXCLUDED",
  };

  // ---------------------------------------------------------------- helpers

  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const round = (v, d = 0) => {
    const f = Math.pow(10, d);
    return Math.round(v * f) / f;
  };
  // Linear score: 1 at `good`, 0 at `bad` (works for both directions).
  const lin = (v, good, bad) => clamp01((v - bad) / (good - bad));

  function parseNumber(s) {
    if (isNum(s)) return s;
    if (typeof s !== "string") return null;
    const m = s.replace(/\s/g, "").match(/-?\d[\d.]*(,\d+)?/);
    if (!m) return null;
    const n = parseFloat(m[0].replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  function rating(r) {
    // Accepts 0..5 or {score: 0..5, source}. Returns 0..1 or null.
    const v = r && typeof r === "object" ? r.score : r;
    return isNum(v) ? clamp01(v / 5) : null;
  }

  function factsMap(x) {
    const m = {};
    (x.facts || []).forEach((f) => {
      if (Array.isArray(f) && f.length >= 2) m[String(f[0]).toLowerCase()] = String(f[1]);
    });
    return m;
  }

  function searchText(x) {
    const parts = [x.title, x.tenure, x.notes, x.description, x.reason];
    (x.facts || []).forEach((f) => parts.push(f && f[1]));
    (x.warns || []).forEach((w) => parts.push(Array.isArray(w) ? w[1] : w));
    return parts.filter(Boolean).join(" \n ");
  }

  // Mention that is not negated ("ohne Erbpacht", "kein Wohnrecht").
  function mentions(text, re) {
    const g = new RegExp(re.source, "gi");
    let m;
    while ((m = g.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 12), m.index).toLowerCase();
      if (!/(kein|keine|keinen|ohne|frei von|nicht)\s*$/.test(before)) return true;
    }
    return false;
  }

  // ------------------------------------------------------------- normalize

  function parseFloor(s) {
    if (s == null) return null;
    const str = String(s).trim();
    if (/\b(EG|Erdgeschoss|Hochparterre|Parterre|Souterrain)\b/i.test(str)) {
      const total = str.match(/von\s*(\d+)/i);
      return { floor: 0, total: total ? +total[1] : null, attic: false, raw: str };
    }
    if (/\bDG\b|Dachgeschoss/i.test(str)) return { floor: null, total: null, attic: true, raw: str };
    const m = str.match(/^(-?\d+)(?:\D+(\d+))?/);
    if (!m) return null;
    return { floor: +m[1], total: m[2] != null ? +m[2] : null, attic: false, raw: str };
  }

  /**
   * Fill structured fields from the free-form `facts` list the daily search
   * already produces. Explicit fields always win.
   */
  function normalize(x) {
    const f = factsMap(x);
    const n = Object.assign({}, x);
    if (n.floor == null && f["etage"] != null) n.floor = f["etage"];
    if (n.yearBuilt == null && f["baujahr"] != null) n.yearBuilt = parseNumber(f["baujahr"]);
    if (n.hausgeld == null && f["hausgeld"] != null) n.hausgeld = parseNumber(f["hausgeld"]);
    if (n.energyClass == null && f["energieklasse"] != null) n.energyClass = f["energieklasse"].trim();
    if (n.condition == null && f["zustand"] != null) n.condition = f["zustand"];
    if (n.brokerRate == null && f["provision"] != null) {
      const p = f["provision"];
      if (/provisionsfrei|keine|ohne/i.test(p)) n.brokerRate = 0;
      else {
        const v = parseNumber(p);
        if (v != null) n.brokerRate = round(v / 100, 6);
      }
    }
    n.floorInfo = parseFloor(n.floor);
    n.outdoorTypes = outdoorTypes(n.outdoor);
    return n;
  }

  // --------------------------------------------------------- outdoor space

  /** Returns e.g. ["Balkon"], ["Terrasse"], ["Garten"], ["Gemeinschaft"] or []. */
  function outdoorTypes(text) {
    if (!text || typeof text !== "string") return [];
    const types = [];
    const add = (t) => {
      if (!types.includes(t)) types.push(t);
    };
    text
      .split(/[,;/+]|\bund\b|\bsowie\b/i)
      .map((t) => t.trim())
      .filter(Boolean)
      .forEach((tok) => {
        if (/gemeinschaft/i.test(tok)) return add("Gemeinschaft");
        if (/balkon/i.test(tok)) add("Balkon");
        if (/loggia/i.test(tok)) add("Loggia");
        if (/terrasse/i.test(tok)) add("Terrasse");
        if (/garten/i.test(tok) && !/balkon|loggia|terrasse/i.test(tok)) add("Garten");
      });
    return types;
  }

  // ---------------------------------------------------- mandatory filters

  const check = (id, label, result, detail) => ({ id, label, result, detail: detail || "" });

  function routeAcceptable(r, t) {
    return isNum(r.totalMin) && r.totalMin <= t.maxTotalMin && isNum(r.transfers) && r.transfers <= t.maxTransfers;
  }

  function mandatoryChecks(raw, profile) {
    const x = raw.floorInfo !== undefined ? raw : normalize(raw);
    const M = profile.mandatory;
    const L = profile.legacy || {};
    const text = searchText(x);
    const out = [];

    // Property and offer type
    if (!x.propertyType || !x.offerType) out.push(check("type", "Eigentumswohnung, Kauf", "unknown", "Objektart/Angebotsart nicht angegeben"));
    else if (x.propertyType === M.propertyType && x.offerType === M.offerType) out.push(check("type", "Eigentumswohnung, Kauf", "pass"));
    else out.push(check("type", "Eigentumswohnung, Kauf", "fail", `${x.propertyType}, ${x.offerType}`));

    // Geography
    if (!x.zone) out.push(check("zone", "München Stadt / Landkreis", "unknown", "Lage nicht angegeben"));
    else out.push(check("zone", "München Stadt / Landkreis", M.zones.includes(x.zone) ? "pass" : "fail", x.zone));

    // Price
    if (!isNum(x.price)) out.push(check("price", `Kaufpreis ≤ ${M.priceMax.toLocaleString("de-DE")} €`, "unknown", "Preis auf Anfrage"));
    else out.push(check("price", `Kaufpreis ≤ ${M.priceMax.toLocaleString("de-DE")} €`, x.price <= M.priceMax ? "pass" : "fail", `${x.price.toLocaleString("de-DE")} €`));

    // Area
    if (!isNum(x.area)) out.push(check("area", `Wohnfläche ≥ ${M.areaMin} m²`, "unknown", "Fläche nicht angegeben"));
    else out.push(check("area", `Wohnfläche ≥ ${M.areaMin} m²`, x.area >= M.areaMin ? "pass" : "fail", `${x.area} m²`));

    // Rooms
    if (!isNum(x.rooms)) out.push(check("rooms", "2–2,5 Zimmer", "unknown", "Zimmerzahl nicht angegeben"));
    else out.push(check("rooms", "2–2,5 Zimmer", M.rooms.includes(x.rooms) ? "pass" : "fail", `${x.rooms} Zimmer`));

    // Private outdoor space
    const ot = x.outdoorTypes || outdoorTypes(x.outdoor);
    const priv = ot.filter((t) => M.outdoorTypes.includes(t));
    if (x.outdoor === false || (typeof x.outdoor === "string" && /^\s*(kein|keine|ohne)\b/i.test(x.outdoor)))
      out.push(check("outdoor", "Privater Balkon / Loggia / Terrasse", "fail", "keine Außenfläche"));
    else if (priv.length) out.push(check("outdoor", "Privater Balkon / Loggia / Terrasse", "pass", priv.join(", ")));
    else if (ot.includes("Gemeinschaft") && !ot.includes("Garten"))
      out.push(check("outdoor", "Privater Balkon / Loggia / Terrasse", "fail", "nur Gemeinschaftsgarten"));
    else if (ot.includes("Garten"))
      out.push(check("outdoor", "Privater Balkon / Loggia / Terrasse", "unknown", "Garten genannt, private Terrasse prüfen"));
    else out.push(check("outdoor", "Privater Balkon / Loggia / Terrasse", "unknown", "Außenfläche nicht angegeben"));

    // Attic / Dachgeschoss
    if (M.excludeAttic) {
      const fi = x.floorInfo;
      const atticWords = /\bDG\b|\b(Dachgeschoss|Dachgeschoß|Dachwohnung|Dachstudio|Mansarde|Spitzboden)|attic/i;
      if (x.attic === true || (fi && fi.attic) || atticWords.test(x.title || "") || atticWords.test(x.notes || ""))
        out.push(check("attic", "Kein Dachgeschoss", "fail", "Dachgeschoss"));
      else if (x.attic === false) out.push(check("attic", "Kein Dachgeschoss", "pass"));
      else if (/dachterrasse/i.test(x.outdoor || "")) out.push(check("attic", "Kein Dachgeschoss", "unknown", "Dachterrasse: Lage im Dachgeschoss prüfen"));
      else if (fi && isNum(fi.floor) && isNum(fi.total) && fi.floor < fi.total) out.push(check("attic", "Kein Dachgeschoss", "pass", `Etage ${fi.raw}`));
      else if (fi && isNum(fi.floor) && fi.floor === 0) out.push(check("attic", "Kein Dachgeschoss", "pass", "Erdgeschoss"));
      else if (fi && isNum(fi.floor) && isNum(fi.total) && fi.floor >= fi.total)
        out.push(check("attic", "Kein Dachgeschoss", "unknown", `oberstes Geschoss (${fi.raw})`));
      else out.push(check("attic", "Kein Dachgeschoss", "unknown", "Etage / Geschosszahl unbekannt"));
    }

    // Leasehold
    if (M.excludeLeasehold) {
      if (mentions(text, /erbpacht|erbbau/) || /erbpacht|erbbau/i.test(x.tenure || ""))
        out.push(check("tenure", "Kein Erbpacht / Erbbaurecht", "fail", "Erbpacht / Erbbaurecht"));
      else if (/eigentum/i.test(x.tenure || "") || /(ohne|kein)\s+(erbpacht|erbbau)/i.test(text))
        out.push(check("tenure", "Kein Erbpacht / Erbbaurecht", "pass", x.tenure || "ohne Erbpacht"));
      else out.push(check("tenure", "Kein Erbpacht / Erbbaurecht", "unknown", "Eigentumsform ungeklärt"));
    }

    // Wohnrecht / Nießbrauch (standing project rule)
    if (M.excludeEncumbrances) {
      if (mentions(text, /wohnrecht|nie(ß|ss)brauch|leibrente/))
        out.push(check("encumbrance", "Kein Wohnrecht / Nießbrauch", "fail", "Wohnrecht / Nießbrauch"));
      else out.push(check("encumbrance", "Kein Wohnrecht / Nießbrauch", "pass"));
    }

    // Public transport
    {
      const T = M.transit;
      const routes = x.routes || {};
      const dests = profile.transportDestinations;
      const verified = dests.map((d) => routes[d]).filter((r) => r && r.verified === true);
      const label = "Akzeptable ÖPNV-Anbindung";
      if (verified.some((r) => routeAcceptable(r, T))) out.push(check("transit", label, "pass"));
      else if (verified.length === dests.length)
        out.push(check("transit", label, "fail", `keine Verbindung ≤ ${T.maxTotalMin} min mit ≤ ${T.maxTransfers} Umstiegen`));
      else out.push(check("transit", label, "unknown", x.rail ? "S-/U-Bahn in der Anzeige genannt, Verbindungen nicht verifiziert" : "Verbindungen nicht verifiziert"));
    }

    // Legacy filters (kept until the user drops them)
    if (L.unrentedOnly) {
      if (x.occ === "vermietet") out.push(check("occupancy", "Unvermietet", "fail", "vermietet"));
      else if (x.occ === "frei") out.push(check("occupancy", "Unvermietet", "pass", "frei"));
      else out.push(check("occupancy", "Unvermietet", "unknown", "Belegung ungeklärt"));
    }
    if (L.excludeGroundFloor) {
      const fi = x.floorInfo;
      if ((fi && fi.floor === 0) || /\b(Erdgeschoss|Hochparterre|Souterrain)\b/i.test(x.title || ""))
        out.push(check("groundFloor", "Kein Erdgeschoss / Hochparterre", "fail", fi ? fi.raw : "laut Titel"));
      else if (fi && (isNum(fi.floor) || fi.attic)) out.push(check("groundFloor", "Kein Erdgeschoss / Hochparterre", "pass"));
      else out.push(check("groundFloor", "Kein Erdgeschoss / Hochparterre", "unknown", "Etage unbekannt"));
    }
    if (L.excludeBuildYears) {
      const [a, b] = L.excludeBuildYears;
      const lbl = `Baujahr nicht ${a}–${b}`;
      if (!isNum(x.yearBuilt)) out.push(check("buildYear", lbl, "unknown", "Baujahr unbekannt"));
      else out.push(check("buildYear", lbl, x.yearBuilt >= a && x.yearBuilt <= b ? "fail" : "pass", String(x.yearBuilt)));
    }
    return out;
  }

  function matchStatus(checks) {
    if (checks.some((c) => c.result === "fail")) return STATUS.EXCLUDED;
    if (checks.some((c) => c.result === "unknown")) return STATUS.NEEDS_VERIFICATION;
    return STATUS.CONFIRMED;
  }

  // ------------------------------------------------------------ financials

  function financials(raw, profile) {
    const x = raw.floorInfo !== undefined ? raw : normalize(raw);
    if (!isNum(x.price)) return null;
    const C = profile.costs;
    const price = x.price;
    const tax = { amount: round(price * C.landTransferTaxRate), rate: C.landTransferTaxRate, kind: "statutory" };
    const notary = { amount: round(price * C.notaryLandRegistryRate), rate: C.notaryLandRegistryRate, kind: "estimate" };
    let broker;
    if (isNum(x.brokerRate)) broker = { amount: round(price * x.brokerRate), rate: x.brokerRate, kind: "confirmed" };
    else broker = { amount: null, rate: null, kind: "unknown" };
    let renovation = null;
    if (x.renovation && isNum(x.renovation.amount) && x.renovation.basis)
      renovation = { amount: x.renovation.amount, basis: x.renovation.basis, kind: "estimate" };

    const confirmed = price + tax.amount + (broker.kind === "confirmed" ? broker.amount : 0);
    const estimated = notary.amount + (renovation ? renovation.amount : 0);
    const hausgeld = isNum(x.hausgeld) ? { monthly: x.hausgeld, kind: "confirmed" } : null;
    const nonRecoverable = isNum(x.hausgeldNonRecoverable) ? { monthly: x.hausgeldNonRecoverable, kind: "confirmed" } : null;
    return {
      price,
      sqmPrice: isNum(x.area) && x.area > 0 ? round(price / x.area) : null,
      landTransferTax: tax,
      notary,
      broker,
      renovation,
      confirmedTotal: confirmed,
      estimatedTotal: estimated,
      total: confirmed + estimated,
      // false when the broker commission is unknown: total is then a lower bound
      totalComplete: broker.kind !== "unknown",
      hausgeld,
      nonRecoverable,
    };
  }

  // ------------------------------------------------------------- rent

  const median = (a) => {
    const s = a.slice().sort((p, q) => p - q);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  function rentEstimate(raw) {
    const x = raw;
    const comps = (x.rentComps || []).filter((c) => c && isNum(c.eurPerSqm) && c.eurPerSqm > 0 && c.source);
    if (!comps.length || !isNum(x.area)) return null;
    const verifiedComps = comps.filter((c) => c.kind === "achieved" || c.kind === "mietspiegel");
    const basis = verifiedComps.length ? verifiedComps : comps;
    const eurPerSqm = round(median(basis.map((c) => c.eurPerSqm)), 2);
    const monthly = round(eurPerSqm * x.area);
    return {
      monthly,
      eurPerSqm,
      basisKind: verifiedComps.length ? "comparables" : "asking",
      verified: false, // an estimate is never a verified achieved rent
      comps: basis.length,
      grossYield: isNum(x.price) && x.price > 0 ? round((monthly * 12) / x.price, 4) : null,
    };
  }

  // ------------------------------------------------------------- transport

  function routeScore(r, S) {
    if (!r || r.verified !== true || !isNum(r.totalMin) || !isNum(r.transfers)) return { value: null, complicated: false };
    const time = lin(r.totalMin, S.routeGoodMin, S.routeBadMin);
    const tr = r.transfers <= 0 ? 1 : r.transfers === 1 ? 0.75 : r.transfers === 2 ? 0.3 : 0;
    const walk = isNum(r.walkMin) ? lin(r.walkMin, S.walkGoodMin, S.walkBadMin) : 0;
    const modes = (r.modes || []).map((m) => String(m).toUpperCase());
    const complicated = r.transfers >= 2 && modes.includes("BUS") && modes.includes("S") && modes.includes("U");
    return { value: clamp01(0.6 * time + 0.3 * tr + 0.1 * walk - (complicated ? 0.2 : 0)), complicated };
  }

  // ------------------------------------------------------------- scoring

  function category(weight, factors) {
    const wsum = factors.reduce((s, f) => s + (f.w || 1), 0);
    const got = factors.reduce((s, f) => s + (f.w || 1) * (f.value == null ? 0 : f.value), 0);
    const fraction = wsum ? got / wsum : 0;
    const missing = factors.filter((f) => f.value == null).map((f) => f.label);
    return { points: round(weight * fraction, 1), max: weight, fraction: round(fraction, 3), complete: missing.length === 0, missing, factors };
  }

  function conditionText(s) {
    if (!s) return null;
    if (/renovierungsbed|modernisierungsbed|sanierungsbed|renovierungsfällig|abrissreif/i.test(s)) return 0.2;
    if (/erstbezug|neuwertig|neubau|kernsaniert|vollsaniert|komplett saniert|umfassend saniert/i.test(s)) return 1;
    if (/saniert|modernisiert|renoviert/i.test(s)) return 0.85;
    if (/gepflegt|gut/i.test(s)) return 0.7;
    return null;
  }

  function ageValue(x) {
    if (x.renovated === true) return 1;
    const y = x.yearBuilt;
    if (!isNum(y)) return null;
    if (y >= 2010) return 1;
    if (y >= 2000) return 0.85;
    if (y >= 1986) return 0.6;
    if (y >= 1960) return 0.3;
    if (y >= 1950) return 0.35;
    return 0.5; // pre-war Altbau, unrenovated
  }

  const ENERGY = { "A+": 1, A: 1, B: 0.85, C: 0.7, D: 0.5, E: 0.35, F: 0.2, G: 0.1, H: 0 };

  function complexValue(x) {
    if (x.highRise === true) return 0;
    if (!isNum(x.units)) return null;
    if (x.units <= 12) return 1;
    if (x.units <= 30) return 0.8;
    if (x.units <= 60) return 0.5;
    if (x.units <= 120) return 0.25;
    return 0.1;
  }

  function wegValue(w) {
    if (!w || typeof w !== "object") return null;
    if (w.sonderumlage) return 0.1;
    if (w.sanierungsstau) return 0.2;
    if (w.sonderumlage === false && w.sanierungsstau === false) return 1;
    return null;
  }

  function serviceValue(s, maxWalk) {
    if (s === undefined || s === null) return null;
    if (s === false) return 0; // confirmed: none within walking distance
    if (s && isNum(s.walkMin)) return s.walkMin <= maxWalk ? 1 : 0.5;
    return null; // named but without a sourced walking time
  }

  function score(raw, profile, ctx) {
    const x = raw.floorInfo !== undefined ? raw : normalize(raw);
    const W = profile.weights;
    const S = profile.scoring;
    const P = profile.preferences;
    const nb = x.neighborhood || {};
    const fin = (ctx && ctx.financials) || financials(x, profile);
    const rent = (ctx && ctx.rent) || rentEstimate(x);

    const neighborhood = category(W.neighborhood, [
      { key: "buildingEnvironment", label: "Bausubstanz & Stadtbild", value: rating(nb.buildingEnvironment) },
      { key: "quietGreen", label: "Ruhe, Grün, Straßenlärm", value: rating(nb.quietGreen) },
      { key: "shopping", label: "Nahversorgung", value: rating(nb.shopping) },
      { key: "maintenance", label: "Gepflegtheit & objektive Indikatoren", value: rating(nb.maintenance) },
      { key: "rentalDemand", label: "Mietnachfrage", value: rating(nb.rentalDemand) },
      { key: "gastronomy", label: "Gastronomie & Dienstleistungen", value: rating(nb.gastronomy) },
    ]);

    const routes = x.routes || {};
    const rs = profile.transportDestinations.map((d) => Object.assign({ dest: d }, routeScore(routes[d], S)));
    const transport = category(
      W.transport,
      rs.map((r) => ({ key: r.dest, label: `Verbindung ${r.dest}`, value: r.value }))
    );
    transport.complicated = rs.filter((r) => r.complicated).map((r) => r.dest);

    const condition = category(W.condition, [
      { key: "age", label: "Baujahr / Sanierung", value: ageValue(x) },
      { key: "state", label: "Zustand", value: conditionText(x.condition) },
      { key: "energy", label: "Energieeffizienz", value: x.energyClass != null && ENERGY[String(x.energyClass).toUpperCase()] != null ? ENERGY[String(x.energyClass).toUpperCase()] : null },
      { key: "complex", label: "Größe der Wohnanlage", value: complexValue(x) },
      { key: "corner", label: "Keine Eckwohnung", value: x.corner === false ? 1 : x.corner === true ? 0.5 : null },
      { key: "lightLayout", label: "Licht & Grundriss", value: rating(x.lightLayout) },
      { key: "weg", label: "WEG: Rücklage, Sanierungsstau, Sonderumlage", value: wegValue(x.weg) },
    ]);

    const [bLo, bHi] = P.liquidAreaBand;
    let risk = null;
    if (/eigentum/i.test(x.tenure || "")) {
      risk = 1;
      if ((x.legalIssues || []).length) risk -= 0.5;
      if (x.occ === "vermietet" && x.tenantRestrictions) risk -= 0.3;
      risk = clamp01(risk);
    }
    const rental = category(W.rental, [
      { key: "yield", label: "Bruttomietrendite (Vergleichsmieten)", value: rent && rent.grossYield != null ? lin(rent.grossYield, S.yieldGood, S.yieldBad) : null },
      { key: "demand", label: "Mietnachfrage 45–65 m²", value: rating(nb.rentalDemand) },
      { key: "size", label: "Fläche im liquiden Segment", value: isNum(x.area) ? (x.area >= bLo && x.area <= bHi ? 1 : x.area > bHi ? 0.7 : 0.3) : null },
      { key: "risk", label: "Rechtliche & Wiederverkaufsrisiken", value: risk },
    ]);

    const price = category(W.price, [
      { key: "target", label: `Preis ≤ ${P.priceTarget.toLocaleString("de-DE")} €`, value: isNum(x.price) ? lin(x.price, P.priceTarget, profile.mandatory.priceMax) : null },
      { key: "sqm", label: "€/m²", value: fin && fin.sqmPrice != null ? lin(fin.sqmPrice, S.sqmPriceGood, S.sqmPriceBad) : null },
      { key: "hausgeld", label: "Hausgeld je m²", value: isNum(x.hausgeld) && isNum(x.area) ? lin(x.hausgeld / x.area, S.hausgeldPerSqmGood, S.hausgeldPerSqmBad) : null },
      { key: "broker", label: "Käuferprovision", value: isNum(x.brokerRate) ? clamp01(1 - x.brokerRate / 0.0714) : null },
    ]);

    const inf = x.infra || {};
    const maxWalk = S.supermarketWalkMax;
    let markets = null;
    if (Array.isArray(inf.supermarkets)) {
      const n = inf.supermarkets.filter((s) => s && isNum(s.walkMin) && s.walkMin <= maxWalk).length;
      markets = n >= 3 ? 1 : n === 2 ? 0.7 : n === 1 ? 0.4 : 0;
    }
    const balconyInfra = category(W.balconyInfra, [
      { key: "balcony", label: "Größe der Außenfläche", w: 0.4, value: isNum(x.outdoorSqm) ? lin(x.outdoorSqm, S.balconyGoodSqm, 2) : null },
      { key: "supermarkets", label: "Supermärkte ≤ 15 min zu Fuß", w: 0.3, value: markets },
      { key: "drugstore", label: "dm / Rossmann", w: 0.1, value: serviceValue(inf.drugstore, maxWalk) },
      { key: "pharmacy", label: "Apotheke", w: 0.1, value: serviceValue(inf.pharmacy, maxWalk) },
      { key: "bakery", label: "Bäckerei", w: 0.05, value: serviceValue(inf.bakery, maxWalk) },
      { key: "alnatura", label: "Alnatura", w: 0.05, value: serviceValue(inf.alnatura, maxWalk) },
    ]);

    const categories = { neighborhood, transport, condition, rental, price, balconyInfra };
    const total = Object.values(categories).reduce((s, c) => s + c.points, 0);
    const missing = [];
    Object.values(categories).forEach((c) => c.missing.forEach((m) => missing.push(m)));
    return { total: Math.round(total), max: 100, provisional: missing.length > 0, missing, categories };
  }

  function validateWeights(profile) {
    const sum = Object.values(profile.weights).reduce((s, v) => s + v, 0);
    if (Math.abs(sum - 100) > 1e-9) throw new Error(`Scoring weights must sum to 100, got ${sum}`);
    return true;
  }

  // ------------------------------------------------------------- warnings

  function warnings(x, fin, rent, sc, profile) {
    const w = [];
    const add = (level, text) => w.push([level, text]);
    if (x.occ === "vermietet") add("bad", "Vermietet: Eigennutzung erst nach Kündigung und Sperrfristen möglich");
    if (x.tenantRestrictions) add("bad", `Mieterbezogene Einschränkung: ${x.tenantRestrictions}`);
    (x.legalIssues || []).forEach((t) => add("bad", t));
    if (x.weg && x.weg.sonderumlage) add("bad", "Sonderumlage beschlossen oder angekündigt");
    if (x.weg && x.weg.sanierungsstau) add("bad", "Sanierungsstau in der WEG");
    const cls = String(x.energyClass || "").toUpperCase();
    if (["F", "G", "H"].includes(cls)) add("warn", `Schwache Energieeffizienz (Klasse ${cls})`);
    if (isNum(x.hausgeld) && isNum(x.area) && x.hausgeld / x.area > profile.scoring.hausgeldPerSqmBad - 1)
      add("warn", `Hohes Hausgeld (${round(x.hausgeld / x.area, 2).toLocaleString("de-DE")} €/m²)`);
    if (fin && fin.broker.kind === "unknown") add("warn", "Käuferprovision nicht angegeben, Gesamtkosten sind eine Untergrenze");
    if (conditionText(x.condition) === 0.2 && !(fin && fin.renovation)) add("warn", "Renovierungsbedarf, Budget ohne Belege nicht beziffert");
    if (rent && rent.basisKind === "asking") add("warn", "Mietschätzung beruht nur auf Angebotsmieten");
    if (x.highRise === true || (isNum(x.units) && x.units > 100)) add("warn", "Große Wohnanlage / Hochhaus");
    if (x.corner === true) add("warn", "Eckwohnung");
    if (sc && sc.categories.transport.complicated.length)
      add("warn", `Umständliche Verbindung (Bus + S-Bahn + U-Bahn) nach ${sc.categories.transport.complicated.join(", ")}`);
    return w;
  }

  // ------------------------------------------------------------- evaluate

  function evaluate(raw, profile) {
    const x = normalize(raw);
    const checks = mandatoryChecks(x, profile);
    const status = matchStatus(checks);
    const fin = financials(x, profile);
    const rent = rentEstimate(x);
    const sc = score(x, profile, { financials: fin, rent });
    return {
      listing: x,
      checks,
      status,
      failed: checks.filter((c) => c.result === "fail"),
      unknown: checks.filter((c) => c.result === "unknown"),
      financials: fin,
      rent,
      score: sc,
      warnings: warnings(x, fin, rent, sc, profile),
    };
  }

  // ------------------------------------------------- dedup and history

  function canonicalUrl(u) {
    if (!u || typeof u !== "string") return null;
    try {
      const p = new URL(u.trim());
      const host = p.hostname.toLowerCase().replace(/^www\./, "");
      const path = p.pathname.replace(/\/+$/, "");
      return host + path;
    } catch (e) {
      return u.trim().toLowerCase();
    }
  }

  /**
   * Merge duplicates across portals. Merges on identical id, a shared
   * canonical URL, or identical PLZ + rooms + price with area within 0.5 m².
   * Listings that only look similar (e.g. different price) are kept apart.
   */
  function dedupe(listings) {
    const out = [];
    const sameObject = (a, b) =>
      a.plz && a.plz === b.plz && isNum(a.price) && a.price === b.price && isNum(a.rooms) && a.rooms === b.rooms && isNum(a.area) && isNum(b.area) && Math.abs(a.area - b.area) <= 0.5;
    listings.forEach((l) => {
      const urls = (l.urls || (l.links || []).map((k) => k[1]) || []).map(canonicalUrl).filter(Boolean);
      const hit = out.find((o) => o.id === l.id || o._urls.some((u) => urls.includes(u)) || sameObject(o, l));
      if (hit) {
        urls.forEach((u) => {
          if (!hit._urls.includes(u)) hit._urls.push(u);
        });
        (l.urls || []).forEach((u) => {
          if (!hit.urls.includes(u)) hit.urls.push(u);
        });
        if (hit.id !== l.id && !hit.dupIds.includes(l.id)) hit.dupIds.push(l.id);
      } else {
        out.push(Object.assign({}, l, { urls: (l.urls || []).slice(), dupIds: (l.dupIds || []).slice(), _urls: urls }));
      }
    });
    return out.map((o) => {
      delete o._urls;
      return o;
    });
  }

  /** Compare two runs. Status values: NEW, PRICE_DROP, PRICE_INCREASE, UNCHANGED; plus removed ids. */
  function compareSnapshots(prev, curr) {
    const byId = new Map((prev || []).map((l) => [l.id, l]));
    const byUrl = new Map();
    (prev || []).forEach((l) => (l.urls || []).forEach((u) => byUrl.set(canonicalUrl(u), l)));
    const seen = new Set();
    const items = (curr || []).map((l) => {
      let p = byId.get(l.id);
      if (!p) p = (l.urls || []).map((u) => byUrl.get(canonicalUrl(u))).find(Boolean);
      if (!p) return { id: l.id, status: "NEW", prevPrice: null };
      seen.add(p.id);
      if (isNum(p.price) && isNum(l.price) && l.price < p.price) return { id: l.id, status: "PRICE_DROP", prevPrice: p.price };
      if (isNum(p.price) && isNum(l.price) && l.price > p.price) return { id: l.id, status: "PRICE_INCREASE", prevPrice: p.price };
      return { id: l.id, status: "UNCHANGED", prevPrice: null };
    });
    const removed = (prev || []).filter((l) => !seen.has(l.id)).map((l) => l.id);
    return { items, removed };
  }

  /** Build first-seen / last-seen / price history from snapshots sorted by date. */
  function trackHistory(snapshots) {
    const h = {};
    snapshots.forEach((s) => {
      (s.listings || []).forEach((l) => {
        const e = h[l.id] || (h[l.id] = { firstSeen: s.date, lastSeen: s.date, prices: [] });
        e.lastSeen = s.date;
        const last = e.prices[e.prices.length - 1];
        if (isNum(l.price) && (!last || last.price !== l.price)) e.prices.push({ date: s.date, price: l.price });
      });
    });
    return h;
  }

  function freshnessDays(firstSeen, runDate) {
    if (!firstSeen || !runDate) return null;
    const a = Date.parse(String(firstSeen).slice(0, 10));
    const b = Date.parse(String(runDate).slice(0, 10));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  return {
    STATUS,
    normalize,
    parseNumber,
    parseFloor,
    outdoorTypes,
    mandatoryChecks,
    matchStatus,
    financials,
    rentEstimate,
    routeScore,
    score,
    validateWeights,
    warnings,
    evaluate,
    canonicalUrl,
    dedupe,
    compareSnapshots,
    trackHistory,
    freshnessDays,
  };
});
