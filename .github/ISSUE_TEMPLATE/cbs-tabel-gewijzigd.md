---
name: CBS-tabel gewijzigd
about: De workflow meldt een onderwerp als niet opgehaald
labels: data
---

**Onderwerp**
Uit de samenvatting van de workflow "CBS-cijfers verversen".

**Melding**
Welke tabellen zijn geprobeerd en wat meldde het script?

**Nieuw tabelnummer**
Zoek op https://opendata.cbs.nl/statline. Vul het nieuwe nummer in bij
`ONDERWERPEN` in `scripts/fetch_statline.py` en bij `STATLINE` in `index.html`.

**Gewijzigde veldnamen**
Staan er velden onder "Velden gemist"? Voeg de nieuwe kolomnaam toe aan de
kandidatenlijst van dat veld; de oude mag blijven staan.
