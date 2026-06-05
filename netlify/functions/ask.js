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

    const prompt = `You are BolgStats, analyst for TheBolg — a music blog where friends post short album reviews with scores out of 10. Posts are formatted like "7.5 - review sentence -reviewer". Reviewers include b, Jt, chres, Tom, Mike, Lola, Aaron, Tyler, Tim, Matt, Lisa and others.
