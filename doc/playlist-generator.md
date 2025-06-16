# playlist generator

## but

un programme visant à générer une playlist de fichier musicaux à partir de différents paramètres.

1) Un dossier source contenant l'intégralité des fichier musicaux.
2) Un thème optionnel, si il est spécifié, seul les fichier musicaux correspondant au thème seront choisi
3) Durée max du thème.
4) Pour chaque fichier musicaux, la date/heure à laquelle le fichier à été joué pour la dernière fois.

## base de données

Une base de donnée sera nécessaire pour maintenir les méta données relatives à chaque fichier.

- songfile
    - id bigint
    - location string
    - md5 string
    - lastplay timestamp

- songtags
    - songfile_id bigint
    - tag_id bigint

- tags
    - id bigint
    - tag string


## use cases pour l'application

### register songfile

Permet d'ajouter un nouveau fichier musical à la base de donnée.
Permet également de modifier des informations car le md5 sert d'identification

PUT /songfile/

body : { location, md5, tags }

### modify location

Permet de modifier la location d'un fichier

PUT /songfile/location/{md5}

body { location }

### set tags

Modifie la liste des tags associés à une songfile (supprimer les anciens tags, et les remplce par ceux spécifié dans cette requète)

PUT /songfile/tags/{md5}

body { tags }

### add tags

Ajoute un tag à la liste des tags associés à une songfile (ne supprime pas les anciens tags)

POST /songfile/tags/{md5}

body { tags }

### remove tags

Supprime un tag de la liste des tags associés à une songfile

DELETE /songfile/tags/{md5}

body { tags }

### set lastplay

Modifie le champ `lastplay` d'une song file

POST /songfile/lastplay/{md5}

La date du serveur est utilisée pour modifier le lastplay



## generation de la playlist

Le programme doit pouvoir surveiller VLC afin de déterminer la fin de la lecture de la playlist.


