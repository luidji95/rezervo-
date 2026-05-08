"use client";

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "@/context/AuthContext";

import { loginUser } from "@/services/authService";

import {
  loginSchema,
  type LoginFormValues,
} from "@/features/auth/schemas/authSchema";

export default function LoginPage() {
  const router = useRouter();

  const { user, loading } = useAuth();

  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!loading && user) {
      router.replace("/dashboard");
    }
  }, [loading, user, router]);

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

      await loginUser(values);

      router.push("/dashboard");
      router.refresh();
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
          <p className="auth-eyebrow">Welcome back</p>

          <h1>Login to Rezervo</h1>

          <p>Access your salon dashboard and manage your bookings.</p>
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
              placeholder="Enter your password"
              {...register("password")}
            />

            {errors.password && (
              <p className="form-error">{errors.password.message}</p>
            )}
          </div>

          {formError && <p className="form-error">{formError}</p>}

          <button
            className="auth-button"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Logging in..." : "Login"}
          </button>
        </form>
      </section>
    </main>
  );
}