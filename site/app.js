import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.PEC_CONFIG;
const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
const $ = (id) => document.getElementById(id);

// Same alphabet as the app and the database check: no 0/O, 1/I/L to avoid mix-ups.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function newCode() {
  const out = [];
  const buf = new Uint8Array(1);
  while (out.length < 12) {
    crypto.getRandomValues(buf);
    if (buf[0] < 248) out.push(ALPHABET[buf[0] % 31]); // 248 = 8 * 31: no modulo bias
  }
  const s = out.join("");
  return `PEC-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
const statusOf = (r) => (r.revoked_at ? "revoked" : r.device_hash ? "active" : "unused");

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2200);
}

async function copy(text, what = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(what);
  } catch {
    prompt("Copy this:", text);
  }
}

function buyerMessage(code) {
  const link = cfg.appDownloadUrl ? `\nDownload the app: ${cfg.appDownloadUrl}` : "";
  return `Thank you for purchasing Pocket PEC!${link}\n\nYour access code: ${code}\n\n` +
    "Open the app and enter this code once while connected to the internet. After that, the app works fully offline. " +
    "The code works on one phone only - please do not share it.";
}

let rows = [];

async function show() {
  const { data: { session } } = await sb.auth.getSession();
  $("loginView").hidden = !!session;
  $("signOut").hidden = !session;
  $("adminView").hidden = true;
  $("notAdmin").hidden = true;
  if (!session) return;
  const { data: admin } = await sb.from("admins").select("user_id").eq("user_id", session.user.id).maybeSingle();
  if (!admin) {
    $("adminSql").textContent = `insert into public.admins (user_id) values ('${session.user.id}');`;
    $("notAdmin").hidden = false;
    return;
  }
  $("adminView").hidden = false;
  await load();
}

async function load() {
  const { data, error } = await sb.from("access_codes").select("*").order("created_at", { ascending: false }).limit(5000);
  if (error) return toast(`Could not load codes: ${error.message}`);
  rows = data;
  render();
}

function render() {
  const q = $("search").value.trim().toLowerCase();
  const f = $("statusFilter").value;
  const count = { unused: 0, active: 0, revoked: 0 };
  rows.forEach((r) => count[statusOf(r)]++);
  $("stats").textContent = `${rows.length} total · ${count.unused} unused · ${count.active} activated · ${count.revoked} revoked`;
  const shown = rows.filter((r) => (!f || statusOf(r) === f) &&
    (!q || [r.code, r.buyer, r.note].some((v) => String(v ?? "").toLowerCase().includes(q))));
  $("codes").innerHTML = shown.map((r) => {
    const st = statusOf(r);
    const label = { unused: "Unused", active: "Activated", revoked: "Revoked" }[st];
    const detail = st === "active"
      ? `<div class="sub">${esc(r.device_label || "device")} · ${fmt(r.redeemed_at)}${r.activations > 1 ? ` · ${r.activations} activations` : ""}</div>`
      : st === "revoked" ? `<div class="sub">${fmt(r.revoked_at)}</div>` : "";
    return `<tr>
      <td class="code">${esc(r.code)}</td>
      <td>${esc(r.buyer) || '<span class="sub">—</span>'}<div class="sub">${esc(r.note)}</div></td>
      <td class="sub">${fmt(r.created_at)}</td>
      <td><span class="badge ${st}">${label}</span>${detail}</td>
      <td style="white-space:nowrap">
        <button class="link" data-act="copy" data-id="${r.id}">Copy message</button>
        ${st === "active" ? `<button class="link" data-act="free" data-id="${r.id}" title="Let the buyer activate on a new phone">Free for new phone</button>` : ""}
        ${st === "revoked" ? `<button class="link" data-act="restore" data-id="${r.id}">Restore</button>`
          : `<button class="link danger" data-act="revoke" data-id="${r.id}">Revoke</button>`}
        ${st === "unused" ? `<button class="link danger" data-act="delete" data-id="${r.id}">Delete</button>` : ""}
      </td></tr>`;
  }).join("") || `<tr><td colspan="5" class="sub">No codes yet.</td></tr>`;
}

async function act(action, id) {
  const r = rows.find((x) => String(x.id) === String(id));
  if (!r) return;
  if (action === "copy") return copy(buyerMessage(r.code), "Message with code copied");
  let res;
  if (action === "free") {
    if (!confirm(`Free ${r.code} so it can be activated on a new phone?\nThe old phone keeps working offline.`)) return;
    res = await sb.from("access_codes").update({ device_hash: null, device_label: null }).eq("id", r.id);
  } else if (action === "revoke") {
    if (!confirm(`Revoke ${r.code}? It can no longer be activated.\nA phone that already activated keeps working offline.`)) return;
    res = await sb.from("access_codes").update({ revoked_at: new Date().toISOString() }).eq("id", r.id);
  } else if (action === "restore") {
    res = await sb.from("access_codes").update({ revoked_at: null }).eq("id", r.id);
  } else if (action === "delete") {
    if (!confirm(`Delete unused code ${r.code}?`)) return;
    res = await sb.from("access_codes").delete().eq("id", r.id);
  }
  if (res?.error) return toast(res.error.message);
  await load();
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginError").textContent = "";
  const { error } = await sb.auth.signInWithPassword({ email: $("email").value, password: $("password").value });
  if (error) $("loginError").textContent = error.message;
  else show();
});

$("signOut").addEventListener("click", async () => {
  await sb.auth.signOut();
  show();
});

$("genForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const n = Math.max(1, Math.min(50, parseInt($("count").value, 10) || 1));
  const buyer = $("buyer").value.trim() || null;
  const note = $("note").value.trim() || null;
  const fresh = Array.from({ length: n }, () => ({ code: newCode(), buyer, note }));
  const btn = e.submitter;
  btn.disabled = true;
  const { data, error } = await sb.from("access_codes").insert(fresh).select("code");
  btn.disabled = false;
  if (error) return toast(`Could not create codes: ${error.message}`);
  $("newCodes").innerHTML = data.map((r) =>
    `<div class="newcode"><span class="code">${esc(r.code)}</span>
      <button class="ghost" data-copy="${esc(r.code)}">Copy code</button>
      <button data-msg="${esc(r.code)}">Copy message for buyer</button></div>`).join("");
  $("buyer").value = "";
  $("note").value = "";
  $("count").value = 1;
  await load();
});

$("newCodes").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.copy) copy(b.dataset.copy, "Code copied");
  if (b.dataset.msg) copy(buyerMessage(b.dataset.msg), "Message with code copied");
});
$("codes").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-act]");
  if (b) act(b.dataset.act, b.dataset.id);
});
$("search").addEventListener("input", render);
$("statusFilter").addEventListener("change", render);
$("refresh").addEventListener("click", load);

sb.auth.onAuthStateChange(() => {});
show();
