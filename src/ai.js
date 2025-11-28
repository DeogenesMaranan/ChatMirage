const aiResponses = [
  "Interesting, tell me more.",
  "I hadn't thought of that.",
  "Why do you say that?",
  "That makes sense.",
  "Can you explain further?",
  "Hmm... I agree.",
  "That's a surprising take!",
  "I see where you're coming from.",
  "Let's switch topics — what's your favorite movie?",
  "Do you enjoy traveling?"
];

function aiRespond(userMessage) {
  return new Promise((resolve) => {
    const delay = 400 + Math.random() * 1200;
    setTimeout(() => {
      const text = aiResponses[Math.floor(Math.random() * aiResponses.length)];
      resolve(text);
    }, delay);
  });
}

module.exports = { aiRespond };
