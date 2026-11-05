import { useState } from "react";
import { getSavedAccount } from "./api";
import { LoginPage } from "./components/LoginPage";
import { Workspace } from "./components/Workspace";
import type { Account } from "./types";

export function App() {
  const [account, setAccount] = useState<Account | null>(getSavedAccount);
  const [sessionExpired, setSessionExpired] = useState(false);

  if (!account) {
    return <LoginPage notice={sessionExpired ? "Your session expired. Please sign in again." : ""} onLogin={(user) => {
      setSessionExpired(false);
      setAccount(user);
    }} />;
  }

  return <Workspace account={account} onSignOut={(expired) => {
    setSessionExpired(expired);
    setAccount(null);
  }} />;
}
