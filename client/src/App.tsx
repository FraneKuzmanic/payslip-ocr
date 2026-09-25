import { Route, Routes } from "react-router";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { AppLayout } from "./components/AppLayout";
import { HomePage } from "./routes/HomePage";
import { LoginPage } from "./routes/LoginPage";
import { NotFoundPage } from "./routes/NotFoundPage";
import { RegisterPage } from "./routes/RegisterPage";
import { SessionPage } from "./routes/SessionPage";
import { UploadBatchProvider } from "./upload/UploadBatchProvider";

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* The catch-all lives inside the protected branch on purpose: outside it, any
            unknown URL would render without a session and become an authentication bypass. */}
        <Route element={<ProtectedRoute />}>
          {/* Above both pages: a batch keeps uploading after the capture page navigates away. */}
          <Route element={<UploadBatchProvider />}>
            <Route index element={<HomePage />} />
            <Route path="sessions/:sessionId" element={<SessionPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
