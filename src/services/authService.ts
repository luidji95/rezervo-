import { supabase } from "@/lib/supabase/client";

type RegisterPayload = {
  email: string;
  password: string;
};

type LoginPayload = {
  email: string;
  password: string;
};

export async function registerUser({ email, password }: RegisterPayload) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/auth/login`,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function loginUser({ email, password }: LoginPayload) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(error.message);
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