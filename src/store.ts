import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface PendingVerification {
  discordUserId: string;
  walletAddress: string;
  code: string;
  expiresAt: number;
}

export interface RoleTier {
  roleId: string;
  nftCount: number;
}

export interface GuildSetup {
  channelId: string;
  contractAddress: string;
  tiers: RoleTier[];
}

export interface WalletSubmissionSetup {
  name: string;
  channelId: string;
  messageId?: string;
  allowedRoleIds: string[];
  opensAt: number;
  closesAt: number | null;
}

export interface WalletSubmissionEntry {
  discordUserId: string;
  discordUsername: string;
  walletAddress: string;
  submittedAt: number;
}

export interface VerifiedWalletEntry {
  discordUserId: string;
  walletAddress: string;
  verifiedAt: number;
}

export interface RaffleConfig {
  announceChannelId?: string;
  winnerChannelId?: string;
}

export interface RaffleEntry {
  discordUserId: string;
  discordUsername: string;
  walletAddress: string;
  enteredAt: number;
}

export interface Raffle {
  key: string;
  name: string;
  announceChannelId: string;
  winnerChannelId: string;
  messageId?: string;
  winnerCount: number;
  allowedRoleIds: string[];
  startsAt: number;
  endsAt: number | null;
  drawnAt: number | null;
  entries: Record<string, RaffleEntry>;
  winners: RaffleEntry[];
}

interface Data {
  pending: Record<string, PendingVerification>;
  verified: Record<string, { discordUserId: string; walletAddress: string; verifiedAt: number }>;
  guildSetups: Record<string, GuildSetup>;
  walletSubmissionSetups: Record<string, Record<string, WalletSubmissionSetup>>;
  walletSubmissions: Record<string, Record<string, Record<string, WalletSubmissionEntry>>>;
  raffleConfigs: Record<string, RaffleConfig>;
  raffleWallets: Record<string, Record<string, string>>;
  raffles: Record<string, Record<string, Raffle>>;
}

export class VerificationStore {
  private data: Data = {
    pending: {},
    verified: {},
    guildSetups: {},
    walletSubmissionSetups: {},
    walletSubmissions: {},
    raffleConfigs: {},
    raffleWallets: {},
    raffles: {},
  };

  private queue = Promise.resolve();

  constructor(private file: string) {}

  async initialize() {
    try {
      const p = JSON.parse(await readFile(this.file, "utf8")) as Partial<Data> & {
        walletSubmissionSetups?: unknown;
        walletSubmissions?: unknown;
        raffleConfigs?: unknown;
        raffleWallets?: unknown;
        raffles?: unknown;
      };
      this.data = {
        pending: p.pending ?? {},
        verified: p.verified ?? {},
        guildSetups: p.guildSetups ?? {},
        walletSubmissionSetups: normalizeWalletSubmissionSetups(p.walletSubmissionSetups),
        walletSubmissions: normalizeWalletSubmissions(p.walletSubmissions),
        raffleConfigs: normalizeRaffleConfigs(p.raffleConfigs),
        raffleWallets: normalizeRaffleWallets(p.raffleWallets),
        raffles: normalizeRaffles(p.raffles),
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      await this.save();
    }
  }

  getPending(id: string) {
    const p = this.data.pending[id];
    return p ? { ...p } : undefined;
  }

  getGuildSetup(id: string) {
    const s = this.data.guildSetups[id];
    return s ? { ...s, tiers: s.tiers.map((t) => ({ ...t })) } : undefined;
  }

  walletOwner(w: string) {
    return this.data.verified[w.toLowerCase()]?.discordUserId;
  }

  getVerifiedWallets() {
    return Object.values(this.data.verified).map((entry) => ({ ...entry }));
  }

  getWalletSubmissionSetup(guildId: string, submissionKey: string) {
    const s = this.data.walletSubmissionSetups[guildId]?.[submissionKey];
    return s ? { ...s, allowedRoleIds: [...s.allowedRoleIds] } : undefined;
  }

  getWalletSubmissions(guildId: string, submissionKey: string) {
    return Object.values(this.data.walletSubmissions[guildId]?.[submissionKey] ?? {}).map((entry) => ({ ...entry }));
  }

  getRaffleConfig(guildId: string) {
    const c = this.data.raffleConfigs[guildId];
    return c ? { ...c } : {};
  }

  getRaffleWallet(guildId: string, discordUserId: string) {
    return this.data.raffleWallets[guildId]?.[discordUserId];
  }

  getRaffle(guildId: string, raffleKey: string) {
    const r = this.data.raffles[guildId]?.[raffleKey];
    return r ? cloneRaffle(r) : undefined;
  }

  listRaffles(guildId: string) {
    return Object.values(this.data.raffles[guildId] ?? {}).map(cloneRaffle);
  }

  listActiveRaffles(guildId: string) {
    return this.listRaffles(guildId).filter((r) => !r.drawnAt);
  }

  listEndedOrDrawnRaffles(guildId: string, now = Date.now()) {
    return this.listRaffles(guildId).filter((r) => Boolean(r.drawnAt) || Boolean(r.endsAt && r.endsAt <= now));
  }

  async setGuildSetup(id: string, s: GuildSetup) {
    this.data.guildSetups[id] = s;
    await this.save();
  }

  async setPending(p: PendingVerification) {
    this.data.pending[p.discordUserId] = p;
    await this.save();
  }

  async removePending(id: string) {
    delete this.data.pending[id];
    await this.save();
  }

  async markVerified(p: PendingVerification) {
    const w = p.walletAddress.toLowerCase();
    this.data.verified[w] = { discordUserId: p.discordUserId, walletAddress: w, verifiedAt: Date.now() };
    delete this.data.pending[p.discordUserId];
    await this.save();
  }

  async setWalletSubmissionSetup(guildId: string, submissionKey: string, setup: WalletSubmissionSetup) {
    this.data.walletSubmissionSetups[guildId] ??= {};
    this.data.walletSubmissionSetups[guildId][submissionKey] = setup;
    this.data.walletSubmissions[guildId] ??= {};
    this.data.walletSubmissions[guildId][submissionKey] = {};
    await this.save();
  }

  async updateWalletSubmissionMessage(guildId: string, submissionKey: string, messageId: string) {
    const setup = this.data.walletSubmissionSetups[guildId]?.[submissionKey];
    if (!setup) return false;
    setup.messageId = messageId;
    await this.save();
    return true;
  }

  async closeWalletSubmission(guildId: string, submissionKey: string) {
    const setup = this.data.walletSubmissionSetups[guildId]?.[submissionKey];
    if (!setup) return false;
    setup.closesAt = Date.now();
    await this.save();
    return true;
  }

  async addWalletSubmission(guildId: string, submissionKey: string, entry: WalletSubmissionEntry) {
    this.data.walletSubmissions[guildId] ??= {};
    this.data.walletSubmissions[guildId][submissionKey] ??= {};
    this.data.walletSubmissions[guildId][submissionKey][entry.discordUserId] = entry;
    await this.save();
  }

  async setRaffleConfig(guildId: string, config: RaffleConfig) {
    const current = this.data.raffleConfigs[guildId] ?? {};
    this.data.raffleConfigs[guildId] = { ...current, ...config };
    await this.save();
  }

  async setRaffleWallet(guildId: string, discordUserId: string, walletAddress: string) {
    this.data.raffleWallets[guildId] ??= {};
    this.data.raffleWallets[guildId][discordUserId] = walletAddress.toLowerCase();
    await this.save();
  }

  async setRaffle(guildId: string, raffle: Raffle) {
    this.data.raffles[guildId] ??= {};
    this.data.raffles[guildId][raffle.key] = cloneRaffle(raffle);
    await this.save();
  }

  async updateRaffleMessage(guildId: string, raffleKey: string, messageId: string) {
    const raffle = this.data.raffles[guildId]?.[raffleKey];
    if (!raffle) return false;
    raffle.messageId = messageId;
    await this.save();
    return true;
  }

  async addRaffleEntry(guildId: string, raffleKey: string, entry: RaffleEntry) {
    const raffle = this.data.raffles[guildId]?.[raffleKey];
    if (!raffle || raffle.drawnAt) return undefined;
    raffle.entries[entry.discordUserId] = entry;
    await this.save();
    return cloneRaffle(raffle);
  }

  async setRaffleWinners(guildId: string, raffleKey: string, winners: RaffleEntry[], drawnAt: number) {
    const raffle = this.data.raffles[guildId]?.[raffleKey];
    if (!raffle) return undefined;
    if (raffle.drawnAt) return cloneRaffle(raffle);
    raffle.winners = winners.map((w) => ({ ...w }));
    raffle.drawnAt = drawnAt;
    await this.save();
    return cloneRaffle(raffle);
  }

  async deleteRaffle(guildId: string, raffleKey: string) {
    if (!this.data.raffles[guildId]?.[raffleKey]) return false;
    delete this.data.raffles[guildId][raffleKey];
    await this.save();
    return true;
  }

  private async save() {
    this.queue = this.queue.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const t = this.file + ".tmp";
      await writeFile(t, JSON.stringify(this.data, null, 2));
      await rename(t, this.file);
    });
    await this.queue;
  }
}

function cloneRaffle(r: Raffle): Raffle {
  return {
    ...r,
    allowedRoleIds: [...r.allowedRoleIds],
    entries: Object.fromEntries(Object.entries(r.entries).map(([userId, entry]) => [userId, { ...entry }])),
    winners: r.winners.map((winner) => ({ ...winner })),
  };
}

function normalizeWalletSubmissionSetups(input: unknown): Record<string, Record<string, WalletSubmissionSetup>> {
  if (!input || typeof input !== "object") return {};
  const result: Record<string, Record<string, WalletSubmissionSetup>> = {};
  for (const [guildId, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    if ("allowedRoleIds" in record && "channelId" in record) {
      result[guildId] = {
        default: {
          name: "default",
          channelId: String(record.channelId),
          allowedRoleIds: Array.isArray(record.allowedRoleIds) ? record.allowedRoleIds.map(String) : [],
          opensAt: Number(record.opensAt ?? Date.now()),
          closesAt: record.closesAt === null || record.closesAt === undefined ? null : Number(record.closesAt),
        },
      };
      continue;
    }
    result[guildId] = {};
    for (const [key, setupValue] of Object.entries(record)) {
      if (!setupValue || typeof setupValue !== "object") continue;
      const setup = setupValue as Record<string, unknown>;
      result[guildId][key] = {
        name: String(setup.name ?? key),
        channelId: String(setup.channelId),
        messageId: setup.messageId ? String(setup.messageId) : undefined,
        allowedRoleIds: Array.isArray(setup.allowedRoleIds) ? setup.allowedRoleIds.map(String) : [],
        opensAt: Number(setup.opensAt ?? Date.now()),
        closesAt: setup.closesAt === null || setup.closesAt === undefined ? null : Number(setup.closesAt),
      };
    }
  }
  return result;
}

function normalizeWalletSubmissions(input: unknown): Record<string, Record<string, Record<string, WalletSubmissionEntry>>> {
  if (!input || typeof input !== "object") return {};
  const result: Record<string, Record<string, Record<string, WalletSubmissionEntry>>> = {};
  for (const [guildId, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const looksLikeOldEntryMap = Object.values(record).some((entry) => entry && typeof entry === "object" && "walletAddress" in entry);
    if (looksLikeOldEntryMap) {
      result[guildId] = { default: normalizeEntryMap(record) };
      continue;
    }
    result[guildId] = {};
    for (const [key, entries] of Object.entries(record)) {
      if (entries && typeof entries === "object") result[guildId][key] = normalizeEntryMap(entries as Record<string, unknown>);
    }
  }
  return result;
}

function normalizeEntryMap(input: Record<string, unknown>) {
  const result: Record<string, WalletSubmissionEntry> = {};
  for (const [userId, value] of Object.entries(input)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    if (!entry.walletAddress) continue;
    result[userId] = {
      discordUserId: String(entry.discordUserId ?? userId),
      discordUsername: String(entry.discordUsername ?? ""),
      walletAddress: String(entry.walletAddress),
      submittedAt: Number(entry.submittedAt ?? Date.now()),
    };
  }
  return result;
}

function normalizeRaffleConfigs(input: unknown): Record<string, RaffleConfig> {
  if (!input || typeof input !== "object") return {};
  const result: Record<string, RaffleConfig> = {};
  for (const [guildId, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const c = value as Record<string, unknown>;
    result[guildId] = {
      announceChannelId: c.announceChannelId ? String(c.announceChannelId) : undefined,
      winnerChannelId: c.winnerChannelId ? String(c.winnerChannelId) : undefined,
    };
  }
  return result;
}

function normalizeRaffleWallets(input: unknown): Record<string, Record<string, string>> {
  if (!input || typeof input !== "object") return {};
  const result: Record<string, Record<string, string>> = {};
  for (const [guildId, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    result[guildId] = {};
    for (const [userId, wallet] of Object.entries(value as Record<string, unknown>)) {
      if (wallet) result[guildId][userId] = String(wallet).toLowerCase();
    }
  }
  return result;
}

function normalizeRaffles(input: unknown): Record<string, Record<string, Raffle>> {
  if (!input || typeof input !== "object") return {};
  const result: Record<string, Record<string, Raffle>> = {};
  for (const [guildId, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    result[guildId] = {};
    for (const [key, raffleValue] of Object.entries(value as Record<string, unknown>)) {
      if (!raffleValue || typeof raffleValue !== "object") continue;
      const r = raffleValue as Record<string, unknown>;
      result[guildId][key] = {
        key: String(r.key ?? key),
        name: String(r.name ?? key),
        announceChannelId: String(r.announceChannelId ?? ""),
        winnerChannelId: String(r.winnerChannelId ?? r.announceChannelId ?? ""),
        messageId: r.messageId ? String(r.messageId) : undefined,
        winnerCount: Math.max(1, Number(r.winnerCount ?? 1)),
        allowedRoleIds: Array.isArray(r.allowedRoleIds) ? r.allowedRoleIds.map(String) : [],
        startsAt: Number(r.startsAt ?? Date.now()),
        endsAt: r.endsAt === null || r.endsAt === undefined ? null : Number(r.endsAt),
        drawnAt: r.drawnAt === null || r.drawnAt === undefined ? null : Number(r.drawnAt),
        entries: normalizeRaffleEntries(r.entries),
        winners: Array.isArray(r.winners) ? r.winners.map((winner) => normalizeRaffleEntry(winner)).filter((e): e is RaffleEntry => Boolean(e)) : [],
      };
    }
  }
  return result;
}

function normalizeRaffleEntries(input: unknown): Record<string, RaffleEntry> {
  if (!input || typeof input !== "object") return {};
  const result: Record<string, RaffleEntry> = {};
  for (const [userId, value] of Object.entries(input as Record<string, unknown>)) {
    const entry = normalizeRaffleEntry(value, userId);
    if (entry) result[userId] = entry;
  }
  return result;
}

function normalizeRaffleEntry(input: unknown, fallbackUserId = ""): RaffleEntry | undefined {
  if (!input || typeof input !== "object") return undefined;
  const entry = input as Record<string, unknown>;
  if (!entry.walletAddress) return undefined;
  return {
    discordUserId: String(entry.discordUserId ?? fallbackUserId),
    discordUsername: String(entry.discordUsername ?? ""),
    walletAddress: String(entry.walletAddress).toLowerCase(),
    enteredAt: Number(entry.enteredAt ?? Date.now()),
  };
}
