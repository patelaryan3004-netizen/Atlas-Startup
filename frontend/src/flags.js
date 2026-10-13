// The site's switches. Each reads the build's environment when it is asked, so a test can turn one on and off.

// VITE_SHOW_PEOPLE: does the People and Institutions side of the site exist at all? The people page and its address, the links to it (the
// header, the menu, the landing page, its footer), the people and firms on the landing page, the firms' offices on the map, and every list of
// people. OFF unless it is set to 1, so a build that forgets to say it shows no named person from people_seed.json and no institution from
// institutions_seed.json anywhere. The server has the matching switch (SHOW_PEOPLE, backend/src/app.js): turn both on together, once the
// people listed have been told.
// (The investor directory, /investors, is its own, already published section and is not behind this switch.)
const ON = ['1', 'true', 'yes', 'on'];
export const showPeople = () => ON.includes(String(import.meta.env.VITE_SHOW_PEOPLE ?? '').trim().toLowerCase());
