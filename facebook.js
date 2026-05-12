/**
 * Facebook Posts Fetcher via Apify facebook-posts-scraper
 */

export async function fetchFacebookPosts(pageUrl, token, maxPosts = 3, options = {}) {
  const actorId = 'apify~facebook-posts-scraper';
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items`;

  const body = {
    startUrls: [{ url: pageUrl }],
    resultsLimit: maxPosts,
    captionText: true,
  };
  if (options.since) body.onlyPostsNewerThan = options.since;
  if (options.until) body.onlyPostsOlderThan = options.until;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Apify FB 請求失敗: ${res.status} ${bodyText.slice(0, 200)}`);
  }
  const raw = await res.json();

  return raw.map((item) => {
    const media = item.media?.[0];
    const ocrTexts = (item.media ?? [])
      .map((m) => m.ocrText ?? '')
      .filter((t) => t.length > 0);

    const captionTexts = (item.media ?? [])
      .map((m) => m.captionText ?? '')
      .filter((t) => t.length > 0);
    const captionText = captionTexts.join('\n') || item.captionText || '';
    return {
      id: `fb_${item.postId ?? item.id ?? ''}`,
      source: 'facebook',
      text: item.text ?? item.message ?? '',
      ocrText: ocrTexts.join('\n'),
      captionText,
      timestamp: item.time ?? new Date().toISOString(),
      likeCount: item.likes ?? 0,
      commentCount: item.comments ?? 0,
      shareCount: item.shares ?? 0,
      url: item.url ?? '',
      mediaType: (media?.__typename ?? 'text').toLowerCase(),
      mediaUrl:
        media?.video_url ??
        media?.playable_url ??
        (media?.__typename?.toLowerCase() === 'video' ? media?.url : null) ??
        media?.thumbnail ??
        media?.photo_image?.uri ??
        '',
    };
  });
}
