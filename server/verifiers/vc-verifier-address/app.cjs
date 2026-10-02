'use strict';
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
// Each verifier mounted here has its own .env using the SAME variable names
// (IS_BASE_URL, CLIENT_ID, DEFINITION_ID, APP_PORT, etc). Loading both via
// dotenv.config() into the shared process.env would let whichever loads
// first "win" for every key (dotenv never overwrites an already-set env
// var) - silently making both verifiers use the same DEFINITION_ID. So each
// one parses its own .env into a private object instead of touching
// process.env at all.
const localEnv = dotenv.parse(fs.readFileSync(path.join(__dirname, '.env')));

const express = require('express');
const QRCode  = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const https   = require('https');
const axios   = require('axios');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Config ──────────────────────────────────────────────────────────────

const IS_BASE_URL        = localEnv.IS_BASE_URL       || 'https://localhost:9443';
const CLIENT_ID          = localEnv.CLIENT_ID;
const CLIENT_SECRET      = localEnv.CLIENT_SECRET;
const ORG_ID             = localEnv.ORG_ID            || '';
const DEFINITION_ID      = localEnv.DEFINITION_ID     || '1c666a92-0acd-4fc6-a5e1-3bfde13ede42';
const PORT               = parseInt(localEnv.APP_PORT || '3001', 10);

const TOKEN_ENDPOINT     = ORG_ID ? `/t/carbon.super/o/${ORG_ID}/oauth2/token` : '/oauth2/token';
const VERIFY_API         = ORG_ID ? '/t/carbon.super/o/api/server/v1/openid4vp/vc-verifications' : '/api/server/v1/openid4vp/vc-verifications';
const VERIFY_SCOPES      = ORG_ID ? 'internal_org_vc_verification_create%20internal_org_vc_verification_view' : 'internal_vc_verification_create%20internal_vc_verification_view';

// VC Templates Management API — used for Issue Credentials (OID4VCI). This is
// issuance, not verification: we ask WSO2 IS to (re)generate a credential
// offer for this template, then hand the resulting
// "openid-credential-offer://" link to the customer's wallet as a QR code.
// This API is tenant-qualified regardless of ORG_ID, unlike the VP
// verification API above.
const TENANT_DOMAIN      = localEnv.TENANT_DOMAIN     || 'carbon.super';
const ISSUE_TEMPLATE_ID  = localEnv.ISSUE_TEMPLATE_ID || 'a51e8a59-0f38-44b4-80e6-ad9801eb9a9c';
const VC_TEMPLATES_API   = `/t/${TENANT_DOMAIN}/api/server/v1/vc-templates`;
const ISSUE_ADMIN_USERNAME = localEnv.ISSUE_ADMIN_USERNAME || 'admin';
const ISSUE_ADMIN_PASSWORD = localEnv.ISSUE_ADMIN_PASSWORD || 'admin';

function issueAuthHeaders() {
  const basic = Buffer.from(`${ISSUE_ADMIN_USERNAME}:${ISSUE_ADMIN_PASSWORD}`).toString('base64');
  return { Authorization: `Basic ${basic}` };
}

// Axios client for IS — skips self-signed cert check (dev only)
const isClient = axios.create({
  baseURL: IS_BASE_URL,
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  timeout: 10000,
});

// ── Copy for each "reason" a verification can be triggered for ───────────────
// The Bank Of Asgard React app links here with ?reason=<key> so this portal can
// show contextual copy for whatever the customer is trying to do. Add more
// entries here to support additional cross-app call-to-actions.

const REASON_COPY = {
  statement: {
    badge:            'Account Statement Request',
    heading:          'Verify to Download Your Statement',
    subtitle:         "Present your Digital ID Wallet credential to securely confirm it's really you before Bank Of Asgard releases your latest account statement.",
    qrLabel:          'Scan to verify and unlock your statement',
    eligibilityTitle: 'Statement access approved',
    eligibilityBody:  "Identity confirmed. You can now download your latest Bank Of Asgard account statement from the app.",
  },
  'verify-address': {
    badge:            'Address Verification',
    heading:          'Verify Your Address',
    subtitle:         'Present your Digital ID Wallet credential to verify the address Bank Of Asgard has on file for you.',
    qrLabel:          'Scan to verify your address',
    eligibilityTitle: 'Address verified',
    eligibilityBody:  "Your address has been verified and will now appear on your Bank Of Asgard profile.",
  },
  default: {
    badge:            null,
    heading:          'Present Your Digital ID',
    subtitle:         'Ask the customer to scan this code with their digital ID wallet. They\'ll be asked to consent before anything is shared with Bank Of Asgard.',
    qrLabel:          'Scan with your Digital ID Wallet',
    eligibilityTitle: 'Approved to proceed',
    eligibilityBody:  "The customer's identity has been confirmed. This verification can now be used to complete account opening, approve a transaction, or check in for a branch appointment.",
  },
};

function copyForReason(reason) {
  return REASON_COPY[reason] || REASON_COPY.default;
}

// ── Copy for credential-issuance reasons (OID4VCI, not the OID4VP copy above) ─

const ISSUE_REASON_COPY = {
  'issue-credentials': {
    badge:        'Credential Issuance',
    heading:      'Add Your Verifiable Credential',
    subtitle:     'Scan this code with your Digital ID Wallet to receive a new verifiable credential from Bank Of Asgard.',
    qrLabel:      'Scan to add this credential to your wallet',
    successBody:  "Your Digital ID Wallet now holds this verifiable credential from Bank Of Asgard.",
  },
  default: {
    badge:        'Credential Issuance',
    heading:      'Add Your Verifiable Credential',
    subtitle:     'Scan this code with your Digital ID Wallet to receive a new verifiable credential.',
    qrLabel:      'Scan to add this credential to your wallet',
    successBody:  "Your Digital ID Wallet now holds this verifiable credential.",
  },
};

function issueCopyForReason(reason) {
  return ISSUE_REASON_COPY[reason] || ISSUE_REASON_COPY.default;
}

// ── Token cache (optional — VP verification APIs are public) ──────────────────
// Cached per requested scope string, since Issue Credentials needs a
// different OAuth2 scope (VC Templates Management API) than the VP
// verification flow above.

const tokenCache = new Map(); // scopes -> { token, expiresAt }

async function getAccessToken(scopes = VERIFY_SCOPES) {
  if (!CLIENT_ID || !CLIENT_SECRET) return null;

  const cached = tokenCache.get(scopes);
  if (cached && Date.now() < cached.expiresAt - 10000) return cached.token;

  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const resp = await isClient.post(
    TOKEN_ENDPOINT,
    `grant_type=client_credentials&scope=${scopes}`,
    {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  tokenCache.set(scopes, {
    token:     resp.data.access_token,
    expiresAt: Date.now() + (resp.data.expires_in * 1000),
  });
  return resp.data.access_token;
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Session store: sessionId → { status, requestId, presentation, error, reason } ─

const sessions = new Map();

// ── Routes ───────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.render('index'));

// Start verification — call IS to initiate VP session.
// Supports both:
//   POST /verify              (the "Generate Verification Request" button on this portal)
//   GET  /verify?reason=...   (a deep link/popup opened from the Bank Of Asgard app)
async function startVerification(req, res) {
  const reason    = (req.query.reason || req.body.reason || 'default').toString();
  const sessionId = uuidv4();
  sessions.set(sessionId, { status: 'pending', requestId: null, presentation: null, error: null, reason });

  try {
    const token = await getAccessToken();

    const resp = await isClient.post(
      VERIFY_API,
      { presentationDefinitionIdentifier: DEFINITION_ID },
      { headers: authHeaders(token) },
    );

    const { requestId, walletUrl } = resp.data;
    sessions.get(sessionId).requestId = requestId;

    const qrDataUrl = await QRCode.toDataURL(walletUrl, {
      width: 300,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });

    res.render('verify', { sessionId, qrDataUrl, walletUrl, reason, copy: copyForReason(reason) });
  } catch (err) {
    console.error('Initiate error:', err.response?.data || err.message);
    sessions.delete(sessionId);
    res.status(500).render('error', {
      message: 'Could not initiate verification. Is WSO2 IS running and the M2M app configured?',
      detail: err.response?.data?.description || err.message,
    });
  }
}

app.post('/verify', startVerification);
app.get('/verify', startVerification);

// Issue a Verifiable Credential — OID4VCI, not OID4VP. We POST to WSO2 IS to
// (re)generate the credential offer for ISSUE_TEMPLATE_ID, then show the
// resulting "openid-credential-offer://" link as a QR code for the
// customer's wallet to scan. This is a separate, standalone popup — there
// is no server-side callback that tells us the wallet accepted the
// credential, so this page doesn't poll a session the way /verify does; it
// shows the offer and lets the customer confirm once they've added it.
//   POST /issue              (the "Generate Credential Offer" button on this portal)
//   GET  /issue?reason=...   (a deep link/popup opened from the Bank Of Asgard app)
async function startIssuance(req, res) {
  const reason = (req.query.reason || req.body.reason || 'issue-credentials').toString();

  try {
    const offerResp = await isClient.post(
      `${VC_TEMPLATES_API}/${ISSUE_TEMPLATE_ID}/offer`,
      {},
      { headers: issueAuthHeaders() },
    );

    let offerId = offerResp.data && offerResp.data.offerId;

    if (!offerId) {
      const templateResp = await isClient.get(
        `${VC_TEMPLATES_API}/${ISSUE_TEMPLATE_ID}`,
        { headers: issueAuthHeaders() },
      );
      offerId = templateResp.data && templateResp.data.offerId;
    }

    if (!offerId) {
      throw new Error(`WSO2 IS did not return an offerId for template "${ISSUE_TEMPLATE_ID}".`);
    }

    const offerUri  = `${IS_BASE_URL}/oid4vci/credential-offer/${offerId}`;
    const offerLink = `openid-credential-offer://?credential_offer_uri=${offerUri}`;

    const qrDataUrl = await QRCode.toDataURL(offerLink, {
      width: 300,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });

    res.render('issue', { qrDataUrl, offerLink, reason, copy: issueCopyForReason(reason) });
  } catch (err) {
    console.error('Issuance error:', err.response?.data || err.message);
    res.status(500).render('error', {
      message: 'Could not generate a credential offer. Is WSO2 IS running and ISSUE_TEMPLATE_ID configured correctly?',
      detail: err.response?.data?.description || err.message,
    });
  }
}

app.post('/issue', startIssuance);
app.get('/issue', startIssuance);

// Poll endpoint — browser calls this every 2s from the verify page
app.get('/session/:id', async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Unknown session' });

  if (session.status === 'pending' && session.requestId) {
    try {
      const token = await getAccessToken();
      const resp = await isClient.get(
        `${VERIFY_API}/${session.requestId}`,
        { headers: authHeaders(token) },
      );

      console.log('[VP STATUS RAW]', JSON.stringify(resp.data, null, 2));
      const { status, presentation, errors } = resp.data;

      if (status === 'VERIFIED') {
        session.status = 'verified';
        session.presentation = presentation || null;
      } else if (status === 'FAILED') {
        session.status = 'error';
        session.error  = (errors && errors.length) ? errors[0] : 'Verification failed';
      }
      // ACTIVE — keep polling
    } catch (err) {
      if (err.response?.status === 404) {
        session.status = 'error';
        session.error  = 'Verification session expired or not found';
      }
      // Other errors — silently continue polling
    }
  }

  res.json(session);
});

// Result page
app.get('/result/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).render('error', { message: 'Session not found', detail: '' });
  if (session.status === 'pending') return res.redirect(`/verify-page/${req.params.id}`);

  res.render('result', { session, sessionId: req.params.id, copy: copyForReason(session.reason) });
});

// NOTE: this module no longer calls app.listen() itself — it's mounted and
// started from bank-of-asgard-main/server/server.js so that starting the
// main server starts this verifier too. See server.js for the .listen() call
// and startup log line.
module.exports = { app, PORT, IS_BASE_URL, DEFINITION_ID, TENANT_DOMAIN, ISSUE_TEMPLATE_ID, CLIENT_ID, CLIENT_SECRET };
