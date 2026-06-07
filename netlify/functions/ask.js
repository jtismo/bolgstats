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
      const response = await fetch('https://api.anthropic.com/v1/messages', {
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
      const data = await response.json();
      const text = (data.content||[]).map(c=>c.text||'').join('');
      return new Response(JSON.stringify({ answer: text }), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    // Normal search mode — albums is the new grouped structure
    const { question, albums, reviewerVoice } = body;

    // Build compact context from album-grouped data
    // Format: album|artist|year|genre|pick|avgScore|reviewer:score:text,...
    const context = albums.map(a => {
      const pick = a.pick ? `[${a.pick}pick]` : '';
      const reviews = (a.reviews || []).map(r => {
        const text = (r.text || '').slice(0, 100).replace(/\|/g, ' ');
        return `${r.reviewer}:${r.score ?? '?'}:${text}`;
      }).join(';');
      return `${a.album}|${a.artist}|${a.year}|${a.genre||''}|${pick}|avg:${a.avgScore??'?'}|${reviews}`;
    }).join('\n');

    const system = reviewerVoice
      ? reviewerVoice + `\n\nArchive format per line: album|artist|year|genre|[picker]|avgScore|reviewer:score:reviewText;... Use this to answer questions. Picks mean that reviewer chose the album for the group to review.`
      : `You are a music analyst for TheBolg, a music blog where friends review albums with scores out of 10. Archive format per line: album|artist|year|genre|[picker]|avgScore|reviewer:score:reviewText;... Picks mean that reviewer chose the album for the group to review. Be concise and witty.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system,
        messages: [{ role: 'user', content: `ARCHIVE (${albums.length} albums):\n${context}\n\nQUESTION: ${question}` }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || `Error: ${JSON.stringify(data).slice(0,200)}`;

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
