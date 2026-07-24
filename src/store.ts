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

interface Data {
  pending: Record<string, PendingVerification>;
  verified: Record<string, { discordUserId: string; walletAddress: string; verifiedAt: number }>;
  guildSetups: Record<string, GuildSetup>;
  walletSubmissionSetups: Record<string, Record<string, WalletSubmissionSetup>>;
  walletSubmissions: Record<string, Record<string, Record<string, WalletSubmissionEntry>>>;
}

export class VerificationStore {
  private data: Data = {
    pending: {},
    verified: {},
    guildSetups: {},
    walletSubmissionSetups: {},
    walletSubmissions: {},
  };

  private queue = Promise.resolve();

  constructor(private file: string) {}

  async initialize() {
    try {
      const p = JSON.parse(await readFile(this.file, "utf8")) as Partial<Data> & {
        walletSubmissionSetups?: unknown;
        walletSubmissions?: unknown;
      };
      this.data = {
        pending: p.pending ?? {},
        verified: p.verified ?? {},
        guildSetups: p.guildSetups ?? {},
        walletSubmissionSetups: normalizeWalletSubmissionSetups(p.walletSubmissionSetups),
        walletSubmissions: normalizeWalletSubmissions(p.walletSubmissions),
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

  getWalletSubmissionSetup(guildId: string, submissionKey: string) {
    const s = this.data.walletSubmissionSetups[guildId]?.[submissionKey];
    return s ? { ...s, allowedRoleIds: [...s.allowedRoleIds] } : undefined;
  }

  getWalletSubmissions(guildId: string, submissionKey: string) {
    return Object.values(this.data.walletSubmissions[guildId]?.[submissionKey] ?? {}).map((entry) => ({ ...entry }));
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
