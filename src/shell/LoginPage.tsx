import { LandingPage } from "./LandingPage";

/** /login: the home page with the log-in panel open. */
export function LoginPage() {
  return <LandingPage authMode="login" />;
}
