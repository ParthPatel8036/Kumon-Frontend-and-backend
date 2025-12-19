// utils/smsRenderer.js
export function renderSmsTemplate(
  text,
  {
    student = {},
    type = "CHECK_IN",
    now = new Date(),
    centerName,
    centreName,          // NEW alias
    tz,                  // existing
    timezone,            // NEW alias
  } = {}
) {
  // Normalise inputs
  const d = now instanceof Date ? now : new Date(now);
  const first = student.first_name ?? student.firstName ?? "";
  const last  = student.last_name  ?? student.lastName  ?? "";
  const full  = [first, last].filter(Boolean).join(" ").trim() || "Student";
  const id    = student.id ?? "";

  const timeZone =
    tz || timezone || process.env.APP_TZ || "Australia/Hobart";

  const centre =
    centerName || centreName || process.env.CENTER_NAME || "Kumon Centre";

  // Defensive Intl (fallback to toLocaleString if needed)
  let dateStr = "";
  let timeStr = "";
  try {
    const dateFmt = new Intl.DateTimeFormat("en-AU", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone,
    });
    const timeFmt = new Intl.DateTimeFormat("en-AU", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
      timeZoneName: "short",
    });
    dateStr = dateFmt.format(d);  // e.g., "Fri, 15 Aug 2025"
    timeStr = timeFmt.format(d);  // e.g., "7:04 pm AEST"
  } catch {
    dateStr = d.toLocaleDateString("en-AU", { timeZone });
    timeStr = d.toLocaleTimeString("en-AU", { timeZone, hour: "2-digit", minute: "2-digit" });
  }

  const map = {
    "student.firstName": first || "Student",
    "student.lastName":  last,
    "student.fullName":  full,
    "student.id":        String(id),
    "type":              String(type || "").toUpperCase(),
    "time":              timeStr,
    "date":              dateStr,
    "center.name":       centre,    // existing
    "centre.name":       centre,    // NEW alias (UK spelling)
    "timezone":          timeZone,  // NEW (useful in some templates)
  };

  // Replace any {token}. Unknown tokens are left as-is so users see what didn't match
  return String(text || "").replace(/\{([^}]+)\}/g, (m, key) => (map[key] ?? m)).trim();
}