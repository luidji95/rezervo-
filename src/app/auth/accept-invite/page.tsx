"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuthorization } from "@/context/AuthorizationContext";
import {
  acceptInvitePasswordSchema,
  type AcceptInvitePasswordValues,
} from "@/features/auth/schemas/authSchema";
import { supabase } from "@/lib/supabase/client";
import {
  AcceptInvitationError,
  acceptTeamInvitation,
} from "@/services/teamInvitationService";

type PageState =
  | "checking"
  | "ready"
  | "linking"
  | "success"
  | "expired"
  | "accepted"
  | "revoked"
  | "invalid"
  | "error";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function AcceptInviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refetchAuthorization } = useAuthorization();
  const [pageState, setPageState] = useState<PageState>("checking");
  const [invitationId, setInvitationId] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AcceptInvitePasswordValues>({
    resolver: zodResolver(acceptInvitePasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    let ignore = false;

    async function initializeInviteSession() {
      try {
        const code = searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          window.history.replaceState({}, "", "/auth/accept-invite");
        }

        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();
        if (error || !user) throw error ?? new Error("Invite session missing");

        const metadataInvitationId = user.user_metadata?.invitation_id;
        if (
          typeof metadataInvitationId !== "string" ||
          !UUID_PATTERN.test(metadataInvitationId)
        ) {
          if (!ignore) setPageState("invalid");
          return;
        }

        if (!ignore) {
          setInvitationId(metadataInvitationId);
          setInvitedEmail(user.email ?? null);
          setPageState("ready");
        }
      } catch {
        if (!ignore) setPageState("invalid");
      }
    }

    void initializeInviteSession();
    return () => {
      ignore = true;
    };
  }, [searchParams]);

  async function onSubmit(values: AcceptInvitePasswordValues) {
    if (!invitationId) return;

    setFormError(null);
    setPageState("linking");

    const { error: passwordError } = await supabase.auth.updateUser({
      password: values.password,
    });

    if (passwordError) {
      setPageState("ready");
      setFormError("Lozinku trenutno nije moguće postaviti. Pokušajte ponovo.");
      return;
    }

    try {
      const result = await acceptTeamInvitation(invitationId);
      setPageState(result.alreadyAccepted ? "accepted" : "success");
      await refetchAuthorization();
      router.replace("/dashboard");
      router.refresh();
    } catch (acceptError) {
      if (acceptError instanceof AcceptInvitationError) {
        if (acceptError.code === "UNAUTHORIZED") {
          router.replace("/auth/login?activated=1");
          return;
        }
        if (acceptError.code === "INVITATION_EXPIRED") setPageState("expired");
        else if (acceptError.code === "INVITATION_REVOKED") setPageState("revoked");
        else if (acceptError.code === "INVITATION_ALREADY_ACCEPTED") setPageState("accepted");
        else if (acceptError.code === "INVALID_INVITATION") setPageState("invalid");
        else if (acceptError.code === "ACCEPT_FAILED") {
          setPageState("ready");
          setFormError("Povezivanje trenutno nije dostupno. Pokušajte ponovo.");
        }
        else {
          setPageState("error");
          setFormError(
            acceptError.code === "EMAIL_MISMATCH"
              ? "Ovaj poziv pripada drugom email nalogu."
              : "Nalog nije moguće povezati. Obratite se vlasniku salona.",
          );
        }
        return;
      }

      setPageState("error");
      setFormError("Poziv trenutno nije moguće prihvatiti.");
    }
  }

  const stateMessages: Partial<Record<PageState, string>> = {
    checking: "Proveravamo poziv...",
    linking: "Povezujemo vaš nalog...",
    success: "Poziv je uspešno prihvaćen. Otvaramo vaš Dashboard...",
    accepted: "Poziv je već prihvaćen. Otvaramo vaš nalog...",
    expired: "Ovaj poziv je istekao. Zatražite novi poziv od vlasnika salona.",
    revoked: "Ovaj poziv je opozvan.",
    invalid: "Poziv nije validan ili session više nije dostupna.",
    error: formError ?? "Došlo je do greške pri povezivanju naloga.",
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-header">
          <p className="auth-eyebrow">Rezervo poziv</p>
          <h1>Pristup salonu</h1>
          {invitedEmail && <p>Poziv je poslat na {invitedEmail}.</p>}
        </div>

        {pageState === "ready" ? (
          <form className="auth-form" onSubmit={handleSubmit(onSubmit)}>
            <div className="form-field">
              <label htmlFor="password">Nova lozinka</label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(errors.password)}
                {...register("password")}
              />
              {errors.password && <p className="form-error">{errors.password.message}</p>}
            </div>

            <div className="form-field">
              <label htmlFor="confirmPassword">Potvrdite lozinku</label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(errors.confirmPassword)}
                {...register("confirmPassword")}
              />
              {errors.confirmPassword && (
                <p className="form-error">{errors.confirmPassword.message}</p>
              )}
            </div>

            {formError && <p className="form-error" role="alert">{formError}</p>}
            <button className="auth-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Povezivanje..." : "Postavi lozinku i prihvati poziv"}
            </button>
          </form>
        ) : (
          <p className={pageState === "success" || pageState === "accepted" ? "form-success" : "form-error"} role="status">
            {stateMessages[pageState]}
          </p>
        )}
      </section>
    </main>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<main className="auth-page"><p>Proveravamo poziv...</p></main>}>
      <AcceptInviteContent />
    </Suspense>
  );
}
