import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import {
  Box,
  Paper,
  Typography,
  TextField,
  IconButton,
  Button,
  CircularProgress,
  Chip,
  Divider,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import LockIcon from "@mui/icons-material/Lock";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { environmentConfig } from "../../util/environment-util";

const GOLD = "#997029";
const AGENT_WS_URL = environmentConfig.TRANSACTIONS_AGENT_URL || "ws://localhost:8011";

const ChatComponent = ({ sessionId, secured = false }) => {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [pendingAuth, setPendingAuth] = useState(null);

  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const authWindowRef = useRef(null);
  const authCheckIntervalRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Handle postMessage from OAuth popup
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data && event.data.type === "auth_callback") {
        setPendingAuth(null);
        if (authWindowRef.current && !authWindowRef.current.closed) {
          authWindowRef.current.close();
        }
        if (authCheckIntervalRef.current) {
          clearInterval(authCheckIntervalRef.current);
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // WebSocket connection
  useEffect(() => {
    const wsUrl = `${AGENT_WS_URL}/chat?session_id=${sessionId}&secured=${secured}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "auth_request") {
          setPendingAuth(data);
          setIsTyping(false);
        } else if (data.type === "message") {
          setIsTyping(false);
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: data.content },
          ]);
        }
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
      }
    };

    ws.onerror = () => {
      setIsConnected(false);
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [sessionId]);

  const sendMessage = useCallback(() => {
    const text = inputValue.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInputValue("");
    setIsTyping(true);
    wsRef.current.send(text);
  }, [inputValue]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleAuthorize = useCallback(() => {
    if (!pendingAuth?.auth_url) return;

    const popup = window.open(
      pendingAuth.auth_url,
      "OAuthWindow",
      "width=600,height=700,scrollbars=yes,resizable=yes"
    );
    authWindowRef.current = popup;

    // Poll for popup closure as a fallback
    authCheckIntervalRef.current = setInterval(() => {
      if (popup && popup.closed) {
        clearInterval(authCheckIntervalRef.current);
        setPendingAuth(null);
      }
    }, 1000);
  }, [pendingAuth]);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "520px",
        border: `1px solid ${GOLD}`,
        borderRadius: 1,
        overflow: "hidden",
        bgcolor: "#fff",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          bgcolor: GOLD,
          px: 2,
          py: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Typography variant="subtitle1" sx={{ color: "#fff", fontWeight: 600 }}>
          Transaction Assistant
        </Typography>
        <Chip
          size="small"
          label={isConnected ? "Connected" : "Disconnected"}
          sx={{
            bgcolor: isConnected ? "#2e7d32" : "#c62828",
            color: "#fff",
            fontSize: "0.7rem",
            height: 20,
          }}
        />
      </Box>

      {/* Messages area */}
      <Box
        sx={{
          flex: 1,
          overflowY: "auto",
          px: 2,
          py: 1.5,
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        {messages.map((msg, i) => (
          <Box
            key={i}
            sx={{
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <Paper
              elevation={0}
              sx={{
                px: 1.5,
                py: 1,
                maxWidth: "85%",
                bgcolor: msg.role === "user" ? GOLD : "#f5f5f5",
                color: msg.role === "user" ? "#fff" : "#1c1c1c",
                borderRadius:
                  msg.role === "user"
                    ? "12px 12px 2px 12px"
                    : "12px 12px 12px 2px",
              }}
            >
              {msg.role === "user" ? (
                <Typography variant="body2" sx={{ lineHeight: 1.5 }}>
                  {msg.content}
                </Typography>
              ) : (
                <Box
                  sx={{
                    fontSize: "0.875rem",
                    lineHeight: 1.6,
                    "& p": { m: 0, mb: 0.5 },
                    "& ul, & ol": { mt: 0.5, mb: 0.5, pl: 2.5 },
                    "& li": { mb: 0.25 },
                    "& strong": { fontWeight: 600 },
                    "& code": {
                      bgcolor: "#e0e0e0",
                      px: 0.5,
                      borderRadius: 0.5,
                      fontSize: "0.8rem",
                      fontFamily: "monospace",
                    },
                  }}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                </Box>
              )}
            </Paper>
          </Box>
        ))}

        {isTyping && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <CircularProgress size={14} sx={{ color: GOLD }} />
            <Typography variant="caption" color="text.secondary">
              Assistant is thinking...
            </Typography>
          </Box>
        )}

        <div ref={messagesEndRef} />
      </Box>

      {/* OBO Authorisation Request */}
      {pendingAuth && (
        <>
          <Divider />
          <Box sx={{ px: 2, py: 1.5, bgcolor: "#fffde7" }}>
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
              <LockIcon sx={{ color: GOLD, mt: 0.25, fontSize: 18 }} />
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  Authorisation Required
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                  To read your transactions, the assistant needs your permission.
                  Click below to authorise access via WSO2 Identity Platform.
                </Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 1 }}>
                  {pendingAuth.scopes.map((scope) => (
                    <Chip
                      key={scope}
                      label={scope}
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: "0.65rem", borderColor: GOLD, color: GOLD }}
                    />
                  ))}
                </Box>
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleAuthorize}
                  sx={{
                    bgcolor: GOLD,
                    "&:hover": { bgcolor: "#7a5a20" },
                    textTransform: "none",
                    fontWeight: 600,
                  }}
                >
                  Authorise Access
                </Button>
              </Box>
            </Box>
          </Box>
        </>
      )}

      {/* Input area */}
      <Divider />
      <Box sx={{ px: 1.5, py: 1, display: "flex", alignItems: "flex-end", gap: 1 }}>
        <TextField
          fullWidth
          multiline
          maxRows={3}
          size="small"
          placeholder={
            isConnected
              ? "Ask about your transactions..."
              : "Connecting..."
          }
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isConnected}
          variant="outlined"
          sx={{
            "& .MuiOutlinedInput-root": {
              "&.Mui-focused fieldset": { borderColor: GOLD },
            },
          }}
        />
        <IconButton
          onClick={sendMessage}
          disabled={!isConnected || !inputValue.trim()}
          sx={{
            bgcolor: GOLD,
            color: "#fff",
            mb: 0.25,
            "&:hover": { bgcolor: "#7a5a20" },
            "&.Mui-disabled": { bgcolor: "#ccc", color: "#fff" },
          }}
        >
          <SendIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
};

ChatComponent.propTypes = {
  sessionId: PropTypes.string.isRequired,
  secured: PropTypes.bool,
};

export default ChatComponent;
