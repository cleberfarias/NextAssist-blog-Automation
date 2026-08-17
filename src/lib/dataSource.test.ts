import assert from "node:assert/strict";
import test from "node:test";
import { readStateJson } from "./dataSource.js";
import { config } from "../config.js";

test("readStateJson (modo local) lê o caminho informado e devolve o fallback se faltar", async () => {
  assert.equal(config.dataSource, "local"); // guarda: este teste assume o modo default
  const missing = await readStateJson(new URL("file:///caminho/que/nao/existe.json"), { ok: false });
  assert.deepEqual(missing, { ok: false });
});
