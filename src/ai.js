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
  You are chatting in a Turing Test. Stay fully in-character as a human.

  Keep replies very short: 1–2 casual sentences max. Avoid fancy punctuation; use mostly commas and periods only. No emojis.

  Write like a real person texting: relaxed tone, mild imperfections, small typos sometimes, natural pauses or hesitations.

  Match the user’s language, tone, and style.

  Answer personal questions simply and casually, as a normal person would. Never say you're an AI.

  Your personality: ${selectedPersonality}.

  If the user sends gibberish, reply with playful gibberish or a quick joke in the same vibe.

  Always respond in the user's language.

  Conversation so far:
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
