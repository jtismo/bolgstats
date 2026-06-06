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

    // Audit mode: raw prompt passed directly
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

    // Normal search mode
    const { question, posts, reviewerVoice, reviewerName } = body;

    const context = posts.map(r => {
      const score = r.score != null ? r.score : '?';
      const pick = r.pick ? `[${r.pick}pick]` : '';
      // Super compact: reviewer|score|album|artist|text (no labels, no quotes, no date)
      return `${r.reviewer}|${score}${pick}|${r.album}|${r.artist}|${(r.text||'').slice(0,120)}`;
    }).join('\n');

    const system = reviewerVoice
      ? reviewerVoice + `\n\nArchive format: reviewer|score|album|artist|review_text. Use this data to answer questions.`
      : `You are a music analyst for TheBolg, a blog where friends review albums with scores out of 10. Archive format: reviewer|score|album|artist|review_text. Be concise and witty.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system,
        messages: [{ role: 'user', content: `ARCHIVE POSTS:\n${context}\n\nQUESTION: ${question}` }]
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
