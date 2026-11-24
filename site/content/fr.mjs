// The French guide (www.photo-touch-up.fr/fr/guide/). Same keys as en.mjs
// (scripts/site.test.ts checks it); labels match the Studio's French UI
// (src/studio/i18n/fr.ts).

export default {
  lang: "fr",
  path: "/fr/guide/",
  title: "Éditeur photo en ligne gratuit, avec calques et IA locale — AgentPhoto Studio",
  description:
    "Retouchez vos photos dans le navigateur : calques, masques, suppression d'arrière-plan et sélections Segment Anything qui tournent sur votre ordinateur, courbes, 20 styles, texte, modèles et export PNG / JPEG / WebP. Sans compte, sans envoi. Votre agent IA peut aussi le piloter.",
  nav: { features: "Fonctions", tasks: "Tutoriels", agents: "Pour les agents IA", faq: "FAQ", open: "Ouvrir l'éditeur", other: "English", github: "GitHub" },
  hero: {
    kicker: "Gratuit · Sans compte · Rien n'est envoyé",
    title: "Un vrai éditeur photo dans votre navigateur, avec une IA qui tourne sur votre ordinateur.",
    lead: "Calques, masques, suppression d'arrière-plan, sélections intelligentes, courbes, styles, texte et modèles. Vos photos restent sur votre ordinateur — et ce même studio peut être piloté par votre agent IA.",
    cta: "Ouvrir l'éditeur",
    secondary: "Le faire piloter par un agent IA",
    shot: "L'éditeur AgentPhoto Studio : calques, inspecteur et une photo sur le canevas",
  },
  why: {
    title: "Un éditeur photo qui respecte votre temps et vos photos.",
    items: [
      ["Gratuit, sans compte", "Ouvrez la page et retouchez. Pas d'inscription, pas d'essai, pas de pub, pas de filigrane sur les exports."],
      ["Vos photos restent chez vous", "Photos et projets sont enregistrés dans votre navigateur. La retouche et les exports se font sur votre ordinateur : rien n'est envoyé."],
      ["L'IA sur votre ordinateur", "La suppression d'arrière-plan et les sélections Segment Anything tournent dans la page. Le modèle se télécharge une fois, avec votre accord, puis reste dans le cache du navigateur."],
      ["Non destructif", "Chaque retouche est un calque, un filtre, un masque ou un réglage modifiable plus tard. Votre photo d'origine n'est jamais modifiée."],
      ["Ce que vous voyez est ce que vous exportez", "L'aperçu et l'export utilisent le même moteur, en pleine résolution."],
      ["Pensé aussi pour les agents", "Le même studio existe en ligne de commande et en serveur MCP : Claude Code ou n'importe quel agent IA retouche vos photos et vérifie son propre travail."],
    ],
  },
  features: {
    title: "Tout ce qu'il faut pour retoucher au quotidien.",
    items: [
      { id: "layers", shot: "editor", title: "Calques, groupes et modes de fusion", body: "Empilez photos, textes, formes, aplats et calques de réglage. Groupes, 16 modes de fusion, opacité, écrêtage sur le calque du dessous, alignement et un panneau de transformation précis (position, taille, rotation, symétrie)." },
      { id: "selections", shot: "ai-select", title: "Sélections et sélection rapide par IA", body: "Rectangle, lasso et lasso polygonal, baguette magique, et sélection rapide par IA : cliquez l'objet, Alt-clic pour exclure, Segment Anything trouve son contour. Transformez une sélection en masque, en nouveau calque, en remplissage ou en réglage masqué." },
      { id: "cutout", shot: "cutout", title: "Suppression d'arrière-plan", body: "Un clic supprime l'arrière-plan d'une photo avec un modèle local (RMBG-1.4, ou MODNet pour les portraits). Le résultat est un masque modifiable : affinez-le au pinceau, ajoutez un nouveau fond, une ombre ou un contour d'autocollant." },
      { id: "filters", shot: "filters", title: "28 filtres aux paramètres en direct", body: "Exposition, niveaux, courbes avec éditeur de courbe, ombres / hautes lumières, balance des blancs, vibrance, teinte / saturation, balance des couleurs, flou, flou de surface pour lisser la peau, netteté, clarté, grain, vignette, et tonalité, contraste et couleur auto. Chaque filtre reste modifiable." },
      { id: "looks", shot: "looks", title: "20 styles en un clic", body: "Noir et blanc, noir, vintage, polaroid, cinéma, film, mat, heure dorée… avec un curseur d'intensité, sur un calque ou sur tout ce qui est sous un calque de réglage." },
      { id: "text", shot: "text", title: "Texte, formes et effets de calque", body: "Texte modifiable avec 15 polices intégrées, dégradés, fonds d'étiquette et retour à la ligne. Rectangles, ellipses, lignes, polygones et étoiles. Ombre portée, lueur externe, ombre interne, contour et incrustation de couleur." },
      { id: "templates", shot: "start", title: "Modèles et formats réseaux sociaux", body: "Partez d'une photo, d'une photo d'exemple, d'un canevas vierge à un format social (Open Graph, post carré, story, miniature YouTube, bannières…) ou d'un des 8 modèles, où votre photo remplace celle du modèle." },
      { id: "export", shot: "export", title: "Export PNG, JPEG et WebP", body: "Choisissez le format (AVIF aussi, si le navigateur sait l'encoder), la qualité et la taille (originale, un format prédéfini, une taille libre ou une échelle), gardez la transparence ou aplatissez-la, et voyez le fichier avant de le télécharger." },
    ],
    more: "Et aussi : pinceau, gomme et tampon de duplication (chaque trait est un nouveau fichier, votre photo reste intacte), recadrage, pipette, masques par plage de couleur, masques en dégradé ou en forme, annuler / rétablir, interface en français et en anglais.",
  },
  steps: {
    title: "Votre première retouche en trois étapes.",
    items: [
      ["Ouvrez l'éditeur", "Rien à installer : il tourne dans Chrome, Edge, Firefox ou Safari sur un ordinateur."],
      ["Déposez votre photo", "Ou partez d'une photo d'exemple, d'un format social ou d'un modèle. Elle devient un projet enregistré dans votre navigateur."],
      ["Retouchez et exportez", "Réglez, détourez, ajoutez du texte, puis Exporter : le fichier arrive dans vos Téléchargements."],
    ],
  },
  tasks: {
    title: "Les retouches courantes, pas à pas.",
    items: [
      { title: "Supprimer un arrière-plan", steps: ["Ouvrez votre photo et sélectionnez son calque.", "Dans Propriétés → Masque, choisissez le modèle et cliquez sur Supprimer l'arrière-plan (la première fois, le modèle se télécharge une fois).", "Zoomez sur les bords ; peignez sur le masque pour corriger un détail.", "Exportez en PNG ou WebP pour garder la transparence, ou ajoutez un calque d'aplat dessous comme nouveau fond."] },
      { title: "Sélectionner un objet avec l'IA", steps: ["Prenez la sélection rapide par IA (Q) dans la barre d'outils.", "Cliquez l'objet ; Alt-clic sur ce qui doit être exclu.", "Appliquez, puis masquez le calque, copiez l'objet sur un nouveau calque ou ajoutez un réglage masqué."] },
      { title: "Redimensionner une photo pour les réseaux sociaux", steps: ["Cliquez une zone vide du canevas pour afficher les réglages du canevas.", "Choisissez un format (post carré, story, Open Graph, YouTube…) et redimensionnez le canevas, ou gardez-le et choisissez la taille à l'export.", "À l'export, Couvrir recadre pour remplir le format, Contenir ajoute des marges."] },
      { title: "Recadrer et redresser", steps: ["Prenez l'outil Recadrage (C), tirez les poignées ou choisissez un ratio, puis Entrée.", "Pour redresser, sélectionnez la photo et réglez sa rotation dans Propriétés → Transformation.", "Faites pivoter toute l'image de 90° ou retournez-la dans les réglages du canevas."] },
      { title: "Corriger la lumière et les couleurs", steps: ["Sélectionnez la photo, ouvrez Filtres.", "Cliquez sur Amélioration auto : elle mesure la photo et ajoute les corrections utiles. Ou ajoutez exposition, balance des blancs, courbes ou vibrance et réglez-les en direct.", "Masquez un filtre avec son œil pour comparer ; rien n'est définitif avant l'export."] },
      { title: "Ajouter du texte sur une image", steps: ["Prenez l'outil Texte (T) et cliquez sur la photo.", "Tapez, puis choisissez police, taille, couleur ou dégradé et alignement dans Propriétés.", "Ajoutez une ombre portée ou un contour dans Effets pour qu'il reste lisible sur n'importe quelle photo."] },
    ],
  },
  agents: {
    title: "Le studio photo que votre agent IA sait piloter.",
    lead: "Cet éditeur est la partie visuelle d'AgentPhoto, un outil en ligne de commande et un serveur MCP pour agents IA. Claude Code, Claude Desktop, Cursor ou tout client MCP ouvre votre photo, modifie le même document non destructif, génère un aperçu, le regarde, corrige ce qu'il voit et exporte — sur votre ordinateur.",
    points: [
      "Demandez en langage courant : « détoure product.jpg et pose-le sur fond blanc avec une ombre douce », « fais une miniature YouTube avec cette photo et le titre … », « exporte ça pour Instagram, en story et en Open Graph ».",
      "L'agent vérifie son travail : chaque modification est rendue en arrière-plan et regardée avant la suivante.",
      "Puis finissez à la main : l'agent ouvre le même projet dans ce Studio, et les modifications s'affichent en direct.",
    ],
    install: "Dans Claude Code :",
    other: "Les autres agents (MCP), la ligne de commande et les skills Hermes Agent :",
    repo: "AgentPhoto sur GitHub",
    npm: "Paquet npm",
    video: "La démo de 2 minutes (en anglais) : un agent retouche, détoure et compose, puis le Studio.",
    videoLabel: "Regarder la démo d'AgentPhoto",
  },
  faq: {
    title: "Bonnes questions, réponses honnêtes.",
    items: [
      ["Est-ce vraiment gratuit ?", "Oui. Pas de compte, pas d'abonnement, pas de pub, pas de filigrane. Le code source d'AgentPhoto est disponible sur GitHub."],
      ["Mes photos sont-elles envoyées sur un serveur ?", "Non. Photos et projets sont enregistrés dans votre navigateur (IndexedDB), et chaque retouche et chaque export se font sur votre ordinateur. Le site sert les fichiers de l'éditeur et mesure les visites avec Google Analytics (pages vues, jamais vos photos ni vos projets). Le réseau sert aussi à télécharger un modèle d'IA la première fois que vous l'utilisez (depuis Hugging Face, avec votre accord) et, si vous choisissez de l'utiliser, à l'assistant facultatif, qui envoie vos aperçus à Claude avec votre propre clé d'API."],
      ["Où sont enregistrés mes projets ?", "Dans ce navigateur, sur cet ordinateur. Ils sont listés dans Récents sur l'écran d'accueil. Effacer les données du site dans le navigateur les supprime : exportez ce que vous voulez garder."],
      ["Comment la suppression d'arrière-plan marche-t-elle sans serveur ?", "Le modèle tourne dans la page grâce à WebAssembly. RMBG-1.4 (168 Mo) est le modèle par défaut ; MODNet (25 Mo) est fait pour les portraits. Les deux se téléchargent une fois et restent dans le cache du navigateur."],
      ["Puis-je l'utiliser pour un usage commercial ?", "Les polices et les photos d'exemple sont libres pour des images commerciales. Le modèle de suppression d'arrière-plan par défaut, RMBG-1.4, est sous licence non commerciale : pour un usage commercial, utilisez MODNet (personnes) ou les sélections Segment Anything. AgentPhoto lui-même est sous licence PolyForm Noncommercial 1.0.0 ; un usage commercial du logiciel demande l'autorisation de l'auteur."],
      ["Quels formats puis-je ouvrir et exporter ?", "Ouvrez du JPEG, du PNG, du WebP et les autres images que votre navigateur sait lire. Exportez en PNG, JPEG, WebP et AVIF (AVIF si le navigateur sait l'encoder)."],
      ["Est-ce que ça marche sur téléphone ?", "L'éditeur est conçu pour un écran d'ordinateur avec une souris ou un pavé tactile. Utilisez un Chrome, Edge, Firefox ou Safari récent."],
      ["Qu'est devenu Photo Touch-Up ?", "Photo Touch-Up, l'éditeur qui était à cette adresse, est devenu AgentPhoto : un nouveau moteur avec des calques non destructifs, de l'IA locale et des modèles, que les agents IA savent aussi piloter."],
    ],
  },
  final: { title: "Retouchez votre prochaine photo maintenant.", cta: "Ouvrir l'éditeur", note: "Rien à installer, rien n'est envoyé." },
  footer: {
    made: "AgentPhoto — le studio photo que votre agent IA sait piloter.",
    licence: "Code source disponible sous licence PolyForm Noncommercial 1.0.0.",
    links: { editor: "Éditeur", guide: "Guide", github: "GitHub", npm: "npm", docs: "Documentation", privacy: "Confidentialité" },
  },
  notFound: { title: "Page introuvable", body: "Cette page n'existe pas (ou plus).", editor: "Ouvrir l'éditeur", guide: "Lire le guide" },
  app: {
    title: "AgentPhoto Studio — éditeur photo en ligne gratuit avec IA locale",
    description:
      "Éditeur photo gratuit dans le navigateur : calques, masques, suppression d'arrière-plan et sélections par IA sur votre ordinateur, courbes, styles, texte, modèles. Sans compte, rien n'est envoyé.",
    noscript: "AgentPhoto Studio a besoin de JavaScript. Lire le guide :",
  },
};
