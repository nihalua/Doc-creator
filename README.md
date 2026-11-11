# Doc-creator: External Work Report generator

A single-file, offline tool that fills in the **External Work Report** PDF for site visits.

## Usage

1. Download `EWR-Olusturucu.html` and open it in a browser (double-click; no internet needed).
2. The first time, fill in **Fixed details** (client, location, requested by, order number,
   your name, signature text or a signature image). They are saved in your browser.
3. Add the days you were on site with **+ Today / + Next day / + Pick date**. Change the
   activity or times for a day if needed.
4. Press **Create PDF**. The file downloads and a preview opens below.

## What gets filled in

| Item | Default |
|---|---|
| Start / end on site | 08:30 / 17:30 |
| Lunch break | 0.5 h (deducted from working time) |
| Travel | 1.5 h to site + 1.5 h back = 3.00 h, `R` (return) |
| Working time | end − start − lunch = 8.50 h |
| Signature, name | from Fixed details |
| Signature date | the day after the last day on site |
| Particular details, follow-up | always left empty |
| File name | `EWR_<Employee_Name>_<Location>_week<NN>.pdf`, e.g. `EWR_Jane_Doe_HH1_week45.pdf` |

- Working hours go into the *working time 08.00-17.00 h* row by default. In the defaults you
  can choose to split them over the 00-08 / 08-17 / 17-22 / 22-24 rows instead.
- If travel to or back is 0, `S` (single) is written.
- The form covers one Sunday–Saturday week. Days in different weeks get one page per week,
  and the file name becomes e.g. `week45-46`. Week numbers are ISO weeks.

## Development

- `src/ewr.html`: UI and PDF layout (coordinates measured from the original template).
- `template/ewr_template_blank.pdf`: the template with all values removed. To regenerate:
  `python tools/make_blank_template.py <filled.pdf> template/ewr_template_blank.pdf`
- `tools/build.py` inlines [pdf-lib](https://github.com/Hopding/pdf-lib) 1.17.1 (MIT) and the
  template into `EWR-Olusturucu.html`:
  `npm pack pdf-lib@1.17.1 && tar xzf pdf-lib-1.17.1.tgz && python tools/build.py package/dist/pdf-lib.min.js`
