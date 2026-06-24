import { useEffect, useState, } from 'react';
import { environmentConfig } from "../util/environment-util";
import PropTypes from 'prop-types';
import { useAsgardeo } from '@asgardeo/react';
import { SwitchTokenContext } from './SwitchTokenContext';


/**
 * @param {object} props
 * @param {string} props.organizationId
 * @param {import('react').ReactNode} props.children
 * @param {import('react').ReactNode} [props.fallback]
 * @param {string} [props.scopes]
 */
const ContextSwitch = ({ organizationId, children, fallback = null, scopes = "openid profile internal_login" }) => {

  const asgardeo = useAsgardeo();
  const { isSignedIn, getAccessToken, exchangeToken } = asgardeo;
  const [ switchToken, setSwitchToken ] = useState("");
  const [ refreshToken, setRefreshToken ] = useState(/** @type {string | null} */ (null));
  const [ expiresIn, setExpiresIn ] = useState(/** @type {number | null} */ (null));

  useEffect(() => {
    if (!isSignedIn || !organizationId) return;
      if (!switchToken || switchToken == "") {
          handleTokenSwitch();
      }
  }, [organizationId, isSignedIn]);

  useEffect(() => {
    if (!switchToken || !refreshToken || !expiresIn) return;

    // Refresh 30 seconds before expiry
    const refreshTime = (expiresIn - 30) * 1000;
    const timer = setTimeout(() => {
      handleTokenRefresh();
    }, refreshTime);

    return () => clearTimeout(timer);
  }, [switchToken, refreshToken, expiresIn]);

  const handleTokenSwitch = async () => {
    if (!isSignedIn) {
        return;
    }
    const loggedInTokenResponse = await getAccessToken();
    const exchangeConfig = {
      attachToken: false,
      data: {
        client_id: `${environmentConfig.APP_CLIENT_ID}`,
        grant_type: 'organization_switch',
        scope: `${scopes}`,
        switching_organization: organizationId,
        token: loggedInTokenResponse,
      },
      id: 'organization-switch',
      returnsSession: false,
      signInRequired: true,
    };
    const tokenResponse = await exchangeToken(exchangeConfig);
    if ("access_token" in tokenResponse && typeof tokenResponse.access_token === "string") {
      setSwitchToken(tokenResponse.access_token);
    }
    if ("refresh_token" in tokenResponse && typeof tokenResponse.refresh_token === "string") {
      setRefreshToken(tokenResponse.refresh_token);
    }
    if ("expires_in" in tokenResponse && typeof tokenResponse.expires_in === "number") {
      setExpiresIn(tokenResponse.expires_in); // in seconds
    }
  };

  const handleTokenRefresh = async () => {
    const refreshConfig = {
      attachToken: false,
      data: {
        client_id: environmentConfig.APP_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      },
      id: "organization-switch-refresh",
      returnsSession: false,
      signInRequired: true,
    };

    const tokenResponse = await exchangeToken(refreshConfig);

    if ("access_token" in tokenResponse && typeof tokenResponse.access_token === "string") {
      setSwitchToken(tokenResponse.access_token);
    }
    if ("refresh_token" in tokenResponse && typeof tokenResponse.refresh_token === "string") {
      setRefreshToken(tokenResponse.refresh_token);
    }
    if ("expires_in" in tokenResponse && typeof tokenResponse.expires_in === "number") {
      setExpiresIn(tokenResponse.expires_in); // in seconds
    }
  };



    if (!isSignedIn) {
      return <>
      {fallback}
      </>;
    }

    if (!switchToken) {
      return <div>Loading...</div>;
    }

    return (
    <SwitchTokenContext.Provider value={switchToken}>
      {children}
    </SwitchTokenContext.Provider>
  );
}

ContextSwitch.propTypes = {
  organizationId: PropTypes.string.isRequired,
  children: PropTypes.element,
  fallback: PropTypes.element,
  scopes: PropTypes.string
};

export default ContextSwitch;
