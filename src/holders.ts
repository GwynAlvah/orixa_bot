export interface HolderTier {
  roleId: string;
  nftCount: number;
}

export function groupWalletsByUser(verified: Array<{ discordUserId: string; walletAddress: string }>) {
  const byUser = new Map<string, string[]>();
  for (const entry of verified) {
    const wallets = byUser.get(entry.discordUserId) ?? [];
    wallets.push(entry.walletAddress);
    byUser.set(entry.discordUserId, wallets);
  }
  return byUser;
}

// undefined means a wallet's balance could not be read, which is deliberately different from
// zero: treating it as zero would strip roles from a holder whenever the RPC hiccups.
export function totalHolding(counts: Array<number | undefined>) {
  if (counts.some((c) => c === undefined)) return undefined;
  return counts.reduce<number>((sum, c) => sum + (c ?? 0), 0);
}

// The full picture for one member: which tier roles they should hold at this balance, and which
// they currently hold but no longer qualify for.
export function plannedRoleChanges(currentRoleIds: Set<string>, tiers: HolderTier[], nftCount: number) {
  const active = tiers.filter((t) => nftCount >= t.nftCount).map((t) => t.roleId);
  const add = active.filter((roleId) => !currentRoleIds.has(roleId));
  const remove = tiers.map((t) => t.roleId).filter((roleId) => currentRoleIds.has(roleId) && !active.includes(roleId));
  return { add, remove, active };
}

// Keeps a burst of wallets from being fired at the RPC all at once.
export async function mapWithConcurrency<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await run(item);
  });
  await Promise.all(workers);
}
