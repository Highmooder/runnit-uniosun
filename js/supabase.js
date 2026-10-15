import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// WHAT: the ONE place that talks to Supabase: the connection, sign in/out,
//       and a small helper for calling database functions.
// WHY:  pages call these small functions and get plain results back
//       ({ ok, data, error }). If the connection ever changes, only this
//       file changes.
// SECURITY: nothing here "protects" data. What a person can see or change
//       is decided by the database rules (pieces 1 to 3), using the
//       signed-in user's identity. This file only asks.

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const MIN_PASSWORD_LENGTH = 8;


// ---------- sessions ----------

export async function getSession() {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session;
  } catch (error) {
    console.warn("Could not read the session.", error);
    return null;
  }
}

export async function signIn({ email, password }) {
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: friendlyError(error) };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}

export async function signUp({ fullName, phone, email, password }) {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, phone },
        emailRedirectTo: new URL("index.html", window.location.href).href,
      },
    });
    if (error) return { ok: false, error: friendlyError(error) };

    // Supabase hides "this email already exists" by returning a fake user
    // with no identities. Tell the person plainly instead.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return { ok: false, error: "An account with this email already exists. Try signing in instead." };
    }
    // No session = the project still requires email confirmation.
    return { ok: true, needsConfirmation: !data.session };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function requestPasswordReset(email) {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: new URL("index.html", window.location.href).href,
    });
    if (error) return { ok: false, error: friendlyError(error) };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}


// ---------- calling database functions ----------

// supabase.rpc('name', { ...args }) with a friendly { ok, data, error } result.
export async function rpc(name, args) {
  try {
    const { data, error } = await supabase.rpc(name, args);
    if (error) return { ok: false, error: friendlyError(error) };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}

// Is the signed-in person an admin? (you)
export async function isAdmin() {
  const result = await rpc("is_admin");
  return result.ok && result.data === true;
}

// The stores the signed-in person manages (empty list if none).
export async function getMyVendors() {
  const result = await rpc("get_my_vendors");
  return result.ok ? result.data || [] : [];
}


// ---------- errors ----------

export function friendlyError(error) {
  const msg = (error && error.message) || "";
  // P0001 = a message we wrote on purpose inside a database function.
  if (error && error.code === "P0001" && msg) return msg;
  if (error && (error.code === "PGRST202" || /could not find the function/i.test(msg))) return "This feature isn't set up yet. Please try again later.";
  if (/invalid login credentials/i.test(msg)) return "Incorrect email or password.";
  if (/email not confirmed/i.test(msg)) return "Please confirm your email first. Check your inbox for the link we sent.";
  if (/already registered|already been registered/i.test(msg)) return "An account with this email already exists. Try signing in instead.";
  if (/password.*(at least|short|weak)|weak password/i.test(msg)) return `Choose a stronger password (at least ${MIN_PASSWORD_LENGTH} characters).`;
  if (/rate limit|too many|security purposes/i.test(msg)) return "Too many attempts. Please wait a minute and try again.";
  if (/valid email|invalid.*email/i.test(msg)) return "Enter a valid email address.";
  if (/JWT|not authenticated|expired/i.test(msg)) return "Your session expired. Please sign in again.";
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return "Couldn't reach the server. Check your internet connection and try again.";
  return "Something went wrong. Please try again.";
}
