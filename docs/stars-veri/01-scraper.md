# STARS scraper

Scraper katmanları, veri sözleşmesi ve test fixture'ları hakkında notlarım.

## Katmanlar

Tek giriş noktası `scripts/stars/run.ts` (`tsx`), `--tier=live|course|syllabus|staff|backfill`,
`--budget=<istek>`, `--dry-run`. Ortak HTTP istemcisi `scripts/stars/http.ts`:
- Global eşzamanlılık + istekler arası minimum aralık: **≤ 3 istek/sn** (eşzamanlılık 2, aralık
  ≥ 400 ms; `oldOfferings` için eşzamanlılık 1). Gerekçe README §6: STARS ~16 istek/sn'de 144
  istekten sonra IP'yi `423 Locked` ile ≥ 8,5 dk tüm uçlara kapatıyor. `AbortSignal.timeout(30s)`.
- **423 → anında dur**: o çalışmada STARS'a başka istek yok, ilerleme kaydedilir, sonraki
  çalışmada devam. 429/5xx: üstel geri çekilme (2, 4, 8, 16 s). Her non-OK'de status + ilk 200
  karakter loglanır. Art arda 10 hata → devre kesici (aynı davranış).
- Sıra: önce `live`, sonra ağır katmanlar (kilit yenirse kontenjan/saat yine güncel kalsın).
- Çalışma başına istek bütçesi; sayaçlar `lastUpdate.json`'a yazılır (istek sayısı, status dağılımı,
  süre, kapsama).
- User-Agent: `bilkenters-bot/1.0 (+https://www.bilkenters.com)`.

| Katman | Ne zaman | Ne çeker | İstek |
|---|---|---|---|
| `live` | 6 saatte bir (mevcut cron) | `plainCourseCodes` + her bölüm için `plainOfferings` (güncel dönem) | ~62 |
| `schedule` (live içinde) | yalnızca saat metni değişen / yeni şubeler | `schedule.php` → tür (DY/DD/DR/LL/LO) + spare saatler | dönem başında ~2.000, sonra birkaç |
| `catalog` | ayda bir | `courses.list.php?CRSCODES=<BÖLÜM>` her bölüm için: **açılmayanlar dahil tüm dersler** (CS: 115, bu dönem açılan 47) + saat/kredi | ~61 |
| `course` | günde bir, bütçeli (ör. 150/çalışma), en eskiden başlayarak | `courses.oldOfferings` her ders için: açıklama, **ön koşul**, saat dağılımı, tüm dönem×şube GPA satırları. Kapsam = **katalogdaki tüm dersler** (önce bu dönem açılanlar, sonra kalanlar) | ilk tur birkaç gün, sonra dönemde ~1 tur |
| `curriculum` | dönemde bir | `curriculum.php?DEPT=<BÖLÜM>` → programlar (major/minor) → her programın dönem dönem müfredatı (zorunlu dersler, seçmeli kutuları, krediler). İç uç keşfedilecek (§Görevler 5b) | ~61 + program sayısı |
| `syllabus` | dönem başı + ilk 4 hafta haftada bir, bütçeli | `syllabus/show/{dönem}/{bölüm}/{no}/{şube}` | ders başı 1 + farklı hocalı şubeler |
| `staff` | ayda bir | `staff.list.php?DEPT=` → id, ad, unvan, web sayfası | ~61 |
| `backfill` | tek seferlik, bütçeli | eski dönemlerin geçmişini doldurur | ~1.100 |

`live`'da saatler **`plainOfferings`'in Schedule sütunundan** parse edilir; `schedule.php` artık her
çalışmada çağrılmaz. Metin biçimi: `Tue 13:30-15:20 (EA-Z03)<br> Wed 08:30-12:20 (B-201)<br> …`.
Slot indeksi mevcut sözleşmeyle aynı: `index = saatIndeksi * 7 + günIndeksi` (saat 0 = 08:30, gün 0 =
Pazartesi). Saat satırları 08:30–22:20 (14 satır) — `lib/offerings/schedule.ts` 12, scheduler
`engine.ts` 13 saat tanımlıyor; indeks üretirken 14'e kadar izin ver, tüketicileri raporla.

## Veri sözleşmesi

### `public/scheduler/data/offerings/<dönem>.json` (istemci indiriyor — hafif tut, yalnızca ekleme)

Mevcut şekil korunur (`lib/offerings/types.ts` `RawOfferings`). Ekler:
- Şube: `instructor` artık `", "` ile birleşik ad (yapışık `  ` biter);
  yeni `instructors: { id: string; name: string }[]` (STARS ID'si, `openCoursesPage('5957')`'den).
  `Staff` → `instructors: []`, `instructor: "Staff"`.
- Şube: `quota.unlimited?: true` ("Unlimited" satırlar; `total`/`available` 0 kalır ki mevcut
  tüketiciler bozulmasın).
- Şube: `schedule` aynı (`{ [slot]: derslik }`, derslikte `(S)` **olmadan**), yeni
  `spare?: number[]` (spare saat slotları) ve `kinds?: Record<string, 'DY'|'DD'|'DR'|'LL'|'LO'>`.
  Scheduler'ın spare'i çakışma sayıp saymayacağı ayrı karar (README #11) — veri ikisini de mümkün
  kılsın.
- Ders: GPA alanları (`averageGpa`, `letterGrade`, `gpaSampleSize`) **course katmanının
  önbelleğinden** gelir; o turda çekilemediyse önceki değer korunur, asla `null` ile ezilmez.
  Pencere: **son 5 akademik yıl, öğrenci sayısıyla ağırlıklı, STARS'ın "Course GPA" sütunu**;
  `gpaSemesters: number` eklenir. Şube `instructorGpa` aynı pencerede **o hocanın o dersteki**
  şube GPA'larının öğrenci ağırlıklı ortalaması; çok hocalı şubede yazılmaz; n < 20 ise yazılmaz.
- `public/scheduler/data/gpa-data.json`: okuyan yok → üretme, dosyayı sil.

### `data/stars/**` (yalnızca sunucu/build okur, `public/` dışında, commit'lenir)

```ts
// data/stars/courses/<BÖLÜM>.json  — { [dersKodu]: CourseRecord }
interface CourseRecord {
  name: string
  description: string | null        // katalog metni (İngilizce, olduğu gibi)
  prerequisite: string | null       // ham ifade: "CS 201 and (MATH 132 or MATH 210)"; "none" -> null
  prerequisiteTree: PrereqNode | null  // deterministik parse; LLM yok
  credits: number | null; ects: number | null
  hours: { lectureOnline: number; lectureF2F: number; recitation: number; labF2F: number; labOnline: number } | null
  inCatalog: boolean                // courses.list'te var mı
  history: Array<[
    semester: string,               // "20252"
    section: string,                // "1"
    instructorIds: string[],
    students: number,
    sectionGpa: number | null,
    courseGpa: number | null,
  ]>
  fetchedAt: string                 // ISO
}

type PrereqNode =
  | { course: string }                          // "CS 201"
  | { and: PrereqNode[] }
  | { or: PrereqNode[] }
  | { text: string }                            // parse edilemeyen parça: "Consent of the instructor", "junior standing"…

// data/stars/prereq-graph.json — tüm derslerden üretilen indeks (ders ve bölüm sayfaları bunu okur)
//   { edges: Array<[ders: string, önKoşul: string, grup: 'and' | 'or']>, reverse: { [önKoşul]: string[] } }

// data/stars/departments.json — { [kod]: { name: string; faculty: string; catalogUrl: string | null } }
//   plainCourseCodes (fakülte sütunu) + academic_units (katalog linkleri)

// data/stars/curricula/<BÖLÜM>.json
interface CurriculumFile {
  programs: Array<{
    id: string                      // STARS'taki program kodu
    name: string                    // "Information Systems and Technologies"
    kind: 'major' | 'minor' | 'other'
    semesters: Array<{
      label: string                 // "1. Yıl Güz" / STARS'taki etiket
      items: Array<
        | { course: string; credits: number | null }               // zorunlu ders
        | { elective: string; credits: number | null }             // "Technical Elective", "GE Elective"…
      >
    }>
    fetchedAt: string
  }>
}

// data/stars/instructors.json — { [id]: { name: string; title: string | null; dept: string | null; web: string | null } }
//   telefon / ofis / e-posta YOK.

// data/stars/syllabi/<dönem>/<BÖLÜM>.json — { [dersKodu]: { sections: Record<şube, string /* hash */>, variants: Record<hash, SyllabusRecord> } }
interface SyllabusRecord {
  coordinator: string | null
  assessments: Array<{ type: string; label: string; count: number; weight: number }>
  fzText: string | null             // "Minimum Requirements to Qualify for the Final Exam" metni, olduğu gibi
  weekly: string[]                  // haftalık konular
  textbooks: string[]
  outcomes: string[]
  ectsWorkloadTotal: number | null
  prerequisiteText: string | null
  fetchedAt: string
}

// data/stars/state.json — katman ilerlemesi: { course: { [kod]: fetchedAt }, syllabus: {...}, staff: {...}, lastRun: {...} }
```

Tarih derinliği: `history` STARS'ın verdiği tüm satırları tutar (1990'a kadar). Boyut sorun olursa
2010 öncesini at ve raporla. Bölüm başına dosya ⇒ her commit'in diff'i küçük kalır.

## Fixture

`scripts/stars/__fixtures__/` altında gerçek STARS HTML'leri:
bölüm listesi, GE `plainOfferings` (çok hocalı şube + `Unlimited` + `Staff` + saatsiz ders), eski
dönem `plainOfferings` (`-` sütunları), birkaç `schedule.php` (farklı türler, `no schedule`),
`oldOfferings` CS 202, syllabus CS 101-1 ve MATH 101-1, `courses.list` örneği. İçerik listesi
`__fixtures__/README.md`'de. Eksik bir şey lazımsa aynı workflow yöntemiyle çek ve ekle.

