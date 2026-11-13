/**
 * Plan-Tiers für Managed-SaaS-Instanzen.
 * Plan kommt aus BELEGO_PLAN; fehlt er, läuft die Instanz als "selfhosted" ohne Einschränkungen.
 * Siehe docs/superpowers/specs/2026-11-13-plan-tiers.md
 */

export const FEATURES = ['email', 'reminders', 'jobs', 'customerPricing', 'reportingFull'];

const STARTER_FEATURES = ['email', 'reminders'];

export const PLANS = {
  selfhosted: {
    label: 'Self-Hosted',
    limits: { invoicesPerMonth: null, quotesPerMonth: null, customers: null },
    features: FEATURES,
  },
  free: {
    label: 'Free',
    limits: { invoicesPerMonth: 5, quotesPerMonth: 5, customers: 10 },
    features: [],
  },
  starter: {
    label: 'Starter',
    limits: { invoicesPerMonth: 25, quotesPerMonth: 25, customers: 50 },
    features: STARTER_FEATURES,
  },
  professional: {
    label: 'Professional',
    limits: { invoicesPerMonth: 100, quotesPerMonth: 100, customers: 250 },
    features: FEATURES,
  },
  enterprise: {
    label: 'Enterprise',
    limits: { invoicesPerMonth: null, quotesPerMonth: null, customers: null },
    features: FEATURES,
  },
};

/** Löst den Plan-Namen auf. Unbekannte Werte werfen, damit ein Tippfehler nicht still unlimited ergibt. */
export function resolvePlanName(value) {
  const name = (value ?? '').trim().toLowerCase();
  if (name === '') return 'selfhosted';
  if (!Object.hasOwn(PLANS, name) || name === 'selfhosted') {
    throw new Error(`Unbekannter BELEGO_PLAN "${value}". Erlaubt: free, starter, professional, enterprise oder leer.`);
  }
  return name;
}

export function getPlanName() {
  return resolvePlanName(process.env.BELEGO_PLAN);
}

export function getPlan() {
  return PLANS[getPlanName()];
}

export function hasFeature(feature) {
  return getPlan().features.includes(feature);
}

/** Limit für kind ('invoices' | 'quotes' | 'customers'); null = unbegrenzt. */
export function getLimit(kind) {
  const { limits } = getPlan();
  if (kind === 'invoices') return limits.invoicesPerMonth;
  if (kind === 'quotes') return limits.quotesPerMonth;
  if (kind === 'customers') return limits.customers;
  throw new Error(`Unbekannte Limit-Art: ${kind}`);
}

export function getUpgradeContact() {
  return process.env.BELEGO_UPGRADE_CONTACT?.trim() || null;
}

/** Abrechnungsperiode 'YYYY-MM' in deutscher Zeit. */
export function currentPeriod(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' })
    .formatToParts(date);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  return `${year}-${month}`;
}

const LIMIT_MESSAGES = {
  invoices: 'Monatliches Limit für Rechnungen erreicht.',
  quotes: 'Monatliches Limit für Angebote erreicht.',
  customers: 'Maximale Anzahl an Kunden erreicht.',
};

export class PlanError extends Error {
  constructor(statusCode, body) {
    super(body.error);
    this.statusCode = statusCode;
    this.body = body;
  }
}

export function planLimitError(kind, limit) {
  return new PlanError(402, {
    error: `${LIMIT_MESSAGES[kind]} Für mehr bitte Ihren Tarif upgraden.`,
    code: 'PLAN_LIMIT_REACHED',
    kind,
    limit,
    plan: getPlanName(),
    upgradeContact: getUpgradeContact(),
  });
}

export function featureNotInPlanError(feature) {
  return new PlanError(403, {
    error: 'Diese Funktion ist in Ihrem Tarif nicht enthalten.',
    code: 'FEATURE_NOT_IN_PLAN',
    feature,
    plan: getPlanName(),
    upgradeContact: getUpgradeContact(),
  });
}

/** Sendet PlanError als Antwort. Gibt true zurück, wenn behandelt. */
export function sendPlanError(res, error) {
  if (!(error instanceof PlanError)) return false;
  res.status(error.statusCode).json(error.body);
  return true;
}

/**
 * Express-Middleware: blockiert Anfragen, wenn das Feature nicht im Plan ist.
 * Mit { allowRead: true } bleiben GET-Anfragen erlaubt, damit Bestandsdaten nach Downgrade sichtbar bleiben.
 */
export function requireFeature(feature, { allowRead = false } = {}) {
  return (req, res, next) => {
    if (hasFeature(feature)) return next();
    if (allowRead && req.method === 'GET') return next();
    sendPlanError(res, featureNotInPlanError(feature));
  };
}
