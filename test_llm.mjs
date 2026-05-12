#!/usr/bin/env node
import { readFileSync } from 'fs';
import https from 'https';
import { fetchFacebookPosts } from './facebook.js';
import { filterSeen, markSeen, clearSeen } from './seen.js';

const env = {};
try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const idx = line.indexOf('=');
    if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
} catch (_) {}

const token = env.APIFY_TOKEN;
const LLM_API_KEY = env.LLM_API_KEY;
const LLM_BASE_URL = env.LLM_BASE_URL || 'https://api.minimaxi.chat/v1';
const LLM_MODEL = env.LLM_MODEL || 'MiniMax-M2.7';

async function analyzePost(post) {
  const text = post.text + (post.ocrText ? '\n圖片：' + post.ocrText : '');

  const prompt = `你是股票代碼提取機器人。

任務：從以下 FB 貼文中，提取所有提到的股票或 ETF 的「4 碼代碼」。

規則：
- 只提取 4 碼數字（台股代碼）
- 忽略「等一下」「等等」「等大家」「等很久」「網站名稱」
- 出現 () 或 【】包起來數字幾乎都是股票代碼
- 如果完全找不到任何股票代碼，回傳：["NOCODE"]

回應格式：JSON Array of strings，例如：["2330","2884","1721"]
不要加任何解釋。

=== 貼文內容 ===
${text.slice(0, 800)}`;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    });

    const url = new URL(`${LLM_BASE_URL}/text/chatcompletion_v2`);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          let content = (json?.choices?.[0]?.message?.content || '[]').trim()
            .replace(/^```json\n?/, '').replace(/\n?```$/, '');
          // strip <thinking> blocks
          content = content.replace(/<think>[\s\S]*?<\/think>/g, '');
          content = content.replace(/[‹<]think(?:ing)?>[^>]*>/gi, '');
          const result = JSON.parse(content);
          resolve(result);
        } catch (e) {
          console.error('[LLM] error:', e.message);
          resolve([]);
        }
      });
    });
    req.on('error', e => { console.error('[LLM] net error:', e.message); resolve([]); });
    req.setTimeout(30000, () => { req.destroy(); resolve([]); });
    req.write(body);
    req.end();
  });
}

async function main() {
  const PAGE_URL = process.argv[2] || 'https://www.facebook.com/i8stock';
  const KEYWORD = process.argv[3] || '撈股中';

  // clearSeen(PAGE_URL); // 註解掉避免誤清

  const posts = await fetchFacebookPosts(PAGE_URL, token, 20);
  const newPosts = filterSeen(PAGE_URL, posts);

  console.log(`=== FB Stock Extractor ===`);
  console.log(`粉專：${PAGE_URL}`);
  console.log(`關鍵字：${KEYWORD}`);
  console.log(`抓到 ${posts.length} 篇，新 ${newPosts.length} 篇`);

  const targetPosts = newPosts.filter(p =>
    p.text.includes(KEYWORD) || p.ocrText?.includes(KEYWORD)
  );
  console.log(`含「${KEYWORD}」：${targetPosts.length} 篇\n`);

  for (const post of targetPosts.slice(0, 5)) {
    const codes = await analyzePost(post);
    const hasStocks = Array.isArray(codes) && codes[0] !== 'NOCODE' && codes.length > 0;
    console.log(`【${post.timestamp}】`);
    console.log(`  內文：${post.text.slice(0, 80)}`);
    console.log(`  股票：${hasStocks ? codes.join('、') : '（未識別）'}`);
    console.log(`  URL：${post.url}`);
    console.log('');
  }

  markSeen(PAGE_URL, newPosts.map(p => p.id));
  console.log(`✅ 完成`);
}

main().catch(console.error);
