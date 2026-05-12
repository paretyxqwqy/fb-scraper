#!/usr/bin/env node
import { fetchFacebookPosts } from './facebook.js';
import { markSeen, filterSeen, listSeen, clearSeen } from './seen.js';
import { readFileSync } from 'fs';

const token = process.env.APIFY_TOKEN || (() => {
  try {
    const env = readFileSync('.env', 'utf8');
    for (const line of env.split('\n')) {
      const [k, v] = line.split('=');
      if (k?.trim() === 'APIFY_TOKEN') return v?.trim();
    }
  } catch {}
  return null;
})();

const PAGE_URL = process.argv[2] || 'https://www.facebook.com/i8stock';

if (!token) {
  console.error('請設定 APAFY_TOKEN 在 .env 檔案中');
  process.exit(1);
}

const cmd = process.argv[3];

if (cmd === 'clear') {
  clearSeen(PAGE_URL);
  console.log('已清空已讀記錄');
  process.exit(0);
}

if (cmd === 'list') {
  const seen = listSeen(PAGE_URL);
  console.log(`已讀 ${seen.length} 篇：`);
  seen.forEach(id => console.log(' ', id));
  process.exit(0);
}

console.log(`抓取：${PAGE_URL}`);
console.log('---');

const posts = await fetchFacebookPosts(PAGE_URL, token, 10);
const newPosts = filterSeen(PAGE_URL, posts);

console.log(`共 ${posts.length} 篇，已讀 ${posts.length - newPosts.length} 篇，新 ${newPosts.length} 篇`);

for (const post of newPosts) {
  console.log(`\n【${post.timestamp}】`);
  console.log(`ID: ${post.id}`);
  console.log(`內文: ${post.text.slice(0, 150)}`);
  if (post.ocrText) console.log(`OCR: ${post.ocrText.slice(0, 80)}`);
  console.log(`❤️ ${post.likeCount} 💬 ${post.commentCount}`);
  console.log(`URL: ${post.url}`);
}

// 標記已讀
markSeen(PAGE_URL, newPosts.map(p => p.id));
console.log(`\n✅ 已標記 ${newPosts.length} 篇為已讀`);
