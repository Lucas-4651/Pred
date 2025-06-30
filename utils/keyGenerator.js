const adjectives = ["Super", "Mega", "Ultra", "Grand", "Petit", "Rapide", "Fort", "Intelligent", "Victorieux", "Champion", "Pro", "Expert", "Gagnant", "Top", "Elite"];
const nouns = ["Prediction", "Victoire", "But", "Match", "Foot", "Strategie", "Champion", "Gagnant", "Score", "Equipe", "Attaque", "Defense", "Pari", "Analyse"];
const numbers = ["20", "22", "24", "25", "30", "33", "35", "40", "45", "50", "55", "60", "70", "80", "90", "100"];

module.exports.generateReadableKey = () => {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = numbers[Math.floor(Math.random() * numbers.length)];
  return `${adj}${noun}${num}`;
};