/*
 * pruefung.js – Inhalte für die PruefungScene (Endboss: mündliche Projektarbeitsprüfung).
 *
 * Alles hier ist frei erfunden und bewusst allgemein gehalten:
 * keine echten Projekte, keine echten Personen, keine echten Firmen.
 *
 * Aufbau einer Frage:
 *   asker      'prof' oder 'betreuer' – wer fragt
 *   hard       harte Frage → Bildschirm wackelt, Mini-Aufgabe wird schwerer
 *   best       Antwortstil, der hier am besten wirkt
 *   worst      Antwortstil, der hier nach hinten losgeht
 *   reactions  Reaktion der Kommission je Stil
 *              (fundiert = Mini-Aufgabe geschafft, buzzword = der übliche Reinfall)
 *   jackpot    optional: eigene Reaktion, wenn das Buzzword-Bingo ausnahmsweise zündet
 */
(function () {
  'use strict';
  const SS = globalThis.SS;
  SS.Data = SS.Data || {};

  SS.Data.pruefung = {
    // Bausteine für den zufälligen Projekttitel: Adjektiv + Tätigkeit + Gegenstand + Methode
    titleParts: {
      adjective: ['KI-gestützte', 'Agile', 'Nachhaltige', 'Datengetriebene', 'Cloudbasierte', 'Ganzheitliche', 'Prototypische', 'Automatisierte'],
      action: ['Optimierung', 'Digitalisierung', 'Analyse', 'Evaluation', 'Konzeption', 'Visualisierung', 'Neugestaltung'],
      subject: ['der Mensa-Warteschlange', 'des Kaffeeautomaten', 'der Parkplatzsuche am Campus', 'der Raumbuchung',
        'des Druckerpapier-Nachschubs', 'der Wasserspender-Logistik', 'der Klausurvorbereitung', 'des WLAN-Empfangs im Hörsaal'],
      method: ['mittels Blockchain', 'auf Basis großer Sprachmodelle', 'im Internet der Dinge', 'mit Low-Code-Plattformen',
        'durch Gamification', 'mit digitalem Zwilling', 'mit Tabellen-Makros', 'in der Cloud']
    },

    examiners: {
      prof: { name: 'Prof. Dr. Streng', role: 'DHBW' },
      betreuer: { name: 'Betreuer:in', role: 'Partnerunternehmen' }
    },

    // Antwortstile in Button-Reihenfolge (Tasten 1–4)
    styles: [
      {
        id: 'fundiert', label: 'Fundiert', hint: 'stark – mit Mini-Aufgabe', color: 0x2563eb,
        playerLines: ['Ich habe drei Alternativen systematisch verglichen …', 'Laut meiner Auswertung in Kapitel 4 …',
          'Die Literatur stützt das eindeutig, und zwar …'],
        failPlayerLine: 'Äh … wo war ich? Moment, die Zahl stimmt nicht …',
        failLines: ['Sie verlieren mitten in der Herleitung den Faden.', 'Gute Idee, aber die Begründung kippt auf halbem Weg.',
          'Die Zahlen auf Ihrer Folie widersprechen gerade Ihrer Aussage.']
      },
      {
        id: 'ehrlich', label: 'Ehrlich & reflektiert', hint: 'solide – beruhigt die Nerven', color: 0x15803d,
        playerLines: ['Ehrlich gesagt war das ein Kompromiss mit dem Zeitplan …', 'Das würde ich heute anders machen, und zwar …',
          'Da bin ich ehrlich: Nicht alles hat geklappt.']
      },
      {
        id: 'buzzword', label: 'Buzzword-Bingo', hint: 'Glücksspiel – selten genial', color: 0xa21caf,
        playerLines: ['Durch agile Synergien skalieren wir disruptiv die Wertschöpfung.',
          'Im Kern ist das ein KI-basierter, cloud-nativer Paradigmenwechsel.',
          'Wir ernten Low Hanging Fruits mit einem ganzheitlichen Mindset.'],
        jackpotLines: ['Moment … das ergibt tatsächlich Sinn. Beeindruckend!', 'Buzzword-Bingo – und jedes Feld sitzt. Chapeau!',
          'Klingt wild, ist aber genial. Das notiere ich mir.']
      },
      {
        id: 'schwafeln', label: 'Schwafeln', hint: 'Zeit schinden – Nervosität steigt', color: 0x9a3412,
        playerLines: ['Also … das ist eine spannende Frage, die man von vielen Seiten …',
          'Ja, also, quasi, im Prinzip, sozusagen … genau.', 'Da muss ich kurz ausholen, im 18. Jahrhundert …']
      }
    ],

    // Spielerzeile, wenn die Antwortzeit abläuft (zählt als Schwafeln)
    timeoutLine: 'Ähm … also … das ist eine sehr gute Frage …',

    questions: [
      {
        asker: 'prof', hard: false, best: 'fundiert', worst: 'schwafeln',
        text: 'Warum haben Sie genau diese Methode gewählt?',
        reactions: {
          fundiert: 'Sauber gegen die Alternativen abgegrenzt. So mag ich das.',
          ehrlich: '„Weil es in den Zeitplan passte“ – ehrlich, aber ausbaufähig.',
          buzzword: '„Synergetisch-agil“ ist keine Methode, sondern ein Gefühl.',
          schwafeln: 'Drei Minuten Redezeit – und keine einzige Methode genannt.'
        }
      },
      {
        asker: 'betreuer', hard: false, best: 'ehrlich', worst: 'buzzword',
        text: 'Was würden Sie heute anders machen?',
        reactions: {
          fundiert: 'Gut analysiert – das klang allerdings fast wie ein zweites Kapitel.',
          ehrlich: 'Starke Selbstreflexion. Genau das wollten wir hören.',
          buzzword: '„Noch mehr Disruption“? Das hätte ich so nicht unterschrieben.',
          schwafeln: 'Also … alles? Oder nichts? Ich bin jetzt verwirrt.'
        }
      },
      {
        asker: 'prof', hard: true, best: 'fundiert', worst: 'buzzword',
        text: 'Wie haben Sie Ihre Ergebnisse validiert?',
        reactions: {
          fundiert: 'Testdaten, Gegenprobe, Fehlerbetrachtung. Respekt.',
          ehrlich: 'Immerhin geben Sie zu, dass die Stichprobe klein war.',
          buzzword: '„Die KI meinte, es passt“ ist keine Validierung.',
          schwafeln: 'Ich wollte eine Begründung. Bekommen habe ich viele „Ähms“.'
        }
      },
      {
        asker: 'betreuer', hard: false, best: 'ehrlich', worst: 'buzzword',
        text: 'Erklären Sie das bitte so, dass es Ihre Oma versteht.',
        reactions: {
          fundiert: 'Fachlich korrekt – aber Ihre Oma ist jetzt eingeschlafen.',
          ehrlich: 'Wunderbar anschaulich! Das erzähle ich beim nächsten Familienessen.',
          buzzword: 'Ihre Oma fragt gerade, ob das ansteckend ist.',
          schwafeln: 'Ihre Oma hätte nach zehn Sekunden das Thema gewechselt.'
        }
      },
      {
        asker: 'prof', hard: true, best: 'fundiert', worst: 'schwafeln',
        text: 'Was ist der wissenschaftliche Mehrwert?',
        reactions: {
          fundiert: 'Klar in den Forschungsstand eingeordnet. Sehr gut.',
          ehrlich: 'Bescheiden, aber nachvollziehbar. Ein kleiner Mehrwert ist auch einer.',
          buzzword: 'Viele schöne Wörter. Der Mehrwert bleibt ein Geheimnis.',
          schwafeln: 'Der Mehrwert dieser Antwort ist leider negativ.'
        }
      },
      {
        asker: 'prof', hard: false, best: 'ehrlich', worst: 'buzzword',
        text: 'Wo sind die Grenzen Ihrer Arbeit?',
        reactions: {
          fundiert: 'Systematisch hergeleitet. Fast schon zu selbstkritisch.',
          ehrlich: 'Genau. Wer seine Grenzen kennt, hat das Thema verstanden.',
          buzzword: '„Grenzenlos skalierbar“ war nicht die gesuchte Antwort.',
          schwafeln: 'Die Grenze meiner Geduld haben wir jedenfalls gefunden.'
        }
      },
      {
        asker: 'betreuer', hard: false, best: 'buzzword', worst: 'schwafeln',
        text: 'Wie würden Sie das bei uns im Unternehmen ausrollen?',
        reactions: {
          fundiert: 'Sehr gründlich. Das Steuerungsgremium wäre begeistert.',
          ehrlich: 'Schrittweise mit einer Pilotgruppe? Vernünftig – und bezahlbar.',
          buzzword: 'Zu viele Buzzwords – sogar für unser Intranet.',
          schwafeln: 'Okay … ich trage einfach „Folgetermin“ in den Kalender ein.'
        },
        jackpot: 'Agile Roadmap, Quick Wins, Skalierung … Ich bin dabei!'
      },
      {
        asker: 'prof', hard: true, best: 'fundiert', worst: 'schwafeln',
        text: 'Welche Quelle stützt die Aussage auf Folie 7?',
        reactions: {
          fundiert: 'Mit Seitenzahl! Sie haben tatsächlich gelesen, was Sie zitieren.',
          ehrlich: 'Gut, dass Sie zugeben, dass die Quelle dünn ist. Notiert.',
          buzzword: '„Das weiß man halt“ ist kein Zitierstil.',
          schwafeln: 'Ich zähle mit: Das war das fünfte „sozusagen“.'
        }
      },
      {
        asker: 'betreuer', hard: false, best: 'ehrlich', worst: 'buzzword',
        text: 'Was hat Sie im Projekt am meisten überrascht?',
        reactions: {
          fundiert: 'Sehr strukturiert – fast schon zu sachlich für diese Frage.',
          ehrlich: 'Schön, dass Sie so offen darüber sprechen. Daraus lernt man.',
          buzzword: 'Dass „Synergien“ Sie überrascht haben, überrascht mich.',
          schwafeln: 'Mich überrascht gerade, wie lange man über nichts reden kann.'
        }
      }
    ],

    // Zwischenfälle (Quick-Time-Events); die Mechanik steckt in der Szene
    incidents: [
      {
        id: 'beamer', title: 'Beamer: Kein Signal',
        hint: 'Welcher Eingang ist der richtige? Klicken oder Taste 1–3.',
        success: 'Bild ist wieder da. Die Kommission nickt anerkennend.',
        fail: 'Sie präsentieren jetzt ohne Folien. Mutig.'
      },
      {
        id: 'demo', title: 'Live-Demo crasht!',
        hint: 'Tippe die Pfeil-Folge nach, um neu zu starten. Pfeiltasten oder Klicken.',
        success: 'Neustart in Rekordzeit – die Demo läuft wieder.',
        fail: '„Bei mir lief das gestern noch …“'
      },
      {
        id: 'akku', title: 'Laptop-Akku 3 %',
        hint: 'Steck das Ladekabel ein: Klick oder Leertaste, wenn der Stecker über der Buchse ist.',
        success: 'Es lädt! Puh.',
        fail: 'Bildschirm schwarz. Den Rest erzählen Sie frei.'
      },
      {
        id: 'folie', title: 'Die Folie hängt!',
        hint: 'Hämmere auf die Leertaste (oder klicke schnell)!',
        success: 'Weiter geht’s – die Folie ist endlich geladen.',
        fail: 'Die Folie bleibt hängen. Sie improvisieren.'
      },
      {
        id: 'tafel', title: '„Können Sie das an der Tafel herleiten?“',
        hint: 'Warte auf „JETZT!“ – dann sofort Leertaste oder Klick.',
        success: 'Saubere Herleitung. Q. e. d.!',
        fail: 'Die Kreide bricht. Ihr Selbstbewusstsein auch.'
      }
    ],

    // Fake-Formeln für die Tafel
    formulas: ['Σ Aufwand ≤ ∫ Kaffee dt', 'Erfolg = (Fleiß + Glück)² / Deadline', 'lim Abgabe→0 Panik = ∞',
      'ECTS ≈ Mensabesuche / Schlaf'],

    // Schlusskommentar der Kommission (erste passende Zeile gilt)
    verdicts: [
      { maxGrade: 1.3, text: 'Herausragend! Am Ende hatten wir keine Fragen mehr.' },
      { maxGrade: 1.7, text: 'Sehr überzeugend. Die Kommission ist beeindruckt.' },
      { maxGrade: 2.3, text: 'Gute Verteidigung mit kleinen Schwächen.' },
      { maxGrade: 2.7, text: 'Solide, aber da wäre mehr drin gewesen.' },
      { maxGrade: 3.3, text: 'Die Methodik hat uns nicht ganz überzeugt.' },
      { maxGrade: 3.7, text: 'Ausreichend, mit viel gutem Willen der Kommission.' },
      { maxGrade: 4.0, text: 'Knapp bestanden. Sehr knapp.' },
      { maxGrade: 5.0, text: 'Leider nicht bestanden. Wir sehen uns im nächsten Prüfungszeitraum.' }
    ],
    blackoutVerdict: 'Totaler Blackout. Die Kommission bricht ab.'
  };
})();
