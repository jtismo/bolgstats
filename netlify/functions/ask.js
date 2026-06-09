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

    // Normal search mode
    const { question, albums, posts, reviewerVoice } = body;
    const archive = albums || posts || [];
    const isGrouped = archive.length > 0 && Array.isArray(archive[0].reviews);

    // Pre-calculate key stats so Claude doesn't have to guess
    let stats = '';
    if (isGrouped) {
      // Reviewer avg scores
      const reviewerScores = {};
      const reviewerCounts = {};
      archive.forEach(a => {
        (a.reviews||[]).forEach(r => {
          if (r.score == null) return;
          if (!reviewerScores[r.reviewer]) { reviewerScores[r.reviewer] = 0; reviewerCounts[r.reviewer] = 0; }
          reviewerScores[r.reviewer] += r.score;
          reviewerCounts[r.reviewer]++;
        });
      });
      const reviewerAvgs = Object.entries(reviewerScores)
        .map(([name, total]) => ({ name, avg: (total/reviewerCounts[name]).toFixed(2), count: reviewerCounts[name] }))
        .sort((a,b) => b.avg - a.avg);

      // Pick avg scores
      const pickScores = {};
      const pickCounts = {};
      archive.forEach(a => {
        if (!a.pick) return;
        (a.reviews||[]).forEach(r => {
          if (r.score == null) return;
          if (!pickScores[a.pick]) { pickScores[a.pick] = 0; pickCounts[a.pick] = 0; }
          pickScores[a.pick] += r.score;
          pickCounts[a.pick]++;
        });
      });
      const pickAvgs = Object.entries(pickScores)
        .map(([name, total]) => ({ name, avg: (total/pickCounts[name]).toFixed(2), count: pickCounts[name] }))
        .sort((a,b) => b.avg - a.avg);

      // Picker's own scores on their own picks
      const selfPickScores = {};
      const selfPickCounts = {};
      archive.forEach(a => {
        if (!a.pick) return;
        (a.reviews||[]).forEach(r => {
          if (r.reviewer !== a.pick || r.score == null) return;
          if (!selfPickScores[a.pick]) { selfPickScores[a.pick] = 0; selfPickCounts[a.pick] = 0; }
          selfPickScores[a.pick] += r.score;
          selfPickCounts[a.pick]++;
        });
      });

      // Top albums
      const topAlbums = [...archive]
        .filter(a => a.avgScore)
        .sort((a,b) => b.avgScore - a.avgScore)
        .slice(0,5)
        .map(a => `${a.album} by ${a.artist} (${a.avgScore})`);

      // Bottom albums  
      const bottomAlbums = [...archive]
        .filter(a => a.avgScore && (a.reviews||[]).length >= 2)
        .sort((a,b) => a.avgScore - b.avgScore)
        .slice(0,5)
        .map(a => `${a.album} by ${a.artist} (${a.avgScore})`);

      stats = `
PRE-CALCULATED STATS (these are exact — use them):
Reviewer avg scores: ${reviewerAvgs.map(r=>`${r.name}: ${r.avg} (${r.count} reviews)`).join(', ')}
Pick avg scores (all reviews on their picks): ${pickAvgs.map(p=>`${p.name}: ${p.avg} (${p.count} reviews on ${pickCounts[p.name]} picks)`).join(', ')}
Top 5 albums by avg score: ${topAlbums.join(', ')}
Bottom 5 albums by avg score: ${bottomAlbums.join(', ')}
Total albums: ${archive.length}, Total reviews: ${archive.reduce((s,a)=>s+(a.reviews||[]).length,0)}
`;
    }

    // Build compact archive context
    const context = isGrouped
      ? archive.map(a => {
          const pick = a.pick ? `[${a.pick}pick]` : '';
          const reviews = (a.reviews||[]).map(r => {
            const text = (r.text||'').replace(/\|/g,' ');
            return `${r.reviewer}:${r.score??'?'}:${text}`;
          }).join(';');
          return `${a.album}|${a.artist}|${a.year}|${a.genre||''}|${pick}|avg:${a.avgScore??'?'}|${reviews}`;
        }).join('\n')
      : archive.map(r =>
          `${r.reviewer}|${r.score??'?'}|${r.album}|${r.artist}|${r.text||''}`
        ).join('\n');

    const rules = `\n\nRULES: 1-3 sentences max. No markdown, asterisks, bullets, or lists. No "Looking at..." or "Let me..." setup phrases. State the answer directly like you're texting a friend. The pre-calculated stats above are accurate — use them for any factual question.`;

    const system = reviewerVoice
      ? reviewerVoice + `\n\nArchive format: album|artist|year|genre|[picker]|avgScore|reviewer:score:text;...\n${stats}` + rules
      : `You are a music analyst for TheBolg. Archive format: album|artist|year|genre|[picker]|avgScore|reviewer:score:text;...\n${stats}` + rules;

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
        messages: [{ role: 'user', content: `ARCHIVE (${archive.length} albums):\n${context}\n\nQUESTION: ${question}` }]
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
