/**
 * Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import {
  Box,
  Container,
  Typography,
  Paper,
  Button,
  TextField,
  Autocomplete,
  CircularProgress,
  Alert,
} from "@mui/material";
import { getTokenAudit } from "../api/token-audit";

const GOLD = "#997029";

// On-brand sequence-diagram palette (warm gold / cream on ink) so the token flow
// matches the Bank of Asgard styling instead of Mermaid's default flat grey.
const CREAM = "#faf5e9";        // actor / label box fill
const GOLD_BORDER = "#c7a24c";  // actor + note borders, lifelines base
const INK = "#463a24";          // all diagram text
const SIGNAL = "#7a5c2e";       // arrows, arrowheads, sequence-number circles
const FAILURE = "#c0392b";      // failed hops (crosshead + tinted band)

mermaid.initialize({
  startOnLoad: false,
  theme: "base",
  fontFamily: '"Inter", "Segoe UI", Roboto, system-ui, sans-serif',
  themeVariables: {
    primaryColor: CREAM,
    primaryBorderColor: GOLD_BORDER,
    primaryTextColor: INK,
    lineColor: GOLD_BORDER,
    textColor: INK,
    actorBkg: CREAM,
    actorBorder: GOLD_BORDER,
    actorTextColor: INK,
    actorLineColor: "#d8c79b",
    signalColor: SIGNAL,
    signalTextColor: INK,
    labelBoxBkgColor: CREAM,
    labelBoxBorderColor: GOLD_BORDER,
    labelTextColor: INK,
    noteBkgColor: "#fff8e6",
    noteBorderColor: GOLD_BORDER,
    noteTextColor: INK,
    activationBkgColor: "#efe3c6",
    activationBorderColor: GOLD_BORDER,
    sequenceNumberColor: "#ffffff",
  },
  sequence: {
    diagramMarginX: 24,
    diagramMarginY: 18,
    actorMargin: 110,
    boxMargin: 12,
    messageMargin: 44,
    mirrorActors: false,   // no duplicate actor row at the bottom — shorter, cleaner
    useMaxWidth: false,    // keep natural size + horizontal scroll (see container) over shrink-to-fit
    actorFontSize: 14,
    actorFontWeight: 600,
    messageFontSize: 12.5,
    noteFontSize: 12,
  },
  themeCSS: `
    .actor { rx: 8px; ry: 8px; filter: drop-shadow(0 1px 2px rgba(60,45,15,0.18)); }
    .actor-line { stroke-dasharray: 3 5; opacity: 0.55; }
    .messageText { font-weight: 500; letter-spacing: 0.1px; }
    [id$="-crosshead"] path { fill: ${FAILURE}; stroke: ${FAILURE}; }
  `,
});

/** Formats elapsed milliseconds since the first event as a short "+Nms"/"+N.Ns" label. */
const formatDelta = (/** @type {number} */ deltaMs) => {
  if (deltaMs < 1000) {
    return `+${Math.round(deltaMs)}ms`;
  }
  return `+${(deltaMs / 1000).toFixed(1)}s`;
};

/** Escapes characters that would break a Mermaid quoted label. */
const sanitizeLabel = (/** @type {string} */ label) => String(label).replace(/"/g, "'");

// Internal concurrency-control bookkeeping (e.g. a second caller awaiting an
// already-in-flight token fetch) — real and useful in the raw audit log for verifying
// the de-dup behavior itself, but it's not an actual hop and just clutters the diagram.
const DIAGRAM_NOISE_EVENTS = new Set(["dedupe_wait"]);

// The raw `event` strings from the audit log are terse internal names (e.g. "fresh",
// "api_call") — fine in JSONL, but cryptic as a diagram label. Map the known vocabulary
// to human-readable phrases; unknown events fall back to a de-underscored, capitalized
// form. Acronym-leading names (api/llm/obo) MUST be mapped explicitly, since the fallback
// would render them "Api"/"Llm"/"Obo".
const EVENT_LABELS = /** @type {Record<string, string>} */ ({
  // Note: `fresh` is intentionally absent — it is repainted (IS -> Agent) with its own
  // label in effectiveHop() below, rather than drawn as a plain hop.
  cache_hit: "Token reused (cache hit)",
  obo_initiated: "OBO exchange initiated",
  obo_exchanged: "OBO token issued",
  agent_token_fetch: "Agent token requested",
  gateway_token_fetch: "Gateway token requested",
  gateway_token_fresh: "Gateway token obtained (fresh)",
  validated_incoming: "Incoming token validated",
  api_call: "API call",
  llm_call: "LLM call",
});

const eventLabel = (/** @type {string} */ event) => {
  if (EVENT_LABELS[event]) {
    return EVENT_LABELS[event];
  }
  const words = String(event || "event").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// Short, readable token-type tag for the detail line, so an event like "fresh" carries
// the context of *which* token was obtained (e.g. OBO vs Agent).
const tokenTypeLabel = (/** @type {string} */ tokenType) =>
  ({ OBO_TOKEN: "OBO", AGENT_TOKEN: "Agent" })[tokenType] ||
  String(tokenType).replace(/_TOKEN$/, "").toLowerCase();

// The canonical actor name for the identity server / IdP, as written to the audit log
// (e.g. `obo_initiated` uses destination "IS").
const IDP_ACTOR = "IS";

// Resolve an event to the hop actually drawn. `fresh` is logged as Agent -> <resource>,
// but the freshly-minted token was obtained FROM the IdP — so repaint it as IS -> Agent,
// reading as the "token obtained" response rather than a second call to the resource.
// (A cached token — `cache_hit` — genuinely does not come from the IdP, so it is left as
// logged and is not repainted here.)
const effectiveHop = (/** @type {any} */ event) => {
  if (event.event === "fresh") {
    return {
      origin: IDP_ACTOR,
      destination: event.origin || "unknown",
      label: "Token obtained (fresh)",
    };
  }
  return {
    origin: event.origin || "unknown",
    destination: event.destination || "unknown",
    label: eventLabel(event.event),
  };
};

/** Builds Mermaid sequenceDiagram source from a chronologically-sorted list of audit events. */
const buildDiagramText = (/** @type {Array<any>} */ allEvents) => {
  const events = allEvents.filter((event) => !DIAGRAM_NOISE_EVENTS.has(event.event));
  if (events.length === 0) {
    return 'sequenceDiagram\nNote over a: No events to display';
  }

  const actorAlias = new Map();
  let aliasCount = 0;
  const aliasFor = (/** @type {string} */ name) => {
    if (!actorAlias.has(name)) {
      actorAlias.set(name, `a${aliasCount++}`);
    }
    return actorAlias.get(name);
  };

  const t0 = events[0].epoch;
  const lines = ["sequenceDiagram", "autonumber"];

  events.forEach((event) => {
    const hop = effectiveHop(event);
    aliasFor(hop.origin);
    aliasFor(hop.destination);
  });
  actorAlias.forEach((alias, name) => {
    lines.push(`participant ${alias} as "${sanitizeLabel(name)}"`);
  });

  events.forEach((event) => {
    const hop = effectiveHop(event);
    const origin = aliasFor(hop.origin);
    const destination = aliasFor(hop.destination);
    const deltaLabel = formatDelta((event.epoch - t0) * 1000);

    // Scopes note (e.g. on `obo_initiated`) — surface what the token is being requested
    // for, as a note spanning the two actors just above the hop it belongs to.
    if (Array.isArray(event.scopes) && event.scopes.length > 0) {
      const span = origin === destination ? origin : `${origin},${destination}`;
      const scopeText = sanitizeLabel(`Requested scopes:<br/>${event.scopes.join(", ")}`);
      lines.push(`Note over ${span}: ${scopeText}`);
    }

    // First line is a human-readable event name; the timing + token/identity details go
    // on a second, muted line so the primary action stays readable at a glance.
    const meta = [deltaLabel];
    if (event.token_type) {
      meta.push(tokenTypeLabel(event.token_type));
    }
    if (event.token_hash) {
      meta.push(`token ${event.token_hash}`);
    }
    if (event.sub) {
      meta.push(`sub ${event.sub}`);
    }
    if (event.act) {
      meta.push(`act ${event.act}`);
    }

    const failed = event.success === false;
    const arrow = failed ? "-x" : "->>";
    const label = sanitizeLabel(`${hop.label}<br/>${meta.join(" · ")}`);
    const line = `${origin}${arrow}${destination}: ${label}`;

    // Tint the band behind a failed hop so failures are obvious beyond the red crosshead.
    if (failed) {
      lines.push("rect rgb(250, 233, 231)");
      lines.push(line);
      lines.push("end");
    } else {
      lines.push(line);
    }
  });

  return lines.join("\n");
};

const TokenFlowPage = () => {
  const [transactionIdInput, setTransactionIdInput] = useState("");
  const [transactionIds, setTransactionIds] = useState(/** @type {Array<string>} */ ([]));
  const [events, setEvents] = useState(/** @type {Array<any>} */ ([]));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [svg, setSvg] = useState("");
  const diagramRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const renderSeq = useRef(0);

  /** Loads events for transactionId (or everything, if blank). When called unfiltered,
   * also (re)populates the dropdown and returns the sorted id list — most-recently-active
   * first — so the caller can decide what to auto-select; returns null otherwise. */
  const loadEvents = useCallback(async (/** @type {string} */ transactionId) => {
    setLoading(true);
    setError(null);
    try {
      const response = await getTokenAudit(transactionId || undefined);
      const data = response.data || [];
      setEvents(data);

      if (!transactionId) {
        const latestEpochByTxn = new Map();
        data.forEach((/** @type {any} */ event) => {
          if (!event.transaction_id) {
            return;
          }
          const current = latestEpochByTxn.get(event.transaction_id);
          if (current === undefined || event.epoch > current) {
            latestEpochByTxn.set(event.transaction_id, event.epoch);
          }
        });
        const sortedIds = [...latestEpochByTxn.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([id]) => id);
        setTransactionIds(sortedIds);
        return sortedIds;
      }
      return null;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load token audit trail");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      // Default to the most recently active transaction rather than leaving every
      // transaction's events mixed together in one undifferentiated diagram.
      const sortedIds = await loadEvents("");
      if (sortedIds && sortedIds.length > 0) {
        setTransactionIdInput(sortedIds[0]);
        await loadEvents(sortedIds[0]);
      }
    })();
  }, [loadEvents]);

  useEffect(() => {
    if (events.length === 0) {
      setSvg("");
      return;
    }
    let cancelled = false;
    // A timestamp-based id can collide when two loadEvents() calls land in the same
    // millisecond (e.g. the initial unfiltered-then-filtered mount sequence) — mermaid
    // briefly mounts an offscreen element under this id to measure/render, and a
    // collision between two concurrent calls corrupts both. A monotonic counter can't
    // collide regardless of timing.
    const id = `tokenflow-${renderSeq.current++}`;
    mermaid
      .render(id, buildDiagramText(events))
      .then(({ svg: renderedSvg }) => {
        if (!cancelled) {
          setSvg(renderedSvg);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(`Failed to render diagram: ${err?.message || err}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [events]);

  return (
    <section className="about_section layout_padding">
      <Container maxWidth="xl">
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3, flexWrap: "wrap" }}>
          <Typography
            variant="h5"
            sx={{ color: GOLD, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontSize: "1.1rem" }}
          >
            Token Flow
          </Typography>
          <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1 }}>
            <Autocomplete
              freeSolo
              size="small"
              options={transactionIds}
              inputValue={transactionIdInput}
              onInputChange={(_e, newValue) => setTransactionIdInput(newValue)}
              onChange={(_e, newValue) => loadEvents(newValue || "")}
              sx={{ minWidth: 320 }}
              renderInput={(params) => <TextField {...params} label="Filter by transaction_id" />}
            />
            <Button
              variant="contained"
              sx={{ bgcolor: GOLD, "&:hover": { bgcolor: GOLD } }}
              onClick={() => loadEvents(transactionIdInput)}
            >
              Load
            </Button>
            <Button variant="outlined" onClick={() => loadEvents(transactionIdInput)}>
              Refresh
            </Button>
          </Box>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Paper elevation={0} sx={{ p: 3, border: "1px solid rgba(0,0,0,.07)" }}>
          {loading && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress />
            </Box>
          )}
          {!loading && events.length === 0 && (
            <Typography color="text.secondary" sx={{ textAlign: "center", py: 6 }}>
              No token audit events found{transactionIdInput ? ` for transaction_id "${transactionIdInput}"` : ""}.
            </Typography>
          )}
          {!loading && events.length > 0 && (
            // mermaid's default securityLevel is "strict", which sanitizes the SVG via
            // DOMPurify internally before render() resolves — svg here is already safe.
            <Box ref={diagramRef} sx={{ overflowX: "auto" }} dangerouslySetInnerHTML={{ __html: svg }} />
          )}
        </Paper>
      </Container>
    </section>
  );
};

export default TokenFlowPage;
