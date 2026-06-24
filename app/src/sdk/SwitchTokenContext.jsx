import { createContext, useContext } from "react";

export const SwitchTokenContext = createContext(/** @type {string | null} */ (null));
export const useSwitchToken = () => useContext(SwitchTokenContext);
