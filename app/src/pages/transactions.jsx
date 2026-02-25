import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Box,
  Container,
  Typography,
  Paper,
  Button,
  Divider,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import LockIcon from "@mui/icons-material/Lock";
import ChatComponent from "../components/transactions/ChatComponent";
import { ROUTES } from "../constants/app-constants";

const GOLD = "#997029";

const TransactionsPage = () => {
  const navigate = useNavigate();
  const [sessionId] = useState(
    () => "session_" + Math.random().toString(36).substring(2, 15)
  );

  return (
    <section className="about_section layout_padding">
      <Container maxWidth="xl">
        {/* Page header */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
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
            sx={{ color: GOLD, fontWeight: 700, letterSpacing: 0.5 }}
          >
            Transaction Assistant
          </Typography>
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
            <ChatComponent sessionId={sessionId} />
          </Box>

          {/* Right column — Info panel */}
          <Box sx={{ flex: 1, minWidth: 260 }}>
            <Paper
              elevation={2}
              sx={{ p: 3, borderRadius: 1, mb: 2 }}
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

            <Paper elevation={2} sx={{ p: 3, borderRadius: 1 }}>
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
                to approve access via Asgardeo. The AI agent only receives your
                transaction data — nothing else.
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Powered by Asgardeo &bull; OAuth 2.0 On-Behalf-Of flow
              </Typography>
            </Paper>
          </Box>
        </Box>
      </Container>
    </section>
  );
};

export default TransactionsPage;
