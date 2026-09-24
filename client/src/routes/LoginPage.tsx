import { useNavigate } from "react-router";
import { useAuth } from "../auth/useAuth";
import { AuthForm } from "../components/AuthForm";

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();

  return (
    <AuthForm
      titleKey="auth.signIn"
      passwordAutoComplete="current-password"
      alternateLinkKey="auth.noAccount"
      alternateTo="/register"
      submit={signIn}
      onSuccess={() => {
        void navigate("/", { replace: true });
      }}
    />
  );
}
