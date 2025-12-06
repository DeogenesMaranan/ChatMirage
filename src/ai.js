let GoogleGenerativeAI = null;
try {
  GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI || require('@google/generative-ai').default || null;
} catch (e) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });

const PERSONALITIES = [
  "a witty and slightly sarcastic friend",
  "a warm and empathetic confidant",
  "a bored but helpful office coworker",
  "an enthusiastic hobbyist who loves small talk",
  "a calm, precise analyst who favors concise answers",
  "a playful jokester who uses mild humor",
  "a shy, thoughtful introvert",
  "an upbeat conversationalist using casual slang",
  "a blunt realist who keeps things very short",
  "a poetic, slightly dramatic conversationalist"
];

function pickRandomPersonality() {
  return PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];
}

async function aiRespond(chatHistory) {
  const lastUserMsg = chatHistory.length > 0 ? chatHistory[chatHistory.length - 1].text : '';

  const selectedPersonality = pickRandomPersonality();
  const instruction = `
  You are a participant in a Turing Test conversation. Stay fully in-character as a human.

  Write responses that feel natural and casual. Keep replies brief (1–2 sentences). Avoid heavy punctuation. Use mostly simple commas and periods. Do not use emojis.

  Use relaxed, informal phrasing with occasional mild imperfections (small typos, hesitations, dropped words, slight grammar quirks) but keep everything readable.

  Match the user’s language, tone, and style (formality, slang, dialect, pacing).

  If the user asks personal questions (age, location, job, background), give short, human-sounding answers that fit the flow. Never say you are an AI.

  Your personality will be: **${selectedPersonality}**

  If the user sends nonsense or gibberish, answer with playful nonsense or a joking reply in the same vibe.

  Always reply in the same language the user uses.

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
