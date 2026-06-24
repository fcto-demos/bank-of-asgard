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

mermaid.initialize({ startOnLoad: false, theme: "neutral" });

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
    const origin = event.origin || "unknown";
    const destination = event.destination || "unknown";
    aliasFor(origin);
    aliasFor(destination);
  });
  actorAlias.forEach((alias, name) => {
    lines.push(`participant ${alias} as "${sanitizeLabel(name)}"`);
  });

  events.forEach((event) => {
    const origin = aliasFor(event.origin || "unknown");
    const destination = aliasFor(event.destination || "unknown");
    const deltaLabel = formatDelta((event.epoch - t0) * 1000);
    const labelParts = [event.event, deltaLabel];
    if (event.token_hash) {
      labelParts.push(`tokenHash=${event.token_hash}`);
    }
    if (event.sub) {
      labelParts.push(`sub=${event.sub}`);
    }
    if (event.act) {
      labelParts.push(`act=${event.act}`);
    }
    const arrow = event.success === false ? "-x" : "->>";
    lines.push(`${origin}${arrow}${destination}: ${sanitizeLabel(labelParts.join(" | "))}`);
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
