# PDF Revizyon Karşılaştırma

Aynı dokümanın iki revizyonunu (ör. Rev A ve Rev B) karşılaştırıp aradaki farkları bulan, **tamamen çevrimdışı** çalışan bir araç.

## Gizlilik
- Program tarayıcınızın içinde çalışır; **hiçbir sunucu, bulut ya da yapay zekâ servisi kullanılmaz.**
- Sayfaya, dış bağlantıyı tamamen yasaklayan bir güvenlik politikası (CSP, `connect-src 'none'`) eklendi. Yani sayfa, isteseydi bile dosyalarınızı bir yere gönderemez.
- Gerekli tüm dosyalar (PDF okuyucu kütüphanesi dahil) bu klasörün içinde. İnternet bağlantısı olmayan bir bilgisayarda da çalışır.

## Kullanım
1. `pdf-karsilastir` klasörünü bilgisayarınıza kopyalayın (klasörün tamamı: `index.html`, `app.js`, `core.js`, `lib/`).
2. `index.html` dosyasına çift tıklayın (Chrome, Edge veya Firefox'ta açılır).
3. Sola **eski revizyonu (A)**, sağa **yeni revizyonu (B)** sürükleyin veya tıklayıp seçin.
4. **Karşılaştır**'a basın.

## Neler gösterir?
**Genel Bakış**
- Toplam / değiştirilen / eklenen / silinen fark sayıları ve metin benzerlik oranı
- **En Önemli Farklar** listesi (ilk 10). Önem puanı şunlara göre otomatik hesaplanır:
  - sayısal değer değişiklikleri (ölçü, basınç, süre, tarih, tolerans, birim…)
  - yükümlülük ve olumsuzluk ifadeleri (shall → should, must, zorunlu, -malıdır, değil, en az, en fazla…)
  - başlık eklenmesi, silinmesi veya değişmesi
  - değişikliğin büyüklüğü
- Değişikliklerin hangi bölümlerde yoğunlaştığı

**Tüm Farklar**: her fark eski ve yeni metin olarak yan yana gösterilir. Silinen kelimeler kırmızı, eklenenler yeşil işaretlenir; sayfa numarası ve bölüm başlığı da yazılır. Türe ve öneme göre filtreleyebilir, metin içinde arama yapabilir, listeyi önem sırasına dizebilirsiniz.

**Doküman Özeti** (her iki revizyon için): başlık, anahtar terimler, öne çıkan cümleler, içindekiler ve yükümlülük içeren ifadelerin listesi.

**Paylaşım raporu (sadece farklar)**: Başkasıyla paylaşmak için hazırlanmış, sade bir fark listesi (`fark-listesi.html`). Her satırda yalnızca şunlar bulunur: sıra numarası, A ve B'deki sayfa numarası, tür (değiştirildi / eklendi / silindi), önem, kategori (sayısal değer, yükümlülük ifadesi, başlık…), eski metin ve yeni metin.
**Raporda olmayanlar:** değişen metnin çevresindeki metin, doküman özeti, dosya adları ve bölüm başlıkları. Paylaşmadan önce dosyayı açıp kontrol etmeniz önerilir.

**Tam rapor**: "Tam rapor (HTML)" bağlam ve doküman özeti dahil her şeyi içerir; yalnızca kendi kullanımınız içindir. "Yazdır / PDF" ile ekrandaki sonuçları PDF'e dönüştürebilirsiniz.

## Notlar ve sınırlamalar
- Karşılaştırma kelime düzeyinde yapılır. Bu nedenle satır kaymaları ve sayfa düzeni değişiklikleri yanlış fark olarak görünmez.
- Üst bilgi, alt bilgi, sayfa numaraları ("Rev 02 Page 12 of 246" tablo içine karışmış olsa bile) ve içindekiler satırları varsayılan olarak yoksayılır.
- **Revizyon işaretleri** (kenar sütundaki "02", "03" ve "deleted 02" gibi yer tutucular) otomatik bulunur ve yoksayılır; hangi işaretlerin yoksayıldığı Genel Bakış'ta yazar. Ayarlardan kapatılabilir.
- Harf ve rakam içeren kodlar (6981XV01001, S698101001, alarm adları vb.) "Kod / etiket" kategorisinde ayrıca işaretlenir.
- Yalnızca noktalama veya büyük/küçük harf değişikliği olan farklar "biçimsel" olarak işaretlenir ve varsayılan olarak gizlenir.
- **Taranmış (resim) PDF'lerde** metin yoktur. Bu dosyaların önce OCR'dan geçirilmesi gerekir; program bu durumda uyarı verir.
- Şifreli PDF'ler desteklenmez.
- Tablolar ve çok sütunlu sayfalar metin olarak okunur. Farklar yine bulunur ama tablo yapısı gösterilmez.
- Resim ve çizimlerdeki değişiklikler karşılaştırılmaz, yalnızca metin karşılaştırılır.
- Özet ve önem puanı yapay zekâ kullanmadan kurallara dayalı olarak hesaplanır. Bir yön göstermek içindir; kritik farkları mutlaka kendiniz okuyun.

## Teknik
- `core.js`: satır oluşturma, üst ve alt bilgi tespiti, başlık tespiti, fark algoritması (Myers O(ND) ve patience bölütleme), önem puanlaması, özetleme
- `app.js`: arayüz
- `lib/`: Mozilla pdf.js 3.11.174 (Apache 2.0 lisansı, `lib/PDFJS-LICENSE`)

---

# Display Revizyon Tespiti (`display-revizyon.html`)

SCADA ekranlarının (ör. Yokogawa CI Server display XML dosyaları) dokümanın **hangi revizyonuna göre** yapıldığını tahmin eder. Ana sayfadaki "Display revizyon tespiti →" bağlantısıyla ya da `display-revizyon.html` dosyasına çift tıklayarak açılır.

## Kullanım
1. Dokümanın **tüm revizyonlarını** (PDF) yükleyin. Etiketler dosya adından tahmin edilir (`..._Rev02.pdf` → "Rev 02"). Gerekirse düzeltin. Liste eskiden yeniye sıralanır; en alttaki revizyon "güncel" kabul edilir.
2. Display XML dosyalarını seçin. Klasör de seçebilir veya sürükleyebilirsiniz; alt klasörler de okunur.
3. **Analiz et**'e basın.

## Nasıl çalışır?
- Her revizyondan tag / parametre adları (6981XV01001, CALZEROSUC…) ve 3 kelimelik ifadeler (operatör mesajları gibi) çıkarılır.
- Yalnızca bazı revizyonlarda geçen ifadeler **ayırt edici** kabul edilir.
- Her XML'deki öznitelik değerleri ve metinler okunur. Display'in ayırt edici ifadelerinin hangi revizyonla en çok örtüştüğüne bakılır.
- Tag eşleşmesi, ifade eşleşmesinden daha güçlü kanıt sayılır.
- Noktalı yollar (Yokogawa CI Server'daki `<value>SYSTEM.PROJE.6981AI01002.PV</value>` gibi) parçalarına ayrılır. Her parça ve ardışık ikililer (`6981AI01002`, `6981AI01002.PV`) ayrı ayrı aranır.
- Hiçbir revizyonda geçmeyen XML içerikleri (koordinat, renk, nesne kimliği…) hesaba katılmaz. Bu sayede XML şemasını bilmeye gerek kalmaz.
- XML kodlaması (UTF-8, UTF-16, Shift_JIS vb.) dosyanın başından otomatik algılanır.

## Tarih kontrolü (isteğe bağlı)
Revizyonların yayın tarihlerini girerseniz (gg.aa.yyyy), display XML'lerindeki değişiklik geçmişi (`<revisionHistory>` → `when="…"`) ile karşılaştırılır:
- "Son değişiklik Rev 03 yayınından önce": Display, Rev 03 yayınlandıktan sonra hiç değiştirilmemiş.
- İçerik Rev 03 gösterdiği halde tarih daha eskiyse uyarı verilir. Bu durumda büyük olasılıkla değişiklik geçmişi eksik tutulmuştur.

## Sonuçlar
| Sonuç | Anlamı |
|---|---|
| **Rev 03 (güncel)** | Display en güncel revizyonla uyumlu |
| **Rev 02** (kırmızı) | Display eski bir revizyona göre yapılmış |
| **⚠ karışık** | Display'de birden fazla revizyonun izleri var (kısmen güncellenmiş olabilir) |
| **Belirsiz** | İki revizyon arasında ayırt edilemedi |
| **Yetersiz kanıt** | Display'de sadece tüm revizyonlarda ortak olan ifadeler var |

Satıra tıklayınca kanıtlar görünür:
- **Lehine kanıt:** Tahmin edilen revizyona özgü ifadeler.
- **Çelişen ifadeler:** Başka revizyonlara ait ifadeler.
- **Güncellenmesi gerekebilir:** Display'de olan ama son revizyonda artık bulunmayan ifadeler.

Sonuçlar CSV (Excel) veya HTML rapor olarak indirilebilir.

## Sınırlamalar
- Sadece metin karşılaştırılır. Renk, yerleşim ve sembol gibi görsel farklar tespit edilemez.
- Bir revizyonda **eklenen** bir öğenin display'de **eksik** olması bu yöntemle güvenilir şekilde bulunamaz, çünkü hangi öğenin hangi display'de olması gerektiği bilinmiyor. Program display'de **fazla veya eski** olan ifadeleri bulur.
- Revizyonlar arasında değişmeyen konuları gösteren display'ler için karar verilemez ("Yetersiz kanıt").
