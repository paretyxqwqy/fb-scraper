/**
 * FB Seen Posts Tracker
 * Tracks which posts have been seen per page URL.
 * Stores in ~/.fb_seen_posts.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

const SEEN_FILE = path.join(homedir(), '.fb_seen_posts.json');

function load() {
  try {
    if (existsSync(SEEN_FILE)) {
      return JSON.parse(readFileSync(SEEN_FILE, 'utf8'));
    }
  } catch (_) {}
  return {};
}

function save(store) {
  writeFileSync(SEEN_FILE, JSON.stringify(store, null, 2));
}

export function markSeen(pageUrl, postIds) {
  const store = load();
  if (!store[pageUrl]) store[pageUrl] = [];
  const seen = new Set(store[pageUrl]);
  for (const id of postIds) seen.add(id);
  store[pageUrl] = Array.from(seen);
  save(store);
}

export function filterSeen(pageUrl, posts) {
  const store = load();
  if (!store[pageUrl]) return posts;
  const seen = new Set(store[pageUrl]);
  return posts.filter(p => !seen.has(p.id));
}

export function listSeen(pageUrl) {
  const store = load();
  return store[pageUrl] || [];
}

export function clearSeen(pageUrl) {
  const store = load();
  if (pageUrl) {
    delete store[pageUrl];
  } else {
    Object.keys(store).forEach(k => delete store[k]);
  }
  save(store);
}
