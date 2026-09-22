export const CATEGORIES = [
  { id: "comida", label: "Comida" },
  { id: "transporte", label: "Transporte" },
  { id: "ingresso", label: "Ingresso" },
  { id: "presente", label: "Presente" },
  { id: "mercado", label: "Mercado" },
  { id: "casa", label: "Casa" },
  { id: "outro", label: "Outro" },
];

const CATEGORY_IDS = new Set(CATEGORIES.map((item) => item.id));
const ID_RE = /^[a-zA-Z0-9_-]{8,40}$/;
const MONTHS_LONG = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function categoryLabel(id) {
  return CATEGORIES.find((item) => item.id === id)?.label || "Outro";
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
}

export function emptyState() {
  const now = new Date().toISOString();
  return {
    version: 1,
    updatedAt: now,
    metaUpdatedAt: now,
    names: { a: "", b: "" },
    outings: [],
    settlements: [],
    divisions: [],
    deleted: [],
  };
}

export function todayISO(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function monthKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function shiftMonth(ym, delta) {
  const [year, month] = ym.split("-").map(Number);
  const next = new Date(year, month - 1 + delta, 1);
  return monthKey(next);
}

export function formatMonth(ym) {
  const [year, month] = ym.split("-").map(Number);
  return `${MONTHS_LONG[month - 1] || ym} de ${year}`;
}

export function monthChoices() {
  return MONTHS_LONG.map((label, index) => ({
    value: String(index + 1).padStart(2, "0"),
    label,
  }));
}

export function splitISO(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!match) return splitISO(todayISO());
  return {
    day: String(Number(match[3])),
    month: match[2],
    year: match[1],
  };
}

export function joinISO(day, month, year) {
  const d = Number(String(day ?? "").trim());
  const m = Number(String(month ?? "").trim());
  const y = Number(String(year ?? "").trim());
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) return null;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  const pad = (value) => String(value).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function formatDateLong(iso) {
  const [year, month, day] = String(iso || "").split("-").map(Number);
  if (!year || !month || !day || !MONTHS_LONG[month - 1]) return "";
  return `${day} de ${MONTHS_LONG[month - 1]} de ${year}`;
}

export function formatDayParts(iso) {
  const [year, month, day] = String(iso || "").split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return {
    day: String(day),
    month: MONTHS_SHORT[month - 1] || "",
    week: WEEKDAYS[date.getDay()] || "",
    year: String(year),
  };
}

export function formatBRL(cents) {
  const value = Number(cents) || 0;
  return (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function centsToInput(cents) {
  return (Math.max(0, Number(cents) || 0) / 100).toFixed(2).replace(".", ",");
}

export function parseMoney(raw) {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0 || raw > 1_000_000) return null;
    return Math.round(raw * 100);
  }
  let text = String(raw ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/^R\$/i, "");
  if (!text) return null;
  if (text.includes(",") && text.includes(".")) text = text.replace(/\./g, "").replace(",", ".");
  else if (text.includes(",")) text = text.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  if (value > 1_000_000) return null;
  return Math.round(value * 100);
}

export function normalizeCode(code) {
  const normalized = String(code || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (!/^[a-z0-9-]{8,32}$/.test(normalized)) return null;
  if (!/[a-z]/.test(normalized)) return null;
  return normalized;
}

function clip(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function isoOrNow(value) {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return value;
  return new Date().toISOString();
}

function sanitizeExpenses(list) {
  const expenses = [];
  for (const raw of (Array.isArray(list) ? list : []).slice(0, 30)) {
    const id = clip(raw?.id, 40);
    const amountCents = Number(raw?.amountCents);
    if (!ID_RE.test(id)) continue;
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 100_000_000) continue;
    expenses.push({
      id,
      label: clip(raw.label, 80) || "Gasto",
      amountCents,
      category: CATEGORY_IDS.has(raw.category) ? raw.category : "outro",
      paidBy: raw.paidBy === "b" || raw.paidBy === "split" ? raw.paidBy : "a",
    });
  }
  return expenses;
}

export function sanitizeState(input) {
  const source = input && typeof input === "object" ? input : {};
  const outings = [];
  for (const raw of (Array.isArray(source.outings) ? source.outings : []).slice(0, 800)) {
    const id = clip(raw?.id, 40);
    if (!ID_RE.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(raw?.date || "")) continue;
    outings.push({
      id,
      date: raw.date,
      title: clip(raw.title, 80) || "Saída",
      place: clip(raw.place, 80),
      note: clip(raw.note, 400),
      expenses: sanitizeExpenses(raw.expenses),
      createdAt: isoOrNow(raw.createdAt),
      updatedAt: isoOrNow(raw.updatedAt),
    });
  }

  const settlements = [];
  for (const raw of (Array.isArray(source.settlements) ? source.settlements : []).slice(0, 800)) {
    const id = clip(raw?.id, 40);
    const amountCents = Number(raw?.amountCents);
    const pair =
      (raw?.from === "a" && raw?.to === "b") || (raw?.from === "b" && raw?.to === "a");
    if (!ID_RE.test(id) || !pair || !/^\d{4}-\d{2}-\d{2}$/.test(raw?.date || "")) continue;
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 100_000_000) continue;
    settlements.push({
      id,
      date: raw.date,
      from: raw.from,
      to: raw.to,
      amountCents,
      note: clip(raw.note, 200),
      createdAt: isoOrNow(raw.createdAt),
      updatedAt: isoOrNow(raw.updatedAt),
    });
  }

  const divisionsByMonth = new Map();
  for (const raw of (Array.isArray(source.divisions) ? source.divisions : []).slice(0, 240)) {
    const month = String(raw?.month || "");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) continue;
    const id = clip(raw?.id, 40);
    const division = {
      id: ID_RE.test(id) ? id : `div-${month}`,
      month,
      on: raw?.on === true,
      updatedAt: isoOrNow(raw?.updatedAt),
    };
    const prev = divisionsByMonth.get(month);
    if (!prev || division.updatedAt >= prev.updatedAt) divisionsByMonth.set(month, division);
  }

  const deleted = [];
  for (const raw of (Array.isArray(source.deleted) ? source.deleted : []).slice(0, 1500)) {
    const id = clip(raw?.id, 40);
    if (!ID_RE.test(id)) continue;
    deleted.push({ id, at: isoOrNow(raw.at) });
  }
  deleted.sort((a, b) => b.at.localeCompare(a.at));

  return {
    version: 1,
    updatedAt: isoOrNow(source.updatedAt),
    metaUpdatedAt: isoOrNow(source.metaUpdatedAt),
    names: {
      a: clip(source.names?.a, 40),
      b: clip(source.names?.b, 40),
    },
    outings,
    settlements,
    divisions: [...divisionsByMonth.values()],
    deleted: deleted.slice(0, 1000),
  };
}

function preferNewer(current, incoming) {
  if (!current) return incoming;
  if (!incoming) return current;
  return (incoming.updatedAt || "") >= (current.updatedAt || "") ? incoming : current;
}

export function mergeStates(left, right) {
  if (!left) return right ? sanitizeState(right) : emptyState();
  if (!right) return sanitizeState(left);
  const a = sanitizeState(left);
  const b = sanitizeState(right);
  const named = (side) => (side.names.a && side.names.b ? side : null);
  const preferNames = () => {
    const leftNamed = named(a);
    const rightNamed = named(b);
    if (leftNamed && rightNamed) return (a.metaUpdatedAt || "") >= (b.metaUpdatedAt || "") ? a : b;
    return leftNamed || rightNamed || a;
  };
  const chosen = preferNames();
  const names = chosen.names;
  const metaUpdatedAt = chosen.metaUpdatedAt;

  const tombstones = new Map();
  for (const item of [...a.deleted, ...b.deleted]) {
    const prev = tombstones.get(item.id);
    if (!prev || item.at > prev.at) tombstones.set(item.id, item);
  }

  const outings = new Map();
  for (const outing of [...a.outings, ...b.outings]) {
    outings.set(outing.id, preferNewer(outings.get(outing.id), outing));
  }
  const settlements = new Map();
  for (const settlement of [...a.settlements, ...b.settlements]) {
    settlements.set(settlement.id, preferNewer(settlements.get(settlement.id), settlement));
  }
  const divisions = new Map();
  for (const division of [...a.divisions, ...b.divisions]) {
    divisions.set(division.month, preferNewer(divisions.get(division.month), division));
  }

  for (const [id, tomb] of [...tombstones]) {
    const kept = [outings, settlements].some((bucket) => {
      const item = bucket.get(id);
      if (!item) return false;
      if ((item.updatedAt || "") > tomb.at) return true;
      bucket.delete(id);
      return false;
    });
    if (kept) tombstones.delete(id);
  }

  const deleted = [...tombstones.values()].sort((aItem, bItem) => bItem.at.localeCompare(aItem.at)).slice(0, 1000);
  return sanitizeState({
    names,
    metaUpdatedAt,
    updatedAt: new Date().toISOString(),
    outings: [...outings.values()],
    settlements: [...settlements.values()],
    divisions: [...divisions.values()],
    deleted,
  });
}

export function monthDivided(state, month) {
  const matches = (state?.divisions || []).filter((item) => item.month === month);
  if (!matches.length) return false;
  const latest = matches.reduce((best, item) => ((item.updatedAt || "") >= (best.updatedAt || "") ? item : best));
  return latest.on === true;
}

function halfDebt(paidA, paidB) {
  const diff = paidA - paidB;
  if (diff >= 0) return Math.floor(diff / 2);
  return -Math.floor(-diff / 2);
}

export function summarize(state, month) {
  const source = state || emptyState();
  const inPeriod = (date) => month === "all" || String(date || "").startsWith(month);
  let totalCents = 0;
  let paidA = 0;
  let paidB = 0;
  let expenseCount = 0;
  let outingCount = 0;
  const cats = {};

  for (const outing of source.outings || []) {
    if (!inPeriod(outing.date)) continue;
    outingCount += 1;
    for (const expense of outing.expenses || []) {
      const cents = expense.amountCents || 0;
      totalCents += cents;
      expenseCount += 1;
      if (expense.paidBy === "b") paidB += cents;
      else if (expense.paidBy === "split") {
        const half = Math.floor(cents / 2);
        paidA += half;
        paidB += cents - half;
      } else paidA += cents;
      const category = expense.category || "outro";
      cats[category] = (cats[category] || 0) + cents;
    }
  }

  let settle = halfDebt(paidA, paidB);
  for (const settlement of source.settlements || []) {
    if (!inPeriod(settlement.date)) continue;
    if (settlement.from === "b" && settlement.to === "a") settle -= settlement.amountCents;
    else if (settlement.from === "a" && settlement.to === "b") settle += settlement.amountCents;
  }

  const byCat = Object.entries(cats)
    .map(([id, cents]) => ({ id, cents }))
    .sort((a, b) => b.cents - a.cents || a.id.localeCompare(b.id));

  return { totalCents, paidA, paidB, settle, outingCount, expenseCount, byCat };
}

export function sortByDateDesc(items) {
  return [...items].sort(
    (a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""),
  );
}
