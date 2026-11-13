// The place box's list (spec 0009y): Gush Dan's cities (zoom 13) and the neighbourhoods of Tel
// Aviv-Yafo, Ramat Gan and Givatayim (zoom 15). Names are in he.json as `places.<id>`.
// Centres: © OpenStreetMap contributors, ODbL, via Nominatim, 2026-11-13. One-off lookups of each
// Hebrew name inside GUSH_DAN_BOUNDS, rounded to 4 decimals; a candidate with no result, a result
// outside the box, or a result that is another place was dropped, never moved by hand. The list
// stays under 100 entries (OSMF's substantial-extract guideline).

export type Place = {
  /** ASCII kebab-case, no dots (i18next's key separator): the `places.<id>` key. */
  id: string;
  center: [lng: number, lat: number];
  zoom: 13 | 15;
};

export const PLACES: readonly Place[] = [
  { id: 'tel-aviv-yafo', center: [34.7818, 32.0853], zoom: 13 },
  { id: 'ramat-gan', center: [34.8247, 32.0687], zoom: 13 },
  { id: 'givatayim', center: [34.8113, 32.073], zoom: 13 },
  { id: 'bnei-brak', center: [34.8324, 32.0874], zoom: 13 },
  { id: 'holon', center: [34.7804, 32.0193], zoom: 13 },
  { id: 'bat-yam', center: [34.7505, 32.0155], zoom: 13 },
  { id: 'petah-tikva', center: [34.886, 32.0878], zoom: 13 },
  { id: 'ramat-hasharon', center: [34.8381, 32.1431], zoom: 13 },
  { id: 'herzliya', center: [34.8469, 32.1656], zoom: 13 },
  { id: 'kiryat-ono', center: [34.8594, 32.0592], zoom: 13 },
  { id: 'or-yehuda', center: [34.863, 32.027], zoom: 13 },
  { id: 'yehud-monosson', center: [34.8908, 32.0332], zoom: 13 },
  { id: 'givat-shmuel', center: [34.8525, 32.0769], zoom: 13 },
  { id: 'rishon-lezion', center: [34.8101, 31.9636], zoom: 13 },
  { id: 'hod-hasharon', center: [34.893, 32.1562], zoom: 13 },
  { id: 'azor', center: [34.8026, 32.0282], zoom: 13 },
  { id: 'ganei-tikva', center: [34.8761, 32.0604], zoom: 13 },
  { id: 'savyon', center: [34.8799, 32.0475], zoom: 13 },
  { id: 'beit-dagan', center: [34.8302, 32.0019], zoom: 13 },
  { id: 'florentin', center: [34.7686, 32.0578], zoom: 15 },
  { id: 'neve-tzedek', center: [34.7641, 32.0633], zoom: 15 },
  { id: 'kerem-hateimanim', center: [34.7661, 32.0703], zoom: 15 },
  { id: 'old-north', center: [34.7745, 32.0839], zoom: 15 },
  { id: 'new-north', center: [34.7896, 32.0869], zoom: 15 },
  { id: 'kikar-hamedina', center: [34.7898, 32.0869], zoom: 15 },
  { id: 'bavli', center: [34.7987, 32.0951], zoom: 15 },
  { id: 'montefiore', center: [34.7897, 32.0691], zoom: 15 },
  { id: 'ramat-aviv', center: [34.7951, 32.1089], zoom: 15 },
  { id: 'ramat-aviv-gimel', center: [34.8004, 32.1267], zoom: 15 },
  { id: 'neve-avivim', center: [34.7965, 32.1191], zoom: 15 },
  { id: 'tel-baruch', center: [34.8159, 32.1198], zoom: 15 },
  { id: 'neot-afeka', center: [34.8217, 32.1176], zoom: 15 },
  { id: 'tzahala', center: [34.8362, 32.1226], zoom: 15 },
  { id: 'ramat-hahayal', center: [34.8366, 32.1156], zoom: 15 },
  { id: 'hadar-yosef', center: [34.8236, 32.1083], zoom: 15 },
  { id: 'yad-eliyahu', center: [34.7933, 32.0587], zoom: 15 },
  { id: 'shapira', center: [34.7804, 32.0509], zoom: 15 },
  { id: 'neve-shaanan', center: [34.777, 32.0569], zoom: 15 },
  { id: 'hatikva', center: [34.7881, 32.0513], zoom: 15 },
  { id: 'kiryat-shalom', center: [34.7774, 32.0433], zoom: 15 },
  { id: 'jaffa', center: [34.751, 32.0443], zoom: 15 },
  { id: 'ajami', center: [34.7501, 32.0452], zoom: 15 },
  { id: 'bursa', center: [34.8022, 32.0859], zoom: 15 },
  { id: 'ramat-chen', center: [34.8189, 32.056], zoom: 15 },
  { id: 'nahalat-ganim', center: [34.8196, 32.0933], zoom: 15 },
  { id: 'tel-binyamin', center: [34.8075, 32.0855], zoom: 15 },
  { id: 'marom-nave', center: [34.8289, 32.0726], zoom: 15 },
  { id: 'ramat-amidar', center: [34.8364, 32.0677], zoom: 15 },
  { id: 'kiryat-krinitzi', center: [34.8471, 32.0584], zoom: 15 },
  { id: 'givat-rambam', center: [34.8043, 32.0668], zoom: 15 },
];
