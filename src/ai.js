let GoogleGenerativeAI = null;
try {
  GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI || require('@google/generative-ai').default || null;
} catch (e) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });

async function aiRespond(chatHistory) {
  const lastUserMsg = chatHistory.length > 0 ? chatHistory[chatHistory.length - 1].text : '';

  function isGibberish(text) {
    const vowelCount = (text.match(/[aeiouAEIOU]/g) || []).length;
    const alphaCount = (text.match(/[a-zA-Z]/g) || []).length;
    const nonAlphaCount = (text.match(/[^a-zA-Z0-9\s]/g) || []).length;
    if (text.length > 0 && (vowelCount < 2 || alphaCount < text.length * 0.3 || nonAlphaCount > text.length * 0.5)) {
      return true;
    }
    return false;
  }

  function detectLanguage(text) {
    if (/^[\u4e00-\u9fff]+$/.test(text)) return 'zh'; // Chinese
    if (/^[а-яА-ЯёЁ]+$/.test(text)) return 'ru'; // Russian
    if (/^[a-zA-Z\s]+$/.test(text)) return 'en'; // English
    return 'auto';
  }

  // If gibberish, reply with gibberish
  if (isGibberish(lastUserMsg)) {
    const shuffled = lastUserMsg.split('').sort(() => Math.random() - 0.5).join('');
    const randomChars = Math.random().toString(36).substring(2, 6);
    return `${shuffled}${randomChars}`;
  }

  // Otherwise, reply in user's language and humanlike style
  const language = detectLanguage(lastUserMsg);
  const instruction =
    "You are participating in a Turing Test game. Reply as humanlike as possible, matching the user's language and style. Keep your responses concise (1-2 sentences). Do not use emojis. If the user writes in English, reply in English. If in another language, reply in that language. Use natural, casual, and sometimes imperfect phrasing. Never reveal you are an AI.\n";

  // Build a chat transcript for context
  let transcript = chatHistory.map(msg => `${msg.from === 'ai' ? 'Partner' : 'You'}: ${msg.text}`).join('\n');
  const prompt = instruction + transcript + '\nPartner:';
  const messages = [
    {
      role: 'user',
      parts: [{ text: prompt }]
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
