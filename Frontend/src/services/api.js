// src/services/api.js
import { getToken, clearToken } from "./auth";

const API = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/+$/, "");

/**
 * Base request helper used by all API calls.
 */
async function request(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers,
    credentials: "include",     // ensure cookies/sessions are sent/received cross-origin
    mode: "cors",
  });

  // Try JSON first; fall back to text if needed
  let data = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try { data = await res.json(); } catch (_) { data = null; }
  } else {
    try { data = await res.text(); } catch (_) { data = null; }
  }

  if (res.status === 401) { clearToken(); throw new Error("Unauthorized"); }
  if (!res.ok) throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
  return data;
}
export { request };

/* Expose base URL for places where we need direct file downloads (e.g., exports) */
export const baseUrl = API;

/* internal: auth header helper for non-JSON requests (e.g., file/blob) */
function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/* ========================
 * Auth
 * ====================== */
export async function login(email, password, opts = {}) {
  const remember = !!opts.remember;
  return request("/auth/login", { method: "POST", body: JSON.stringify({ email, password, remember }) });
}

// NEW: refresh current session token (silent/rolling sessions)
export async function refreshAuth() {
  return request("/auth/refresh", { method: "POST" });
}

/* ========================
 * Account (self-service)
 * ====================== */
// Current user profile
export async function me() {
  return request("/auth/me");
}
// Update own account (email and/or password)
export async function updateAccount(partial) {
  return request("/auth/me", {
    method: "PATCH",
    body: JSON.stringify(partial || {}),
  });
}
// Convenience wrappers
export async function changeEmail(email) {
  return updateAccount({ email });
}
export async function changePassword(password) {
  return updateAccount({ password });
}

/* ========================
 * Scan
 * ====================== */

// Preview the rendered default message (no SMS sent)
// NEW: third param opts supports { headcountOnly: boolean }
export async function postScanPreview(qrCode, type, opts = {}) {
  return request("/scan/preview", {
    method: "POST",
    body: JSON.stringify({
      qrCode,
      type,
      headcountOnly: !!opts.headcountOnly, // NEW
    }),
  });
}

// Perform the scan; supports optional per-send override message and recheck flag
// NEW: supports headcountOnly and both call styles:
//   postScan(qrCode, type, messageOverride?, recheck?, headcountOnly?)
//   postScan({ token, type, messageOverride?, recheck?, headcountOnly? })
export async function postScan(a, b, c, d, e) {
  let payload;

  if (a && typeof a === "object") {
    // Object style
    const { token, type, messageOverride, recheck, headcountOnly } = a;
    payload = { qrCode: token, type, headcountOnly: !!headcountOnly };
    if (typeof messageOverride === "string" && messageOverride.trim()) {
      payload.messageOverride = messageOverride.trim();
    }
    if (recheck === true) payload.recheck = true;
  } else {
    // Positional style (backward compatible)
    const qrCode = a, type = b, messageOverride = c, recheck = d, headcountOnly = e;
    payload = { qrCode, type, headcountOnly: !!headcountOnly };
    if (typeof messageOverride === "string" && messageOverride.trim()) {
      payload.messageOverride = messageOverride.trim();
    }
    if (recheck === true) payload.recheck = true;
  }

  const data = await request("/scan", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  // ---- Keep existing gateway failure handling intact ----
  // Only evaluate when backend provided gateway details (i.e., SMS was attempted)
  const details = Array.isArray(data?.recipientsDetailed) ? data.recipientsDetailed : [];
  const failing = details.filter(r => r && r.gateway_status !== "SUCCESS");
  const overall = data?.overallGatewayStatus || (failing.length ? "FAILURE" : "SUCCESS");

  if (overall !== "SUCCESS") {
    const reason = data?.gatewayFailureReason || (failing[0]?.gateway_status || "UNKNOWN");
    const msg = data?.gatewayFailureMessage
      || (reason === "INSUFFICIENT_CREDIT"
            ? "SMS gateway reports insufficient credit. No messages were delivered. Please top up your SMS balance and try again."
            : `SMS gateway returned non-success status: ${reason}.`);

    const err = new Error(msg);
    // Optionally expose structured info for UIs that need it (current Scan.jsx uses message only)
    err.code = "GATEWAY_FAILURE";
    err.gateway = {
      reason,
      statuses: failing.map(f => f.gateway_status),
      recipients: details
    };
    throw err;
  }

  return data;
}

/* ========================
 * Messages
 * ====================== */
export async function getMessages(limit = 50, offset = 0, includeStudent = true) {
  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  qs.set("offset", String(offset));
  if (includeStudent) qs.set("include", "student");
  return request(`/messages?${qs.toString()}`);
}

/* ========================
 * Templates
 * ====================== */

// List templates (e.g., CHECK_IN, CHECK_OUT). Returns array or {items:[...]} depending on backend.
export async function getTemplates() {
  return request("/templates");
}

// Update a template by key (e.g., "CHECK_IN"). Body { text } only.
export async function patchTemplate(key, text) {
  return request(`/templates/${encodeURIComponent(String(key))}`, {
    method: "PATCH",
    body: JSON.stringify({ text }),
  });
}

/* ========================
 * Students
 * ====================== */

// List students with optional search + status; returns array or { items: [...] }
export async function getStudents(limit = 200, offset = 0, search = "", status = "") {
  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  qs.set("offset", String(offset));
  if (search) qs.set("search", search);
  if (status) qs.set("status", status);
  return request(`/students?${qs.toString()}`);
}

// Create a student; body must include firstName and lastName (backend requirement)
export async function createStudent(payload) {
  return request(`/students`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// Update a student by ID
export async function updateStudent(id, payload) {
  return request(`/students/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

// Delete a student (server may also remove any guardians not linked elsewhere)
export async function deleteStudent(id) {
  return request(`/students/${encodeURIComponent(String(id))}`, { method: "DELETE" });
}

/* ========================
 * Guardians
 * ====================== */

// List guardians with optional filters; returns array or { items: [...] }.
// `search` matches name/email/phone; `relationship` is a string;
// `active` and `phoneValid` accept "yes" | "no" | "" (empty for any).
export async function getGuardians(
  limit = 200,
  offset = 0,
  search = "",
  relationship = "",
  active = "",
  phoneValid = ""
) {
  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  qs.set("offset", String(offset));
  if (search) qs.set("search", search);
  if (relationship) qs.set("relationship", relationship);
  if (active) qs.set("active", active);
  if (phoneValid) qs.set("phoneValid", phoneValid);
  return request(`/guardians?${qs.toString()}`);
}

// Inverse join: list guardians for a specific student
export async function getGuardiansByStudent(studentId) {
  const qs = new URLSearchParams();
  qs.set("studentId", String(studentId));
  return request(`/guardians?${qs.toString()}`);
}

/**
 * Students by guardian (single)
 * GET /guardians/:id/students
 * Returns array or { items: Student[] }
 */
export async function getStudentsByGuardian(guardianId) {
  return request(`/guardians/${encodeURIComponent(String(guardianId))}/students`);
}

/**
 * Students by guardians (bulk)
 * GET /guardians/students?ids=1,2,3
 * Returns { items: { [guardianId]: Student[] } }
 */
export async function getStudentsByGuardianBulk(guardianIds = []) {
  const ids = Array.from(new Set((guardianIds || []).map(id => String(id)).filter(Boolean)));
  if (!ids.length) return { items: {} };
  const qs = new URLSearchParams();
  qs.set("ids", ids.join(","));
  return request(`/guardians/students?${qs.toString()}`);
}

/**
 * NEW — Create a guardian
 * POST /guardians
 */
export async function createGuardian(payload) {
  return request(`/guardians`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * NEW — Link guardian to student
 * POST /students/:sid/guardians/:gid
 * Body: { isPrimary?: boolean }
 */
export async function linkGuardian(studentId, guardianId, isPrimary = false) {
  return request(`/students/${encodeURIComponent(String(studentId))}/guardians/${encodeURIComponent(String(guardianId))}`, {
    method: "POST",
    body: JSON.stringify({ isPrimary: !!isPrimary }),
  });
}

/**
 * NEW — Unlink guardian from student (keep guardian record)
 * DELETE /students/:sid/guardians/:gid
 */
export async function unlinkGuardian(studentId, guardianId) {
  return request(`/students/${encodeURIComponent(String(studentId))}/guardians/${encodeURIComponent(String(guardianId))}`, {
    method: "DELETE",
  });
}

/**
 * NEW — Update a guardian
 * PATCH /guardians/:id
 */
export async function patchGuardian(id, payload) {
  return request(`/guardians/${encodeURIComponent(String(id))}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/**
 * NEW — Delete a guardian (students are NOT deleted)
 * DELETE /guardians/:id
 */
export async function deleteGuardian(id) {
  return request(`/guardians/${encodeURIComponent(String(id))}`, {
    method: "DELETE",
  });
}

/* ========================
 * Bulk Import (CSV)
 * ====================== */

/**
 * NEW — Bulk import students + guardians via CSV
 * POST /import/csv  (multipart/form-data)
 * Returns JSON (e.g., { created, updated, errors: [...] })
 */
export async function importStudentsCsv(file) {
  const fd = new FormData();
  fd.set("file", file);
  const res = await fetch(`${API}/import/csv`, {
    method: "POST",
    headers: { ...authHeaders() }, // do NOT set Content-Type; browser will set boundary
    body: fd,
    credentials: "include",
    mode: "cors",
  });
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (res.status === 401) { clearToken(); throw new Error("Unauthorized"); }
  if (!res.ok) throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
  return data;
}

/* ========================
 * QR Code lifecycle
 * ====================== */

/**
 * NEW — Generate QR codes for students
 * POST /qr/generate { studentIds: number[] }
 * Returns JSON (e.g., { items: [{ studentId, token }] })
 */
export async function generateQRCodes(studentIds = []) {
  return request(`/qr/generate`, {
    method: "POST",
    body: JSON.stringify({ studentIds }),
  });
}

/**
 * NEW — Download a student's QR PNG
 * GET /qr/:studentId.png  (binary)
 */
export async function getQrPng(studentId) {
  const res = await fetch(`${API}/qr/${encodeURIComponent(String(studentId))}.png`, {
    headers: { ...authHeaders() },
    credentials: "include",
    mode: "cors",
  });
  if (res.status === 401) { clearToken(); throw new Error("Unauthorized"); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

/**
 * NEW — Cleanup temporary QR images after download
 * POST /qr/cleanup { studentIds: number[] }
 */
export async function cleanupQrImages(studentIds = []) {
  return request(`/qr/cleanup`, {
    method: "POST",
    body: JSON.stringify({ studentIds }),
  });
}

/* ========================
 * Users (Admin)
 * ====================== */

/**
 * List users
 * GET /users?limit=&offset=&q=&role=&active=
 * Returns array or { items: User[] }
 */
export async function getUsers(limit = 100, offset = 0, q = "", role = "", active = "") {
  const qs = new URLSearchParams();
  if (limit != null) qs.set("limit", String(limit));
  if (offset != null) qs.set("offset", String(offset));
  if (q) qs.set("q", q.trim());
  if (role) qs.set("role", String(role).toUpperCase());
  if (active !== "") {
    const v = typeof active === "string" ? active : (active ? "yes" : "no");
    qs.set("active", v);
  }
  const s = qs.toString();
  return request(`/users${s ? `?${s}` : ""}`);
}

/**
 * Create user
 * POST /users
 * Body: { email, password, role, active }
 * Returns created user (or { item })
 */
export async function createUser(payload) {
  return request(`/users`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Update user
 * PATCH /users/:id
 * Body: { email?, password?, role?, active? }
 * Returns updated user (or { item })
 */
export async function updateUser(id, payload) {
  return request(`/users/${encodeURIComponent(String(id))}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/**
 * Delete user
 * DELETE /users/:id
 */
export async function deleteUser(id) {
  return request(`/users/${encodeURIComponent(String(id))}`, {
    method: "DELETE",
  });
}

/* ========================
 * Settings
 * ====================== */

/**
 * Organisation settings (read)
 * GET /settings
 */
export async function getOrgSettings() {
  return request(`/settings`);
}

/**
 * Organisation settings (update)
 * PATCH /settings
 * Body: partial { centreName?, timezone?, smsPolicy?: { sendOnCheckIn?, sendOnCheckOut? } }
 */
export async function updateOrgSettings(partial) {
  return request(`/settings`, {
    method: "PATCH",
    body: JSON.stringify(partial || {}),
  });
}

/**
 * Send test SMS
 * POST /settings/test-sms  { to }
 */
export async function testSms({ to }) {
  return request(`/settings/test-sms`, {
    method: "POST",
    body: JSON.stringify({ to }),
  });
}

/**
 * Health check
 * GET /settings/health
 */
export async function getHealth() {
  return request(`/settings/health`);
}

/**
 * Archive & purge data older than policy window (12 months)
 * POST /settings/purge-old
 */
export async function purgeOldData() {
  return request(`/settings/purge-old`, { method: "POST" });
}