import { Navigate } from "react-router";

export function DashboardRedirect() {
  return <Navigate to="/world" replace />;
}
