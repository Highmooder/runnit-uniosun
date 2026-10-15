import { MIN_PASSWORD_LENGTH, getSession, signIn, signUp, signOut, isAdmin, getMyVendors } from "../supabase.js";

// WHAT: the sign-in page. Signed out: sign in or create an account.
//       Signed in: admins go to admin.html, vendors go to vendor.html.
// WHY:  one front door for everyone. The database decides who is an admin
//       and which store someone manages; this page only asks and redirects.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+()\-\s]{7,}$/;
const VIEWS = ["login-loading", "auth-view", "confirm-view", "waiting-view"];

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  wireForms();
  await route();
});

function showView(id) {
  VIEWS.forEach((v) => ($(v).style.display = v === id ? "block" : "none"));
}

// Decide where this visitor belongs.
async function route() {
  const session = await getSession();
  if (!session) return showView("auth-view");

  if (await isAdmin()) {
    window.location.replace("admin.html");
    return;
  }
  const stores = await getMyVendors();
  if (stores.length) {
    window.location.replace("vendor.html");
    return;
  }

  $("waiting-email").textContent = session.user.email;
  showView("waiting-view");
}


// ---------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------
function wireForms() {
  document.querySelectorAll("[data-auth-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setAuthTab(btn.dataset.authTab));
  });

  $("signin-form").addEventListener("submit", onSignIn);
  $("signup-form").addEventListener("submit", onSignUp);

  $("confirm-back").addEventListener("click", () => {
    setAuthTab("signin");
    showView("auth-view");
  });
  $("recheck-btn").addEventListener("click", async () => {
    showView("login-loading");
    await route();
  });
  $("signout-btn").addEventListener("click", async () => {
    await signOut();
    showView("auth-view");
  });
}

function setAuthTab(tab) {
  document.querySelectorAll("[data-auth-tab]").forEach((btn) => {
    btn.setAttribute("aria-selected", String(btn.dataset.authTab === tab));
  });
  $("signin-panel").hidden = tab !== "signin";
  $("signup-panel").hidden = tab !== "signup";
}

function clearErrors(form) {
  form.querySelectorAll(".has-error").forEach((el) => el.classList.remove("has-error"));
  form.querySelectorAll(".field-error").forEach((el) => (el.textContent = ""));
  form.querySelectorAll(".form-submit-error").forEach((el) => (el.style.display = "none"));
}

function fieldError(id, message) {
  $(id).classList.add("has-error");
  $(id + "-error").textContent = message;
}

function showError(id, message) {
  const el = $(id);
  el.textContent = message;
  el.style.display = "block";
}

// Disable the button and change its label while a request is running.
async function withBusy(button, busyLabel, task) {
  const idle = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.textContent = idle;
  }
}

async function onSignIn(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearErrors(form);

  const email = $("signin-email").value.trim();
  const password = $("signin-password").value;
  let invalid = false;
  if (!EMAIL_RE.test(email)) (fieldError("signin-email", "Enter a valid email address."), (invalid = true));
  if (!password) (fieldError("signin-password", "Enter your password."), (invalid = true));
  if (invalid) return;

  const result = await withBusy($("signin-submit"), "Signing in…", () => signIn({ email, password }));
  if (!result.ok) {
    showError("signin-error", result.error);
    return;
  }

  $("signin-password").value = "";
  await route();
}

async function onSignUp(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearErrors(form);

  const fullName = $("signup-name").value.trim();
  const phone = $("signup-phone").value.trim();
  const email = $("signup-email").value.trim();
  const password = $("signup-password").value;

  let invalid = false;
  const need = (id, ok, msg) => {
    if (!ok) {
      fieldError(id, msg);
      invalid = true;
    }
  };
  need("signup-name", fullName && fullName.length <= 120, "Enter your full name.");
  need("signup-phone", PHONE_RE.test(phone) && phone.length <= 30, "Enter a valid phone number.");
  need("signup-email", EMAIL_RE.test(email), "Enter a valid email address.");
  need("signup-password", password.length >= MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (invalid) {
    form.querySelector(".has-error")?.focus();
    return;
  }

  const result = await withBusy($("signup-submit"), "Creating account…", () => signUp({ fullName, phone, email, password }));
  if (!result.ok) {
    showError("signup-error", result.error);
    return;
  }

  $("signup-password").value = "";
  if (result.needsConfirmation) {
    $("confirm-email").textContent = email;
    showView("confirm-view");
    return;
  }
  await route();
}
