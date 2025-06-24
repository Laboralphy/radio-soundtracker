/**
 * @param aArray {*[]}
 * @returns {*[]}
 */
function shuffleArray (aArray) {
    // Créer une copie du tableau pour éviter de modifier l'original
    const shuffled = [...aArray];

    // Parcourir le tableau à l'envers
    for (let i = shuffled.length - 1; i > 0; i--) {
        // Générer un index aléatoire entre 0 et i (inclus)
        const j = Math.floor(Math.random() * (i + 1));

        // Échanger les éléments aux indices i et j
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled;
}

module.exports = {
    shuffleArray
};
