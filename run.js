#!/usr/bin/env node
import { fetchFacebookPosts } from './facebook.js';
import { markSeen, filterSeen } from './seen.js';
import { readFileSync } from 'fs';
import https from 'https';

// ===== 讀 env =====
function loadEnv() {
  try {
    const env = readFileSync('.env', 'utf8');
    const map = {};
    for (const line of env.split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return map;
  } catch (_) {}
  return {};
}

const env = loadEnv();
const APAFY_TOKEN = env.APIFY_TOKEN || process.env.APIFY_TOKEN;
const LLM_API_KEY = env.LLM_API_KEY || process.env.LLM_API_KEY || env.FINMIND_TOKEN;
const LLM_BASE_URL = env.LLM_BASE_URL || process.env.LLM_BASE_URL || 'https://api.minimaxi.chat/v1';
const LLM_MODEL = env.LLM_MODEL || process.env.LLM_MODEL || 'MiniMax-M2.7';

// TG
const TG_BOT_TOKEN = env.TG_BOT_TOKEN || process.env.TG_BOT_TOKEN;
const TG_CHANNEL_ID = env.TG_CHANNEL_ID || process.env.TG_CHANNEL_ID;

// DC
const DC_BOT_TOKEN = env.DC_BOT_TOKEN || process.env.DC_BOT_TOKEN;
const DC_CHANNEL_ID = env.DC_CHANNEL_ID || process.env.DC_CHANNEL_ID;

// ===== LLM 分析 =====
async function analyzePost(post) {
  if (!LLM_API_KEY) {
    console.log('[LLM] No API key, skip analysis');
    return null;
  }

  const prompt = `你是一個股票名稱提取機器人。

分析以下 FB 貼文，提取所有提到的股票或ETF名稱。

規則：
- 只提取「明確提到」的股票名稱或代碼
- 忽略以下關鍵字前後的內容：「等一下」、「等等」、「等很久」、「等大家」
- 如果是網站、帳號名稱（非股票）也要忽略
- 回應格式為 JSON Array，例如：["2330 台積電", "2884 玉山金"]
- 如果找不到任何股票，回應：[]
- 只寫 JSON，什麼都不要加

貼文內容：
${post.text}${post.ocrText ? '\n圖片文字：' + post.ocrText : ''}`;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    });

    const url = new URL(`${LLM_BASE_URL}/text/chatcompletion_v2`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const content = json?.choices?.[0]?.message?.content?.trim() || '[]';
          // 去掉 code block
          const cleaned = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
          resolve(JSON.parse(cleaned));
        } catch (e) {
          console.error('[LLM] parse error:', e.message, data.slice(0, 100));
          resolve(null);
        }
      });
    });

    req.on('error', e => {
      console.error('[LLM] request error:', e.message);
      resolve(null);
    });
    req.setTimeout(30000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

// ===== 發送 Telegram =====
async function sendTelegram(text) {
  if (!TG_BOT_TOKEN || !TG_CHANNEL_ID) return;
  const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({ chat_id: TG_CHANNEL_ID, text, parse_mode: 'HTML' });
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { const j = JSON.parse(d); resolve(j.ok); } catch { resolve(false); } });
    });
    req.on('error', e => resolve(false));
    req.write(body); req.end();
  });
}

// ===== 發送 Discord =====
async function sendDiscord(text) {
  if (!DC_BOT_TOKEN || !DC_CHANNEL_ID) return;
  const url = `https://discord.com/api/v10/channels/${DC_CHANNEL_ID}/messages`;
  const body = JSON.stringify({ content: text });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'discord.com', path: '/api/v10/channels/' + DC_CHANNEL_ID + '/messages',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bot ${DC_BOT_TOKEN}` },
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { const j = JSON.parse(d); resolve(j.id != null); } catch { resolve(false); } });
    });
    req.on('error', e => resolve(false));
    req.write(body); req.end();
  });
}

// ===== 主程式 =====
async function main() {
  if (!APAFY_TOKEN) { console.error('需要 APAFY_TOKEN'); process.exit(1); }

  const PAGE_URL = process.argv[2] || 'https://www.facebook.com/i8stock';
  const KEYWORD = '撈股中';

  console.log(`=== FB Scraper + LLM 分析 ===`);
  console.log(`粉專：${PAGE_URL}`);
  console.log(`關鍵字：${KEYWORD}`);
  console.log('');

  // 抓取
  const posts = await fetchFacebookPosts(PAGE_URL, APAFY_TOKEN, 20);
  const newPosts = filterSeen(PAGE_URL, posts);
  console.log(`抓到 ${posts.length} 篇，新 ${newPosts.length} 篇`);

  // 過濾含關鍵字
  const keywordPosts = newPosts.filter(p =>
    p.text.includes(KEYWORD) || p.ocrText?.includes(KEYWORD)
  );
  console.log(`含「${KEYWORD}」：${keywordPosts.length} 篇`);

  if (keywordPosts.length === 0) {
    console.log('沒有符合條件的貼文');
    markSeen(PAGE_URL, newPosts.map(p => p.id));
    return;
  }

  // 分析 + 推播
  for (const post of keywordPosts) {
    const stocks = await analyzePost(post);
    const stockList = Array.isArray(stocks) && stocks.length > 0
      ? stocks.join('、')
      : '（未識別出股票）';

    const msg = [
      `📣 <b>FB 股票情報</b>`,
      ``,
      `👤 <a href="${post.url}">原文連結</a>`,
      `⏰ ${post.timestamp}`,
      ``,
      `📝 ${post.text.slice(0, 200)}${post.text.length > 200 ? '...' : ''}`,
      ``,
      `🔍 ${stockList}`,
      ``,
      `<i>僅供參考，不構成投資建議</i>`,
    ].join('\n');

    console.log(`\n--- 分析 ---`);
    console.log(`時間：${post.timestamp}`);
    console.log(`股票：${stockList}`);
    console.log(`URL：${post.url}`);

    const tg = await sendTelegram(msg);
    console.log(`TG 發送：${tg ? '✅' : '❌'}`);

    const dc = await sendDiscord(msg.replace(/<[^>]+>/g, ''));
    console.log(`DC 發送：${dc ? '✅' : '❌'}`);
  }

  markSeen(PAGE_URL, newPosts.map(p => p.id));
  console.log(`\n完成，已標記 ${newPosts.length} 篇為已讀`);
}

main().catch(e => { console.error(e); process.exit(1); });
