let GoogleGenerativeAI = null;
try {
  GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI || require('@google/generative-ai').default || null;
} catch (e) {

  const { GoogleGenerativeAI } = require('@google/generative-ai');
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });

function detectLanguage(text) {
  if (!text) return 'en';
  const t = text.toLowerCase();
  if (t.match(/\b(hola|gracias|¿|adiós|buenos)\b/)) return 'es';
  if (t.match(/\b(bonjour|merci|au revoir|salut)\b/)) return 'fr';
  if (t.match(/\b(hallo|danke|tschüss)\b/)) return 'de';
  if (t.match(/\b(olá|obrigado|adeus)\b/)) return 'pt';
  if (t.match(/\b(the|is|and|you|why|hello)\b/)) return 'en';
  return 'en';
}

async function aiRespond(userMessage) {
  const lang = detectLanguage(userMessage);

  const messages = [
    {
      role: 'user',
      parts: [{ text: userMessage }]
    }
  ];

  try {
    const result = await model.generateContent({ contents: messages });
    return result.response.text();
  } catch (err) {
    console.error('AI generation error:', err);
    throw new Error('Failed to generate AI response.');
  }
}

module.exports = { aiRespond };
