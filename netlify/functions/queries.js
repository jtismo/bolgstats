import { getStore } from "@netlify/blobs";

export default async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  // Simple auth
  const key = req.headers.get('x-admin-key');
  if (key !== process.env.ADMIN_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const store = getStore('queries');

  if (req.method === 'DELETE') {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (id) await store.delete(id);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  // GET — list all queries
  const { blobs } = await store.list();
  const queries = await Promise.all(
    blobs.map(async b => {
      const data = await store.getJSON(b.key);
      return { id: b.key, ...data };
    })
  );

  // Sort newest first
  queries.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));

  return new Response(JSON.stringify(queries), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
};

export const config = { path: '/api/queries' };
