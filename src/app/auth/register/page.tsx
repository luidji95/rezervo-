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
      router.replace("/dashboard");
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
    },
  });

  async function onSubmit(values: RegisterFormValues) {
    try {
      setFormError("");
      setSuccessMessage("");

      await registerUser(values);

      setSuccessMessage(
        "Account created successfully. Please check your email to confirm your account."
      );

      reset();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong.";

      setFormError(message);
    }
  }

  if (loading) {
    return <p>Loading...</p>;
  }

  if (user) {
    return null;
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-header">
          <p className="auth-eyebrow">Create account</p>

          <h1>Start using Rezervo</h1>

          <p>Create your salon management account.</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit(onSubmit)}>
          <div className="form-field">
            <label htmlFor="email">Email</label>

            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              {...register("email")}
            />

            {errors.email && (
              <p className="form-error">{errors.email.message}</p>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="password">Password</label>

            <input
              id="password"
              type="password"
              placeholder="Create a password"
              {...register("password")}
            />

            {errors.password && (
              <p className="form-error">{errors.password.message}</p>
            )}
          </div>

          {formError && <p className="form-error">{formError}</p>}

          {successMessage && (
            <p className="form-success">{successMessage}</p>
          )}

          <button
            className="auth-button"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Creating account..." : "Create account"}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Already have an account? <Link href="/auth/login">Login</Link>
          </p>
        </div>
      </section>
    </main>
  );
}