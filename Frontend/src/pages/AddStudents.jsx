// src/pages/AddStudents.jsx
import { useState, useRef, useEffect } from "react";
import { useLocation, Navigate } from "react-router-dom";
import { useForm, useFieldArray } from "react-hook-form";
import {
  createStudent,
  createGuardian,
  linkGuardian,
  importStudentsCsv,
  generateQRCodes,
  getQrPng,
  cleanupQrImages,
} from "../services/api";
import { getRole, addAuthStorageListener } from "../services/auth";

export default function AddStudents() {
  // RBAC: Admin only
  const [role, setRole] = useState(() => getRole());
  const isAdmin = role === "ADMIN";
  const loc = useLocation();
  useEffect(() => {
    const unsub = addAuthStorageListener(setRole);
    return unsub;
  }, []);
  if (!isAdmin) {
    // App-level guard & sidebar already hide this, but we redirect just in case.
    return <Navigate to="/dashboard" replace state={{ denied: loc.pathname }} />;
  }

  const [mode, setMode] = useState("single"); // "single" | "bulk"
  return (
    <>
      <header style={{ marginBottom: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Add Student(s)</h1>
        <p className="muted small">Create one student with guardians, or upload a CSV for bulk creation.</p>
      </header>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ display:"flex", gap:8, marginBottom: 12 }}>
          <button
            type="button"
            className="btn"
            aria-pressed={mode==="single"}
            onClick={() => setMode("single")}
          >
            Single student
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={mode==="bulk"}
            onClick={() => setMode("bulk")}
          >
            Bulk CSV
          </button>
        </div>

        {mode === "single" ? <SingleForm /> : <BulkCsv />}
      </div>
    </>
  );
}

function SingleForm() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null); // { student, guardians:[], links:[{guardianId,isPrimary}] }
  const [qrState, setQrState] = useState({ generating:false, tokens:null, zipping:false, downloading:false, cleaning:false });
  const [downloadUrl, setDownloadUrl] = useState(null); // object URL for downloaded PNG (single) or ZIP (future)

  const { register, handleSubmit, watch, control, reset } = useForm({
    defaultValues: {
      student: {
        externalId: "",
        firstName: "",
        lastName: "",
        dob: "",
        status: "ACTIVE",
        canLeaveAlone: false,
        notes: "",
      },
      // Guardians are OPTIONAL by default (allow zero-guardian create)
      guardians: [],
    },
  });

  const { fields, append, remove, update } = useFieldArray({ control, name: "guardians" });

  const onSubmit = async (data) => {
    setError("");
    setSaving(true);
    setCreated(null);
    setQrState({ generating:false, tokens:null, zipping:false, downloading:false, cleaning:false });
    setDownloadUrl(null);

    try {
      // 1) Create student
      const sPayload = {
        externalId: data.student.externalId || null,
        firstName: data.student.firstName.trim(),
        lastName:  data.student.lastName.trim(),
        status:    data.student.status || "ACTIVE",
        canLeaveAlone: !!data.student.canLeaveAlone,
        notes:     data.student.notes?.trim() || null,
        dob:       data.student.dob || null,
      };
      const student = await createStudent(sPayload);

      // 2) Create guardians + link (skips if none present or fields incomplete)
      const guardians = [];
      const links = [];
      for (const g of data.guardians) {
        if (!g.firstName.trim() || !g.lastName.trim() || !g.phone.trim()) continue;
        const gp = {
          firstName: g.firstName.trim(),
          lastName:  g.lastName.trim(),
          relationship: g.relationship || "GUARDIAN",
          email:     g.email?.trim() || null,
          phone:     g.phone.trim(), // server normalizes to E.164
        };
        const createdG = await createGuardian(gp);
        guardians.push(createdG);
        await linkGuardian(student.id, createdG.id, !!g.primary);
        links.push({ guardianId: createdG.id, isPrimary: !!g.primary });
      }

      setCreated({ student, guardians, links });
    } catch (e) {
      setError(e?.message || "Failed to add student");
    } finally {
      setSaving(false);
    }
  };

  async function handleGenerateQr() {
    if (!created?.student?.id) return;
    setError("");
    setQrState(s => ({ ...s, generating:true }));
    try {
      const res = await generateQRCodes([created.student.id]); // returns tokens per student
      setQrState(s => ({ ...s, generating:false, tokens: res?.items || [] }));
    } catch (e) {
      setQrState(s => ({ ...s, generating:false }));
      setError(e?.message || "Failed to generate QR");
    }
  }

  async function handleDownloadPng() {
    if (!created?.student?.id) return;
    setError("");
    setQrState(s => ({ ...s, downloading:true }));
    try {
      const blob = await getQrPng(created.student.id);
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      // trigger download
      const a = document.createElement("a");
      a.href = url;
      a.download = `qr_${created.student.id}.png`;
      a.click();
    } catch (e) {
      setError(e?.message || "Failed to download QR");
    } finally {
      setQrState(s => ({ ...s, downloading:false }));
    }
  }

  async function handleCleanup() {
    if (!created?.student?.id) return;
    setError("");
    setQrState(s => ({ ...s, cleaning:true }));
    try {
      await cleanupQrImages([created.student.id]);
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    } catch (e) {
      setError(e?.message || "Failed to clean up temporary QR files");
    } finally {
      setQrState(s => ({ ...s, cleaning:false }));
    }
  }

  const guardians = watch("guardians");
  const primaryIndex = guardians.findIndex(g => !!g.primary);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid" style={{ gap: 16 }}>
      {error && (
        <div className="small" style={{ background:"rgba(239,68,68,.12)", border:"1px solid rgba(239,68,68,.3)", borderRadius:10, padding:"8px 10px" }}>
          {error}
        </div>
      )}

      <section className="card" style={{ padding: 12 }}>
        <h2 className="h2">Student details</h2>
        <div className="grid" style={{ gap: 8 }}>
          <div className="grid" style={{ gap: 6 }}>
            <label className="muted small">External ID (optional)</label>
            <input className="input" {...register("student.externalId")} placeholder="e.g., S-1001" />
          </div>
          <div className="grid" style={{ gap: 6 }}>
            <label className="muted small">First name *</label>
            <input className="input" {...register("student.firstName", { required:true })} />
          </div>
          <div className="grid" style={{ gap: 6 }}>
            <label className="muted small">Last name *</label>
            <input className="input" {...register("student.lastName", { required:true })} />
          </div>
          <div className="grid" style={{ gap: 6 }}>
            <label className="muted small">Date of birth</label>
            <input type="date" className="input" {...register("student.dob")} />
          </div>
          <div className="grid" style={{ gap: 6 }}>
            <label className="muted small">Status</label>
            <select className="input" {...register("student.status")}>
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </div>
          <label style={{ display:"inline-flex", alignItems:"center", gap:8, marginTop: 6 }}>
            <input type="checkbox" {...register("student.canLeaveAlone")} />
            Can leave alone
          </label>
          <div className="grid" style={{ gap: 6 }}>
            <label className="muted small">Notes</label>
            <textarea className="input" {...register("student.notes")} placeholder="Optional notes…" />
          </div>
        </div>
      </section>

      <section className="card" style={{ padding: 12 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <h2 className="h2">Guardian(s)</h2>
          <button type="button" className="btn" onClick={() => append({ firstName:"", lastName:"", relationship:"GUARDIAN", email:"", phone:"", primary: fields.length === 0 })}>
            + Add guardian
          </button>
        </div>

        <p className="muted small" style={{ marginTop: 6 }}>Optional — you can add guardians now or link them later from the student record.</p>

        <div className="grid" style={{ gap: 12 }}>
          {fields.map((f, i) => (
            <div key={f.id} className="card" style={{ padding: 12 }}>
              <div className="grid" style={{ gap: 8 }}>
                <div className="grid" style={{ gap: 6 }}>
                  <label className="muted small">First name *</label>
                  <input className="input" {...register(`guardians.${i}.firstName`, { required:true })} />
                </div>
                <div className="grid" style={{ gap: 6 }}>
                  <label className="muted small">Last name *</label>
                  <input className="input" {...register(`guardians.${i}.lastName`, { required:true })} />
                </div>
                <div className="grid" style={{ gap: 6 }}>
                  <label className="muted small">Relationship</label>
                  <input className="input" {...register(`guardians.${i}.relationship`)} placeholder="GUARDIAN / MOTHER / FATHER / ..." />
                </div>
                <div className="grid" style={{ gap: 6 }}>
                  <label className="muted small">Email</label>
                  <input type="email" className="input" {...register(`guardians.${i}.email`)} placeholder="Optional" />
                </div>
                <div className="grid" style={{ gap: 6 }}>
                  <label className="muted small">Phone (E.164) *</label>
                  <input type="tel" className="input" {...register(`guardians.${i}.phone`, { required:true })} placeholder="+614…" />
                </div>

                <label style={{ display:"inline-flex", alignItems:"center", gap:8, marginTop: 4 }}>
                  <input
                    type="radio"
                    name="primary_guardian"
                    checked={i === primaryIndex}
                    onChange={() => {
                      // toggle 'primary' only on this one
                      guardians.forEach((g, idx) => update(idx, { ...g, primary: idx === i }));
                    }}
                  />
                  Primary guardian
                </label>

                <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop: 8 }}>
                  <button type="button" className="btn" onClick={() => remove(i)} disabled={false}>
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
        {/* Disable after successful submission */}
        <button type="submit" className="btn" disabled={saving || !!created?.student}>
          {saving ? "Saving…" : "Create"}
        </button>
      </div>

      {created?.student && (
        <section className="card" style={{ padding: 12 }}>
          <h2 className="h2">QR codes</h2>
          <p className="muted small">Generate secure QR for the new student, then download and clean up.</p>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <button type="button" className="btn" onClick={handleGenerateQr} disabled={qrState.generating}>
              {qrState.generating ? "Generating…" : "Generate QR"}
            </button>
            <button type="button" className="btn" onClick={handleDownloadPng} disabled={!created?.student?.id || qrState.downloading}>
              {qrState.downloading ? "Downloading…" : "Download PNG"}
            </button>
            <button type="button" className="btn" onClick={handleCleanup} disabled={!created?.student?.id || qrState.cleaning}>
              {qrState.cleaning ? "Cleaning…" : "Delete temporary files"}
            </button>
          </div>
        </section>
      )}
    </form>
  );
}

function BulkCsv() {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [createdIds, setCreatedIds] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [genDone, setGenDone] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  async function handleUpload() {
    if (!file) return;
    setBusy(true);
    setMsg("");
    setCreatedIds([]);
    setGenDone(false);
    try {
      const res = await importStudentsCsv(file);

      // IDs may come back as strings; coerce to numbers before filtering
      const ids = Array.isArray(res?.createdIds)
        ? res.createdIds
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n) && n > 0)
        : [];

      setCreatedIds(ids);

      const createdCount =
        typeof res?.created === "number" ? res.created : ids.length;

      setMsg(
        `Uploaded ${createdCount} students.${ids.length ? ` New IDs: ${ids.join(", ")}` : ""}`
      );
    } catch (e) {
      setMsg(e?.message || "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateAll() {
    if (!createdIds.length) return;
    setGenerating(true);
    try {
      await generateQRCodes(createdIds);
      setGenDone(true);
      setMsg((m) => `${m} • QR codes generated.`);
    } catch (e) {
      setMsg(e?.message || "QR generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownloadAll() {
    if (!createdIds.length) return;
    setDownloading(true);
    try {
      for (const id of createdIds) {
        try {
          const blob = await getQrPng(id);
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `qr_${id}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        } catch (_) {
          // continue with others
        }
      }
    } finally {
      setDownloading(false);
    }
  }

  async function handleCleanupAll() {
    if (!createdIds.length) return;
    setCleaning(true);
    try {
      await cleanupQrImages(createdIds);
      setMsg((m) => `${m} • Temporary QR files deleted.`);
    } catch (e) {
      setMsg(e?.message || "Cleanup failed.");
    } finally {
      setCleaning(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="grid" style={{ gap: 6 }}>
        <label className="muted small">Select CSV file</label>
        <input
          className="input"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </div>

      <section className="card" style={{ padding: 12 }}>
        <h3 className="h3">CSV format</h3>
        <div className="muted small" style={{ lineHeight: 1.5 }}>
          <strong>Student columns (required):</strong> <code>firstName</code>, <code>lastName</code><br />
          <strong>Student columns (optional):</strong> <code>externalId</code>, <code>dob</code>, <code>status</code>, <code>canLeaveAlone</code>, <code>notes</code><br />
          <strong>Guardian 1 (optional but recommended):</strong> <code>g1_firstName</code>, <code>g1_lastName</code>, <code>g1_phone</code>, <code>g1_email</code>, <code>g1_relationship</code>, <code>g1_primary</code><br />
          <strong>Guardian 2 (optional):</strong> <code>g2_firstName</code>, <code>g2_lastName</code>, <code>g2_phone</code>, <code>g2_email</code>, <code>g2_relationship</code>, <code>g2_primary</code>
        </div>

        <div className="muted small" style={{ marginTop: 8 }}>
          <strong>Rules & accepted values:</strong>
          <ul style={{ margin: "6px 0 0 18px" }}>
            <li><code>dob</code>: <em>YYYY-MM-DD</em> (e.g., <code>2015-03-07</code>).</li>
            <li><code>status</code>: <code>ACTIVE</code> or <code>INACTIVE</code> (defaults to <code>ACTIVE</code>).</li>
            <li><code>canLeaveAlone</code> / <code>g*_primary</code>: <code>true</code>/<code>false</code> (also accepts <code>yes/no</code>, <code>1/0</code>).</li>
            <li><code>g*_relationship</code>: text like <code>GUARDIAN</code>, <code>MOTHER</code>, <code>FATHER</code>, etc. (defaults to <code>GUARDIAN</code>).</li>
            <li><code>g*_phone</code>: use E.164, e.g. <code>+61412345678</code> (AU numbers preferred).</li>
          </ul>
        </div>

        <div className="muted small" style={{ marginTop: 8 }}>
          <strong>Header row (canonical):</strong>
          <pre style={{ margin: "6px 0 0", whiteSpace: "pre-wrap", overflowX: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, padding: 8, borderRadius: 8, background: "rgba(0,0,0,0.04)" }}>
externalId,firstName,lastName,dob,status,canLeaveAlone,notes,g1_firstName,g1_lastName,g1_phone,g1_email,g1_relationship,g1_primary,g2_firstName,g2_lastName,g2_phone,g2_email,g2_relationship,g2_primary
          </pre>
        </div>

        <div className="muted small" style={{ marginTop: 8 }}>
          <strong>Example row:</strong>
          <pre style={{ margin: "6px 0 0", whiteSpace: "pre-wrap", overflowX: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, padding: 8, borderRadius: 8, background: "rgba(0,0,0,0.04)" }}>
S-1001,Alex,Chen,2014-08-22,ACTIVE,true,"Peanut allergy",Jamie,Chen,+61411111111,jamie@example.com,MOTHER,true,Sam,Chen,+61422222222,sam@example.com,FATHER,false
          </pre>
        </div>

        <div className="muted small" style={{ marginTop: 8 }}>
          <strong>Accepted aliases (optional):</strong> you may also use <code>external_id</code>, <code>first_name</code>, <code>last_name</code> for student fields, and
          <code> g1_first_name</code>/<code>g2_first_name</code>, <code>g1_last_name</code>/<code>g2_last_name</code>.
        </div>
      </section>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {/* Disable after successful submission */}
        <button type="button" className="btn" onClick={handleUpload} disabled={!file || busy || createdIds.length > 0}>
          {busy ? "Uploading…" : "Upload"}
        </button>

        {/* These appear after a successful upload */}
        {createdIds.length > 0 && (
          <>
            <button
              type="button"
              className="btn"
              onClick={handleGenerateAll}
              disabled={generating}
            >
              {generating ? "Generating…" : genDone ? "Regenerate" : "Generate QR Codes"}
            </button>

            <button
              type="button"
              className="btn"
              onClick={handleDownloadAll}
              disabled={!genDone || downloading}
              title={genDone ? "" : "Generate QR codes first"}
            >
              {downloading ? "Downloading…" : "Download All"}
            </button>

            <button
              type="button"
              className="btn"
              onClick={handleCleanupAll}
              disabled={cleaning}
            >
              {cleaning ? "Cleaning…" : "Delete Temporary Files"}
            </button>
          </>
        )}
      </div>

      {msg && (
        <div
          className="small"
          style={{
            background: "rgba(37,99,235,.08)",
            border: "1px solid rgba(37,99,235,.30)",
            borderRadius: 10,
            padding: "8px 10px",
          }}
        >
          {msg}
        </div>
      )}
    </div>
  );
}