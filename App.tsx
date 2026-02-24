/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { GoogleGenAI } from "@google/genai";

// ============================================================
// POLYFILLS & UTILS
// ============================================================
if (typeof window !== 'undefined' && !(window as any).storage) {
  (window as any).storage = {
    get: async (key: string) => ({ value: localStorage.getItem(key) }),
    set: async (key: string, value: string) => localStorage.setItem(key, value),
  };
}

// Polyfill for process.env in browser
if (typeof window !== 'undefined' && !window.process) {
  (window as any).process = { env: {} };
}

const DB_KEY = "medicompanion_v5";

const today = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const genId = (p = "id") => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const initials = (name: string) => (name || "??").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
const formatDate = (iso: string) => { if (!iso) return ""; const d = new Date(iso); return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); };

const SEED_MEDICINES = [
  { id: "m1", patientId: "p1", name: "Metformin", dosage: "500mg", timings: ["08:00", "20:00"], notes: "Take with food", pillsRemaining: 28, pillsTotal: 60, color: "#10b981", interactions: ["Alcohol"], category: "Diabetes", prescribedBy: "Dr. Robert Kim" },
  { id: "m2", patientId: "p1", name: "Lisinopril", dosage: "10mg", timings: ["09:00"], notes: "Monitor BP", pillsRemaining: 15, pillsTotal: 30, color: "#3b82f6", interactions: ["NSAIDs"], category: "Blood Pressure", prescribedBy: "Dr. Robert Kim" },
];

function generateSeedDoseLog() {
  const log: any[] = [];
  const now = new Date();
  for (let d = 13; d >= 0; d--) {
    const date = new Date(now); date.setDate(date.getDate() - d);
    const dateStr = date.toISOString().split("T")[0];
    SEED_MEDICINES.forEach((med) => {
      med.timings.forEach((time) => {
        const rand = Math.random();
        log.push({ id: `log-${dateStr}-${med.id}-${time}`, medicineId: med.id, medicineName: med.name, patientId: med.patientId, scheduledTime: `${dateStr}T${time}:00`, status: rand > 0.15 ? "taken" : rand > 0.07 ? "missed" : "pending", takenAt: rand > 0.15 ? `${dateStr}T${time}:03:00` : null });
      });
    });
  }
  return log;
}

const buildSeedUsers = () => ([
  { id: "p1", role: "patient", name: "Margaret Chen", age: 72, email: "margaret@demo.com", password: "demo123", avatar: "MC", medicalHistory: "Type 2 Diabetes, Hypertension, Mild Arthritis", allergies: "Penicillin, Sulfa drugs", emergencyContacts: [{ name: "Dr. Robert Kim", role: "Primary Physician", phone: "+1-555-0101", type: "doctor" }, { name: "Ambulance / Emergency", role: "Emergency Services", phone: "112", type: "ambulance" }], linkedDoctors: ["d1"], linkedFamily: ["f1"], points: 340, badges: ["7-Day Streak", "Perfect Week"], streak: 12 },
  { id: "f1", role: "family", name: "David Chen", age: 45, email: "david@demo.com", password: "demo123", avatar: "DC", relationship: "Son", medicalHistory: "", allergies: "", emergencyContacts: [], linkedPatients: ["p1"], points: 0, badges: [], streak: 0 },
  { id: "d1", role: "doctor", name: "Dr. Robert Kim", age: 52, email: "dr.kim@demo.com", password: "demo123", avatar: "RK", specialization: "General Physician", licenseNo: "MD-12345", hospital: "City Medical Center", phone: "+1-555-0101", emergencyContacts: [], linkedPatients: ["p1"], points: 0, badges: [], streak: 0 },
]);

const defaultDB = () => ({
  users: buildSeedUsers(),
  medicines: [...SEED_MEDICINES],
  doseLogs: generateSeedDoseLog(),
  links: [{ patientId: "p1", familyId: "f1" }, { patientId: "p1", doctorId: "d1" }],
  contactRequests: [
    { id: "cr1", from: "p1", to: "d1", type: "contact", message: "Need consultation", timestamp: new Date(Date.now() - 3600000).toISOString(), read: false },
    { id: "cr2", from: "f1", to: "d1", type: "contact", message: "Margaret missed doses", timestamp: new Date(Date.now() - 7200000).toISOString(), read: false },
  ],
  medicalHistory: [
    { id: "mh1", patientId: "p1", date: "2024-11-10", title: "Diabetes Follow-up", description: "HbA1c: 7.2%. Metformin dose maintained. Diet counseling given.", doctor: "Dr. Robert Kim", type: "consultation" },
    { id: "mh2", patientId: "p1", date: "2024-09-05", title: "Blood Pressure Review", description: "BP: 138/88 mmHg. Lisinopril 10mg continued. Advised low-sodium diet.", doctor: "Dr. Robert Kim", type: "consultation" },
    { id: "mh3", patientId: "p1", date: "2024-07-20", title: "Arthritis Assessment", description: "Mild arthritis in knee joints. Physiotherapy recommended. Pain manageable.", doctor: "Dr. Robert Kim", type: "assessment" },
  ],
});

const LANGS = [
  { code: "en-US", label: "English" },
  { code: "hi-IN", label: "हिन्दी (Hindi)" },
  { code: "ta-IN", label: "தமிழ் (Tamil)" },
  { code: "te-IN", label: "తెలుగు (Telugu)" },
  { code: "kn-IN", label: "ಕನ್ನಡ (Kannada)" },
  { code: "ml-IN", label: "മലയാളം (Malayalam)" },
  { code: "mr-IN", label: "मराठी (Marathi)" },
  { code: "gu-IN", label: "ગુજરાતી (Gujarati)" },
  { code: "bn-IN", label: "বাংলা (Bengali)" },
  { code: "pa-IN", label: "ਪੰਜਾਬੀ (Punjabi)" },
  { code: "or-IN", label: "ଓଡ଼ିଆ (Odia)" },
  { code: "as-IN", label: "অসমীয়া (Assamese)" },
  { code: "ur-IN", label: "اردو (Urdu)" },
  { code: "es-ES", label: "Español" },
  { code: "fr-FR", label: "Français" },
  { code: "zh-CN", label: "中文" },
  { code: "ar-SA", label: "العربية" },
];

const TRANSLATIONS: any = {
  "en-US": {
    dashboard: "Dashboard",
    medicines: "Medicines",
    analytics: "Analytics",
    sos: "SOS",
    history: "History",
    chat: "AI Chat",
    settings: "Settings",
    greeting: "Good morning",
    greeting_afternoon: "Good afternoon",
    greeting_evening: "Good evening",
    today_schedule: "Today's Schedule",
    quick_emergency: "Quick Emergency",
    calling: "Calling",
    sos_alert: "SOS ALERT SENT",
    sos_msg: "Emergency services and family notified.",
    adherence: "Adherence",
    points: "Points",
    streak: "Day Streak",
    low_supply: "Low Supply",
    no_meds: "No medicines scheduled",
    add_meds_sub: "Add prescriptions in the Medicines tab.",
    take_now: "Take Now",
    taken: "Taken",
    missed: "Missed",
    emergency_contacts: "Emergency Contacts",
    activate_sos: "ACTIVATE SOS",
    sos_description: "Clicking the button below will alert all your emergency contacts and share your current location.",
    health_analytics: "Health Analytics",
    weekly_adherence: "Weekly Adherence",
    achievements: "Achievements",
    medical_history: "Medical History",
    past_consultations: "Past consultations, reports and assessments",
    accessibility: "Accessibility",
    high_contrast: "High Contrast Mode",
    large_text: "Large Text",
    voice_guidance: "Voice Guidance (TTS)",
    app_language: "App Language",
    profile_info: "Profile Information",
    edit_profile: "Edit Profile",
    add_medicine: "Add Medicine",
    active_prescriptions: "Active prescriptions and schedules",
    pills_left: "pills left",
    prescribed_by: "Prescribed by",
    avoid: "Avoid",
  },
  "hi-IN": {
    dashboard: "डैशबोर्ड",
    medicines: "दवाइयाँ",
    analytics: "एनालिटिक्स",
    sos: "एसओएस",
    history: "इतिहास",
    chat: "एआई चैट",
    settings: "सेटिंग्स",
    greeting: "शुभ प्रभात",
    greeting_afternoon: "शुभ दोपहर",
    greeting_evening: "शुभ संध्या",
    today_schedule: "आज का शेड्यूल",
    quick_emergency: "त्वरित आपातकाल",
    calling: "कॉल कर रहे हैं",
    sos_alert: "एसओएस अलर्ट भेजा गया",
    sos_msg: "आपातकालीन सेवाओं और परिवार को सूचित कर दिया गया है।",
    adherence: "अनुपालन",
    points: "अंक",
    streak: "दिनों का सिलसिला",
    low_supply: "कम आपूर्ति",
    no_meds: "कोई दवा निर्धारित नहीं है",
    add_meds_sub: "दवाइयाँ टैब में नुस्खे जोड़ें।",
    take_now: "अभी लें",
    taken: "लिया गया",
    missed: "छूट गया",
    emergency_contacts: "आपातकालीन संपर्क",
    activate_sos: "एसओएस सक्रिय करें",
    sos_description: "नीचे दिए गए बटन पर क्लिक करने से आपके सभी आपातकालीन संपर्कों को अलर्ट मिल जाएगा और आपकी वर्तमान स्थिति साझा की जाएगी।",
    health_analytics: "स्वास्थ्य विश्लेषण",
    weekly_adherence: "साप्ताहिक अनुपालन",
    achievements: "उपलब्धियां",
    medical_history: "चिकित्सा इतिहास",
    past_consultations: "पिछली नियुक्तियां और रिपोर्ट",
    accessibility: "पहुंच",
    high_contrast: "उच्च कंट्रास्ट मोड",
    large_text: "बड़े अक्षर",
    voice_guidance: "आवाज मार्गदर्शन (TTS)",
    app_language: "ऐप की भाषा",
    profile_info: "प्रोफ़ाइल जानकारी",
    edit_profile: "प्रोफ़ाइल संपादित करें",
    add_medicine: "दवा जोड़ें",
    active_prescriptions: "सक्रिय नुस्खे और शेड्यूल",
    pills_left: "गोलियां बची हैं",
    prescribed_by: "द्वारा निर्धारित",
    avoid: "परहेज करें",
  }
};

const speak = (text: string, lang = "en-US") => {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang; u.rate = 0.88;
  window.speechSynthesis.speak(u);
};

// ============================================================
// SHARED COMPONENTS
// ============================================================
const Toast = ({ toasts, remove }: { toasts: any[], remove: (id: number) => void }) => (
  <div className="toast-wrap">
    {toasts.map(t => (
      <div key={t.id} className="toast" onClick={() => remove(t.id)}>
        <div className="toast-icon">{t.icon || "💊"}</div>
        <div><div className="toast-title">{t.title}</div>{t.msg && <div className="toast-msg">{t.msg}</div>}</div>
      </div>
    ))}
  </div>
);

const ProgressRing = ({ pct, size = 80, stroke = 7 }: { pct: number, size?: number, stroke?: number }) => {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  const color = pct >= 80 ? "var(--green)" : pct >= 50 ? "var(--amber)" : "var(--red)";
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle className="progress-ring-bg" cx={size/2} cy={size/2} r={r} strokeWidth={stroke} style={{ transform: "rotate(-90deg)", transformOrigin: "center" }} />
      <circle className="progress-ring-fill" cx={size/2} cy={size/2} r={r} strokeWidth={stroke} strokeDasharray={circ} strokeDashoffset={offset} style={{ transform: "rotate(-90deg)", transformOrigin: "center", stroke: color }} />
      <text x="50%" y="50%" textAnchor="middle" dy="0.35em" style={{ fill: "var(--text)", fontFamily: "var(--font-display)", fontWeight: 800, fontSize: size / 4 }}>{pct}%</text>
    </svg>
  );
};

// ============================================================
// MODALS
// ============================================================
const AddMedModal = ({ onClose, onAdd, patientId, patients, isDoctor }: any) => {
  const [form, setForm] = useState({ name: "", dosage: "", timings: ["08:00"], notes: "", pillsTotal: 30, color: "#3b82f6", category: "", interactions: "", targetPatientId: patientId });
  const set = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));
  const submit = () => {
    if (!form.name || !form.dosage) return;
    onAdd({ ...form, id: genId("m"), patientId: form.targetPatientId, pillsRemaining: parseInt(form.pillsTotal as any) || 30, pillsTotal: parseInt(form.pillsTotal as any) || 30, interactions: form.interactions.split(",").map(s => s.trim()).filter(Boolean) });
    onClose();
  };
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header"><div className="modal-title">💊 Add Medicine</div><button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {(isDoctor || patients?.length > 1) && patients && (
            <div className="form-group"><label className="form-label">Add to Patient</label>
              <select className="form-input" value={form.targetPatientId} onChange={e => set("targetPatientId", e.target.value)}>
                {patients.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          <div className="form-row">
            <div className="form-group"><label className="form-label">Medicine Name *</label><input className="form-input" value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Metformin" /></div>
            <div className="form-group"><label className="form-label">Dosage *</label><input className="form-input" value={form.dosage} onChange={e => set("dosage", e.target.value)} placeholder="e.g. 500mg" /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Category</label><input className="form-input" value={form.category} onChange={e => set("category", e.target.value)} placeholder="e.g. Diabetes" /></div>
            <div className="form-group"><label className="form-label">Total Pills</label><input className="form-input" type="number" min="1" value={form.pillsTotal} onChange={e => set("pillsTotal", e.target.value)} /></div>
          </div>
          <div className="form-group"><label className="form-label">Known Interactions</label><input className="form-input" value={form.interactions} onChange={e => set("interactions", e.target.value)} placeholder="e.g. Alcohol, NSAIDs (comma-separated)" /></div>
          <div className="form-group">
            <label className="form-label">Color Label</label>
            <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
              {["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#06b6d4","#84cc16"].map(c => (
                <div key={c} onClick={() => set("color", c)} style={{ width: 30, height: 30, borderRadius: "50%", background: c, cursor: "pointer", border: form.color === c ? "3px solid var(--text)" : "3px solid transparent", boxShadow: form.color === c ? "0 0 0 2px var(--surface), 0 0 0 4px " + c : "none" }} />
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Reminder Times</label>
            {form.timings.map((tm, i) => (
              <div key={i} style={{ display: "flex", gap: 7, marginBottom: 7 }}>
                <input className="form-input" type="time" value={tm} onChange={e => set("timings", form.timings.map((x, j) => j === i ? e.target.value : x))} style={{ flex: 1 }} />
                {form.timings.length > 1 && <button className="btn btn-secondary btn-sm" onClick={() => set("timings", form.timings.filter((_, j) => j !== i))}>✕</button>}
              </div>
            ))}
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 4 }} onClick={() => set("timings", [...form.timings, "12:00"])}>+ Add Time</button>
          </div>
          <div className="form-group"><label className="form-label">Instructions / Notes</label><textarea className="form-input" rows={2} value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="e.g. Take with food" style={{ resize: "vertical" }} /></div>
          <button className="btn btn-primary btn-block btn-lg" style={{ marginTop: 4 }} onClick={submit}>💊 Save Medicine</button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// PAGES
// ============================================================
const PatientDashboard = ({ user, medicines, doseLog, onTake, tts, lang, addToast }: any) => {
  const t = TRANSLATIONS[lang] || TRANSLATIONS["en-US"];
  const todayStr = today();
  const todayDoses: any[] = [];
  medicines.forEach((med: any) => {
    med.timings.forEach((time: string) => {
      const log = doseLog.find((l: any) => l.medicineId === med.id && l.scheduledTime === `${todayStr}T${time}:00`);
      todayDoses.push({ med, time, status: log?.status || "pending" });
    });
  });
  todayDoses.sort((a, b) => a.time.localeCompare(b.time));
  const taken = todayDoses.filter(d => d.status === "taken").length;
  const total = todayDoses.length;
  const pct = total ? Math.round((taken / total) * 100) : 0;
  const lowPills = medicines.filter((m: any) => m.pillsRemaining <= 7);
  const missedToday = todayDoses.filter(d => d.status === "missed").length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t.greeting : hour < 18 ? t.greeting_afternoon : t.greeting_evening;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">{greeting}, {user.name.split(" ")[0]} 👋</div>
          <div className="page-sub">{new Date().toLocaleDateString(lang, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
        </div>
        {user.streak > 0 && (
          <div className="streak-badge"><span style={{ fontSize: 24 }}>🔥</span><div><div style={{ fontWeight: 800, fontSize: 18, color: "var(--amber)", fontFamily: "var(--font-display)" }}>{user.streak}</div><div style={{ fontSize: 11, color: "var(--text3)" }}>{t.streak}</div></div></div>
        )}
      </div>

      <div className="alert-banner alert-info" style={{ marginBottom: 20 }}>
        <span style={{ fontSize: 22 }}>💊</span>
        <div>
          <div style={{ fontWeight: 700, color: "var(--blue)", fontSize: 14 }}>
            {total === 0 ? t.no_meds : `You have ${total} medication${total > 1 ? "s" : ""} scheduled for today.`}
          </div>
          <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 2 }}>
            {taken}/{total} {t.taken.toLowerCase()}{missedToday > 0 ? ` · ⚠️ ${missedToday} ${t.missed.toLowerCase()}` : taken === total && total > 0 ? " · ✅ All done!" : ""}
          </div>
        </div>
      </div>

      {lowPills.length > 0 && (
        <div className="alert-banner alert-warn" style={{ marginBottom: 20 }}>
          <span style={{ fontSize: 20 }}>⚠️</span>
          <div><div style={{ fontWeight: 700, color: "var(--amber)", fontSize: 14 }}>{t.low_supply}</div><div style={{ fontSize: 13, color: "var(--text2)", marginTop: 2 }}>{lowPills.map((m: any) => `${m.name} (${m.pillsRemaining} left)`).join(", ")}</div></div>
        </div>
      )}

      <div className="grid-4" style={{ marginBottom: 22 }}>
        <div className="stat-card stat-accent" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <ProgressRing pct={pct} size={58} stroke={6} />
          <div><div className="stat-label">Today</div><div style={{ fontWeight: 700, fontSize: 17, marginTop: 4 }}>{taken}/{total}</div><div className="stat-sub">doses done</div></div>
        </div>
        <div className="stat-card stat-green"><div className="stat-label">{t.adherence}</div><div className="stat-value" style={{ color: "var(--green)" }}>{pct}%</div><div className="stat-sub">this week</div></div>
        <div className="stat-card stat-amber"><div className="stat-label">{t.points}</div><div className="stat-value" style={{ color: "var(--amber)" }}>{user.points || 0}</div><div className="stat-sub">⭐ {user.badges?.length || 0} badges</div></div>
        <div className="stat-card stat-blue"><div className="stat-label">{t.medicines}</div><div className="stat-value" style={{ color: "var(--blue)" }}>{medicines.length}</div><div className="stat-sub">{missedToday > 0 ? `⚠️ ${missedToday} missed` : "All on track"}</div></div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header" style={{ paddingBottom: 14 }}>
            <div className="card-title">📅 {t.today_schedule}</div>
            {tts && <button style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 7, padding: "5px 11px", fontSize: 12, cursor: "pointer", fontFamily: "var(--font)", fontWeight: 600 }} onClick={() => speak(`You have ${total} doses today. ${taken} taken.`, lang)}>🔊</button>}
          </div>
          <div className="card-body" style={{ paddingTop: 0 }}>
            {todayDoses.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon">💊</div><div className="empty-state-title">{t.no_meds}</div><div className="empty-state-sub">{t.add_meds_sub}</div></div>
            ) : todayDoses.map((d, i) => (
              <div key={i} className={`dose-item ${d.status}`}>
                <div className="dose-dot" style={{ background: d.med.color || "var(--accent)" }} />
                <div className="dose-info">
                  <div className="dose-name">{d.med.name}</div>
                  <div className="dose-detail">{d.med.dosage}{d.med.notes ? ` · ${d.med.notes.slice(0, 30)}` : ""}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 5 }}>⏰ {d.time}</div>
                  {d.status === "taken" ? <span className="dose-badge badge-taken">✓ {t.taken}</span>
                    : d.status === "missed" ? <span className="dose-badge badge-missed">✗ {t.missed}</span>
                    : <button className="btn btn-green btn-sm" onClick={() => { onTake(d.med.id, d.time); if (tts) speak(`${d.med.name} marked as taken!`, lang); }}>{t.take_now}</button>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {(user.emergencyContacts?.length || 0) > 0 && (
            <div className="card">
              <div className="card-header" style={{ paddingBottom: 0 }}><div className="card-title">🚨 {t.quick_emergency}</div></div>
              <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {user.emergencyContacts.map((c: any, i: number) => (
                  <button key={i} className={`emerg-btn ${c.type === "doctor" ? "emerg-doctor" : "emerg-ambulance"}`} onClick={() => { addToast({ icon: "📞", title: `${t.calling} ${c.name}`, msg: c.phone }); window.location.href = `tel:${c.phone}`; }}>
                    <span style={{ fontSize: 26 }}>{c.type === "doctor" ? "👨⚕️" : "🚑"}</span>
                    <div style={{ textAlign: "left" }}>
                      <div className="emerg-label" style={{ fontSize: 14 }}>{c.name}</div>
                      <div className="emerg-sub">{c.phone}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const FamilyDashboard = ({ user, patients, medicines, doseLog, addToast }: any) => {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Family Dashboard</div>
          <div className="page-sub">Monitoring {patients.length} family member(s)</div>
        </div>
      </div>
      <div className="grid-2">
        {patients.map((p: any) => {
          const pMeds = medicines.filter((m: any) => m.patientId === p.id);
          const todayStr = today();
          const pDoses = [];
          pMeds.forEach((m: any) => m.timings.forEach((t: any) => pDoses.push({ m, t })));
          const taken = doseLog.filter((l: any) => l.patientId === p.id && l.scheduledTime.startsWith(todayStr) && l.status === "taken").length;
          const total = pDoses.length;
          const pct = total ? Math.round((taken / total) * 100) : 0;
          return (
            <div key={p.id} className="card">
              <div className="card-header">
                <div className="card-title">{p.name}</div>
                <div className="nav-avatar" style={{ background: "var(--accent)", width: 32, height: 32 }}>{p.avatar}</div>
              </div>
              <div className="card-body">
                <div style={{ display: "flex", alignItems: "center", gap: 15, marginBottom: 15 }}>
                  <ProgressRing pct={pct} size={60} />
                  <div>
                    <div className="stat-label">Today's Adherence</div>
                    <div style={{ fontSize: 13, color: "var(--text2)" }}>{taken} of {total} doses taken</div>
                  </div>
                </div>
                <div className="alert-banner alert-info" style={{ padding: "8px 12px", fontSize: 12 }}>
                  <span>📋</span> {pMeds.length} Active Medications
                </div>
                <button className="btn btn-secondary btn-sm btn-block" style={{ marginTop: 10 }}>View Detailed Report</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const DoctorDashboard = ({ user, patients, medicines, doseLog, contactRequests, addToast }: any) => {
  const unread = contactRequests.filter((r: any) => r.to === user.id && !r.read).length;
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Doctor's Portal</div>
          <div className="page-sub">{user.hospital} · {user.specialization}</div>
        </div>
        {unread > 0 && <div className="streak-badge"><span style={{ fontSize: 20 }}>✉️</span><div><div style={{ fontWeight: 800, color: "var(--accent)" }}>{unread}</div><div style={{ fontSize: 11 }}>New Requests</div></div></div>}
      </div>
      <div className="grid-3" style={{ marginBottom: 22 }}>
        <div className="stat-card stat-blue"><div className="stat-label">Total Patients</div><div className="stat-value">{patients.length}</div><div className="stat-sub">Active monitoring</div></div>
        <div className="stat-card stat-red"><div className="stat-label">Critical Alerts</div><div className="stat-value">2</div><div className="stat-sub">Requires attention</div></div>
        <div className="stat-card stat-green"><div className="stat-label">Avg. Adherence</div><div className="stat-value">88%</div><div className="stat-sub">Across all patients</div></div>
      </div>
      <div className="card">
        <div className="card-header"><div className="card-title">My Patients</div></div>
        <div className="card-body">
          {patients.map((p: any) => (
            <div key={p.id} className="patient-row">
              <div className="nav-avatar" style={{ background: "var(--blue)", width: 40, height: 40 }}>{p.avatar}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: "var(--text3)" }}>{p.age} years · {p.medicalHistory.split(",")[0]}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--green)" }}>92% Adherence</div>
                <button className="btn btn-secondary btn-sm" style={{ marginTop: 4 }}>Manage Meds</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const MedicinesPage = ({ user, medicines, onAddMed, onDeleteMed, isDoctor, patients, lang }: any) => {
  const t = TRANSLATIONS[lang] || TRANSLATIONS["en-US"];
  const [showAdd, setShowAdd] = useState(false);
  return (
    <div className="page">
      <div className="page-header">
        <div><div className="page-title">💊 {t.medicines}</div><div className="page-sub">{t.active_prescriptions}</div></div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ {t.add_medicine}</button>
      </div>
      <div className="grid-3">
        {medicines.map((m: any) => (
          <div key={m.id} className="med-card" style={{ "--med-color": m.color } as any}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div className="med-name">{m.name}</div>
                <div className="med-dosage">{m.dosage} · {m.category}</div>
              </div>
              <button className="modal-close" style={{ padding: "2px 6px" }} onClick={() => onDeleteMed(m.id)}>✕</button>
            </div>
            <div className="med-pill-bar"><div className="med-pill-fill" style={{ width: `${(m.pillsRemaining / m.pillsTotal) * 100}%`, background: m.color }} /></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text3)", fontWeight: 600 }}>
              <span>{m.pillsRemaining} {t.pills_left}</span>
              <span>{Math.round((m.pillsRemaining / m.pillsTotal) * 100)}%</span>
            </div>
            <div className="med-timings">
              {m.timings.map((t: string, i: number) => <span key={i} className="med-time-tag">{t}</span>)}
            </div>
            {m.interactions?.length > 0 && (
              <div className="interaction-warn"><span>⚠️</span> {t.avoid}: {m.interactions.join(", ")}</div>
            )}
            <div style={{ marginTop: 12, fontSize: 11, color: "var(--text3)" }}>{t.prescribed_by}: <span style={{ fontWeight: 600, color: "var(--text2)" }}>{m.prescribedBy}</span></div>
          </div>
        ))}
      </div>
      {showAdd && <AddMedModal onClose={() => setShowAdd(false)} onAdd={onAddMed} patientId={user.id} patients={patients} isDoctor={isDoctor} />}
    </div>
  );
};

const AnalyticsPage = ({ user, doseLog, medicines, lang }: any) => {
  const t = TRANSLATIONS[lang] || TRANSLATIONS["en-US"];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const last7Days = [...Array(7)].map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const dateStr = d.toISOString().split("T")[0];
    const dayName = days[d.getDay()];
    const dayLogs = doseLog.filter((l: any) => l.patientId === user.id && l.scheduledTime.startsWith(dateStr));
    const taken = dayLogs.filter((l: any) => l.status === "taken").length;
    const total = dayLogs.length;
    const pct = total ? Math.round((taken / total) * 100) : 0;
    return { dayName, pct };
  });

  return (
    <div className="page">
      <div className="page-header"><div><div className="page-title">📊 {t.health_analytics}</div><div className="page-sub">Adherence trends and medication insights</div></div></div>
      <div className="grid-2" style={{ marginBottom: 22 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">{t.weekly_adherence}</div></div>
          <div className="card-body">
            <div className="chart-bar-wrap">
              {last7Days.map((d, i) => (
                <div key={i} className="chart-bar-col">
                  <div className="chart-bar" style={{ height: `${d.pct}%`, background: d.pct >= 80 ? "var(--green)" : d.pct >= 50 ? "var(--amber)" : "var(--red)" }} />
                  <div className="chart-label">{d.dayName}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">{t.achievements}</div></div>
          <div className="card-body grid-2" style={{ gap: 10 }}>
            <div className="badge-award"><span style={{ fontSize: 32 }}>🏆</span><div style={{ fontWeight: 700, fontSize: 13 }}>7-Day Streak</div><div style={{ fontSize: 10, color: "var(--text3)" }}>Perfect adherence</div></div>
            <div className="badge-award"><span style={{ fontSize: 32 }}>⭐</span><div style={{ fontWeight: 700, fontSize: 13 }}>Early Bird</div><div style={{ fontSize: 10, color: "var(--text3)" }}>Morning doses on time</div></div>
          </div>
        </div>
      </div>
    </div>
  );
};

const SOSPage = ({ user, addToast, lang }: any) => {
  const t = TRANSLATIONS[lang] || TRANSLATIONS["en-US"];
  return (
    <div className="page">
      <div className="page-header"><div><div className="page-title">🚨 {t.sos}</div><div className="page-sub">{t.sos_description.split(".")[0]}</div></div></div>
      <div className="grid-2">
        <div className="card" style={{ borderColor: "var(--red)", background: "var(--red-soft)" }}>
          <div className="card-header"><div className="card-title" style={{ color: "var(--red)" }}>{t.activate_sos}</div></div>
          <div className="card-body">
            <p style={{ fontSize: 14, marginBottom: 15 }}>{t.sos_description}</p>
            <button className="btn btn-red btn-lg btn-block" style={{ height: 80, fontSize: 20, fontWeight: 900 }} onClick={() => addToast({ icon: "🚨", title: t.sos_alert, msg: t.sos_msg })}>ACTIVATE SOS</button>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">{t.emergency_contacts}</div></div>
          <div className="card-body">
            {user.emergencyContacts?.map((c: any, i: number) => (
              <div key={i} className="doctor-card">
                <span style={{ fontSize: 24 }}>{c.type === "doctor" ? "👨⚕️" : "🚑"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text3)" }}>{c.role}</div>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => { addToast({ icon: "📞", title: `${t.calling} ${c.name}`, msg: c.phone }); window.location.href = `tel:${c.phone}`; }}>Call</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const HistoryPage = ({ user, medicalHistory, lang }: any) => {
  const t = TRANSLATIONS[lang] || TRANSLATIONS["en-US"];
  return (
    <div className="page">
      <div className="page-header"><div><div className="page-title">📜 {t.medical_history}</div><div className="page-sub">{t.past_consultations}</div></div></div>
      <div className="card">
        <div className="card-body">
          {medicalHistory.filter((h: any) => h.patientId === user.id).sort((a: any, b: any) => b.date.localeCompare(a.date)).map((h: any) => (
            <div key={h.id} className="hist-item">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{h.title}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)" }}>{formatDate(h.date)}</div>
              </div>
              <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 10 }}>{h.description}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 12, color: "var(--text3)" }}>Doctor: <span style={{ fontWeight: 600, color: "var(--text2)" }}>{h.doctor}</span></div>
                <span className="hist-type" style={{ background: h.type === "consultation" ? "var(--blue-soft)" : "var(--purple-soft)", color: h.type === "consultation" ? "var(--blue)" : "var(--purple)" }}>{h.type}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const SettingsPage = ({ user, onUpdateUser, addToast, lang, setLang, tts, setTts }: any) => {
  const t = TRANSLATIONS[lang] || TRANSLATIONS["en-US"];
  const [hc, setHc] = useState(document.body.classList.contains("hc"));
  const [largeText, setLargeText] = useState(document.body.classList.contains("large-text"));

  const toggleHC = () => { document.body.classList.toggle("hc"); setHc(!hc); };
  const toggleLarge = () => { document.body.classList.toggle("large-text"); setLargeText(!largeText); };
  const toggleTTS = () => { const newVal = !tts; setTts(newVal); localStorage.setItem("med_tts", String(newVal)); addToast({ icon: "🔊", title: "Voice Updated", msg: `Voice guidance ${newVal ? "enabled" : "disabled"}` }); };
  const changeLang = (l: string) => { setLang(l); localStorage.setItem("med_lang", l); addToast({ icon: "🌐", title: "Language Updated", msg: `App language set to ${LANGS.find(x => x.code === l)?.label}` }); };

  return (
    <div className="page">
      <div className="page-header"><div><div className="page-title">⚙️ {t.settings}</div><div className="page-sub">Personalize your experience and accessibility</div></div></div>
      <div className="grid-2">
        <div className="card">
          <div className="card-header"><div className="card-title">{t.accessibility}</div></div>
          <div className="card-body">
            <div className="info-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div><div style={{ fontWeight: 700 }}>{t.high_contrast}</div><div style={{ fontSize: 12, color: "var(--text3)" }}>Better visibility for visual impairment</div></div>
              <div className={`toggle-switch ${hc ? "on" : ""}`} onClick={toggleHC}><div className="toggle-knob" /></div>
            </div>
            <div className="info-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div><div style={{ fontWeight: 700 }}>{t.large_text}</div><div style={{ fontSize: 12, color: "var(--text3)" }}>Increase font size across the app</div></div>
              <div className={`toggle-switch ${largeText ? "on" : ""}`} onClick={toggleLarge}><div className="toggle-knob" /></div>
            </div>
            <div className="info-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div><div style={{ fontWeight: 700 }}>{t.voice_guidance}</div><div style={{ fontSize: 12, color: "var(--text3)" }}>Enable spoken reminders and schedule</div></div>
              <div className={`toggle-switch ${tts ? "on" : ""}`} onClick={toggleTTS}><div className="toggle-knob" /></div>
            </div>
            <div className="info-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div><div style={{ fontWeight: 700 }}>{t.app_language}</div><div style={{ fontSize: 12, color: "var(--text3)" }}>Choose your preferred language</div></div>
              <select className="form-input" style={{ width: 140 }} value={lang} onChange={e => changeLang(e.target.value)}>
                {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">{t.profile_info}</div></div>
          <div className="card-body">
            <div className="info-row"><div className="info-label">Name</div><div style={{ fontWeight: 600 }}>{user.name}</div></div>
            <div className="info-row"><div className="info-label">Email</div><div style={{ fontWeight: 600 }}>{user.email}</div></div>
            <div className="info-row"><div className="info-label">Role</div><div style={{ fontWeight: 600, textTransform: "capitalize" }}>{user.role}</div></div>
            <button className="btn btn-secondary btn-sm btn-block" style={{ marginTop: 15 }}>{t.edit_profile}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const AIChatPage = ({ user, medicines, doseLog, lang, tts }: any) => {
  const t = TRANSLATIONS[lang] || TRANSLATIONS["en-US"];
  const [messages, setMessages] = useState([
    { role: "assistant", content: `Hello ${user.name.split(" ")[0]}! 👋 I'm MediCompanion AI — your specialized medical assistant.\n\nI can help you with:\n• 💊 Drug information — uses, dosages, side effects\n• ⚠️ Drug interactions — is it safe to combine medicines?\n• 📋 Your current medicines — ${medicines.slice(0, 2).map((m: any) => m.name).join(", ")} and more\n\nWhat would you like to know today?` }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const buildSystemPrompt = () => {
    const medList = medicines.map((m: any) => `${m.name} ${m.dosage}`).join(', ');
    return `You are MediCompanion AI, a helpful medical assistant. You provide information about drugs, interactions, and health based on authoritative sources like WHO and NIH. 
    Current Patient: ${user.name}, Age: ${user.age}. 
    Current Medicines: ${medList || 'None recorded'}.
    Language: ${lang}. Please respond in the user's preferred language if possible.
    Always recommend consulting a doctor for specific medical advice.`;
  };

  const sendMessage = async (text?: string) => {
    const userText = (text || input).trim();
    if (!userText) return;
    setInput("");
    setLoading(true);
    const newMessages = [...messages, { role: "user", content: userText }];
    setMessages(newMessages);

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("API Key missing");
      }
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: newMessages.map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }]
        })),
        config: {
          systemInstruction: buildSystemPrompt(),
        },
      });
      
      const reply = response.text || "I'm sorry, I couldn't process that. Please try again.";
      setMessages(p => [...p, { role: "assistant", content: reply }]);
      if (tts) speak(reply, lang);
    } catch (err) {
      console.error(err);
      setMessages(p => [...p, { role: "assistant", content: "Sorry, I'm having trouble connecting. Please check your internet connection and try again." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div><div className="page-title">🤖 {t.chat}</div><div className="page-sub">Powered by Gemini AI</div></div>
      </div>
      <div className="card chat-container">
        <div className="chat-messages">
          {messages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              <div className="chat-bubble">
                {m.content}
                {m.role === "assistant" && tts && (
                  <button 
                    onClick={() => speak(m.content, lang)} 
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, marginLeft: 8, opacity: 0.6 }}
                    title="Speak message"
                  >
                    🔊
                  </button>
                )}
              </div>
            </div>
          ))}
          {loading && <div className="chat-msg assistant"><div className="chat-bubble">Thinking...</div></div>}
          <div ref={messagesEndRef} />
        </div>
        <div className="chat-input-bar">
          <input className="chat-input" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMessage()} placeholder="Ask me anything about your health..." />
          <button className="btn btn-primary" onClick={() => sendMessage()}>Send</button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// AUTH SCREEN
// ============================================================
const AuthScreen = ({ onLogin, db, setDb }: any) => {
  const [mode, setMode] = useState("signin");
  const [role, setRole] = useState("patient");
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [si, setSI] = useState({ email: "", password: "" });
  const setSIf = (k: string, v: string) => setSI(p => ({ ...p, [k]: v }));
  const [su, setSU] = useState({ name: "", email: "", password: "", confirmPassword: "", age: "", medicalHistory: "", allergies: "", relationship: "", specialization: "", licenseNo: "", hospital: "", phone: "", ec: [{ name: "", role: "", phone: "", type: "doctor" }, { name: "", role: "", phone: "", type: "ambulance" }] });
  const setSUf = (k: string, v: any) => setSU(p => ({ ...p, [k]: v }));

  const handleSignIn = () => {
    setError("");
    const found = db.users.find((u: any) => u.email.toLowerCase() === si.email.toLowerCase() && u.password === si.password);
    if (!found) { setError("Invalid email or password."); return; }
    onLogin(found);
  };

  const totalSteps = role === "patient" ? 3 : role === "doctor" ? 3 : 2;

  const handleNext = () => {
    setError("");
    if (step === 1) {
      if (!su.name.trim()) { setError("Please enter your full name."); return; }
      if (!su.email.includes("@")) { setError("Please enter a valid email."); return; }
      if (db.users.find((u: any) => u.email.toLowerCase() === su.email.toLowerCase())) { setError("Email already exists."); return; }
      if (su.password.length < 6) { setError("Password must be at least 6 characters."); return; }
      if (su.password !== su.confirmPassword) { setError("Passwords do not match."); return; }
      setStep(2);
    } else if (step < totalSteps) { setStep(s => s + 1); }
    else {
      const id = genId(role[0]);
      const newUser = { id, role, name: su.name.trim(), email: su.email.trim().toLowerCase(), password: su.password, avatar: initials(su.name), age: su.age, medicalHistory: role === "patient" ? su.medicalHistory : "", allergies: role === "patient" ? su.allergies : "", relationship: role === "family" ? su.relationship : "", specialization: role === "doctor" ? su.specialization : "", licenseNo: role === "doctor" ? su.licenseNo : "", hospital: role === "doctor" ? su.hospital : "", phone: role === "doctor" ? su.phone : "", emergencyContacts: role === "patient" ? su.ec.filter((c: any) => c.name.trim()) : [], linkedDoctors: [], linkedFamily: [], linkedPatients: [], points: 0, badges: [], streak: 0 };
      const newDb = { ...db, users: [...db.users, newUser] };
      setDb(newDb);
      onLogin(newUser);
    }
  };

  const roleData: any = { patient: { color: "#c4390a", bg: "#fef2ee", icon: "🧑🦳", label: "Patient" }, family: { color: "#1d6b47", bg: "#e8f5ef", icon: "👨👩👧", label: "Family" }, doctor: { color: "#1a3d9e", bg: "#eef3ff", icon: "👨⚕️", label: "Doctor" } };

  return (
    <div className="auth-bg">
      <div className="auth-card">
        <div className="auth-logo"><span style={{ fontSize: 28 }}>💊</span> MediCompanion</div>
        <div className="auth-tagline">India's Smart Medicine & Care Platform</div>
        <div className="auth-toggle">
          <button className={`auth-toggle-btn ${mode === "signin" ? "active" : ""}`} onClick={() => { setMode("signin"); setStep(1); setError(""); }}>Sign In</button>
          <button className={`auth-toggle-btn ${mode === "signup" ? "active" : ""}`} onClick={() => { setMode("signup"); setStep(1); setError(""); }}>Create Account</button>
        </div>

        {mode === "signin" && (
          <>
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.5px" }}>I am a...</div>
              <div className="role-tabs">
                {Object.entries(roleData).map(([v, d]: [string, any]) => (
                  <button key={v} className={`role-tab-btn ${role === v ? "active" : ""}`} onClick={() => setRole(v)} style={{ color: role === v ? d.color : undefined }}>
                    <div style={{ fontSize: 22, marginBottom: 3 }}>{d.icon}</div>
                    <div>{d.label}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="form-group"><label className="form-label">Email Address</label><input className="form-input" type="email" value={si.email} onChange={e => setSIf("email", e.target.value)} placeholder="your@email.com" autoComplete="email" /></div>
            <div className="form-group"><label className="form-label">Password</label><input className="form-input" type="password" value={si.password} onChange={e => setSIf("password", e.target.value)} placeholder="••••••••" onKeyDown={e => e.key === "Enter" && handleSignIn()} /></div>
            {error && <div className="error-msg">⚠️ {error}</div>}
            <button className="btn btn-primary btn-block btn-lg" onClick={handleSignIn} style={{ marginBottom: 16 }}>Sign In →</button>
            <div className="section-divider">Quick Demo Access</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {[{ email: "margaret@demo.com", pass: "demo123", label: "Margaret Chen", role: "Patient", icon: "🧑🦳" }, { email: "david@demo.com", pass: "demo123", label: "David Chen", role: "Family", icon: "👨👩👧" }, { email: "dr.kim@demo.com", pass: "demo123", label: "Dr. Robert Kim", role: "Doctor", icon: "👨⚕️" }].map(d => (
                <button key={d.email} className="demo-pill" onClick={() => { setSIf("email", d.email); setSIf("password", d.pass); }}>
                  <span style={{ fontSize: 18 }}>{d.icon}</span>
                  <div><div style={{ fontWeight: 700, color: "var(--text)", fontSize: 13 }}>{d.label}</div><div style={{ fontSize: 11, color: "var(--text3)" }}>{d.role} · {d.email}</div></div>
                </button>
              ))}
            </div>
          </>
        )}

        {mode === "signup" && (
          <>
            {step === 1 && (
              <div className="role-tabs" style={{ marginBottom: 20 }}>
                {Object.entries(roleData).map(([v, d]: [string, any]) => (
                  <button key={v} className={`role-tab-btn ${role === v ? "active" : ""}`} onClick={() => setRole(v)} style={{ color: role === v ? d.color : undefined }}>
                    <div style={{ fontSize: 20, marginBottom: 3 }}>{d.icon}</div>
                    <div>{d.label}</div>
                  </button>
                ))}
              </div>
            )}
            <div className="step-indicator">
              {Array.from({ length: totalSteps }, (_, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", flex: i < totalSteps - 1 ? 1 : 0, gap: 8 }}>
                  <div className={`step-dot ${step > i + 1 ? "done" : step === i + 1 ? "active" : "inactive"}`}>{step > i + 1 ? "✓" : i + 1}</div>
                  {i < totalSteps - 1 && <div className={`step-line ${step > i + 1 ? "done" : ""}`} />}
                </div>
              ))}
            </div>
            {step === 1 && (
              <>
                <div className="form-group"><label className="form-label">Full Name *</label><input className="form-input" value={su.name} onChange={e => setSUf("name", e.target.value)} placeholder="e.g. Priya Sharma" /></div>
                <div className="form-group"><label className="form-label">Email Address *</label><input className="form-input" type="email" value={su.email} onChange={e => setSUf("email", e.target.value)} placeholder="priya@email.com" /></div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Password *</label><input className="form-input" type="password" value={su.password} onChange={e => setSUf("password", e.target.value)} placeholder="Min. 6 chars" /></div>
                  <div className="form-group"><label className="form-label">Confirm *</label><input className="form-input" type="password" value={su.confirmPassword} onChange={e => setSUf("confirmPassword", e.target.value)} placeholder="Repeat" /></div>
                </div>
              </>
            )}
            {step === 2 && role === "patient" && (
              <>
                <div className="form-group"><label className="form-label">Age</label><input className="form-input" type="number" value={su.age} onChange={e => setSUf("age", e.target.value)} /></div>
                <div className="form-group"><label className="form-label">Medical History</label><textarea className="form-input" rows={2} value={su.medicalHistory} onChange={e => setSUf("medicalHistory", e.target.value)} placeholder="e.g. Type 2 Diabetes, Hypertension" style={{ resize: "vertical" }} /></div>
                <div className="form-group"><label className="form-label">Known Allergies</label><input className="form-input" value={su.allergies} onChange={e => setSUf("allergies", e.target.value)} placeholder="e.g. Penicillin" /></div>
              </>
            )}
            {step === 2 && role === "family" && (
              <>
                <div className="form-group"><label className="form-label">Age</label><input className="form-input" type="number" value={su.age} onChange={e => setSUf("age", e.target.value)} /></div>
                <div className="form-group"><label className="form-label">Relationship to Patient</label><input className="form-input" value={su.relationship} onChange={e => setSUf("relationship", e.target.value)} placeholder="e.g. Son, Daughter, Spouse" /></div>
              </>
            )}
            {step === 2 && role === "doctor" && (
              <>
                <div className="form-group"><label className="form-label">Specialization *</label><input className="form-input" value={su.specialization} onChange={e => setSUf("specialization", e.target.value)} placeholder="e.g. General Physician" /></div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">License No.</label><input className="form-input" value={su.licenseNo} onChange={e => setSUf("licenseNo", e.target.value)} placeholder="MD-XXXXX" /></div>
                  <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={su.phone} onChange={e => setSUf("phone", e.target.value)} placeholder="+91-XXXXXXXXXX" /></div>
                </div>
              </>
            )}
            {step === 3 && role === "patient" && su.ec.map((c: any, i: number) => (
              <div key={i} style={{ background: "var(--surface2)", borderRadius: 12, padding: 14, marginBottom: 12, border: "1.5px solid var(--border)" }}>
                <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 10, color: "var(--text2)", textTransform: "uppercase" }}>Contact {i + 1}</div>
                <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={c.name} onChange={e => setSU(p => ({ ...p, ec: p.ec.map((x: any, j: number) => j === i ? { ...x, name: e.target.value } : x) }))} /></div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={c.phone} onChange={e => setSU(p => ({ ...p, ec: p.ec.map((x: any, j: number) => j === i ? { ...x, phone: e.target.value } : x) }))} /></div>
                  <div className="form-group"><label className="form-label">Type</label><select className="form-input" value={c.type} onChange={e => setSU(p => ({ ...p, ec: p.ec.map((x: any, j: number) => j === i ? { ...x, type: e.target.value } : x) }))}><option value="doctor">👨⚕️ Doctor</option><option value="ambulance">🚑 Ambulance</option></select></div>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Role</label><input className="form-input" value={c.role} onChange={e => setSU(p => ({ ...p, ec: p.ec.map((x: any, j: number) => j === i ? { ...x, role: e.target.value } : x) }))} placeholder="e.g. Primary Physician" /></div>
              </div>
            ))}
            {step === 3 && role === "doctor" && (
              <div className="form-group"><label className="form-label">Hospital / Clinic</label><input className="form-input" value={su.hospital} onChange={e => setSUf("hospital", e.target.value)} placeholder="e.g. AIIMS, Apollo Hospital" /></div>
            )}
            {error && <div className="error-msg">⚠️ {error}</div>}
            <div style={{ display: "flex", gap: 9, marginTop: 6 }}>
              {step > 1 && <button className="btn btn-secondary" onClick={() => { setStep(s => s - 1); setError(""); }}>← Back</button>}
              <button className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={handleNext}>{step < totalSteps ? "Next →" : "✅ Create Account"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ============================================================
// MAIN APP COMPONENT
// ============================================================
export default function App() {
  const [db, setDb] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [page, setPage] = useState("dashboard");
  const [toasts, setToasts] = useState<any[]>([]);
  const [lang, setLang] = useState(localStorage.getItem("med_lang") || "en-US");
  const [tts, setTts] = useState(localStorage.getItem("med_tts") === "true");
  const toastRef = useRef(0);
  const dbRef = useRef<any>(null);

  useEffect(() => {
    dbRef.current = db;
  }, [db]);

  useEffect(() => {
    if ("Notification" in window) {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await (window as any).storage.get(DB_KEY);
        if (result?.value) setDb(JSON.parse(result.value));
        else setDb(defaultDB());
      } catch { setDb(defaultDB()); }
    };
    load();
  }, []);

  const saveDB = useCallback(async (newDb: any) => {
    try { await (window as any).storage.set(DB_KEY, JSON.stringify(newDb)); } catch {}
  }, []);

  const addToast = useCallback((toast: any) => {
    const id = ++toastRef.current;
    setToasts(p => [...p, { ...toast, id }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4500);
  }, []);

  // Helper: always returns HH:MM with leading zeros
  const normalizeTime = (date: Date) => {
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  };

  useEffect(() => {
    if (!db) return;

    const interval = setInterval(() => {
      const currentDb = dbRef.current;
      if (!currentDb) return;

      const currentTime = normalizeTime(new Date());
      const todayStr = today();
      let hasUpdates = false;
      let newLogs = [...currentDb.doseLogs];

      currentDb.medicines.forEach((med: any) => {
        med.timings.forEach((t: string) => {
          if (t === currentTime) {
            const scheduledTime = `${todayStr}T${t}:00`;

            // Check if a log already exists in the current logs
            const hasLog = newLogs.some(
              (l: any) => l.medicineId === med.id && l.scheduledTime === scheduledTime
            );

            if (!hasLog) {
              const newLog = {
                id: genId("log"),
                medicineId: med.id,
                medicineName: med.name,
                patientId: med.patientId,
                scheduledTime,
                status: "pending",
                takenAt: null
              };

              newLogs.push(newLog);
              hasUpdates = true;

              addToast({
                icon: "⏳",
                title: "Dose due",
                msg: `${med.name} scheduled at ${t}`
              });

              if (tts) {
                speak(`Reminder: It is time to take your ${med.name}.`, lang);
              }

              if ("Notification" in window && Notification.permission === "granted") {
                new Notification("Medicine Reminder", {
                  body: `Take ${med.name} (${med.dosage})`,
                  icon: "/pill.svg"
                });
              }
            }
          }
        });
      });

      if (hasUpdates) {
        const updatedDb = { ...currentDb, doseLogs: newLogs };
        setDb(updatedDb);
        saveDB(updatedDb);
      }
    }, 10000); // Check every 10 seconds for better reliability

    return () => clearInterval(interval);
  }, [addToast, saveDB, !!db, tts, lang]);

  const handleTake = (medicineId: string, time: string) => {
    const todayStr = today();
    const scheduledTime = `${todayStr}T${time}:00`;
    const med = db.medicines.find((m: any) => m.id === medicineId);
    const hasEntry = db.doseLogs.some((l: any) => l.medicineId === medicineId && l.scheduledTime === scheduledTime);
    
    const finalLogs = hasEntry
      ? db.doseLogs.map((l: any) => l.medicineId === medicineId && l.scheduledTime === scheduledTime ? { ...l, status: "taken", takenAt: new Date().toISOString() } : l)
      : [...db.doseLogs, { id: genId("log"), medicineId, medicineName: med.name, patientId: med.patientId, scheduledTime, status: "taken", takenAt: new Date().toISOString() }];
    
    const newDb = { 
      ...db, 
      doseLogs: finalLogs, 
      medicines: db.medicines.map((m: any) => m.id === medicineId ? { ...m, pillsRemaining: Math.max(0, m.pillsRemaining - 1) } : m) 
    };
    setDb(newDb);
    saveDB(newDb);
    addToast({ icon: "✅", title: "Dose taken", msg: `${med.name} recorded.` });
  };

  const handleAddMed = (med: any) => {
    const newDb = { ...db, medicines: [...db.medicines, med] };
    setDb(newDb);
    saveDB(newDb);
    addToast({ icon: "💊", title: "Medicine Added", msg: `${med.name} has been added to the schedule.` });
  };

  const handleDeleteMed = (id: string) => {
    const med = db.medicines.find((m: any) => m.id === id);
    const newDb = { ...db, medicines: db.medicines.filter((m: any) => m.id !== id) };
    setDb(newDb);
    saveDB(newDb);
    addToast({ icon: "🗑️", title: "Medicine Removed", msg: `${med?.name} deleted.` });
  };

  if (!db) return <div className="p-8 text-center">Loading MediCompanion...</div>;

  if (!user) {
    return <AuthScreen onLogin={setUser} db={db} setDb={setDb} />;
  }

  const renderPage = () => {
    const pMeds = db.medicines.filter((m: any) => m.patientId === user.id);
    const patients = user.role === "doctor" ? db.users.filter((u: any) => u.role === "patient") : user.role === "family" ? db.users.filter((u: any) => user.linkedPatients?.includes(u.id)) : [user];

    switch (page) {
      case "dashboard": 
        if (user.role === "doctor") return <DoctorDashboard user={user} patients={patients} medicines={db.medicines} doseLog={db.doseLogs} contactRequests={db.contactRequests} addToast={addToast} />;
        if (user.role === "family") return <FamilyDashboard user={user} patients={patients} medicines={db.medicines} doseLog={db.doseLogs} addToast={addToast} />;
        return <PatientDashboard user={user} medicines={pMeds} doseLog={db.doseLogs} onTake={handleTake} addToast={addToast} lang={lang} tts={tts} />;
      case "medicines": return <MedicinesPage user={user} medicines={pMeds} onAddMed={handleAddMed} onDeleteMed={handleDeleteMed} isDoctor={user.role === "doctor"} patients={patients} lang={lang} />;
      case "analytics": return <AnalyticsPage user={user} doseLog={db.doseLogs} medicines={pMeds} lang={lang} />;
      case "sos": return <SOSPage user={user} addToast={addToast} lang={lang} />;
      case "history": return <HistoryPage user={user} medicalHistory={db.medicalHistory} lang={lang} />;
      case "chat": return <AIChatPage user={user} medicines={pMeds} doseLog={db.doseLogs} lang={lang} tts={tts} />;
      case "settings": return <SettingsPage user={user} addToast={addToast} lang={lang} setLang={setLang} tts={tts} setTts={setTts} />;
      default: return <div>Page not found</div>;
    }
  };

  const t = TRANSLATIONS[lang] || TRANSLATIONS["en-US"];

  return (
    <div className="app">
      <Toast toasts={toasts} remove={id => setToasts(p => p.filter(t => t.id !== id))} />
      <nav className="nav">
        <div className="nav-header">
          <div className="nav-logo">💊 MediCompanion</div>
          <div className="nav-sub">Smart Care</div>
        </div>
        <div className="nav-items">
          <button className={`nav-item ${page === 'dashboard' ? 'active' : ''}`} onClick={() => setPage('dashboard')}>🏠 {t.dashboard}</button>
          {user.role === "patient" && (
            <>
              <button className={`nav-item ${page === 'medicines' ? 'active' : ''}`} onClick={() => setPage('medicines')}>💊 {t.medicines}</button>
              <button className={`nav-item ${page === 'analytics' ? 'active' : ''}`} onClick={() => setPage('analytics')}>📊 {t.analytics}</button>
              <button className={`nav-item ${page === 'history' ? 'active' : ''}`} onClick={() => setPage('history')}>📜 {t.history}</button>
              <button className={`nav-item ${page === 'sos' ? 'active' : ''}`} onClick={() => setPage('sos')}>🚨 {t.sos}</button>
            </>
          )}
          <button className={`nav-item ${page === 'chat' ? 'active' : ''}`} onClick={() => setPage('chat')}>🤖 {t.chat}</button>
          <button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}>⚙️ {t.settings}</button>
        </div>
        <div className="nav-footer">
          <div className="nav-user-card">
            <div className="nav-avatar" style={{background: 'var(--accent)', width: 32, height: 32}}>{user.avatar}</div>
            <div>
              <div className="nav-user-name">{user.name}</div>
              <div className="nav-user-role">{user.role}</div>
            </div>
          </div>
          <button className="logout-btn" onClick={() => setUser(null)}>Logout</button>
        </div>
      </nav>
      <main className="main">
        {renderPage()}
      </main>
    </div>
  );
}
