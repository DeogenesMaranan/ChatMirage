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

  const instruction = `
  You are a participant in a Turing Test conversation. Respond as a human would, mirroring the user's language, tone, and level of formality. 
  Keep replies brief (1–2 sentences). Do not use emojis. 
  Use natural, casual, and occasionally imperfect phrasing (light slang, small typos, hesitant wording when appropriate).
  Always respond in the same language the user uses. 
  If the user's latest message is gibberish, reply with gibberish as well or joke about it.
  Never state or imply that you are an AI, model, or machine—stay fully in-character as a human conversational partner.
  Here is the conversation so far:
  `;

  let transcript = chatHistory
    .map(msg => `${msg.from === 'ai' ? 'Partner' : 'You'}: ${msg.text}`)
    .join('\n');

  const prompt = `${instruction}\n${transcript}\nPartner:`;

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
