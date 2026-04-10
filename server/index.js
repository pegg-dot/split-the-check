const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const anthropic = new Anthropic.default({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

app.post('/api/scan-receipt', async (req, res) => {
  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    // Extract base64 data and media type from data URL
    const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid image format' });
    }

    const mediaType = match[1];
    const base64Data = match[2];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data,
              },
            },
            {
              type: 'text',
              text: `Extract every line item from this receipt. Return ONLY valid JSON in this exact format, no other text:

{
  "items": [
    { "name": "Item Name", "price": 12.99 }
  ],
  "tax": 0.00
}

Rules:
- "name" is the item description (clean it up if abbreviated)
- "price" is the total price for that line as a number (not per-unit — use the line total)
- "tax" is the tax amount if visible on the receipt, otherwise 0
- Do NOT include the total line, subtotal line, or tax line as items
- Do NOT include tip lines as items
- Prices should be numbers, not strings`,
            },
          ],
        },
      ],
    });

    const text = response.content[0].text.trim();

    // Parse JSON from Claude's response — handle markdown code blocks
    let jsonStr = text;
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    const data = JSON.parse(jsonStr);
    res.json(data);
  } catch (err) {
    console.error('Receipt scan error:', err.message);
    res.status(500).json({ error: 'Failed to scan receipt' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
