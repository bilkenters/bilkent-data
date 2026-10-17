# bilkent-data

Selam! [bilkenters.com](https://www.bilkenters.com)'u yaparken ders programı oluşturucu, ders
sayfaları ve bölüm haritaları için STARS'taki verilere ihtiyacım oldu. Elle toplamak imkansız
olunca bir scraper yazdım; topladığı her şey burada JSON olarak duruyor ve GitHub Actions ile
kendi kendine güncelleniyor.

Belki başka birinin de işine yarar diye açık bıraktım. Kendi projende kullanabilirsin, sadece
kaynak olarak bu repoyu belirtmen yeter.

> Bilkent'in resmi bir kaynağı değil. Veriler STARS'ın giriş istemeyen sayfalarından çekiliyor,
> arada hata çıkabilir. Kesin bilgi lazımsa STARS'a bak.

## Neler var

| Nerede | Ne var |
|---|---|
| `public/scheduler/data/offerings/<dönem>.json` | O dönem açılan dersler: şubeler, hocalar, ders saatleri, derslikler, kontenjan, ders ve hoca not ortalamaları. Dönem kodu `YYYYT` (T: 1 güz, 2 bahar, 3 yaz), 20201'den beri. |
| `public/scheduler/data/semesters.json`, `departments.json`, `lastUpdate.json` | Dönem listesi, bölümler, son güncelleme zamanı |
| `data/stars/courses/<BÖLÜM>.json` | Katalog: ders adı, açıklama, kredi/ECTS, saatler, ön koşul (hem metin hem ağaç), dönem dönem geçmiş. 58 bölüm. |
| `data/stars/curricula/<BÖLÜM>.json` | Program müfredatları (36 bölüm) |
| `data/stars/prereq-graph.json` | Ön koşul grafı |
| `data/stars/departments.json` | Fakülte ve bölüm yapısı |
| `data/stars/instructors.json` | Hoca adı, unvanı, bölümü, web sayfası. Telefon, ofis, e-posta tutmuyorum. |
| `data/stars/syllabi/<dönem>/<BÖLÜM>.json` | Syllabus özetleri: değerlendirme yüzdeleri, FZ şartı |
| `data/stars/schedule/<dönem>.json` | Haftalık program önbelleği (ders türü, spare saatler) |

Tipler [`scripts/stars/types.ts`](scripts/stars/types.ts) ve
[`lib/offerings/types.ts`](lib/offerings/types.ts) içinde. Daha detaylı notlarım
[`docs/stars-veri/`](docs/stars-veri/) klasöründe.

## Doğrudan çekmek istersen

Repo public olduğu için dosyalar direkt CDN'den gelebiliyor:

```
https://cdn.jsdelivr.net/gh/bilkenters/bilkent-data@main/public/scheduler/data/offerings/20261.json
https://raw.githubusercontent.com/bilkenters/bilkent-data/main/data/stars/courses/CS.json
```

## Ne zaman güncelleniyor

[`.github/workflows/stars.yml`](.github/workflows/stars.yml) şöyle çalışıyor (saatler UTC):

| Ne | Ne zaman | Neyi günceller |
|---|---|---|
| `live` | 00, 06, 12, 18 | Bu dönemin kontenjan ve kayıt sayıları |
| `course` | her gün 03:17 | Katalog, ön koşullar, ders geçmişi (her gün birazını) |
| `syllabus` | pazartesi 04:37 | Syllabus özetleri |
| `catalog` + `staff` + `curriculum` | her ayın 3'ü 02:47 | Bölüm yapısı, kadro, müfredatlar |

STARS çok hızlı istek atınca IP'yi birkaç dakikalığına kilitliyor, o yüzden scraper saniyede en
fazla 3 istek atıyor. Kilitlenirse duruyor ve o ana kadar topladığını kaydediyor.

## Kendi bilgisayarında denemek

```sh
npm ci
npm test                                  # parser testleri, kayıtlı STARS sayfalarıyla
npm run stars -- --tier=live --dry-run    # hiçbir dosyaya yazmadan dener
```

Ricam şu: scraper'ı sık sık çalıştırma. Veri zaten burada güncel, STARS'ı boşuna yormayalım 🙂

## Lisans

Kod [MIT](LICENSE), veri [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Kullanırsan
"bilkenters / bilkent-data" diye kaynak göstermen yeterli.

Bir hata görürsen ya da eklenmesini istediğin bir şey varsa issue açabilirsin.
