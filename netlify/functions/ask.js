import { getStore } from "@netlify/blobs";

export default async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const body = await req.json();

    // Audit mode
    if (body.rawPrompt) {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4000,
          messages: [{ role: 'user', content: body.rawPrompt }]
        })
      });
      const d = await resp.json();
      const text = (d.content||[]).map(c=>c.text||'').join('');
      return new Response(JSON.stringify({ answer: text }), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const { question, albums, posts, reviewerVoice, reviewerName } = body;
    const archive = albums || posts || [];
    const isGrouped = archive.length > 0 && Array.isArray(archive[0].reviews);

    // ── LOG QUERY ─────────────────────────────────────────────────────────
    try {
      const store = getStore('queries');
      const key = `q_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
      await store.setJSON(key, {
        question,
        reviewer: reviewerName || 'unknown',
        timestamp: new Date().toISOString(),
      });
    } catch(e) {
      console.warn('Query log failed:', e.message);
    }

    // ── PRE-CALCULATE STATS ───────────────────────────────────────────────
    const reviewerScores = {}, reviewerCounts = {};
    const pickScores = {}, pickCounts = {};
    const genreScores = {}, genreCounts = {};
    let highestAlbum = null, lowestAlbum = null;

    const genreNorm = g => g.trim()
      .replace(/^hiphop$/i, 'Hip Hop')
      .replace(/^hip-hop$/i, 'Hip Hop')
      .replace(/^r&b\/soul$/i, 'R&B')
      .replace(/^indie$/i, 'Indie')
      .toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

    archive.forEach(a => {
      if (a.genre) {
        const g = genreNorm(a.genre);
        if (!genreScores[g]) { genreScores[g] = 0; genreCounts[g] = 0; }
      }
      (a.reviews||[]).forEach(r => {
        if (r.score == null) return;
        if (!reviewerScores[r.reviewer]) { reviewerScores[r.reviewer] = 0; reviewerCounts[r.reviewer] = 0; }
        reviewerScores[r.reviewer] += r.score;
        reviewerCounts[r.reviewer]++;
        if (a.pick) {
          if (!pickScores[a.pick]) { pickScores[a.pick] = 0; pickCounts[a.pick] = 0; }
          pickScores[a.pick] += r.score;
          pickCounts[a.pick]++;
        }
        if (a.genre) {
          const g = genreNorm(a.genre);
          genreScores[g] += r.score;
          genreCounts[g]++;
        }
      });
      if (a.avgScore && (a.reviews||[]).length >= 2) {
        if (!highestAlbum || a.avgScore > highestAlbum.avgScore) highestAlbum = a;
        if (!lowestAlbum || a.avgScore < lowestAlbum.avgScore) lowestAlbum = a;
      }
    });

    const reviewerAvgs = Object.entries(reviewerScores)
      .map(([n,t]) => ({ name: n, avg: (t/reviewerCounts[n]).toFixed(2), count: reviewerCounts[n] }))
      .sort((a,b) => b.avg - a.avg);

    const pickAvgs = Object.entries(pickScores)
      .map(([n,t]) => ({ name: n, avg: (t/pickCounts[n]).toFixed(2), picks: pickCounts[n] }))
      .sort((a,b) => b.avg - a.avg);

    const genreAvgs = Object.entries(genreScores)
      .filter(([g]) => genreCounts[g] >= 2)
      .map(([g,t]) => ({ genre: g, avg: (t/genreCounts[g]).toFixed(2), count: genreCounts[g] }))
      .sort((a,b) => b.avg - a.avg);

    const topAlbums = [...archive]
      .filter(a => a.avgScore && (a.reviews||[]).length >= 2)
      .sort((a,b) => b.avgScore - a.avgScore).slice(0,10)
      .map(a => `${a.album} by ${a.artist} (${a.avgScore}, ${a.year})`);

    const bottomAlbums = [...archive]
      .filter(a => a.avgScore && (a.reviews||[]).length >= 2)
      .sort((a,b) => a.avgScore - b.avgScore).slice(0,5)
      .map(a => `${a.album} by ${a.artist} (${a.avgScore}, ${a.year})`);

    const stats = `PRE-CALCULATED STATS (exact numbers — always use these for factual questions):
Reviewer avg scores: ${reviewerAvgs.map(r=>`${r.name}: ${r.avg} (${r.count} reviews)`).join(', ')}
Pick avg scores (avg of all reviews on their picks): ${pickAvgs.map(p=>`${p.name}: ${p.avg} (${p.picks} picks)`).join(', ')}
Genre avg scores: ${genreAvgs.map(g=>`${g.genre}: ${g.avg}`).join(', ')}
Top 10 albums by avg: ${topAlbums.join(' | ')}
Bottom 5 albums by avg: ${bottomAlbums.join(' | ')}
Total: ${archive.length} albums, ${archive.reduce((s,a)=>s+(a.reviews||[]).length,0)} reviews`;

    // ── CLASSIFY QUESTION TYPE ────────────────────────────────────────────
    const q = (question||'').toLowerCase();
    const isFactual = /\b(highest|lowest|most|least|average|avg|how many|total|count|best rated|worst rated|top|bottom|ranking|who gives|who scores|what score|what rating|which genre|picks have|what genre|genre gets|genre has|genre score)\b/.test(q);
    const mentionsReviewer = /\b(b|jt|chres|tom|tyler|lola|aaron|tim|matt|lisa|mike)\b/.test(q);
    const mentionsAlbum = archive.some(a =>
      a.album && q.includes(a.album.toLowerCase().slice(0, 10))
    );

    let context = '';

    if (isFactual && !mentionsAlbum) {
      // Factual question — stats are enough, send minimal context
      context = `(Full review text omitted — use pre-calculated stats above to answer)`;
    } else if (mentionsAlbum) {
      // Question about a specific album — find it and send full text
      const relevant = archive.filter(a =>
        a.album && q.includes(a.album.toLowerCase().slice(0,10))
      );
      context = relevant.map(a => {
        const pick = a.pick ? `[${a.pick}pick]` : '';
        const reviews = (a.reviews||[]).map(r =>
          `${r.reviewer}:${r.score??'?'}:${r.text||''}`
        ).join('\n');
        return `${a.album} by ${a.artist} (${a.year}) ${pick}\n${reviews}`;
      }).join('\n\n');
    } else if (mentionsReviewer) {
      // Question about a specific reviewer — send all their reviews with full text
      const revName = ['b','Jt','chres','Tom','Tyler','Lola','Aaron','Tim','Matt','Lisa','Mike']
        .find(r => q.includes(r.toLowerCase()));
      const relevant = archive.filter(a =>
        (a.reviews||[]).some(r => r.reviewer === revName && r.text)
      );
      context = relevant.map(a => {
        const rev = (a.reviews||[]).find(r => r.reviewer === revName);
        return `${a.album}|${a.artist}|${a.year}|${rev.reviewer}:${rev.score??'?'}:${rev.text||''}`;
      }).join('\n');
    } else {
      // Qualitative question — send all albums with full text
      context = archive.map(a => {
        const pick = a.pick ? `[${a.pick}pick]` : '';
        const reviews = (a.reviews||[]).map(r =>
          r.text
            ? `${r.reviewer}:${r.score??'?'}:${r.text}`
            : `${r.reviewer}:${r.score??'?'}`
        ).join(';');
        return `${a.album}|${a.artist}|${a.year}|${a.genre||''}|${pick}|${reviews}`;
      }).join('\n');
    }

    const rules = `\n\nRULES: 1-3 sentences max. No markdown, asterisks, bullets, or lists. No setup phrases like "Looking at..." or "Let me...". State the answer directly. Use pre-calculated stats for factual questions.`;

    const system = reviewerVoice
      ? reviewerVoice + `\n\nArchive format: album|artist|year|genre|[picker]|reviewer:score:text;...\n\n${stats}` + rules
      : `You are a music analyst for TheBolg, a music blog where friends review albums with scores out of 10.\n\n${stats}` + rules;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        system,
        messages: [{ role: 'user', content: `ARCHIVE:\n${context}\n\nQUESTION: ${question}` }]
      })
    });

    const result = await resp.json();
    const text = (result.content||[]).map(c=>c.text||'').join('').trim()
      || (result.error ? `Error: ${result.error.message}` : 'No answer found.');

    return new Response(JSON.stringify({ answer: text }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });

  } catch(err) {
    return new Response(JSON.stringify({ answer: `Error: ${err.message}` }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
};

export const config = { path: '/api/ask' };
