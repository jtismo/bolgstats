export default async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  try {
    const body = await req.json();

    // Audit mode
    if (body.rawPrompt) {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 4000, messages: [{ role: 'user', content: body.rawPrompt }] })
      });
      const d = await resp.json();
      return new Response(JSON.stringify({ answer: (d.content||[]).map(c=>c.text||'').join('') }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const { question, albums, posts } = body;
    const archive = albums || posts || [];

    // ── PRE-CALCULATE STATS ───────────────────────────────────────────────
    const rS = {}, rC = {}, pS = {}, pC = {}, gS = {}, gC = {};
    const normG = g => { if (!g) return null; const s = g.trim().toLowerCase(); if (s==='hiphop'||s==='hip-hop') return 'Hip Hop'; if (s==='r&b/soul') return 'R&B'; return s.replace(/\b\w/g,c=>c.toUpperCase()); };

    archive.forEach(a => {
      const g = normG(a.genre);
      (a.reviews||[]).forEach(r => {
        if (r.score==null) return;
        rS[r.reviewer]=(rS[r.reviewer]||0)+r.score; rC[r.reviewer]=(rC[r.reviewer]||0)+1;
        if (a.pick) { pS[a.pick]=(pS[a.pick]||0)+r.score; pC[a.pick]=(pC[a.pick]||0)+1; }
        if (g) { gS[g]=(gS[g]||0)+r.score; gC[g]=(gC[g]||0)+1; }
      });
    });

    const fmt = (scores, counts, key='name') => Object.keys(scores)
      .map(n=>({n, avg:scores[n]/counts[n], c:counts[n]}))
      .sort((a,b)=>b.avg-a.avg)
      .map(x=>`${x.n}: ${x.avg.toFixed(2)} (${x.c})`).join(', ');

    const topAlbums = [...archive].filter(a=>a.avgScore&&(a.reviews||[]).length>=2)
      .sort((a,b)=>b.avgScore-a.avgScore).slice(0,10)
      .map(a=>`${a.album} by ${a.artist} (${a.avgScore})`).join(' | ');

    const bottomAlbums = [...archive].filter(a=>a.avgScore&&(a.reviews||[]).length>=2)
      .sort((a,b)=>a.avgScore-b.avgScore).slice(0,5)
      .map(a=>`${a.album} by ${a.artist} (${a.avgScore})`).join(' | ');

    const stats = `STATS:
Reviewer avgs: ${fmt(rS,rC)}
Pick avgs: ${fmt(pS,pC)}
Genre avgs: ${Object.keys(gS).filter(g=>gC[g]>=2).map(g=>({g,avg:gS[g]/gC[g],c:gC[g]})).sort((a,b)=>b.avg-a.avg).map(x=>`${x.g}: ${x.avg.toFixed(2)}`).join(', ')}
Top albums: ${topAlbums}
Bottom albums: ${bottomAlbums}
Total: ${archive.length} albums, ${archive.reduce((s,a)=>s+(a.reviews||[]).length,0)} reviews`;

    // ── FULL ARCHIVE CONTEXT ──────────────────────────────────────────────
    const context = archive.map(a => {
      const pick = a.pick ? `[${a.pick}pick]` : '';
      const reviews = (a.reviews||[]).map(r =>
        r.text ? `${r.reviewer}:${r.score??'?'}:${r.text}` : `${r.reviewer}:${r.score??'?'}`
      ).join(';');
      return `${a.album}|${a.artist}|${a.year}|${a.genre||''}|${pick}|${reviews}`;
    }).join('\n');

    const system = `You are a music analyst for TheBolg, a blog where friends review albums scored out of 10. Answer questions accurately and directly. 1-3 sentences max. No markdown, no asterisks, no bullets. No setup phrases. Just answer.

${stats}`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        system: [
          {
            type: 'text',
            text: system + `\n\nARCHIVE (${archive.length} albums):\n${context}`,
            cache_control: { type: 'ephemeral' }
          }
        ],
        messages: [{ role: 'user', content: question }]
      })
    });

    const result = await resp.json();
    const text = (result.content||[]).map(c=>c.text||'').join('').trim()
      || (result.error?.message ? `Error: ${result.error.message}` : 'No answer found.');

    return new Response(JSON.stringify({ answer: text }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch(err) {
    return new Response(JSON.stringify({ answer: `Error: ${err.message}` }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
};

export const config = { path: '/api/ask' };
