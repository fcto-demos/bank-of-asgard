import PropTypes from "prop-types";
import { createContext, useState } from "react";

const BankAccountContext = createContext(/** @type {any} */ (null));

/**
 * @param {object} props
 * @param {import('react').ReactNode} props.children
 */
const BankAccountProvider = ({ children }) => {
  const initialAccountState = {
    accountNumber: "083434342982340",
    balance: 9565.50,
  };

  const [ bankAccountData, setBankAccountData ] = useState(initialAccountState);

  const updateBalance = (/** @type {number} */ newBalance) => {
    setBankAccountData((prevValue) => ({
      ...prevValue,
      balance: newBalance,
    }));
  };

  return (
    <BankAccountContext.Provider value={{ bankAccountData, updateBalance }}>
      {children}
    </BankAccountContext.Provider>
  );
};

BankAccountProvider.propTypes = {
  children: PropTypes.node,
};

export { BankAccountContext, BankAccountProvider };
