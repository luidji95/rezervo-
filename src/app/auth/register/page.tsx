"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { useRouter } from "next/navigation";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "@/context/AuthContext";

import { registerUser } from "@/services/authService";

import {
  registerSchema,
  type RegisterFormValues,
} from "@/features/auth/schemas/authSchema";

export default function RegisterPage() {
  const router = useRouter();

  const { user, loading } = useAuth();

  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (!loading && user) {
      router.replace("/onboarding");
    }
  }, [loading, user, router]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(values: RegisterFormValues) {
    try {
      setFormError("");
      setSuccessMessage("");

      const result = await registerUser({
        email: values.email,
        password: values.password,
      });

      if (result.session && result.user) {
        router.replace("/onboarding");
        return;
      }

      setSuccessMessage(
        "Nalog je kreiran. Proverite email i potvrdite registraciju."
      );

      reset();
    } catch (error) {
      console.error("Registration submission failed:", error);
      const message =
        error instanceof Error
          ? error.message
          : "Registracija trenutno nije moguća. Pokušajte ponovo.";

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
          <p className="auth-eyebrow">Novi nalog</p>

          <h1>Kreirajte nalog</h1>

          <p>Napravite nalog i podesite svoj salon.</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit(onSubmit)}>
          <div className="form-field">
            <label htmlFor="email">Email</label>

            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={
                errors.email ? "register-email-error" : undefined
              }
              {...register("email")}
            />

            {errors.email && (
              <p className="form-error" id="register-email-error">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="password">Lozinka</label>

            <input
              id="password"
              type="password"
              placeholder="Kreirajte lozinku"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={
                errors.password ? "register-password-error" : undefined
              }
              {...register("password")}
            />

            {errors.password && (
              <p className="form-error" id="register-password-error">
                {errors.password.message}
              </p>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="confirmPassword">Potvrdite lozinku</label>

            <input
              id="confirmPassword"
              type="password"
              placeholder="Ponovite lozinku"
              aria-invalid={Boolean(errors.confirmPassword)}
              aria-describedby={
                errors.confirmPassword ? "confirm-password-error" : undefined
              }
              {...register("confirmPassword")}
            />

            {errors.confirmPassword && (
              <p className="form-error" id="confirm-password-error">
                {errors.confirmPassword.message}
              </p>
            )}
          </div>

          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}

          {successMessage && (
            <p className="form-success" role="status">
              {successMessage}
            </p>
          )}

          <button
            className="auth-button"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Kreiranje naloga..." : "Registrujte se"}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Već imate nalog? <Link href="/auth/login">Prijavite se</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
