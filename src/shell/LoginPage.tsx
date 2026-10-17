import { LoginForm } from "wasp/client/auth";
import { Link } from "wasp/client/router";
import { authAppearance } from "./authAppearance";

export function LoginPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <LoginForm appearance={authAppearance} />
        <p className="auth-switch">
          New here? <Link to="/signup">Create an account</Link>
        </p>
        <p className="demo-hint">
          Demo account: <code>demo</code> / <code>demo1234</code>
        </p>
      </div>
    </div>
  );
}
