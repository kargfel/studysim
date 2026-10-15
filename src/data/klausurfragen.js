/*
 * klausurfragen.js – Fragenkatalog der KlausurScene (SS.Data.klausurfragen).
 *
 * Format einer Frage:
 *   { category, question, answers: [vier Antworten], correct: Index der richtigen Antwort (0–3), explanation? }
 *
 * Regeln für neue Fragen:
 *   - Frage höchstens 120 Zeichen, Antwort höchstens 60 Zeichen (passt in eine Antwortzeile).
 *   - Die richtige Antwort muss fachlich stimmen – die falschen dürfen gern albern sein.
 *   - Die Szene mischt die Antworten, die Reihenfolge hier ist also egal.
 *   - Keine echten Personen, keine Firmennamen (außer DHBW).
 */
(function () {
  'use strict';
  const SS = (globalThis.SS = globalThis.SS || {});
  SS.Data = SS.Data || {};

  SS.Data.klausurfragen = [
    // ── Zahlensysteme ─────────────────────────────────────────────
    {
      category: 'Zahlensysteme',
      question: 'Was ergibt die Binärzahl 1011 im Dezimalsystem?',
      answers: ['13', '11', '1011', 'Kommt auf die Tagesform an'],
      correct: 1,
      explanation: '8 + 0 + 2 + 1 = 11.'
    },
    {
      category: 'Zahlensysteme',
      question: 'Welchen Dezimalwert hat die Hexadezimalzahl 0xFF?',
      answers: ['256', '15', '255', 'FF ist doch keine Zahl!'],
      correct: 2,
      explanation: 'F steht für 15, also 15 · 16 + 15 = 255.'
    },
    {
      category: 'Zahlensysteme',
      question: 'Wie viele verschiedene Werte lassen sich mit 8 Bit darstellen?',
      answers: ['255', '128', '8', '256'],
      correct: 3,
      explanation: '2^8 = 256 Werte – von 0 bis 255.'
    },
    {
      category: 'Zahlensysteme',
      question: 'Wie lautet -1 als 8-Bit-Zweierkomplement?',
      answers: ['11111111', '10000001', '11111110', '00000001'],
      correct: 0,
      explanation: 'Aus 00000001 alle Bits kippen (11111110), dann 1 addieren.'
    },
    {
      category: 'Zahlensysteme',
      question: 'Welche Farbe hat der Webfarbcode #00FF00?',
      answers: ['Rot', 'Grün', 'Blau', 'Mensa-Soßenbraun'],
      correct: 1,
      explanation: 'RGB: kein Rot, volles Grün, kein Blau.'
    },

    // ── Algorithmen ───────────────────────────────────────────────
    {
      category: 'Algorithmen',
      question: 'Welche Laufzeit hat die binäre Suche in einem sortierten Array?',
      answers: ['O(n)', 'O(n²)', 'O(1)', 'O(log n)'],
      correct: 3,
      explanation: 'Der Suchbereich halbiert sich bei jedem Schritt.'
    },
    {
      category: 'Algorithmen',
      question: 'Wie ist die Worst-Case-Laufzeit von Quicksort?',
      answers: ['O(n log n)', 'O(n²)', 'O(log n)', 'O(n)'],
      correct: 1,
      explanation: 'Bei dauerhaft ungünstigem Pivot – im Mittel aber O(n log n).'
    },
    {
      category: 'Algorithmen',
      question: 'Welche Worst-Case-Laufzeit hat Mergesort?',
      answers: ['O(n log n)', 'O(n²)', 'O(2^n)', 'O(n)'],
      correct: 0,
      explanation: 'Teilen und Mischen klappt auch im schlimmsten Fall in O(n log n).'
    },
    {
      category: 'Algorithmen',
      question: 'Was braucht jede Rekursion, damit sie terminiert?',
      answers: ['Eine globale Variable', 'Mindestens zwei Parameter', 'Eine Abbruchbedingung (Basisfall)', 'Sehr viel Kaffee'],
      correct: 2,
      explanation: 'Ohne Basisfall ruft sie sich ewig selbst auf – bis zum Stack Overflow.'
    },

    // ── Datenstrukturen ───────────────────────────────────────────
    {
      category: 'Datenstrukturen',
      question: 'Welche Datenstruktur arbeitet nach dem LIFO-Prinzip?',
      answers: ['Queue (Warteschlange)', 'Stack (Stapel)', 'Hashmap', 'Mensa-Schlange'],
      correct: 1,
      explanation: 'Last In, First Out – wie ein Tellerstapel.'
    },
    {
      category: 'Datenstrukturen',
      question: 'Welche Datenstruktur ist eine Mensa-Schlange – zumindest in der Theorie?',
      answers: ['Stack (LIFO)', 'Binärbaum', 'Queue (FIFO)', 'Hashmap mit Vordrängel-Kollisionen'],
      correct: 2,
      explanation: 'First In, First Out – solange sich niemand vordrängelt.'
    },
    {
      category: 'Datenstrukturen',
      question: 'Wie viele Kinder hat ein Knoten in einem Binärbaum höchstens?',
      answers: ['1', '2', '3', 'Beliebig viele'],
      correct: 1,
      explanation: 'Binär: höchstens ein linkes und ein rechtes Kind.'
    },
    {
      category: 'Datenstrukturen',
      question: 'Wie schnell ist der Zugriff auf einen Eintrag einer Hashtabelle im Mittel?',
      answers: ['O(n)', 'O(log n)', 'O(n log n)', 'O(1)'],
      correct: 3,
      explanation: 'Konstant – zumindest solange es wenige Kollisionen gibt.'
    },

    // ── Datenbanken ───────────────────────────────────────────────
    {
      category: 'Datenbanken',
      question: 'Mit welchem SQL-Befehl liest man Daten aus einer Tabelle?',
      answers: ['SELECT', 'GET', 'READ', 'GIB_HER'],
      correct: 0,
      explanation: 'SELECT … FROM … – der Klassiker.'
    },
    {
      category: 'Datenbanken',
      question: 'Welche SQL-Klausel filtert Gruppen nach einem GROUP BY?',
      answers: ['WHERE', 'ORDER BY', 'HAVING', 'LIMIT'],
      correct: 2,
      explanation: 'WHERE filtert Zeilen vor dem Gruppieren, HAVING die Gruppen danach.'
    },
    {
      category: 'Datenbanken',
      question: 'Was bewirkt »DELETE FROM kunden;« ohne WHERE-Klausel?',
      answers: ['Löscht nur die erste Zeile', 'Löscht alle Zeilen der Tabelle', 'Nichts – ohne WHERE ist das ungültig', 'Löscht die Tabelle samt Struktur'],
      correct: 1,
      explanation: 'Die Tabelle bleibt, die Daten sind weg. Backup?'
    },
    {
      category: 'Datenbanken',
      question: 'Welcher JOIN liefert nur Zeilen mit Treffern in beiden Tabellen?',
      answers: ['LEFT JOIN', 'FULL OUTER JOIN', 'CROSS JOIN', 'INNER JOIN'],
      correct: 3,
      explanation: 'LEFT und FULL behalten auch Zeilen ohne Partner.'
    },
    {
      category: 'Datenbanken',
      question: 'Wozu dient ein Primärschlüssel?',
      answers: ['Identifiziert jede Zeile eindeutig', 'Verschlüsselt die Datenbank', 'Öffnet den Serverraum', 'Sortiert die Tabelle alphabetisch'],
      correct: 0,
      explanation: 'Er ist eindeutig und darf nicht NULL sein.'
    },

    // ── Netzwerke ─────────────────────────────────────────────────
    {
      category: 'Netzwerke',
      question: 'Welcher HTTP-Statuscode bedeutet »Not Found«?',
      answers: ['200', '404', '500', '418'],
      correct: 1,
      explanation: '418 gibt es übrigens auch: »I’m a teapot« – ein Aprilscherz.'
    },
    {
      category: 'Netzwerke',
      question: 'Was bedeutet der HTTP-Statuscode 500?',
      answers: ['Alles in Ordnung', 'Seite nicht gefunden', 'Interner Serverfehler', '500 ECTS gutgeschrieben'],
      correct: 2,
      explanation: '5xx heißt: Der Server hat’s verbockt, nicht du.'
    },
    {
      category: 'Netzwerke',
      question: 'Was bedeutet der HTTP-Statuscode 403?',
      answers: ['Zugriff verboten (Forbidden)', 'Weiterleitung', 'Anfrage erfolgreich', 'Server macht Mittagspause'],
      correct: 0,
      explanation: 'Der Server hat dich verstanden – lässt dich aber nicht rein.'
    },
    {
      category: 'Netzwerke',
      question: 'Welches Protokoll sorgt für eine zuverlässige, geordnete Übertragung?',
      answers: ['UDP', 'IP', 'TCP', 'Brieftaube'],
      correct: 2,
      explanation: 'TCP bestätigt und sortiert Pakete. UDP schickt einfach los.'
    },
    {
      category: 'Netzwerke',
      question: 'Welcher Standard-Port gehört zu HTTPS?',
      answers: ['80', '443', '22', '8080'],
      correct: 1,
      explanation: '80 ist HTTP, 22 ist SSH.'
    },
    {
      category: 'Netzwerke',
      question: 'Auf welcher OSI-Schicht arbeitet das Internet Protocol (IP)?',
      answers: ['Schicht 2 – Sicherung', 'Schicht 4 – Transport', 'Schicht 7 – Anwendung', 'Schicht 3 – Vermittlung'],
      correct: 3,
      explanation: 'Die Vermittlungsschicht sorgt fürs Routing zwischen Netzen.'
    },
    {
      category: 'Netzwerke',
      question: 'Wie viele Bit hat eine IPv4-Adresse?',
      answers: ['32', '64', '128', '48'],
      correct: 0,
      explanation: '128 Bit hat IPv6, 48 Bit eine MAC-Adresse.'
    },
    {
      category: 'Netzwerke',
      question: 'Was macht DNS?',
      answers: ['Verschlüsselt das WLAN', 'Übersetzt Domainnamen in IP-Adressen', 'Verteilt IP-Adressen automatisch', 'Druckt Moodle aus'],
      correct: 1,
      explanation: 'Das Telefonbuch des Internets. IP-Adressen verteilt DHCP.'
    },

    // ── Git ───────────────────────────────────────────────────────
    {
      category: 'Git',
      question: 'Welcher Git-Befehl holt Änderungen vom Remote und führt sie direkt zusammen?',
      answers: ['git push', 'git fetch', 'git pull', 'git commit'],
      correct: 2,
      explanation: 'pull = fetch + merge. fetch allein lädt nur herunter.'
    },
    {
      category: 'Git',
      question: 'Was macht »git commit«?',
      answers: ['Speichert vorgemerkte Änderungen im lokalen Repo', 'Lädt Änderungen auf den Server', 'Löscht den aktuellen Branch', 'Verpflichtet dich zur pünktlichen Abgabe'],
      correct: 0,
      explanation: 'Zum Remote kommen die Commits erst mit »git push«.'
    },
    {
      category: 'Git',
      question: 'Wie erstellst du einen neuen Branch und wechselst direkt hinein?',
      answers: ['git branch -d feature', 'git merge feature', 'git push --force', 'git checkout -b feature'],
      correct: 3,
      explanation: 'Alternativ: git switch -c feature. Mit -d würdest du löschen.'
    },

    // ── Objektorientierung ────────────────────────────────────────
    {
      category: 'OOP',
      question: 'Wie heißt das OOP-Prinzip, interne Daten hinter Methoden zu verbergen?',
      answers: ['Vererbung', 'Kapselung', 'Polymorphie', 'Prokrastination'],
      correct: 1,
      explanation: 'Private Attribute – Zugriff nur über Methoden.'
    },
    {
      category: 'OOP',
      question: 'Eine Klasse übernimmt Attribute und Methoden einer anderen. Das nennt man …',
      answers: ['Vererbung', 'Kapselung', 'Rekursion', 'Plagiat'],
      correct: 0,
      explanation: 'Bei Klassen erwünscht – in der Projektarbeit eher nicht.'
    },
    {
      category: 'OOP',
      question: 'Gleicher Methodenaufruf, anderes Verhalten je nach Objekttyp – das ist …',
      answers: ['Kapselung', 'Komposition', 'Polymorphie', 'Montagmorgen'],
      correct: 2,
      explanation: 'tier.gibLaut(): Der Hund bellt, die Katze miaut.'
    },
    {
      category: 'OOP',
      question: 'Was ist ein Objekt in der objektorientierten Programmierung?',
      answers: ['Eine Tabelle in SQL', 'Ein Kommentar im Code', 'Ein Möbelstück im Hörsaal', 'Eine Instanz einer Klasse'],
      correct: 3,
      explanation: 'Die Klasse ist der Bauplan, das Objekt das fertige Haus.'
    },

    // ── Logik ─────────────────────────────────────────────────────
    {
      category: 'Logik',
      question: 'Was ergibt »wahr XOR wahr«?',
      answers: ['wahr', 'falsch', 'wahrscheinlich', 'Kommt auf die Prüfungsordnung an'],
      correct: 1,
      explanation: 'XOR ist nur wahr, wenn genau ein Operand wahr ist.'
    },
    {
      category: 'Logik',
      question: 'NICHT (A UND B) ist logisch gleichwertig zu …',
      answers: ['(NICHT A) UND (NICHT B)', 'A ODER B', '(NICHT A) ODER (NICHT B)', 'NICHT A UND B'],
      correct: 2,
      explanation: 'Negation hineinziehen – aus UND wird dabei ODER.'
    },
    {
      category: 'Logik',
      question: 'Wann ist die Aussage »Wenn A, dann B« falsch?',
      answers: ['A falsch, B wahr', 'A und B falsch', 'A wahr, B falsch', 'Nie – Logik lügt nicht'],
      correct: 2,
      explanation: 'Nur wenn aus etwas Wahrem etwas Falsches folgt.'
    },

    // ── Betriebssysteme ───────────────────────────────────────────
    {
      category: 'Betriebssysteme',
      question: 'Was beschreibt einen Deadlock?',
      answers: ['Prozesse warten gegenseitig aufeinander – ewig', 'Ein Prozess läuft besonders schnell', 'Der Speicher räumt sich selbst auf', 'Der Laptop-Akku ist leer'],
      correct: 0,
      explanation: 'Jeder hält etwas fest, das der andere gerade braucht.'
    },
    {
      category: 'Betriebssysteme',
      question: 'Was ist die Aufgabe des Schedulers im Betriebssystem?',
      answers: ['Plant deine Klausurtermine', 'Verteilt die CPU-Zeit auf Prozesse', 'Formatiert die Festplatte', 'Kühlt den Prozessor'],
      correct: 1,
      explanation: 'Er entscheidet, welcher Prozess wann rechnen darf.'
    },
    {
      category: 'Betriebssysteme',
      question: 'Was ist ein Thread im Betriebssystem?',
      answers: ['Ein eigener Rechner im Netzwerk', 'Ein Diskussionsfaden im Moodle-Forum', 'Ein Kabel im Serverraum', 'Ein Ausführungsstrang innerhalb eines Prozesses'],
      correct: 3,
      explanation: 'Threads eines Prozesses teilen sich denselben Speicher.'
    },
    {
      category: 'Betriebssysteme',
      question: 'Was macht das Betriebssystem, wenn der Arbeitsspeicher knapp wird?',
      answers: ['Lagert Speicherseiten auf die Festplatte aus', 'Lädt neuen RAM aus dem Internet', 'Löscht zufällig Programme', 'Nichts – RAM ist unendlich'],
      correct: 0,
      explanation: 'Auslagern (Swapping) ist langsam, aber besser als ein Absturz.'
    },

    // ── Theoretische Informatik ───────────────────────────────────
    {
      category: 'Theoretische Informatik',
      question: 'Welche Sprachen erkennt ein endlicher Automat?',
      answers: ['Kontextfreie Sprachen', 'Reguläre Sprachen', 'Alle entscheidbaren Sprachen', 'Nur Deutsch und Englisch'],
      correct: 1,
      explanation: 'Für kontextfreie Sprachen braucht es einen Kellerautomaten.'
    },
    {
      category: 'Theoretische Informatik',
      question: 'Was besagt das Halteproblem?',
      answers: ['Nicht allgemein entscheidbar, ob ein Programm hält', 'Jedes Programm hält irgendwann an', 'Programme halten nur mit Netzteil durch', 'Endlosschleifen sind verboten'],
      correct: 0,
      explanation: 'Kein Algorithmus kann das für alle Programme und Eingaben entscheiden.'
    },
    {
      category: 'Theoretische Informatik',
      question: 'Die Sprache aller korrekt geklammerten Ausdrücke wie (()()) ist …',
      answers: ['regulär', 'nicht entscheidbar', 'kontextfrei, aber nicht regulär', 'nur mit KI erkennbar'],
      correct: 2,
      explanation: 'Zum Klammerzählen braucht es einen Keller – endlich viele Zustände reichen nicht.'
    },
    {
      category: 'Theoretische Informatik',
      question: 'Was bedeutet »NP-vollständig«?',
      answers: ['Nicht lösbar – auch nicht mit unendlich Zeit', 'Nur mit Quantencomputern lösbar', 'Die Klausur ist nicht vollständig korrigiert', 'In NP und mindestens so schwer wie jedes NP-Problem'],
      correct: 3,
      explanation: 'Ob es dafür effiziente Algorithmen gibt, ist offen (P = NP?).'
    },

    // ── DHBW-Alltag (mit Augenzwinkern) ───────────────────────────
    {
      category: 'DHBW-Alltag',
      question: 'Wie wechseln sich Theorie- und Praxisphasen an der DHBW ab?',
      answers: ['Jeden zweiten Dienstag', 'Etwa alle drei Monate', 'Einmal pro Studium', 'Immer wenn der Wasserspender leer ist'],
      correct: 1,
      explanation: 'Rund zwölf Wochen Hochschule, dann rund zwölf Wochen Praxis.'
    },
    {
      category: 'DHBW-Alltag',
      question: 'Wie viele ECTS-Punkte umfasst ein Bachelor an der DHBW?',
      answers: ['180', '240', '210', 'So viele wie Kaffeebecher'],
      correct: 2,
      explanation: 'Sechs Semester, 210 ECTS – dual heißt eben doppelt fleißig.'
    },
    {
      category: 'DHBW-Alltag',
      question: 'Wofür steht die Abkürzung DHBW?',
      answers: ['Deutsche Hochschule für Bits und Wissen', 'Doppelt hart, bitte weitermachen', 'Dauerhaft hungrig bis Wochenende', 'Duale Hochschule Baden-Württemberg'],
      correct: 3,
      explanation: 'Dual heißt: Hochschule und Partnerunternehmen im Wechsel.'
    },
    {
      category: 'DHBW-Alltag',
      question: 'Wie heißt an der DHBW die feste Gruppe, mit der du durchs Studium gehst?',
      answers: ['Kurs', 'Rudel', 'Fraktion', 'Abteilung'],
      correct: 0,
      explanation: 'Kleine Kurse statt voller Hörsäle – ein DHBW-Markenzeichen.'
    },
    {
      category: 'DHBW-Alltag',
      question: 'Wo landen in vielen Vorlesungen Folien, Abgaben und Ankündigungen?',
      answers: ['Am Schwarzen Brett der Mensa', 'Im Moodle-Kurs', 'Auf einer Diskette', 'In der Gerüchteküche'],
      correct: 1,
      explanation: 'Tipp: Benachrichtigungen einschalten, dann verpasst du keine Frist.'
    },
    {
      category: 'DHBW-Alltag',
      question: 'Der Wasserspender liefert nur noch stilles Wasser. Wahrscheinlichste Ursache?',
      answers: ['Er hat Prüfungsangst', 'Er ist im Energiesparmodus', 'Die CO₂-Flasche ist leer', 'Sprudel gibt’s nur in der Praxisphase'],
      correct: 2,
      explanation: 'Ohne Kohlendioxid kein Sprudel – reine Chemie.'
    },
    {
      category: 'DHBW-Alltag',
      question: 'Was gehört in jede wissenschaftliche Projektarbeit?',
      answers: ['Ein Kapitel über das Mensa-Essen', 'Mindestens drei Memes', 'Ein Gutschein für die Gutachtenden', 'Ein sauberes Literaturverzeichnis'],
      correct: 3,
      explanation: 'Quellen angeben – sonst wird es schnell ein Plagiat.'
    },
    {
      category: 'DHBW-Alltag',
      question: 'Was bedeutet die Note 4,0?',
      answers: ['Gerade noch bestanden', 'Durchgefallen', 'Mit Auszeichnung', 'Vier von null Punkten'],
      correct: 0,
      explanation: '»Ausreichend« – alles schlechter als 4,0 ist nicht bestanden.'
    },
    {
      category: 'DHBW-Alltag',
      question: 'Wofür steht die Abkürzung ECTS?',
      answers: ['Extra Coffee To Survive', 'European Credit Transfer and Accumulation System', 'Elektronisches Campus-Ticket-System', 'Endlich Credits, trotzdem Stress'],
      correct: 1,
      explanation: 'Ein ECTS-Punkt steht für etwa 25 bis 30 Stunden Arbeit.'
    },
    {
      category: 'DHBW-Alltag',
      question: 'Was bedeutet »c. t.« hinter einer Uhrzeit im Vorlesungsplan?',
      answers: ['Pünktlich auf die Sekunde', 'Kaffee mitbringen', 'Beginn 15 Minuten später', 'Vorlesung fällt aus'],
      correct: 2,
      explanation: 'Cum tempore – das akademische Viertel. »s. t.« heißt pünktlich.'
    },
    {
      category: 'DHBW-Alltag',
      question: 'Die Klausur ist verhauen. Was folgt in der Regel?',
      answers: ['Die sofortige Exmatrikulation', 'Ein Freigetränk vom Prüfungsamt', 'Eine Ehrenrunde um den Campus', 'Eine Wiederholungsprüfung'],
      correct: 3,
      explanation: 'Also: durchatmen, nachlernen, nochmal antreten.'
    },
    {
      category: 'DHBW-Alltag',
      question: 'Welche Lernstrategie ist laut Lernforschung besonders wirksam?',
      answers: ['Verteilt lernen und sich selbst abfragen', 'Die Nacht vorher durchlernen', 'Folien unters Kopfkissen legen', 'Nur Altklausuren auswendig lernen'],
      correct: 0,
      explanation: 'Verteiltes Wiederholen schlägt jede Nachtschicht.'
    },
    {
      category: 'DHBW-Alltag',
      question: 'Wie sieht ein eduroam-Benutzername typischerweise aus?',
      answers: ['admin', 'kennung@domain-der-hochschule', 'Nur der Vorname', 'Das Passwort vom Zettel am Beamer'],
      correct: 1,
      explanation: 'An der Domain erkennt eduroam, wo dein Login geprüft wird.'
    },
    {
      category: 'DHBW-Alltag',
      question: 'Wo verbringst du im dualen Studium die Praxisphasen?',
      answers: ['In der Mensa', 'Im Bett, aber mit Laptop', 'Beim Partnerunternehmen', 'In der Bibliothek, Regal 7'],
      correct: 2,
      explanation: 'Theorie an der DHBW, Praxis beim Partnerunternehmen.'
    }
  ];
})();
