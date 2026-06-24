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

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Box, Chip, FormControlLabel, Switch, Typography } from "@mui/material";
import ShieldIcon from "@mui/icons-material/Shield";
import { SITE_SECTIONS } from "../../constants/app-constants";
import ChatComponent from "../transactions/ChatComponent";
import { TransactionInfoPanel } from "../../pages/transactions";

const GOLD = "#997029";

/**
 * @param {object} props
 * @param {(section: string) => void} props.setSiteSection
 * @param {string} props.role
 */
const BusinessMemberContent = ({ setSiteSection, role }) => {
  const [secured, setSecured] = useState(false);
  const [sessionId, setSessionId] = useState(
    () => "session_" + Math.random().toString(36).substring(2, 15)
  );

  const handleSecuredToggle = (/** @type {any} */ e) => {
    setSecured(e.target.checked);
    setSessionId("session_" + Math.random().toString(36).substring(2, 15));
  };

  useEffect(() => {
    setSiteSection(SITE_SECTIONS.BUSINESS);
  }, []);

  return (
    <>
      <section className="about_section layout_padding">
        <div className="container-fluid">
          <Box sx={{ mb: 2, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
            <Box>
              <Typography variant="h5" sx={{ color: GOLD, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontSize: "1.1rem", mb: 0.5 }}>
                How can we help you today?
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Business {role} — ask about branches, products, or your account.
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
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
                      sx={{ height: 18, fontSize: "0.65rem", fontWeight: 700, bgcolor: secured ? "#e8f5e9" : "#f5f5f5", color: secured ? "#2e7d32" : "#999" }}
                    />
                  </Box>
                }
                sx={{ m: 0 }}
              />
            </Box>
          </Box>
          <Box sx={{ display: "flex", gap: 3, alignItems: "flex-start", flexWrap: "wrap" }}>
            <Box sx={{ flex: "0 0 420px", minWidth: 300 }}>
              <ChatComponent sessionId={sessionId} secured={secured} />
            </Box>
            <TransactionInfoPanel />
          </Box>
        </div>
      </section>
    </>
  );
}

BusinessMemberContent.propTypes = {
  setSiteSection: PropTypes.object.isRequired,
  role: PropTypes.string.isRequired
};

export default BusinessMemberContent;
