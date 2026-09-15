import assert from "node:assert/strict";
import test from "node:test";
import { buildSalesLeadsFromEvents } from "./funnel.js";
import type { ConversionEvent } from "../conversions.js";

const events: ConversionEvent[] = [
  {
    name: "page_view",
    anonymousId: "anon-1",
    path: "/precos",
    source: "instagram",
    content: "controle-de-pecas",
    createdAt: "2026-09-12T10:00:00.000Z",
  },
  {
    name: "trial_started",
    anonymousId: "anon-1",
    content: "controle-de-pecas",
    createdAt: "2026-09-12T10:05:00.000Z",
  },
  {
    name: "signup_completed",
    anonymousId: "anon-1",
    userId: "user-1",
    createdAt: "2026-09-12T10:06:00.000Z",
  },
  {
    name: "first_order_created",
    userId: "user-1",
    createdAt: "2026-09-12T11:00:00.000Z",
  },
];

test("une navegação anônima e usuário autenticado no mesmo lead", () => {
  const leads = buildSalesLeadsFromEvents(events);
  assert.equal(leads.length, 1);
  assert.equal(leads[0]?.leadId, "anon-1");
  assert.equal(leads[0]?.userId, "user-1");
  assert.equal(leads[0]?.source, "instagram");
  assert.deepEqual(leads[0]?.signals.map((signal) => signal.name), [
    "pricing_view",
    "trial_started",
    "signup_completed",
    "first_order_created",
  ]);
});

test("ignora eventos sem identidade comercial utilizável", () => {
  const leads = buildSalesLeadsFromEvents([
    { name: "page_view", path: "/", createdAt: "2026-09-12T10:00:00.000Z" },
  ]);
  assert.deepEqual(leads, []);
});
