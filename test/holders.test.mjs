import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { groupWalletsByUser, mapWithConcurrency, plannedRoleChanges, totalHolding } from "../dist/holders.js";

const TIERS = [
  { roleId: "bronze", nftCount: 1 },
  { roleId: "gold", nftCount: 5 },
];

test("a member who sold everything loses every tier role", () => {
  deepStrictEqual(plannedRoleChanges(new Set(["bronze", "gold"]), TIERS, 0), { add: [], remove: ["bronze", "gold"], active: [] });
});

test("a member who sold down to one tier keeps only that tier", () => {
  deepStrictEqual(plannedRoleChanges(new Set(["bronze", "gold"]), TIERS, 1), { add: [], remove: ["gold"], active: ["bronze"] });
});

test("a member who still qualifies is left alone", () => {
  deepStrictEqual(plannedRoleChanges(new Set(["bronze", "gold"]), TIERS, 5), { add: [], remove: [], active: ["bronze", "gold"] });
});

test("a new holder gains every tier they qualify for", () => {
  deepStrictEqual(plannedRoleChanges(new Set(), TIERS, 9), { add: ["bronze", "gold"], remove: [], active: ["bronze", "gold"] });
});

test("roles outside the configured tiers are never touched", () => {
  deepStrictEqual(plannedRoleChanges(new Set(["mod", "bronze"]), TIERS, 0), { add: [], remove: ["bronze"], active: [] });
});

test("wallets are grouped per user", () => {
  const verified = [
    { discordUserId: "u1", walletAddress: "wA" },
    { discordUserId: "u1", walletAddress: "wB" },
    { discordUserId: "u2", walletAddress: "wC" },
  ];
  deepStrictEqual([...groupWalletsByUser(verified)], [["u1", ["wA", "wB"]], ["u2", ["wC"]]]);
});

test("holdings are summed across a user's wallets, so an empty second wallet costs nothing", () => {
  strictEqual(totalHolding([9, 0]), 9);
  strictEqual(totalHolding([0, 0]), 0);
});

test("an unreadable wallet is not treated as a zero balance", () => {
  strictEqual(totalHolding([9, undefined]), undefined);
  strictEqual(totalHolding([undefined]), undefined);
});

test("concurrency is capped and every item still runs", async () => {
  let live = 0;
  let peak = 0;
  const done = [];
  await mapWithConcurrency([...Array(20).keys()], 4, async (item) => {
    peak = Math.max(peak, ++live);
    await new Promise((r) => setTimeout(r, 5));
    live--;
    done.push(item);
  });
  strictEqual(peak <= 4, true);
  strictEqual(done.length, 20);
});

test("an empty list does not hang", async () => {
  await mapWithConcurrency([], 4, async () => {
    throw Error("must not run");
  });
});
