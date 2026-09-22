import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  formatBRL,
  formatDateLong,
  joinISO,
  mergeStates,
  monthDivided,
  normalizeCode,
  parseMoney,
  sanitizeState,
  shiftMonth,
  splitISO,
  summarize,
} from "../logic.js";
import { handleCasal } from "../api/_lib/casal.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "casal-"));
process.env.DATA_DIR = dir;
delete process.env.VERCEL;

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL", msg);
    return;
  }
  console.log("ok", msg);
}

function outing(id, date, expenses, updatedAt = `${date}T12:00:00.000Z`) {
  return {
    id,
    date,
    title: "Jantar",
    place: "Centro",
    note: "",
    expenses,
    createdAt: updatedAt,
    updatedAt,
  };
}

function expense(id, amountCents, paidBy, category = "comida") {
  return { id, label: "Conta", amountCents, category, paidBy };
}

const idA = "11111111-1111-1111-1111-111111111111";
const idB = "22222222-2222-2222-2222-222222222222";
const expA = "33333333-3333-3333-3333-333333333333";
const expB = "44444444-4444-4444-4444-444444444444";
const setA = "55555555-5555-5555-5555-555555555555";

assert(parseMoney("42,50") === 4250, "vírgula vira centavos");
assert(parseMoney("1.234,56") === 123456, "milhar brasileiro");
assert(parseMoney("R$ 10") === 1000, "aceita cifrão");
assert(parseMoney("10,5") === 1050, "um decimal");
assert(parseMoney("") === null, "vazio não é número");
assert(parseMoney("10,555") === null, "três decimais não passam");
assert(parseMoney("-5") === null, "negativo não passa");
assert(normalizeCode(" Mesa 4821 ") === "mesa-4821", "código normaliza");
assert(normalizeCode("12345678") === null, "código só de número não passa");
assert(normalizeCode("abc") === null, "código curto não passa");
assert(shiftMonth("2026-01", -1) === "2025-12", "mês volta o ano");
assert(formatBRL(4000).includes("40,00"), "real brasileiro");
assert(joinISO(22, 9, 2026) === "2026-09-22", "dia, mês e ano viram a data");
assert(joinISO("31", "02", "2026") === null, "31 de fevereiro não passa");
assert(formatDateLong("2026-09-22") === "22 de setembro de 2026", "data mostra dia, mês e ano");
assert(splitISO("2026-09-05").day === "5" && splitISO("2026-09-05").month === "09", "separa a data nessa ordem");

const base = {
  names: { a: "Ana", b: "Leo" },
  metaUpdatedAt: "2026-09-01T00:00:00.000Z",
  outings: [
    outing(idA, "2026-09-10", [expense(expA, 18000, "a")]),
    outing(idB, "2026-09-12", [expense(expB, 10000, "b")]),
  ],
  settlements: [],
  deleted: [],
};
const summary = summarize(sanitizeState(base), "2026-09");
assert(summary.totalCents === 28000, "total do mês");
assert(summary.paidA === 18000 && summary.paidB === 10000, "quem pagou");
assert(summary.settle === 4000, "Leo deve 40 para Ana");
assert(summarize(sanitizeState(base), "2026-10").outingCount === 0, "outro mês fica de fora");

const split = summarize(
  sanitizeState({
    ...base,
    outings: [outing(idA, "2026-09-10", [expense(expA, 101, "split")])],
  }),
  "2026-09",
);
assert(split.settle === 0, "centavo solto de metade cada não vira dívida");

const settled = summarize(
  sanitizeState({
    ...base,
    settlements: [
      {
        id: setA,
        date: "2026-09-20",
        from: "b",
        to: "a",
        amountCents: 4000,
        note: "pix",
        createdAt: "2026-09-20T00:00:00.000Z",
        updatedAt: "2026-09-20T00:00:00.000Z",
      },
    ],
  }),
  "2026-09",
);
assert(settled.settle === 0, "acerto zera a diferença");
assert(monthDivided(sanitizeState(base), "2026-09") === false, "sem pedido, o mês não está dividido");

const divOn = "77777777-7777-7777-7777-777777777777";
const divOff = "88888888-8888-8888-8888-888888888888";
const divided = sanitizeState({
  ...base,
  divisions: [{ id: divOn, month: "2026-09", on: true, updatedAt: "2026-09-20T00:00:00.000Z" }],
});
assert(monthDivided(divided, "2026-09") === true, "dividir liga a conta do mês");
assert(divided.divisions.length === 1 && divided.divisions[0].id === divOn, "a divisão fica no mês");
assert(
  monthDivided(
    mergeStates(divided, {
      ...base,
      divisions: [{ id: divOff, month: "2026-09", on: false, updatedAt: "2026-09-21T00:00:00.000Z" }],
    }),
    "2026-09",
  ) === false,
  "desfazer a divisão mais nova vale nos dois celulares",
);
assert(
  sanitizeState({ divisions: [{ month: "2026-13", on: true }, { month: "nope", on: true }] }).divisions.length === 0,
  "mês inválido não vira divisão",
);

const remoteOnly = "66666666-6666-6666-6666-666666666666";
const merged = mergeStates(base, {
  ...base,
  metaUpdatedAt: "2026-09-02T00:00:00.000Z",
  names: { a: "Ana", b: "Léo" },
  outings: [outing(remoteOnly, "2026-09-15", [expense(expB, 5000, "b")])],
});
assert(merged.outings.length === 3, "merge junta as saídas dos dois");
assert(merged.names.b === "Léo", "nome mais novo fica");
const keptNames = mergeStates(
  { ...merged, metaUpdatedAt: "2026-09-22T18:00:00.000Z" },
  { names: { a: "", b: "" }, metaUpdatedAt: "2026-09-22T19:00:00.000Z", outings: [], settlements: [], deleted: [] },
);
assert(keptNames.names.a === "Ana" && keptNames.names.b === "Léo", "celular novo não apaga os nomes");

const removed = mergeStates(merged, {
  ...merged,
  outings: merged.outings.filter((item) => item.id !== idA),
  deleted: [{ id: idA, at: "2026-09-21T00:00:00.000Z" }],
});
assert(!removed.outings.some((item) => item.id === idA), "apagar em um celular some no outro");

const revived = mergeStates(removed, {
  ...base,
  outings: [outing(idA, "2026-09-10", [expense(expA, 18000, "a")], "2026-09-22T00:00:00.000Z")],
});
assert(revived.outings.some((item) => item.id === idA), "edição depois do apagar volta a saída");

async function post(body, method = "POST") {
  return handleCasal({ method, headers: {}, body });
}

const first = await post({ code: "mesa-4821", state: base });
assert(first.status === 200 && first.json.ok, "grava a conta");
assert(first.json.persistent === true, "no computador a conta fica em disco");
assert(first.json.state.outings.length === 2, "devolve as saídas");

const raw = fs.readFileSync(path.join(dir, "casal.json"), "utf8");
assert(!raw.includes("mesa-4821"), "o código não fica escrito no arquivo");
assert(raw.includes("Ana"), "os nomes ficam na conta");

const other = await post({ code: "outra-chave", state: { names: { a: "Lia", b: "Rui" }, outings: [], settlements: [], deleted: [] } });
assert(other.json.state.outings.length === 0, "outro código não vê a conta");

const second = await post({
  code: "mesa-4821",
  state: {
    names: { a: "Ana", b: "Leo" },
    metaUpdatedAt: "2026-09-01T00:00:00.000Z",
    outings: [outing(remoteOnly, "2026-09-18", [expense(expA, 2000, "a", "transporte")])],
    settlements: [],
    deleted: [],
  },
});
assert(second.json.state.outings.length === 3, "o segundo celular soma a saída nova");

const badCode = await post({ code: "1234", state: base });
assert(badCode.status === 400, "código fraco é recusado");
const badJson = await post("{");
assert(badJson.status === 400, "json inválido é recusado");
const badMethod = await post(null, "GET");
assert(badMethod.status === 405, "só aceita post");

if (failed) {
  console.error(`${failed} falha(s)`);
  process.exit(1);
}
console.log("tudo certo");
