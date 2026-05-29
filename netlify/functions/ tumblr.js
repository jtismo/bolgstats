export default async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const url = new URL(req.url);
    const offset = url.searchParams.get('offset') || '0';
    const KEY = 'BRqwhfZWyoRss6ax8Gbb4UrijPqO1aedOzYsVQfpIm23h9nmvU';

    const response = await fetch(
      `https://api.tumblr.com/v2/blog/thebolg.tumblr.com/posts?api_key=${KEY}&limit=50&offset=${offset}`
    );
    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
};

export const config = { path: '/api/tumblr' };
