// eslint.config.js
module.exports = [
    {
        ignores: ['node_modules/', 'dist/'], // Exclure les dossiers inutiles
    },
    {
        languageOptions: {
            ecmaVersion: 'latest', // Active ES2023+
            sourceType: 'module',  // Utiliser les imports ESModules
        },
        linterOptions: {
            reportUnusedDisableDirectives: true, // Alerter si une règle eslint-disable est inutile
        },
        rules: {
            'semi': ['error', 'always'], // Exiger des points-virgules
            'quotes': ['error', 'single'], // Utiliser des guillemets simples
            'indent': ['error', 4], // Indentation à 4 espaces
            'no-trailing-spaces': 'error', // Pas d'espaces en fin de ligne
            'eol-last': ['error', 'always'], // Toujours une ligne vide à la fin des fichiers
            'no-console': 'off', // Autoriser console.log en backend
            'prefer-const': 'error', // Utiliser const quand possible
            'no-var': 'error' // Interdire var
        }
    }
];
