import PropTypes from "prop-types";
import { createContext, useEffect, useState } from "react";
import { useAsgardeo } from "@asgardeo/react";
import { environmentConfig } from "../util/environment-util";
import { getExtendedProfile, updateExtendedProfile } from "../api/profile";

const WalletContext = createContext(null);

const CUSTOM_SCHEMA = "urn:scim:schemas:extension:custom:User";

// Parses the linkedwalletholders claim, stored as a plain comma-separated
// string (e.g. "did:key:abcd,jane@gmail.com") rather than a native SCIM
// multi-valued attribute or a JSON-encoded array. Comma-separated, NOT
// JSON: WSO2 IS's SCIM2 write path validates custom string-claim values
// with its own generic character check on top of whatever the claim's own
// regEx says (which was empty here) - square brackets and double quotes
// (i.e. JSON.stringify's own array syntax) get rejected with "...is not
// in the correct format", confirmed via the server's own PATCH error log.
// A holder id (a DID or, via the fallback chain in the verifier's
// result.ejs, an email) never itself contains a comma, so this is a safe
// delimiter. Tolerant of the value being missing, empty, or (from before
// this fix, or a manual edit) still JSON-array-shaped - falls back to
// parsing it as JSON in that case so previously-written data isn't lost.
function parseLinkedWallets(raw) {
  if (!raw) {
    return [];
  }
  if (raw.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// WalletProvider owns everything the Digital ID Wallet verification flows
// (Account Security "Link my Wallet", Balance Statement, Verify My Address)
// read from and write back to the customer's SCIM2 profile:
//   - linkedWallets: every wallet holder id ("person-id") that has been
//     linked to this account, so the account can have more than one linked
//     wallet and Account Security can show which ones are linked instead of
//     a single "linked/not linked" flag.
//   - verifiedAddress / isAddressVerified: the outcome of the "Verify My
//     Address" flow.
//
// Both are persisted to WSO2 IS (custom SCIM2 schema: linkedwalletholders,
// islinkedtogovwallet, homeAddress, isaddressverified) so they survive a
// reload or a later login, not just the current session's React state.
//
// Self-service /scim2/Me works for a normal password login. It 404s for a
// wallet-based sign-in (no backing local SCIM user reachable that way), so
// every read/write here falls back to the BOA server's /me-extended route,
// which resolves the real account via the caller's verified email instead
// (see server/server.js).
const WalletProvider = ({ children }) => {
  const { isSignedIn, http, getAccessToken } = useAsgardeo();

  const [linkAttemptStatus, setLinkAttemptStatus] = useState("idle"); // idle | pending | failed
  const [linkedWallets, setLinkedWallets] = useState([]);
  // Authoritative "is a wallet linked" flag, driven directly from the
  // islinkedtogovwallet claim - mirrors isAddressVerified below rather
  // than being derived from linkedWallets.length. The two normally agree,
  // but treating linkedWallets as the source of truth meant a stale
  // linkedwalletholders value (e.g. left over from before a fix, or from
  // a write that only partially applied) could show "linked" even when
  // islinkedtogovwallet itself was false in WSO2 IS.
  const [isWalletLinked, setIsWalletLinked] = useState(false);
  const [verifiedAddress, setVerifiedAddress] = useState(null);
  const [isAddressVerified, setIsAddressVerified] = useState(false);
  const [isProfileLoading, setIsProfileLoading] = useState(true);

  const applyProfileFields = (custom) => {
    setLinkedWallets(parseLinkedWallets(custom.linkedwalletholders));
    setIsWalletLinked(String(custom.islinkedtogovwallet).toLowerCase() === "true");
    const addressVerified = String(custom.isaddressverified).toLowerCase() === "true";
    // Only surface a persisted home address once it's actually flagged as
    // verified - homeAddress and isaddressverified are always written
    // together by recordAddressVerification below, but this guards against
    // a stale or manually-edited homeAddress value showing up on the
    // profile before (or without) verification.
    if (addressVerified && custom.homeAddress) {
      setVerifiedAddress(custom.homeAddress);
    }
    setIsAddressVerified(addressVerified);
  };

  // Small delay helper for the retry below.
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Falls back to the BOA server's /me-extended lookup (see server.js).
  // Retried a couple of times with a short backoff: right after a fresh
  // wallet-login redirect, getAccessToken() can occasionally be called
  // before the SDK has actually finished the token exchange, which would
  // otherwise cause this fallback to fail once and silently leave the
  // profile blank for the rest of the session (linking/address status
  // included).
  const loadExtendedProfileWithRetry = async (attemptsLeft = 3) => {
    try {
      const token = await getAccessToken();
      const response = await getExtendedProfile(token);
      console.log("[WalletProvider] /me-extended fallback succeeded:", response.data);
      applyProfileFields(response.data || {});
    } catch (err) {
      console.log(
        `[WalletProvider] /me-extended fallback failed (attempts left after this: ${attemptsLeft - 1}):`,
        err?.response?.data || err?.message || err
      );
      if (attemptsLeft > 1) {
        await sleep(600);
        return loadExtendedProfileWithRetry(attemptsLeft - 1);
      }
      // Nothing to show either way - leave defaults (no linked wallets,
      // no verified address). Balance Statement / Verify My Address stay
      // gated behind "Link your Digital ID Wallet first".
    }
  };

  // On login, load whatever's already on the profile so linked wallets and
  // a previously-verified address show immediately, without the customer
  // having to redo either flow every session.
  useEffect(() => {
    if (!isSignedIn) {
      return;
    }

    setIsProfileLoading(true);

    http.request({
      method: "GET",
      headers: { "Accept": "application/json" },
      url: `${environmentConfig.IDP_BASE_URL}/scim2/Me`,
    }).then((response) => {
      const customSchema = response?.data?.[CUSTOM_SCHEMA] || {};
      console.log("[WalletProvider] self-service /scim2/Me succeeded:", customSchema);
      applyProfileFields(customSchema);
    }).catch(async (err) => {
      // Expected for wallet-based sign-ins (no backing local SCIM user
      // reachable via the caller's own token) - fall back to the
      // server-side, email-resolved lookup instead of leaving the profile
      // blank.
      console.log(
        "[WalletProvider] self-service /scim2/Me failed (expected for a wallet-based login), falling back to /me-extended:",
        err?.response?.status || err?.message || err
      );
      await loadExtendedProfileWithRetry();
    }).finally(() => {
      setIsProfileLoading(false);
    });
  }, [isSignedIn]);

  // Writes the given custom-schema fields to the profile, trying
  // self-service first and falling back to the server-resolved route on
  // failure - mirrors the read path above. Best-effort: a failure here
  // still leaves the in-memory state (already updated by the caller)
  // correct for the rest of this session, it just won't carry over.
  //
  // Logged just as verbosely as the read path (loadExtendedProfileWithRetry
  // above) and retried the same way - a write made right after a fresh
  // wallet login is just as exposed to getAccessToken() not being ready
  // yet as a read is, and a silently-failed write is exactly what was
  // causing "wallet linked" to not persist across sessions even after the
  // in-memory list updated correctly for the current one.
  const persistProfileFields = async (fields, attemptsLeft = 3) => {
    try {
      await http.request({
        method: "PATCH",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/scim+json",
        },
        data: {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          // One "replace" operation per field, each with its own explicit
          // path, rather than a single operation whose value is a nested
          // object with all the fields on it. WSO2 IS's SCIM2 handler was
          // observed to only reliably apply one attribute out of a
          // multi-attribute nested-value replace (linkedwalletholders
          // would persist, islinkedtogovwallet silently wouldn't, from
          // the exact same request) - per-attribute path operations are
          // the more spec-compliant form and don't hit that.
          Operations: Object.entries(fields).map(([key, value]) => ({
            op: "replace",
            path: `${CUSTOM_SCHEMA}:${key}`,
            value,
          })),
        },
        url: `${environmentConfig.IDP_BASE_URL}/scim2/Me`,
      });
      console.log("[WalletProvider] self-service PATCH /scim2/Me succeeded:", fields);
    } catch (err) {
      console.log(
        "[WalletProvider] self-service PATCH /scim2/Me failed (expected for a wallet-based login), falling back to /me-extended:",
        err?.response?.status || err?.message || err
      );
      try {
        const token = await getAccessToken();
        await updateExtendedProfile(token, fields);
        console.log("[WalletProvider] /me-extended PATCH fallback succeeded:", fields);
      } catch (fallbackError) {
        console.log(
          `[WalletProvider] /me-extended PATCH fallback failed (attempts left after this: ${attemptsLeft - 1}):`,
          fallbackError?.response?.data || fallbackError?.message || fallbackError
        );
        if (attemptsLeft > 1) {
          await sleep(600);
          return persistProfileFields(fields, attemptsLeft - 1);
        }
        console.error(
          "[WalletProvider] Could not persist profile fields after retries - this write will not survive a reload/re-login:",
          fields
        );
      }
    }
  };

  // Called once a wallet-link verification popup reports success, with the
  // holder id (person-id) disclosed in that presentation. Adds it to the
  // linked-wallets list (deduping) instead of replacing a single flag, so
  // the customer can link more than one wallet over time and Account
  // Security can list all of them.
  const recordWalletLink = (holderId) => {
    setLinkAttemptStatus("idle");
    if (!holderId) {
      return;
    }
    setLinkedWallets((prev) => {
      if (prev.includes(holderId)) {
        return prev;
      }
      const next = [...prev, holderId];
      persistProfileFields({
        linkedwalletholders: next.join(","),
        islinkedtogovwallet: "true",
      });
      return next;
    });
    setIsWalletLinked(true);
  };

  const recordAddressVerification = (address) => {
    setVerifiedAddress(address);
    setIsAddressVerified(true);
    persistProfileFields({
      homeAddress: address,
      isaddressverified: "true",
    });
  };

  return (
    <WalletContext.Provider
      value={{
        linkAttemptStatus,
        setLinkAttemptStatus,
        linkedWallets,
        isWalletLinked,
        isProfileLoading,
        recordWalletLink,
        verifiedAddress,
        isAddressVerified,
        setVerifiedAddress,
        recordAddressVerification,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

WalletProvider.propTypes = {
  children: PropTypes.node,
};

export { WalletContext, WalletProvider };
