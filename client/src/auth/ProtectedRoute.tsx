import { Navigate, Outlet } from "react-router";
import { Spinner } from "../components/Spinner";
import { useAuth } from "./useAuth";

export function ProtectedRoute() {
  const { session, loading } = useAuth();

  // Redirecting while the session is still being restored would bounce an authenticated user
  // to the login screen on every reload.
  if (loading) return <Spinner />;
  if (session === null) return <Navigate to="/login" replace />;

  return <Outlet />;
}
