import { describe, expect, it } from "vitest";
import { diffValues } from "./audit-event";

describe("diferença da auditoria", () => {
  it("lista só as folhas alteradas, com antes e depois", () => {
    const before = { sync: { cron: "*/5 * * * *", pageSize: 50 }, documents: { prefix: "VIS" }, list: [1, 2] };
    const after = { sync: { cron: "*/10 * * * *", pageSize: 50 }, documents: { prefix: "VIS" }, list: [1, 2, 3], novo: true };
    expect(diffValues(before, after)).toEqual([
      { path: "sync.cron", before: "*/5 * * * *", after: "*/10 * * * *" },
      { path: "list", before: [1, 2], after: [1, 2, 3] },
      { path: "novo", before: null, after: true },
    ]);
  });

  it("nunca grava o valor de campos secretos", () => {
    expect(diffValues({ appSecret: "a" }, { appSecret: "b" })).toEqual([{ path: "appSecret", before: "[oculto]", after: "[alterado]" }]);
    expect(diffValues({ conta: { app_secret: "a" } }, { conta: { app_secret: "a" } })).toEqual([]);
  });
});
