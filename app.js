import {
  CATEGORIES,
  categoryLabel,
  centsToInput,
  emptyState,
  formatBRL,
  formatDateLong,
  formatDayParts,
  formatMonth,
  joinISO,
  monthChoices,
  splitISO,
  mergeStates,
  monthKey,
  newId,
  normalizeCode,
  parseMoney,
  sanitizeState,
  shiftMonth,
  sortByDateDesc,
  summarize,
  todayISO,
} from "./logic.js?v=11";

const STATE_KEY = "adois:v1";
const CODE_KEY = "adois:code";
let installEvent = null;

const app = document.getElementById("app");
let state = loadState();
let rev = 0;
let chain = Promise.resolve();
let ui = {
  view: "resumo",
  month: monthKey(new Date()),
  editingId: null,
  draft: null,
  confirm: null,
  error: "",
  flash: "",
  keepFlash: false,
  sync: codeOf() ? "busy" : "local",
  persistent: null,
  search: "",
  codeDraft: "",
};

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
    if (!raw) return emptyState();
    return sanitizeState(raw);
  } catch {
    return emptyState();
  }
}

function onboarded() {
  return Boolean(state.names.a && state.names.b);
}

function codeOf() {
  return normalizeCode(localStorage.getItem(CODE_KEY) || "");
}

function writeLocal() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    ui.error = "O navegador bloqueou salvar neste celular.";
  }
}

function nameOf(side) {
  return state.names[side] || (side === "a" ? "Pessoa 1" : "Pessoa 2");
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function payerLabel(paidBy) {
  if (paidBy === "split") return "metade cada";
  return nameOf(paidBy === "b" ? "b" : "a");
}

function outingTotal(outing) {
  return (outing.expenses || []).reduce((sum, expense) => sum + expense.amountCents, 0);
}

function payerSummary(outing) {
  if (!outing.expenses.length) return "sem gasto";
  const kinds = new Set(outing.expenses.map((expense) => expense.paidBy));
  if (kinds.size > 1) return "os dois pagaram";
  const only = [...kinds][0];
  if (only === "split") return "metade cada";
  return `${nameOf(only)} pagou`;
}

function pluralSaidas(count) {
  return count === 1 ? "1 saída" : `${count} saídas`;
}

function syncLabel() {
  if (ui.sync === "busy") return "sincronizando";
  if (ui.sync === "ok") return "os dois celulares";
  if (ui.sync === "error") return "falhou ao sincronizar";
  return "neste celular";
}

function blankDraft() {
  return {
    forId: null,
    date: todayISO(),
    title: "",
    place: "",
    note: "",
    expenses: [{ id: newId(), label: "", amount: "", category: "comida", paidBy: "a" }],
  };
}

function draftFromOuting(outing) {
  return {
    forId: outing.id,
    date: outing.date,
    title: outing.title,
    place: outing.place,
    note: outing.note,
    expenses: outing.expenses.length
      ? outing.expenses.map((expense) => ({
          id: expense.id,
          label: expense.label,
          amount: centsToInput(expense.amountCents),
          category: expense.category,
          paidBy: expense.paidBy,
        }))
      : [{ id: newId(), label: "", amount: "", category: "comida", paidBy: "a" }],
  };
}

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [head, id] = parts;
  if (head === "saidas") return { view: "saidas", editingId: null };
  if (head === "nova") return { view: "nova", editingId: null };
  if (head === "editar" && id) return { view: "nova", editingId: id };
  if (head === "saida" && id) return { view: "detalhe", editingId: id };
  if (head === "ajustes") return { view: "ajustes", editingId: null };
  return { view: "resumo", editingId: null };
}

function stashDraft() {
  const form = document.getElementById("outing-form");
  if (!form || !ui.draft) return;
  const next = readOutingForm(form);
  next.forId = ui.draft.forId;
  ui.draft = next;
}

function go(hash, flash = "") {
  ui.error = "";
  ui.flash = flash;
  ui.keepFlash = Boolean(flash);
  if (location.hash === hash) syncFromHash();
  else location.hash = hash;
}

function syncFromHash() {
  stashDraft();
  if (!codeOf()) {
    ui.view = "codigo";
    render();
    return;
  }
  if (!onboarded()) {
    ui.view = "boas-vindas";
    render();
    return;
  }
  const next = parseHash();
  const enteringForm = next.view === "nova" && (ui.view !== "nova" || ui.editingId !== next.editingId);
  ui.view = next.view;
  ui.editingId = next.editingId;
  ui.confirm = null;
  if (!ui.keepFlash) ui.flash = "";
  ui.keepFlash = false;
  if (enteringForm) {
    if (ui.draft && ui.draft.forId === (next.editingId || null) && ui.view === "nova") {
      // rascunho da mesma saída continua na tela
    } else if (next.editingId) {
      const outing = state.outings.find((item) => item.id === next.editingId);
      ui.draft = outing ? draftFromOuting(outing) : null;
    } else if (!(ui.draft && ui.draft.forId === null)) {
      ui.draft = blankDraft();
    }
  }
  render();
  const heading = app.querySelector("h1");
  if (heading) heading.focus();
}

function save() {
  rev += 1;
  state.updatedAt = new Date().toISOString();
  writeLocal();
  enqueueSync();
}

function enqueueSync() {
  if (!codeOf()) {
    ui.sync = "local";
    paintSync();
    return;
  }
  const sentRev = rev;
  const payload = JSON.parse(JSON.stringify(state));
  ui.sync = "busy";
  paintSync();
  chain = chain
    .then(() => syncNow(sentRev, payload))
    .catch(() => {
      ui.sync = "error";
      paintSync();
    });
}

async function syncNow(sentRev, payload) {
  const code = codeOf();
  if (!code) {
    ui.sync = "local";
    paintSync();
    return;
  }
  const res = await fetch("/api/casal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ code, state: payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "sync");
  ui.persistent = data.persistent;
  if (sentRev !== rev) return;
  state = mergeStates(state, data.state);
  writeLocal();
  ui.sync = "ok";
  if (onboarded() && (ui.view === "codigo" || ui.view === "boas-vindas")) {
    ui.view = "resumo";
    render();
    return;
  }
  const typing = document.querySelector("#outing-form, #settings-form, #welcome-form, #code-form");
  if (!typing) {
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  } else paintSync();
}

function paintSync() {
  const el = app.querySelector("[data-sync-label]");
  if (!el) return;
  el.textContent = syncLabel();
  el.dataset.state = ui.sync;
}

function dateSource(draft) {
  const base = splitISO(draft?.date);
  return {
    day: draft?.day ?? base.day,
    month: draft?.month ?? base.month,
    year: draft?.year ?? base.year,
  };
}

function dateFieldHtml(source) {
  const parts = source?.day != null || source?.month || source?.year ? source : splitISO(source);
  const options = monthChoices()
    .map(
      (month) =>
        `<option value="${month.value}"${parts.month === month.value ? " selected" : ""}>${month.label}</option>`,
    )
    .join("");
  return `<div class="field">
    <span>Data</span>
    <div class="date-fields">
      <label>Dia<input name="day" inputmode="numeric" maxlength="2" autocomplete="off" value="${esc(parts.day)}" placeholder="22"></label>
      <label>Mês<select name="month">${options}</select></label>
      <label>Ano<input name="year" inputmode="numeric" maxlength="4" autocomplete="off" value="${esc(parts.year)}" placeholder="2026"></label>
    </div>
  </div>`;
}

function readOutingForm(form) {
  return {
    date: joinISO(form.day.value, form.month.value, form.year.value) || "",
    day: form.day.value,
    month: form.month.value,
    year: form.year.value,
    title: form.title.value,
    place: form.place.value,
    note: form.note.value,
    expenses: [...form.querySelectorAll("[data-expense]")].map((row) => ({
      id: row.dataset.id,
      label: row.querySelector("[name=label]").value,
      amount: row.querySelector("[name=amount]").value,
      category: row.querySelector('input[name^="cat-"]:checked')?.value || "comida",
      paidBy: row.querySelector('input[name^="paid-"]:checked')?.value || "a",
    })),
  };
}

function updateFormTotal() {
  const form = document.getElementById("outing-form");
  const target = document.getElementById("form-total");
  if (!form || !target) return;
  let total = 0;
  let invalid = false;
  for (const row of form.querySelectorAll("[data-expense]")) {
    const raw = row.querySelector("[name=amount]").value.trim();
    if (!raw) continue;
    const cents = parseMoney(raw);
    if (cents == null) invalid = true;
    else total += cents;
  }
  target.textContent = invalid ? "Confere os valores" : formatBRL(total);
}

function tombstone(id) {
  state.deleted.push({ id, at: new Date().toISOString() });
}

async function onCode(form) {
  ui.codeDraft = form.code.value;
  const code = normalizeCode(form.code.value);
  if (!code) {
    ui.error = "O código precisa de pelo menos 8 caracteres e uma letra. Exemplo: mesa-4821.";
    render();
    return;
  }
  localStorage.setItem(CODE_KEY, code);
  ui.codeDraft = "";
  ui.error = "";
  ui.entering = true;
  render();
  try {
    await syncNow(rev, JSON.parse(JSON.stringify(state)));
  } catch {
    ui.sync = "error";
  }
  ui.entering = false;
  if (onboarded()) {
    ui.view = "resumo";
    if (!location.hash || location.hash === "#") history.replaceState(null, "", "#/");
    render();
    return;
  }
  ui.view = "boas-vindas";
  render();
}

function onWelcome(form) {
  const a = form.nameA.value.trim();
  const b = form.nameB.value.trim();
  if (!a || !b) {
    ui.error = "Preenche os dois nomes.";
    render();
    return;
  }
  state.names = { a, b };
  state.metaUpdatedAt = new Date().toISOString();
  ui.error = "";
  save();
  go("#/");
}

function onSaveOuting(form) {
  const draft = readOutingForm(form);
  draft.forId = ui.draft?.forId ?? ui.editingId;
  ui.draft = draft;
  if (!draft.title.trim()) {
    ui.error = "Escreve o que vocês fizeram.";
    render();
    return;
  }
  if (!draft.date) {
    ui.error = "A data começa pelo dia, depois o mês e o ano. Exemplo: 22, setembro, 2026.";
    render();
    return;
  }
  const expenses = [];
  for (const row of draft.expenses) {
    const blank = !row.label.trim() && !String(row.amount).trim();
    if (blank) continue;
    const cents = parseMoney(row.amount);
    if (cents == null) {
      ui.error = "Tem um valor que não entendi. Exemplo: 42,50.";
      render();
      return;
    }
    if (cents === 0) {
      ui.error = "O valor do gasto precisa ser maior que zero.";
      render();
      return;
    }
    expenses.push({
      id: row.id || newId(),
      label: row.label.trim() || "Gasto",
      amountCents: cents,
      category: row.category,
      paidBy: row.paidBy,
    });
  }
  const now = new Date().toISOString();
  const existing = state.outings.find((item) => item.id === ui.editingId);
  const outing = {
    id: existing?.id || newId(),
    date: draft.date,
    title: draft.title.trim(),
    place: draft.place.trim(),
    note: draft.note.trim(),
    expenses,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  state.outings = [outing, ...state.outings.filter((item) => item.id !== outing.id)];
  ui.draft = null;
  ui.error = "";
  save();
  go(`#/saida/${outing.id}`, existing ? "Saída atualizada." : "Saída anotada.");
}

function onSaveSettings(form) {
  const a = form.nameA.value.trim();
  const b = form.nameB.value.trim();
  const rawCode = form.code.value.trim();
  if (!a || !b) {
    ui.error = "Os dois nomes precisam estar preenchidos.";
    render();
    return;
  }
  if (rawCode && !normalizeCode(rawCode)) {
    ui.error = "O código precisa de pelo menos 8 caracteres e uma letra. Exemplo: mesa-4821.";
    render();
    return;
  }
  state.names = { a, b };
  state.metaUpdatedAt = new Date().toISOString();
  if (rawCode) localStorage.setItem(CODE_KEY, normalizeCode(rawCode));
  else localStorage.removeItem(CODE_KEY);
  ui.error = "";
  save();
  ui.flash = rawCode ? "Salvo. O outro celular entra com o mesmo código." : "Salvo neste celular.";
  render();
}

function onImport(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || ""));
      state = mergeStates(state, parsed);
      ui.flash = "Juntei o arquivo com o que já estava aqui.";
      ui.error = "";
      save();
      render();
    } catch {
      ui.error = "Esse arquivo não é uma conta do A Dois.";
      render();
    }
  };
  reader.readAsText(file);
}

function wipe() {
  const now = new Date().toISOString();
  for (const outing of state.outings) state.deleted.push({ id: outing.id, at: now });
  for (const settlement of state.settlements) state.deleted.push({ id: settlement.id, at: now });
  state.outings = [];
  state.settlements = [];
  state.divisions = (state.divisions || []).map((item) => ({ ...item, on: false, updatedAt: now }));
  ui.confirm = null;
  save();
  ui.flash = "Conta zerada neste celular e no código, se houver.";
  render();
}

function suggestCode() {
  const words = ["mesa", "casa", "rua", "cafe", "praia", "noite", "chave", "festa", "janela", "ponte"];
  const word = words[Math.floor(Math.random() * words.length)];
  return `${word}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function icon(name) {
  const paths = {
    home: '<path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-5H10v5H5a1 1 0 0 1-1-1v-8.5Z" fill="currentColor"/>',
    list: '<path d="M7 7h12M7 12h12M7 17h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    plus: '<path d="M12 6v12M6 12h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    gear: '<path fill="currentColor" fill-rule="evenodd" d="M19.14 12.94a7.5 7.5 0 0 0 .06-.94c0-.31-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.61l-1.92-3.32a.5.5 0 0 0-.59-.22l-2.39.96a7.2 7.2 0 0 0-1.62-.94l-.36-2.54A.49.49 0 0 0 13.92 2h-3.84c-.24 0-.44.17-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.5.5 0 0 0-.59.22L2.72 8.87a.5.5 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.04.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.5.5 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}

function nav(current) {
  const item = (href, key, label, extra = "") => {
    const on = current === key ? ' aria-current="page"' : "";
    return `<a href="${href}"${on} class="${extra}">${icon(key === "resumo" ? "home" : key === "saidas" ? "list" : key === "nova" ? "plus" : "gear")}<span>${label}</span></a>`;
  };
  return `<nav class="nav">
    ${item("#/", "resumo", "Início")}
    ${item("#/saidas", "saidas", "Saídas")}
    ${item("#/nova", "nova", "Nova")}
    ${item("#/ajustes", "ajustes", "Ajustes")}
  </nav>`;
}

function shell(title, body, current) {
  return `<div class="phone">
    <header class="top">
      <p class="brand">a dois</p>
      <p class="sync" data-sync-label data-state="${esc(ui.sync)}">${esc(syncLabel())}</p>
    </header>
    <main>
      ${title ? `<h1 tabindex="-1">${esc(title)}</h1>` : ""}
      ${ui.flash ? `<p class="flash" role="status">${esc(ui.flash)}</p>` : ""}
      ${ui.error ? `<p class="error" role="alert">${esc(ui.error)}</p>` : ""}
      ${body}
    </main>
    ${nav(current)}
  </div>`;
}

function expenseFields(expense) {
  const types = CATEGORIES.map(
    (category) =>
      `<label><input type="radio" name="cat-${expense.id}" value="${category.id}"${expense.category === category.id ? " checked" : ""}><span>${category.label}</span></label>`,
  ).join("");
  const pill = (value, label) =>
    `<label><input type="radio" name="paid-${expense.id}" value="${value}"${expense.paidBy === value ? " checked" : ""}>${esc(label)}</label>`;
  return `<fieldset class="form-card" data-expense data-id="${esc(expense.id)}">
    <legend>Gasto</legend>
    <label class="field">O quê<input name="label" maxlength="80" value="${esc(expense.label)}" placeholder="Jantar, uber, ingresso"></label>
    <label class="field">Valor<input name="amount" inputmode="decimal" maxlength="14" value="${esc(expense.amount)}" placeholder="0,00" autocomplete="off"></label>
    <div class="field"><span>Tipo</span><div class="types" role="radiogroup" aria-label="Tipo de gasto">${types}</div></div>
    <div class="field"><span>Quem pagou</span><div class="pills">${pill("a", nameOf("a"))}${pill("b", nameOf("b"))}${pill("split", "Metade cada")}</div></div>
    <button class="text-btn" type="button" data-action="remove-expense" data-id="${esc(expense.id)}">Tirar este gasto</button>
  </fieldset>`;
}

function renderCode() {
  app.innerHTML = `<div class="phone">
    <main class="welcome stack">
      <p class="brand">a dois</p>
      <h1 tabindex="-1">Código do casal</h1>
      <p class="lede">Os dois celulares entram com o mesmo código. Nesta primeira vez ele fica salvo neste aparelho.</p>
      ${ui.error ? `<p class="error" role="alert">${esc(ui.error)}</p>` : ""}
      <form id="code-form" class="stack">
        <label class="field">Código<input class="code-input" name="code" maxlength="40" autocapitalize="none" spellcheck="false" autocomplete="off" placeholder="mesa-4821" value="${esc(ui.codeDraft)}" required></label>
        <button class="ghost" type="button" data-action="generate-code">Gerar um código</button>
        <button class="primary" type="submit"${ui.entering ? " disabled" : ""}>${ui.entering ? "Entrando…" : "Entrar"}</button>
      </form>
      <p class="hint">Quem já tem a conta cola o código. Quem está começando gera um e manda para o outro.</p>
    </main>
  </div>`;
}

function renderWelcome() {
  app.innerHTML = `<div class="phone">
    <main class="welcome stack">
      <p class="brand">a dois</p>
      <h1 tabindex="-1">O que vocês fizeram e quem pagou.</h1>
      <p class="lede">Anota o dia, a saída e cada gasto. O mês mostra o total e quem pagou.</p>
      ${ui.error ? `<p class="error" role="alert">${esc(ui.error)}</p>` : ""}
      <form id="welcome-form" class="stack">
        <label class="field">Seu nome<input name="nameA" maxlength="40" autocomplete="given-name" required placeholder="Ana"></label>
        <label class="field">Quem mora com você<input name="nameB" maxlength="40" autocomplete="off" required placeholder="Leo"></label>
        <button class="primary" type="submit">Começar</button>
      </form>
      <p class="hint">O código deste celular já ficou salvo. Os nomes também ficam depois desta tela.</p>
    </main>
  </div>`;
}

function renderResumo() {
  const summary = summarize(state, ui.month);
  const current = monthKey(new Date());
  const recent = sortByDateDesc(state.outings.filter((item) => item.date.startsWith(ui.month))).slice(0, 3);
  const average = summary.outingCount ? Math.round(summary.totalCents / summary.outingCount) : 0;
  const cats = summary.byCat
    .map((cat) => {
      const pct = summary.totalCents ? Math.max(4, Math.round((cat.cents / summary.totalCents) * 100)) : 0;
      return `<div class="cat">
        <div class="cat-top"><span>${esc(categoryLabel(cat.id))}</span><span>${esc(formatBRL(cat.cents))}</span></div>
        <div class="track"><div class="fill" style="width:${pct}%"></div></div>
      </div>`;
    })
    .join("");
  const cards = recent.map(outingCard).join("");
  const body = `
    <div class="monthbar">
      <button class="icon-btn" type="button" data-action="month" data-dir="-1" aria-label="Mês anterior">‹</button>
      <h1 tabindex="-1">${esc(formatMonth(ui.month))}</h1>
      <button class="icon-btn" type="button" data-action="month" data-dir="1" aria-label="Próximo mês"${ui.month >= current ? " disabled" : ""}>›</button>
    </div>
    ${summary.outingCount ? `<p class="total">${esc(formatBRL(summary.totalCents))}</p>` : ""}
    ${
      summary.outingCount
        ? `<p class="stats">${esc(pluralSaidas(summary.outingCount))}${summary.totalCents ? ` · média ${esc(formatBRL(average))}` : ""}</p>`
        : ""
    }
    ${
      summary.outingCount === 0
        ? `<section class="empty">
            <h2>Nenhuma saída em ${esc(formatMonth(ui.month))}.</h2>
            <p class="lede">Quando vocês saírem, anota o que fizeram e quem pagou.</p>
            <a class="primary" href="#/nova" style="display:inline-block;text-decoration:none;text-align:center">Nova saída</a>
          </section>`
        : `<div class="pair">
            <article class="who who-a"><h2>${esc(nameOf("a"))}</h2><p class="money">${esc(formatBRL(summary.paidA))}</p><p>pagou nas saídas</p></article>
            <article class="who who-b"><h2>${esc(nameOf("b"))}</h2><p class="money">${esc(formatBRL(summary.paidB))}</p><p>pagou nas saídas</p></article>
          </div>`
    }
    ${cats ? `<h2 class="section-title">Por tipo</h2><div class="cats">${cats}</div>` : ""}
    ${cards ? `<h2 class="section-title">Neste mês</h2><div class="cards">${cards}</div><p><a href="#/saidas">Ver o caderno inteiro</a></p>` : ""}
  `;
  app.innerHTML = shell("", body, "resumo");
}

function outingCard(outing) {
  const when = formatDayParts(outing.date);
  const total = outingTotal(outing);
  return `<a class="card" href="#/saida/${esc(outing.id)}">
    <time class="day" datetime="${esc(outing.date)}"><b>${esc(when.day)}</b><span>${esc(when.month)}</span><span class="year">${esc(when.year)}</span></time>
    <span class="card-body"><span><h2>${esc(outing.title)}</h2><p>${esc([outing.place, payerSummary(outing)].filter(Boolean).join(" · "))}</p></span></span>
    <strong>${total ? esc(formatBRL(total)) : ""}</strong>
  </a>`;
}

function renderSaidas() {
  const query = ui.search.trim().toLowerCase();
  const items = sortByDateDesc(state.outings).filter((outing) => {
    if (!query) return true;
    const blob = [outing.title, outing.place, outing.note, ...outing.expenses.map((expense) => expense.label)]
      .join(" ")
      .toLowerCase();
    return blob.includes(query);
  });
  const body = `
    <input class="search" id="search" type="search" placeholder="Buscar saída ou gasto" value="${esc(ui.search)}">
    ${
      items.length
        ? `<div class="cards" id="outing-list">${items.map(outingCard).join("")}</div>`
        : `<section class="empty"><h2>${query ? "Nada com esse texto." : "O caderno ainda está em branco."}</h2><p class="lede">${query ? "Tenta outra palavra." : "A primeira saída começa pelo botão Nova."}</p></section>`
    }
  `;
  app.innerHTML = shell("Saídas", body, "saidas");
  const search = document.getElementById("search");
  if (search && ui.search) {
    search.focus();
    const end = search.value.length;
    search.setSelectionRange(end, end);
  }
}

function renderForm() {
  const editing = state.outings.find((item) => item.id === ui.editingId);
  if (ui.editingId && !editing) {
    app.innerHTML = shell("Essa saída não está mais aqui.", `<p><a href="#/saidas">Voltar ao caderno</a></p>`, "saidas");
    return;
  }
  if (!ui.draft) ui.draft = editing ? draftFromOuting(editing) : blankDraft();
  const draft = ui.draft;
  const body = `<form id="outing-form" class="stack" autocomplete="off">
    ${dateFieldHtml(dateSource(draft))}
    <label class="field">O que vocês fizeram<input name="title" maxlength="80" required value="${esc(draft.title)}" placeholder="Jantar, cinema, mercado"></label>
    <label class="field">Onde<input name="place" maxlength="80" value="${esc(draft.place)}" placeholder="Bairro, restaurante, casa"></label>
    <label class="field">Nota<textarea name="note" maxlength="400" placeholder="O que ficou da noite">${esc(draft.note)}</textarea></label>
    <h2 class="section-title">Gastos</h2>
    ${draft.expenses.map(expenseFields).join("")}
    <button class="ghost" type="button" data-action="add-expense">Mais um gasto</button>
    <p class="form-total"><span>Total</span><strong id="form-total">R$ 0,00</strong></p>
    <button class="primary" type="submit">${editing ? "Salvar alterações" : "Salvar saída"}</button>
    ${editing ? `<a href="#/saida/${esc(editing.id)}">Cancelar</a>` : ""}
  </form>`;
  app.innerHTML = shell(editing ? "Editar saída" : "Nova saída", body, "nova");
  updateFormTotal();
}

function renderDetalhe() {
  const outing = state.outings.find((item) => item.id === ui.editingId);
  if (!outing) {
    app.innerHTML = shell("Essa saída não está mais aqui.", `<p><a href="#/saidas">Voltar ao caderno</a></p>`, "saidas");
    return;
  }
  const when = formatDayParts(outing.date);
  const lines = outing.expenses
    .map(
      (expense) => `<li class="expense">
        <div><strong>${esc(expense.label)}</strong><span class="sub">${esc(categoryLabel(expense.category))} · ${esc(payerLabel(expense.paidBy))}</span></div>
        <b>${esc(formatBRL(expense.amountCents))}</b>
      </li>`,
    )
    .join("");
  const asking = ui.confirm?.kind === "outing" && ui.confirm.id === outing.id;
  const body = `
    <p class="kicker">${esc(when.week)}, ${esc(formatDateLong(outing.date))}</p>
    ${outing.place ? `<p class="place">${esc(outing.place)}</p>` : ""}
    ${outing.note ? `<p class="note">${esc(outing.note)}</p>` : ""}
    ${lines ? `<ul class="expense-list">${lines}</ul>` : `<p class="lede">Sem gastos nesta saída.</p>`}
    <p class="form-total"><span>Total</span><strong>${esc(formatBRL(outingTotal(outing)))}</strong></p>
    <div class="actions">
      <a class="ghost" href="#/editar/${esc(outing.id)}" style="text-decoration:none">Editar</a>
      <button class="danger" type="button" data-action="ask-delete" data-kind="outing" data-id="${esc(outing.id)}">Apagar</button>
    </div>
    ${asking ? confirmBox() : ""}
    <p><a href="#/saidas">Todas as saídas</a></p>
  `;
  app.innerHTML = shell(outing.title, body, "saidas");
}

function renderAjustes() {
  const code = localStorage.getItem(CODE_KEY) || "";
  let syncHint = "Sem código, a conta fica só neste celular.";
  if (code && ui.persistent === true) syncHint = "Os dois celulares com esse código veem as mesmas saídas.";
  if (code && ui.persistent === false) {
    syncHint = "Este servidor não guarda a conta entre visitas. O celular continua com os dados. Para os dois ficarem juntos o tempo todo, liga o Redis do projeto.";
  }
  if (code && ui.sync === "error") syncHint = "Não cheguei no servidor. Os dados continuam neste celular.";
  const body = `<form id="settings-form" class="stack">
      <label class="field">Nome 1<input name="nameA" maxlength="40" value="${esc(state.names.a)}" required></label>
      <label class="field">Nome 2<input name="nameB" maxlength="40" value="${esc(state.names.b)}" required></label>
      <label class="field">Código do casal<input name="code" maxlength="40" autocapitalize="none" spellcheck="false" value="${esc(code)}" placeholder="mesa-4821"></label>
      <p class="hint">É a senha da conta. Quem tiver o código vê as saídas. Quanto mais longo, melhor.</p>
      <p class="hint">${esc(syncHint)}</p>
      <div class="actions">
        <button class="ghost" type="button" data-action="generate-code">Gerar código</button>
        <button class="primary" type="submit">Salvar</button>
      </div>
    </form>
    <div class="actions">
      <button class="ghost" type="button" data-action="sync-now">Trazer agora</button>
      <button class="ghost" type="button" data-action="export">Exportar arquivo</button>
      <label class="ghost file">Importar arquivo<input type="file" accept="application/json,.json" data-action="import"></label>
    </div>
    <h2 class="section-title">Instalar</h2>
    <p class="lede">No celular ele vira um app: ícone na tela inicial e tela cheia, sem a barra do navegador.</p>
    ${
      installEvent
        ? `<button class="primary" type="button" data-action="install-app">Instalar neste celular</button>`
        : ""
    }
    <p class="hint">iPhone: Safari, botão Compartilhar, Adicionar à Tela de Início. Android: Chrome, menu de três pontos, Instalar app.</p>
    <h2 class="section-title">O que fica anotado</h2>
    <p class="lede">Cada gasto entra no total de quem pagou na saída.</p>
    ${
      ui.confirm?.kind === "wipe"
        ? confirmBox()
        : `<button class="danger" type="button" data-action="ask-delete" data-kind="wipe" data-id="all">Zerar saídas</button>`
    }
  `;
  app.innerHTML = shell("Ajustes", body, "ajustes");
}

function confirmBox() {
  if (!ui.confirm) return "";
  const copy = {
    outing: "Apagar essa saída? Os gastos saem da conta dos dois, se o código estiver ligado.",
    wipe: "Zerar tudo? Nomes e código ficam. As saídas somem nos dois celulares.",
  }[ui.confirm.kind];
  return `<div class="confirm">
    <p>${copy}</p>
    <div class="actions">
      <button class="danger" type="button" data-action="confirm-delete">Apagar</button>
      <button class="ghost" type="button" data-action="cancel-confirm">Cancelar</button>
    </div>
  </div>`;
}

function render() {
  document.title = onboarded() ? `A Dois · ${state.names.a} e ${state.names.b}` : "A Dois";
  if (!codeOf() || ui.view === "codigo") {
    renderCode();
    return;
  }
  if (!onboarded() || ui.view === "boas-vindas") {
    renderWelcome();
    return;
  }
  if (ui.view === "saidas") renderSaidas();
  else if (ui.view === "nova") renderForm();
  else if (ui.view === "detalhe") renderDetalhe();
  else if (ui.view === "ajustes") renderAjustes();
  else renderResumo();
}

app.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.target.id === "code-form") onCode(event.target);
  else if (event.target.id === "welcome-form") onWelcome(event.target);
  else if (event.target.id === "outing-form") onSaveOuting(event.target);
  else if (event.target.id === "settings-form") onSaveSettings(event.target);
});

app.addEventListener("input", (event) => {
  if (event.target.id === "search") {
    ui.search = event.target.value;
    const items = sortByDateDesc(state.outings).filter((outing) => {
      const query = ui.search.trim().toLowerCase();
      if (!query) return true;
      const blob = [outing.title, outing.place, outing.note, ...outing.expenses.map((expense) => expense.label)]
        .join(" ")
        .toLowerCase();
      return blob.includes(query);
    });
    const list = document.getElementById("outing-list");
    const empty = app.querySelector(".empty");
    if (!items.length) {
      if (list) list.remove();
      if (!empty) {
        const section = document.createElement("section");
        section.className = "empty";
        section.innerHTML = "<h2>Nada com esse texto.</h2><p class=\"lede\">Tenta outra palavra.</p>";
        event.target.after(section);
      }
      return;
    }
    if (empty) empty.remove();
    const html = items.map(outingCard).join("");
    if (list) list.innerHTML = html;
    else {
      const wrap = document.createElement("div");
      wrap.className = "cards";
      wrap.id = "outing-list";
      wrap.innerHTML = html;
      event.target.after(wrap);
    }
    return;
  }
  if (event.target.closest("#outing-form")) updateFormTotal();
});

app.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action], [data-go]");
  if (!button) return;
  if (button.dataset.go) {
    go(button.dataset.go);
    return;
  }
  const action = button.dataset.action;
  if (action === "month") {
    ui.month = shiftMonth(ui.month, Number(button.dataset.dir));
    ui.confirm = null;
    render();
    return;
  }
  if (action === "add-expense") {
    ui.draft = readOutingForm(document.getElementById("outing-form"));
    ui.draft.forId = ui.editingId || null;
    ui.draft.expenses.push({ id: newId(), label: "", amount: "", category: "comida", paidBy: "a" });
    render();
    return;
  }
  if (action === "remove-expense") {
    ui.draft = readOutingForm(document.getElementById("outing-form"));
    ui.draft.forId = ui.editingId || null;
    ui.draft.expenses = ui.draft.expenses.filter((expense) => expense.id !== button.dataset.id);
    if (!ui.draft.expenses.length) {
      ui.draft.expenses.push({ id: newId(), label: "", amount: "", category: "comida", paidBy: "a" });
    }
    render();
    return;
  }
  if (action === "ask-delete") {
    ui.confirm = { kind: button.dataset.kind, id: button.dataset.id };
    render();
    return;
  }
  if (action === "cancel-confirm") {
    ui.confirm = null;
    render();
    return;
  }
  if (action === "confirm-delete") {
    const pending = ui.confirm;
    if (!pending) return;
    if (pending.kind === "wipe") {
      wipe();
      return;
    }
    if (pending.kind === "outing") {
      state.outings = state.outings.filter((item) => item.id !== pending.id);
      tombstone(pending.id);
      ui.confirm = null;
      save();
      go("#/saidas", "Saída apagada.");
    }
  }
  if (action === "generate-code") {
    const input = app.querySelector("[name=code]");
    if (input) {
      input.value = suggestCode();
      ui.codeDraft = input.value;
    }
    return;
  }
  if (action === "export") {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "a-dois.json";
    link.click();
    URL.revokeObjectURL(link.href);
    return;
  }
  if (action === "install-app") {
    if (!installEvent) return;
    const prompt = installEvent;
    installEvent = null;
    prompt.prompt();
    prompt.userChoice.finally(() => {
      if (ui.view === "ajustes") render();
    });
    return;
  }
  if (action === "sync-now") {
    if (!codeOf()) {
      ui.flash = "Define um código e salva para juntar os dois celulares.";
      render();
      return;
    }
    const sentRev = rev;
    const payload = JSON.parse(JSON.stringify(state));
    ui.sync = "busy";
    paintSync();
    syncNow(sentRev, payload)
      .then(() => {
        ui.flash = ui.sync === "ok" ? "Atualizado." : "Não consegui sincronizar.";
        render();
      })
      .catch(() => {
        ui.sync = "error";
        ui.flash = "Não consegui sincronizar. A conta continua neste celular.";
        render();
      });
  }
});

app.addEventListener("change", (event) => {
  if (event.target.matches("[data-action=import]")) {
    const file = event.target.files?.[0];
    if (file) onImport(file);
  }
});

window.addEventListener("hashchange", syncFromHash);

if (codeOf() && onboarded() && (!location.hash || location.hash === "#")) {
  history.replaceState(null, "", "#/");
}
syncFromHash();
if (codeOf()) enqueueSync();

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installEvent = event;
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (ui.view === "ajustes" && !typing) render();
});

window.addEventListener("appinstalled", () => {
  installEvent = null;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
