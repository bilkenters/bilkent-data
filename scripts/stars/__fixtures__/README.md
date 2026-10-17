# STARS fixture'lari

Parser testleri icin gercek HTML. 2026-09-25 tarihinde GitHub Actions'tan cekildi (konteynerden STARS kapali). Guncellemek icin `docs/stars-veri/README.md` §5'teki workflow yontemi.

| Dosya | Kaynak | Bayt |
|---|---|---|
| `plainCourseCodes.html` | /homepage/ajax/plainCourseCodes.php | 24004 |
| `plainOfferings-GE-20261.html` | /homepage/ajax/plainOfferings.php?COURSE_CODE=GE&SEMESTER=20261 | 66388 |
| `plainOfferings-EDU-20261.html` | /homepage/ajax/plainOfferings.php?COURSE_CODE=EDU&SEMESTER=20261 | 24129 |
| `plainOfferings-HUM-20101.html` | /homepage/ajax/plainOfferings.php?COURSE_CODE=HUM&SEMESTER=20101 | 66095 |
| `plainOfferings-HUM-20151.html` | /homepage/ajax/plainOfferings.php?COURSE_CODE=HUM&SEMESTER=20151 | 83650 |
| `schedule-CS_101-1-20261.html` | /homepage/ajax/schedule.php?COURSE=CS%20101-1&SEMESTER=20261 | 12388 |
| `schedule-TURK_101-1-20261.html` | /homepage/ajax/schedule.php?COURSE=TURK%20101-1&SEMESTER=20261 | 47 |
| `schedule-ECON_102-1-20261.html` | /homepage/ajax/schedule.php?COURSE=ECON%20102-1&SEMESTER=20261 | 12210 |
| `schedule-CHEM_101-1-20261.html` | /homepage/ajax/schedule.php?COURSE=CHEM%20101-1&SEMESTER=20261 | 12364 |
| `schedule-ENG_101-1-20261.html` | /homepage/ajax/schedule.php?COURSE=ENG%20101-1&SEMESTER=20261 | 12246 |
| `oldOfferings-CS_202.html` | /homepage/ajax/courses.oldOfferings.php?COURSE=CS%20202 | 174492 |
| `oldOfferings-EDU_113.html` | /homepage/ajax/courses.oldOfferings.php?COURSE=EDU%20113 | 5907 |
| `courses.list-EDU.html` | /homepage/ajax/courses.list.php?CRSCODES=EDU&SHW= | 41182 |
| `syllabus-20261-CS-101-1.html` | /syllabus/show/20261/CS/101/1 | 29288 |
| `syllabus-20261-MATH-101-1.html` | /syllabus/show/20261/MATH/101/1 | 28052 |
| `syllabus-20252-ECON-102-1.html` | /syllabus/show/20252/ECON/102/1 | 28443 |

Notlar:
- GE: cok hocali sube (GE 400), `Unlimited` kontenjan (GE 100/250/251), `Staff`, saatsiz dersler.
- EDU: kucuk bolum, cok hocali sube (EDU 113-1).
- HUM 20101: kontenjan sutunlari `-`; HUM 20151: dolu.
- TURK 101-1 schedule: `no schedule`.
- oldOfferings CS 202: on kosul + saat dagilimi + 1990'a kadar satirlar.
- schedule türleri: CS 101-1 ve CHEM 101-1 `cl_ders_DY` + `cl_lab_LL`; ECON 102-1 `cl_ders_DY` + `cl_ders_DR` (recitation); ENG 101-1 yalnizca `cl_ders_DY`. Online ornegi (`cl_ders_DD`, `cl_lab_LO`) yok; legend tablosunda siniflar var.
- Cok hocali hucre: her hoca ayri `<span style='...display:table-row'>`, adi ilk `<div>`'de, ID `openCoursesPage('8580')`'de. HTML'de kapanmamis `<a>` var; cheerio tolere ediyor, regex'e guvenme.
- Syllabus sayfalarinda harf notu araligi yok.

## S1 ekleri (2026-09-25, `.github/probe` gecici workflow'u)

| Dosya | Kaynak |
|---|---|
| `academic_units.html` | /homepage/academic_units.php |
| `curriculum-{CTIS,CS,MAN,PSYC}.html` | /homepage/curriculum.php?DEPT=… (program listesi) |
| `curriculum.printable-<PROGRAM>.html` | /homepage/ajax/curriculum.printableHTML.php?PROGRAM=…&TRACK= (CTIS_BS_F, CTIS_MN, CS_BS, MAN_BS_2018, ECON_BA_2018, PSYC_BA_2013) |
| `curriculum.electives-<PROGRAM>-<GRUP>.html` | /homepage/ajax/curriculum.electiveCourses.php?DEPT=&PROGRAM=&TRACK=&CODE=&TITLE= |
| `courses.list-CS.html` | /homepage/ajax/courses.list.php?CRSCODES=CS&SHW= |
| `syllabus-20261-GE-100-1.html` | FZ "N/A", ders kitabi yok |
| `syllabus-20261-CS-999-1.html` | olmayan ders: "CS 999 is not a course." (HTTP 200) |
| `staff.list-SAMPLE.html` | **sentetik**: staff.list.php yapisi; telefon/oda/e-posta sahte (gercek iletisim verisi repoya girmez) |
| `snapshot/plainOfferings-20261.json.gz` | 61 bolumun 20261 plainOfferings HTML'i (uyum testi + live e2e testi) |
| `snapshot/offerings-20261-v1.json.gz` | eski scraper'in 20261 offerings'i (commit cba4890): uyum testi referansi + testlerin sabit "onceki" verisi |

Notlar:
- Mufredat ucu: curriculum.php sayfasindaki `openCurriculumlPage('CTIS_BS_F','')` -> `ajax/curriculum.printableHTML.php?PROGRAM=CTIS_BS_F&TRACK=`. Secmeli gruplari: `openElectiveGroup('CTIS','CTIS_BS_F','','CTIS_F_UR','General Elective')` -> `ajax/curriculum.electiveCourses.php`.
- Akademik birim kodu ders kodundan farkli olabilir: `DEPT=EE` (dersler EEE). Hukuk gibi tek birimli fakultede linkler fakulte baslik satirinda.
- Dersi olmayan bolumun plainOfferings'i: `<div id='poDiv'>no course</div>` (gecerli, bos).
- oldOfferings'in "Lecture Hours" kutusundaki etiketler katalogla tutarsiz (CS 202: oldOfferings "Hybrid 1 / Online 2", courses.list yuz yuze 3); saat dagilimi courses.list'ten alinir.
