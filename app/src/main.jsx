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

import { AsgardeoProvider } from "@asgardeo/react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { environmentConfig } from "./util/environment-util";

createRoot(document.getElementById('root')).render(
    <AsgardeoProvider
      clientId={`${environmentConfig.APP_CLIENT_ID}`}
      baseUrl={`${environmentConfig.ASGARDEO_BASE_URL}`}
      organizationHandle={environmentConfig.ORGANIZATION_NAME || undefined}
      preferences={{
        theme: {
          overrides: {
            borderRadius: {
              small: '0',
              medium: '0',
              large: '0'
            },
            colors: {
              primary: {
                main: 'var(--primary-2)'
              }
            }
          }
        }
      }}
    >
      <App />
    </AsgardeoProvider>
);
