/**
 * KAP sector key (`sector_key` in src/services/sector_service.py) → the BIST sector index
 * that tracks it, offered as a one-click comparison on the stock chart. Every symbol here
 * answers /market/index/{symbol} with chart history. Sectors without a dedicated index
 * (healthcare, defence, publishing…) get no suggestion rather than a loose one.
 */
const SECTOR_INDEX: Record<string, { symbol: string; name: string }> = {
  "ana-metal-sanayi": { symbol: "XMANA", name: "BIST Metal Ana" },
  "araci-kurumlar": { symbol: "XAKUR", name: "BIST Aracı Kurumlar" },
  bankalar: { symbol: "XBANK", name: "BIST Banka" },
  bilisim: { symbol: "XBLSM", name: "BIST Bilişim" },
  "elektrik-gaz-ve-buhar": { symbol: "XELKT", name: "BIST Elektrik" },
  "finansal-kiralama-ve-faktoring-sirketleri": { symbol: "XFINK", name: "BIST Fin. Kir. Faktoring" },
  "finansman-sirketleri": { symbol: "XUMAL", name: "BIST Mali" },
  "girisim-sermayesi-yatirim-ortakliklari": { symbol: "XUMAL", name: "BIST Mali" },
  "varlik-yonetim-sirketleri": { symbol: "XUMAL", name: "BIST Mali" },
  "gayrimenkul-yatirim-ortakliklari": { symbol: "XGMYO", name: "BIST GYO" },
  "gida-icecek-ve-tutun": { symbol: "XGIDA", name: "BIST Gıda İçecek" },
  "holdingler-ve-yatirim-sirketleri": { symbol: "XHOLD", name: "BIST Holding ve Yatırım" },
  "insaat-ve-bayindirlik-isleri": { symbol: "XINSA", name: "BIST İnşaat" },
  "kagit-ve-kagit-urunleri-basim": { symbol: "XKAGT", name: "BIST Orman Kağıt Basım" },
  "orman-urunleri-ve-mobilya": { symbol: "XKAGT", name: "BIST Orman Kağıt Basım" },
  "kimya-ilac-petrol-lastik-ve-plastik-urunler": { symbol: "XKMYA", name: "BIST Kimya Petrol Plastik" },
  konaklama: { symbol: "XTRZM", name: "BIST Turizm" },
  "yiyecek-ve-icecek-hizmetleri": { symbol: "XTRZM", name: "BIST Turizm" },
  "menkul-kiymet-yatirim-ortakliklari": { symbol: "XYORT", name: "BIST Menkul Kıymet Yat. Ort." },
  "metal-esya-makine-elektrikli-cihazlar-ve-ulasim-araclari": { symbol: "XMESY", name: "BIST Metal Eşya Makina" },
  "perakende-ticaret": { symbol: "XTCRT", name: "BIST Ticaret" },
  "toptan-ticaret": { symbol: "XTCRT", name: "BIST Ticaret" },
  "sigorta-sirketleri": { symbol: "XSGRT", name: "BIST Sigorta" },
  "spor-faaliyetleri-eglence-ve-oyun-faaliyetleri": { symbol: "XSPOR", name: "BIST Spor" },
  "tas-ve-topraga-dayali": { symbol: "XTAST", name: "BIST Taş Toprak" },
  "tekstil-giyim-esyasi-ve-deri": { symbol: "XTEKS", name: "BIST Tekstil Deri" },
  telekomunikasyon: { symbol: "XILTM", name: "BIST İletişim" },
  "ulastirma-ve-depolama": { symbol: "XULAS", name: "BIST Ulaştırma" },
  "metal-cevheri-madenciligi": { symbol: "XMADN", name: "BIST Madencilik" },
  "komur-ve-linyit-madenciligi": { symbol: "XMADN", name: "BIST Madencilik" },
  "diger-madencilik-ve-tas-ocakciligi": { symbol: "XMADN", name: "BIST Madencilik" },
};

export function sectorIndexOf(sectorKey: string | null | undefined): { symbol: string; name: string } | null {
  return sectorKey ? (SECTOR_INDEX[sectorKey] ?? null) : null;
}
