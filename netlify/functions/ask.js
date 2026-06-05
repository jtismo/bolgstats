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
    const { question, posts } = await req.json();

    const context = posts.slice(0, 60).map(p => {
      const text = (p.body || p.caption || p.summary || '')
        .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
      return `[${(p.date||'').slice(0,10)}] ${text}`;
    }).join('\n\n');

    const prompt = `You are BolgStats, analyst for TheBolg — a music blog where friends post short album reviews with scores out of 10. Posts are formatted like "7.5 - review sentence -reviewer". Reviewers include b, Jt, chres, Tom, Mike, Lola, Aaron, Tyler, Tim, Matt, Lisa and others. Answer concisely and wittily, referencing real scores and reviews.\n\nPOSTS:\n${context}\n\nQUESTION: ${question}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 400 }
        })
      }
    );

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
      || `Gemini error: ${JSON.stringify(data).slice(0, 200)}`;

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
