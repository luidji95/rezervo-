"use client";

import { useCallback, useEffect, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "@/context/AuthContext";

import { loginUser } from "@/services/authService";
import { getPostLoginPath } from "@/features/authorization/services/authorizationService";

import {
  loginSchema,
  type LoginFormValues,
} from "@/features/auth/schemas/authSchema";

export default function LoginPage() {
  const router = useRouter();

  const { user, loading } = useAuth();

  const [formError, setFormError] = useState("");

  const redirectAfterLogin = useCallback(
    async (userId: string) => {
      router.replace(await getPostLoginPath(userId));
    },
    [router]
  );

  useEffect(() => {
    if (!loading && user) {
      redirectAfterLogin(user.id).catch((error) => {
        console.error("Failed to determine post-login redirect:", error);
        setFormError("Nije moguće proveriti podešavanje salona.");
      });
    }
  }, [loading, redirectAfterLogin, user]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(values: LoginFormValues) {
    try {
      setFormError("");

      const { user: loggedInUser } = await loginUser(values);

      await redirectAfterLogin(loggedInUser.id);
    } catch (error) {
      console.error("Login submission failed:", error);
      const message =
        error instanceof Error
          ? error.message
          : "Prijava trenutno nije moguća. Pokušajte ponovo.";

      setFormError(message);
    }
  }

  if (loading) {
    return <p>Učitavanje...</p>;
  }

  if (user) {
    return null;
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-header">
          <p className="auth-eyebrow">Dobro došli nazad</p>

          <h1>Prijavite se</h1>

          <p>Pristupite svom salonu i nastavite sa radom.</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit(onSubmit)}>
          <div className="form-field">
            <label htmlFor="email">Email</label>

            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "email-error" : undefined}
              {...register("email")}
            />

            {errors.email && (
              <p className="form-error" id="email-error">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="password">Lozinka</label>

            <input
              id="password"
              type="password"
              placeholder="Unesite lozinku"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={
                errors.password ? "password-error" : undefined
              }
              {...register("password")}
            />

            {errors.password && (
              <p className="form-error" id="password-error">
                {errors.password.message}
              </p>
            )}
          </div>

          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}

          <button
            className="auth-button"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Prijavljivanje..." : "Prijavi se"}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Nemate nalog?{" "}
            <Link href="/auth/register">Registrujte se</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
