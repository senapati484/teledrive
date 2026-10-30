// @ts-nocheck
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { ConnectionTCPObfuscated } from "telegram/network/connection";
import * as fs from "fs";

const apiId = 30061045;
const apiHash = "457f14bd4e74ea235a9c7262792cab15";

// Load session string from vault file
const vaultRaw = fs.readFileSync("/Users/sayansenapati/Library/Application Support/com.teledrive.app/teledrive_vault.json", "utf-8");
const vault = JSON.parse(vaultRaw);
const sessionString = vault.telegram_session;
const channelId = vault.telegram_channel_id;

console.log("Connecting with channelId:", channelId);

async function run() {
  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connection: ConnectionTCPObfuscated,
    connectionRetries: 5,
  });
  await client.connect();
  console.log("Connected!");
  
  const entity = await client.getInputEntity(channelId).catch(() => client.getEntity(channelId));
  const messages = await client.getMessages(entity, { limit: 100 });
  console.log(`Fetched ${messages.length} messages:`);
  
  const results = messages.map(m => {
    const media = (m as any).media;
    let fileInfo = "";
    if (media?.document) {
      const doc = media.document;
      const filenameAttr = (doc.attributes || []).find(
        (a: any) => a.className === "DocumentAttributeFilename"
      );
      fileInfo = `[File: ${filenameAttr?.fileName || "unknown"} (size: ${doc.size}, mime: ${doc.mimeType})]`;
    }
    return {
      id: m.id,
      date: m.date,
      text: m.text ? m.text.substring(0, 100) : "",
      fileInfo
    };
  });
  
  fs.writeFileSync("/Users/sayansenapati/.gemini/antigravity/brain/5fb0a2ed-e15a-44cf-81ea-b0ca7fee4e9a/scratch/dump_messages.json", JSON.stringify(results, null, 2));
  console.log("Dumped to scratch/dump_messages.json");
  await client.disconnect();
}

run().catch(console.error);
