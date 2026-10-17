# STARS notları

STARS'ı kurcalarken tuttuğum notlar: hangi uç ne veriyor, rate-limit nasıl çalışıyor.

## Rate-limit (özet)

STARS ~16 istek/sn'de 144 istekten sonra IP'yi `423 Locked` ile **en az 8,5 dakika** tüm uçlara
kapatıyor. Ayrıntısı aşağıda.

## STARS uçları (hepsi girişsiz)

Taban: `https://stars.bilkent.edu.tr/homepage/ajax/`

| Uç | Ne veriyor | Bugün kullanılıyor mu |
|---|---|---|
| `plainCourseCodes.php` | 61 bölüm: kod, ad, **fakülte** | kod + ad |
| `plainOfferings.php?COURSE_CODE=CS&SEMESTER=20261` | 16 sütun: şube, ad, **hoca(lar) + STARS ID** (`openCoursesPage('5957')`), ders/lab saati, kredi, ECTS, atanmış kontenjan + **tipi** (`65 Mand. or Elect.` / `Unlimited`), toplam kontenjan, zorunlu/seçmeli/toplam kayıt, boş kontenjan, **saat metni**, syllabus linki | kısmen (ID, tip, saat metni, link yok) |
| `schedule.php?COURSE=CS%20101-1&SEMESTER=20261` | Haftalık tablo. Hücre sınıfı = tür: `cl_ders_DY` yüz yüze ders, `cl_ders_DD` online/hibrit ders, `cl_ders_DR` recitation, `cl_lab_LL` yüz yüze lab/stüdyo, `cl_lab_LO` online lab. `(S)` = Spare Hour. Saat satırları 08:30–22:20 (14 satır) | yalnızca derslik |
| `courses.oldOfferings.php?COURSE=CS%20202` | Üstte: **katalog açıklaması, ön koşul ifadesi** (`CS 201 and (MATH 132 or MATH 210)`), online/hibrit/yüz yüze saat dağılımı, kredi. Altta `#sections`: her dönem × şube için dönem, şube, hoca(+ID), **öğrenci sayısı, şube GPA, ders GPA**. 1990'a kadar (CS 202: 73 dönem; MATH 101: 522 satır). Sayfa büyük (MATH 101: 680 KB) | ilk 12 satırın ortalaması + hoca toplamı |
| `offerings.list.php?CRSCODES=CS&SEMESTER=20261` | O dönem açılan dersler, saat dağılımı ile | hayır |
| `courses.list.php?CRSCODES=CS&SHW=` | **Tüm katalog** (açılmayanlar dahil; CS: 115 ders, bu dönem açılan 47) | hayır |
| `staff.list.php?DEPT=CS&orderby=` | Bölüm akademik kadrosu: ad, **unvan**, web sayfası, STARS ID (+ ofis/telefon — **saklanmayacak**) | hayır |
| `staff.info.php?ID=5957` | Ad, unvan, eğitim ve araştırma alanı (+ ofis/telefon) | hayır |
| `https://stars.bilkent.edu.tr/syllabus/show/{dönem}/{bölüm}/{no}/{şube}` | **Giriş istemiyor.** Değerlendirme tablosu (Type / Label / Count / Total Contribution), **FZ şartı** (serbest metin), haftalık konular, ders kitabı, öğrenme çıktıları, ECTS iş yükü tablosu, koordinatör, GenAI politikası, ders türü/yöntemi | hayır |
| `academic_units.php`, `curriculum.php?DEPT=` | Fakülte/bölüm yapısı, program müfredatları, `catalog.bilkent.edu.tr` linkleri | hayır |

Kapalı/boş: `courses.desc.php` boş dönüyor (aynı bilgi oldOfferings'te var). `evalreport` yalnızca
kampüs ağından (`Instructor and course evaluation records are only available on computers within
the Bilkent University network`) — **kullanılmayacak**. Baktığım 3 syllabusta (CS 101, MATH 101,
ECON 102) **harf notu aralıkları yok**; not hesaplayıcının harf tablosu için mevcut form akışı
gerekli kalıyor.

Dönem seçicisinde 131 dönem var. `plainOfferings` 2010'da da çalışıyor (kontenjan sütunları `-`),
2015'te kontenjan dolu.

Syllabus örnekleri (değerlendirme):
- CS 101-1 (20261): Final 35, Midterm 35, Lab 15, Quiz 10, Homework 5. FZ: midterm ≥ %40, lab ≥ %65, ödev ≥ %51.
- MATH 101-1 (20261): Midterm 1 28, Midterm 2 28, Final 28, Homework 16. FZ: iki midterm toplamı < 40/200 ise FZ.
- ECON 102-1 (20252): Homework+Quiz 20, Participation 10, Midterm 30, Final 40.

## Rate-limit ayrıntısı

25 Eylül 15:46 UTC, temiz bir Actions runner'ından, prod ile aynı istemci (varsayılan fetch UA) ve
aynı ayarlarla (8 paralel, batch arası 200 ms) **yalnızca** `courses.oldOfferings` istekleri:

- İlk **144 istek 9 saniyede** başarılı (~16 istek/sn, 10,6 MB). 145. istekten itibaren:
  `HTTP 423 Locked`, gövde: *"Bilkent University — Too many requests. Please try again in a few
  minutes"*. Header'da `Retry-After` yok.
- Kilit **IP'nin tamamına**: `plainCourseCodes.php` dahil her uç 423. 30 sn arayla izlendi,
  **8,5 dakika sonra hâlâ kalkmamıştı.**
- Aynı gün prod'da `schedule.php` 1.971 isteği 5 paralel / 500 ms (~7 istek/sn) ile sorunsuz
  geçiyor. Sorun toplam hacim değil, **hız** (ve büyük yanıtlar). GPA aşaması hızlanınca kilit;
  kilitli IP'de kalan tüm GPA istekleri boş → "0 ders" çalışmaları.

Sonuç / kurallar:
- Global sınır **≤ 3 istek/sn** (eşzamanlılık 2, istekler arası ≥ 400 ms); `oldOfferings` gibi
  büyük sayfalarda eşzamanlılık 1.
- **423 gelirse o çalışmada STARS'a bir daha istek atma**: ilerlemeyi kaydet, çık. Tekrar denemek
  kilidi uzatır. 429/5xx için normal geri çekilme.
- Önce `live` katmanı (62 küçük istek), sonra ağır katmanlar — kilit yenirse en azından
  kontenjan/saat güncel kalsın.

