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
    const { system, messages, max_tokens } = await req.json();
    const prompt = system
      ? `${system}\n\n${messages[0].content}`
      : messages[0].content;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: max_tokens || 800 }
        })
      }
    );

    const data = await response.json();
    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      return new Response(JSON.stringify({ 
        content: [{ type: 'text', text: `Debug: ${JSON.stringify(data)}` }] 
      }), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
    const text = data.candidates[0].content.parts[0].text;

    return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch(err) {
    return new Response(JSON.stringify({ error: err
