export const PROFILE_LIMITS = Object.freeze({ name: 80, notes: 100000 });
// Fold older profile fields into context without discarding saved information.
export function profileContext(value, language = "en") {
  const notes = typeof value?.notes === "string" ? value.notes : "";
  const extra = [];
  for (const [key, label] of [
    ["city", language === "bg" ? "Град" : "City"],
    ["occupation", language === "bg" ? "Занимание" : "Occupation"],
  ]) {
    const field = typeof value?.[key] === "string" ? value[key].trim() : "";
    if (field && !notes.includes(field)) extra.push(`${label}: ${field}`);
  }
  return [notes, extra.join("\n")].filter(Boolean).join("\n\n");
}
