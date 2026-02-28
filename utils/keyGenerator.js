const crypto = require("crypto");

const adjectives = [
  "Fulgurant", "Éclatant", "Souverain", "Vigilant", "Épique",
  "Audacieux", "Majestueux", "Infaillible", "Rapide", "Stratégique",
  "Glorieux", "Noble", "Vif", "Féroce", "Lumineux",
  "Agile", "Invincible", "Prestigieux", "Royal", "Élite",
  "Champion", "Expert", "Supérieur", "Prodige", "Victorieux",
  "Éclair", "Titan", "Alpha", "Omega", "Phoenix"
];

const nouns = [
  "Victoire", "Score", "Equipe", "Match", "Arena",
  "Buts", "Attaque", "Défense", "Stratégie", "Tactique",
  "Pari", "Analyse", "Championnat", "Offensive", "Génie",
  "Force", "Héros", "Légende", "Maestro", "Conquête",
  "Assaut", "Équipe", "Offensive", "Clash", "Rival",
  "Exploit", "Succès", "Domination", "Triomphe", "Challenge"
];

const numbers = [
  "21", "23", "26", "28", "31", "34", "36",
  "42", "46", "51", "56", "61", "72", "82", "91", "105"
];

function secureRandomInt(max) {
  const randomBytes = crypto.randomBytes(4);
  const randomNumber = randomBytes.readUInt32BE(0);
  return randomNumber % max;
}

module.exports.generateReadableKey = () => {
  const adj = adjectives[secureRandomInt(adjectives.length)];
  const noun = nouns[secureRandomInt(nouns.length)];
  const num = numbers[secureRandomInt(numbers.length)];
  const suffix = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `${adj}-${noun}${num}-${suffix}`;
};