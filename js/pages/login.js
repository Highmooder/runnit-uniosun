import { MIN_PASSWORD_LENGTH, supabase, rpc, getSession, signIn, signUp, signOut, isAdmin, getMyVendors } from "../supabase.js";

// WHAT: the sign-in page. Signed out: sign in or create an account.
//       Signed in: admins go to admin.html, vendors to vendor.html, and
//       anyone with no store yet fills in the "Set up your store" form.
// WHY:  one front door for everyone. The database decides who is an admin
//       and which store someone manages; this page only asks and redirects.
// THE RULE: a new store is created as "pending". Nothing goes live until
//       the admin approves the store and then each product.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+()\-\s]{7,}$/;
const VIEWS = ["login-loading", "auth-view", "confirm-view", "store-view"];

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

  await showStoreForm(session);
}


// ---------------------------------------------------------------------
// Set up your store
// ---------------------------------------------------------------------
async function showStoreForm(session) {
  // Fill in what we already know from sign-up (they can still change it).
  const meta = session.user.user_metadata || {};
  if (!$("store-owner").value) $("store-owner").value = meta.full_name || "";
  if (!$("store-phone").value) $("store-phone").value = meta.phone || "";

  await loadCategories();
  showView("store-view");
}

async function loadCategories() {
  const select = $("store-category");
  if (select.options.length > 1) return; // already loaded

  const { data, error } = await supabase.from("categories").select("id, name").order("name");
  if (error || !data) {
    showError("store-error", "Couldn't load the categories. Please refresh the page.");
    return;
  }
  for (const category of data) {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    select.appendChild(option);
  }
}

async function onStore(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearErrors(form);

  const storeName = $("store-name").value.trim();
  const categoryId = $("store-category").value;
  const location = $("store-location").value.trim();
  const owner = $("store-owner").value.trim();
  const phone = $("store-phone").value.trim();
  const whatsapp = $("store-whatsapp").value.trim();
  const description = $("store-description").value.trim();

  let invalid = false;
  const need = (id, ok, msg) => {
    if (!ok) {
      fieldError(id, msg);
      invalid = true;
    }
  };
  need("store-name", storeName.length >= 2 && storeName.length <= 120, "Enter your store name.");
  need("store-category", !!categoryId, "Choose a category.");
  need("store-location", location.length >= 2 && location.length <= 200, "Tell us where on campus you are.");
  need("store-owner", owner.length >= 2 && owner.length <= 120, "Enter your full name.");
  need("store-phone", PHONE_RE.test(phone) && phone.length <= 30, "Enter a valid phone number.");
  need("store-whatsapp", !whatsapp || (PHONE_RE.test(whatsapp) && whatsapp.length <= 30), "Enter a valid WhatsApp number, or leave it empty.");
  need("store-description", description.length >= 10 && description.length <= 1000, "Describe your store in 10 to 1,000 characters.");
  if (invalid) {
    form.querySelector(".has-error")?.focus();
    return;
  }

  const result = await withBusy($("store-submit"), "Submitting…", () =>
    rpc("register_vendor", {
      p_store_name: storeName,
      p_owner_name: owner,
      p_phone: phone,
      p_whatsapp: whatsapp,
      p_category_id: categoryId,
      p_location: location,
      p_description: description,
    })
  );
  if (!result.ok) {
    showError("store-error", result.error);
    return;
  }

  // The store now exists (as "pending"). The product page takes it from here.
  window.location.replace("vendor.html");
}


// ---------------------------------------------------------------------
// Sign in / create account
// ---------------------------------------------------------------------
function wireForms() {
  document.querySelectorAll("[data-auth-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setAuthTab(btn.dataset.authTab));
  });

  $("signin-form").addEventListener("submit", onSignIn);
  $("signup-form").addEventListener("submit", onSignUp);
  $("store-form").addEventListener("submit", onStore);

  $("confirm-back").addEventListener("click", () => {
    setAuthTab("signin");
    showView("auth-view");
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
