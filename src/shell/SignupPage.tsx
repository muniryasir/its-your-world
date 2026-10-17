import { SignupForm } from "wasp/client/auth";
import { Link } from "wasp/client/router";
import { authAppearance } from "./authAppearance";

export function SignupPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <SignupForm appearance={authAppearance} />
        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}
