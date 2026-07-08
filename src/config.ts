import "dotenv/config";
const req=(n:string)=>{const v=process.env[n]?.trim();if(!v)throw Error("Missing required environment variable: "+n);return v};
export const config={discordToken:req("DISCORD_TOKEN"),guildId:req("DISCORD_GUILD_ID"),openSeaApiKey:req("OPENSEA_API_KEY"),arcTestnetRpcUrl:process.env.ARC_TESTNET_RPC_URL?.trim()||"https://rpc.testnet.arc.network",orixaContractAddress:"0xCc6f721F6b340922469b64CdeA71927cd9EF1bfA".toLowerCase(),verificationTtlMs:Number(process.env.VERIFICATION_TTL_MINUTES||15)*60000};
