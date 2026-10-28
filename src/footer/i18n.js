const CS = {
  blockLabel: "Doplňky k objednávce",
  blockTitle: "",
  blockSubtitle: "",
  tipTitle: "Přidat spropitné",
  tipHint: "Poděkujte lidem, kteří vaši objednávku připravují.",
  tipGroup: "Výše spropitného",
  tipThanks: "Mockrát děkujeme",
  servicesTitle: "Doplňkové služby",
  parcelProtection: "Ochrana zásilky",
  parcelProtectionHint: "Pojištění zásilky pro případ ztráty nebo poškození.",
  priorityShipping: "Přednostní expedice",
  priorityShippingHint: "Vaše objednávka se vyřídí přednostně.",
  giftTitle: "Dárková kartička",
  giftHint: "Ke každé kartičce můžete připsat věnování.",
  cardCount: "Počet kartiček",
  cardMore: "Přidat kartičku",
  cardLess: "Ubrat kartičku",
  noteLabel: (n, total) => (total > 1 ? `Věnování ${n}` : "Věnování"),
  notePlaceholder: "Napište pár slov na kartičku…",
  error: "Změnu se nepodařilo provést. Zkuste to prosím znovu.",
  priceError: "Cena doplňku v košíku neodpovídá nabídce, proto byl z košíku odebrán.",
  orphanNotice: "V košíku je položka doplňku, která už není nabízena.",
  orphanRemove: "Odebrat z košíku",
};

const SK = {
  blockLabel: "Doplnky k objednávke",
  blockTitle: "",
  blockSubtitle: "",
  tipTitle: "Pridať prepitné",
  tipHint: "Poďakujte ľuďom, ktorí vašu objednávku pripravujú.",
  tipGroup: "Výška prepitného",
  tipThanks: "Veľmi pekne ďakujeme",
  servicesTitle: "Doplnkové služby",
  parcelProtection: "Ochrana zásielky",
  parcelProtectionHint: "Poistenie zásielky pre prípad straty alebo poškodenia.",
  priorityShipping: "Prednostná expedícia",
  priorityShippingHint: "Vaša objednávka sa vybaví prednostne.",
  giftTitle: "Darčeková kartička",
  giftHint: "Ku každej kartičke môžete pripísať venovanie.",
  cardCount: "Počet kartičiek",
  cardMore: "Pridať kartičku",
  cardLess: "Ubrať kartičku",
  noteLabel: (n, total) => (total > 1 ? `Venovanie ${n}` : "Venovanie"),
  notePlaceholder: "Napíšte pár slov na kartičku…",
  error: "Zmenu sa nepodarilo vykonať. Skúste to prosím znova.",
  priceError: "Cena doplnku v košíku nezodpovedá ponuke, preto bol z košíka odobraný.",
  orphanNotice: "V košíku je položka doplnku, ktorá už nie je ponúkaná.",
  orphanRemove: "Odobrať z košíka",
};

// Config text key -> key in the language table (the config names differ for three of them).
const OVERRIDE_KEYS = {
  blockTitle: "blockTitle",
  blockSubtitle: "blockSubtitle",
  tipTitle: "tipTitle",
  tipHint: "tipHint",
  tipThanks: "tipThanks",
  servicesTitle: "servicesTitle",
  parcelProtectionName: "parcelProtection",
  parcelProtectionHint: "parcelProtectionHint",
  priorityShippingName: "priorityShipping",
  priorityShippingHint: "priorityShippingHint",
  giftTitle: "giftTitle",
  giftHint: "giftHint",
  giftPlaceholder: "notePlaceholder",
};

// Default texts for the shop language, with the merchant's texts from the (validated) config on top. The defaults
// are used for every text that is not overridden; without overrides the plain language table is returned.
export function textsFor(language, overrides) {
  const base = language === "sk" ? SK : CS;
  const keys = Object.keys(OVERRIDE_KEYS).filter((key) => overrides && typeof overrides[key] === "string" && overrides[key] !== "");
  if (keys.length === 0) return base;
  const merged = { ...base };
  for (const key of keys) merged[OVERRIDE_KEYS[key]] = overrides[key];
  return merged;
}
