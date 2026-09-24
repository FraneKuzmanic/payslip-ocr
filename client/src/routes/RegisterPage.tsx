import { useNavigate } from "react-router";
import { useAuth } from "../auth/useAuth";
import { AuthForm } from "../components/AuthForm";

export function RegisterPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();

  return (
    <AuthForm
      titleKey="auth.signUp"
      passwordAutoComplete="new-password"
      alternateLinkKey="auth.haveAccount"
      alternateTo="/login"
      submit={signUp}
      onSuccess={() => {
        void navigate("/", { replace: true });
      }}
    />
  );
}
