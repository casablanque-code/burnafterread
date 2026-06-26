import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SecurityPage from "./SecurityPage";
import "./index.css";

const path = window.location.pathname;
const isSecurityPage = path === "/security" || path === "/security/";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isSecurityPage ? <SecurityPage /> : <App />}
  </React.StrictMode>
);
