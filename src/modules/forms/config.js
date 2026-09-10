export function stripPhoneExtension(value) {
  return String(value || '').replace(/\s*(?:ext\.?|extension|x|#)\s*\d+\s*$/i, '');
}

export function cleanPhoneInput(value) {
  const withoutExtension = stripPhoneExtension(value).trim();
  if (!withoutExtension) return '';
  if (withoutExtension.startsWith('+')) return `+${withoutExtension.slice(1).replace(/\D/g, '')}`;
  return withoutExtension.replace(/\D/g, '');
}

export function buildPhoneValue(phone, countryCode) {
  const cleanPhone = cleanPhoneInput(phone);
  if (!cleanPhone || cleanPhone === '+') return cleanPhone;

  const phoneDigits = cleanPhone.replace(/\D/g, '');
  const countryDigits = String(countryCode || '').replace(/\D/g, '');

  if (phoneDigits.startsWith('00') && phoneDigits.length > 2) return `+${phoneDigits.slice(2)}`;

  if (cleanPhone.startsWith('+')) {
    if (countryDigits && phoneDigits.startsWith(countryDigits + countryDigits)) {
      return `+${countryDigits}${phoneDigits.slice(countryDigits.length * 2)}`;
    }
    return `+${phoneDigits}`;
  }

  if (!countryDigits) return cleanPhone;

  if (phoneDigits.startsWith(countryDigits + countryDigits)) {
    return `+${countryDigits}${phoneDigits.slice(countryDigits.length * 2)}`;
  }

  if (phoneDigits.startsWith(countryDigits) && phoneDigits.length > countryDigits.length) {
    return `+${phoneDigits}`;
  }

  return `+${countryDigits}${phoneDigits.replace(/^0+/, '')}`;
}

/** Attribution + URL-sync fields — single source of truth for excluded/hidden tracking names. */
export const TRACKING_FIELDS = [
  'current_url',
  'first_landing_url',
  'first_page',
  'last_page',
  'referrer_url',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'GCLID',
  'fbclid',
  'unique_id',
  'lead_reference',
  'quote_url',
  'all_files_url',
];

// Shared by the gold form (gold loans) and the standalone pawn loan calculator,
// so a rate change can never apply to only one of them.
const LOAN_RATE_BANDS = [
  { maxExclusive: 5000, interestRate: 6.5, apr: 93.21 },
  { maxInclusive: 15000, interestRate: 6.0, apr: 84.96 },
];

export const formConfig = {
  selectors: {
    root: '[data-form]',
    field: '[data-form-field]',
    step: '[data-form-step]',
    stepCurrent: '[data-form-step-current]',
    stepTotal: '[data-form-step-total]',
    choice: '[data-form-choice]',
    choiceInput: "input[type='radio'], input[type='checkbox']",
    choiceGroup: '[data-form-choice-group]',
    fieldGroup: '[data-form-field-group]',
    upload: '[data-form-upload]',
    uploadTrigger: '[data-form-upload-trigger]',
    uploadRemove: '[data-form-upload-remove]',
    error: '[data-form-error], .form_field-error',
    conditional: '[data-form-show-if], [data-form-show-if-group], [data-form-hide-if], [data-form-hide-if-group], [data-form-hide-if-any], [data-form-hide-if-any-group]',
    action: '[data-form-action]',
    // `data-form-upload-value-image` is the explicit name; bare
    // `data-form-upload-value` is the backward-compatible alias for older
    // single-field forms. Images land here → Zoho Image Upload field.
    uploadValue: '[data-form-upload-value-image], [data-form-upload-value]',
    // Documents and videos land here → Zoho File Upload field. If a widget
    // has no file target, everything falls back to uploadValue.
    uploadValueFile: '[data-form-upload-value-file]',
    uploadName: '[data-form-upload-name], .form_upload-name',
    controls: 'input, select, textarea, button',
  },

  params: {
    enabled: true,
    watch: true,
    updateUrl: false,
    stripAfterHydrate: true,
    separator: '.',
    fieldAliases: {},
    excludedFields: new Set(TRACKING_FIELDS),
  },

  attribution: {
    storageKey: 'sr_attribution',
    quoteUrlFallbackPath: '/get-a-quote',
    quoteUrlStep: '2',
    utmParams: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'],
    clickIdParams: ['gclid', 'fbclid'],
    // "Real sales lead" (not newsletter/utility) for GTM: it triggers off
    // the form_category field this produces, instead of hardcoding form
    // keys in GTM.
    leadFormKeys: new Set(['get-a-quote', 'gold', 'appointment', 'courier']),
  },

  uploads: {
    workerBase: 'https://suttons-form-helper.silent-breeze-25c2.workers.dev',
    workerUploadPath: '/upload',
    clientHeaderName: 'X-Suttons-Client',
    clientHeaderValue: 'suttons-form-v2-2026',
    tempFileTimeoutMs: 5 * 60 * 1000,
    maxBytes: 20 * 1024 * 1024,
    // Single source of truth for customer-facing upload copy. Keep in sync
    // with allowedMimeTypes / allowedExtensions below.
    acceptedLabel: 'JPEG, PNG, HEIC, HEIF, WEBP, GIF, PDF, DOC, DOCX, MP4, MOV, WEBM',
    // Images: WebP/HEIC/HEIF are transcoded to JPEG server-side by the
    // Worker; documents/videos pass through unconverted to Zoho's File
    // Upload field. Mirrors the Worker's ALLOWED_TYPES / ALLOWED_EXTENSIONS
    // (authoritative there) — update both together.
    allowedMimeTypes: [
      // images
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'image/heic', 'image/heif',
      // documents
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      // videos
      'video/mp4', 'video/quicktime', 'video/webm',
    ],
    allowedExtensions: [
      '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif',
      '.pdf', '.doc', '.docx',
      '.mp4', '.mov', '.webm',
    ],
  },

  successPages: {
    enabled: true,
    // enquiry_type intentionally excluded so it isn't placed in the thank-you
    // URL / browser history / referrer.
    includeParams: ['form', 'reference', 'asset_type'],
  },

  submit: {
    // Same-named hidden inputs, each gated by show-if, where exactly one
    // should submit; without dedup, Zapier/Zoho would pick the wrong one.
    // See core/fields.js prepareChooseOneControls.
    // Names authored as SEVERAL controls in the Designer that must collapse to
    // one submitted value. The losers are RENAMED to unsubmittedNamePrefix, which
    // is the only thing that removes a key from Webflow's payload — disabling a
    // control does not (see core/app.js).
    //
    // `New_Lead_Type` was removed on 9 Sep 2026, and box_and_papers,
    // meeting_venue and appointment_length with it. All four are decided in
    // submit-values/ now. New_Lead_Type in particular is authored in no page's
    // markup — a live grep of all six lead pages finds no control of that name
    // — so it had nothing to dedup, and while it stayed in this list a render
    // pass between two applies could rename the rule's OWN hidden. It cannot
    // go back to markup either: the dedup submits exactly one control and this
    // value accumulates.
    chooseOneFieldNames: ['bullion_name'],
    unsubmittedNamePrefix: '_disabled_',
  },

  gold: {
    priceEndpoint: '/gold/price',
    trendEndpoint: '/gold/trend',
    currency: 'GBP',
    ouncesPerTroy: 31.1034768,
    purchaseToValuePercent: 88,
    // Per-item-type purchase rate override, whole percent, applied instead of
    // purchaseToValuePercent above (see gold.js getOfferRatio). Jewellery only
    // (869eu8kr1, Sam 25 Aug: "for jewellery only the 88% to 86%, coins and
    // bars to remain at 88%"). PURCHASES ONLY — loans use loanToValuePercent
    // for every item type, so adding a key here never moves a loan offer.
    // An absent, blank or non-numeric entry falls back to the 88 above.
    purchaseToValuePercentByItemType: {
      jewellery: 86,
    },
    loanToValuePercent: 75,
    // Reduces live spot by this percent before purchase/loan ratios apply
    // (see gold.js getSpotOfferMultiplier). Set to 0 to disable.
    // This is the "top line" discount, spot price to working price (Sam,
    // 21 Jul: "take 2% off the spot price BEFORE applying the discounting
    // below" to purchases and loans). It therefore reduces loan offers as
    // well as purchases, by design. 2 -> 3 on 9 Sep 2026 (869eu8kr1).
    spotDiscountPercent: 3,
    loanTermMonths: 6,
    rateBands: LOAN_RATE_BANDS,
  },

  loan: {
    min: 500,
    max: 15000,
    step: 500,
    durations: [1, 2, 3, 4, 5, 6],
    defaultDuration: 3,
    noSavingMessage: "Our rates are similar to the largest pawnbroker. Find out why to choose us.",
    rateBands: LOAN_RATE_BANDS,
    competitorLabel: "the UK's largest pawnbroker",
    // These competitor rates are MONTHLY, the same basis as `interestRate`
    // above. The savings calc in loan.js relies on this.
    competitorRates: [
      { maxInclusive: 1500, rate: 10.49 },
      { maxInclusive: 3500, rate: 9.49 },
      { maxInclusive: 5000, rate: 9.0 },
      { maxInclusive: 7500, rate: 8.0 },
      { maxInclusive: 10000, rate: 7.0 },
    ],
  },

  ignoredFieldTypes: new Set(['hidden', 'submit', 'button', 'reset']),
  ignoredTypePresetFields: new Set(['file', 'radio', 'checkbox']),
  managedAttributes: ['inputmode', 'autocomplete', 'maxlength'],

  address: {
    // Google Places API key, restricted by HTTP referrer to the site's
    // domain(s). No runtime override exists; edit the value below to change it.
    googlePlacesApiKey: 'AIzaSyARV7qz4ohGmCpEFJGCegIe27r5PzF2v1o',
    placesApiBase: 'https://places.googleapis.com/v1',
    ukOnly: true,

    // Demo mode: no API key needed. Generates fake suggestions and address
    // data. Set to false once a real googlePlacesApiKey is configured.
    demo: false,
  },
};

export const fieldRules = {
  first_name: { maxlength: 40, autocomplete: 'given-name' },
  last_name: { maxlength: 80, autocomplete: 'family-name' },
  email: { maxlength: 100 },
  address_search: { autocomplete: 'off', maxlength: 255 },
  house_number: { autocomplete: 'off', maxlength: 100 },
  address_line_1: { autocomplete: 'address-line1', maxlength: 255 },
  address_line_2: { autocomplete: 'address-line2', maxlength: 255 },
  town_city: { autocomplete: 'address-level2', maxlength: 100 },
  county: { autocomplete: 'address-level1', maxlength: 100 },
  postcode: {
    autocomplete: 'postal-code',
    validate: 'postcode',
    maxlength: 10,
    message: 'Enter a valid postcode.',
  },
  country: { autocomplete: 'country-name', maxlength: 100 },
  model: {
    maxlength: 255,
  },
  additional_information: { maxlength: 1000 },
  additional_info: { maxlength: 1000 },
  weight_grams: {
    inputmode: 'decimal',
    validate: 'money',
    filter: 'money',
    min: 0.01,
    max: 1000,
    message: 'Enter a valid weight up to 1,000g.',
  },
  weight_grams_9ct: {
    inputmode: 'decimal',
    validate: 'money',
    filter: 'money',
    min: 0.01,
    max: 1000,
    message: 'Enter a valid weight up to 1,000g.',
  },
  weight_grams_14ct: {
    inputmode: 'decimal',
    validate: 'money',
    filter: 'money',
    min: 0.01,
    max: 1000,
    message: 'Enter a valid weight up to 1,000g.',
  },
  weight_grams_18ct: {
    inputmode: 'decimal',
    validate: 'money',
    filter: 'money',
    min: 0.01,
    max: 1000,
    message: 'Enter a valid weight up to 1,000g.',
  },
  weight_grams_22ct: {
    inputmode: 'decimal',
    validate: 'money',
    filter: 'money',
    min: 0.01,
    max: 1000,
    message: 'Enter a valid weight up to 1,000g.',
  },
  weight_grams_24ct: {
    inputmode: 'decimal',
    validate: 'money',
    filter: 'money',
    min: 0.01,
    max: 1000,
    message: 'Enter a valid weight up to 1,000g.',
  },
  quantity: {
    inputmode: 'numeric',
    validate: 'integer',
    filter: 'integer',
    min: 1,
    message: 'Enter a valid quantity.',
  },
  quantity_item_1: {
    inputmode: 'numeric',
    validate: 'integer',
    filter: 'integer',
    min: 1,
    message: 'Enter a valid quantity.',
  },
};

export const fieldTypes = {
  text: {
    inputType: 'text',
  },
  email: {
    inputType: 'text',
    inputmode: 'email',
    autocomplete: 'email',
    validate: 'email',
    message: 'Enter a valid email address.',
  },
  phone: {
    inputType: 'tel',
    inputmode: 'tel',
    autocomplete: 'tel',
    validate: 'phone',
    filter: 'phone',
    message: 'Enter a valid phone number.',
  },
  money: {
    inputType: 'text',
    inputmode: 'decimal',
    validate: 'money',
    filter: 'money',
    message: 'Enter a valid amount.',
  },
  integer: {
    inputType: 'text',
    inputmode: 'numeric',
    validate: 'integer',
    filter: 'integer',
    message: 'Enter a whole number.',
  },
  year: {
    inputType: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    validate: 'year',
    filter: 'year',
    maxlength: '4',
    message: 'Enter a valid year.',
  },
  postcode: {
    inputType: 'text',
    inputmode: 'text',
    autocomplete: 'postal-code',
    validate: 'postcode',
    maxlength: 10,
    message: 'Enter a valid postcode.',
  },
  date: {
    inputType: 'date',
    validate: 'date',
    message: 'Please select a date.',
  },
  time: {
    validate: 'required',
    message: 'Please select a time.',
  },
};

export const fieldFilters = {
  phone(value) {
    return cleanPhoneInput(value);
  },
  money(value) {
    if (String(value || '').includes('-')) return '';
    const clean = value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
    const [integerPart, fractionPart] = clean.split('.');
    const formattedInteger = integerPart
      ? new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(Number(integerPart))
      : '';

    if (!clean.includes('.')) return formattedInteger;
    return `${formattedInteger}.${fractionPart || ''}`;
  },
  integer(value) {
    if (String(value || '').includes('-')) return '';
    return value.replace(/[^0-9]/g, '');
  },
  year(value) {
    return value.replace(/[^0-9]/g, '').slice(0, 4);
  },
  noSpaces(value) {
    return value.replace(/\s/g, '');
  },
};

export const fieldValidators = {
  email(value) {
    if (/[<>]/.test(value)) return false;
    // Domain must be dot-separated labels with a real TLD: no leading or
    // trailing dot, no consecutive dots. The old [^\s@]+ let "x@y.com."
    // through, which Zoho then rejected. Local part still allows internal dots.
    return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(String(value).trim());
  },
  phone(value) {
    const clean = String(value || '').trim();
    const digits = clean.replace(/\D/g, '');
    const digitCount = digits.length;
    if (!/^[0-9+()\s-]{9,}$/.test(clean)) return false;
    const isInternational = clean.startsWith('+') || digits.startsWith('00');
    return isInternational
      ? digitCount >= 10 && digitCount <= 15
      : digitCount >= 9 && digitCount <= 11;
  },
  noSpaces(value) {
    return !/\s/.test(value);
  },
  postcode(value) {
    const clean = value.trim().toUpperCase();
    const normalised = clean.replace(/\s+/g, ' ');
    return /^[A-Z]{1,2}[0-9][A-Z0-9]?\s?[0-9][A-Z]{2}$/.test(normalised) || normalised.replace(/\s+/g, '') === 'GIR0AA';
  },
  money(value) {
    const amount = Number(String(value).replace(/[^0-9.-]/g, ''));
    return !Number.isNaN(amount) && amount > 0;
  },
  integer(value) {
    return /^[0-9]+$/.test(value);
  },
  year(value) {
    const year = Number(value);
    const currentYear = new Date().getFullYear();
    return /^[0-9]{4}$/.test(value) && year >= 1900 && year <= currentYear;
  },
  date(value) {
    if (!value) return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime());
  },
  required(value) {
    return Boolean(value && String(value).trim());
  },
};
