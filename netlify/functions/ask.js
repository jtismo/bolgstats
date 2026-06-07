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

    const context = isGrouped
      ? archive.map(a => {
          const pick = a.pick ? `[${a.pick}pick]` : '';
          const reviews = (a.reviews || []).map(r => {
            const text = (r.text || '').slice(0, 60).replace(/\|/g, ' ');
            return `${r.reviewer}:${r.score ?? '?'}:${text}`;
          }).join(';');
          return `${a.album}|${a.artist}|${a.year}|${a.genre||''}|${pick}|avg:${a.avgScore??'?'}|${reviews}`;
        }).join('\n')
      : archive.map(r => {
          return `${r.reviewer}|${r.score??'?'}|${r.album}|${r.artist}|${(r.text||'').slice(0,60)}`;
        }).join('\n');

    const system = reviewerVoice
      ? reviewerVoice + `\n\nArchive format: album|artist|year|genre|[picker]|avgScore|reviewer:score:text;... Picks = who chose the album for the group.`
      : `You are a music analyst for TheBolg, a music blog where friends review albums with scores out of 10. Archive format: album|artist|year|genre|[picker]|avgScore|reviewer:score:text;... Be concise and witty.`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system,
        messages: [{ role: 'user', content: `ARCHIVE (${archive.length} albums):\n${context}\n\nQUESTION: ${question}` }]
      })
    });

    const result = await resp.json();
    const text = (result.content||[]).map(c => c.text||'').join('').trim()
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
