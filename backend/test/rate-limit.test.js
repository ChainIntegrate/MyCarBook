"use strict";
// MCB-02: dietro Nginx, senza "trust proxy" tutti i client condividevano
// un solo contatore. Ora ogni IP reale (X-Forwarded-For da Nginx) ha il suo.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startApp } = require("./helpers");

async function hit(base, ip) {
  const res = await fetch(`${base}/api/pin-json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: "{}"
  });
  return res.status;
}

test("un client che esaurisce il limite non blocca gli altri", async () => {
  const ctx = await startApp({ limits: { json: 3 } });
  try {
    for (let i = 0; i < 3; i++) await hit(ctx.base, "203.0.113.10");
    assert.equal(await hit(ctx.base, "203.0.113.10"), 429, "l'attaccante viene limitato");
    assert.notEqual(await hit(ctx.base, "198.51.100.7"), 429, "un altro utente no");
  } finally {
    await ctx.close();
  }
});

test("controprova: con trust proxy disattivato (configurazione precedente) il blocco è globale", async () => {
  const ctx = await startApp({ limits: { json: 3 }, env: { TRUST_PROXY: "false" } });
  try {
    for (let i = 0; i < 3; i++) await hit(ctx.base, "203.0.113.10");
    assert.equal(await hit(ctx.base, "198.51.100.7"), 429);
  } finally {
    await ctx.close();
  }
});
