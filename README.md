# Doc-creator: External Work Report oluşturucu

Fabrika ziyaretleri için **External Work Report** PDF'ini otomatik dolduran,
tek dosyalık ve çevrimdışı çalışan bir araç.

## Kullanım

1. `EWR-Olusturucu.html` dosyasını indir ve tarayıcıda aç (çift tıklamak yeterli, internet gerekmez).
2. İlk seferde **Sabit bilgiler** bölümünü doldur (Client, Location, Requested by,
   order number, adın vb.). Bu bilgiler tarayıcında saklanır, bir dahaki sefere hazır gelir.
3. **+ Bugün / + Sonraki gün / + Tarih seç** ile çalıştığın günleri ekle. Gerekirse
   aktivite metnini ya da saatleri o gün için değiştir.
4. **PDF oluştur**'a bas: dosya iner ve sayfanın altında önizlemesi açılır.

## Varsayılan hesap

| Alan | Varsayılan |
|---|---|
| Başlangıç / bitiş | 08:30 / 17:30 |
| Öğle arası | 0,5 saat (çalışma süresinden düşülür) |
| Yol | 1,5 saat gidiş + 1,5 saat dönüş = 3,00 saat, `R` (return) |
| Çalışma süresi | bitiş − başlangıç − öğle = 8,50 saat |

- Çalışma saatleri varsayılan olarak, örnek rapordaki gibi tamamı
  *working time 08.00-17.00 h* satırına yazılır. İstersen ayarlardan
  00-08 / 08-17 / 17-22 / 22-24 dilimlerine bölünmesini seçebilirsin.
- Gidiş veya dönüşten biri 0 ise `S` (single) yazılır.
- Form Pazar–Cumartesi haftası şeklindedir; farklı haftalara düşen günler için
  her hafta ayrı bir sayfa üretilir. Hafta numarası ISO haftasıdır.
- Rapor (imza) tarihi varsayılan olarak bugündür.
- Türkçe ş/ğ/ı karakterleri PDF fontu desteklemediği için s/g/i olarak yazılır.

## Geliştirme

- `src/ewr.html`: arayüz ve PDF yerleşimi (koordinatlar orijinal şablondan ölçüldü).
- `template/ewr_template_blank.pdf`: değerleri silinmiş boş şablon.
  Yeniden üretmek için: `python tools/make_blank_template.py <dolu.pdf> template/ewr_template_blank.pdf`
- `tools/build.py`: [pdf-lib](https://github.com/Hopding/pdf-lib) 1.17.1 (MIT) ve şablonu
  `EWR-Olusturucu.html` içine gömer:
  `npm pack pdf-lib@1.17.1 && tar xzf pdf-lib-1.17.1.tgz && python tools/build.py package/dist/pdf-lib.min.js`
