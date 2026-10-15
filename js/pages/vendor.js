import { getSession, signOut, getMyVendors } from "../supabase.js";
import { listProducts, submitProduct, editProduct, setStock, pauseProduct, withdrawEdit, removeProduct, checkImage, uploadPhoto, loadCategories, formatNaira, withImageFallback } from "../products.js";
import { escapeHtml as esc, attrUrl } from "../escape.js";

// WHAT: the page where a vendor's team posts and manages their products.
// WHO:  a signed-in person who has set up a store (see index.html).
// THE RULE: nothing a vendor does goes live by itself. The STORE waits for
//       approval, and so does every new product and every edit to a live
//       product (the shop keeps showing the current version meanwhile).
//       Instant actions: Pause (can only take a product OFF sale) and
//       Stock. The database enforces all of this; this page only asks
//       and explains.

const state = {
  vendors: [],
  vendorId: null,
  products: [],
  categories: [],
  filter: "all",
  busy: false,
};

const $ = (id) => document.getElementById(id);
const AVAILABILITY = { "in-stock": "Available", limited: "Limited stock", unavailable: "Unavailable" };
const categoryName = (id) => state.categories.find((c) => c.id === id)?.name ?? id;
const currentStore = () => state.vendors.find((v) => v.id === state.vendorId);

document.addEventListener("DOMContentLoaded", async () => {
  $("signout-btn").addEventListener("click", async () => {
    await signOut();
    window.location.replace("index.html");
  });

  const session = await getSession();
  if (!session) {
    window.location.replace("index.html");
    return;
  }

  // No store yet? index.html decides where they belong (store form or admin).
  state.vendors = await getMyVendors();
  if (!state.vendors.length) {
    window.location.replace("index.html");
    return;
  }

  state.categories = await loadCategories();

  const wanted = new URLSearchParams(window.location.search).get("store");
  state.vendorId = state.vendors.some((v) => v.id === wanted) ? wanted : state.vendors[0].id;

  wire();
  show("vp-app");
  renderStores();
  renderStoreNote();
  await refresh();
});

function show(id) {
  ["vp-loading", "vp-app"].forEach((v) => ($(v).style.display = v === id ? "block" : "none"));
}


// ---------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------
async function refresh() {
  const result = await listProducts(state.vendorId);
  const banner = $("vp-error");
  if (!result.ok) {
    banner.textContent = result.error;
    banner.style.display = "block";
    return;
  }
  banner.style.display = "none";
  state.products = result.data || [];
  renderFilters();
  renderList();
}

// What the vendor should see for one product.
function describe(p) {
  const edit = p.edit;
  const storeLive = currentStore()?.status === "approved";
  const out = { badges: [], note: null, noteKind: "", changes: [], actions: ["edit", "stock"] };

  if (p.stockQty === 0) out.badges.push(["Sold out", "badge-danger"]);

  if (p.status === "pending") {
    out.badges.push(["Waiting for approval", "badge-accent"]);
    out.note = "Runnit Uniosun is reviewing this. Students can see it once it is approved.";
    out.actions.push("remove");
    return out;
  }

  if (p.status === "rejected") {
    out.badges.push(["Not approved", "badge-danger"]);
    out.note = p.reviewNote ? `Reason: ${p.reviewNote}` : "Runnit Uniosun didn't approve this product.";
    out.noteKind = "bad";
    out.actions.push("remove");
    return out;
  }

  // approved product
  if (storeLive) {
    out.badges.push(["Live", ""]);
  } else {
    out.badges.push(["Approved", ""], ["Store not live yet", "badge-outline"]);
    out.note = "This product is approved, but students can't see it until your store is approved.";
    out.noteKind = "warn";
  }
  if (p.availability === "unavailable") out.badges.push(["Paused", "badge-outline"]);
  if (p.availability !== "unavailable") out.actions.push("pause");

  if (edit && edit.status === "pending") {
    out.badges.push(["Edit waiting for approval", "badge-accent"]);
    out.note = "Students still see the current version until your edit is approved. Changes you asked for:";
    out.noteKind = "warn";
    out.changes = changesBetween(p, edit.proposed);
    out.actions.push("withdraw");
  } else if (edit && edit.status === "rejected") {
    out.note = `Your last edit wasn't approved${edit.reviewNote ? `. Reason: ${edit.reviewNote}` : "."} The version below is still the current one.`;
    out.noteKind = "bad";
  }
  out.actions.push("remove");
  return out;
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

function stockText(p) {
  if (p.stockQty === null || p.stockQty === undefined) return "Stock: not counted";
  if (p.stockQty === 0) return "Sold out";
  return `${p.stockQty} in stock`;
}


// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------
function renderStores() {
  const el = $("vp-stores");
  if (state.vendors.length < 2) {
    el.style.display = "none";
    return;
  }
  el.style.display = "flex";
  el.innerHTML = state.vendors
    .map((v) => `<button type="button" class="filter-chip ${v.id === state.vendorId ? "is-active" : ""}" data-store="${esc(v.id)}" aria-pressed="${v.id === state.vendorId}">${esc(v.storeName)}</button>`)
    .join("");
}

// The big message about the STORE itself.
function renderStoreNote() {
  const store = currentStore();
  const el = $("vp-store-note");
  if (!store || store.status === "approved") {
    el.style.display = "none";
    return;
  }
  el.style.display = "block";
  if (store.status === "rejected") {
    el.textContent = `Your store wasn't approved${store.reviewNote ? `. Reason: ${store.reviewNote}` : "."} Please contact Runnit Uniosun to sort it out.`;
  } else {
    el.textContent = "Your store is waiting for approval. You can add products now, but nothing goes live automatically. Students can see your store and products only after Runnit Uniosun approves your store and each product.";
  }
}

const isWaiting = (p) => p.status === "pending" || (p.edit && p.edit.status === "pending");
const needsAttention = (p) => p.status === "rejected" || (p.edit && p.edit.status === "rejected");

function matchesFilter(p) {
  switch (state.filter) {
    case "live":
      return p.status === "approved";
    case "waiting":
      return isWaiting(p);
    case "attention":
      return needsAttention(p);
    default:
      return true;
  }
}

function renderFilters() {
  const counts = {
    all: state.products.length,
    live: state.products.filter((p) => p.status === "approved").length,
    waiting: state.products.filter(isWaiting).length,
    attention: state.products.filter(needsAttention).length,
  };
  const labels = [["all", "All"], ["live", "Approved"], ["waiting", "Waiting"], ["attention", "Needs attention"]];
  $("vp-filters").innerHTML = labels
    .map(([key, label]) => `<button type="button" class="filter-chip ${state.filter === key ? "is-active" : ""}" data-filter="${key}" aria-pressed="${state.filter === key}">${label} (${counts[key]})</button>`)
    .join("");
}

function renderList() {
  const list = state.products.filter(matchesFilter);
  $("vp-count").textContent = `${list.length} product${list.length === 1 ? "" : "s"}`;
  const el = $("vp-list");

  if (!state.products.length) {
    el.innerHTML = `<div class="empty-state"><h3>No products yet</h3><p style="margin-inline:auto">Add your first product. It goes live once Runnit Uniosun approves it.</p></div>`;
    return;
  }
  if (!list.length) {
    el.innerHTML = `<div class="empty-state"><h3>Nothing here</h3><p style="margin-inline:auto">No products match this filter.</p></div>`;
    return;
  }

  el.innerHTML = list
    .map((p) => {
      const d = describe(p);
      const buttons = {
        edit: `<button type="button" class="btn btn-outline btn-sm" data-act="edit" data-id="${esc(p.id)}">${p.status === "rejected" ? "Edit and resubmit" : "Edit"}</button>`,
        stock: `<button type="button" class="btn btn-outline btn-sm" data-act="stock" data-id="${esc(p.id)}">Stock</button>`,
        pause: `<button type="button" class="btn btn-outline btn-sm" data-act="pause" data-id="${esc(p.id)}">Pause</button>`,
        withdraw: `<button type="button" class="btn btn-outline btn-sm" data-act="withdraw" data-id="${esc(p.id)}">Withdraw edit</button>`,
        remove: `<button type="button" class="btn btn-outline btn-danger-outline btn-sm" data-act="remove" data-id="${esc(p.id)}">Remove</button>`,
      };
      return `
      <article class="vp-item">
        <div class="vp-item__thumb"><img src="${attrUrl(p.image)}" alt="${esc(p.name)}" loading="lazy" /></div>
        <div class="vp-item__main">
          <div class="vp-item__title">
            <h3>${esc(p.name)}</h3>
            ${d.badges.map(([text, cls]) => `<span class="badge ${cls}">${esc(text)}</span>`).join("")}
          </div>
          <div class="vp-item__meta">
            <strong>${formatNaira(p.price)}</strong>
            <span>${esc(categoryName(p.categoryId))}</span>
            <span>${esc(AVAILABILITY[p.availability] || p.availability)}</span>
            <span>${esc(stockText(p))}</span>
          </div>
          ${d.note ? `<p class="vp-item__note ${d.noteKind ? "vp-item__note--" + d.noteKind : ""}">${esc(d.note)}</p>` : ""}
          ${d.changes.length ? `<ul class="vp-item__changes">${d.changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
        </div>
        <div class="vp-item__actions">${d.actions.map((a) => buttons[a]).join("")}</div>
      </article>`;
    })
    .join("");
  el.querySelectorAll(".vp-item__thumb img").forEach(withImageFallback);
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


// ---------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------
async function act(task) {
  if (state.busy) return;
  state.busy = true;
  try {
    await task();
  } finally {
    state.busy = false;
  }
}

async function onPause(p) {
  const ok = await confirmDialog({
    title: `Pause ${p.name}?`,
    body: "It is marked Unavailable straight away. Turning it back on is an edit, so Runnit Uniosun reviews it first.",
    okLabel: "Pause product",
  });
  if (!ok) return;
  await act(async () => {
    const r = await pauseProduct(p.id);
    if (!r.ok) return toast(r.error, true);
    toast(`${p.name} is paused.`);
    await refresh();
  });
}

async function onWithdraw(p) {
  const ok = await confirmDialog({ title: "Withdraw this edit?", body: "Your proposed changes are discarded. The product stays as it is.", okLabel: "Withdraw edit" });
  if (!ok) return;
  await act(async () => {
    const r = await withdrawEdit(p.id);
    if (!r.ok) return toast(r.error, true);
    toast("Edit withdrawn.");
    await refresh();
  });
}

async function onRemove(p) {
  const ok = await confirmDialog({
    title: `Remove ${p.name}?`,
    body: "It is hidden from your list and from students. Past orders stay intact.",
    okLabel: "Remove product",
  });
  if (!ok) return;
  await act(async () => {
    const r = await removeProduct(p.id);
    if (!r.ok) return toast(r.error, true);
    toast(`${p.name} was removed.`);
    await refresh();
  });
}

// Stock changes are instant: no approval needed.
function onStock(p) {
  $("vp-stock-product").textContent = p.name;
  $("vp-stock-input").value = p.stockQty ?? "";
  $("vp-stock-input").classList.remove("has-error");
  $("vp-stock-input-error").textContent = "";
  $("vp-stock-error").style.display = "none";
  $("vp-stock-cancel").onclick = () => $("vp-stock-dialog").close();

  $("vp-stock-form").onsubmit = async (event) => {
    event.preventDefault();
    if (state.busy) return;
    $("vp-stock-input").classList.remove("has-error");
    $("vp-stock-input-error").textContent = "";
    $("vp-stock-error").style.display = "none";

    const raw = $("vp-stock-input").value.trim();
    let stock = null; // empty = stop counting
    if (raw !== "") {
      stock = Number(raw);
      if (!Number.isInteger(stock) || stock < 0 || stock > 100000) {
        $("vp-stock-input").classList.add("has-error");
        $("vp-stock-input-error").textContent = "Enter a whole number from 0 to 100,000, or leave it empty.";
        return;
      }
    }

    await act(async () => {
      const r = await setStock(p.id, stock);
      if (!r.ok) {
        $("vp-stock-error").textContent = r.error;
        $("vp-stock-error").style.display = "block";
        return;
      }
      $("vp-stock-dialog").close();
      toast(stock === null ? `${p.name}: stock is no longer counted.` : `${p.name}: stock set to ${stock}.`);
      await refresh();
    });
  };

  $("vp-stock-dialog").showModal();
}


// ---------------------------------------------------------------------
// Add / edit form
// ---------------------------------------------------------------------
function field(id, label, control, hint = "") {
  return `<div class="form-group"><label for="${id}">${esc(label)}</label>${control}${hint ? `<span class="vp-hint">${esc(hint)}</span>` : ""}<span class="field-error" id="${id}-error"></span></div>`;
}

function openForm(product) {
  const editing = !!product;
  // For a live product with an edit already waiting, start from that edit.
  const base = editing && product.edit && product.edit.status === "pending" ? { ...product, ...product.edit.proposed } : product || {};
  const form = $("vp-form");
  let currentImage = base.image || null;

  const opts = (list, value) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(l)}</option>`).join("");
  const live = editing && product.status === "approved";

  form.innerHTML = `
    <h2 id="vp-dialog-title">${editing ? "Edit product" : "Add product"}</h2>
    ${live ? `<p class="vp-review-note">Students keep seeing the current version of this product until Runnit Uniosun approves your changes.</p>` : ""}
    ${editing && product.status === "rejected" && product.reviewNote ? `<p class="vp-review-note">Note from Runnit Uniosun: ${esc(product.reviewNote)}</p>` : ""}
    ${field("vp-name", "Product name", `<input type="text" id="vp-name" maxlength="120" autocomplete="off" value="${esc(base.name || "")}" />`)}
    <div class="vp-form-row">
      ${field("vp-price", "Price (₦)", `<input type="number" id="vp-price" min="0" max="50000000" step="1" inputmode="numeric" value="${esc(base.price ?? "")}" />`, "Whole naira, no commas.")}
      ${field("vp-availability", "Availability", `<select id="vp-availability">${opts(Object.entries(AVAILABILITY), base.availability || "in-stock")}</select>`)}
    </div>
    ${field("vp-category", "Category", `<select id="vp-category"><option value="">Choose a category</option>${opts(state.categories.map((c) => [c.id, c.name]), base.categoryId)}</select>`)}
    ${field("vp-description", "Description", `<textarea id="vp-description" rows="4" maxlength="1000">${esc(base.description || "")}</textarea>`, "At least 10 characters. Say what it is, sizes, and anything a buyer should know.")}
    ${!editing ? field("vp-stock-new", "How many do you have? (optional)", `<input type="number" id="vp-stock-new" min="0" max="100000" step="1" inputmode="numeric" />`, "Leave empty if you don't count stock. You can change it any time, instantly.") : ""}
    <div class="form-group">
      <label for="vp-photo">Photo</label>
      <div class="vp-photo">
        <div class="vp-item__thumb" id="vp-photo-preview"><img src="${attrUrl(currentImage)}" alt="" /></div>
        <input type="file" id="vp-photo" accept="image/jpeg,image/png,image/webp" />
      </div>
      <span class="vp-hint">JPG, PNG or WebP, up to 3 MB.</span>
      <span class="field-error" id="vp-photo-error"></span>
    </div>
    <div class="form-submit-error" id="vp-form-error" role="alert"></div>
    <div class="vp-dialog__actions">
      <button type="button" class="btn btn-outline" id="vp-cancel">Cancel</button>
      <button type="submit" class="btn btn-primary" id="vp-submit">${live ? "Send edit for approval" : editing ? "Resubmit for approval" : "Submit for approval"}</button>
    </div>`;

  form.querySelectorAll("#vp-photo-preview img").forEach(withImageFallback);
  $("vp-cancel").onclick = () => $("vp-dialog").close();

  $("vp-photo").addEventListener("change", () => {
    const file = $("vp-photo").files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    $("vp-photo-preview").innerHTML = `<img src="${url}" alt="Selected photo preview" />`;
  });

  form.onsubmit = async (event) => {
    event.preventDefault();
    if (state.busy) return;
    form.querySelectorAll(".has-error").forEach((el) => el.classList.remove("has-error"));
    form.querySelectorAll(".field-error").forEach((el) => (el.textContent = ""));
    $("vp-form-error").style.display = "none";

    const values = {
      name: $("vp-name").value.trim(),
      price: Number($("vp-price").value),
      availability: $("vp-availability").value,
      categoryId: $("vp-category").value,
      description: $("vp-description").value.trim(),
      image: currentImage,
    };
    const priceText = $("vp-price").value.trim();
    const file = $("vp-photo").files[0];

    let invalid = false;
    const need = (id, ok, message) => {
      if (!ok) {
        $(id).classList.add("has-error");
        $(id + "-error").textContent = message;
        invalid = true;
      }
    };
    need("vp-name", values.name.length >= 2 && values.name.length <= 120, "Enter a product name (2 to 120 characters).");
    need("vp-price", priceText !== "" && Number.isInteger(values.price) && values.price >= 0 && values.price <= 50000000, "Enter a whole-number price, 0 or more.");
    need("vp-category", values.categoryId, "Choose a category.");
    need("vp-description", values.description.length >= 10 && values.description.length <= 1000, "Write at least 10 characters.");
    const photoProblem = checkImage(file);
    need("vp-photo", !photoProblem, photoProblem);

    // Optional starting stock (new products only)
    const stockText = !editing ? $("vp-stock-new").value.trim() : "";
    let stockNew = null;
    if (stockText !== "") {
      stockNew = Number(stockText);
      need("vp-stock-new", Number.isInteger(stockNew) && stockNew >= 0 && stockNew <= 100000, "Enter a whole number from 0 to 100,000, or leave it empty.");
    }
    if (invalid) return form.querySelector(".has-error")?.focus();

    await act(async () => {
      const button = $("vp-submit");
      const idle = button.textContent;
      button.disabled = true;
      button.textContent = "Sending…";
      try {
        if (file) {
          const up = await uploadPhoto(state.vendorId, file);
          if (!up.ok) return showFormError(up.error);
          values.image = up.url;
        }
        const result = editing ? await editProduct(product.id, values) : await submitProduct(state.vendorId, values);
        if (!result.ok) return showFormError(result.error);

        // New product with a starting stock: save the count right away.
        let stockNote = "";
        if (!editing && stockNew !== null && result.data && result.data.id) {
          const s = await setStock(result.data.id, stockNew);
          if (!s.ok) stockNote = " Your stock count wasn't saved. Use the Stock button to set it.";
        }

        $("vp-dialog").close();
        const kind = result.data && result.data.kind;
        toast(
          (kind === "edit_pending"
            ? "Your edit was sent for approval. Students keep seeing the current version until then."
            : kind === "resubmitted"
              ? "Product resubmitted for approval."
              : "Product submitted. It goes live only after Runnit Uniosun approves it.") + stockNote
        );
        await refresh();
      } finally {
        button.disabled = false;
        button.textContent = idle;
      }
    });
  };

  $("vp-dialog").showModal();
}

function showFormError(message) {
  const el = $("vp-form-error");
  el.textContent = message;
  el.style.display = "block";
}


// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------
function wire() {
  $("vp-add").addEventListener("click", () => openForm(null));

  $("vp-stores").addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-store]");
    if (!btn) return;
    state.vendorId = btn.dataset.store;
    state.filter = "all";
    history.replaceState({}, "", `vendor.html?store=${encodeURIComponent(state.vendorId)}`);
    renderStores();
    renderStoreNote();
    await refresh();
  });

  $("vp-filters").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-filter]");
    if (!btn) return;
    state.filter = btn.dataset.filter;
    renderFilters();
    renderList();
  });

  $("vp-list").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-act]");
    if (!btn) return;
    const product = state.products.find((p) => p.id === btn.dataset.id);
    if (!product) return;
    const actions = {
      edit: () => openForm(product),
      stock: () => onStock(product),
      pause: () => onPause(product),
      withdraw: () => onWithdraw(product),
      remove: () => onRemove(product),
    };
    actions[btn.dataset.act]?.();
  });
}
