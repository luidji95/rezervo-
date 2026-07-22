import { supabase } from "@/lib/supabase/client";

type RegisterPayload = {
  email: string;
  password: string;
};

type LoginPayload = {
  email: string;
  password: string;
};

function getAuthErrorMessage(
  error: { code?: string; message: string },
  action: "login" | "register"
) {
  if (error.code === "invalid_credentials") {
    return "Pogrešan email ili lozinka.";
  }

  if (
    error.code === "email_exists" ||
    error.code === "user_already_exists" ||
    error.message.toLowerCase().includes("already registered")
  ) {
    return "Nalog sa ovim emailom već postoji.";
  }

  return action === "login"
    ? "Prijava trenutno nije moguća. Pokušajte ponovo."
    : "Registracija trenutno nije moguća. Pokušajte ponovo.";
}

export async function registerUser({ email, password }: RegisterPayload) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/auth/login`,
    },
  });

  if (error) {
    console.error("Registration failed:", error);
    throw new Error(getAuthErrorMessage(error, "register"));
  }

  return data;
}

export async function loginUser({ email, password }: LoginPayload) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error("Login failed:", error);
    throw new Error(getAuthErrorMessage(error, "login"));
  }

  return data;
}

export async function logoutUser() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error(error.message);
  }
}

export async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw new Error(error.message);
  }

  return user;
}
