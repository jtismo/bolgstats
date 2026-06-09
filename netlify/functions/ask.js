import { getStore } from "@netlify/blobs";

export default async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  try {
    const body = await req.json();

    // ── AUDIT MODE ────────────────────────────────────────────────────────
    if (body.rawPrompt) {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 4000, messages: [{ role: 'user', content: body.rawPrompt }] })
      });
      const d = await resp.json();
      return new Response(JSON.stringify({ answer: (d.content||[]).map(c=>c.text||'').join('') }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const { question, albums, posts, reviewerVoice, reviewerName } = body;
    const archive = albums || posts || [];
    const isGrouped = archive.length > 0 && Array.isArray(archive[0].reviews);

    // ── LOG QUERY ─────────────────────────────────────────────────────────
    try {
      const store = getStore('queries');
      await store.setJSON(`q_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, {
        question, reviewer: reviewerName || 'unknown', timestamp: new Date().toISOString()
      });
    } catch(e) { console.warn('Log failed:', e.message); }

    // ── PRE-CALCULATE STATS ───────────────────────────────────────────────
    const normGenre = g => {
      if (!g) return null;
      const s = g.trim().toLowerCase();
      if (s === 'hiphop' || s === 'hip-hop') return 'Hip Hop';
      if (s === 'r&b/soul') return 'R&B';
      return s.replace(/\b\w/g, c => c.toUpperCase());
    };

    const rScores = {}, rCounts = {};
    const pScores = {}, pCounts = {};
    const gScores = {}, gCounts = {};

    archive.forEach(a => {
      const genre = normGenre(a.genre);
      (a.reviews||[]).forEach(r => {
        if (r.score == null) return;
        // reviewer
        rScores[r.reviewer] = (rScores[r.reviewer]||0) + r.score;
        rCounts[r.reviewer] = (rCounts[r.reviewer]||0) + 1;
        // pick
        if (a.pick) {
          pScores[a.pick] = (pScores[a.pick]||0) + r.score;
          pCounts[a.pick] = (pCounts[a.pick]||0) + 1;
        }
        // genre
        if (genre) {
          gScores[genre] = (gScores[genre]||0) + r.score;
          gCounts[genre] = (gCounts[genre]||0) + 1;
        }
      });
    });

    const reviewerAvgs = Object.keys(rScores)
      .map(n => `${n}: ${(rScores[n]/rCounts[n]).toFixed(2)} (${rCounts[n]} reviews)`)
      .sort().join(', ');

    const pickAvgs = Object.keys(pScores)
      .map(n => ({ n, avg: pScores[n]/pCounts[n] }))
      .sort((a,b) => b.avg - a.avg)
      .map(x => `${x.n}: ${x.avg.toFixed(2)} (${pCounts[x.n]} picks)`)
      .join(', ');

    const genreAvgs = Object.keys(gScores)
      .filter(g => gCounts[g] >= 2)
      .map(g => ({ g, avg: gScores[g]/gCounts[g] }))
      .sort((a,b) => b.avg - a.avg)
      .map(x => `${x.g}: ${x.avg.toFixed(2)} (${gCounts[x.g]} reviews)`)
      .join(', ');

    const topAlbums = [...archive]
      .filter(a => a.avgScore && (a.reviews||[]).length >= 2)
      .sort((a,b) => b.avgScore - a.avgScore).slice(0,10)
      .map(a => `${a.album} by ${a.artist} (${a.avgScore})`).join(' | ');

    const bottomAlbums = [...archive]
      .filter(a => a.avgScore && (a.reviews||[]).length >= 2)
      .sort((a,b) => a.avgScore - b.avgScore).slice(0,5)
      .map(a => `${a.album} by ${a.artist} (${a.avgScore})`).join(' | ');

    const totalReviews = archive.reduce((s,a)=>s+(a.reviews||[]).length,0);

    const stats = `PRE-CALCULATED STATS — use these for any factual question:
Reviewer avg scores: ${reviewerAvgs}
Pick avg scores: ${pickAvgs}
Genre avg scores: ${genreAvgs}
Top 10 albums: ${topAlbums}
Bottom 5 albums: ${bottomAlbums}
Total: ${archive.length} albums, ${totalReviews} reviews`;

    // ── CLASSIFY & BUILD CONTEXT ──────────────────────────────────────────
    const q = (question||'').toLowerCase();
    const isFactual = /\b(highest|lowest|most|least|average|avg|how many|total|count|best rated|worst rated|top|bottom|ranking|who gives|who scores|what score|what rating|which genre|picks have|what genre|genre gets|genre has|genre score)\b/.test(q);
    const mentionsReviewer = /\b(b|jt|chres|tom|tyler|lola|aaron|tim|matt|lisa|mike)\b/.test(q);
    const mentionsAlbum = archive.some(a => a.album && a.album.length > 4 && q.includes(a.album.toLowerCase().slice(0,10)));

    let context;
    if (isFactual && !mentionsAlbum) {
      context = '(Use pre-calculated stats above to answer — no archive text needed)';
    } else if (mentionsAlbum) {
      const relevant = archive.filter(a => a.album && a.album.length > 4 && q.includes(a.album.toLowerCase().slice(0,10)));
      context = relevant.map(a =>
        `${a.album} by ${a.artist} (${a.year})${a.pick?' ['+a.pick+'pick]':''}\n` +
        (a.reviews||[]).map(r => `${r.reviewer}: ${r.score??'?'} — ${r.text||'(no text)'}`).join('\n')
      ).join('\n\n');
    } else if (mentionsReviewer) {
      const revName = ['b','Jt','chres','Tom','Tyler','Lola','Aaron','Tim','Matt','Lisa','Mike'].find(r => q.includes(r.toLowerCase()));
      context = archive
        .filter(a => (a.reviews||[]).some(r => r.reviewer === revName))
        .map(a => {
          const rev = (a.reviews||[]).find(r => r.reviewer === revName);
          return `${a.album} by ${a.artist} (${a.year}) — ${rev.reviewer}: ${rev.score??'?'} — ${rev.text||'(no text)'}`;
        }).join('\n');
    } else {
      context = archive.map(a => {
        const pick = a.pick ? `[${a.pick}pick]` : '';
        const reviews = (a.reviews||[]).map(r => r.text ? `${r.reviewer}:${r.score??'?'}:${r.text}` : `${r.reviewer}:${r.score??'?'}`).join(';');
        return `${a.album}|${a.artist}|${a.year}|${a.genre||''}|${pick}|${reviews}`;
      }).join('\n');
    }

    const rules = `\n\nRULES: 1-3 sentences max. No markdown, asterisks, bullets, or lists. No setup phrases. Answer directly like texting a friend.`;
    const system = (reviewerVoice || 'You are a music analyst for TheBolg, a music blog where friends review albums scored out of 10.')
      + `\n\n${stats}` + rules;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        system,
        messages: [{ role: 'user', content: `ARCHIVE:\n${context}\n\nQUESTION: ${question}` }]
      })
    });

    const result = await resp.json();
    const text = (result.content||[]).map(c=>c.text||'').join('').trim()
      || (result.error?.message ? `Error: ${result.error.message}` : 'No answer found.');

    return new Response(JSON.stringify({ answer: text }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch(err) {
    return new Response(JSON.stringify({ answer: `Error: ${err.message}` }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
};

export const config = { path: '/api/ask' };
