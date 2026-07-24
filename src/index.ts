import { randomBytes } from "node:crypto";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  GuildMember,
  Interaction,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { config } from "./config.js";
import { OpenSeaClient } from "./opensea.js";
import { ArcClient } from "./arc.js";
import { VerificationStore } from "./store.js";

const VERIFY = "holder:verify";
const HOLDER_MODAL = "holder:wallet-modal";
const HOLDER_INPUT = "holder:wallet-address";
const CONFIRM = "holder:confirm";

const WALLET_SUBMIT = "wallet-submission:submit";
const WALLET_MODAL = "wallet-submission:modal";
const WALLET_INPUT = "wallet-submission:wallet-address";

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const store = new VerificationStore("data/verifications.json");
const openSea = new OpenSeaClient(config.openSeaApiKey, "", "");
const chain = new ArcClient(config.arcTestnetRpcUrl);

client.once(Events.ClientReady, (c) => {
  console.log("Logged in as " + c.user.tag);
});

client.on(Events.InteractionCreate, async (i) => {
  try {
    await handle(i);
  } catch (e) {
    console.error(e);
    if (i.isRepliable()) {
      const x = { content: "Action failed. Try again later.", flags: MessageFlags.Ephemeral as const };
      i.replied || i.deferred ? await i.followUp(x) : await i.reply(x);
    }
  }
});

async function handle(i: Interaction) {
  if (i.isChatInputCommand() && i.commandName === "setup-verification") {
    await handleSetupVerification(i);
    return;
  }

  if (i.isChatInputCommand() && i.commandName === "setup-wallet-submission") {
    await handleSetupWalletSubmission(i);
    return;
  }

  if (i.isChatInputCommand() && i.commandName === "export-wallet-submissions") {
    await handleExportWalletSubmissions(i);
    return;
  }

  if (i.isButton() && i.customId === VERIFY) {
    const m = new ModalBuilder().setCustomId(HOLDER_MODAL).setTitle("NFT holder verification");
    const x = new TextInputBuilder()
      .setCustomId(HOLDER_INPUT)
      .setLabel("Your EVM wallet address")
      .setPlaceholder("0x...")
      .setStyle(TextInputStyle.Short)
      .setMinLength(42)
      .setMaxLength(42)
      .setRequired(true);
    m.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(x));
    await i.showModal(m);
    return;
  }

  if (i.isModalSubmit() && i.customId === HOLDER_MODAL) {
    const wallet = i.fields.getTextInputValue(HOLDER_INPUT).trim().toLowerCase();
    if (!ADDRESS.test(wallet)) {
      await i.reply({ content: "Invalid EVM wallet address.", flags: MessageFlags.Ephemeral });
      return;
    }

    const owner = store.walletOwner(wallet);
    if (owner && owner !== i.user.id) {
      await i.reply({ content: "Wallet already verified by another account.", flags: MessageFlags.Ephemeral });
      return;
    }

    const code = "ORIXA-" + randomBytes(5).toString("hex").toUpperCase();
    await store.setPending({
      discordUserId: i.user.id,
      walletAddress: wallet,
      code,
      expiresAt: Date.now() + config.verificationTtlMs,
    });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(CONFIRM).setLabel("Check OpenSea profile").setStyle(ButtonStyle.Primary),
    );

    await i.reply({
      content: "Add this code to the OpenSea bio for " + wallet + ":\n\n**" + code + "**\n\nSave it, then press below.",
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (i.isButton() && i.customId === CONFIRM) {
    await handleHolderConfirm(i);
    return;
  }

  if (i.isButton() && i.customId === WALLET_SUBMIT) {
    await handleWalletSubmitButton(i);
    return;
  }

  if (i.isModalSubmit() && i.customId === WALLET_MODAL) {
    await handleWalletSubmitModal(i);
    return;
  }
}

async function handleSetupVerification(i: Interaction) {
  if (!i.isChatInputCommand()) return;
  if (!i.inGuild() || !i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await i.reply({ content: "Manage Server permission is required.", flags: MessageFlags.Ephemeral });
    return;
  }

  const channel = i.options.getChannel("channel", true, [ChannelType.GuildText]);
  const contract = config.orixaContractAddress;
  const tiers: Array<{ roleId: string; nftCount: number }> = [];

  for (let n = 1; n <= 5; n++) {
    const role = i.options.getRole("role-" + n);
    const count = i.options.getInteger("nft-count-" + n);
    if ((role && count === null) || (!role && count !== null)) {
      await i.reply({ content: "Tier " + n + " needs both role and NFT count.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (role && count !== null) tiers.push({ roleId: role.id, nftCount: count });
  }

  if (new Set(tiers.map((t) => t.roleId)).size !== tiers.length || new Set(tiers.map((t) => t.nftCount)).size !== tiers.length) {
    await i.reply({ content: "Roles and thresholds must be unique.", flags: MessageFlags.Ephemeral });
    return;
  }

  tiers.sort((a, b) => a.nftCount - b.nftCount);
  const me = i.guild!.members.me;
  const bad = tiers.find((t) => {
    const r = i.guild!.roles.cache.get(t.roleId);
    return !r || r.managed || !me || r.position >= me.roles.highest.position;
  });

  if (bad) {
    await i.reply({ content: "Move my bot role above <@&" + bad.roleId + ">.", flags: MessageFlags.Ephemeral });
    return;
  }

  await store.setGuildSetup(i.guildId, { channelId: channel.id, contractAddress: contract, tiers });

  const lines = tiers.map((t) => "- <@&" + t.roleId + ">: **" + t.nftCount + "+ NFTs**").join("\n");
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("Verify Orixa holder status")
    .setDescription(
      [
        "Click **Verify holder** and submit your wallet address.",
        "Add the temporary code to your OpenSea profile bio, then confirm.",
        "",
        "**Contract**: " + contract,
        "**Arc Testnet**",
        "",
        "**Role tiers**",
        lines,
        "",
        "No transaction, approval, seed phrase, or private key is requested.",
      ].join("\n"),
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(VERIFY).setLabel("Verify holder").setStyle(ButtonStyle.Success),
  );

  await channel.send({ embeds: [embed], components: [row] });
  await i.reply({ content: "Panel posted in <#" + channel.id + ">.", flags: MessageFlags.Ephemeral });
}

async function handleSetupWalletSubmission(i: Interaction) {
  if (!i.isChatInputCommand()) return;
  if (!i.inGuild() || !i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await i.reply({ content: "Manage Server permission is required.", flags: MessageFlags.Ephemeral });
    return;
  }

  const channel = i.options.getChannel("channel", true, [ChannelType.GuildText]);
  const durationMinutes = i.options.getInteger("duration-minutes", true);
  const allowedRoleIds = parseRoleIds(i.options.getString("allow-roles"));
  const missingRoleId = allowedRoleIds.find((roleId) => !i.guild!.roles.cache.has(roleId));

  if (missingRoleId) {
    await i.reply({ content: "Role not found in this server: `" + missingRoleId + "`", flags: MessageFlags.Ephemeral });
    return;
  }

  const now = Date.now();
  const closesAt = now + durationMinutes * 60_000;
  await store.setWalletSubmissionSetup(i.guildId, {
    channelId: channel.id,
    allowedRoleIds,
    opensAt: now,
    closesAt,
  });

  const roleLine = allowedRoleIds.length ? allowedRoleIds.map((r) => "<@&" + r + ">").join(", ") : "Everyone";
  const closeTimestamp = Math.floor(closesAt / 1000);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Submit your wallet")
    .setDescription(
      [
        "Click **Submit wallet** and enter your EVM wallet address.",
        "",
        "**Allowed entrants**: " + roleLine,
        "**Closes**: <t:" + closeTimestamp + ":F> (<t:" + closeTimestamp + ":R>)",
        "",
        "One entry per Discord account. Submitting again updates your wallet.",
      ].join("\n"),
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(WALLET_SUBMIT).setLabel("Submit wallet").setStyle(ButtonStyle.Primary),
  );

  await channel.send({ embeds: [embed], components: [row] });
  await i.reply({ content: "Wallet submission panel posted in <#" + channel.id + ">.", flags: MessageFlags.Ephemeral });
}

async function handleExportWalletSubmissions(i: Interaction) {
  if (!i.isChatInputCommand()) return;
  if (!i.inGuild() || !i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await i.reply({ content: "Manage Server permission is required.", flags: MessageFlags.Ephemeral });
    return;
  }

  const entries = store.getWalletSubmissions(i.guildId);
  const rows = [
    ["discord_user_id", "discord_username", "wallet_address", "submitted_at_iso", "submitted_at_unix"],
    ...entries
      .sort((a, b) => a.submittedAt - b.submittedAt)
      .map((e) => [e.discordUserId, e.discordUsername, e.walletAddress, new Date(e.submittedAt).toISOString(), String(e.submittedAt)]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
  const file = new AttachmentBuilder(Buffer.from(csv, "utf8"), { name: "wallet-submissions.csv" });

  await i.reply({ content: "Exported " + entries.length + " wallet submission(s).", files: [file], flags: MessageFlags.Ephemeral });
}

async function handleHolderConfirm(i: Interaction) {
  if (!i.isButton()) return;
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const p = store.getPending(i.user.id);
  if (!p) {
    await i.editReply("No pending verification. Start again.");
    return;
  }

  if (p.expiresAt < Date.now()) {
    await store.removePending(i.user.id);
    await i.editReply("Code expired. Start again.");
    return;
  }

  if (store.walletOwner(p.walletAddress) && store.walletOwner(p.walletAddress) !== i.user.id) {
    await i.editReply("Wallet already claimed.");
    return;
  }

  if (!(await openSea.profileContainsCode(p.walletAddress, p.code))) {
    await i.editReply("Code is not visible in the OpenSea bio yet.");
    return;
  }

  if (!i.inGuild() || i.guildId !== config.guildId) {
    await i.editReply("Use the configured server.");
    return;
  }

  const setup = store.getGuildSetup(i.guildId);
  if (!setup) {
    await i.editReply("Ask an admin to run /setup-verification.");
    return;
  }

  const count = await chain.balance(setup.contractAddress, p.walletAddress);
  const qualified = setup.tiers.filter((t) => count >= t.nftCount);
  if (!qualified.length) {
    await i.editReply("Wallet holds " + count + " NFT(s), below the minimum.");
    return;
  }

  const member = await i.guild!.members.fetch(i.user.id);
  const all = setup.tiers.map((t) => t.roleId);
  const add = qualified.map((t) => t.roleId);
  const remove = all.filter((r) => member.roles.cache.has(r) && !add.includes(r));

  if (remove.length) await member.roles.remove(remove, "NFT tier sync");
  await member.roles.add(add, "Verified Orixa holder");
  await store.markVerified(p);
  await i.editReply("Verified with " + count + " NFT(s). Granted: " + add.map((r) => "<@&" + r + ">").join(", ") + ".");
}

async function handleWalletSubmitButton(i: Interaction) {
  if (!i.isButton()) return;
  if (!i.inGuild()) {
    await i.reply({ content: "Use this inside the server.", flags: MessageFlags.Ephemeral });
    return;
  }

  const setup = store.getWalletSubmissionSetup(i.guildId);
  if (!setup) {
    await i.reply({ content: "Wallet submissions are not configured.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (Date.now() > setup.closesAt) {
    await i.reply({ content: "Wallet submissions are closed.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!memberHasAnyRole(i.member, setup.allowedRoleIds)) {
    await i.reply({ content: "You do not have an allowed role for this submission.", flags: MessageFlags.Ephemeral });
    return;
  }

  const m = new ModalBuilder().setCustomId(WALLET_MODAL).setTitle("Submit wallet address");
  const x = new TextInputBuilder()
    .setCustomId(WALLET_INPUT)
    .setLabel("Your EVM wallet address")
    .setPlaceholder("0x...")
    .setStyle(TextInputStyle.Short)
    .setMinLength(42)
    .setMaxLength(42)
    .setRequired(true);
  m.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(x));
  await i.showModal(m);
}

async function handleWalletSubmitModal(i: Interaction) {
  if (!i.isModalSubmit()) return;
  if (!i.inGuild()) {
    await i.reply({ content: "Use this inside the server.", flags: MessageFlags.Ephemeral });
    return;
  }

  const setup = store.getWalletSubmissionSetup(i.guildId);
  if (!setup) {
    await i.reply({ content: "Wallet submissions are not configured.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (Date.now() > setup.closesAt) {
    await i.reply({ content: "Wallet submissions are closed.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!memberHasAnyRole(i.member, setup.allowedRoleIds)) {
    await i.reply({ content: "You do not have an allowed role for this submission.", flags: MessageFlags.Ephemeral });
    return;
  }

  const wallet = i.fields.getTextInputValue(WALLET_INPUT).trim().toLowerCase();
  if (!ADDRESS.test(wallet)) {
    await i.reply({ content: "Invalid EVM wallet address.", flags: MessageFlags.Ephemeral });
    return;
  }

  await store.addWalletSubmission(i.guildId, {
    discordUserId: i.user.id,
    discordUsername: i.user.tag,
    walletAddress: wallet,
    submittedAt: Date.now(),
  });

  await i.reply({ content: "Wallet submitted: `" + wallet + "`", flags: MessageFlags.Ephemeral });
}


function parseRoleIds(input: string | null) {
  if (!input) return [];
  const ids = [...input.matchAll(/<@&(?<mentionId>\d+)>|(?<plainId>\d{17,20})/g)].map(
    (match) => match.groups?.mentionId ?? match.groups?.plainId ?? "",
  );
  return [...new Set(ids.filter(Boolean))];
}

function memberHasAnyRole(member: Interaction["member"], allowedRoleIds: string[]) {
  if (!allowedRoleIds.length) return true;
  if (!member) return false;
  if (member instanceof GuildMember) return allowedRoleIds.some((roleId) => member.roles.cache.has(roleId));
  return allowedRoleIds.some((roleId) => member.roles.includes(roleId));
}

function csvCell(value: string) {
  return '"' + value.replaceAll('"', '""') + '"';
}

await store.initialize();
await client.login(config.discordToken);
