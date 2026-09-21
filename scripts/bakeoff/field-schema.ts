/**
 * The Croatian payslip field schema — the single source of truth for BOTH engines.
 *
 * Content Understanding consumes it as a `fieldSchema`; the LLM challenger consumes the
 * same descriptions as a JSON schema. Both get identical instructions, so the bake-off
 * compares engines rather than prompts.
 *
 * Descriptions are mini-prompts. They name the Croatian labels a payslip actually prints,
 * including the variants across the seven layouts in our golden set, because that wording
 * is what the model matches against.
 */

export interface FieldDef {
  type: "string" | "number" | "date" | "array";
  description: string;
  items?: Record<string, FieldDef>;
}

const s = (description: string): FieldDef => ({ type: "string", description });

export const PAYSLIP_FIELDS: Record<string, FieldDef> = {
  employerName: s(
    "Naziv poslodavca (tvrtka). Traži pod 'Poslodavac:', 'I. PODACI O POSLODAVCU / 1. Tvrtka' ili 'Naziv / ime i prezime'. " +
      "OPREZ: na nekim obrascima blok poslodavca je DESNO, a blok radnika LIJEVO. Ne uzimaj ime proizvođača " +
      "programa za obračun plaće (npr. redak 'Registrirani korisnik'). Ako obrazac uopće nema blok poslodavca, vrati null.",
  ),
  employerAddress: s("Adresa ili sjedište poslodavca (ulica, broj, poštanski broj, grad)."),
  employerOib: s(
    "OIB poslodavca — točno 11 znamenki. Može biti ispisan s prefiksom 'HR' (npr. HR14610016674); vrati samo 11 znamenki. " +
      "Na svakom obračunu postoje DVA OIB-a; ovo je onaj u bloku poslodavca.",
  ),
  employerIban: s(
    "IBAN poslodavca. Prepiši točno kako je ispisano, čak i ako nije u IBAN formatu (neki obrasci tu ispisuju stari broj računa poput '2360000-1101425545').",
  ),
  employeeName: s(
    "Ime i prezime radnika/radnice. Traži pod 'Posloprimac:', 'II. PODACI O RADNIKU / 1. Ime i prezime'. " +
      "Može biti ispisano 'PREZIME IME'. Zanemari broj u zagradama iza imena (matični broj radnika).",
  ),
  employeeAddress: s("Adresa radnika (ulica, broj, poštanski broj, grad)."),
  employeeOib: s("OIB radnika — točno 11 znamenki, iz bloka radnika. Nije isti kao OIB poslodavca."),
  employeeIban: s(
    "IBAN tekućeg računa radnika na koji se isplaćuje plaća. NE uzimaj IBAN primatelja poreza (redak 'Primatelj:') ni IBAN poslodavca.",
  ),
  period: s(
    "Obračunsko razdoblje na koje se plaća odnosi, u formatu YYYY-MM. Ispisano kao 'ZA RAZDOBLJE: svibanj 2025.', " +
      "'GODINA 2025, MJESEC 6', 'OBRAČUN PLAĆE 2025-06' ili '1.05.2025 do 31.05.2025'. " +
      "Hrvatski mjeseci: siječanj=01, veljača=02, ožujak=03, travanj=04, svibanj=05, lipanj=06, " +
      "srpanj=07, kolovoz=08, rujan=09, listopad=10, studeni=11, prosinac=12. " +
      "NIJE isto što i datum isplate, koji je obično sljedeći mjesec.",
  ),
  paymentDate: s(
    "Datum isplate u formatu YYYY-MM-DD. Ispisano kao 'Datum isplate', 'Datum određen za isplatu' ili " +
      "'DATUM I IZNOS ZA ISPLATU'. NE uzimaj datum obračuna ni datum ispisa dokumenta.",
  ),
  ukupnoSati: s(
    "Ukupan broj sati ISPISAN U ISTOM RETKU kao ukupni iznos BRUTO PLAĆE — npr. '1. BRUTO PLAĆA  Ukupno sati: 212', " +
      "'BRUTO PLAĆA (1. do 5.)  128,00', 'PLAĆA (BRUTO SVOTA)  179,00', ili UKUPNO redak tablice plaćanja. " +
      "NE uzimaj ugovoreni mjesečni fond sati ('Fond sati', 'REDOVNI MJESEČNI FOND SATI') ako se razlikuje od sati uz bruto plaću — " +
      "to su dva različita broja i često su oba ispisana na istom obračunu.",
  ),
  currency: s("Valuta obračuna — 'EUR' za sve obračune od 2023. nadalje, 'HRK' za starije."),

  brutoPlaca: s(
    "BRUTO PLAĆA — ukupni bruto iznos prije doprinosa i poreza. Labeli: '1. BRUTO PLAĆA', 'BRUTO PLAĆA (1. do 5.)', " +
      "'PLAĆA (BRUTO SVOTA)', 'Bruto', 'IZNOS OSTVARENOG OPOREZIVOG PRIMITKA', " +
      "'REDOVNI MJESEČNI FOND SATI I UKUPAN IZNOS PLAĆE NA TEMELJU RADNOG ODNOSA'. " +
      "Ako postoji i 'Bruto' i 'Bruto 2', uzmi 'Bruto'.",
  ),
  doprinosiIzPlace: s(
    "UKUPNI DOPRINOSI IZ PLAĆE — doprinosi na teret RADNIKA (MIO I. i II. stup, ukupno 20%), koji umanjuju plaću. " +
      "Labeli: '4. DOPRINOSI IZ PLAĆE (NA TERET ZAPOSLENIKA)', 'Ukupno doprinosi', 'UTVRĐIVANJE DOPRINOSA IZ OSNOVICE', " +
      "'IZDACI', 'Doprinosi iz plaća'. NE brkaj s 'doprinosi NA plaću', koji su na teret poslodavca.",
  ),
  doprinosMioIStup: s("Doprinos za mirovinsko osiguranje I. STUP (generacijska solidarnost), stopa 15%."),
  doprinosMioIiStup: s("Doprinos za mirovinsko osiguranje II. STUP (individualna kapitalizirana štednja), stopa 5%."),
  dohodak: s(
    "DOHODAK = bruto plaća umanjena za doprinose iz plaće. Labeli: '5. DOHODAK (1. – 4.)', '8. DOHODAK', " +
      "'DOHODAK (VIII.1. - VIII.2.)', 'DOHODAK - Plaća umanjena za doprinose'. Nije isto što i neto plaća.",
  ),
  osobniOdbitak: s(
    "OSOBNI ODBITAK (neoporezivi odbitak, olakšica) koji se odbija od dohotka prije poreza. " +
      "Labeli: '6. OLAKŠICE', 'OSOBNI ODBITAK', 'NEOPOREZIVI ODBITAK (UKUPAN FAKTOR OSOBNOG ODBITKA)', 'Osobni odbici', 'Olakšica'. " +
      "Osnovni iznos je 600,00 EUR mjesečno od 2025., uvećan za uzdržavane članove.",
  ),
  poreznaOsnovica: s(
    "POREZNA OSNOVICA = dohodak umanjen za osobni odbitak. Ne može biti negativna — ako osobni odbitak premašuje dohodak, ispisuje se 0,00.",
  ),
  porezNaDohodak: s(
    "UKUPAN IZNOS POREZA NA DOHODAK. Labeli: '8. POREZ NA DOHODAK', 'UKUPAN IZNOS POREZA', 'UKUPNO POREZ', " +
      "'IZNOS PREDUJMA POREZA I PRIREZA POREZU NA DOHODAK'. " +
      "Prepiši ISPISANI iznos; nemoj ga sam računati iz ispisane stope — stopa je ponekad zaokružena i netočna.",
  ),
  netoPlaca: s(
    "NETO PLAĆA = dohodak umanjen za porez, PRIJE neoporezivih primitaka i prije obustava. " +
      "Labeli: '9. NETO PLAĆA (5. – 8.)', 'NETO PLAĆA (1 do 5) - (7) – (9)', 'IZNOS PLAĆE', 'IZNOS NETO PLAĆE', 'Neto'. " +
      "NIJE isto što i iznos za isplatu.",
  ),
  neoporeziviPrimiciUkupno: s(
    "UKUPAN IZNOS NEOPOREZIVIH PRIMITAKA/NAKNADA (prehrana, prijevoz, putni nalozi, nagrade). " +
      "Labeli: '10. NEOPOREZIVI PRIHODI', 'VRSTE I IZNOSI NEOPOREZIVIH NAKNADA', 'NEOPOREZIVI PRIMICI I NAKNADE PLAĆE NA TERET HZZO', 'Dodaci', 'NAKNADE'. " +
      "Ako obrazac taj odjeljak uopće ne ispisuje, vrati null; ako ga ispisuje s iznosom 0,00, vrati 0,00.",
  ),
  obustaveUkupno: s(
    "UKUPAN IZNOS OBUSTAVA IZ PLAĆE (krediti, sindikalne članarine, ovrhe) koje se oduzimaju od isplate. " +
      "Labeli: '12. OBUSTAVE', 'VRSTE I IZNOSI OBUSTAVA IZ PLAĆE', 'Odbici'. " +
      "Ako obrazac taj odjeljak uopće ne ispisuje, vrati null; ako ga ispisuje s iznosom 0,00, vrati 0,00.",
  ),
  iznosZaIsplatu: s(
    "IZNOS ZA ISPLATU — konačni iznos koji se doznačuje radniku na račun, = neto plaća + neoporezivi primici − obustave. " +
      "Labeli: '13. IZNOS ZA ISPLATU (11. – 12.)', 'XII. IZNOS ZA ISPLATU NAKON OBUSTAVA', " +
      "'DATUM I IZNOS ZA ISPLATU PLAĆE/NAKNADE PLAĆE U CIJELOSTI', 'Osobni račun'. " +
      "Ovo je jedini iznos koji odgovara uplati na bankovnom izvatku.",
  ),
  doprinosiNaPlacu: s(
    "UKUPNI DOPRINOSI NA PLAĆU — doprinosi na teret POSLODAVCA (obvezno zdravstveno osiguranje, stopa 16,5%). " +
      "Ne umanjuju plaću radnika. Labeli: '2. DOPRINOSI NA PLAĆU (NA TERET POSLODAVCA)', 'DOPRINOSI NA OSNOVICU', " +
      "'IZNOS DOPRINOSA NA OSNOVICU', 'Doprinosi na plaće'. Može biti 0,00 uz olakšicu za prvo zapošljavanje.",
  ),
  ukupanTrosakRada: s(
    "UKUPAN TROŠAK RADA / TROŠAK POSLODAVCA = bruto + doprinosi na plaću + neoporezivi primici. " +
      "Labeli: '3. UKUPAN TROŠAK PLAĆE (ZA POSLODAVCA)', 'XIV. UKUPAN TROŠAK RADA', 'UKUPNI TROŠAK POSLODAVCA'. " +
      "Neki obrasci ga ne ispisuju — tada vrati null. 'Bruto 2' NIJE ukupan trošak rada.",
  ),

  payComponents: {
    type: "array",
    description:
      "Stavke koje čine BRUTO PLAĆU (redovan rad, smjene, prekovremeni, godišnji odmor, blagdani, bolovanje, dodaci). " +
      "Zbroj iznosa mora biti jednak bruto plaći. " +
      "VAŽNO: ako tablica ima hijerarhiju (npr. '1.1. za redoviti rad' pa ispod nje '- redovan rad'), uzmi SAMO " +
      "završne (leaf) retke, ne međuzbrojeve — inače ćeš iznose brojati dvaput.",
    items: {
      naziv: s("Naziv vrste rada ili dodatka, bez šifre (VrPr) koja mu prethodi."),
      sati: s("Broj sati za tu stavku; null ako redak nema sate (dodaci izraženi koeficijentom)."),
      koeficijent: s("Koeficijent, faktor ili satnica za tu stavku; null ako nije ispisan."),
      iznos: s("Iznos u eurima za tu stavku."),
    },
  },
  obustave: {
    type: "array",
    description:
      "Pojedinačne obustave iz plaće. Zbroj iznosa mora biti jednak ukupnom iznosu obustava. Prazan niz ako ih nema.",
    items: {
      naziv: s("Naziv ili vrsta obustave."),
      vjerovnik: s("Vjerovnik kojem se obustava doznačuje; null ako nije ispisan."),
      iznos: s("Iznos obustave u eurima."),
      ostatakSalda: s("Ostatak salda kredita; null ako nije ispisan."),
      brojRata: s("Preostali broj rata, prepisan kako je ispisan (npr. '14' ili '10/120'); null ako nije ispisan."),
    },
  },
  neoporeziviPrimici: {
    type: "array",
    description:
      "Pojedinačni neoporezivi primici i naknade. Zbroj iznosa mora biti jednak ukupnom iznosu. Prazan niz ako ih nema.",
    items: {
      naziv: s("Naziv neoporezivog primitka (npr. 'Trošak prehrane', 'Prijevoz', 'Naknada za topli obrok')."),
      iznos: s("Iznos u eurima."),
    },
  },
};

/** Rules both engines get verbatim, so neither is advantaged by better instructions. */
export const SHARED_RULES = `
- Dokument je hrvatski obračun plaće (Obrazac IP1). Sadržaj je propisan, ali raspored NIJE — svaki proizvođač programa za plaće ima svoj izgled.
- Brojevi su u hrvatskom formatu: zarez je decimalni separator, točka je separator tisućica. "1.234,56" znači tisuću dvjesto trideset četiri i 56 centi.
  Vrati SVE iznose kao decimalni string s točkom kao decimalnim separatorom i bez separatora tisućica: "1234.56".
- Vrati null za polje kojeg na dokumentu NEMA. Nikada ne pogađaj, ne računaj i ne izvodi vrijednost koja nije ispisana.
- Ako je vrijednost na dokumentu zaklonjena (npr. gumbom sučelja na snimci zaslona) ili odrezana, vrati null.
- Prepisuj iznose točno kako su ispisani. Ne zaokružuj i ne preračunavaj.
- Snimke zaslona mogu sadržavati statusnu traku, adresnu traku preglednika, nazive datoteka i gumbe aplikacije — sve to zanemari.
`.trim();
