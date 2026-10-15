import { getSession, signOut, isAdmin, rpc } from "../supabase.js";
import { loadCategories, formatNaira, withImageFallback } from "../products.js";
import { escapeHtml as esc, attrUrl } from "../escape.js";

// WHAT: the admin page. You review stores and products here.
// WHO:  only accounts in the admins table. Anyone else is sent away, and
//       the database refuses their requests anyway (every admin function
//       checks is_admin()).
// THE RULE: nothing goes live until you approve it. Approve the STORE
//       first, then each PRODUCT (or each EDIT to a live product).
// FUTURE: suspend or reactivate a store, and un-approve a product.

const state = {
  tab: "stores", // stores | products | all
  stores: [], // stores waiting for review
  products: [], // new products + edits waiting for review
  allStores: [],
  categories: [],
  busy: false,
};

const $ = (id) => document.getElementById(id);
const AVAILABILITY = { "in-stock": "Available", limited: "Limited stock", unavailable: "Unavailable" };
const categoryName = (id) => state.categories.find((c) => c.id === id)?.name ?? id;
const fmtDate = (v) => (v ? new Date(v).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }) : "");

document.addEventListener("DOMContentLoaded", async () => {
  $("signout-btn").addEventListener("click", async () => {
    await signOut();
    window.location.replace("index.html");
  });

  const session = await getSession();
  if (!session || !(await isAdmin())) {
    window.location.replace("index.html"); // index.html sends people where they belong
    return;
  }

  state.categories = await loadCategories();
  wire();
  await loadAll();
  $("ad-loading").style.display = "none";
  $("ad-app").style.display = "block";
  render();
});


// ---------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------
async function loadAll() {
  const [stores, products, all] = await Promise.all([
    rpc("admin_pending_vendors"),
    rpc("admin_pending_products"),
    rpc("admin_list_vendors"),
  ]);

  const failed = [stores, products, all].find((r) => !r.ok);
  const banner = $("ad-error");
  if (failed) {
    banner.textContent = failed.error;
    banner.style.display = "block";
  } else {
    banner.style.display = "none";
  }

  if (stores.ok) state.stores = stores.data || [];
  if (products.ok) state.products = products.data || [];
  if (all.ok) state.allStores = all.data || [];
}


// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------
function render() {
  const tabs = [
    ["stores", `Stores to review (${state.stores.length})`],
    ["products", `Products to review (${state.products.length})`],
    ["all", `All stores (${state.allStores.length})`],
  ];
  $("ad-tabs").innerHTML = tabs
    .map(([key, label]) => `<button type="button" class="filter-chip ${state.tab === key ? "is-active" : ""}" data-tab="${key}" aria-pressed="${state.tab === key}">${esc(label)}</button>`)
    .join("");

  const el = $("ad-list");
  if (state.tab === "stores") {
    el.innerHTML = state.stores.length
      ? state.stores.map((s) => storeCard(s, true)).join("")
      : empty("No stores waiting", "New stores appear here when a vendor submits one.");
  } else if (state.tab === "products") {
    el.innerHTML = state.products.length
      ? state.products.map((item, i) => productCard(item, i)).join("")
      : empty("No products waiting", "New products and edits appear here when a vendor sends them.");
  } else {
    el.innerHTML = state.allStores.length
      ? state.allStores.map((s) => storeCard(s, false)).join("")
      : empty("No stores yet", "Stores appear here once vendors set them up.");
  }
  el.querySelectorAll(".vp-item__thumb img").forEach(withImageFallback);
}

function empty(title, text) {
  return `<div class="empty-state"><h3>${esc(title)}</h3><p style="margin-inline:auto">${esc(text)}</p></div>`;
}

function storeCard(s, withActions) {
  const badges = [];
  if (s.status === "approved") badges.push(["Approved", ""]);
  else if (s.status === "rejected") badges.push(["Rejected", "badge-danger"]);
  else badges.push(["Waiting for approval", "badge-accent"]);
  if (s.active === false) badges.push(["Inactive", "badge-outline"]);

  return `
  <article class="vp-item">
    <div class="vp-item__thumb"><img src="${attrUrl(s.image)}" alt="${esc(s.store_name)}" loading="lazy" /></div>
    <div class="vp-item__main">
      <div class="vp-item__title">
        <h3>${esc(s.store_name)}</h3>
        ${badges.map(([text, cls]) => `<span class="badge ${cls}">${esc(text)}</span>`).join("")}
      </div>
      <div class="vp-item__meta">
        <span>${esc(categoryName(s.category_id))}</span>
        <span>${esc(s.location)}</span>
        <span>Sent ${esc(fmtDate(s.created_at))}</span>
      </div>
      <p class="vp-item__note">${esc(s.description)}</p>
      <div class="vp-item__meta">
        <span>Owner: ${esc(s.owner_name)}</span>
        <span>Phone: ${esc(s.phone)}</span>
        <span>WhatsApp: ${esc(s.whatsapp)}</span>
        <span>${esc(s.email)}</span>
      </div>
      ${s.status === "rejected" && s.review_note ? `<p class="vp-item__note vp-item__note--bad">Reason given: ${esc(s.review_note)}</p>` : ""}
    </div>
    ${
      withActions
        ? `<div class="vp-item__actions">
            <button type="button" class="btn btn-primary btn-sm" data-act="approve-store" data-id="${esc(s.id)}">Approve</button>
            <button type="button" class="btn btn-outline btn-danger-outline btn-sm" data-act="reject-store" data-id="${esc(s.id)}">Reject</button>
          </div>`
        : ""
    }
  </article>`;
}

function productCard(item, index) {
  const p = item.proposed;
  const isEdit = item.kind === "edit";
  const storeWaiting = state.stores.some((s) => s.id === item.vendorId);

  const badges = [[isEdit ? "Edit to a live product" : "New product", "badge-accent"]];
  if (storeWaiting) badges.push(["Store not approved yet", "badge-outline"]);
  const changes = isEdit ? changesBetween(item.current, p) : [];

  return `
  <article class="vp-item">
    <div class="vp-item__thumb"><img src="${attrUrl(p.image)}" alt="${esc(p.name)}" loading="lazy" /></div>
    <div class="vp-item__main">
      <div class="vp-item__title">
        <h3>${esc(p.name)}</h3>
        ${badges.map(([text, cls]) => `<span class="badge ${cls}">${esc(text)}</span>`).join("")}
      </div>
      <div class="vp-item__meta">
        <strong>${formatNaira(p.price)}</strong>
        <span>${esc(categoryName(p.categoryId))}</span>
        <span>${esc(AVAILABILITY[p.availability] || p.availability)}</span>
        <span>Store: ${esc(item.vendorName)}</span>
        <span>Sent ${esc(fmtDate(item.submittedAt))}</span>
      </div>
      <p class="vp-item__note">${esc(p.description)}</p>
      ${changes.length ? `<p class="vp-item__note vp-item__note--warn">Changes from the live version:</p><ul class="vp-item__changes">${changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
    </div>
    <div class="vp-item__actions">
      <button type="button" class="btn btn-primary btn-sm" data-act="approve-product" data-i="${index}">Approve</button>
      <button type="button" class="btn btn-outline btn-danger-outline btn-sm" data-act="reject-product" data-i="${index}">Reject</button>
    </div>
  </article>`;
}

function changesBetween(current, proposed) {
  const rows = [];
  const add = (label, from, to) => from !== to && rows.push(`${label}: ${from || "none"} → ${to || "none"}`);
  add("Name", current.name, proposed.name);
  add("Price", formatNaira(current.price), formatNaira(proposed.price));
  add("Category", categoryName(current.categoryId), categoryName(proposed.categoryId));
  add("Availability", AVAILABILITY[current.availability], AVAILABILITY[proposed.availability]);
  if (current.description !== proposed.description) rows.push("Description updated");
  if ((current.image || "") !== (proposed.image || "")) rows.push("Photo changed");
  return rows;
}


// ---------------------------------------------------------------------
// Toast and confirm
// ---------------------------------------------------------------------
let toastTimer;
function toast(message, isError = false) {
  const el = $("vp-toast");
  el.textContent = message;
  el.className = "vp-toast" + (isError ? " vp-toast--error" : "");
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), isError ? 7000 : 5000);
}

function confirmDialog({ title, body, okLabel }) {
  return new Promise((resolve) => {
    const dlg = $("vp-confirm");
    $("vp-confirm-title").textContent = title;
    $("vp-confirm-body").textContent = body;
    $("vp-confirm-ok").textContent = okLabel;
    let confirmed = false;
    $("vp-confirm-ok").onclick = () => {
      confirmed = true;
      dlg.close();
    };
    $("vp-confirm-cancel").onclick = () => dlg.close();
    dlg.onclose = () => resolve(confirmed);
    dlg.showModal();
  });
}

async function act(task) {
  if (state.busy) return;
  state.busy = true;
  try {
    await task();
  } finally {
    state.busy = false;
  }
}


// ---------------------------------------------------------------------
// Approve / reject
// ---------------------------------------------------------------------
// kind: "store" | "product". item: a store row, or a pending-product entry.
function sendReview(kind, item, decision, note) {
  if (kind === "store") {
    return rpc("admin_review_vendor", { p_vendor_id: item.id, p_decision: decision, p_note: note });
  }
  return rpc("admin_review_product", {
    p_product_id: item.productId,
    p_revision_id: item.revisionId, // null for a brand-new product
    p_decision: decision,
    p_note: note,
  });
}

const nameOf = (kind, item) => (kind === "store" ? item.store_name : item.kind === "edit" ? item.current.name : item.proposed.name);

async function onApprove(kind, item) {
  const name = nameOf(kind, item);
  const copy =
    kind === "store"
      ? { title: `Approve ${name}?`, body: "The store is marked verified. Its approved products become visible to students." }
      : item.kind === "edit"
        ? { title: `Approve this edit to ${name}?`, body: "The changes replace the live version straight away." }
        : { title: `Approve ${name}?`, body: "It becomes visible to students right away, as long as its store is approved." };

  const ok = await confirmDialog({ ...copy, okLabel: "Approve" });
  if (!ok) return;

  await act(async () => {
    const r = await sendReview(kind, item, "approve", null);
    if (!r.ok) return toast(r.error, true);
    toast(`${name} approved.`);
    await loadAll();
    render();
  });
}

function onReject(kind, item) {
  const name = nameOf(kind, item);
  $("ad-reject-title").textContent = `Reject ${name}?`;
  $("ad-reject-target").textContent = kind === "store" ? "The vendor sees your reason on their page." : "The vendor sees your reason next to the product.";
  $("ad-reject-note").value = "";
  $("ad-reject-note").classList.remove("has-error");
  $("ad-reject-note-error").textContent = "";
  $("ad-reject-error").style.display = "none";
  $("ad-reject-cancel").onclick = () => $("ad-reject").close();

  $("ad-reject-form").onsubmit = async (event) => {
    event.preventDefault();
    if (state.busy) return;
    $("ad-reject-note").classList.remove("has-error");
    $("ad-reject-note-error").textContent = "";
    $("ad-reject-error").style.display = "none";

    const note = $("ad-reject-note").value.trim();
    if (note.length < 3 || note.length > 500) {
      $("ad-reject-note").classList.add("has-error");
      $("ad-reject-note-error").textContent = "Give a short reason (3 to 500 characters).";
      return;
    }

    await act(async () => {
      const r = await sendReview(kind, item, "reject", note);
      if (!r.ok) {
        $("ad-reject-error").textContent = r.error;
        $("ad-reject-error").style.display = "block";
        return;
      }
      $("ad-reject").close();
      toast(`${name} rejected. The vendor will see your reason.`);
      await loadAll();
      render();
    });
  };

  $("ad-reject").showModal();
}


// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------
function wire() {
  $("ad-tabs").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-tab]");
    if (!btn) return;
    state.tab = btn.dataset.tab;
    render();
  });

  $("ad-list").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-act]");
    if (!btn) return;

    const act = btn.dataset.act;
    if (act === "approve-store" || act === "reject-store") {
      const store = state.stores.find((s) => s.id === btn.dataset.id);
      if (!store) return;
      act === "approve-store" ? onApprove("store", store) : onReject("store", store);
    } else {
      const item = state.products[Number(btn.dataset.i)];
      if (!item) return;
      act === "approve-product" ? onApprove("product", item) : onReject("product", item);
    }
  });
}
