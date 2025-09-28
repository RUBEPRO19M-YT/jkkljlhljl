import 'dotenv/config';
import { Client, GatewayIntentBits, Partials, EmbedBuilder } from 'discord.js';
import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';
import fs from 'fs';
import express from 'express';

// ==== Config Discord ====
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

// ==== Feeds RSS ====
const rssFeeds = {
  "AEMET_Esp": { url: process.env.AEMET_ESP_FEED, channelId: process.env.AEMET_ESP_CHANNEL },
  "AEMET_CValencia": { url: process.env.AEMET_CVALENCIA_FEED, channelId: process.env.AEMET_CVALENCIA_CHANNEL },
  "AEMET_Cat": { url: process.env.AEMET_CAT_FEED, channelId: process.env.AEMET_CAT_CHANNEL },
  "GVA112": { url: process.env.GVA112_FEED, channelId: process.env.GVA112_CHANNEL },
  "emergenciescat": { url: process.env.EMERGENCIESCAT_FEED, channelId: process.env.EMERGENCIESCAT_CHANNEL },
  "DGTes": { url: process.env.DGTES_FEED, channelId: process.env.DGTES_CHANNEL }
};

// ==== Persistencia ====
let lastSeen = {};
const LAST_SEEN_FILE = "./lastSeen.json";
if (fs.existsSync(LAST_SEEN_FILE)) lastSeen = JSON.parse(fs.readFileSync(LAST_SEEN_FILE, "utf-8"));
else Object.keys(rssFeeds).forEach(u => lastSeen[u] = []);

function saveLastSeen() {
  fs.writeFileSync(LAST_SEEN_FILE, JSON.stringify(lastSeen, null, 2));
}

// ==== Utilidades ====
function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max - 3) + "..." : str;
}

function cleanHTML(html) {
  if (!html) return "";
  let text = html.replace(/<br\s*\/?>/gi, "\n"); 
  text = text.replace(/<a[^>]*>(.*?)<\/a>/gi, "$1"); 
  text = text.replace(/<[^>]+>/g, ""); 
  text = text.replace(/&amp;/g, "&")
             .replace(/&lt;/g, "<")
             .replace(/&gt;/g, ">")
             .replace(/&quot;/g, '"')
             .replace(/&#39;/g, "'");
  return text.trim();
}

function parseTweetHTML(html) {
  if (!html) return { text: "", images: [] };

  const imgMatches = [...(html.matchAll(/https:\/\/t\.co\/[^\s"]+/g) || [])];
  const images = imgMatches
    .map(match => match[0])
    .filter(url => url.match(/\.(jpg|png|gif)$/i));

  const text = cleanHTML(html);
  return { text, images };
}

function buildTweetEmbed(title, link, description, username, images) {
  const embedTitle = truncate(description.replace(/\n/g, " "), 100);

  const embed = new EmbedBuilder()
    .setAuthor({ name: truncate(username, 256), url: link })
    .setTitle(embedTitle)
    .setDescription(truncate(description, 4096))
    .setColor("#1DA1F2")
    .setFooter({ text: `${truncate(username, 256)} • Fuentes Oficiales` })
    .setURL(link);

  if (images.length > 0) embed.setImage(images[0]); 
  return embed;
}

// ==== Cliente Discord ====
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message]
});

async function checkTweets() {
  for (const username of Object.keys(rssFeeds)) {
    const { url: feedUrl, channelId } = rssFeeds[username];

    try {
      const response = await fetch(feedUrl);
      const xml = await response.text();
      const feed = await parseStringPromise(xml);
      const items = feed.rss.channel[0].item.reverse();
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) continue;

      const newTweets = items.filter(i => !lastSeen[username].includes(i.link[0]));
      const tweetsToSend = lastSeen[username].length === 0 ? newTweets.slice(-10) : newTweets;

      for (const item of tweetsToSend) {
        const link = item.link[0];
        const title = item.title[0] || username;
        const descriptionHTML = item.description[0] || "";
        const { text, images } = parseTweetHTML(descriptionHTML);

        const embed = buildTweetEmbed(title, link, text, username, images);
        const files = images.slice(1).map((url, i) => ({ attachment: url, name: `image${i + 2}.png` }));

        await channel.send({ embeds: [embed], files });

        lastSeen[username].push(link);
      }

      if (lastSeen[username].length > 50) lastSeen[username] = lastSeen[username].slice(-50);
      saveLastSeen();

    } catch (e) {
      console.error(`Error leyendo RSS de ${username}:`, e);
    }
  }
}

client.once("ready", async () => {
  console.log(`Bot Twitter/RSS conectado como ${client.user.tag}`);
  if (client.user) {
    client.user.setPresence({ activities: [{ name: "Twitter/X", type: 3 }], status: "online" });
  }

  checkTweets();
  setInterval(checkTweets, 2 * 60 * 1000);
});

// ==== Servidor Express para Uptime Robot ====
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot activo 👍"));
app.listen(PORT, () => console.log(`Servidor ping activo en puerto ${PORT}`));

client.login(DISCORD_TOKEN);
