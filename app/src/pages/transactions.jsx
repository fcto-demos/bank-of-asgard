import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Box,
  Container,
  Typography,
  Paper,
  Button,
  Divider,
  Switch,
  FormControlLabel,
  Chip,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import LockIcon from "@mui/icons-material/Lock";
import ShieldIcon from "@mui/icons-material/Shield";
import ChatComponent from "../components/transactions/ChatComponent";
import { ROUTES } from "../constants/app-constants";

const GOLD = "#997029";

const TransactionsPage = () => {
  const navigate = useNavigate();
  const [secured, setSecured] = useState(false);
  const [sessionId, setSessionId] = useState(
    () => "session_" + Math.random().toString(36).substring(2, 15)
  );


  const handleSecuredToggle = (e) => {
    setSecured(e.target.checked);
    // New session so the agent reconnects with the updated secured param
    setSessionId("session_" + Math.random().toString(36).substring(2, 15));
  };

  return (
    <section className="about_section layout_padding">
      <Container maxWidth="xl">
        {/* Page header */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3, flexWrap: "wrap" }}>
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate(ROUTES.USER_PROFILE)}
            sx={{
              color: GOLD,
              textTransform: "none",
              "&:hover": { bgcolor: "transparent", textDecoration: "underline" },
            }}
          >
            Back to Profile
          </Button>
          <Typography
            variant="h5"
            sx={{ color: GOLD, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontSize: "1.1rem" }}
          >
            Transaction Assistant
          </Typography>
          <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1 }}>
            <ShieldIcon sx={{ color: secured ? GOLD : "#bbb", fontSize: 20 }} />
            <FormControlLabel
              control={
                <Switch
                  checked={secured}
                  onChange={handleSecuredToggle}
                  sx={{
                    "& .MuiSwitch-switchBase.Mui-checked": { color: GOLD },
                    "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": { bgcolor: GOLD },
                  }}
                />
              }
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>AI Guardrails</Typography>
                  <Chip
                    label={secured ? "ON" : "OFF"}
                    size="small"
                    sx={{
                      height: 18,
                      fontSize: "0.65rem",
                      fontWeight: 700,
                      bgcolor: secured ? "#e8f5e9" : "#f5f5f5",
                      color: secured ? "#2e7d32" : "#999",
                    }}
                  />
                </Box>
              }
              sx={{ m: 0 }}
            />
          </Box>
        </Box>

        <Box
          sx={{
            display: "flex",
            gap: 3,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          {/* Left column — AI chat */}
          <Box sx={{ flex: "0 0 420px", minWidth: 300 }}>
            <ChatComponent sessionId={sessionId} secured={secured} />
          </Box>

          {/* Right column — Info panel */}
          <Box sx={{ flex: 1, minWidth: 260 }}>
            <Paper
              elevation={0}
              sx={{
                p: 3,
                borderRadius: 0,
                mb: 2,
                border: "1px solid rgba(0,0,0,.07)",
                borderLeft: `3px solid ${GOLD}`,
                boxShadow: "0 1px 3px rgba(0,0,0,.05), 0 4px 20px rgba(0,0,0,.06)",
              }}
            >
              <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
                How it works
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                The Transaction Assistant uses AI to help you understand your
                financial activity. Ask questions in plain language:
              </Typography>
              <Box component="ul" sx={{ pl: 2, m: 0 }}>
                {[
                  "Show me my last 10 transactions",
                  "How much did I spend on dining last month?",
                  "What were my largest purchases in January?",
                  "Summarise my spending by category",
                  "Were there any transfers in the past 30 days?",
                ].map((example) => (
                  <Box
                    key={example}
                    component="li"
                    sx={{ mb: 0.5 }}
                  >
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ fontStyle: "italic" }}
                    >
                      &ldquo;{example}&rdquo;
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Paper>

            <Paper
              elevation={0}
              sx={{
                p: 3,
                borderRadius: 0,
                border: "1px solid rgba(0,0,0,.07)",
                borderLeft: `3px solid ${GOLD}`,
                boxShadow: "0 1px 3px rgba(0,0,0,.05), 0 4px 20px rgba(0,0,0,.06)",
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
                <LockIcon sx={{ color: GOLD, fontSize: 20 }} />
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  Your data stays private
                </Typography>
              </Box>
              <Divider sx={{ mb: 1.5 }} />
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                The assistant accesses your transactions using a secure
                <strong> On-Behalf-Of (OBO)</strong> token — a short-lived,
                scoped credential that allows the AI to act on your behalf
                without ever seeing your password.
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                When you first ask about your transactions, you&apos;ll be prompted
                to approve access via WSO2 Identity Platform. The AI agent only receives your
                transaction data — nothing else.
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Powered by WSO2 Identity Platform &bull; OAuth 2.0 On-Behalf-Of flow
              </Typography>
              <Box sx={{ mt: 1.5 }}>
                <img
                  src="/images/powered-by-aws.png"
                  alt="Powered by AWS"
                  style={{ height: "140px" }}
                />
              </Box>

            </Paper>
          </Box>
        </Box>
      </Container>
    </section>
  );
};

export default TransactionsPage;
