# play list management

## Fonctionnement imaginé

### Programme par defaut

- on définit un `programme-par-defaut`.
- on lance ce `programme-par-defaut` au démarrage du process radio.
- lorsque ce `programme-par-defaut` s'arrête, on le relance.
 
### Programmes spéciaux

- à différents horaires selon le contenu du `cron-tab`, j'interromps le `programme-par-defaut` et je lance un `programme-spécial`.
- lorsqu'un `programme-spécial` s'arrête, je retourne au `programme-par-defaut`.
- ces horaires sont définis dans un système `cron-tab` applicatif
