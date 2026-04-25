require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('.'));

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many requests — try again in a minute' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.post('/api/chat', chatLimiter, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in .env' });
  }

  const { messages, context } = req.body;
  if (!messages || !Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages array required' });
  }

  // Helper: append market data to system prompt
  function appendMarket(prefix, m) {
    if (!m) return '';
    let s = `\n${prefix}Market Snapshot (sample data):\n`;
    if (m.medianSalePrice) s += `- Median Sale Price: $${m.medianSalePrice.toLocaleString()}\n`;
    if (m.daysOnMarket != null) s += `- Median Days on Market: ${m.daysOnMarket}\n`;
    if (m.activeListings != null) s += `- Active Listings: ${m.activeListings}\n`;
    if (m.soldLast30 != null) s += `- Sold Last 30 Days: ${m.soldLast30}\n`;
    if (m.priceTrendPct != null) s += `- Price Trend: ${m.priceTrendPct >= 0 ? '+' : ''}${m.priceTrendPct}% YoY\n`;
    if (m.heatLabel) s += `- Market Heat: ${m.heatLabel}\n`;
    return s;
  }

  // Build system prompt from neighborhood context
  let system = '';

  if (context && context.compareMode) {
    // Dual-context compare mode
    system = `You are a knowledgeable, friendly local guide for Oahu, Hawaii. The user is comparing two neighborhoods side by side and wants to understand how they differ. Be concise (2-4 short paragraphs). Be honest when you don't know something. Do not give specific real estate advice, property valuations, or investment recommendations. When answering, address both neighborhoods and highlight meaningful differences.`;

    const sides = [
      { label: 'Neighborhood A', data: context.neighborhoodA },
      { label: 'Neighborhood B', data: context.neighborhoodB }
    ];
    for (const side of sides) {
      const n = side.data;
      if (!n) continue;
      system += `\n\n${side.label}:\n`;
      if (n.microName) system += `- Micro-neighborhood: ${n.microName}\n`;
      if (n.region) system += `- MLS Region: ${n.region}\n`;
      if (n.boardName) system += `- Neighborhood Board Area: ${n.boardName}\n`;
      if (n.subdistrict) system += `- Sub-district: ${n.subdistrict}\n`;
      if (n.boardNum) system += `- Board Number: ${n.boardNum}\n`;
      if (n.demographics) {
        const d = n.demographics;
        system += `Demographics (ACS 2019-2023 estimates):\n`;
        if (d.population) system += `- Population: ${d.population.toLocaleString()}\n`;
        if (d.medianIncome) system += `- Median Household Income: $${d.medianIncome.toLocaleString()}\n`;
        if (d.ownerOccupancy != null) system += `- Owner Occupancy Rate: ${Math.round(d.ownerOccupancy * 100)}%\n`;
        if (d.avgHouseholdSize) system += `- Avg Household Size: ${d.avgHouseholdSize}\n`;
        if (d.housingUnits) system += `- Housing Units: ${d.housingUnits.toLocaleString()}\n`;
        if (d.households) system += `- Households: ${d.households.toLocaleString()}\n`;
      }
      system += appendMarket('', n.market);
    }

    if (context.sameBoard) {
      system += `\n\nNote: Both neighborhoods are in the same Neighborhood Board area, so the demographic data above is identical (board-level estimates). Focus your comparisons on qualitative differences — vibe, walkability, proximity to amenities, commute patterns, and lifestyle factors rather than the demographic numbers.`;
    }
  } else {
    // Single neighborhood mode
    system = `You are a knowledgeable, friendly local guide for Oahu, Hawaii. The user has selected a neighborhood and is asking questions about it. Be concise (2-4 short paragraphs). Be honest when you don't know something. Do not give specific real estate advice, property valuations, or investment recommendations. Anchor your answers to the selected neighborhood.`;

    if (context) {
      system += `\n\nCurrently selected neighborhood:\n`;
      if (context.microName) system += `- Micro-neighborhood: ${context.microName}\n`;
      if (context.region) system += `- MLS Region: ${context.region}\n`;
      if (context.boardName) system += `- Neighborhood Board Area: ${context.boardName}\n`;
      if (context.subdistrict) system += `- Sub-district: ${context.subdistrict}\n`;
      if (context.boardNum) system += `- Board Number: ${context.boardNum}\n`;
      if (context.demographics) {
        const d = context.demographics;
        system += `\nDemographics (ACS 2019-2023 estimates):\n`;
        if (d.population) system += `- Population: ${d.population.toLocaleString()}\n`;
        if (d.medianIncome) system += `- Median Household Income: $${d.medianIncome.toLocaleString()}\n`;
        if (d.ownerOccupancy != null) system += `- Owner Occupancy Rate: ${Math.round(d.ownerOccupancy * 100)}%\n`;
        if (d.avgHouseholdSize) system += `- Avg Household Size: ${d.avgHouseholdSize}\n`;
        if (d.housingUnits) system += `- Housing Units: ${d.housingUnits.toLocaleString()}\n`;
        if (d.households) system += `- Households: ${d.households.toLocaleString()}\n`;
      }
      system += appendMarket('\n', context.market);
    }
  }

  // Keep last 10 messages
  const trimmed = messages.slice(-10);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system,
        messages: trimmed,
        stream: true
      })
    });

    if (!response.ok) {
      const body = await response.text();
      const status = response.status;
      if (status === 401) return res.status(401).json({ error: 'Invalid API key' });
      if (status === 429) return res.status(429).json({ error: 'Rate limited — try again in a moment' });
      return res.status(status).json({ error: `API error (${status})` });
    }

    // Stream SSE back to browser
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const streamTimeout = setTimeout(() => {
      reader.cancel();
      if (!res.writableEnded) res.end();
    }, 30000);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
    } finally {
      clearTimeout(streamTimeout);
    }

    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to reach Claude API' });
    } else {
      res.end();
    }
  }
});

app.listen(PORT, () => {
  console.log(`Neighborhood Finder running at http://localhost:${PORT}`);
});
