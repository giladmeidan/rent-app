// The waitlist's cities (spec 0017), key → label, in display order. Shared by the page (app.js) and the
// server (lib/signup.js): the server rejects any other key. Plain ES module: no DOM, no Node API.
export const CITIES = Object.freeze([
  ['tel-aviv', 'תל אביב-יפו'],
  ['ramat-gan', 'רמת גן'],
  ['givatayim', 'גבעתיים'],
  ['bnei-brak', 'בני ברק'],
  ['holon', 'חולון'],
  ['bat-yam', 'בת ים'],
  ['rishon', 'ראשון לציון'],
  ['petah-tikva', 'פתח תקווה'],
  ['herzliya', 'הרצליה'],
  ['ramat-hasharon', 'רמת השרון'],
  ['kiryat-ono', 'קריית אונו'],
  ['givat-shmuel', 'גבעת שמואל'],
  ['or-yehuda', 'אור יהודה'],
  ['yehud', 'יהוד-מונוסון'],
  ['other', 'עיר אחרת'],
]);

export const CITY_KEYS = Object.freeze(CITIES.map(([key]) => key));
