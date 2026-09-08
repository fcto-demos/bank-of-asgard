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

import Box from "@mui/material/Box";
import PropTypes from "prop-types";
import Tooltip from "@mui/material/Tooltip";
import { useCallback, useEffect, useRef, useState } from "react";

const GOLD = "#997029";

// Wider than the 420px this column used to be fixed at — agent answers now include
// tool output (deduction tables, assessments) that read badly in a narrow column.
export const DEFAULT_CHAT_WIDTH = 560;
const MIN_CHAT_WIDTH = 320;
const MAX_CHAT_WIDTH = 1000;
const STORAGE_KEY = "boa.chatColumnWidth";
const KEYBOARD_STEP = 24;

const clamp = (/** @type {number} */ px) =>
  Math.min(MAX_CHAT_WIDTH, Math.max(MIN_CHAT_WIDTH, px));

/**
 * Reads the persisted width. Storage can throw outright (Safari private mode, blocked
 * site data), so every access is guarded and falls back to the default.
 * @returns {number}
 */
const readStoredWidth = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CHAT_WIDTH;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? clamp(parsed) : DEFAULT_CHAT_WIDTH;
  } catch {
    return DEFAULT_CHAT_WIDTH;
  }
};

/**
 * Drag-to-resize wrapper for the assistant column.
 *
 * Replaces the fixed `flex: "0 0 420px"` box that previously wrapped every
 * ChatComponent. The width is per-browser (localStorage) so a presenter's chosen
 * width survives page navigation and reloads mid-demo.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 */
const ResizableChatColumn = ({ children }) => {
  const [width, setWidth] = useState(DEFAULT_CHAT_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const dragState = useRef({ startX: 0, startWidth: DEFAULT_CHAT_WIDTH });

  // Read storage after mount rather than in useState's initialiser: the initial render
  // then matches on every browser, including ones where storage is unavailable.
  useEffect(() => {
    setWidth(readStoredWidth());
  }, []);

  const persist = useCallback((/** @type {number} */ next) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Width still applies for this session; only persistence is lost.
    }
  }, []);

  const handlePointerDown = (/** @type {React.PointerEvent<HTMLDivElement>} */ event) => {
    event.preventDefault();
    dragState.current = { startX: event.clientX, startWidth: width };
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (/** @type {React.PointerEvent<HTMLDivElement>} */ event) => {
    if (!isDragging) return;
    const { startX, startWidth } = dragState.current;
    setWidth(clamp(startWidth + (event.clientX - startX)));
  };

  const endDrag = (/** @type {React.PointerEvent<HTMLDivElement>} */ event) => {
    if (!isDragging) return;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    persist(width);
  };

  const handleKeyDown = (/** @type {React.KeyboardEvent<HTMLDivElement>} */ event) => {
    let next = width;
    if (event.key === "ArrowLeft") next = clamp(width - KEYBOARD_STEP);
    else if (event.key === "ArrowRight") next = clamp(width + KEYBOARD_STEP);
    else if (event.key === "Home") next = DEFAULT_CHAT_WIDTH;
    else return;
    event.preventDefault();
    setWidth(next);
    persist(next);
  };

  const resetWidth = () => {
    setWidth(DEFAULT_CHAT_WIDTH);
    persist(DEFAULT_CHAT_WIDTH);
  };

  return (
    <Box
      sx={{
        flex: `0 0 ${width}px`,
        minWidth: MIN_CHAT_WIDTH,
        maxWidth: "100%",
        display: "flex",
        alignItems: "stretch",
        gap: 0.5,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>

      <Tooltip title="Drag to resize — double-click to reset" placement="right">
        <Box
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize assistant panel"
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={resetWidth}
          onKeyDown={handleKeyDown}
          sx={{
            flex: "0 0 8px",
            alignSelf: "stretch",
            cursor: "col-resize",
            borderRadius: 1,
            // touch-action keeps a touch drag from scrolling the page instead of resizing.
            touchAction: "none",
            bgcolor: isDragging ? GOLD : "transparent",
            transition: "background-color 120ms ease",
            "&:hover": { bgcolor: isDragging ? GOLD : "rgba(153,112,41,.35)" },
            "&:focus-visible": { outline: `2px solid ${GOLD}`, outlineOffset: 2 },
            // Hidden on small screens, where the columns stack and dragging is meaningless.
            display: { xs: "none", md: "block" },
          }}
        />
      </Tooltip>
    </Box>
  );
};

ResizableChatColumn.propTypes = {
  children: PropTypes.node.isRequired,
};

export default ResizableChatColumn;
