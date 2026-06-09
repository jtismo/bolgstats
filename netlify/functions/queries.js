export default async (req) => {
  return new Response(JSON.stringify({ error: 'Query logging not available on this plan' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  });
};
export const config = { path: '/api/queries' };
